/**
 * 插件 ↔ UI 消息协议
 *
 * ⚠️ 枚举值与 plugin-mastergo 的 `messages/sender.ts` **逐字对齐**，原因很实际：
 * `ui/composables/useMCPConnection.ts`（UI 侧的 WS + JSON-RPC 客户端，596 行）是从
 * plugin-mastergo 原样移植过来的，它按 `type === 'methodResult'` / `'statusChanged'` 等字符串分发。
 * 协议一改，那份代码就得改 —— 而它正是「移植而非重写」这笔收益的主体。
 *
 * 消息通道两侧：
 *   - **插件沙箱（lib/main.ts）**：`penpot.ui.sendMessage` 发；`penpot.ui.onMessage` 收
 *   - **UI iframe（ui/）**：`parent.postMessage` 发；`window.message` 收
 *
 * ⚠️ Penpot 宿主自己也会往 UI iframe 发消息（`{source: 'penpot', type: 'theme', ...}`），
 * 因此每条消息额外带 `source` 字段并在接收侧过滤 —— 否则主题变更会被误当业务消息。
 */

export const SOURCE_PLUGIN = 'mgmcp-plugin'
export const SOURCE_UI = 'mgmcp-ui'

/** 插件 → UI。取值必须与 plugin-mastergo 一致（见文件头说明）。 */
export enum PluginMessage {
  /** 连接/文档状态变更（本插件只用它携带 documentInfo 与 codename，不带 status） */
  STATUS_CHANGED = 'statusChanged',
  /** 方法执行结果；`data: { id, response }`，response 是完整 JSON-RPC 响应对象 */
  METHOD_RESULT = 'methodResult',
  /** 方法执行错误；`data: { id, error }` */
  METHOD_ERROR = 'methodError',
  /** 插件自身错误；`data: { message }` */
  ERROR = 'error',
  /** 日志；`data: { message }` */
  LOG = 'log',
  /** 选区变化；`data: { ... }` */
  SELECTION_CHANGED = 'selectionChanged',
  /**
   * 窗口尺寸调整结果；`data: { requestId, size, error? }`。
   *
   * 新增类型（不是改动既有枚举值）—— 移植过来的 `useMCPConnection` 只按已知类型分发，
   * 未知类型会落到 `default` 分支被忽略，所以不会破坏那份代码。
   */
  UI_RESIZED = 'uiResized',
}

/** UI → 插件 */
export enum UIMessage {
  HELLO = 'Hello!',
  /** 主动连接 MCP 服务器 */
  CONNECT = 'connect',
  /** 断开 MCP 服务器连接 */
  DISCONNECT = 'disconnect',
  /** 设置 MCP 服务器地址 */
  SET_SERVER_URL = 'setServerUrl',
  /** 获取当前连接状态 */
  GET_STATUS = 'getStatus',
  /** 执行方法调用；`data: { request: <JSON-RPC 请求> }` */
  EXECUTE_METHOD = 'executeMethod',
  /**
   * 调整插件窗口大小；`data: { requestId, width, height }`。
   *
   * ⚠️ 必须**由 UI 发给沙箱**执行：`penpot.ui.resize` 只存在于沙箱（code 上下文），
   * UI iframe 里没有 `penpot` 全局。沙箱回 `UI_RESIZED`。
   */
  RESIZE = 'resize',
  /** 设置插件代号 */
  SET_CODENAME = 'setCodename',
  /**
   * 本地自测：不依赖任何服务端，直接把内置样例 DSL 渲染到画布。
   *
   * 这是 Penpot 侧新增的消息（plugin-mastergo 没有），存在的意义是把
   * 「插件 ↔ 宿主 ↔ 画布」与「插件 ↔ hub ↔ AI」两条链的排障彻底解耦：
   * 画不出东西时先点自测，自测通过则问题一定在网络/协议侧。
   */
  SELF_TEST = 'selfTest',
}

/** 自测/渲染进度（通过 log 消息承载，避免引入 UI 侧不认识的消息类型） */
export interface TaskProgressPayload {
  step: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  message?: string
}

export type MessageType = {
  type: UIMessage | PluginMessage
  source?: string
  data?: any
} & Record<string, unknown>

/**
 * 插件 → UI。
 *
 * 必须容错：UI 未打开（用户手动关掉面板）时 sendMessage 会抛；通知类消息丢失
 * 不应影响渲染结果，因此吞掉异常并落到 console。
 */
export function sendMsgToUI(message: MessageType): void {
  try {
    penpot.ui.sendMessage({ source: SOURCE_PLUGIN, ...message })
  } catch {
    const isError = message.type === PluginMessage.METHOD_ERROR || message.type === PluginMessage.ERROR
    console[isError ? 'error' : 'log']?.(`[mgMCP→UI] ${String(message.type)}`, message.data ?? '')
  }
}

/** UI → 插件（仅 UI iframe 内可用） */
export function sendMsgToPlugin(message: MessageType): void {
  parent.postMessage({ source: SOURCE_UI, ...message }, '*')
}

/** 判断一条消息是否来自我们的插件通道（过滤掉 Penpot 宿主消息） */
export function isPluginMessage(source: unknown): boolean {
  return source === SOURCE_PLUGIN
}

export function isUIMessage(source: unknown): boolean {
  return source === SOURCE_UI
}
