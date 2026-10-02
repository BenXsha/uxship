/**
 * JSON-RPC 2.0 类型定义
 */

// 请求
export interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

// 通知（无响应）
export interface JSONRPCNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

// 成功响应
export interface JSONRPCSuccessResponse {
  jsonrpc: '2.0'
  id: string | number
  result: unknown
}

// 错误响应
export interface JSONRPCErrorResponse {
  jsonrpc: '2.0'
  id: string | number
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export type JSONRPCResponse = JSONRPCSuccessResponse | JSONRPCErrorResponse

/**
 * MCP 标准错误码
 */
export const MCP_ERROR_CODES = {
  // JSON-RPC 错误码
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // MCP 扩展错误码
  TOOL_NOT_FOUND: -32001,
  RESOURCE_NOT_FOUND: -32002,
  RESOURCE_NOT_SUPPORTED: -32003,
} as const

/**
 * 创建成功响应
 */
export function createSuccessResponse(id: string | number, result: unknown): JSONRPCSuccessResponse {
  return { jsonrpc: '2.0', id, result }
}

/**
 * 创建错误响应
 */
export function createErrorResponse(
  id: string | number,
  code: number,
  message: string,
  data?: unknown
): JSONRPCErrorResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } }
}

/**
 * 判断消息是否为请求
 */
export function isRequest(msg: unknown): msg is JSONRPCRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as any).jsonrpc === '2.0' &&
    typeof (msg as any).method === 'string' &&
    (msg as any).id !== undefined
  )
}

/**
 * 判断消息是否为通知
 */
export function isNotification(msg: unknown): msg is JSONRPCNotification {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as any).jsonrpc === '2.0' &&
    typeof (msg as any).method === 'string' &&
    (msg as any).id === undefined
  )
}