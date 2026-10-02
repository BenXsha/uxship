import { describe, it, expect } from 'vitest'
import { suggestChanges } from '../src/utils/design-suggest-engine.js'

const emptyStructure = {}

const defaultStructure = {
  layout: { direction: 'HORIZONTAL', padding: [0, 0, 0, 0] },
}

describe('suggestChanges - color', () => {
  it('matches "改成蓝色"', () => {
    const { proposals, unmatched } = suggestChanges(emptyStructure, '改成蓝色')
    expect(proposals.length).toBeGreaterThan(0)
    expect(proposals[0].type).toBe('fill')
    expect(unmatched.length).toBe(0)
  })

  it('matches "改成深蓝"', () => {
    const { proposals, unmatched } = suggestChanges(emptyStructure, '改成深蓝')
    expect(proposals.length).toBeGreaterThan(0)
    expect(proposals[0].type).toBe('fill')
    expect(unmatched.length).toBe(0)
  })

  it('matches "描边红色"', () => {
    const { proposals } = suggestChanges(emptyStructure, '描边红色')
    const strokeProp = proposals.find(p => p.type === 'stroke')
    expect(strokeProp).toBeTruthy()
  })

  it('matches hex color "#0071e3"', () => {
    const { proposals, unmatched } = suggestChanges(emptyStructure, '改成#0071e3')
    expect(proposals.length).toBeGreaterThan(0)
    expect(unmatched.length).toBe(0)
  })
})

describe('suggestChanges - padding', () => {
  it('matches "内边距16"', () => {
    const { proposals, unmatched } = suggestChanges(defaultStructure, '内边距16')
    const pad = proposals.find(p => p.type === 'padding')
    expect(pad).toBeTruthy()
    expect(pad?.properties.paddingTop).toBe(16)
  })

  it('matches "右边内边距加大"', () => {
    const { proposals, unmatched } = suggestChanges(defaultStructure, '右边内边距加大')
    const pad = proposals.find(p => p.type === 'padding')
    expect(pad).toBeTruthy()
    expect(pad?.properties.paddingRight).toBeDefined()
    expect(pad?.properties.paddingLeft).toBeUndefined()
  })

  it('matches "左边距16"', () => {
    const { proposals } = suggestChanges(defaultStructure, '左边距16')
    const pad = proposals.find(p => p.type === 'padding')
    expect(pad).toBeTruthy()
    expect(pad?.properties.paddingLeft).toBe(16)
  })
})

describe('suggestChanges - alignment', () => {
  it('matches "居中对齐"', () => {
    const { proposals, unmatched } = suggestChanges(emptyStructure, '居中对齐')
    const align = proposals.find(p => p.type === 'alignment')
    expect(align).toBeTruthy()
    expect(align?.properties.mainAxisAlignItems).toBe('CENTER')
    expect(unmatched.length).toBe(0)
  })

  it('matches "垂直居中"', () => {
    const { proposals } = suggestChanges(emptyStructure, '垂直居中')
    const cross = proposals.find(p => p.type === 'crossAxisAlignment')
    expect(cross).toBeTruthy()
    expect(cross?.properties.counterAxisAlignItems).toBe('CENTER')
  })
})

describe('suggestChanges - corner radius', () => {
  it('matches "圆角8"', () => {
    const { proposals, unmatched } = suggestChanges(emptyStructure, '圆角8')
    const r = proposals.find(p => p.type === 'cornerRadius')
    expect(r).toBeTruthy()
    expect(r?.properties.cornerRadius).toBe(8)
  })

  it('matches "圆角加大"', () => {
    const { proposals } = suggestChanges(emptyStructure, '圆角加大')
    const r = proposals.find(p => p.type === 'cornerRadius')
    expect(r).toBeTruthy()
    expect(r?.properties.cornerRadius).toBeGreaterThanOrEqual(8)
  })

  it('matches "改成圆点"', () => {
    const { proposals, unmatched } = suggestChanges(emptyStructure, '改成圆点')
    const r = proposals.find(p => p.type === 'cornerRadius')
    expect(r).toBeTruthy()
    expect(r?.properties.cornerRadius).toBe(999)
  })
})

describe('suggestChanges - composite instructions', () => {
  it('matches "圆角16居中对齐"', () => {
    const { proposals, unmatched } = suggestChanges(emptyStructure, '圆角16居中对齐')
    expect(proposals.length).toBe(2)
    const types = proposals.map(p => p.type)
    expect(types).toContain('cornerRadius')
    expect(types).toContain('alignment')
  })

  it('matches "间距加大圆角8"', () => {
    const { proposals } = suggestChanges(emptyStructure, '间距加大圆角8')
    const types = proposals.map(p => p.type)
    expect(types).toContain('spacing')
    expect(types).toContain('cornerRadius')
  })
})

describe('suggestChanges - spacing', () => {
  it('matches "间距16"', () => {
    const { proposals, unmatched } = suggestChanges(emptyStructure, '间距16')
    const gap = proposals.find(p => p.type === 'spacing')
    expect(gap).toBeTruthy()
    expect(gap?.properties.itemSpacing).toBe(16)
  })

  it('matches "间距加大"', () => {
    const { proposals } = suggestChanges(emptyStructure, '间距加大')
    const gap = proposals.find(p => p.type === 'spacing')
    expect(gap).toBeTruthy()
    expect(gap?.properties.itemSpacing).toBeGreaterThan(0)
  })
})

describe('suggestChanges - font', () => {
  it('matches "字号20"', () => {
    const { proposals, unmatched } = suggestChanges(emptyStructure, '字号20')
    const fs = proposals.find(p => p.type === 'fontSize')
    expect(fs).toBeTruthy()
    expect(fs?.properties.fontSize).toBe(20)
  })

  it('matches "加粗"', () => {
    const { proposals } = suggestChanges(emptyStructure, '加粗')
    const fw = proposals.find(p => p.type === 'fontWeight')
    expect(fw).toBeTruthy()
  })

  it('matches "字体苹方"', () => {
    const { proposals } = suggestChanges(emptyStructure, '字体苹方')
    const fn = proposals.find(p => p.type === 'fontName')
    expect(fn).toBeTruthy()
    expect(fn?.properties.fontName.family).toContain('PingFang')
  })
})

describe('suggestChanges - brand style', () => {
  it('matches "苹果风" for brand color and radius', () => {
    const { proposals } = suggestChanges(emptyStructure, '改成苹果风蓝色')
    const fill = proposals.find(p => p.type === 'fill')
    expect(fill).toBeTruthy()
  })
})

describe('suggestChanges - unmatched', () => {
  it('returns unmatched for gibberish', () => {
    const { proposals, unmatched } = suggestChanges(emptyStructure, 'asdfghjkl')
    expect(proposals.length).toBe(0)
    expect(unmatched.length).toBeGreaterThan(0)
  })
})

// ───────────────────────── 对象之间对齐 vs 容器内对齐 ─────────────────────────
//
// 这是两条完全不同的路径，之前只有容器语义 —— 于是「把这三个对象左对齐」会被理解成
// "改容器的 primaryAxisAlignItems"（错的）。判别规则写死在引擎里：
//   1. 等距/分布类词 → 只可能指对象之间；
//   2. 对齐词 + 多对象标记（对象/多个/选中/全部/互相…）→ 对象之间；
//   3. 其余保持容器语义（向后兼容，老指令行为不变）。

describe('对象之间对齐/分布（与容器内对齐区分）', () => {
  const structure = { name: 'Root', type: 'FRAME', children: [] }

  it('「把这三个对象左对齐」→ align-nodes（不是容器的 ALIGN_MAP）', () => {
    const { proposals } = suggestChanges(structure as never, '把这三个对象左对齐')
    const nodeAlign = proposals.find((p) => p.type === 'align-nodes')
    expect(nodeAlign).toBeDefined()
    expect(nodeAlign!.properties).toMatchObject({ axis: 'HORIZONTAL', direction: 'MIN' })
    expect(proposals.some((p) => p.type === 'alignment')).toBe(false)
  })

  it('「选中的对象垂直居中」→ align-nodes（垂直轴）', () => {
    const { proposals } = suggestChanges(structure as never, '选中的对象垂直居中')
    expect(proposals.find((p) => p.type === 'align-nodes')!.properties)
      .toMatchObject({ axis: 'VERTICAL', direction: 'CENTER' })
  })

  it('「这几个图层等距分布」→ distribute-nodes', () => {
    const { proposals } = suggestChanges(structure as never, '这几个图层水平等距')
    expect(proposals.find((p) => p.type === 'distribute-nodes')!.properties).toMatchObject({ axis: 'HORIZONTAL' })
  })

  it('向后兼容：「居中对齐」不带对象标记 → 仍是容器语义', () => {
    const { proposals } = suggestChanges(structure as never, '居中对齐')
    expect(proposals.find((p) => p.type === 'alignment')).toBeDefined()
    expect(proposals.some((p) => p.type === 'align-nodes')).toBe(false)
  })

  it('对象级命中时**不再**同时给容器级提案（一句话不该改两处）', () => {
    const { proposals } = suggestChanges(structure as never, '多个对象右对齐')
    expect(proposals.filter((p) => p.type === 'alignment' || p.type === 'align-nodes')).toHaveLength(1)
  })
})
