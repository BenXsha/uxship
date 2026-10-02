// ───── 通用基础类型 ─────

export interface Position {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Color {
  r: number
  g: number
  b: number
  a: number
}

export interface GradientStop {
  position: number
  color: string
}

export interface Fill {
  type: 'solid' | 'gradient_linear' | 'gradient_radial' | 'gradient_angular' | 'gradient_diamond' | 'image'
  color?: string
  gradientStops?: GradientStop[]
  gradientHandlePositions?: { x: number; y: number }[]
  imageUrl?: string
  imageScaleMode?: 'FILL' | 'FIT' | 'TILE' | 'STRETCH' | 'CROP'
  imageRotation?: number
  filters?: {
    exposure?: number
    contrast?: number
    saturation?: number
    temperature?: number
    tint?: number
    highlights?: number
    shadows?: number
    hue?: number
  }
  ratio?: number
  isVisible?: boolean
  alpha?: number
  blendMode?: string
  name?: string
  transform?: [[number, number, number], [number, number, number]]
}

export interface Stroke {
  type: 'solid' | 'gradient_linear' | 'gradient_radial' | 'gradient_angular' | 'gradient_diamond' | 'image'
  color?: string
  gradientStops?: GradientStop[]
  gradientHandlePositions?: { x: number; y: number }[]
  imageUrl?: string
  imageScaleMode?: 'FILL' | 'FIT' | 'TILE' | 'STRETCH' | 'CROP'
  imageRotation?: number
  filters?: {
    exposure?: number
    contrast?: number
    saturation?: number
    temperature?: number
    tint?: number
    highlights?: number
    shadows?: number
    hue?: number
  }
  ratio?: number
  isVisible?: boolean
  alpha?: number
  blendMode?: string
  name?: string
  transform?: [[number, number, number], [number, number, number]]
}

export interface Effect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR'
  radius?: number
  color?: string
  offset?: { x: number; y: number }
  visible?: boolean
  blendMode?: string
  spread?: number
  showShadowBehindNode?: boolean
  isEffectShow?: boolean
}

export interface Constraints {
  horizontal: 'LEFT' | 'RIGHT' | 'LEFT_RIGHT' | 'SCALE' | 'CENTER'
  vertical: 'TOP' | 'BOTTOM' | 'TOP_BOTTOM' | 'SCALE' | 'CENTER'
}

// ───── 元素基础 ─────

export interface BaseElement {
  type: string
  name: string
  id?: string
  // 通用属性（dsl-spec「通用属性」）：可见性 / 锁定
  isVisible?: boolean
  isLocked?: boolean
  position?: Position
  size?: Partial<Size>
  rotation?: number
  // 圆角（frame/component/rectangle 均可使用；rectangle 中另有声明）
  cornerRadius?: number
  topLeftRadius?: number
  topRightRadius?: number
  bottomLeftRadius?: number
  bottomRightRadius?: number
  fills?: Fill[]
  strokes?: Stroke[]
  strokeWidth?: number
  strokeTopWeight?: number
  strokeBottomWeight?: number
  strokeLeftWeight?: number
  strokeRightWeight?: number
  effects?: Effect[]
  opacity?: number
  constraints?: Constraints
  blendMode?: 'PASS_THROUGH' | 'NORMAL' | 'DARKEN' | 'MULTIPLY' | 'COLOR_BURN' | 'LIGHTEN' | 'SCREEN' | 'COLOR_DODGE' | 'OVERLAY' | 'SOFT_LIGHT' | 'HARD_LIGHT' | 'DIFFERENCE' | 'EXCLUSION' | 'HUE' | 'SATURATION' | 'COLOR' | 'LUMINOSITY' | 'PLUS_DARKER' | 'PLUS_LIGHTER'
  flexGrow?: 0 | 1
  layoutPositioning?: 'AUTO' | 'ABSOLUTE'
  alignSelf?: 'AUTO' | 'STRETCH' | 'START' | 'CENTER' | 'END'
}

// ───── 具体元素类型 ─────

export interface RectangleElement extends BaseElement {
  type: 'rectangle'
  cornerRadius?: number
  cornerSmooth?: number
  topLeftRadius?: number
  topRightRadius?: number
  bottomLeftRadius?: number
  bottomRightRadius?: number
}

export interface TextSegment {
  start: number
  end: number
  fills: Fill[]
}

export interface TextElement extends BaseElement {
  type: 'text'
  content: string
  fontSize?: number
  fontWeight?: number
  fontName?: { family: string; style: string }
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT'
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM'
  textAutoResize?: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE'
  lineHeight?: number | { unit: 'PIXELS' | 'PERCENT' | 'AUTO', value?: number }
  /** 字间距：number 视为像素；对象形态来自 dsl_exportNode 导出（MasterGo LetterSpacing） */
  letterSpacing?: number | { unit?: string, value?: number }
  paragraphSpacing?: number
  textDecoration?: string
  textCase?: string
  textSegments?: TextSegment[]
  /**
   * 富文本 run（P2-3）：按顺序拼接，渲染末端用 `text.getRange` 逐段上样式（字号/字重/字距/颜色）。
   * 仅在真的多 run 时才写（单 run 交给整段样式）。
   */
  runs?: Array<{ text: string; fontSize?: number; fontWeight?: number; color?: string; letterSpacing?: number }>
}

export interface EllipseElement extends BaseElement {
  type: 'ellipse'
}

export interface PolygonElement extends BaseElement {
  type: 'polygon'
  pointCount?: number
  cornerRadius?: number
}

export interface StarElement extends BaseElement {
  type: 'star'
  pointCount?: number
  innerRadius?: number
}

export interface LineElement extends BaseElement {
  type: 'line'
  strokeCap?: 'STROKE' | 'ROUND' | 'SQUARE' | 'NONE' | 'ROUND_OUTSIDE' | 'ARROW_EQUILATERAL'
  strokeJoin?: 'MITER' | 'BEVEL' | 'ROUND'
}

export interface ConnectorEndpoint {
  endpointNodeId?: string
  magnet?: 'AUTO' | 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT' | 'CENTER'
  x?: number
  y?: number
}

export interface ConnectorElement extends BaseElement {
  type: 'connector'
  connectorStart: ConnectorEndpoint
  connectorEnd: ConnectorEndpoint
  connectorLineType?: 'STRAIGHT' | 'ELBOWED' | 'CURVED'
  connectorStartStrokeCap?: 'NONE' | 'ARROW_EQUILATERAL' | 'LINE_ARROW' | 'ROUND_ARROW' | 'DIAMOND' | 'RING'
  connectorEndStrokeCap?: 'NONE' | 'ARROW_EQUILATERAL' | 'LINE_ARROW' | 'ROUND_ARROW' | 'DIAMOND' | 'RING'
}

export interface BooleanOperationElement extends BaseElement {
  type: 'boolean_operation'
  booleanOperation: 'UNION' | 'INTERSECT' | 'SUBTRACT' | 'EXCLUDE'
  children: BaseElement[]
}

export interface PenElement extends BaseElement {
  type: 'pen'
  pathData?: string | any[]
  svgPathData?: string
  windingRule?: 'Nonzero' | 'EvenOdd'
  isClosed?: boolean
  strokeCap?: 'STROKE' | 'ROUND' | 'SQUARE' | 'NONE' | 'ROUND_OUTSIDE' | 'ARROW_EQUILATERAL'
  strokeJoin?: 'MITER' | 'BEVEL' | 'ROUND'
}

export interface SvgElement extends BaseElement {
  type: 'svg'
  svgContent: string
  chartOption?: string
}

export interface GroupElement extends BaseElement {
  type: 'group'
  children: BaseElement[]
}

export interface FrameElement extends BaseElement {
  type: 'frame'
  children: BaseElement[]
  svgContent?: string
  cornerRadius?: number
  layoutMode?: 'NONE' | 'VERTICAL' | 'HORIZONTAL' | 'GRID'
  itemSpacing?: number
  paddingTop?: number
  paddingBottom?: number
  paddingLeft?: number
  paddingRight?: number
  clipsContent?: boolean
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX'
  mainAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
  crossAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX'
  counterAxisAlignContent?: 'AUTO' | 'SPACE_BETWEEN'
  flexWrap?: 'NO_WRAP' | 'WRAP'
  crossAxisSpacing?: number
  primaryAxisSizingMode?: 'FIXED' | 'AUTO'
  counterAxisSizingMode?: 'FIXED' | 'AUTO'
  breakpoints?: Array<{
    name: string
    minWidth: number
    properties: Record<string, any>
  }>
}

/**
 * Tailwind 断点定义（按 min-width 排序）
 */
export const TAILWIND_BREAKPOINTS: Array<{ name: string; minWidth: number }> = [
  { name: 'sm', minWidth: 640 },
  { name: 'md', minWidth: 768 },
  { name: 'lg', minWidth: 1024 },
  { name: 'xl', minWidth: 1280 },
  { name: '2xl', minWidth: 1536 },
]

export interface InstanceElement extends BaseElement {
  type: 'instance'
  componentId?: string
  componentName?: string
  /** 展开实例可能携带子元素（普通实例的子元素继承自 Master，渲染时忽略） */
  children?: BaseElement[]
  /** 团队组件库组件的 ukey（mg.importComponentByKeyAsync 的入参），优先于 componentId/componentName 无匹配时使用 */
  componentUkey?: string
  /** 团队库名（可选，配合 componentName 缩小搜索范围） */
  componentLibrary?: string
  /** 组件集 variant 名称片段（可选，如 "Selected"） */
  componentVariant?: string
  isExpandedInstance?: boolean
  overrides?: Record<string, Record<string, string>>
  variantProperties?: Record<string, string>
  /**
   * 换组件目标：已存在于画布上的实例节点 ID 列表。
   * 非空时元素不再创建新实例，而是把这些实例的主组件替换为上面的 component* 指定的组件。
   * HTML 侧对应属性：data-swap-node-id="1:2,3:4"
   */
  swapNodeIds?: string[]
  /** 换组件后保持实例原有宽高（默认 false，采用新组件默认尺寸）。HTML：data-swap-keep-size */
  swapKeepSize?: boolean
  /** 换组件后重置实例的直接覆写（默认 false，保留覆写）。HTML：data-swap-reset-overrides */
  swapResetOverrides?: boolean
  /** 目标不是实例时是否保留原对象（默认 false：原位替换为实例并删除原对象）。HTML：data-swap-keep-original */
  swapKeepOriginal?: boolean
}

export interface ComponentElement extends BaseElement {
  type: 'component'
  children: BaseElement[]
  alias?: string
  description?: string
  cornerRadius?: number
  layoutMode?: 'NONE' | 'VERTICAL' | 'HORIZONTAL' | 'GRID'
  itemSpacing?: number
  paddingTop?: number
  paddingBottom?: number
  paddingLeft?: number
  paddingRight?: number
  clipsContent?: boolean
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX'
  mainAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
  crossAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX'
  counterAxisAlignContent?: 'AUTO' | 'SPACE_BETWEEN'
  flexWrap?: 'NO_WRAP' | 'WRAP'
  crossAxisSpacing?: number
  primaryAxisSizingMode?: 'FIXED' | 'AUTO'
  counterAxisSizingMode?: 'FIXED' | 'AUTO'
}

export interface TemplateRefElement extends BaseElement {
  type: 'template-ref'
  ref: string
  overrides?: Record<string, any>
}

export interface TemplateElement extends BaseElement {
  type: 'template'
  template: 'grid' | 'table' | 'list' | 'form' | 'pagination' | 'carousel'
  config: Record<string, any>
  data?: any[]
}

export interface GeneratorElement extends BaseElement {
  type: 'generator'
  generatorType: string
  config: Record<string, any>
}

export interface TreeData {
  id: string
  label: string
  children?: TreeData[]
  expanded?: boolean
  selected?: boolean
  disabled?: boolean
  icon?: string
  metadata?: Record<string, any>
}

export interface TreeConfig {
  itemHeight?: number
  indentSize?: number
  showIcon?: boolean
  showExpandIcon?: boolean
  expandIconPosition?: 'left' | 'right'
  nodeStyle?: Record<string, any>
  labelStyle?: Record<string, any>
  iconStyle?: Record<string, any>
  expandIconStyle?: Record<string, any>
  lineStyle?: Record<string, any>
  hoverStyle?: Record<string, any>
  selectedStyle?: Record<string, any>
  disabledStyle?: Record<string, any>
}

export interface TreeElement extends BaseElement {
  type: 'tree'
  data: TreeData[]
  config: TreeConfig
}

export interface TableColumn {
  key: string
  label: string
  width?: number
  align?: 'LEFT' | 'CENTER' | 'RIGHT'
  style?: {
    fontSize?: number
    fontWeight?: number
    fills?: Fill[]
    textColor?: string
  }
}

// ───── 文档类型 ─────

export const DEFAULT_DSL_VERSION = '2.0'

export interface DSLDocument {
  version: string
  elements: BaseElement[]
}

// ───── 服务端兼容类型（bag-of-props, 所有字段可选） ─────

export interface DSLElement {
  type: string
  name?: string
  id?: string
  componentId?: string
  componentName?: string
  componentUkey?: string
  componentLibrary?: string
  componentVariant?: string
  variantProperties?: Record<string, string>
  overrides?: Record<string, Record<string, string>>
  swapNodeIds?: string[]
  swapKeepSize?: boolean
  swapResetOverrides?: boolean
  swapKeepOriginal?: boolean
  size?: { width?: number; height?: number }
  position?: { x: number; y: number }
  layoutMode?: 'NONE' | 'VERTICAL' | 'HORIZONTAL'
  flexWrap?: 'NO_WRAP' | 'WRAP'
  itemSpacing?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  mainAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN' | 'SPACE_AROUND'
  crossAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER'
  primaryAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN'
  counterAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER'
  fills?: Array<{ type: string; color?: string; opacity?: number; alpha?: number; isVisible?: boolean; imageUrl?: string; imageScaleMode?: string; gradientStops?: Array<{ position: number; color: string }>; gradientHandlePositions?: Array<{ x: number; y: number }>; blendMode?: string }>
  strokes?: Array<{ type: string; color: string }>
  strokeWidth?: number
  strokeAlign?: string
  strokeCap?: string
  strokeJoin?: string
  cornerRadius?: number
  topLeftRadius?: number
  topRightRadius?: number
  bottomLeftRadius?: number
  bottomRightRadius?: number
  opacity?: number
  rotation?: number
  effects?: Array<{ type: string; color?: string; offset?: { x: number; y: number }; radius?: number; spread?: number; visible?: boolean; blendMode?: string }>
  children?: DSLElement[]
  characters?: string
  content?: string
  fontSize?: number
  fontWeight?: number
  fontName?: { family: string; style: string }
  textAlignHorizontal?: string
  textAlignVertical?: string
  textAutoResize?: string
  lineHeight?: { unit: string; value: number }
  letterSpacing?: number
  textDecoration?: string
  textCase?: string
  paragraphSpacing?: number
  flexGrow?: number
  layoutPositioning?: 'AUTO' | 'ABSOLUTE'
  clipsContent?: boolean
  primaryAxisSizingMode?: 'FIXED' | 'AUTO'
  counterAxisSizingMode?: 'FIXED' | 'AUTO'
  layoutSizingHorizontal?: 'FILL' | 'AUTO' | 'FIXED'
  layoutSizingVertical?: 'FILL' | 'AUTO' | 'FIXED'
  positionFromBottom?: number
  alignSelf?: string
  layoutAlign?: 'STRETCH' | 'INHERIT' | 'MIN' | 'CENTER' | 'MAX'
  svgPathData?: string
  svgContent?: string
  chartOption?: string
  constrainProportions?: boolean
  isVisible?: boolean
  generatorType?: string
  template?: string
  config?: Record<string, any>
  data?: Record<string, any>[]
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  crossAxisSpacing?: number
  primaryAxisAlignContent?: string
  counterAxisAlignContent?: string
  pathData?: string | any[]
  isClosed?: boolean
  attributes?: Record<string, string>
  constraints?: Constraints
  blendMode?: string
  windingRule?: string
}
