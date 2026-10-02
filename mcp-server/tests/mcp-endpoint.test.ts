import { describe, it, expect } from 'vitest'
import { resolveDirectMcpMessage } from '../src/server/http-server.js'

/**
 * `/mcp` 精简端点的消息解析门禁
 *
 * 背景（真机踩过的坑）：该端点只支持 `tools/call`，但历史实现把**任何** JSON-RPC 消息
 * 都交给 `bridge.handleToolsCall`，而后者假设 `params.name` 存在 —— 客户端发 `initialize`
 * 时会抛出 `Cannot read properties of undefined (reading 'replace')`，再被 catch 包装成
 * 误导性的「Parse error」，让人以为是自己的请求格式写错了。
 *
 * 现在：只有 body 不是合法 JSON 才是 -32700；方法不支持是 -32601（并指路 SSE）；
 * 缺 `params.name` 是 -32602；通知类不响应。
 */
describe('resolveDirectMcpMessage', () => {
  it('tools/call + 工具名 → 正常路由', () => {
    const result = resolveDirectMcpMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'node_get', arguments: { nodeId: '1:2' } },
    })
    expect(result).toEqual({ kind: 'call', name: 'node_get' })
  })

  it('initialize 得到 -32601 Method not found，并指路 /sse（而不是误导性 Parse error）', () => {
    const result = resolveDirectMcpMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
    })
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.code).toBe(-32601)
    expect(result.message).toContain('Method not found')
    expect(result.message).toContain('/sse')
  })

  it('其它未知方法也是 -32601，并在消息里回显方法名', () => {
    const result = resolveDirectMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.code).toBe(-32601)
    expect(result.message).toContain('tools/list')
  })

  it('tools/call 缺 params.name → -32602', () => {
    for (const message of [
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: '' } },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: '   ' } },
    ]) {
      const result = resolveDirectMcpMessage(message)
      expect(result.kind, JSON.stringify(message)).toBe('error')
      if (result.kind !== 'error') continue
      expect(result.code).toBe(-32602)
      expect(result.message).toContain('params.name')
    }
  })

  it('notifications/* 归类为通知（不响应）', () => {
    expect(resolveDirectMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }).kind).toBe('notification')
  })

  it('非对象 / 空消息 → -32601（不抛异常）', () => {
    for (const message of [null, undefined, {}, [], 42, 'x']) {
      const result = resolveDirectMcpMessage(message)
      expect(result.kind, JSON.stringify(message)).toBe('error')
    }
  })
})
