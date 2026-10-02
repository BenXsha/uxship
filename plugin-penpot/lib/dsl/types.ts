/**
 * DSL 类型（Penpot 侧子集）
 *
 * 权威定义在 MasterGo 侧：`mcp-server/src/dsl-types.ts` +
 * `skills/design/rules/08-dsl-specification.md`。
 *
 * 这里**只声明 Penpot 适配器需要处理的字段，并保持字段名逐字一致** —— 字段名一致是
 * 「同一份 DSL 能落到两个宿主」的前提；类型收窄只影响类型检查，不影响运行时兼容
 * （多余字段会被 HostAdapter 的 `applyProperties` 归入 skipped，不会静默丢弃）。
 *
 * ⚠️ 命名差异备忘（来自 MasterGo dsl-types.ts）：
 *   - 文本内容是 `content`（不是 `characters`）
 *   - 位置是 `position: {x, y}`，尺寸是 `size: {width, height}`
 *   - 可见性/锁定是 `isVisible` / `isLocked`
 *   - 单边描边是 `strokeTopWeight` / `strokeRightWeight` / `strokeBottomWeight` / `strokeLeftWeight`
 */

export type DSLElementType =
  | 'frame'
  | 'group'
  | 'rectangle'
  | 'ellipse'
  | 'text'
  | 'svg'
  | 'pen'
  | 'path'
  | 'polygon'
  | 'star'
  | 'line'
  | 'component'
  | 'instance'
  | 'boolean_operation'
  | 'template'
  | 'generator'
  | 'tree'
  | 'connector'

/** 客户端渲染引擎会往 DSL 文档上挂旁路元数据（如未解析的 Tailwind class）—— 本文件只描述 DSL 本体，
 *  旁路元数据不在此声明 */

/**
 * 富文本的一个 run（P2-3）。同一 `content` 上按顺序拼接，渲染末端逐段上样式（字号/字重/字距/颜色）。
 * 只收「能准确落到 Penpot `TextRange`」的字段；整段级别的字体族/行高等仍走元素本体。
 */
export interface TextRun {
  text: string
  fontSize?: number
  fontWeight?: number
  /** 十六进制颜色（如 `#FF6B35`）—— 落到 range.fills */
  color?: string
  letterSpacing?: number
}

export interface DSLPosition {
  x?: number
  y?: number
}

export interface DSLSize {
  width?: number
  height?: number
}

export interface DSLFill {
  /**
   * 类型。**同时接受两种命名体系**：客户端渲染引擎的 `solid`/`gradient_linear`
   * 与本项目 DSL 的 `SOLID`/`GRADIENT_LINEAR` —— 归一在 `host/gradient.ts` 做一次。
   */
  type?: string
  /** 颜色（hex / rgb() / `{r,g,b,a}` 对象，见 host/color.ts） */
  color?: unknown
  opacity?: number
  /** 引擎产物：与 opacity 同义，后者优先 */
  alpha?: number
  visible?: boolean
  /** 引擎产物：与 visible 同义，任一为 false 即隐藏 */
  isVisible?: boolean
  blendMode?: string
  gradientStops?: { position?: number; offset?: number; color?: unknown }[]
  stops?: { position?: number; offset?: number; color?: unknown }[]
  /** 归一化 0–1 的渐起/终点（相对形状包围盒） */
  gradientHandlePositions?: { x?: number; y?: number }[]
  /** 径向椭圆的缩放矩阵；`transform[0][0]` = rx / r */
  transform?: number[][]
  imageUrl?: string
  imageData?: string
  imageScaleMode?: 'FILL' | 'FIT' | 'CROP' | 'TILE'
}

export interface DSLStroke {
  /** 同 fill.type：`solid` 或 `gradient_linear` 等（大小写不限） */
  type?: string
  color?: unknown
  width?: number
  opacity?: number
  alpha?: number
  visible?: boolean
  isVisible?: boolean
  align?: 'INSIDE' | 'OUTSIDE' | 'CENTER'
  dashPattern?: number[]
  /** 渐变描边（Penpot 侧落到 strokeColorGradient） */
  gradientStops?: { position?: number; offset?: number; color?: unknown }[]
  gradientHandlePositions?: { x?: number; y?: number }[]
  transform?: number[][]
}

export interface DSLEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR' | string
  offset?: { x?: number; y?: number }
  radius?: number
  spread?: number
  /** 颜色（同样接受 rgb 对象） */
  color?: unknown
  visible?: boolean
  isVisible?: boolean
}

export interface DSLElement {
  type: DSLElementType | string
  name: string
  id?: string

  isVisible?: boolean
  isLocked?: boolean
  position?: DSLPosition
  size?: DSLSize
  rotation?: number

  cornerRadius?: number
  topLeftRadius?: number
  topRightRadius?: number
  bottomLeftRadius?: number
  bottomRightRadius?: number
  fills?: DSLFill[]
  strokes?: DSLStroke[]
  strokeWidth?: number
  /** 客户端渲染引擎的写法（与 strokeWidth 同义） */
  strokeWeight?: number
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER'
  /**
   * 线帽（**元素级单值**，MasterGo 语义）：`NONE` / `ROUND` / `SQUARE` / `ARROW_EQUILATERAL` / `LINE_ARROW` / `ROUND_ARROW`。
   *
   * 来源：客户端渲染的 `svg-extractor`（CSS `stroke-linecap` 与 SVG `marker-*`）。
   * Penpot 的 stroke 模型是「起点帽 + 终点帽」两个成员，**两端怎么给由宿主层决定**（见 `host/penpot-paint.ts`）。
   */
  strokeCap?: string
  /** 拐角连接（`MITER` / `ROUND` / `BEVEL`）。Penpot 的 stroke 模型**没有**该成员 → 由宿主如实上报降级。 */
  strokeJoin?: string
  /** 节点级图片（<img src>） */
  imageUrl?: string
  imageScaleMode?: string
  blendMode?: string
  layoutPositioning?: 'AUTO' | 'ABSOLUTE'
  strokeTopWeight?: number
  strokeRightWeight?: number
  strokeBottomWeight?: number
  strokeLeftWeight?: number
  effects?: DSLEffect[]
  opacity?: number

  // 自动布局（frame / component）
  children?: DSLElement[]
  layoutMode?: 'NONE' | 'VERTICAL' | 'HORIZONTAL' | 'GRID'
  itemSpacing?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX'
  /** 子元素在主轴上的伸缩（MasterGo 的 flexGrow 语义） */
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'AUTO' | 'FILL'
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'AUTO' | 'FILL'
  /** 容器自身的尺寸模式 */
  primaryAxisSizingMode?: 'FIXED' | 'AUTO'
  counterAxisSizingMode?: 'FIXED' | 'AUTO'
  flexWrap?: 'NO_WRAP' | 'WRAP'
  flexGrow?: 0 | 1
  clipsContent?: boolean
  /**
   * 声明式令牌绑定（来自 `data-token-<property>`，如 `data-token-fill="system.color.primary"`）。
   * 渲染管线在**结构与属性全部落完之后**统一绑定（宿主"直接写属性即解绑"）。
   */
  tokenBindings?: Record<string, string>

  // 文本
  content?: string
  fontSize?: number
  fontWeight?: number
  fontName?: { family: string; style?: string }
  lineHeight?: number | { unit: 'PIXELS' | 'PERCENT' | 'AUTO'; value?: number }
  letterSpacing?: number | { unit?: string; value?: number }
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM'
  textAutoResize?: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE'
  /**
   * 多 run 富文本（P2-3）。给出时 `content` 应等于各 run `text` 的拼接；
   * 渲染末端用 `text.getRange(start,end)` 逐段上样式（字号/字重/字距/颜色）。
   */
  runs?: TextRun[]

  // 组件实例（MasterGo 侧 dsl-exporter.ts 用同一组字段名）
  /** 母版组件 id（导出实例时写入；渲染时用它重新实例化） */
  componentId?: string
  componentName?: string
  /** 母版是否在本文件内（拿不到该信息时省略，不猜） */
  isLocalMaster?: boolean
  /**
   * 实例已展开成真实子节点树（MasterGo 导出器的约定）。
   * 导出实例时写 `type: 'frame'` + 本标记 + `componentId`：这样导出的树**逐字可再渲染**，
   * 不依赖目标文档里还有这个组件。
   */
  isExpandedInstance?: boolean

  // SVG / 矢量
  svgContent?: string
  svgPathData?: string
  /** `polygon` / `star` 的顶点数（几何由宿主生成） */
  pointCount?: number
  /** `star` 的内半径比例（0–1） */
  innerRadius?: number
}

export interface DSLDocument {
  version?: string
  elements: DSLElement[]
}
