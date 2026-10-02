/**
 * `node/convertToComponent` 的 `namePrefix` 形态（按名前缀建库）
 *
 * 语义与 MasterGo 侧对齐：当前页里名字以该前缀开头的节点，**只取最外层**
 * （祖先也匹配的节点必须丢弃 —— 先转父节点会让子节点 id 失效），已是组件母版的跳过。
 *
 * Penpot 侧判断「已是组件母版」用 `listComponents().masterNodeId`（HostNode 不暴露
 * parent，也没法用形态 C 的祖先回溯），所以这里同时验证跳过是**幂等**的。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RequestDispatcher } from '@lib/dispatcher'
import { installHost, resetHost, MemoryHost } from '@lib/host/index'

let host: MemoryHost
let dispatcher: RequestDispatcher

beforeEach(() => {
  host = new MemoryHost()
  installHost(host)
  dispatcher = new RequestDispatcher()
})

afterEach(() => {
  dispatcher.destroy()
  resetHost()
})

async function result(method: string, params: Record<string, unknown> = {}) {
  const response = await dispatcher.dispatch({ jsonrpc: '2.0', id: 1, method, params } as never)
  if ('error' in response) return { __error: response.error }
  return response.result as Record<string, any>
}

async function createNode(type: string, name: string, parentId?: string): Promise<string> {
  const params: Record<string, unknown> = {
    element: { type, name, size: { width: 100, height: 60 } },
  }
  if (parentId) params.parentId = parentId
  const r = await result('node/create', params)
  return r.rootIds[0] as string
}

describe('node/convertToComponent —— namePrefix（按名建库）', () => {
  it('只取最外层：匹配节点的后代不再单独转换', async () => {
    const card = await createNode('frame', 'DS_Card')
    const inner = await createNode('rectangle', 'DS_Inner', card) // 也匹配前缀，但祖先是匹配节点
    const loose = await createNode('rectangle', 'DS_Loose') // 顶层，独立匹配
    await createNode('rectangle', 'Other') // 不匹配

    const r = await result('node/convertToComponent', { namePrefix: 'DS_' })

    expect(r.ok).toBe(true)
    expect(r.namePrefix).toBe('DS_')
    // 最外层候选 = DS_Card + DS_Loose；DS_Inner 被剪枝
    expect(r.matched).toBe(2)
    expect(r.count).toBe(2)
    expect(r.skipped).toEqual([])
    expect(r.components.map((c: any) => c.name).sort()).toEqual(['DS_Card', 'DS_Loose'])
    expect(r.components.map((c: any) => c.nodeId).sort()).toContain(loose)
    // 子层没有被单独转成母版（仍是卡里的普通子层）
    expect(host.getNodeById(inner)?.type).not.toBe('component')
    expect(await host.listComponents()).toHaveLength(2)
  })

  it('已是组件母版的跳过（幂等），不重复转、不抛错', async () => {
    await createNode('frame', 'DS_Card')
    await createNode('rectangle', 'DS_Other')

    const first = await result('node/convertToComponent', { namePrefix: 'DS_' })
    expect(first.count).toBe(2)

    const again = await result('node/convertToComponent', { namePrefix: 'DS_' })
    expect(again.ok).toBe(false)
    expect(again.matched).toBe(2)
    expect(again.count).toBe(0)
    expect(again.skipped.map((s: any) => s.reason)).toEqual(['already-component', 'already-component'])
    // 没有产生重复组件
    const list = await result('component/list')
    expect(list.count).toBe(2)
  })

  it('前缀零命中时返回空批次（不抛错）', async () => {
    await createNode('frame', 'Whatever')
    const r = await result('node/convertToComponent', { namePrefix: 'ZZ_' })
    expect(r.matched).toBe(0)
    expect(r.count).toBe(0)
    expect(r.components).toEqual([])
  })

  it('keepOriginal 仍如实说明 Penpot 无该语义', async () => {
    await createNode('frame', 'DS_Card')
    const r = await result('node/convertToComponent', { namePrefix: 'DS_', keepOriginal: true })
    expect(r.note).toMatch(/没有"保留原对象副本"的语义/)
  })
})
