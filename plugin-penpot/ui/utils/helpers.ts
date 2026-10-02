/**
 * 获取 WebSocket 关闭原因
 */
export function getWebSocketCloseReason(code: number): string {
  const reasons: Record<number, string> = {
    1000: '正常关闭',
    1001: '端点离开',
    1002: '协议错误',
    1003: '数据类型错误',
    1005: '无状态码',
    1006: '异常关闭',
  }
  return reasons[code] || `错误码 ${code}`
}

/**
 * 生成唯一的请求 ID
 */
export function generateRequestId(): number {
  return Date.now()
}

/**
 * 创建 JSON-RPC 请求
 */
export function createJsonRpcRequest(
  method: string,
  params: any = {},
  id?: number
): any {
  return {
    jsonrpc: '2.0',
    method,
    params,
    id: id || generateRequestId(),
  }
}

/**
 * 创建 JSON-RPC 错误响应
 */
export function createJsonRpcError(
  id: number,
  code: number,
  message: string
): any {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  }
}
