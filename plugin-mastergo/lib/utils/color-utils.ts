export interface RGBColor {
  r: number
  g: number
  b: number
  a: number
}

export function hexToRgb(hex: string): RGBColor {
  // Try hex format: #RGB, #RRGGBB, #RRGGBBAA
  const hexResult = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(hex)
  if (hexResult) {
    return {
      r: parseInt(hexResult[1], 16) / 255,
      g: parseInt(hexResult[2], 16) / 255,
      b: parseInt(hexResult[3], 16) / 255,
      a: hexResult[4] ? parseInt(hexResult[4], 16) / 255 : 1,
    }
  }

  // Try rgba(r,g,b,a) or rgb(r,g,b)
  const rgbaMatch = hex.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/i)
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1], 10) / 255,
      g: parseInt(rgbaMatch[2], 10) / 255,
      b: parseInt(rgbaMatch[3], 10) / 255,
      a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
    }
  }

  // Try named CSS colors
  if (hex.toLowerCase() === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 }
  }

  return { r: 0, g: 0, b: 0, a: 1 }
}

export function rgbToHex(rgb: { r: number; g: number; b: number; a?: number }): string {
  const r = Math.round(rgb.r * 255).toString(16).padStart(2, '0')
  const g = Math.round(rgb.g * 255).toString(16).padStart(2, '0')
  const b = Math.round(rgb.b * 255).toString(16).padStart(2, '0')
  if (rgb.a !== undefined && rgb.a < 1) {
    const a = Math.round(rgb.a * 255).toString(16).padStart(2, '0')
    return `#${r}${g}${b}${a}`
  }
  return `#${r}${g}${b}`
}

export type ColorInput = string | { r: number; g: number; b: number; a?: number }

export function processColor(color: ColorInput): RGBColor {
  if (typeof color === 'string') {
    return hexToRgb(color)
  }
  if (typeof color === 'object' && color !== null) {
    const r = typeof color.r === 'number' ? color.r : 0
    const g = typeof color.g === 'number' ? color.g : 0
    const b = typeof color.b === 'number' ? color.b : 0
    const a = typeof color.a === 'number' ? color.a : 1
    const needsNormalization = r > 1 || g > 1 || b > 1
    return {
      r: needsNormalization ? r / 255 : r,
      g: needsNormalization ? g / 255 : g,
      b: needsNormalization ? b / 255 : b,
      a: a,
    }
  }
  return { r: 0, g: 0, b: 0, a: 1 }
}

export function colorDistance(
  c1: { r: number; g: number; b: number },
  c2: { r: number; g: number; b: number }
): number {
  const dr = c1.r - c2.r
  const dg = c1.g - c2.g
  const db = c1.b - c2.b
  return Math.sqrt(dr * dr + dg * dg + db * db) * 100
}
