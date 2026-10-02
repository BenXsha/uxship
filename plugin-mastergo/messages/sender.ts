// 插件发出的消息
export enum PluginMessage {
  /** 连接状态变化 */
  STATUS_CHANGED = 'statusChanged',
  /** MCP 请求执行结果 */
  REQUEST_RESULT = 'requestResult',
  /** 方法执行结果 */
  METHOD_RESULT = 'methodResult',
  /** 方法执行错误 */
  METHOD_ERROR = 'methodError',
  /** MCP 请求执行错误 */
  ERROR = 'error',
  /** 操作日志 */
  LOG = 'log',
  /** 选中变化 */
  SELECTION_CHANGED = 'selectionChanged',
}

//UI发出的消息
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
  /** 执行方法调用 */
  EXECUTE_METHOD = 'executeMethod',
  /** 调整插件窗口大小 */
  RESIZE = 'resize',
  /** 设置插件代号 */
  SET_CODENAME = 'setCodename',
}

type MessageType = {
  type: UIMessage | PluginMessage,
  data?: any;
}

/**
 * 向UI发送消息
 */
export const sendMsgToUI = (data: MessageType) => {
  mg.ui.postMessage(data, "*")
}


/**
 * 向插件发送消息
 */
export const sendMsgToPlugin = (data: MessageType) => {
  parent.postMessage(data, "*")
}
