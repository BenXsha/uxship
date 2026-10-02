/**
 * 紧凑模式（`penpot.ui.resize`）
 *
 * 起因是我把这件事判错了：一开始断言"Penpot 面板尺寸在 open() 时定死、没有折叠通路"，
 * 于是只把球做成了顶栏指示。查官方 api.yml 后确认 **有**
 *   `penpot.ui.resize(width, height) => void`（"Resizes the plugin UI."）
 *   `penpot.ui.size: {width,height} | null`
 * 所以 plugin-mastergo 那套"折叠成球 / 点开展开"是可以照搬的。
 *
 * 这里钉三件事：
 *   1. 切换时**确实**向宿主下发尺寸（用注入端口断言参数）；
 *   2. 官方对窗口尺寸有 min/max（未给数值）→ **读回 `ui.size` 并以实际值为准**，被夹要记说明；
 *   3. 脱离插件环境（harness / ui-shot / 纯浏览器）时优雅降级：视觉照常切换，尺寸不动，
 *      并记一条说明 —— 不假装成功。
 */
import { describe, expect, it, vi } from 'vitest'
import { useCompactMode, type UiSizePort } from '@ui/composables/useCompactMode'

/**
 * 假"沙箱回包"：记录下发了什么，并回一个**宿主实际给到的尺寸**。
 * `clamp` 用来模拟官方提到的 min/max 限制（把球窗口夹大）。
 */
function makePort(clamp?: { width: number; height: number }) {
  const calls: [number, number][] = []
  const port: UiSizePort = {
    resize: vi.fn(async (width: number, height: number) => {
      calls.push([width, height])
      return clamp ?? { width, height }
    }),
  }
  return { port, calls }
}

describe('折叠 / 展开', () => {
  it('默认展开；collapse 下发紧凑尺寸、expand 还原展开尺寸', async () => {
    const { port, calls } = makePort()
    const compact = useCompactMode({ expanded: { width: 400, height: 560 }, compact: { width: 132, height: 132 }, port })

    expect(compact.isCompact.value).toBe(false)
    compact.collapse()
    expect(compact.isCompact.value).toBe(true) // 界面立刻切（不等宿主）
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls).toEqual([[132, 132]])

    compact.expand()
    expect(compact.isCompact.value).toBe(false)
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls).toEqual([[132, 132], [400, 560]])
  })

  it('toggle 来回切换', () => {
    const { port } = makePort()
    const compact = useCompactMode({ port })
    compact.toggle()
    expect(compact.isCompact.value).toBe(true)
    compact.toggle()
    expect(compact.isCompact.value).toBe(false)
  })

  it('展开尺寸与 main.ts 的 open() 尺寸一致（否则展开后会跳一下）', async () => {
    const { port, calls } = makePort()
    const compact = useCompactMode({ port })
    compact.collapse()
    compact.expand()
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]).toEqual([compact.expandedSize.width, compact.expandedSize.height])
    expect(compact.expandedSize).toEqual({ width: 400, height: 560 })
  })
})

describe('宿主 min/max：以读回值为准，不假设自己拿到了想要的大小', () => {
  it('读回一致 → 无说明', async () => {
    const { port } = makePort()
    const compact = useCompactMode({ port })
    compact.collapse()
    await vi.waitFor(() => expect(compact.lastApplied.value).toEqual(compact.compactSize))
    expect(compact.notes.value).toEqual([])
  })

  it('宿主把球窗口夹大（官方有 min 限制）→ 记说明并记录实际值', async () => {
    // 模拟沙箱回包：宿主把紧凑尺寸夹大
    const port: UiSizePort = { resize: async () => ({ width: 240, height: 240 }) }
    const compact = useCompactMode({ port })
    compact.collapse()

    await vi.waitFor(() => expect(compact.lastApplied.value).toEqual({ width: 240, height: 240 }))
    expect(compact.notes.value.join(' ')).toMatch(/min\/max/)
  })

  it('沙箱抛错 → 记说明，不崩', async () => {
    const port: UiSizePort = { resize: () => { throw new Error('宿主拒绝') } }
    const compact = useCompactMode({ port })
    expect(() => compact.collapse()).not.toThrow()
    await vi.waitFor(() => expect(compact.notes.value.join(' ')).toMatch(/宿主拒绝/))
  })

  it('沙箱没回报尺寸（插件未打开/旧版）→ 记说明，不假装成功', async () => {
    const port: UiSizePort = { resize: async () => null }
    const compact = useCompactMode({ port })
    compact.collapse()
    await vi.waitFor(() => expect(compact.notes.value.join(' ')).toMatch(/没有回报窗口尺寸/))
    expect(compact.lastApplied.value).toBeNull()
  })

  it('连点：只认最后一次请求的结果（不回退、不串台）', async () => {
    let resolveFirst: ((value: { width: number; height: number }) => void) | undefined
    let call = 0
    const port: UiSizePort = {
      resize: () => {
        call += 1
        if (call === 1) {
          return new Promise<{ width: number; height: number }>((resolve) => { resolveFirst = resolve })
        }
        return Promise.resolve({ width: 400, height: 560 })
      },
    }
    const compact = useCompactMode({ port })
    compact.collapse()   // 第 1 次（慢）
    compact.expand()     // 第 2 次（快）
    await vi.waitFor(() => expect(compact.lastApplied.value).toEqual({ width: 400, height: 560 }))

    // 第 1 次的迟到结果不应把状态改回去
    resolveFirst?.({ width: 132, height: 132 })
    await Promise.resolve()
    expect(compact.lastApplied.value).toEqual({ width: 400, height: 560 })
  })
})

describe('脱离插件的环境（harness / ui-shot / 纯浏览器打开）', () => {
  it('没有接上尺寸端口 → 视觉切换照常，但如实说明尺寸未改变', async () => {
    const compact = useCompactMode({ port: null })
    expect(compact.canResize.value).toBe(false)

    compact.collapse()
    expect(compact.isCompact.value).toBe(true) // 界面照样能切
    await vi.waitFor(() => expect(compact.notes.value.join(' ')).toMatch(/没接上尺寸端口/))
    expect(compact.lastApplied.value).toBeNull()
  })

  it('说明只记一次（反复切换不刷屏）', async () => {
    const compact = useCompactMode({ port: null })
    compact.collapse()
    await vi.waitFor(() => expect(compact.notes.value).toHaveLength(1))
    compact.expand()
    compact.collapse()
    await Promise.resolve()
    expect(compact.notes.value).toHaveLength(1)
  })
})

describe('默认尺寸', () => {
  it('紧凑 180×180（与 plugin-mastergo 一致）、展开 400×560（与 open() 一致）', () => {
    const compact = useCompactMode({ port: null })
    expect(compact.compactSize).toEqual({ width: 180, height: 180 })
    expect(compact.expandedSize).toEqual({ width: 400, height: 560 })
  })
})

describe('useCompactMode：打开即紧凑（对齐 MasterGo 版）', () => {
  it('initialCompact: true → 初始为紧凑态；expand 后展开', () => {
    const port = { resize: (width: number, height: number) => ({ width, height }) }
    const compact = useCompactMode({ initialCompact: true, port })
    expect(compact.isCompact.value).toBe(true)
    compact.expand()
    expect(compact.isCompact.value).toBe(false)
  })

  it('不传 initialCompact → 仍默认展开（保持既有语义，由 App 决定）', () => {
    const port = { resize: (width: number, height: number) => ({ width, height }) }
    expect(useCompactMode({ port }).isCompact.value).toBe(false)
  })
})
