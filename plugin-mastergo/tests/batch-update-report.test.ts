import { describe, it, expect, afterEach } from 'vitest'
import { installMgStub, resetMgStub } from './helpers/mg-stub'
import { handleBatchUpdateNodes } from '../lib/api/nodeHandlers'

/**
 * `node_batchUpdate` 逐项回报门禁
 *
 * 2026-09 真实踩坑：一条坏 nodeId 让整批中断，且抛的是宿主 JSON 桥的内部错
 * `value at updates[i].nodeId is not JSON-serializable`（用户因此废掉两个脚本）。
 * 现在与 batchCreate / batchDelete 同口径：逐项回报、单项失败不中断、错误信息讲清楚。
 */

function makeNode(id: string, type = 'RECTANGLE'): any {
  return {
    id,
    name: id,
    type,
    removed: false,
    isVisible: true,
    isLocked: false,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    fills: [],
    strokes: [],
    effects: [],
  }
}

afterEach(() => {
  resetMgStub()
})

describe('node_batchUpdate：逐项回报', () => {
  it('第 2 条 nodeId 不存在：success=false、updated=2、failed 带 nodeId，后续项仍被处理', () => {
    const a = makeNode('1:1')
    const c = makeNode('1:3')
    installMgStub({ nodes: { '1:1': a, '1:3': c } })

    const res = handleBatchUpdateNodes({
      updates: [
        { nodeId: '1:1', properties: { x: 1 } },
        { nodeId: '1:2', properties: { x: 2 } },
        { nodeId: '1:3', properties: { x: 3 } },
      ],
    })

    expect(res.success).toBe(false)
    expect(res.updated).toBe(2)
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0].nodeId).toBe('1:2')
    expect(res.failed[0].index).toBe(1)
    expect(res.failed[0].error).toContain('1:2')
    expect(res.failed[0].error).toContain('节点不存在')

    // 三项都跑完了（第 2 条失败没有中断第 3 条）
    expect(res.results).toHaveLength(3)
    expect(res.results.map((r: any) => r.success)).toEqual([true, false, true])
    expect(c.x).toBe(3)
  })

  it('错误信息里不出现宿主 JSON 桥的内部错', () => {
    const a = makeNode('1:1')
    installMgStub({ nodes: { '1:1': a } })

    const res = handleBatchUpdateNodes({
      updates: [{ nodeId: '9:9', properties: { x: 1 } }],
    })

    const text = JSON.stringify(res)
    expect(text).not.toContain('JSON-serializable')
    expect(text).not.toContain('not JSON')
  })

  it('nodeId 为 undefined / 非字符串：报「updates[i].nodeId 缺失或不是字符串」，且响应体可 JSON 序列化', () => {
    const a = makeNode('1:1')
    installMgStub({ nodes: { '1:1': a } })
    // 模拟「从 node_clone 信封里取 res.id 拿到 undefined」以及「把带 parent 循环引用的节点对象当 id 传」
    const circularNode: any = { type: 'RECTANGLE', name: 'circular' }
    circularNode.parent = { id: 'page:1', parent: circularNode }

    const res = handleBatchUpdateNodes({
      updates: [
        { nodeId: undefined as any, properties: { x: 1 } },
        { nodeId: circularNode, properties: { x: 2 } },
        { nodeId: '1:1', properties: { x: 3 } },
      ],
    })

    expect(res.success).toBe(false)
    expect(res.updated).toBe(1)
    expect(res.failed).toHaveLength(2)
    expect(res.failed[0].error).toContain('updates[0].nodeId 缺失或不是字符串')
    expect(res.failed[0].error).toContain('undefined')
    expect(res.failed[1].error).toContain('updates[1].nodeId 缺失或不是字符串')
    expect(res.failed[1].error).toContain('object')
    // 关键：不把不可序列化的对象塞进响应体（旧版就是这里炸的）
    expect(() => JSON.stringify(res)).not.toThrow()
    expect(JSON.stringify(res)).not.toContain('circular')
    expect(a.x).toBe(3)
  })

  it('全部成功：success=true、failed 为空数组', () => {
    const a = makeNode('1:1')
    const b = makeNode('1:2')
    installMgStub({ nodes: { '1:1': a, '1:2': b } })

    const res = handleBatchUpdateNodes({
      updates: [
        { nodeId: '1:1', properties: { x: 10 } },
        { nodeId: '1:2', properties: { x: 20 } },
      ],
    })

    expect(res.success).toBe(true)
    expect(res.updated).toBe(2)
    expect(res.failed).toEqual([])
    expect(res.results[0].nodeId).toBe('1:1')
    expect(res.results[1].node.x).toBe(20)
  })

  it('properties 缺失：报 updates[i].properties 缺失（不再抛 Object.entries 的底层错）', () => {
    const a = makeNode('1:1')
    installMgStub({ nodes: { '1:1': a } })

    const res = handleBatchUpdateNodes({
      updates: [{ nodeId: '1:1' } as any],
    })

    expect(res.success).toBe(false)
    expect(res.failed[0].error).toContain('updates[0].properties 缺失或不是对象')
  })

  it('updates 不是数组：仍抛参数错误', () => {
    installMgStub({})
    expect(() => handleBatchUpdateNodes({ updates: undefined as any })).toThrow(/updates/)
  })
})
