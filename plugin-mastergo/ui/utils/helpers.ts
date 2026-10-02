/**
 * 简化 JSON 显示
 */
export function simplifyJson(data: any, maxLength: number = 100): string {
  if (!data) return ''
  const jsonStr = JSON.stringify(data)
  if (jsonStr.length <= maxLength) {
    return jsonStr
  }
  return `${jsonStr.substring(0, maxLength)}... (已折叠 ${jsonStr.length} 字符)`
}

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
 * 创建 JSON-RPC 通知（不需要响应）
 */
export function createJsonRpcNotification(method: string, params: any = {}): any {
  return {
    jsonrpc: '2.0',
    method,
    params,
  }
}

/**
 * 创建 JSON-RPC 响应
 */
export function createJsonRpcResponse(id: number, result: any): any {
  return {
    jsonrpc: '2.0',
    id,
    result,
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
