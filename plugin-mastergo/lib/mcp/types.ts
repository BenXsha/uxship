/** JSON-RPC 2.0 标准类型定义 */

export interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, any>
}

export interface JSONRPCNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, any>
}

export interface JSONRPCSuccessResponse {
  jsonrpc: '2.0'
  id: string | number
  result: any
}

export interface JSONRPCErrorResponse {
  jsonrpc: '2.0'
  id: string | number
  error: {
    code: number
    message: string
    data?: any
  }
}

export type JSONRPCResponse = JSONRPCSuccessResponse | JSONRPCErrorResponse

export type JSONRPCMessage = JSONRPCRequest | JSONRPCNotification

export type Request = JSONRPCRequest

export type ErrorResponse = JSONRPCErrorResponse

/** 连接状态枚举 */
export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'disconnected'
  | 'reconnecting'

/** MCPClient 事件回调接口 */
export interface MCPClientEvents {
  onStatusChange: (status: ConnectionStatus) => void
  onRequest: (request: JSONRPCRequest) => void
  onNotification: (notification: JSONRPCNotification) => void
  onError: (error: Error) => void
}

/** MCPClient 配置 */
export interface MCPClientConfig {
  /** MCP 服务器地址 */
  serverUrl: string
  /** 心跳间隔（毫秒），默认 30000 */
  heartbeatInterval?: number
  /** 初始重连延迟（毫秒），默认 1000 */
  reconnectDelay?: number
  /** 最大重连延迟（毫秒），默认 60000 */
  maxReconnectDelay?: number
  /** 最大心跳超时次数，默认 2 */
  maxMissedHeartbeats?: number
}