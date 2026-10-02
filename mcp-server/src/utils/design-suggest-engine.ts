const COLOR_MAP: Record<string, { r: number; g: number; b: number }> = {
  红: { r: 239, g: 68, b: 68 },
  红色: { r: 239, g: 68, b: 68 },
  深红: { r: 185, g: 28, b: 28 },
  蓝: { r: 59, g: 130, b: 246 },
  蓝色: { r: 59, g: 130, b: 246 },
  深蓝: { r: 30, g: 64, b: 175 },
  浅蓝: { r: 147, g: 197, b: 253 },
  绿: { r: 34, g: 197, b: 94 },
  绿色: { r: 34, g: 197, b: 94 },
  深绿: { r: 21, g: 128, b: 61 },
  浅绿: { r: 187, g: 247, b: 212 },
  紫: { r: 168, g: 85, b: 247 },
  紫色: { r: 168, g: 85, b: 247 },
  黄: { r: 234, g: 179, b: 8 },
  黄色: { r: 234, g: 179, b: 8 },
  橙: { r: 249, g: 115, b: 22 },
  橙色: { r: 249, g: 115, b: 22 },
  黑: { r: 0, g: 0, b: 0 },
  黑色: { r: 0, g: 0, b: 0 },
  白: { r: 255, g: 255, b: 255 },
  白色: { r: 255, g: 255, b: 255 },
  灰: { r: 107, g: 114, b: 128 },
  灰色: { r: 107, g: 114, b: 128 },
  深灰: { r: 55, g: 65, b: 81 },
  深灰色: { r: 55, g: 65, b: 81 },
  浅灰: { r: 209, g: 213, b: 219 },
  浅灰色: { r: 209, g: 213, b: 219 },
  品牌色: { r: 67, g: 64, b: 234 },
  透明: { r: 0, g: 0, b: 0 },
  金色: { r: 212, g: 175, b: 55 },
  粉色: { r: 236, g: 72, b: 153 },
  青色: { r: 20, g: 184, b: 166 },
  棕色: { r: 139, g: 90, b: 43 },
  靛蓝: { r: 99, g: 102, b: 241 },
  靛色: { r: 99, g: 102, b: 241 },
  玫红: { r: 244, g: 63, b: 94 },
  墨绿: { r: 6, g: 78, b: 59 },
  天蓝: { r: 14, g: 165, b: 233 },
  藏蓝: { r: 25, g: 43, b: 92 },
}

const ALIGN_MAP: Record<string, string> = {
  居中对齐: 'CENTER',
  居中: 'CENTER',
  左对齐: 'MIN',
  靠左: 'MIN',
  右对齐: 'MAX',
  靠右: 'MAX',
  分散对齐: 'SPACE_BETWEEN',
  两端对齐: 'SPACE_BETWEEN',
}

const CROSS_ALIGN_MAP: Record<string, string> = {
  顶部对齐: 'MIN',
  靠上: 'MIN',
  底部对齐: 'MAX',
  靠下: 'MAX',
  垂直居中: 'CENTER',
  上下居中: 'CENTER',
  拉伸: 'STRETCH',
}

const BRAND_STYLES: Record<string, { fills?: Array<{ type: string; color: { r: number; g: number; b: number; a: number } }>; cornerRadius?: number; fonts?: Record<string, any> }> = {
  '苹果': {
    fills: [{ type: 'SOLID', color: { r: 0, g: 0.44, b: 0.89, a: 1 } }],
    cornerRadius: 12,
  },
  '苹果风': {
    fills: [{ type: 'SOLID', color: { r: 0, g: 0.44, b: 0.89, a: 1 } }],
    cornerRadius: 12,
  },
}

const FONT_MAP: Record<string, { family: string; style?: string }> = {
  苹方: { family: 'PingFang SC' },
  pingfang: { family: 'PingFang SC' },
  思源黑体: { family: 'Noto Sans CJK SC' },
  思源宋体: { family: 'Noto Serif CJK SC' },
  微软雅黑: { family: 'Microsoft YaHei' },
  yahei: { family: 'Microsoft YaHei' },
  arial: { family: 'Arial' },
  helvetica: { family: 'Helvetica Neue' },
  roboto: { family: 'Roboto' },
  inter: { family: 'Inter' },
  sf: { family: 'SF Pro' },
  sfpro: { family: 'SF Pro' },
  monospace: { family: 'JetBrains Mono', style: 'Regular' },
  等宽: { family: 'JetBrains Mono', style: 'Regular' },
}

const GRADIENT_COLOR_ORDER: Record<string, string[]> = {
  蓝紫: ['#3B82F6', '#8B5CF6'],
  蓝绿: ['#3B82F6', '#10B981'],
  红橙: ['#EF4444', '#F97316'],
  红紫: ['#EF4444', '#A855F7'],
  紫粉: ['#A855F7', '#EC4899'],
  青蓝: ['#14B8A6', '#3B82F6'],
  橙黄: ['#F97316', '#EAB308'],
  黑白: ['#000000', '#FFFFFF'],
  暗色: ['#1F2937', '#111827'],
  亮色: ['#F9FAFB', '#FFFFFF'],
}

const THEME_MAP: Record<string, { name: string; changes: Array<{ type: string; description: string; properties: Record<string, any> }> }> = {
  暗色主题: {
    name: '暗色主题',
    changes: [
      { type: 'fill', description: '背景改为深色', properties: { fills: [{ type: 'SOLID', color: { r: 0.12, g: 0.12, b: 0.14, a: 1 } }] } },
      { type: 'textColor', description: '文字改为浅色', properties: { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }] } },
    ],
  },
  深色主题: {
    name: '深色主题',
    changes: [
      { type: 'fill', description: '背景改为深色', properties: { fills: [{ type: 'SOLID', color: { r: 0.12, g: 0.12, b: 0.14, a: 1 } }] } },
      { type: 'textColor', description: '文字改为浅色', properties: { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }] } },
    ],
  },
  亮色主题: {
    name: '亮色主题',
    changes: [
      { type: 'fill', description: '背景改为白色', properties: { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }] } },
      { type: 'textColor', description: '文字改为深色', properties: { fills: [{ type: 'SOLID', color: { r: 0.07, g: 0.09, b: 0.16, a: 1 } }] } },
    ],
  },
  轻量主题: {
    name: '轻量主题',
    changes: [
      { type: 'fill', description: '背景改为浅灰', properties: { fills: [{ type: 'SOLID', color: { r: 0.96, g: 0.97, b: 0.98, a: 1 } }] } },
      { type: 'textColor', description: '文字加深', properties: { fills: [{ type: 'SOLID', color: { r: 0.07, g: 0.09, b: 0.16, a: 1 } }] } },
    ],
  },
}

function parseColor(text: string): { r: number; g: number; b: number; a: number } | null {
  if (hasKeyword(text, ['透明度', '不透明'])) return null
  const hasFontContext = hasKeyword(text, ['字体', '字型'])
  for (const [key, rgb] of Object.entries(COLOR_MAP)) {
    if (hasFontContext && key.length === 1) continue
    if (text.includes(key)) {
      return { ...rgb, a: key === '透明' ? 0 : 1 }
    }
  }
  const hexMatch = text.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/g)
  if (hexMatch) {
    const hex = hexMatch[0]
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
      a: 1,
    }
  }
  const rgbaMatch = text.match(/rgba?\(\s*(\d+)\s*,?\s*(\d+)\s*,?\s*(\d+)/)
  if (rgbaMatch) {
    return { r: +rgbaMatch[1], g: +rgbaMatch[2], b: +rgbaMatch[3], a: 1 }
  }
  return null
}

function parseNumber(text: string): number | null {
  const match = text.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : null
}

function parseNumberNear(text: string, keyword: string): number | null {
  const idx = text.indexOf(keyword)
  if (idx === -1) return null
  const after = text.slice(idx + keyword.length)
  const gaiwei = after.match(/改为\s*(\d+)/)
  if (gaiwei) return parseInt(gaiwei[1], 10)
  const m = after.match(/^\s*(\d+)/)
  if (m) return parseInt(m[1], 10)
  const dao = after.match(/到\s*(\d+)/)
  if (dao) return parseInt(dao[1], 10)
  const before = text.slice(0, idx)
  const m2 = before.match(/(\d+)\s*$/)
  if (m2) return parseInt(m2[1], 10)
  return null
}

function hasKeyword(text: string, keywords: string[]): boolean {
  return keywords.some(k => text.includes(k))
}

export interface ChangeProposal {
  type: string
  description: string
  filter?: Record<string, any>
  properties: Record<string, any>
}

function suggestDirection(text: string, structure: any): ChangeProposal | null {
  const isHorizontal = hasKeyword(text, ['横向', '水平', '行排列', '行布局', '从左到右', '横排'])
  const isVertical = hasKeyword(text, ['纵向', '垂直', '竖向', '列排列', '列布局', '从上到下', '竖排', '垂直排列'])

  if (!isHorizontal && !isVertical) return null

  const currentLayout = structure.layout?.direction
  const target = isHorizontal ? 'HORIZONTAL' : 'VERTICAL'
  if (currentLayout === target) return null

  return {
    type: 'layoutDirection',
    description: `布局方向改为 ${isHorizontal ? '横向(HORIZONTAL)' : '纵向(VERTICAL)'}`,
    properties: { layoutMode: target, flexMode: target },
  }
}

const DIRECTION_KEYWORDS: Record<string, 'top' | 'right' | 'bottom' | 'left'> = {
  '上边': 'top', '上方': 'top', '顶部': 'top', '上面': 'top',
  '右边': 'right', '右侧': 'right', '右方': 'right', '右面': 'right',
  '下边': 'bottom', '下方': 'bottom', '底部': 'bottom', '下面': 'bottom',
  '左边': 'left', '左侧': 'left', '左方': 'left', '左面': 'left',
}

function detectPaddingDirection(text: string): 'top' | 'right' | 'bottom' | 'left' | null {
  for (const [kw, dir] of Object.entries(DIRECTION_KEYWORDS)) {
    if (text.includes(kw)) return dir
  }
  return null
}

function suggestPadding(text: string, structure: any): ChangeProposal | null {
  if (!hasKeyword(text, ['内边距', 'padding', '边距', '留白'])) return null

  const num = parseNumberNear(text, '边距') ?? parseNumberNear(text, 'padding') ?? parseNumber(text)
  const isBigger = hasKeyword(text, ['加大', '增大', '扩大', '增加', '多一点', '宽一点'])
  const isSmaller = hasKeyword(text, ['减小', '缩小', '减少', '小一点', '窄一点', '紧凑'])

  if (num === null && !isBigger && !isSmaller) return null

  const current = {
    top: structure.layout?.padding?.[0] ?? 0,
    right: structure.layout?.padding?.[1] ?? 0,
    bottom: structure.layout?.padding?.[2] ?? 0,
    left: structure.layout?.padding?.[3] ?? 0,
  }

  const direction = detectPaddingDirection(text)
  const currentVal = direction ? current[direction] : Math.max(current.top, current.right, current.bottom, current.left)

  let v = currentVal
  if (num !== null) v = num
  else if (isBigger) v = Math.max(currentVal, 16) + 8
  else if (isSmaller) v = Math.max(0, currentVal - 8)

  const props: Record<string, number> = direction
    ? { [`padding${direction.charAt(0).toUpperCase() + direction.slice(1)}`]: v }
    : { paddingTop: v, paddingRight: v, paddingBottom: v, paddingLeft: v }

  const dirLabel = direction ? `${direction} ` : ''

  return {
    type: 'padding',
    description: `${dirLabel}内边距改为 ${v}px (原 top=${current.top}, right=${current.right}, bottom=${current.bottom}, left=${current.left})`,
    properties: props,
  }
}

function suggestLineHeight(text: string): ChangeProposal | null {
  if (!hasKeyword(text, ['行高', '行距', 'lineheight', 'line-height'])) return null

  const num = parseNumberNear(text, '高') ?? parseNumberNear(text, '距') ?? parseNumber(text)
  const isBigger = hasKeyword(text, ['加大', '增大', '扩大', '增加'])
  const isSmaller = hasKeyword(text, ['减小', '缩小', '减少'])

  if (num !== null) {
    return {
      type: 'lineHeight',
      description: `行高改为 ${num}px`,
      properties: { lineHeight: { unit: 'PIXELS', value: num } },
    }
  }

  if (isBigger) {
    return {
      type: 'lineHeight',
      description: '行高加大',
      properties: { lineHeight: { unit: 'PIXELS', value: 28 } },
    }
  }

  if (isSmaller) {
    return {
      type: 'lineHeight',
      description: '行高减小',
      properties: { lineHeight: { unit: 'PIXELS', value: 18 } },
    }
  }

  return null
}

function suggestLetterSpacing(text: string): ChangeProposal | null {
  if (!hasKeyword(text, ['字间距', '字距', '字符间距', 'letterspacing', 'letter-spacing'])) return null

  const num = parseNumberNear(text, '距') ?? parseNumberNear(text, '间距') ?? parseNumber(text)
  const isBigger = hasKeyword(text, ['加大', '增大', '扩大', '松散', '宽松'])
  const isSmaller = hasKeyword(text, ['减小', '缩小', '紧密', '紧凑'])

  let v = 0
  if (num !== null) v = num
  else if (isBigger) v = 2
  else if (isSmaller) v = -0.5

  return {
    type: 'letterSpacing',
    description: `字间距改为 ${v}`,
    properties: { letterSpacing: v },
  }
}

function suggestFontName(text: string): ChangeProposal | null {
  if (!hasKeyword(text, ['字体', '字型', 'font'])) return null

  for (const [key, font] of Object.entries(FONT_MAP)) {
    if (text.includes(key)) {
      return {
        type: 'fontName',
        description: `字体改为 ${font.family}${font.style ? ` ${font.style}` : ''}`,
        properties: { fontName: { family: font.family, style: font.style || 'Regular' } },
      }
    }
  }

  return null
}

function suggestGradient(text: string): ChangeProposal | null {
  if (!hasKeyword(text, ['渐变', '渐变色', 'gradient'])) return null

  for (const [key, colors] of Object.entries(GRADIENT_COLOR_ORDER)) {
    if (text.includes(key)) {
      return {
        type: 'gradientFill',
        description: `改为 ${key} 线性渐变`,
        properties: {
          fills: [{
            type: 'GRADIENT_LINEAR',
            gradientStops: [
              { position: 0, color: colors[0] },
              { position: 1, color: colors[1] },
            ],
            gradientHandlePositions: [
              { x: 0, y: 0.5 },
              { x: 1, y: 0.5 },
            ],
          }],
        },
      }
    }
  }

  const fromColor = parseColor(text)
  if (fromColor) {
    const other = fromColor.r > 128 ? '#1F2937' : '#F9FAFB'
    return {
      type: 'gradientFill',
      description: '改为线性渐变',
      properties: {
        fills: [{
          type: 'GRADIENT_LINEAR',
          gradientStops: [
            { position: 0, color: `#${fromColor.r.toString(16).padStart(2, '0')}${fromColor.g.toString(16).padStart(2, '0')}${fromColor.b.toString(16).padStart(2, '0')}` },
            { position: 1, color: other },
          ],
          gradientHandlePositions: [
            { x: 0, y: 0.5 },
            { x: 1, y: 0.5 },
          ],
        }],
      },
    }
  }

  return {
    type: 'gradientFill',
    description: '改为线性渐变',
    properties: {
      fills: [{
        type: 'GRADIENT_LINEAR',
        gradientStops: [
          { position: 0, color: '#6366F1' },
          { position: 1, color: '#8B5CF6' },
        ],
        gradientHandlePositions: [
          { x: 0, y: 0.5 },
          { x: 1, y: 0.5 },
        ],
      }],
    },
  }
}

function suggestStrokeWidth(text: string): ChangeProposal | null {
  if (!hasKeyword(text, ['描边', '描边宽度', '描边粗细', '边框', '边框宽度', '边框粗细', 'stroke-width', 'border-width'])) return null

  const near = parseNumberNear(text, '描边') ?? parseNumberNear(text, '边框')
  if (near !== null) {
    return {
      type: 'strokeWidth',
      description: `描边宽度改为 ${near}px`,
      properties: { strokeWeight: near },
    }
  }

  if (hasKeyword(text, ['加粗', '加厚'])) {
    return {
      type: 'strokeWidth',
      description: '描边加粗',
      properties: { strokeWeight: 2 },
    }
  }

  if (hasKeyword(text, ['变细', '变薄'])) {
    return {
      type: 'strokeWidth',
      description: '描边变细',
      properties: { strokeWeight: 0.5 },
    }
  }

  const fallback = parseNumber(text)
  if (fallback !== null) {
    return {
      type: 'strokeWidth',
      description: `描边宽度改为 ${fallback}px`,
      properties: { strokeWeight: fallback },
    }
  }

  return null
}

function suggestCrossAlign(text: string): ChangeProposal | null {
  if (!hasKeyword(text, ['顶部对齐', '靠上', '底部对齐', '靠下', '垂直居中', '上下居中', '拉伸'])) return null

  for (const [key, val] of Object.entries(CROSS_ALIGN_MAP)) {
    if (text.includes(key)) {
      return {
        type: 'crossAxisAlignment',
        description: `交叉轴对齐改为 ${key}`,
        properties: { counterAxisAlignItems: val, crossAxisAlignItems: val },
      }
    }
  }

  return null
}

function suggestFlexWrap(text: string): ChangeProposal | null {
  if (!hasKeyword(text, ['换行', '折行', 'wrap', '不换行', 'nowrap'])) return null

  const shouldWrap = hasKeyword(text, ['换行', '折行', 'wrap']) && !hasKeyword(text, ['不换行', '不折行', 'nowrap'])

  return {
    type: 'flexWrap',
    description: shouldWrap ? '允许换行' : '不换行',
    properties: { flexWrap: shouldWrap ? 'WRAP' : 'NO_WRAP' },
  }
}

function suggestLock(text: string): ChangeProposal | null {
  if (!hasKeyword(text, ['锁定', '解锁'])) return null

  const shouldLock = hasKeyword(text, ['锁定']) && !hasKeyword(text, ['解锁'])

  return {
    type: 'lock',
    description: shouldLock ? '锁定元素' : '解锁元素',
    properties: { isLocked: shouldLock },
  }
}

function suggestTextVerticalAlign(text: string): ChangeProposal | null {
  if (!hasKeyword(text, ['垂直对齐'])) return null

  if (hasKeyword(text, ['顶部', '靠上', '上对齐'])) {
    return {
      type: 'textVerticalAlign',
      description: '文字垂直顶部对齐',
      properties: { textAlignVertical: 'TOP' },
    }
  }

  if (hasKeyword(text, ['居中'])) {
    return {
      type: 'textVerticalAlign',
      description: '文字垂直居中',
      properties: { textAlignVertical: 'CENTER' },
    }
  }

  if (hasKeyword(text, ['底部', '靠下', '下对齐'])) {
    return {
      type: 'textVerticalAlign',
      description: '文字垂直底部对齐',
      properties: { textAlignVertical: 'BOTTOM' },
    }
  }

  return null
}

function suggestParagraphSpacing(text: string): ChangeProposal | null {
  if (!hasKeyword(text, ['段落间距', '段距', '段落间隔', 'paragraph-spacing'])) return null

  const num = parseNumberNear(text, '段落间距') ?? parseNumberNear(text, '段距') ?? parseNumberNear(text, '段落') ?? parseNumber(text)
  const isBigger = hasKeyword(text, ['加大', '增大', '增加'])
  const isSmaller = hasKeyword(text, ['减小', '缩小', '减少'])

  let v = 12
  if (num !== null) v = num
  else if (isBigger) v = 16
  else if (isSmaller) v = 4

  return {
    type: 'paragraphSpacing',
    description: `段落间距改为 ${v}`,
    properties: { paragraphSpacing: v },
  }
}

function suggestBlur(text: string): ChangeProposal | null {
  if (!hasKeyword(text, ['模糊', '毛玻璃', 'blur'])) return null

  const num = parseNumberNear(text, '模糊') ?? parseNumber(text)

  if (hasKeyword(text, ['背景模糊', '毛玻璃', 'background blur'])) {
    return {
      type: 'backgroundBlur',
      description: `背景模糊 ${num ?? 10}px`,
      properties: {
        effects: [{
          type: 'BACKGROUND_BLUR',
          radius: num ?? 10,
          visible: true,
          isEffectShow: true,
        }],
      },
    }
  }

  return {
    type: 'layerBlur',
    description: `图层模糊 ${num ?? 4}px`,
    properties: {
      effects: [{
        type: 'LAYER_BLUR',
        radius: num ?? 4,
        visible: true,
        isEffectShow: true,
      }],
    },
  }
}

function suggestInnerShadow(text: string): ChangeProposal | null {
  if (!hasKeyword(text, ['内阴影', 'inner shadow', '内部阴影'])) return null

  return {
    type: 'innerShadow',
    description: '添加内阴影',
    properties: {
      effects: [{
        type: 'INNER_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.1 },
        offset: { x: 0, y: 2 },
        radius: 4,
        visible: true,
      }],
    },
  }
}

function suggestClipsContent(text: string): ChangeProposal | null {
  if (!hasKeyword(text, ['裁剪', '溢出隐藏', '溢出', 'clip'])) return null

  const shouldClip = hasKeyword(text, ['裁剪', '溢出隐藏', '隐藏溢出']) && !hasKeyword(text, ['不裁剪', '不溢出', '不隐藏'])

  return {
    type: 'clipsContent',
    description: shouldClip ? '裁剪溢出内容' : '不裁剪内容',
    properties: { clipsContent: shouldClip },
  }
}

function suggestGap(text: string): ChangeProposal | null {
  if (!hasKeyword(text, ['间距', '间隔', 'gap'])) return null
  if (hasKeyword(text, ['字间距', '字距', '段落间距', '段距', '段落间隔'])) return null

  const isBigger = hasKeyword(text, ['加大', '增大', '扩大', '增加', '大一点'])
  const isSmaller = hasKeyword(text, ['减小', '缩小', '缩小', '减少', '小一点', '紧凑'])

  const defaultCurrent = 0
  let newSpacing = defaultCurrent

  if (isBigger) newSpacing = 12
  else if (isSmaller) newSpacing = 4
  else {
    const n = parseNumberNear(text, '间距') ?? parseNumberNear(text, 'gap') ?? parseNumber(text)
    if (n !== null) newSpacing = n
  }

  return {
    type: 'spacing',
    description: `子元素间距改为 ${newSpacing}`,
    properties: { itemSpacing: newSpacing },
  }
}

function suggestFontWeight(text: string): ChangeProposal | null {
  if (hasKeyword(text, ['描边'])) return null
  if (!hasKeyword(text, ['加粗', '粗体', 'bold'])) {
    const num = parseNumberNear(text, '重') ?? parseNumber(text)
    if (num !== null && hasKeyword(text, ['字重', 'weight', 'font-weight'])) {
      let style = 'Regular'
      if (num >= 700) style = 'Bold'
      else if (num >= 600) style = 'Semi Bold'
      else if (num >= 500) style = 'Medium'
      else if (num <= 300) style = 'Light'

      return {
        type: 'fontWeight',
        description: `字重改为 ${num}`,
        properties: { fontWeight: num, fontName: { family: '', style } },
      }
    }
    return null
  }

  return {
    type: 'fontWeight',
    description: '加粗文字',
    properties: { fontWeight: 700, fontName: { family: '', style: 'Bold' } },
  }
}

function suggestTheme(text: string): Array<{ type: string; description: string; properties: Record<string, any> }> | null {
  for (const [key, theme] of Object.entries(THEME_MAP)) {
    if (text.includes(key)) {
      return theme.changes
    }
  }
  return null
}

export function suggestChanges(
  structure: any,
  instruction: string
): { proposals: ChangeProposal[]; unmatched: string[] } {
  const proposals: ChangeProposal[] = []
  const unmatched: string[] = []
  const text = instruction.toLowerCase()

  const themeChanges = suggestTheme(text)
  if (themeChanges) {
    proposals.push(...themeChanges)
  }

  if (hasKeyword(text, ['隐藏', '不可见', '消失'])) {
    proposals.push({
      type: 'visibility',
      description: '隐藏元素',
      properties: { isVisible: false },
    })
  } else if (hasKeyword(text, ['显示', '可见'])) {
    proposals.push({
      type: 'visibility',
      description: '显示元素',
      properties: { isVisible: true },
    })
  }

  const color = parseColor(text)
  if (color) {
    const hasStroke = hasKeyword(text, ['描边', '边框'])
    if (hasStroke) {
      proposals.push({
        type: 'stroke',
        description: `描边颜色改为 rgba(${color.r},${color.g},${color.b},${color.a})`,
        properties: {
          strokes: [{ type: 'SOLID', color: { r: color.r / 255, g: color.g / 255, b: color.b / 255, a: color.a } }],
        },
      })
    }
    const hasGradient = hasKeyword(text, ['渐变', '渐变色'])
    if (!hasGradient && !hasStroke) {
      proposals.push({
        type: 'fill',
        description: `填充颜色改为 rgba(${color.r},${color.g},${color.b},${color.a})`,
        properties: {
          fills: [{ type: 'SOLID', color: { r: color.r / 255, g: color.g / 255, b: color.b / 255, a: color.a } }],
        },
      })
    }
  }

  const direction = suggestDirection(text, structure)
  if (direction) proposals.push(direction)

  const padding = suggestPadding(text, structure)
  if (padding) proposals.push(padding)

  const gap = suggestGap(text)
  if (gap) proposals.push(gap)

  const lineHeight = suggestLineHeight(text)
  if (lineHeight) proposals.push(lineHeight)

  const letterSpacing = suggestLetterSpacing(text)
  if (letterSpacing) proposals.push(letterSpacing)

  const fontName = suggestFontName(text)
  if (fontName) proposals.push(fontName)

  const gradient = suggestGradient(text)
  if (gradient) proposals.push(gradient)

  const strokeWidth = suggestStrokeWidth(text)
  if (strokeWidth) proposals.push(strokeWidth)

  const crossAlign = suggestCrossAlign(text)
  if (crossAlign) proposals.push(crossAlign)

  const wrap = suggestFlexWrap(text)
  if (wrap) proposals.push(wrap)

  const lock = suggestLock(text)
  if (lock) proposals.push(lock)

  const textVAlign = suggestTextVerticalAlign(text)
  if (textVAlign) proposals.push(textVAlign)

  const paraSpacing = suggestParagraphSpacing(text)
  if (paraSpacing) proposals.push(paraSpacing)

  const blur = suggestBlur(text)
  if (blur) proposals.push(blur)

  const innerShadow = suggestInnerShadow(text)
  if (innerShadow) proposals.push(innerShadow)

  const clips = suggestClipsContent(text)
  if (clips) proposals.push(clips)

  const fontWeight = suggestFontWeight(text)
  if (fontWeight) proposals.push(fontWeight)

  const brandMatch = Object.entries(BRAND_STYLES).find(([key]) => text.includes(key))
  if (brandMatch) {
    const [brandName, brandStyle] = brandMatch
    const desc: string[] = []
    if (brandStyle.fills) {
      const c = brandStyle.fills[0].color
      proposals.push({ type: 'fill', description: `${brandName}品牌色`, properties: { fills: brandStyle.fills } })
      desc.push(`${brandName}品牌色`)
    }
    if (brandStyle.cornerRadius) {
      proposals.push({ type: 'cornerRadius', description: `${brandName}圆角`, properties: { cornerRadius: brandStyle.cornerRadius } })
      desc.push(`${brandName}圆角`)
    }
  }

  if (hasKeyword(text, ['圆角'])) {
    const radius = parseNumberNear(text, '圆角') ?? parseNumber(text)
    proposals.push({
      type: 'cornerRadius',
      description: `圆角改为 ${radius ?? 8}px`,
      properties: { cornerRadius: radius ?? 8 },
    })
  }

  if (hasKeyword(text, ['圆点', '变成圆', '改成圆', '弄圆'])) {
    proposals.push({
      type: 'cornerRadius',
      description: '改为圆点（大圆角）',
      properties: { cornerRadius: 999 },
    })
  }

  if (hasKeyword(text, ['加阴影', '添加阴影', '外部阴影'])) {
    proposals.push({
      type: 'shadow',
      description: '添加投影效果',
      properties: {
        effects: [{
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.15 },
          offset: { x: 0, y: 4 },
          radius: 8,
          visible: true,
        }],
      },
    })
  }

  if (hasKeyword(text, ['去阴影', '移除阴影', '去除阴影', '删除阴影', '去除'])) {
    proposals.push({
      type: 'shadow',
      description: '移除所有阴影效果',
      properties: { effects: [] },
    })
  }

  // 对象级优先：命中就**不再**给容器级提案（同一句话不该同时改容器和对象）
  const nodeAlign = suggestNodeAlignment(text)
  if (nodeAlign) {
    proposals.push(nodeAlign)
  } else {
    const align = suggestAlign(text)
    if (align) proposals.push(align)
  }

  if (hasKeyword(text, ['字号', '字体大小']) && !hasKeyword(text, ['字重', '间距', '间隔'])) {
    const sz = parseNumberNear(text, '号') ?? parseNumberNear(text, '大小') ?? parseNumber(text)
    if (sz !== null) {
      proposals.push({
        type: 'fontSize',
        description: `字号改为 ${sz}px`,
        properties: { fontSize: sz },
      })
    }
  }

  if (hasKeyword(text, ['透明度', '不透明'])) {
    if (hasKeyword(text, ['半透明', '半透'])) {
      proposals.push({
        type: 'opacity',
        description: '透明度改为 50%',
        properties: { opacity: 0.5 },
      })
    } else {
      const n = parseNumberNear(text, '透明度') ?? parseNumber(text)
      if (n !== null) {
        proposals.push({
          type: 'opacity',
          description: `透明度改为 ${Math.min(100, n)}%`,
          properties: { opacity: Math.min(100, n) / 100 },
        })
      }
    }
  }

  if ((hasKeyword(text, ['宽度', '宽', 'wide', 'width']) || hasKeyword(text, ['加宽', '增宽'])) && !hasKeyword(text, ['描边宽度', '边框宽度'])) {
    const w = parseNumberNear(text, '宽度') ?? parseNumberNear(text, '宽') ?? parseNumberNear(text, '加宽') ?? parseNumber(text)
    if (w !== null) {
      proposals.push({
        type: 'width',
        description: `宽度改为 ${w}px`,
        properties: { width: w },
      })
    }
  }

  if ((hasKeyword(text, ['高度', '高']) || hasKeyword(text, ['加高', '增高', '缩短'])) && !hasKeyword(text, ['行高', 'line'])) {
    const h = parseNumberNear(text, '高度') ?? parseNumberNear(text, '高') ?? parseNumberNear(text, '缩短') ?? parseNumber(text)
    if (h !== null) {
      proposals.push({
        type: 'height',
        description: `高度改为 ${h}px`,
        properties: { height: h },
      })
    }
  }

  if (hasKeyword(text, ['旋转'])) {
    const deg = parseNumberNear(text, '旋转') ?? parseNumber(text)
    if (deg !== null) {
      proposals.push({
        type: 'rotation',
        description: `旋转 ${deg}°`,
        properties: { rotation: deg },
      })
    }
  }

  if (proposals.length === 0) {
    // Fuzzy fallback: try to extract any meaningful parts from unmatched text
    const anyNum = parseNumber(text)
    if (hasKeyword(text, ['大', '小', '多', '少', '宽', '窄', '高', '低', '厚', '薄'])) {
      const fuzzy = hasKeyword(text, ['大', '多', '宽', '高', '厚']) ? 'bigger' : 'smaller'
      if (hasKeyword(text, ['间距', 'gap', '间隔'])) {
        proposals.push({
          type: 'spacing',
          description: `提示: 未能精确匹配"${instruction}"。请尝试"间距加大"或"间距16"等明确指令`,
          properties: { itemSpacing: fuzzy === 'bigger' ? 12 : 4 },
        })
      } else if (hasKeyword(text, ['边距', 'padding', '留白'])) {
        proposals.push({
          type: 'padding',
          description: `提示: 未能精确匹配"${instruction}"。请尝试"内边距加大"或"内边距24"等明确指令`,
          properties: { paddingTop: fuzzy === 'bigger' ? 24 : 8, paddingRight: fuzzy === 'bigger' ? 24 : 8, paddingBottom: fuzzy === 'bigger' ? 24 : 8, paddingLeft: fuzzy === 'bigger' ? 24 : 8 },
        })
      } else if (hasKeyword(text, ['字号', '字体大小', '字'])) {
        const fallbackSize = fuzzy === 'bigger' ? (anyNum ?? 24) : (anyNum ?? 12)
        proposals.push({
          type: 'fontSize',
          description: `提示: 未能精确匹配"${instruction}"。建议使用"字号20"等带数值的指令`,
          properties: { fontSize: fallbackSize },
        })
      }
    }
  }

  if (proposals.length === 0) {
    unmatched.push(instruction)
  }

  return { proposals, unmatched }
}

/**
 * **对象之间**的对齐/等距分布（与上面的"容器内对齐"是两件事）
 *
 * - 容器内对齐（`suggestAlign` / `CROSS_ALIGN_MAP`）：改 flex 容器的 `primaryAxisAlignItems`，
 *   让**子元素在容器里**怎么排。
 * - 对象之间对齐（本函数）：把**若干个选中的对象**互相摆齐，改的是各对象的坐标。
 *   插件原语 `node/align`（Penpot：`alignHorizontal/Vertical`、`distributeHorizontal/Vertical`）。
 *
 * 判别规则（写死，避免歧义）：
 *   1. 命中「等距 / 分布 / 间隔相等」这类**只可能指对象之间**的词 → 走分布；
 *   2. 命中对齐词 **且** 文本里有多对象标记（对象/多个/这几个/选中/全部/所有/互相） → 走对象对齐；
 *   3. 其余仍按原来的容器语义（保持向后兼容 —— 老指令的行为不变）。
 */
const OBJECT_MARKERS = ['对象', '图层', '多个', '几个', '选中', '全部', '所有', '互相', '之间']

function suggestNodeAlignment(text: string): ChangeProposal | null {
  const hasObjectMarker = OBJECT_MARKERS.some((marker) => text.includes(marker))

  // ① 等距分布（只可能指对象之间）
  if (hasKeyword(text, ['等距', '等间隔', '间距相等', '平均分布', '均分'])) {
    const axis = hasKeyword(text, ['纵向', '垂直', '竖向', '上下']) ? 'VERTICAL' : 'HORIZONTAL'
    return {
      type: 'distribute-nodes',
      description: `对象之间沿${axis === 'VERTICAL' ? '垂直' : '水平'}方向等距分布`,
      properties: { axis },
    }
  }

  if (!hasObjectMarker) return null

  // ② 对象之间对齐
  const horizontal: Record<string, 'MIN' | 'CENTER' | 'MAX'> = {
    左对齐: 'MIN', 靠左: 'MIN', 居中对齐: 'CENTER', 水平居中: 'CENTER',
    右对齐: 'MAX', 靠右: 'MAX',
  }
  const vertical: Record<string, 'MIN' | 'CENTER' | 'MAX'> = {
    顶部对齐: 'MIN', 靠上: 'MIN', 垂直居中: 'CENTER', 上下居中: 'CENTER',
    底部对齐: 'MAX', 靠下: 'MAX',
  }

  for (const [key, direction] of Object.entries(horizontal)) {
    if (text.includes(key)) {
      return {
        type: 'align-nodes',
        description: `对象之间水平对齐（${key}）`,
        properties: { axis: 'HORIZONTAL', direction },
      }
    }
  }
  for (const [key, direction] of Object.entries(vertical)) {
    if (text.includes(key)) {
      return {
        type: 'align-nodes',
        description: `对象之间垂直对齐（${key}）`,
        properties: { axis: 'VERTICAL', direction },
      }
    }
  }
  return null
}

function suggestAlign(text: string): ChangeProposal | null {
  for (const [key, val] of Object.entries(ALIGN_MAP)) {
    if (text.includes(key)) {
      return {
        type: 'alignment',
        description: `主轴对齐改为 ${key}`,
        properties: { mainAxisAlignItems: val },
      }
    }
  }
  return null
}
