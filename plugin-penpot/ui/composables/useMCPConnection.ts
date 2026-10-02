import { ref, computed } from 'vue'

import { sendMsgToPlugin, UIMessage } from '@messages/sender'
import { getWebSocketCloseReason, createJsonRpcError, createJsonRpcRequest } from '../utils/helpers'

export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'connecting'
  | 'reconnecting'
  | 'disconnecting'

export interface MCPConnectionConfig {
  defaultServerUrl: string
  debugMode?: boolean
  /**
   * initialize 握手时报的客户端名。服务端靠它识别后端。
   * 默认 `'MasterGo-Plugin'`（保持 plugin-mastergo 的历史行为）；Penpot 插件传 `'Penpot-Plugin'`。
   */
  clientName?: string
  /**
   * 显式声明的后端标识（`'penpot'` / `'mastergo'`）。
   * 比名字关键字更可靠，服务端优先采信。
   */
  clientBackend?: string
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
  /** 服务端把本会话归属到的后端（'penpot' / 'mastergo'）；空串=未上报（旧服务端） */
  const serverBackend = ref<string>('')
  /** 服务端是否已归属本会话（旧服务端不报此项，默认 true 以免误报） */
  const serverAttributed = ref<boolean>(true)
  /** 服务端接受的后端集合（未归属时用于提示该怎么办） */
  const serverAcceptedBackends = ref<string[]>([])
  /** 服务端版本（来自 initialize 的 serverInfo.version）—— 与插件版本对照，便于发现“不配套” */
  const serverVersion = ref<string>('')
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
    if (isConnected.value) return '断开连接'
    if (isConnecting.value) return '连接中…'
    return '连接服务端'
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
        // （文档/代号信息可能在此时还没到 —— 它们在 handlePluginMessage 里后到时自愈重发）
        if (sendInitialize()) addLog('info', 'initialize 已发送')
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

  /**
   * 发送（或重发）initialize。
   *
   * 为什么抽成函数：这个报文有**两处**要发 —— WS 刚连上时、以及文档/代号信息后到时。
   * 原先第二处是**手抄**的一份，把 `name` 写死成 'MasterGo-Plugin' 且不带 `backend`
   * （从 MasterGo 那份移植时的残留）：一旦它在 Penpot 侧被触发，服务端会按名字把
   * 本会话重新归到 **mastergo** —— 静默串台。所以两处必须共用同一份 clientInfo。
   *
   * @returns 是否真的发出（WS 未连接时返回 false）
   */
  function sendInitialize(): boolean {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) return false

    // 只装字符串字段（name / version / backend / codename / 文档与页信息）；
    // 用 Record<string, string> 而不是 Record<string, any>，让写入处能真的被类型检查。
    const clientInfo: Record<string, string> = {
      name: config.clientName ?? 'MasterGo-Plugin',
      version: String(__PLUGIN_VERSION__),
    }
    if (config.clientBackend) clientInfo.backend = config.clientBackend
    if (codename.value) clientInfo.codename = codename.value
    if (documentInfo.value) {
      clientInfo.documentName = documentInfo.value.documentName
      clientInfo.documentId = documentInfo.value.documentId
      clientInfo.pageName = documentInfo.value.pageName
      clientInfo.pageId = documentInfo.value.pageId
    }

    ws.value.send(JSON.stringify(createJsonRpcRequest(
      'initialize',
      { protocolVersion: '2024-11-05', capabilities: {}, clientInfo },
      Date.now(),
    )))
    return true
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

            // initialize 响应携带服务端对**本会话**的归属结果：
            //   serverInfo.backend    = 本会话被归属到的后端（null = 未归属）
            //   serverInfo.attributed = 是否已归属
            //   serverInfo.acceptedBackends = 本桥接受哪些后端
            // 注意：共联单 hub 下 backend 不等于桥的默认后端，不能拿它去推桥的能力。
            const info = message.result?.serverInfo
            if (info && typeof info === 'object') {
              if (typeof info.version === 'string' && info.version) serverVersion.value = info.version
              if (typeof info.backend === 'string' && info.backend) serverBackend.value = info.backend
              if (typeof info.attributed === 'boolean') serverAttributed.value = info.attributed
              if (Array.isArray(info.acceptedBackends)) serverAcceptedBackends.value = info.acceptedBackends.map(String)
              addLog(
                info.attributed === false ? 'error' : 'info',
                info.attributed === false
                  ? `服务端拒绝归属本会话（接受的接端: ${serverAcceptedBackends.value.join(', ') || '?'}）`
                  : `服务端已归属本会话到: ${serverBackend.value || '?'}`,
              )
            }

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

  // 将 DSL 发送给 MCP Server 作为上下文

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

    // ⚠️ 必须发**完整 JSON-RPC 错误响应**（`error` 字段）。
    //
    // 曾修过的一类真事故：早期写法是 `createJsonRpcRequest('error', {code,message})`
    // 再把 `method`/`params` 删掉 —— 但错误信息存在 `params` 里，删完只剩 `{jsonrpc,id}`：
    // 服务端按 `(result !== undefined || error !== undefined)` 分类入帧，整帧被**静默丢弃**，
    // pending 请求要等满 30s 才超时。后果是插件侧每一个真实错误（节点不存在 / 令牌不存在 /
    // 参数非法）都变成"等 30 秒然后看到 Timeout"，AI 与人都拿不到原因 —— 而日志还会报
    // "错误响应已发送"。所以这里用现成的 `createJsonRpcError()`，不要手搭帧。
    const errorResponse = createJsonRpcError(id, -32603, errorMessage)

    try {
      ws.value.send(JSON.stringify(errorResponse))
      console.log('[DEBUG] 错误响应已发送')
      return true
    } catch (error) {
      console.error('[DEBUG] 发送错误响应失败:', error)
      return false
    }
  }


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
      }
      // 文档/代号信息可能比 WS 连接晚到（面板启动时 HELLO 有竞态）。
      // 后到时重发一次 initialize，让服务端会话元数据自愈 ——
      // 否则 session_list 里会是一串空 documentName/pageName，无法分辨操作的是哪个文件。
      if (ws.value && ws.value.readyState === WebSocket.OPEN) {
        if (sendInitialize()) {
          addLog('info', `已把文档/会话信息同步到服务端（${documentInfo.value?.documentName || '未命名文档'} / ${documentInfo.value?.pageName || '-'}）`)
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
      
      // 这个响应是不是**服务端发来的请求**的执行结果？
      //
      // activeTaskIds 只在「从 WS 收到请求」时登记（见 handleWebSocketMessage）。
      // 面板里的本地操作（自测渲染 / 「HTML → 画布」按钮）也会产生 methodResult，
      // 但它们**没有对应的服务端请求** —— 无脑回帧会造成：
      //   1. 服务端刷 "No pending request found for response id: ..." 警告；
      //   2. WS 未连时还会打一条 "无法发送响应" 的 error，看着像出错了。
      const fromServer = data.id !== undefined && activeTaskIds.value.has(data.id)
      if (data.id !== undefined) {
        activeTaskIds.value.delete(data.id)
      }

      if (!fromServer) {
        addLog('info', `本地操作完成 (${data.id})`)
        return
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

      // 同上：本地发起的请求失败时不该往服务端回错误帧
      const fromServer = data.id !== undefined && activeTaskIds.value.has(data.id)
      if (data.id !== undefined) {
        activeTaskIds.value.delete(data.id)
      }
      setErrorBriefly(data.error || '方法执行错误')

      if (!fromServer) return

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
    serverBackend,
    serverAttributed,
    serverAcceptedBackends,
    serverVersion,
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
    sendInitialize,
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
