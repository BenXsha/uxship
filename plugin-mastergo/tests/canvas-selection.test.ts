import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installMgStub, resetMgStub, type MgStub } from './helpers/mg-stub'
import { resolveNodes, handleSetSelection } from '../lib/api/canvasHandlers'

/**
 * 画布聚焦/选区的节点解析与选区设置测试（`mg` 全局桩）
 *
 * `resolveNodes` 是 `canvas_zoom_to_node` / `selection_set` / `node_swap_component`
 * 共用的目标解析入口：显式 ID 优先、去重、缺 ID 回报、无 ID 回退当前选区。
 * 解析错了会静默操作错对象，所以这里把语义锁死。
 */
const node = (id: string, name = id) => ({ id, name, type: 'FRAME', removed: false, parent: { id: 'page:1' } })

let mg: MgStub

beforeEach(() => {
  mg = installMgStub({
    nodes: {
      '1:1': node('1:1', 'A'),
      '1:2': node('1:2', 'B'),
      '1:3': node('1:3', 'C'),
    },
    selection: [node('1:3', 'C')],
  })
})

afterEach(() => resetMgStub())

describe('resolveNodes', () => {
  it('按 ID 解析并保持顺序', () => {
    const { nodes, missing } = resolveNodes({ nodeIds: ['1:2', '1:1'] })
    expect(nodes.map((n: any) => n.id)).toEqual(['1:2', '1:1'])
    expect(missing).toEqual([])
  })

  it('nodeId 与 nodeIds 合并且去重', () => {
    const { nodes } = resolveNodes({ nodeId: '1:1', nodeIds: ['1:1', '1:2'] })
    expect(nodes.map((n: any) => n.id)).toEqual(['1:1', '1:2'])
  })

  it('不存在的 ID 只进 missing，不抛异常', () => {
    const { nodes, missing } = resolveNodes({ nodeIds: ['1:1', 'nope'] })
    expect(nodes.map((n: any) => n.id)).toEqual(['1:1'])
    expect(missing).toEqual(['nope'])
  })

  it('未传 ID 时回退当前选区', () => {
    const { nodes } = resolveNodes({})
    expect(nodes.map((n: any) => n.id)).toEqual(['1:3'])
  })

  it('useSelection:false 时不回退选区', () => {
    const { nodes } = resolveNodes({ useSelection: false })
    expect(nodes).toEqual([])
  })
})

describe('handleSetSelection', () => {
  it('replace：整体替换选区', () => {
    const out = handleSetSelection({ nodeIds: ['1:1', '1:2'] })
    expect(out).toMatchObject({ success: true, mode: 'replace', selectedCount: 2 })
    expect(out.selectedNodeIds).toEqual(['1:1', '1:2'])
  })

  it('add：追加到现有选区并去重', () => {
    const out = handleSetSelection({ nodeIds: ['1:3', '1:1'], addToSelection: true })
    expect(out.mode).toBe('add')
    expect(out.selectedNodeIds.sort()).toEqual(['1:1', '1:3'])
  })

  it('传空数组即清空选区', () => {
    const out = handleSetSelection({ nodeIds: [] })
    expect(out).toMatchObject({ selectedCount: 0, mode: 'replace' })
  })

  it('selectAll 走 page.selectAll', () => {
    const out = handleSetSelection({ selectAll: true })
    expect(out.mode).toBe('all')
    expect(out.selectedCount).toBe(3)
  })

  it('全部 ID 都不存在时报错（不静默返回空选区）', () => {
    expect(() => handleSetSelection({ nodeIds: ['nope'] })).toThrow(/节点不存在/)
  })

  it('合法 ID 已被回读确认（selectedNodeIds 与 page.selection 一致）', () => {
    const out = handleSetSelection({ nodeIds: ['1:1'] })
    expect(mg.document.currentPage.selection.map((n: any) => n.id)).toEqual(out.selectedNodeIds)
  })
})

/**
 * 跳页选区：选区是**页面级**的，传其他页面的节点时 MasterGo 会静默忽略。
 * 旧实现把请求参数当结果返回 → 假成功（返回 success/count，实际没选中）。
 */
describe('handleSetSelection — 跳页防假成功', () => {
  const crossPageNode = { id: '2:1', name: '别页节点', type: 'FRAME', removed: false, parent: { id: 'page:2', type: 'PAGE' } }

  it('预检直接拦下跳页节点，且不改动现有选区', () => {
    mg = installMgStub({
      nodes: { '2:1': crossPageNode, '1:1': node('1:1', 'A') },
      selection: [node('1:1', 'A')],
    })
    expect(() => handleSetSelection({ nodeIds: ['2:1'] })).toThrow(/不在当前页面/)
    // 已经生效的选区不能被半途改掉
    expect(mg.document.currentPage.selection.map((n: any) => n.id)).toEqual(['1:1'])
  })

  it('同页 + 跳页混合时整体拒绝（不留半成品选区）', () => {
    mg = installMgStub({
      nodes: { '2:1': crossPageNode, '1:1': node('1:1', 'A') },
      selection: [],
    })
    expect(() => handleSetSelection({ nodeIds: ['1:1', '2:1'] })).toThrow(/不在当前页面/)
    expect(mg.document.currentPage.selection).toEqual([])
  })

  it('回读校验：宿主静默过滤时抛错而非返回假成功', () => {
    // parent 无 type 信息 → 预检无法判定（放行），赋值后由回读发现未生效
    mg = installMgStub({
      nodes: { '1:9': { id: '1:9', name: 'Y', type: 'FRAME', removed: false, parent: { id: 'page:2' } } },
      selection: [],
      filterSelectionToPage: true,
    })
    expect(() => handleSetSelection({ nodeIds: ['1:9'] })).toThrow(/选区未完全生效/)
  })

  it('正常同页仍成功，且返回值取自回读', () => {
    mg = installMgStub({ nodes: { '1:1': node('1:1', 'A') }, selection: [], filterSelectionToPage: true })
    const out = handleSetSelection({ nodeIds: ['1:1'] })
    expect(out).toMatchObject({ success: true, selectedCount: 1 })
    expect(mg.document.currentPage.selection.map((n: any) => n.id)).toEqual(['1:1'])
  })
})
