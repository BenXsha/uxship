/**
 * HostAdapter —— 宿主端口（六边形架构的「被驱动端」）
 *
 * 设计动机
 * ---------------------------------------------------------------
 * plugin-mastergo 的全部宿主耦合只收敛在少数几个点（见分析报告 §12.3）：
 *   - `utils/node-utils.ts`  → createNodeByType + applyNodeProperties / applyFills / applyStrokes / applyEffects
 *   - `api/component-utils.ts` → makeNode / serializeNode / renderSvgIcon
 *   - `api/dsl-renderer.ts`  → 每类 DSL 元素的创建
 *   - 各 handler 里的直调
 * 本接口把这几点固化为显式契约，于是「新增一个宿主」= 新增一个实现，而不是 fork 一份代码。
 *
 * 三条设计原则
 * ---------------------------------------------------------------
 * 1. **DSL 是 IR，宿主命名只活在实现里**
 *    属性包的字段名沿用本项目 DSL 的既有命名（`layoutMode` / `itemSpacing` /
 *    `primaryAxisAlignItems`…），因为 DSL 已经是跨宿主的中介表示。翻译成 Penpot 的
 *    `flex.dir` / `rowGap` / `justifyContent` 是 PenpotAdapter 的职责。
 * 2. **不支持的能力要显式报错，不要静默丢弃**
 *    `applyProperties` 返回 `ApplyResult`，把每条未能应用的属性连原因一起交回。
 *    调用方（服务端 / AI）据此知道设计稿在哪一处降级了 —— 静默丢属性是最坏结果。
 * 3. **变异操作一律 async**
 *    Penpot 多数变异是同步的，但 `openPage` / `uploadMediaUrl` / `waitForLayoutUpdate`
 *    是异步；MasterGo 侧同样有 `createNodeFromSvgAsync` / `loadFontAsync` / `createImage`。
 *    统一 async 避免后续改签名（调用方已有 await 心智）。
 */

// ═══════════════════════════════════════════════════════════
// 节点
// ═══════════════════════════════════════════════════════════

/**
 * 节点句柄。
 *
 * 刻意做成**结构化**接口：宿主原生形状对象（Penpot 的 `PenpotShape`、MasterGo 的 `SceneNode`）
 * 天然带 `id` 与 `type`，可直接被当作 `HostNode` 使用，无需包装层。
 * handler 只应通过 `HostAdapter` 操作它，**不要**伸手去摸宿主私有字段 —— 那是移植性泄漏点。
 */
export interface HostNode {
  readonly id: string
  readonly type: string
  /** 节点名（图层名）。语义化命名是本项目的硬要求（对应 HTML 的 `data-name`）。 */
  name?: string
}

/** 本项目目前会创建的节点种类。未实现的 kind 由 capabilities 声明。 */
export type NodeKind =
  | 'frame'
  | 'rectangle'
  | 'ellipse'
  | 'text'
  | 'svg'
  | 'group'
  | 'path'
  /** 钢笔路径（DSL 的 `pen`，与 `path` 同义；两者都落到宿主的 Path） */
  | 'pen'
  | 'polygon'
  | 'star'
  | 'line'
  | 'component'
  | 'instance'
  | 'boolean'
  | 'section'
  | 'slice'
  | 'connector'

/** 创建节点的最小规格；其余样式一律走 `applyProperties`。 */
export interface NodeSpec {
  kind: NodeKind
  /** 图层名（语义化，勿用 div_3 / frame_7） */
  name?: string
  x?: number
  y?: number
  /**
   * `x`/`y` 的语义：false/未传 = **页面绝对坐标**（DSL 里 `position` 的实测值就是绝对坐标）；
   * true = **相对父层**的偏移（宿主会加上父层结算后的绝对位置）。
   *
   * 为什么必须显式区分：Penpot 的 `shape.x/y` 是页面绝对坐标，而「把图标放进内容区」
   * 这类场景想表达的是「相对父层 (paddingLeft, paddingTop)」。按绝对坐标传 (0,0) 会让
   * 子节点跑到页面原点，父层一动就错位（实测踩到）。
   */
  relativeToParent?: boolean
  width?: number
  height?: number
  /** kind === 'text' 时的初始文本 */
  characters?: string
  /** kind === 'svg' 时的 SVG 源码 */
  svgContent?: string
  /** kind === 'polygon' | 'star' 时的顶点数（几何由宿主生成，不需要外部给 path data） */
  pointCount?: number
  /** kind === 'star' 时的内半径比例（0–1） */
  innerRadius?: number
  /** kind === 'pen' | 'path' 时的路径数据（string 直接可用；本机命令数组需转换） */
  pathData?: string
  /** kind === 'instance' 时的主组件 id（宿主内组件） */
  componentId?: string
  /** kind === 'boolean' 时的布尔运算类型 */
  booleanOperation?: 'UNION' | 'SUBTRACT' | 'INTERSECT' | 'EXCLUDE'
}

// ═══════════════════════════════════════════════════════════
// 属性包（DSL 命名）
// ═══════════════════════════════════════════════════════════

export interface GradientStop {
  /** 0–1 */
  position: number
  /**
   * 颜色。**四种形态全部要接受**（见 `host/color.ts`）：
   * `{r,g,b,a}`（客户端渲染引擎）、`#RRGGBB[AA]`、`rgb()/rgba()`、具名色。
   * 只认 hex 会让 HTML 链路的**每一个颜色**都变成 `[object Object]`。
   */
  color: unknown
}

/** 渐变描述。字段名同时兼容引擎（小写 + `gradientStops`）与 DSL（大写 + `stops`） */
export interface HostGradient {
  /**
   * 填充/描边类型。可为 `SOLID` / `gradient_linear` / `GRADIENT_RADIAL` / `IMAGE` … ——
   * 大小写与连接方式不一，统一由 `host/gradient.ts#normalizeFillType` 归一。
   * 缺省时按「有 color 则 SOLID」处理。
   */
  type?: string
  gradientStops?: GradientStop[]
  /** `gradientStops` 的别名（部分 DSL 导出用 stops） */
  stops?: GradientStop[]
  /** 归一化 0–1 渐变的起/终点，相对形状包围盒（Figma/引擎语义） */
  gradientHandlePositions?: { x: number; y: number }[]
  /** 引擎的径向椭圆比例矩阵；`transform[0][0]` = rx / r → Penpot 的 `width` */
  transform?: number[][]
}

/** Penpot 的图片贴合模式 */
export type ImageScaleMode = 'FILL' | 'FIT' | 'CROP' | 'TILE'

/**
 * 填充。
 *
 * 刻意用**扁平接口**而不是判别联合：真实数据里 `type` 有多种大小写甚至缺失，
 * 判别联合会把「运行时的宽容」伪装成「编译期的严谨」，最后必现一堆收窄失败。
 * 分类统一走 `normalizeFillType()`。
 */
export interface HostFill extends HostGradient {
  color?: unknown
  /** 远程图片地址（Penpot 侧需 uploadMediaUrl 换 ImageData） */
  imageUrl?: string
  /** base64 图片数据（优先于 imageUrl） */
  imageData?: string
  mimeType?: string
  imageScaleMode?: ImageScaleMode
  opacity?: number
  /** 引擎产物：与 `opacity` 同义，后者优先 */
  alpha?: number
  visible?: boolean
  /** 引擎产物：与 `visible` 同义，任一为 false 即视为隐藏 */
  isVisible?: boolean
  blendMode?: string
}

/** 单边描边：`sides` 是本项目有、而 Penpot 原生没有的能力（分析报告 §12.5） */
export type StrokeSide = 'top' | 'right' | 'bottom' | 'left'

/**
 * 描边。
 *
 * 继承 `HostGradient`，所以**渐变描边**直接用 `type: 'GRADIENT_LINEAR' +
 * gradientStops + gradientHandlePositions` 表达，映射到 Penpot 的 `strokeColorGradient`。
 */
export interface HostStroke extends HostGradient {
  color?: unknown
  width?: number
  opacity?: number
  alpha?: number
  align?: 'INSIDE' | 'OUTSIDE' | 'CENTER'
  /**
   * 缺省表示四边。传单边时宿主若不支持，必须在 `ApplyResult.skipped` 里报告，
   * 由上层决定降级策略（当前约定：Penpot 侧按整圈落地并如实报告）。
   */
  sides?: StrokeSide[]
  dashPattern?: number[]
  /**
   * Penpot 的虚线样式（'solid' | 'dashed' | 'dotted' | …）。
   *
   * 与 `dashPattern` 是两套表达：DSL 用线段长度数组，Penpot 用样式名。
   * 读回来时若只有样式名（Penpot 不给数字数组），写入侧也要认它 —— 否则
   * 虚线描边往返一次就退化成实线。
   */
  strokeStyle?: 'solid' | 'dashed' | 'dotted' | 'mixed' | 'none' | 'svg'
  visible?: boolean
  isVisible?: boolean
  /**
   * 线帽（**DSL 口径**：`NONE` / `ROUND` / `SQUARE` / `ARROW_EQUILATERAL` / `LINE_ARROW` / `ROUND_ARROW`）。
   *
   * 为何放在 HostStroke 上：DSL 的 `strokeCap` 是**元素级单值**，渲染器把它落到每条描边上，
   * 而 Penpot 的 stroke 模型是「起点帽 + 终点帽」两个成员 —— 这一步映射由**宿主层**做，
   * 映射不了的值也由宿主层如实进 `ApplyResult.skipped`（约定：宁可报降级，不要静默）。
   */
  capStart?: string
  capEnd?: string
  /** 拐角连接（`MITER` / `ROUND` / `BEVEL`）。Penpot 的 stroke 模型**没有** line-join 成员 → 映射不了要上报。 */
  join?: string
}

export interface HostEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR'
  offset?: { x: number; y: number }
  radius?: number
  spread?: number
  /** 颜色：同样接受四种形态 */
  color?: unknown
  visible?: boolean
  isVisible?: boolean
}

export interface FontName {
  family: string
  /** Regular / Medium / SemiBold / Bold … */
  style?: string
}

export type LayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL'
export type PrimaryAxisAlign = 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
export type CounterAxisAlign = 'MIN' | 'CENTER' | 'MAX'
/** `AUTO` 是客户端渲染引擎的写法（= 内容自适应），与 `HUG` 同义 */
export type SizingMode = 'FIXED' | 'HUG' | 'AUTO' | 'FILL'

/**
 * 宿主无关的属性包。
 *
 * 每个字段的「能否应用」由宿主能力决定；无法应用时进 `ApplyResult.skipped`，不抛错。
 */
export interface NodeProperties {
  name?: string

  // ── 几何 ──
  x?: number
  y?: number
  /**
   * 宽高。宿主侧通常只能通过 `resize(w,h)` 设置（宽高是只读属性），
   * 因此本字段是**命令**而不是可回读状态，回读请用 `readProperties(['width','height'])`。
   */
  width?: number
  height?: number
  rotation?: number

  // ── 外观 ──
  opacity?: number
  visible?: boolean
  locked?: boolean
  cornerRadius?: number
  /** 分角圆角（Penpot 原生支持 borderRadiusTopLeft 等四个成员） */
  topLeftRadius?: number
  topRightRadius?: number
  bottomLeftRadius?: number
  bottomRightRadius?: number
  /**
   * 节点级图片（`<img src>` 的产物）。
   * 宿主需自己把 URL 变成可用的图片数据（Penpot：`uploadMediaUrl`），
   * 失败必须进 skipped —— 不能默默变成一个空框。
   */
  imageUrl?: string
  imageScaleMode?: 'FILL' | 'FIT' | 'CROP' | 'TILE'
  fills?: HostFill[]
  strokes?: HostStroke[]
  strokeWidth?: number
  /** 描边对齐（客户端渲染引擎的 strokeAlign） */
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER'
  effects?: HostEffect[]
  blendMode?: string

  // ── 自动布局 ──
  layoutMode?: LayoutMode
  itemSpacing?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  primaryAxisAlignItems?: PrimaryAxisAlign
  counterAxisAlignItems?: CounterAxisAlign
  layoutSizingHorizontal?: SizingMode
  layoutSizingVertical?: SizingMode
  /** 在 flex/grid 父层中脱离布局流（`position:absolute` 的产物） */
  layoutPositioning?: 'AUTO' | 'ABSOLUTE'
  flexWrap?: 'NO_WRAP' | 'WRAP'
  /** 容器自身的尺寸模式（主轴 / 交叉轴） */
  primaryAxisSizingMode?: 'FIXED' | 'AUTO'
  counterAxisSizingMode?: 'FIXED' | 'AUTO'

  // ── 文本 ──
  characters?: string
  fontSize?: number
  fontName?: FontName
  fontWeight?: number
  lineHeight?: { value: number; unit: 'PIXELS' | 'PERCENT' | 'AUTO' }
  letterSpacing?: { value: number; unit: 'PIXELS' | 'PERCENT' }
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM'
  textAutoResize?: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE'

  // ── 容器 ──
  clipsContent?: boolean
}

/** 单条未能应用的属性说明 */
export interface PropertySkip {
  property: string
  reason: string
}

/** `applyProperties` 的结果。`skipped` 非空即表示设计在这一处降级了。 */
export interface ApplyResult {
  applied: string[]
  skipped: PropertySkip[]
}

// ═══════════════════════════════════════════════════════════
// 文档 / 页面 / 选区
// ═══════════════════════════════════════════════════════════

export interface HostPageInfo {
  id: string
  name: string
}

export interface HostDocumentInfo {
  /** 宿主 id：'penpot' | 'mastergo' | 'memory' */
  host: HostId
  /**
   * 会话代号（多实例时用于区分「在操作哪一个插件实例」）。
   *
   * 两个宿主都**按文档/客户端持久化**（Penpot：`localStorage`；MasterGo：`clientStorage`），
   * 由 `getDocumentCodename()` 提供 —— 见该方法的说明。
   */
  codename?: string
  /** 文档/文件 id（可能为空：memory 宿主没有真实文档） */
  documentId?: string
  documentName?: string
  pageId?: string
  pageName?: string
  /** 宿主版本号（用于版本兼容判断） */
  hostVersion?: string
  pluginVersion?: string
}

// ═══════════════════════════════════════════════════════════
// 能力探测
// ═══════════════════════════════════════════════════════════

export type HostId = 'penpot' | 'mastergo' | 'memory'

/**
 * 宿主能力清单。
 *
 * 对应 MasterGo 侧已有的 `plugin_capabilities` 机制 —— 它解决的是同一个问题：
 * **宿主的 API 集合随版本漂移，工具层必须按运行时实际可用性决定暴露什么**。
 * 声明为 false 的能力，其对应 handler 应直接返回 `available:false` 而不是报错。
 */
export interface HostCapabilities {
  host: HostId
  /** 支持创建的节点种类 */
  nodeKinds: NodeKind[]
  props: {
    fills: boolean
    /** 单边描边（Penpot 无原生支持） */
    perSideStrokes: boolean
    gradients: boolean
    imageFills: boolean
    /** 能否把**远程 URL** 拉成图片数据（Penpot：uploadMediaUrl） */
    imageFromUrl: boolean
    effects: boolean
    /** 背景模糊（与图层模糊分开控制的宿主为 true） */
    backgroundBlur: boolean
    autoLayout: boolean
    gridLayout: boolean
    textAutoResize: boolean
    /** 变量/令牌能否**绑定**到节点属性（Penpot: applyToken） */
    tokenBinding: boolean
  }
  ops: {
    createComponent: boolean
    componentInstances: boolean
    componentVariants: boolean
    /**
     * 能否**换主组件**（Penpot：`shape.swapComponent(component)`）。
     *
     * 这条能力位的存在本身是个教训：我一度断言"Penpot 没有换主组件的写入路径"，
     * 于是手写了一整套合成实现（建实例→插回原位→继承→删旧）。而官方 api.yml 里写着
     *   `swapComponent(component: LibraryComponent): void`
     *   "Swaps the component instance for another component, keeping the overrides when
     *    possible. Similar to the "swap component" action on the Penpot interface."
     * 现在合成实现退化为**旧宿主/非实例**的兜底。
     */
    swapComponent: boolean
    /** 对象之间的对齐 / 等距分布（Penpot：`alignHorizontal` 等四个方法） */
    alignNodes: boolean
    teamLibrary: boolean
    booleanOps: boolean
    exportImage: boolean
    svgImport: boolean
    group: boolean
    /**
     * 插件 UI iframe 是否可用 —— 决定「浏览器真实渲染 → 实测像素」这条
     * 像素精度链路能否落到该宿主（分析报告 §11.3 / §12.7）。
     */
    renderUiIframe: boolean
    /**
     * 子节点顺序是否为 Figma 语义（追加=末尾、children=自然顺序）。
     * Penpot 需显式打开 `naturalChildOrdering` flag 才是；关了会出现
     * 「非 flex 容器追加反而插到最前」「flex 容器 children 读出来是反的」。
     */
    naturalChildOrdering: boolean
    /**
     * 宿主的 `page.findShapes()` 是否**真能列出本页形状** —— 运行时功能性探测，
     * 不是只看方法存不存在（社区反馈它可能恒返回 `[]`）。
     * 真时全页搜索/令牌传播走宿主 API；假时退回手写递归。
     */
    findShapes: boolean
    /** 宿主原生 CSS 生成（Penpot：`generateStyle` + `generateFontFaces`） */
    generateCss: boolean
  }
}

// ═══════════════════════════════════════════════════════════
// 宿主端口
// ═══════════════════════════════════════════════════════════

export type NotifyKind = 'info' | 'normal' | 'warning' | 'error' | 'success'

export interface FontRequest {
  family: string
  style?: string
}

/** 布尔运算类型（DSL 与 Penpot 的命名不同，由实现负责换算） */
export type BooleanOperation = 'UNION' | 'SUBTRACT' | 'INTERSECT' | 'EXCLUDE'

/** 导出格式（工具层用大写，宿主用各自的小写枚举） */
export type ExportFormat = 'PNG' | 'JPG' | 'WEBP' | 'SVG' | 'PDF'

export interface ExportOptions {
  format: ExportFormat
  /** 缩放倍率（固定宽高约束会被换算成缩放） */
  scale?: number
  /** 固定宽/高约束（宿主无此概念时由实现换算为 scale，并如实说明） */
  width?: number
  height?: number
}

export interface ExportResult {
  /** 实际使用的格式（宿主命名，如 jpeg） */
  format: string
  mimeType: string
  /** 文本格式（SVG）时 `data` 是源码而非 base64 */
  isText: boolean
  /**
   * 裸数据：文本格式（SVG）为源码；栅格格式为**裸 base64**（不带 `data:` 前缀）。
   *
   * ⚠️ 注意：这是**宿主层**的口径。服务端的 `image-export.ts` 要求栅格给 `data:` URI
   * （`result.data.startsWith('data:')`，否则报 "Unexpected data format"），
   * 所以带前缀这件事在 **handler 层**（`api/exportHandlers.ts`）做 —— 契约适配属于边界。
   */
  data: string
  /** 实际生效的缩放 */
  scale: number
  /** 降级/换算说明（非空即表示用了近似手段） */
  notes: string[]
}

/**
 * 设计令牌（Penpot：`library.local.tokens`）。
 *
 * ⚠️ 与 MasterGo 的变量模型**不同**，实现方必须把这些差异如实带出来：
 *   - Penpot 用 `TokenSet`（集合）+ `TokenTheme`（主题＝激活哪些集合），**没有"变量多模式取值"**；
 *     因此归一化时把值放进一个 `default` 伪模式，并用 `model: 'penpot-tokens'` 标明；
 *   - `TokenType` 是 Penpot 自己的词表（color/spacing/typography/…），与 MasterGo 的
 *     COLOR/NUMBER/… 不同名 → 归一化时给出近似映射 + 原始类型；
 *   - Penpot 的 `token.applyToShapes()` 是**真绑定**（改令牌全稿联动），这是 MasterGo 侧当前缺的能力。
 */
export interface HostToken {
  id: string
  name: string
  /** 宿主原始类型（Penpot：color/dimension/spacing/typography/…） */
  hostType: string
  /** 令牌值（可能是 `{color.primary}` 这类引用） */
  value?: string
  description?: string
  resolvedValue?: string
}

export interface HostTokenSet {
  id: string
  name: string
  active: boolean
  tokens: HostToken[]
}

/** 样式资产（颜色样式 / 文本样式） */
export interface HostColorStyle {
  id: string
  name: string
  path?: string
  libraryId?: string
  /** 所属库名（团队库辨识用；与 HostComponentInfo 口径一致） */
  libraryName?: string
  isLocal?: boolean
  /** 归一化后的色值 */
  color?: string
  opacity?: number
  /** 渐变样式（Penpot 的 LibraryColor 也可能带 gradient） */
  gradient?: unknown
}

export interface HostTextStyle {
  id: string
  name: string
  path?: string
  libraryId?: string
  /** 所属库名（团队库辨识用） */
  libraryName?: string
  isLocal?: boolean
  fontFamily?: string
  fontSize?: string
  fontWeight?: string
  lineHeight?: string
  letterSpacing?: string
}

/**
 * 富文本的一个 run（宿主端口，与 DSL `TextRun` 同形）。
 * 渲染：先整体写 `characters`，再按顺序切 `[start,end)` 逐段上样式。
 */
export interface HostTextRun {
  text: string
  fontSize?: number
  fontWeight?: number
  /** 十六进制颜色（落到 `TextRange.fills`） */
  color?: string
  letterSpacing?: number
}

/**
 * `createVariants` 的可选参数。
 *
 * 存在的意义：`node/convertToComponent` 的 `variantGroups` 形态要求合成后的变体集
 * **叫 `setId`**（如 `DS_Button`），而容器名只有宿主侧拿得到（handler 里没有形状句柄）——
 * 所以把「改名 + 回读校验」做在原语内部，而不是让 handler 猜。
 */
export interface CreateVariantsOptions {
  /** 变体容器的名字（Penpot 的 VariantContainer 是 board 子类型，`name` 应可写） */
  containerName?: string
  /**
   * 多属性轴（Penpot 原生支持；提供时忽略 `propertyName`/`values` 单轴参数）。
   * 每个轴的名字 + 与 `nodes` 一一对应的轴值。
   */
  axes?: readonly VariantAxis[]
}

/** 一个变体属性轴：名字 + 与 `nodes` 顺序一一对应的轴值 */
export interface VariantAxis {
  name: string
  values: readonly string[]
}

export interface CreateVariantsResult {
  ok: boolean
  containerId?: string
  componentIds?: string[]
  /**
   * 容器**实际**的名字（回读值）。与请求的 `containerName` 不一致即表示改名未生效 ——
   * 调用方必须如实带出这个差异，而不是假定改名成功了。
   */
  containerName?: string
  /** 回读的属性轴名（`Variants.properties`）—— 真机证据，确认实际生成了几个轴 */
  properties?: string[]
  /** 回读的每个变体实际轴值（按 component id）—— 确认 `setVariantProperty` 真的落到宿主 */
  variantValues?: Record<string, Record<string, string>>
  reason?: string
  note?: string
}

/** 组件（本文件库或已连接的团队库） */
export interface HostComponentInfo {
  id: string
  name: string
  /** 库内路径（Penpot 的 component.path） */
  path?: string
  libraryId?: string
  libraryName?: string
  isVariant?: boolean
  /** 是否来自本文件（false = 团队库/外部库） */
  isLocal?: boolean
  /**
   * 母版形状的节点 id（Penpot：`component.mainInstance().id`）。
   * 用于判断"某个节点是不是组件母版" —— 换组件时被替换对象若是母版必须拒绝。
   */
  masterNodeId?: string
}

/** 库的极小标识（用于连接/列举的回执，不带 components 等重字段） */
export interface HostLibraryRef {
  id: string
  name: string
}

/**
 * 团队库连接状态（`HostAdapter.connectTeamLibraries` 的结果）。
 *
 * 为什么把“没连上”的每种原因分开：
 *   - `supported:false` = 宿主旧/没这个 API（该改手动连）；
 *   - `candidates` 有值但没命中 = 名字写错（该改用其中某个）；
 *   - `failed` = 名字对、宿主拒了（该看错误文本）。
 * 三种给 AI 的下一步完全不同，合成一句“团队库不可用”就白费了。
 */
export interface TeamLibraryConnectionInfo {
  /** 当前可用（本文件库 + 已连接）的库 */
  connected: HostLibraryRef[]
  /** 本次新连上的库 */
  newlyConnected: HostLibraryRef[]
  /** 宿主是否具备“列出可连库 + 连接”的能力 */
  supported: boolean
  /** 没连上时的原因（能力缺失 / 名字没命中 / 连接抛错） */
  reason?: string
  /** `availableLibraries()` 的返回值 —— 给“可连的库有这些”提示 */
  candidates?: HostLibraryRef[]
  /** 本次尝试连接但失败（抛错）的库 */
  failed?: (HostLibraryRef & { error: string })[]
}

/** 宿主可用字体（fonts/list 用） */
export interface HostFontInfo {
  family: string
  /** 变体名，如 Regular / SemiBold / Bold */
  style?: string
  fontWeight?: string
}

/**
 * 宿主端口。所有 handler 与渲染器只依赖本接口。
 *
 * 同步/异步标注即契约：标 `Promise` 的必须在宿主侧 await 完成后才 resolve，
 * 否则 DSL 渲染会出现「先读几何再等布局」的竞态。
 */
export interface HostAdapter {
  readonly id: HostId

  /** 探测宿主能力（启动时调用一次，结果可缓存） */
  getCapabilities(): HostCapabilities

  /** 装载（注册事件、初始化缓存）。幂等。 */
  init(): Promise<void>

  // ── 生命周期 ──

  /** 创建节点；`spec.parentId` 优先于 `parent` 参数 */
  createNode(spec: NodeSpec, parent?: HostNode | null): Promise<HostNode>
  getNodeById(id: string): HostNode | null
  removeNode(node: HostNode): Promise<void>
  cloneNode(node: HostNode): Promise<HostNode>
  /** 追加子节点。`index` 缺省表示追加到末尾（注意宿主差异：Penpot 用 insertChild，appendChild 在 board 上有已知问题） */
  appendChild(parent: HostNode, child: HostNode, index?: number): Promise<void>
  setParentIndex(node: HostNode, index: number): Promise<void>
  group(nodes: HostNode[]): Promise<HostNode>

  // ── 属性 ──

  /** 批量应用属性；逐条判定，不可应用者进 `skipped` */
  applyProperties(node: HostNode, props: NodeProperties): Promise<ApplyResult>
  /** 回读属性（用于渲染后校验「是否真的生效」） */
  readProperties(node: HostNode, fields: readonly string[]): Record<string, unknown>

  // ── 资源 ──

  loadFonts(requests: readonly FontRequest[]): Promise<void>
  /** 列出宿主可用字体（对应插件方法 fonts/list） */
  listFonts(): Promise<HostFontInfo[]>
  /** 导出节点为图片/文本（对应插件方法 node/exportImage） */
  exportNode(node: HostNode, options: ExportOptions): Promise<ExportResult>

  // ── 组合与组件 ──

  /** 布尔运算（对应插件方法 node/boolean） */
  booleanOperation(nodes: readonly HostNode[], operation: BooleanOperation): Promise<HostNode>
  /**
   * 把若干节点转成组件母版（对应插件方法 node/convertToComponent）。
   * 返回母版形状与组件 id —— 后续 `component/list` 能查到它。
   */
  createComponent(nodes: readonly HostNode[], name?: string): Promise<{ componentId: string; nodeId: string; name: string }>
  /**
   * 换主组件（对应 `node/swapComponent` 的底层原语）。
   *
   * Penpot：`shape.swapComponent(component)` —— 要求当前形状**是组件副本实例**，
   * 且宿主会"尽可能保留覆写"。旧宿主没有这个方法时由调用方回退到合成实现。
   */
  swapComponent?(node: HostNode, input: {
    componentId?: string
    componentName?: string
    libraryName?: string
  }): Promise<{ componentId: string; componentName: string }>

  /**
   * **对象之间**对齐（不是容器内对齐 —— 后者是 flex 的 primary/counterAxisAlignItems）。
   *
   * Penpot：`alignHorizontal(shapes, 'left'|'center'|'right')` /
   * `alignVertical(shapes, 'top'|'center'|'bottom')`
   * （官方原文：*"Aligning will move all the selected layers to a position relative to one of
   * them in the horizontal direction."*）
   */
  alignNodes?(nodes: readonly HostNode[], input: { axis: 'HORIZONTAL' | 'VERTICAL'; direction: 'MIN' | 'CENTER' | 'MAX' }): Promise<void>

  /**
   * **对象之间**等距分布。Penpot：`distributeHorizontal/Vertical(shapes)`
   * （官方原文：*"position them horizontally with equal distances between them"*）。
   */
  distributeNodes?(nodes: readonly HostNode[], input: { axis: 'HORIZONTAL' | 'VERTICAL' }): Promise<void>

  /** 清空实例覆写（Penpot：`shape.resetOverrides()`）。`carryOverOverrides: false` 时用 */
  resetOverrides?(node: HostNode): Promise<void>

  /**
   * 把一段操作包进**一个撤销块**（Penpot：`penpot.history.undoBlockBegin/Finish`）。
   *
   * 为什么需要：`dsl/render` 一次会创建几十个节点，宿主默认是"一个操作一步撤销" ——
   * 用户渲完一页想撤掉，得按几十次 Ctrl+Z。包成一个块之后一次撤掉。
   * 宿主没有 history 时不报错，交给 `onUnsupported` 说明（这属于体验优化，不该让渲染失败）。
   */
  withUndoBlock?<T>(label: string, run: () => Promise<T>): Promise<T>

  /** 分离实例（断开与母版的链接），对应插件方法 node/detachInstance */
  detachInstance(node: HostNode): Promise<{ detached: boolean; note?: string }>
  /** 列出可用组件：本文件库 + 已连接的团队库 */
  listComponents(): Promise<HostComponentInfo[]>

  /**
   * 把团队库**连上**（Penpot：`library.connectLibrary(id)`），让 `listComponents` / 实例化
   * 能看到本文件之外的库。
   *
   * 为什么由适配器做而不是新增工具：Penpot 的插件可以**读**已连接的库，但从不调
   * `connectLibrary` —— 于是 AI 想复用团队组件时，只能请用户“先回 UI 连一次”（Demo 2 的真实阻塞点）。
   * 连接是复用团队资产的必经步骤，不该让模型多记一个工具（见 CONTRIBUTING 的工具面治理）。
   *
   * `nameOrId` 给了就连指定库；不给则连上 `availableLibraries()` 里所有还没连的。
   * 不具备该能力的宿主可以不实现（MasterGo 的团队库不经“连接”）。返回已连接/本次新连的清单，
   * 以及能力缺失或连接失败的原因 —— 不静默失败。
   */
  connectTeamLibraries?(nameOrId?: string): Promise<TeamLibraryConnectionInfo>

  /**
   * 实例化组件（团队库/本地库）并放到画布上。
   *
   * 定位方式：`componentId`（最精确）> `componentName` + 可选 `libraryName`（按名字解析）。
   * 团队库不需要调用方先连：Penpot 适配器会按需 `connectLibrary`（见 `connectTeamLibraries`），
   * 只在库真的连不上时抛错（错误里分清是名字没命中还是能力缺失）。
   */
  instantiateComponent(input: {
    componentId?: string
    componentName?: string
    libraryName?: string
    parent?: HostNode | null
    x?: number
    y?: number
    width?: number
    height?: number
    name?: string
  }): Promise<{ nodeId: string; componentId: string; componentName: string; libraryName?: string }>
  /**
   * 切换组件变体的某个属性（Penpot：`instance.switchVariant(pos, value)`）。
   * 用于"换组件"的变体回退路径：Penpot 插件 API 没有直接的"换主组件"写入路径。
   */
  switchVariant(
    node: HostNode,
    propertyName: string,
    value: string,
  ): Promise<{ switched: boolean; note?: string }>

  // ── 设计令牌（Penpot：tokens；MasterGo：variables） ──

  listTokenSets(): Promise<HostTokenSet[]>
  /** 创建令牌；集合不存在时按 `setName` 新建（缺省 "Design Tokens"）。返回 created 表示是新建还是已存在 */
  createToken(input: {
    name: string
    type: string
    value: string
    setName?: string
    description?: string
  }): Promise<{ token: HostToken; setId: string; setName: string; created: boolean }>
  /** 更新令牌的值/描述（按 name 定位；`setName` 用于消歧同名令牌） */
  updateToken(input: {
    name: string
    value?: string
    description?: string
    setName?: string
  }): Promise<{ token: HostToken; updated: string[] }>
  /**
   * 令牌改名（单独一个方法，不并进 `updateToken`）。
   *
   * 为何分开：`updateToken` 的第一个参数 `name` 是**选择器**，而工具层的 `name` 是**新名字**，
   * 两个语义在同一个调里会歧义；拆开后选择器与目标值不共用一个字段名。
   */
  renameToken(input: { name: string; newName: string; setName?: string }): Promise<{ token: HostToken; renamed: boolean }>
  /** 删除令牌（按 name 定位） */
  deleteToken(input: { name: string; setName?: string }): Promise<{ deleted: string }>
  /**
   * 把令牌**绑定**到节点的指定属性（Penpot：`shape.applyToken(token, properties)`）。
   *
   * 绑定是**引用**而非写值：改令牌值全稿联动。但宿主"**直接改属性即解绑**" —— 绑定之后
   * 再写 fills/strokes 会把引用换成死值，所以管线顺序必须是「先落结构与属性 → 最后统一绑令牌」。
   *
   * 校验只认 `readNodeTokens` 的回读（`shape.tokens`），不认 "调用没抛错"。
   * 宿主不支持绑定时抛 `UnsupportedHostFeatureError`（MasterGo 侧工具层返回 `available:false`）。
   */
  applyToken(
    node: HostNode,
    tokenName: string,
    properties?: readonly string[],
  ): Promise<{ applied: boolean; tokenId?: string; properties: string[]; bound: Record<string, string>; note?: string }>
  /** 读回节点已绑定的令牌（Penpot：`shape.tokens` 只读映射）—— 绑定校验的唯一诚实依据 */
  readNodeTokens(node: HostNode): Record<string, string>
  /**
   * 激活/停用令牌集合（Penpot 的「主题包含哪些集合」模型）。
   *
   * 为何必须能改：**集合未激活时，绑定只是引用，渲染不跟着令牌走**（真机实测 v2.18.0：
   * `shape.tokens` 已显示绑定，但改令牌值后 fills 仍是旧色，集合 `active: false`）。
   * 所以「渲染后统一改 tokens、全稿联动」的前提是集合处于激活态。
   */
  setTokenSetActive(input: {
    setName?: string
    tokenName?: string
    active: boolean
  }): Promise<{ changed: boolean; active: boolean; setName: string; note?: string }>
  /**
   * 把令牌的**当前值**重新下发到已绑定它的形状（官方：`Token.applyToShapes(shapes, properties)`）。
   *
   * 为何必须显式做这一步：**改令牌值不会自动回写已绑定形状**。真机实测（Penpot 2.18.0）：
   * 集合已 `active`、`shape.tokens` 有引用，但改值后 `fills` 不变、导出 PNG 像素仍是旧色；
   * 而在 Penpot 面板里手改同一个令牌却会刷新画布 —— 说明刷新是**由编辑动作驱动的重下发**，
   * 官方方法就是 `applyToShapes()`。所以「改一次令牌、全稿联动」= 改值 + 本方法。
   *
   * `rewritten` 必须来自回读（fills 快照比对），不拿"调用没报错"当成功。
   */
  propagateToken(input: {
    tokenName: string
    setName?: string
    properties?: readonly string[]
  }): Promise<{ matched: number; rewritten: number; rebound: number; mechanism: string; note?: string }>

  /**
   * 把 N 个节点合成**原生变体集**（Penpot：createVariantFromComponents + Variants）。
   *
   * `nodes[i]` 对应 `values[i]`（按数组顺序配对，而不是依赖宿主返回的组件顺序）。
   * 宿主不支持变体时返回 `{ok:false, reason}`，由调用方降级为命名约定。
   */
  createVariants(
    nodes: readonly HostNode[],
    propertyName: string,
    values: readonly string[],
    options?: CreateVariantsOptions,
  ): Promise<CreateVariantsResult>

  // ── 样式资产 ──

  listColorStyles(): Promise<HostColorStyle[]>
  listTextStyles(): Promise<HostTextStyle[]>
  /**
   * 读节点的 pluginData（可选）。
   *
   * 现在只有一个用途：Penpot 侧的单边描边是**用叠加 Path 模拟**的，规格记在
   * `mgmcp:sideBorderSpecs` 里 —— 导出 DSL 时靠它还原成 `strokeTopWeight` 等四个字段，
   * 否则「模拟出来的边框」往返一次就退化成整圈描边。
   */
  getNodePluginData?(node: HostNode, key: string): string | undefined

  /**
   * 订阅**选区变化**（可选）。
   *
   * 存在的意义：面板要显示"用户当前选中了什么"，而选区变化是宿主主动推的事件
   * （Penpot：`penpot.on('selectionchange')` / `pagechange`）——
   * 这也属于文档类 API，所以只能藏在宿主端口后面（见 host-isolation 门禁）。
   *
   * 返回取消订阅函数。
   */
  observeSelection?(callback: () => void): () => void

  /** 创建颜色样式（Penpot：library.local.createColor） */
  createColorStyle(input: { name: string; color: string; opacity?: number; description?: string }): Promise<HostColorStyle>
  /** 创建文本样式（Penpot：library.local.createTypography） */
  createTextStyle(input: {
    name: string
    fontFamily?: string
    fontSize?: string | number
    fontWeight?: string | number
    lineHeight?: string | number
    letterSpacing?: string | number
    description?: string
  }): Promise<HostTextStyle>

  /**
   * 按**名字**更新已存在的颜色样式（找不到返回 null）。
   *
   * 为何必需：Penpot 插件 API **删不掉样式**，且 `createColor()` 不去重 ——
   * 因此重复注册会**永久翻倍**。要可重入，只能按名 upsert（见 `library/registerStyles`）。
   */
  updateColorStyle(input: { name: string; color: string; opacity?: number; description?: string }): Promise<HostColorStyle | null>
  /** 按**名字**更新已存在的文本样式（找不到返回 null）。理由同 `updateColorStyle`。 */
  updateTextStyle(input: {
    name: string
    fontFamily?: string
    fontSize?: string | number
    fontWeight?: string | number
    lineHeight?: string | number
    letterSpacing?: string | number
    description?: string
  }): Promise<HostTextStyle | null>

  /**
   * 把样式应用到节点。
   * - `fill` / `stroke`：把颜色样式写成节点的填充/描边（Penpot 的 LibraryColor 可直接 `asFill()/asStroke()`）
   * - `text`：把文本样式 `applyToText(shape)`
   */
  applyStyle(node: HostNode, styleId: string, styleType: 'fill' | 'stroke' | 'text'): Promise<{ applied: boolean; note?: string }>

  /**
   * 对文本节点应用**多 run** 富文本（Penpot：`text.getRange(start,end)` + 逐段写 `TextRange`）。
   * 先整体写 `characters`，再按 run 顺序切区间上样式；颜色走 `range.fills`。
   */
  applyTextRuns(
    node: HostNode,
    runs: readonly HostTextRun[],
  ): Promise<{ applied: boolean; runCount: number; characters: number; note?: string }>
  /**
   * 读回文本节点的 run 列表（Penpot：逐字 `getRange` 后按样式分组）。
   * 文本过长时返回 `[]`（逐字扫描代价高）—— 调用方据此退回单 run。
   */
  readTextRuns(node: HostNode): HostTextRun[]

  /**
   * 生成节点子树的**宿主原生 CSS**（Penpot：`generateStyle({type:'css'})` + `generateFontFaces`）。
   *
   * 用途：`design_to_code` 的可选 `exportCss` —— 拿到**宿主自己**产出的规则与 `@font-face`，
   * 比从 DSL 手写字段映射更保真。宿主不具备时 `available:false` + `reason`（**不谎报**）。
   */
  generateCss(nodes: readonly HostNode[]): Promise<{
    available: boolean
    css: string
    fontFaces: string
    nodeCount: number
    reason?: string
  }>

  // ── 文档 / 页面 / 选区 ──

  getDocumentInfo(): HostDocumentInfo
  /**
   * 会话代号（**多 session 身份**）—— 服务端 `session_list` / `session_switch` 靠它区分多个插件实例。
   * Penpot：按**文档**持久化在 `penpot.localStorage`（首用自动生成一个易记代号）；MasterGo：`clientStorage`。
   */
  getDocumentCodename(): string
  /** 设置会话代号（持久化；返回实际生效值）。空串忽略。 */
  setDocumentCodename(name: string): string
  getSelection(): readonly HostNode[]
  setSelection(nodes: readonly HostNode[]): Promise<void>
  listPages(): readonly HostPageInfo[]
  getCurrentPage(): HostPageInfo | null
  /** 当前页的顶层节点。用于「没指定 nodeId 时对整页做遍历/命中测试」 */
  getPageRootNodes(): readonly HostNode[]
  switchPage(pageId: string): Promise<void>
  createPage(name: string): Promise<HostPageInfo>
  /**
   * 重命名页面。返回 `applied` 由**回读**决定（宿主可能异步排队，不能假设成功）。
   * Penpot 只暴露「当前页」对象可写，因此非当前页会抛错而不是静默失败。
   */
  renamePage(pageId: string, name: string): Promise<{ applied: boolean; name: string; reason?: string }>

  // ── 视图 / 交互 ──

  zoomToNodes(nodes: readonly HostNode[]): Promise<void>
  notify(message: string, kind?: NotifyKind): void

  /**
   * 等待宿主布局结算。
   * Penpot：`await penpot.waitForLayoutUpdate()`；MasterGo：no-op 或宿主就绪回调；
   * Memory：no-op。**在读取几何前必须调用**，否则读到的是变更前的值。
   */
  waitForLayoutUpdate(): Promise<void>
}
