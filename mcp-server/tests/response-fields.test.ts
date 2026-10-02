import { describe, it, expect } from 'vitest'
import type { JSONRPCRequest, JSONRPCResponse } from '../src/types/index.js'
import { routeToolCall, type ToolRouterBridge } from '../src/utils/tool-handlers.js'
import { parseFields, filterFields } from '../src/utils/response-fields.js'

/**
 * `fields` 字段白名单测试
 *
 * 背景：`fields` 是**主动**收窄手段（预算是超限后的被动截断）。语义刻意简单可预测：
 * - 只过滤**顶层**（不递归嵌套子对象）；
 * - **`id` 永远保留**（AI 定位 / 续查节点必需）；
 * - 数组 → 逐元素过滤，`missing` 取并集；
 * - 未命中的字段名进 `missing` —— 让 AI 立刻知道**字段名写错了**；
 * - 纯函数：不改入参、`null` / `undefined` 安全。
 */

describe('parseFields — 解析 fields 参数', () => {
  it('数组：去空白、去空串、去重（保持原始大小写）', () => {
    expect(parseFields([' id ', 'name', '', '  ', 'name', 'name'])).toEqual(['id', 'name'])
    // 大小写不归一：JSON 键大小写敏感，写错应在 missing 里回报
    expect(parseFields(['name', 'Name'])).toEqual(['name', 'Name'])
  })

  it('逗号分隔字符串：按 , 拆分并去空白', () => {
    expect(parseFields('id, name ,fills,  ,type')).toEqual(['id', 'name', 'fills', 'type'])
    expect(parseFields('id')).toEqual(['id'])
  })

  it('非法输入 → 空数组（不抛异常）', () => {
    for (const raw of [undefined, null, 42, true, {}, ['ok', 1, null, { a: 1 }]]) {
      expect(Array.isArray(parseFields(raw))).toBe(true)
    }
    expect(parseFields(undefined)).toEqual([])
    expect(parseFields(null)).toEqual([])
    expect(parseFields(['ok', 1, null, { a: 1 }])).toEqual(['ok']) // 只接受字符串项
  })
})

describe('filterFields — 过滤 payload', () => {
  it('对象：只留列出的键，且 id 始终保留', () => {
    const payload = { id: '1:2', name: 'Frame', type: 'FRAME', fills: ['#fff'], size: { w: 100 } }
    const result = filterFields(payload, ['name', 'fills'])

    expect(result.payload).toEqual({ name: 'Frame', fills: ['#fff'], id: '1:2' })
    expect(result.kept.sort()).toEqual(['fills', 'id', 'name'])
    expect(result.missing).toEqual([])
  })

  it('missing：请求了但源里没有的字段名被收集（关键反馈：字段名写错了）', () => {
    const result = filterFields({ id: '1:2', name: 'Frame' }, ['name', 'fill', 'bbox'])
    expect(result.missing).toEqual(['fill', 'bbox'])
    expect(result.kept.sort()).toEqual(['id', 'name'])
  })

  it('嵌套不递归：只过滤顶层，子对象原样保留', () => {
    const payload = { id: '1:2', name: 'Card', children: [{ id: '1:3', name: 'Inner', fills: [] }] }
    const result = filterFields(payload, ['children'])

    expect(result.payload).toEqual({
      children: [{ id: '1:3', name: 'Inner', fills: [] }], // children 内部原样，不被 fields 影响
      id: '1:2',
    })
  })

  it('数组：逐元素过滤，missing 取并集（去重）', () => {
    const payload = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', fills: ['#000'] },
    ]
    const result = filterFields(payload, ['name', 'fills', 'typo'])

    expect(result.payload).toEqual([
      { name: 'A', id: 'a' },
      { name: 'B', fills: ['#000'], id: 'b' },
    ])
    expect(result.kept.sort()).toEqual(['fills', 'id', 'name'])
    expect(result.missing).toEqual(['fills', 'typo']) // 元素 1 缺 fills、两个元素都缺 typo → 并集去重
  })

  it('数组里的非对象元素（字符串 / 数字 / null）原样通过', () => {
    const payload = ['x', 42, null, { id: 'a', name: 'A' }]
    const result = filterFields(payload, ['name'])
    expect(result.payload).toEqual(['x', 42, null, { name: 'A', id: 'a' }])
  })

  it('fields 为空 → 原样返回同一引用，kept / missing 都为空', () => {
    const payload = { id: '1:2', name: 'Frame' }
    for (const empty of [[], undefined as unknown as string[]]) {
      const result = filterFields(payload, empty)
      expect(result.payload).toBe(payload)
      expect(result.kept).toEqual([])
      expect(result.missing).toEqual([])
    }
  })

  it('不修改入参（纯函数）', () => {
    const payload = { id: '1:2', name: 'Frame', fills: ['#fff'] }
    const before = JSON.stringify(payload)
    const result = filterFields(payload, ['name'])
    expect(JSON.stringify(payload)).toBe(before)
    expect(result.payload).not.toBe(payload)
    expect(Object.keys(payload).sort()).toEqual(['fills', 'id', 'name'])
  })

  it('null / undefined / 标量 → 安全返回原值', () => {
    expect(filterFields(null, ['id'])).toEqual({ payload: null, kept: [], missing: [] })
    expect(filterFields(undefined, ['id'])).toEqual({ payload: undefined, kept: [], missing: [] })
    expect(filterFields('text', ['id'])).toEqual({ payload: 'text', kept: [], missing: [] })
    expect(filterFields(7, ['id'])).toEqual({ payload: 7, kept: [], missing: [] })
  })

  it('源对象没有 id 时不凭空造 id', () => {
    const result = filterFields({ name: 'Frame' }, ['name'])
    expect(result.payload).toEqual({ name: 'Frame' })
    expect(result.kept).toEqual(['name'])
  })
})

// ======== 接线：node_get / node_get_root 的 fields 白名单 ========

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

describe('接线 — node_get / node_get_root 的 fields', () => {
  it('node_get 传 fields：只留白名单字段 + id，并回报 _fields', async () => {
    const node = { id: '1:2', name: 'Frame', type: 'FRAME', fills: ['#fff'], strokes: [] }
    const bridge = makeBridge(node)
    const response = await routeToolCall(call('node_get', { nodeId: '1:2', fields: ['name', 'fill'] }), bridge, bridge.forwardRequest)
    const payload = payloadOf(response)

    expect(payload.name).toBe('Frame')
    expect(payload.id).toBe('1:2')
    expect(payload.type).toBeUndefined()
    expect(payload.fills).toBeUndefined()
    expect(payload._fields).toEqual({ kept: ['name', 'id'], missing: ['fill'] })
  })

  it('node_get 不传 fields：字节原样返回（不介入）', async () => {
    const node = { id: '1:2', name: 'Frame', type: 'FRAME' }
    const bridge = makeBridge(node)
    const response = await routeToolCall(call('node_get', { nodeId: '1:2' }), bridge, bridge.forwardRequest)
    expect((response as any).result.content[0].text).toBe(JSON.stringify(node))
  })

  it('node_get_root 传 fields：只过滤顶层，root 子对象保持原样', async () => {
    const payload = {
      rootId: '0:1',
      root: { id: '0:1', name: 'Page', children: [{ id: '0:2', name: 'A' }] },
      ancestors: [{ id: '0:1', name: 'Page' }],
      page: { id: '0:1', name: 'Page 1' },
    }
    const bridge = makeBridge(payload)
    const response = await routeToolCall(call('node_get_root', { nodeId: '0:2', fields: ['root', 'nope'] }), bridge, bridge.forwardRequest)
    const out = payloadOf(response)

    // 顶层只剩 root（+ 说明），root 内部完整保留
    expect(out.root).toEqual(payload.root)
    expect(out.ancestors).toBeUndefined()
    expect(out.page).toBeUndefined()
    expect(out._fields).toEqual({ kept: ['root'], missing: ['nope'] })
  })

  it('非 JSON 响应跳过 fields 过滤，不破坏原文', async () => {
    const bridge = makeBridge('plugin exploded: not json', true)
    const response = await routeToolCall(call('node_get', { nodeId: '1:2', fields: ['name'] }), bridge, bridge.forwardRequest)
    expect((response as any).result.content[0].text).toBe('plugin exploded: not json')
  })
})
