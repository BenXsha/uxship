/**
 * `variable/apply`（令牌**绑定**）与 `variable_update` 的选择器口径
 *
 * 这一组锁两件在真机上会静默出错的事：
 *
 * 1. **id 选择器**：`variable_update` 工具 schema 的必填字段是 `id`（为 MasterGo 的形状），
 *    而 Penpot 的宿主方法按 `name` 定位。若不把 id 反查成名字，调用方拿 `variable_create`
 *    返回的 id 去改值**必失败** —— 而"改一次令牌、全稿联动"正是设计系统流水线的主循环。
 * 2. **绑定必须回读校验**：`applyToShapes()` 返回 void，宿主对不认识的属性名是静默忽略的，
 *    所以 `applied` 只能来自 `shape.tokens` 的读回，不能来自"调用没报错"。
 *
 * MemoryHost 刻意不实现绑定（`tokenBinding: false`），因此这里的断言正好覆盖
 * 「宿主不支持时必须如实说」这条降级路径 —— 而不是假装成功。
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
  if ('error' in response) return { __error: response.error } as Record<string, any>
  return response.result as Record<string, any>
}

/** 建一个令牌，返回 variable_create 给出的令牌 id（字段名就是 nodeId，沿用现状） */
async function createToken(name: string, value = '#FF4D3D') {
  const created = await result('variable/create', {
    name,
    type: 'COLOR',
    value,
    collectionName: 'Design Tokens',
  })
  expect(created.ok).toBe(true)
  return created.nodeId as string
}

async function createRect(name = 'R') {
  const created = await result('node/create', {
    element: { type: 'rectangle', name, size: { width: 120, height: 40 } },
  })
  return created.rootIds[0] as string
}

describe('variable/update 的选择器口径', () => {
  it('用 id 定位改值（工具 schema 的必填字段就是 id）', async () => {
    const id = await createToken('color.brand.primary')
    const updated = await result('variable/update', { id, value: '#0066FF' })

    expect(updated.__error).toBeUndefined()
    expect(updated.ok).toBe(true)
    expect(updated.updated).toContain('value')
  })

  it('同时传 id + name 时，name 是**新名字**（与 MasterGo 同义），不是选择器', async () => {
    const id = await createToken('color.brand.primary')
    const updated = await result('variable/update', { id, name: 'color.brand.base', value: '#00AA55' })

    expect(updated.updated).toEqual(expect.arrayContaining(['value', 'name']))
    expect(updated.name).toBe('color.brand.base')

    const list = await result('variable/list')
    const names = list.collections.flatMap((set: any) => set.variables.map((v: any) => v.name))
    expect(names).toContain('color.brand.base')
    expect(names).not.toContain('color.brand.primary')
  })

  it('只传 name / variableId 时仍按名字定位（兼容旧用法）', async () => {
    await createToken('color.neutral.bg')
    const updated = await result('variable/update', { name: 'color.neutral.bg', value: '#FFFFFF' })
    expect(updated.ok).toBe(true)
  })

  it('id 不存在时给出可操作的原因，而不是静默改错令牌', async () => {
    await createToken('color.brand.primary')
    const updated = await result('variable/update', { id: 'not-a-real-id', value: '#000000' })
    expect(updated.__error?.message ?? '').toContain('令牌不存在')
  })
})

describe('variable/apply（绑定）', () => {
  it('按 id 绑定：能解析到令牌（不报"令牌不存在"），宿主不支持时如实上报', async () => {
    const id = await createToken('color.brand.primary')
    const nodeId = await createRect('Bind Target')

    const bound = await result('variable/apply', { id, nodeIds: [nodeId] })

    // 关键：解析成功 —— 否则 handler 会直接抛错（见上一条「id 不存在」）
    expect(bound.__error).toBeUndefined()
    expect(bound.total).toBe(1)
    expect(bound.properties).toEqual(['fill'])
    // MemoryHost = tokenBinding:false → 必须如实说"没绑上"，并带上回读结果
    expect(bound.applied).toBe(0)
    expect(bound.nodes[0].applied).toBe(false)
    expect(bound.nodes[0].bound).toEqual({})
    expect(String(bound.nodes[0].note ?? '')).toContain('不支持')
  })

  it('节点不存在时进 skipped，不中断其它节点', async () => {
    const id = await createToken('color.brand.primary')
    const nodeId = await createRect('Bind Target')

    const bound = await result('variable/apply', { id, nodeIds: [nodeId, 'missing-node'] })

    expect(bound.total).toBe(2)
    expect(bound.skipped).toEqual([{ nodeId: 'missing-node', reason: expect.stringContaining('节点不存在') }])
  })

  it('properties 可覆盖默认的 fill', async () => {
    const id = await createToken('color.brand.primary')
    const nodeId = await createRect('Bind Target')

    const bound = await result('variable/apply', { id, nodeIds: [nodeId], properties: ['fill', 'stroke'] })
    expect(bound.properties).toEqual(['fill', 'stroke'])
  })
})

/**
 * 集合激活（`activateSet`）
 *
 * 真机（Penpot 2.18.0）教训：令牌集合默认 `active: false`，此时 `shape.tokens` 已有绑定引用，
 * 但改令牌值后 `fills` 仍是旧色 —— **绑定≠渲染联动**。所以激活必须是可操作的一步。
 *
 * ⚠️ 注意 `MemoryHost` 建集合时是 `active: true`，与真机默认相反；
 * 因此下面**不依赖默认值**，而是两个方向都显式断言。
 */
describe('variable/update 的 activateSet', () => {
  it('能停用与激活，并回读真实状态', async () => {
    const id = await createToken('color.brand.primary')

    const off = await result('variable/update', { id, activateSet: false })
    expect(off.__error).toBeUndefined()
    expect(off.setActive).toBe(false)
    expect(off.updated).toContain('setActive')
    expect((await result('variable/list')).collections[0].active).toBe(false)

    const on = await result('variable/update', { id, activateSet: true })
    expect(on.setActive).toBe(true)
    expect((await result('variable/list')).collections[0].active).toBe(true)
  })

  it('已是目标状态时不谎报 changed（幂等）', async () => {
    const id = await createToken('color.brand.primary')
    await result('variable/update', { id, activateSet: true })

    const again = await result('variable/update', { id, activateSet: true })
    expect(again.setActive).toBe(true)
    expect(again.updated).toEqual([])
    expect(again.ok).toBe(false)
    expect(String(again.reason ?? '')).toContain('没有需要更新的字段')
  })

  it('未传 activateSet 时响应里不带该字段（不干扰既有调用方）', async () => {
    const id = await createToken('color.brand.primary')
    const updated = await result('variable/update', { id, value: '#123456' })
    expect(updated.updated).toContain('value')
    expect(updated.setActive).toBeUndefined()
  })
})

/**
 * 改值 → 传播（`Token.applyToShapes()`）
 *
 * 真机教训：改令牌值**不会**自动回写已绑定形状（集合已 active、引用也在，fills 与渲染都不变；
 * 而面板手改会刷新）。所以改值必须跟一次显式传播，并把 matched/rewritten（回读数）带回。
 */
describe('variable/update 的传播', () => {
  it('改值时自动带传播结果（内存宿主不支持 → 如实 0 + note，不谎报）', async () => {
    const id = await createToken('color.brand.primary')

    const updated = await result('variable/update', { id, value: '#0066FF' })

    expect(updated.updated).toContain('value')
    expect(updated.propagated).toMatchObject({ matched: 0, rewritten: 0, mechanism: 'none' })
    expect(updated.warnings).toBeUndefined()
  })

  it('没改值时不带 propagated（不能假装传播过）', async () => {
    const id = await createToken('color.brand.primary')

    const renamed = await result('variable/update', { id, name: 'color.brand.base' })

    expect(renamed.updated).toContain('name')
    expect(renamed.propagated).toBeUndefined()
  })
})
