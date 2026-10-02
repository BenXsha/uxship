/**
 * DSL → 语义结构 / 压缩结构 转换
 *
 * 从原始 DSL 提取设计意图，去除像素坐标和渲染噪声。
 * 输出体积约为原始 DSL 的 5-10%，适合 AI agent 直接消费。
 */
import type { DSLElement } from '../dsl-types.js'
import { filterVisibleEffects } from './effect-visibility.js'

// 代码生成不相关的 DSL 字段
const CODE_IRRELEVANT_FIELDS = new Set([
  'id', 'constraints', 'description', 'alias',
  'removed', 'expanded', 'isLocked',
])

// Fill 中代码生成不需要的字段
const FILL_IRRELEVANT_FIELDS = new Set([
  'transform', 'filters', 'ratio', 'blendMode', 'name', 'scaleMode',
])

// Effect 中代码生成不需要的字段
const EFFECT_IRRELEVANT_FIELDS = new Set([
  'visible', 'id',
])

// ============== 语义 DSL ==============

export interface SemanticComponent {
  type: string
  name: string
  children?: SemanticComponent[]
  props?: Record<string, any>
  style?: Record<string, any>
}

export function dslToSemantic(dsl: { version: string; elements: DSLElement[] }): SemanticComponent[] {
  // ---------- 视觉令牌提取（所有元素的完整样式）----------
  function extractStyle(e: DSLElement): Record<string, any> | undefined {
    const s: Record<string, any> = {}; let hasStyle = false
    if (e.fills && e.fills.length > 0) {
      const vf = e.fills.filter(f => (f as any).isVisible !== false)
      if (vf.length > 0) {
        const f = vf[0] as any
        if (f.type === 'SOLID' || f.type === 'solid') { s.background = f.color; hasStyle = true }
        else if (f.type?.toLowerCase().includes('gradient')) {
          s.gradient = { type: f.type.includes('RADIAL') ? 'radial' : 'linear', stops: (f.gradientStops || []).map((gs: any) => ({ color: gs.color, pos: gs.position })) }; hasStyle = true
        }
      }
      if (e.type === 'text') { const tf = e.fills.find(f => (f.type === 'SOLID' || f.type === 'solid') && f.color) as any; if (tf?.color) { s.color = tf.color; hasStyle = true } }
    }
    const s0 = (e.strokes?.[0] || {}) as any
    if (s0.isVisible !== false && s0.color) { s.borderColor = s0.color; if (e.strokeWidth) s.borderWidth = e.strokeWidth; hasStyle = true }
    if (e.effects) {
      // 可见性口径统一走 filterVisibleEffects（同时接受 visible / isVisible，并尊重 isEffectShow）
      const activeFx = filterVisibleEffects(e.effects)
      const sh = activeFx.filter((fx: any) => fx.type === 'DROP_SHADOW' || fx.type === 'INNER_SHADOW')
      if (sh.length > 0) {
        s.shadows = sh.map((fx: any) => ({
          type: fx.type.toLowerCase(),
          color: fx.color,
          dx: fx.offset?.x || 0,
          dy: fx.offset?.y || 0,
          blur: fx.radius || 0,
          spread: fx.spread || 0,
        }))
        hasStyle = true
      }
      // 模糊：此前语义路径完全未输出（只有逐元素路径的 addEffects 处理）
      const layerBlur = activeFx.find((fx: any) => fx.type === 'LAYER_BLUR')
      if (layerBlur) { s.blur = layerBlur.radius || 0; hasStyle = true }
      const bgBlur = activeFx.find((fx: any) => fx.type === 'BACKGROUND_BLUR')
      if (bgBlur) { s.backdropBlur = bgBlur.radius || 0; hasStyle = true }
    }
    if (e.cornerRadius && e.cornerRadius > 0) { s.borderRadius = e.cornerRadius; hasStyle = true }
    if (e.opacity !== undefined && e.opacity < 1) { s.opacity = e.opacity; hasStyle = true }
    return hasStyle ? s : undefined
  }

  // ---------- 布局令牌提取 ----------
  function layoutProps(e: DSLElement): Record<string, any> {
    const p: Record<string, any> = {}
    if (e.layoutMode) p.layoutMode = e.layoutMode
    if (e.itemSpacing) p.itemSpacing = e.itemSpacing
    if (e.paddingTop || e.paddingRight || e.paddingBottom || e.paddingLeft) {
      p.padding = [e.paddingTop || 0, e.paddingRight || 0, e.paddingBottom || 0, e.paddingLeft || 0]
    }
    if (e.mainAxisAlignItems) p.alignMain = e.mainAxisAlignItems
    if (e.crossAxisAlignItems) p.alignCross = e.crossAxisAlignItems
    if (e.flexWrap) p.flexWrap = e.flexWrap
    if (e.clipsContent) p.clipContent = true
    return p
  }

  // ---------- 递归转换：所有元素保留完整 tokens ----------
  function walk(el: DSLElement): SemanticComponent {
    const comp: SemanticComponent = {
      type: el.type === 'frame' || el.type === 'section' ? 'container' : el.type || 'element',
      name: el.name || '',
      style: extractStyle(el),
    }
    if (el.size?.width && el.size?.height) { comp.props = { ...layoutProps(el), width: el.size.width, height: el.size.height } }
    else if (Object.keys(layoutProps(el)).length > 0) { comp.props = layoutProps(el) }

    if (el.type === 'text') {
      comp.props = { ...comp.props, text: el.content || el.characters || '', fontSize: el.fontSize, align: el.textAlignHorizontal?.toLowerCase(), font: el.fontName ? `${el.fontName.family} ${el.fontName.style}` : undefined }
      Object.keys(comp.props).forEach(k => { if (comp.props![k] === undefined) delete comp.props![k] })
      return comp
    }

    if (['pen', 'path', 'ellipse', 'polygon', 'star', 'boolean_operation'].includes(el.type || '')) {
      comp.type = 'graphic'; return comp
    }

    if (el.type === 'rectangle' && el.fills?.some(f => f.type === 'IMAGE')) {
      comp.type = 'image'; const img = el.fills.find(f => f.type === 'IMAGE') as any
      if (img?.imageUrl) { comp.props = { ...comp.props, src: img.imageUrl } }
      return comp
    }

    if (el.children && el.children.length > 0) {
      comp.children = el.children.map(walk)
    }
    return comp
  }

  // ---------- 第二趟：仅保留分割线检测（视觉属性，非模式）----------
  function postProcess(comp: SemanticComponent, rawEl?: DSLElement): void {
    if (!comp.children || comp.children.length === 0) return
    for (let i = 0; i < comp.children.length; i++) {
      postProcess(comp.children[i], rawEl?.children?.[i])
    }
    // 分割线检测（基于物理尺寸，不依赖命名模式）
    const h = rawEl?.size?.height ?? 0
    const w = rawEl?.size?.width ?? 0
    const thinChild = comp.children.length === 1 && rawEl?.children?.[0]
    const thinH = thinChild && (rawEl.children![0].size?.height ?? 0) <= 3
    const thinW = thinChild && (rawEl.children![0].size?.width ?? 0) <= 2
    if ((h <= 4 || w <= 2 || thinH || thinW) && comp.children.every(c => c.type === 'graphic' || c.type === 'rectangle' || c.type === 'divider')) {
      comp.type = 'divider'; comp.children = []; return
    }
  }

  // ---------- 主流程 ----------
  const roots = dsl.elements.map(walk)
  for (let i = 0; i < roots.length; i++) {
    postProcess(roots[i], dsl.elements[i])
  }
  return roots
}

export function stripIrrelevantFields(dsl: { version: string; elements: any[] }): void {
  function walk(el: any): void {
    if (el.name && el.name.endsWith('__svg')) {
      for (const field of CODE_IRRELEVANT_FIELDS) {
        if (field !== 'id') delete el[field]
      }
    } else {
      for (const field of CODE_IRRELEVANT_FIELDS) {
        delete el[field]
      }
    }
    if (el.fills) {
      for (const fill of el.fills) {
        for (const f of FILL_IRRELEVANT_FIELDS) {
          delete fill[f]
        }
      }
    }
    if (el.effects) {
      for (const eff of el.effects) {
        for (const f of EFFECT_IRRELEVANT_FIELDS) {
          delete eff[f]
        }
      }
    }
    if (el.children) {
      for (const child of el.children) {
        walk(child)
      }
    }
  }
  for (const el of dsl.elements) {
    walk(el)
  }
}

// ============== 压缩 DSL ==============

export interface CompressedDSL {
  version: string
  stylePalette: {
    colors: Record<string, string>
    fonts: Record<string, { family: string; style: string }>
    cornerRadii: Record<string, number>
  }
  svgAssets: string[]
  tree: any[]
}

export function compressDsl(dsl: { version: string; elements: any[] }): CompressedDSL {
  const palette: CompressedDSL['stylePalette'] = { colors: {}, fonts: {}, cornerRadii: {} }
  const svgAssets: string[] = []
  let colorIdx = 0, fontIdx = 0, radiusIdx = 0

  function refColor(c: string): string {
    const key = `c${colorIdx}`; palette.colors[key] = c; colorIdx++; return key
  }

  function compressNode(el: any): any {
    if (!el || typeof el !== 'object') return el
    const node: any = { t: el.type || '?' }
    if (el.name && el.name !== el.type) node.n = el.name

    if (el.position && (el.position.x || el.position.y))
      node.p = { x: Math.round(el.position.x), y: Math.round(el.position.y) }
    if (el.size && (el.size.width || el.size.height))
      node.s = { w: Math.round(el.size.width || 0), h: Math.round(el.size.height || 0) }

    if (el.layoutMode) node.lm = el.layoutMode
    if (el.itemSpacing) node.is = el.itemSpacing
    if (el.flexWrap) node.fw = el.flexWrap
    if (el.clipsContent) node.cc = true
    if (el.paddingTop || el.paddingRight || el.paddingBottom || el.paddingLeft)
      node.pd = [el.paddingTop||0, el.paddingRight||0, el.paddingBottom||0, el.paddingLeft||0].map(Math.round)
    if (el.mainAxisAlignItems) node.ama = el.mainAxisAlignItems
    if (el.crossAxisAlignItems) node.aca = el.crossAxisAlignItems

    if (el.type === 'text') {
      node.txt = el.content || el.characters || ''
      if (el.fontSize) node.fs = Math.round(el.fontSize)
      if (el.fontName) {
        const fk = `f${fontIdx}`; palette.fonts[fk] = { family: el.fontName.family || '', style: el.fontName.style || '' }; node.fn = fk; fontIdx++
      }
      if (el.textAlignHorizontal) node.ta = el.textAlignHorizontal
      if (el.lineHeight) node.lh = el.lineHeight.value || el.lineHeight
      if (el.letterSpacing) node.ls = typeof el.letterSpacing === 'number' ? el.letterSpacing : (el.letterSpacing.value || 0)
    }

    if (el.fills && el.fills.length > 0) {
      const vf = el.fills.filter((f: any) => (f as any).isVisible !== false)
      if (vf.length > 0) {
        const f = vf[0]
        if (f.color) node.fc = refColor(f.color)
        if (f.type && (f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL' || f.type === 'gradient_linear' || f.type === 'gradient_radial'))
          node.fg = { t: f.type.includes('RADIAL') ? 'radial' : 'linear', stops: (f.gradientStops || []).map((gs: any) => ({ c: refColor(gs.color), p: gs.position })) }
        if (f.alpha !== undefined && f.alpha < 1) node.fa = f.alpha
      }
      if (el.type === 'text') {
        const tf = el.fills.find((f: any) => (f.type === 'SOLID' || f.type === 'solid') && f.color)
        if (tf?.color) node.tc = refColor(tf.color)
      }
    }
    if (el.strokes && el.strokes.length > 0) {
      const s = el.strokes[0]
      if (s.isVisible !== false && s.color) { node.sc = refColor(s.color); if (el.strokeWidth) node.sw = el.strokeWidth }
    }
    if (el.cornerRadius) { const rk = `r${radiusIdx}`; palette.cornerRadii[rk] = Math.round(el.cornerRadius); node.cr = rk; radiusIdx++ }
    if (el.opacity !== undefined && el.opacity < 1) node.op = el.opacity

    if (el.name && el.name.includes('__svg')) {
      node.sa = true; node.c = []
      return node
    }

    if (el.type === 'pen' || el.type === 'path' || el.type === 'boolean_operation' ||
        el.type === 'ellipse' || el.type === 'line' || el.type === 'polygon' || el.type === 'star') {
      return null
    }
    if (el.type === 'group') {
      const hasText = el.children?.some((c: any) => hasTextInTree(c))
      if (!hasText && !el.fills?.some((f: any) => f.color)) return null
    }
    if (el.type === 'rectangle' && !el.fills?.some((f: any) => f.isVisible !== false && f.color)) return null

    function hasTextInTree(el: any): boolean {
      if (el.type === 'text') return true
      return el.children?.some((c: any) => hasTextInTree(c)) || false
    }

    if (el.children && el.children.length > 0) {
      const cc = el.children.map(compressNode).filter(Boolean)
      if (cc.length > 0) node.c = cc
    }
    return node
  }

  return { version: dsl.version || '2.0', stylePalette: palette, svgAssets, tree: dsl.elements.map(compressNode).filter(Boolean) }
}
