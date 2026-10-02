import { describe, it, expect } from 'vitest'
import type { JSONRPCRequest, JSONRPCResponse } from '../src/types/index.js'
import { routeToolCall, type ToolRouterBridge } from '../src/utils/tool-handlers.js'
import { getToolList } from '../src/utils/tools.js'
import { HEAVY_OUTPUT_TOOLS, hintFor } from '../src/utils/response-budget.js'

/**
 * 输出侧预算 —— **与工具面 / 转发链耦合**的回归测试。
 *
 * 纯函数部分的回归已经搬到它自己的包（`packages/response-budget/test/index.test.ts`），
 * 那边可以脱离 mcp-server 独立跑。这里只留两类测试：
 * 1. 白名单与**真实工具面**对齐（工具改名/新增时抓漏网）；
 * 2. `routeToolCall` 插件转发主路径上的接线（封装形状、maxChars 透传、非 JSON 兜底）。
 */

/** 生成 n 个「序列化约 65 字符」的节点（用于构造确定的超限 payload） */
function makeNodes(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({ id: `n${i}`, name: 'x'.repeat(40) }))
}

describe('HEAVY_OUTPUT_TOOLS 白名单与真实工具面对齐', () => {
  it('每个受预算约束的工具名都存在于 getToolList()（防改名后白名单失效）', () => {
    const names = new Set(getToolList().map((t) => t.name))
    const stale = HEAVY_OUTPUT_TOOLS.filter((name) => !names.has(name))
    expect(stale, `白名单里有不存在的工具名：${stale.join(', ')}`).toEqual([])
    expect(new Set(HEAVY_OUTPUT_TOOLS).size).toBe(HEAVY_OUTPUT_TOOLS.length) // 无重复
  })
})

// ======== 接线（tool-handlers 的插件转发主路径）========

function makeBridge(payload: unknown, raw = false): ToolRouterBridge {
  const text = raw ? String(payload) : JSON.stringify(payload)
  return {
    forwardRequest: async (req) => ({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text }] } }) as JSONRPCResponse,
    listPluginSessions: () => [],
    findPluginClientBySessionId: () => null,
    findPluginClientByClientId: () => null,
    findPluginClientByCodename: () => null,
    setActiveSession: () => {},
    getActiveSession: () => undefined,
    sendNotification: () => {},
    sendTaskPlan: () => {},
    sendTaskStep: () => {},
    sendTaskComplete: () => {},
    handleLocalTool: (req: JSONRPCRequest) =>
      ({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } }) as JSONRPCResponse,
  }
}

function call(name: string, args: Record<string, unknown>, id = 1): JSONRPCRequest {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }
}

function payloadOf(response: JSONRPCResponse): Record<string, any> {
  return JSON.parse((response as any).result.content[0].text)
}

describe('接线 — routeToolCall 插件转发主路径', () => {
  it('重输出工具的超限结果被截断，封装形状不变（仍是 content[0].text）', async () => {
    const bridge = makeBridge({ nodes: makeNodes(500) })
    const response = await routeToolCall(call('search_nodes', { query: 'x' }), bridge, bridge.forwardRequest)

    const content = (response as any).result.content
    expect(Array.isArray(content)).toBe(true)
    expect(content[0].type).toBe('text')
    expect(typeof content[0].text).toBe('string')

    const payload = payloadOf(response)
    expect(payload._budget.truncated).toBe(true)
    expect(payload._truncated.field).toBe('nodes')
    expect(payload.nodes.length).toBeLessThan(500)
  })

  it('调用方传 maxChars 生效，且 maxChars: 0 时不限制', async () => {
    const bridge = makeBridge({ nodes: makeNodes(500) })

    const limited = await routeToolCall(call('search_nodes', { maxChars: 5_000 }), bridge, bridge.forwardRequest)
    expect(payloadOf(limited)._budget.maxChars).toBe(5_000)
    expect(JSON.stringify(payloadOf(limited)).length).toBeLessThanOrEqual(5_000)

    const unlimited = await routeToolCall(call('search_nodes', { maxChars: 0 }), bridge, bridge.forwardRequest)
    expect(payloadOf(unlimited)._budget).toBeUndefined()
    expect(payloadOf(unlimited).nodes.length).toBe(500)
  })

  it('非白名单工具不受影响（原字节返回）', async () => {
    const big = { nodes: makeNodes(500) }
    const bridge = makeBridge(big)
    const response = await routeToolCall(call('selection_get', {}), bridge, bridge.forwardRequest)
    expect((response as any).result.content[0].text).toBe(JSON.stringify(big))
  })

  it('导出类工具（node_export_batch）不叠预算（自带 maxBytes / savePath 机制）', async () => {
    const big = { nodes: makeNodes(500) }
    const bridge = makeBridge(big)
    const response = await routeToolCall(call('node_export_batch', { format: 'svg', nodeIds: ['1:2'] }), bridge, bridge.forwardRequest)
    expect((response as any).result.content[0].text).toBe(JSON.stringify(big))
  })

  it('不是 JSON 的响应跳过预算，不破坏原文', async () => {
    const bridge = makeBridge('plugin exploded: not json at all', true)
    const response = await routeToolCall(call('node_get', { nodeId: '1:2' }), bridge, bridge.forwardRequest)
    expect((response as any).result.content[0].text).toBe('plugin exploded: not json at all')
    expect((response as any).result.isError).toBeUndefined()
  })

  it('预算内结果不重写字节（客户端看到的 JSON 文本与插件原样一致）', async () => {
    const small = { id: '1:2', name: 'Frame' }
    const bridge = makeBridge(small)
    const response = await routeToolCall(call('node_get', { nodeId: '1:2' }), bridge, bridge.forwardRequest)
    expect((response as any).result.content[0].text).toBe(JSON.stringify(small))
  })
})

describe('重输出工具白名单防漏（真机踩过：新工具 fonts_list 返回 95.9KB 未被预算约束）', () => {
  it('所有「清单 / 检索」类工具都必须在 HEAVY_OUTPUT_TOOLS 里（有明确理由的例外见下）', () => {
    // session_list 的规模由「打开着几个插件窗口」决定（个位数），不随文档规模膨胀，也不受用户数据影响
    const BOUNDED_BY_ENVIRONMENT = new Set(['session_list'])
    const missing = getToolList()
      .map((tool) => tool.name)
      .filter((name) => /(_list|_search)$/.test(name))
      .filter((name) => !BOUNDED_BY_ENVIRONMENT.has(name))
      .filter((name) => !HEAVY_OUTPUT_TOOLS.includes(name))
    expect(
      missing,
      `这些工具的响应会随文档规模线性膨胀，却没纳入输出预算：${missing.join(', ')}`,
    ).toEqual([])
  })

  it('fonts_list / style_list_* 已显式纳入，并带工具感知收窄提示', () => {
    for (const name of ['fonts_list', 'style_list_colors', 'style_list_text']) {
      expect(HEAVY_OUTPUT_TOOLS, `${name} 不在白名单`).toContain(name)
      expect(hintFor(name, 90_000, 600)).toContain('截断')
    }
  })
})
