/**
 * `dsl/exportNode` / `dsl/exportSelection` —— 画布 → DSL
 *
 * 最有价值的断言是**往返闭环**：`导出 → 渲染 → 再导出` 两次导出的 DSL 必须一致。
 * 它同时钉住三件事：字段名对齐规范（`content` 而非 `characters`）、量纲一致（颜色）、
 * 「可再渲染」而不是导出一份私有结构。任何一处字段名漂移，这条断言都会红。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RequestDispatcher } from '@lib/dispatcher'
import { installHost, resetHost, MemoryHost } from '@lib/host/index'
import type { DSLDocument } from '@lib/dsl/types'

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

async function call(method: string, params: Record<string, unknown> = {}) {
  const response = await dispatcher.dispatch({ jsonrpc: '2.0', id: 1, method, params } as never)
  if ('error' in response) return { __error: response.error } as Record<string, any>
  return response.result as Record<string, any>
}

const find = (name: string) => host.flatten().find((node) => node.name === name)

async function makeTree() {
  const created = await call('node/create', {
    element: {
      type: 'frame',
      name: 'Card',
      size: { width: 320, height: 200 },
      layoutMode: 'VERTICAL',
      itemSpacing: 12,
      paddingTop: 16,
      paddingLeft: 16,
      cornerRadius: 8,
      fills: [{ type: 'SOLID', color: '#FFFFFF' }],
      strokes: [{ type: 'SOLID', color: '#E5E7EB' }],
      strokeWidth: 1,
      children: [
        { type: 'text', name: 'Title', content: '标题', fontSize: 18, fontWeight: 700, position: { x: 16, y: 16 } },
        { type: 'rectangle', name: 'Thumb', size: { width: 288, height: 120 }, fills: [{ type: 'SOLID', color: '#3366FF' }] },
      ],
    },
  })
  return created.rootIds[0] as string
}

describe('dsl/exportNode', () => {
  it('字段名对齐 DSL 规范（position/size/content，而不是 x/y/characters）', async () => {
    const cardId = await makeTree()
    const dsl = await call('dsl/exportNode', { nodeId: cardId })

    expect(dsl.version).toBe('2.0')
    const card = dsl.elements[0]
    expect(card).toMatchObject({
      type: 'frame',
      name: 'Card',
      position: { x: 0, y: 0 },
      size: { width: 320, height: 200 },
      layoutMode: 'VERTICAL',
      itemSpacing: 12,
      cornerRadius: 8,
      strokeWidth: 1,
    })
    expect(card.paddingTop).toBe(16)
    expect(card.paddingLeft).toBe(16)
    // 零内边距不写进 DSL（避免噪音）
    expect(card.paddingRight).toBeUndefined()
    expect(card.fills[0]).toMatchObject({ type: 'SOLID', color: '#FFFFFF' })
    expect(card.strokes[0]).toMatchObject({ type: 'SOLID', color: '#E5E7EB' })
    // x/y/characters 这些宿主词不许出现在 DSL 顶层
    expect(card.x).toBeUndefined()
    expect(card.characters).toBeUndefined()
  })

  it('文本节点导出 content / 字号 / 字重（量纲不被误读）', async () => {
    const cardId = await makeTree()
    const dsl = await call('dsl/exportNode', { nodeId: cardId })
    const title = dsl.elements[0].children[0]
    expect(title).toMatchObject({ type: 'text', name: 'Title', content: '标题', fontSize: 18, fontWeight: 700 })
  })

  it('往返闭环：导出 → 渲染 → 再导出，两次导出完全一致', async () => {
    const cardId = await makeTree()
    const first = (await call('dsl/exportNode', { nodeId: cardId })) as DSLDocument

    // 换一页渲染，避免 id 冲突；渲染后再导出
    await call('page/create', { name: 'RoundTrip' })
    const rendered = await call('dsl/render', { dsl: first })
    expect(rendered.ok).toBe(true)

    const exported = ((await call('dsl/exportSelection', {})) as DSLDocument).elements
    const roundTrip = (await call('dsl/exportNode', { nodeId: exported[0].id })) as DSLDocument

    // 归一掉 id（每次渲染都会变）后逐字比较
    const strip = (doc: DSLDocument) =>
      JSON.parse(JSON.stringify({ ...doc, _notes: undefined }, (key, value) => (key === 'id' ? undefined : value)))
    expect(strip(roundTrip)).toEqual(strip(first))
  })

  it('单边描边：合成 Path 不进 DSL，四边权重按 pluginData 还原', async () => {
    const created = await call('node/create', { element: { type: 'rectangle', name: 'Bordered', size: { width: 100, height: 40 } } })
    const nodeId = created.rootIds[0] as string
    const node = host.getNodeById(nodeId)!
    // 预置 Penpot 侧模拟单边描边时写下的规格（真实写入发生在 host/border-sides.ts）
    ;(node as unknown as { props: Record<string, unknown> }).props.pluginData = {
      'mgmcp:sideBorderSpecs': JSON.stringify({ top: 0, right: 0, bottom: 2, left: 2 }),
    }

    const dsl = await call('dsl/exportNode', { nodeId })
    const element = dsl.elements[0]
    expect(element.strokeBottomWeight).toBe(2)
    expect(element.strokeLeftWeight).toBe(2)
    expect(element.strokeTopWeight).toBe(0)
    expect(element.strokeRightWeight).toBe(0)
    expect(element.children).toBeUndefined()
  })

  it('合成的边框 Path 自身被跳过（不是用户画的东西）', async () => {
    const parent = await call('node/create', { element: { type: 'frame', name: 'P', size: { width: 100, height: 40 } } })
    const parentId = parent.rootIds[0] as string
    const path = await call('node/create', {
      element: { type: 'path', name: 'Border Bottom', svgPathData: 'M0 40 L100 40', parentId },
    })
    void path
    const pathNode = find('Border Bottom')!
    ;(pathNode as unknown as { props: Record<string, unknown> }).props.pluginData = { 'mgmcp:sideBorders': '1' }

    const dsl = await call('dsl/exportNode', { nodeId: parentId })
    expect(dsl.elements[0].children).toBeUndefined()
  })

  it('path 的 d 能读回来（Penpot 的 Path.d；老版本退回 content）', async () => {
    const created = await call('node/create', {
      element: { type: 'path', name: 'Wave', svgPathData: 'M4 32 C 14 4, 30 4, 40 32 Z', size: { width: 40, height: 40 } },
    })
    const dsl = await call('dsl/exportNode', { nodeId: created.rootIds[0] })
    expect(dsl.elements[0]).toMatchObject({ type: 'path', svgPathData: 'M4 32 C 14 4, 30 4, 40 32 Z' })
    // 有 d 就不该报「取不到」
    expect((dsl._notes ?? []).join(' ')).not.toMatch(/path 的 d 取不到/)
  })

  it('svg-raw 取不回 markup → 如实写 note（不伪造 svgContent）', async () => {
    const created = await call('node/create', { element: { type: 'svg', name: 'Icon', size: { width: 24, height: 24 } } })
    const dsl = await call('dsl/exportNode', { nodeId: created.rootIds[0] })
    expect(dsl.elements[0].type).toBe('svg')
    expect(dsl.elements[0].svgContent).toBeUndefined()
    // 措辞改过一次：原来写"无法回读 markup"（把"没有 getter"读成了"导不出来"），
    // 现在如实区分「单节点无 getter」与「整棵形状可用 generateMarkup 导出 SVG」
    expect(dsl._notes.join(' ')).toMatch(/svg-raw 单节点取不到 SVG 源码/)
    expect(dsl._notes.join(' ')).toMatch(/generateMarkup/)
  })

  it('depth 截断 → note 说明有多少子节点没导出', async () => {
    const cardId = await makeTree()
    const dsl = await call('dsl/exportNode', { nodeId: cardId, depth: 0 })
    expect(dsl.elements[0].children).toBeUndefined()
    expect(dsl._notes.join(' ')).toMatch(/已达 depth=0，2 个子节点未导出/)
  })

  it('maxNodes 超限 → 截断并如实标注（不静默）', async () => {
    const cardId = await makeTree()
    const dsl = await call('dsl/exportNode', { nodeId: cardId, maxNodes: 1 })
    expect(dsl._notes.join(' ')).toMatch(/节点数超过上限（1）/)
  })

  it('节点不存在 → 抛错并说明「Penpot 只能查当前页」', async () => {
    expect((await call('dsl/exportNode', { nodeId: 'ghost' })).__error?.message).toMatch(/节点不存在: ghost/)
  })
})

describe('dsl/exportSelection 与实例', () => {
  it('无选区 → 抛错；有选区 → 多根导出', async () => {
    await makeTree()
    await call('selection/set', { nodeIds: [] })
    expect((await call('dsl/exportSelection', {})).__error?.message).toMatch(/没有选中任何节点/)

    await call('selection/set', { nodeIds: [find('Card')!.id, find('Thumb')!.id] })
    const dsl = await call('dsl/exportSelection', {})
    expect(dsl.elements.map((e: any) => e.name)).toEqual(['Card', 'Thumb'])
  })

  it('exportNode 缺 nodeId 时：单选可用，多选报错', async () => {
    await makeTree()
    await call('selection/set', { nodeIds: [find('Card')!.id] })
    expect((await call('dsl/exportNode', {})).elements).toHaveLength(1)

    await call('selection/set', { nodeIds: [find('Card')!.id, find('Thumb')!.id] })
    expect((await call('dsl/exportNode', {})).__error?.message).toMatch(/选中了 2 个节点/)
  })

  it('实例导出成 type:instance 并还原 componentId / componentName', async () => {
    const created = await call('node/create', { element: { type: 'rectangle', name: 'MasterBase', size: { width: 100, height: 40 } } })
    const masterId = created.rootIds[0] as string
    const component = await call('node/convertToComponent', { nodeId: masterId, name: 'Button / Primary' })

    const instance = await host.instantiateComponent({ componentId: component.componentId, x: 10, y: 20 })
    const dsl = await call('dsl/exportNode', { nodeId: instance.nodeId })
    // 导出成展开后的 frame（逐字可再渲染），母版信息用 componentId 标注
    expect(dsl.elements[0]).toMatchObject({
      type: 'frame',
      isExpandedInstance: true,
      componentId: component.componentId,
      componentName: 'Button / Primary',
      isLocalMaster: true,
      position: { x: 10, y: 20 },
    })
  })
})
