/**
 * DSL Token Extractor
 *
 * 从 Token 面板的 DSL 中提取设计令牌，输出为开发者资源：
 * - CSS 自定义属性（变量）
 * - Tailwind CSS 配置文件
 * - DTCG JSON (Design Token Community Group 格式)
 *
 * 输入：由 dsl_exportNode / dsl_exportSelection 导出的 Token 面板 DSL
 * 输出：结构化 token 对象 + 各格式字符串
 */

import type { DSLElement } from '../dsl-types.js'
import { deriveSystemPalette, type DerivedPalette } from './color-scale.js'

// ─── 类型定义 ───────────────────────────────────────────

export type TokenFormat = 'css' | 'tailwind' | 'dtcg'

export interface TokenCollection {
  colors: Record<string, string>
  typography: Record<string, TypographyToken>
  spacing: Record<string, number>
  shadows: Record<string, string>
  materials: Record<string, MaterialToken>
  borderRadius: Record<string, number>
  opacity: Record<string, number>
  zIndex: Record<string, number>
  motion: Record<string, number | string>
  fonts: Record<string, string>
}

interface TypographyToken {
  fontSize: number
  fontWeight: number
  fontFamily?: string
  letterSpacing?: number
  lineHeight?: number
}

interface MaterialToken {
  background: string
  shadow: string
  border?: string
}

export interface TokenExportResult {
  collection: TokenCollection
  css: string
  tailwind: string
  dtcg: string
  warnings: string[]
  /** 给定 `brand`（或 DSL 里提取到 brand）时，额外推导出的三层色板（P2-2） */
  palette?: DerivedPalette
}

// ─── 核心提取函数 ─────────────────────────────────────

export interface TokenExportOptions {
  darkMode?: boolean
  brand?: string
}

export function dslToTokens(
  dsl: { version: string; elements: DSLElement[] },
  options?: TokenExportOptions,
): TokenExportResult {
  const collection: TokenCollection = {
    colors: {},
    typography: {},
    spacing: {},
    shadows: {},
    materials: {},
    borderRadius: {},
    opacity: {},
    zIndex: {},
    motion: {},
    fonts: {},
  }
  const warnings: string[] = []

  for (const el of dsl.elements) {
    walkElement(el, collection, warnings)
  }

  const css = generateCSS(collection, options)
  const tailwind = generateTailwindConfig(collection, options)
  const dtcg = generateDTCG(collection, options)

  // P2-2：有品牌种子色就额外推导三层色板（失败不阻断导出，只记 warning）
  let palette: DerivedPalette | undefined
  const seed = options?.brand || collection.colors['brand']
  if (seed) {
    try {
      palette = deriveSystemPalette(seed, { mode: options?.darkMode ? 'dark' : 'light' })
    } catch (error) {
      warnings.push(`色彩推导失败（种子色 ${seed}）：${(error as Error).message}`)
    }
  }

  return { collection, css, tailwind, dtcg, warnings, ...(palette ? { palette } : {}) }
}

// ─── 递归遍历 ─────────────────────────────────────────

function walkElement(el: DSLElement, col: TokenCollection, warnings: string[]) {
  const name = el.name || el.attributes?.['data-name'] || ''

  if (name && isTokenElement(el, name)) {
    extractToken(el, name, col, warnings)
  }

  if (el.children) {
    for (const child of el.children) {
      walkElement(child, col, warnings)
    }
  }
}

// ─── 判断是否为 token 元素 ────────────────────────────

const COLOR_NAMES = new Set([
  'Brand Text', 'Brand Hover', 'Brand Bg',
  'Neutral Bg', 'Neutral Bg Hover', 'Neutral Bg Active',
  'Neutral Border', 'Neutral Border Hover',
  'Neutral Text Secondary', 'Neutral Text',
  'Success', 'Warning', 'Error', 'Info',
])

const TYPO_NAMES = new Set([
  'H1', 'H2', 'H3', 'H4',
  'Label 16', 'Label 14', 'Label 14 Mono',
  'Label 13', 'Label 13 Mono', 'Label 12',
  'Copy 16', 'Copy 14', 'Copy 13', 'Copy 13 Mono',
  'Button 16', 'Button 14', 'Button 12',
])

const SPACE_PREFIX = 'Space '

const FONT_PREFIX = 'Font '

function isTokenElement(el: DSLElement, name: string): boolean {
  if (COLOR_NAMES.has(name)) return true
  if (TYPO_NAMES.has(name)) return true
  if (name.startsWith(SPACE_PREFIX)) return true
  if (name.startsWith('Shadow ')) return true
  if (name.startsWith('Surface Material ') || name.startsWith('Floating Material ')) return true
  if (name.startsWith('Radius ') || name.startsWith('Opacity ') || name.startsWith('ZIndex ')) return true
  if (name.startsWith('Duration ') || name.startsWith('Easing ')) return true
  if (name.startsWith(FONT_PREFIX)) return true
  return false
}

// ─── 提取单个 token ───────────────────────────────────

function extractToken(el: DSLElement, name: string, col: TokenCollection, warnings: string[]) {
  if (COLOR_NAMES.has(name)) {
    extractColorToken(el, name, col, warnings)
  } else if (TYPO_NAMES.has(name)) {
    extractTypoToken(el, name, col)
  } else if (name.startsWith(SPACE_PREFIX)) {
    extractSpaceToken(el, name, col, warnings)
  } else if (name.startsWith('Shadow ')) {
    extractShadowToken(el, name, col, warnings)
  } else if (name.startsWith('Surface Material ') || name.startsWith('Floating Material ')) {
    extractMaterialToken(el, name, col, warnings)
  } else if (name.startsWith('Radius ')) {
    extractRadiusToken(el, name, col, warnings)
  } else if (name.startsWith('Opacity ')) {
    extractOpacityToken(el, name, col, warnings)
  } else if (name.startsWith('ZIndex ')) {
    extractZIndexToken(el, name, col, warnings)
  } else if (name.startsWith('Duration ')) {
    extractDurationToken(el, name, col, warnings)
  } else if (name.startsWith('Easing ')) {
    extractEasingToken(el, name, col, warnings)
  } else if (name.startsWith(FONT_PREFIX)) {
    extractFontToken(el, name, col, warnings)
  }
}

function extractColorToken(el: DSLElement, name: string, col: TokenCollection, warnings: string[]) {
  if (el.fills && el.fills.length > 0) {
    const fill = el.fills[0]
    let color = fill.color || ''
    if (color.startsWith('rgba') || color.startsWith('rgb')) {
      try {
        const { r, g, b, a } = hexToRgb(fillToHex(fill))
        color = rgbToHex({ r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), a })
      } catch {
        color = fill.color || '#000000'
      }
    }
    col.colors[name] = color
  } else if (el.children) {
    for (const child of el.children) {
      if (child.type === 'rectangle' && child.fills) {
        extractColorToken(child, name, col, warnings)
        return
      }
    }
    warnings.push(`Color token "${name}" has no fills`)
  } else {
    warnings.push(`Color token "${name}" has no fills`)
  }
}

function fillToHex(fill: any): string {
  if (fill.color) return fill.color
  return '#000000'
}

interface RgbObj {
  r: number
  g: number
  b: number
  a?: number
}

function hexToRgb(hex: string): RgbObj {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16)
  const g = parseInt(clean.substring(2, 4), 16)
  const b = parseInt(clean.substring(4, 6), 16)
  return { r, g, b }
}

function rgbToHex(c: RgbObj): string {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  if (c.a !== undefined && c.a < 1) {
    return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}${toHex(c.a * 255)}`
  }
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`
}

function extractTypoToken(el: DSLElement, name: string, col: TokenCollection) {
  col.typography[name] = {
    fontSize: el.fontSize || 16,
    fontWeight: el.fontWeight || 400,
    fontFamily: el.fontName?.family,
    letterSpacing: el.letterSpacing,
    lineHeight: el.lineHeight?.value,
  }
}

function extractSpaceToken(el: DSLElement, name: string, col: TokenCollection, warnings: string[]) {
  const value = el.size?.width || el.size?.height || 0
  if (value > 0) {
    const key = name.replace(SPACE_PREFIX, '').toLowerCase()
    col.spacing[key] = value
  } else if (el.children) {
    for (const child of el.children) {
      if (child.type === 'rectangle' && child.size?.width) {
        const key = name.replace(SPACE_PREFIX, '').toLowerCase()
        col.spacing[key] = child.size.width
        return
      }
    }
    warnings.push(`Spacing token "${name}" has no measurable size`)
  }
}

function extractShadowToken(el: DSLElement, name: string, col: TokenCollection, warnings: string[]) {
  if (el.effects && el.effects.length > 0) {
    const drop = el.effects.find(e => e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW')
    if (drop) {
      const offset = drop.offset || { x: 0, y: 0 }
      const radius = drop.radius || 0
      const spread = drop.spread || 0
      const color = drop.color || 'rgba(0,0,0,0.1)'
      const key = name.replace('Shadow ', '').toLowerCase()
      col.shadows[key] = `${offset.x}px ${offset.y}px ${radius}px ${spread}px ${color}`
      return
    }
  }
  warnings.push(`Shadow token "${name}" has no effects`)
}

function extractMaterialToken(el: DSLElement, name: string, col: TokenCollection, warnings: string[]) {
  const bg = el.fills?.[0]?.color || '#FFFFFF'
  const drop = el.effects?.find(e => e.type === 'DROP_SHADOW')
  let shadow = 'none'
  if (drop) {
    const off = drop.offset || { x: 0, y: 0 }
    const r = drop.radius || 0
    shadow = `${off.x}px ${off.y}px ${r}px ${drop.color || 'rgba(0,0,0,0.08)'}`
  }
  col.materials[name] = { background: bg, shadow }
}

// ─── 新 token 提取函数 ────────────────────────────────

function extractRadiusToken(el: DSLElement, name: string, col: TokenCollection, warnings: string[]) {
  // name like "Radius 4", "Radius Pill" → key: "4", "Pill"
  const key = name.replace('Radius ', '').toLowerCase()
  if (key === 'pill') { col.borderRadius['full'] = 9999; return }
  const v = parseInt(key, 10)
  if (!isNaN(v)) col.borderRadius[key] = v
}

function extractOpacityToken(el: DSLElement, name: string, col: TokenCollection, warnings: string[]) {
  // name like "Opacity 100", "Opacity 80" → percentage
  const key = name.replace('Opacity ', '')
  const pct = parseInt(key, 10)
  if (!isNaN(pct)) col.opacity[key.toLowerCase()] = pct / 100
}

function extractZIndexToken(el: DSLElement, name: string, col: TokenCollection, warnings: string[]) {
  // name like "ZIndex Dropdown", "ZIndex Modal"
  const key = name.replace('ZIndex ', '').toLowerCase()
  // value comes from the text content, e.g. "Dropdown (100)" → extract 100
  const text = el.content || el.characters || ''
  const match = text.match(/(\d+)/)
  if (match) col.zIndex[key] = parseInt(match[1], 10)
}

function extractDurationToken(el: DSLElement, name: string, col: TokenCollection, warnings: string[]) {
  // name like "Duration Fast", "Duration Normal"
  const key = name.replace('Duration ', '').toLowerCase()
  const text = el.content || el.characters || ''
  const match = text.match(/(\d+)/)
  if (match) col.motion[`duration-${key}`] = parseInt(match[1], 10)
}

function extractFontToken(el: DSLElement, name: string, col: TokenCollection, warnings: string[]) {
  // name like "Font Sans", "Font Mono" → key "sans", "mono"
  const key = name.replace(FONT_PREFIX, '').toLowerCase()
  const text = (el.content || el.characters || '').trim()
  if (text) {
    col.fonts[key] = text
  }
}

function extractEasingToken(el: DSLElement, name: string, col: TokenCollection, warnings: string[]) {
  // name like "Easing In", "Easing Out" → key "in", "out", "in-out"
  const key = name.replace('Easing ', '').replace(' ', '-').toLowerCase()
  const text = el.content || el.characters || ''
  const easing = text.includes('ease-in-out') ? 'cubic-bezier(0.4, 0, 0.2, 1)' :
    text.includes('ease-out') ? 'cubic-bezier(0, 0, 0.2, 1)' :
    text.includes('ease-in') ? 'cubic-bezier(0.4, 0, 1, 1)' : text.trim()
  col.motion[`easing-${key}`] = easing
}

// ─── CSS 变量生成 ─────────────────────────────────────

function generateCSS(col: TokenCollection, options?: TokenExportOptions): string {
  const lines: string[] = [':root {']
  if (Object.keys(col.colors).length > 0) {
    lines.push('  /* Colors */')
    for (const [name, value] of Object.entries(col.colors)) {
      lines.push(`  --color-${cssKey(name)}: ${value};`)
    }
  }
  if (Object.keys(col.typography).length > 0) {
    lines.push('')
    lines.push('  /* Typography */')
    for (const [name, value] of Object.entries(col.typography)) {
      const k = cssKey(name)
      lines.push(`  --font-size-${k}: ${value.fontSize}px;`)
      lines.push(`  --font-weight-${k}: ${value.fontWeight};`)
      if (value.fontFamily) lines.push(`  --font-family-${k}: ${value.fontFamily};`)
      if (value.letterSpacing) lines.push(`  --letter-spacing-${k}: ${value.letterSpacing}px;`)
      if (value.lineHeight) lines.push(`  --line-height-${k}: ${value.lineHeight}px;`)
    }
  }
  if (Object.keys(col.spacing).length > 0) {
    lines.push('')
    lines.push('  /* Spacing */')
    for (const [name, value] of Object.entries(col.spacing)) {
      lines.push(`  --space-${cssKey(name)}: ${value}px;`)
    }
    // Semantic aliases: map numeric spacing to xs/sm/md/lg/xl
    const sorted = Object.entries(col.spacing).sort((a, b) => a[1] - b[1])
    const semanticKeys = ['xs', 'sm', 'md', 'lg', 'xl']
    semanticKeys.forEach((key, i) => {
      if (sorted[i]) lines.push(`  --space-${key}: ${sorted[i][1]}px;`)
    })
  }
  if (Object.keys(col.shadows).length > 0) {
    lines.push('')
    lines.push('  /* Shadows */')
    for (const [name, value] of Object.entries(col.shadows)) {
      lines.push(`  --shadow-${cssKey(name)}: ${value};`)
    }
  }
  if (Object.keys(col.materials).length > 0) {
    lines.push('')
    lines.push('  /* Materials */')
    for (const [name, value] of Object.entries(col.materials)) {
      const k = cssKey(name)
      lines.push(`  --material-${k}-bg: ${value.background};`)
      lines.push(`  --material-${k}-shadow: ${value.shadow};`)
    }
  }
  if (Object.keys(col.borderRadius).length > 0) {
    lines.push('')
    lines.push('  /* Border Radius */')
    for (const [name, value] of Object.entries(col.borderRadius)) {
      lines.push(`  --radius-${cssKey(name)}: ${value}px;`)
    }
  }
  if (Object.keys(col.opacity).length > 0) {
    lines.push('')
    lines.push('  /* Opacity */')
    for (const [name, value] of Object.entries(col.opacity)) {
      lines.push(`  --opacity-${cssKey(name)}: ${value};`)
    }
  }
  if (Object.keys(col.zIndex).length > 0) {
    lines.push('')
    lines.push('  /* Z-Index */')
    for (const [name, value] of Object.entries(col.zIndex)) {
      lines.push(`  --z-index-${cssKey(name)}: ${value};`)
    }
  }
  if (Object.keys(col.motion).length > 0) {
    lines.push('')
    lines.push('  /* Motion */')
    for (const [name, value] of Object.entries(col.motion)) {
      lines.push(`  --motion-${cssKey(name)}: ${value};`)
    }
  }
  if (Object.keys(col.fonts).length > 0) {
    lines.push('')
    lines.push('  /* Font Families */')
    for (const [name, value] of Object.entries(col.fonts)) {
      lines.push(`  --font-${cssKey(name)}: ${value};`)
    }
  }
  if (Object.keys(col.shadows).length > 0) {
    lines.push('')
    lines.push('  /* Elevation (semantic) */')
    const elevationMap: Record<string, string> = {
      'surface': col.shadows['sm'] || 'none',
      'floating': col.shadows['md'] || col.shadows['sm'] || '0 4px 6px rgba(0,0,0,0.07)',
      'overlay': col.shadows['lg'] || col.shadows['md'] || '0 10px 25px rgba(0,0,0,0.10)',
      'dialog': col.shadows['xl'] || col.shadows['lg'] || '0 20px 25px rgba(0,0,0,0.15)',
    }
    for (const [level, shadow] of Object.entries(elevationMap)) {
      lines.push(`  --elevation-${level}: ${shadow};`)
    }
  }
  lines.push('}')

  // Utility classes for transition & animation
  const hasDuration = Object.keys(col.motion).some(k => k.startsWith('duration-'))
  const hasEasing = Object.keys(col.motion).some(k => k.startsWith('easing-'))
  if (hasDuration && hasEasing) {
    const durFast = col.motion['duration-fast'] || 150
    const durNormal = col.motion['duration-normal'] || 250
    const durSlow = col.motion['duration-slow'] || 400
    const easeOut = col.motion['easing-out'] || 'cubic-bezier(0, 0, 0.2, 1)'
    const easeIn = col.motion['easing-in'] || 'cubic-bezier(0.4, 0, 1, 1)'
    const easeInOut = col.motion['easing-in-out'] || 'cubic-bezier(0.4, 0, 0.2, 1)'
    lines.push('')
    lines.push('/* Transition utilities */')
    lines.push(`.transition-fast { transition: all ${durFast}ms ${easeOut}; }`)
    lines.push(`.transition-normal { transition: all ${durNormal}ms ${easeOut}; }`)
    lines.push(`.transition-slow { transition: all ${durSlow}ms ${easeOut}; }`)
    lines.push('')
    lines.push('/* Animation keyframes */')
    lines.push('@keyframes fadeIn {')
    lines.push('  from { opacity: 0; }')
    lines.push('  to { opacity: 1; }')
    lines.push('}')
    lines.push(`.animate-fade-in { animation: fadeIn ${durNormal}ms ${easeOut}; }`)
    lines.push('@keyframes fadeOut {')
    lines.push('  from { opacity: 1; }')
    lines.push('  to { opacity: 0; }')
    lines.push('}')
    lines.push(`.animate-fade-out { animation: fadeOut ${durFast}ms ${easeIn}; }`)
    lines.push('@keyframes slideUp {')
    lines.push('  from { opacity: 0; transform: translateY(8px); }')
    lines.push('  to { opacity: 1; transform: translateY(0); }')
    lines.push('}')
    lines.push(`.animate-slide-up { animation: slideUp ${durNormal}ms ${easeOut}; }`)
    lines.push('@keyframes slideDown {')
    lines.push('  from { opacity: 0; transform: translateY(-8px); }')
    lines.push('  to { opacity: 1; transform: translateY(0); }')
    lines.push('}')
    lines.push(`.animate-slide-down { animation: slideDown ${durNormal}ms ${easeOut}; }`)
    lines.push('@keyframes scaleIn {')
    lines.push('  from { opacity: 0; transform: scale(0.95); }')
    lines.push('  to { opacity: 1; transform: scale(1); }')
    lines.push('}')
    lines.push(`.animate-scale-in { animation: scaleIn ${durNormal}ms ${easeOut}; }`)
  }

  // Focus ring utility
  if (Object.keys(col.colors).length > 0) {
    const focusRingColor = col.colors['brand'] || '#4340EA'
    lines.push('')
    lines.push('/* Focus ring */')
    lines.push(`.focus-ring { outline: 2px solid ${focusRingColor}; outline-offset: 2px; }`)
    lines.push(`.focus-ring-inset { outline: 2px solid ${focusRingColor}; outline-offset: -2px; }`)
  }

  // Dark mode override
  if (options?.darkMode) {
    const brand = options.brand || col.colors['brand'] || '#4340EA'
    const dark = deriveDarkTokensSimple(brand, col)
    lines.push('')
    lines.push('/* Dark mode overrides */')
    lines.push('.dark {')
    for (const [key, value] of Object.entries(dark)) {
      lines.push(`  ${value}`)
    }
    lines.push('}')
  }

  return lines.join('\n')
}

function deriveDarkTokensSimple(brand: string, col: TokenCollection): Record<string, string> {
  const tokens: Record<string, string> = {}
  const bR = parseInt(brand.slice(1, 3), 16)
  const bG = parseInt(brand.slice(3, 5), 16)
  const bB = parseInt(brand.slice(5, 7), 16)
  const brandLight = `rgba(${bR},${bG},${bB},0.2)`
  const luminance = (0.299 * bR + 0.587 * bG + 0.114 * bB) / 255
  const brandHover = luminance > 0.5
    ? `rgb(${Math.max(0, bR - 30)},${Math.max(0, bG - 30)},${Math.max(0, bB - 30)})`
    : `rgb(${Math.min(255, bR + 30)},${Math.min(255, bG + 30)},${Math.min(255, bB + 30)})`

  const darkMap: Record<string, string> = {
    'brand': brand,
    'brand-hover': brandHover,
    'brand-light': brandLight,
    'neutral-bg': '#131426',
    'neutral-bg-hover': '#1E1F32',
    'neutral-bg-active': '#2A2B3E',
    'neutral-border': '#3F3F50',
    'neutral-border-hover': brand,
    'neutral-text-secondary': '#9CA3AF',
    'neutral-text': '#E4E4E7',
    'neutral-text-title': '#FFFFFF',
    'success': '#4ADE80',
    'success-bg': 'rgba(34,197,94,0.1)',
    'warning': '#FBBF24',
    'warning-bg': 'rgba(245,158,11,0.1)',
    'error': '#F87171',
    'error-bg': 'rgba(239,68,68,0.15)',
    'info': '#60A5FA',
    'info-bg': 'rgba(59,130,246,0.1)',
  }
  for (const [key, value] of Object.entries(darkMap)) {
    if (col.colors[key] || col.colors[key.replace('-bg', '')] || key.startsWith('neutral-') || key.startsWith('brand')) {
      tokens[key] = `--color-${key}: ${value};`
    }
  }
  // Surface colors
  if (col.colors['neutral-bg']) {
    tokens['surface-1'] = '--color-surface-1: #1A1B2E;'
    tokens['surface-2'] = '--color-surface-2: #2A2B3E;'
    tokens['surface-hover'] = '--color-surface-hover: #2A2B3E;'
    tokens['surface-active'] = '--color-surface-active: #3F3F50;'
    tokens['overlay'] = '--color-overlay: rgba(0,0,0,0.6);'
  }
  return tokens
}

function getDarkColorMap(brand: string): Record<string, string> {
  const bR = parseInt(brand.slice(1, 3), 16)
  const bG = parseInt(brand.slice(3, 5), 16)
  const bB = parseInt(brand.slice(5, 7), 16)
  const luminance = (0.299 * bR + 0.587 * bG + 0.114 * bB) / 255
  const brandHover = luminance > 0.5
    ? `rgb(${Math.max(0, bR - 30)},${Math.max(0, bG - 30)},${Math.max(0, bB - 30)})`
    : `rgb(${Math.min(255, bR + 30)},${Math.min(255, bG + 30)},${Math.min(255, bB + 30)})`
  return {
    'neutral-bg': '#131426',
    'neutral-bg-hover': '#1E1F32',
    'neutral-bg-active': '#2A2B3E',
    'neutral-bg-surface': '#1A1B2E',
    'neutral-border': '#3F3F50',
    'neutral-border-hover': brand,
    'neutral-text': '#E4E4E7',
    'neutral-text-secondary': '#9CA3AF',
    'neutral-text-title': '#FFFFFF',
    'brand': brand,
    'brand-hover': brandHover,
    'brand-light': `rgba(${bR},${bG},${bB},0.2)`,
    'success': '#4ADE80',
    'success-bg': 'rgba(34,197,94,0.1)',
    'warning': '#FBBF24',
    'warning-bg': 'rgba(245,158,11,0.1)',
    'error': '#F87171',
    'error-bg': 'rgba(239,68,68,0.15)',
    'info': '#60A5FA',
    'info-bg': 'rgba(59,130,246,0.1)',
  }
}

function adjustAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function cssKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

// ─── Tailwind Config 生成 ──────────────────────────────

function generateTailwindConfig(col: TokenCollection, options?: TokenExportOptions): string {
  const lines: string[] = [
    '/** @type {import(\'tailwindcss\').Config} */',
    'module.exports = {',
  ]

  if (options?.darkMode) {
    lines.push('  darkMode: \'class\',')
  }

  lines.push('  theme: {')
  lines.push('    extend: {')

  // Colors
  if (Object.keys(col.colors).length > 0) {
    lines.push('      colors: {')
    const groups: Record<string, Record<string, string>> = {}
    for (const [name, value] of Object.entries(col.colors)) {
      const parts = name.split(/\s+/)
      const group = parts[0].toLowerCase()
      const shade = parts.slice(1).join('-').toLowerCase()
      if (!groups[group]) groups[group] = {}
      groups[group][shade || 'DEFAULT'] = value
    }
    for (const [group, shades] of Object.entries(groups)) {
      lines.push(`        ${group}: {`)
      for (const [shade, value] of Object.entries(shades)) {
        lines.push(`          '${shade}': '${value}',`)
      }
      lines.push('        },')
    }
    lines.push('      },')
  }

  // Dark mode color variants
  if (options?.darkMode) {
    const brand = options.brand || col.colors['brand'] || '#4340EA'
    const darkCols = getDarkColorMap(brand)
    lines.push('      darkColors: {')
    const darkGroups: Record<string, Record<string, string>> = {}
    for (const [name, value] of Object.entries(darkCols)) {
      const key = name.replace(/-/g, '-')
      const parts = key.split('-')
      const group = parts[0]
      const shade = parts.slice(1).join('-') || 'DEFAULT'
      if (!darkGroups[group]) darkGroups[group] = {}
      darkGroups[group][shade] = value
    }
    for (const [group, shades] of Object.entries(darkGroups)) {
      lines.push(`        ${group}: {`)
      for (const [shade, value] of Object.entries(shades)) {
        lines.push(`          '${shade}': '${value}',`)
      }
      lines.push('        },')
    }
    lines.push('      },')
    lines.push('      backgroundColor: {')
    lines.push('        dark: {')
    lines.push("          DEFAULT: '#131426',")
    lines.push("          hover: '#1E1F32',")
    lines.push("          active: '#2A2B3E',")
    lines.push("          surface: '#1A1B2E',")
    lines.push('        },')
    lines.push('      },')
    lines.push('      textColor: {')
    lines.push('        dark: {')
    lines.push("          primary: '#E4E4E7',")
    lines.push("          secondary: '#9CA3AF',")
    lines.push("          title: '#FFFFFF',")
    lines.push('        },')
    lines.push('      },')
    lines.push('      borderColor: {')
    lines.push('        dark: {')
    lines.push("          DEFAULT: '#3F3F50',")
    lines.push("          hover: brand,")
    lines.push('        },')
    lines.push('      },')
  }

  // Spacing
  if (Object.keys(col.spacing).length > 0) {
    lines.push('      spacing: {')
    for (const [name, value] of Object.entries(col.spacing)) {
      lines.push(`        '${name}': '${value}px',`)
    }
    lines.push('      },')
  }

  // Font sizes
  if (Object.keys(col.typography).length > 0) {
    lines.push('      fontSize: {')
    for (const [name, value] of Object.entries(col.typography)) {
      const k = cssKey(name)
      const lh = value.lineHeight ? `${value.lineHeight}px` : '1.5'
      lines.push(`        '${k}': ['${value.fontSize}px', { fontWeight: '${value.fontWeight}', lineHeight: '${lh}' }],`)
    }
    lines.push('      },')
  }

  // Box shadow
  if (Object.keys(col.shadows).length > 0) {
    lines.push('      boxShadow: {')
    for (const [name, value] of Object.entries(col.shadows)) {
      lines.push(`        '${name}': '${value}',`)
    }
    lines.push('      },')
  }

  // Border radius
  if (Object.keys(col.borderRadius).length > 0) {
    lines.push('      borderRadius: {')
    for (const [name, value] of Object.entries(col.borderRadius)) {
      lines.push(`        '${name}': '${value}px',`)
    }
    lines.push('      },')
  }

  // Opacity
  if (Object.keys(col.opacity).length > 0) {
    lines.push('      opacity: {')
    for (const [name, value] of Object.entries(col.opacity)) {
      lines.push(`        '${name}': '${value}',`)
    }
    lines.push('      },')
  }

  // Z-Index
  if (Object.keys(col.zIndex).length > 0) {
    lines.push('      zIndex: {')
    for (const [name, value] of Object.entries(col.zIndex)) {
      lines.push(`        '${name}': '${value}',`)
    }
    lines.push('      },')
  }

  // Font families
  if (Object.keys(col.fonts).length > 0) {
    lines.push('      fontFamily: {')
    for (const [name, value] of Object.entries(col.fonts)) {
      lines.push(`        '${name}': ${value},`)
    }
    lines.push('      },')
  }

  // Motion
  if (Object.keys(col.motion).length > 0) {
    lines.push('      transitionDuration: {')
    const durations = Object.entries(col.motion).filter(([k]) => k.startsWith('duration-'))
    for (const [name, value] of durations) {
      lines.push(`        '${name.replace('duration-', '')}': '${value}ms',`)
    }
    lines.push('      },')
  }

  lines.push('    },')
  lines.push('  },')
  lines.push('}')
  return lines.join('\n')
}

// ─── DTCG JSON 生成 ───────────────────────────────────

interface DTCGToken {
  $value: string | number | Record<string, string | number>
  $type: string
  $description?: string
  $extensions?: Record<string, any>
}

function generateDTCG(col: TokenCollection, options?: TokenExportOptions): string {
  const tokens: Record<string, Record<string, DTCGToken>> = {}

  // Color
  if (Object.keys(col.colors).length > 0) {
    tokens.color = {}
    for (const [name, value] of Object.entries(col.colors)) {
      tokens.color[cssKey(name)] = {
        $value: value,
        $type: 'color',
        $description: name,
      }
    }
  }

  // Dark color tokens
  if (options?.darkMode) {
    const brand = options.brand || col.colors['brand'] || '#4340EA'
    const darkCols = getDarkColorMap(brand)
    tokens.dark = {}
    for (const [name, value] of Object.entries(darkCols)) {
      tokens.dark[cssKey(name)] = {
        $value: value,
        $type: 'color',
        $description: `Dark: ${name}`,
      }
    }
    tokens.dark['surface-1'] = { $value: '#1A1B2E', $type: 'color', $description: 'Dark surface level 1' }
    tokens.dark['surface-2'] = { $value: '#2A2B3E', $type: 'color', $description: 'Dark surface level 2' }
    tokens.dark['overlay'] = { $value: 'rgba(0,0,0,0.6)', $type: 'color', $description: 'Dark overlay' }
  }

  // Typography
  if (Object.keys(col.typography).length > 0) {
    tokens.typography = {}
    for (const [name, value] of Object.entries(col.typography)) {
      tokens.typography[cssKey(name)] = {
        $value: {
          fontSize: `${value.fontSize}px`,
          fontWeight: value.fontWeight,
          fontFamily: value.fontFamily || 'sans-serif',
          lineHeight: value.lineHeight ? `${value.lineHeight}px` : '1.5',
        },
        $type: 'typography',
        $description: name,
      }
    }
  }

  // Spacing
  if (Object.keys(col.spacing).length > 0) {
    tokens.spacing = {}
    for (const [name, value] of Object.entries(col.spacing)) {
      tokens.spacing[cssKey(name)] = {
        $value: `${value}px`,
        $type: 'dimension',
        $description: `Space ${name}`,
      }
    }
  }

  // Shadow
  if (Object.keys(col.shadows).length > 0) {
    tokens.shadow = {}
    for (const [name, value] of Object.entries(col.shadows)) {
      tokens.shadow[cssKey(name)] = {
        $value: value,
        $type: 'shadow',
        $description: `Shadow ${name}`,
      }
    }
  }

  // Border radius
  if (Object.keys(col.borderRadius).length > 0) {
    tokens.borderRadius = {}
    for (const [name, value] of Object.entries(col.borderRadius)) {
      tokens.borderRadius[name] = {
        $value: `${value}px`,
        $type: 'dimension',
        $description: `Radius ${name}`,
      }
    }
  }

  // Opacity
  if (Object.keys(col.opacity).length > 0) {
    tokens.opacity = {}
    for (const [name, value] of Object.entries(col.opacity)) {
      tokens.opacity[name] = {
        $value: value,
        $type: 'number',
        $description: `Opacity ${name}`,
      }
    }
  }

  // Z-Index
  if (Object.keys(col.zIndex).length > 0) {
    tokens.zIndex = {}
    for (const [name, value] of Object.entries(col.zIndex)) {
      tokens.zIndex[name] = {
        $value: value,
        $type: 'number',
        $description: `Z-Index ${name}`,
      }
    }
  }

  // Font families
  if (Object.keys(col.fonts).length > 0) {
    tokens.fontFamily = {}
    for (const [name, value] of Object.entries(col.fonts)) {
      tokens.fontFamily[name] = {
        $value: value,
        $type: 'fontFamily',
        $description: `Font ${name}`,
      }
    }
  }

  // Motion
  if (Object.keys(col.motion).length > 0) {
    tokens.motion = {}
    for (const [name, value] of Object.entries(col.motion)) {
      tokens.motion[name] = {
        $value: value,
        $type: name.startsWith('duration-') ? 'duration' : 'cubicBezier',
        $description: name,
      }
    }
  }

  return JSON.stringify({ $schema: 'https://design-tokens.org/format/v1.0', tokens }, null, 2)
}
