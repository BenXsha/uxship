/**
 * Penpot Plugin API —— 本项目用到的子集声明
 *
 * 为什么不直接用官方 `@penpot/plugin-types`？
 * ---------------------------------------------------------------
 * 1. 官方类型随 Penpot 版本生成（npm 上 latest=1.4.2 / next=1.5.0），而本插件必须与
 *    宿主版本解耦 —— 见分析报告 §8「版本强耦合」与 §12.7「capability 探测」。
 * 2. 本文件把「我们实际依赖的 API」显式记录下来，是 capability 探测清单的单一来源：
 *    `lib/host/penpot.ts` 里每个可选能力都对应这里的一个声明。
 * 3. 离线可编译、可类型检查，不引入额外依赖。
 *
 * 字段名与结构严格对齐官方 `mcp/packages/server/data/api_types.yml`（develop 分支），
 * 因此后续若要切换到官方类型包，只需把 `tsconfig.types` 换成 `["@penpot/plugin-types"]`
 * 并删掉本文件，无需改业务代码。
 */

// ─── 基础几何 ─────────────────────────────────────────────

interface PenpotPoint {
  x: number
  y: number
}

interface PenpotBounds {
  x: number
  y: number
  width: number
  height: number
}

interface PenpotColor {
  id?: string
  name?: string
  color?: string
  opacity?: number
  gradient?: PenpotGradient
  image?: PenpotImageData
}

type PenpotGradient = {
  type: 'linear' | 'radial'
  startX: number
  startY: number
  endX: number
  endY: number
  width: number
  stops: { color: string; opacity?: number; offset: number }[]
}

interface PenpotImageData {
  /** 官方声明为**必填**（旧版本文件写成可选，已按 vendor 类型纠正） */
  id: string
  name?: string
  width: number
  height: number
  mtype?: string
  /**
   * 是否保持宽高比（即图片填充的 fit / fill 取向）。
   * ⚠️ 官方成员列表标了 `readonly`：插件读得到、设不了 —— 所以 DSL 的 `imageScaleMode` 落不到这里
   * （见 `docs/host-differences.md`「Images」）。默认 false。
   */
  keepAspectRatio?: boolean
  /** 官方类型是**方法**（返回字节数组），不是 base64 字符串 —— 旧版本文件写错过。 */
  data(): Promise<Uint8Array>
}

// ─── 样式 ─────────────────────────────────────────────────

interface PenpotFill {
  fillColor?: string
  fillOpacity?: number
  fillColorGradient?: PenpotGradient
  fillColorRefFile?: string
  fillColorRefId?: string
  fillImage?: PenpotImageData
}

interface PenpotStroke {
  strokeColor?: string
  strokeColorRefFile?: string
  strokeColorRefId?: string
  strokeOpacity?: number
  strokeStyle?: 'none' | 'svg' | 'mixed' | 'solid' | 'dotted' | 'dashed'
  strokeWidth?: number
  strokeAlignment?: 'center' | 'inner' | 'outer'
  strokeCapStart?: string
  strokeCapEnd?: string
  strokeColorGradient?: PenpotGradient
}

interface PenpotShadow {
  id?: string
  style?: 'drop-shadow' | 'inner-shadow'
  offsetX?: number
  offsetY?: number
  blur?: number
  spread?: number
  hidden?: boolean
  color?: PenpotColor
}

interface PenpotBlur {
  id?: string
  value?: number
  hidden?: boolean
}

// ─── 布局 ─────────────────────────────────────────────────

interface PenpotFlexLayout {
  dir: 'row' | 'row-reverse' | 'column' | 'column-reverse'
  alignItems?: 'end' | 'start' | 'center' | 'stretch'
  alignContent?: 'end' | 'start' | 'center' | 'stretch' | 'space-between' | 'space-around' | 'space-evenly'
  justifyItems?: 'end' | 'start' | 'center' | 'stretch'
  justifyContent?: 'end' | 'start' | 'center' | 'stretch' | 'space-between' | 'space-around' | 'space-evenly'
  rowGap: number
  columnGap: number
  verticalPadding: number
  horizontalPadding: number
  topPadding: number
  rightPadding: number
  bottomPadding: number
  leftPadding: number
  horizontalSizing: 'fill' | 'auto' | 'fix'
  verticalSizing: 'fill' | 'auto' | 'fix'
  wrap?: 'wrap' | 'nowrap'
  appendChild(child: PenpotShape): void
  remove(): void
}

interface PenpotLayoutChildProperties {
  absolute: boolean
  zIndex: number
  horizontalSizing: 'fill' | 'auto' | 'fix'
  verticalSizing: 'fill' | 'auto' | 'fix'
  alignSelf: 'end' | 'start' | 'center' | 'auto' | 'stretch'
  horizontalMargin: number
  verticalMargin: number
  topMargin: number
  rightMargin: number
  bottomMargin: number
  leftMargin: number
  maxWidth: number | null
  maxHeight: number | null
  minWidth: number | null
  minHeight: number | null
}

// ─── Shape ────────────────────────────────────────────────

/** ShapeBase：所有形状的公共成员（此处只声明本项目会读写的部分） */
interface PenpotShapeBase {
  readonly id: string
  readonly type: string
  name: string
  readonly parent: PenpotShape | null
  readonly parentIndex: number
  x: number
  y: number
  readonly width: number
  readonly height: number
  readonly bounds: PenpotBounds
  readonly center: PenpotPoint
  blocked: boolean
  hidden: boolean
  visible: boolean
  proportionLock: boolean
  borderRadius: number
  borderRadiusTopLeft: number
  borderRadiusTopRight: number
  borderRadiusBottomRight: number
  borderRadiusBottomLeft: number
  opacity: number
  blendMode: string
  shadows: PenpotShadow[]
  blur?: PenpotBlur
  backgroundBlur?: PenpotBlur
  readonly boardX: number
  readonly boardY: number
  readonly parentX: number
  readonly parentY: number
  flipX: boolean
  flipY: boolean
  rotation: number
  fills: PenpotFill[] | 'mixed'
  strokes: PenpotStroke[]
  readonly layoutChild?: PenpotLayoutChildProperties
  readonly tokens?: Record<string, string>
  /**
   * 插件私有数据（随文档持久化）。
   * 本项目用它记录「单边描边叠加节点的 id」，以便重渲染时先删旧的再建新的（幂等）。
   */
  getPluginData(key: string): string
  setPluginData(key: string, value: string): void
  getPluginDataKeys(): string[]
  getSharedPluginData(namespace: string, key: string): string
  setSharedPluginData(namespace: string, key: string, value: string): void
  getSharedPluginDataKeys(namespace: string): string[]
  /**
   * 导出为图片/文本。`scale` 是**唯一**的尺寸控制手段（没有固定宽高约束）——
   * 见 `PenpotHost.exportNode`：WIDTH/HEIGHT 会被换算成 scale 并如实说明。
   */
  export(config: { type: 'svg' | 'png' | 'jpeg' | 'webp' | 'pdf'; scale?: number; suffix?: string; skipChildren?: boolean }): Promise<Uint8Array>
  /** 分离组件实例（断开与母版的链接）；非实例调用无害 */
  detach?(): void
  resize(width: number, height: number): void
  rotate(angle: number, center?: PenpotPoint | null): void
  clone(): PenpotShape
  remove(): void
  setParentIndex(index: number): void
  bringToFront(): void
  sendToBack(): void
  applyToken(token: PenpotToken, properties?: string[]): void
}

/** Board / Group / Boolean 都具备 children 与插入方法 */
interface PenpotContainerShape extends PenpotShapeBase {
  readonly children: PenpotShape[]
  appendChild(child: PenpotShape): void
  insertChild(index: number, child: PenpotShape): void
}

interface PenpotBoard extends PenpotContainerShape {
  type: 'board'
  clipContent: boolean
  showInViewMode: boolean
  readonly flex?: PenpotFlexLayout
  addFlexLayout(): PenpotFlexLayout
  isVariantContainer(): boolean
}

interface PenpotRectangle extends PenpotShapeBase {
  type: 'rectangle'
}

interface PenpotEllipse extends PenpotShapeBase {
  type: 'ellipse'
}

interface PenpotPath extends PenpotShapeBase {
  type: 'path'
  /**
   * 路径数据（SVG path 的 `d`）。**可写** —— 这是把图标导成"一条可编辑矢量"的关键：
   * `penpot.createPath()` 后写 `d`，就能正常 resize / 改色 / 在 flex 里伸缩，
   * 而 `createShapeFromSvg()` 返回的 Group 尺寸由子元素推导、`resize()` 基本无效。
   */
  d: string
  /** @deprecated 官方建议用 `d` 或 `commands` */
  content: string
  readonly commands: unknown[]
  /** @deprecated 用 `d` */
  toD(): string
}

/** 文本区间（官方 `TextRange` 的子集）——只声明本插件用到的可写字段 */
interface PenpotTextRange {
  readonly characters: string
  fontSize: string | 'mixed'
  fontWeight: string | 'mixed'
  fontFamily: string | 'mixed'
  lineHeight: string | 'mixed'
  letterSpacing: string | 'mixed'
  fills: PenpotFill[] | 'mixed'
}

interface PenpotText extends PenpotShapeBase {
  type: 'text'
  characters: string
  /** 取文本区间（官方 `Text.getRange`）—— 赋 `fontSize`/`fontWeight`/`fills` 等即写回该区间样式 */
  getRange(start: number, end: number): PenpotTextRange
  /**
   * ⚠️ Penpot 的 resize() 会把 growType 强制为 "fixed"（官方 instruction 明示），
   * 因此设置文本尺寸后需要显式恢复 growType。
   */
  growType: 'fixed' | 'auto-width' | 'auto-height'
  fontId: string
  fontFamily: string
  fontVariantId: string
  /** 官方类型为字符串（如 "14"） */
  fontSize: string
  fontWeight: string
  fontStyle: 'normal' | 'italic' | 'mixed' | null
  /** 官方类型为字符串 */
  lineHeight: string
  /** 官方类型为字符串 */
  letterSpacing: string
  textTransform: 'mixed' | 'uppercase' | 'capitalize' | 'lowercase' | null
  textDecoration: 'mixed' | 'underline' | 'line-through' | null
  direction: 'mixed' | 'ltr' | 'rtl' | null
  align: 'center' | 'left' | 'right' | 'mixed' | 'justify' | null
  verticalAlign: 'center' | 'top' | 'bottom' | null
  readonly textBounds: PenpotBounds
}

interface PenpotGroup extends PenpotContainerShape {
  type: 'group'
}

interface PenpotBoolean extends PenpotContainerShape {
  type: 'boolean'
}

type PenpotShape =
  | PenpotBoard
  | PenpotRectangle
  | PenpotEllipse
  | PenpotPath
  | PenpotText
  | PenpotGroup
  | PenpotBoolean

// ─── 字体 / 令牌 / 库 ─────────────────────────────────────

interface PenpotFontVariant {
  name: string
  fontId: string
  fontFamily: string
  fontWeight: string
  fontStyle?: 'normal' | 'italic' | null
}

interface PenpotFont {
  name: string
  fontId: string
  fontFamily: string
  fontStyle?: 'normal' | 'italic' | null
  fontVariantId: string
  fontWeight: string
  variants: PenpotFontVariant[]
  applyToText(text: PenpotText, variant?: PenpotFontVariant): void
}

interface PenpotFontsContext {
  all: PenpotFont[]
  findById(id: string): PenpotFont | null
  findByName(name: string): PenpotFont | null
  findAllById(id: string): PenpotFont[]
  findAllByName(name: string): PenpotFont[]
}

/**
 * 设计令牌（官方文档：https://doc.plugins.penpot.app ，源自上游 `api_types.yml`）。
 *
 * 为什么这里逐字照官方抄（而不是凭运行时印象写）：
 *   - 令牌 API 从 **`@penpot/plugin-types@1.5.0`** 才公开，而 npm 的 `latest`（1.4.2）里
 *     **连 "token" 一次都不出现** —— 所以"拿 npm 包对账"会得出"这 API 不存在"的错误结论；
 *     唯一可核对的对照物是官方文档站。
 *   - 曾经凭印象写错过：把 `resolvedValueString` 写成 `resolvedValue`（读回永远 undefined）。
 * 可选成员（`?`）是可缺失探测用的：旧宿主可能没有。
 */
interface PenpotToken {
  readonly id: string
  name: string
  type: string
  /** 值：可能是 `{color.primary}` 这类引用；**可写**（update 靠它） */
  value: unknown
  /** 官方名（只读）。旧宿主/旧 typings 里可能叫 `resolvedValue`，适配器两者都读 */
  readonly resolvedValueString?: string
  readonly resolvedValue?: string
  description?: string
  /** 删除该令牌（Penpot 的 token 级 remove） */
  remove(): void
  /**
   * ⭐ 真绑定 / **传播**：把该令牌应用到给定形状的属性上。
   *
   * 官方对 `properties` 的说明：*"Not always correspond to Shape properties. For example,
   * `fill` property applies to `fillColor` of the first fill of the shape."* —— 即 `'fill'` 合法。
   * 总枚举见 `TokenProperty`（含 `'all'`）。
   */
  applyToShapes(shapes: PenpotShape[], properties?: string[]): void
}

interface PenpotTokenSet {
  readonly id: string
  name: string
  active: boolean
  tokens: PenpotToken[]
  /** 官方：`[type, Token[]][]`；用于按类型取令牌（适配器目前自己过滤，保留声明备查） */
  tokensByType?: [string, PenpotToken[]][]
  getTokenById?(id: string): PenpotToken | undefined
  toggleActive(): void
  addToken(input: { type: string; name: string; value: unknown }): PenpotToken
}

/** 库颜色样式：`asFill()/asStroke()` 才能保住"样式引用"语义 */
interface PenpotLibraryColor {
  id: string
  name: string
  path?: string
  libraryId?: string
  color?: string
  opacity?: number
  gradient?: unknown
  asFill(): PenpotFill
  asStroke(): PenpotStroke
}

/** 组件变体：属性轴 + 每个变体的属性值 */
interface PenpotVariants {
  id: string
  libraryId: string
  properties: string[]
  /** 新增一个属性轴（随后用 renameProperty 命名） */
  addProperty(): void
  renameProperty(pos: number, name: string): void
  removeProperty(pos: number): void
  currentValues(property: string): string[]
  variantComponents(): PenpotLibraryVariantComponent[]
}

/** 变体组件：可设置某个属性轴上的值 */
interface PenpotLibraryVariantComponent extends PenpotLibraryComponent {
  setVariantProperty(pos: number, value: string): void
  variantProps: Record<string, string>
  variantError?: string
  variants?: PenpotVariants | null
}

/** 变体容器（本质是 board） */
interface PenpotVariantContainer extends PenpotContainerShape {
  type: 'board'
  variants?: PenpotVariants | null
  isVariantContainer(): boolean
}

/** 库文本样式 */
interface PenpotLibraryTypography {
  id: string
  name: string
  path?: string
  libraryId?: string
  fontFamily?: string
  /** 以下均为字符串（如 "14" / "1.5"），与 Penpot 内部一致 */
  fontSize?: string
  fontWeight?: string
  lineHeight?: string
  letterSpacing?: string
  /** 字体族必须通过它落地（直接写 fontFamily 无效） */
  setFont(font: PenpotFont, variant?: PenpotFontVariant): void
  applyToText(shape: PenpotShape): void
}

/**
 * 令牌主题：**"哪些集合生效"的真正载体**（官方定义，之前这里只声明了 `group`/`name`）。
 */
interface PenpotTokenTheme {
  readonly id: string
  readonly externalId?: string
  group: string
  name: string
  active: boolean
  readonly activeSets: PenpotTokenSet[]
  toggleActive(): void
  addSet(tokenSet: string | PenpotTokenSet): void
  removeSet(tokenSet: string | PenpotTokenSet): void
  remove(): void
}

interface PenpotTokenCatalog {
  sets: PenpotTokenSet[]
  themes: PenpotTokenTheme[]
  /** 官方允许**建集合时就直接 active**（否则新建的集合不驱动渲染，得额外 toggleActive） */
  addSet(input: { name: string; active?: boolean }): PenpotTokenSet
  addTheme(input: { group: string; name: string }): PenpotTokenTheme
  getSetById(id: string): PenpotTokenSet | undefined
  getThemeById(id: string): PenpotTokenTheme | undefined
}

interface PenpotLibraryComponent {
  id: string
  name: string
  /** 库内路径（如 "Buttons/Primary"） */
  path?: string
  libraryId?: string
  instance(): PenpotShape
  mainInstance(): PenpotShape
  isVariant(): boolean
}

interface PenpotLibrary {
  id: string
  name: string
  getPluginData?(key: string): string
  setPluginData?(key: string, value: string): void
  components: PenpotLibraryComponent[]
  colors: PenpotLibraryColor[]
  typographies: PenpotLibraryTypography[]
  tokens: PenpotTokenCatalog
  createComponent(shapes: PenpotShape[]): PenpotLibraryComponent
  createColor(): PenpotLibraryColor
  createTypography(): PenpotLibraryTypography
}

interface PenpotLibraryContext {
  readonly local: PenpotLibrary
  readonly connected: PenpotLibrary[]
  availableLibraries(): Promise<{ id: string; name: string }[]>
  connectLibrary(id: string): Promise<PenpotLibrary>
}

// ─── 页面 / 视口 / UI / 顶层 ──────────────────────────────

interface PenpotPage {
  readonly id: string
  name: string
  /** 页面根容器。顶层形状追加到这里（官方类型为 `Shape`，非 null） */
  readonly root: PenpotShape
  getShapeById(id: string): PenpotShape | null
  /**
   * 按 criteria 列出本页形状（官方 `Page.findShapes`）。**无 criteria ⇒ 返回全页所有形状**：
   * `findShapes({ name?, nameLike?, type? })`（name 精确不区分大小写，nameLike 子串包含，type 精确）。
   * ⚠️ 社区反馈它可能恒返回 `[]`；本插件按运行时探测决定是否启用（见 `PenpotHost.supportsFindShapes`）。
   */
  findShapes(criteria?: { name?: string; nameLike?: string; type?: string }): PenpotShape[]
}

interface PenpotViewport {
  readonly center: PenpotPoint
  readonly zoom: number
  zoomIntoView(shapes: PenpotShape[]): void
}

interface PenpotFile {
  readonly id: string
  readonly name: string
}

interface PenpotPluginUI {
  open(name: string, url: string, options?: { width: number; height: number; hidden?: boolean }): void
  readonly size: { width: number; height: number } | null
  resize(width: number, height: number): void
  sendMessage(message: unknown, throwOnError?: boolean): void
  onMessage<T>(callback: (message: T) => void): void
}

interface PenpotLocalStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface Penpot {
  readonly version: string
  readonly root: PenpotShape | null
  readonly currentFile: PenpotFile | null
  readonly currentPage: PenpotPage | null
  readonly viewport: PenpotViewport
  readonly library: PenpotLibraryContext
  readonly fonts: PenpotFontsContext
  readonly localStorage: PenpotLocalStorage
  readonly ui: PenpotPluginUI
  readonly theme: 'dark' | 'light' | string
  selection: PenpotShape[]
  createBoard(): PenpotBoard
  createRectangle(): PenpotRectangle
  createEllipse(): PenpotEllipse
  createPath(): PenpotPath
  createText(text: string): PenpotText | null
  createBoolean(boolType: string, shapes: PenpotShape[]): PenpotBoolean | null
  createShapeFromSvg(svgString: string): PenpotGroup | null
  createShapeFromSvgWithImages(svgString: string): Promise<PenpotGroup | null>
  createPage(): PenpotPage
  openPage(page: string | PenpotPage, newWindow?: boolean): Promise<void>
  group(shapes: PenpotShape[]): PenpotGroup | null
  ungroup(group: PenpotGroup, ...other: PenpotGroup[]): void
  createVariantFromComponents(shapes: PenpotBoard[]): PenpotVariantContainer
  alignHorizontal(shapes: PenpotShape[], direction: 'center' | 'left' | 'right'): void
  alignVertical(shapes: PenpotShape[], direction: 'center' | 'top' | 'bottom'): void
  generateStyle(shapes: PenpotShape[], options?: { type?: 'css'; withPrelude?: boolean; includeChildren?: boolean }): string
  /** 生成渲染这些形状所需的 `@font-face` 样式（官方为异步方法）。需要 `content:read` 权限。 */
  generateFontFaces(shapes: PenpotShape[]): Promise<string>
  generateMarkup(shapes: PenpotShape[], options?: { type?: 'html' | 'svg' }): string
  uploadMediaUrl(name: string, url: string): Promise<PenpotImageData>
  uploadMediaData(name: string, data: Uint8Array, mimeType: string): Promise<PenpotImageData>
  closePlugin(): void
  /**
   * 布局变更后必须 await 一次，之后读取几何才可信。
   *
   * ⚠️ 该 API 出现在官方 `initial_instructions.md` 里，但**未收录进 `api_types.yml`**，
   * 因此声明为可选 —— 调用方必须做运行时探测（见 penpot.ts 的 waitForLayoutUpdate）。
   */
  waitForLayoutUpdate?(): Promise<void>
}

declare const penpot: Penpot
