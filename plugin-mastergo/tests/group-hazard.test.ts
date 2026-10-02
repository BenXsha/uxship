import { describe, it, expect, afterEach } from 'vitest'
import { installMgStub, resetMgStub, type MgStub } from './helpers/mg-stub'
import {
  handleCreateNode,
  handleBatchCreateNodes,
  handleUpdateNode,
  handleBatchUpdateNodes,
} from '../lib/api/nodeHandlers'

/**
 * GROUP 护栏门禁（warn + 继续，不阻断）
 *
 * 2026-09 真实踩坑：
 * - 在 GROUP 内新建节点会立刻炸开该组（实测 80×14 → 6135×1472）；
 * - 对 GROUP 的子层写 width/height/x/y 会触发组级等比缩放（16×16 图标被拉成 18.63×18）。
 *
 * 这是宿主既有行为、不是参数错误，所以只告警不阻断；但**必须**走响应 warnings 通道，
 * 且非 GROUP 场景一条都不许报（防误报）。
 */

let seq = 0

function makeNode(type = 'RECTANGLE'): any {
  seq += 1
  return {
    id: `${type.toLowerCase()}-${seq}`,
    name: `${type}${seq}`,
    type,
    removed: false,
    isVisible: true,
    isLocked: false,
    x: 0,
    y: 0,
    width: 16,
    height: 16,
    rotation: 0,
    opacity: 1,
    fills: [],
    strokes: [],
    effects: [],
  }
}

/** 能真正收子节点的容器（appendChild 写入 children + 反向 parent） */
function makeContainer(type = 'FRAME'): any {
  const container: any = Object.assign(makeNode(type), {
    children: [],
    appendChild(child: any) {
      container.children = container.children.filter((c: any) => c !== child)
      container.children.push(child)
      child.parent = container
    },
  })
  return container
}

/** 注入 create* 工厂（桩默认不提供节点构造器） */
function installCreators(mg: MgStub): void {
  const anyMg = mg as any
  anyMg.createFrame = () => makeNode('FRAME')
  anyMg.createComponent = () => makeNode('COMPONENT')
  anyMg.createRectangle = () => makeNode('RECTANGLE')
  anyMg.createEllipse = () => makeNode('ELLIPSE')
  anyMg.createText = () => Object.assign(makeNode('TEXT'), { characters: '' })
}

afterEach(() => {
  resetMgStub()
})

describe('node_create：在 GROUP 内建节点', () => {
  it('父层是 GROUP：响应里出现 GROUP 相关 warning', () => {
    const group = makeContainer('GROUP')
    const mg = installMgStub({ nodes: { '3:1': group } })
    installCreators(mg)

    const res = handleCreateNode({ type: 'frame', properties: { x: 1, y: 2 }, parentId: '3:1' })

    expect(res.warnings).toBeDefined()
    expect(res.warnings[0]).toContain('GROUP')
    expect(res.warnings[0]).toContain('组边界会被炸开')
    // warn + 继续：节点照样建出来了
    expect(group.children).toHaveLength(1)
  })

  it('父层是 FRAME：不产生 GROUP warning（防误报）', () => {
    const frame = makeContainer('FRAME')
    const mg = installMgStub({ nodes: { '2:1': frame } })
    installCreators(mg)

    const res = handleCreateNode({ type: 'frame', properties: { x: 1, y: 2 }, parentId: '2:1' })

    expect(res.warnings).toBeUndefined()
    expect(frame.children).toHaveLength(1)
  })

  it('不带 parentId（落到页面）：不产生 GROUP warning', () => {
    const mg = installMgStub({})
    installCreators(mg)

    const res = handleCreateNode({ type: 'frame', properties: { x: 1, y: 2 } })

    expect(res.warnings).toBeUndefined()
  })
})

describe('node_batchCreate：GROUP 内建节点逐项告警', () => {
  it('建到 GROUP 的那一条带 warning，建到 FRAME 的那一条不带', () => {
    const group = makeContainer('GROUP')
    const frame = makeContainer('FRAME')
    const mg = installMgStub({ nodes: { '3:1': group, '2:1': frame } })
    installCreators(mg)

    const res = handleBatchCreateNodes({
      nodes: [
        { type: 'frame', properties: { x: 1 }, parentId: '3:1' },
        { type: 'frame', properties: { x: 1 }, parentId: '2:1' },
      ],
    })

    expect(res.created).toBe(2)
    expect(res.results[0].warnings[0]).toContain('GROUP')
    expect(res.results[1].warnings).toBeUndefined()
  })
})

describe('node_update / node_batchUpdate：GROUP 子层改几何', () => {
  it('对 GROUP 直接子层写 width：warning 提示组级等比缩放', () => {
    const group = makeContainer('GROUP')
    const icon = makeNode('RECTANGLE')
    group.appendChild(icon)
    installMgStub({ nodes: { '3:1': group, '1:1': icon } })

    const res = handleUpdateNode({ nodeId: '1:1', properties: { width: 18 } })

    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toContain('GROUP')
    expect(res.warnings[0]).toContain('等比缩放')
    // warn + 继续：值照样写进去了
    expect(icon.width).toBe(18)
  })

  it('对 GROUP 直接子层写 x/y/height/rotation 同样告警', () => {
    const group = makeContainer('GROUP')
    const icon = makeNode('RECTANGLE')
    group.appendChild(icon)
    installMgStub({ nodes: { '3:1': group, '1:1': icon } })

    for (const props of [{ x: 1 }, { y: 2 }, { height: 3 }, { rotation: 45 }]) {
      const res = handleUpdateNode({ nodeId: '1:1', properties: props })
      expect(res.warnings?.[0]).toContain('GROUP')
    }
  })

  it('只改非几何属性（fills/name）：不产生 GROUP warning', () => {
    const group = makeContainer('GROUP')
    const icon = makeNode('RECTANGLE')
    group.appendChild(icon)
    installMgStub({ nodes: { '3:1': group, '1:1': icon } })

    const res = handleUpdateNode({ nodeId: '1:1', properties: { name: '改了名字' } })
    expect(res.warnings).toBeUndefined()
    expect(icon.name).toBe('改了名字')
  })

  it('FRAME 的子层改几何：不产生 GROUP warning', () => {
    const frame = makeContainer('FRAME')
    const child = makeNode('RECTANGLE')
    frame.appendChild(child)
    installMgStub({ nodes: { '2:1': frame, '1:1': child } })

    const res = handleUpdateNode({ nodeId: '1:1', properties: { width: 18 } })
    expect(res.warnings).toBeUndefined()
  })

  it('batchUpdate：只给命中 GROUP 的那条挂 warning，后续项不受影响', () => {
    const group = makeContainer('GROUP')
    const inGroup = makeNode('RECTANGLE')
    const inFrame = makeNode('RECTANGLE')
    group.appendChild(inGroup)
    installMgStub({ nodes: { '3:1': group, '1:1': inGroup, '1:2': inFrame } })

    const res = handleBatchUpdateNodes({
      updates: [
        { nodeId: '1:1', properties: { height: 20 } },
        { nodeId: '1:2', properties: { height: 20 } },
      ],
    })

    expect(res.success).toBe(true)
    expect(res.results[0].warnings[0]).toContain('GROUP')
    expect(res.results[1].warnings).toBeUndefined()
    expect(inFrame.height).toBe(20)
  })
})
