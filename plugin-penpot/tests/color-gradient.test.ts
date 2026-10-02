/**
 * 颜色 / 填充类型 / 渐变几何 归一化测试
 *
 * 这一层存在的唯一理由：**DSL 里的颜色有 4 种表示，而客户端渲染引擎用的是最不直观的那种
 * （`{r,g,b,a}` 对象）**。修之前 `String({r:67,...})` → `"[OBJECT OBJECT]"`，
 * 于是 HTML 链路的每一个颜色都落不下来，而单测（用手写 hex）全绿。
 */
import { describe, expect, it } from 'vitest'
import { describeColor, normalizeColor } from '@lib/host/color'
import { buildPenpotGradient, isFillVisible, normalizeFillType, readFillOpacity } from '@lib/host/gradient'

describe('normalizeColor — 四种形态', () => {
  it('形态 1a：0–1 浮点（客户端渲染引擎 cssColorToRgb 的真实产出）', () => {
    // ⚠️ 这三个用例是对着**真机实测值**写的：修之前它们分别变成 #010101 / #000000 / #010101，
    //    整页因此发黑。引擎把 RGB 除以了 255，必须按值判定量纲。
    const r = (v: number) => Math.round(v * 255)

    const text = normalizeColor({ r: r(156) / 255, g: r(163) / 255, b: r(175) / 255, a: 1 })
    expect(text!.hex).toBe('#9CA3AF') // 修之前 → #010101

    const dark = normalizeColor({ r: 11 / 255, g: 18 / 255, b: 32 / 255, a: 1 })
    expect(dark!.hex).toBe('#0B1220') // 修之前 → #000000

    const white = normalizeColor({ r: 1, g: 1, b: 1, a: 1 })
    expect(white!.hex).toBe('#FFFFFF') // 1 也算 0–1（与 MasterGo processColor 一致）

    expect(normalizeColor({ r: 0, g: 0, b: 0, a: 0.5 })!.opacity).toBeCloseTo(0.5, 4)
    // 半调灰：0.5 → 128 而不是 1
    expect(normalizeColor({ r: 0.5, g: 0.5, b: 0.5, a: 1 })!.hex).toBe('#808080')
  })

  it('形态 1b：0–255 整数（手写 DSL / Figma 系导出）', () => {
    expect(normalizeColor({ r: 67, g: 64, b: 234, a: 1 })).toEqual({ hex: '#4340EA', opacity: 1 })
    expect(normalizeColor({ r: 255, g: 255, b: 255 })).toEqual({ hex: '#FFFFFF', opacity: 1 })
    expect(normalizeColor({ r: 49.6, g: 239.4, b: 183.5, a: 1 })!.hex).toBe('#32EFB8')
  })

  it('两种量纲对同一个颜色必须得出同一个结果（宿主间的颜色一致性）', () => {
    expect(normalizeColor({ r: 156, g: 163, b: 175 })!.hex).toBe(normalizeColor({ r: 156 / 255, g: 163 / 255, b: 175 / 255 })!.hex)
  })

  it('形态 2：hex（3/4/6/8 位）', () => {
    expect(normalizeColor('#4340ea')).toEqual({ hex: '#4340EA', opacity: 1 })
    expect(normalizeColor('#abc')).toEqual({ hex: '#AABBCC', opacity: 1 })
    expect(normalizeColor('#0F172A80')!.opacity).toBeCloseTo(128 / 255, 4)
    expect(normalizeColor('#abcF')!.hex).toBe('#AABBCC')
    expect(normalizeColor('#abcF')!.opacity).toBe(1)
  })

  it('形态 3：rgb() / rgba()（含百分比与空格/斜杠写法）', () => {
    expect(normalizeColor('rgb(67, 64, 234)')).toEqual({ hex: '#4340EA', opacity: 1 })
    expect(normalizeColor('rgba(67,64,234,0.25)')!.opacity).toBeCloseTo(0.25, 4)
    expect(normalizeColor('rgb(100% 50% 0%)')).toEqual({ hex: '#FF8000', opacity: 1 })
    expect(normalizeColor('rgb(255 0 0 / 50%)')!.opacity).toBeCloseTo(0.5, 4)
  })

  it('形态 4：transparent 与具名色', () => {
    expect(normalizeColor('transparent')).toEqual({ hex: '#000000', opacity: 0 })
    expect(normalizeColor('WHITE')).toEqual({ hex: '#FFFFFF', opacity: 1 })
    expect(normalizeColor('rebeccapurple')).toBeNull() // 长尾具名色不猜
  })

  it('显式 opacity 优先于颜色自带的 alpha', () => {
    expect(normalizeColor({ r: 0, g: 0, b: 0, a: 0.2 }, 0.9)!.opacity).toBeCloseTo(0.9, 4)
    expect(normalizeColor('#00000080', 0.9)!.opacity).toBeCloseTo(0.9, 4)
  })

  it('识别不了就返回 null —— 绝不兜底成黑色', () => {
    expect(normalizeColor(undefined)).toBeNull()
    expect(normalizeColor(null)).toBeNull()
    expect(normalizeColor('')).toBeNull()
    expect(normalizeColor('not-a-color')).toBeNull()
    expect(normalizeColor({ r: 'x', g: 1, b: 2 })).toBeNull()
  })

  it('嵌在 { color: ... }（Penpot Color 形态）里也能解', () => {
    expect(normalizeColor({ color: '#123456' })).toEqual({ hex: '#123456', opacity: 1 })
  })

  it('describeColor 用于把「不认识的色值」写进 report', () => {
    expect(describeColor({ r: 1, g: 2, b: 3 })).toBe('{"r":1,"g":2,"b":3}')
    expect(describeColor(undefined)).toBe('')
  })
})

describe('normalizeFillType — 两种命名体系都要认', () => {
  it('引擎的小写与 DSL 的大写归一为同一个值', () => {
    expect(normalizeFillType('gradient_linear')).toBe('GRADIENT_LINEAR')
    expect(normalizeFillType('GRADIENT_LINEAR')).toBe('GRADIENT_LINEAR')
    expect(normalizeFillType('solid')).toBe('SOLID')
    expect(normalizeFillType('SOLID')).toBe('SOLID')
    expect(normalizeFillType('image')).toBe('IMAGE')
  })

  it('conic 的各种叫法都归到 ANGULAR（Penpot 不支持，要如实降级）', () => {
    expect(normalizeFillType('gradient_angular')).toBe('GRADIENT_ANGULAR')
    expect(normalizeFillType('gradient_conic')).toBe('GRADIENT_ANGULAR')
    expect(normalizeFillType('conic')).toBe('GRADIENT_ANGULAR')
  })

  it('未知/缺失返回 UNKNOWN（调用方据此决定是否按纯色兜底）', () => {
    expect(normalizeFillType(undefined)).toBe('UNKNOWN')
    expect(normalizeFillType('')).toBe('UNKNOWN')
    expect(normalizeFillType('whatever')).toBe('UNKNOWN')
  })
})

describe('buildPenpotGradient — 几何换算', () => {
  it('linear：直接用归一化 handles（引擎的 gradientHandlePositions）', () => {
    const result = buildPenpotGradient({
      type: 'gradient_linear',
      gradientStops: [
        { position: 0, color: { r: 49, g: 239, b: 184, a: 1 } },
        { position: 1, color: { r: 67, g: 64, b: 234, a: 1 } },
      ],
      gradientHandlePositions: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.gradient.type).toBe('linear')
    expect(result.gradient.startX).toBe(0)
    expect(result.gradient.startY).toBe(0.5)
    expect(result.gradient.endX).toBe(1)
    expect(result.gradient.endY).toBe(0.5)
    expect(result.gradient.width).toBe(1)
    expect(result.gradient.stops).toEqual([
      { color: '#31EFB8', opacity: 1, offset: 0 },
      { color: '#4340EA', opacity: 1, offset: 1 },
    ])
  })

  it('linear：色标的 a 通道拆到 opacity', () => {
    const result = buildPenpotGradient({
      type: 'GRADIENT_LINEAR',
      stops: [
        { offset: 0, color: '#00000080' },
        { offset: 1, color: 'rgba(255,255,255,0.25)' },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.gradient.stops[0].color).toBe('#000000')
    expect(result.gradient.stops[0].opacity).toBeCloseTo(128 / 255, 4)
    expect(result.gradient.stops[1].opacity).toBeCloseTo(0.25, 4)
  })

  it('radial：圆心 + 半径端点 + 垂直缩放比（来自引擎的 transform[0][0]）', () => {
    const result = buildPenpotGradient({
      type: 'gradient_radial',
      gradientStops: [
        { position: 0, color: { r: 255, g: 255, b: 255, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 0, a: 0 } },
      ],
      gradientHandlePositions: [{ x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 }],
      // 引擎：fill.transform = [[rx / r, 0, 0], [0, ry / r, 0]]
      transform: [[0.5, 0, 0], [0, 1, 0]],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.gradient.type).toBe('radial')
    expect(result.gradient.startX).toBe(0.5)
    expect(result.gradient.startY).toBe(0.5)
    expect(result.gradient.endX).toBe(0.9)
    expect(result.gradient.endY).toBe(0.5)
    // 0.5 = rx / r → 椭圆比例，Penpot 用 width 字段承载
    expect(result.gradient.width).toBe(0.5)
  })

  it('conic / diamond：Penpot 没有 → 报原因并给出降级色', () => {
    const conic = buildPenpotGradient({
      type: 'gradient_angular',
      gradientStops: [
        { position: 0, color: '#31EFB8' },
        { position: 1, color: '#4340EA' },
      ],
    })
    expect(conic.ok).toBe(false)
    if (conic.ok) return
    expect(conic.reason).toMatch(/不支持 GRADIENT_ANGULAR/)
    expect(conic.fallback).toEqual({ hex: '#31EFB8', opacity: 1 })

    expect(buildPenpotGradient({ type: 'GRADIENT_DIAMOND', gradientStops: [{ position: 0, color: '#fff' }, { position: 1, color: '#000' }] }).ok).toBe(false)
  })

  it('色标不足 2 个 → 不是渐变，报原因', () => {
    const result = buildPenpotGradient({ type: 'GRADIENT_LINEAR', gradientStops: [{ position: 0, color: '#fff' }] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/至少需要 2 个色标/)
  })

  it('色值无法识别时如实报出具体色值', () => {
    const result = buildPenpotGradient({
      type: 'GRADIENT_LINEAR',
      gradientStops: [{ position: 0, color: 'rebeccapurple' }, { position: 1, color: 'chartreuse' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/rebeccapurple/)
  })

  it('色标按 offset 排序（CSS 语义与顺序无关）', () => {
    const result = buildPenpotGradient({
      type: 'GRADIENT_LINEAR',
      gradientStops: [
        { position: 1, color: '#000000' },
        { position: 0, color: '#FFFFFF' },
        { position: 0.5, color: '#808080' },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.gradient.stops.map((s) => s.offset)).toEqual([0, 0.5, 1])
  })

  it('缺 handles 时给出 Penpot 默认（水平）而不是 0', () => {
    const result = buildPenpotGradient({
      type: 'GRADIENT_LINEAR',
      gradientStops: [{ position: 0, color: '#fff' }, { position: 1, color: '#000' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([result.gradient.startX, result.gradient.startY, result.gradient.endX, result.gradient.endY]).toEqual([0, 0.5, 1, 0.5])
  })

  it('缺 position 时按顺序均分', () => {
    const result = buildPenpotGradient({
      type: 'GRADIENT_LINEAR',
      gradientStops: [{ color: '#000' }, { color: '#888' }, { color: '#fff' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.gradient.stops.map((s) => s.offset)).toEqual([0, 0.5, 1])
  })
})

describe('引擎命名兼容', () => {
  it('isFillVisible 同时认 visible 与 isVisible', () => {
    expect(isFillVisible({})).toBe(true)
    expect(isFillVisible({ visible: false })).toBe(false)
    expect(isFillVisible({ isVisible: false })).toBe(false)
    expect(isFillVisible({ visible: true, isVisible: false })).toBe(false)
  })

  it('readFillOpacity 同时认 opacity 与 alpha，且前者优先', () => {
    expect(readFillOpacity({})).toBeUndefined()
    expect(readFillOpacity({ alpha: 0.3 })).toBeCloseTo(0.3, 4)
    expect(readFillOpacity({ opacity: 0.8 })).toBeCloseTo(0.8, 4)
    expect(readFillOpacity({ opacity: 0.8, alpha: 0.3 })).toBeCloseTo(0.8, 4)
    expect(readFillOpacity({ alpha: 2 })).toBe(1) // 收在 0..1
  })
})
