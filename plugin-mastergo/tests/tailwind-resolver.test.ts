import { describe, it, expect } from 'vitest'
import { resolveTailwindStyle, collectUnresolvedClasses } from '../ui/composables/tailwind-resolver'

/**
 * Tailwind 解析器覆盖与“未解析告警”回归测试
 *
 * 背景：解析器是白名单制，未命中的 class 会被**静默丢弃**——用户只看到“样式莫名没生效”。
 * 本文件锁住两件事：
 * 1. 高频写法必须被解析（中性色 / 任意值圆角阴影 / 刻度圆角阴影 / leading / opacity / z）
 * 2. 解析不了的必须被 `collectUnresolvedClasses` **如实报告**（不再静默）
 */
describe('resolveTailwindStyle — 基础覆盖', () => {
  it('布局与间距刻度', () => {
    expect(resolveTailwindStyle('flex')).toBe('display:flex')
    expect(resolveTailwindStyle('items-center')).toBe('align-items:center')
    expect(resolveTailwindStyle('p-4')).toBe('padding:1rem')
    expect(resolveTailwindStyle('px-6')).toBe('padding-left:1.5rem;padding-right:1.5rem')
    expect(resolveTailwindStyle('gap-3')).toBe('gap:0.75rem')
    expect(resolveTailwindStyle('w-10')).toBe('width:2.5rem')
  })

  it('任意值写法', () => {
    expect(resolveTailwindStyle('w-[320px]')).toBe('width:320px')
    expect(resolveTailwindStyle('text-[#333333]')).toBe('color:#333333')
    expect(resolveTailwindStyle('leading-[20px]')).toBe('line-height:20px')
    expect(resolveTailwindStyle('tracking-[0.5px]')).toBe('letter-spacing:0.5px')
    expect(resolveTailwindStyle('rounded-[16px]')).toBe('border-radius:16px')
    expect(resolveTailwindStyle('shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)]')).toBe(
      'box-shadow:0 10px 15px -3px rgba(0, 0, 0, 0.1)',
    )
  })
})

describe('resolveTailwindStyle — 中立色/调色板（本次补齐）', () => {
  it('white / black / transparent', () => {
    expect(resolveTailwindStyle('bg-white')).toBe('background-color:#ffffff')
    expect(resolveTailwindStyle('text-black')).toBe('color:#000000')
    expect(resolveTailwindStyle('border-transparent')).toBe('border-color:rgba(0,0,0,0)')
  })

  it('gray / slate 调色板', () => {
    expect(resolveTailwindStyle('text-gray-900')).toBe('color:#111827')
    expect(resolveTailwindStyle('bg-gray-100')).toBe('background-color:#f3f4f6')
    expect(resolveTailwindStyle('border-slate-200')).toBe('border-color:#e2e8f0')
    expect(resolveTailwindStyle('bg-slate-800')).toBe('background-color:#1e293b')
  })

  it('其它调色板仍不支持（交给告警提示改用任意值）', () => {
    expect(resolveTailwindStyle('bg-indigo-600')).toBeNull()
    expect(resolveTailwindStyle('text-red-500')).toBeNull()
    // 不存在的刻度也不能误报
    expect(resolveTailwindStyle('bg-gray-1000')).toBeNull()
  })
})

describe('resolveTailwindStyle — 圆角/阴影/行高/透明度/层级（本次补齐）', () => {
  it('圆角刻度', () => {
    expect(resolveTailwindStyle('rounded')).toBe('border-radius:0.25rem')
    expect(resolveTailwindStyle('rounded-sm')).toBe('border-radius:0.125rem')
    expect(resolveTailwindStyle('rounded-lg')).toBe('border-radius:0.5rem')
    expect(resolveTailwindStyle('rounded-2xl')).toBe('border-radius:1rem')
    expect(resolveTailwindStyle('rounded-full')).toBe('border-radius:9999px')
    expect(resolveTailwindStyle('rounded-nope')).toBeNull()
  })

  it('阴影刻度', () => {
    expect(resolveTailwindStyle('shadow')).toContain('box-shadow:0 1px 3px 0')
    expect(resolveTailwindStyle('shadow-md')).toContain('box-shadow:0 4px 6px -1px')
    expect(resolveTailwindStyle('shadow-lg')).toContain('box-shadow:0 10px 15px -3px')
    expect(resolveTailwindStyle('shadow-inner')).toContain('inset 0 2px 4px 0')
    expect(resolveTailwindStyle('shadow-nope')).toBeNull()
  })

  it('行高倍数 / 透明度 / 层级', () => {
    expect(resolveTailwindStyle('leading-tight')).toBe('line-height:1.25')
    expect(resolveTailwindStyle('leading-none')).toBe('line-height:1')
    expect(resolveTailwindStyle('opacity-50')).toBe('opacity:0.5')
    expect(resolveTailwindStyle('z-10')).toBe('z-index:10')
  })
})

describe('collectUnresolvedClasses — 不再静默丢弃', () => {
  it('全部可解析时为空（典型卡片写法）', () => {
    const cls = 'flex items-center gap-3 px-6 rounded-2xl shadow-lg bg-white text-gray-900 leading-tight'
    expect(collectUnresolvedClasses(cls)).toEqual([])
  })

  it('变体前缀 / 未覆盖工具类 / 其他调色板 会被报出', () => {
    const cls = 'flex hover:bg-red-500 space-y-2 grid-cols-3 bg-indigo-600'
    expect(collectUnresolvedClasses(cls).sort()).toEqual(
      ['bg-indigo-600', 'grid-cols-3', 'hover:bg-red-500', 'space-y-2'].sort(),
    )
  })

  it('渐变与 bg-opacity 由元素级逻辑单独消费，不算未解析', () => {
    const cls = 'bg-gradient-to-r from-[#ffffff] via-[#eeeeee] to-[#000000] bg-opacity-50'
    expect(collectUnresolvedClasses(cls)).toEqual([])
  })

  it('空输入与多余空白安全', () => {
    expect(collectUnresolvedClasses('')).toEqual([])
    expect(collectUnresolvedClasses(null)).toEqual([])
    expect(collectUnresolvedClasses(undefined)).toEqual([])
    expect(collectUnresolvedClasses('  flex   p-4  ')).toEqual([])
  })
})
