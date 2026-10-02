import { ref, computed } from 'vue'

import { sendMsgToPlugin, UIMessage } from '@messages/sender'
import {
  getWebSocketCloseReason,
  createJsonRpcRequest,
} from '../utils/helpers'

export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'connecting'
  | 'reconnecting'
  | 'disconnecting'

export interface MCPConnectionConfig {
  defaultServerUrl: string
  debugMode?: boolean
  onSelectionChange?: (data: any) => void
  onTaskPlan?: (plan: any) => void
  onTaskStep?: (step: any) => void
  onTaskComplete?: (result: any) => void
  onClientRender?: (html: string) => Promise<any>
}

export   function useMCPConnection(
  addLog: (type: string, message: string, jsonData?: any) => void,
  config: MCPConnectionConfig
) {
  const { defaultServerUrl, onSelectionChange, onTaskPlan, onTaskStep, onTaskComplete, onClientRender } = config

  const status = ref<ConnectionStatus>('disconnected')
  const serverUrl = ref(defaultServerUrl)
  const ws = ref<WebSocket | null>(null)
  const documentInfo = ref<{ documentName: string; documentId: string; pageName: string; pageId: string } | null>(null)
  const codename = ref<string>('')
  // 活跃的任务 ID 集合（正在处理中的 MCP 请求）
  const activeTaskIds = ref<Set<number>>(new Set())
  // 最近的错误信息（显示数秒后自动清除）
  const lastError = ref<string>('')
  let errorTimer: ReturnType<typeof setTimeout> | null = null
  const clientRenderMapping = new Map<string, number>()

  const isConnected = computed(() => status.value === 'connected')
  const isConnecting = computed(
    () => status.value === 'connecting' || status.value === 'reconnecting'
  )
  const isProcessing = computed(() => activeTaskIds.value.size > 0)
  const hasError = computed(() => lastError.value !== '')

  const statusText = computed(() => {
    const map: Record<ConnectionStatus, string> = {
      connected: '已连接',
      disconnected: '未连接',
      connecting: '连接中...',
      reconnecting: '重连中...',
      disconnecting: '断开中...',
    }
    return map[status.value] || status.value
  })

  const statusClass = computed(() => {
    const map: Record<ConnectionStatus, string> = {
      connected: 'status-connected',
      disconnected: 'status-disconnected',
      connecting: 'status-connecting',
      reconnecting: 'status-connecting',
      disconnecting: 'status-disconnected',
    }
    return map[status.value] || ''
  })

  const connectionButtonText = computed(() => {
    if (isConnected.value) return '断开'
    if (isConnecting.value) return '等待...'
    return '连接'
  })

  function connect() {
    if (!serverUrl.value.trim()) {
      addLog('error', '请输入 MCP Server 地址')
      return
    }

    status.value = 'connecting'

    try {
      // 如果已有连接，先断开
      if (ws.value !== null) {
        ws.value.close()
        ws.value = null
      }

      // 创建新的 WebSocket 连接
      ws.value = new WebSocket(serverUrl.value)

      ws.value.onopen = () => {
        console.log('[DEBUG] MCP WebSocket 连接已建立')
        console.log('[DEBUG] WebSocket readyState:', ws.value?.readyState)
        console.log('[DEBUG] WebSocket.OPEN:', WebSocket.OPEN)

        status.value = 'connected'
        addLog('success', `已连接到 MCP Server: ${serverUrl.value}`)

        // 发送 initialize 请求初始化连接
        const clientInfo: Record<string, any> = {
          name: 'MasterGo-Plugin',
          version: __PLUGIN_VERSION__,
        }
        if (codename.value) {
          clientInfo.codename = codename.value
        }
        if (documentInfo.value) {
          clientInfo.documentName = documentInfo.value.documentName
          clientInfo.documentId = documentInfo.value.documentId
          clientInfo.pageName = documentInfo.value.pageName
          clientInfo.pageId = documentInfo.value.pageId
        }
        const initRequest = createJsonRpcRequest(
          'initialize',
          {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo,
          },
          Date.now()
        )

        console.log(
          '[DEBUG] 准备发送 initialize 请求:',
          JSON.stringify(initRequest, null, 2)
        )
        if (ws.value) {
          console.log('[DEBUG] 发送 initialize 请求到 MCP 服务器')
          ws.value.send(JSON.stringify(initRequest))
          console.log('[DEBUG] initialize 请求已发送')
        } else {
          console.log('[DEBUG] WebSocket 对象为 null，无法发送请求')
        }
      }

      ws.value.onmessage = (event) => {
        console.log('[DEBUG] 收到 WebSocket 消息:', event.data)
        handleWebSocketMessage(event)
      }

      ws.value.onerror = (error) => {
        console.error('MCP WebSocket 错误:', error)
        status.value = 'disconnected'
        addLog(
          'error',
          `WebSocket 连接错误：${error instanceof Error ? error.message : String(error)}`
        )
        addLog('error', '请检查 MCP Server 是否运行在指定地址')
      }

      ws.value.onclose = (event) => {
        console.log('MCP WebSocket 连接已关闭')
        status.value = 'disconnected'

        const closeReason = getWebSocketCloseReason(event.code)

        addLog('info', `与 MCP Server 的连接已断开 (${closeReason})`)
        if (event.reason) {
          addLog('info', `关闭原因：${event.reason}`)
        }

        ws.value = null
      }
    } catch (error: any) {
      console.error('连接 MCP 失败:', error)
      status.value = 'disconnected'
      addLog(
        'error',
        `MCP 连接失败：${error.message || String(error)}`
      )
    }
  }

  function disconnect() {
    if (ws.value !== null) {
      ws.value.close()
      ws.value = null
    }
    status.value = 'disconnected'
    addLog('info', '已断开 MCP 连接')
  }

  function toggleConnection() {
    if (isConnected.value) {
      disconnect()
    } else if (serverUrl.value) {
      connect()
    }
  }

  function handleWebSocketMessage(event: MessageEvent) {
    console.log('收到 MCP 原始消息:', event.data)

    try {
      const message = JSON.parse(event.data)
      console.log('解析后的 MCP 消息:', message)

      // 处理 JSON-RPC 2.0 消息
      if (message.jsonrpc === '2.0') {
        // 处理请求
        if (message.method && message.id !== undefined) {
          // html/render-client — 客户端渲染拦截，不转发给插件主线程
          if (message.method === 'html/render-client' && onClientRender) {
            activeTaskIds.value.add(message.id)
            addLog('info', `收到客户端渲染请求 (id: ${message.id})`)

            const html = message.params?.html || ''
            if (!html) {
              addLog('error', '客户端渲染请求缺少 HTML 参数')
              activeTaskIds.value.delete(message.id)
              sendErrorToMCP(message.id, 'Missing html parameter')
              return
            }

            onClientRender(html)
              .then((dsl) => {
                addLog('success', `客户端渲染完成，DSL 元素数: ${dsl.elements?.[0]?.children?.length || 0}`)
                // 将客户端渲染结果作为 dsl/render 请求转发给插件主线程
                const dslRenderId = `cr-${message.id}-${Date.now()}`
                // 透传渲染后聚焦开关（插件端 dsl/render 默认聚焦并选中新建根节点）
                const renderParams: any = { dsl }
                if (message.params?.focus === false) renderParams.focus = false
                if (message.params?.select === false) renderParams.select = false
                sendMsgToPlugin({
                  type: UIMessage.EXECUTE_METHOD,
                  data: {
                    request: {
                      jsonrpc: '2.0',
                      id: dslRenderId,
                      method: 'dsl/render',
                      params: renderParams,
                    },
                    _clientRenderOriginalId: message.id,
                  },
                })
                // 暂存映射：插件返回 dsl/render 结果后，映射回原始请求 id
                clientRenderMapping.set(dslRenderId, message.id)
              })
              .catch((error: any) => {
                addLog('error', `客户端渲染失败: ${error.message}`)
                activeTaskIds.value.delete(message.id)
                sendErrorToMCP(message.id, `Client render failed: ${error.message}`)
              })
            return
          }

          // 标记为活跃任务
          activeTaskIds.value.add(message.id)
          
          addLog(
            'info',
            `收到 MCP 请求：${message.method} (id: ${message.id})`
          )
          addLog('info', `请求参数`, message.params)

          // 将请求转发给插件主线程处理
          addLog('info', `转发请求给插件主进程：${message.method}`)
          sendMsgToPlugin({
            type: UIMessage.EXECUTE_METHOD,
            data: {
              request: message,
            },
          })
        }
        // 处理通知
        else if (message.method) {
          // 任务进度通知
          if (message.method === 'task/plan' && onTaskPlan) {
            onTaskPlan(message.params)
          } else if (message.method === 'task/step' && onTaskStep) {
            onTaskStep(message.params)
          } else if (message.method === 'task/complete' && onTaskComplete) {
            onTaskComplete(message.params)
          }
          addLog('info', `收到 MCP 通知：${message.method}`)
          if (message.params) {
            addLog('info', `通知参数`, message.params)
          }
        }
        // 处理响应
        else if (message.result || message.error) {
          if (message.result) {
            addLog('success', `MCP 响应 (${message.id})`, message.result)
          } else {
            addLog(
              'error',
              `MCP 错误响应 (${message.id})`,
              message.error
            )
          }
        }
      } else {
        addLog('info', `非 JSON-RPC 消息`, message)
      }
    } catch (error) {
      console.error('解析 MCP 消息失败:', error)
      addLog(
        'error',
        `解析 MCP 消息失败：${error instanceof Error ? error.message : String(error)}`
      )
      addLog('error', `原始消息内容：${event.data}`)
    }
  }

  // 曾经这里有 `sendDSLToMCP`：把 `dsl/exportSelection` 的响应当上下文推给服务端
  // （`context/update` 通知）。**已连同 UI 按钮一起移除** —— 整条链是死的：
  // 那条请求服务端入站不路由（永远等不到响应），这条通知也被“其他通知（忽略）”丢掉。
  // 详见 components/SelectionPanel.vue 的注释。

  function sendResponseToMCP(response: any) {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
      addLog('error', 'WebSocket 未连接，无法发送响应')
      return false
    }

    try {
      ws.value.send(JSON.stringify(response))
      console.log('[DEBUG] ✅ 响应已成功发送到 MCP 服务器!')
      return true
    } catch (error) {
      console.error('[ERROR] 发送响应失败:', error)
      addLog(
        'error',
        `发送响应失败：${error instanceof Error ? error.message : String(error)}`
      )
      return false
    }
  }

  function sendErrorToMCP(id: number, errorMessage: string) {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
      addLog('error', `WebSocket 未连接，无法发送错误响应 (${id})`)
      return false
    }

    const errorResponse = createJsonRpcRequest('error', {
      code: -32603,
      message: errorMessage,
    })
    errorResponse.id = id
    delete errorResponse.method
    delete errorResponse.params

    try {
      ws.value.send(JSON.stringify(errorResponse))
      console.log('[DEBUG] 错误响应已发送')
      return true
    } catch (error) {
      console.error('[DEBUG] 发送错误响应失败:', error)
      return false
    }
  }

  // 曾经这里有 `sendDSLExportRequest`（发 `dsl/exportSelection` 请求给服务端）。**已移除**，
  // 原因同上：服务端入站只认 `initialize` / `codename/update` / 响应，这个 method 不会被处理。

  function setErrorBriefly(message: string) {
    lastError.value = message
    if (errorTimer) clearTimeout(errorTimer)
    errorTimer = setTimeout(() => {
      lastError.value = ''
      errorTimer = null
    }, 5000)
  }

  function handlePluginMessage(event: MessageEvent): void {
    const { type, data } = event.data || {}

    if (type === 'statusChanged') {
      const validStatuses = ['connected','disconnected','connecting','reconnecting','disconnecting']
      if (data.status && validStatuses.includes(data.status)) {
        status.value = data.status as ConnectionStatus
      }
      const serverInfo = data.serverUrl
        ? `，服务器：${data.serverUrl}`
        : ''
      addLog('info', `插件状态：${status.value}${serverInfo}`)
      if (data.serverUrl) {
        serverUrl.value = data.serverUrl
      }
      if (data.documentInfo) {
        documentInfo.value = data.documentInfo
        addLog('info', `文档：${data.documentInfo.documentName} / ${data.documentInfo.pageName}`)
      }
      if (data.codename) {
        codename.value = data.codename
        // 代号变更时重新 initialize 以更新服务端（无需断开重连）
        if (ws.value && ws.value.readyState === WebSocket.OPEN) {
          const initMsg = createJsonRpcRequest(
            'initialize',
            {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: {
                name: 'MasterGo-Plugin',
                version: __PLUGIN_VERSION__,
                codename: data.codename,
                documentName: documentInfo.value?.documentName || '',
                documentId: documentInfo.value?.documentId || '',
                pageName: documentInfo.value?.pageName || '',
                pageId: documentInfo.value?.pageId || '',
              },
            },
            Date.now()
          )
          ws.value.send(JSON.stringify(initMsg))
          addLog('info', `代号已同步到服务端: ${data.codename}`)
        }
      }
    } else if (type === 'methodResult') {
      // 检查是否是客户端渲染的 dsl/render 结果（需要映射回原始请求 id）
      const originalId = data.id !== undefined ? clientRenderMapping.get(String(data.id)) : undefined
      
      if (originalId) {
        // 这是客户端渲染的 dsl/render 结果，映射回原始 html/render-client 请求
        clientRenderMapping.delete(String(data.id))
        // 修正响应对象中的 ID 为原始请求 ID（MCP Server 通过 ID 关联 pending request）
        if (data.response && typeof data.response === 'object') {
          data.response.id = originalId
        }
        data.id = originalId
      }
      
      // 任务完成，清除活跃标记
      if (data.id !== undefined) {
        activeTaskIds.value.delete(data.id)
      }
      
      if (!ws.value) {
        addLog('error', `WebSocket 对象为 null，无法发送响应 (${data.id})`)
        return
      }

      if (ws.value.readyState !== WebSocket.OPEN) {
        addLog(
          'error',
          `WebSocket 未连接，readyState=${ws.value.readyState}，无法发送响应 (${data.id})`
        )
        return
      }

      try {
        ws.value.send(JSON.stringify(data.response))
        addLog('success', `响应已成功发送到 MCP 服务器 (${data.id})`)
      } catch (error) {
        addLog(
          'error',
          `发送响应失败：${error instanceof Error ? error.message : String(error)}`
        )
      }
    } else if (type === 'methodError') {
      // 检查是否是客户端渲染结果（需要映射回原始请求 id）
      const originalId = data.id !== undefined ? clientRenderMapping.get(String(data.id)) : undefined
      if (originalId) {
        clientRenderMapping.delete(String(data.id))
        data.id = originalId
      }

      // 任务失败，清除活跃标记，显示错误状态
      if (data.id !== undefined) {
        activeTaskIds.value.delete(data.id)
      }
      setErrorBriefly(data.error || '方法执行错误')
      
      const success = sendErrorToMCP(data.id, data.error)
      if (success) {
        addLog('info', `错误响应已发送到 MCP 服务器 (${data.id})`)
      } else {
        addLog('error', `无法发送错误响应 (${data.id})`)
      }
    } else if (type === 'error') {
      setErrorBriefly(data.message || '插件错误')
      addLog('error', `插件错误：${data.message}`)
    } else if (type === 'log') {
      addLog('info', `插件日志：${data.message}`)
    } else if (type === 'selectionChanged') {
      if (onSelectionChange) {
        onSelectionChange(data)
      }
    } else {
      addLog(
        'info',
        `收到未知插件消息类型：${type}，数据：${JSON.stringify(data || {})}`
      )
    }
  }

  // 自动连接
  let connectTimer: ReturnType<typeof setTimeout> | null = null
  function autoConnect(delay: number = 1000) {
    connectTimer = setTimeout(() => {
      if (!isConnected.value && !isConnecting.value) {
        addLog('info', '自动连接到 MCP 服务器...')
        connect()
      }
    }, delay)
  }

  function cleanup() {
    if (connectTimer) { clearTimeout(connectTimer); connectTimer = null }
    if (errorTimer) { clearTimeout(errorTimer); errorTimer = null }
    if (ws.value) {
      ws.value.close()
      ws.value = null
    }
  }

  return {
    // State
    status,
    serverUrl,
    ws,
    activeTaskIds,
    lastError,
    documentInfo,
    codename,

    // Computed
    isConnected,
    isConnecting,
    isProcessing,
    hasError,
    statusText,
    statusClass,
    connectionButtonText,

    // Methods
    connect,
    disconnect,
    toggleConnection,
    handleWebSocketMessage,
    handlePluginMessage,
    sendResponseToMCP,
    sendErrorToMCP,
    autoConnect,
    cleanup,
  }
}
