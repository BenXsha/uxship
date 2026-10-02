export function cssColorToRgb(color: string): { r: number; g: number; b: number; a: number } | null {
  if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') {
    return { r: 0, g: 0, b: 0, a: 0 }
  }
  if (color.startsWith('#')) {
    const hex = color.replace('#', '')
    const r = parseInt(hex.substring(0, 2), 16) / 255
    const g = parseInt(hex.substring(2, 4), 16) / 255
    const b = parseInt(hex.substring(4, 6), 16) / 255
    const a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1
    return { r, g, b, a }
  }
  const rgbaMatch = color.match(/^rgba?\(\s*(\d+)\s*[,/]\s*(\d+)\s*[,/]\s*(\d+)\s*(?:[,/]\s*([\d.]+))?\s*\)$/i)
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1], 10) / 255,
      g: parseInt(rgbaMatch[2], 10) / 255,
      b: parseInt(rgbaMatch[3], 10) / 255,
      a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
    }
  }
  const namedColors: Record<string, string> = {
    black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000',
    blue: '#0000FF', yellow: '#FFFF00', orange: '#FFA500', purple: '#800080',
    pink: '#FFC0CB', gray: '#808080', silver: '#C0C0C0', gold: '#FFD700',
    cyan: '#00FFFF', magenta: '#FF00FF', teal: '#008080', navy: '#000080',
    olive: '#808000', lime: '#00FF00', aqua: '#00FFFF', fuchsia: '#FF00FF',
    maroon: '#800000', darkblue: '#00008B', darkcyan: '#008B8B', darkgray: '#A9A9A9',
    darkgreen: '#006400', darkkhaki: '#BDB76B', darkmagenta: '#8B008B', darkolivegreen: '#556B2F',
    darkorange: '#FF8C00', darkorchid: '#9932CC', darkred: '#8B0000',
    darksalmon: '#E9967A', darkseagreen: '#8FBC8F', darkslateblue: '#483D8B',
    darkslategray: '#2F4F4F', darkturquoise: '#00CED1', darkviolet: '#9400D3',
    deeppink: '#FF1493', deepskyblue: '#00BFFF', dimgray: '#696969',
    dodgerblue: '#1E90FF', firebrick: '#B22222', floralwhite: '#FFFAF0',
    forestgreen: '#228B22', gainsboro: '#DCDCDC', ghostwhite: '#F8F8FF',
    goldenrod: '#DAA520', greenyellow: '#ADFF2F', honeydew: '#F0FFF0',
    hotpink: '#FF69B4', indianred: '#CD5C5C', indigo: '#4B0082', ivory: '#FFFFF0',
    khaki: '#F0E68C', lavender: '#E6E6FA', lavenderblush: '#FFF0F5',
    lawngreen: '#7CFC00', lemonchiffon: '#FFFACD', lightblue: '#ADD8E6',
    lightcoral: '#F08080', lightcyan: '#E0FFFF', lightgoldenrodyellow: '#FAFAD2',
    lightgray: '#D3D3D3', lightgreen: '#90EE90', lightpink: '#FFB6C1',
    lightsalmon: '#FFA07A', lightseagreen: '#20B2AA', lightskyblue: '#87CEFA',
    lightslategray: '#778899', lightsteelblue: '#B0C4DE', lightyellow: '#FFFFE0',
    limegreen: '#32CD32', linen: '#FAF0E6', mediumaquamarine: '#6B8E23',
    mediumblue: '#0000CD', mediumorchid: '#BA55D3', mediumpurple: '#9370DB',
    mediumseagreen: '#3CB371', mediumslateblue: '#7B68EE', mediumspringgreen: '#00FA9A',
    mediumturquoise: '#48D1CC', mediumvioletred: '#C71585', midnightblue: '#191970',
    mintcream: '#F5FFFA', mistyrose: '#FFE4E1', moccasin: '#FFE4B5',
    navajowhite: '#FFDEAD', oldlace: '#FDF5E6', olivedrab: '#6B8E23',
    orangered: '#FF4500', orchid: '#DA70D6', palegoldenrod: '#EEE8AA',
    palegreen: '#98FB98', paleturquoise: '#AFEEEE', palevioletred: '#DB7093',
    papayawhip: '#FFEFD5', peachpuff: '#FFDAB9', peru: '#CD853F',
    plum: '#DDA0DD', powderblue: '#B0E0E6', rosybrown: '#BC8F8F',
    royalblue: '#4169E1', saddlebrown: '#8B4513', salmon: '#FA8072',
    sandybrown: '#F4A460', seagreen: '#2E8B57', seashell: '#FFF5EE',
    sienna: '#A0522D', skyblue: '#87CEEB', slateblue: '#6A5ACD',
    slategray: '#708090', snow: '#FFFAFA', springgreen: '#00FF7F',
    steelblue: '#4682B4', tan: '#D2B48C', thistle: '#D8BFD8',
    tomato: '#FF6347', turquoise: '#40E0D0', violet: '#EE82EE',
    wheat: '#F5DEB3', whitesmoke: '#F5F5F5', yellowgreen: '#9ACD32',
  }
  const hexColor = namedColors[color.toLowerCase()]
  if (hexColor) return cssColorToRgb(hexColor)
  return null
}

/** 归一化 rgb(0–1) → `#RRGGBB`（忽略 alpha；富文本 run 的颜色口径） */
export function rgbToHex(color: { r: number; g: number; b: number }): string {
  const part = (value: number): string => Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, '0')
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`.toUpperCase()
}

export function parseBorderRadius(css: string): number | undefined {  if (!css || css === '0px') return undefined
  const match = css.match(/(\d+)px/)
  return match ? parseInt(match[1]) : undefined
}

export function parseBoxShadow(shadow: string): { offsetX: number; offsetY: number; radius: number; spread: number; color: string; inner: boolean } | null {
  if (!shadow || shadow === 'none') return null
  let inner = false
  let cleanShadow = shadow
  if (shadow.includes('inset')) {
    inner = true
    cleanShadow = shadow.replace(/inset\s*/g, '')
  }

  const colorMatch = cleanShadow.match(/(rgba?\([^)]+\)|#[a-f0-9]{3,8}|[a-z]+)/i)
  if (!colorMatch) return null
  const color = colorMatch[1]
  cleanShadow = cleanShadow.replace(color, '').trim()

  const numParts = cleanShadow.match(/-?\d+px/g) || []
  if (numParts.length < 3) return null

  const offsetX = parseInt(numParts[0] || '0')
  const offsetY = parseInt(numParts[1] || '0')
  const radius = parseInt(numParts[2] || '0')
  const spread = numParts.length >= 4 ? parseInt(numParts[3] || '0') : 0

  return {
    offsetX,
    offsetY,
    radius,
    spread,
    color,
    inner,
  }
}

export function getFontStyle(weight: number): string {
  if (weight >= 800) return 'Extra Bold'
  if (weight >= 700) return 'Bold'
  if (weight >= 600) return 'Semi Bold'
  if (weight >= 500) return 'Medium'
  return 'Regular'
}
