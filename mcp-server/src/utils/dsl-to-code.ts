/**
 * DSL → HTML+Tailwind 转换引擎
 *
 * 将 MasterGo DSL JSON 转换为 HTML+Tailwind 代码，
 * 使得 AI Agent 可以将设计稿导出为可复用的前端代码。
 *
 * 支持的 DSL 类型: frame, text, rectangle, ellipse, pen, group, component
 * 输出格式: HTML+Tailwind CSS
 * 支持的布局: Flex (row/col), Absolute
 *
 * 图标支持:
 * - 自动检测 Icon_<prefix>:<name> 命名的元素
 * - 通过 Iconify API 获取真实路径和颜色
 * - 同容器内多个 pen 路径合并为单个 SVG
 * - 支持 fills/strokes/opacity 属性
 */

import { fetchIcon } from './icon-utils.js'
import type { DSLElement } from '../dsl-types.js'
import { safeCatchAsync } from './tool-error.js'
import { dslToTokens, type TokenCollection } from './dsl-tokens.js'
import { HtmlRenderer, createRenderer } from './framework-renderer.js'
import { dslToSemantic, stripIrrelevantFields, compressDsl } from './dsl-to-semantic.js'
import { filterVisibleEffects } from './effect-visibility.js'
import type { SemanticComponent, CompressedDSL } from './dsl-to-semantic.js'
export type { SemanticComponent, CompressedDSL } from './dsl-to-semantic.js'
export { dslToSemantic, stripIrrelevantFields, compressDsl } from './dsl-to-semantic.js'

export interface ConvertOptions {
  indent?: number
  useSemanticTags?: boolean
  includeDataAttributes?: boolean
  mode?: 'html' | 'tokens' | 'semantic' | 'hybrid' | 'compressed'
  framework?: 'html' | 'react' | 'vue3'
  codeOnly?: boolean
  exportSvgs?: boolean
  svgOutputDir?: string
}

export interface ConvertResult {
  html?: string
  tokens?: {
    css: string
    tailwind: string
    dtcg: string
    collection: TokenCollection
  }
  semantic?: { version: string; components: SemanticComponent[] }
  compressed?: CompressedDSL
  files?: Record<string, string>
  warnings: string[]
  stats: {
    elementsConverted: number
    componentsDetected: number
    textNodes: number
    frames: number
  }
  /** SVG 文件名 → 原始节点 ID 映射（用于后续插件端真实导出替换） */
  svgNodeIds?: Record<string, string>
}

// ============== 常量定义 ==============

const HTML_TAG_MAP: Record<string, string> = {
  frame: 'section',
  section: 'section',
  text: 'span',
  rectangle: 'div',
  ellipse: 'div',
  pen: 'svg',
  path: 'svg',
  svg: 'svg',
  polygon: 'svg',
  star: 'svg',
  line: 'svg',
  group: 'div',
  component: 'div',
  instance: 'div',
  boolean_operation: 'div',
  symbol: 'div',
  slice: 'div',
  canvas: 'div',
}

function parseIconName(name: string | undefined): { prefix: string; name: string } | null {
  if (!name) return null
  const match = name.match(/^(?:Icon_)?([a-z0-9]+):([a-z0-9_-]+)$/i)
  return match ? { prefix: match[1], name: match[2] } : null
}

const FONT_WEIGHT_MAP: Record<string, number> = {
  'Thin': 100,
  'Extra Light': 200,
  'Light': 300,
  'Regular': 400,
  'Medium': 500,
  'Semi Bold': 600,
  'Bold': 700,
  'Extra Bold': 800,
  'Black': 900,
}

// ============== 辅助函数 ==============

function colorToHex(color: string, alpha?: number): string {
  // 如果已经是 hex 格式
  if (color.startsWith('#')) {
    if (alpha !== undefined && alpha < 1) {
      const r = parseInt(color.slice(1, 3), 16)
      const g = parseInt(color.slice(3, 5), 16)
      const b = parseInt(color.slice(5, 7), 16)
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
    return color
  }
  return color
}

function generateIndent(level: number, size: number = 2): string {
  return ' '.repeat(level * size)
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ============== SVG 几何辅助函数 ==============

function generatePolygonPoints(width: number, height: number, pointCount: number): string {
  const cx = width / 2
  const cy = height / 2
  const r = Math.min(cx, cy)
  const points: string[] = []
  for (let i = 0; i < pointCount; i++) {
    const angle = (2 * Math.PI * i) / pointCount - Math.PI / 2
    const x = cx + r * Math.cos(angle)
    const y = cy + r * Math.sin(angle)
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return points.join(' ')
}

function generateStarPoints(width: number, height: number, pointCount: number, innerRadius: number): string {
  const cx = width / 2
  const cy = height / 2
  const outerR = Math.min(cx, cy)
  const innerR = outerR * innerRadius
  const totalPoints = pointCount * 2
  const points: string[] = []
  for (let i = 0; i < totalPoints; i++) {
    const angle = (2 * Math.PI * i) / totalPoints - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    const x = cx + r * Math.cos(angle)
    const y = cy + r * Math.sin(angle)
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return points.join(' ')
}

function getFillColor(element: DSLElement): string {
  if (element.fills && element.fills.length > 0) {
    const fill = element.fills[0]
    if ((fill.type === 'SOLID' || fill.type === 'solid') && fill.color) {
      return fill.color
    }
  }
  return 'currentColor'
}

function getStrokeLinecap(cap?: string): string {
  if (!cap) return ''
  const map: Record<string, string> = { ROUND: 'round', SQUARE: 'square' }
  return map[cap] ? ` stroke-linecap="${map[cap]}"` : ''
}

function getStrokeLinejoin(join?: string): string {
  if (!join) return ''
  const map: Record<string, string> = { MITER: 'miter', BEVEL: 'bevel', ROUND: 'round' }
  return map[join] ? ` stroke-linejoin="${map[join]}"` : ''
}

function calculateGradientAngle(handles?: Array<{ x: number; y: number }>): number {
  if (!handles || handles.length < 2) return 180
  const dx = handles[1].x - handles[0].x
  const dy = handles[1].y - handles[0].y
  let angle = Math.atan2(dx, -dy) * 180 / Math.PI
  if (angle < 0) angle += 360
  return Math.round(angle)
}

function formatGradientStops(stops: Array<{ position: number; color: string }>): string {
  return stops.map(s => `${s.color}_${Math.round(s.position * 100)}%`).join(',')
}

function getGradientCenter(handles?: Array<{ x: number; y: number }>): string {
  if (!handles || handles.length < 1) return ''
  const cx = Math.round(handles[0].x * 100)
  const cy = Math.round(handles[0].y * 100)
  return `at_${cx}%_${cy}%`
}

// ============== Tailwind 类生成器 ==============

class TailwindClassBuilder {
  private classes: string[] = []
  private warnings: string[] = []

  add(cls: string): this {
    if (cls && !this.classes.includes(cls)) {
      this.classes.push(cls)
    }
    return this
  }

  addSize(width?: number, height?: number, layoutMode?: string, primaryAxisSizingMode?: string, counterAxisSizingMode?: string): this {
    const isHorizontal = layoutMode === 'HORIZONTAL'
    const isVertical = layoutMode === 'VERTICAL'
    const autoPrimary = layoutMode && primaryAxisSizingMode === 'AUTO'
    const autoCounter = layoutMode && counterAxisSizingMode === 'AUTO'
    const r = (v: number) => Math.round(v)

    if (!(isHorizontal && autoPrimary) && !(isVertical && autoCounter) && width !== undefined && width > 0) {
      this.add(`w-[${r(width)}px]`)
    }
    if (!(isVertical && autoPrimary) && !(isHorizontal && autoCounter) && height !== undefined && height > 0) {
      this.add(`h-[${r(height)}px]`)
    }
    return this
  }

  addPosition(x?: number, y?: number): this {
    if (x !== undefined || y !== undefined) {
      this.add('absolute')
      const r = (v: number) => Math.round(v)
      if (x !== undefined) this.add(`left-[${r(x)}px]`)
      if (y !== undefined) this.add(`top-[${r(y)}px]`)
    }
    return this
  }

  addLayout(element: DSLElement): this {
    const {
      layoutMode, itemSpacing,
      mainAxisAlignItems, crossAxisAlignItems,
      primaryAxisAlignItems, counterAxisAlignItems,
      crossAxisSpacing, primaryAxisAlignContent, counterAxisAlignContent
    } = element

    // NONE layout：flex 相关样式（gap/justify/items）不生效，跳过
    if (layoutMode === 'NONE') return this

    // 未设置 layoutMode 也跳过 flex 样式
    if (!layoutMode) return this

    // 使用 mainAxisAlignItems 或 primaryAxisAlignItems
    const mainAlign = mainAxisAlignItems || primaryAxisAlignItems
    const crossAlign = crossAxisAlignItems || counterAxisAlignItems

    if (layoutMode === 'HORIZONTAL') {
      this.add('flex')
      this.add('flex-row')
    } else if (layoutMode === 'VERTICAL') {
      this.add('flex')
      this.add('flex-col')
    }

    // 间距
    const spacing = itemSpacing && itemSpacing > 0 ? itemSpacing : 0
    const crossSpacing = crossAxisSpacing !== undefined && crossAxisSpacing > 0 ? crossAxisSpacing : spacing
    if (spacing > 0 || crossSpacing > 0) {
      if (spacing === crossSpacing) {
        this.add(`gap-[${spacing}px]`)
      } else {
        if (layoutMode === 'HORIZONTAL') {
          this.add(`gap-x-[${spacing}px]`)
          this.add(`gap-y-[${crossSpacing}px]`)
        } else {
          this.add(`gap-y-[${spacing}px]`)
          this.add(`gap-x-[${crossSpacing}px]`)
        }
      }
    }

    if (mainAlign) {
      const justifyMap: Record<string, string> = {
        MIN: 'justify-start',
        CENTER: 'justify-center',
        MAX: 'justify-end',
        SPACE_BETWEEN: 'justify-between',
      }
      if (justifyMap[mainAlign]) {
        this.add(justifyMap[mainAlign])
      }
    }

    // primaryAxisAlignContent：多行容器的主轴内容对齐（flex-wrap 场景）
    if (primaryAxisAlignContent && primaryAxisAlignContent !== 'AUTO') {
      const justifyContentMap: Record<string, string> = {
        MIN: 'justify-start',
        CENTER: 'justify-center',
        MAX: 'justify-end',
        SPACE_BETWEEN: 'justify-between',
      }
      if (justifyContentMap[primaryAxisAlignContent]) {
        this.add(justifyContentMap[primaryAxisAlignContent])
      }
    }

    if (crossAlign) {
      const itemsMap: Record<string, string> = {
        MIN: 'items-start',
        CENTER: 'items-center',
        MAX: 'items-end',
      }
      if (itemsMap[crossAlign]) {
        this.add(itemsMap[crossAlign])
      }
    }

    // counterAxisAlignContent：多行容器的交叉轴内容对齐（CSS align-content）
    if (counterAxisAlignContent && counterAxisAlignContent !== 'AUTO') {
      this.addCounterAxisAlignContent(counterAxisAlignContent)
    }

    return this
  }

  addPadding(element: DSLElement): this {
    const { paddingTop, paddingRight, paddingBottom, paddingLeft } = element

    // 统一 padding
    if (paddingTop === paddingRight && paddingRight === paddingBottom && paddingBottom === paddingLeft) {
      if (paddingTop && paddingTop > 0) {
        this.add(`p-[${paddingTop}px]`)
      }
    } else if (paddingTop === paddingBottom && paddingLeft === paddingRight) {
      // py- px-
      if (paddingTop && paddingTop > 0) this.add(`py-[${paddingTop}px]`)
      if (paddingLeft && paddingLeft > 0) this.add(`px-[${paddingLeft}px]`)
    } else {
      // 单独设置
      if (paddingTop && paddingTop > 0) this.add(`pt-[${paddingTop}px]`)
      if (paddingRight && paddingRight > 0) this.add(`pr-[${paddingRight}px]`)
      if (paddingBottom && paddingBottom > 0) this.add(`pb-[${paddingBottom}px]`)
      if (paddingLeft && paddingLeft > 0) this.add(`pl-[${paddingLeft}px]`)
    }

    return this
  }

  addBackground(fills?: Array<{ type: string; color?: string; opacity?: number; alpha?: number; isVisible?: boolean; gradientStops?: Array<{ position: number; color: string }>; gradientHandlePositions?: Array<{ x: number; y: number }> }>): this {
    if (!fills || fills.length === 0) return this

    const visibleFills = fills.filter(f => f.isVisible !== false)
    if (visibleFills.length === 0) return this

    // 单填充：使用简化的逻辑（兼容旧行为）
    if (visibleFills.length === 1) {
      const fill = visibleFills[0]
      const opacity = fill.opacity ?? fill.alpha ?? 1

      if (fill.type === 'SOLID' || fill.type === 'solid') {
        if (fill.color) {
          const color = colorToHex(fill.color, opacity < 1 ? opacity : undefined)
          if (color.startsWith('rgba')) {
            this.add(`bg-[${color}]`)
          } else {
            this.add(`bg-[${fill.color}]`)
            if (opacity < 1) {
              this.add(`opacity-[${opacity}]`)
            }
          }
        }
      } else if (fill.type === 'GRADIENT_LINEAR' || fill.type === 'gradient_linear') {
        if (fill.gradientStops && fill.gradientStops.length >= 2) {
          const angle = calculateGradientAngle(fill.gradientHandlePositions)
          const stops = formatGradientStops(fill.gradientStops)
          this.add(`bg-[linear-gradient(${angle}deg,${stops})]`)
        } else {
          this.warnings.push('Linear gradient has insufficient color stops, using simplified conversion')
          this.add('bg-gradient-to-r')
        }
      } else if (fill.type === 'GRADIENT_RADIAL' || fill.type === 'gradient_radial') {
        if (fill.gradientStops && fill.gradientStops.length >= 2) {
          const center = getGradientCenter(fill.gradientHandlePositions)
          const stops = formatGradientStops(fill.gradientStops)
          this.add(`bg-[radial-gradient(circle_${center},${stops})]`)
        } else {
          this.warnings.push('Radial gradient has insufficient color stops')
        }
      } else if (fill.type === 'GRADIENT_ANGULAR' || fill.type === 'gradient_angular') {
        if (fill.gradientStops && fill.gradientStops.length >= 2) {
          const angle = calculateGradientAngle(fill.gradientHandlePositions)
          const center = getGradientCenter(fill.gradientHandlePositions)
          const stops = formatGradientStops(fill.gradientStops)
          this.add(`bg-[conic-gradient(from_${angle}deg_${center},${stops})]`)
        } else {
          this.warnings.push('Angular gradient has insufficient color stops')
        }
      } else if (fill.type === 'IMAGE' || fill.type === 'image') {
        const imageUrl = (fill as any).imageUrl || (fill as any).imageRef
        if (imageUrl) {
          // 转义 URL 中的特殊字符以符合 Tailwind 语法
          const escapedUrl = imageUrl.replace(/([()[\]])/g, '\\$1')
          this.add(`bg-[url(${escapedUrl})]`)
        }
        // 映射 imageScaleMode → object-fit
        const scaleMode = (fill as any).imageScaleMode || (fill as any).scaleMode || 'FILL'
        const scaleMap: Record<string, string> = {
          'FILL': 'object-fill',
          'FIT': 'object-contain',
          'CROP': 'object-cover',
          'STRETCH': 'object-none',
          'TILE': 'object-scale-down',
        }
        this.add(scaleMap[scaleMode] || 'object-cover')
      }
      return this
    }

    // 多填充：叠加为 multi-background
    // Figma/MasterGo 中 fills[0] 为底层、fills[n] 为顶层；
    // CSS multi-background 第一个图层为顶层，需反转顺序
    const bgLayers: string[] = []
    for (let i = visibleFills.length - 1; i >= 0; i--) {
      const fill = visibleFills[i]
      const opacity = fill.opacity ?? fill.alpha ?? 1

      if (fill.type === 'SOLID' || fill.type === 'solid') {
        // 在 multi-background 中，solid 转为伪渐变以便叠加
        if (fill.color) {
          const color = colorToHex(fill.color, opacity < 1 ? opacity : undefined)
          if (color.startsWith('rgba')) {
            bgLayers.push(`linear-gradient(${color},${color})`)
          } else {
            bgLayers.push(`linear-gradient(${fill.color},${fill.color})`)
          }
        }
      } else if (fill.type === 'GRADIENT_LINEAR' || fill.type === 'gradient_linear') {
        if (fill.gradientStops && fill.gradientStops.length >= 2) {
          const angle = calculateGradientAngle(fill.gradientHandlePositions)
          const stops = formatGradientStops(fill.gradientStops)
          bgLayers.push(`linear-gradient(${angle}deg,${stops})`)
        }
      } else if (fill.type === 'GRADIENT_RADIAL' || fill.type === 'gradient_radial') {
        if (fill.gradientStops && fill.gradientStops.length >= 2) {
          const center = getGradientCenter(fill.gradientHandlePositions)
          const stops = formatGradientStops(fill.gradientStops)
          bgLayers.push(`radial-gradient(circle_${center},${stops})`)
        }
      } else if (fill.type === 'GRADIENT_ANGULAR' || fill.type === 'gradient_angular') {
        if (fill.gradientStops && fill.gradientStops.length >= 2) {
          const angle = calculateGradientAngle(fill.gradientHandlePositions)
          const center = getGradientCenter(fill.gradientHandlePositions)
          const stops = formatGradientStops(fill.gradientStops)
          bgLayers.push(`conic-gradient(from_${angle}deg_${center},${stops})`)
        }
      } else if (fill.type === 'IMAGE' || fill.type === 'image') {
        this.warnings.push('Image fill in multi-fill context requires manual src attribute')
      }
    }

    if (bgLayers.length > 0) {
      this.add(`bg-[${bgLayers.join(',')}]`)
    }

    return this
  }

  addBorder(strokes?: Array<{ type: string; color: string; alpha?: number; isVisible?: boolean; gradientStops?: Array<{ position: number; color: string }> }>, strokeWidth?: number, cornerRadius?: number, strokeAlign?: string): this {
    // 圆角：必须在早返回之前处理，否则无描边元素圆角全丢
    if (cornerRadius && cornerRadius > 0) {
      if (cornerRadius >= 999) {
        this.add('rounded-full')
      } else {
        this.add(`rounded-[${cornerRadius}px]`)
      }
    }

    // 过滤可见描边
    const visibleStrokes = strokes?.filter(s => s.isVisible !== false) || []
    if (visibleStrokes.length === 0) return this

    const sw = strokeWidth && strokeWidth > 0 ? strokeWidth : 1

    // 收集所有 box-shadow，合并为单行 shadow-[a,_b,_c] 输出（Tailwind 非叠加性）
    const shadowParts: string[] = []

    for (let idx = 0; idx < visibleStrokes.length; idx++) {
      const stroke = visibleStrokes[idx]
      let color = stroke.color || '#000000'

      // 处理描边渐变：取第一个色标作为近似颜色
      if (stroke.type === 'GRADIENT_LINEAR' || stroke.type === 'gradient_linear' ||
          stroke.type === 'GRADIENT_RADIAL' || stroke.type === 'gradient_radial' ||
          stroke.type === 'GRADIENT_ANGULAR' || stroke.type === 'gradient_angular') {
        if (stroke.gradientStops && stroke.gradientStops.length > 0) {
          color = stroke.gradientStops[0].color
        }
        this.warnings.push('Gradient stroke converted to solid color (first gradient stop)')
      }

      // 处理透明度
      const alpha = stroke.alpha ?? 1
      if (alpha < 1) {
        color = colorToHex(color, alpha)
      }

      if (idx === 0) {
        if (strokeAlign === 'INSIDE') {
          shadowParts.push(`inset_0_0_0_${sw}px_${color}`)
        } else if (strokeAlign === 'OUTSIDE') {
          this.add(`outline-[${sw}px]`)
          this.add(`outline-[${color}]`)
        } else {
          this.add(`border-[${sw}px]`)
          this.add(`border-[${color}]`)
        }
      } else {
        shadowParts.push(`0_0_0_${sw}px_${color}`)
      }
    }

    if (shadowParts.length > 0) {
      this.add(`shadow-[${shadowParts.join(',_')}]`)
    }

    return this
  }

  addTextStyle(element: DSLElement): this {
    const { fontSize, fontWeight, fontName, textAlignHorizontal, textAlignVertical, fills } = element

    // 文本填充色 → text-[color]
    if (fills && fills.length > 0) {
      const visibleFill = fills.find(f => f.isVisible !== false && (f.type === 'SOLID' || f.type === 'solid'))
      if (visibleFill?.color) {
        const alpha = visibleFill.opacity ?? visibleFill.alpha ?? 1
        const color = alpha < 1 ? colorToHex(visibleFill.color, alpha) : visibleFill.color
        this.add(`text-[${color}]`)
      }
    }

    if (fontSize) {
      this.add(`text-[${fontSize}px]`)
    }

    // 处理 fontWeight 和 fontName.style
    let weight = fontWeight
    if (!weight && fontName?.style) {
      weight = FONT_WEIGHT_MAP[fontName.style]
    }
    if (weight) {
      this.add(`font-[${weight}]`)
    }

    // 字体族
    if (fontName?.family) {
      this.add(`font-['${fontName.family}']`)
    }

    if (textAlignHorizontal) {
      const alignMap: Record<string, string> = {
        LEFT: 'text-left',
        CENTER: 'text-center',
        RIGHT: 'text-right',
      }
      if (alignMap[textAlignHorizontal]) {
        this.add(alignMap[textAlignHorizontal])
      }
    }

    if (textAlignVertical) {
      const valignMap: Record<string, string> = {
        TOP: 'align-top',
        CENTER: 'align-middle',
        BOTTOM: 'align-bottom',
      }
      if (valignMap[textAlignVertical]) {
        this.add(valignMap[textAlignVertical])
      }
    }

    // 行高
    if (element.lineHeight) {
      const { unit, value } = element.lineHeight
      const unitLower = unit?.toLowerCase()
      if (unitLower === 'pixels' || unitLower === 'px') {
        this.add(`leading-[${value}px]`)
      } else if (unitLower === 'percent' || unitLower === '%') {
        this.add(`leading-[${value}%]`)
      } else if (unitLower === 'raw') {
        // RAW 单位下的 value 已是相对于字体大小的倍数，不再跳过 1.0/1.2
        this.add(`leading-[${value}]`)
      }
      // AUTO: 不添加 explicit lineHeight，使用浏览器默认
    }

    // 字间距
    let letterSpacingValue: number | undefined
    let letterSpacingUnit: string = 'px'
    if (typeof element.letterSpacing === 'object' && element.letterSpacing !== null) {
      const ls = element.letterSpacing as { value: number; unit?: string }
      letterSpacingValue = ls.value ?? 0
      if (ls.unit) {
        const u = ls.unit.toUpperCase()
        if (u === 'PERCENT' || u === '%') {
          letterSpacingUnit = '%'
        } else if (u === 'PIXELS' || u === 'PX') {
          letterSpacingUnit = 'px'
        } else {
          letterSpacingUnit = u  // em 等原样输出
        }
      }
    } else if (typeof element.letterSpacing === 'number') {
      letterSpacingValue = element.letterSpacing
    }
    if (letterSpacingValue !== undefined && letterSpacingValue !== 0) {
      this.add(`tracking-[${letterSpacingValue}${letterSpacingUnit}]`)
    }

    // 文本装饰
    if (element.textDecoration) {
      const decoMap: Record<string, string> = {
        UNDERLINE: 'underline',
        STRIKETHROUGH: 'line-through',
        NONE: 'no-underline',
      }
      if (decoMap[element.textDecoration]) {
        this.add(decoMap[element.textDecoration])
      }
    }

    // 文本大小写
    if (element.textCase) {
      const caseMap: Record<string, string> = {
        UPPER: 'uppercase',
        LOWER: 'lowercase',
        TITLE: 'capitalize',
      }
      if (caseMap[element.textCase]) {
        this.add(caseMap[element.textCase])
      }
    }

    // 段落间距
    if (element.paragraphSpacing && element.paragraphSpacing > 0) {
      this.add(`mb-[${element.paragraphSpacing}px]`)
    }

    // 文本自动调整
    if (element.textAutoResize) {
      if (element.textAutoResize === 'NONE') {
        this.add('overflow-hidden')
      } else if (element.textAutoResize === 'WIDTH_AND_HEIGHT') {
        // auto-sizing, no specific class needed
      } else if (element.textAutoResize === 'HEIGHT') {
        this.add('whitespace-normal')
      } else if (element.textAutoResize === 'TRUNCATE') {
        this.add('truncate')
      }
    }

    // 渐变文字：text-transparent bg-clip-text + 实际渐变背景
    if (fills && fills.length > 0) {
      const gradientFill = fills.find(f =>
        f.isVisible !== false &&
        (f.type === 'GRADIENT_LINEAR' || f.type === 'gradient_linear' ||
         f.type === 'GRADIENT_RADIAL' || f.type === 'gradient_radial' ||
         f.type === 'GRADIENT_ANGULAR' || f.type === 'gradient_angular')
      )
      if (gradientFill) {
        this.add('text-transparent')
        this.add('bg-clip-text')
        // 补上实际的渐变背景，让 text-transparent 有内容可透
        if (gradientFill.type === 'GRADIENT_LINEAR' || gradientFill.type === 'gradient_linear') {
          if (gradientFill.gradientStops && gradientFill.gradientStops.length >= 2) {
            const angle = calculateGradientAngle(gradientFill.gradientHandlePositions)
            const stops = formatGradientStops(gradientFill.gradientStops)
            this.add(`bg-[linear-gradient(${angle}deg,${stops})]`)
          }
        } else if (gradientFill.type === 'GRADIENT_RADIAL' || gradientFill.type === 'gradient_radial') {
          if (gradientFill.gradientStops && gradientFill.gradientStops.length >= 2) {
            const center = getGradientCenter(gradientFill.gradientHandlePositions)
            const stops = formatGradientStops(gradientFill.gradientStops)
            this.add(`bg-[radial-gradient(circle_${center},${stops})]`)
          }
        } else if (gradientFill.type === 'GRADIENT_ANGULAR' || gradientFill.type === 'gradient_angular') {
          if (gradientFill.gradientStops && gradientFill.gradientStops.length >= 2) {
            const angle = calculateGradientAngle(gradientFill.gradientHandlePositions)
            const center = getGradientCenter(gradientFill.gradientHandlePositions)
            const stops = formatGradientStops(gradientFill.gradientStops)
            this.add(`bg-[conic-gradient(from_${angle}deg_${center},${stops})]`)
          }
        }
      }
      // SOLID text-[color] 已在上方处理（577-585），无需重复
    }

    return this
  }

  /**
   * 阴影 / 模糊 → Tailwind 工具类
   *
   * 注意事项（历史上踩过的坑）：
   * - `radius: 0` 是合法的硬阴影（如 `0 2px 0`），不能用 falsy 判断丢掉
   * - `isEffectShow === false` 表示设计器里“效果开关”被关闭，不应输出
   * - CSS box-shadow 没有逐阴影混合模式语义，不能用 blendMode 过滤：
   *   导出值常见的是 `PASS_THROUGH`（默认），按它过滤会把正常阴影全部丢弃
   */
  addEffects(effects?: Array<{ type: string; color?: string; offset?: { x: number; y: number }; radius?: number; spread?: number; visible?: boolean; isVisible?: boolean; blendMode?: string; isEffectShow?: boolean }>): this {
    if (!effects || effects.length === 0) return this

    // 可见性口径统一走 filterVisibleEffects（同时接受 visible / isVisible，并尊重 isEffectShow）
    const active = filterVisibleEffects(effects)

    // 收集所有阴影（DROP_SHADOW + INNER_SHADOW），合并为单行 shadow-[a,_b,_c]
    const shadowParts: string[] = []
    for (const eff of active) {
      if (eff.type === 'DROP_SHADOW' || eff.type === 'INNER_SHADOW') {
        const x = eff.offset?.x ?? 0
        const y = eff.offset?.y ?? 0
        const blur = eff.radius ?? 0
        const spread = eff.spread ?? 0
        const color = colorToHex(eff.color ?? '#000000')
        const inset = eff.type === 'INNER_SHADOW' ? 'inset_' : ''
        shadowParts.push(`${inset}${x}px_${y}px_${blur}px_${spread}px_${color}`)
      }
    }
    if (shadowParts.length > 0) {
      this.add(`shadow-[${shadowParts.join(',_')}]`)
    }

    const layerBlur = active.find(e => e.type === 'LAYER_BLUR')
    if (layerBlur?.radius !== undefined) {
      this.add(`blur-[${layerBlur.radius}px]`)
    }

    const bgBlur = active.find(e => e.type === 'BACKGROUND_BLUR')
    if (bgBlur?.radius !== undefined) {
      this.add(`backdrop-blur-[${bgBlur.radius}px]`)
    }

    return this
  }

  addFlexGrow(flexGrow?: number): this {
    if (flexGrow !== undefined && flexGrow > 0) {
      if (flexGrow === 1) {
        this.add('flex-1')
      } else {
        this.add(`flex-[${flexGrow}]`)
      }
    }
    return this
  }

  addOpacity(opacity?: number): this {
    if (opacity !== undefined && opacity < 1 && opacity >= 0) {
      this.add(`opacity-[${opacity}]`)
    }
    return this
  }

  addRotation(rotation?: number): this {
    if (rotation && rotation !== 0) {
      this.add(`rotate-[${rotation}deg]`)
    }
    return this
  }

  addClipsContent(clipsContent?: boolean): this {
    if (clipsContent) {
      this.add('overflow-hidden')
    }
    return this
  }

  addFlexWrap(flexWrap?: string): this {
    if (flexWrap === 'WRAP') {
      this.add('flex-wrap')
    } else if (flexWrap === 'NO_WRAP') {
      this.add('flex-nowrap')
    }
    return this
  }

  addConstraints(constraints?: Record<string, unknown> | { horizontal?: string; vertical?: string }): this {
    if (!constraints) return this
    const h = constraints.horizontal as string
    const v = constraints.vertical as string
    if (h === 'STRETCH') this.add('w-full')
    if (v === 'STRETCH') this.add('h-full')
    if (h === 'CENTER') this.add('mx-auto')
    if (v === 'CENTER') this.add('my-auto')
    return this
  }

  addMinMaxSize(element: DSLElement): this {
    if (element.minWidth && element.minWidth > 0) this.add(`min-w-[${element.minWidth}px]`)
    if (element.maxWidth && element.maxWidth > 0) this.add(`max-w-[${element.maxWidth}px]`)
    if (element.minHeight && element.minHeight > 0) this.add(`min-h-[${element.minHeight}px]`)
    if (element.maxHeight && element.maxHeight > 0) this.add(`max-h-[${element.maxHeight}px]`)
    return this
  }

  addPerCornerRadius(element: DSLElement): this {
    const { topLeftRadius, topRightRadius, bottomLeftRadius, bottomRightRadius } = element
    if (topLeftRadius && topLeftRadius > 0) this.add(`rounded-tl-[${topLeftRadius}px]`)
    if (topRightRadius && topRightRadius > 0) this.add(`rounded-tr-[${topRightRadius}px]`)
    if (bottomLeftRadius && bottomLeftRadius > 0) this.add(`rounded-bl-[${bottomLeftRadius}px]`)
    if (bottomRightRadius && bottomRightRadius > 0) this.add(`rounded-br-[${bottomRightRadius}px]`)
    return this
  }

  addBlendMode(blendMode?: string): this {
    if (!blendMode || blendMode === 'PASS_THROUGH' || blendMode === 'NORMAL') return this
    const map: Record<string, string> = {
      MULTIPLY: 'mix-blend-multiply',
      SCREEN: 'mix-blend-screen',
      OVERLAY: 'mix-blend-overlay',
      DARKEN: 'mix-blend-darken',
      LIGHTEN: 'mix-blend-lighten',
      'COLOR_DODGE': 'mix-blend-color-dodge',
      'COLOR_BURN': 'mix-blend-color-burn',
      'HARD_LIGHT': 'mix-blend-hard-light',
      'SOFT_LIGHT': 'mix-blend-soft-light',
      DIFFERENCE: 'mix-blend-difference',
      EXCLUSION: 'mix-blend-exclusion',
      HUE: 'mix-blend-hue',
      SATURATION: 'mix-blend-saturation',
      COLOR: 'mix-blend-color',
      LUMINOSITY: 'mix-blend-luminosity',
      'LINEAR_BURN': 'mix-blend-color-burn',
      'LINEAR_DODGE': 'mix-blend-color-dodge',
      'PLUS_LIGHTER': 'mix-blend-plus-lighter',
    }
    if (map[blendMode]) {
      this.add(map[blendMode])
    }
    return this
  }

  addCounterAxisAlignContent(align?: string): this {
    if (!align || align === 'AUTO') return this
    const map: Record<string, string> = {
      MIN: 'content-start',
      CENTER: 'content-center',
      MAX: 'content-end',
      SPACE_BETWEEN: 'content-between',
    }
    if (map[align]) {
      this.add(map[align])
    }
    return this
  }

  build(): string {
    return this.classes.join(' ')
  }

  getWarnings(): string[] {
    return this.warnings
  }
}

// ============== 合并 Pen 为单个 SVG ==============

function renderMergedSvg(
  container: DSLElement,
  pens: DSLElement[],
  iconData: any | null,
  level: number,
  options: ConvertOptions
): { html: string; warnings: string[] } {
  const warnings: string[] = []
  const indent = generateIndent(level, options.indent || 2)
  const childIndent = generateIndent(level + 1, options.indent || 2)

  const size = container.size || pens[0]?.size || { width: 24, height: 24 }
  const viewBox = `0 0 ${size.width} ${size.height}`

  const classBuilder = new TailwindClassBuilder()
  classBuilder.addSize(size.width, size.height)
  if (container.opacity !== undefined && container.opacity < 1) {
    classBuilder.addOpacity(container.opacity)
  }
  const classString = classBuilder.build()
  const classAttr = classString ? ` class="${classString}"` : ''

  let svgContent = ''

  if (iconData && iconData.paths) {
    for (const path of iconData.paths) {
      const fill = path.fill || 'currentColor'
      const opacity = path.opacity !== undefined ? ` opacity="${path.opacity}"` : ''
      svgContent += `${childIndent}<path d="${path.d}" fill="${fill}"${opacity}/>\n`
    }
  } else {
    for (const pen of pens) {
      const pd = pen.svgPathData || pen.pathData
      if (typeof pd === 'string') {
        let fillColor = 'currentColor'
        if (pen.fills && pen.fills.length > 0) {
          const fill = pen.fills[0]
          if ((fill.type === 'SOLID' || fill.type === 'solid') && fill.color) {
            fillColor = fill.color
          }
        }
        const opacity = pen.opacity !== undefined ? ` opacity="${pen.opacity}"` : ''
        const closedPath = pen.isClosed ? pd.trim() + ' Z' : pd
        let strokeAttr = ''
        if (pen.strokes && pen.strokes.length > 0) {
          const stroke = pen.strokes[0]
          if (stroke.color) {
            strokeAttr = ` stroke="${stroke.color}"`
            if (pen.strokeWidth) strokeAttr += ` stroke-width="${pen.strokeWidth}"`
          }
        }
        svgContent += `${childIndent}<path d="${closedPath}" fill="${fillColor}"${strokeAttr}${opacity}/>\n`
      }
    }
  }

  const html = `${indent}<svg${classAttr} width="${size.width}" height="${size.height}" viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg">\n${svgContent}${indent}</svg>\n`
  return { html, warnings }
}

// ============== SVG 文件导出辅助 ==============

/**
 * 递归收集元素及其子元素中所有可渲染的 SVG 路径/形状
 */
function collectSvgPaths(el: DSLElement): string[] {
  const paths: string[] = []
  if (el.type === 'pen' || el.type === 'path') {
    const pd = el.svgPathData || el.pathData
    if (typeof pd === 'string') {
      let fillColor = 'none'
      if (el.fills && el.fills.length > 0) {
        const fill = el.fills[0]
        if ((fill.type === 'SOLID' || fill.type === 'solid') && fill.color) {
          fillColor = fill.color
        } else if (fill.gradientStops && fill.gradientStops.length > 0) {
          fillColor = fill.gradientStops[0].color || 'none'
        }
      }
      let strokeAttr = ''
      if (el.strokes && el.strokes.length > 0) {
        const stroke = el.strokes[0]
        if (stroke.color) {
          const sc = typeof stroke.color === 'string' ? stroke.color : 'currentColor'
          strokeAttr = ` stroke="${sc}"`
          if (el.strokeWidth) strokeAttr += ` stroke-width="${el.strokeWidth}"`
        }
      }
      const capJoin = getStrokeLinecap(el.strokeCap) + getStrokeLinejoin(el.strokeJoin)
      const closedPath = el.isClosed ? pd.trim() + ' Z' : pd
      const opacity = el.opacity !== undefined && el.opacity < 1 ? ` opacity="${el.opacity}"` : ''
      paths.push(`<path d="${closedPath}" fill="${fillColor}"${strokeAttr}${capJoin}${opacity}/>`)
    }
  } else if (el.type === 'ellipse') {
    const w = el.size?.width || 24
    const h = el.size?.height || 24
    let fillColor = 'none'
    if (el.fills && el.fills.length > 0) {
      const fill = el.fills[0]
      if ((fill.type === 'SOLID' || fill.type === 'solid') && fill.color) {
        fillColor = fill.color
      } else if (fill.gradientStops && fill.gradientStops.length > 0) {
        fillColor = fill.gradientStops[0].color || 'none'
      }
    }
    let strokeAttr = ''
    if (el.strokes && el.strokes.length > 0) {
      const stroke = el.strokes[0]
      if (stroke.color) {
        const sc = typeof stroke.color === 'string' ? stroke.color : 'currentColor'
        strokeAttr = ` stroke="${sc}" stroke-width="${el.strokeWidth || 1}"`
      }
    }
    paths.push(`<ellipse cx="${w/2}" cy="${h/2}" rx="${w/2}" ry="${h/2}" fill="${fillColor}"${strokeAttr}/>`)
  } else if (el.type === 'rectangle') {
    const w = el.size?.width || 10
    const h = el.size?.height || 10
    let fillColor = 'none'
    if (el.fills && el.fills.length > 0) {
      const fill = el.fills[0]
      if ((fill.type === 'SOLID' || fill.type === 'solid') && fill.color) {
        fillColor = fill.color
      } else if (fill.gradientStops && fill.gradientStops.length > 0) {
        fillColor = fill.gradientStops[0].color || 'none'
      }
    }
    const rx = el.cornerRadius || 0
    let strokeAttr = ''
    if (el.strokes && el.strokes.length > 0) {
      const stroke = el.strokes[0]
      if (stroke.color) {
        const sc = typeof stroke.color === 'string' ? stroke.color : 'currentColor'
        strokeAttr = ` stroke="${sc}" stroke-width="${el.strokeWidth || 1}"`
      }
    }
    paths.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="${rx}" fill="${fillColor}"${strokeAttr}/>`)
  } else if (el.type === 'line') {
    const w = el.size?.width || 100
    const h = el.size?.height || 100
    let strokeColor = 'currentColor'
    if (el.strokes && el.strokes.length > 0) {
      const s = el.strokes[0]
      if (s.color) strokeColor = s.color
    }
    const sw = el.strokeWidth || 1
    paths.push(`<line x1="0" y1="0" x2="${w}" y2="${h}" stroke="${strokeColor}" stroke-width="${sw}"/>`)
  } else if (['frame', 'group', 'instance', 'boolean_operation'].includes(el.type || '')) {
    // 容器元素：如果有自身的 fill/stroke，渲染为背景矩形
    const w = el.size?.width || 24
    const h = el.size?.height || 24
    const f0 = el.fills?.[0] as any
    const s0 = el.strokes?.[0] as any
    const hasFill = f0 && f0.color && f0.isVisible !== false
    const hasStroke = s0 && s0.color && s0.isVisible !== false
    if (hasFill || hasStroke) {
      let fillColor = 'none'
      if (hasFill) {
        if ((f0.type === 'SOLID' || f0.type === 'solid') && f0.color) {
          fillColor = f0.color
        }
      }
      let strokeAttr = ''
      if (hasStroke) {
        if (s0.color) {
          strokeAttr = ` stroke="${s0.color}" stroke-width="${el.strokeWidth || 1}"`
        }
      }
      const rx = el.cornerRadius || 0
      paths.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="${rx}" fill="${fillColor}"${strokeAttr}/>`)
    }
  }
  // 递归子元素
  if (el.children) {
    for (const child of el.children) {
      paths.push(...collectSvgPaths(child))
    }
  }
  return paths
}

/**
 * 将元素渲染为独立 SVG 文件并返回 <img> 标签
 */
function renderAsSvgFile(
  element: DSLElement,
  level: number,
  options: ConvertOptions,
  svgFiles: Record<string, string>,
  svgCounter: { count: number },
  svgNodeIds?: Record<string, string>,
): { html: string; warnings: string[] } {
  const warnings: string[] = []
  const indent = generateIndent(level, options.indent || 2)
  const size = element.size || { width: 24, height: 24 }
  const viewBox = `0 0 ${size.width} ${size.height}`
  const paths = collectSvgPaths(element)
  const outputDir = options.svgOutputDir || 'icons'

  svgCounter.count++
  const svgName = `icon-${svgCounter.count}`
  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>\n<svg width="${size.width}" height="${size.height}" viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg">\n${paths.map(p => '  ' + p).join('\n')}\n</svg>`
  const svgKey = `${outputDir}/${svgName}.svg`
  svgFiles[svgKey] = svgContent
  if (svgNodeIds && element.id) {
    svgNodeIds[svgKey] = element.id
  }

  // 只保留 data-name 等语义属性，去掉布局相关 class
  const name = element.name ? element.name.replace(/__svg$/, '') : ''
  const imgClass = options.includeDataAttributes ? ` data-name="${name}"` : ''
  const html = `${indent}<img src="${outputDir}/${svgName}.svg" width="${size.width}" height="${size.height}" alt="${name}"${imgClass} />\n`

  if (paths.length === 0) {
    warnings.push(`Element "${element.name}" marked as __svg but has no renderable paths`)
  }

  return { html, warnings }
}

// ============== DSL 元素转换器 ==============

function convertElement(
  element: DSLElement,
  level: number = 0,
  options: ConvertOptions = {},
  parentLayoutMode?: string,
  iconCache?: Map<string, any>,
  renderer?: import('./framework-renderer.js').FrameworkRenderer,
  svgFiles?: Record<string, string>,
  svgCounter?: { count: number },
  svgNodeIds?: Record<string, string>,
): { html: string; warnings: string[] } {
  const warnings: string[] = []
  const indent = generateIndent(level, options.indent || 2)
  const childIndent = generateIndent(level + 1, options.indent || 2)

  // 跳过不可见元素
  if (element.isVisible === false) {
    return { html: '', warnings }
  }

  // 确定 HTML 标签
  let tag = HTML_TAG_MAP[element.type] || 'div'
  const r = renderer

  if (options.useSemanticTags === false) {
    if (tag === 'section') tag = 'div'
  }

  // 组件边界 Level 2: 命名检测
  // DS_ 前缀或 PascalCase → 识别为语义组件标签（仅非 HTML 框架生效）
  const elementName = element.name || ''
  const isComponentName = elementName.startsWith('DS_') || /^[A-Z][a-z]+(?:[A-Z][a-z]*)*$/.test(elementName)
  if (isComponentName && r && options.framework !== 'html') {
    tag = elementName
  }

  // __svg 后缀：将整个元素导出为单一 SVG 文件
  if (options.exportSvgs && svgFiles && svgCounter && elementName.endsWith('__svg')) {
    return renderAsSvgFile(element, level, options, svgFiles, svgCounter, svgNodeIds)
  }

  // 组件边界 Level 1: 显式边界 — instance/generator 映射为语义标签
  if (element.type === 'instance' && element.componentName && r && options.framework !== 'html') {
    tag = element.componentName
  } else if (element.generatorType && r && options.framework !== 'html') {
    tag = element.generatorType.replace(/-./g, (m: string) => m[1].toUpperCase())
  }

  // 文本元素使用 span
  if (element.type === 'text') {
    tag = 'span'
  }

  // 带有 IMAGE fill 的 rectangle 转为 <img> 标签
  let imageObjectFitClass = ''
  if (element.type === 'rectangle' && element.fills) {
    const imageFill = element.fills.find(f => f.type === 'IMAGE' || f.type === 'image')
    if (imageFill) {
      tag = 'img'
      const imageUrl = (imageFill as any).imageUrl || (imageFill as any).imageRef
      if (imageUrl) {
        element.attributes = element.attributes || {}
        element.attributes['src'] = imageUrl
      }
      // 将 imageScaleMode 转为 object-fit 类
      const scaleMode = (imageFill as any).imageScaleMode || (imageFill as any).scaleMode || 'FILL'
      const scaleMap: Record<string, string> = {
        'FILL': 'object-fill',
        'FIT': 'object-contain',
        'CROP': 'object-cover',
        'STRETCH': 'object-none',
        'TILE': 'object-scale-down',
      }
      imageObjectFitClass = scaleMap[scaleMode] || ''
      // image fill 不再作为背景色处理
    }
  }

  // 模式匹配标签覆盖（方案B）
  const pattern = (element as any)._pattern as UIPattern
  if (pattern === 'divider' && element.type === 'rectangle') {
    tag = 'hr'  // 纯分割线 → <hr>
  } else if (pattern === 'divider') {
    tag = 'div'  // 分割线容器 → <div>
    element.attributes = element.attributes || {}
    element.attributes['role'] = 'separator'
  } else if (pattern === 'nav-link' && tag === 'span') {
    tag = 'a'  // 导航链接 → <a>
    element.attributes = element.attributes || {}
    element.attributes['href'] = '#'
  } else if (pattern === 'button') {
    tag = 'button'  // 按钮 → <button>
  } else if (tag === 'section' && element.layoutMode === 'HORIZONTAL' && element.children && element.children.length >= 3) {
    // 导航容器检测：flex-row + 多数子元素等宽 + 含文本 → <nav>
    const widths = element.children.map(c => c.size?.width ?? 0).filter(w => w > 0)
    const avgW = widths.reduce((a, b) => a + b, 0) / widths.length
    const widthMatch = widths.filter(w => Math.abs(w - avgW) / avgW < 0.2).length
    if (widthMatch >= element.children.length * 0.6) {
      tag = 'nav'
    }
  }

  // 构建 Tailwind 类
  const classBuilder = new TailwindClassBuilder()

  // 尺寸
  classBuilder.addSize(element.size?.width, element.size?.height, element.layoutMode, element.primaryAxisSizingMode, element.counterAxisSizingMode)

  // 位置（父元素没有 flex 布局 → NONE 或未设置）
  const noFlexParent = !parentLayoutMode || parentLayoutMode === 'NONE'
  if (noFlexParent && element.position) {
    // 居中/右对齐文字：用 text-align + padding-top 代替 absolute（符合自然文本流）
    if (element.type === 'text' && element.textAlignHorizontal === 'CENTER') {
      classBuilder.add('text-center')
      if (element.position.y && element.position.y > 0) {
        classBuilder.add(`pt-[${element.position.y}px]`)
      }
    } else {
      classBuilder.addPosition(element.position.x, element.position.y)
    }
  }

  // 布局
  classBuilder.addLayout(element)

  // NONE 容器需 position: relative 供子元素 absolute 定位参考
  if ((!element.layoutMode || element.layoutMode === 'NONE') && element.type !== 'text' && element.type !== 'pen' && element.type !== 'ellipse') {
    const hasAbsoluteChild = element.children?.some(c => c.position && (c.position.x !== 0 || c.position.y !== 0))
    if (hasAbsoluteChild) {
      classBuilder.add('relative')
    }
  }

  // 内边距（仅 flex 容器有效；NONE layout 子元素用 absolute 定位，CSS padding 会偏移参考点）
  if (element.layoutMode && element.layoutMode !== 'NONE') {
    classBuilder.addPadding(element)
  }

  // 背景（跳过 image fill，已在上面处理；文本的 fill 映射到 text- 而非 bg-）
  if (!imageObjectFitClass && element.type !== 'text') {
    classBuilder.addBackground(element.fills)
  }

  // image fill 的 object-fit 类
  if (imageObjectFitClass) {
    classBuilder.add(imageObjectFitClass)
  }

  // 边框和圆角
  classBuilder.addBorder(element.strokes, element.strokeWidth, element.cornerRadius, element.strokeAlign)
  classBuilder.addPerCornerRadius(element)

  // 效果
  classBuilder.addEffects(element.effects)

  // Flex 增长
  classBuilder.addFlexGrow(element.flexGrow)

  // 裁剪内容
  classBuilder.addClipsContent(element.clipsContent)

  // 弹性换行（仅 flex 容器有效）
  if (element.layoutMode && element.layoutMode !== 'NONE') {
    classBuilder.addFlexWrap(element.flexWrap)
  }

  // 约束
  classBuilder.addConstraints(element.constraints)

  // 尺寸限制
  classBuilder.addMinMaxSize(element)

  // 混合模式
  classBuilder.addBlendMode(element.blendMode)

  // 透明度
  // 当 fill 有独立 alpha 且 element 也有 opacity 时，将 opacity 烘入 fill 颜色
  // 避免 CSS opacity 影响子元素
  const hasFillAlpha = element.fills?.some(f => {
    if (f.isVisible === false) return false
    return (f.alpha ?? 1) < 1 || (f.opacity ?? 1) < 1
  })
  if (!hasFillAlpha) {
    classBuilder.addOpacity(element.opacity)
  }

  // 旋转
  classBuilder.addRotation(element.rotation)

  // 文本样式
  if (element.type === 'text') {
    classBuilder.addTextStyle(element)
  }

  warnings.push(...classBuilder.getWarnings())

  // 构建 class 属性
  let classString = classBuilder.build()

  // 交互增强：对交互式标签添加 hover/transition
  if (tag === 'a' || tag === 'button' || tag === 'nav') {
    classString += ' cursor-pointer'
    if (!classString.includes('hover:')) classString += ' hover:opacity-80 transition-opacity'
  } else if ((element as any)._pattern === 'button') {
    classString += ' cursor-pointer hover:opacity-80 transition-opacity'
  }

  const classAttr = classString ? ` class="${classString}"` : ''
  const displayName = element.name || element.type || 'element'

  // 构建 data 属性
  let dataAttrs = ''
  if (options.includeDataAttributes !== false) {
    // 始终输出 data-name，如果没有名称则使用类型作为默认值
    dataAttrs += ` data-name="${escapeHtml(displayName)}"`
    if (element.id) {
      dataAttrs += ` data-id="${element.id}"`
    }
  }

  // 处理子元素
  let childrenHtml = ''
  if (element.children && element.children.length > 0 && tag !== 'img') {
    // NONE layout：按视觉位置排序子元素（同行按 x，不同行按 y）
    const sortedChildren = !element.layoutMode || element.layoutMode === 'NONE' || element.layoutMode === 'VERTICAL'
      ? [...element.children].sort((a, b) => {
          const ax = a.position?.x ?? 0; const ay = a.position?.y ?? 0
          const bx = b.position?.x ?? 0; const by = b.position?.y ?? 0
          const rowThreshold = 10
          const sameRow = Math.abs(ay - by) < rowThreshold
          if (sameRow) return ax - bx
          return ay - by
        })
      : element.children

    const iconKey = element.name ? parseIconName(element.name) : null
    const iconData = iconKey && iconCache ? iconCache.get(`${iconKey.prefix}:${iconKey.name}`) : null
    const penChildren = sortedChildren.filter(c => c.type === 'pen' || c.type === 'path')
    const nonPenChildren = sortedChildren.filter(c => c.type !== 'pen' && c.type !== 'path')

    // svgContent 优先：frame 含 svgContent 且子节点纯 SVG 时直接嵌入
    if (element.svgContent && penChildren.length > 0 && nonPenChildren.length === 0) {
      childrenHtml = `${generateIndent(level + 1, options.indent || 2)}${element.svgContent}\n`
    } else if (penChildren.length > 0 && !options.exportSvgs) {
      const merged = renderMergedSvg(element, penChildren, iconData, level + 1, options)
      childrenHtml += merged.html
      warnings.push(...merged.warnings)
    }

    for (const child of nonPenChildren) {
      const result = convertElement(child, level + 1, options, element.layoutMode, iconCache, undefined, svgFiles, svgCounter, svgNodeIds)
      if (result.html) {
        childrenHtml += result.html
        warnings.push(...result.warnings)
      }
    }

    // exportSvgs 模式：pen 子元素单独渲染（每个输出为独立 SVG 文件）
    if (options.exportSvgs && penChildren.length > 0) {
      for (const child of penChildren) {
        const result = convertElement(child, level + 1, options, element.layoutMode, iconCache, undefined, svgFiles, svgCounter, svgNodeIds)
        if (result.html) {
          childrenHtml += result.html
          warnings.push(...result.warnings)
        }
      }
    }
  }

  // 处理文本内容
  const textContent = element.characters || element.content || ''

  // 构建最终 HTML
  let html = ''

  // 自闭合标签处理
  if (tag === 'img') {
    const srcAttr = element.attributes?.['src'] ? ` src="${escapeHtml(element.attributes['src'])}"` : ''
    html = `${indent}<${tag}${srcAttr}${classAttr}${dataAttrs} />\n`
  } else if (tag === 'hr') {
    html = `${indent}<hr${classAttr}${dataAttrs} />\n`
  } else if (element.chartOption) {
    // 图表元素：还原为 <chart> 标签
    const w = element.size?.width ? ` w-[${element.size.width}px]` : ''
    const h = element.size?.height ? ` h-[${element.size.height}px]` : ''
    html = `${indent}<chart${classAttr}${w}${h}${dataAttrs}\n`
    html += `${childIndent}option='${element.chartOption}'\n`
    html += `${indent}></chart>\n`
  } else if (element.type === 'pen' || element.type === 'path') {
    const pathData = element.svgPathData || element.pathData
    if (typeof pathData === 'string') {
      const viewBox = element.size
        ? `0 0 ${element.size.width} ${element.size.height}`
        : '0 0 24 24'

      let fillColor = 'currentColor'
      if (element.fills && element.fills.length > 0) {
        const fill = element.fills[0]
        if ((fill.type === 'SOLID' || fill.type === 'solid') && fill.color) {
          fillColor = fill.color
        }
      }

      const capJoin = getStrokeLinecap(element.strokeCap) + getStrokeLinejoin(element.strokeJoin)
      const closedPath = element.isClosed ? pathData.trim() + ' Z' : pathData
      const svgWidth = element.size?.width || 24
      const svgHeight = element.size?.height || 24
      const opacity = element.opacity !== undefined && element.opacity < 1 ? ` opacity="${element.opacity}"` : ''

      let strokeAttr = ''
      if (element.strokes && element.strokes.length > 0) {
        const stroke = element.strokes[0]
        if (stroke.color) {
          strokeAttr = ` stroke="${stroke.color}"`
          if (element.strokeWidth) strokeAttr += ` stroke-width="${element.strokeWidth}"`
        }
      }

      if (options.exportSvgs && svgFiles && svgCounter) {
        svgCounter.count++
        const svgName = `icon-${svgCounter.count}`
        const svgContent = `<?xml version="1.0" encoding="UTF-8"?>\n<svg width="${svgWidth}" height="${svgHeight}" viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="${closedPath}" fill="${fillColor}"${strokeAttr}${capJoin}${opacity}/>\n</svg>`
        const outputDir = options.svgOutputDir || 'icons'
        svgFiles[`${outputDir}/${svgName}.svg`] = svgContent
        html = `${indent}<img${classAttr}${dataAttrs} src="${outputDir}/${svgName}.svg" width="${svgWidth}" height="${svgHeight}" alt="${element.name || ''}" />\n`
      } else {
        html = `${indent}<svg${classAttr}${dataAttrs} width="${svgWidth}" height="${svgHeight}" viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg">\n`
        html += `${childIndent}<path d="${closedPath}" fill="${fillColor}"${strokeAttr}${capJoin}${opacity}/>\n`
        html += `${indent}</svg>\n`
      }
    } else {
      warnings.push(`Pen element ${element.name || 'unnamed'} has unsupported path data format`)
      html = `${indent}<div${classAttr}${dataAttrs}></div>\n`
    }
  } else if (element.type === 'polygon') {
    const w = element.size?.width || 100
    const h = element.size?.height || 100
    const pointCount = (element as any).pointCount || 3
    const points = generatePolygonPoints(w, h, pointCount)
    const fill = getFillColor(element)
    const strokeColor = element.strokes?.[0]?.color
    const viewBox = `0 0 ${w} ${h}`
    const strokeAttr = strokeColor ? ` stroke="${strokeColor}" stroke-width="${element.strokeWidth || 1}"` : ''
    const capJoin = getStrokeLinecap(element.strokeCap) + getStrokeLinejoin(element.strokeJoin)
    html = `${indent}<svg${classAttr}${dataAttrs} viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">\n`
    html += `${childIndent}<polygon points="${points}" fill="${fill}"${strokeAttr}${capJoin}/>\n`
    html += `${indent}</svg>\n`
  } else if (element.type === 'star') {
    const w = element.size?.width || 100
    const h = element.size?.height || 100
    const pointCount = (element as any).pointCount || 5
    const innerRadius = (element as any).innerRadius ?? 0.5
    const points = generateStarPoints(w, h, pointCount, innerRadius)
    const fill = getFillColor(element)
    const strokeColor = element.strokes?.[0]?.color
    const viewBox = `0 0 ${w} ${h}`
    const strokeAttr = strokeColor ? ` stroke="${strokeColor}" stroke-width="${element.strokeWidth || 1}"` : ''
    const capJoin = getStrokeLinecap(element.strokeCap) + getStrokeLinejoin(element.strokeJoin)
    html = `${indent}<svg${classAttr}${dataAttrs} viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">\n`
    html += `${childIndent}<polygon points="${points}" fill="${fill}"${strokeAttr}${capJoin}/>\n`
    html += `${indent}</svg>\n`
  } else if (element.type === 'ellipse') {
    const w = element.size?.width || 100
    const h = element.size?.height || 100
    const cx = w / 2
    const cy = h / 2
    const rx = w / 2
    const ry = h / 2
    const fill = getFillColor(element)
    const strokeColor = element.strokes?.[0]?.color
    const viewBox = `0 0 ${w} ${h}`
    const strokeAttr = strokeColor ? ` stroke="${strokeColor}" stroke-width="${element.strokeWidth || 1}"` : ''
    html = `${indent}<svg${classAttr}${dataAttrs} viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">\n`
    html += `${childIndent}<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"${strokeAttr}/>\n`
    html += `${indent}</svg>\n`
  } else if (element.type === 'line') {
    const w = element.size?.width || 100
    const h = element.size?.height || 100
    const strokeColor = element.strokes?.[0]?.color || 'currentColor'
    const strokeWidth = element.strokeWidth || 1
    const viewBox = `0 0 ${w} ${h}`
    const capAttr = getStrokeLinecap(element.strokeCap) || ' stroke-linecap="round"'
    const joinAttr = getStrokeLinejoin(element.strokeJoin)
    html = `${indent}<svg${classAttr}${dataAttrs} viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">\n`
    html += `${childIndent}<line x1="0" y1="0" x2="${w}" y2="${h}" stroke="${strokeColor}" stroke-width="${strokeWidth}"${capAttr}${joinAttr}/>\n`
    html += `${indent}</svg>\n`
  } else if (element.type === 'svg' && element.svgContent) {
    // SVG 元素：输出原始 SVG 内容（来自 data-icon 或 chart 渲染结果）
    html = `${indent}<svg${classAttr}${dataAttrs} xmlns="http://www.w3.org/2000/svg">\n`
    html += `${childIndent}${element.svgContent}\n`
    html += `${indent}</svg>\n`
  } else if (textContent) {
    // 有文本内容的元素
    if (childrenHtml) {
      html = `${indent}${r ? r.openTag(tag, { class: classString || undefined, 'data-name': displayName }) : `<${tag}${classAttr}${dataAttrs}>`}\n`
      html += `${childIndent}${escapeHtml(textContent)}\n`
      html += childrenHtml
      html += `${indent}${r ? r.closeTag(tag) : `</${tag}>`}\n`
    } else {
      html = `${indent}${r ? r.openTag(tag, { class: classString || undefined, 'data-name': displayName }) + escapeHtml(textContent) + r.closeTag(tag) : `<${tag}${classAttr}${dataAttrs}>${escapeHtml(textContent)}</${tag}>`}\n`
    }
  } else if (childrenHtml) {
    html = `${indent}${r ? r.openTag(tag, { class: classString || undefined, 'data-name': displayName }) : `<${tag}${classAttr}${dataAttrs}>`}\n`
    html += childrenHtml
    html += `${indent}${r ? r.closeTag(tag) : `</${tag}>`}\n`
  } else {
    html = `${indent}${r ? r.voidTag(tag, { class: classString || undefined, 'data-name': displayName }) : `<${tag}${classAttr}${dataAttrs}></${tag}>`}\n`
  }

  return { html, warnings }
}

// ============== 组件模式匹配（方案B）==============

type UIPattern = 'divider' | 'status-dot' | 'nav-link' | 'button' | undefined

/**
 * 递归检测 DSL 树中的已知 UI 组件模式，在元素上标记 _pattern
 * 让 convertElement 生成语义 HTML（<hr>/<a>/<button> 等）
 */
function detectPatterns(el: DSLElement, parent?: DSLElement): void {
  const p = el as any

  // 先递归子元素
  if (el.children) {
    for (const child of el.children) {
      detectPatterns(child, el)
    }
  }

  const w = el.size?.width ?? 0
  const h = el.size?.height ?? 0
  const name = el.name || ''
  const parentName = parent?.name || ''

  // 1. 分割线：高度 ≤ 3px，无子元素或仅一个同名字元素
  if (h <= 3 && (!el.children || el.children.length === 0)) {
    p._pattern = 'divider'
    return
  }

  // 2. 分割线容器：frame/div 包裹一个分割线，且本身高度 ≤ 3
  if ((el.type === 'frame' || el.type === 'rectangle') && h <= 4) {
    p._pattern = 'divider'
    return
  }

  // 3. 状态指示点：小型 ellipse/rectangle（≤ 16px），有填充色
  if ((el.type === 'ellipse' || el.type === 'rectangle') && w <= 16 && h <= 16) {
    const hasFill = el.fills?.some(f => f.type === 'SOLID' && f.color && f.isVisible !== false)
    if (hasFill) {
      p._pattern = 'status-dot'
      return
    }
  }

  // 4. 导航链接：flex-row 父容器内的 text，CENTER 对齐
  if (el.type === 'text' && parent?.layoutMode === 'HORIZONTAL' && el.textAlignHorizontal === 'CENTER') {
    p._pattern = 'nav-link'
    return
  }

  // 5. 按钮：frame/instance 有背景色、borderRadius、单个居中文本
  if ((el.type === 'frame' || el.type === 'instance') && w > 0 && h > 0 && el.cornerRadius && el.cornerRadius > 0) {
    const hasBg = el.fills?.some(f => (f.type === 'SOLID' || f.type === 'GRADIENT_LINEAR') && f.color && f.isVisible !== false)
    const singleCenteredText = el.children?.length === 1 && el.children[0].type === 'text'
    if (hasBg && singleCenteredText) {
      p._pattern = 'button'
      return
    }
  }
}

// ============== 布局意图推断（方案A）==============

/**
 * 递归推断 NONE 布局容器的真实意图：是同排 flex、同列 flex、居中、还是确实需要 absolute
 * 在转换前就地修改 element.layoutMode，避免下游做机械的坐标翻译
 */
function inferLayout(el: DSLElement): void {
  if (!el.children || el.children.length === 0) return

  // 先递归推断子元素（深度优先）
  for (const child of el.children) {
    inferLayout(child)
  }

  // 只处理 NONE 布局（flex 布局已有明确意图）
  if (el.layoutMode !== 'NONE' && el.layoutMode !== undefined) return

  const visible = el.children.filter(c => c.isVisible !== false)
  if (visible.length < 1) return

  const pw = el.size?.width ?? 0
  const ph = el.size?.height ?? 0

  // 收集位置数据
  const rects = visible.map(c => ({
    x: c.position?.x ?? 0, y: c.position?.y ?? 0,
    w: c.size?.width ?? 0, h: c.size?.height ?? 0,
  }))

  // 检测是否重叠（重叠 → 保留 absolute）
  const hasOverlap = rects.some((a, i) =>
    rects.some((b, j) => i !== j && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)
  )
  if (hasOverlap) return

  // 同行检测：y 差值 < 10px
  const yVals = rects.map(r => r.y).sort((a, b) => a - b)
  const sameRow = yVals[yVals.length - 1] - yVals[0] < 10

  if (sameRow) {
    // 等宽且连续 → 导航栏模式（flex-row + 固定宽度）
    const widths = rects.map(r => r.w)
    const sortedByX = [...visible].sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0))
    const gaps: number[] = []
    for (let i = 1; i < sortedByX.length; i++) {
      gaps.push((sortedByX[i].position?.x ?? 0) - (sortedByX[i - 1].position?.x ?? 0) - (sortedByX[i - 1].size?.width ?? 0))
    }
    const gapConsistent = gaps.length === 0 || gaps.every(g => Math.abs(g - gaps[0]) < 5)
    const widthConsistent = widths.length < 2 || widths.every(w => Math.abs(w - widths[0]) / (widths[0] || 1) < 0.3)

    // 同一行且（等宽 + 等间距）或只有少量项目 → 绝大多数是导航/菜单
    if (gapConsistent && widthConsistent) {
      el.layoutMode = 'HORIZONTAL'
      el.mainAxisAlignItems = 'MIN'
      el.crossAxisAlignItems = 'CENTER'
      return
    }

    // 不同宽度但无重叠且项目数 ≤ 5 → 也可能是 flex-row（如 一键检测）
    if (visible.length <= 5) {
      el.layoutMode = 'HORIZONTAL'
      el.mainAxisAlignItems = 'MIN'
      el.crossAxisAlignItems = 'CENTER'
      return
    }
  }

  // 垂直堆叠检测：子元素从上到下排列（下一个的 y ≥ 上一个的底部 - 容差）
  const sortedByY = [...visible].sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))
  const verticalStack = sortedByY.every((c, i) => {
    if (i === 0) return true
    const prev = sortedByY[i - 1]
    const prevBottom = (prev.position?.y ?? 0) + (prev.size?.height ?? 0)
    return (c.position?.y ?? 0) >= prevBottom - 5
  })
  if (verticalStack && visible.length > 1) {
    el.layoutMode = 'VERTICAL'
    el.mainAxisAlignItems = 'MIN'
    return
  }

  // 单个子元素且大致居中 → flex 居中
  if (visible.length === 1 && pw > 0 && ph > 0) {
    const c = visible[0]
    const cx = c.position?.x ?? 0; const cy = c.position?.y ?? 0
    const cw = c.size?.width ?? 0; const ch = c.size?.height ?? 0
    const expectX = (pw - cw) / 2; const expectY = (ph - ch) / 2
    if (Math.abs(cx - expectX) < 20 && Math.abs(cy - expectY) < 20) {
      el.layoutMode = 'HORIZONTAL'
      el.mainAxisAlignItems = 'CENTER'
      el.crossAxisAlignItems = 'CENTER'
      return
    }
  }

  // fallthrough：多行多列混合 → 保持 NONE，下游用 absolute 排序
}

/**
 * 语义结构 → AI 风格 HTML（替代机械转换器）
 */
function semanticToHtml(components: SemanticComponent[], svgIdMap?: Record<string, string>): string {
  const r = (v: number) => Math.round(v)
  // Build reverse map: nodeId → svgFilename
  const nodeToFile: Record<string, string> = {}
  if (svgIdMap) {
    for (const [file, nodeId] of Object.entries(svgIdMap)) {
      nodeToFile[nodeId] = file
    }
  }
  let svgCounter = 0

  function walk(comp: SemanticComponent, depth: number): string {
    const t = comp['type']
    const p = comp['props'] || {}
    const s = comp['style'] || {}
    const name = comp['name'] || ''
    const kids = (comp['children'] || []) as SemanticComponent[]
    const indent = '  '.repeat(depth + 1)
    const html = ''

    // Text
    if (t === 'text') {
      const txt = p['text'] || ''
      const color = s['color'] || ''
      const sz = p['fontSize'] || 0
      let cls = 'text-xs'
      if (color) cls += ` text-[${color}]`
      if (sz) cls += ` text-[${r(sz)}px]`
      // Short status text
      if (['正常','异常','同步中','删除中'].includes(txt)) {
        const colors: Record<string,string> = {'正常':'text-green-400','异常':'text-red-400','同步中':'text-yellow-400','删除中':'text-yellow-400'}
        cls = `text-xs ${colors[txt] || 'text-white'}`
      }
      // Long text → truncate
      if (txt.length > 20) cls += ' truncate'
      // Title-level text → use p or span
      return `${indent}<span class="${cls}">${txt}</span>\n`
    }

    // Divider
    if (t === 'divider' || name.includes('分隔线') || (p['width'] === 1 && p['height'] && p['height'] > 10)) {
      return `${indent}<div class="w-px h-5 bg-white/10 mx-2"></div>\n`
    }

    // Graphics with no children → skip (handled by __svg or decorative)
    if ((t === 'graphic' || t === 'ellipse') && kids.length === 0) return ''
    // Standalone background rectangles → skip (cosmetic, parent container handles it)
    if (t === 'rectangle' && kids.length === 0) return ''
    if (t === 'rectangle') {
      if (kids.length === 0 && s['background']) return ''
    }

    // __svg container → emit <img> reference
    if (name.includes('__svg')) {
      svgCounter++
      const svgPath = `icons/icon-${svgCounter}.svg`
      return `${indent}<img src="${svgPath}" class="w-5 h-5" alt="${name.replace('__svg','')}">\n`
    }

    // Build children first
    let childrenHtml = ''
    for (const c of kids) childrenHtml += walk(c, depth + 1)

    // Container with no content and no styling → skip
    const hasVisualStyle = s['background'] || s['borderRadius'] || s['borderColor'] || s['opacity'] !== undefined || s['gradient'] || (s['shadows'] && s['shadows'].length > 0)
    if (!childrenHtml.trim() && !hasVisualStyle) return ''

    // Build Tailwind classes
    const cls: string[] = []
    const lm = p['layoutMode'] || ''
    const pad: number[] = p['padding'] || []

    // Groups → treat as flex-row container (two-column layout common for groups)
    if (t === 'group' && !lm && kids.length >= 2) cls.push('flex flex-row items-center justify-between flex-wrap')
    else if (lm === 'HORIZONTAL') { cls.push('flex flex-row'); const g = p['itemSpacing']; if (g) cls.push(`gap-[${g}px]`) }

    // Alignment
    const am = p['alignMain'] || ''; const ac = p['alignCross'] || ''
    const jMap: Record<string,string> = {'MIN':'justify-start','CENTER':'justify-center','MAX':'justify-end','SPACE_BETWEEN':'justify-between','SPACE_AROUND':'justify-around'}
    const iMap: Record<string,string> = {'MIN':'items-start','CENTER':'items-center','MAX':'items-end','STRETCH':'items-stretch'}
    if (am && jMap[am]) cls.push(jMap[am])
    if (ac && iMap[ac]) cls.push(iMap[ac])

    // Flex wrap
    if (p['flexWrap'] === 'WRAP') cls.push('flex-wrap')
    else if (p['flexWrap'] === 'NO_WRAP') cls.push('flex-nowrap')

    // Clipping: only apply when needed (not to every clipsContent container)
    if (p['clipContent'] && kids.length >= 3) cls.push('overflow-hidden')

    // Default alignment for flex containers (AI-style hint)
    if (lm === 'HORIZONTAL' && !ac && kids.length >= 2) cls.push('items-center')

    if (pad.length === 4) {
      const [pt, pr, pb, pl] = pad.map(v => r(v || 0))
      if (pt === pr && pr === pb && pb === pl) { if (pt) cls.push(`p-[${pt}px]`) }
      else if (pt === pb && pl === pr) {
        if (pt) cls.push(`py-[${pt}px]`); if (pl) cls.push(`px-[${pl}px]`)
      } else {
        if (pt) cls.push(`pt-[${pt}px]`); if (pr) cls.push(`pr-[${pr}px]`)
        if (pb) cls.push(`pb-[${pb}px]`); if (pl) cls.push(`pl-[${pl}px]`)
      }
    }

    const bg = s['background']; if (bg) cls.push(`bg-[${bg}]`)
    const grad = s['gradient']
    if (grad) {
      const stops = (grad['stops'] || []).map((gs: any) => {
        let c = gs.color || '#000'
        // Convert 8-digit hex to rgba for Tailwind compat
        if (/^#[0-9a-f]{8}$/i.test(c)) {
          const r = parseInt(c.slice(1,3), 16)
          const g = parseInt(c.slice(3,5), 16)
          const b = parseInt(c.slice(5,7), 16)
          const a = (parseInt(c.slice(7,9), 16) / 255).toFixed(2)
          c = `rgba(${r},${g},${b},${a})`
        }
        return `${c} ${(gs.pos * 100).toFixed(0)}%`
      }).join(', ')
      cls.push(grad['type'] === 'radial' ? `bg-[radial-gradient(circle_at_50%_100%,${stops})]` : `bg-[linear-gradient(90deg,${stops})]`)
    }
    const br = s['borderRadius']; if (br) cls.push(`rounded-[${r(br)}px]`)
    const bc = s['borderColor']; if (bc) cls.push(`border border-[${bc}]`)
    const sh = s['shadows']
    if (sh && sh.length > 0) {
      const parts = sh.map((sh: any) => {
        let c = sh.color || '#000'
        if (/^#[0-9a-f]{8}$/i.test(c)) {
          const r = parseInt(c.slice(1,3), 16); const g = parseInt(c.slice(3,5), 16)
          const b = parseInt(c.slice(5,7), 16); const a = (parseInt(c.slice(7,9),16)/255).toFixed(2)
          c = `rgba(${r},${g},${b},${a})`
        }
        // inner shadow → inset；spread 非 0 时补第 4 个长度（此前被静默丢弃）
        const inset = sh.type === 'inner_shadow' ? 'inset ' : ''
        const spread = sh.spread ? ` ${sh.spread}px` : ''
        return `${inset}${sh.dx}px ${sh.dy}px ${sh.blur}px${spread} ${c}`
      }).join(', ')
      cls.push(`shadow-[${parts}]`)
    }
    // 模糊：语义路径此前完全没输出 blur / backdrop-blur
    if (s['blur']) cls.push(`blur-[${s['blur']}px]`)
    if (s['backdropBlur']) cls.push(`backdrop-blur-[${s['backdropBlur']}px]`)
    if (s['opacity'] !== undefined && s['opacity'] < 1) cls.push(`opacity-[${s['opacity']}]`)

    const interactive = /button|返回|点击|立即调整/.test(name)
    if (interactive) cls.push('cursor-pointer hover:opacity-80 transition-opacity')
    // Add hover to table rows for better UX
    if (name.includes('table-row')) cls.push('hover:bg-white/[0.08] transition-colors')
    // Add hover to pagination controls
    if (name.includes('pagination') || name.includes('分页')) cls.push('[&_button]:hover:text-white/80 [&_button]:transition-colors')

    const clsStr = cls.length ? ` class="${cls.join(' ')}"` : ''
    
    // Collapse only truly transparent containers: no layoutMode, no visual style, no padding
    // Containers with layoutMode (HORIZONTAL/VERTICAL) are structurally essential
    if (!lm && !hasVisualStyle && !pad.some((v: number) => v > 0) && childrenHtml.split('\n').filter((l: string) => l.trim()).length <= 6) {
      return childrenHtml
    }
    
    // Container: build and return
    if (!clsStr && childrenHtml.split('\n').filter(l => l.trim()).length <= 2) {
      return childrenHtml  // No wrapper needed
    }

    // Collapse single-child containers with no visual style
    const childLines = childrenHtml.split('\n').filter(l => l.trim())
    if (!lm && !s['background'] && !s['borderRadius'] && !s['borderColor'] && s['opacity'] === undefined) {
      if (childLines.length <= 3) return childrenHtml.trim()
    }

    return `${indent}<div${clsStr}>\n${childrenHtml}${indent}</div>\n`
  }

  let out = ''
  for (const c of components) out += walk(c, 0)
  return out
}

/**
 * 仅生成 SVG 文件（供 semantic/hybrid 模式调用）
 */
export async function generateSvgFiles(
  dsl: { version: string; elements: DSLElement[] },
  options: ConvertOptions,
): Promise<{ files?: Record<string, string>; svgNodeIds?: Record<string, string> }> {
  const result = await dslToCode(dsl, { ...options, mode: 'html', codeOnly: true })
  return { files: result.files, svgNodeIds: result.svgNodeIds }
}

// ============== 主转换函数 ==============

/**
 * 将 DSL 文档转换为 HTML+Tailwind 代码
 * @param dsl DSL 文档对象
 * @param options 转换选项
 * @returns 转换结果
 */
export async function dslToCode(
  dsl: { version: string; elements: DSLElement[] },
  options: ConvertOptions = {}
): Promise<ConvertResult> {
  const warnings: string[] = []
  const stats = {
    elementsConverted: 0,
    componentsDetected: 0,
    textNodes: 0,
    frames: 0,
  }

  // 合并默认选项
  const mergedOptions: ConvertOptions = {
    indent: 2,
    useSemanticTags: true,
    includeDataAttributes: true,
    ...options,
  }

  // Token 导出模式：不走 HTML 转换
  if (mergedOptions.mode === 'tokens') {
    const tokenResult = dslToTokens(dsl, {
      darkMode: (options as any)?.darkMode,
      brand: (options as any)?.theme?.brand || (options as any)?.brand,
    })
    return {
      tokens: {
        css: tokenResult.css,
        tailwind: tokenResult.tailwind,
        dtcg: tokenResult.dtcg,
        collection: tokenResult.collection,
      },
      warnings: tokenResult.warnings,
      stats: {
        elementsConverted: 0,
        componentsDetected: 0,
        textNodes: 0,
        frames: 0,
      },
    }
  }

  // 语义 DSL 模式：提取设计意图，AI 自行渲染
  if (mergedOptions.mode === 'semantic') {
    const components = dslToSemantic(dsl)
    let files: Record<string, string> | undefined
    let svgNodeIds: Record<string, string> | undefined
    // 支持 exportSvgs：运行完整管线导出 SVG 文件
    if (mergedOptions.exportSvgs) {
      const svgResult = await generateSvgFiles(dsl, mergedOptions)
      files = svgResult.files
      svgNodeIds = svgResult.svgNodeIds
    }
    return {
      html: '',
      semantic: { version: '3.0', components },
      files,
      svgNodeIds,
      warnings: [],
      stats: { elementsConverted: 0, componentsDetected: 0, textNodes: 0, frames: 0 },
    }
  }

  // 压缩 DSL 模式：去噪声 + 抽样式 + 保结构，AI 自行渲染
  if (mergedOptions.mode === 'compressed') {
    let files: Record<string, string> | undefined
    if (mergedOptions.exportSvgs) {
      const svgResult = await generateSvgFiles(dsl, mergedOptions)
      files = svgResult.files
    }
    const compressed = compressDsl(dsl)
    return {
      html: '',
      compressed,
      files,
      warnings: [],
      stats: { elementsConverted: 0, componentsDetected: 0, textNodes: 0, frames: 0 },
    }
  }

  // 兼容模式：保持现有 hybrid/html 行为
  const isHybrid = !mergedOptions.mode || mergedOptions.mode === 'hybrid'
  let hybridSemantic: { version: string; components: SemanticComponent[] } | undefined
  if (isHybrid) {
    // 在 stripIrrelevantFields 前提取语义结构（保留 id/constraints 等字段）
    const comps = dslToSemantic(dsl)
    if (comps.length > 0) hybridSemantic = { version: '3.0', components: comps }
  }

  // 混合模式（默认）：语义结构 → AI 风格 HTML + SVG 资产
  if (isHybrid && hybridSemantic) {
    // Generate SVG files first (to get the file→nodeId mapping)
    let svgFiles: Record<string, string> | undefined
    let svgNodeIdsResult: Record<string, string> | undefined
    if (mergedOptions.exportSvgs) {
      const svgResult = await generateSvgFiles(dsl, mergedOptions)
      svgFiles = svgResult.files
      svgNodeIdsResult = svgResult.svgNodeIds
    }
    // Generate HTML from semantic (pass svgNodeIds for icon mapping)
    const html = semanticToHtml(hybridSemantic.components, svgNodeIdsResult)
    // 混合模式下也统计 DSL 元素：countElements 是函数声明（已提升）且 stats 已初始化，
    // 否则默认路径会把 elementsConverted 等恒为 0 返回给调用方（local-tools 的 stats）。
    countElements(dsl.elements)
    return {
      html: '<div class="flex flex-col gap-2 p-4">\n' + html + '</div>\n',
      files: svgFiles,
      semantic: hybridSemantic,
      svgNodeIds: svgNodeIdsResult,
      warnings: [],
      stats,
    }
  }

  // codeOnly 过滤：移除代码生成不需要的 DSL 字段，缩小体积 20-30%
  if (mergedOptions.codeOnly) {
    stripIrrelevantFields(dsl as any)
  }

  // 验证 DSL
  if (!dsl || !dsl.elements || !Array.isArray(dsl.elements)) {
    return {
      html: '<!-- Invalid DSL: missing elements array -->',
      warnings: ['Invalid DSL structure: elements array is required'],
      stats,
    }
  }

  // 布局意图推断：NONE 容器 → HORIZONTAL/VERTICAL（先递归处理子元素）
  for (const el of dsl.elements) {
    inferLayout(el)
  }

  // 组件模式匹配：分割线/导航链接/按钮等 → 标记 _pattern 供 convertElement 使用
  for (const el of dsl.elements) {
    detectPatterns(el)
  }

  // 预获取图标（从 Iconify）
  const iconCache = new Map<string, any>()
  async function scanAndFetchIcons(elements: DSLElement[]) {
    for (const el of elements) {
      if (el.name) {
        const parsed = parseIconName(el.name)
        if (parsed) {
          const key = `${parsed.prefix}:${parsed.name}`
          if (!iconCache.has(key)) {
            const icon = await safeCatchAsync(`icon/fetch/${key}`, () => fetchIcon(key), null)
            if (icon) iconCache.set(key, icon)
          }
        }
      }
      if (el.children) await scanAndFetchIcons(el.children)
    }
  }
  await scanAndFetchIcons(dsl.elements)

  // 统计元素
  function countElements(elements: DSLElement[]) {
    for (const el of elements) {
      stats.elementsConverted++
      if (el.type === 'component' || el.type === 'INSTANCE') {
        stats.componentsDetected++
      }
      if (el.type === 'text') {
        stats.textNodes++
      }
      if (el.type === 'frame') {
        stats.frames++
      }
      if (el.children) {
        countElements(el.children)
      }
    }
  }
  countElements(dsl.elements)

  // 转换所有元素
  const frameworkRenderer = mergedOptions.framework
    ? createRenderer(mergedOptions.framework, mergedOptions.indent || 2)
    : undefined
  const svgFiles: Record<string, string> = {}
  const svgNodeIds: Record<string, string> = {}
  const svgCounter = { count: 0 }
  let html = ''
  for (const element of dsl.elements) {
    const result = convertElement(element, 0, mergedOptions, undefined, iconCache, frameworkRenderer, svgFiles, svgCounter, svgNodeIds)
    html += result.html
    warnings.push(...result.warnings)
  }

  // 添加 HTML 包装（如果只有一个根元素且是 section）
  let finalHtml = html
  if (dsl.elements.length === 1 && dsl.elements[0].type === 'frame') {
    // 已经是干净的结构，不需要额外包装
  } else if (dsl.elements.length > 1) {
    // 多个根元素，用 div 包装
    finalHtml = `<div class="flex flex-col gap-4">\n${html}</div>\n`
  }

  // 多文件输出：框架模式下按组件边界拆分
  let files: Record<string, string> | undefined
  if (frameworkRenderer && mergedOptions.framework && mergedOptions.framework !== 'html') {
    files = {}
    for (const element of dsl.elements) {
      const name = element.name || 'Component'
      const isComponent = name.startsWith('DS_') || /^[A-Z][a-z]+(?:[A-Z][a-z]*)*$/.test(name)
      if (isComponent) {
        const elResult = convertElement(element, 1, mergedOptions, undefined, iconCache, frameworkRenderer)
        const ext = mergedOptions.framework === 'vue3' ? '.vue' : '.tsx'
        files[`${name}${ext}`] = frameworkRenderer.wrapComponent(name, elResult.html, {
          children: true,
        })
      }
    }
    // 入口文件
    const entryName = 'App'
    const imports = Object.keys(files).map(f => {
      const compName = f.replace(/\.\w+$/, '')
      return mergedOptions.framework === 'vue3'
        ? `import ${compName} from './${f}'`
        : `import { ${compName} } from './${f}'`
    })
    const entryExt = mergedOptions.framework === 'vue3' ? '.vue' : '.tsx'
    files[`${entryName}${entryExt}`] = frameworkRenderer.wrapPage(entryName, finalHtml, { imports })
  }

  // 合并 SVG 文件到输出（HTML 模式也支持）
  if (Object.keys(svgFiles).length > 0) {
    files = files || {}
    Object.assign(files, svgFiles)
  }

  return {
    html: finalHtml,
    files,
    semantic: isHybrid ? hybridSemantic : undefined,
    svgNodeIds: Object.keys(svgNodeIds).length > 0 ? svgNodeIds : undefined,
    warnings: [...new Set(warnings)], // 去重
    stats,
  }
}

/**
 * 将 DSL 转换为带样式的完整 HTML 文档
 * @param dsl DSL 文档对象
 * @param options 转换选项
 * @returns 完整的 HTML 文档字符串
 */
export async function dslToFullHtml(
  dsl: { version: string; elements: DSLElement[] },
  options: ConvertOptions & { title?: string } = {}
): Promise<string> {
  const result = await dslToCode(dsl, options)

  const title = options.title || 'Generated from MasterGo'

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen p-8">
${result.html}</body>
</html>
`
}

/**
 * 验证 DSL 结构是否有效
 * @param dsl 待验证的 DSL 对象
 * @returns 验证结果
 */
export function validateDSL(dsl: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!dsl || typeof dsl !== 'object') {
    errors.push('DSL must be an object')
    return { valid: false, errors }
  }

  const dslObj = dsl as Record<string, unknown>

  if (!dslObj.version) {
    errors.push('DSL version is required')
  }

  if (!dslObj.elements || !Array.isArray(dslObj.elements)) {
    errors.push('DSL elements array is required')
  } else if (dslObj.elements.length === 0) {
    errors.push('DSL elements array is empty')
  }

  // 递归验证元素结构
  function validateElement(element: unknown, path: string): void {
    if (!element || typeof element !== 'object') {
      errors.push(`${path}: element must be an object`)
      return
    }

    const el = element as Record<string, unknown>

    if (!el.type || typeof el.type !== 'string') {
      errors.push(`${path}: element type is required`)
    }

    if (el.children && Array.isArray(el.children)) {
      el.children.forEach((child, index) => {
        validateElement(child, `${path}.children[${index}]`)
      })
    }
  }

  if (Array.isArray(dslObj.elements)) {
    dslObj.elements.forEach((el, index) => {
      validateElement(el, `elements[${index}]`)
    })
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// ============== 导出类型 ==============

export type { DSLElement } from '../dsl-types.js'
