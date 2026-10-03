/**
 * Fake Penpot —— 用于测试 `PenpotHost` 的宿主替身
 *
 * 为什么不只用 MemoryHost 测：MemoryHost 测的是「编排逻辑」，而 PenpotHost 里的
 * **映射正确性**（颜色拆 alpha、shadows 结构、flex 枚举、单边描边降级、insertChild 顺序、
 * resize 打回 growType）只有对着「行为像 Penpot 的替身」才能验证。
 *
 * 这里刻意复刻了官方 `initial_instructions.md` 与 `api_types.yml` 里记录的**三个宿主怪癖**：
 *   1. 默认 `appendChild` 在 board 上会打乱顺序 → 替身把 appendChild 实现为「插到开头」，
 *      从而使「误用 appendChild」立刻被测出来
 *   2. `resize()` 会把文本 `growType` 置为 `fixed`
 *   3. `penpot.createText` 返回的文本默认 `growType = 'fixed'`
 */

export interface FakeShape {
  id: string
  type: string
  name: string
  /** 页面绝对坐标（setter 会带动所有后代一起位移 —— 与真实宿主一致） */
  x: number
  y: number
  /** 内部存储（供递归位移时绕过访问器使用） */
  _x: number
  _y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  blocked: boolean
  borderRadius: number
  /** 真实 board 有 clipContent；缺了会让适配器的 clipsContent 判定误判为“该类型不支持” */
  clipContent?: boolean
  blendMode?: string
  fills: unknown
  strokes: unknown[]
  shadows: unknown[]
  blur?: unknown
  backgroundBlur?: unknown
  parent: FakeShape | null
  children: FakeShape[]
  /** 相对父层的偏移（真实宿主是计算属性） */
  readonly parentX: number
  readonly parentY: number
  flex?: Record<string, unknown>
  layoutChild?: Record<string, unknown>
  characters?: string
  growType?: string
  fontSize?: string
  fontWeight?: string
  fontFamily?: string
  fontId?: string
  lineHeight?: string
  letterSpacing?: string
  /** 富文本区间替身（P2-3）：逐字样式 + `Text.getRange` */
  rangeStyle: Array<{ fontSize?: string; fontWeight?: string; letterSpacing?: string; fillColor?: string }>
  /**
   * 官方 `ShapeBase.switchVariant(pos: number, value: string)` 的替身。
   *
   * **只在变体成员上存在**（与真宿主一致：非变体实例上探测不到该方法）—— 所以它是可选的。
   * 替身会校验 `pos` 必须是 number：真机传轴名会被后端拒（`Value not valid: State. Code: :pos`），
   * 把它复刻到离线，才能抓住「适配层误传轴名」这类缺陷。
   */
  switchVariant?(pos: number, value: string): void
  /**
   * 官方 `ShapeBase.component(): LibraryComponent | null` 的替身（实例 → 它的库组件）。
   *
   * 变体**成员组件**带 `variants` 轴表；于是实例上的轴表要从 `component().variants.properties` 取
   * —— 真机实测就是这条路径（实例的 parent 不是变体容器，所以不能只靠 `parent.variants`）。
   */
  component?(): { variants?: { properties: string[] } | null } | null
  getRange(start: number, end: number): unknown
  align?: string | null
  verticalAlign?: string | null
  /** Path 的路径数据（可写；写入后几何随之更新 —— 与 Penpot 行为一致的替身） */
  d?: string
  /** 插件私有数据（与 Penpot 一致：随文档持久化） */
  pluginData: Map<string, string>
  getPluginData(key: string): string
  setPluginData(key: string, value: string): void
  getPluginDataKeys(): string[]
  getSharedPluginData(namespace: string, key: string): string
  setSharedPluginData(namespace: string, key: string, value: string): void
  getSharedPluginDataKeys(namespace: string): string[]
  resize(width: number, height: number): void
  rotate(angle: number): void
  clone(): FakeShape
  remove(): void
  setParentIndex(index: number): void
  insertChild(index: number, child: FakeShape): void
  appendChild(child: FakeShape): void
  addFlexLayout(): Record<string, unknown>
  isVariantContainer(): boolean
  bringToFront(): void
  sendToBack(): void
  applyToken(token: unknown, properties?: string[]): void
  /** 导出为字节（Penpot：`shape.export({type, scale})`）。SVG 返回带非 ASCII 的文本，锁 UTF-8 解码。 */
  export(config: { type?: string; scale?: number }): Uint8Array
  /** 已绑定的令牌（键=属性名，值=令牌名）；未绑定时为 undefined —— 与真机 `shape.tokens` 同形 */
  tokens?: Record<string, string>
}

export interface FakePenpot {
  version: string
  currentFile: { id: string; name: string }
  currentPage: {
    id: string
    name: string
    root: FakeShape
    getShapeById(id: string): FakeShape | null
    findShapes(criteria?: { name?: string; nameLike?: string; type?: string }): FakeShape[]
  }
  selection: FakeShape[]
  library: {
    local: {
      components: unknown[]
      id: string
      name: string
      colors: Record<string, unknown>[]
      typographies: Record<string, unknown>[]
      createComponent(shapes: FakeShape[]): { id: string; name: string; instance(): FakeShape; mainInstance(): FakeShape; isVariant(): boolean }
      createColor(): Record<string, unknown>
      createTypography(): Record<string, unknown>
      tokens: { sets: unknown[]; themes: unknown[]; addSet(input: { name: string }): unknown; addTheme(input: { group: string; name: string }): unknown }
    }
    connected: unknown[]
    availableLibraries(): Promise<unknown[]>
    connectLibrary(id: string): Promise<unknown>
    /** 测试辅助：登记一个「可连接但尚未连接」的团队库（真机：library.availableLibraries()） */
    __addAvailableLibrary(lib: unknown): void
  }
  fonts: {
    all: unknown[]
    findByName(name: string): FakeFont | null
    findById(id: string): FakeFont | null
    findAllByName(name: string): FakeFont[]
    findAllById(id: string): FakeFont[]
  }
  ui: {
    opened: { name: string; url: string } | null
    sent: unknown[]
    open(name: string, url: string, options?: unknown): void
    size: { width: number; height: number } | null
    resize(width: number, height: number): void
    sendMessage(message: unknown): void
    onMessage<T>(callback: (message: T) => void): void
    /** 测试辅助：模拟来自 UI 的消息 */
    __emit(message: unknown): void
  }
  localStorage: {
    store: Map<string, string>
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
  }
  viewport: {
    zoomed: string[][]
    zoomIntoView(shapes: FakeShape[]): void
    zoomReset(): void
  }
  theme: string
  /** 与 Penpot 的 flags-proxy 对齐：可用赋值打开 naturalChildOrdering */
  flags: { naturalChildOrdering: boolean }
  createBoard(): FakeShape
  createRectangle(): FakeShape
  createEllipse(): FakeShape
  createPath(): FakeShape
  createText(text: string): FakeShape | null
  createBoolean(boolType: string, shapes: FakeShape[]): FakeShape | null
  createShapeFromSvg(svg: string): FakeShape | null
  createShapeFromSvgWithImages(svg: string): Promise<FakeShape | null>
  createPage(): { id: string; name: string }
  createVariantFromComponents(shapes: FakeShape[]): FakeShape
  openPage(page: string | { id: string }): Promise<void>
  group(shapes: FakeShape[]): FakeShape | null
  ungroup(group: FakeShape): void
  uploadMediaUrl(name: string, url: string): Promise<unknown>
  uploadMediaData(name: string, data: Uint8Array, mimeType: string): Promise<unknown>
  closePlugin(): void
  generateStyle(shapes: FakeShape[]): string
  generateFontFaces(shapes: FakeShape[]): Promise<string>
  generateMarkup(): string
  /** 测试辅助：查看所有已创建节点的扁平列表 */
  __all(): FakeShape[]
  /** 测试辅助：记录 uploadMediaUrl / uploadMediaData 的调用（断言“同一 URL 不重复拉取”） */
  __uploads: string[]
  /** 事件订阅（真实 Penpot：`penpot.on(evt, cb)` → listenerId；`penpot.off(id)`） */
  on(event: string, handler: (...args: unknown[]) => void): symbol
  off(listenerId: symbol): void
  /** 测试辅助：触发某个事件（如 'selectionchange'） */
  __emit(event: string, ...args: unknown[]): void
  /** 测试辅助：把某个方法置为 undefined，模拟旧版本 Penpot */
  __removeApi(path: string): void
  /**
   * 测试辅助：变体相关的调用流水（仅在 `options.variants` 开启后会有内容）。
   * 用于断言 `addProperty` / `renameProperty(0, name)` / `setVariantProperty(0, value)` 真的被调了。
   */
  __variantLog: { op: string; args: unknown[] }[]
}

export interface FakeFont {
  name: string
  fontId: string
  fontFamily: string
  fontWeight: string
  variants: { name: string; fontId: string; fontWeight: string; fontFamily: string }[]
  applyToText(text: FakeShape, variant?: { fontId: string; fontWeight: string; fontFamily?: string }): void
}

export interface FakePenpotOptions {
  /** 可用字体（family → 字重列表） */
  fonts?: Record<string, string[]>
  /** 是否提供 waitForLayoutUpdate（该方法未收录进 api_types.yml，需探测） */
  withWaitForLayoutUpdate?: boolean
  documentName?: string
  pageName?: string
  /**
   * 模拟「`page.findShapes()` 方法存在，但恒返回 `[]`」的真实社区缺陷。
   * 用于验证宿主的功能性探测会判死并退回手写递归（P1-4）。
   */
  findShapesBroken?: boolean
  /**
   * 开启**组件变体**替身（默认关闭 → 既有用例的行为一字不改）。
   *
   * 开启后：`createComponent` 会把组件登记进 `library.local.components`（于是
   * `PenpotHost.listComponents()` 能看到母版 id）；`createVariantFromComponents` 返回的容器
   * 会带 `variants` 句柄（addProperty / renameProperty / variantComponents / setVariantProperty）。
   */
  variants?: boolean | FakeVariantsOptions
}

export interface FakeVariantsOptions {
  /**
   * 故意把 `variantComponents()` 的返回顺序倒过来。
   *
   * 存在的意义：`createVariants` 必须按 `component.mainInstance()?.id` 配对，
   * 依赖库内顺序就会把 hover 的属性值写到 disabled 上 —— 这个开关让那种 bug 立刻暴露。
   */
  shuffleVariantComponents?: boolean
  /** 把容器名做成只读（模拟"改名不生效"），用于验证适配器如实回报期望值/实际值 */
  containerNameLocked?: boolean
  /**
   * 让变体成员上的 `switchVariant` 直接抛错，用于验证适配层**就地兜住**宿主异常。
   *
   * 真机背景：参数契约不符时 Penpot 抛 `Value not valid: … Code: :pos`，而该异常曾一路
   * 穿到 MCP 层变成 `Internal error` —— 调用方拿不到原因，画布上还留半成品。
   */
  switchVariantError?: string
}

/**
 * Penpot 给新建图形注入的默认涂色（与真实宿主一致）
 *
 * 来源：`common/src/app/common/types/shape.cljc` 的 `minimal-*-attrs` +
 * `common/src/app/common/colors.cljc`（`gray-20 = #B1B2B5`、`white = #FFFFFF`、`black = #000000`）。
 *
 * ⚠️ 替身必须**照抄这些默认值**，否则「宿主默认涂色没被抹掉」这类 bug 在单测里永远看不见
 * —— 之前替身默认 `fills: []`，比真实宿主“干净”，于是白色背景/灰块/黑描边全部漏过。
 */
export const PENPOT_DEFAULT_PAINT: Record<string, { fills: unknown[]; strokes: unknown[] }> = {
  board: { fills: [{ fillColor: '#FFFFFF', fillOpacity: 1 }], strokes: [] },
  rectangle: { fills: [{ fillColor: '#B1B2B5', fillOpacity: 1 }], strokes: [] },
  ellipse: { fills: [{ fillColor: '#B1B2B5', fillOpacity: 1 }], strokes: [] },
  path: {
    fills: [],
    strokes: [{ strokeStyle: 'solid', strokeAlignment: 'center', strokeWidth: 1, strokeColor: '#000000', strokeOpacity: 1 }],
  },
  group: { fills: [], strokes: [] },
  text: { fills: [], strokes: [] },
}

/**
 * 把某个节点的所有后代按 delta 位移（绕过访问器直接改内部字段，避免递归重复触发）。
 * 真实宿主里移动父层会带着子层一起走 —— 替身必须照抄，否则「边框/图标是否跟着父层」
 * 这类问题在单测里根本测不出来。
 */
function shiftDescendants(node: { children: unknown[] }, dx: number, dy: number): void {
  for (const child of node.children as { _x: number; _y: number; children: unknown[] }[]) {
    if (dx) child._x += dx
    if (dy) child._y += dy
    shiftDescendants(child, dx, dy)
  }
}

/** 真实宿主里能承载子节点的类型（frame=board / group / bool / svg-raw） */
const CONTAINER_TYPES = new Set(['board', 'group', 'boolean', 'svg-raw'])

let idSeq = 0
function nextId(prefix: string): string {
  idSeq += 1
  return `${prefix}-${idSeq}`
}

export function createFakePenpot(options: FakePenpotOptions = {}): FakePenpot {
  idSeq = 0
  const all: FakeShape[] = []

  const makeShape = (type: string, overrides: Partial<FakeShape> = {}): FakeShape => {
    const defaults = PENPOT_DEFAULT_PAINT[type as keyof typeof PENPOT_DEFAULT_PAINT] ?? { fills: [], strokes: [] }
    const shape: FakeShape = {
      id: nextId(type),
      type,
      name: type,
      _x: 0,
      _y: 0,
      get x() {
        return this._x
      },
      set x(next: number) {
        const delta = next - this._x
        this._x = next
        if (delta) shiftDescendants(this, delta, 0)
      },
      get y() {
        return this._y
      },
      set y(next: number) {
        const delta = next - this._y
        this._y = next
        if (delta) shiftDescendants(this, 0, delta)
      },
      width: 0,
      height: 0,
      rotation: 0,
      opacity: 1,
      visible: true,
      blocked: false,
      borderRadius: 0,
      clipContent: type === 'board' ? true : undefined,
      blendMode: 'normal',
      // 真实宿主会注入默认涂色 —— 替身照抄
      fills: structuredClone(defaults.fills),
      strokes: structuredClone(defaults.strokes),
      shadows: [],
      parent: null,
      children: [],
      get parentX() {
        return this.x - (this.parent ? this.parent.x : 0)
      },
      get parentY() {
        return this.y - (this.parent ? this.parent.y : 0)
      },

      pluginData: new Map<string, string>(),
      getPluginData(key: string) {
        return this.pluginData.get(key) ?? ''
      },
      setPluginData(key: string, value: string) {
        this.pluginData.set(key, value)
      },

      /** 富文本区间（P2-3 替身）：逐字样式，getRange 聚合读 / 逐字写 */
      rangeStyle: [] as Array<{ fontSize?: string; fontWeight?: string; letterSpacing?: string; fillColor?: string }>,
      getRange(start: number, end: number) {
        const self = this as unknown as FakeShape & { rangeStyle: Array<{ fontSize?: string; fontWeight?: string; letterSpacing?: string; fillColor?: string }> }
        const chars = typeof self.characters === 'string' ? self.characters : ''
        const lo = Math.max(0, Math.min(start, chars.length))
        const hi = Math.max(lo, Math.min(end, chars.length))
        const styles = self.rangeStyle
        for (let i = styles.length; i < chars.length; i += 1) styles.push({})
        const agg = (pick: (style: (typeof styles)[number]) => string | undefined): string | 'mixed' => {
          const values = new Set<string | undefined>()
          for (let i = lo; i < hi; i += 1) values.add(pick(styles[i] ?? {}))
          if (values.size === 1) return ([...values][0] ?? 'mixed') as string | 'mixed'
          return 'mixed'
        }
        const write = (patch: (typeof styles)[number]) => {
          for (let i = lo; i < hi; i += 1) styles[i] = { ...styles[i], ...patch }
        }
        return {
          get characters() {
            return chars.slice(lo, hi)
          },
          get fontSize() {
            return agg((style) => style.fontSize)
          },
          set fontSize(value: string) {
            write({ fontSize: value })
          },
          get fontWeight() {
            return agg((style) => style.fontWeight)
          },
          set fontWeight(value: string) {
            write({ fontWeight: value })
          },
          get letterSpacing() {
            return agg((style) => style.letterSpacing)
          },
          set letterSpacing(value: string) {
            write({ letterSpacing: value })
          },
          get fills() {
            const colors = new Set<string | undefined>()
            for (let i = lo; i < hi; i += 1) colors.add((styles[i] ?? {}).fillColor)
            if (colors.size !== 1) return 'mixed'
            const color = [...colors][0]
            return color ? [{ fillColor: color, fillOpacity: 1 }] : []
          },
          set fills(value: unknown) {
            const color = Array.isArray(value) && value[0] && typeof (value[0] as { fillColor?: unknown }).fillColor === 'string'
              ? String((value[0] as { fillColor: string }).fillColor)
              : undefined
            write({ fillColor: color })
          },
        }
      },
      getPluginDataKeys() {
        return [...this.pluginData.keys()]
      },
      getSharedPluginData() {
        return ''
      },
      setSharedPluginData() {
        /* noop */
      },
      getSharedPluginDataKeys() {
        return []
      },

      resize(width: number, height: number) {
        this.width = width
        this.height = height
        // 怪癖 2：resize 会把文本 growType 打回 fixed
        if (this.type === 'text') this.growType = 'fixed'
      },
      rotate() {
        /* noop */
      },
      export(config: { type?: string }) {
        if (config?.type === 'svg') {
          // 带非 ASCII（真机 SVG 导出走的是插件主进程的 UTF-8 解码；沙箱里没有 TextDecoder）
          const text = `<svg xmlns="http://www.w3.org/2000/svg"><text>${this.name} 图</text></svg>`
          const bytes: number[] = []
          for (const ch of text) {
            const cp = ch.codePointAt(0) as number
            if (cp < 0x80) bytes.push(cp)
            else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
            else bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
          }
          return Uint8Array.from(bytes)
        }
        // PNG 魔数（导出路径不校验内容，给个形状即可）
        return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      },
      clone() {
        const copy = makeShape(this.type, { name: this.name, x: this.x, y: this.y })
        copy.width = this.width
        copy.height = this.height
        return copy
      },
      remove() {
        if (this.parent) this.parent.children = this.parent.children.filter((c) => c.id !== this.id)
        const at = all.findIndex((s) => s.id === this.id)
        if (at >= 0) all.splice(at, 1)
      },
      setParentIndex(index: number) {
        if (!this.parent) return
        this.parent.children = this.parent.children.filter((c) => c.id !== this.id)
        this.parent.children.splice(Math.max(0, index), 0, this)
      },
      insertChild(index: number, child: FakeShape) {
        // 真实宿主只允许 frame/group/bool/svg-raw 承载子节点，其余类型会抛错
        // （plugins/shape.cljs 的 not-valid :insertChild）。替身必须照抄，
        // 否则「把叶子当容器」这类错误在单测里永远看不见。
        if (!CONTAINER_TYPES.has(this.type)) {
          throw new Error(`insertChild: 节点类型 ${this.type} 不是容器`)
        }
        const at = Math.max(0, Math.min(index, this.children.length))
        if (child.parent) child.parent.children = child.parent.children.filter((c) => c.id !== child.id)
        this.children.splice(at, 0, child)
        child.parent = this
        // 进入有布局的容器 → 宿主会给出 layoutChild（叠加层靠 absolute 脱离布局流）
        if (this.flex && !child.layoutChild) {
          child.layoutChild = { absolute: false, zIndex: 0, horizontalSizing: 'fix', verticalSizing: 'fix' }
        }
      },
      /**
       * 怪癖 1：官方明示 `appendChild` 在 board 上有问题且 flex 下子顺序反转。
       * 替身把它实现为「插到最前面」—— 于是任何误用 appendChild 的代码都会在断言里暴露。
       */
      appendChild(child: FakeShape) {
        this.insertChild(0, child)
      },
      addFlexLayout() {
        const flex: Record<string, unknown> = {
          dir: 'row',
          rowGap: 0,
          columnGap: 0,
          verticalPadding: 0,
          horizontalPadding: 0,
          topPadding: 0,
          rightPadding: 0,
          bottomPadding: 0,
          leftPadding: 0,
          horizontalSizing: 'fix',
          verticalSizing: 'fix',
          remove: () => {
            delete this.flex
          },
        }
        this.flex = flex
        return flex
      },
      isVariantContainer() {
        return false
      },
      bringToFront() {
        /* noop */
      },
      sendToBack() {
        /* noop */
      },
      // 令牌绑定：**刻意模拟真机的三个关键行为**（均来自 Penpot 2.18.0 实测）：
      //   1. 异步落地（调用返回后立刻回读 `tokens` 仍是空）；
      //   2. **切换语义**：对已绑定同一令牌的形状再下发 = **解绑**（且不写值）；
      //   3. 绑定那一刻把令牌当前值写进 fills（官方：`fill` → 第一个 fill 的 `fillColor`）。
      // 不照这三条做，PenpotHost 的有界轮询与 propagateToken 的「解绑→重绑」就永远测不到。
      applyToken(token: unknown, properties?: string[]) {
        const props = properties && properties.length ? properties : ['fill']
        const name = String((token as { name?: string })?.name ?? '')
        const value = (token as { value?: unknown })?.value
        setTimeout(() => {
          const current: Record<string, string> = { ...(shape.tokens ?? {}) }
          const alreadyBound = props.every((prop) => current[prop] === name)
          const next = { ...current }
          if (alreadyBound) {
            for (const prop of props) delete next[prop]
            shape.tokens = next
            return
          }
          for (const prop of props) next[prop] = name
          shape.tokens = next
          if (value !== undefined) {
            const fills = Array.isArray(shape.fills) ? [...(shape.fills as unknown[])] : []
            fills[0] = { ...((fills[0] ?? {}) as object), fillColor: String(value) }
            ;(shape as { fills?: unknown }).fills = fills
          }
        }, 5)
      },
      ...overrides,
    }
    all.push(shape)
    return shape
  }

  const variantOptions: FakeVariantsOptions =
    typeof options.variants === 'object' && options.variants !== null ? options.variants : {}
  const variantsEnabled = options.variants === true || (typeof options.variants === 'object' && options.variants !== null)

  /**
   * 造一个「库组件」记录。
   *
   * 形状对齐真实 Penpot 的 LibraryComponent：`id` / `name` / `path` / `mainInstance()` /
   * `isVariant()` / `instance()`，外加变体属性写入（`setVariantProperty`）。
   */
  const makeComponentRecord = (shape: FakeShape, name?: string) => {
    const record = {
      id: nextId('component'),
      name: name ?? shape.name ?? 'Component',
      path: '',
      instance: () => {
        const instanceShape = makeShape('board', { name: 'Instance' })
        // 官方 `ShapeBase.component()`：实例指向它的库组件（变体成员则带 variants 轴表）
        instanceShape.component = () => record
        attachVariantSwitcher(instanceShape)
        return instanceShape
      },
      mainInstance: () => shape,
      isVariant: () => false,
      /** 变体成员组件才有的轴表（由 createVariantFromComponents 填上） */
      variants: null as { properties: string[] } | null,
      /** 位置索引 → 写入的属性值（供断言） */
      variantProperties: {} as Record<number, string>,
      setVariantProperty(pos: number, value: string) {
        record.variantProperties[pos] = value
        variantLog.push({ op: 'setVariantProperty', args: [shape.id, pos, value] })
      },
    }
    return record
  }

  /**
   * 给形状挂上 `switchVariant` 替身（官方 `ShapeBase.switchVariant(pos: number, value: string)`）。
   *
   * `pos` 必须是**数字轴下标**：真机传轴名会被后端拒（`Value not valid: State. Code: :pos`），
   * 这里也抛同样的错 —— 于是“适配层误传轴名”在离线就能暴露。
   */
  function attachVariantSwitcher(target: FakeShape): void {
    target.switchVariant = (pos: number, value: string) => {
      if (variantOptions.switchVariantError) throw new Error(variantOptions.switchVariantError)
      if (typeof pos !== 'number') throw new Error(`Value not valid: ${String(pos)}. Code: :pos`)
      variantLog.push({ op: 'switchVariant', args: [target.id, pos, value] })
    }
  }

  const variantLog: { op: string; args: unknown[] }[] = []

  const root = makeShape('board', { name: 'Page Root' })
  const page = { id: 'page-1', name: options.pageName ?? 'Page 1', root }

  /**
   * `page.findShapes(criteria?)` 替身：无 criteria ⇒ 全页形状；支持 name/nameLike/type 过滤。
   * `findShapesBroken` 时恒返回 `[]`（复刻社区反馈的真实缺陷），用于验证功能性探测 + 递归兜底。
   */
  const findShapes = (criteria?: { name?: string; nameLike?: string; type?: string }): FakeShape[] => {
    if (options.findShapesBroken) return []
    const lower = (value: unknown): string => String(value ?? '').toLowerCase()
    return all.filter((shape) => {
      if (criteria?.name !== undefined && lower(shape.name) !== lower(criteria.name)) return false
      if (criteria?.nameLike !== undefined && !lower(shape.name).includes(lower(criteria.nameLike))) return false
      if (criteria?.type !== undefined && lower(shape.type) !== lower(criteria.type)) return false
      return true
    })
  }

  const makePage = (id: string, name: string) => ({
    id,
    name,
    root,
    getShapeById: (sid: string) => all.find((s) => s.id === sid) ?? null,
    findShapes,
  })

  const listeners = new Map<string, { id: symbol; handler: (...args: unknown[]) => void }[]>()

  const fonts: Record<string, FakeFont> = {}
  for (const [family, weights] of Object.entries(options.fonts ?? { Inter: ['400', '600', '700'] })) {
    fonts[family] = {
      name: family,
      fontId: `${family}-id`,
      fontFamily: family,
      fontWeight: weights[0],
      variants: weights.map((weight) => ({
        name: weight === '400' ? 'Regular' : weight === '600' ? 'SemiBold' : 'Bold',
        fontId: `${family}-${weight}`,
        fontWeight: weight,
        fontFamily: family,
      })),
      applyToText(text: FakeShape, variant?: { fontId: string; fontWeight: string; fontFamily?: string }) {
        if (!variant) return
        text.fontId = variant.fontId
        text.fontFamily = variant.fontFamily
        text.fontWeight = variant.fontWeight
      },
    }
  }

  const penpot: FakePenpot = {
    version: '2.15.0',
    currentFile: { id: 'file-1', name: options.documentName ?? 'Fake File' },
    currentPage: makePage(page.id, page.name),
    selection: [],
    library: (() => {
      /**
       * 真机行为（Penpot 2.18.0 实测）：样式名里的 `/` 是**文件夹分隔**，且**每段会 trim**。
       * `createColor()` 后写 `name = 'Brand / Brand Primary'` → 存成 `name='Brand Primary' / path='Brand'`。
       * 替身照此建模，否则「按名 upsert 要 trim 叶子名」这条真机坑在单测里跑不到。
       */
      const splitStyleName = (raw: string): { name: string; path: string } => {
        const segments = String(raw).split('/').map((part) => part.trim()).filter(Boolean)
        if (segments.length <= 1) return { name: segments[0] ?? '', path: '' }
        return { name: segments[segments.length - 1], path: segments.slice(0, -1).join(' / ') }
      }
      /** 给样式记录装一个会「拆分 + trim」的 name 访问器（赋 name 即同时定 path） */
      const defineStyleName = (record: Record<string, unknown>): void => {
        let leaf = ''
        Object.defineProperty(record, 'name', {
          enumerable: true,
          configurable: true,
          get: () => leaf,
          set: (raw: string) => {
            const parsed = splitStyleName(raw)
            leaf = parsed.name
            record.path = parsed.path
          },
        })
      }
      const colors: Record<string, unknown>[] = []
      const typographies: Record<string, unknown>[] = []
      const localLibrary = {
        id: 'lib-1',
        name: 'Local',
        components: [] as unknown[],
        colors,
        typographies,
        createComponent(shapes: FakeShape[]) {
          const record = makeComponentRecord(shapes[0], variantsEnabled ? shapes[0]?.name : undefined)
          // 默认不登记（既有用例依赖 `listComponents()` 为空）；开启变体替身后才登记，
          // 否则「已是组件母版 → 复用」这条分支在单测里永远跑不到
          if (variantsEnabled) (penpot.library.local.components as unknown[]).push(record)
          return record
        },
        createColor() {
          const record: Record<string, unknown> = { id: `color-${colors.length + 1}`, color: '#000000', opacity: 1, path: '' }
          defineStyleName(record)
          colors.push(record)
          return record
        },
        createTypography() {
          const record: Record<string, unknown> = {
            id: `typo-${typographies.length + 1}`,
            fontSize: '12',
            fontWeight: '400',
            lineHeight: '1.5',
            letterSpacing: '0',
            path: '',
            setFont() {},
          }
          defineStyleName(record)
          typographies.push(record)
          return record
        },
        tokens: (() => {
          // 令牌目录：**刻意对齐真机行为**（Penpot 2.18.0 实测）。
          //
          // 之前这里 `addSet` 只返回一个字面量、不记录也不给 `addToken`，并且 `active: true` ——
          // 于是两个真机才暴露的问题（① 集合默认未激活 → 绑定不驱动渲染；
          // ② applyToken 异步落地）在离线测试里根本跑不到。现在 sets 是真实数组、默认 active:false。
          const sets: any[] = []
          return {
            sets,
            themes: [] as unknown[],
            addSet: (input: { name: string }) => {
              const set: any = {
                id: `fake-set-${sets.length + 1}`,
                name: input.name,
                active: false,
                tokens: [] as any[],
                toggleActive() {
                  set.active = !set.active
                },
                addToken(tokenInput: { type: string; name: string; value: unknown }) {
                  const token: any = {
                    id: `fake-token-${set.tokens.length + 1}`,
                    name: tokenInput.name,
                    type: tokenInput.type,
                    value: tokenInput.value,
                    get resolvedValue() {
                      return this.value
                    },
                    remove() {
                      const index = set.tokens.indexOf(token)
                      if (index >= 0) set.tokens.splice(index, 1)
                    },
                    /**
                     * 官方语义：*"`fill` property applies to `fillColor` of the first fill of the shape"*。
                     * 替身照此实现 —— 否则"改值 → 传播"这条路径在离线测试里永远跑不到。
                     */
                    applyToShapes(shapes: any[], properties?: string[]) {
                      const props = properties && properties.length ? properties : ['fill']
                      if (!props.includes('fill') && !props.includes('all')) return
                      const value = String(token.value ?? '')
                      for (const shape of shapes ?? []) {
                        const fills = Array.isArray(shape.fills) ? [...shape.fills] : []
                        fills[0] = { ...(fills[0] ?? {}), fillColor: value }
                        shape.fills = fills
                      }
                    },
                  }
                  set.tokens.push(token)
                  return token
                },
              }
              sets.push(set)
              return set
            },
            addTheme: (input: { group: string; name: string }) => input,
          }
        })(),
      }

      const connected: unknown[] = [localLibrary]
      const available: unknown[] = []

      return {
        local: localLibrary,
        // ⚠️ 照抄真机形态：`connected` 里**也含本文件库**（实测 component/list 返回 4 条而只有
        // 2 个组件）。不这样建模，"按 id 去重"的逻辑在单测里永远测不到。
        connected,
        async availableLibraries() {
          return available.map((lib) => ({ id: (lib as { id: string }).id, name: (lib as { name: string }).name }))
        },
        async connectLibrary(id: string) {
          // 真机语义：连上之后库进入 `connected`（之后 listComponents 就能看到它的组件）
          const found = available.find((lib) => (lib as { id: string }).id === id)
          if (!found) throw new Error(`library not found: ${id}`)
          available.splice(available.indexOf(found), 1)
          connected.push(found)
          return found
        },
        __addAvailableLibrary(lib: unknown) {
          available.push(lib)
        },
      }
    })(),
    fonts: {
      all: Object.values(fonts),
      findByName: (name: string) => fonts[name] ?? null,
      findById: (id: string) => Object.values(fonts).find((f) => f.fontId === id) ?? null,
      findAllByName: (name: string) => (fonts[name] ? [fonts[name]] : []),
      findAllById: (id: string) => Object.values(fonts).filter((f) => f.fontId === id),
    },
    ui: {
      opened: null,
      sent: [],
      open(name: string, url: string) {
        this.opened = { name, url }
      },
      size: { width: 400, height: 560 },
      resize() {
        /* noop */
      },
      sendMessage(message: unknown) {
        this.sent.push(message)
      },
      onMessage<T>(callback: (message: T) => void) {
        this.__emit = (message: unknown) => callback(message as T)
      },
      __emit() {
        /* 未注册时忽略 */
      },
    },
    localStorage: {
      store: new Map(),
      getItem(key: string) {
        return this.store.get(key) ?? null
      },
      setItem(key: string, value: string) {
        this.store.set(key, value)
      },
      removeItem(key: string) {
        this.store.delete(key)
      },
    },
    viewport: {
      zoomed: [],
      zoomIntoView(shapes: FakeShape[]) {
        this.zoomed.push(shapes.map((s) => s.id))
      },
      zoomReset() {
        /* noop */
      },
    },
    theme: 'dark',
    // Penpot 默认 false（见 app.plugins.flags/initialize）—— 替身照抄，否则测不出顺序问题
    flags: { naturalChildOrdering: false },

    createBoard() {
      const board = makeShape('board')
      root.insertChild(root.children.length, board)
      return board
    },
    createRectangle() {
      return makeShape('rectangle')
    },
    createEllipse() {
      return makeShape('ellipse')
    },
    createPath() {
      const path = makeShape('path')
      // 替身里让 `d` 可写，并从路径数据粗算包围盒 ——
      // 这样 PenpotHost 的「d 写入后回读几何」校验才能被真实跑通
      let dValue = ''
      Object.defineProperty(path, 'd', {
        enumerable: true,
        get: () => dValue,
        set: (next: string) => {
          dValue = String(next ?? '')
          const numbers = (dValue.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number).filter(Number.isFinite)
          if (!numbers.length) {
            path.width = 0
            path.height = 0
            return
          }
          let minX = Number.POSITIVE_INFINITY
          let minY = Number.POSITIVE_INFINITY
          let maxX = Number.NEGATIVE_INFINITY
          let maxY = Number.NEGATIVE_INFINITY
          for (let i = 0; i + 1 < numbers.length; i += 2) {
            minX = Math.min(minX, numbers[i])
            maxX = Math.max(maxX, numbers[i])
            minY = Math.min(minY, numbers[i + 1])
            maxY = Math.max(maxY, numbers[i + 1])
          }
          path.width = Math.max(0.001, maxX - minX)
          path.height = Math.max(0.001, maxY - minY)
          // 真实宿主里 Path 的 x/y 由路径几何推导（d 的包围盒左上角）
          path._x = minX
          path._y = minY
        },
      })
      return path
    },
    createText(text: string) {
      // 怪癖 3：默认 growType = 'fixed'
      return makeShape('text', { characters: text, growType: 'fixed' })
    },
    createBoolean(_boolType: string, shapes: FakeShape[]) {
      return makeShape('boolean', { name: 'Boolean', children: [...shapes] })
    },
    createShapeFromSvg(svg: string) {
      if (!svg.includes('<svg')) return null
      return makeShape('group', { name: 'SVG' })
    },
    async createShapeFromSvgWithImages(svg: string) {
      if (!svg.includes('<svg')) return null
      return makeShape('group', { name: 'SVG (with images)' })
    },
    createPage() {
      return { id: nextId('page'), name: 'New Page' }
    },
    createVariantFromComponents(shapes: FakeShape[]) {
      variantLog.push({ op: 'createVariantFromComponents', args: [shapes.map((shape) => shape.id)] })
      const container = makeShape('board', { name: 'Variant Container' })
      // 开启变体替身时把成员搬进容器（与真实宿主一致；未开启时保持既有行为不动）
      if (variantsEnabled) {
        for (const shape of shapes) container.insertChild(container.children.length, shape)
      } else {
        container.children = [...shapes]
      }
      // 默认：与既有行为一字不差（容器没有 variants 句柄 → 适配器会如实报 ok:false）
      if (!variantsEnabled) return container

      const components = shapes.map((shape) => {
        const record = makeComponentRecord(shape, shape.name)
        penpot.library.local.components.push(record)
        return record
      })
      // 真机实测（Penpot）：createVariantFromComponents **自动带一个属性**（默认名 "Property 1"）。
      // 假宿主照此模拟，否则会漏测「幽灵属性」回归（见 penpot-components.ts 的复用第 0 轴逻辑）。
      const propertyNames: string[] = ['Property 1']
      const handle = {
        addProperty() {
          propertyNames.push(`Property ${propertyNames.length + 1}`)
          variantLog.push({ op: 'addProperty', args: [] })
        },
        renameProperty(pos: number, name: string) {
          propertyNames[pos] = name
          variantLog.push({ op: 'renameProperty', args: [pos, name] })
        },
        propertyNames,
        /** 与真宿主 `Variants.properties` 对齐（供适配层回读已存在几个轴） */
        get properties() {
          return [...propertyNames]
        },
        variantComponents() {
          variantLog.push({ op: 'variantComponents', args: [] })
          return variantOptions.shuffleVariantComponents ? [...components].reverse() : components
        },
      }
      Object.defineProperty(container, 'variants', { value: handle, enumerable: true, configurable: true })

      /**
       * 变体成员上的 `switchVariant` 替身（官方 `ShapeBase.switchVariant(pos: number, value: string)`）。
       *
       * 两个关键点都照着真机来：
       *   1. `pos` 必须是**数字轴下标** —— 传轴名会被真宿主拒（`Value not valid: State. Code: :pos`），
       *      这里也抛同样的错，于是“适配层误传轴名”在离线就能暴露；
       *   2. 只在**变体成员**上有这个方法（非变体形状探测不到），与真宿主一致。
       */
      for (const [index, shape] of shapes.entries()) {
        attachVariantSwitcher(shape)
        const record = components[index]
        if (!record) continue
        // 成员组件带轴表，且成员形状的 `component()` 指回它 —— 与真宿主一致
        record.variants = handle
        shape.component = () => record
      }

      if (variantOptions.containerNameLocked) {
        const fixed = container.name
        Object.defineProperty(container, 'name', {
          enumerable: true,
          configurable: true,
          get: () => fixed,
          set: () => {
            throw new TypeError('fake: VariantContainer.name 不可写')
          },
        })
      }
      return container
    },
    async openPage(target: string | { id: string }) {
      const id = typeof target === 'string' ? target : target.id
      if (id === page.id) return
      // 假宿主：切换后把 currentPage 指到新页（真实 Penpot 可能异步排队）
      penpot.currentPage = makePage(id, `Page ${id}`)
    },
    group(shapes: FakeShape[]) {
      if (!shapes.length) return null
      const group = makeShape('group')
      const host = shapes[0].parent
      if (host) {
        host.insertChild(host.children.length, group)
      } else {
        root.insertChild(root.children.length, group)
      }
      for (const shape of shapes) group.insertChild(group.children.length, shape)
      return group
    },
    ungroup() {
      /* noop */
    },
    async uploadMediaUrl(name: string, url?: string) {
      penpot.__uploads.push(url ?? name)
      return { name, width: 1, height: 1 }
    },
    async uploadMediaData(name: string) {
      penpot.__uploads.push(name)
      return { name, width: 1, height: 1 }
    },
    closePlugin() {
      /* noop */
    },
    generateStyle(shapes: FakeShape[]) {
      return `/* fake-css:${shapes.length} */`
    },
    async generateFontFaces(shapes: FakeShape[]) {
      return `/* fake-font-faces:${shapes.length} */`
    },
    generateMarkup() {
      return ''
    },
    __all: () => all,
    __uploads: [],
    __variantLog: variantLog,
    // 事件订阅：真实宿主有 selectionchange / pagechange 等（见官方 api.yml 的 EventsMap）。
    // 替身必须支持，否则「面板显示选区」这条链在单测里永远是空的。
    on(event: string, handler: (...args: unknown[]) => void) {
      const listenerId = Symbol(event)
      const list = listeners.get(event) ?? []
      list.push({ id: listenerId, handler })
      listeners.set(event, list)
      return listenerId
    },
    off(listenerId: symbol) {
      for (const [event, list] of listeners) {
        const next = list.filter((entry) => entry.id !== listenerId)
        if (next.length !== list.length) listeners.set(event, next)
      }
    },
    __emit(event: string, ...args: unknown[]) {
      for (const entry of [...(listeners.get(event) ?? [])]) entry.handler(...args)
    },
    __removeApi(path: string) {
      const segments = path.split('.')
      let cursor: Record<string, unknown> = penpot as unknown as Record<string, unknown>
      for (const segment of segments.slice(0, -1)) {
        cursor = cursor[segment] as Record<string, unknown>
      }
      delete cursor[segments[segments.length - 1]]
    },
  }

  if (options.withWaitForLayoutUpdate) {
    ;(penpot as unknown as Record<string, unknown>).waitForLayoutUpdate = async () => undefined
  }

  return penpot
}

/** 把 fake penpot 装到全局，返回卸载函数 */
export function installFakePenpot(options?: FakePenpotOptions): { penpot: FakePenpot; restore: () => void } {
  const penpot = createFakePenpot(options)
  const globalObject = globalThis as unknown as Record<string, unknown>
  const previous = globalObject.penpot
  globalObject.penpot = penpot
  return {
    penpot,
    restore: () => {
      globalObject.penpot = previous
    },
  }
}

/** 找某个板下的子节点名（断言顺序用） */
export function childNames(parent: FakeShape): string[] {
  return parent.children.map((child) => child.name)
}
