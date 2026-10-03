/**
 * PenpotHost —— `HostAdapter` 的 Penpot 实现
 *
 * 映射规格来源：`内部笔记`「七、概念映射表」与「12.5 能力缺口」。
 * 字段名/枚举值以本仓库 `typings/penpot.d.ts` 为准（本项目自持的 Penpot 子集声明）。
 * 上游 `api_types.yml` / `api.yml` 不在本仓库，注释里对其的引用均未经本仓库核对。
 *
 * 实现纪律
 * ---------------------------------------------------------------
 * 1. **探测不得有副作用**。能力探测只读 `typeof`，绝不为了探测而 `createBoard()` ——
 *    那会在用户的文档里留下 undo 记录。需要真实实例才能判定的能力（flex/grid）采用
 *    「首次接触真实 board 时惰性确认」。
 * 2. **不静默丢属性**。凡是映射不了的，写进 `ApplyResult.skipped` 并给出原因。
 * 3. **一律用 `insertChild`**。官方 instruction 明确 `appendChild` 在 board 上有问题，
 *    且 flex 的 row/column 下子元素顺序会反转 —— `insertChild(index, child)` 可控。
 * 4. **按簇拆分的适配层**。本文件只保留：能力探测、节点生命周期、属性应用（几何先于文本的
 *    阶段顺序见 `apply-order.ts`）、导出、文档/页面/选区，以及每个簇模块的**薄委托**
 *    （1–3 行）+ 一个组装 deps 的私有方法。各簇实现就在同目录：
 *    单边描边 → `penpot-side-borders.ts`；组件/实例/变体 → `penpot-components.ts`；
 *    样式资产与字体 → `penpot-styles.ts`；设计令牌 + 绑定 + 传播 → `penpot-tokens.ts`；
 *    形状/库的窄化读取 → `penpot-runtime.ts`。
 *    依赖方向**单向**：host → 模块（模块内不反向摸 `PenpotHost`，宿主原语经窄 deps 接口传入）。
 *    旧单文件规则 R1 在拆簇后升级为层次规则 R1'，见 README「约定（续）」与 `tests/host-isolation.test.ts`。
 */
import { HostArgumentError, HostNodeNotFoundError, UnsupportedHostFeatureError } from './errors'
import { orderedPropertyEntries } from './apply-order'
import { normalizeColor } from './color'
import { fromPenpotEffects, fromPenpotFills, fromPenpotStrokes } from './penpot-read'
import { HOST_SCAN_BUDGET, connectTeamLibraries as connectTeamLibrariesAtRuntime, containerChildren, flexOf, getChildren } from './penpot-runtime'
import { analyzeSimpleSvg, normalizeSvgSize } from './svg-import'
import { buildVectorPath, type VectorKind } from './vector-shapes'
import * as components from './penpot-components'
import * as styles from './penpot-styles'
import * as sideBorders from './penpot-side-borders'
import * as tokens from './penpot-tokens'
import * as textRuns from './penpot-text'
import { penpotCapFor, toPenpotEffects, toPenpotFills, toPenpotStrokes } from './penpot-paint'
import { isFillVisible, normalizeFillType } from './gradient'
import { decodeBase64, inlineMediaName, mimeTypeFromUrl, penpotMediaRejection, sniffImageMime, utf8Bytes, utf8Decode } from './media'
import {
  PENPOT_CORNER_KEYS,
  PENPOT_PADDING_KEYS,
  mapBlendMode,
  mapCounterAxis,
  mapGrowType,
  mapPrimaryAxis,
  mapSizing,
  mapStrokeAlignment,
  mapTextAlign,
  mapTextVerticalAlign,
} from './penpot-enums'
import type {
  ApplyResult,
  BooleanOperation,
  CreateVariantsOptions,
  CreateVariantsResult,
  ExportFormat,
  ExportOptions,
  ExportResult,
  FontName,
  HostColorStyle,
  HostComponentInfo,
  FontRequest,
  HostFontInfo,
  HostAdapter,
  HostCapabilities,
  HostDocumentInfo,
  HostEffect,
  HostFill,
  HostNode,
  HostPageInfo,
  HostStroke,
  HostTextRun,
  HostTextStyle,
  HostToken,
  HostTokenSet,
  NodeKind,
  NodeProperties,
  NodeSpec,
  NotifyKind,
  PropertySkip,
  TeamLibraryConnectionInfo,
} from './types'

// ═══════════════════════════════════════════════════════════
// 颜色 / 单位转换
// ═══════════════════════════════════════════════════════════

/**
 * @deprecated 改用 `host/color.ts#normalizeColor`。
 * 保留只是为了不让旧调用点编译失败；新代码不要用。
 */
export function splitHexColor(input: string, fallbackOpacity?: number): { hex: string; opacity: number } {
  return normalizeColor(input, fallbackOpacity) ?? { hex: '', opacity: fallbackOpacity ?? 1 }
}

// ═══════════════════════════════════════════════════════════
// PenpotHost
// ═══════════════════════════════════════════════════════════

/** 会话代号：按文档持久化（见 `penpot-codename.ts`）—— 多 session 的区分依据 */
import * as codename from './penpot-codename'

/** 能通过 createNode 创建的 kind。group 必须走 group(nodes)，故不在列。 */
/**
 * 能通过 createNode 创建的 kind。
 *
 * `group` 必须走 group(nodes)，故不在列。
 * `polygon` / `star` / `line` 走「生成 `d` + 原生 Path」——**不需要绕过 API**：
 * 它们本来就是路径，且这样落地后仍是可编辑矢量（`createShapeFromSvg` 反而会退化成不透明 svg-raw）。
 */
const SUPPORTED_KINDS: readonly NodeKind[] = [
  'frame', 'rectangle', 'ellipse', 'text', 'svg', 'path', 'pen',
  'polygon', 'star', 'line',
]

export class PenpotHost implements HostAdapter {
  readonly id = 'penpot' as const

  private capabilities: HostCapabilities | null = null
  /** 需要真实 board 实例才能判定的能力；null = 尚未确认 */
  private flexSupport: boolean | null = null
  /**
   * Penpot 的 `naturalChildOrdering` flag 是否已生效（见 `enableNaturalChildOrdering`）。
   * 它决定 insertChild 的索引语义，因此必须记录下来供插入逻辑使用。
   */
  private naturalChildOrdering = false
  /** 待应用的字体请求（fontName 阶段登记，fontWeight 阶段消费） */
  private readonly pendingFont = new Map<string, FontName>()
  private readonly loadedFontFamilies = new Set<string>()
  /**
   * 远程图片 → Penpot ImageData 缓存。
   * 同一张图在一页里被引用十几次是常态，每次走 uploadMediaUrl 会重复拉取并拖慢渲染。
   */
  private readonly imageDataCache = new Map<string, PenpotImageData>()

  /**
   * `page.findShapes()` 功能性探测结果（懒计算，`null` = 未探测）。
   * 不能只看方法存不存在 —— 社区反饋它可能恒返回 `[]`（见 `supportsFindShapes`）。
   */
  private findShapesSupport: boolean | null = null

  // ── 能力探测 ──

  async init(): Promise<void> {
    this.enableNaturalChildOrdering()
    this.capabilities = this.probe()
  }

  /**
   * 打开 Penpot 的 `naturalChildOrdering` flag。
   *
   * 为什么必须开（否则会出现两个方向的错觉）：
   * `app.plugins.flags/initialize` 默认把它设为 **false**，而它控制着三处约定 ——
   *   - `appendChild`：flag 关时索引恒为 0 → 在**非 flex** 容器上是「插到最前」而不是追加；
   *   - `getChildren`：flag 关时对 **flex** 容器返回**内部反向存储**的顺序（画布上顺序是对的，
   *     但 API 读出来是反的 → 导出/回读全反）；
   *   - `insertChild`：flag 关时索引被换算成 `count - index`。
   * 打开后三处都变成 Figma 语义（追加=末尾、children=自然顺序），与 MasterGo 侧一致，
   * 我们也就不需要在适配器里做任何「反着插」的补偿。
   *
   * 读回实际值并记录（老版 Penpot 没有 flags 代理时保持 false，走兼容分支）。
   */
  private enableNaturalChildOrdering(): void {
    // SAFETY: penpot.flags 是宿主运行时的插件标志位代理，未收录进 typings/penpot.d.ts；老版宿主没有该对象，故先断言再按 typeof 判定缺失分支。
    const flags = (penpot as unknown as { flags?: { naturalChildOrdering?: boolean } }).flags
    if (!flags || typeof flags !== 'object') {
      this.naturalChildOrdering = false
      return
    }
    try {
      flags.naturalChildOrdering = true
      this.naturalChildOrdering = flags.naturalChildOrdering === true
    } catch {
      this.naturalChildOrdering = flags.naturalChildOrdering === true
    }
    if (!this.naturalChildOrdering) {
      // 不静默：这会让子节点顺序在两个地方出错，必须让调用方看得见
      this.notify('未能开启 Penpot 的 naturalChildOrdering —— 子节点顺序可能与设计不一致', 'warning')
    }
  }

  getCapabilities(): HostCapabilities {
    if (!this.capabilities) this.capabilities = this.probe()
    return this.capabilities
  }

  /** 纯只读探测：只用 typeof，不创建任何节点 */
  private probe(): HostCapabilities {
    const has = (fn: unknown) => typeof fn === 'function'
    const local = penpot.library?.local

    return {
      host: 'penpot',
      nodeKinds: [...SUPPORTED_KINDS],
      props: {
        fills: has(penpot.createRectangle),
        // Penpot 的 Stroke 只有 strokeAlignment + caps，没有 per-side（§12.5）
        perSideStrokes: false,
        gradients: true,
        // IMAGE 填充已接线：`resolveImageFills` 把 `imageData`（裸 base64 / data URI）
        // 或 `imageUrl` 换成宿主的 `ImageData` 再落 `fillImage`（见 docs/host-differences.md「Images」）。
        imageFills: true,
        // 节点级 `imageUrl` 也接线（`uploadMediaUrl` / `uploadMediaData`，按 URL 缓存）——
        // 不受插件 iframe 的 CORS 限制（Penpot 后端代拉）。
        imageFromUrl: has(penpot.uploadMediaUrl),
        effects: true,
        // blur / backgroundBlur 是两个独立成员，能力齐备
        backgroundBlur: true,
        // 真实判定在首次拿到 board 时进行（见 detectFlex）；此处给出保守的可用性判断
        autoLayout: this.flexSupport ?? has(penpot.createBoard),
        // 宿主**有** addGridLayout（CSS Grid 等价物），是**本插件未接线** —— 说明要准确，
        // 别把"我们没做"写成"宿主没有"。优先级的判断依据：本技能包主线是 flex 自动布局 + D2C，
        // 而 CSS Grid 只影响布局保真（且 Tailwind 白名单不产出 grid），属可选增强。
        gridLayout: false,
        textAutoResize: true,
        // 本项目在 MasterGo 侧缺的能力（变量只能 CRUD，不能绑定）；Penpot 原生具备
        tokenBinding: has(local?.tokens?.addSet) && has(penpot.createRectangle),
      },
      ops: {
        createComponent: has(local?.createComponent),
        componentInstances: true,
        componentVariants: has(penpot.createVariantFromComponents),
        // `swapComponent` 是**形状级**方法（不在 penpot 全局上），拿根节点探一下
        // 四个方法同族，有一个就都有；这里按 alignHorizontal 探
        alignNodes: typeof penpot.alignHorizontal === 'function',
        swapComponent: (() => {
          try {
            // SAFETY: typings/penpot.d.ts 只在 PenpotLibraryComponent 上声明 swapComponent，未在形状基类声明；形状级 swapComponent 是运行时能力，按可缺失探测。
            const rootShape = penpot.currentPage?.root as unknown as { swapComponent?: unknown } | undefined
            return typeof rootShape?.swapComponent === 'function'
          } catch {
            return false
          }
        })(),
        teamLibrary: has(penpot.library?.availableLibraries),
        booleanOps: has(penpot.createBoolean),
        exportImage: true,
        svgImport: has(penpot.createShapeFromSvg),
        group: has(penpot.group),
        // Penpot 插件有 UI iframe（penpot.ui.open）—— 像素精度链路的前提（§11.3）
        renderUiIframe: has(penpot.ui?.open),
        // 子节点顺序语义是否已归到 Figma 语义（见 enableNaturalChildOrdering）
        naturalChildOrdering: this.naturalChildOrdering,
        // 全页搜索走 `page.findShapes()` 的**功能性**探测（不是只看方法存在）
        findShapes: this.supportsFindShapes(),
        // 宿主原生 CSS 生成（Penpot: generateStyle + generateFontFaces）
        generateCss: has(penpot.generateStyle),
      },
    }
  }

  /**
   * 运行时**功能性**探测 `page.findShapes()`：方法存在 ≠ 能用。
   *
   * 官方签名是 `findShapes(criteria?)`，无参 ⇒ 全页所有形状（`doc.plugins.penpot.app/interfaces/Page`）。
   * 但社区「MCP/API Issue list」反馈它可能恒返回 `[]`。所以判据取“可证伪”：
   *   - 方法不存在 / 抛错 → false（缓存）；
   *   - 列出了形状 → true（缓存）；
   *   - 页面**有顶层形状**却列出为空 → 明确证伪，false（缓存）；
   *   - 页面为空 → 无法证伪，返回 false **但不缓存**（等有形状时再判，避免在开插件那一刻的空页上误判）。
   */
  private supportsFindShapes(): boolean {
    if (this.findShapesSupport !== null) return this.findShapesSupport
    const page = penpot.currentPage
    const fn = page?.findShapes
    if (!page || typeof fn !== 'function') {
      this.findShapesSupport = false
      return false
    }
    let listed: PenpotShape[] | null = null
    try {
      const result = fn.call(page)
      listed = Array.isArray(result) ? result : null
    } catch {
      listed = null
    }
    if (listed === null) {
      this.findShapesSupport = false
      return false
    }
    if (listed.length > 0) {
      // 完整性 sanity：全页形状数不得少于顶层子形状数（防「只列顶层/被截断」的残缺实现）
      if (listed.length < getChildren(page.root).length) {
        this.findShapesSupport = false
        return false
      }
      this.findShapesSupport = true
      return true
    }
    if (getChildren(page.root).length > 0) {
      this.findShapesSupport = false
      return false
    }
    // 空页：不缓存
    return false
  }

  /**
   * 本页所有形状（扁平）。优先宿主 `page.findShapes()`（一次 API 调用），
   * 不可用/失效时退回**手写递归**（带预算上限）。两者都只读；
   * 返回的 `PenpotShape` 即 `HostNode` 本身（与 `getShapeById` 同一口径）。
   */
  private allShapes(): PenpotShape[] {
    const page = penpot.currentPage
    if (!page) return []
    if (this.supportsFindShapes()) {
      const listed = page.findShapes()
      if (Array.isArray(listed)) return listed
    }
    const out: PenpotShape[] = []
    const stack: PenpotShape[] = [...getChildren(page.root)]
    while (stack.length > 0 && out.length < HOST_SCAN_BUDGET) {
      const current = stack.pop() as PenpotShape
      out.push(current)
      const children = containerChildren(current)
      if (children) stack.push(...children)
    }
    return out
  }

  /** 惰性确认 flex 能力：只有拿到真实 board 才敢下结论 */
  private detectFlex(board: PenpotBoard): boolean {
    if (this.flexSupport === null) {
      this.flexSupport = typeof board.addFlexLayout === 'function'
      if (this.capabilities) this.capabilities.props.autoLayout = this.flexSupport
    }
    return this.flexSupport
  }

  // ── 内部：节点解析 ──

  private requireShape(node: HostNode | null | undefined, feature: string): PenpotShape {
    // SAFETY: HostNode 是宿主端口的 opaque 句柄；在 PenpotHost 里它就是 Penpot 的 shape 对象本身（requireShape/createNode 是同一条口径），此处只做读写前的存在性探测。
    const shape = node as unknown as PenpotShape | null | undefined
    if (!shape || typeof shape.remove !== 'function') {
      throw new HostNodeNotFoundError(`${feature}: ${node?.id ?? '<null>'}`)
    }
    return shape
  }

  private requireContainer(shape: PenpotShape, feature: string): PenpotContainerShape {
    // SAFETY: PenpotShape 联合未在所有成员上暴露 children/insertChild；按 Partial 探测，随后用 typeof insertChild + Array.isArray(children) 双重判定，非容器抛 HostArgumentError。
    const container = shape as unknown as Partial<PenpotContainerShape>
    if (typeof container.insertChild !== 'function' || !Array.isArray(container.children)) {
      throw new HostArgumentError(`${feature}: 节点 ${shape.id}(${shape.type}) 不是容器，无法承载子节点`)
    }
    // SAFETY: 上一行已用 typeof insertChild 与 Array.isArray(children) 确认该形状是运行时容器，此断言只是把已核实的形状交给 TS。
    return shape as unknown as PenpotContainerShape
  }

  private currentRoot(): PenpotBoard {
    const page = penpot.currentPage
    if (!page) throw new HostArgumentError('Penpot 当前没有打开的页面')
    // 页面根容器在 Penpot 里就是一个 Board（Root Frame）
    // SAFETY: Penpot 的页面根容器运行时就是一个 Board（Root Frame）；requireContainer 已确认它是容器，Board 额外带 flex/clipContent 等成员。
    return this.requireContainer(page.root, 'currentRoot') as unknown as PenpotBoard
  }

  // ── 生命周期 ──

  /**
   * 创建节点。
   *
   * ⚠️ **创建后必须先抹掉宿主注入的默认涂色**，否则会凭空多出背景：
   * Penpot 的新建图形自带涂色（`common/src/app/common/types/shape.cljc` 的 `minimal-*-attrs`）：
   *   - Board → **白色填充** `clr/white`
   *   - Rectangle / Ellipse → **灰色填充** `clr/gray-20` (#B1B2B5)
   *   - Path → **黑色 1px 居中描边**
   * 而 HTML/DSL 的语义是「没写背景就是透明」（MasterGo 侧新建 frame 也是透明的）。
   * 不抹掉就会出现「多出白色背景 / 灰块 / 图标带一圈黑边」这类看不见来源的伪影。
   */
  async createNode(spec: NodeSpec, parent?: HostNode | null): Promise<HostNode> {
    // 渲染器传入 spec 时**总会**把涂色写成显式值（哪怕空），因此这里不能因为“元素自带涂色”就跳过预清。
    if (!this.getCapabilities().nodeKinds.includes(spec.kind)) {
      if (spec.kind === 'group') {
        throw new UnsupportedHostFeatureError(
          'createNode(group)',
          'Penpot 的 penpot.group(shapes) 必须在调用时给出成员，请改用 host.group(nodes)',
        )
      }
      throw new UnsupportedHostFeatureError(`createNode(${spec.kind})`)
    }

    let shape: PenpotShape
    /** SVG 墨迹在目标框内的居中偏移（由 createSvgShape 回传） */
    let iconInkOffset: { x: number; y: number } | null = null

    switch (spec.kind) {
      case 'frame': {
        const board = penpot.createBoard()
        this.detectFlex(board)
        this.resetHostDefaultPaint(board, 'frame')
        shape = board
        break
      }
      case 'rectangle':
        shape = penpot.createRectangle()
        this.resetHostDefaultPaint(shape, 'rectangle')
        break
      case 'ellipse':
        shape = penpot.createEllipse()
        this.resetHostDefaultPaint(shape, 'ellipse')
        break
      case 'text': {
        const text = penpot.createText(spec.characters ?? '')
        if (!text) throw new HostArgumentError('penpot.createText 返回 null')
        // Penpot 默认 growType 是 fixed；文本块默认按高度自适应更贴近本项目 DSL 语义
        text.growType = 'auto-height'
        // 文本**不**抹颜色：HTML 默认文字色就是黑色（`minimal-text-attrs` 也不带 fills），
        // 抹成透明只会让文字凭空消失。
        shape = text
        break
      }
      case 'svg':
        {
          const created = await this.createSvgShape(spec.svgContent ?? '', { width: spec.width, height: spec.height, name: spec.name })
          shape = created.shape
          // 按墨迹尺寸在目标框里居中：图标画在框的左上角会显得偏，且不同图标的 viewBox 内留白不同
          if (created.ink && (spec.width || spec.height)) {
            iconInkOffset = {
              x: Math.max(0, ((spec.width ?? created.ink.width) - created.ink.width) / 2),
              y: Math.max(0, ((spec.height ?? created.ink.height) - created.ink.height) / 2),
            }
          }
        }
        break
      case 'path':
      case 'polygon':
      case 'star':
      case 'line':
      case 'pen': {
        const path = penpot.createPath()
        this.resetHostDefaultPaint(path, spec.kind)
        const width = spec.width ?? 0
        const height = spec.height ?? 0
        if (spec.kind === 'path' || spec.kind === 'pen') {
          if (!spec.pathData) {
            throw new HostArgumentError(`createNode(${spec.kind}): 缺少 pathData`)
          }
          path.d = spec.pathData
        } else {
          path.d = buildVectorPath(spec.kind as VectorKind, {
            pointCount: spec.pointCount,
            innerRadius: spec.innerRadius,
            width,
            height,
          })
        }
        shape = path
        break
      }
      default:
        throw new UnsupportedHostFeatureError(`createNode(${spec.kind})`)
    }

    if (spec.name) shape.name = spec.name

    // 位置：绝对坐标直接用；相对父层则要**先等布局结算**再换算 ——
    // 否则读到的是父层被 flex/auto-layout 摆放之前的陈旧位置（实测会整体偏移）。
    const inkX = iconInkOffset?.x ?? 0
    const inkY = iconInkOffset?.y ?? 0
    if (spec.relativeToParent && parent) {
      await this.waitForLayoutUpdate()
      const parentShape = this.requireShape(parent, 'createNode(parent)')
      shape.x = parentShape.x + (spec.x ?? 0) + inkX
      shape.y = parentShape.y + (spec.y ?? 0) + inkY
    } else {
      if (spec.x !== undefined) shape.x = spec.x + inkX
      if (spec.y !== undefined) shape.y = spec.y + inkY
    }
    // ⚠️ SVG 图标不 resize：它的 `d` 已经按目标尺寸缩放好，自然尺寸就是**墨迹尺寸**
    // （在框里居中由 iconInkOffset 负责）。再 resize 到框尺寸会把非方形图标拉变形
    // （Penpot 的 resize 对 Path 不缩放几何，只改外框 —— 两边都不对）。
    if ((spec.width !== undefined || spec.height !== undefined) && spec.kind !== 'svg') {
      shape.resize(spec.width ?? shape.width, spec.height ?? shape.height)
    }

    const target = parent ? this.requireShape(parent, 'createNode(parent)') : this.currentRoot()
    this.insertChild(this.requireContainer(target, 'createNode'), shape, undefined)

    // SAFETY: 反向方向：Penpot 的 shape 对象本身就是宿主端口对外暴露的 HostNode（不额外包装），故直接断言返回。
    return shape as unknown as HostNode
  }

  /**
   * 抹掉 Penpot 给新建图形注入的默认涂色（详见 `createNode` 的注释）。
   *
   * **只清该类型真的有的默认通道**：每次赋值都是一次**同步阻塞**的跨 iframe 调用
   * （真机实测 ≈10ms/次），清一个本来就不存在的默认通道就是白花 10ms。各类型默认值见
   * `PENPOT_DEFAULT_PAINT`（照抄 Penpot `minimal-*-attrs`）：
   *   - board：白填充、无描边；rectangle / ellipse：gray-20 填充、无描边 → **只需清 `fills`**；
   *   - path 家族（path/pen/polygon/star/line —— 宿主都用 `createPath()` 建）：无填充、
   *     **黑 1px 居中描边** → **只需清 `strokes`**。
   * **刻意保留**：即使调用方随后会写自己的涂色，也先把该通道清干净 —— 清空的通道是后续 **token 绑定 / 组件化**
   * 的干净基线（留着宿主默认涂色会让绑定语义含糊：“这个值到底是谁给的”）。
   * 所以“元素自带涂色就跳过预清”这个“优化”是**故意不做**的，别再当冗余删（见 `rules/17-host-differences.md §2.7`）。
   * 只清涂色，不动其它属性：尺寸/位置/名称由调用方设置，flex 等布局也不受影响。
   * 失败不抛错 —— 清不掉最多是多一个伪影，不应该让整页渲染挂掉。
   */
  private resetHostDefaultPaint(shape: PenpotShape, kind?: NodeKind): void {
    // 未传 kind（如 createShapeFromSvg 回退路径拿到的是未知成员的 group）→ 两个通道都清，保持旧行为
    const onlyFill = kind === 'frame' || kind === 'rectangle' || kind === 'ellipse'
    const onlyStroke =
      kind === 'path' || kind === 'pen' || kind === 'polygon' || kind === 'star' || kind === 'line'
    if (!onlyStroke) {
      try {
        shape.fills = []
      } catch {
        /* Path/Text 等少数类型把 fills 标成只读：清不掉就留着，不能因此中断整页渲染 */
      }
    }
    if (!onlyFill) {
      try {
        shape.strokes = []
      } catch {
        /* 与 fills 同理：只读类型的默认描边无法清除，属可接受的次优结果 */
      }
    }
  }

  /**
   * 创建 SVG 图元。
   *
   * 两条路：
   *   A. **单条可编辑矢量路径**（`analyzeSimpleSvg` 能安全转换时）：建 `Path` + 写 `d`。
   *      这样图标才能正常 resize / 改色 / 在 flex 里伸缩 —— 而 `createShapeFromSvg`
   *      返回的 Group 尺寸由子元素推导，`resize()` 基本无效（MasterGo 侧同样踩过，
   *      那边只能用 relativeTransform 缩放绕开）。
   *   B. **回退**：`createShapeFromSvg`（含 `<image>` 时走 WithImages），把颜色/变换
   *      原样交给宿主处理。
   *
   * 走 A 之后会**回读校验**（`d` 写不进去时 width 会是 0）—— 写失败就回退到 B，
   * 而不是留一个空路径。
   */
  private async createSvgShape(
    svg: string,
    options: { width?: number; height?: number; color?: string; name?: string } = {},
  ): Promise<{ shape: PenpotShape; ink?: { width: number; height: number } }> {
    if (!svg.trim()) throw new HostArgumentError('createNode(svg): svgContent 为空')

    // 关键：把**目标尺寸**交给分析器 —— 它会直接把坐标缩放到目标尺寸。
    // Penpot 的 `resize()` 不会缩放 Path 的几何（实测：24 viewBox 的图标放进 18 的框里
    // 会变成「一个 18×18 的窗口」，图标跑位/被裁/压扁）。
    const analysis = analyzeSimpleSvg(svg, { width: options.width, height: options.height })
    if (analysis) {
      try {
        const path = penpot.createPath()
        path.d = analysis.d

        // 回读校验：d 未生效时几何为空
        if (path.width > 0 && path.height > 0) {
          const color = analysis.color ?? options.color
          const stroke = analysis.paint === 'stroke' ? normalizeColor(color, 1) : null
          const fill = analysis.paint === 'stroke' ? null : normalizeColor(color, 1)
          // Penpot 的 Path 自带「黑 1px 居中描边」与默认填充，**两个通道都必须被显式覆盖**：
          // 只覆盖填充会留下一圈黑边，两通道都不写（无颜色可解析时）会变成黑色块。
          // 这里一次把两个通道都写掉，取代原先「先 resetHostDefaultPaint（2 次往返）再赋值」——
          // 效果完全一致，但每个图标少 1~2 次跨 iframe 调用（真机实测 ≈10ms/次）。
          // 描边宽度已由 analyzeSimpleSvg 按目标尺寸缩放（analysis.strokeWidth）。
          path.fills = fill ? [{ fillColor: fill.hex, fillOpacity: fill.opacity }] : []
          // 线帽：Lucide/Remix 系列线条图标默认 `stroke-linecap="round"`，而 Penpot 的 Path
          // 默认平头 —— 不落这一步，每个圆头图标都会变方头。Penpot 有起点/终点两个成员，
          // 而 SVG 的 `stroke-linecap` 本就作用于两端 → 两端同值。
          const cap = penpotCapFor(analysis.cap)
          path.strokes = stroke
            ? [{
                strokeColor: stroke.hex,
                strokeOpacity: stroke.opacity,
                strokeWidth: Math.max(0.1, analysis.strokeWidth),
                strokeAlignment: 'center',
                strokeStyle: 'solid',
                ...(cap ? { strokeCapStart: cap, strokeCapEnd: cap } : {}),
              }]
            : []
          return { shape: path, ink: analysis.ink }
        }
      } catch {
        /* 落到回退路径 */
      }
    }

    // 含 <image> 的 SVG 需要走 WithImages 变体，否则内嵌位图会丢
    const needsImages = /<image[\s>]/i.test(svg)
    if (needsImages && typeof penpot.createShapeFromSvgWithImages === 'function') {
      const group = await penpot.createShapeFromSvgWithImages(normalizeSvgSize(svg, { width: options.width, height: options.height }))
      if (!group) throw new HostArgumentError('penpot.createShapeFromSvgWithImages 返回 null')
      this.resetHostDefaultPaint(group)
      return { shape: group }
    }

    // 回退路径：先把 width/height 改写成目标尺寸（Iconify 给的是 1em，宿主会落成 1px）
    const group = penpot.createShapeFromSvg(normalizeSvgSize(svg, { width: options.width, height: options.height }))
    if (!group) throw new HostArgumentError('penpot.createShapeFromSvg 返回 null（SVG 无法解析？）')
    this.resetHostDefaultPaint(group)
    return { shape: group }
  }

  getNodeById(id: string): HostNode | null {
    const page = penpot.currentPage
    if (!page) return null

    // ⚠️ Penpot 只能查**当前页**（page.getShapeById），跨页查找不可用 —— §8 的单页限制
    if (typeof page.getShapeById === 'function') {
      const found = page.getShapeById(id)
      if (found) {
        // SAFETY: page.getShapeById 返回的 PenpotShape 即 HostNode 本身（端口不额外包装），此处仅做端口类型转换。
        return found as unknown as HostNode
      }

      /**
       * 宿主有 `getShapeById` 却查不到 → **直接返回 null，绝不退化成全页扫描**。
       *
       * 真机踩到（用户随手问"我选中了什么"时暴露的）：插件 API 是跨 iframe 代理，
       * **每次属性访问都是一次往返**；`scanFor` 逐节点读 `children`，在大文档上
       * 直接把 `node/get` 拖到超时（表现为 "Timeout waiting for plugin response: node/get"，
       * 而同一时刻 `selection/get` / `component/list` 都秒回 —— 因为它们不做查找）。
       * 查不到就查不到：多半是在**别的页**（插件只能查当前页），这该由上层如实报错，
       * 而不是用一次全页遍历去赌。
       */
      return null
    }

    // 只有**老宿主没有 getShapeById** 时才走扫描，并且**给预算上限**：
    // 宁可如实说"没找到"，也不要挂在这里。
    return this.scanFor(page.root, id)
  }

  private scanFor(root: PenpotShape, id: string): HostNode | null {
    // 优先走宿主 `findShapes()`（一次调用，免逐节点往返）；不可用时退回手写遍历。
    if (this.supportsFindShapes()) {
      const hit = this.allShapes().find((shape) => shape.id === id)
      // SAFETY: findShapes 返回的 PenpotShape 即 HostNode 本身（与 getShapeById 同一口径），断言仅做端口类型转换。
      return hit ? (hit as unknown as HostNode) : null
    }
    const stack: PenpotShape[] = [root]
    let visited = 0
    while (stack.length) {
      if (visited >= HOST_SCAN_BUDGET) {
        console.warn(`[host] 全页扫描达到预算上限 ${HOST_SCAN_BUDGET}，未找到 ${id} —— 如实返回 null（不要靠遍历去赌）`)
        return null
      }
      const current = stack.pop() as PenpotShape
      visited += 1
      if (current.id === id) {
        // SAFETY: 全页扫描命中的 PenpotShape 即 HostNode 本身（与 getShapeById 同一口径），断言仅做端口类型转换。
        return current as unknown as HostNode
      }
      const children = containerChildren(current)
      if (children) stack.push(...children)
    }
    return null
  }

  async removeNode(node: HostNode): Promise<void> {
    this.requireShape(node, 'removeNode').remove()
  }

  async cloneNode(node: HostNode): Promise<HostNode> {
    // SAFETY: shape.clone() 返回 PenpotShape，仍指向宿主形状本身；端口层统一按 HostNode 暴露。
    return this.requireShape(node, 'cloneNode').clone() as unknown as HostNode
  }

  async appendChild(parent: HostNode, child: HostNode, index?: number): Promise<void> {
    const container = this.requireContainer(this.requireShape(parent, 'appendChild'), 'appendChild')
    this.insertChild(container, this.requireShape(child, 'appendChild'), index)
  }

  /**
   * 统一的插入入口（全部走 `insertChild`，不用 `appendChild` —— 官方 instruction 明示
   * `appendChild` 在 board 上有已知问题）。
   *
   * ⚠️ `index` 的语义随 `naturalChildOrdering` flag 变化（见 `enableNaturalChildOrdering`）：
   *   - **flag 开**（已实现）：`index = children.length` → 追加到末尾（Figma 语义）；
   *   - **flag 关**（老版 Penpot）：Penpot 会把索引换算成 `count - index`，所以：
   *       · 非 flex 容器：要追加必须传 **0**（传 length 反而插到最前）
   *       · flex 容器：内部顺序本身是反的，要追加恰好要传 **length**
   * 这条分支只在 flag 不可用时生效；两种情况下都保证「追加=视觉末尾」。
   */
  private insertChild(container: PenpotContainerShape, child: PenpotShape, index?: number): void {
    const count = container.children.length
    if (index !== undefined) {
      container.insertChild(Math.max(0, Math.min(index, count)), child)
      return
    }

    if (this.naturalChildOrdering) {
      container.insertChild(count, child)
      return
    }

    const isFlex = Boolean(flexOf(container))
    container.insertChild(isFlex ? count : 0, child)
  }

  async setParentIndex(node: HostNode, index: number): Promise<void> {
    this.requireShape(node, 'setParentIndex').setParentIndex(index)
  }

  async group(nodes: HostNode[]): Promise<HostNode> {
    if (!this.getCapabilities().ops.group) throw new UnsupportedHostFeatureError('group')
    if (nodes.length === 0) throw new HostArgumentError('group 至少需要一个节点')
    const shapes = nodes.map((n) => this.requireShape(n, 'group'))
    const group = penpot.group(shapes)
    if (!group) throw new HostArgumentError('penpot.group 返回 null')
    // SAFETY: penpot.group() 返回的 PenpotGroup 就是宿主节点；断言仅做端口类型转换。
    return group as unknown as HostNode
  }

  /** 单边描边模块的宿主状态型原语（无状态的 `penpot.createPath()` 不进 deps） */
  private sideBorderDeps(): sideBorders.SideBorderDeps {
    return {
      insertChild: (container, child, index) => this.insertChild(container, child, index),
      findShapeById: (id) => this.getNodeById(id) as PenpotShape | null,
      waitForLayoutUpdate: () => this.waitForLayoutUpdate(),
      resetDefaultPaint: (shape) => this.resetHostDefaultPaint(shape),
      readPluginData: (shape, key) => {
        try {
          return shape.getPluginData(key) ?? undefined
        } catch {
          return undefined
        }
      },
      writePluginData: (shape, key, value) => {
        try {
          shape.setPluginData(key, value)
        } catch {
          /* pluginData 不可用：本次不落叠加层（没有记录就无法幂等） */
        }
      },
    }
  }

  // ── 属性 ──

  async applyProperties(node: HostNode, props: NodeProperties): Promise<ApplyResult> {
    const shape = this.requireShape(node, 'applyProperties')
    const applied: string[] = []
    const skipped: PropertySkip[] = []
    let sideBorderTouched = false

    const ok = (property: string) => applied.push(property)
    const skip = (property: string, reason: string) => skipped.push({ property, reason })

    for (const [key, value] of orderedPropertyEntries(props)) {
      switch (key) {
        // ── 名称 ──
        case 'name':
          shape.name = String(value)
          ok('name')
          break

        // ── 几何 ──
        case 'x':
          shape.x = Number(value)
          ok('x')
          break
        case 'y':
          shape.y = Number(value)
          ok('y')
          break
        case 'width':
        case 'height': {
          const w = key === 'width' ? Number(value) : shape.width
          const h = key === 'height' ? Number(value) : shape.height
          try {
            shape.resize(w, h)
            ok(key)
            // resize() 会把文本 growType 打回 fixed，必须由后续 textAutoResize 阶段恢复。
            // 这正是 PROPERTY_PHASES 把几何排在文本之前的原因（见 apply-order.ts）。
          } catch (error) {
            skip(key, `resize 失败: ${(error as Error).message}`)
          }
          break
        }
        case 'rotation':
          shape.rotation = Number(value)
          ok('rotation')
          break

        // ── 外观 ──
        case 'opacity':
          shape.opacity = Number(value)
          ok('opacity')
          break
        case 'visible':
          shape.visible = Boolean(value)
          ok('visible')
          break
        case 'locked':
          shape.blocked = Boolean(value)
          ok('locked')
          break
        case 'cornerRadius':
          shape.borderRadius = Number(value)
          ok('cornerRadius')
          break

        // ── 分角圆角（Penpot 原生四个成员）──
        case 'topLeftRadius':
        case 'topRightRadius':
        case 'bottomLeftRadius':
        case 'bottomRightRadius':
          ;/* SAFETY: 分角圆角成员名由 PENPOT_CORNER_KEYS 查表得出（动态键），四个成员在 PenpotShapeBase 上均声明为 number，按 Record 写入不改变运行时形状。 */ (shape as unknown as Record<string, number>)[PENPOT_CORNER_KEYS[key]] = Number(value)
          ok(key)
          break

        // ── 节点级图片（<img src>）──
        case 'imageUrl': {
          const result = await this.fillFromImageUrl(String(value), props.imageScaleMode)
          if (result.error) {
            skip('imageUrl', result.error)
            break
          }
          shape.fills = result.fills
          ok('imageUrl')
          break
        }
        case 'imageScaleMode':
          // 已被 imageUrl 一并消费（Penpot 的贴合模式属于图片填充，不能单独设置）
          if (props.imageUrl === undefined) {
            skip('imageScaleMode', '需要同时提供 imageUrl（贴合模式属于图片填充）')
          } else {
            ok('imageScaleMode')
          }
          break

        case 'blendMode': {
          const mapped = mapBlendMode(String(value))
          if (!mapped) {
            skip('blendMode', `Penpot 不支持混合模式: ${String(value)}`)
            break
          }
          shape.blendMode = mapped
          ok('blendMode')
          break
        }
        case 'fills': {
          const fills = value as HostFill[]
          // IMAGE 填充要先把图片换成宿主可用的 ImageData（异步），再交给纯映射的 toPenpotFills
          const resolved = await this.resolveImageFills(fills)
          const result = toPenpotFills(fills, resolved.images)
          shape.fills = result.fills
          if (result.fills.length) ok('fills')
          for (const reason of result.skipped) skip('fills', reason)
          for (const reason of resolved.errors) skip('fills', reason)
          break
        }
        case 'strokes': {
          const result = toPenpotStrokes(value as HostStroke[])
          shape.strokes = result.strokes
          if (result.strokes.length) ok('strokes')

          // 单边描边：Penpot 插件 API 没有 per-side，用叠加 Path 模拟（见 border-sides.ts）。
          // ⚠️ 这里**只登记规格**，真正落节点在本方法末尾 —— 因为叠加层是否需要 absolute
          // 取决于 flex 布局，而 PROPERTY_PHASES 里「外观」排在「布局」之前，
          // 此刻 flex 可能还没应用。放末尾才能拿到最终布局状态。
          sideBorders.writeSideBorderSpecs(this.sideBorderDeps(), shape, result.sideBorders)
          sideBorderTouched = true

          for (const reason of result.skipped) skip('strokes', reason)
          break
        }
        case 'strokeWidth': {
          const strokes = shape.strokes
          if (!Array.isArray(strokes) || !strokes.length) {
            skip('strokeWidth', '节点没有描边，Penpot 需先有 Stroke 才能改宽度')
            break
          }
          shape.strokes = strokes.map((s) => ({ ...s, strokeWidth: Number(value) }))
          ok('strokeWidth')
          break
        }
        case 'strokeAlign': {
          const strokes = shape.strokes
          if (!Array.isArray(strokes) || !strokes.length) {
            skip('strokeAlign', '节点没有描边，Penpot 需先有 Stroke 才能改对齐')
            break
          }
          const alignment = mapStrokeAlignment(value as NodeProperties['strokeAlign'])
          shape.strokes = strokes.map((stroke) => ({ ...stroke, strokeAlignment: alignment }))
          ok('strokeAlign')
          break
        }
        case 'effects': {
          const result = toPenpotEffects(value as HostEffect[])
          if (result.shadows) shape.shadows = result.shadows
          if (result.blur !== undefined) shape.blur = result.blur
          if (result.backgroundBlur !== undefined) shape.backgroundBlur = result.backgroundBlur
          if (result.shadows || result.blur !== undefined || result.backgroundBlur !== undefined) ok('effects')
          for (const reason of result.skipped) skip('effects', reason)
          break
        }

        // ── 自动布局 ──
        case 'layoutMode': {
          // SAFETY: layoutMode 分支只在 board 上有意义；后续 board.flex/addFlexLayout 由 detectFlex 运行时确认，非 board 时 flex 为 undefined。
          const board = shape as unknown as PenpotBoard
          const mode = value as NodeProperties['layoutMode']
          if (mode === 'NONE') {
            board.flex?.remove()
            ok('layoutMode')
            break
          }
          if (!this.detectFlex(board)) {
            skip('layoutMode', '宿主不支持自动布局')
            break
          }
          const flex = board.flex ?? board.addFlexLayout()
          if (mode === 'HORIZONTAL') flex.dir = 'row'
          else if (mode === 'VERTICAL') flex.dir = 'column'
          ok('layoutMode')
          break
        }
        case 'itemSpacing': {
          const flex = flexOf(shape)
          if (!flex) {
            skip('itemSpacing', '节点没有 flex 布局，请先设置 layoutMode')
            break
          }
          flex.rowGap = Number(value)
          flex.columnGap = Number(value)
          ok('itemSpacing')
          break
        }
        case 'paddingTop':
        case 'paddingRight':
        case 'paddingBottom':
        case 'paddingLeft': {
          const flex = flexOf(shape)
          if (!flex) {
            skip(key, '节点没有 flex 布局，请先设置 layoutMode')
            break
          }
          // ⚠️ 命名差异：DSL 用 paddingTop，Penpot 的 FlexLayout 用 topPadding
          ;/* SAFETY: padding 的 Penpot 成员名（topPadding 等）由 PENPOT_PADDING_KEYS 动态查出，声明上均 number；按 Record 写入不改变运行时形状。 */ (flex as unknown as Record<string, number>)[PENPOT_PADDING_KEYS[key]] = Number(value)
          ok(key)
          break
        }
        case 'primaryAxisAlignItems': {
          const flex = flexOf(shape)
          if (!flex) {
            skip(key, '节点没有 flex 布局，请先设置 layoutMode')
            break
          }
          flex.justifyContent = mapPrimaryAxis(value as NodeProperties['primaryAxisAlignItems'])
          ok(key)
          break
        }
        case 'counterAxisAlignItems': {
          const flex = flexOf(shape)
          if (!flex) {
            skip(key, '节点没有 flex 布局，请先设置 layoutMode')
            break
          }
          flex.alignItems = mapCounterAxis(value as NodeProperties['counterAxisAlignItems'])
          ok(key)
          break
        }
        case 'layoutSizingHorizontal':
        case 'layoutSizingVertical': {
          const layoutChild = shape.layoutChild
          if (!layoutChild) {
            skip(key, '节点不在 flex/grid 布局内，无 layoutChild')
            break
          }
          const target = key === 'layoutSizingHorizontal' ? 'horizontalSizing' : 'verticalSizing'
          ;/* SAFETY: 目标键 horizontalSizing/verticalSizing 由 axis 动态选择，声明上是 fill|auto|fix 字符串枚举；写入值由 mapSizing 保证落在该集合内。 */ (layoutChild as unknown as Record<string, string>)[target] = mapSizing(
            value as NodeProperties['layoutSizingHorizontal'],
          )
          ok(key)
          break
        }

        case 'layoutPositioning': {
          const layoutChild = shape.layoutChild
          if (!layoutChild) {
            skip(key, '节点不在 flex/grid 布局内，无 layoutChild')
            break
          }
          layoutChild.absolute = value === 'ABSOLUTE'
          ok(key)
          break
        }

        case 'flexWrap': {
          const flex = flexOf(shape)
          if (!flex) {
            skip(key, '节点没有 flex 布局，请先设置 layoutMode')
            break
          }
          flex.wrap = value === 'WRAP' ? 'wrap' : 'nowrap'
          ok(key)
          break
        }

        case 'primaryAxisSizingMode':
        case 'counterAxisSizingMode': {
          // 「按内容自适应」（hug）这件事**不需要 flex** —— Penpot 的 board 即使没有 auto-layout
          // 也能 wrap 内容。引擎恰恰是在**非 flex 帧**上用这两个字段表达 hug，
          // 所以以前「没有 flex 就跳过」等于把 54 条自适应设置全丢了
          // （真机现象：输入框里的文本包裹层被撑成整行高、文本贴顶 13px）。
          const flex = flexOf(shape)
          // SAFETY: 非 flex 帧用形状自带的 horizontalSizing/verticalSizing（Penpot 未在细分类型上统一暴露）；这里仅按 Record 承接动态键写入。
          const sizing = shape as unknown as Record<string, string>
          // 主轴/交叉轴是相对 flex 方向的概念，Penpot 的字段却是绝对的 horizontal/vertical
          // —— flex 下按 dir 换算（否则 row 布局会把主轴尺寸写到交叉轴上）；
          // 无 flex 时没有方向可言，按「默认 row」口径映射（DEFAULT 主线 = 水平）。
          const isRow = flex ? flex.dir.startsWith('row') : true
          const axis = key === 'primaryAxisSizingMode'
            ? (isRow ? 'horizontalSizing' : 'verticalSizing')
            : (isRow ? 'verticalSizing' : 'horizontalSizing')
          // SAFETY: flex 与 sizing 两个目标都是“可按 dynamic 键写 sizing”的对象；二选一后统一按 Record 写，键集合由 axis 固定。
          const target = flex ? (flex as unknown as Record<string, string>) : sizing
          target[axis] = value === 'AUTO' ? 'auto' : 'fix'
          ok(key)
          break
        }

        // ── 文本 ──
        case 'characters':
        case 'fontSize':
        case 'lineHeight':
        case 'letterSpacing':
        case 'textAlignHorizontal':
        case 'textAlignVertical':
        case 'textAutoResize':
        case 'fontName':
        case 'fontWeight': {
          if (shape.type !== 'text') {
            skip(key, `属性 ${key} 仅适用于文本节点，当前节点是 ${shape.type}`)
            break
          }
          const reason = this.applyTextProperty(shape as PenpotText, key, value)
          if (reason) skip(key, reason)
          else ok(key)
          break
        }

        // ── 容器 ──
        case 'clipsContent': {
          // SAFETY: 用 'clipContent' in board 判定该节点是否支持裁剪；PenpotShape 联合未统一暴露该成员，按 Partial 探测。
          const board = shape as unknown as Partial<PenpotBoard>
          if (!('clipContent' in board)) {
            skip('clipsContent', '该节点类型不支持裁剪内容（仅 board）')
            break
          }
          board.clipContent = Boolean(value)
          ok('clipsContent')
          break
        }

        default:
          skip(String(key), 'Penpot 适配器尚未映射该属性')
          break
      }
    }

    // ── 单边描边叠加层：按**最终**布局状态重建（幂等：先删旧再建新）──
    // 两种触发：本次改了描边（sideBorderTouched），或本次改了布局（layoutMode 等）
    // —— 后者关系到叠加层用绝对坐标还是父级相对坐标。直接在每次应用末尾跑一遍最省心。
    if (sideBorderTouched || props.layoutMode !== undefined || props.layoutSizingHorizontal !== undefined || props.layoutSizingVertical !== undefined) {
      const overlay = await sideBorders.applySideBorders(this.sideBorderDeps(), shape)
      if (overlay.applied) applied.push('strokes.sides')
      for (const reason of overlay.skipped) skipped.push({ property: 'strokes.sides', reason })
    }

    return { applied, skipped }
  }

  /** 返回 null 表示成功，返回字符串表示跳过原因 */
  private applyTextProperty(text: PenpotText, key: keyof NodeProperties, value: unknown): string | null {
    switch (key) {
      case 'characters':
        text.characters = String(value)
        return null

      case 'fontSize':
        // Penpot 的 fontSize 是字符串
        text.fontSize = String(value)
        return null

      case 'lineHeight': {
        const lh = value as NonNullable<NodeProperties['lineHeight']>
        if (lh.unit === 'AUTO') return 'Penpot 不支持 lineHeight = AUTO'
        if (lh.unit === 'PERCENT') {
          text.lineHeight = String(round(lh.value / 100, 4))
          return null
        }
        // Penpot 的行高是相对倍数（字符串），px 需换算成 fontSize 的比值。
        // 拿不到 fontSize 时原样透传，并在语义上如实标注为近似。
        const fontSize = Number(text.fontSize)
        if (!Number.isFinite(fontSize) || fontSize <= 0) {
          text.lineHeight = String(lh.value)
          return null
        }
        text.lineHeight = String(round(lh.value / fontSize, 4))
        return null
      }

      case 'letterSpacing': {
        const ls = value as NonNullable<NodeProperties['letterSpacing']>
        text.letterSpacing = String(ls.unit === 'PERCENT' ? ls.value / 100 : ls.value)
        return null
      }

      case 'textAlignHorizontal':
        text.align = mapTextAlign(value as NodeProperties['textAlignHorizontal'])
        return null

      case 'textAlignVertical':
        text.verticalAlign = mapTextVerticalAlign(value as NodeProperties['textAlignVertical'])
        return null

      case 'textAutoResize':
        text.growType = mapGrowType(value as NodeProperties['textAutoResize'])
        return null

      case 'fontName':
        // Penpot 的 fontFamily 不能直接赋值，必须通过 Font.applyToText 落地；
        // 因此先把请求登记下来，由 applyFont 统一选变体应用。
        this.pendingFont.set(text.id, value as FontName)
        return this.applyFont(text)

      case 'fontWeight': {
        // ⚠️ 只给 fontWeight（没有 fontName）是**很常见**的情况 —— 客户端渲染引擎经常只产出
        // 字重。此时不该去解析字体族：Penpot 的 `fontWeight` 本身可写，直接写即可；
        // 只有能确定字体族时才需要 `applyToText` 换变体（那会同时把字重落到位）。
        // 之前这里直接调 applyFont，导致「字体不可用: undefined」并且**字重丢失**。
        const weight = Number(value)
        const requested = this.pendingFont.get(text.id)
        const family = requested?.family || text.fontFamily || text.fontId
        if (!family) {
          text.fontWeight = String(weight)
          return null
        }
        return this.applyFont(text, weight)
      }

      default:
        return `Penpot 适配器尚未映射文本属性 ${String(key)}`
    }
  }

  /** 依据待应用字体请求 + 目标字重，选一个变体并 applyToText */
  private applyFont(text: PenpotText, explicitWeight?: number): string | null {
    const fonts = penpot.fonts
    if (!fonts || typeof fonts.findByName !== 'function') return '宿主未提供 penpot.fonts.findByName'

    const requested = this.pendingFont.get(text.id)
    const family = requested?.family || text.fontFamily || text.fontId
    const font = fonts.findByName(family)
    if (!font) {
      return `字体不可用: ${family}（Penpot 只支持文档/系统里已存在的字体）`
    }

    const wantedStyle = (requested?.style ?? '').toLowerCase()
    const wantedWeight = explicitWeight !== undefined ? String(explicitWeight) : String(text.fontWeight || '')

    const variant =
      // 1) 先按 style 名匹配（Regular / Medium / SemiBold / Bold …）
      font.variants.find((v) => wantedStyle && (v.name.toLowerCase().includes(wantedStyle) ||
        String(v.fontWeight).toLowerCase() === wantedStyle)) ??
      // 2) 再按字重匹配
      font.variants.find((v) => wantedWeight && String(v.fontWeight) === wantedWeight) ??
      // 3) 兜底：第一个可用变体
      font.variants[0]

    font.applyToText(text, variant)

    // 回读校验**只在能判定时进行**：必须拿到该变体的 fontId 才比较。
    // 老实现写的是 `text.fontId === before && text.fontId !== variant.fontId` —— 当
    // `variant.fontId` 不存在（Penpot 的 FontVariant 未必带它）时，第二个条件恒真，
    // 于是**每次都会误报「字体应用未生效」**（真机上就是这样：13+3+3+1 条全是误报），
    // 让人去查一个并不存在的问题。
    const wantedFontId = variant?.fontId
    if (wantedFontId && text.fontId !== wantedFontId) {
      return `字体应用未生效: ${family} / ${variant?.name ?? wantedWeight}（回读 fontId=${text.fontId ?? '空'}）`
    }

    this.loadedFontFamilies.add(family)
    return null
  }

  /**
   * 解析填充里的 IMAGE：把每一条图片填充换成宿主可用的 `ImageData`（失败原因单独收着）。
   *
   * 为什么在 `applyProperties` 里做而不是 `toPenpotFills`：取图是**异步**的
   * （`uploadMediaUrl` / `uploadMediaData`），而 `toPenpotFills` 是纯同步映射。
   * 返回值按**填充对象引用**索引，调用方原样转交给 `toPenpotFills`。
   */
  private async resolveImageFills(fills: HostFill[]): Promise<{ images: Map<HostFill, PenpotImageData>; errors: string[] }> {
    const images = new Map<HostFill, PenpotImageData>()
    const errors: string[] = []

    for (const fill of fills) {
      // 隐藏的图片填充不会落地，没必要为此上传（省一次宿主往返）
      if (normalizeFillType(fill.type) !== 'IMAGE' || !isFillVisible(fill)) continue
      try {
        images.set(fill, await this.imageDataFromFill(fill))
      } catch (error) {
        errors.push(`图片填充未落地: ${(error as Error).message}`)
      }
    }

    return { images, errors }
  }

  /**
   * 填充/节点级图片数据 → `ImageData`。
   *
   * 优先 `imageData`（客户端渲染产出的是**裸 base64** 的 PNG；也可能是 data URI），
   * 否则 `imageUrl`（远程走 `uploadMediaUrl`，`data:` 走 `uploadMediaData`）。
   */
  private async imageDataFromFill(fill: HostFill): Promise<PenpotImageData> {
    const inline = typeof fill.imageData === 'string' && fill.imageData.trim() ? fill.imageData.trim() : undefined
    const url = typeof fill.imageUrl === 'string' && fill.imageUrl.trim() ? fill.imageUrl.trim() : undefined
    const source = inline ?? (url && /^data:/i.test(url) ? url : undefined)

    if (source) {
      const cached = this.imageDataCache.get(source)
      if (cached) return cached
      // 裸 base64 没有标签，用 imageUrl 的后缀做第二线索（data URI 自带 MIME）
      const uploaded = await this.uploadInlineImage(source, inline ? url : undefined)
      this.imageDataCache.set(source, uploaded)
      return uploaded
    }

    if (url) return await this.imageDataFromUrl(url)
    throw new Error('图片填充既没有 imageUrl 也没有 imageData')
  }

  /**
   * 远程 URL → `ImageData`（`uploadMediaUrl`）。
   *
   * 为什么不自已 fetch：Penpot 的 uploadMediaUrl 由**后端**代拉，不受插件 iframe 的 CORS 限制，
   * 也不用把二进制搬到前端。同一张图在一页里被引十几次是常态，按 URL 缓存避免重复上传。
   */
  private async imageDataFromUrl(url: string): Promise<PenpotImageData> {
    const upload = penpot.uploadMediaUrl
    if (typeof upload !== 'function') {
      throw new Error('宿主不支持 uploadMediaUrl，无法把远程图片转为图片填充')
    }
    const cached = this.imageDataCache.get(url)
    if (cached) return cached

    const name = url.split('/').pop()?.split('?')[0] || 'image'
    const imageData = await upload.call(penpot, name, url)
    if (!imageData) throw new Error(`uploadMediaUrl 返回空: ${url}`)
    this.imageDataCache.set(url, imageData)
    return imageData
  }

  /**
   * `data:image/png;base64,…` 或裸 base64 → 上传参数（`uploadMediaData` 需要的 name/data/mimeType）。
   *
   * 硬限制先在这里判：Penpot 只收 5 种 MIME、默认 30 MiB —— 提前报可读原因，
   * 别把宿主的 `media-type-not-allowed` 原样穿透。
   */
  private decodeInlineImage(value: string, hintUrl?: string): { name: string; data: Uint8Array; mimeType: string } {
    let declaredMime: string | undefined
    let bytes: Uint8Array

    if (/^data:/i.test(value)) {
      const match = /^data:([^;,]+)(;base64)?,(.*)$/is.exec(value)
      if (!match) throw new Error('data URI 格式无法解析')
      declaredMime = (match[1] || '').trim().toLowerCase() || undefined
      const payload = match[3] ?? ''
      bytes = match[2] ? decodeBase64(payload) : utf8Bytes(decodeURIComponent(payload))
    } else {
      bytes = decodeBase64(value)
    }

    const mimeType = sniffImageMime(bytes) ?? declaredMime ?? mimeTypeFromUrl(hintUrl)
    const rejection = penpotMediaRejection(mimeType, bytes.byteLength)
    if (rejection) throw new Error(rejection)

    return { name: inlineMediaName(mimeType as string), data: bytes, mimeType: mimeType as string }
  }

  /**
   * 内联图片（裸 base64 / data URI）→ `ImageData`。
   *
   * ⚠️ **SVG 走不通**：Penpot 的 `uploadMediaData` 会把 `image/svg+xml` 的 blob 路由到
   * **SVG 导入通道**（`process-blobs` 的 `svg-blob?` 分支），`Promise` 解析到的是解析后的
   * SVG 数据而不是 `ImageData`；宿主随后以 `Code: :fills` 拒绝这个 fill —— 一句看不出
   * 原因的错误。这里提前挡住，给可执行的替代方案（远程位图 / vector 元素）。
   */
  private async uploadInlineImage(value: string, hintUrl?: string): Promise<PenpotImageData> {
    const decoded = this.decodeInlineImage(value, hintUrl)
    if (decoded.mimeType === 'image/svg+xml') {
      throw new Error(
        'Penpot 的 uploadMediaData 把 SVG 走图形导入通道（拿不到 ImageData），内联 SVG 无法作为图片填充；' +
          '请改用 vector 元素（svgContent）/ data-icon，或换成远程位图 URL',
      )
    }
    return await this.requireUploadMediaData(decoded)
  }

  /** `uploadMediaData` 是可选能力（旧宿主没有）；缺失时给明确原因而不是静默丢图 */
  private async requireUploadMediaData(input: { name: string; data: Uint8Array; mimeType: string }): Promise<PenpotImageData> {
    const uploaded = await this.uploadMediaBinary(input)
    if (!uploaded) throw new Error('宿主未提供 uploadMediaData，无法把内联图片转为图片填充')
    return uploaded
  }

  /**
   * 节点级 `imageUrl`（`<img>` / 手写 DSL 的 `element.imageUrl`）→ 图片填充。
   * `data:` URI 走**另一条路**：它是内联二进制，不是远程资源 ——
   * `uploadMediaUrl` 会让后端去"拉"一个 data URI，必然失败。
   */
  private async fillFromImageUrl(
    url: string,
    scaleMode: NodeProperties['imageScaleMode'],
  ): Promise<{ fills: PenpotFill[]; error?: string }> {
    const trimmed = url.trim()
    if (!trimmed) return { fills: [], error: 'imageUrl 为空' }

    if (/^data:/i.test(trimmed)) return await this.fillFromImageDataUrl(trimmed, scaleMode)

    try {
      const imageData = await this.imageDataFromUrl(trimmed)
      // Penpot 的图片填充：fillImage 携带 ImageData；贴合模式无法表达（Fill 没有对应字段）。
      void scaleMode
      return { fills: [{ fillImage: imageData, fillOpacity: 1 }] }
    } catch (error) {
      return { fills: [], error: `图片拉取失败（${trimmed}）: ${(error as Error).message}` }
    }
  }

  /** `data:image/png;base64,…` → 图片填充（走 `penpot.uploadMediaData`） */
  private async fillFromImageDataUrl(
    url: string,
    scaleMode: NodeProperties['imageScaleMode'],
  ): Promise<{ fills: PenpotFill[]; error?: string }> {
    const cached = this.imageDataCache.get(url)
    try {
      const imageData = cached ?? await this.uploadInlineImage(url)
      if (!cached) this.imageDataCache.set(url, imageData)
      void scaleMode
      return { fills: [{ fillImage: imageData, fillOpacity: 1 }] }
    } catch (error) {
      return { fills: [], error: (error as Error).message }
    }
  }

  /**
   * 上传图片二进制（`uploadMediaData(name, data: Uint8Array, mimeType)`），返回**完整** ImageData。
   *
   * 保留宿主回的 width/height：`PenpotFill.fillImage` 需要完整 ImageData，只留 id/name 不够。
   */
  private async uploadMediaBinary(input: { name: string; data: Uint8Array; mimeType: string }): Promise<PenpotImageData | null> {
    // typings 声明 uploadMediaData 为必填；旧版宿主可能没有，故先探测
    if (typeof penpot.uploadMediaData !== 'function') return null
    return await penpot.uploadMediaData(input.name, input.data, input.mimeType)
  }

  readProperties(node: HostNode, fields: readonly string[]): Record<string, unknown> {
    const shape = this.requireShape(node, 'readProperties')
    const out: Record<string, unknown> = {}

    for (const field of fields) {
      switch (field) {
        case 'id':
          out.id = shape.id
          break
        case 'type':
          out.type = shape.type
          break
        /**
         * 四个组件标志的**官方语义**（照抄 api.yml 的说明，不看名字猜）：
         *   isComponentInstance()     → true 表示"**在**某个组件实例内部"（母版或副本都算，含子节点）
         *   isComponentMainInstance() → true 表示"在组件**母版**内部"   ← 判母版用这个
         *   isComponentCopyInstance() → true 表示"在组件**副本实例**内部" ← 判实例用这个
         *   isComponentRoot()         → true 表示"是组件树的根"（母版是根、副本的根**也是** → 不区分）
         * 血泪教训：我曾按名字把 `isComponentRoot` 当成"是母版"，结果把用户选中的**副本实例**
         * 判成了母版（详见 README「说宿主做不到之前，先 grep api.yml」一节）。
         */
        case 'isComponentInstance':
        case 'isComponentMainInstance':
        case 'isComponentCopyInstance':
        case 'isComponentRoot': {
          // SAFETY: 四个组件标志（isComponentInstance 等）在 Penpot 声明为方法；按 Record 索引取成员、typeof 判定后再 call，未声明的宿主得 undefined。
          const holder = shape as unknown as Record<string, unknown>
          const fn = holder[field]
          out[field] = typeof fn === 'function' ? Boolean((fn as () => boolean).call(shape)) : undefined
          break
        }
        case 'componentId': {
          // 实例形状上挂的组件引用。API 里既可能是属性也可能是方法 → 两种都认，不猜错
          // SAFETY: 实例形状的 component 引用运行时既可能是属性也可能是方法（版本差异）；按可选的联合形状探测，两种都兼容。
          const holder = shape as unknown as {
            component?: { id?: string } | null | (() => { id?: string } | null)
          }
          const raw = typeof holder.component === 'function' ? holder.component() : holder.component
          out.componentId = raw?.id
          break
        }
        case 'name':
          out.name = shape.name
          break
        case 'parentId':
          out.parentId = shape.parent?.id ?? null
          break
        case 'childCount':
          out.childCount = getChildren(shape).length
          break
        case 'children':
          out.children = getChildren(shape).map((c) => c.id)
          break
        // ⚠️ 回读必须归一化：Penpot 的 shape.fills 是它自己的结构
        // （{fillColor, fillOpacity, fillColorGradient,…}），而 DSL 消费方（describe/导出器）
        // 要的是 {type, color}。曾经原样透传 → 真机上导出会**丢掉所有颜色**，
        // 单测却因为 MemoryHost 存的就是 DSL 形状而全绿。
        case 'fills':
          out.fills = shape.fills === 'mixed' ? 'mixed' : fromPenpotFills(shape.fills)
          break
        case 'strokes':
          out.strokes = fromPenpotStrokes(shape.strokes)
          break
        case 'shadows':
          out.shadows = fromPenpotEffects({ shadows: shape.shadows })
          break
        case 'effects':
          out.effects = fromPenpotEffects({
            shadows: shape.shadows,
            blur: shape.blur,
            backgroundBlur: shape.backgroundBlur,
          })
          break
        case 'layoutMode': {
          const flex = flexOf(shape)
          out.layoutMode = !flex ? 'NONE' : flex.dir.startsWith('row') ? 'HORIZONTAL' : 'VERTICAL'
          break
        }
        case 'pathData': {
          // Penpot 的 Path 有 d / content / commands / toD()（官方 api.yml）。
          // `d` 是最直接的 SVG path data；老版本可能只有 `content` → 两级兜底，
          // 都没有就返回 undefined（由调用方如实报「取不到」而不是编一个空形状）。
          if (shape.type !== 'path') {
            out.pathData = undefined
            break
          }
          // SAFETY: Penpot 的 Path 有 d / content / commands / toD()；这里按最小形状探测两级兜底（d → content），都没有则如实返回 undefined。
          const path = shape as unknown as { d?: string; content?: unknown }
          out.pathData = typeof path.d === 'string' && path.d
            ? path.d
            : (typeof path.content === 'string' && path.content ? path.content : undefined)
          break
        }
        case 'characters':
          out.characters = shape.type === 'text' ? (shape as PenpotText).characters : undefined
          break
        case 'growType':
          out.growType = shape.type === 'text' ? (shape as PenpotText).growType : undefined
          break
        default:
          // SAFETY: 默认分支按调用方给的字段名动态读形状成员（fields 是开放列表）；取不到即 undefined，不臆造。
          out[field] = (shape as unknown as Record<string, unknown>)[field]
          break
      }
    }

    return out
  }

  // ── 资源 ──

  async loadFonts(requests: readonly FontRequest[]): Promise<void> {
    const fonts = penpot.fonts
    if (!fonts || typeof fonts.findByName !== 'function') return

    for (const request of requests) {
      const font = fonts.findByName(request.family)
      if (!font) {
        // 不抛错：字体缺失应降级为「字形回退」，而不是让整页渲染失败
        this.notify(`字体不可用，已回退: ${request.family}`, 'warning')
        continue
      }
      this.loadedFontFamilies.add(request.family)
    }
  }

  // ── 导出 ──

  /**
   * 导出节点。
   *
   * Penpot 的 `shape.export({type, scale})` 只支持**倍率**，没有"固定宽度/高度"约束 ——
   * 因此 WIDTH/HEIGHT 会被换算成 scale（value / 当前尺寸）并在 `notes` 里说明是换算来的，
   * 而不是假装原生支持。
   */
  async exportNode(node: HostNode, options: ExportOptions): Promise<ExportResult> {
    const shape = this.requireShape(node, 'exportNode')
    const notes: string[] = []

    const typeMap: Record<ExportFormat, 'png' | 'jpeg' | 'webp' | 'svg' | 'pdf'> = {
      PNG: 'png', JPG: 'jpeg', WEBP: 'webp', SVG: 'svg', PDF: 'pdf',
    }
    const type = typeMap[options.format] ?? 'png'
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
    }

    let scale = options.scale ?? 1
    if (options.width !== undefined && shape.width > 0) {
      scale = options.width / shape.width
      notes.push(`按固定宽度 ${options.width} 换算为 scale=${round(scale, 4)}（Penpot 导出只支持倍率）`)
    } else if (options.height !== undefined && shape.height > 0) {
      scale = options.height / shape.height
      notes.push(`按固定高度 ${options.height} 换算为 scale=${round(scale, 4)}（Penpot 导出只支持倍率）`)
    }
    if (!(scale > 0)) scale = 1

    // PDF/SVG 的 scale 语义在 Penpot 里可能被忽略；不假设成功，失败就如实抛
    const bytes = await shape.export({ type, scale })

    const isText = type === 'svg'
    return {
      format: type,
      mimeType: mimeMap[type] ?? 'application/octet-stream',
      isText,
      // ⚠️ 不能用 `TextDecoder`：插件沙箱里没有它（真机 SVG 导出报 `Internal error: TextDecoder is not a constructor`）。
      data: isText ? utf8Decode(bytes) : bytesToBase64(bytes),
      scale,
      notes,
    }
  }

  // ── 组合与组件 ──
  //
  // 实现按簇拆到 `lib/host/penpot-components.ts`（依赖方向 host → 模块，见 README「约定（续）」R1'）；
  // 这里只留薄委托 + 一个组装 deps 的私有方法。

  /** 组件模块的宿主**状态型**原语（无状态的 `penpot.createBoolean` / `align*` 不进 deps） */
  private componentDeps(): components.ComponentDeps {
    return {
      requireShape: (node, feature) => this.requireShape(node, feature),
      requireContainer: (shape, feature) => this.requireContainer(shape, feature),
      currentRoot: () => this.currentRoot(),
      insertChild: (container, child, index) => this.insertChild(container, child, index),
    }
  }

  async booleanOperation(nodes: readonly HostNode[], operation: BooleanOperation): Promise<HostNode> {
    return components.booleanOperation(this.componentDeps(), nodes, operation)
  }

  async createComponent(
    nodes: readonly HostNode[],
    name?: string,
  ): Promise<{ componentId: string; nodeId: string; name: string }> {
    return components.createComponent(this.componentDeps(), nodes, name)
  }

  async alignNodes(
    nodes: readonly HostNode[],
    input: { axis: 'HORIZONTAL' | 'VERTICAL'; direction: 'MIN' | 'CENTER' | 'MAX' },
  ): Promise<void> {
    return components.alignNodes(this.componentDeps(), nodes, input)
  }

  async distributeNodes(nodes: readonly HostNode[], input: { axis: 'HORIZONTAL' | 'VERTICAL' }): Promise<void> {
    return components.distributeNodes(this.componentDeps(), nodes, input)
  }

  async withUndoBlock<T>(label: string, run: () => Promise<T>): Promise<T> {
    return components.withUndoBlock(label, run)
  }

  async swapComponent(
    node: HostNode,
    input: { componentId?: string; componentName?: string; libraryName?: string },
  ): Promise<{ componentId: string; componentName: string }> {
    return components.swapComponent(this.componentDeps(), node, input)
  }

  async resetOverrides(node: HostNode): Promise<void> {
    return components.resetOverrides(this.componentDeps(), node)
  }

  async detachInstance(node: HostNode): Promise<{ detached: boolean; note?: string }> {
    return components.detachInstance(this.componentDeps(), node)
  }

  async listComponents(): Promise<HostComponentInfo[]> {
    return components.listComponents()
  }

  /** 把可连接的团队库连上（`library.connectLibrary`）；见 `penpot-runtime.connectTeamLibraries` */
  async connectTeamLibraries(nameOrId?: string): Promise<TeamLibraryConnectionInfo> {
    return connectTeamLibrariesAtRuntime(nameOrId)
  }

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
    return components.instantiateComponent(this.componentDeps(), input)
  }

  async switchVariant(
    node: HostNode,
    propertyName: string,
    value: string,
  ): Promise<{ switched: boolean; note?: string }> {
    return components.switchVariant(this.componentDeps(), node, propertyName, value)
  }

  async createVariants(
    nodes: readonly HostNode[],
    propertyName: string,
    values: readonly string[],
    options: CreateVariantsOptions = {},
  ): Promise<CreateVariantsResult> {
    return components.createVariants(this.componentDeps(), nodes, propertyName, values, options)
  }

  // ── 样式资产（Penpot：library.local.colors / typographies） ──
  //
  // 实现拆到 `lib/host/penpot-styles.ts`；字体清单（listFonts）也在那边 ——「字体」是一个概念，
  // 不要跨两个文件。这里只留薄委托 + 一个组装 deps 的私有方法。

  /** 样式模块的宿主**状态型**原语（无状态的 `penpot.fonts` 不进 deps） */
  private styleDeps(): styles.StyleDeps {
    return { requireShape: (node, feature) => this.requireShape(node, feature) }
  }

  async listColorStyles(): Promise<HostColorStyle[]> {
    return styles.listColorStyles()
  }

  async listTextStyles(): Promise<HostTextStyle[]> {
    return styles.listTextStyles()
  }

  async createColorStyle(input: {
    name: string
    color: string
    opacity?: number
    description?: string
  }): Promise<HostColorStyle> {
    return styles.createColorStyle(input)
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
    return styles.createTextStyle(input)
  }

  async updateColorStyle(input: {
    name: string
    color: string
    opacity?: number
    description?: string
  }): Promise<HostColorStyle | null> {
    return styles.updateColorStyle(input)
  }

  async updateTextStyle(input: {
    name: string
    fontFamily?: string
    fontSize?: string | number
    fontWeight?: string | number
    lineHeight?: string | number
    letterSpacing?: string | number
    description?: string
  }): Promise<HostTextStyle | null> {
    return styles.updateTextStyle(input)
  }

  async applyStyle(
    node: HostNode,
    styleId: string,
    styleType: 'fill' | 'stroke' | 'text',
  ): Promise<{ applied: boolean; note?: string }> {
    return styles.applyStyle(this.styleDeps(), node, styleId, styleType)
  }

  async listFonts(): Promise<HostFontInfo[]> {
    return styles.listFonts()
  }

  async generateCss(nodes: readonly HostNode[]): Promise<{
    available: boolean
    css: string
    fontFaces: string
    nodeCount: number
    reason?: string
  }> {
    return styles.generateCss(this.styleDeps(), nodes)
  }

  /** 富文本区间模块的宿主状态型原语（非文本节点报错，而不是静默当空） */
  private requireText(node: HostNode, feature: string): PenpotText {
    const shape = this.requireShape(node, feature)
    if (shape.type !== 'text') throw new HostArgumentError(`${feature} 需要文本节点（当前 ${shape.type}）`)
    return shape as PenpotText
  }

  private textDeps(): textRuns.TextDeps {
    return { requireText: (node, feature) => this.requireText(node, feature) }
  }

  async applyTextRuns(
    node: HostNode,
    runs: readonly HostTextRun[],
  ): Promise<{ applied: boolean; runCount: number; characters: number; note?: string }> {
    return textRuns.applyTextRuns(this.textDeps(), node, runs)
  }

  readTextRuns(node: HostNode): HostTextRun[] {
    return textRuns.readTextRuns(this.textDeps(), node)
  }

  // ── 节点 pluginData / 选区订阅（宿主端口原语，不属于任何拆出的簇） ──

  getNodePluginData(node: HostNode, key: string): string | undefined {
    const value = this.requireShape(node, 'getNodePluginData').getPluginData(key)
    return value ? value : undefined
  }

  /**
   * 订阅选区变化（含换页 —— 换页后选区会清空，面板必须跟着更新）。
   *
   * `penpot.on` 返回 listenerId，配 `penpot.off(id)` 退订（官方 api.yml：`on(...)` → `off(listenerId)`）。
   */
  observeSelection(callback: () => void): () => void {
    // SAFETY: penpot.on/off（事件订阅）未收录进 typings/penpot.d.ts；按可缺失探测，无 on 时返回空退订函数。
    const context = penpot as unknown as {
      on?: (event: string, handler: (...args: unknown[]) => void) => unknown
      off?: (id: unknown) => void
    }
    if (typeof context.on !== 'function') return () => {}

    const ids: unknown[] = []
    // 用 try/catch 包住：不同 Penpot 版本的 EventsMap 略有差异（早期没有 pagechange）
    for (const event of ['selectionchange', 'pagechange']) {
      try {
        const id = context.on(event, () => callback())
        if (id !== undefined) ids.push(id)
      } catch {
        /* 该事件在当前版本不可用 —— 少一个监听而已，不影响主流程 */
      }
    }

    return () => {
      if (typeof context.off !== 'function') return
      for (const id of ids) {
        try { context.off(id) } catch { /* 已随插件销毁 */ }
      }
    }
  }

  // ── 文档 / 页面 / 选区 ──

  getDocumentInfo(): HostDocumentInfo {
    const page = penpot.currentPage
    return {
      host: this.id,
      // 与 MasterGo 侧（Nova / Pixel …）对齐的会话代号：
      // 服务端 session_list 靠它区分多个插件实例；按文档持久化，用户可在面板里改
      codename: codename.getCodename(),
      documentId: penpot.currentFile?.id,
      documentName: penpot.currentFile?.name,
      pageId: page?.id,
      pageName: page?.name,
      hostVersion: penpot.version,
      pluginVersion: typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : undefined,
    }
  }

  /** 当前文档的会话代号（按文档持久化，首用自动生成） */
  getDocumentCodename(): string {
    return codename.getCodename()
  }

  /** 设置当前文档的会话代号（持久化；空串忽略） */
  setDocumentCodename(name: string): string {
    return codename.setCodename(name)
  }

  getSelection(): readonly HostNode[] {
    const selection = penpot.selection
    // SAFETY: penpot.selection 是 PenpotShape[]，与 HostNode 在本适配器是同一对象（见 getNodeById 口径）；断言仅做端口类型转换。
    return Array.isArray(selection) ? (selection as unknown as HostNode[]) : []
  }

  async setSelection(nodes: readonly HostNode[]): Promise<void> {
    penpot.selection = nodes.map((n) => this.requireShape(n, 'setSelection'))
  }

  listPages(): readonly HostPageInfo[] {
    // SAFETY: penpot.pages 清单未收录进 typings（老版本没有）；按可缺失探测，缺失时退化为只报当前页。
    const pages = (penpot as unknown as { pages?: { id: string; name: string }[] }).pages
    if (Array.isArray(pages)) return pages.map((p) => ({ id: p.id, name: p.name }))

    // 老版本没有 pages 清单：至少把当前页报出来，避免返回空数组被误读成「文档没有页面」
    const current = penpot.currentPage
    return current ? [{ id: current.id, name: current.name }] : []
  }

  getCurrentPage(): HostPageInfo | null {
    const page = penpot.currentPage
    return page ? { id: page.id, name: page.name } : null
  }

  getPageRootNodes(): readonly HostNode[] {
    const page = penpot.currentPage
    if (!page) return []
    // SAFETY: 页面根的子形状就是宿主节点；getChildren 返回 PenpotShape[]，断言仅做端口类型转换。
    return getChildren(page.root) as unknown as HostNode[]
  }

  async switchPage(pageId: string): Promise<void> {
    await penpot.openPage(pageId)
  }

  async createPage(name: string): Promise<HostPageInfo> {
    const page = penpot.createPage()
    page.name = name
    return { id: page.id, name: page.name }
  }

  async renamePage(pageId: string, name: string): Promise<{ applied: boolean; name: string; reason?: string }> {
    const current = penpot.currentPage
    if (!current) throw new HostArgumentError('Penpot 当前没有打开的页面')
    if (current.id !== pageId) {
      // 官方 API 只给了 currentPage 的可写引用；其他页要先切过去
      throw new HostArgumentError(
        `需先切到目标页再重命名（当前: ${current.id}，目标: ${pageId}）—— Penpot 只暴露当前页对象可写`,
      )
    }
    current.name = name
    const applied = current.name === name
    return { applied, name: current.name, reason: applied ? undefined : '重命名未生效' }
  }

  // ── 视图 / 交互 ──

  async zoomToNodes(nodes: readonly HostNode[]): Promise<void> {
    if (!nodes.length) return
    const shapes = nodes.map((n) => this.requireShape(n, 'zoomToNodes'))
    if (typeof penpot.viewport?.zoomIntoView === 'function') {
      penpot.viewport.zoomIntoView(shapes)
      return
    }
    // 退化路径：zoomIntoView 不可用时至少把选区设上，让用户能看见成果
    penpot.selection = shapes
  }

  notify(message: string, kind: NotifyKind = 'info'): void {
    // Penpot 没有原生 toast API；转发到插件 UI，由 UI 渲染。
    // 必须 try/catch：UI 未打开时 sendMessage 会抛。
    try {
      penpot.ui?.sendMessage?.({ type: 'mgmcp/notify', kind, message })
    } catch {
      /* UI 不可用，落到 console */
    }
    if (kind === 'error') console.error(`[mgMCP] ${message}`)
    else console.log(`[mgMCP] ${message}`)
  }

  async waitForLayoutUpdate(): Promise<void> {
    // `waitForLayoutUpdate` 出现在官方 initial_instructions.md，但**未收录进 api_types.yml**，
    // 因此必须运行时探测；不可用时退化为一个宏任务窗口。
    const fn = penpot.waitForLayoutUpdate
    if (typeof fn === 'function') {
      await fn.call(penpot)
      return
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  // ── 设计令牌（Penpot：library.local.tokens） ──
  //
  // 实现拆到 `lib/host/penpot-tokens.ts`（令牌 CRUD 与绑定/传播是同一条链），**行为契约**见该文件头。
  // 这里只留薄委托 + 一个组装 deps 的私有方法。

  async listTokenSets(): Promise<HostTokenSet[]> {
    return tokens.listTokenSets()
  }

  async createToken(input: {
    name: string
    type: string
    value: string
    setName?: string
    description?: string
  }): Promise<{ token: HostToken; setId: string; setName: string; created: boolean }> {
    return tokens.createToken(input)
  }

  async updateToken(input: {
    name: string
    value?: string
    description?: string
    setName?: string
  }): Promise<{ token: HostToken; updated: string[] }> {
    return tokens.updateToken(input)
  }

  async deleteToken(input: { name: string; setName?: string }): Promise<{ deleted: string }> {
    return tokens.deleteToken(input)
  }

  // ── 令牌绑定（Penpot 的真绑定能力；MasterGo 侧没有这条通道） ──

  /** 令牌模块的宿主**状态型**原语（无状态的 `library.local.tokens` 不进 deps） */
  private tokenDeps(): tokens.TokenDeps {
    return {
      requireShape: (node, feature) => this.requireShape(node, feature),
      allShapes: () => this.allShapes(),
    }
  }

  readNodeTokens(node: HostNode): Record<string, string> {
    return tokens.readNodeTokens(node)
  }

  async applyToken(
    node: HostNode,
    tokenName: string,
    properties: readonly string[] = ['fill'],
  ): Promise<{ applied: boolean; tokenId?: string; properties: string[]; bound: Record<string, string>; note?: string }> {
    return tokens.applyToken(this.tokenDeps(), node, tokenName, properties)
  }

  async renameToken(input: {
    name: string
    newName: string
    setName?: string
  }): Promise<{ token: HostToken; renamed: boolean }> {
    return tokens.renameToken(input)
  }

  async setTokenSetActive(input: {
    setName?: string
    tokenName?: string
    active: boolean
  }): Promise<{ changed: boolean; active: boolean; setName: string; note?: string }> {
    return tokens.setTokenSetActive(input)
  }

  async propagateToken(input: {
    tokenName: string
    setName?: string
    properties?: readonly string[]
  }): Promise<{ matched: number; rewritten: number; rebound: number; mechanism: string; note?: string }> {
    return tokens.propagateToken(this.tokenDeps(), input)
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0)
    out += alphabet[(triple >> 18) & 63]
    out += alphabet[(triple >> 12) & 63]
    out += b1 === undefined ? '=' : alphabet[(triple >> 6) & 63]
    out += b2 === undefined ? '=' : alphabet[triple & 63]
  }
  return out
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
