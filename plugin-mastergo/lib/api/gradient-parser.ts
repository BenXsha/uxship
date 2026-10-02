/**
 * 解析 CSS gradient 字符串（如 linear-gradient(135deg,#4F46E5,#7C3AED)）
 * 转换为 MasterGo GRADIENT_LINEAR / GRADIENT_RADIAL / GRADIENT_ANGULAR 格式
 */
export function parseCSSGradient(gradientStr: string): { type: string; gradientStops: any[]; gradientHandlePositions?: any[]; _centerOffsetX?: number; _centerOffsetY?: number } | null {
  if (gradientStr.startsWith('linear-gradient')) {
    return parseLinearGradient(gradientStr)
  }
  if (gradientStr.startsWith('radial-gradient')) {
    return parseRadialGradient(gradientStr)
  }
  if (gradientStr.startsWith('conic-gradient')) {
    return parseConicGradient(gradientStr)
  }
  return null
}

/**
 * 解析 CSS linear-gradient
 */
export function parseLinearGradient(gradientStr: string): { type: string; gradientStops: any[]; gradientHandlePositions?: any[] } | null {
  const match = gradientStr.match(/linear-gradient\((.+)\)/)
  if (!match) return null
  const inner = match[1]

  let angleDeg = 180
  let stopsStr = inner

  const angleMatch = inner.match(/^\s*(\d+)deg\s*,\s*(.*)/)
  if (angleMatch) {
    angleDeg = parseFloat(angleMatch[1])
    stopsStr = angleMatch[2]
  } else {
    const keywordMatch = inner.match(/^\s*to\s+(\S+(?:\s+\S+)?)\s*,\s*(.*)/)
    if (keywordMatch) {
      const dir = keywordMatch[1]
      const angleMap: Record<string, number> = {
        'bottom': 180,
        'top': 0,
        'right': 90,
        'left': 270,
        'bottom right': 135,
        'bottom left': 225,
        'top right': 45,
        'top left': 315,
      }
      angleDeg = angleMap[dir] ?? 180
      stopsStr = keywordMatch[2]
    }
  }

  const gradientStops = parseGradientStops(stopsStr)
  if (gradientStops.length === 0) return null

  return {
    type: 'GRADIENT_LINEAR',
    gradientStops,
    gradientHandlePositions: angleToHandlePositions(angleDeg),
  }
}

/**
 * 解析 CSS radial-gradient 转换为 MasterGo GRADIENT_RADIAL
 * 支持格式: radial-gradient(circle at X% Y%, stops...)
 *           radial-gradient(ellipse at X% Y%, stops...)
 *           radial-gradient(circle closest-side at X% Y%, stops...)
 *           radial-gradient(#ff0, #f00)
 */
export function parseRadialGradient(gradientStr: string): { type: string; gradientStops: any[]; gradientHandlePositions?: any[]; _centerOffsetX?: number; _centerOffsetY?: number; _sizeW?: number; _sizeH?: number } | null {
  const match = gradientStr.match(/radial-gradient\((.+)\)/)
  if (!match) return null
  let inner = match[1]

  // 提取显式尺寸: "ellipse 185px 185px" 或 "circle 185px"
  let explicitW: number | undefined, explicitH: number | undefined
  const ellipseSizeMatch = inner.match(/ellipse\s+(\d+)px\s+(\d+)px/)
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

  // 提取位置信息: "circle at 50% 50%," 或 "circle closest-side at 30% 60%,"
  let cx = 0.5, cy = 0.5
  const atMatch = inner.match(/at\s+(\d+(?:\.\d+)?%)\s+(\d+(?:\.\d+)?%)\s*,\s*(.*)/)
  if (atMatch) {
    cx = parseFloat(atMatch[1]) / 100
    cy = parseFloat(atMatch[2]) / 100
    inner = atMatch[3]
  } else {
    // "at center" or no position (default 50% 50%)
    const centerMatch = inner.match(/at\s+center\s*,\s*(.*)/)
    if (centerMatch) {
      inner = centerMatch[1]
    } else {
      // strip shape/size keywords before the first comma
      const cleanMatch = inner.match(/^(?:circle|ellipse)?\s*(?:\w+\s+)?,?\s*(.*)/)
      if (cleanMatch) inner = cleanMatch[1]
    }
  }

  const gradientStops = parseGradientStops(inner)
  if (gradientStops.length === 0) return null

  // MasterGo normalizes radial gradient handle positions to center (0.5,0.5)
  // Non-centered center must be achieved via transform matrix
  const result: any = {
    type: 'GRADIENT_RADIAL',
    gradientStops,
    gradientHandlePositions: [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 1 },
    ],
  }

  // Pass center offset back so convertFills can compute transform
  if (cx !== 0.5 || cy !== 0.5) {
    result._centerOffsetX = cx - 0.5
    result._centerOffsetY = cy - 0.5
  }

  // 传递显式尺寸，convertFills 通过 transform 缩放渐变
  if (explicitW !== undefined) {
    result._sizeW = explicitW
    result._sizeH = explicitH
  }

  return result
}

/**
 * 解析 CSS conic-gradient 转换为 MasterGo GRADIENT_ANGULAR
 * 支持格式: conic-gradient(from 0deg at 50% 50%, stops...)
 *           conic-gradient(from 45deg, stops...)
 *           conic-gradient(#ff0, #f00)
 */
export function parseConicGradient(gradientStr: string): { type: string; gradientStops: any[]; gradientHandlePositions?: any[] } | null {
  const match = gradientStr.match(/conic-gradient\((.+)\)/)
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

  const gradientStops = parseGradientStops(inner)
  if (gradientStops.length === 0) return null

  // Angular gradient: first handle = center, second handle = angle direction
  const rad = (fromDeg - 90) * Math.PI / 180
  const handleDist = 0.5
  return {
    type: 'GRADIENT_ANGULAR',
    gradientStops,
    gradientHandlePositions: [
      { x: cx, y: cy },
      { x: cx + Math.cos(rad) * handleDist, y: cy + Math.sin(rad) * handleDist },
    ],
  }
}

/**
 * 解析 gradient stops 字符串，支持 rgba() 嵌套逗号
 */
export function parseGradientStops(stopsStr: string): { position: number; color: string }[] {
  const parts = splitGradientStops(stopsStr)
  if (parts.length === 0) return []

  // 如果只有一个颜色，创建单色渐变
  if (parts.length === 1) {
    const color = parts[0].trim()
    return [
      { position: 0, color },
      { position: 1, color },
    ]
  }

  const gradientStops: { position: number; color: string }[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim()
    const posMatch = part.match(/^(.*?)\s+(\d+(?:\.\d+)?%)$/)
    if (posMatch) {
      gradientStops.push({
        color: posMatch[1].trim(),
        position: parseFloat(posMatch[2]) / 100,
      })
    } else {
      gradientStops.push({
        color: part,
        position: parts.length > 1 ? i / (parts.length - 1) : 0,
      })
    }
  }
  return gradientStops
}

/**
 * 按逗号分割 gradient stops，正确处理 rgba() 内部的逗号
 */
export function splitGradientStops(stopsStr: string): string[] {
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

/**
 * 将 CSS gradient 角度转换为 MasterGo gradientHandlePositions
 *
 * CSS linear-gradient 角度：0deg=bottom-to-top, 90deg=left-to-right
 * 对应 handle positions 是渐变线的起点和终点
 * 坐标在 [0,1]×[0,1] 范围内，(0,0)=左上角
 *
 * CSS 角度转数学角度：mathAngle = 90 - cssAngle
 * 渐变线方向 (dx, dy) 在屏幕坐标系（y向下）中从中心出发
 * handle positions = 渐变线与包围盒 [0,1]×[0,1] 的交点
 */
export function angleToHandlePositions(angleDeg: number): any[] {
  // CSS 0°(上) = 数学 90°(上)，逆时针为正
  const rad = (90 - angleDeg) * Math.PI / 180
  const dx = Math.cos(rad)
  const dy = -Math.sin(rad)  // 屏幕 y 向下取反

  // 计算渐变线 (0.5,0.5) + t * (dx,dy) 与包围盒各边的交点 t 值
  let tMin = -Infinity
  let tMax = Infinity

  if (dx !== 0) {
    const tLeft = -0.5 / dx
    const tRight = 0.5 / dx
    tMin = Math.max(tMin, Math.min(tLeft, tRight))
    tMax = Math.min(tMax, Math.max(tLeft, tRight))
  }

  if (dy !== 0) {
    const tTop = -0.5 / dy
    const tBottom = 0.5 / dy
    tMin = Math.max(tMin, Math.min(tTop, tBottom))
    tMax = Math.min(tMax, Math.max(tTop, tBottom))
  }

  return [
    { x: 0.5 + tMin * dx, y: 0.5 + tMin * dy },
    { x: 0.5 + tMax * dx, y: 0.5 + tMax * dy },
  ]
}
