/**
 * 插件入口（Penpot 的 `code` 上下文）
 *
 * 架构对齐（分析报告 §12.1）：
 *   - **本文件** = Penpot 插件沙箱：无 DOM、有全局 `penpot`，负责执行方法
 *   - **ui/**    = Penpot 的插件 UI iframe：有 DOM/WebSocket，负责与服务端通信
 * 与 plugin-mastergo 的分工完全一致（插件端 `lib/main.ts` + UI 端
 * `ui/composables/useMCPConnection.ts`），因此 WS / JSON-RPC 那部分代码一行都不用改。
 *
 * 本文件只做三件事：装宿主、开 UI、把 UI 转发来的请求交给 dispatcher。
 * **不放业务逻辑**。宿主调用纪律（由 `tests/host-isolation.test.ts` 自动把关）：
 *   - **文档/画布类** API（`create*` / `library` / `fonts` / `currentPage` / `viewport` / `selection` …）
 *     只允许出现在 `lib/host/penpot.ts`
 *   - **插件自身 UI 通道**（`penpot.ui.*`）是消息边界，允许出现在本文件与 `messages/sender.ts`
 */
import { RequestDispatcher } from './dispatcher'
import { detectHost, installHost, type HostAdapter } from './host/index'
import { PluginMessage, UIMessage, sendMsgToUI, isUIMessage, type MessageType } from '@messages/sender'
import { logger } from './utils/Logger'
import { applyUiSize, type HostUiContext } from './ui-size'
import { SAMPLE_DSL, SMOKE_DSL } from './dsl/sample'
import { renderDsl } from './dsl/renderer'

const PLUGIN_NAME = 'uxship for Penpot'
/**
 * 展开态尺寸。
 *
 * 打开时先用 **紧凑尺寸**（一颗球）、点开才展开 —— 与 plugin-mastergo 一致；
 * 之前默认开着整个面板，是“看起来不如 MasterGo 简洁”的主因。
 */
const UI_EXPANDED = { width: 400, height: 560 }
const UI_COMPACT = { width: 180, height: 180 }

/** UI 侧 `useMCPConnection` 期望的 serverUrl 形态；自建 hub 默认端口见 vite define */
const DEFAULT_HUB_URL = typeof __DEFAULT_HUB_URL__ === 'string' ? __DEFAULT_HUB_URL__ : 'ws://localhost:15489'

let host: HostAdapter | null = null
let dispatcher: RequestDispatcher | null = null
let initialized = false

async function bootstrap(): Promise<void> {
  if (initialized) return
  initialized = true

  host = detectHost()
  installHost(host)
  await host.init()

  dispatcher = new RequestDispatcher()

  // 会话代号：与 MasterGo 侧一致，**启动即分配并持久化**（不依赖首次 getDocumentInfo 的惰性生成）——
  // 这样服务端 initialize / session_list 从第一刻起就有稳定的 session 身份，
  // 而不是先报空、再靠 session-enrich 回填。
  const codename = host.getDocumentCodename()

  logger.info(`[main] host=${host.id} plugin=${pluginVersion()} codename=${codename}`)

  // 打开插件 UI。不传 hidden —— 面板可见是「用户知道自己能操作画布」的前提，
  // 这与 plugin-mastergo 不自动重连是同一条设计纪律（何时允许 AI 操作画布由用户决定）。
  try {
    penpot.ui.open(PLUGIN_NAME, 'index.html', { ...UI_COMPACT })
  } catch (error) {
    logger.error('[main] penpot.ui.open 失败', error)
  }

  penpot.ui.onMessage<MessageType>((message) => {
    handleUiMessage(message).catch((error) => {
      logger.error('[main] handleUiMessage failed', error)
      broadcastError(String((error as Error)?.message ?? error))
    })
  })

  // 选区变化 → 推给面板（面板上的「选中」卡片靠它活）。
  // 换页也要推：换页后选区被清空，不推的话卡片会一直显示上一页的旧选区。
  stopObservingSelection = host.observeSelection?.(() => sendSelection()) ?? null
  sendSelection()
}

/** 取消选区订阅（插件销毁时用；Penpot 里监听器随插件走，但显式退订更干净） */
let stopObservingSelection: (() => void) | null = null
export function teardown(): void {
  stopObservingSelection?.()
  stopObservingSelection = null
}

/**
 * 把当前选区推给 UI。
 *
 * 细节（type/name）在沙箱侧读一次就够 —— 面板只用来"让人知道现在选了什么"，
 * 不需要持续同步属性变化；真要拿完整数据是 AI 调 `dsl_export_selection` 的事。
 */
function sendSelection(): void {
  const adapter = host
  if (!adapter) return

  try {
    const nodes = adapter.getSelection()
    // 面板不做虚拟滚动，只展示前若干个；总数照实报，避免"看着只有 8 个"的误解
    const details = nodes.slice(0, 8).map((node) => {
      const props = adapter.readProperties(node, ['id', 'type', 'name'])
      return {
        id: String(props.id ?? ''),
        type: String(props.type ?? ''),
        name: String(props.name ?? ''),
      }
    })

    sendMsgToUI({
      type: PluginMessage.SELECTION_CHANGED,
      data: { count: nodes.length, details, truncated: Math.max(0, nodes.length - details.length) },
    })
  } catch (error) {
    // 选区读取失败不应影响渲染主流程，但也不能静默 —— 面板会显示"读取失败"
    sendMsgToUI({
      type: PluginMessage.SELECTION_CHANGED,
      data: { count: 0, details: [], error: String((error as Error)?.message ?? error) },
    })
  }
}

function pluginVersion(): string {
  return typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : 'dev'
}

function currentHost(): HostAdapter {
  if (!host) throw new Error('宿主尚未初始化')
  return host
}

async function handleUiMessage(message: MessageType): Promise<void> {
  if (!message || typeof message !== 'object') return
  // 过滤非本通道消息（Penpot 宿主会发 source:'penpot' 的主题消息）
  if (message.source !== undefined && !isUIMessage(message.source)) return

  switch (message.type) {
    case UIMessage.HELLO:
      sendReady()
      return

    case UIMessage.EXECUTE_METHOD:
      await executeMethod(message)
      return

    case UIMessage.SELF_TEST:
      await runSelfTest(message)
      return

    case UIMessage.RESIZE: {
      // 窗口尺寸只能在沙箱里改（UI iframe 没有 penpot 全局）—— 见 lib/ui-size.ts 的文件头
      const data = (message.data ?? {}) as { requestId?: number; width?: number; height?: number }
      const width = Number(data.width ?? UI_EXPANDED.width)
      const height = Number(data.height ?? UI_EXPANDED.height)
      // SAFETY: penpot.ui 的完整类型是 PenpotPluginUI；applyUiSize 只用到 resize/size 两个成员（HostUiContext 声明的最小面），断言只收窄到会用到的部分。
      const result = applyUiSize(penpot.ui as unknown as HostUiContext, width, height)
      sendMsgToUI({
        type: PluginMessage.UI_RESIZED,
        data: { requestId: data.requestId, size: result.size, error: result.error },
      })
      return
    }

    case UIMessage.SET_CODENAME: {
      // 代号持久化在**宿主层**（Penpot 按文档存 localStorage）——沙箱只转发与广播
      const next = currentHost().setDocumentCodename(
        String((message.data as { codename?: string })?.codename ?? ''),
      )
      sendStatusChanged(next)
      logger.info(`[main] 会话代号已更新：${next}`)
      return
    }

    default:
      // 未识别消息不改行为，只记录 —— 前向兼容
      logger.debug('[main] 未识别的 UI 消息', message)
  }
}

/**
 * 就绪通知。
 *
 * ⚠️ 刻意**不携带 `status` 字段**：在 Penpot 架构里 WebSocket 由 UI iframe 持有
 * （与官方 Penpot MCP 插件一致），连接状态归 UI 管。若这里报 status，会把 UI 刚建立的
 * 连接状态覆盖掉。
 */
function sendReady(): void {
  sendStatusChanged(currentHost().getDocumentCodename())
  logger.info(`[main] ready: ${JSON.stringify(currentHost().getDocumentInfo())}`)
}

function sendStatusChanged(codename: string): void {
  const doc = currentHost().getDocumentInfo()
  sendMsgToUI({
    type: PluginMessage.STATUS_CHANGED,
    data: {
      // 无 status 字段（见函数头说明）
      codename,
      documentInfo: {
        documentName: doc.documentName ?? '',
        documentId: doc.documentId ?? '',
        pageName: doc.pageName ?? '',
        pageId: doc.pageId ?? '',
      },
      host: doc.host,
      pluginVersion: pluginVersion(),
      hubUrl: DEFAULT_HUB_URL,
      capabilities: currentHost().getCapabilities(),
    },
  })
}

/** 执行 UI 转发来的 JSON-RPC 请求，并把完整响应回送 UI（由 UI 发回 hub） */
async function executeMethod(message: MessageType): Promise<void> {
  const request = (message.data as { request?: Record<string, unknown> } | undefined)?.request

  if (!request || typeof request !== 'object' || request.id === undefined || !request.method) {
    broadcastError('executeMethod 缺少合法的 request（需要 {id, method}）')
    return
  }

  if (!dispatcher) throw new Error('dispatcher 尚未初始化')

  const response = await dispatcher.dispatch(request as never)

  if ('error' in response) {
    sendMsgToUI({
      type: PluginMessage.METHOD_ERROR,
      data: { id: request.id, error: response.error.message },
    })
    return
  }

  // ⚠️ UI 侧期望 `data.response` 是**完整 JSON-RPC 响应对象**（它直接 ws.send(JSON.stringify(data.response))）
  sendMsgToUI({
    type: PluginMessage.METHOD_RESULT,
    data: { id: request.id, response: { jsonrpc: '2.0', id: request.id, result: response.result } },
  })
}

/**
 * 本地自测：不依赖任何服务端，直接把内置样例 DSL 渲染到画布。
 *
 * 进度通过 `log` 消息回传 —— 不引入 UI 侧不认识的消息类型（见 messages/sender.ts 文件头）。
 */
async function runSelfTest(message: MessageType): Promise<void> {
  const id = (message.data as { id?: string | number } | undefined)?.id ?? 'self-test'
  const wantFull = (message.data as { full?: boolean } | undefined)?.full === true
  const dsl = wantFull ? SAMPLE_DSL : SMOKE_DSL
  const label = wantFull ? '完整样例（覆盖全部已知宿主差异）' : '冒烟样例'

  const progress = (text: string) => sendMsgToUI({ type: PluginMessage.LOG, data: { message: text } })

  try {
    progress(`自测开始：${label}`)

    const report = await renderDsl(currentHost(), dsl, { zoom: true, select: true })

    progress(`创建 ${report.rootCount} 个顶层节点，降级 ${report.skipped.length} 项`)

    // 回读校验：渲染成功不等于几何正确（Auto Layout 会覆盖 x/y）
    const verify = report.rootIds
      .map((nodeId) => currentHost().getNodeById(nodeId))
      .filter((node): node is NonNullable<typeof node> => Boolean(node))
      .map((node) => currentHost().readProperties(node, ['id', 'name', 'x', 'y', 'width', 'height', 'layoutMode']))

    sendMsgToUI({
      type: PluginMessage.METHOD_RESULT,
      data: {
        id,
        response: {
          jsonrpc: '2.0',
          id,
          result: {
            ok: report.rootCount > 0,
            label,
            ...report,
            verify,
            hint: report.skipped.length
              ? '存在降级项，见 skipped —— 预期内（例如单边描边在 Penpot 无原生表达）'
              : '全部属性均被宿主接受',
          },
        },
      },
    })
  } catch (error) {
    const reason = `自测渲染失败: ${(error as Error).message}`
    progress(reason)
    sendMsgToUI({ type: PluginMessage.METHOD_ERROR, data: { id, error: reason } })
  }
}

function broadcastError(message: string): void {
  sendMsgToUI({ type: PluginMessage.ERROR, data: { message } })
}

bootstrap().catch((error) => {
  // 初始化失败必须可见，否则表现为「插件打开了但什么都不响应」
  console.error('[mgMCP] 插件初始化失败', error)
  try {
    penpot.ui.sendMessage({
      type: PluginMessage.ERROR,
      source: 'mgmcp-plugin',
      data: { message: `插件初始化失败: ${(error as Error).message}` },
    })
  } catch {
    /* UI 尚不可用 */
  }
})
