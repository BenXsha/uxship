import { describe, it, expect, afterEach, vi } from 'vitest'
import { installMgStub, resetMgStub } from './helpers/mg-stub'
import { handleMoveNode } from '../lib/api/nodeHandlers'

/**
 * `node_move` 的 `index` 参数门禁
 *
 * 2026-09 真实踩坑：旧版 `handleMoveNode` 只 `console.warn('Exact index positioning may
 * require manual reorder')` 然后固定 `appendChild`（永远追加到末尾），用户因此发明了
 * 「依次 move 所有兄弟」的笨办法。
 *
 * 现在按宿主 `ChildrenMixin.insertChild(index, child)` 精确定位；宿主不支持 / 抛错时
 * 回退 `appendChild` 并给中文 warning（不静默降级）。
 */

let seq = 0

function makeNode(type = 'FRAME'): any {
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
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    fills: [],
    strokes: [],
    effects: [],
  }
}

/** 能真正收子节点的容器：appendChild 追加末尾、insertChild 按序号插入（同宿主语义） */
function makeContainer(type = 'FRAME'): any {
  const container: any = Object.assign(makeNode(type), {
    children: [],
    appendChild(child: any) {
      container.children = container.children.filter((c: any) => c !== child)
      container.children.push(child)
      child.parent = container
    },
    insertChild(index: number, child: any) {
      container.children = container.children.filter((c: any) => c !== child)
      container.children.splice(index, 0, child)
      child.parent = container
    },
  })
  return container
}

afterEach(() => {
  resetMgStub()
})

describe('node_move：index 真正生效', () => {
  it('传 index 时调用 insertChild(index, node)，并回显 index', () => {
    const parent = makeContainer()
    const a = makeNode()
    const b = makeNode()
    const target = makeNode()
    parent.appendChild(a)
    parent.appendChild(b)
    parent.appendChild(target)
    target.id = '1:3'

    const insertSpy = vi.fn(parent.insertChild)
    parent.insertChild = insertSpy

    installMgStub({ nodes: { '2:1': parent, '1:3': target } })
    const res = handleMoveNode({ nodeId: '1:3', parentId: '2:1', index: 0 })

    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(insertSpy.mock.calls[0][0]).toBe(0)
    expect(insertSpy.mock.calls[0][1]).toBe(target)
    expect(res.index).toBe(0)
    expect(res.success).toBe(true)
    expect(res.warnings).toBeUndefined()
    // 真的插到了第 0 位，而不是被追加到末尾
    expect(parent.children.map((c: any) => c.id)).toEqual(['1:3', a.id, b.id])
  })

  it('index 指向中间位置时同样按序号插入', () => {
    const parent = makeContainer()
    const a = makeNode()
    const b = makeNode()
    const target = makeNode()
    parent.appendChild(a)
    parent.appendChild(target)
    parent.appendChild(b)
    target.id = '1:9'

    installMgStub({ nodes: { '2:1': parent, '1:9': target } })
    const res = handleMoveNode({ nodeId: '1:9', parentId: '2:1', index: 1 })

    expect(res.index).toBe(1)
    expect(parent.children.map((c: any) => c.id)).toEqual([a.id, '1:9', b.id])
  })

  it('宿主没有 insertChild：回退 appendChild，并给中文 warning（不静默）', () => {
    const parent = makeContainer()
    const a = makeNode()
    const target = makeNode()
    parent.appendChild(a)
    parent.appendChild(target)
    target.id = '1:3'
    delete (parent as any).insertChild
    const appendSpy = vi.fn(parent.appendChild)
    parent.appendChild = appendSpy

    installMgStub({ nodes: { '2:1': parent, '1:3': target } })
    const res = handleMoveNode({ nodeId: '1:3', parentId: '2:1', index: 0 })

    expect(appendSpy).toHaveBeenCalledWith(target)
    // 没真的按序号插入，就不回显 index（避免调用方误以为生效）
    expect(res.index).toBeUndefined()
    expect(res.success).toBe(true)
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toContain('insertChild')
    expect(res.warnings[0]).toContain('已追加到末尾')
  })

  it('insertChild 抛错：回退 appendChild，warning 里带宿主错误原因', () => {
    const parent = makeContainer()
    const target = makeNode()
    parent.appendChild(target)
    target.id = '1:3'
    parent.insertChild = () => {
      throw new Error('index out of range')
    }
    const appendSpy = vi.fn(parent.appendChild)
    parent.appendChild = appendSpy

    installMgStub({ nodes: { '2:1': parent, '1:3': target } })
    const res = handleMoveNode({ nodeId: '1:3', parentId: '2:1', index: 5 })

    expect(appendSpy).toHaveBeenCalledWith(target)
    expect(res.index).toBeUndefined()
    expect(res.warnings[0]).toContain('insertChild 调用失败')
    expect(res.warnings[0]).toContain('index out of range')
  })

  it('index 不是非负整数：忽略序号并说明，仍不中断', () => {
    const parent = makeContainer()
    const target = makeNode()
    parent.appendChild(target)
    target.id = '1:3'

    installMgStub({ nodes: { '2:1': parent, '1:3': target } })
    const res = handleMoveNode({ nodeId: '1:3', parentId: '2:1', index: -1 as any })

    expect(res.success).toBe(true)
    expect(res.index).toBeUndefined()
    expect(res.warnings[0]).toContain('非负整数')
  })

  it('不传 index：行为与旧版一致（追加到末尾、不回显 index、无 warning）', () => {
    const parent = makeContainer()
    const a = makeNode()
    const target = makeNode()
    parent.appendChild(a)
    parent.appendChild(target)
    target.id = '1:3'

    installMgStub({ nodes: { '2:1': parent, '1:3': target } })
    const res = handleMoveNode({ nodeId: '1:3', parentId: '2:1' })

    expect(res).toMatchObject({ success: true })
    expect(res.index).toBeUndefined()
    expect(res.warnings).toBeUndefined()
    expect(parent.children.map((c: any) => c.id)).toEqual([a.id, '1:3'])
  })
})
