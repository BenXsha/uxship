import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installMgStub, resetMgStub, type MgStub } from './helpers/mg-stub'
import { structureHandlers, handleGetRoot, DEFAULT_SUBTREE_MAX_DEPTH } from '../lib/api/structureHandlers'

/**
 * 顶层结构查询（`node_get_root` → `node/getRoot`）测试
 *
 * 假节点树：Page(page:1) → Frame(2:1) → Group(2:2) → Rect(2:3)，
 * 用 `mg-stub` 的根查询选项（`withRootApis` / `rootNodeIdById` / `rootParentLayerIdById`）驱动。
 * 覆盖：正常返回、祖先链与页面归属、子树 + maxDepth、根节点对象缺失、API 缺失、参数/节点错误。
 */

const page: any = {
  id: 'page:1', name: 'Test Page', type: 'PAGE', removed: false, isVisible: true, isLocked: false,
  children: [], parent: { id: 'document:1', name: 'Document', type: 'DOCUMENT' },
}
const frame: any = {
  id: '2:1', name: 'Frame', type: 'FRAME', removed: false, isVisible: true, isLocked: false,
  x: 0, y: 0, width: 400, height: 300, children: [], parent: page,
}
const group: any = {
  id: '2:2', name: 'Group', type: 'GROUP', removed: false, isVisible: true, isLocked: false,
  x: 10, y: 10, width: 100, height: 80, children: [], parent: frame,
}
const rect: any = {
  id: '2:3', name: 'Rect', type: 'RECTANGLE', removed: false, isVisible: true, isLocked: false,
  x: 12, y: 12, width: 40, height: 40, fills: [], strokes: [], children: [], parent: group,
}
page.children.push(frame)
frame.children.push(group)
group.children.push(rect)

const nodes: Record<string, any> = { 'page:1': page, '2:1': frame, '2:2': group, '2:3': rect }

/** 安装带根查询 API 的桩 */
function installWithRootApis(extra: Record<string, any> = {}): MgStub {
  return installMgStub({
    nodes,
    pageName: 'Test Page',
    withRootApis: true,
    rootNodeIdById: { '2:3': '2:1', '2:2': '2:1', '2:1': '2:1' },
    rootParentLayerIdById: { '2:3': 'page:1', '2:2': 'page:1', '2:1': 'page:1' },
    ...extra,
  })
}

beforeEach(() => {
  installWithRootApis()
})

afterEach(() => resetMgStub())

describe('node/getRoot — 注册与基础返回', () => {
  it('注册在 structureHandlers 的 node/getRoot 下', () => {
    expect(typeof structureHandlers['node/getRoot']).toBe('function')
  })

  it('返回根节点摘要、根父层 id、祖先链与页面归属', () => {
    const out = handleGetRoot({ nodeId: '2:3' })

    expect(out.success).toBe(true)
    expect(out.nodeId).toBe('2:3')
    expect(out.rootNodeId).toBe('2:1')
    expect(out.rootParentLayerId).toBe('page:1')
    expect(out.root).toMatchObject({
      id: '2:1', name: 'Frame', type: 'FRAME',
      width: 400, height: 300, x: 0, y: 0, parentId: 'page:1',
    })
    // 祖先链自下而上：Group → Frame → Page
    expect(out.ancestors.map((a: any) => a.id)).toEqual(['2:2', '2:1', 'page:1'])
    expect(out.ancestorsOrder).toBe('bottom-up')
    expect(out.pageId).toBe('page:1')
    expect(out.pageName).toBe('Test Page')
    // 未请求子树时不返回 subtree / maxDepth
    expect(out.subtree).toBeUndefined()
    expect(out.maxDepth).toBeUndefined()
  })

  it('查询对象本身是页面时，页面归属即自身、祖先链为空', () => {
    const out = handleGetRoot({ nodeId: 'page:1' })
    expect(out.ancestors).toEqual([])
    expect(out.pageId).toBe('page:1')
  })

  it('根节点对象取不到时只回 id，不报错', () => {
    installWithRootApis({ rootNodeIdById: { '2:3': null } })
    const out = handleGetRoot({ nodeId: '2:3' })
    expect(out.success).toBe(true)
    expect(out.rootNodeId).toBeNull()
    // 回退用查询节点 id 兜底
    expect(out.root).toEqual({ id: '2:3' })
  })
})

describe('node/getRoot — 子树与 maxDepth', () => {
  it('includeSubtree=true 时附带子树，并回显生效的 maxDepth', () => {
    const out = handleGetRoot({ nodeId: '2:1', includeSubtree: true, maxDepth: 1 })
    expect(out.maxDepth).toBe(1)
    expect(out.subtree.id).toBe('2:1')
    // 深度 1：只展开一层子节点（Group），Group 不再有 children 且打截断标记
    expect(out.subtree.children.map((c: any) => c.id)).toEqual(['2:2'])
    expect(out.subtree.children[0].children).toBeUndefined()
    expect(out.subtree.children[0].truncated).toBe(true)
  })

  it('未传 maxDepth 时用默认值并回显', () => {
    const out = handleGetRoot({ nodeId: '2:3', includeSubtree: true })
    expect(out.maxDepth).toBe(DEFAULT_SUBTREE_MAX_DEPTH)
    expect(out.subtree.id).toBe('2:3')
  })

  it('maxDepth=0 时只返回节点自身，不带 children', () => {
    const out = handleGetRoot({ nodeId: '2:1', includeSubtree: true, maxDepth: 0 })
    expect(out.subtree.id).toBe('2:1')
    expect(out.subtree.children).toBeUndefined()
    expect(out.subtree.truncated).toBe(true)
  })

  it('默认 maxDepth 可完整展开到叶子', () => {
    const out = handleGetRoot({ nodeId: '2:1', includeSubtree: true })
    expect(out.subtree.children[0].children[0].id).toBe('2:3')
    expect(out.subtree.children[0].children[0].truncated).toBeUndefined()
  })
})

describe('node/getRoot — 错误与降级分支', () => {
  it('宿主缺少根查询 API 时返回 unsupported，不抛错', () => {
    installMgStub({ nodes }) // 注意：不传 withRootApis
    const out = handleGetRoot({ nodeId: '2:3' })
    expect(out).toMatchObject({ success: false, reason: 'unsupported', nodeId: '2:3' })
    expect(out.message).toContain('getRootNodeById')
  })

  it('缺少 nodeId 时抛中文错误', () => {
    expect(() => handleGetRoot({} as any)).toThrow(/nodeId/)
  })

  it('节点不存在时抛中文错误', () => {
    expect(() => handleGetRoot({ nodeId: 'nope' })).toThrow(/未找到节点/)
  })
})
