import type { HandlerContext } from './index'

interface ColorStyleInfo {
  id: string
  name: string
  description: string
  paintType: string
  color?: string
  opacity?: number
  paints: readonly any[]
}

interface TextStyleInfo {
  id: string
  name: string
  description: string
  fontName: { family: string; style: string }
  fontSize: number
  fontWeight: number
  lineHeight: LineHeight | null
  letterSpacing: number | null
}

/** 从字体样式名推导字重（MasterGo TextStyle 无 fontWeight 字段，只在 fontName.style 中） */
function fontWeightFromStyleName(styleName?: string): number {
  const s = String(styleName || '').toLowerCase()
  if (/\b(thin|hairline)\b/.test(s)) return 100
  if (/extra\s*light|ultra\s*light/.test(s)) return 200
  if (/\blight\b/.test(s)) return 300
  if (/medium/.test(s)) return 500
  if (/semi\s*bold|demi\s*bold/.test(s)) return 600
  if (/extra\s*bold|ultra\s*bold/.test(s)) return 800
  if (/\bblack\b|heavy/.test(s)) return 900
  if (/\bbold\b/.test(s)) return 700
  const numeric = /\((\d{3})\)|\b(\d{3})\b/.exec(s)
  if (numeric) return parseInt(numeric[1] || numeric[2], 10)
  return 400
}

function extractColorInfo(paints: readonly any[]): { color?: string; opacity?: number; paintType: string } {
  if (!paints || paints.length === 0) return { paintType: 'NONE' }

  const paint = paints[0]
  const type = paint.type || 'SOLID'
  let color: string | undefined
  let opacity: number | undefined

  if (type === 'SOLID' && paint.color) {
    const r = Math.round((paint.color.r || 0) * 255)
    const g = Math.round((paint.color.g || 0) * 255)
    const b = Math.round((paint.color.b || 0) * 255)
    color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
    opacity = paint.opacity ?? paint.color.a ?? 1
  }

  return { color, opacity, paintType: type }
}

export function handleStyleListColors(): ColorStyleInfo[] {
  const styles = mg.getLocalPaintStyles()
  const result: ColorStyleInfo[] = []

  for (let i = 0; i < styles.length; i++) {
    const s = styles[i]
    const paints = s.paints || []
    const info = extractColorInfo(paints)
    result.push({
      id: s.id,
      name: s.name,
      description: s.description || '',
      paintType: info.paintType,
      color: info.color,
      opacity: info.opacity,
      paints,
    })
  }

  return result
}

export function handleStyleListText(): TextStyleInfo[] {
  const styles = mg.getLocalTextStyles()
  const result: TextStyleInfo[] = []

  for (let i = 0; i < styles.length; i++) {
    const s = styles[i]
    result.push({
      id: s.id,
      name: s.name,
      description: s.description || '',
      fontName: s.fontName,
      fontSize: s.fontSize,
      fontWeight: fontWeightFromStyleName(s.fontName?.style),
      lineHeight: s.lineHeight ?? null,
      letterSpacing: s.letterSpacing ?? null,
    })
  }

  return result
}

export function handleStyleApply(
  params: { nodeId: string; styleId: string; styleType: 'fill' | 'stroke' | 'text' },
  context: HandlerContext
): { success: boolean; nodeId: string; styleId: string; styleType: string } {
  const { nodeId, styleId, styleType } = params

  const node = mg.getNodeById(nodeId) as any
  if (!node) throw new Error(`Node not found: ${nodeId}`)

  switch (styleType) {
    case 'fill':
      node.fillStyleId = styleId
      break
    case 'stroke':
      node.strokeStyleId = styleId
      break
    case 'text':
      node.textStyleId = styleId
      break
    default:
      throw new Error(`Unsupported styleType: ${styleType}. Supported: fill, stroke, text`)
  }

  return { success: true, nodeId, styleId, styleType }
}
