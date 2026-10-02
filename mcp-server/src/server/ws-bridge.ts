/**
 * WebSocket 桥接层
 * 
 * 管理 MasterGo 插件的 WebSocket 连接，
 * 并作为 HTTP 服务器和 WebSocket 插件之间的消息桥接。
 * 
 * 消息链路:
 *   HTTP/外部客户端 -> handleMcpRequest() -> 转发到 WebSocket 插件 -> 等待响应 -> 返回结果
 *   WebSocket 插件连接 -> 接收响应 -> resolve 对应的 pending Promise
 */
import { WebSocketServer, WebSocket } from 'ws'
import type { JSONRPCRequest, JSONRPCResponse } from '../types/index.js'
import { killPort } from '../utils/process.js'
import { safeParseObject } from '../utils/safe-json.js'
import { SERVER_VERSION } from '../version.js'
import { routeToolCall, type ToolRouterBridge } from '../utils/tool-handlers.js'

interface PendingRequest {
  resolve: (response: JSONRPCResponse) => void
  reject: (reason: Error) => void
  timeout: NodeJS.Timeout
  method: string
  requestKey: string
}

interface PluginClient {
  socket: WebSocket
  clientId: number
  clientType: BridgeClientType
  /** 该客户端归属的后端（单后端模式下恒为桥的默认后端；共联模式下由 initialize 决定） */
  backend: BridgeBackend
  initialized: boolean
  sessionId: string
  codename: string
  documentName: string
  documentId: string
  pageName: string
  pageId: string
  connectedAt: number
  lastPong: number
  meta: Record<string, any>
}

/**
 * 后端标识。一个 MCP 服务端可以同时托管多个设计工具的桥：
 *   - `mastergo` → MasterGo 插件（plugin-mastergo）
 *   - `penpot`   → Penpot 插件（plugin-penpot）
 * 两者讲**同一套 JSON-RPC 协议**（这正是 plugin-penpot 能零改动复用 UI 传输层的原因），
 * 因此差异只在「怎么识别客户端、怎么命名会话、clientId 怎么错开」。
 */
export type BridgeBackend = 'mastergo' | 'penpot'

/** 插件客户端类型。`unknown` 表示已连上但还没 announce 自己是谁 */
export type BridgeClientType = 'mastergo-plugin' | 'penpot-plugin' | 'unknown'

export interface WebSocketBridgeOptions {
  /** 本桥服务的后端。默认 `mastergo`（保持历史行为） */
  backend?: BridgeBackend
  /**
   * 会话 id 前缀。仅单后端模式下生效（用于兼容自定义前缀）。
   * 共联模式下前缀**按客户端声明的后端**取 `BRIDGE_PROFILE[backend].sessionPrefix`。
   */
  sessionPrefix?: string
  /**
   * clientId 起始偏移。多个桥共用 router 时必须错开，
   * 否则 `findPluginClientByClientId(1)` 会同时命中两个桥的客户端。
   */
  clientIdOffset?: number
  /**
   * 本桥接受哪些后端。默认只有 `backend` 自己。
   *
   * 传入多个（如 `['mastergo','penpot']`）= **共联单 hub**：两种插件连同一个端口，
   * 按 `initialize` 自述的后端分区（会话前缀随之不同）。
   */
  acceptedBackends?: BridgeBackend[]
}



interface QueuedRequest {
  request: JSONRPCRequest
  sessionId?: string
  clientId?: number
  resolve: (response: JSONRPCResponse) => void
  reject: (reason: Error) => void
  startTime: number
}

/**
 * 路由目标。
 * 同一个文档可能同时开着多个插件实例（如 Nova / Pixel），它们的 sessionId 相同
 * （`sess_<documentId>`），只有 clientId 唯一，所以 clientId 优先。
 */
export interface SessionTarget {
  sessionId?: string
  clientId?: number
}

/**
 * HttpServer / SdkServer / register-tools 需要的最小桥接口。
 * `WebSocketBridge`（单后端）与 `BridgeRouter`（多后端）都满足它 ——
 * 这使得「新增一个后端」不需要改任何上层的类型签名。
 */
export interface ServerBridge extends ToolRouterBridge {
  isPluginConnected(): boolean
  handleToolsCall(request: JSONRPCRequest, sourceId?: string): Promise<JSONRPCResponse>
}

/** 各后端的默认参数（`sessionPrefix` 是路由依据，别随意改） */
export const BRIDGE_PROFILE: Record<BridgeBackend, Required<Pick<WebSocketBridgeOptions, 'sessionPrefix' | 'clientIdOffset' | 'backend'>> & {
  /** clientInfo.name 中出现这些关键字即认为是本后端的插件 */
  clientNameHints: string[]
  /** 连接去失时的提示文案 */
  noClientMessage: string
}> = {
  mastergo: {
    backend: 'mastergo',
    sessionPrefix: 'sess_',
    clientIdOffset: 0,
    clientNameHints: ['MasterGo'],
    noClientMessage: 'No MasterGo plugin connected. Please ensure the MasterGo plugin is running.',
  },
  penpot: {
    backend: 'penpot',
    sessionPrefix: 'sess_penpot_',
    clientIdOffset: 10000,
    clientNameHints: ['Penpot'],
    noClientMessage: 'No Penpot plugin connected. Please open the plugin-penpot panel and connect to this server.',
  },
}

/** 后端 → 客户端类型 */
function pluginTypeFor(backend: BridgeBackend): BridgeClientType {
  return `${backend}-plugin` as BridgeClientType
}

/** 客户端类型 → 后端。共联模式下靠它把客户端归到正确的分区 */
export function backendOfClientType(clientType: BridgeClientType): BridgeBackend | null {
  if (clientType === 'mastergo-plugin') return 'mastergo'
  if (clientType === 'penpot-plugin') return 'penpot'
  return null
}

/** 没有 sourceId 的客户端（HTTP POST /mcp、SSE SDK 路径）共用的兜底源标识 */
const DEFAULT_SESSION_SOURCE = '__default__'

export class WebSocketBridge {
  private wss: WebSocketServer | null = null
  private clients: Map<number, PluginClient> = new Map()
  private clientCounter = 0
  private pendingRequests: Map<string, PendingRequest> = new Map()
  private pendingIdIndex: Map<string, string> = new Map() // idStr → requestKey
  private requestQueue: QueuedRequest[] = []
  private activeCount = 0
  private readonly MAX_CONCURRENT = 10
  private shuttingDown = false
  // 源客户端 ID → 目标插件会话映射（用于 session_switch 持久化）
  private activeSessionMap: Map<string, SessionTarget> = new Map()

  /** 本桥的**默认**后端（单后端模式即唯一后端；共联模式下用于无自述时的兼容回退） */
  readonly backend: BridgeBackend
  /** 本桥接受的后端集合（长度 > 1 即共联模式） */
  readonly acceptedBackends: readonly BridgeBackend[]
  /** 单后端模式下的客户端类型（共联模式下按客户端后端动态决定） */
  readonly pluginClientType: BridgeClientType
  /**
   * 会话 id 前缀（单后端模式）。
   * ⚠️ 公开是有意的：BridgeRouter 需要比较前缀**长度**来决定归属
   * （`sess_` 是 `sess_penpot_` 的前缀，必须取最长匹配，否则 Penpot 会话会被路由到 mastergo）。
   */
  readonly sessionPrefix: string
  private readonly clientIdOffset: number
  private readonly clientNameHints: string[]
  private readonly noClientMessage: string
  /** 日志前缀 —— 多桥同时运行时靠它区分输出 */
  private readonly logTag: string

  constructor(options: WebSocketBridgeOptions = {}) {
    this.backend = options.backend ?? 'mastergo'
    const accepted = options.acceptedBackends?.length ? [...options.acceptedBackends] : [this.backend]
    // 去重且保证默认后端在内
    this.acceptedBackends = [...new Set([this.backend, ...accepted])]
    const profile = BRIDGE_PROFILE[this.backend]
    this.pluginClientType = pluginTypeFor(this.backend)
    this.sessionPrefix = options.sessionPrefix ?? profile.sessionPrefix
    this.clientIdOffset = options.clientIdOffset ?? profile.clientIdOffset
    this.clientNameHints = profile.clientNameHints
    this.noClientMessage = profile.noClientMessage
    this.logTag = this.isShared
      ? `[WS Hub:${this.acceptedBackends.join('+')}]`
      : this.backend === 'mastergo'
        ? '[WS Bridge]'
        : `[WS Bridge:${this.backend}]`
  }

  /** 是否共联多个后端（一个端口接两种插件） */
  get isShared(): boolean {
    return this.acceptedBackends.length > 1
  }

  /** 本桥能否服务某后端的客户端（BridgeRouter 靠它定位该发给哪个桥） */
  canServeBackend(backend: BridgeBackend): boolean {
    return this.acceptedBackends.includes(backend)
  }

  /** 某后端的会话 id 前缀 */
  sessionPrefixFor(backend: BridgeBackend): string {
    if (!this.isShared && backend === this.backend) return this.sessionPrefix
    return BRIDGE_PROFILE[backend].sessionPrefix
  }

  /**
   * 会话 id → 归属后端与匹配长度（最长前缀优先的原料）。
   * 共联模式下两个前缀都在同一个桥上，因此必须用返回值而不是
   * `ownsSessionId` 的布尔结果 —— 否则 `sess_penpot_x` 会被 `sess_` 误吃。
   */
  matchSession(sessionId: string | undefined): { backend: BridgeBackend; length: number } | null {
    if (typeof sessionId !== 'string' || !sessionId) return null
    let best: { backend: BridgeBackend; length: number } | null = null
    for (const backend of this.acceptedBackends) {
      const prefix = this.sessionPrefixFor(backend)
      if (!sessionId.startsWith(prefix)) continue
      if (!best || prefix.length > best.length) best = { backend, length: prefix.length }
    }
    return best
  }

  /** 本桥是否接受这个客户端（按客户端类型反推后端，再看该后端是否在接收集里） */
  acceptsClient(client: { clientType: BridgeClientType; initialized: boolean }): boolean {
    if (!client.initialized) return false
    const backend = backendOfClientType(client.clientType)
    return backend !== null && this.canServeBackend(backend)
  }

  private isUsable(client: PluginClient): boolean {
    return this.acceptsClient(client) && client.socket.readyState === WebSocket.OPEN
  }

  /**
   * 会话列表 + **按需实时补全**文档元数据。
   *
   * 为什么需要：插件在 initialize 那一刻可能还不知道文档信息
   * （UI iframe 挂载早于沙箱注册消息监听 → 那一发 HELLO 会丢），
   * 于是服务端拿到一串空 documentName/pageName —— `session_list` 里根本看不出在操作哪个文件。
   * 只修插件侧治不彻底（还要求用户重载插件）；而「元数据从**实时查询**来」
   * 彻底去掉了对握手时序的依赖：谁有真相就问谁，问到的结果缓回客户端，后续调用直接命中。
   *
   * 插件不应答也不影响列表本身（短超时 + 吞掉错误）：补全失败只是少几个字段，
   * 不应该让 `session_list` 这个**用来排障**的工具反而挂掉。
   */
  async listPluginSessionsResolved(timeoutMs = 2000): Promise<Array<ReturnType<WebSocketBridge['listPluginSessions']>[number]>> {
    const sessions = this.listPluginSessions()
    const pending = sessions.filter((s) => !s.documentName || !s.pageName || !s.codename)
    if (!pending.length) return sessions

    await Promise.all(pending.map(async (session) => {
      const client = this.clients.get(session.clientId)
      if (!client) return
      try {
        const response = await this.withTimeout(
          this.forwardRequest(
            { jsonrpc: '2.0', id: `session-enrich-${session.clientId}-${Date.now()}`, method: 'document/getInfo', params: {} } as JSONRPCRequest,
            session.sessionId,
            session.clientId,
          ),
          timeoutMs,
        )
        const info = extractDocumentInfo(response)
        if (!info) return
        // 写回客户端：这是一次**缓存填充**，不是会话状态变更
        if (!client.codename && info.codename) client.codename = info.codename
        if (!client.documentName && info.documentName) client.documentName = info.documentName
        if (!client.documentId && info.documentId) client.documentId = info.documentId
        if (!client.pageName && info.pageName) client.pageName = info.pageName
        if (!client.pageId && info.pageId) client.pageId = info.pageId
      } catch {
        /* 插件不在线 / 不应答：保持空值，不影响列表 */
      }
    }))

    return this.listPluginSessions()
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    // 迟到的拒绝不要再冒成 unhandledRejection
    promise.catch(() => {})
    let timer: NodeJS.Timeout | null = null
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    })
    try {
      return await Promise.race([promise, guard])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * 会话 id 是否由本桥的**某个**已接受前缀匹配。
   *
   * ⚠️ 这是纯前缀测试，不是「排他归属」——`sess_penpot_x` 对前缀 `sess_` 也会返回 true。
   * 唯一排他判定在 `BridgeRouter.backendForSessionId`（取最长前缀）。
   * 共联模式下请用 `matchSession()`，它同时返回归属后端。
   */
  ownsSessionId(sessionId: string | undefined): boolean {
    return this.matchSession(sessionId) !== null
  }

  /**
   * 启动 WebSocket 服务器，等待 MasterGo 插件连接
   * 如果端口被占用，自动清理后重试
   */
  private bindHost = '127.0.0.1'

  start(wsPort: number, host: string = '127.0.0.1'): void {
    this.bindHost = host
    // 只清理自己的旧实例；陌生进程占用时只报告（不再无差别 kill）
    killPort(wsPort)
    this.startWithRetry(wsPort, 3)
  }

  private startWithRetry(wsPort: number, retries: number): void {
    const wss = new WebSocketServer({ port: wsPort, host: this.bindHost })

    wss.on('listening', () => {
      this.wss = wss
      console.log(`${this.logTag} WebSocket server listening on ws://${this.bindHost}:${wsPort}`)
    })

    wss.on('connection', (socket: WebSocket, req) => {
      this.handleNewConnection(socket, req)
    })

    wss.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        const { killed, refused } = killPort(wsPort)
        if (refused.length > 0) {
          console.error(
            `${this.logTag} 端口 ${wsPort} 被非本服务进程占用，已拒绝强杀：` +
              refused.map((o) => `${o.pid} (${o.command.slice(0, 80)})`).join(', ') +
              `\n  请用 WS_PORT / --ws-port 换端口，或先停掉占用进程。`,
          )
          return
        }
        if (retries > 0 && killed.length > 0) {
          setTimeout(() => {
            this.startWithRetry(wsPort, retries - 1)
          }, 1000)
        } else {
          console.error(`${this.logTag} 端口 ${wsPort} 仍被占用，放弃重试`)
        }
      } else {
        console.error(`${this.logTag} Error:`, error.message)
      }
    })
  }

  /**
   * 检查是否有 MasterGo 插件连接
   */
  isPluginConnected(): boolean {
    for (const client of this.clients.values()) {
      if (this.acceptsClient(client) && client.socket.readyState === WebSocket.OPEN) {
        return true
      }
    }
    return false
  }

  /**
   * 从 initialize 的自述信息解析客户端归属的后端。
   *
   * 优先级：显式 `backend` 声明 > 客户端名关键字 > 单后端模式的默认后端。
   * 解析不出来就返回 null（**不收编**）—— 归属宁可不给，也不能猜。
   */
  private resolveClientBackend(clientName: string, declaredBackend: string): BridgeBackend | null {
    const declared = declaredBackend.trim() as BridgeBackend
    if (declared && this.canServeBackend(declared)) return declared
    // 显式声明了**别的**后端 → 明确矛盾，一律拒收。
    // （不得回退到默认后端：那会把「Penpot 插件填了 15489」这种误连默默收编，
    //   之后所有工具调用都会落到错的工具上）
    if (declared) return null

    for (const backend of this.acceptedBackends) {
      const hints = BRIDGE_PROFILE[backend].clientNameHints
      if (hints.some((hint) => clientName.includes(hint))) return backend
    }

    // 名字命中了**别的已知后端**（例：Penpot 插件连到了仅接 MasterGo 的桥）
    // → 同样是明确矛盾，拒收。不得因为「本桥只接一个后端」就把它当自己人：
    // 那会让一个 Penpot 客户端静静地出现在 MasterGo 的会话列表里。
    const otherProfiles = Object.entries(BRIDGE_PROFILE) as [BridgeBackend, (typeof BRIDGE_PROFILE)[BridgeBackend]][]
    for (const [backend, profile] of otherProfiles) {
      if (this.canServeBackend(backend)) continue
      if (profile.clientNameHints.some((hint) => clientName.includes(hint))) return null
    }

    // 完全没自述（老版插件 / 桌面端直连）：单后端桥叫它上（历史行为兼容）；
    // 共联模式下无从得知它到底是哪个，宁可拒收。
    if (!this.isShared) return this.backend
    return null
  }

  /**
   * 获取连接的插件客户端数量
   */
  /** 某个（或全部）后端的已连接客户端数。共联模式下必须按后端过滤 */
  getPluginCount(backend?: BridgeBackend): number {
    let count = 0
    for (const client of this.clients.values()) {
      if (!this.acceptsClient(client)) continue
      if (backend && client.backend !== backend) continue
      count++
    }
    return count
  }

  /**
   * 列出所有已初始化的插件会话
   */
  listPluginSessions(): Array<{
    sessionId: string
    codename: string
    documentName: string
    documentId: string
    pageName: string
    pageId: string
    clientId: number
    connectedAt: number
    /** 后端标识 —— 多后端聚合时用于区分（session_list 直接透出） */
    backend: BridgeBackend
    /** 客户端类型，便于排查「连上了但没 announce」的情况 */
    clientType: BridgeClientType
  }> {
    const sessions: Array<{
      sessionId: string
      codename: string
      documentName: string
      documentId: string
      pageName: string
      pageId: string
      clientId: number
      connectedAt: number
      backend: BridgeBackend
      clientType: BridgeClientType
    }> = []
    for (const client of this.clients.values()) {
      if (this.acceptsClient(client)) {
        sessions.push({
          sessionId: client.sessionId,
          codename: client.codename,
          documentName: client.documentName,
          documentId: client.documentId,
          pageName: client.pageName,
          pageId: client.pageId,
          clientId: client.clientId,
          connectedAt: client.connectedAt,
          backend: client.backend,
          clientType: client.clientType,
        })
      }
    }
    return sessions
  }

  /**
   * 按 sessionId 查找插件客户端
   *
   * 注意：同一文档下的多个插件实例 sessionId 相同（`sess_<documentId>`），
   * 需要精确定位时请用 findPluginClientByClientId。
   */
  findPluginClientBySessionId(sessionId: string): PluginClient | null {
    for (const client of this.clients.values()) {
      if (this.isUsable(client) && client.sessionId === sessionId) {
        return client
      }
    }
    return null
  }

  /**
   * 按 clientId 查找插件客户端（精确查找，O(1)）
   */
  findPluginClientByClientId(clientId: number): PluginClient | null {
    const client = this.clients.get(clientId)
    if (client && this.isUsable(client)) {
      return client
    }
    return null
  }

  /**
   * 按 codename 查找插件客户端（代号不保证唯一，命中第一个匹配项）
   */
  findPluginClientByCodename(codename: string): PluginClient | null {
    for (const client of this.clients.values()) {
      if (this.isUsable(client) && client.codename === codename) {
        return client
      }
    }
    return null
  }

  /**
   * 解析路由目标：clientId → sessionId → 第一个可用插件
   */
  private resolvePluginClient(sessionId?: string, clientId?: number): PluginClient | null {
    if (clientId !== undefined && clientId !== null) {
      const byClientId = this.findPluginClientByClientId(clientId)
      if (byClientId) return byClientId
    }
    if (sessionId) {
      const bySessionId = this.findPluginClientBySessionId(sessionId)
      if (bySessionId) return bySessionId
    }
    return this.findPluginClient()
  }

  /** 构造“找不到插件”的提示，保留 sessionId / clientId 上下文 */
  private buildNoClientMessage(sessionId?: string, clientId?: number): string {
    if (clientId !== undefined && clientId !== null) {
      return `Plugin client not found: clientId=${clientId}${this.backend !== 'mastergo' ? ` (backend=${this.backend})` : ''}`
    }
    if (sessionId) {
      return `Plugin session not found: ${sessionId}`
    }
    return this.noClientMessage
  }

  /**
   * 处理 JSON-RPC 通知（无 id，无需响应）
   * MCP 规范：通知不应返回任何响应
   */
  handleNotification(_notification: JSONRPCRequest): void {
    // notifications/initialized 由 SDK Transport 自动处理
    // 其他通知暂忽略
  }

  /**
   * 处理 tools/call 请求（供 HTTP 模式使用，STDIO 模式走 SdkServer）
   * 解析工具名，判断是否需要转发
   * @param sourceId - 可选，源 SSE 会话 ID
   */
  async handleToolsCall(request: JSONRPCRequest, sourceId?: string): Promise<JSONRPCResponse> {
    return routeToolCall(request, this as any, this.forwardToPlugin.bind(this), sourceId)
  }

  /**
   * 转发请求到 MasterGo 插件并等待响应
   * 这是消息链路闭环的关键：发送请求 -> 注册等待 -> 插件响应 -> resolve Promise
   * @param request - JSON-RPC 请求
   * @param sessionId - 可选，目标插件会话 ID，不传则使用第一个可用插件
   */
  private executeSend(request: JSONRPCRequest, sessionId?: string, clientId?: number): Promise<JSONRPCResponse> {
    const pluginClient = this.resolvePluginClient(sessionId, clientId)

    if (!pluginClient) {
      return Promise.resolve({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32000, message: this.buildNoClientMessage(sessionId, clientId) },
      })
    }

    return new Promise<JSONRPCResponse>((resolve, reject) => {
      const idStr = String(request.id)
      const requestKey = `${request.method}:${idStr}`
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestKey)
        this.pendingIdIndex.delete(idStr)
        resolve({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32003,
            message: `Timeout waiting for plugin response: ${request.method}`
          }
        })
      }, 30000)

      this.pendingRequests.set(requestKey, {
        resolve,
        reject,
        timeout,
        method: request.method,
        requestKey,
      })
      this.pendingIdIndex.set(idStr, requestKey)

      pluginClient.socket.send(JSON.stringify(request))
    })
  }

  private processQueue(): void {
    const now = Date.now()
    while (this.requestQueue.length > 0) {
      const item = this.requestQueue[0]
      // Drop requests that waited in queue too long (30s total)
      if (now - item.startTime > 30000) {
        this.requestQueue.shift()
        item.resolve({
          jsonrpc: '2.0',
          id: item.request.id,
          error: { code: -32003, message: `Timeout in queue: ${item.request.method}` },
        })
        continue
      }
      if (this.activeCount >= this.MAX_CONCURRENT) break
      this.requestQueue.shift()
      this.activeCount++
      this.executeSend(item.request, item.sessionId, item.clientId)
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this.activeCount--
          this.processQueue()
        })
    }
  }

  private forwardToPlugin(request: JSONRPCRequest, sessionId?: string, clientId?: number): Promise<JSONRPCResponse> {
    if (this.shuttingDown) {
      return Promise.resolve({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32000, message: 'Server is shutting down' },
      })
    }

    return new Promise<JSONRPCResponse>((resolve, reject) => {
      this.requestQueue.push({ request, sessionId, clientId, resolve, reject, startTime: Date.now() })
      this.processQueue()
    })
  }

  /**
   * 发送请求到插件并通过回调返回结果（适用于 STDIO 模式）
   */
  sendToPlugin(request: JSONRPCRequest, callback: (err: Error | null, response?: JSONRPCResponse) => void, sessionId?: string, clientId?: number): void {
    const pluginClient = this.resolvePluginClient(sessionId, clientId)

    if (!pluginClient) {
      callback(new Error(this.buildNoClientMessage(sessionId, clientId)))
      return
    }

    let actualMethod = request.method
    
    if (request.method === 'tools/call') {
      const callParams = request.params as { name: string; arguments?: Record<string, unknown> }
      actualMethod = callParams.name.replace(/_/g, '/')
    }

    const requestKey = `${actualMethod}:${request.id}`

    const timeout = setTimeout(() => {
      this.pendingRequests.delete(requestKey)
      console.error(`[STDIO] Timeout for request: method=${actualMethod}, id=${request.id}`)
      callback(new Error(`Timeout waiting for plugin response: ${request.method}`))
    }, 30000)

    this.pendingRequests.set(requestKey, {
      resolve: (response) => {
        clearTimeout(timeout)
        console.log(`[STDIO] Got response for method=${actualMethod}, id=${request.id}:`, JSON.stringify(response).substring(0, 200))
        callback(null, response)
      },
      reject: (err) => {
        clearTimeout(timeout)
        callback(err)
      },
      timeout,
      method: actualMethod,
      requestKey,
    })

    pluginClient.socket.send(JSON.stringify(request))
  }

  /**
   * 处理新的 WebSocket 连接
   */
  private handleNewConnection(socket: WebSocket, req?: any): void {
    const clientId = this.clientIdOffset + (++this.clientCounter)
    const now = Date.now()

    // 连接来源审计：便于排查“谁连上来了”（WS 无鉴权，依赖默认只监听 127.0.0.1）
    const remoteAddress = req?.socket?.remoteAddress || 'unknown'
    const origin = req?.headers?.origin || '(none)'
    console.log(`${this.logTag} Incoming connection #${clientId} from ${remoteAddress} origin=${origin}`)

    // 从连接 URL 提取参数（MasterGo 桌面端可能在 URL 中传 Authorization/docid）
    let urlParams: URLSearchParams | null = null
    try {
      if (req?.url) urlParams = new URL(req.url, 'http://localhost').searchParams
    } catch { /* ignore */ }

    // 桌面端直连只适用于 mastergo 桥；penpot 插件永远走 initialize 握手
    const isMasterGoDesktop = this.backend === 'mastergo' && !!(urlParams?.has('Authorization') && urlParams?.has('docid'))

    const client: PluginClient = {
      socket,
      clientId,
      clientType: isMasterGoDesktop ? 'mastergo-plugin' : 'unknown',
      // 桌面端直连固定归 mastergo；其余客户端等 initialize 自述
      backend: 'mastergo',
      initialized: isMasterGoDesktop,  // 自动初始化 MasterGo 桌面端
      sessionId: isMasterGoDesktop ? `${this.sessionPrefixFor('mastergo')}mg_${urlParams?.get('docid') || clientId}` : '',
      codename: isMasterGoDesktop ? 'mastergo-desktop' : '',
      documentName: '',
      documentId: urlParams?.get('docid') || '',
      pageName: '',
      pageId: '',
      connectedAt: now,
      lastPong: now,
      meta: {},
    }
    this.clients.set(clientId, client)

    if (isMasterGoDesktop) {
      console.log(`${this.logTag} MasterGo desktop connected (doc: ${client.documentId})`)
    }

    socket.on('message', (data: Buffer) => {
      const str = data.toString()
      console.log(`${this.logTag} RAW from ${clientId}: ${str.substring(0, 300)}`)
      this.handleMessage(clientId, str)
    })

    const heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.ping()
      }
      // 3 次心跳无 pong 回复视为僵尸连接
      if (Date.now() - client.lastPong > 90000) {
        console.warn(`${this.logTag} Closing zombie connection (ID: ${clientId}), no pong for 90s`)
        cleanupHeartbeat()
        socket.terminate()
        this.clients.delete(clientId)
      }
    }, 30000)

    socket.on('pong', () => {
      client.lastPong = Date.now()
    })

    const cleanupHeartbeat = () => {
      clearInterval(heartbeat)
    }

    socket.on('close', (code: number) => {
      cleanupHeartbeat()
      this.clients.delete(clientId)
    })

    socket.on('error', (error: Error) => {
      cleanupHeartbeat()
      console.error(`${this.logTag} Client error (ID: ${clientId}):`, error.message)
      this.clients.delete(clientId)
    })
  }

  /**
   * 处理来自 WebSocket 插件的消息
   * 包括: initialize 响应、工具执行结果响应、通知
   */
  private handleMessage(clientId: number, data: string): void {
    // 非对象 JSON（'null' / '[]' / 原始值）在这里拦下：之前会让 msg.method 抛 TypeError
    // 并使整个进程崩溃（socket.on('message') 回调内的未捕获异常）
    const msg = safeParseObject<any>(data)
    if (!msg) {
      console.error(`${this.logTag} Ignoring non-object message from client ${clientId}: ${data.substring(0, 120)}`)
      return
    }

    console.log(`${this.logTag} Msg from ${clientId}: method=${msg.method}, hasId=${msg.id !== undefined}, hasResult=${msg.result !== undefined}, hasError=${msg.error !== undefined}`)

    const client = this.clients.get(clientId)
    if (!client) return

    // 1. 处理 initialize 请求
    if (msg.method === 'initialize' && msg.id !== undefined) {
      client.initialized = true
      const clientInfo = msg.params?.clientInfo || {}
      const clientName = clientInfo.name || ''
      // 识别自己的插件：命中本后端关键字，或客户端显式声明了 backend
      const declaredBackend = typeof clientInfo.backend === 'string' ? clientInfo.backend : ''
      const resolvedBackend = this.resolveClientBackend(clientName, declaredBackend)
      if (resolvedBackend) {
        client.backend = resolvedBackend
        client.clientType = pluginTypeFor(resolvedBackend)
      } else {
        // 跨后端误连（例：Penpot 插件填了 MasterGo 的 15489，而本桥没开共联）：
        // 绝不收编，但必须吭声。否则表现为「插件面板显示已连接、session_list 却为空」。
        const announced = declaredBackend || clientName || '(未命名)'
        console.warn(
          `${this.logTag} 客户端 ${clientId} 声明的后端是 "${announced}"，本桥只接受 [${this.acceptedBackends.join(', ')}] —— ` +
            `已拒绝归属，它不会出现在 session_list 里。`,
        )
      }

      // 提取文档元数据
      client.codename = clientInfo.codename || ''
      client.documentName = clientInfo.documentName || ''
      client.documentId = clientInfo.documentId || ''
      client.pageName = clientInfo.pageName || ''
      client.pageId = clientInfo.pageId || ''
      client.sessionId = `${this.sessionPrefixFor(client.backend)}${clientInfo.documentId || clientId}`
      client.connectedAt = Date.now()
      client.meta = clientInfo.meta || {}

      // 响应 initialize
      // ⚠️ 上报的必须是**本客户端被归属到的后端**，不是桥的默认后端：
      // 共联单 hub 下桥的默认后端是 mastergo，若照实上报，Penpot 插件面板会把
      // 一个完全正常的连接当成「后端不匹配」报警（误报比不报更坏）。
      const attributed = client.clientType !== 'unknown'
      const initResponse = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: {
            name: 'mcp-server',
            version: SERVER_VERSION,
            /** 本会话被归属到的后端；null = 未归属 */
            backend: attributed ? client.backend : null,
            /** 是否已归属。false 通常意味着客户端自述的后端不在本桥的接收集里 */
            attributed,
            /** 本桥接受哪些后端（用于在未归属时告诉用户该怎么办） */
            acceptedBackends: [...this.acceptedBackends],
          }
        }
      }
      client.socket.send(JSON.stringify(initResponse))
      return
    }

    // 2. 处理响应（有 id 且没有 method，或有 result/error）
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      this.handlePluginResponse(msg.id, msg.method, msg)
      return
    }

    // 3. 处理 codename/update 通知（来自 UI，代号变更时更新服务端）
    if (msg.method === 'codename/update' && msg.params?.codename) {
      client.codename = msg.params.codename
      return
    }

    // 4. 如果收到任何消息但尚未初始化，自动标记为已初始化（适配桌面端直连）
    //    共联模式下**不自动归属**：一个没自述的客户端到底是什么，无从得知 —— 猜错就是串台。
    if (!client.initialized) {
      if (this.isShared) {
        console.warn(
          `${this.logTag} 客户端 ${clientId} 尚未 initialize（msg.method=${msg.method || '(response)'}）—— ` +
            `共联模式不接受无自述的客户端，请让其先发送 initialize。`,
        )
        return
      }
      client.initialized = true
      client.clientType = this.pluginClientType
      client.backend = this.backend
      client.sessionId = `${this.sessionPrefixFor(this.backend)}${clientId}`
      client.connectedAt = Date.now()
      console.log(`${this.logTag} Auto-initialized client ${clientId} from message: ${msg.method || '(response)'}`)
    }

    // 5. 其他通知（忽略）
  }

  /**
   * 处理来自插件的响应
   * 根据请求 ID 找到对应的 pending Promise 并 resolve
   */
  private handlePluginResponse(msgId: string | number, msgMethod: string | undefined, response: any): void {
    console.log(`${this.logTag} handlePluginResponse id=${msgId} method=${msgMethod} hasResult=${!!response.result} hasError=${!!response.error}`)
    const pending = this.findPendingRequest(msgId, msgMethod)

    if (pending) {
      clearTimeout(pending.timeout)
      this.pendingRequests.delete(pending.requestKey)
      this.pendingIdIndex.delete(String(msgId))

      // 所有插件响应都包装成 CallToolResponse 格式
      // MCP 规范要求 tools/call 的响应包含 content 数组
      let rpcResponse: JSONRPCResponse
      if (response.result !== undefined) {
        rpcResponse = {
          jsonrpc: '2.0',
          id: response.id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.result)
              }
            ]
          }
        }
      } else {
        rpcResponse = {
          jsonrpc: '2.0',
          id: response.id,
          result: response.result,
          error: response.error
        }
      }
      
      pending.resolve(rpcResponse)
    } else {
      console.warn(`${this.logTag} No pending request found for response id: ${msgId}`)
    }
  }

  /**
   * 查找等待中的请求（O(1) 索引查找）
   */
  private findPendingRequest(msgId: string | number, msgMethod: string | undefined): PendingRequest | null {
    const idStr = String(msgId)
    if (msgMethod) {
      const key = `${msgMethod}:${idStr}`
      const entry = this.pendingRequests.get(key)
      if (entry) return entry
    }
    // Fallback: 通过 idStr 索引 O(1) 查找
    const indexedKey = this.pendingIdIndex.get(idStr)
    if (indexedKey) {
      return this.pendingRequests.get(indexedKey) || null
    }
    return null
  }

  /**
   * 发送 JSON-RPC 通知（无 id，无需响应）到插件
   * @param sessionId - 可选，目标插件会话 ID，不传则广播到所有可用插件
   */
  sendNotification(method: string, params: any, sessionId?: string): void {
    if (sessionId) {
      const pluginClient = this.findPluginClientBySessionId(sessionId)
      if (!pluginClient) return
      const notification = { jsonrpc: '2.0', method, params }
      pluginClient.socket.send(JSON.stringify(notification))
      return
    }
    // 不指定 sessionId 时广播到所有可用插件（向后兼容）
    for (const client of this.clients.values()) {
      if (this.isUsable(client)) {
        const notification = { jsonrpc: '2.0', method, params }
        client.socket.send(JSON.stringify(notification))
      }
    }
  }

  /**
   * 异步转发请求到插件并等待响应（公共方法，供共享 handlers 使用）
   */
  async forwardRequest(request: JSONRPCRequest, sessionId?: string, clientId?: number): Promise<JSONRPCResponse> {
    return this.forwardToPlugin(request, sessionId, clientId)
  }

  /**
   * 发送任务计划到插件（插件端展示步骤列表）
   */
  sendTaskPlan(steps: { id: string; label: string }[]): void {
    this.sendNotification('task/plan', { steps })
  }

  /**
   * 发送单步状态更新
   */
  sendTaskStep(id: string, status: 'pending' | 'running' | 'completed' | 'failed', message?: string): void {
    this.sendNotification('task/step', { id, status, message })
  }

  /**
   * 发送任务完成通知
   */
  sendTaskComplete(status: 'success' | 'failed', message?: string): void {
    this.sendNotification('task/complete', { status, message })
  }

  /**
   * 设置指定源会话的目标插件会话（session_switch 持久化）
   */
  setActiveSession(sourceId: string, target: SessionTarget): void {
    this.activeSessionMap.set(sourceId, target)
  }

  /**
   * 获取指定源会话的目标插件。
   *
   * HTTP POST /mcp 与 SSE SDK 路径下 sourceId 恒为 undefined，
   * 因此额外支持一个全局兜底源，保证 session_switch 对这些客户端同样生效。
   */
  getActiveSession(sourceId?: string): SessionTarget | undefined {
    if (sourceId) {
      const own = this.activeSessionMap.get(sourceId)
      if (own) return own
    }
    return this.activeSessionMap.get(DEFAULT_SESSION_SOURCE)
  }

  handleLocalTool(_request: JSONRPCRequest): JSONRPCResponse | Promise<JSONRPCResponse> {
    return {
      jsonrpc: '2.0',
      id: _request.id,
      error: { code: -32601, message: 'Method not found' },
    }
  }

  /**
   * 查找已连接的 MasterGo 插件客户端
   */
  private findPluginClient(): PluginClient | null {
    for (const client of this.clients.values()) {
      if (this.isUsable(client)) {
        return client
      }
    }
    return null
  }

  async stop(): Promise<void> {
    this.shuttingDown = true

    // Reject all pending requests
    for (const [, entry] of this.pendingRequests) {
      clearTimeout(entry.timeout)
      entry.reject(new Error('Server is shutting down'))
    }
    this.pendingRequests.clear()
    this.pendingIdIndex.clear()

    // Close all client connections
    for (const [, client] of this.clients) {
      client.socket.close(1000, 'Server shutting down')
    }
    this.clients.clear()

    if (this.wss) {
      this.wss.close()
      this.wss = null
    }

    // Small delay to let pending work drain
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}



/**
 * 从插件响应里取出文档信息。
 *
 * 注意插件的响应被 `handlePluginResponse` 统一包成了
 * `{content:[{type:'text', text: JSON.stringify(裸数据)}]}`，所以要解两层。
 */
function extractDocumentInfo(response: JSONRPCResponse): {
  codename?: string
  documentName?: string
  documentId?: string
  pageName?: string
  pageId?: string
} | null {
  if (!response || 'error' in response || !response.result) return null
  const result = response.result as { content?: { text?: string }[] }
  const text = result.content?.[0]?.text
  if (typeof text !== 'string') return null
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const pick = (key: string): string | undefined =>
      typeof parsed[key] === 'string' && parsed[key] ? (parsed[key] as string) : undefined
    return {
      codename: pick('codename'),
      documentName: pick('documentName'),
      documentId: pick('documentId'),
      pageName: pick('pageName'),
      pageId: pick('pageId'),
    }
  } catch {
    return null
  }
}
