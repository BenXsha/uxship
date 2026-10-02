/**
 * 当前选区（面板展示）与宿主订阅
 *
 * 两个层次都要钉：
 *   1. **宿主订阅**：`penpot.on('selectionchange'|'pagechange')` 是选区数据的唯一来源。
 *      这条链此前**完全没有生产者** —— UI 里有 `SELECTION_CHANGED` 的处理分支，沙箱却
 *      从不发送，于是"选了什么"在面板上永远不可见（移植组件也只能得到一个空面板）。
 *      所以这里既测宿主端口的订阅/退订，也测真实宿主的事件名。
 *   2. **状态归约**：展示信息只有"类型/名称/个数"，边界（读失败、超量截断、清空）要稳住。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { PenpotHost } from '@lib/host/penpot'
import { MemoryHost } from '@lib/host/memory'
import { installFakePenpot, type FakePenpot } from './helpers/fake-penpot'
import { useSelection } from '@ui/composables/useSelection'

describe('宿主订阅选区变化', () => {
  let fake: FakePenpot
  let host: PenpotHost

  beforeEach(async () => {
    const installed = installFakePenpot()
    fake = installed.penpot
    host = new PenpotHost()
    await host.init()
  })

  it('selectionchange 触发回调（真宿主就是靠这个事件把选区推给面板）', () => {
    let calls = 0
    host.observeSelection(() => { calls += 1 })

    fake.__emit('selectionchange', ['s1'])
    expect(calls).toBe(1)
    fake.__emit('selectionchange', ['s1', 's2'])
    expect(calls).toBe(2)
  })

  it('pagechange 也算选区变化（换页会清空选区，不推的话面板会显示上一页的旧选区）', () => {
    let calls = 0
    host.observeSelection(() => { calls += 1 })

    fake.__emit('pagechange', { id: 'page-2' })
    expect(calls).toBe(1)
  })

  it('退订后不再回调（off(listenerId)）', () => {
    let calls = 0
    const stop = host.observeSelection(() => { calls += 1 })
    fake.__emit('selectionchange', [])
    stop()
    fake.__emit('selectionchange', [])
    expect(calls).toBe(1)
  })

  it('宿主没提供事件 API 时退化成空订阅（旧版 Penpot 不该让插件崩）', () => {
    const bare = { } as unknown as PenpotHost
    const stop = Object.getPrototypeOf(host).observeSelection.call(bare, () => {})
    expect(typeof stop).toBe('function')
    expect(() => stop()).not.toThrow()
  })

  it('内存替身也能触发（便于端到端测面板链路）', () => {
    const memory = new MemoryHost()
    let calls = 0
    const stop = memory.observeSelection!(() => { calls += 1 })
    memory.__fireSelectionChange()
    expect(calls).toBe(1)
    stop()
    memory.__fireSelectionChange()
    expect(calls).toBe(1)
  })
})

describe('选区展示状态', () => {
  it('正常载荷：个数 / 明细 / 截断提示', () => {
    const selection = useSelection()
    selection.updateSelection({
      count: 12,
      details: [
        { id: 's1', type: 'board', name: 'Login Page' },
        { id: 's2', type: 'text', name: 'Title' },
      ],
      truncated: 10,
    })

    expect(selection.hasSelection.value).toBe(true)
    expect(selection.summaryText.value).toBe('12 个对象')
    expect(selection.details.value).toHaveLength(2)
    expect(selection.truncated.value).toBe(10)
    expect(selection.error.value).toBe('')
  })

  it('未选中：摘要为「未选中」，明细为空', () => {
    const selection = useSelection()
    selection.updateSelection({ count: 0, details: [{ id: 'x', type: 'text', name: 'stale' }] })
    expect(selection.isEmpty.value).toBe(true)
    expect(selection.summaryText.value).toBe('未选中')
    expect(selection.details.value).toEqual([])
    expect(selection.truncated.value).toBe(0)
  })

  it('沙箱读失败：只记错误，**保留上一次列表**（显示失败比显示空更接近真相）', () => {
    const selection = useSelection()
    selection.updateSelection({ count: 2, details: [{ id: 's1', type: 'text', name: 'A' }] })
    selection.updateSelection({ error: '节点不存在' })

    expect(selection.error.value).toBe('节点不存在')
    expect(selection.count.value).toBe(2)
    expect(selection.details.value).toHaveLength(1)
  })

  it('错误恢复后重新接受载荷', () => {
    const selection = useSelection()
    selection.updateSelection({ error: 'boom' })
    selection.updateSelection({ count: 1, details: [{ id: 's1', type: 'rect', name: 'R' }] })
    expect(selection.error.value).toBe('')
    expect(selection.count.value).toBe(1)
  })

  it('缺字段/负数都被夹住（JSON 来自 postMessage，不能假设形状）', () => {
    const selection = useSelection()
    selection.updateSelection({ count: -3, details: null as never, truncated: -1 } as never)
    expect(selection.count.value).toBe(0)
    expect(selection.details.value).toEqual([])
    expect(selection.truncated.value).toBe(0)
  })
})
