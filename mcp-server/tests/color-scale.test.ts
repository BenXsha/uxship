import { describe, it, expect } from 'vitest'
import { contrastRatio, deriveSystemPalette } from '../src/utils/color-scale.js'
import { dslToTokens } from '../src/utils/dsl-tokens.js'

/**
 * P2-2 色彩推导引擎：种子色 → 三层色板。
 * 纯函数，这里的断言就是它的验收口径。
 */

describe('deriveSystemPalette：结构与确定性', () => {
  it('同一 seed 恒等输出（确定性）', () => {
    const a = deriveSystemPalette('#4340EA')
    const b = deriveSystemPalette('#4340ea') // 大小写不敏感
    expect(b).toEqual(a)
  })

  it('种子色归一化为大写 #RRGGBB，并作为 primary', () => {
    const palette = deriveSystemPalette('#4340ea')
    expect(palette.seed).toBe('#4340EA')
    expect(palette.system['color.primary']).toBe('#4340EA')
    expect(palette.component['button.bg']).toBe('#4340EA')
  })

  it('reference 有完整色阶且明度单调递减（50 → 900）', () => {
    const { reference } = deriveSystemPalette('#4340EA')
    const keys = Object.keys(reference)
    expect(keys).toHaveLength(10)
    // 对黑底的对比度随亮度递减 → 50 最亮、900 最暗
    const ratios = keys.map((key) => contrastRatio(reference[key], '#000000') as number)
    for (let i = 1; i < ratios.length; i += 1) {
      expect(ratios[i]).toBeLessThan(ratios[i - 1])
    }
  })

  it('on-primary 与 semantic/component 角色齐备', () => {
    const palette = deriveSystemPalette('#4340EA')
    for (const key of ['color.on-primary', 'color.text', 'color.text-muted', 'color.border', 'color.surface', 'color.success', 'color.warning', 'color.danger']) {
      expect(palette.system[key], `缺 ${key}`).toMatch(/^#[0-9A-F]{6}$/)
    }
    for (const key of ['button.fg', 'button.bg-hover', 'input.border', 'focus.ring']) {
      expect(palette.component[key], `缺 ${key}`).toMatch(/^#[0-9A-F]{6}$/)
    }
  })
})

describe('deriveSystemPalette：可读性', () => {
  it.each(['#4340EA', '#16A34A', '#0F172A', '#FFD400', '#EC4899'])(
    'on-primary 对 primary（%s）对比度 ≥ 4.5:1',
    (seed) => {
      const palette = deriveSystemPalette(seed)
      const ratio = contrastRatio(palette.system['color.primary'], palette.system['color.on-primary']) as number
      // 深色种子选白字；浅色种子应自动选近黑字（关键：不能一律白字）
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    },
  )

  it('浅色种子（#FFD400）自动选近黑前景', () => {
    const palette = deriveSystemPalette('#FFD400')
    expect(palette.system['color.on-primary']).toBe('#0F172A')
  })

  it('极低饱和度的种子色可推导，并如实记入 notes', () => {
    const palette = deriveSystemPalette('#808080')
    expect(palette.reference['primary.600']).toMatch(/^#[0-9A-F]{6}$/)
    expect(palette.notes.join(' ')).toContain('中性灰')
  })
})

describe('deriveSystemPalette：错误处理', () => {
  it('非法种子色抛错（不做静默兜底）', () => {
    expect(() => deriveSystemPalette('not-a-color')).toThrow(/无法解析种子色/)
    expect(() => deriveSystemPalette('#12345')).toThrow()
  })
})

describe('dslToTokens 集成：有品牌色时附带 palette', () => {
  const dsl = { version: '2.0', elements: [] }

  it('传 theme.brand → 结果含 palette', () => {
    const result = dslToTokens(dsl as never, { brand: '#4340EA' })
    expect(result.palette?.seed).toBe('#4340EA')
    expect(result.palette?.system['color.primary']).toBe('#4340EA')
  })

  it('无品牌色 → 不含 palette（不凭空推导）', () => {
    const result = dslToTokens(dsl as never, {})
    expect(result.palette).toBeUndefined()
  })

  it('品牌色非法 → 不阻断导出，只记 warning', () => {
    const result = dslToTokens(dsl as never, { brand: 'oops' })
    expect(result.palette).toBeUndefined()
    expect(result.warnings.some((warning) => warning.includes('色彩推导失败'))).toBe(true)
  })
})

describe('P2-1 暗色调色板（mode: dark）', () => {
  it('reference 色阶两模式一致（色阶是原始值，不随主题变）', () => {
    const light = deriveSystemPalette('#4340EA', { mode: 'light' })
    const dark = deriveSystemPalette('#4340EA', { mode: 'dark' })
    expect(dark.reference).toEqual(light.reference)
    expect(dark.mode).toBe('dark')
  })

  it('中性色翻转：深底 + 浅字（且两者对比达标）', () => {
    const { system } = deriveSystemPalette('#4340EA', { mode: 'dark' })
    const surfaceVsWhite = contrastRatio(system['color.surface'], '#FFFFFF') as number
    const textVsWhite = contrastRatio(system['color.text'], '#FFFFFF') as number
    // surface 很暗 → 对白对比度很高；text 很亮 → 对白对比度低
    expect(surfaceVsWhite).toBeGreaterThan(10)
    expect(surfaceVsWhite).toBeGreaterThan(textVsWhite)
    expect(contrastRatio(system['color.text'], system['color.surface']) as number).toBeGreaterThanOrEqual(4.5)
  })

  it('暗色下品牌色抬亮、与深底可辨（对比 ≥ 3:1）', () => {
    const dark = deriveSystemPalette('#4340EA', { mode: 'dark' })
    expect(dark.system['color.primary']).not.toBe('#4340EA') // 抬亮后不等于种子
    expect(contrastRatio(dark.system['color.primary'], dark.system['color.surface']) as number).toBeGreaterThanOrEqual(3)
    expect(dark.notes.join(' ')).toContain('抬亮')
  })

  it('暗色 on-primary 对 primary 仍 ≥ 4.5:1', () => {
    const dark = deriveSystemPalette('#4340EA', { mode: 'dark' })
    expect(contrastRatio(dark.system['color.primary'], dark.system['color.on-primary']) as number).toBeGreaterThanOrEqual(4.5)
  })

  it('dslToTokens({brand, darkMode:true}) → palette.mode === dark', () => {
    const result = dslToTokens({ version: '2.0', elements: [] } as never, { brand: '#4340EA', darkMode: true })
    expect(result.palette?.mode).toBe('dark')
  })
})
