/** JSON-RPC 2.0 标准类型定义（仅本仓库 dispatcher 实际使用的子集） */

export interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
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

export type Request = JSONRPCRequest
