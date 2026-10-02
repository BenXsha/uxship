import type { ClientRenderNode } from './client-render-types'
import { cssColorToRgb } from './client-color-utils'

function parseSvgColor(color: string): { r: number; g: number; b: number; a: number } | null {
  if (!color || color === 'none' || color === 'transparent') return null
  return cssColorToRgb(color)
}

/**
 * 解析 SVG marker 定义，判断箭头类型
 * 返回 strokeCap 值: 'ARROW_EQUILATERAL' | 'ROUND_ARROW' | null
 */
function classifyMarker(markerEl: Element): string | null {
  const path = markerEl.querySelector('path')
  if (!path) return null
  const d = path.getAttribute('d') || ''
  if (!d) return null
  const fill = path.getAttribute('fill') || markerEl.getAttribute('fill') || 'black'
  // markerWidth/markerHeight/orient 目前不影响 strokeCap 判定，保留供后续扩展
  void markerEl.getAttribute('markerWidth')
  void markerEl.getAttribute('markerHeight')
  void markerEl.getAttribute('orient')

  const fd = d.replace(/\s+/g, ' ').trim()
  const isTriangle = /M\s+[\d.]+\s+[\d.]+\s+L\s+[\d.]+\s+[\d.]+\s+L\s+[\d.]+\s+[\d.]+\s+Z/i.test(fd)
  const isVShape = /M\s+[\d.]+\s+[\d.]+\s+L\s+[\d.]+\s+[\d.]+\s+L\s+[\d.]+\s+[\d.]+$/i.test(fd)
  const isCircle = /M\s+[\d.]+\s+[\d.]+\s+A\s+[\d.]+/.test(fd)
  const isFilled = fill !== 'none' && fill !== 'transparent'

  if (isTriangle && isFilled) return 'ARROW_EQUILATERAL'
  if (isVShape) return 'LINE_ARROW'
  if (isCircle) return 'ROUND_ARROW'
  return null
}

/**
 * 从 SVG 父元素收集 marker 定义
 */
function collectMarkers(parentEl: Element): Map<string, string> {
  const markers = new Map<string, string>()
  const defsList = parentEl.querySelectorAll('defs')
  for (const defs of defsList) {
    for (const marker of defs.querySelectorAll('marker')) {
      const id = marker.getAttribute('id')
      if (!id) continue
      const cap = classifyMarker(marker)
      if (cap) markers.set(id, cap)
      else markers.set(id, 'NONE')
    }
  }
  return markers
}

/**
 * 根据 marker 属性设置 strokeCap
 */
function applyMarkerCap(
  child: Element,
  markers: Map<string, string>,
  defaultCap: string,
  strokeColor?: { r: number; g: number; b: number; a: number } | null,
): string {
  const markerEnd = child.getAttribute('marker-end') || ''
  const markerStart = child.getAttribute('marker-start') || ''
  if (markerEnd) {
    const id = markerEnd.replace(/^url\(#/, '').replace(/\)$/, '')
    const cap = markers.get(id)
    if (cap && cap !== 'NONE') return cap
  }
  if (markerStart) {
    const id = markerStart.replace(/^url\(#/, '').replace(/\)$/, '')
    const cap = markers.get(id)
    if (cap && cap !== 'NONE') return cap
  }
  return defaultCap
}

async function extractSvgChild(
  child: Element,
  svgRect: DOMRect,
  markers: Map<string, string>,
): Promise<ClientRenderNode | null> {
  const tag = child.tagName.toLowerCase()

  const rect = child.getBoundingClientRect()
  const x = Math.round(rect.left - svgRect.left)
  const y = Math.round(rect.top - svgRect.top)
  const w = Math.round(rect.width)
  const h = Math.round(rect.height)
  if (w <= 0 && h <= 0) return null

  const cs = window.getComputedStyle(child)
  const attrOpacity = parseFloat(child.getAttribute('opacity') || '')
  const cssOpacity = parseFloat(cs.opacity)
  const fillOpacity = parseFloat(cs.fillOpacity || child.getAttribute('fill-opacity') || '')
  const strokeOpacity = parseFloat(cs.strokeOpacity || child.getAttribute('stroke-opacity') || '')
  let svgOpacity = 1
  if (attrOpacity >= 0) svgOpacity = Math.min(svgOpacity, attrOpacity)
  if (cssOpacity >= 0) svgOpacity = Math.min(svgOpacity, cssOpacity)
  if (fillOpacity >= 0) svgOpacity = Math.min(svgOpacity, fillOpacity)
  if (strokeOpacity >= 0) svgOpacity = Math.min(svgOpacity, strokeOpacity)
  const hasOpacity = svgOpacity >= 0 && svgOpacity < 1

  const svgStrokeLinecap = child.getAttribute('stroke-linecap') || cs.strokeLinecap || 'butt'
  const svgStrokeLinejoin = child.getAttribute('stroke-linejoin') || cs.strokeLinejoin || 'miter'
  const defaultStrokeCap = svgStrokeLinecap === 'round' ? 'ROUND' : svgStrokeLinecap === 'square' ? 'SQUARE' : 'NONE'

  if (tag === 'path') {
    const pathData = child.getAttribute('d') || ''
    if (!pathData) return null
    const fillColor = parseSvgColor(cs.fill)
    const strokeColor = parseSvgColor(cs.stroke)
    const strokeW = parseFloat(child.getAttribute('stroke-width') || cs.strokeWidth) || 0

    const node: ClientRenderNode = {
      type: 'pen',
      name: child.getAttribute('data-name') || 'path',
      position: { x, y },
      size: { width: w, height: h },
      layoutPositioning: 'ABSOLUTE',
      children: [],
      svgPathData: pathData,
    }
    if (hasOpacity) node.opacity = svgOpacity
    if (fillColor) node.fills = [{ type: 'solid', color: fillColor }]
    if (strokeColor && strokeW > 0) {
      node.strokes = [{ type: 'solid', color: strokeColor }]
      node.strokeWidth = strokeW
      node.strokeAlign = 'INSIDE'
      node.strokeJoin = svgStrokeLinejoin === 'round' ? 'ROUND' : svgStrokeLinejoin === 'bevel' ? 'BEVEL' : 'MITER'
      node.strokeCap = applyMarkerCap(child, markers, strokeColor ? defaultStrokeCap : 'NONE', strokeColor)
    }
    return node
  }

  if (tag === 'circle') {
    const fillColor = parseSvgColor(cs.fill)
    const strokeColor = parseSvgColor(cs.stroke)
    const strokeW = parseFloat(child.getAttribute('stroke-width') || cs.strokeWidth) || 0
    const node: ClientRenderNode = {
      type: 'ellipse',
      name: child.getAttribute('data-name') || 'circle',
      position: { x, y },
      size: { width: w, height: h },
      layoutPositioning: 'ABSOLUTE',
      children: [],
    }
    if (hasOpacity) node.opacity = svgOpacity
    if (fillColor) node.fills = [{ type: 'solid', color: fillColor }]
    if (strokeColor && strokeW > 0) {
      node.strokes = [{ type: 'solid', color: strokeColor }]
      node.strokeWidth = strokeW
      node.strokeAlign = 'INSIDE'
      node.strokeCap = defaultStrokeCap
    }
    return node
  }

  if (tag === 'rect') {
    const fillColor = parseSvgColor(cs.fill)
    const strokeColor = parseSvgColor(cs.stroke)
    const strokeW = parseFloat(child.getAttribute('stroke-width') || cs.strokeWidth) || 0
    const rx = parseFloat(child.getAttribute('rx') || '0')
    const node: ClientRenderNode = {
      type: 'rectangle',
      name: child.getAttribute('data-name') || 'rect',
      position: { x, y },
      size: { width: w, height: h },
      layoutPositioning: 'ABSOLUTE',
      children: [],
    }
    if (hasOpacity) node.opacity = svgOpacity
    if (fillColor) node.fills = [{ type: 'solid', color: fillColor }]
    if (strokeColor && strokeW > 0) {
      node.strokes = [{ type: 'solid', color: strokeColor }]
      node.strokeWidth = strokeW
      node.strokeCap = defaultStrokeCap
    }
    if (rx > 0) node.cornerRadius = rx
    return node
  }

  if (tag === 'line') {
    const strokeColor = parseSvgColor(cs.stroke)
    const strokeW = parseFloat(child.getAttribute('stroke-width') || cs.strokeWidth) || 0
    const x1 = parseFloat(child.getAttribute('x1') || '0')
    const y1 = parseFloat(child.getAttribute('y1') || '0')
    const x2 = parseFloat(child.getAttribute('x2') || '0')
    const y2 = parseFloat(child.getAttribute('y2') || '0')
    const pathData = `M ${x1} ${y1} L ${x2} ${y2}`
    const node: ClientRenderNode = {
      type: 'pen',
      name: child.getAttribute('data-name') || 'line',
      position: { x, y },
      size: { width: w, height: h },
      layoutPositioning: 'ABSOLUTE',
      children: [],
      svgPathData: pathData,
    }
    if (hasOpacity) node.opacity = svgOpacity
    if (strokeColor && strokeW > 0) {
      node.strokes = [{ type: 'solid', color: strokeColor }]
      node.strokeWidth = strokeW
      node.strokeJoin = svgStrokeLinejoin === 'round' ? 'ROUND' : svgStrokeLinejoin === 'bevel' ? 'BEVEL' : 'MITER'
      node.strokeCap = applyMarkerCap(child, markers, defaultStrokeCap, strokeColor)
    }
    return node
  }

  if (tag === 'text') {
    const content = child.textContent?.trim() || ''
    if (!content) return null
    const fontSize = parseFloat(cs.fontSize) || 12
    const fillColor = parseSvgColor(cs.fill)
    const textAnchor = child.getAttribute('text-anchor') || 'start'
    const node: ClientRenderNode = {
      type: 'text',
      name: child.getAttribute('data-name') || 'text',
      position: { x, y },
      size: { width: w, height: h },
      layoutPositioning: 'ABSOLUTE',
      children: [],
      content,
      fontSize,
      fontWeight: parseFloat(cs.fontWeight) || 400,
      fontName: { family: 'Inter', style: 'Regular' },
      textAlignHorizontal: textAnchor === 'middle' ? 'CENTER' : textAnchor === 'end' ? 'RIGHT' : 'LEFT',
      textAlignVertical: 'TOP',
      textAutoResize: 'WIDTH_AND_HEIGHT',
    }
    if (hasOpacity) node.opacity = svgOpacity
    if (fillColor) node.fills = [{ type: 'solid', color: fillColor }]
    return node
  }

  if (tag === 'ellipse') {
    const fillColor = parseSvgColor(cs.fill)
    const strokeColor = parseSvgColor(cs.stroke)
    const strokeW = parseFloat(child.getAttribute('stroke-width') || cs.strokeWidth) || 0
    const node: ClientRenderNode = {
      type: 'ellipse',
      name: child.getAttribute('data-name') || 'ellipse',
      position: { x, y },
      size: { width: w, height: h },
      layoutPositioning: 'ABSOLUTE',
      children: [],
    }
    if (hasOpacity) node.opacity = svgOpacity
    if (fillColor) node.fills = [{ type: 'solid', color: fillColor }]
    if (strokeColor && strokeW > 0) {
      node.strokes = [{ type: 'solid', color: strokeColor }]
      node.strokeWidth = strokeW
      node.strokeCap = svgStrokeLinecap === 'round' ? 'ROUND' : svgStrokeLinecap === 'square' ? 'SQUARE' : 'NONE'
    }
    return node
  }

  if (tag === 'polygon' || tag === 'polyline') {
    const points = child.getAttribute('points') || ''
    if (!points) return null
    const parts = points.trim().split(/[\s,]+/).map(parseFloat)
    if (parts.length < 4) return null
    let pathData = 'M ' + parts[0] + ' ' + parts[1]
    for (let i = 2; i < parts.length; i += 2) {
      pathData += ' L ' + parts[i] + ' ' + parts[i + 1]
    }
    if (tag === 'polygon') pathData += ' Z'
    const fillColor = parseSvgColor(cs.fill)
    const strokeColor = parseSvgColor(cs.stroke)
    const strokeW = parseFloat(child.getAttribute('stroke-width') || cs.strokeWidth) || 0
    const node: ClientRenderNode = {
      type: 'pen',
      name: child.getAttribute('data-name') || tag,
      position: { x, y },
      size: { width: w, height: h },
      layoutPositioning: 'ABSOLUTE',
      children: [],
      svgPathData: pathData,
    }
    if (hasOpacity) node.opacity = svgOpacity
    if (fillColor) node.fills = [{ type: 'solid', color: fillColor }]
    if (strokeColor && strokeW > 0) {
      node.strokes = [{ type: 'solid', color: strokeColor }]
      node.strokeWidth = strokeW
      node.strokeJoin = svgStrokeLinejoin === 'round' ? 'ROUND' : svgStrokeLinejoin === 'bevel' ? 'BEVEL' : 'MITER'
      node.strokeCap = applyMarkerCap(child, markers, defaultStrokeCap, strokeColor)
    }
    return node
  }

  return null
}

export async function extractSvgChildren(parentEl: Element, svgRect: DOMRect): Promise<ClientRenderNode[]> {
  const markers = collectMarkers(parentEl)
  return extractSvgChildrenWithMarkers(parentEl, svgRect, markers)
}

async function extractSvgChildrenWithMarkers(
  parentEl: Element,
  svgRect: DOMRect,
  markers: Map<string, string>,
): Promise<ClientRenderNode[]> {
  const nodes: ClientRenderNode[] = []
  for (const child of Array.from(parentEl.children)) {
    const tag = child.tagName.toLowerCase()
    const skipTags = ['defs', 'clippath', 'lineargradient', 'radialgradient', 'stop', 'filter', 'mask', 'pattern', 'marker', 'symbol']
    if (skipTags.includes(tag)) continue

    if (tag === 'g') {
      const flattened = await extractSvgChildrenWithMarkers(child, svgRect, markers)
      nodes.push(...flattened)
      continue
    }

    const node = await extractSvgChild(child, svgRect, markers)
    if (node) nodes.push(node)
  }
  return nodes
}
