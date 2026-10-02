import { describe, it, expect, afterEach } from 'vitest'
import { installMgStub, resetMgStub, type MgStub } from './helpers/mg-stub'
import { handleCloneNode, handleConvertToComponent } from '../lib/api/nodeHandlers'

/**
 * 信封字段门禁：`node_clone` 与 `node_convertToComponent`
 *
 * 2026-09 真实踩坑：
 * - `node_clone` 返回 `{success, node}` 信封，而 `node_get` / `node_update` 返回**裸节点**；
 *   混用时 `res.id` 取到 `undefined`，再把 undefined 当 nodeId 传下去就撞上宿主
 *   `not JSON-serializable` 内部错 → 现在信封里补顶层 `id`，两种读法都安全。
 * - `node_convertToComponent` 会给母版分配**新 id** 却不回传（旧版只返回裸节点快照），
 *   用户不接住返回值就再也找不到组件 → 现在显式回传 `componentId`。
 */

function makeNode(id: string, type = 'FRAME'): any {
  const node: any = {
    id,
    name: `${type}-${id}`,
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
  // 宿主 SceneNode.remove()：标记 removed 并从父层 children 里摘掉
  node.remove = () => {
    node.removed = true
    const parent = node.parent
    if (parent && Array.isArray(parent.children)) {
      parent.children = parent.children.filter((c: any) => c !== node)
    }
  }
  return node
}

/** 能真正收子节点的容器（appendChild 写入 children + 反向 parent） */
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

afterEach(() => {
  resetMgStub()
})

describe('node_clone：信封补顶层 id（与裸节点读法兼容）', () => {
  it('返回体同时有顶层 id 与 node.id，且两者一致', () => {
    const source = makeNode('1:1')
    const cloned = makeNode('1:99')
    source.clone = () => cloned
    installMgStub({ nodes: { '1:1': source } })

    const res = handleCloneNode({ nodeId: '1:1' })

    expect(res.success).toBe(true)
    expect(typeof res.id).toBe('string')
    expect(res.id).toBe(cloned.id)
    expect(res.node.id).toBe(cloned.id)
    // 两种读法都能拿到同一个 id（旧版 res.id 是 undefined）
    expect(res.id).toBe(res.node.id)
  })

  it('克隆到指定父层后顶层 id 仍是新节点 id', () => {
    const source = makeNode('1:1')
    const cloned = makeNode('1:98')
    source.clone = () => cloned
    const parent = makeContainer('2:1')
    installMgStub({ nodes: { '1:1': source, '2:1': parent } })

    const res = handleCloneNode({ nodeId: '1:1', parentId: '2:1', x: 12, y: 34 })

    expect(res.id).toBe('1:98')
    expect(res.node.parentId).toBe('2:1')
    expect(parent.children[0].id).toBe('1:98')
  })
})

describe('node_convertToComponent：回传新母版 id', () => {
  it('返回体带 componentId（= 转换后母版的 id），并保留裸节点字段', () => {
    const source = makeNode('1:1')
    source.x = 40
    source.y = 50
    const parent = makeContainer('2:1')
    parent.appendChild(source)
    const child = makeNode('1:2', 'RECTANGLE')
    source.children = [child]

    const component = makeContainer('3:7', 'COMPONENT')
    const mg: MgStub = installMgStub({ nodes: { '1:1': source, '2:1': parent } })
    ;(mg as any).createComponent = () => component

    const res = handleConvertToComponent({ nodeId: '1:1' })

    expect(res.componentId).toBe('3:7')
    // 子层真的搬到母版里了（appendChild 生效）
    expect(component.children.map((c: any) => c.id)).toEqual(['1:2'])
    // 母版被挂到原父层，原节点已删除
    expect(parent.children.map((c: any) => c.id)).toEqual(['3:7'])
    expect(source.removed).toBe(true)
    expect(res.id).toBe('3:7')
    expect(res.type).toBe('COMPONENT')
    // 复位几何：母版落在原节点的位置
    expect(res.x).toBe(40)
    expect(res.y).toBe(50)
  })

  it('keepOriginal=true 时保留原节点，componentId 仍回传', () => {
    const source = makeNode('1:1')
    const parent = makeContainer('2:1')
    parent.appendChild(source)
    source.children = []

    const component = makeContainer('3:8', 'COMPONENT')
    const mg: MgStub = installMgStub({ nodes: { '1:1': source, '2:1': parent } })
    ;(mg as any).createComponent = () => component

    const res = handleConvertToComponent({ nodeId: '1:1', keepOriginal: true })

    expect(res.componentId).toBe('3:8')
    expect(source.removed).toBe(false)
    expect(parent.children.map((c: any) => c.id)).toEqual(['1:1', '3:8'])
  })
})

/**
 * 三种形态（nodeId 单个 / nodeIds 批量 / namePrefix 按名建库）
 *
 * `namePrefix` 依赖 `page.findAll`（与真实宿主一致）：测试内最小补充，不改共享桩文件。
 */
function attachFindAll(mg: MgStub, nodes: any[]): void {
  const page = mg.document.currentPage as any
  page.findAll = (predicate: (n: any) => boolean) => (predicate ? nodes.filter(predicate) : nodes.slice())
}

describe('node_convertToComponent：三种形态', () => {
  it('形态 A：name 指定母版名；不传则沿用原节点名', () => {
    const source = makeNode('1:1')
    source.name = 'RawNode'
    const parent = makeContainer('2:1')
    parent.appendChild(source)
    source.children = []
    const component = makeContainer('3:7', 'COMPONENT')
    const mg = installMgStub({ nodes: { '1:1': source, '2:1': parent } })
    ;(mg as any).createComponent = () => component

    const named = handleConvertToComponent({ nodeId: '1:1', name: 'DS / Button' })
    expect(named.componentId).toBe('3:7')
    expect(component.name).toBe('DS / Button')

    // 不传 name 时沿用原节点名
    const plainSource = makeNode('1:2')
    plainSource.name = 'PlainNode'
    const plainParent = makeContainer('2:2')
    plainParent.appendChild(plainSource)
    plainSource.children = []
    const plainComponent = makeContainer('3:9', 'COMPONENT')
    const mg2 = installMgStub({ nodes: { '1:2': plainSource, '2:2': plainParent } })
    ;(mg2 as any).createComponent = () => plainComponent
    handleConvertToComponent({ nodeId: '1:2' })
    expect(plainComponent.name).toBe('PlainNode')
  })

  it('形态 A：已是 COMPONENT 幂等跳过，不抛错', () => {
    const node = makeNode('1:1', 'COMPONENT')
    installMgStub({ nodes: { '1:1': node } })

    const res = handleConvertToComponent({ nodeId: '1:1' })
    expect(res.converted).toBe(false)
    expect(res.skipped[0]).toMatchObject({ nodeId: '1:1', reason: 'already-component' })
    expect(node.removed).toBe(false)
  })

  it('形态 B：nodeIds 批量逐个转，各自保留自己的名字', () => {
    const a = makeNode('1:1')
    a.name = 'CardA'
    const b = makeNode('1:2')
    b.name = 'CardB'
    const parent = makeContainer('2:1')
    parent.appendChild(a)
    parent.appendChild(b)
    a.children = []
    b.children = []
    const compA = makeContainer('3:1', 'COMPONENT')
    const compB = makeContainer('3:2', 'COMPONENT')
    let call = 0
    const mg = installMgStub({ nodes: { '1:1': a, '1:2': b, '2:1': parent } })
    ;(mg as any).createComponent = () => (call++ === 0 ? compA : compB)

    const res = handleConvertToComponent({ nodeIds: ['1:1', '1:2'] })
    expect(res.success).toBe(true)
    expect(res.count).toBe(2)
    expect(res.components.map((c: any) => c.componentId)).toEqual(['3:1', '3:2'])
    expect(compA.name).toBe('CardA')
    expect(compB.name).toBe('CardB')
    expect(res.skipped).toEqual([])
  })

  it('形态 B：批量时传共用 name 被忽略并回 notes（不静默）', () => {
    const a = makeNode('1:1')
    a.name = 'KeepA'
    const b = makeNode('1:2')
    b.name = 'KeepB'
    const parent = makeContainer('2:1')
    parent.appendChild(a)
    parent.appendChild(b)
    a.children = []
    b.children = []
    const compA = makeContainer('3:1', 'COMPONENT')
    const compB = makeContainer('3:2', 'COMPONENT')
    let call = 0
    const mg = installMgStub({ nodes: { '1:1': a, '1:2': b, '2:1': parent } })
    ;(mg as any).createComponent = () => (call++ === 0 ? compA : compB)

    const res = handleConvertToComponent({ nodeIds: ['1:1', '1:2'], name: 'Shared' })
    expect(res.notes?.[0]).toMatch(/忽略 name/)
    expect(compA.name).toBe('KeepA')
    expect(compB.name).toBe('KeepB')
  })

  it('形态 C：namePrefix 只取最外层，跳过已是 COMPONENT', () => {
    const outer = makeContainer('1:1', 'FRAME')
    outer.name = 'DS_Card'
    const inner = makeNode('1:2', 'TEXT')
    inner.name = 'DS_Inner' // 匹配前缀，但祖先是匹配节点 → 必须被丢弃
    outer.appendChild(inner)
    const already = makeNode('1:3', 'COMPONENT')
    already.name = 'DS_Existing'
    const other = makeNode('1:4', 'FRAME')
    other.name = 'Other'
    const component = makeContainer('9:1', 'COMPONENT')
    const mg = installMgStub({ nodes: { '1:1': outer, '1:2': inner, '1:3': already, '1:4': other } })
    attachFindAll(mg, [outer, inner, already, other])
    ;(mg as any).createComponent = () => component

    const res = handleConvertToComponent({ namePrefix: 'DS_' })
    // matched = 最外层候选（DS_Card + DS_Existing）；DS_Inner 被剪枝、Other 不匹配
    expect(res.matched).toBe(2)
    expect(res.count).toBe(1)
    expect(res.namePrefix).toBe('DS_')
    expect(component.name).toBe('DS_Card')
    expect(inner.removed).toBe(false) // 子层未被单独转换
    expect(res.skipped.map((s: any) => s.nodeId)).toEqual(['1:3'])
  })

  it('形态 C：keepOriginal 语义与形态 A 一致', () => {
    const outer = makeContainer('1:1', 'FRAME')
    outer.name = 'DS_Keep'
    const component = makeContainer('9:2', 'COMPONENT')
    const mg = installMgStub({ nodes: { '1:1': outer } })
    attachFindAll(mg, [outer])
    ;(mg as any).createComponent = () => component

    const res = handleConvertToComponent({ namePrefix: 'DS_', keepOriginal: true })
    expect(res.count).toBe(1)
    expect(outer.removed).toBe(false)
  })
})
