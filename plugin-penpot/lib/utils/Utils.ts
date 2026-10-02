/**
 * JSON-RPC 错误码与错误格式化
 *
 * 只保留 `dispatcher.ts` 实际引用的两项。此前本文件还挂着 WS 状态表、连接/性能/内存配置、
 * debounce/throttle/deepClone 等一批通用工具 —— 全仓库零引用，已按死代码清除。
 */

/**
 * JSON-RPC 错误码
 */
export const JSONRPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
} as const

/**
 * 格式化错误消息
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
