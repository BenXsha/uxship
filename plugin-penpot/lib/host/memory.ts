/**
 * MemoryHost —— 纯内存宿主实现
 *
 * 两个用途：
 * 1. **单测**：dsl-renderer / handlers 的断言不需要真实 Penpot，也不需要给全局 `penpot`
 *    打桩；直接注入本实现，然后读 `toTree()` 断言结构。
 * 2. **离线干跑**：`UXSHIP_DRY_RUN` 式的排障 —— 不连画布也能看到 DSL 被翻译成了什么。
 *
 * 它同时是 `HostAdapter` 的**第二个实现**，用来验证接口没有偷偷绑死 Penpot 语义
 * （接口只有一个实现时，抽象往往是假的）。
 */
import { HostArgumentError, HostNodeNotFoundError, UnsupportedHostFeatureError } from './errors'
import { orderedPropertyEntries } from './apply-order'
import { normalizeColor } from './color'
import { styleNameMatches } from './style-name'
import { computeAlignment, computeDistribution, type AlignBox, type AlignDelta } from '../align'
import { normalizeFillType } from './gradient'
import { buildVectorPath } from './vector-shapes'
import type {
  ApplyResult,
  BooleanOperation,
  CreateVariantsOptions,
  CreateVariantsResult,
  ExportOptions,
  ExportResult,
  FontRequest,
  HostColorStyle,
  HostComponentInfo,
  HostTextStyle,
  HostTextRun,
  HostToken,
  HostTokenSet,
  HostAdapter,
  HostCapabilities,
  HostDocumentInfo,
  HostFontInfo,
  HostNode,
  HostPageInfo,
  NodeKind,
  NodeProperties,
  NodeSpec,
  NotifyKind,
  PropertySkip,
} from './types'

export interface MemoryNode extends HostNode {
  readonly id: string
  readonly type: string
  name: string
  kind: NodeKind
  parentId: string | null
  children: MemoryNode[]
  props: NodeProperties
  /** 富文本 run（P2-3）：`applyTextRuns` 写入、`readTextRuns` 读回（与 Penpot 行为对齐） */
  textRuns?: HostTextRun[]
}

export interface MemoryHostOptions {
  documentName?: string
  homePageName?: string
  /**
   * 覆盖能力清单，用于测试「宿主不支持某能力时的降级路径」。
   * 刻意做成**两层都可选** —— 否则测一个开关要把整张表抄一遍（构造函数本来就是浅合并两层）。
   */
  capabilities?: Partial<Omit<HostCapabilities, 'ops' | 'props'>> & {
    ops?: Partial<HostCapabilities['ops']>
    props?: Partial<HostCapabilities['props']>
  }
  /** 是否模拟 `resize()` 会破坏文本 autoResize（Penpot 真实行为，见 §12.5） */
  resizeResetsTextAutoResize?: boolean
}

const DEFAULT_CAPABILITIES: HostCapabilities = {
  host: 'memory',
  nodeKinds: [
    'frame',
    'rectangle',
    'ellipse',
    'text',
    'svg',
    'path',
    'pen',
    'polygon',
    'star',
    'line',
    'component',
    'instance',
    'boolean',
  ],
  props: {
    fills: true,
    perSideStrokes: true,
    gradients: true,
    imageFills: true,
    imageFromUrl: true,
    effects: true,
    backgroundBlur: true,
    autoLayout: true,
    gridLayout: false,
    textAutoResize: true,
    tokenBinding: false,
  },
  ops: {
    createComponent: true,
    componentInstances: true,
    componentVariants: false,
    // 替身默认**不提供**原生换组件 —— 这样默认跑的是兜底（合成）路径；
    // 要测原生路径就 `capabilities: { ops: { swapComponent: true } }` 打开。
    // 真实 Penpot 侧是运行时探测（见 penpot.ts 的能力表）。
    swapComponent: false,
    // 替身的对齐/分布**默认打开**：它用 lib/align.ts 的几何算法算（与 handler 兜底同一份），
    // 所以两种路径结果一致，测试也能直接断言坐标。
    alignNodes: true,
    teamLibrary: false,
    booleanOps: true,
    exportImage: false,
    svgImport: true,
    group: true,
    renderUiIframe: true,
    naturalChildOrdering: true,
    // 替身没有页级 findShapes；令牌传播走自己的存储（与 Penpot 的行为等价）
    findShapes: false,
    // 替身不实现宿主原生 CSS 生成（Penpot 有 generateStyle/generateFontFaces）
    generateCss: false,
  },
}

const KIND_TO_TYPE: Record<NodeKind, string> = {
  frame: 'board',
  rectangle: 'rectangle',
  ellipse: 'ellipse',
  text: 'text',
  svg: 'svg-raw',
  group: 'group',
  path: 'path',
  pen: 'path',
  polygon: 'path',
  star: 'path',
  line: 'path',
  component: 'board',
  instance: 'board',
  boolean: 'boolean',
  section: 'board',
  slice: 'rectangle',
  connector: 'path',
}

export class MemoryHost implements HostAdapter {
  readonly id = 'memory' as const

  private capabilities: HostCapabilities
  private nodes = new Map<string, MemoryNode>()
  private pages: HostPageInfo[]
  private currentPageId: string
  private selectionIds: string[] = []
  private seq = 0
  private readonly documentName: string
  private readonly resizeResetsTextAutoResize: boolean

  /** 断言用记录 */
  readonly notifications: { message: string; kind: NotifyKind }[] = []
  readonly loadedFonts: FontRequest[] = []
  readonly zoomLog: string[][] = []

  constructor(options: MemoryHostOptions = {}) {
    this.capabilities = {
      ...DEFAULT_CAPABILITIES,
      ...options.capabilities,
      props: { ...DEFAULT_CAPABILITIES.props, ...options.capabilities?.props },
      ops: { ...DEFAULT_CAPABILITIES.ops, ...options.capabilities?.ops },
    }
    this.documentName = options.documentName ?? 'Memory Document'
    this.resizeResetsTextAutoResize = options.resizeResetsTextAutoResize ?? true
    const homePage: HostPageInfo = { id: 'page-1', name: options.homePageName ?? 'Page 1' }
    this.pages = [homePage]
    this.currentPageId = homePage.id
  }

  // ── 能力 ──

  getCapabilities(): HostCapabilities {
    return this.capabilities
  }

  async init(): Promise<void> {
    /* 无副作用 */
  }

  // ── 生命周期 ──

  async createNode(spec: NodeSpec, parent?: HostNode | null): Promise<HostNode> {
    if (!this.capabilities.nodeKinds.includes(spec.kind)) {
      throw new UnsupportedHostFeatureError(`createNode(${spec.kind})`)
    }
    const id = `${spec.kind}-${++this.seq}`
    const node: MemoryNode = {
      id,
      type: KIND_TO_TYPE[spec.kind],
      kind: spec.kind,
      name: spec.name ?? id,
      parentId: null,
      children: [],
      props: {},
    }
    // 真实宿主任何形状都有坐标（缺省 0）—— 替身不能"没给就没有"，否则 `读 x` 得到 undefined，
    // 导出时会误以为"位置未知"而漏掉 position
    if (spec.relativeToParent && parent) {
      const parentNode = this.requireNode(parent.id)
      node.props.x = Number(parentNode.props.x ?? 0) + (spec.x ?? 0)
      node.props.y = Number(parentNode.props.y ?? 0) + (spec.y ?? 0)
    } else {
      node.props.x = spec.x ?? 0
      node.props.y = spec.y ?? 0
    }
    if (spec.width !== undefined) node.props.width = spec.width
    if (spec.height !== undefined) node.props.height = spec.height
    if (spec.characters !== undefined) node.props.characters = spec.characters
    if (spec.svgContent !== undefined) (node.props as Record<string, unknown>).svgContent = spec.svgContent
    if (spec.kind === 'polygon' || spec.kind === 'star' || spec.kind === 'line') {
      ;(node.props as Record<string, unknown>).pathData = buildVectorPath(spec.kind, {
        pointCount: spec.pointCount,
        innerRadius: spec.innerRadius,
        width: spec.width ?? 0,
        height: spec.height ?? 0,
      })
    } else if (spec.pathData !== undefined) {
      ;(node.props as Record<string, unknown>).pathData = spec.pathData
    }
    this.nodes.set(id, node)

    const target = parent?.id ? parent : null
    if (target) {
      await this.appendChild(this.requireNode(target.id), node)
    } else {
      node.parentId = this.currentPageId
    }
    return node
  }

  getNodeById(id: string): HostNode | null {
    return this.nodes.get(id) ?? null
  }

  async removeNode(node: HostNode): Promise<void> {
    const target = this.requireNode(node.id)
    target.children = []
    if (target.parentId) {
      const parent = this.nodes.get(target.parentId)
      if (parent) parent.children = parent.children.filter((c) => c.id !== target.id)
    }
    this.nodes.delete(target.id)
  }

  async cloneNode(node: HostNode): Promise<HostNode> {
    const source = this.requireNode(node.id)
    const copy: MemoryNode = {
      ...source,
      id: `${source.kind}-${++this.seq}`,
      children: [],
      props: { ...source.props },
    }
    this.nodes.set(copy.id, copy)
    return copy
  }

  async appendChild(parent: HostNode, child: HostNode, index?: number): Promise<void> {
    const p = this.requireNode(parent.id)
    const c = this.requireNode(child.id)
    if (c.parentId) {
      const old = this.nodes.get(c.parentId)
      if (old) old.children = old.children.filter((n) => n.id !== c.id)
    }
    const children = p.children.filter((n) => n.id !== c.id)
    if (index === undefined || index < 0 || index > children.length) {
      children.push(c)
    } else {
      children.splice(index, 0, c)
    }
    p.children = children
    c.parentId = p.id
  }

  async setParentIndex(node: HostNode, index: number): Promise<void> {
    const n = this.requireNode(node.id)
    if (!n.parentId) return
    const parent = this.nodes.get(n.parentId)
    if (!parent) return
    parent.children = parent.children.filter((c) => c.id !== n.id)
    const at = Math.max(0, Math.min(index, parent.children.length))
    parent.children.splice(at, 0, n)
  }

  async group(nodes: HostNode[]): Promise<HostNode> {
    if (!this.capabilities.ops.group) throw new UnsupportedHostFeatureError('group')
    if (nodes.length === 0) throw new HostArgumentError('group 至少需要一个节点')
    const first = this.requireNode(nodes[0].id)
    // 注意：group 不走 createNode —— 两侧宿主都无法「先建空组再塞子节点」
    // （Penpot 的 penpot.group(shapes) 必须在调用时给出成员）。
    const group: MemoryNode = {
      id: `group-${++this.seq}`,
      type: 'group',
      kind: 'group',
      name: 'Group',
      parentId: null,
      children: [],
      props: {},
    }
    this.nodes.set(group.id, group)
    // 子节点的父层可能是「页面」（页面不是节点，不能走 appendChild）
    const parentOfFirst = first.parentId
    if (parentOfFirst && parentOfFirst !== this.currentPageId && this.nodes.has(parentOfFirst)) {
      await this.appendChild(this.requireNode(parentOfFirst), group)
    } else {
      group.parentId = this.currentPageId
    }
    for (const n of nodes) await this.appendChild(group, this.requireNode(n.id))
    return group
  }

  // ── 属性 ──

  async applyProperties(node: HostNode, props: NodeProperties): Promise<ApplyResult> {
    const target = this.requireNode(node.id)
    const applied: string[] = []
    const skipped: PropertySkip[] = []

    const apply = (key: keyof NodeProperties, value: unknown, reason?: string) => {
      if (reason) {
        skipped.push({ property: String(key), reason })
        return
      }
      target.props[key] = value as never
      applied.push(String(key))
    }

    for (const [key, value] of orderedPropertyEntries(props)) {
      switch (key) {
        case 'name':
          target.name = String(value)
          applied.push('name')
          break

        case 'fills': {
          if (!this.capabilities.props.fills) {
            skipped.push({ property: 'fills', reason: '宿主不支持填充' })
            break
          }
          const fills = value as NonNullable<NodeProperties['fills']>
          const blocked = fills.find((fill) => {
            const kind = normalizeFillType(fill.type)
            return (
              ((kind === 'GRADIENT_LINEAR' || kind === 'GRADIENT_RADIAL') && !this.capabilities.props.gradients) ||
              (kind === 'IMAGE' && !this.capabilities.props.imageFills)
            )
          })
          if (blocked) {
            skipped.push({ property: 'fills', reason: `宿主不支持填充类型 ${String(blocked.type)}` })
            break
          }
          apply('fills', fills)
          break
        }

        case 'strokes': {
          const strokes = value as NonNullable<NodeProperties['strokes']>
          const needsSides = strokes.some((s) => s.sides && s.sides.length > 0 && s.sides.length < 4)
          apply('strokes', strokes, !needsSides || this.capabilities.props.perSideStrokes
            ? undefined
            : '宿主无单边描边，已按四边描边落地')
          break
        }

        case 'effects': {
          const effects = value as NonNullable<NodeProperties['effects']>
          const needsBgBlur = effects.some((e) => e.type === 'BACKGROUND_BLUR')
          if (needsBgBlur && !this.capabilities.props.backgroundBlur) {
            skipped.push({ property: 'effects', reason: '宿主不支持背景模糊' })
            break
          }
          apply('effects', effects)
          break
        }

        case 'layoutMode': {
          if (value === 'NONE') {
            apply('layoutMode', value)
            break
          }
          apply('layoutMode', value, this.capabilities.props.autoLayout ? undefined : '宿主不支持自动布局')
          break
        }

        case 'width':
        case 'height': {
          apply(key, value)
          if (this.resizeResetsTextAutoResize && target.kind === 'text') {
            // 模拟 Penpot：resize 会把 growType 打回 fixed，对应本 DSL 语义的 textAutoResize='NONE'
            target.props.textAutoResize = 'NONE'
          }
          break
        }

        default: {
          const isTextProp = key === 'characters' || key === 'fontSize' || key === 'fontName' ||
            key === 'fontWeight' || key === 'lineHeight' || key === 'letterSpacing' ||
            key === 'textAlignHorizontal' || key === 'textAlignVertical' || key === 'textAutoResize'
          apply(key, value, isTextProp && target.kind !== 'text' ? `属性 ${key} 仅适用于文本节点` : undefined)
          break
        }
      }
    }

    return { applied, skipped }
  }

  /**
   * pluginData 的替身：真实宿主是 `shape.getPluginData(key)`，这里读 `props.pluginData` 这个口袋。
   * 单边描边的规格键（mgmcp:sideBorderSpecs）由测试直接预置 —— 因为**模拟单边描边本身是
   * Penpot 专有的**（Penpot 原生没有 per-side，MasterGo/内存宿主走原生字段）。
   */
  getNodePluginData(node: HostNode, key: string): string | undefined {
    const bag = (this.requireNode(node.id).props as Record<string, unknown>).pluginData as
      | Record<string, string>
      | undefined
    return bag?.[key]
  }

  readProperties(node: HostNode, fields: readonly string[]): Record<string, unknown> {
    const target = this.requireNode(node.id)
    const out: Record<string, unknown> = {}
    for (const field of fields) {
      switch (field) {
        case 'id':
          out.id = target.id
          break
        case 'type':
          out.type = target.type
          break
        case 'kind':
          out.kind = target.kind
          break
        case 'pathData':
          out.pathData = (target.props as Record<string, unknown>).pathData
          break
        /**
         * 四个标志按**官方语义**建模（不是按名字猜）：
         *   isComponentInstance     = 在组件实例内部（母版或副本都算）→ 实例本身及其子节点
         *   isComponentMainInstance = 在组件**母版**内部 → 母版本身及其子节点
         *   isComponentCopyInstance = 在组件**副本实例**内部 → 副本本身及其子节点
         *   isComponentRoot         = 组件树的根 → 母版是根，副本的根**也是**
         */
        case 'isComponentInstance':
          out.isComponentInstance = target.kind === 'instance' ||
            this.isUnderInstance(target.id) ||
            this.components.some((component) => component.masterNodeId === target.id) ||
            this.isUnder(target.id, this.components.map((c) => c.masterNodeId).filter(Boolean) as string[])
          break
        case 'isComponentMainInstance':
          out.isComponentMainInstance = (target.props as Record<string, unknown>).isComponentMainInstance === true ||
            this.components.some((component) => component.masterNodeId === target.id) ||
            this.isUnder(target.id, this.components.map((c) => c.masterNodeId).filter(Boolean) as string[])
          break
        case 'isComponentCopyInstance':
          out.isComponentCopyInstance = (target.props as Record<string, unknown>).isComponentCopyInstance === true ||
            (target.kind === 'instance' && (target.props as Record<string, unknown>).isComponentMainInstance !== true)
          break
        case 'isComponentRoot':
          out.isComponentRoot = (target.props as Record<string, unknown>).isComponentRoot === true ||
            target.kind === 'instance' ||
            this.components.some((component) => component.masterNodeId === target.id)
          break
        case 'componentId':
          out.componentId = (target.props as Record<string, unknown>).componentId
          break
        case 'name':
          out.name = target.name
          break
        /**
         * 真 Penpot 的 `shape.visible` 永远是布尔值（默认 true），这里按同样口径建模。
         *
         * 为什么必须显式建模：默认分支只回 `props.visible`（没设过就是 `undefined`），
         * 于是「无条件把 visible 记进按名覆写表」这类只在真机才暴露的缺陷，
         * 在 MemoryHost 下测不出来（真机 `carriedOver` 被虚增，单测全绿）。
         * 见 `lib/api/swapComponentHandlers.ts > collectCarryOver` 与
         * `tests/swap-component.test.ts > carriedOver 只算真的带过的项`。
         */
        case 'visible':
          out.visible = (target.props as Record<string, unknown>).visible !== false
          break
        case 'parentId':
          out.parentId = target.parentId
          break
        case 'childCount':
          out.childCount = target.children.length
          break
        case 'children':
          out.children = target.children.map((c) => c.id)
          break
        default:
          out[field] = target.props[field as keyof NodeProperties]
          break
      }
    }
    return out
  }

  // ── 资源 ──

  async loadFonts(requests: readonly FontRequest[]): Promise<void> {
    this.loadedFonts.push(...requests)
  }

  // ── 导出（内存宿主：返回可预测的占位数据，供单测断言契约） ──

  async exportNode(node: HostNode, options: ExportOptions): Promise<ExportResult> {
    const target = this.requireNode(node.id)
    const notes: string[] = []
    let scale = options.scale ?? 1
    if (options.width !== undefined && target.props.width) {
      scale = options.width / Number(target.props.width)
      notes.push(`按固定宽度 ${options.width} 换算为 scale=${scale}`)
    } else if (options.height !== undefined && target.props.height) {
      scale = options.height / Number(target.props.height)
      notes.push(`按固定高度 ${options.height} 换算为 scale=${scale}`)
    }
    const isText = options.format === 'SVG'
    const mime: Record<string, string> = {
      PNG: 'image/png', JPG: 'image/jpeg', WEBP: 'image/webp', SVG: 'image/svg+xml', PDF: 'application/pdf',
    }
    return {
      format: options.format.toLowerCase(),
      mimeType: mime[options.format] ?? 'application/octet-stream',
      isText,
      data: isText ? '<svg/>' : 'BASE64',
      scale,
      notes,
    }
  }

  /** 注册过的组件（单测里由 createComponent 填充） */
  readonly components: HostComponentInfo[] = []

  async booleanOperation(nodes: readonly HostNode[], operation: BooleanOperation): Promise<HostNode> {
    if (!this.capabilities.ops.booleanOps) throw new UnsupportedHostFeatureError('booleanOperation')
    if (nodes.length < 2) throw new HostArgumentError('布尔运算至少需要 2 个节点')
    const first = this.requireNode(nodes[0].id)
    // ⚠️ 顶层节点的 parentId 是**页面 id**，不是节点 —— 直接 requireNode 会抛「节点不存在: page-1」
    const parentNode = first.parentId && first.parentId !== this.currentPageId && this.nodes.has(first.parentId)
      ? this.requireNode(first.parentId)
      : null
    const node = await this.createNode({ kind: 'boolean', name: `${operation} 结果` }, parentNode)
    // 记录运算类型，便于单测断言（NodeProperties 没有该字段，故走宽松索引）
    ;((node as MemoryNode).props as Record<string, unknown>).booleanOperation = operation
    for (const n of nodes) await this.appendChild(node, this.requireNode(n.id))
    return node
  }

  async createComponent(
    nodes: readonly HostNode[],
    name?: string,
  ): Promise<{ componentId: string; nodeId: string; name: string }> {
    if (!this.capabilities.ops.createComponent) throw new UnsupportedHostFeatureError('createComponent')
    if (!nodes.length) throw new HostArgumentError('createComponent 至少需要 1 个节点')
    const master = this.requireNode(nodes[0].id)
    const componentName = name ?? master.name
    const componentId = `component-${this.components.length + 1}`
    this.components.push({ id: componentId, name: componentName, isLocal: true, masterNodeId: master.id })
    return { componentId, nodeId: master.id, name: componentName }
  }

  async detachInstance(node: HostNode): Promise<{ detached: boolean; note?: string }> {
    const target = this.requireNode(node.id)
    const wasInstance = target.kind === 'instance'
    // SAFETY: MemoryHost 自己造节点就是普通可变对象（kind/type 均为普通字段），
    // 断言成可变形状只为了把 "instance" 原地降级成 frame —— 与 PenpotHost.detach 的语义对齐。
    const mutable = target as unknown as { kind: string; type: string }
    mutable.kind = 'frame'
    mutable.type = 'board'
    return { detached: true, note: wasInstance ? undefined : '该节点本来就不是实例（分离操作无害）' }
  }

  async listComponents(): Promise<HostComponentInfo[]> {
    return [...this.components]
  }

  // ── 组件实例化 / 变体（内存实现） ──

  async instantiateComponent(input: {
    componentId?: string
    componentName?: string
    libraryName?: string
    parent?: HostNode | null
    x?: number
    y?: number
    width?: number
    height?: number
    name?: string
  }): Promise<{ nodeId: string; componentId: string; componentName: string; libraryName?: string }> {
    if (!this.capabilities.ops.componentInstances) throw new UnsupportedHostFeatureError('instantiateComponent')
    // ⚠️ 必须尊重 libraryName：忽略它会让「指定了不存在的库」也能实例化成功，
    // 于是「库未连接」这类真实失败在单测里永远测不出来。
    const wantedLibrary = input.libraryName?.trim().toLowerCase()
    if (wantedLibrary) {
      const known = this.components.some(
        (candidate) =>
          (candidate.libraryName ?? '').trim().toLowerCase() === wantedLibrary ||
          candidate.libraryId === input.libraryName,
      )
      if (!known) {
        throw new HostArgumentError(
          `团队库未连接或不存在: ${input.libraryName}（Penpot 需先在 UI 里连接该库；本插件暂未接线 connectLibrary）`,
        )
      }
    }

    const component = this.components.find((candidate) => {
      if (wantedLibrary) {
        const inLibrary =
          (candidate.libraryName ?? '').trim().toLowerCase() === wantedLibrary ||
          candidate.libraryId === input.libraryName
        if (!inLibrary) return false
      }
      if (input.componentId) return candidate.id === input.componentId
      return Boolean(input.componentName) && candidate.name === input.componentName
    })
    if (!component) {
      throw new HostArgumentError(
        `组件未找到: ${input.componentId ?? input.componentName}` +
          (input.libraryName ? `（库 ${input.libraryName}）` : ''),
      )
    }

    const node = await this.createNode(
      { kind: 'instance', name: input.name ?? component.name, x: input.x, y: input.y, width: input.width, height: input.height },
      input.parent ?? null,
    )
    ;((node as MemoryNode).props as Record<string, unknown>).componentId = component.id

    // 复制组件内容（真实宿主的 instance() 自带内容）
    for (const child of this.componentTemplates.get(component.id) ?? []) {
      await this.createNode(
        child.characters === undefined
          ? { kind: 'frame', name: child.name }
          : { kind: 'text', name: child.name, characters: child.characters, width: 100, height: 20 },
        node,
      )
    }

    return { nodeId: node.id, componentId: component.id, componentName: component.name, libraryName: input.libraryName }
  }

  /** 选区变化订阅者（单测可调 `__fireSelectionChange()` 触发） */
  private selectionListeners: (() => void)[] = []

  observeSelection(callback: () => void): () => void {
    this.selectionListeners.push(callback)
    return () => {
      this.selectionListeners = this.selectionListeners.filter((cb) => cb !== callback)
    }
  }

  /** 测试辅助：模拟宿主触发一次选区变化事件 */
  __fireSelectionChange(): void {
    for (const listener of [...this.selectionListeners]) listener()
  }

  /** 某节点是否在某个实例子树内 */
  private isUnderInstance(nodeId: string): boolean {
    const instances = this.flatten().filter((node) => node.kind === 'instance')
    return this.isUnder(nodeId, instances.map((node) => node.id))
  }

  /** 某节点（含自身）是否在给定根之一的子树内 */
  private isUnder(nodeId: string, rootIds: readonly string[]): boolean {
    let current = this.getNodeById(nodeId)
    while (current) {
      if (rootIds.includes(current.id)) return true
      const parentId = this.readProperties(current, ['parentId']).parentId as string | null
      current = parentId ? this.getNodeById(parentId) : null
    }
    return false
  }

  /** 对齐/分布调用记录（单测断言用） */
  readonly alignCalls: { axis: string; direction?: string; nodeIds: string[] }[] = []

  /** 取若干节点的几何盒（对齐/分布共用；缺失字段按 0，与真实宿主「坐标恒有值」对齐） */
  private shapeBoxes(nodes: readonly HostNode[]): AlignBox[] {
    return nodes.map((node) => {
      const props = this.requireNode(node.id).props as Record<string, unknown>
      return {
        x: Number(props.x ?? 0), y: Number(props.y ?? 0),
        width: Number(props.width ?? 0), height: Number(props.height ?? 0),
      }
    })
  }

  /** 把对齐/分布算出的位移写回节点（只写非零分量，避免无谓改动） */
  private applyDeltas(nodes: readonly HostNode[], deltas: readonly AlignDelta[]): void {
    nodes.forEach((node, index) => {
      const props = this.requireNode(node.id).props as Record<string, unknown>
      if (deltas[index].dx) props.x = Number(props.x ?? 0) + deltas[index].dx
      if (deltas[index].dy) props.y = Number(props.y ?? 0) + deltas[index].dy
    })
  }

  /**
   * 对象之间对齐（替身实现 = 与 handler 兜底**同一份几何算法** `lib/align.ts`）。
   * 这样"宿主原生路径"和"兜底路径"在替身上结果一致，测试能直接断言坐标，而不是只断言"调用了"。
   */
  async alignNodes(
    nodes: readonly HostNode[],
    input: { axis: 'HORIZONTAL' | 'VERTICAL'; direction: 'MIN' | 'CENTER' | 'MAX' },
  ): Promise<void> {
    if (!this.capabilities.ops.alignNodes) {
      throw new UnsupportedHostFeatureError('alignNodes', '宿主未提供对齐能力')
    }
    this.alignCalls.push({ axis: input.axis, direction: input.direction, nodeIds: nodes.map((n) => n.id) })

    this.applyDeltas(nodes, computeAlignment(this.shapeBoxes(nodes), input.axis, input.direction))
  }

  /** 对象之间等距分布（替身实现同上，共用 `lib/align.ts`） */
  async distributeNodes(nodes: readonly HostNode[], input: { axis: 'HORIZONTAL' | 'VERTICAL' }): Promise<void> {
    if (!this.capabilities.ops.alignNodes) {
      throw new UnsupportedHostFeatureError('distributeNodes', '宿主未提供分布能力')
    }
    this.alignCalls.push({ axis: input.axis, nodeIds: nodes.map((n) => n.id) })

    this.applyDeltas(nodes, computeDistribution(this.shapeBoxes(nodes), input.axis))
  }

  /** 撤销块记录（单测断言用） */
  readonly undoBlocks: { label: string; opened: number; closed: number }[] = []
  private undoDepth = 0

  /**
   * 撤销块替身：按 begin/finish 计数（真实宿主是 `history.undoBlockBegin/Finish`）。
   * 刻意记录 `opened`/`closed` 两个计数 —— 忘了闭合（或异常路径漏了 finally）就能被断言抓到。
   */
  async withUndoBlock<T>(label: string, run: () => Promise<T>): Promise<T> {
    const record = { label, opened: this.undoDepth + 1, closed: 0 }
    this.undoDepth += 1
    this.undoBlocks.push(record)
    try {
      return await run()
    } finally {
      this.undoDepth -= 1
      record.closed = this.undoDepth
    }
  }

  /** 原生换组件调用记录（单测断言用） */
  readonly swaps: { nodeId: string; componentId?: string; componentName?: string }[] = []
  /** resetOverrides 调用记录 */
  readonly resets: string[] = []

  /**
   * 原生换组件替身：只改归属与名字，**几何与子节点保持**（真实宿主的
   * `swapComponent` 是"尽可能保留覆写"，不会把实例挪走）。
   */
  async swapComponent(
    node: HostNode,
    input: { componentId?: string; componentName?: string; libraryName?: string },
  ): Promise<{ componentId: string; componentName: string }> {
    if (!this.capabilities.ops.swapComponent) {
      throw new UnsupportedHostFeatureError('swapComponent', '宿主未提供 shape.swapComponent（旧版 Penpot）')
    }
    const target = this.requireNode(node.id)
    const components = await this.listComponents()
    const found = components.find((component) =>
      (input.componentId && component.id === input.componentId) ||
      (input.componentName && component.name === input.componentName))
    if (!found) {
      throw new HostArgumentError(`组件未找到: ${input.componentId ?? input.componentName}`)
    }
    this.swaps.push({ nodeId: node.id, componentId: found.id, componentName: found.name })
    ;(target.props as Record<string, unknown>).componentId = found.id
    return { componentId: found.id, componentName: found.name }
  }

  async resetOverrides(node: HostNode): Promise<void> {
    const target = this.requireNode(node.id)
    this.resets.push(node.id)
    delete (target.props as Record<string, unknown>).overrides
  }

  /** 变体集记录（单测断言用） */
  readonly variantSets: {
    containerId: string
    propertyName: string
    values: string[]
    nodeIds: string[]
    /** 请求的容器名（`createVariants` 的 options.containerName） */
    containerName?: string
  }[] = []

  async createVariants(
    nodes: readonly HostNode[],
    propertyName: string,
    values: readonly string[],
    options: CreateVariantsOptions = {},
  ): Promise<CreateVariantsResult> {
    if (!this.capabilities.ops.componentVariants) {
      return { ok: false, reason: '宿主不支持组件变体（capabilities.ops.componentVariants 为 false）' }
    }
    if (nodes.length < 2) return { ok: false, reason: '变体集至少需要 2 个节点' }

    const containerId = `variants-${this.variantSets.length + 1}`
    this.variantSets.push({
      containerId,
      propertyName,
      values: [...values],
      nodeIds: nodes.map((node) => node.id),
      ...(options.containerName !== undefined ? { containerName: options.containerName } : {}),
    })
    return {
      ok: true,
      containerId,
      componentIds: nodes.map((_, index) => `${containerId}-comp-${index + 1}`),
      ...(options.containerName !== undefined ? { containerName: options.containerName } : {}),
    }
  }

  async createColorStyle(input: { name: string; color: string; opacity?: number; description?: string }): Promise<HostColorStyle> {
    const normalized = normalizeColor(input.color, input.opacity)
    if (!normalized) throw new HostArgumentError(`createColorStyle: 色值无法识别: ${input.color}`)
    const style: HostColorStyle = {
      id: `paint-${this.colorStyles.length + 1}`,
      name: input.name,
      color: normalized.hex,
      opacity: input.opacity ?? normalized.opacity,
      isLocal: true,
    }
    this.colorStyles.push(style)
    return { ...style }
  }

  async createTextStyle(input: {
    name: string
    fontFamily?: string
    fontSize?: string | number
    fontWeight?: string | number
    lineHeight?: string | number
    letterSpacing?: string | number
    description?: string
  }): Promise<HostTextStyle> {
    const style: HostTextStyle = {
      id: `text-${this.textStyles.length + 1}`,
      name: input.name,
      isLocal: true,
      fontFamily: input.fontFamily,
      fontSize: input.fontSize === undefined ? undefined : String(input.fontSize),
      fontWeight: input.fontWeight === undefined ? undefined : String(input.fontWeight),
      lineHeight: input.lineHeight === undefined ? undefined : String(input.lineHeight),
      letterSpacing: input.letterSpacing === undefined ? undefined : String(input.letterSpacing),
    }
    this.textStyles.push(style)
    return { ...style }
  }

  /** 按名 upsert 的颜色样式（找不到返回 null）——与 penpot-styles.updateColorStyle 同语义 */
  async updateColorStyle(input: { name: string; color: string; opacity?: number; description?: string }): Promise<HostColorStyle | null> {
    const existing = this.colorStyles.find((style) => styleNameMatches(style.name, input.name))
    if (!existing) return null
    const normalized = normalizeColor(input.color, input.opacity)
    if (!normalized) throw new HostArgumentError(`updateColorStyle: 色值无法识别: ${input.color}`)
    existing.color = normalized.hex
    existing.opacity = input.opacity ?? normalized.opacity
    return { ...existing }
  }

  /** 按名 upsert 的文本样式（找不到返回 null）——与 penpot-styles.updateTextStyle 同语义 */
  async updateTextStyle(input: {
    name: string
    fontFamily?: string
    fontSize?: string | number
    fontWeight?: string | number
    lineHeight?: string | number
    letterSpacing?: string | number
    description?: string
  }): Promise<HostTextStyle | null> {
    const existing = this.textStyles.find((style) => styleNameMatches(style.name, input.name))
    if (!existing) return null
    if (input.fontFamily !== undefined) existing.fontFamily = input.fontFamily
    if (input.fontSize !== undefined) existing.fontSize = String(input.fontSize)
    if (input.fontWeight !== undefined) existing.fontWeight = String(input.fontWeight)
    if (input.lineHeight !== undefined) existing.lineHeight = String(input.lineHeight)
    if (input.letterSpacing !== undefined) existing.letterSpacing = String(input.letterSpacing)
    return { ...existing }
  }

  /**
   * 宿主原生 CSS 生成 —— 内存宿主**不实现**（Penpot 才有 generateStyle/generateFontFaces），
   * 如实返回 `available:false`，让上层走降级分支而不是拿到假 CSS。
   */
  async generateCss(nodes: readonly HostNode[]): Promise<{
    available: boolean
    css: string
    fontFaces: string
    nodeCount: number
    reason?: string
  }> {
    return { available: false, css: '', fontFaces: '', nodeCount: nodes.length, reason: 'MemoryHost 未提供 penpot.generateStyle' }
  }

  /** 富文本 run（P2-3）——与 penpot-text 同语义：整体写 characters，记录 runs 供读回 */
  async applyTextRuns(
    node: HostNode,
    runs: readonly HostTextRun[],
  ): Promise<{ applied: boolean; runCount: number; characters: number; note?: string }> {
    const target = node as MemoryNode
    if (target.kind !== 'text') throw new HostArgumentError(`applyTextRuns 需要文本节点（当前 ${target.kind}）`)
    if (!runs.length) return { applied: false, runCount: 0, characters: 0, note: 'runs 为空' }
    const content = runs.map((run) => run.text).join('')
    target.props.characters = content
    target.textRuns = runs.map((run) => ({ ...run }))
    return { applied: true, runCount: runs.length, characters: content.length }
  }

  readTextRuns(node: HostNode): HostTextRun[] {
    const target = node as MemoryNode
    if (target.kind !== 'text') throw new HostArgumentError(`readTextRuns 需要文本节点（当前 ${target.kind}）`)
    return (target.textRuns ?? []).map((run) => ({ ...run }))
  }

  /**
   * 单测可预置的「组件内容」：组件 id → 子节点描述。
   * 实例化时复制成子树 —— 真实宿主的 `component.instance()` 本来就带内容，
   * 替身没有这层建模就测不了「按图层名带过文字」。
   */
  readonly componentTemplates = new Map<string, { name: string; characters?: string }[]>()

  /** 内存里可切换的变体属性（单测可预置） */
  readonly variantSwitches: { nodeId: string; propertyName: string; value: string }[] = []
  /** 预置为"不是变体实例"的节点 id，用于测试回退说明 */
  readonly nonVariantNodes = new Set<string>()

  async switchVariant(
    node: HostNode,
    propertyName: string,
    value: string,
  ): Promise<{ switched: boolean; note?: string }> {
    if (this.nonVariantNodes.has(node.id) || this.requireNode(node.id).kind !== 'instance') {
      return { switched: false, note: '该节点不是变体实例（Penpot 的 switchVariant 只在变体实例上可用）' }
    }
    this.variantSwitches.push({ nodeId: node.id, propertyName, value })
    return { switched: true }
  }

  // ── 设计令牌（内存实现：可创建/更新/删除，供单测与离线干跑） ──

  private tokenSets: HostTokenSet[] = []

  async listTokenSets(): Promise<HostTokenSet[]> {
    return this.tokenSets.map((set) => ({ ...set, tokens: set.tokens.map((token) => ({ ...token })) }))
  }

  async createToken(input: {
    name: string
    type: string
    value: string
    setName?: string
    description?: string
  }): Promise<{ token: HostToken; setId: string; setName: string; created: boolean }> {
    const setName = input.setName ?? 'Design Tokens'
    let set = this.tokenSets.find((candidate) => candidate.name === setName)
    if (!set) {
      set = { id: `set-${this.tokenSets.length + 1}`, name: setName, active: true, tokens: [] }
      this.tokenSets.push(set)
    }
    const existing = set.tokens.find((token) => token.name === input.name)
    if (existing) {
      existing.value = input.value
      if (input.description !== undefined) existing.description = input.description
      return { token: { ...existing }, setId: set.id, setName: set.name, created: false }
    }
    const token: HostToken = {
      id: `token-${set.tokens.length + 1}-${setName}`,
      name: input.name,
      hostType: input.type,
      value: input.value,
      description: input.description,
    }
    set.tokens.push(token)
    return { token: { ...token }, setId: set.id, setName: set.name, created: true }
  }

  async updateToken(input: {
    name: string
    value?: string
    description?: string
    setName?: string
  }): Promise<{ token: HostToken; updated: string[] }> {
    const found = this.findMemoryToken(input.name, input.setName)
    if (!found) throw new HostArgumentError(`令牌不存在: ${input.name}`)
    const updated: string[] = []
    if (input.value !== undefined) {
      found.token.value = input.value
      updated.push('value')
    }
    if (input.description !== undefined) {
      found.token.description = input.description
      updated.push('description')
    }
    return { token: { ...found.token }, updated }
  }

  async deleteToken(input: { name: string; setName?: string }): Promise<{ deleted: string }> {
    const found = this.findMemoryToken(input.name, input.setName)
    if (!found) throw new HostArgumentError(`令牌不存在: ${input.name}`)
    found.set.tokens = found.set.tokens.filter((token) => token.name !== input.name)
    return { deleted: input.name }
  }

  async renameToken(input: { name: string; newName: string; setName?: string }): Promise<{ token: HostToken; renamed: boolean }> {
    const found = this.findMemoryToken(input.name, input.setName)
    if (!found) throw new HostArgumentError(`令牌不存在: ${input.name}`)
    const renamed = found.token.name !== input.newName
    if (renamed) found.token.name = input.newName
    return { token: { ...found.token }, renamed }
  }

  /**
   * 内存宿主不实现令牌绑定（`tokenBinding: false`）。
   *
   * 刻意**不假装成功**：`applied: false` + 原因，这样 handler 层的 available:false 分支
   * 与降级文案都能在单测里被覆盖到。
   */
  async applyToken(
    _node: HostNode,
    tokenName: string,
    properties: readonly string[] = ['fill'],
  ): Promise<{ applied: boolean; properties: string[]; bound: Record<string, string>; note?: string }> {
    return {
      applied: false,
      properties: [...properties],
      bound: {},
      note: `内存宿主不支持令牌绑定（${tokenName}）`,
    }
  }

  readNodeTokens(_node: HostNode): Record<string, string> {
    return {}
  }

  /** 内存宿主：直接改集合的 active 标志（Penpot 侧要过 `toggleActive()`） */
  async setTokenSetActive(input: {
    setName?: string
    tokenName?: string
    active: boolean
  }): Promise<{ changed: boolean; active: boolean; setName: string; note?: string }> {
    const set =
      (input.tokenName ? this.findMemoryToken(input.tokenName, input.setName)?.set : undefined) ??
      (input.setName ? this.tokenSets.find((candidate) => candidate.name === input.setName) : undefined)
    if (!set) throw new HostArgumentError('找不到令牌集合（需要 setName 或 tokenName）')

    const before = set.active !== false
    if (before === input.active) return { changed: false, active: before, setName: set.name }
    set.active = input.active
    return { changed: true, active: set.active, setName: set.name }
  }

  /** 内存宿主不实现令牌传播（`tokenBinding: false`）—— 如实返回 0，不假装成功 */
  async propagateToken(input: {
    tokenName: string
    setName?: string
    properties?: readonly string[]
  }): Promise<{ matched: number; rewritten: number; rebound: number; mechanism: string; note?: string }> {
    const found = this.findMemoryToken(input.tokenName, input.setName)
    if (!found) throw new HostArgumentError(`令牌不存在: ${input.tokenName}`)
    return {
      matched: 0,
      rewritten: 0,
      rebound: 0,
      mechanism: 'none',
      note: '内存宿主不实现令牌传播（tokenBinding: false）',
    }
  }

  private findMemoryToken(name: string, setName?: string): { token: HostToken; set: HostTokenSet } | null {
    for (const set of this.tokenSets) {
      if (setName && set.name !== setName) continue
      const token = set.tokens.find((candidate) => candidate.name === name)
      if (token) return { token, set }
    }
    return null
  }

  // ── 样式资产（内存实现） ──

  /** 单测可预置的样式资产 */
  readonly colorStyles: HostColorStyle[] = []
  readonly textStyles: HostTextStyle[] = []

  async listColorStyles(): Promise<HostColorStyle[]> {
    return this.colorStyles.map((style) => ({ ...style }))
  }

  async listTextStyles(): Promise<HostTextStyle[]> {
    return this.textStyles.map((style) => ({ ...style }))
  }

  async applyStyle(
    node: HostNode,
    styleId: string,
    styleType: 'fill' | 'stroke' | 'text',
  ): Promise<{ applied: boolean; note?: string }> {
    const target = this.requireNode(node.id)

    if (styleType === 'text') {
      const style = this.textStyles.find((candidate) => candidate.id === styleId)
      if (!style) throw new HostArgumentError(`文本样式不存在: ${styleId}`)
      if (target.kind !== 'text') return { applied: false, note: `目标节点是 ${target.kind}，文本样式只能应用到文本节点` }
      target.props.fontSize = style.fontSize ? Number(style.fontSize) : target.props.fontSize
      target.props.fontWeight = style.fontWeight ? Number(style.fontWeight) : target.props.fontWeight
      return { applied: true }
    }

    const style = this.colorStyles.find((candidate) => candidate.id === styleId)
    if (!style) throw new HostArgumentError(`颜色样式不存在: ${styleId}`)
    const fill = { type: 'SOLID', color: style.color ?? '#000000', opacity: style.opacity ?? 1 }
    if (styleType === 'fill') target.props.fills = [fill]
    else target.props.strokes = [{ color: style.color ?? '#000000', width: 1, opacity: style.opacity ?? 1 }]
    return { applied: true }
  }

  /** 内存宿主的“可用字体”：把已加载过的字体报回去（便于单测断言） */
  async listFonts(): Promise<HostFontInfo[]> {
    return this.loadedFonts.map((request) => ({ family: request.family, style: request.style }))
  }

  // ── 文档 / 页面 / 选区 ──

  getDocumentInfo(): HostDocumentInfo {
    const page = this.pages.find((p) => p.id === this.currentPageId)
    return {
      host: this.id,
      codename: this.documentCodename,
      documentId: 'memory-document',
      documentName: this.documentName,
      pageId: page?.id,
      pageName: page?.name,
      hostVersion: 'memory',
    }
  }

  /** 会话代号（替身：仅内存；默认 'Memory'） */
  private documentCodename = 'Memory'

  getDocumentCodename(): string {
    return this.documentCodename
  }

  setDocumentCodename(name: string): string {
    const trimmed = String(name ?? '').trim()
    if (trimmed) this.documentCodename = trimmed
    return this.documentCodename
  }

  getSelection(): readonly HostNode[] {
    return this.selectionIds.map((id) => this.requireNode(id))
  }

  async setSelection(nodes: readonly HostNode[]): Promise<void> {
    this.selectionIds = nodes.map((n) => n.id)
  }

  listPages(): readonly HostPageInfo[] {
    return this.pages
  }

  getCurrentPage(): HostPageInfo | null {
    return this.pages.find((p) => p.id === this.currentPageId) ?? null
  }

  getPageRootNodes(): readonly HostNode[] {
    return this.nodesInPage(this.currentPageId)
  }

  async switchPage(pageId: string): Promise<void> {
    if (!this.pages.some((p) => p.id === pageId)) throw new HostArgumentError(`页面不存在: ${pageId}`)
    this.currentPageId = pageId
  }

  async createPage(name: string): Promise<HostPageInfo> {
    const page: HostPageInfo = { id: `page-${this.pages.length + 1}`, name }
    this.pages.push(page)
    return page
  }

  async renamePage(pageId: string, name: string): Promise<{ applied: boolean; name: string; reason?: string }> {
    const page = this.pages.find((p) => p.id === pageId)
    if (!page) throw new HostArgumentError(`页面不存在: ${pageId}`)
    page.name = name
    return { applied: page.name === name, name: page.name }
  }

  // ── 视图 / 交互 ──

  async zoomToNodes(nodes: readonly HostNode[]): Promise<void> {
    this.zoomLog.push(nodes.map((n) => n.id))
  }

  notify(message: string, kind: NotifyKind = 'info'): void {
    this.notifications.push({ message, kind })
  }

  async waitForLayoutUpdate(): Promise<void> {
    /* 内存宿主布局即时生效 */
  }

  // ── 断言辅助 ──

  /** 取当前页树的快照（测试断言用） */
  toTree(rootId?: string): MemoryNode[] {
    if (rootId) return [this.requireNode(rootId)]
    return this.nodesInPage(this.currentPageId)
  }

  /** 扁平列出当前页所有节点（含嵌套） */
  flatten(): MemoryNode[] {
    const out: MemoryNode[] = []
    const walk = (nodes: MemoryNode[]) => {
      for (const n of nodes) {
        out.push(n)
        walk(n.children)
      }
    }
    walk(this.nodesInPage(this.currentPageId))
    return out
  }

  private nodesInPage(pageId: string): MemoryNode[] {
    return [...this.nodes.values()].filter((n) => n.parentId === pageId)
  }

  private requireNode(id: string): MemoryNode {
    const node = this.nodes.get(id)
    if (!node) throw new HostNodeNotFoundError(id)
    return node
  }
}
