import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installMgStub, resetMgStub, type MgStub } from './helpers/mg-stub'
import { handleSearchFind } from '../lib/api/utilHandlers'

/**
 * `handleSearchFind` 的选区副作用与形状容忍（端到端）测试
 *
 * 三个真实踩坑：① `name` 传字符串被整段跳过 → 返回全页 270 个节点；
 * ② `colors` 传字符串 → 崩在 `hexToRgb(undefined)`；③ `maxSize: 55` 被静默忽略。
 * 另有第四个问题：**无条件**把命中节点设为选区 → 用户选区被带偏、视口跟着跳。
 *
 * 注：`tests/helpers/mg-stub.ts` 由另一个 agent 维护，这里用**测试内最小补充**的方式
 * 给 page 挂 `findAll`（与真实宿主一致：返回过滤后的节点数组），不改共享桩文件。
 */
function attachFindAll(mg: MgStub, nodes: any[]): void {
  const page = mg.document.currentPage as any
  page.findAll = (predicate: (n: any) => boolean) => (predicate ? nodes.filter(predicate) : nodes.slice())
}

const frame = (id: string, name: string, extra: Record<string, any> = {}) => ({
  id,
  name,
  type: 'FRAME',
  width: 120,
  height: 120,
  removed: false,
  parent: { id: 'page:1' },
  ...extra,
})

/** #4A6CF7 → { r, g, b, a }（MasterGo 的 SOLID fill 用 0-1 浮点） */
const BLUE = { r: 0x4a / 255, g: 0x6c / 255, b: 0xf7 / 255, a: 1 }

const nodes = [
  frame('1:1', '绑定说明', { fills: [{ type: 'SOLID', color: BLUE }] }),
  frame('1:2', '按钮', { width: 40, height: 40, fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }] }),
  { id: '1:3', name: '说明', type: 'TEXT', width: 200, height: 240, removed: false, parent: { id: 'page:1' } },
]

let mg: MgStub

beforeEach(() => {
  mg = installMgStub({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), selection: [nodes[2]] })
  attachFindAll(mg, nodes)
})

afterEach(() => resetMgStub())

describe('search_nodes — 选区副作用开关', () => {
  it('select:false 时完全不碰用户选区（连赋值都没有）', () => {
    const before = mg.document.currentPage.selection
    const out = handleSearchFind({ types: 'FRAME', select: false })

    expect(out.count).toBe(2) // 过滤照常生效
    expect(mg.document.currentPage.selection).toBe(before) // 同一个数组实例 = 没被改写
    expect(mg.document.currentPage.selection.map((n: any) => n.id)).toEqual(['1:3'])
    expect(out).toMatchObject({ selected: 0, selectionUntouched: true })
  })

  it('select:false 且零命中时也不碰选区', () => {
    const before = mg.document.currentPage.selection
    const out = handleSearchFind({ name: '不存在的层', select: false })
    expect(out).toMatchObject({ count: 0, selected: 0, selectionUntouched: true })
    expect(mg.document.currentPage.selection).toBe(before)
  })

  it('默认（不传 select）时命中节点被设为选区，并在响应里回显', () => {
    const out = handleSearchFind({ name: '绑定说明' })
    expect(out.count).toBe(1)
    expect(out).toMatchObject({ selected: 1, selectionUntouched: false })
    expect(mg.document.currentPage.selection.map((n: any) => n.id)).toEqual(out.nodeIds)
    expect(mg.document.currentPage.selection.map((n: any) => n.id)).toEqual(['1:1'])
  })

  it('默认但零命中时不改写选区（不改就是不改，不能"改成空"）', () => {
    const before = mg.document.currentPage.selection
    const out = handleSearchFind({ name: '不存在的层' })
    expect(out.count).toBe(0)
    // 零命中时没有可写的内容，选区保持不变（不主动清空用户选区）
    expect(mg.document.currentPage.selection).toBe(before)
    expect(out).toMatchObject({ selected: 0, selectionUntouched: true })
  })
})

describe('search_nodes — 字符串/数字简写真的生效', () => {
  it('name 传字符串 → 真的按包含匹配过滤（3 个节点只命中 1 个，而不是返回全量）', () => {
    const out = handleSearchFind({ name: '绑定说明', select: false })
    expect(out.count).toBe(1)
    expect(out.nodeIds).toEqual(['1:1'])
    expect(out.nodes[0]).toMatchObject({ id: '1:1', name: '绑定说明', type: 'FRAME' })
  })

  it('colors 传字符串 → 不崩且能按填充色筛出节点', () => {
    const out = handleSearchFind({ colors: '#4A6CF7', select: false })
    expect(out.nodeIds).toEqual(['1:1'])
  })

  it('maxSize 传数字 → 按宽高上限筛出节点（旧实现静默忽略）', () => {
    const out = handleSearchFind({ maxSize: 50, select: false })
    expect(out.nodeIds).toEqual(['1:2'])
  })

  it('minSize 传数字 → 按宽高下限筛出节点', () => {
    const out = handleSearchFind({ minSize: 200, select: false })
    expect(out.nodeIds).toEqual(['1:3'])
  })

  it('types 传字符串 + name 传字符串 → 组合过滤仍生效', () => {
    const out = handleSearchFind({ types: 'TEXT', name: '说明', select: false })
    expect(out.nodeIds).toEqual(['1:3'])
  })

  it('先过滤再 limit：count / nodeIds 都是截断后的', () => {
    const out = handleSearchFind({ types: 'FRAME', limit: 1, select: false })
    expect(out.count).toBe(1)
    expect(out.nodeIds).toEqual(['1:1'])
  })

  it('形状不认识 → 抛错而不是静默返回全量', () => {
    expect(() => handleSearchFind({ name: 123 })).toThrow(/name/)
    expect(() => handleSearchFind({ colors: [{ type: 'fill' }] })).toThrow(/colors/)
    expect(() => handleSearchFind({ maxSize: '50', select: false })).toThrow(/maxSize/)
  })
})

describe('search_nodes — 响应形状保持兼容', () => {
  it('count / nodeIds / nodes / effects 回显都在', () => {
    mg = installMgStub({
      nodes: {
        '2:1': frame('2:1', '带阴影', { effects: [{ type: 'DROP_SHADOW', visible: true }] }),
      },
      selection: [],
    })
    attachFindAll(mg, [mg.getNodeById('2:1')])

    const out = handleSearchFind({ hasShadow: true, select: false })
    expect(out).toMatchObject({ count: 1, selected: 0, selectionUntouched: true })
    expect(out.nodeIds).toEqual(['2:1'])
    expect(out.nodes[0]).toMatchObject({ id: '2:1', name: '带阴影', type: 'FRAME' })
    expect(out.nodes[0].effects).toBeDefined()
  })
})
