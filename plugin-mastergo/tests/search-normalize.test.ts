import { describe, it, expect } from 'vitest'
import { normalizeSearchParams } from '../lib/api/utilHandlers'

/**
 * `normalizeSearchParams` 形状归一化测试
 *
 * 背景（真实踩坑）：旧 `handleSearchFind` 只认「一种形状」，形状不符时不报错而是**静默忽略条件**，
 * 于是 `search_nodes({ name: "绑定说明" })` 返回了 270 个无关节点、`maxSize: 55` 被忽略、
 * `colors: "#fff"` 直接崩在 `hexToRgb(undefined)`。原则是 **形状容忍 + 不认识就报错**：
 * 字符串/数字简写一律接受，其它形状一律抛中文错误（静默返回全量是最危险的失败模式）。
 */
describe('normalizeSearchParams — name', () => {
  it('字符串 → { value, matchType: contains }', () => {
    expect(normalizeSearchParams({ name: '绑定说明' }).name).toEqual({
      value: '绑定说明',
      matchType: 'contains',
    })
  })

  it('对象 → 原样保留（含 matchType）', () => {
    expect(normalizeSearchParams({ name: { value: '绑定说明', matchType: 'exact' } }).name).toEqual({
      value: '绑定说明',
      matchType: 'exact',
    })
  })

  it('对象缺 matchType 时不擅自补键（过滤逻辑自己按 contains 兜底）', () => {
    expect(normalizeSearchParams({ name: { value: '标题' } }).name).toEqual({ value: '标题' })
  })

  it('name 传数字 → 抛错且提示含 name', () => {
    expect(() => normalizeSearchParams({ name: 123 })).toThrow(/name/)
  })

  it('name.value 不是字符串 → 抛错且提示含 name', () => {
    expect(() => normalizeSearchParams({ name: { value: 123 } })).toThrow(/name/)
    expect(() => normalizeSearchParams({ name: { value: ['绑定说明'] } })).toThrow(/name/)
  })

  it('空字符串 / 空 value → 抛错（否则会匹配全部节点）', () => {
    expect(() => normalizeSearchParams({ name: '' })).toThrow(/name/)
    expect(() => normalizeSearchParams({ name: { value: '  ' } })).toThrow(/name/)
  })

  it('matchType 拼错 → 抛错（拼错会让整个 switch 落空、静默放行全部节点）', () => {
    expect(() => normalizeSearchParams({ name: { value: 'x', matchType: 'fuzzy' } })).toThrow(/matchType/)
  })
})

describe('normalizeSearchParams — colors', () => {
  it('单个字符串 → fill + tolerance 20（旧实现会崩在 hexToRgb(undefined)）', () => {
    expect(normalizeSearchParams({ colors: '#4A6CF7' }).colors).toEqual([
      { color: '#4A6CF7', type: 'fill', tolerance: 20 },
    ])
  })

  it('字符串数组 → 逐个归一化', () => {
    expect(normalizeSearchParams({ colors: ['#4A6CF7', 'rgb(0,0,0)'] }).colors).toEqual([
      { color: '#4A6CF7', type: 'fill', tolerance: 20 },
      { color: 'rgb(0,0,0)', type: 'fill', tolerance: 20 },
    ])
  })

  it('对象数组 → 保留并补 type/tolerance 默认值', () => {
    expect(
      normalizeSearchParams({ colors: [{ color: '#FF0000', type: 'stroke', tolerance: 8 }] }).colors
    ).toEqual([{ color: '#FF0000', type: 'stroke', tolerance: 8 }])
    expect(normalizeSearchParams({ colors: [{ color: '#FF0000' }] }).colors).toEqual([
      { color: '#FF0000', type: 'fill', tolerance: 20 },
    ])
  })

  it('混合数组（字符串 + 对象）都接受', () => {
    expect(normalizeSearchParams({ colors: ['#fff', { color: '#000', type: 'stroke' }] }).colors).toEqual([
      { color: '#fff', type: 'fill', tolerance: 20 },
      { color: '#000', type: 'stroke', tolerance: 20 },
    ])
  })

  it('空数组 = 没有颜色条件（保持旧语义，不报错）', () => {
    expect(normalizeSearchParams({ colors: [] }).colors).toEqual([])
  })

  it('非法 colors → 抛错且提示含 colors / 正确示例', () => {
    expect(() => normalizeSearchParams({ colors: 123 })).toThrow(/colors/)
    expect(() => normalizeSearchParams({ colors: { color: '#fff' } })).toThrow(/colors/)
    expect(() => normalizeSearchParams({ colors: ['#fff', 42] })).toThrow(/colors/)
  })

  it('对象缺 color / color 非字符串 → 抛错并给正确示例', () => {
    expect(() => normalizeSearchParams({ colors: [{ type: 'fill' }] })).toThrow(/colors\[0\]\.color/)
    expect(() => normalizeSearchParams({ colors: [{ color: 123 }] })).toThrow(/color/)
    expect(() => normalizeSearchParams({ colors: [{}] })).toThrow(/color/)
  })

  it('type 非法 / tolerance 非数字 → 抛错', () => {
    expect(() => normalizeSearchParams({ colors: [{ color: '#fff', type: 'background' }] })).toThrow(/type/)
    expect(() => normalizeSearchParams({ colors: [{ color: '#fff', tolerance: '20' }] })).toThrow(/tolerance/)
  })
})

describe('normalizeSearchParams — minSize / maxSize', () => {
  it('数字 → 宽高同值（旧实现会静默忽略）', () => {
    expect(normalizeSearchParams({ minSize: 24 }).minSize).toEqual({ width: 24, height: 24 })
    expect(normalizeSearchParams({ maxSize: 55 }).maxSize).toEqual({ width: 55, height: 55 })
  })

  it('对象 → 只保留给出的边', () => {
    expect(normalizeSearchParams({ minSize: { height: 18 } }).minSize).toEqual({ height: 18 })
    expect(normalizeSearchParams({ maxSize: { width: 640, height: 480 } }).maxSize).toEqual({
      width: 640,
      height: 480,
    })
  })

  it('非法尺寸（字符串 / 数组 / 布尔 / NaN）→ 抛错', () => {
    expect(() => normalizeSearchParams({ minSize: '18' })).toThrow(/minSize/)
    expect(() => normalizeSearchParams({ maxSize: [55] })).toThrow(/maxSize/)
    expect(() => normalizeSearchParams({ minSize: true })).toThrow(/minSize/)
    expect(() => normalizeSearchParams({ maxSize: NaN })).toThrow(/maxSize/)
  })

  it('对象里 width/height 非数字或全空 → 抛错', () => {
    expect(() => normalizeSearchParams({ minSize: { width: '18' } })).toThrow(/minSize/)
    expect(() => normalizeSearchParams({ maxSize: {} })).toThrow(/maxSize/)
  })
})

describe('normalizeSearchParams — types', () => {
  it('字符串 → 单元素数组', () => {
    expect(normalizeSearchParams({ types: 'TEXT' }).types).toEqual(['TEXT'])
  })

  it('数组 → 原样', () => {
    expect(normalizeSearchParams({ types: ['TEXT', 'FRAME'] }).types).toEqual(['TEXT', 'FRAME'])
  })

  it('非法 types → 抛错', () => {
    expect(() => normalizeSearchParams({ types: 1 })).toThrow(/types/)
    expect(() => normalizeSearchParams({ types: ['TEXT', 2] })).toThrow(/types/)
    expect(() => normalizeSearchParams({ types: '' })).toThrow(/types/)
  })
})

describe('normalizeSearchParams — select', () => {
  it('默认 true（向后兼容：老调用仍会改选区）', () => {
    expect(normalizeSearchParams({}).select).toBe(true)
    expect(normalizeSearchParams({ name: '标题' }).select).toBe(true)
  })

  it('显式 false', () => {
    expect(normalizeSearchParams({ select: false }).select).toBe(false)
  })

  it('非布尔 → 抛错（"false" 字符串也算错，避免把语义搞反）', () => {
    expect(() => normalizeSearchParams({ select: 'false' })).toThrow(/select/)
    expect(() => normalizeSearchParams({ select: 0 })).toThrow(/select/)
  })
})

describe('normalizeSearchParams — 其它字段的类型门禁', () => {
  it('hasShadow / hasBlur 非布尔 → 抛错', () => {
    expect(() => normalizeSearchParams({ hasShadow: 'true' })).toThrow(/hasShadow/)
    expect(() => normalizeSearchParams({ hasBlur: 1 })).toThrow(/hasBlur/)
    expect(normalizeSearchParams({ hasShadow: false }).hasShadow).toBe(false)
  })

  it('opacity 需要 { min, max } 且值为数字', () => {
    expect(normalizeSearchParams({ opacity: { min: 0.4 } }).opacity).toEqual({ min: 0.4 })
    expect(() => normalizeSearchParams({ opacity: 0.5 })).toThrow(/opacity/)
    expect(() => normalizeSearchParams({ opacity: {} })).toThrow(/opacity/)
    expect(() => normalizeSearchParams({ opacity: { min: '0.4' } })).toThrow(/opacity/)
  })

  it('limit 需要正整数', () => {
    expect(normalizeSearchParams({ limit: 50 }).limit).toBe(50)
    expect(() => normalizeSearchParams({ limit: '50' })).toThrow(/limit/)
    expect(() => normalizeSearchParams({ limit: 0 })).toThrow(/limit/)
    expect(() => normalizeSearchParams({ limit: -3 })).toThrow(/limit/)
    expect(() => normalizeSearchParams({ limit: 1.5 })).toThrow(/limit/)
  })
})

describe('normalizeSearchParams — 空入参', () => {
  it('未提供任何字段时只返回 select 默认值，其它字段保持 undefined', () => {
    const out = normalizeSearchParams({})
    expect(out).toEqual({ select: true })
    for (const key of ['name', 'types', 'colors', 'hasShadow', 'hasBlur', 'minSize', 'maxSize', 'opacity', 'limit']) {
      expect(out[key as keyof typeof out], `${key} 不应有值`).toBeUndefined()
    }
  })

  it('null / undefined 视为「未提供」，不是错误', () => {
    expect(normalizeSearchParams(undefined)).toEqual({ select: true })
    expect(normalizeSearchParams(null)).toEqual({ select: true })
    expect(normalizeSearchParams({ name: null, colors: null, minSize: null })).toEqual({ select: true })
  })

  it('传入非对象 → 抛错', () => {
    expect(() => normalizeSearchParams('绑定说明')).toThrow(/对象/)
    expect(() => normalizeSearchParams([])).toThrow(/对象/)
  })
})
