import { describe, it, expect } from 'vitest'
import { isEffectVisible, filterVisibleEffects } from '../src/utils/effect-visibility.js'

/**
 * 效果可见性口径回归测试
 *
 * 锁住历史上真实踩过的坑：
 * - 运行时对象用 `isVisible`、DSL 用 `visible`：只判一种就会漏
 * - `isEffectShow:false`（设计器"效果开关"关闭）必须视为不生效
 * - 非对象 / 空输入不能抛异常（会在渲染主链路里炸掉整个元素）
 */
describe('isEffectVisible', () => {
  it('accepts DSL-shaped visible:true', () => {
    expect(isEffectVisible({ type: 'DROP_SHADOW', visible: true })).toBe(true)
  })

  it('accepts runtime-shaped isVisible:true', () => {
    expect(isEffectVisible({ type: 'DROP_SHADOW', isVisible: true })).toBe(true)
  })

  it('defaults to visible when the flag is missing', () => {
    expect(isEffectVisible({ type: 'LAYER_BLUR' })).toBe(true)
  })

  it('rejects DSL-shaped visible:false', () => {
    expect(isEffectVisible({ type: 'DROP_SHADOW', visible: false })).toBe(false)
  })

  it('rejects runtime-shaped isVisible:false', () => {
    expect(isEffectVisible({ type: 'DROP_SHADOW', isVisible: false })).toBe(false)
  })

  it('rejects when isEffectShow is false even if visible is true', () => {
    expect(isEffectVisible({ type: 'DROP_SHADOW', visible: true, isEffectShow: false })).toBe(false)
    expect(isEffectVisible({ type: 'DROP_SHADOW', isVisible: true, isEffectShow: false })).toBe(false)
  })

  it('prefers isVisible when both fields exist', () => {
    expect(isEffectVisible({ isVisible: false, visible: true })).toBe(false)
    expect(isEffectVisible({ isVisible: true, visible: false })).toBe(true)
  })

  it('handles non-object input without throwing', () => {
    expect(isEffectVisible(null)).toBe(false)
    expect(isEffectVisible(undefined)).toBe(false)
    expect(isEffectVisible('DROP_SHADOW')).toBe(false)
    expect(isEffectVisible(42)).toBe(false)
  })
})

describe('filterVisibleEffects', () => {
  it('keeps only active effects', () => {
    const effects = [
      { type: 'DROP_SHADOW', visible: true },
      { type: 'LAYER_BLUR', isVisible: false },
      { type: 'INNER_SHADOW', visible: true, isEffectShow: false },
      { type: 'BACKGROUND_BLUR' },
    ]
    expect(filterVisibleEffects(effects).map((e) => e.type)).toEqual(['DROP_SHADOW', 'BACKGROUND_BLUR'])
  })

  it('returns [] for non-array input', () => {
    expect(filterVisibleEffects(undefined)).toEqual([])
    expect(filterVisibleEffects(null)).toEqual([])
    expect(filterVisibleEffects({ type: 'DROP_SHADOW' })).toEqual([])
  })
})
