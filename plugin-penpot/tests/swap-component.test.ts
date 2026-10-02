/**
 * `node/swapComponent` —— 插件端合成的「换组件」
 *
 * Penpot 插件 API 没有"换主组件"的写入路径（`instance.component()` 只读），
 * 但这件事能用已有原语拼出来：建实例 → 插回原父层与原图层顺序 → 继承位置/尺寸/名字
 * → 按图层名带过文字/可见性 → 删原对象。
 *
 * 这一组的价值在于：**把"看起来做不到"变成"有明确语义的实现"**，并且逐条锁住语义细节 ——
 * 少任何一条，换组件都会悄悄变成"复制一个实例到别处"。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RequestDispatcher } from '@lib/dispatcher'
import { installHost, resetHost, MemoryHost } from '@lib/host/index'

let host: MemoryHost
let dispatcher: RequestDispatcher

function boot(options?: ConstructorParameters<typeof MemoryHost>[0]) {
  host = new MemoryHost(options)
  installHost(host)
  dispatcher = new RequestDispatcher()
}

beforeEach(() => boot())

afterEach(() => {
  dispatcher.destroy()
  resetHost()
})

async function call(method: string, params: Record<string, unknown> = {}) {
  const response = await dispatcher.dispatch({ jsonrpc: '2.0', id: 1, method, params } as never)
  if ('error' in response) return { __error: response.error } as Record<string, any>
  return response.result as Record<string, any>
}

/** 造一个带内容的组件（母版内容含两个文字层） */
async function makeComponent(name = 'Card / New'): Promise<string> {
  const created = await call('node/create', { element: { type: 'rectangle', name: 'MasterBase', size: { width: 200, height: 100 } } })
  const masterId = created.rootIds[0] as string
  const component = await call('node/convertToComponent', { nodeId: masterId, name })
  host.componentTemplates.set(component.componentId, [
    { name: 'Title', characters: '组件默认标题' },
    { name: 'Body', characters: '组件默认正文' },
  ])
  return component.componentId
}

/** 造一个被替换的普通对象：含同名的文字层（用于测按名字带过文字） */
async function makeSource(name = 'OldCard') {
  const created = await call('node/create', {
    element: {
      type: 'frame',
      name,
      size: { width: 320, height: 160 },
      layoutMode: 'NONE',
      children: [
        { type: 'text', name: 'Title', content: '我的标题', size: { width: 200 } },
        { type: 'text', name: 'Body', content: '我的正文', size: { width: 200 } },
        { type: 'text', name: 'Extra', content: '只有旧的才有', size: { width: 200 } },
      ],
    },
  })
  return created.rootIds[0] as string
}

const find = (name: string) => host.flatten().find((node) => node.name === name)

describe('原位替换', () => {
  it('建实例 → 继承位置/尺寸/名字 → 原对象被删除', async () => {
    const componentId = await makeComponent()
    const sourceId = await makeSource()

    const r = await call('node/swapComponent', { nodeId: sourceId, componentId })
    expect(r.ok).toBe(true)
    expect(r.replaced).toBe(1)
    expect(r.results[0].success).toBe(true)

    // 原对象没了，新实例在原层级
    expect(host.getNodeById(sourceId)).toBeNull()
    const newNode = host.getNodeById(r.results[0].nodeId)!
    expect(newNode.name).toBe('OldCard')

    const props = (newNode as any).props
    expect(props.x).toBe(0)
    expect(props.y).toBe(0)
    expect(props.width).toBe(320) // keepSize 缺省 true → 保持原宽高
    expect(props.height).toBe(160)
  })

  it('图层顺序复位（不是插到末尾）', async () => {
    const componentId = await makeComponent()
    const created = await call('node/create', {
      element: {
        type: 'frame',
        name: 'Parent',
        size: { width: 400, height: 300 },
        layoutMode: 'NONE',
        children: [
          { type: 'rectangle', name: 'Before' },
          { type: 'rectangle', name: 'Target', size: { width: 100, height: 50 } },
          { type: 'rectangle', name: 'After' },
        ],
      },
    })
    const parentId = created.rootIds[0] as string
    const targetId = find('Target')!.id

    await call('node/swapComponent', { nodeId: targetId, componentId })

    const parent = host.getNodeById(parentId) as any
    const names = parent.children.map((child: any) => (child as any).name)
    // 位置仍在 Before 与 After 之间；名字沿用原名（所以比 id / 组件归属，而不是比名字）
    expect(names[0]).toBe('Before')
    expect(names[2]).toBe('After')
    expect(parent.children[1].id).not.toBe(targetId)
    expect(parent.children[1].props.componentId).toBe(componentId)
  })

  it('按图层名带过文字（carryOverOverrides 缺省 true）', async () => {
    const componentId = await makeComponent()
    const sourceId = await makeSource()

    const r = await call('node/swapComponent', { nodeId: sourceId, componentId })
    expect(r.results[0].carriedOver).toBe(2) // Title + Body 同名 → 带过

    const newRoot = host.getNodeById(r.results[0].nodeId) as any
    const title = newRoot.children.find((c: any) => c.name === 'Title')
    const body = newRoot.children.find((c: any) => c.name === 'Body')
    expect(title.props.characters).toBe('我的标题')
    expect(body.props.characters).toBe('我的正文')
    // 'Extra' 在新组件里不存在 → 自然丢失（这是换组件的应有语义）
    expect(newRoot.children.some((c: any) => c.name === 'Extra')).toBe(false)
  })

  it('carryOverOverrides:false → 用组件默认文字', async () => {
    const componentId = await makeComponent()
    const sourceId = await makeSource()

    const r = await call('node/swapComponent', { nodeId: sourceId, componentId, carryOverOverrides: false })
    expect(r.results[0].carriedOver).toBeUndefined()
    const newRoot = host.getNodeById(r.results[0].nodeId) as any
    expect(newRoot.children.find((c: any) => c.name === 'Title').props.characters).toBe('组件默认标题')
  })

  it('keepOriginal:true → 原对象保留', async () => {
    const componentId = await makeComponent()
    const sourceId = await makeSource()

    const r = await call('node/swapComponent', { nodeId: sourceId, componentId, keepOriginal: true })
    expect(r.ok).toBe(true)
    expect(host.getNodeById(sourceId)).not.toBeNull()
  })

  it('keepSize:false → 用组件自身尺寸（不回落到原尺寸）', async () => {
    const componentId = await makeComponent()
    const created = await call('node/create', { element: { type: 'rectangle', name: 'Big', size: { width: 999, height: 888 } } })
    const r = await call('node/swapComponent', { nodeId: created.rootIds[0], componentId, keepSize: false })
    const props = (host.getNodeById(r.results[0].nodeId) as any).props
    // MemoryHost 的实例默认无尺寸 → 不该被写成 999×888
    expect(props.width).not.toBe(999)
  })

  it('name 参数可指定实例名', async () => {
    const componentId = await makeComponent()
    const sourceId = await makeSource()
    const r = await call('node/swapComponent', { nodeId: sourceId, componentId, name: 'Renamed' })
    expect(host.getNodeById(r.results[0].nodeId)!.name).toBe('Renamed')
  })
})

describe('拒绝与降级（不静默）', () => {
  it('被替换对象是组件母版 → 拒绝并说明原因', async () => {
    const created = await call('node/create', { element: { type: 'rectangle', name: 'MasterNode' } })
    const masterId = created.rootIds[0] as string
    const component = await call('node/convertToComponent', { nodeId: masterId, name: 'C1' })

    // 用自己当目标组件也没关系 —— 关键是被替换对象是母版
    const r = await call('node/swapComponent', { nodeId: masterId, componentId: component.componentId })
    expect(r.ok).toBe(false)
    expect(r.results[0].error).toMatch(/是组件母版/)
  })

  it('ukey / 缺组件参数：前者 available:false，后者抛错', async () => {
    const sourceId = await makeSource()
    const byUkey = await call('node/swapComponent', { nodeId: sourceId, ukey: 'k1' })
    expect(byUkey.available).toBe(false)
    expect(byUkey.hint).toMatch(/componentId/)

    expect((await call('node/swapComponent', { nodeId: sourceId })).__error?.message).toMatch(/需要 componentId 或 component/)
  })

  it('组件名找不到 → 逐项失败并给出原因（不抛整批）', async () => {
    const sourceId = await makeSource()
    const r = await call('node/swapComponent', { nodeId: sourceId, component: '不存在组件' })
    expect(r.ok).toBe(false)
    expect(r.failed).toBe(1)
    expect(r.results[0].error).toMatch(/组件未找到/)
  })

  it('resetOverrides / properties / COMPONENT_SET 都有明确说明', async () => {
    const componentId = await makeComponent()
    const sourceId = await makeSource()
    const r = await call('node/swapComponent', {
      nodeId: sourceId,
      componentId,
      resetOverrides: true,
      properties: { slot1: 'comp-x' },
      type: 'COMPONENT_SET',
    })
    const notes = r.results[0].notes.join(' | ')
    expect(notes).toMatch(/resetOverrides 在 Penpot 上无需处理/)
    expect(notes).toMatch(/组件属性插槽/)
    expect(notes).toMatch(/createVariantFromComponents/)
  })

  it('flex 父层 → 说明位置由布局决定', async () => {
    const componentId = await makeComponent()
    const created = await call('node/create', {
      element: {
        type: 'frame',
        name: 'FlexParent',
        size: { width: 400, height: 300 },
        layoutMode: 'VERTICAL',
        children: [{ type: 'rectangle', name: 'FlexTarget', size: { width: 100, height: 50 } }],
      },
    })
    void created
    const targetId = find('FlexTarget')!.id
    const r = await call('node/swapComponent', { nodeId: targetId, componentId })
    expect(r.results[0].success).toBe(true)
    expect(r.results[0].notes.join(' ')).toMatch(/flex 布局/)
  })
})

describe('批量与选区', () => {
  it('批量：逐项回报，一项失败不影响其余', async () => {
    const componentId = await makeComponent()
    const a = await makeSource('A')
    const b = await makeSource('B')

    const r = await call('node/swapComponent', { nodeIds: [a, 'ghost'], componentId })
    // 'ghost' 不存在 → 定位阶段就抛错（整批拒绝，因为参数本身错了）
    expect(r.__error?.message).toMatch(/节点不存在: ghost/)
    void b

    const ok = await call('node/swapComponent', { nodeIds: [a], componentId })
    expect(ok.replaced).toBe(1)
  })

  it('useSelection 回退选区；选区为空时抛错', async () => {
    const componentId = await makeComponent()
    const sourceId = await makeSource()
    await call('selection/set', { nodeIds: [sourceId] })

    const r = await call('node/swapComponent', { componentId })
    expect(r.replaced).toBe(1)

    await call('selection/set', { nodeIds: [] })
    expect((await call('node/swapComponent', { componentId })).__error?.message).toMatch(/没有可替换的对象/)
  })

  it('variantProperties → 走 switchVariant', async () => {
    const componentId = await makeComponent()
    const sourceId = await makeSource()
    const r = await call('node/swapComponent', { nodeId: sourceId, componentId, variantProperties: { State: 'Hover' } })
    expect(r.results[0].success).toBe(true)
    expect(host.variantSwitches).toHaveLength(1)
    expect(host.variantSwitches[0]).toMatchObject({ propertyName: 'State', value: 'Hover' })
  })
})

// ───────────────────────── 原生 swapComponent（官方 API） ─────────────────────────
//
// 这条是本次审计的起点：**Penpot 有 `shape.swapComponent(component)`**，
// 官方原文写着 "Similar to the "swap component" action on the Penpot interface"。
// 我此前断言"没有写入路径"，于是手写了一整套合成实现 —— 现在原生优先、合成只作兜底。
// 这里钉住"什么时候走原生、什么时候回退"，避免以后又退化成"只会合成"。

describe('原生 swapComponent（宿主支持时优先）', () => {
  beforeEach(() => boot({ capabilities: { ops: { swapComponent: true } } }))

  it('源对象是实例 → 走宿主原生，并回读组件信息', async () => {
    const componentId = await makeComponent('Card / New')
    const master = await call('node/create', { element: { type: 'rectangle', name: 'InstMaster' } })
    const masterId = master.rootIds[0] as string
    const comp = await call('node/convertToComponent', { nodeId: masterId, name: 'Card / New' })
    const instance = await host.instantiateComponent({ componentId: comp.componentId, x: 0, y: 0 })
    const source = host.getNodeById(instance.nodeId)!

    const r = await call('node/swapComponent', { nodeId: source.id, componentId })
    expect(r.results[0].success).toBe(true)
    expect(r.results[0].native).toBe(true)
    expect(r.results[0].notes.join(' ')).toMatch(/原生 shape\.swapComponent/)
    // 宿主的替换调用被记录，且原对象**没有被删**（原生语义是就地替换，不是新建）
    expect(host.swaps.at(-1)).toMatchObject({ nodeId: source.id, componentId })
    expect(host.getNodeById(source.id)).not.toBeNull()
  })

  it('carryOverOverrides:false → 额外调 resetOverrides 清覆写', async () => {
    const componentId = await makeComponent('Card / New')
    const master = await call('node/create', { element: { type: 'rectangle', name: 'InstMaster2' } })
    const comp = await call('node/convertToComponent', { nodeId: master.rootIds[0] as string, name: 'Card / New' })
    const instance = await host.instantiateComponent({ componentId: comp.componentId, x: 0, y: 0 })

    await call('node/swapComponent', { nodeId: instance.nodeId, componentId, carryOverOverrides: false })
    expect(host.resets).toContain(instance.nodeId)
  })

  it('源对象不是实例 → 明确回退到合成实现（原生要求是实例）', async () => {
    const componentId = await makeComponent('Card / New')
    const sourceId = await makeSource('PlainRect')

    const r = await call('node/swapComponent', { nodeId: sourceId, componentId })
    expect(r.results[0].success).toBe(true)
    expect(r.results[0].native).toBeUndefined()
    expect(r.results[0].notes.join(' ')).toMatch(/不是组件实例 → 用合成实现/)
    expect(host.swaps).toHaveLength(0)
  })
})

// 真机语义（用户选中一个 Button **副本实例**时暴露的）：
// 我按名字把 `isComponentRoot` 当成了"是母版"，把副本实例判成了母版 ✗。
// 官方说明原文（api.yml）：
//   isComponentInstance()     → "inside a component instance"（母版/副本都算，含子节点）
//   isComponentMainInstance() → "inside a component **main** instance"   ← 判母版
//   isComponentCopyInstance() → "inside a component **copy** instance"   ← 判副本
//   isComponentRoot()         → "the root of a component tree"（副本的根也为真 → 不区分）
// 这组用例把判定钉在官方成员上，而不是名字。

describe('母版 / 副本判定用官方成员（不是名字）', () => {
  it('isComponentMainInstance=true（且 masterNodeId 不匹配）→ 仍然拒绝替换', async () => {
    const componentId = await makeComponent('Card / New')
    const created = await call('node/create', { element: { type: 'rectangle', name: 'MasterLike' } })
    const nodeId = created.rootIds[0] as string
    // 模拟真机：节点在母版内部，但组件库的 masterNodeId 指向别的节点
    const node = host.getNodeById(nodeId)!
    ;(node as unknown as { props: Record<string, unknown> }).props.isComponentMainInstance = true

    const r = await call('node/swapComponent', { nodeId, componentId })
    expect(r.ok).toBe(false)
    expect(r.results[0].error).toMatch(/组件母版/)
  })

  it('副本实例（isComponentCopyInstance=true）→ 走宿主原生 swapComponent', async () => {
    boot({ capabilities: { ops: { swapComponent: true } } })
    const componentId = await makeComponent('Card / New')
    const created = await call('node/create', { element: { type: 'rectangle', name: 'CopyLike' } })
    const nodeId = created.rootIds[0] as string
    ;(host.getNodeById(nodeId) as unknown as { props: Record<string, unknown> }).props.isComponentCopyInstance = true

    const r = await call('node/swapComponent', { nodeId, componentId })
    expect(r.results[0].native).toBe(true)
    expect(host.swaps.at(-1)).toMatchObject({ nodeId, componentId })
  })

  it('普通对象（两个标志都假）→ 合成实现（原位替换）', async () => {
    const componentId = await makeComponent('Card / New')
    const plain = await makeSource('PlainOne')
    const r = await call('node/swapComponent', { nodeId: plain, componentId })
    expect(r.results[0].native).toBeUndefined()
    expect(r.results[0].notes.join(' ')).toMatch(/不是组件实例 → 用合成实现/)
  })
})
