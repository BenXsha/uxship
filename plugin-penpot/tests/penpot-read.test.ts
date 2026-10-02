/**
 * Penpot 原生结构 → DSL 口径（`lib/host/penpot-read.ts`）
 *
 * **夹具全部抄自真机**：下面那两段 JSON 是从一个真实 Penpot 实例上用 `node_get`
 * 抓下来的原始返回（一次 HTML+Tailwind → 画布的渲染产物）。
 *
 * 为什么要专门强调这点：这套转换存在的唯一原因，就是 MemoryHost 存的是 DSL 形状、
 * 而真 Penpot 吐的是它自己的结构 —— 用替身造夹具会永远测不出这个差异
 * （上一版就是这么漏掉的：`design/describe` 的填充摘要成了 `[""]`，
 * `dsl/export*` 在真机上会把所有颜色丢掉，而单测全绿）。
 */
import { describe, expect, it } from 'vitest'
import { fromPenpotEffects, fromPenpotFills, fromPenpotStrokes } from '@lib/host/penpot-read'

/** 真机抓取：`bg-[#0B1220]` 的纯色填充 */
const REAL_SOLID_FILL = [
  {
    fillColor: '#0b1220',
    fillOpacity: 1,
    fillColorGradient: null,
    fillColorRefFile: null,
    fillColorRefId: null,
    fillImage: null,
  },
]

/** 真机抓取：`bg-[linear-gradient(140deg,#1E1B4B,#312E81,#0B1220)]` */
const REAL_GRADIENT_FILL = [
  {
    fillColor: null,
    fillOpacity: 1,
    fillColorGradient: {
      type: 'linear',
      startX: 0.08045018441135998,
      startY: 5.551115123125783e-17,
      endX: 0.91954981558864,
      endY: 1,
      width: 1,
      stops: [
        { color: '#1e1b4b', opacity: 1, offset: 0 },
        { color: '#312e81', opacity: 1, offset: 0.5 },
        { color: '#0b1220', opacity: 1, offset: 1 },
      ],
    },
    fillColorRefFile: null,
    fillColorRefId: null,
    fillImage: null,
  },
]

/** 真机抓取：`shadow-[0_24px_64px_rgba(15,23,42,0.10)]` */
const REAL_SHADOW = [
  {
    id: 'ca3dc605-b695-80d8-8008-b788aec35422',
    style: 'drop-shadow',
    offsetX: 0,
    offsetY: 24,
    blur: 64,
    spread: 0,
    hidden: false,
    color: { color: '#0f172a', opacity: 0.1 },
  },
]

describe('填充归一化', () => {
  it('纯色：fillColor/fillOpacity → {type:SOLID, color}', () => {
    const fills = fromPenpotFills(REAL_SOLID_FILL)
    expect(fills).toHaveLength(1)
    expect(fills[0]).toMatchObject({ type: 'SOLID', color: '#0b1220', opacity: 1 })
  })

  it('渐变：fillColorGradient → GRADIENT_LINEAR + stops + handle', () => {
    const fills = fromPenpotFills(REAL_GRADIENT_FILL)
    const fill = fills[0] as Record<string, any>
    expect(fill.type).toBe('GRADIENT_LINEAR')
    expect(fill.gradientStops).toEqual([
      { position: 0, color: '#1e1b4b', opacity: 1 },
      { position: 0.5, color: '#312e81', opacity: 1 },
      { position: 1, color: '#0b1220', opacity: 1 },
    ])
    expect(fill.gradientHandlePositions[0].x).toBeCloseTo(0.0804, 3)
    expect(fill.gradientHandlePositions[1]).toEqual({ x: expect.any(Number), y: 1 })
    // width=1 → 不需要 transform（否则会给径向加上无意义的缩放）
    expect(fill.transform).toBeUndefined()
  })

  it('径向的 width≠1 → 逆变换成 transform（写入侧从 transform[0][0] 读回它）', () => {
    const fills = fromPenpotFills([
      {
        fillColor: null,
        fillOpacity: 1,
        fillColorGradient: { type: 'radial', startX: 0.5, startY: 0.5, endX: 1, endY: 0.5, width: 0.4, stops: [{ color: '#ffffff', opacity: 1, offset: 0 }] },
      },
    ])
    const fill = fills[0] as Record<string, any>
    expect(fill.type).toBe('GRADIENT_RADIAL')
    expect(fill.transform).toEqual([[0.4, 0, 0], [0, 0.4, 0]])
  })

  it('库颜色引用（样式绑定）保留下来，不被抹平成普通纯色', () => {
    const fills = fromPenpotFills([
      { fillColor: '#4f46e5', fillOpacity: 1, fillColorGradient: null, fillColorRefFile: 'file-1', fillColorRefId: 'color-9' },
    ])
    expect(fills[0]).toMatchObject({ type: 'SOLID', color: '#4f46e5', colorRef: { file: 'file-1', id: 'color-9' } })
  })

  it('未知结构不静默丢：标成 UNKNOWN 并原样带出', () => {
    const fills = fromPenpotFills([{ somethingNew: 1 }])
    expect(fills[0]).toMatchObject({ type: 'UNKNOWN', hostRaw: { somethingNew: 1 } })
  })

  it('空填充 → 空数组（没有填充是合法状态）', () => {
    expect(fromPenpotFills([])).toEqual([])
    expect(fromPenpotFills(undefined)).toEqual([])
  })
})

describe('描边归一化', () => {
  it('映射宽度与对齐（inner→INSIDE），并把 dash 样式带出来', () => {
    const strokes = fromPenpotStrokes([
      { strokeColor: '#4f46e5', strokeOpacity: 1, strokeWidth: 1, strokeStyle: 'solid', strokeAlignment: 'inner' },
      { strokeColor: '#94a3b8', strokeOpacity: 0.5, strokeWidth: 2, strokeStyle: 'dashed', strokeAlignment: 'outer' },
    ])
    expect(strokes[0]).toMatchObject({ type: 'SOLID', color: '#4f46e5', width: 1, align: 'INSIDE' })
    expect(strokes[0].strokeStyle).toBeUndefined() // solid 是默认，不写噪音
    expect(strokes[1]).toMatchObject({ width: 2, align: 'OUTSIDE', strokeStyle: 'dashed', opacity: 0.5 })
  })

  it('渐变描边走同一个渐变读取器', () => {    const strokes = fromPenpotStrokes([
      {
        strokeColorGradient: { type: 'linear', startX: 0, startY: 0, endX: 1, endY: 0, width: 1, stops: [{ color: '#ff0000', opacity: 1, offset: 0 }] },
        strokeWidth: 1,
        strokeAlignment: 'center',
      },
    ])
    expect(strokes[0]).toMatchObject({ type: 'GRADIENT_LINEAR', align: 'CENTER' })
  })

  it('线帽回读为 DSL 口径（两端都给，导出端才能还原）', () => {
    const strokes = fromPenpotStrokes([
      { strokeColor: '#111111', strokeWidth: 2, strokeCapStart: 'round', strokeCapEnd: 'round' },
    ])
    expect(strokes[0].capStart).toBe('ROUND')
    expect(strokes[0].capEnd).toBe('ROUND')
  })

  it('平头（Penpot 里是空值）→ 不写 cap 字段（不伪造 NONE）', () => {
    const strokes = fromPenpotStrokes([{ strokeColor: '#111111', strokeWidth: 2 }])
    expect(strokes[0].capStart).toBeUndefined()
    expect(strokes[0].capEnd).toBeUndefined()
  })
})

describe('效果归一化', () => {
  it('drop-shadow → DROP_SHADOW（真实阴影）', () => {
    const effects = fromPenpotEffects({ shadows: REAL_SHADOW })
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({
      type: 'DROP_SHADOW',
      offset: { x: 0, y: 24 },
      radius: 64,
      spread: 0,
      color: '#0f172a',
      opacity: 0.1,
    })
    expect(effects[0].visible).toBeUndefined() // 可见是默认，不写噪音
  })

  it('inner-shadow / 隐藏阴影都如实映射', () => {
    const effects = fromPenpotEffects({
      shadows: [{ style: 'inner-shadow', offsetX: 0, offsetY: 2, blur: 4, spread: 0, hidden: true, color: { color: '#000000', opacity: 0.2 } }],
    })
    expect(effects[0]).toMatchObject({ type: 'INNER_SHADOW', visible: false })
  })

  it('图层模糊与背景模糊（写入侧拆成两个字段）必须一起读回来', () => {
    const effects = fromPenpotEffects({ blur: { value: 8, hidden: false }, backgroundBlur: { value: 16, hidden: true } })
    expect(effects).toEqual([
      { type: 'LAYER_BLUR', radius: 8 },
      { type: 'BACKGROUND_BLUR', radius: 16, visible: false },
    ])
  })

  it('三者都空 → 空数组', () => {
    expect(fromPenpotEffects({})).toEqual([])
  })
})
