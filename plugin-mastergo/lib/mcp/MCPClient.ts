import { ConnectionStatus, JSONRPCRequest, JSONRPCNotification, JSONRPCSuccessResponse, JSONRPCErrorResponse, MCPClientConfig, MCPClientEvents } from './types'
import { logger } from '../utils/Logger'
import { CONNECTION_CONFIG, PERFORMANCE_CONFIG, WS_READY_STATE, safeClearTimeout, safeClearInterval, debounce, generateId } from '../utils/Utils'

// MCP 服务器信息接口
export interface MCPServerInfo {
  name: string
  version: string
  description: string
}

// MCP 服务器功能特性接口
export interface MCPFeatures {
  supportedMethods: string[]
  dslAttachments: boolean
  ollamaSupport: boolean
  skillCount: number
}

// MCP 服务器能力接口
export interface MCPCapabilities {
  maxConcurrentTasks: number
  taskTimeout: number
  heartbeatInterval: number
}

// MCP 状态接口
export interface MCPStatus {
  connected: boolean
  connecting: boolean
  calling: boolean
  lastMessage?: string
  serverInfo?: MCPServerInfo
  features?: MCPFeatures
  capabilities?: MCPCapabilities
}

// 消息队列接口
interface QueuedMessage {
  id: string
  data: any
  timestamp: number
  retries: number
}

/** 根据请求生成成功响应 */
export function createSuccessResponse(id: string | number, result: any): JSONRPCSuccessResponse {
  return { jsonrpc: '2.0', id, result }
}

/** 根据请求生成错误响应 */
export function createErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: any,
): JSONRPCErrorResponse {
  return { jsonrpc: '2.0', id: id ?? 0, error: { code, message, data } }
}

/** 判断消息是否为请求（有 id 字段） */
function isRequest(msg: any): msg is JSONRPCRequest {
  return msg && msg.jsonrpc === '2.0' && msg.method && msg.id !== undefined
}

/** 判断消息是否为通知（无 id 字段） */
function isNotification(msg: any): msg is JSONRPCNotification {
  return msg && msg.jsonrpc === '2.0' && msg.method && msg.id === undefined
}

/**
 * 优化的 MCP 客户端：管理 WebSocket 连接、心跳、自动重连和 JSON-RPC 消息收发。
 *
 * 优化要点：
 * - 内存管理：清理定时器、事件监听器、消息队列
 * - 性能优化：消息队列、防抖、节流、日志优化
 * - 架构改进：生命周期管理、错误处理、状态管理
 * - 防止内存泄漏：WeakMap、清理函数、引用管理
 */
export class MCPClient {
  private ws: WebSocket | null = null
  private status: ConnectionStatus = 'disconnected'
  private config: Required<MCPClientConfig>
  private mcpStatus: MCPStatus = {
    connected: false,
    connecting: false,
    calling: false
  }

  private heartbeatTimer: number | null = null
  private reconnectTimer: number | null = null
  private missedHeartbeats = 0
  private reconnectDelay: number
  private reconnectAttempt = 0
  private messageQueue: QueuedMessage[] = []
  private pendingRequests: Map<string, { resolve: Function; reject: Function; timeout: number }> = new Map()
  private destroyed = false

  private callbacks: Partial<MCPClientEvents> = {}

  constructor(config: MCPClientConfig) {
    this.config = {
      serverUrl: config.serverUrl,
      heartbeatInterval: config.heartbeatInterval ?? CONNECTION_CONFIG.DEFAULT_HEARTBEAT_INTERVAL,
      reconnectDelay: config.reconnectDelay ?? CONNECTION_CONFIG.DEFAULT_RECONNECT_DELAY,
      maxReconnectDelay: config.maxReconnectDelay ?? CONNECTION_CONFIG.MAX_RECONNECT_DELAY,
      maxMissedHeartbeats: config.maxMissedHeartbeats ?? CONNECTION_CONFIG.MAX_MISSED_HEARTBEATS,
    }
    this.reconnectDelay = this.config.reconnectDelay

    logger.info('[MCPClient] Client initialized', { serverUrl: this.config.serverUrl })
  }

  /** 注册事件回调 */
  on<K extends keyof MCPClientEvents>(event: K, callback: MCPClientEvents[K]): void {
    if (this.destroyed) {
      logger.warn('[MCPClient] Cannot register callback on destroyed client')
      return
    }
    this.callbacks[event] = callback
  }

  /** 获取当前连接状态 */
  getStatus(): ConnectionStatus {
    return this.status
  }

  /** 获取服务器地址 */
  getServerUrl(): string {
    return this.config.serverUrl
  }

  /** 获取 MCP 状态 */
  getMCPStatus(): MCPStatus {
    return { ...this.mcpStatus }
  }

  /** 主动连接服务器 */
  connect(): void {
    if (this.destroyed) {
      logger.warn('[MCPClient] Cannot connect destroyed client')
      return
    }

    logger.info('[MCPClient] Connect requested', { serverUrl: this.config.serverUrl })
    
    if (!this.config.serverUrl.trim()) {
      const error = new Error('MCP Server URL cannot be empty')
      logger.error('[MCPClient] Connection failed', error)
      this.callbacks.onError?.(error)
      return
    }

    this.clearTimers()
    this.reconnectAttempt = 0
    this.reconnectDelay = this.config.reconnectDelay
    this.mcpStatus.connecting = true
    this.mcpStatus.connected = false
    
    this.doConnect()
  }

  /** 主动断开连接 */
  disconnect(): void {
    logger.info('[MCPClient] Disconnect requested')
    this.clearTimers()
    this.clearMessageQueue()
    this.clearPendingRequests()
    
    if (this.ws) {
      this.setStatus('disconnecting')
      this.mcpStatus.connecting = false
      this.mcpStatus.connected = false
      this.mcpStatus.calling = false
      
      try {
        this.ws.close(1000, 'Client disconnect')
      } catch (error) {
        logger.warn('[MCPClient] Error closing WebSocket', error)
      }
      
      this.ws = null
    }

    this.setStatus('disconnected')
    this.mcpStatus.lastMessage = 'Connection closed'
    logger.info('[MCPClient] Disconnect completed')
  }

  /** 向服务器发送通知（无 id，不期待响应） */
  sendNotification(method: string, params?: Record<string, any>): void {
    if (this.destroyed) {
      logger.warn('[MCPClient] Cannot send notification on destroyed client')
      return
    }

    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined && { params }),
    }

    this.queueMessage(notification)
  }

  /** 发送请求并等待响应 */
  async sendRequest<T = any>(method: string, params?: Record<string, any>): Promise<T> {
    if (this.destroyed) {
      return Promise.reject(new Error('Client is destroyed'))
    }

    const id = generateId()
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined && { params })
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout: ${method}`))
      }, PERFORMANCE_CONFIG.REQUEST_TIMEOUT) as unknown as number

      this.pendingRequests.set(id, { resolve, reject, timeout })
      this.queueMessage(request)
    })
  }

  /** 更新服务器地址并重连 */
  setServerUrl(url: string): void {
    logger.info('[MCPClient] Setting server URL', { from: this.config.serverUrl, to: url })
    this.config.serverUrl = url
    
    if (this.status === 'connected' || this.status === 'reconnecting') {
      this.disconnect()
      this.connect()
    }
  }

  /** 销毁客户端，释放所有资源 */
  destroy(): void {
    logger.info('[MCPClient] Destroying client')
    this.destroyed = true
    this.disconnect()
    this.callbacks = {}
    logger.info('[MCPClient] Client destroyed')
  }

  // ---- 内部方法 ----

  private doConnect(): void {
    if (this.destroyed) {
      return
    }

    try {
      this.setStatus('connecting')
      
      if (typeof WebSocket === 'undefined' || typeof WebSocket !== 'function') {
        const error = new Error('WebSocket API is not available in MasterGo plugin environment')
        logger.error('[MCPClient] WebSocket not available', error)
        this.handleConnectionError(error)
        return
      }
      
      this.ws = new WebSocket(this.config.serverUrl)
      this.setupWebSocketHandlers()
    } catch (error) {
      logger.error('[MCPClient] WebSocket creation failed', error instanceof Error ? error : String(error))
      this.handleConnectionError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private setupWebSocketHandlers(): void {
    if (!this.ws) return

    const debouncedErrorHandler = debounce((error: Event) => {
      logger.error('[MCPClient] WebSocket error', error)
      this.handleConnectionError(new Error('WebSocket connection error'))
    }, PERFORMANCE_CONFIG.DEBOUNCE_DELAY)

    this.ws.onopen = () => this.handleOpen()
    this.ws.onmessage = (event: MessageEvent) => this.handleMessage(event.data)
    this.ws.onclose = (event: CloseEvent) => this.handleClose(event)
    this.ws.onerror = debouncedErrorHandler
  }

  private handleOpen(): void {
    logger.info('[MCPClient] Connection established', { serverUrl: this.config.serverUrl })
    
    this.reconnectAttempt = 0
    this.reconnectDelay = this.config.reconnectDelay
    this.missedHeartbeats = 0
    this.mcpStatus.connected = true
    this.mcpStatus.connecting = false
    this.mcpStatus.calling = false
    this.mcpStatus.lastMessage = 'Connected to MCP Server'
    
    this.startHeartbeat()
    this.processMessageQueue()
    this.setStatus('connected')
  }

  private handleClose(event: CloseEvent): void {
    logger.info('[MCPClient] Connection closed', { 
      code: event.code, 
      reason: event.reason, 
      wasClean: event.wasClean 
    })

    this.stopHeartbeat()
    this.mcpStatus.connected = false
    this.mcpStatus.connecting = false
    this.mcpStatus.calling = false
    this.mcpStatus.lastMessage = `Connection closed: ${event.reason || 'Unknown reason'}`

    if (this.status !== 'disconnecting' && this.status !== 'disconnected' && !this.destroyed) {
      this.scheduleReconnect()
    } else {
      this.setStatus('disconnected')
    }
  }

  private handleConnectionError(error: Error): void {
    this.mcpStatus.connecting = false
    this.mcpStatus.connected = false
    this.mcpStatus.lastMessage = error.message
    this.setStatus('disconnected')
    this.callbacks.onError?.(error)
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return
    logger.debug('[MCPClient] Status change', { from: this.status, to: status })
    this.status = status
    this.callbacks.onStatusChange?.(status)
  }

  private handleMessage(data: any): void {
    if (this.destroyed) return

    if (data === 'pong' || data === '"pong"') {
      this.missedHeartbeats = 0
      return
    }

    let parsed: any
    try {
      parsed = typeof data === 'string' ? JSON.parse(data) : data
    } catch (error) {
      logger.error('[MCPClient] Failed to parse message', { error, data })
      return
    }

    if (isRequest(parsed)) {
      this.callbacks.onRequest?.(parsed)
    } else if (isNotification(parsed)) {
      this.callbacks.onNotification?.(parsed)
    } else if (parsed.id !== undefined) {
      this.handleResponse(parsed)
    }
  }

  private handleResponse(response: any): void {
    const { id, result, error } = response
    const pending = this.pendingRequests.get(String(id))

    if (pending) {
      safeClearTimeout(pending.timeout)
      this.pendingRequests.delete(String(id))

      if (error) {
        pending.reject(new Error(error.message))
      } else {
        pending.resolve(result)
      }
    }
  }

  private queueMessage(data: any): void {
    if (this.destroyed) return

    const message: QueuedMessage = {
      id: generateId(),
      data,
      timestamp: Date.now(),
      retries: 0
    }

    this.messageQueue.push(message)

    if (this.messageQueue.length > CONNECTION_CONFIG.MESSAGE_QUEUE_MAX_SIZE) {
      this.messageQueue.shift()
      logger.warn('[MCPClient] Message queue full, dropped oldest message')
    }

    this.processMessageQueue()
  }

  private processMessageQueue(): void {
    if (!this.ws || this.ws.readyState !== WS_READY_STATE.OPEN || this.messageQueue.length === 0) {
      return
    }

    const message = this.messageQueue.shift()
    if (!message) return

    try {
      const json = JSON.stringify(message.data)
      this.ws.send(json)
      logger.debug('[MCPClient] Message sent', { id: message.id })
    } catch (error) {
      logger.error('[MCPClient] Failed to send message', error)
      
      if (message.retries < 3) {
        message.retries++
        this.messageQueue.unshift(message)
      }
    }

    if (this.messageQueue.length > 0) {
      requestAnimationFrame(() => this.processMessageQueue())
    }
  }

  private clearMessageQueue(): void {
    this.messageQueue = []
    logger.debug('[MCPClient] Message queue cleared')
  }

  private clearPendingRequests(): void {
    this.pendingRequests.forEach(({ reject, timeout }) => {
      safeClearTimeout(timeout)
      reject(new Error('Client disconnected'))
    })
    this.pendingRequests.clear()
    logger.debug('[MCPClient] Pending requests cleared')
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    
    this.heartbeatTimer = setInterval(() => {
      if (this.destroyed) {
        this.stopHeartbeat()
        return
      }

      this.missedHeartbeats++
      
      if (this.missedHeartbeats >= this.config.maxMissedHeartbeats) {
        logger.warn('[MCPClient] Heartbeat timeout, reconnecting')
        this.stopHeartbeat()
        this.forceReconnect()
        return
      }
      
      this.queueMessage('ping')
    }, this.config.heartbeatInterval) as unknown as number

    logger.debug('[MCPClient] Heartbeat started', { interval: this.config.heartbeatInterval })
  }

  private stopHeartbeat(): void {
    safeClearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    logger.debug('[MCPClient] Heartbeat stopped')
  }

  private scheduleReconnect(): void {
    if (this.destroyed || typeof WebSocket === 'undefined') {
      return
    }

    if (this.reconnectAttempt >= CONNECTION_CONFIG.MAX_RECONNECT_ATTEMPTS) {
      logger.error('[MCPClient] Max reconnect attempts reached')
      this.setStatus('disconnected')
      return
    }

    this.setStatus('reconnecting')
    this.reconnectAttempt++

    const delay = Math.min(this.reconnectDelay, this.config.maxReconnectDelay)
    logger.info('[MCPClient] Scheduling reconnect', { attempt: this.reconnectAttempt, delay })

    this.reconnectTimer = setTimeout(() => {
      this.doConnect()
    }, delay) as unknown as number

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.config.maxReconnectDelay)
  }

  private forceReconnect(): void {
    if (this.ws) {
      try {
        this.ws.close(4000, 'Heartbeat timeout')
      } catch (error) {
        logger.warn('[MCPClient] Error closing WebSocket for reconnect', error)
      }
      this.ws = null
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat()
    safeClearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    logger.debug('[MCPClient] Timers cleared')
  }
}
