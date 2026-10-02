import { ref, readonly } from 'vue'
import { cssColorToRgb, parseBorderRadius, parseBoxShadow, getFontStyle } from './client-color-utils'
import { extractSvgChildren } from './svg-extractor'
import { applyTailwindToTree } from './tailwind-resolver'
import { resolveDataIcons, resolveBgImageData, waitForImages } from './icon-resolver'
import { parseInstanceOverrides } from './client-override-attrs'
import type { ClientRenderNode, ClientRenderState } from './client-render-types'

export function useClientRender() {
  const state = ref<ClientRenderState>({
    isRendering: false,
    progress: '',
    error: null,
  })

  // 图片 base64 缓存，避免同一 URL 重复 Canvas 处理（跨函数共享）
  const imageDataCache = new Map<string, string>()

  function resetState() {
    state.value = { isRendering: false, progress: '', error: null }
  }

  function splitGradientStops(stopsStr: string): string[] {
    const result: string[] = []
    let current = ''
    let parenDepth = 0
    for (const ch of stopsStr) {
      if (ch === '(') { parenDepth++; current += ch }
      else if (ch === ')') { parenDepth--; current += ch }
      else if (ch === ',' && parenDepth === 0) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    if (current.trim()) result.push(current.trim())
    return result
  }

  function parseGradientStops(stopsStr: string): { position: number; color: string }[] {
    const parts = splitGradientStops(stopsStr)
    if (parts.length === 0) return []
    if (parts.length === 1) {
      const color = parts[0].trim()
      return [{ position: 0, color }, { position: 1, color }]
    }
    const stops: { position: number; color: string }[] = []
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim()
      const posMatch = part.match(/^(.*?)\s+(\d+(?:\.\d+)?%)$/)
      if (posMatch) {
        stops.push({ color: posMatch[1].trim(), position: parseFloat(posMatch[2]) / 100 })
      } else {
        stops.push({ color: part, position: parts.length > 1 ? i / (parts.length - 1) : 0 })
      }
    }
    return stops
  }

  function angleToHandlePositions(angleDeg: number): { x: number; y: number }[] {
    const rad = (90 - angleDeg) * Math.PI / 180
    const dx = Math.cos(rad)
    const dy = -Math.sin(rad)
    let tMin = -Infinity
    let tMax = Infinity
    if (dx !== 0) {
      const tLeft = -0.5 / dx, tRight = 0.5 / dx
      tMin = Math.max(tMin, Math.min(tLeft, tRight))
      tMax = Math.min(tMax, Math.max(tLeft, tRight))
    }
    if (dy !== 0) {
      const tTop = -0.5 / dy, tBottom = 0.5 / dy
      tMin = Math.max(tMin, Math.min(tTop, tBottom))
      tMax = Math.min(tMax, Math.max(tTop, tBottom))
    }
    return [
      { x: 0.5 + tMin * dx, y: 0.5 + tMin * dy },
      { x: 0.5 + tMax * dx, y: 0.5 + tMax * dy },
    ]
  }

  function fixTransparentStops(stops: { position: number; color: { r: number; g: number; b: number; a: number } }[]): void {
    for (let i = 0; i < stops.length; i++) {
      const c = stops[i].color
      if (c.a === 0 && c.r === 0 && c.g === 0 && c.b === 0) {
        let nearest = -1
        let minDist = Infinity
        for (let j = 0; j < stops.length; j++) {
          if (j !== i && stops[j].color.a > 0) {
            const dist = Math.abs(stops[j].position - stops[i].position)
            if (dist < minDist) { minDist = dist; nearest = j }
          }
        }
        if (nearest >= 0) {
          stops[i].color = { ...stops[nearest].color, a: 0 }
        }
      }
    }
  }

  function splitCSSLayers(value: string): string[] {
    const layers: string[] = []
    let depth = 0
    let current = ''
    for (const ch of value) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
      if (ch === ',' && depth === 0) {
        layers.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    if (current.trim()) layers.push(current.trim())
    return layers
  }

  function parseCSSGradient(str: string): { type: string; gradientStops: { position: number; color: { r: number; g: number; b: number; a: number } }[]; gradientHandlePositions: { x: number; y: number }[]; _centerOffsetX?: number; _centerOffsetY?: number; _sizeW?: number; _sizeH?: number } | null {
    const clean = str.trim()
    if (clean.startsWith('linear-gradient(')) {
      const match = clean.match(/linear-gradient\((.+)\)/)
      if (!match) return null
      let inner = match[1]
      let angleDeg = 180
      let stopsStr = inner

      const angleMatch = inner.match(/^\s*(\d+)deg\s*,\s*(.*)/)
      if (angleMatch) {
        angleDeg = parseFloat(angleMatch[1])
        stopsStr = angleMatch[2]
      } else {
        const kwMatch = inner.match(/^\s*to\s+(\S+(?:\s+\S+)?)\s*,\s*(.*)/)
        if (kwMatch) {
          const dirMap: Record<string, number> = { bottom: 180, top: 0, right: 90, left: 270, 'bottom right': 135, 'bottom left': 225, 'top right': 45, 'top left': 315, 'right bottom': 135, 'left bottom': 225, 'right top': 45, 'left top': 315 }
          angleDeg = dirMap[kwMatch[1]] ?? 180
          stopsStr = kwMatch[2]
        }
      }

      const stops = parseGradientStops(stopsStr).map(s => ({ ...s, color: cssColorToRgb(s.color) || { r: 0, g: 0, b: 0, a: 1 } }))
      if (!stops.length) return null
      fixTransparentStops(stops)

      return {
        type: 'gradient_linear',
        gradientStops: stops,
        gradientHandlePositions: angleToHandlePositions(angleDeg),
      }
    }

    if (clean.startsWith('radial-gradient(')) {
      const match = clean.match(/radial-gradient\((.+)\)/)
      if (!match) return null
      let inner = match[1]

      let cx = 0.5, cy = 0.5
      let explicitW: number | undefined, explicitH: number | undefined

      const ellipseSizeMatch = inner.match(/(?:ellipse\s+)?(\d+)px\s+(\d+)px/)
      if (ellipseSizeMatch) {
        explicitW = parseInt(ellipseSizeMatch[1], 10)
        explicitH = parseInt(ellipseSizeMatch[2], 10)
      } else {
        const circleSizeMatch = inner.match(/circle\s+(\d+)px/)
        if (circleSizeMatch) {
          const r = parseInt(circleSizeMatch[1], 10)
          explicitW = r * 2
          explicitH = r * 2
        }
      }

      const atMatch = inner.match(/at\s+(\d+(?:\.\d+)?%)\s+(\d+(?:\.\d+)?%)\s*,\s*(.*)/)
      if (atMatch) {
        cx = parseFloat(atMatch[1]) / 100
        cy = parseFloat(atMatch[2]) / 100
        inner = atMatch[3]
      } else {
        const centerMatch = inner.match(/at\s+center\s*,\s*(.*)/)
        if (centerMatch) inner = centerMatch[1]
        else {
          const cleanMatch = inner.match(/^(?:circle|ellipse)?\s*(?:\w+\s+)?,?\s*(.*)/)
          if (cleanMatch) inner = cleanMatch[1]
        }
      }

      const stops = parseGradientStops(inner).map(s => ({ ...s, color: cssColorToRgb(s.color) || { r: 0, g: 0, b: 0, a: 1 } }))
      if (!stops.length) return null
      fixTransparentStops(stops)

      const result: any = {
        type: 'gradient_radial',
        gradientStops: stops,
        gradientHandlePositions: [
          { x: 0.5, y: 0.5 },
          { x: 1, y: 1 },
        ],
      }

      if (cx !== 0.5 || cy !== 0.5) {
        result._centerOffsetX = cx - 0.5
        result._centerOffsetY = cy - 0.5
      }

      if (explicitW !== undefined) {
        result._sizeW = explicitW
        result._sizeH = explicitH
      }

      return result
    }

    if (clean.startsWith('conic-gradient(')) {
      const match = clean.match(/conic-gradient\((.+)\)/)
      if (!match) return null
      let inner = match[1]

      let fromDeg = 0
      let cx = 0.5, cy = 0.5

      const fromMatch = inner.match(/from\s+(\d+(?:\.\d+)?)deg\s+at\s+(\d+(?:\.\d+)?%)\s+(\d+(?:\.\d+)?%)\s*,\s*(.*)/)
      if (fromMatch) {
        fromDeg = parseFloat(fromMatch[1])
        cx = parseFloat(fromMatch[2]) / 100
        cy = parseFloat(fromMatch[3]) / 100
        inner = fromMatch[4]
      } else {
        const fromOnlyMatch = inner.match(/from\s+(\d+(?:\.\d+)?)deg\s*,\s*(.*)/)
        if (fromOnlyMatch) {
          fromDeg = parseFloat(fromOnlyMatch[1])
          inner = fromOnlyMatch[2]
        } else {
          const atMatch = inner.match(/at\s+(\d+(?:\.\d+)?%)\s+(\d+(?:\.\d+)?%)\s*,\s*(.*)/)
          if (atMatch) {
            cx = parseFloat(atMatch[1]) / 100
            cy = parseFloat(atMatch[2]) / 100
            inner = atMatch[3]
          }
        }
      }

      const stops = parseGradientStops(inner).map(s => ({ ...s, color: cssColorToRgb(s.color) || { r: 0, g: 0, b: 0, a: 1 } }))
      if (!stops.length) return null
      fixTransparentStops(stops)

      const rad = (fromDeg - 90) * Math.PI / 180
      const handleDist = 0.5
      return {
        type: 'gradient_angular',
        gradientStops: stops,
        gradientHandlePositions: [
          { x: cx, y: cy },
          { x: cx + Math.cos(rad) * handleDist, y: cy + Math.sin(rad) * handleDist },
        ],
      }
    }

    return null
  }

  function parsePx(val: string): number {
    const m = val.match(/^(-?\d+(?:\.\d+)?)px/)
    return m ? parseFloat(m[1]) : 0
  }

  // ─── extractNode 子函数 ──────────────────────────────────

  function getElementRect(element: Element, parentRect: DOMRect) {
    const rect = element.getBoundingClientRect()
    let x = Math.round(rect.left - parentRect.left)
    let y = Math.round(rect.top - parentRect.top)
    let width = Math.round(rect.width), height = Math.round(rect.height)
    const elInline = (element as HTMLElement).style
    let hasFullHeight = false
    if (elInline.height === '100%' && parentRect.height > 0) { height = Math.round(parentRect.height); hasFullHeight = true }
    if (elInline.width === '100%' && parentRect.width > 0) { width = Math.round(parentRect.width) }
    return { x, y, width, height, hasFullHeight, rect }
  }

  function handleEarlyReturn(element: Element, tag: string, cs: CSSStyleDeclaration, width: number, height: number): boolean {
    if (tag === 'script' || tag === 'style' || tag === 'link') return true
    if (cs.display === 'none') return true
    if (width <= 0 && height <= 0) return true
    return false
  }

  function extractInstanceNode(element: Element, tag: string, x: number, y: number, width: number, height: number): ClientRenderNode | null {
    const instanceId = element.getAttribute('data-component-id')
    const instanceName = element.getAttribute('data-component-name')
    // 团队组件库引用：data-library-ukey 为最终形态；data-library-component 由服务端解析后写入
    const libraryUkey = element.getAttribute('data-library-ukey') || element.getAttribute('data-library-component')
    const libraryVariant = element.getAttribute('data-library-variant')
    if (!instanceId && !instanceName && !libraryUkey) return null
    const node: ClientRenderNode = {
      type: 'instance', name: element.getAttribute('data-name') || tag,
      position: { x, y }, size: { width, height }, children: [],
    }
    if (instanceId) node.componentId = instanceId
    if (instanceName) node.componentName = instanceName
    if (libraryUkey) node.componentUkey = libraryUkey
    if (libraryVariant) node.componentVariant = libraryVariant

    const variantProps = element.getAttribute('data-library-variant-properties')
    if (variantProps) {
      try {
        const parsed = JSON.parse(variantProps)
        if (parsed && typeof parsed === 'object') node.variantProperties = parsed
      } catch {
        console.warn('[extractNode] data-library-variant-properties 不是合法 JSON:', variantProps)
      }
    }
    // 实例子节点覆写：data-override-text/fill/visible-<childName> → DSL overrides
    const instanceOverrides = parseInstanceOverrides((n) => element.getAttribute(n), element.getAttributeNames())
    if (instanceOverrides) node.overrides = instanceOverrides
    return node
  }

  /** 解析 data-swap-node-id / data-swap-node-ids（支持逗号、空格分隔的多个节点 ID） */
  function parseSwapNodeIds(element: Element): string[] {
    const raw = element.getAttribute('data-swap-node-id') || element.getAttribute('data-swap-node-ids') || ''
    return raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
  }

  /**
   * 换组件指令节点：data-swap-node-id 指向画布上已有的实例，
   * 目标组件优先取 data-swap-* ，回退到 data-library-* / data-component-*。
   * 该元素本身不产生新节点，因此可挂在 0 尺寸占位元素上（早于尺寸早退判断）。
   */
  function extractSwapNode(element: Element, tag: string, x: number, y: number, width: number, height: number): ClientRenderNode | null {
    const swapNodeIds = parseSwapNodeIds(element)
    if (swapNodeIds.length === 0) return null

    const ukey = element.getAttribute('data-swap-ukey')
      || element.getAttribute('data-swap-component')
      || element.getAttribute('data-library-ukey')
      || element.getAttribute('data-library-component')
    const componentId = element.getAttribute('data-swap-component-id') || element.getAttribute('data-component-id')
    const componentName = element.getAttribute('data-component-name')
    const variant = element.getAttribute('data-swap-variant') || element.getAttribute('data-library-variant')
    const rawVariantProps = element.getAttribute('data-swap-variant-properties') || element.getAttribute('data-library-variant-properties')

    if (!ukey && !componentId && !componentName) {
      console.warn(
        '[extractNode] data-swap-node-id 缺少目标组件属性（data-swap-component / data-swap-ukey / data-swap-component-id / data-component-id / data-component-name / data-library-ukey）:',
        swapNodeIds.join(','),
      )
    }

    const node: ClientRenderNode = {
      type: 'instance',
      name: element.getAttribute('data-name') || tag,
      position: { x, y },
      size: { width, height },
      children: [],
    }
    if (componentId) node.componentId = componentId
    if (componentName) node.componentName = componentName
    if (ukey) node.componentUkey = ukey
    if (variant) node.componentVariant = variant
    if (rawVariantProps) {
      try {
        const parsed = JSON.parse(rawVariantProps)
        if (parsed && typeof parsed === 'object') node.variantProperties = parsed
      } catch {
        console.warn('[extractNode] data-swap-variant-properties 不是合法 JSON:', rawVariantProps)
      }
    }

    node.swapNodeIds = swapNodeIds
    // 属性存在时才写入，便于区分「未声明」（走默认：实例不保持 / 非实例保持）与显式 false
    const keepSizeAttr = element.getAttribute('data-swap-keep-size')
    if (keepSizeAttr !== null) node.swapKeepSize = keepSizeAttr === 'true'
    const resetOverridesAttr = element.getAttribute('data-swap-reset-overrides')
    if (resetOverridesAttr !== null) node.swapResetOverrides = resetOverridesAttr === 'true'
    const keepOriginalAttr = element.getAttribute('data-swap-keep-original')
    if (keepOriginalAttr !== null) node.swapKeepOriginal = keepOriginalAttr === 'true'
    // 换组件后同样支持实例子节点覆写（data-override-*）
    const swapOverrides = parseInstanceOverrides((n) => element.getAttribute(n), element.getAttributeNames())
    if (swapOverrides) node.overrides = swapOverrides
    return node
  }

  function extractSvgResultNode(element: Element, tag: string, parentIsFlex: boolean, cs: CSSStyleDeclaration, x: number, y: number, width: number, height: number): ClientRenderNode | null {
    const resolvedSvg = (element as any).__resolvedSvg
    if (!resolvedSvg) return null
    const elStyle = (element as HTMLElement).style
    const isMarginAuto = elStyle.marginLeft === 'auto' || elStyle.marginRight === 'auto' ||
      elStyle.marginTop === 'auto' || elStyle.marginBottom === 'auto'
    return {
      type: 'frame', name: element.getAttribute('data-name') || tag,
      position: { x, y }, size: { width, height },
      layoutPositioning: isMarginAuto ? 'ABSOLUTE' : (parentIsFlex && cs.position !== 'absolute') ? 'AUTO' : 'ABSOLUTE',
      layoutMode: 'NONE', children: [], svgContent: resolvedSvg,
    }
  }

  async function extractImageFill(element: Element, tag: string): Promise<{ imgFill: any } | null> {
    if (tag !== 'img') return null
    const imgEl = element as HTMLImageElement
    const src = imgEl.src
    if (!src) return null
    const fill: any = { type: 'image', imageUrl: src, imageScaleMode: 'FILL' }
    if (imgEl.complete && imgEl.naturalWidth > 0) {
      if (!imageDataCache.has(src)) {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = imgEl.naturalWidth; canvas.height = imgEl.naturalHeight
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(imgEl, 0, 0)
            const dataUrl = canvas.toDataURL('image/png')
            const comma = dataUrl.indexOf(',')
            if (comma >= 0) imageDataCache.set(src, dataUrl.substring(comma + 1))
          }
        } catch (e) { console.warn('[extractNode-IMG] Canvas 提取失败:', e) }
      }
      fill.imageData = imageDataCache.get(src)
    }
    return { imgFill: fill }
  }

  function determineNodeType(tag: string, isInlineText: boolean, isContainer: boolean, element: Element): ClientRenderNode['type'] {
    if (isInlineText) return 'text'
    if (tag === 'button') return 'frame'
    if (!isContainer && element.children.length === 0) return 'rectangle'
    return 'frame'
  }

  function extractLayoutInfo(element: Element, cs: CSSStyleDeclaration, node: ClientRenderNode): void {
    const display = cs.display
    if (display !== 'flex' && display !== 'inline-flex') return
    node.layoutMode = (cs.flexDirection === 'column' || cs.flexDirection === 'column-reverse') ? 'VERTICAL' : 'HORIZONTAL'

    const gapVal = parseFloat(cs.gap)
    if (!isNaN(gapVal)) { node.itemSpacing = gapVal }
    else {
      const rowGap = parseFloat(cs.rowGap), columnGap = parseFloat(cs.columnGap)
      if (!isNaN(rowGap)) node.itemSpacing = rowGap
      else if (!isNaN(columnGap) && node.layoutMode === 'HORIZONTAL') node.itemSpacing = columnGap
      else node.itemSpacing = 0
    }

    const pt = parsePx(cs.paddingTop), pr = parsePx(cs.paddingRight)
    const pb = parsePx(cs.paddingBottom), pl = parsePx(cs.paddingLeft)
    node.paddingTop = pt; node.paddingRight = pr; node.paddingBottom = pb; node.paddingLeft = pl

    const alignMap: Record<string, string> = { 'flex-start': 'MIN', start: 'MIN', 'flex-end': 'MAX', end: 'MAX', center: 'CENTER', stretch: 'MIN', baseline: 'MIN' }
    node.counterAxisAlignItems = (alignMap[cs.alignItems] || 'MIN') as 'MIN' | 'CENTER' | 'MAX'
    const justifyMap: Record<string, string> = {
      'flex-start': 'MIN', start: 'MIN', 'flex-end': 'MAX', end: 'MAX',
      center: 'CENTER', 'space-between': 'SPACE_BETWEEN', 'space-around': 'SPACE_AROUND', 'space-evenly': 'SPACE_AROUND',
    }
    node.primaryAxisAlignItems = (justifyMap[cs.justifyContent] || 'MIN') as 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
    if (cs.flexWrap === 'wrap') node.flexWrap = 'WRAP'

    const elStyle = (element as HTMLElement).style
    if (!!elStyle.width && elStyle.width !== '100%' && elStyle.width !== 'auto') node.counterAxisSizingMode = 'FIXED'
    if (!!elStyle.height && elStyle.height !== '100%' && elStyle.height !== 'auto') node.primaryAxisSizingMode = 'FIXED'
  }

  async function handleSvgElement(element: Element, tag: string, node: ClientRenderNode, width: number, height: number, cs: CSSStyleDeclaration): Promise<ClientRenderNode | null> {
    if (tag !== 'svg') return null
    const svgRect = element.getBoundingClientRect()
    const svgChildren = await extractSvgChildren(element, svgRect)
    if (svgChildren.length > 0) {
      node.type = 'frame'; node.children = svgChildren
    } else {
      node.type = 'svg'
      let svgContent = (element as any).__resolvedSvg || element.outerHTML
      if (svgContent) {
        const cssColor = cs.color
        if (cssColor && cssColor !== 'rgba(0, 0, 0, 0)' && cssColor !== 'transparent') svgContent = svgContent.replace(/currentColor/gi, cssColor)
        svgContent = svgContent.replace(/width="[^"]*"/, `width="${width}"`).replace(/height="[^"]*"/, `height="${height}"`)
        node.svgContent = svgContent
      }
    }
    return node
  }

  function extractBackgroundFills(element: Element, cs: CSSStyleDeclaration, imgFill: any, width: number, height: number, elemName: string): any[] | null {
    const bgColor = cssColorToRgb(cs.backgroundColor)
    const bgImage = cs.backgroundImage
    const fills: any[] = []

    if (imgFill) return null

    if (bgImage && bgImage !== 'none') {
      const layers = splitCSSLayers(bgImage)
      for (const layer of layers) {
        if (layer.startsWith('linear-gradient(') || layer.startsWith('radial-gradient(') || layer.startsWith('conic-gradient(')) {
          const gradient = parseCSSGradient(layer)
          if (gradient) {
            const fill: any = { type: gradient.type, gradientStops: gradient.gradientStops, gradientHandlePositions: gradient.gradientHandlePositions, isVisible: true, alpha: 1, blendMode: 'NORMAL' }
            if ((gradient.type === 'gradient_radial' || gradient.type === 'GRADIENT_RADIAL') && (gradient._centerOffsetX !== undefined || gradient._centerOffsetY !== undefined || gradient._sizeW !== undefined)) {
              const nodeW = width || 200, nodeH = height || 200
              const cx = Math.max(0, Math.min(1, (gradient._centerOffsetX ?? 0) + 0.5)), cy = Math.max(0, Math.min(1, (gradient._centerOffsetY ?? 0) + 0.5))
              const sizeW = gradient._sizeW ?? nodeW / 2, sizeH = gradient._sizeH ?? nodeH / 2
              const rx = Math.min(sizeW / nodeW, 1), ry = Math.min(sizeH / nodeH, 1), r = Math.max(rx, ry)
              fill.gradientHandlePositions = [{ x: cx, y: cy }, { x: cx + r, y: cy }]
              fill.transform = [[rx / r, 0, 0], [0, ry / r, 0]]
            } else fill.transform = [[1, 0, 0], [0, 1, 0]]
            fills.push(fill)
          }
        } else if (layer.startsWith('url(')) {
          const urlMatch = layer.match(/url\(['"]?([^'"\)]+)['"]?\)/)
          if (urlMatch) {
            const fill: any = { type: 'image', imageUrl: urlMatch[1], imageScaleMode: 'FILL' }
            if ((element as any).__bgImageData) fill.imageData = (element as any).__bgImageData
            fills.push(fill)
          }
        } else if (layer.startsWith('#') || layer.startsWith('rgba(') || layer.startsWith('rgb(')) {
          const solidColor = cssColorToRgb(layer)
          if (solidColor && solidColor.a > 0) fills.push({ type: 'solid', color: solidColor })
        }
      }
    }

    if (!imgFill && bgColor && bgColor.a > 0 && (!fills.length || bgImage === 'none' || !fills.some(f => f.type === 'solid' || f.type === 'SOLID'))) {
      fills.push({ type: 'solid', color: bgColor })
    }
    if (fills.length > 1) fills.reverse()
    return fills.length > 0 ? fills : null
  }

  function extractBorderRadius(element: Element, cs: CSSStyleDeclaration, node: ClientRenderNode): void {
    const parsePxVal = (val: string): number => { const m = val.match(/(\d+(?:\.\d+)?)px/); return m ? parseFloat(m[1]) : 0 }
    const brShorthand = cs.borderRadius || ''
    const brParts = brShorthand.split(/\s+/)
    if (brParts.length === 1 && brParts[0]) {
      const br = parseBorderRadius(brShorthand)
      if (br !== undefined) node.cornerRadius = br
    } else if (brParts.length >= 4) {
      node.topLeftRadius = parsePxVal(brParts[0])
      node.topRightRadius = parsePxVal(brParts[1])
      node.bottomRightRadius = parsePxVal(brParts[2])
      node.bottomLeftRadius = parsePxVal(brParts[3])
    }
    const readBr = (prop: string): number => {
      const inline = (element as HTMLElement).style[prop as any] || ''
      return inline ? parsePxVal(inline) : parsePxVal(cs[prop as any] || '')
    }
    const tl = readBr('borderTopLeftRadius'), tr = readBr('borderTopRightRadius')
    const br2 = readBr('borderBottomRightRadius'), bl = readBr('borderBottomLeftRadius')
    if (tl > 0 || tr > 0 || br2 > 0 || bl > 0) {
      if (tl === tr && tr === br2 && br2 === bl) { if (tl > 0) node.cornerRadius = tl }
      else { node.topLeftRadius = tl; node.topRightRadius = tr; node.bottomRightRadius = br2; node.bottomLeftRadius = bl }
    } else {
      const brAttr = element.getAttribute('data-br')
      if (brAttr) {
        for (const entry of brAttr.split('|')) {
          const [prop, valStr] = entry.split(':'); const val = parseFloat(valStr)
          if (prop && !isNaN(val) && val > 0) {
            if (prop === 'border-top-left-radius') node.topLeftRadius = val
            if (prop === 'border-top-right-radius') node.topRightRadius = val
            if (prop === 'border-bottom-left-radius') node.bottomLeftRadius = val
            if (prop === 'border-bottom-right-radius') node.bottomRightRadius = val
          }
        }
      }
    }
  }

  function extractStrokes(cs: CSSStyleDeclaration, node: ClientRenderNode): void {
    const bwTop = parseFloat(cs.borderTopWidth), bwRight = parseFloat(cs.borderRightWidth)
    const bwBottom = parseFloat(cs.borderBottomWidth), bwLeft = parseFloat(cs.borderLeftWidth)
    const bc = cssColorToRgb(cs.borderColor)
    if ((bwTop > 0 || bwRight > 0 || bwBottom > 0 || bwLeft > 0) && bc) {
      const sidesEqual = bwTop === bwRight && bwRight === bwBottom && bwBottom === bwLeft
      node.strokes = [{ type: 'solid', color: bc }]; node.strokeAlign = 'INSIDE'
      const join = cs.strokeLinejoin || 'miter'
      node.strokeJoin = join === 'round' ? 'ROUND' : join === 'bevel' ? 'BEVEL' : 'MITER'
      if (sidesEqual) node.strokeWeight = bwTop
      else { node.strokeWeight = Math.max(bwTop, bwRight, bwBottom, bwLeft)
        node.strokeTopWeight = bwTop; node.strokeBottomWeight = bwBottom
        node.strokeLeftWeight = bwLeft; node.strokeRightWeight = bwRight }
    }
  }

  function extractEffects(cs: CSSStyleDeclaration): any[] {
    const effects: any[] = []
    const boxShadowValue = cs.boxShadow
    const shadow = parseBoxShadow(boxShadowValue)
    if (shadow) {
      const shadowColor = cssColorToRgb(shadow.color) || { r: 0, g: 0, b: 0, a: 0.25 }
      effects.push({ type: shadow.inner ? 'INNER_SHADOW' : 'DROP_SHADOW', offset: { x: shadow.offsetX, y: shadow.offsetY }, radius: shadow.radius, color: shadowColor, spread: shadow.spread, visible: true, blendMode: 'NORMAL', showShadowBehindNode: false, isEffectShow: true })
    }
    const filter = cs.filter || ''
    if (filter.includes('blur')) {
      const m = filter.match(/blur\(([\d.]+)px\)/)
      if (m) effects.push({ type: 'LAYER_BLUR', radius: parseFloat(m[1]), visible: true, blendMode: 'NORMAL' })
    }
    if (filter.includes('backdrop-blur')) {
      const m = filter.match(/backdrop-blur\(([\d.]+)px\)/)
      if (m) effects.push({ type: 'BACKGROUND_BLUR', radius: parseFloat(m[1]), visible: true, blendMode: 'NORMAL' })
    }
    return effects
  }

  function extractTransform(cs: CSSStyleDeclaration, node: ClientRenderNode): void {
    const opacity = parseFloat(cs.opacity)
    if (opacity < 1) node.opacity = opacity
    const rotation = parseFloat(cs.transform?.match(/rotate\(([\d.]+)deg\)/)?.[1] || '0')
    if (!isNaN(rotation)) node.rotation = rotation
    const blendMode = cs.mixBlendMode
    if (blendMode && blendMode !== 'normal') {
      const modeMap: Record<string, string> = {
        multiply: 'MULTIPLY', screen: 'SCREEN', overlay: 'OVERLAY',
        darken: 'DARKEN', lighten: 'LIGHTEN', 'color-dodge': 'COLOR_DODGE',
        'color-burn': 'COLOR_BURN', hardlight: 'HARDLIGHT', softlight: 'SOFTLIGHT',
        difference: 'DIFFERENCE', exclusion: 'EXCLUSION', hue: 'HUE',
        saturation: 'SATURATION', color: 'COLOR', luminosity: 'LUMINOSITY',
      }
      node.blendMode = modeMap[blendMode] || 'NORMAL'
    }
  }

  function extractTextContent(element: Element, cs: CSSStyleDeclaration, node: ClientRenderNode): void {
    if (node.type !== 'text') return
    const inlineChildTags = ['span', 'em', 'strong', 'a', 'b', 'i', 'u', 's', 'small', 'sub', 'sup', 'code']
    const hasInlineChildren = Array.from(element.children).some(c => inlineChildTags.includes(c.tagName.toLowerCase()))

    let textContent: string
    let textSegments: Array<{ start: number; end: number; fills: any[] }> | undefined

    if (hasInlineChildren) {
      textSegments = []; let offset = 0; const parts: string[] = []
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) { parts.push(child.textContent || ''); offset += (child.textContent || '').length }
        else if (child.nodeType === Node.ELEMENT_NODE) {
          const el = child as HTMLElement; const t = el.textContent || ''; parts.push(t)
          const childColor = cssColorToRgb(window.getComputedStyle(el).color)
          if (childColor && t.length > 0) textSegments.push({ start: offset, end: offset + t.length, fills: [{ type: 'solid', color: childColor }] })
          offset += t.length
        }
      }
      textContent = parts.join('')
    } else if (element.querySelector('br')) {
      const parts: string[] = []
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) parts.push(child.textContent || '')
        else if (child.nodeType === Node.ELEMENT_NODE) {
          const el = child as HTMLElement
          parts.push(el.tagName.toLowerCase() === 'br' ? '\n' : el.textContent || '')
        }
      }
      textContent = parts.join('').trim()
    } else textContent = element.textContent?.trim() || ''

    if (!textContent) { node.type = 'frame'; return }

    const hasLineBreak = textContent.includes('\n')
    const fontSize = parseFloat(cs.fontSize) || 14; const fontWeight = parseInt(cs.fontWeight) || 400
    node.content = textContent; node.fontSize = fontSize; node.fontWeight = fontWeight
    node.fontName = { family: 'Inter', style: getFontStyle(fontWeight) }

    // 文本节点的 fills 只能是**文字颜色**：CSS `color` 权威。
    // 原实现写作 `if (textColor && !node.fills)` —— 一旦元素带背景（`extractBackgroundFills`
    // 已把背景写进 `node.fills`），文字颜色就被跳过，背景色顶掉文字色：
    // `<p class="bg-[rgba(60,60,67,0.10)] px-2">Ctrl</p>` 的整排快捷键因此看不见。
    // 这里不再看 `node.fills` 是否已有值，背景永远不能冒充文字色。
    const textColor = cssColorToRgb(cs.color)
    if (textColor) node.fills = [{ type: 'solid', color: textColor }]
    if (textSegments && textSegments.length > 0) node.textSegments = textSegments

    const ta = cs.textAlign
    node.textAlignHorizontal = ta === 'center' ? 'CENTER' : ta === 'right' ? 'RIGHT' : 'LEFT'
    node.textAlignVertical = 'TOP'

    const lh = cs.lineHeight
    if (lh && lh !== 'normal') { const lhPx = parseFloat(lh); if (!isNaN(lhPx)) node.lineHeight = { unit: 'PIXELS', value: lhPx } }
    const ls = parseFloat(cs.letterSpacing); if (!isNaN(ls)) node.letterSpacing = ls

    const el = element as HTMLElement; const origWS = el.style.whiteSpace
    el.style.whiteSpace = 'nowrap'; const naturalW = el.scrollWidth; el.style.whiteSpace = origWS
    if (hasLineBreak || (node.size.width > 0 && naturalW > node.size.width + 1)) {
      node.size = { ...node.size, width: Math.ceil(node.size.width) + 3 }; node.textAutoResize = 'HEIGHT'
    } else node.textAutoResize = 'WIDTH_AND_HEIGHT'
  }

  function processChildren(element: Element, cs: CSSStyleDeclaration, node: ClientRenderNode, rect: DOMRect): Promise<void> {
    return (async () => {
      const children = Array.from(element.children)
      const inlineChildTags = ['span', 'em', 'strong', 'a', 'b', 'i', 'u', 's', 'small', 'sub', 'sup', 'code']
      const isFlexParent = node.layoutMode === 'VERTICAL' || node.layoutMode === 'HORIZONTAL'
      for (const child of children) {
        if (node.textSegments && inlineChildTags.includes(child.tagName.toLowerCase())) continue
        if (child.tagName.toLowerCase() === 'br') continue
        const childNode = await extractNode(child, rect, isFlexParent)
        if (!childNode) continue
        const childStyle = (child as HTMLElement).style
        if (childStyle.marginLeft === 'auto' || childStyle.marginRight === 'auto' ||
            childStyle.marginTop === 'auto' || childStyle.marginBottom === 'auto') {
          childNode.layoutPositioning = 'ABSOLUTE'
        }
        if (isFlexParent && childNode.layoutPositioning !== 'ABSOLUTE' && childNode.type !== 'text') {
          const childEl = child as HTMLElement
          const shouldStretch = !(element as HTMLElement).style.alignItems || (element as HTMLElement).style.alignItems === 'stretch'
          if (node.layoutMode === 'HORIZONTAL' && shouldStretch && !childEl.style.height) {
            const pt = parseFloat(cs.paddingTop) || 0; const pb = parseFloat(cs.paddingBottom) || 0
            childNode.size = { ...childNode.size, height: Math.max(0, node.size.height - pt - pb) }; childNode.primaryAxisSizingMode = 'FIXED'
          } else if (node.layoutMode === 'VERTICAL' && shouldStretch && !childEl.style.width) {
            const pl = parseFloat(cs.paddingLeft) || 0; const pr = parseFloat(cs.paddingRight) || 0
            childNode.size = { ...childNode.size, width: Math.max(0, node.size.width - pl - pr) }; childNode.counterAxisSizingMode = 'FIXED'
          }
        }
        node.children.push(childNode)
      }
    })()
  }

  function fallbackEmptyText(element: Element, cs: CSSStyleDeclaration, node: ClientRenderNode, tag: string): void {
    if (node.type === 'text' || tag === 'svg' || node.children.length > 0) return
    const textContent = element.textContent?.trim() || ''
    if (!textContent) return
    const fontSize = parseFloat(cs.fontSize) || 14; const fontWeight = parseInt(cs.fontWeight) || 400
    const textColor = cssColorToRgb(cs.color)
    const textW = node.size.width
    const el = element as HTMLElement; const origWS = el.style.whiteSpace
    el.style.whiteSpace = 'nowrap'; const textNaturalW = el.scrollWidth; el.style.whiteSpace = origWS
    const textAutoResize = textNaturalW > textW + 1 ? 'HEIGHT' : 'WIDTH_AND_HEIGHT'
    const isFlexParent = node.layoutMode === 'VERTICAL' || node.layoutMode === 'HORIZONTAL'
    node.children.push({
      type: 'text', name: element.getAttribute('data-name') || 'text',
      position: { x: 0, y: 0 }, size: { width: textW + (textAutoResize === 'HEIGHT' ? 3 : 0), height: node.size.height },
      layoutPositioning: isFlexParent ? 'AUTO' : 'ABSOLUTE', children: [],
      content: textContent, fontSize, fontWeight, fontName: { family: 'Inter', style: getFontStyle(fontWeight) },
      textAlignHorizontal: cs.textAlign === 'center' ? 'CENTER' : cs.textAlign === 'right' ? 'RIGHT' : 'LEFT',
      textAlignVertical: 'TOP', textAutoResize, fills: textColor ? [{ type: 'solid', color: textColor }] : undefined,
    })
  }

  async function extractNode(element: Element, parentRect: DOMRect, parentIsFlex: boolean = false): Promise<ClientRenderNode | null> {
    const tag = element.tagName.toLowerCase()
    const { x, y, width, height, hasFullHeight, rect } = getElementRect(element, parentRect)
    const cs = window.getComputedStyle(element)

    // 换组件指令优先于尺寸早退（data-swap-* 常挂在 0 尺寸占位元素上）
    const swapNode = extractSwapNode(element, tag, x, y, width, height)
    if (swapNode) return swapNode

    if (handleEarlyReturn(element, tag, cs, width, height)) return null
    const elemName = element.getAttribute('data-name') || tag

    // Early returns for instance, resolved SVG, img
    const instanceNode = extractInstanceNode(element, tag, x, y, width, height)
    if (instanceNode) return instanceNode
    const svgResult = extractSvgResultNode(element, tag, parentIsFlex, cs, x, y, width, height)
    if (svgResult) return svgResult
    const imgResult = await extractImageFill(element, tag)
    const imgFill = imgResult?.imgFill ?? null

    // Build base node
    const isInlineText = ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'strong', 'a', 'label', 'li', 'b', 'i', 'u', 's', 'small', 'sub', 'sup', 'code', 'pre', 'blockquote', 'figcaption', 'cite', 'time'].includes(tag)
    const isContainer = tag === 'div' || tag === 'section' || tag === 'article' || tag === 'main' || tag === 'header' || tag === 'footer' || tag === 'nav' || tag === 'aside' || tag === 'figure' || tag === 'form' || tag === 'fieldset' || tag === 'button'
    const nodeType = determineNodeType(tag, isInlineText, isContainer, element)
    const flexGrow = parseFloat(cs.flexGrow)
    const node: ClientRenderNode = {
      type: nodeType, name: element.getAttribute('data-name') || tag,
      position: { x, y }, size: { width, height },
      layoutPositioning: (parentIsFlex && cs.position !== 'absolute') ? 'AUTO' : 'ABSOLUTE', children: [],
    }
    if (!isNaN(flexGrow) && flexGrow > 0) node.flexGrow = flexGrow
    if (hasFullHeight) node.primaryAxisSizingMode = 'FIXED'

    // Extract all style properties
    extractLayoutInfo(element, cs, node)

    const svgNode = await handleSvgElement(element, tag, node, width, height, cs)
    if (svgNode) return svgNode

    const fills = extractBackgroundFills(element, cs, imgFill, width, height, elemName)
    // 注：文本节点的背景填充在下面 `extractTextContent` 里会被文字颜色覆盖；
    // 无文字的文本元素（如空 `<p class="bg-x">` 装饰块）会转成 frame，背景保留。
    if (fills) node.fills = imgFill ? [imgFill] : fills

    extractBorderRadius(element, cs, node)
    extractStrokes(cs, node)

    const effects = extractEffects(cs)
    if (effects.length > 0) node.effects = effects

    extractTransform(cs, node)
    extractTextContent(element, cs, node)

    node.clipsContent = cs.overflow === 'hidden'
    await processChildren(element, cs, node, rect)
    fallbackEmptyText(element, cs, node, tag)

    if (node.type === 'frame' && node.children.length === 0 && !node.fills && !node.strokes && !node.flexGrow) return null
    return node
  }

  async function renderHtml(htmlString: string): Promise<any> {
    state.value = { isRendering: true, progress: '注入 HTML...', error: null }
    console.log('[renderHtml] 开始渲染, HTML 长度=', htmlString.length)

    const container = document.createElement('div')
    container.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;z-index:-9999;'

    try {
      const bodyMatch = htmlString.match(/<body[^>]*>([\s\S]*)<\/body>/i)
      const content = bodyMatch ? bodyMatch[1].trim() : htmlString

      state.value = { ...state.value, progress: '浏览器渲染中...' }
      container.innerHTML = content
      document.body.appendChild(container)
      console.log('[renderHtml] container 已添加到 body, children=', container.children.length)

      const tailwindResult = applyTailwindToTree(container)
      const unresolvedClasses = tailwindResult.unresolved
      // 文本元素上的背景/内边距/圆角会被拦下（走告警而非静默丢弃），提示替代写法
      const renderWarnings = tailwindResult.warnings
      console.log('[renderHtml] Tailwind 已应用，未解析 class:', unresolvedClasses.length, unresolvedClasses.slice(0, 8).join(', '))
      if (unresolvedClasses.length > 0) {
        console.warn('[renderHtml] 以下 Tailwind class 未被解析（样式会丢失，建议改用任意值写法）:', unresolvedClasses)
      }
      for (const warning of renderWarnings) console.warn('[renderHtml] Tailwind 告警:', warning)

      console.log('[renderHtml] 开始 resolveDataIcons...')
      await resolveDataIcons(container)
      console.log('[renderHtml] resolveDataIcons 完成')

      console.log('[renderHtml] 开始 resolveBgImageData...')
      await resolveBgImageData(container, imageDataCache)
      console.log('[renderHtml] resolveBgImageData 完成')

      await new Promise(resolve => requestAnimationFrame(resolve))
      await new Promise(resolve => setTimeout(resolve, 100))

      console.log('[renderHtml] 开始 waitForImages...')
      await waitForImages(container)
      console.log('[renderHtml] waitForImages 完成')

      const containerRect = container.getBoundingClientRect()
      console.log('[renderHtml] containerRect=', containerRect.width, 'x', containerRect.height)
      const allDivs = container.querySelectorAll('div')
      console.log('[renderHtml] DOM 调试: container 有', allDivs.length, '个 div')
      let idx = 0
      for (const d of Array.from(allDivs).slice(0, 10)) {
        const r = d.getBoundingClientRect()
        const cs = window.getComputedStyle(d)
        console.log(`[renderHtml] DOM[${idx}] class="${d.className?.substring(0, 40)}" display=${cs.display} rect=${r.width}x${r.height} @ ${r.left},${r.top}`)
        idx++
      }

      state.value = { ...state.value, progress: '提取计算样式...' }

      const elements: ClientRenderNode[] = []
      for (const child of Array.from(container.children)) {
        console.log('[renderHtml] 提取节点:', child.tagName, child.className?.substring(0, 30))
        const node = await extractNode(child, containerRect)
        if (node) {
          elements.push(node)
          console.log('[renderHtml] 节点 children 数量:', node.children?.length, 'fills:', node.fills?.map(f => f.type).join(','))
          for (const c of node.children || []) {
            console.log('[renderHtml]   子节点:', c.type, c.name, 'pos:', c.position, 'size:', c.size, 'fills:', c.fills?.map((f: any) => f.type).join(','))
            for (const cc of c.children || []) {
              console.log('[renderHtml]     孙节点:', cc.type, cc.name, 'pos:', cc.position, 'size:', cc.size, 'fills:', cc.fills?.map((f: any) => f.type).join(','))
            }
          }
        }
      }
      console.log('[renderHtml] 提取完成, elements=', elements.length)

      const cleanElements = elements.map(n => n)

      // 全部为换组件指令时不再包一层根 frame（换组件不产生新节点，无需容器）
      const isSwapOnly = cleanElements.length > 0 && cleanElements.every(
        (n) => n.type === 'instance' && (n.swapNodeIds?.length || 0) > 0,
      )
      if (isSwapOnly) {
        const swapDsl: any = { version: '2.0', elements: cleanElements }
        // 告警文案与 class 名单一起回传（宿主侧只认 `_unresolvedClasses`，故合并进同一数组）：
        // class 名保持可机器读，末尾追加的人类可读文案负责写清替代写法。
        const reportedClasses = [...unresolvedClasses, ...renderWarnings]
        if (reportedClasses.length > 0) swapDsl._unresolvedClasses = reportedClasses
        console.log('[renderHtml] 纯换组件指令 DSL:', JSON.stringify(swapDsl).substring(0, 1000))
        state.value = { isRendering: false, progress: '完成（换组件）', error: null }
        return swapDsl
      }

      const rootWidth = Math.round(containerRect.width) || 1440
      const rootHeight = Math.round(containerRect.height) || 900

      const rootName = cleanElements.length === 1 ? cleanElements[0].name : 'Client Render'
      const dsl: any = {
        version: '2.0',
        elements: [{
          type: 'frame',
          name: rootName,
          position: { x: 0, y: 0 },
          size: { width: rootWidth, height: rootHeight },
          layoutMode: 'NONE',
          fills: [{ type: 'solid', color: '#ffffff' }],
          clipsContent: true,
          children: cleanElements,
        }],
      }

      console.log('[renderHtml] 最终 DSL:', JSON.stringify(dsl, null, 2).substring(0, 5000))

      // 把未解析的 Tailwind class 随 DSL 回传：插件端 dsl/render 会把它带进响应与画布通知
      const reportedClasses = [...unresolvedClasses, ...renderWarnings]
      if (reportedClasses.length > 0) dsl._unresolvedClasses = reportedClasses

      state.value = { isRendering: false, progress: '完成', error: null }
      return dsl
    } catch (error: any) {
      state.value = { isRendering: false, progress: '失败', error: error.message }
      throw error
    } finally {
      if (container.parentNode) document.body.removeChild(container)
    }
  }

  return {
    state: readonly(state),
    renderHtml,
    resetState,
  }
}
