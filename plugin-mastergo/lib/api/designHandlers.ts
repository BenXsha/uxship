import { rgbToHex } from '../utils/color-utils'
import { isItemVisible, serializeEffects } from './visual-utils'

const STYLE_NAME_TO_WEIGHT: Record<string, number> = {
  Thin: 100, 'Extra Light': 200, ExtraLight: 200, Light: 300,
  Regular: 400, Normal: 400, Medium: 500,
  'Semi Bold': 600, SemiBold: 600, 'Demi Bold': 600,
  Bold: 700, 'Extra Bold': 800, ExtraBold: 800, 'Ultra Bold': 800,
  Black: 900, Heavy: 900,
}

function styleNameToWeight(style: string): number {
  return STYLE_NAME_TO_WEIGHT[style] ?? 400
}

function colorObjToHex(c: { r: number; g: number; b: number; a?: number }): string {
  return rgbToHex({ r: c.r, g: c.g, b: c.b, a: c.a })
}

interface DescribeOptions {
  depth?: number
  includeStyle?: boolean
}

function describeNode(node: any, options: DescribeOptions, currentDepth: number): Record<string, any> | null {
  if (!node || node.removed) return null

  const result: Record<string, any> = {
    id: node.id,
    name: node.name || '',
    type: node.type,
  }

  if ('x' in node) {
    result.x = Math.round(node.x)
    result.y = Math.round(node.y)
    result.width = Math.round(node.width)
    result.height = Math.round(node.height)
  }

  if (node.type === 'TEXT') {
    result.text = node.characters || ''
    if (options.includeStyle) {
      const style: Record<string, any> = {}
      if ('fontSize' in node) style.fontSize = node.fontSize
      if (node.fontName) {
        style.fontFamily = node.fontName.family
        style.fontWeight = typeof node.fontName.style === 'string'
          ? styleNameToWeight(node.fontName.style)
          : (node.fontWeight ?? 400)
        style.fontStyle = node.fontName.style
      } else if ('fontWeight' in node) {
        style.fontWeight = node.fontWeight
      }
      if ('textAlignHorizontal' in node) style.textAlign = node.textAlignHorizontal
      if ('lineHeight' in node && node.lineHeight) {
        style.lineHeight = node.lineHeight.value ?? node.lineHeight
      }
      if ('letterSpacing' in node) style.letterSpacing = node.letterSpacing
      if ('paragraphSpacing' in node && node.paragraphSpacing) style.paragraphSpacing = node.paragraphSpacing
      if ('textDecoration' in node) style.textDecoration = node.textDecoration
      if ('textCase' in node) style.textCase = node.textCase
      if (node.fills && node.fills.length > 0) {
        const solid = node.fills.find((f: any) => f.type === 'SOLID' && f.color)
        if (solid) {
          style.textColor = colorObjToHex(solid.color)
        }
      }
      result.style = style
    }
  }

  if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    if ('flexMode' in node && node.flexMode) {
      result.layout = {
        direction: node.flexMode,
        itemSpacing: node.itemSpacing ?? 0,
        padding: [node.paddingTop ?? 0, node.paddingRight ?? 0, node.paddingBottom ?? 0, node.paddingLeft ?? 0],
        alignMain: node.mainAxisAlignItems,
        alignCross: node.crossAxisAlignItems,
      }
    }
    if ('clipsContent' in node && node.clipsContent) {
      result.clipsContent = true
    }
    if (options.includeStyle) {
      if ('primaryAxisSizingMode' in node) result.primaryAxisSizingMode = node.primaryAxisSizingMode
      if ('counterAxisSizingMode' in node) result.counterAxisSizingMode = node.counterAxisSizingMode
    }
  }

  if ('opacity' in node && node.opacity !== undefined && node.opacity < 1) {
    result.opacity = node.opacity
  }

  if ('isVisible' in node && node.isVisible === false) {
    result.isVisible = false
  }

  if ('cornerRadius' in node && node.cornerRadius !== undefined && node.cornerRadius > 0) {
    result.cornerRadius = node.cornerRadius
  }

  if (options.includeStyle) {
    if ('fills' in node && node.fills && node.fills.length > 0) {
      const visibleFills = node.fills.filter((f: any) => isItemVisible(f))
      if (visibleFills.length > 0) {
        const hexFills: string[] = []
        for (const f of visibleFills) {
          if (f.type === 'SOLID' && f.color) {
            hexFills.push(colorObjToHex(f.color))
          } else if (f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL' || f.type === 'GRADIENT_ANGULAR') {
            const stops = f.gradientStops || []
            hexFills.push(stops.length > 0 ? `gradient(${stops.length} stops)` : f.type)
          } else if (f.type === 'IMAGE') {
            hexFills.push('image')
          }
        }
        if (hexFills.length > 0) result.fills = hexFills
      }
    }

    if ('strokes' in node && node.strokes && node.strokes.length > 0) {
      const visibleStrokes = node.strokes.filter((s: any) => isItemVisible(s))
      if (visibleStrokes.length > 0) {
        const s = visibleStrokes[0]
        result.stroke = {
          color: s.color ? colorObjToHex(s.color) : undefined,
          weight: node.strokeWeight ?? 1,
          align: node.strokeAlign ?? 'INSIDE',
        }
      }
    }

    if ('effects' in node && node.effects && node.effects.length > 0) {
      // 运行时字段是 isVisible（DSL 才叫 visible），统一走 visual-utils 判定
      const visibleEffects = serializeEffects(node.effects).filter((e) => e.isVisible)
      if (visibleEffects.length > 0) {
        result.effects = visibleEffects.map((e) => ({
          type: e.type,
          radius: e.radius,
          offset: e.offset,
          color: e.color ? colorObjToHex(e.color) : undefined,
          ...(e.spread !== undefined ? { spread: e.spread } : {}),
          // isEffectShow=false 表示效果开关被关掉（设计器里不渲染），显式回报便于判定
          ...(e.isEffectShow === false ? { isEffectShow: false } : {}),
        }))
      }
    }
  }

  const hasChildren = node.children && node.children.length > 0
  const maxDepth = options.depth ?? 3

  if (hasChildren) {
    result.childCount = node.children.length
    if (currentDepth < maxDepth) {
      result.children = node.children
        .map((c: any) => describeNode(c, options, currentDepth + 1))
        .filter(Boolean)
    } else {
      result.summary = summarizeChildren(node.children)
    }
  }

  return result
}

function summarizeChildren(children: any[]): Record<string, any> {
  const typeCounts: Record<string, number> = {}
  for (const c of children) {
    if (c && c.type) {
      typeCounts[c.type] = (typeCounts[c.type] || 0) + 1
    }
  }
  return {
    typeCounts,
    totalChildren: children.length,
  }
}

export function handleDesignDescribe(params: {
  nodeId: string
  depth?: number
  includeStyle?: boolean
}): any {
  if (!params.nodeId) {
    throw new Error('Missing required parameter: nodeId')
  }

  const node = mg.getNodeById(params.nodeId)
  if (!node) {
    throw new Error(`Node not found: ${params.nodeId}`)
  }

  const options: DescribeOptions = {
    depth: params.depth ?? 3,
    includeStyle: params.includeStyle ?? false,
  }

  const tree = describeNode(node, options, 0)
  return { tree }
}
