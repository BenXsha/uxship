import { describe, it, expect } from 'vitest'
import { convertEffects, convertBlendMode, hasShadowEffect } from '../lib/api/effect-converter'

/**
 * DSL Effect → 运行时 Effect 的转换测试（渲染链路：dsl/render）
 *
 * 口径约定：
 * - 输入是 DSL 形状（`visible` / hex 颜色字符串），也可能是运行时形状（`isVisible`）
 * - 输出必须是 MasterGo 运行时形状（`isVisible` + RGBA 对象 + 归一化默认值）
 */
describe('convertEffects', () => {
  it('DSL visible → 运行时 isVisible', () => {
    expect(convertEffects([{ type: 'DROP_SHADOW', visible: false }])[0].isVisible).toBe(false)
    expect(convertEffects([{ type: 'DROP_SHADOW', visible: true }])[0].isVisible).toBe(true)
  })

  it('运行时 isVisible 也能作为输入（双字段兼容）', () => {
    expect(convertEffects([{ type: 'LAYER_BLUR', isVisible: false }])[0].isVisible).toBe(false)
  })

  it('阴影补齐运行时必需字段与默认值', () => {
    const out = convertEffects([
      { type: 'DROP_SHADOW', radius: 10, color: '#00000033', offset: { x: 0, y: 4 } },
    ])[0]
    expect(out).toMatchObject({
      type: 'DROP_SHADOW',
      radius: 10,
      spread: 0,
      blendMode: 'NORMAL',
      showShadowBehindNode: false,
      isEffectShow: true,
      offset: { x: 0, y: 4 },
    })
    // hex → RGBA 对象
    expect(out.color).toMatchObject({ r: 0, g: 0, b: 0 })
    expect(out.color.a).toBeCloseTo(0.2, 2)
  })

  it('阴影缺省值：radius 10 / 黑色半透明 / offset(0,4)', () => {
    const out = convertEffects([{ type: 'INNER_SHADOW' }])[0]
    expect(out.radius).toBe(10)
    expect(out.offset).toEqual({ x: 0, y: 4 })
    expect(out.color).toEqual({ r: 0, g: 0, b: 0, a: 0.25 })
  })

  it('radius:0 的硬阴影保留 0（不被默认值 10 覆盖）', () => {
    expect(convertEffects([{ type: 'DROP_SHADOW', radius: 0 }])[0].radius).toBe(0)
  })

  it('模糊效果补齐 radius 与 blendMode', () => {
    const blur = convertEffects([{ type: 'LAYER_BLUR' }])[0]
    expect(blur.type).toBe('LAYER_BLUR')
    expect(blur.radius).toBe(10)
    expect(blur.blendMode).toBe('NORMAL')
    expect(blur.isVisible).toBe(true)

    const bg = convertEffects([{ type: 'BACKGROUND_BLUR', radius: 6 }])[0]
    expect(bg.radius).toBe(6)
  })

  it('保持数组顺序与数量', () => {
    const out = convertEffects([
      { type: 'DROP_SHADOW' },
      { type: 'LAYER_BLUR', radius: 4 },
      { type: 'INNER_SHADOW' },
    ])
    expect(out.map((e) => e.type)).toEqual(['DROP_SHADOW', 'LAYER_BLUR', 'INNER_SHADOW'])
  })

  it('LIQUID_GLASS 字段直传（含 isVisible 归一化）', () => {
    const out = convertEffects([
      {
        type: 'LIQUID_GLASS',
        depth: 12,
        dispersion: 0.4,
        refraction: 1.2,
        lightIntensity: 0.8,
        lightAngle: 45,
        radius: 8,
        blendMode: 'SCREEN',
        visible: false,
      },
    ])[0]
    expect(out).toMatchObject({
      type: 'LIQUID_GLASS',
      depth: 12,
      dispersion: 0.4,
      refraction: 1.2,
      lightIntensity: 0.8,
      lightAngle: 45,
      radius: 8,
      blendMode: 'SCREEN',
      isVisible: false,
    })
  })

  it('MOTION_BLUR 字段直传', () => {
    const out = convertEffects([
      { type: 'MOTION_BLUR', radius: 6, angle: 30, blendMode: 'MULTIPLY', isVisible: true },
    ])[0]
    expect(out).toMatchObject({
      type: 'MOTION_BLUR',
      radius: 6,
      angle: 30,
      blendMode: 'MULTIPLY',
      isVisible: true,
    })
  })

  it('未知效果类型原样透传（不丢字段）', () => {
    const out = convertEffects([{ type: 'FANCY_GLOW', amount: 3, isVisible: false }])[0]
    expect(out).toMatchObject({ type: 'FANCY_GLOW', amount: 3, isVisible: false })
  })
})

describe('convertBlendMode', () => {
  it('支持的值原样返回', () => {
    expect(convertBlendMode('MULTIPLY')).toBe('MULTIPLY')
    expect(convertBlendMode('NORMAL')).toBe('NORMAL')
  })

  it('不兼容值映射到最接近的受支持模式', () => {
    expect(convertBlendMode('LINEAR_BURN')).toBe('PLUS_DARKER')
    expect(convertBlendMode('LINEAR_DODGE')).toBe('PLUS_LIGHTER')
  })

  it('未知值降级为 NORMAL', () => {
    expect(convertBlendMode('NOPE')).toBe('NORMAL')
  })
})

describe('hasShadowEffect', () => {
  it('自身或任一后代有阴影都返回 true', () => {
    expect(hasShadowEffect({ effects: [{ type: 'DROP_SHADOW' }] })).toBe(true)
    expect(hasShadowEffect({ effects: [], children: [{ effects: [{ type: 'INNER_SHADOW' }] }] })).toBe(true)
  })

  it('只有模糊时返回 false', () => {
    expect(hasShadowEffect({ effects: [{ type: 'LAYER_BLUR' }] })).toBe(false)
    expect(hasShadowEffect({ effects: [] })).toBe(false)
  })
})
