import { describe, it, expect, afterEach } from 'vitest'
import { installMgStub, resetMgStub, type MgStub } from './helpers/mg-stub'
import { handleConvertToComponent } from '../lib/api/nodeHandlers'
import { handleCapabilities } from '../lib/api/mcpHandlers'

/**
 * `node_convertToComponent` 的两个新形态：
 * - D `listOnly: true`：只列举不转换（回 `matched: [{nodeId,name,type}]`）
 * - E `variantGroups[]`：按显式属性表把成员改名成 `Prop=Value` 后 `combineAsVariants` 合成原生变体集
 *
 * 宿主 API 桩：`mg-stub` 不含 `createComponent` / `combineAsVariants`（真实宿主才有），
 * 故在**本测试文件内**补桩，不动共享 helper（`tests/helpers/mg-stub.ts` 未改动）。
 */

function makeNode(id: string, type = 'FRAME'): any {
  const node: any = {
    id,
    name: `${type}-${id}`,
    type,
    removed: false,
    isVisible: true,
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
  if (type === 'FRAME' || type === 'COMPONENT') {
    node.flexMode = 'NONE'
    node.itemSpacing = 0
    node.paddingTop = 0
    node.paddingRight = 0
    node.paddingBottom = 0
    node.paddingLeft = 0
    node.mainAxisAlignItems = 'FLEX_START'
    node.crossAxisAlignItems = 'FLEX_START'
    node.mainAxisSizingMode = 'FIXED'
    node.crossAxisSizingMode = 'FIXED'
    node.clipsContent = true
  }
  node.remove = () => {
    node.removed = true
    const parent = node.parent
    if (parent && Array.isArray(parent.children)) {
      parent.children = parent.children.filter((c: any) => c !== node)
    }
  }
  return node
}

/** 能真正收子节点的容器（appendChild 写 children + 反向 parent） */
function makeContainer(id: string, type = 'FRAME'): any {
  const container: any = Object.assign(makeNode(id, type), {
    children: [],
    appendChild(child: any) {
      container.children = container.children.filter((c: any) => c !== child)
      container.children.push(child)
      child.parent = container
    },
  })
  return container
}

/** 页面级 findAll 的最小实现（真实宿主提供，桩里没有） */
function attachFindAll(mg: MgStub, nodes: any[]): void {
  const page = mg.document.currentPage as any
  page.findAll = (predicate: (n: any) => boolean) => (predicate ? nodes.filter(predicate) : nodes.slice())
}

interface VariantHarness {
  mg: MgStub
  /** 宿主调用事件序列：'create'（建母版）/ 'combine'（合成变体集） */
  events: string[]
  createdComponents: any[]
  combineCalls: any[][]
  sets: any[]
}

interface HarnessOptions {
  nodes: any[]
  /** 是否注入 combineAsVariants（false 用来模拟私有化客户端缺 API） */
  withCombine?: boolean
  withFindAll?: boolean
}

function installVariantStub(opts: HarnessOptions): VariantHarness {
  const nodesById: Record<string, any> = {}
  for (const node of opts.nodes) nodesById[node.id] = node
  const mg = installMgStub({ nodes: nodesById })

  const events: string[] = []
  const createdComponents: any[] = []
  const combineCalls: any[][] = []
  const sets: any[] = []
  let componentSeq = 0
  let setSeq = 0

  ;(mg as any).createComponent = () => {
    const component = makeContainer(`C:${++componentSeq}`, 'COMPONENT')
    createdComponents.push(component)
    events.push('create')
    return component
  }

  if (opts.withCombine !== false) {
    ;(mg as any).combineAsVariants = (list: any[]) => {
      events.push('combine')
      combineCalls.push(list.slice())
      const set = makeContainer(`SET:${++setSeq}`, 'COMPONENT_SET')
      set.name = `COMPONENT_SET-${setSeq}`
      sets.push(set)
      return set
    }
  }

  if (opts.withFindAll) attachFindAll(mg, opts.nodes)

  return { mg, events, createdComponents, combineCalls, sets }
}

afterEach(() => {
  resetMgStub()
})

describe('node_convertToComponent：listOnly 只列举不转换', () => {
  it('namePrefix + listOnly 回 matched[{nodeId,name,type}]，且不建组件、不改文档', () => {
    const outer = makeContainer('1:1', 'FRAME')
    outer.name = 'DS_Card'
    const inner = makeNode('1:2', 'TEXT')
    inner.name = 'DS_Inner' // 前缀匹配但祖先是匹配节点 → 只取最外层，必须被剪枝
    outer.appendChild(inner)
    const other = makeNode('1:3', 'FRAME')
    other.name = 'Other'
    const harness = installVariantStub({ nodes: [outer, inner, other], withFindAll: true })

    const res = handleConvertToComponent({ namePrefix: 'DS_', listOnly: true })

    expect(res.ok).toBe(true)
    expect(res.matched).toEqual([
      { nodeId: '1:1', name: 'DS_Card', type: 'FRAME' },
    ])
    expect(res.count).toBe(1)
    expect(res.components).toEqual([])
    expect(res.skipped).toEqual([])
    expect(res.namePrefix).toBe('DS_')
    expect(Array.isArray(res.notes) && res.notes.length > 0).toBe(true)
    // 关键：一次转换都没发生
    expect(harness.events).toEqual([])
    expect(harness.createdComponents).toEqual([])
    expect(outer.removed).toBe(false)
    expect(inner.removed).toBe(false)
  })

  it('listOnly 也支持 nodeIds，不存在的节点进 skipped（不抛错）', () => {
    const a = makeNode('1:1', 'COMPONENT')
    a.name = 'Existing'
    installVariantStub({ nodes: [a] })

    const res = handleConvertToComponent({ nodeIds: ['1:1', '9:9'], listOnly: true })

    expect(res.ok).toBe(true)
    expect(res.matched).toEqual([{ nodeId: '1:1', name: 'Existing', type: 'COMPONENT' }])
    expect(res.count).toBe(1)
    expect(res.skipped).toEqual([
      { nodeId: '9:9', reason: 'not-found', message: 'Node not found: 9:9' },
    ])
  })

  it('listOnly 缺少 nodeId/nodeIds/namePrefix 时抛参数错；与 variantGroups 互斥', () => {
    installVariantStub({ nodes: [] })
    expect(() => handleConvertToComponent({ listOnly: true })).toThrow(/listOnly=true 需要与/)
    expect(() => handleConvertToComponent({
      listOnly: true,
      variantGroups: [{ setId: 'DS_X', propertyName: 'State', members: [] }],
    })).toThrow(/互斥/)
  })
})

describe('node_convertToComponent：variantGroups 合成原生变体集', () => {
  it('成员改名成 State=X、调用 combineAsVariants、set 改名为 setId、values 与 members 对齐', () => {
    const parent = makeContainer('2:1')
    const def = makeNode('1:1')
    def.name = 'Btn_Default'
    const hover = makeNode('1:2')
    hover.name = 'Btn_Hover'
    parent.appendChild(def)
    parent.appendChild(hover)
    const harness = installVariantStub({ nodes: [def, hover, parent] })

    const res = handleConvertToComponent({
      variantGroups: [{
        setId: 'DS_Button',
        propertyName: 'State',
        members: [{ nodeId: '1:1', value: 'default' }, { nodeId: '1:2', value: 'hover' }],
      }],
    })

    expect(res.ok).toBe(true)
    expect(res.count).toBe(2)
    // 成员被改名成宿主的变体命名约定（Prop=Value）
    expect(harness.createdComponents.map((c) => c.name)).toEqual(['State=default', 'State=hover'])
    expect(harness.combineCalls).toHaveLength(1)
    expect(harness.combineCalls[0].map((c) => c.name)).toEqual(['State=default', 'State=hover'])
    // set 被改名为 setId，并回读实际值
    expect(harness.sets[0].name).toBe('DS_Button')
    expect(res.variantSets).toEqual([{
      setId: 'DS_Button',
      containerId: 'SET:1',
      propertyName: 'State',
      memberCount: 2,
      values: ['default', 'hover'],
      ok: true,
    }])
    // components 回读的是改名后的真实名字（便于对账）
    expect(res.components).toEqual([
      { nodeId: '1:1', componentId: 'C:1', name: 'State=default' },
      { nodeId: '1:2', componentId: 'C:2', name: 'State=hover' },
    ])
    expect(res.skipped).toEqual([])
    // 覆盖成员原名这件事必须写进 notes（不静默）
    expect(res.notes.join('\n')).toMatch(/被覆盖/)
    // 原节点已被原位转成母版（keepOriginal 未传）
    expect(def.removed).toBe(true)
    expect(hover.removed).toBe(true)
  })

  it('先把所有 group 的成员转完，再逐组合成', () => {
    const parent = makeContainer('2:1')
    const nodes: any[] = []
    for (const id of ['1:1', '1:2', '1:3', '1:4']) {
      const node = makeNode(id)
      parent.appendChild(node)
      nodes.push(node)
    }
    const harness = installVariantStub({ nodes: [...nodes, parent] })

    const res = handleConvertToComponent({
      variantGroups: [
        { setId: 'DS_A', propertyName: 'State', members: [{ nodeId: '1:1', value: 'a1' }, { nodeId: '1:2', value: 'a2' }] },
        { setId: 'DS_B', propertyName: 'Size', members: [{ nodeId: '1:3', value: 'b1' }, { nodeId: '1:4', value: 'b2' }] },
      ],
    })

    expect(harness.events).toEqual(['create', 'create', 'create', 'create', 'combine', 'combine'])
    expect(res.variantSets.map((v: any) => [v.setId, v.propertyName, v.ok])).toEqual([
      ['DS_A', 'State', true],
      ['DS_B', 'Size', true],
    ])
  })

  it('已是 COMPONENT 的成员被直接复用（不重复转换）', () => {
    const existing = makeNode('1:1', 'COMPONENT')
    existing.name = 'ExistingMaster'
    const raw = makeNode('1:2')
    raw.name = 'RawHover'
    const harness = installVariantStub({ nodes: [existing, raw] })

    const res = handleConvertToComponent({
      variantGroups: [{
        setId: 'DS_Button', propertyName: 'State',
        members: [{ nodeId: '1:1', value: 'default' }, { nodeId: '1:2', value: 'hover' }],
      }],
    })

    // 只给 raw 建了一次母版
    expect(harness.createdComponents).toHaveLength(1)
    expect(harness.combineCalls[0].map((c) => c.id)).toEqual(['1:1', 'C:1'])
    expect(res.ok).toBe(true)
    expect(res.components).toEqual([
      { nodeId: '1:1', componentId: '1:1', name: 'State=default' },
      { nodeId: '1:2', componentId: 'C:1', name: 'State=hover' },
    ])
    // 复用这件事如实写进 notes
    expect(res.notes.join('\n')).toMatch(/复用/)
    // 复用节点本身没有被 remove
    expect(existing.removed).toBe(false)
  })

  it('宿主没有 combineAsVariants → ok:false + reason，不抛错、不改成员名', () => {
    const a = makeNode('1:1')
    a.name = 'Btn_Default'
    const b = makeNode('1:2')
    b.name = 'Btn_Hover'
    const harness = installVariantStub({ nodes: [a, b], withCombine: false })

    const res = handleConvertToComponent({
      variantGroups: [{
        setId: 'DS_Button', propertyName: 'State',
        members: [{ nodeId: '1:1', value: 'default' }, { nodeId: '1:2', value: 'hover' }],
      }],
    })

    expect(res.ok).toBe(false)
    expect(res.variantSets).toHaveLength(1)
    expect(res.variantSets[0].ok).toBe(false)
    expect(res.variantSets[0].reason).toMatch(/容器未提供 combineAsVariants|宿主未提供 combineAsVariants/)
    // 合成不了就不做破坏性改名：成员母版仍是原名
    expect(harness.createdComponents.map((c) => c.name)).toEqual(['Btn_Default', 'Btn_Hover'])
    expect(res.variantSets[0].values).toBeUndefined()
  })

  it('成员不足 2 个 → ok:false + reason（不合成）', () => {
    const only = makeNode('1:1')
    only.name = 'Solo'
    const harness = installVariantStub({ nodes: [only] })

    const res = handleConvertToComponent({
      variantGroups: [{
        setId: 'DS_Solo', propertyName: 'State',
        members: [{ nodeId: '1:1', value: 'only' }],
      }],
    })

    expect(res.ok).toBe(false)
    expect(res.variantSets[0]).toMatchObject({ setId: 'DS_Solo', memberCount: 1, ok: false })
    expect(res.variantSets[0].reason).toMatch(/成员不足 2 个/)
    expect(harness.combineCalls).toEqual([])
  })

  it('combineAsVariants 抛错 → 该组 ok:false + notify 兜底，其它组不受影响', () => {
    const parent = makeContainer('2:1')
    const nodes: any[] = []
    for (const id of ['1:1', '1:2', '1:3', '1:4']) {
      const node = makeNode(id)
      parent.appendChild(node)
      nodes.push(node)
    }
    const harness = installVariantStub({ nodes: [...nodes, parent] })
    // 只让第一组合成失败
    const original = (harness.mg as any).combineAsVariants
    let call = 0
    ;(harness.mg as any).combineAsVariants = (list: any[]) => {
      if (call++ === 0) throw new Error('host refused')
      return original(list)
    }

    const res = handleConvertToComponent({
      variantGroups: [
        { setId: 'DS_Bad', propertyName: 'State', members: [{ nodeId: '1:1', value: 'x' }, { nodeId: '1:2', value: 'y' }] },
        { setId: 'DS_Good', propertyName: 'State', members: [{ nodeId: '1:3', value: 'x' }, { nodeId: '1:4', value: 'y' }] },
      ],
    })

    expect(res.ok).toBe(false)
    expect(res.variantSets[0].ok).toBe(false)
    expect(res.variantSets[0].reason).toMatch(/combineAsVariants 抛错/)
    expect(res.variantSets[0].values).toEqual(['x', 'y'])
    expect(res.variantSets[1]).toMatchObject({ setId: 'DS_Good', ok: true, values: ['x', 'y'] })
    // 与 componentHandlers 同风格的兜底提示
    expect((harness.mg as any).notifications.some((m: string) => m.includes('可手动选中后右键 Combine as Variants'))).toBe(true)
  })

  it('宿主拒绝改名时：ok:true 但把期望值与实际值写进 reason/notes', () => {
    const a = makeNode('1:1')
    const b = makeNode('1:2')
    const harness = installVariantStub({ nodes: [a, b] })
    const original = (harness.mg as any).combineAsVariants
    ;(harness.mg as any).combineAsVariants = (list: any[]) => {
      const set = original(list)
      Object.defineProperty(set, 'name', { configurable: true, get: () => 'FrozenSet', set: () => {} })
      return set
    }

    const res = handleConvertToComponent({
      variantGroups: [{
        setId: 'DS_Button', propertyName: 'State',
        members: [{ nodeId: '1:1', value: 'default' }, { nodeId: '1:2', value: 'hover' }],
      }],
    })

    expect(res.variantSets[0].ok).toBe(true)
    expect(res.variantSets[0].setId).toBe('FrozenSet')
    expect(res.variantSets[0].reason).toMatch(/"DS_Button"/)
    expect(res.variantSets[0].reason).toMatch(/"FrozenSet"/)
    expect(res.notes.join('\n')).toMatch(/FrozenSet/)
  })

  it('keepOriginal=true 在 variantGroups 形态下不适用：按 false 处理并写进 notes', () => {
    const a = makeNode('1:1')
    const b = makeNode('1:2')
    const harness = installVariantStub({ nodes: [a, b] })

    const res = handleConvertToComponent({
      keepOriginal: true,
      variantGroups: [{
        setId: 'DS_Button', propertyName: 'State',
        members: [{ nodeId: '1:1', value: 'default' }, { nodeId: '1:2', value: 'hover' }],
      }],
    })

    expect(res.notes[0]).toMatch(/keepOriginal 不适用/)
    // 成员是原位转母版（原节点被移除），不是"留副本"
    expect(a.removed).toBe(true)
    expect(b.removed).toBe(true)
    expect(res.variantSets[0].ok).toBe(true)
    expect(harness.createdComponents).toHaveLength(2)
  })

  it('members 为空 / 缺 nodeId 的配置如实回报，不抛错', () => {
    const a = makeNode('1:1')
    const harness = installVariantStub({ nodes: [a] })

    const res = handleConvertToComponent({
      variantGroups: [
        { setId: 'DS_Empty', propertyName: 'State', members: [] },
        { setId: 'DS_Bad', propertyName: 'State', members: [{ value: 'x' }, { nodeId: '9:9', value: 'y' }] },
      ],
    })

    expect(res.ok).toBe(false)
    expect(res.variantSets[0].reason).toMatch(/members 为空/)
    expect(res.variantSets[1].ok).toBe(false)
    expect(res.skipped.map((s: any) => s.reason)).toEqual(['invalid-member', 'not-found'])
    expect(harness.events).toEqual([])
  })
})

describe('plugin_capabilities：变体探测块', () => {
  it('注入 combineAsVariants 时为 true，缺失时为 false', () => {
    // handleCapabilities 会读构建期注入的版本常量，测试里补一个全局值
    ;(globalThis as any).__PLUGIN_VERSION__ = 'test'

    const harness = installVariantStub({ nodes: [makeNode('1:1')] })
    const withCombine = handleCapabilities({}, {} as any)
    expect(withCombine.variants).toMatchObject({ combineAsVariants: true })
    // 桩里页面上没有 INSTANCE / FRAME 可选（findOne 缺失）→ 节点级探测为 null
    expect(withCombine.variants.setVariantPropertyValues).toBeNull()

    const { mg: bare } = installVariantStub({ nodes: [], withCombine: false })
    expect((bare as any).combineAsVariants).toBeUndefined()
    expect(handleCapabilities({}, {} as any).variants.combineAsVariants).toBe(false)
    expect(harness.events).toEqual([])
  })
})
