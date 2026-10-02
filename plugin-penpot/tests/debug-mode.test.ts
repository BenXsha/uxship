/**
 * 调试模式开关（`useDebugMode`）
 *
 * 背景：面板里有一批**开发期才有用**的区块（本地自测 / HTML→画布 / 宿主能力清单 /
 * 尺寸说明条）。它们对真机排查很关键，但日常使用只会让面板变吵 ——
 * 所以按"**默认隐藏、点顶栏版本号按需打开**"处理（而不是删掉）。
 *
 * 这里钉住三件事：
 *   1. 默认关；localStorage 记过就按记的来；`?debug=1` 也能开（浏览器里直开 UI 时方便）；
 *   2. 读写存储**抛错也要能用**（隐私模式 / 某些宿主沙箱里 localStorage 会抛）；
 *   3. 关闭时不"静默"——由调用方负责把关键信息写进日志（组件里 watch notes → addLog）。
 */
import { describe, expect, it, vi } from 'vitest'
import { useDebugMode } from '@ui/composables/useDebugMode'

function makeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value) }),
  }
}

describe('默认与持久化', () => {
  it('默认关闭（干净 UI）', () => {
    const { isDebug } = useDebugMode({ storage: makeStorage(), search: '' })
    expect(isDebug.value).toBe(false)
  })

  it('存储里记过 1 → 打开', () => {
    const { isDebug } = useDebugMode({ storage: makeStorage({ 'mgmcp:debug': '1' }), search: '' })
    expect(isDebug.value).toBe(true)
  })

  it('toggle 后写回存储（关掉面板再开仍记得）', () => {
    const storage = makeStorage()
    const { isDebug, toggleDebug } = useDebugMode({ storage, search: '' })

    toggleDebug()
    expect(isDebug.value).toBe(true)
    expect(storage.data.get('mgmcp:debug')).toBe('1')

    toggleDebug()
    expect(isDebug.value).toBe(false)
    expect(storage.data.get('mgmcp:debug')).toBe('0')
  })

  it('setDebug 可显式设置（供测试/自动化用）', () => {
    const { isDebug, setDebug } = useDebugMode({ storage: makeStorage(), search: '' })
    setDebug(true)
    expect(isDebug.value).toBe(true)
  })
})

describe('`?debug=1` 也认（浏览器里直接打开 UI 调试）', () => {
  it('查询串里带 debug=1 → 打开', () => {
    expect(useDebugMode({ storage: makeStorage(), search: '?debug=1' }).isDebug.value).toBe(true)
    expect(useDebugMode({ storage: makeStorage(), search: '?a=1&debug=1' }).isDebug.value).toBe(true)
    expect(useDebugMode({ storage: makeStorage(), search: '?debug=1&b=2' }).isDebug.value).toBe(true)
  })

  it('不误判：debug=0 / debugx=1 / 子串都当关闭', () => {
    for (const search of ['?debug=0', '?debugx=1', '?nodebug=1=debug=1x', '']) {
      expect(useDebugMode({ storage: makeStorage(), search }).isDebug.value, search).toBe(false)
    }
  })

  it('存储里明确关过 → **完全听存储的**（URL 顶不开）', () => {
    // 用户手动隐藏过调试面板，就不该因为地址栏带 debug=1 又冒出来
    expect(useDebugMode({ storage: makeStorage({ 'mgmcp:debug': '0' }), search: '?debug=1' }).isDebug.value).toBe(false)
    expect(useDebugMode({ storage: makeStorage({ 'mgmcp:debug': '1' }), search: '' }).isDebug.value).toBe(true)
  })
})

describe('存储不可用时的降级', () => {
  it('getItem 抛错 → 仍然默认关闭，不崩', () => {
    const storage = { getItem: () => { throw new Error('隐私模式') }, setItem: () => {} }
    expect(() => useDebugMode({ storage, search: '' })).not.toThrow()
    expect(useDebugMode({ storage, search: '' }).isDebug.value).toBe(false)
  })

  it('setItem 抛错 → 本次会话仍可切换', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('配额') } }
    const { isDebug, toggleDebug } = useDebugMode({ storage, search: '' })
    expect(() => toggleDebug()).not.toThrow()
    expect(isDebug.value).toBe(true)
  })

  it('storage 为 null（非浏览器环境）→ 只用查询串', () => {
    expect(useDebugMode({ storage: null, search: '?debug=1' }).isDebug.value).toBe(true)
    expect(useDebugMode({ storage: null, search: '' }).isDebug.value).toBe(false)
  })
})
