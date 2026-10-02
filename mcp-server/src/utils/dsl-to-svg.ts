/**
 * DSL → SVG 渲染器
 *
 * 将 DSL 文档渲染为清洁的 SVG 字符串（纯 SVG 元素，无 foreignObject），
 * 供插件端通过 createNodeFromSvgAsync 导入为可编辑的原生节点。
 *
 * 映射规则：
 *   rectangle → <rect>
 *   ellipse   → <ellipse>
 *   text      → <text>
 *   frame     → <g> + <rect>（背景）
 *   svg       → 直接嵌入
 */

import type { DSLElement } from '../dsl-types.js'

export interface RenderOptions {
  keepDataName?: boolean
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function parseHexColor(hex: string): { r: number; g: number; b: number; a: number } | null {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (h.length === 6) h = h + 'ff'
  if (h.length !== 8) return null
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const a = Math.round((parseInt(h.slice(6, 8), 16) / 255) * 100) / 100
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null
  return { r, g, b, a }
}

function fmtColor(c: any): string {
  if (!c) return 'none'
  if (typeof c === 'string') {
    const parsed = parseHexColor(c)
    if (parsed) {
      const a = parsed.a ?? 1
      if (a >= 1) return `rgb(${parsed.r},${parsed.g},${parsed.b})`
      return `rgba(${parsed.r},${parsed.g},${parsed.b},${a})`
    }
    return c
  }
  const r = Math.round((c.r || 0) * 255)
  const g = Math.round((c.g || 0) * 255)
  const b = Math.round((c.b || 0) * 255)
  const a = c.a ?? 1
  if (a >= 1) return `rgb(${r},${g},${b})`
  return `rgba(${r},${g},${b},${a})`
}

function fmtFill(fills: any): string | null {
  if (!fills?.length) return null
  const f = fills[0]
  if (!f) return null
  const type = (f.type || '').toLowerCase()
  if (type === 'solid' && f.color) {
    return fmtColor(f.color)
  }
  if (type.startsWith('gradient') && f.gradientStops?.length) {
    const stops = f.gradientStops.map((s: any) => {
      const c = fmtColor(s.color)
      const p = Math.round((s.position || 0) * 100)
      return `${c} ${p}%`
    }).join(', ')
    return `linear-gradient(${stops})`
  }
  return null
}

function fmtOpacity(fills: any): string | undefined {
  if (!fills?.length) return undefined
  const a = fills[0]?.color?.a
  if (a !== undefined && a < 1 && a > 0) return String(a)
  return undefined
}

function escapeXml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function makeEl(tag: string, attrs: Record<string, string | undefined>, children: string = ''): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}="${escapeXml(String(v))}"`)
    .join(' ')
  if (!children) return `    <${tag} ${a}/>`
  return `    <${tag} ${a}>\n${children}    </${tag}>`
}

function renderOne(el: any): string {
  const size = el.size || { width: 100, height: 100 }
  const w = size.width ?? 100
  const h = size.height ?? 100
  const x = el.position?.x ?? 0
  const y = el.position?.y ?? 0
  const fill = fmtFill(el.fills)
  const opacity = fmtOpacity(el.fills)
  const rx = el.cornerRadius
  const name = el.name || ''

  const common = (tag: string, extra: Record<string, string | undefined> = {}): string => {
    const style = [fill ? `fill:${fill}` : 'fill:none', opacity ? `opacity:${opacity}` : ''].filter(Boolean).join(';')
    const dn = name ? { 'data-name': name } : {}
    return makeEl(tag, { x: String(x), y: String(y), width: String(w), height: String(h), style: style || undefined, ...dn, ...extra })
  }

  switch (el.type) {
    case 'rectangle':
      return common('rect', rx !== undefined ? { rx: String(rx) } : {})

    case 'ellipse':
      return makeEl('ellipse', {
        cx: String(x + w / 2), cy: String(y + h / 2),
        rx: String(w / 2), ry: String(h / 2),
        style: fill ? `fill:${fill}` : 'fill:none',
        opacity, 'data-name': name || undefined,
      })

    case 'text': {
      const content = el.content || el.characters || ''
      const fontSize = el.fontSize || 16
      const fontWeight = el.fontWeight || 400
      const fontFamily = el.fontName?.family || 'Inter'
      const textColor = fill || '#000000'
      const align = el.textAlignHorizontal || 'left'
      const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'
      const anchorX = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x
      return makeEl('text', {
        x: String(anchorX), y: String(y + h / 2 + fontSize * 0.35),
        'font-family': fontFamily, 'font-size': `${fontSize}px`,
        'font-weight': String(fontWeight), 'fill': textColor,
        'text-anchor': anchor, opacity, 'data-name': name || undefined,
      }, `      ${escapeXml(content)}`)
    }

    case 'frame':
    case 'group': {
      const children = (el.children || []).map((c: any) => renderOne(c)).filter(Boolean).join('\n')
      if (!children && !fill) return ''
      const bg = fill ? common('rect', rx !== undefined ? { rx: String(rx) } : {}) : ''
      return `<g data-name="${escapeXml(name)}">\n${bg}${children ? '\n' + children : ''}\n    </g>`
    }

    case 'svg':
    case 'path':
    case 'pen':
      return common('path', { d: el.svgPathData || el.pathData || '' })

    default:
      return ''
  }
}

export function dslToSvg(
  elements: any[],
  _options: RenderOptions = {},
): string {
  const rendered = elements.map(e => renderOne(e)).filter(Boolean).join('\n')
  let maxW = 0; let maxH = 0
  for (const e of elements) {
    const pos = e.position || { x: 0, y: 0 }
    const size = e.size || { width: 100, height: 100 }
    maxW = Math.max(maxW, (pos.x || 0) + (size.width || 100))
    maxH = Math.max(maxH, (pos.y || 0) + (size.height || 100))
  }
  return [
    `<svg xmlns="${SVG_NS}" width="${Math.max(maxW, 100)}" height="${Math.max(maxH, 100)}" viewBox="0 0 ${Math.max(maxW, 100)} ${Math.max(maxH, 100)}">`,
    rendered,
    `</svg>`,
  ].join('\n')
}

export function dslToSvgDocument(dsl: any): any {
  const svgContent = dslToSvg(dsl.elements || [])
  return {
    version: '2.0',
    elements: [{
      type: 'svg',
      name: 'svg-render',
      svgContent,
      size: { width: 1440, height: 900 },
    }],
  }
}
