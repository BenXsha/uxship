import { describe, it, expect } from 'vitest'
import { isItemVisible, serializeEffect, serializeEffects, isShadowEffect, isBlurEffect } from '../lib/api/visual-utils'

/**
 * 插件端 effects / paint 公共逻辑回归测试
 *
 * 这一层是 2026-09 那次真实缺陷的根因所在：effects 字段提取曾在
 * serializer / dsl-exporter / design_describe 三处各写一套，且字段名
 * （运行时 isVisible vs DSL visible）不统一 —— node_get / selection_get
 * 因此完全读不到阴影。此文件锁死口径。
 */
describe('isItemVisible', () => {
  it('接受运行时 isVisible', () => {
    expect(isItemVisible({ isVisible: true })).toBe(true)
    expect(isItemVisible({ isVisible: false })).toBe(false)
  })

  it('接受 DSL visible', () => {
    expect(isItemVisible({ visible: true })).toBe(true)
    expect(isItemVisible({ visible: false })).toBe(false)
  })

  it('缺省视为可见', () => {
    expect(isItemVisible({})).toBe(true)
    expect(isItemVisible(null)).toBe(true)
  })

  it('isVisible 优先于 visible', () => {
    expect(isItemVisible({ isVisible: false, visible: true })).toBe(false)
  })
})

describe('serializeEffect', () => {
  const shadow = {
    type: 'DROP_SHADOW',
    isVisible: true,
    radius: 12,
    spread: 0,
    blendMode: 'PASS_THROUGH',
    showShadowBehindNode: false,
    isEffectShow: true,
    color: { r: 0, g: 0, b: 0, a: 0.3 },
    offset: { x: 0, y: 4 },
  }

  it('保留阴影全部字段（少一个都会让回读失真）', () => {
    expect(serializeEffect(shadow)).toEqual({
      type: 'DROP_SHADOW',
      isVisible: true,
      radius: 12,
      spread: 0,
      blendMode: 'PASS_THROUGH',
      showShadowBehindNode: false,
      isEffectShow: true,
      color: { r: 0, g: 0, b: 0, a: 0.3 },
      offset: { x: 0, y: 4 },
    })
  })

  it('radius:0 的硬阴影不被丢弃（falsy 陷阱）', () => {
    expect(serializeEffect({ type: 'DROP_SHADOW', radius: 0 }).radius).toBe(0)
  })

  it('颜色与偏移做浅拷贝（不把 mg 内部对象带进 JSON）', () => {
    const color = { r: 1, g: 0, b: 0, a: 1 }
    const offset = { x: 1, y: 2 }
    const out = serializeEffect({ type: 'DROP_SHADOW', color, offset })
    expect(out.color).not.toBe(color)
    expect(out.offset).not.toBe(offset)
    expect(out.color).toEqual(color)
    expect(out.offset).toEqual(offset)
  })

  it('缺字段时不臆造（undefined 不写入）', () => {
    const out = serializeEffect({ type: 'LAYER_BLUR' })
    expect(out).toEqual({ type: 'LAYER_BLUR', isVisible: true })
    expect('radius' in out).toBe(false)
    expect('color' in out).toBe(false)
  })

  it('无效输入不抛异常', () => {
    expect(serializeEffect(null).type).toBe('UNKNOWN')
    expect(serializeEffect(undefined).isVisible).toBe(true)
  })
})

describe('serializeEffects', () => {
  it('批量转换并保持顺序', () => {
    const out = serializeEffects([
      { type: 'DROP_SHADOW', radius: 4 },
      { type: 'LAYER_BLUR', radius: 8, isVisible: false },
    ])
    expect(out.map((e) => e.type)).toEqual(['DROP_SHADOW', 'LAYER_BLUR'])
    expect(out[1].isVisible).toBe(false)
  })

  it('非数组返回空数组', () => {
    expect(serializeEffects(undefined)).toEqual([])
    expect(serializeEffects(null)).toEqual([])
    expect(serializeEffects({ type: 'DROP_SHADOW' })).toEqual([])
  })
})

describe('类型判定', () => {
  it('isShadowEffect / isBlurEffect', () => {
    expect(isShadowEffect({ type: 'DROP_SHADOW' })).toBe(true)
    expect(isShadowEffect({ type: 'INNER_SHADOW' })).toBe(true)
    expect(isShadowEffect({ type: 'LAYER_BLUR' })).toBe(false)
    expect(isBlurEffect({ type: 'LAYER_BLUR' })).toBe(true)
    expect(isBlurEffect({ type: 'BACKGROUND_BLUR' })).toBe(true)
    expect(isBlurEffect({ type: 'DROP_SHADOW' })).toBe(false)
  })
})
