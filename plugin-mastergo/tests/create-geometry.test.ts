import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installMgStub, resetMgStub, type MgStub } from './helpers/mg-stub'
import { handleCreateNode, handleBatchCreateNodes, handleCloneNode } from '../lib/api/nodeHandlers'

/**
 * 「插入后二次应用几何」门禁
 *
 * 2026-09 真实踩坑：`node_create` 在 `appendChild()` **之前**写 x/y，宿主插入父层时按父层
 * （尤其自动布局）重算几何 → instance 落到 y≈-5000、frame 落 (0,0)。
 *
 * 桩的 `resetGeometryOnAppend: true` 模拟宿主这个行为：appendChild 后把子节点 x/y 归零。
 * 我们断言「插入之后再写」仍然落点正确。
 */

let seq = 0

/** 造一个形状接近宿主、字段名与运行时一致的节点 */
function makeNode(type: string): any {
  seq += 1
  const node: any = {
    id: `${type.toLowerCase()}-${seq}`,
    name: type,
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
  if (type === 'FRAME' || type === 'COMPONENT' || type === 'INSTANCE') {
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
  return node
}

/** 造一个能真正收子节点的容器（appendChild 写入 children + parent） */
function makeContainer(type = 'FRAME', extra: Record<string, any> = {}): any {
  const container = Object.assign(makeNode(type), {
    children: [],
    appendChild(child: any) {
      container.children.push(child)
      child.parent = container
    },
  }, extra)
  return container
}

/** 注入 create* 工厂（stub 默认不提供节点构造器） */
function installCreators(mg: MgStub): void {
  const anyMg = mg as any
  anyMg.createFrame = () => makeNode('FRAME')
  anyMg.createComponent = () => makeNode('COMPONENT')
  anyMg.createRectangle = () => makeNode('RECTANGLE')
  anyMg.createEllipse = () => makeNode('ELLIPSE')
  anyMg.createText = () => Object.assign(makeNode('TEXT'), { characters: '' })
}

beforeEach(() => {
  seq = 0
})

afterEach(() => {
  resetMgStub()
})

describe('node_create：插入后二次应用几何', () => {
  it('带 parentId 建 frame：appendChild 重置 x/y 之后仍落在 (100,200)', () => {
    const parent = makeContainer()
    const mg = installMgStub({ nodes: { '2:2': parent }, resetGeometryOnAppend: true })
    installCreators(mg)

    const res = handleCreateNode({ type: 'frame', properties: { x: 100, y: 200 }, parentId: '2:2' })

    expect(res.x).toBe(100)
    expect(res.y).toBe(200)
    expect(parent.children).toHaveLength(1)
    expect(parent.children[0].x).toBe(100)
    expect(parent.children[0].y).toBe(200)
  })

  it('不带 parentId 建 frame：坐标同样正确', () => {
    const mg = installMgStub({ resetGeometryOnAppend: true })
    installCreators(mg)

    const res = handleCreateNode({ type: 'frame', properties: { x: 10, y: 20 } })

    expect(res.x).toBe(10)
    expect(res.y).toBe(20)
  })

  it('几何子集之外的属性不受二次应用影响（fills 仍然写进）', () => {
    const parent = makeContainer()
    const mg = installMgStub({ nodes: { '2:2': parent }, resetGeometryOnAppend: true })
    installCreators(mg)

    const res = handleCreateNode({
      type: 'frame',
      properties: { x: 5, y: 6, fills: [{ type: 'SOLID', color: '#ff0000' }] },
      parentId: '2:2',
    })

    expect(res.x).toBe(5)
    expect(res.fills).toHaveLength(1)
  })

  it('instance：插入父层后被重置的 x/y 也会被二次写回', () => {
    const instanceHolder: any = { type: 'INSTANCE' }
    const component = makeContainer('COMPONENT', {
      createInstance: () => Object.assign(makeNode('INSTANCE'), { masterComponent: instanceHolder }),
    })
    const parent = makeContainer()
    const mg = installMgStub({ nodes: { '1:1': component, '2:2': parent }, resetGeometryOnAppend: true })
    installCreators(mg)

    const res = handleCreateNode({
      type: 'instance',
      properties: { componentId: '1:1', x: 33, y: 44 },
      parentId: '2:2',
    })

    expect(res.x).toBe(33)
    expect(res.y).toBe(44)
  })

  it('rotation 也属于插入后二次应用的几何属性', () => {
    const parent = makeContainer()
    const mg = installMgStub({ nodes: { '2:2': parent }, resetGeometryOnAppend: true })
    installCreators(mg)

    const res = handleCreateNode({ type: 'frame', properties: { x: 1, y: 2, rotation: 45 }, parentId: '2:2' })

    expect(res.rotation).toBe(45)
  })

  it('归一化 warning（layoutMode → flexMode）能出现在响应 warnings 里，且不重复', () => {
    const parent = makeContainer()
    const mg = installMgStub({ nodes: { '2:2': parent }, resetGeometryOnAppend: true })
    installCreators(mg)

    const res = handleCreateNode({
      type: 'frame',
      properties: { x: 1, y: 2, layoutMode: 'HORIZONTAL' },
      parentId: '2:2',
    })

    expect(res.flexMode).toBe('HORIZONTAL')
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toContain('flexMode')
  })
})

describe('node_batchCreate：插入后二次应用几何 + parentId 生效', () => {
  it('批量建 frame 且指定 parentId：插入父层、坐标正确', () => {
    const parent = makeContainer()
    const mg = installMgStub({ nodes: { '2:2': parent }, resetGeometryOnAppend: true })
    installCreators(mg)

    const res = handleBatchCreateNodes({
      nodes: [{ type: 'frame', properties: { x: 7, y: 8 }, parentId: '2:2' }],
    })

    expect(res.created).toBe(1)
    expect(res.results[0].node.x).toBe(7)
    expect(res.results[0].node.y).toBe(8)
    // parentId 确实生效（此前怀疑被忽略，实测代码是处理的）
    expect(parent.children).toHaveLength(1)
    expect(parent.children[0].id).toBe(res.results[0].node.id)
  })

  it('批量建节点不带 parentId：坐标正确', () => {
    const mg = installMgStub({ resetGeometryOnAppend: true })
    installCreators(mg)

    const res = handleBatchCreateNodes({ nodes: [{ type: 'frame', properties: { x: 3, y: 4 } }] })

    expect(res.results[0].node.x).toBe(3)
    expect(res.results[0].node.y).toBe(4)
  })
})

describe('node_clone：x/y 写在 appendChild 之后', () => {
  it('克隆到指定父层（会重置几何）后落点正确', () => {
    const source = makeNode('FRAME')
    source.clone = () => makeNode('FRAME')
    const parent = makeContainer()
    const mg = installMgStub({ nodes: { '1:1': source, '2:2': parent }, resetGeometryOnAppend: true })
    installCreators(mg)

    const res = handleCloneNode({ nodeId: '1:1', parentId: '2:2', x: 66, y: 77 })

    expect(res.node.x).toBe(66)
    expect(res.node.y).toBe(77)
    expect(parent.children).toHaveLength(1)
  })

  it('不传 x/y 时不强行改坐标（保留宿主插入结果）', () => {
    const source = makeNode('FRAME')
    source.clone = () => makeNode('FRAME')
    const mg = installMgStub({ nodes: { '1:1': source }, resetGeometryOnAppend: true })
    installCreators(mg)

    const res = handleCloneNode({ nodeId: '1:1' })

    expect(res.node.x).toBe(0)
    expect(res.node.y).toBe(0)
  })

  it('重命名与落点同时生效', () => {
    const source = makeNode('FRAME')
    source.clone = () => makeNode('FRAME')
    const mg = installMgStub({ nodes: { '1:1': source }, resetGeometryOnAppend: true })
    installCreators(mg)

    const res = handleCloneNode({ nodeId: '1:1', x: 9, y: 9, name: '副本' })

    expect(res.node.name).toBe('副本')
    expect(res.node.x).toBe(9)
    expect(res.node.y).toBe(9)
  })
})
