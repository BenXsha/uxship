/**
 * DSL → 宿主 渲染器
 *
 * 这是「声明式 DSL 一次成页」在 Penpot 侧的落地实现：把一棵 DSL 树翻译成一串
 * HostAdapter 调用。它与 MasterGo 侧的 `dsl-renderer.ts`（2,060 行、34 处 `mg.`）职责相同，
 * 但因为宿主细节被压在 HostAdapter 之下，这里是**纯编排逻辑，零宿主 API**。
 *
 * 三个关键编排决策
 * ---------------------------------------------------------------
 * 1. **父布局先于子元素应用**。Penpot 的 `layoutChild`（子元素的 fill/hug/fix）只有在
 *    父容器已是 flex 布局后才存在；因此顺序是「建父 → 应用父的布局 → 递归子」，
 *    否则子元素的尺寸语义会静默丢失。
 * 2. **文本尺寸与 growType 互斥处理**。`resize()` 会把 growType 打回 fixed。策略：
 *      - 给了 width+height → 固定框（fixed）
 *      - 只给 width      → 固定宽 + 自动高（保留折行）
 *      - 都没给          → 自动宽（单行贴合）
 *    这是 DSL 语义到宿主语义的**策略**，属于渲染器职责，不放进 HostAdapter。
 * 3. **单个元素失败不拖垮整页**（默认）。除非 `strict: true`，否则把失败记进 report
 *    继续渲染 —— 一页 50 个元素因为 1 个不支持的星形全废掉是不可接受的。
 */
import { isUnsupportedHostFeature } from '../host/errors'
import type { ApplyResult, HostAdapter, HostNode, HostStroke, NodeKind, NodeProperties, NodeSpec, StrokeSide } from '../host/types'
import type { DSLElement, DSLEffect, DSLFill, DSLStroke } from './types'

// ═══════════════════════════════════════════════════════════
// 报告
// ═══════════════════════════════════════════════════════════

export interface RenderSkip {
  /** DSL 中的路径，如 `elements[0].children[2]` */
  path: string
  /** 出问题的字段或元素类型 */
  target: string
  reason: string
}

export interface RenderReport {
  host: string
  /** 成功创建的节点（按创建顺序） */
  created: { id: string; name: string; kind: string; dslType: string }[]
  /** 顶层节点的 id（focus / select 用） */
  rootIds: string[]
  /** 降级与失败记录。非空即表示设计与 DSL 不完全一致。 */
  skipped: RenderSkip[]
  /** 每个元素的 applied/skipped 统计，便于定位「大部分属性没生效」
   *
   * 口径：`applied` 只数**经 `applyProperties` 落地**的属性；`name` 与几何尺寸由
   * `createNode(spec)` 承担（渲染器不再重复下发），因此不计入这个数。 */
  perElement: { path: string; applied: number; skipped: number }[]
  /**
   * 客户端渲染阶段未能解析的 Tailwind class / 告警。
   * 这些 class 的样式**已经丢了**，所以必须在报告里显式回传 ——
   * 否则调用方会拿到一个“看起来渲染成功、但少了一堆样式”的结果。
   */
  unresolvedClasses: string[]
  /**
   * 布局告警（客户端渲染上报）：目前用于「刀尖换行」——盒宽恰好等于文字宽时 CJK 亚像素溢出
   * 会让 DOM 折行；引擎已按单行收敛，同时在这里如实说明（不静默）。见 `rules/05-pitfalls.md §13.1`。
   */
  layoutWarnings: string[]
  /** 顶层节点数量（= 本次渲染的成果数） */
  rootCount: number
  /**
   * 耗时（真实数字，供“生成为什么慢”定位）。
   *
   * `hostRenderMs` 在沙箱里实测（DSL → 宿主全部落地）；`clientRenderMs` 由客户端渲染引擎上报
   * （HTML → 实测像素 → DSL，含浏览器排版/图标解析/固定等待），两者相加才能看出卡在哪一段。
   */
  timing: {
    hostRenderMs: number
    clientRenderMs?: number
  }
  /**
   * 令牌绑定结果（`data-token-*` 声明 → 渲染时绑定）。
   *
   * `bound` 来自宿主回读（`shape.tokens`），不拿"调用没报错"当成功：
   * 令牌不存在 / 属性名不被接受 / 宿主未异步落地 —— 都进 `failed` 并带可操作 reason。
   */
  tokenBindings: {
    requested: number
    bound: number
    failed: { path: string; property: string; token: string; reason: string }[]
  }
  /** 富文本 run 结果（P2-3）：本次真正应用了 run 的元素/run/字符数 */
  textRuns: { elements: number; runs: number; characters: number }
  /**
   * `rootIds` 的别名，供服务端 `code_to_design` 读取以便建立 DesignCache 会话
   * （它找的是 `rootNodeIds` 这个字段名，见 tool-handlers.ts）。
   */
  rootNodeIds: string[]
}

export interface RenderOptions {
  /** 渲染到指定父节点之下；缺省渲染到当前页根容器 */
  parent?: HostNode | null
  /** 任一元素失败即中断并抛错（CI / 单测用）；默认 false */
  strict?: boolean
  /** 渲染完成后聚焦成果（默认 true） */
  zoom?: boolean
  /** 渲染完成后选中成果（默认 true） */
  select?: boolean
  /** 渲染前批量加载字体（默认 true） */
  loadFonts?: boolean
  /**
   * 父层是否 flex（由**父层递归时**解析一次并传下）。
   *
   * 存在的意义：Penpot 侧每次 `readProperties` 都是一次跨 iframe 往返，而「父层是否 flex」
   * 只有带 `position` 的子元素才需要 —— 此前**每个**这样的子元素都会各自读一次父层。
   */
  parentIsFlex?: boolean
  /**
   * 父层的 flex 布局（**从 DSL 得知，零往返**）：仅用于决定是否下发 `layoutPositioning`。
   * 非 flex 时宿主必拒该项（白花一次往返 + 一条噪声降级），因此已知非 flex 就直接不发。
   * 与之相对，`parentIsFlex` 是**宿主回读值**，用于位置换算的精确性，两者用途不同。
   */
  parentFlexLayout?: boolean
}

// ═══════════════════════════════════════════════════════════
// 渲染
// ═══════════════════════════════════════════════════════════

const DSL_TYPE_TO_KIND: Record<string, NodeKind> = {
  frame: 'frame',
  component: 'frame', // Penpot 侧先按 board 落地，组件化由后续步骤完成
  rectangle: 'rectangle',
  ellipse: 'ellipse',
  text: 'text',
  svg: 'svg',
  pen: 'pen',
  path: 'path',
  polygon: 'polygon',
  star: 'star',
  line: 'line',
}

/** 明确「知道但不支持」的 DSL 类型：报原因，而不是报「未知类型」 */
const KNOWN_UNSUPPORTED: Record<string, string> = {
  instance: 'Penpot 组件实例化尚未接线（需 library.components + component.instance()）',
  boolean_operation: '布尔运算尚未接线（penpot.createBoolean）',
  template: '模版元素应在服务端展开为普通 DSL 元素后再下发',
  generator: '生成器元素应在服务端展开为普通 DSL 元素后再下发',
  tree: '树形元素应在服务端展开为普通 DSL 元素后再下发',
  connector: 'Penpot 无 connector 概念',
}

/** 从 fills 里挑一个可用作图标色的纯色（只看第一个有色的填充） */
function pickColor(fills?: DSLFill[]): string | null {
  if (!Array.isArray(fills)) return null
  for (const fill of fills) {
    const raw = fill as DSLFill & { color?: unknown }
    if (raw?.color === undefined || raw.color === null) continue
    if (typeof raw.color === 'string') return raw.color
    // { r, g, b } 形态：转成 hex 供 host 归一
    const record = raw.color as { r?: unknown; g?: unknown; b?: unknown }
    if (typeof record?.r === 'number') {
      const byte = (value: unknown) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))).toString(16).padStart(2, '0')
      return `#${byte(record.r)}${byte(record.g)}${byte(record.b)}`
    }
  }
  return null
}

/** 渲染输入：DSL 文档（或裸元素数组）。额外容许 `_unresolvedClasses` 等旁路元数据 */
export type DSLDocumentInput = { elements?: DSLElement[]; _unresolvedClasses?: unknown; _layoutWarnings?: unknown; _clientRenderMs?: unknown } | DSLElement[]

export async function renderDsl(
  host: HostAdapter,
  document: DSLDocumentInput,
  options: RenderOptions = {},
): Promise<RenderReport> {
  const startedAtMs = Date.now()
  const elements = Array.isArray(document) ? document : (document?.elements ?? [])
  const report: RenderReport = {
    host: host.id,
    created: [],
    rootIds: [],
    skipped: [],
    perElement: [],
    rootCount: 0,
    rootNodeIds: [],
    tokenBindings: { requested: 0, bound: 0, failed: [] },
    textRuns: { elements: 0, runs: 0, characters: 0 },
    unresolvedClasses: collectUnresolvedClasses(document),
    layoutWarnings: collectLayoutWarnings(document),
    timing: { hostRenderMs: 0, clientRenderMs: collectClientRenderMs(document) },
  }

  if (!Array.isArray(elements) || elements.length === 0) {
    report.timing.hostRenderMs = Date.now() - startedAtMs
    report.skipped.push({ path: 'elements', target: 'document', reason: 'DSL 文档没有任何 elements' })
    return report
  }

  if (options.loadFonts !== false) {
    await collectAndLoadFonts(host, elements)
  }

  /**
   * 整次渲染 = **一个撤销块**。
   *
   * 落一页通常创建几十个节点，宿主默认"一次操作一步撤销" —— 用户渲完想撤掉得按几十次 Ctrl+Z。
   * 包成一个块之后一次撤掉（`penpot.history.undoBlockBegin/Finish`，见 host#withUndoBlock）。
   * 宿主没有 history 时直接跑（这是体验优化，不该让渲染失败）。
   */
  const renderAll = async (): Promise<void> => {
    for (let i = 0; i < elements.length; i += 1) {
      const node = await renderElement(host, elements[i], `elements[${i}]`, options, report)
      if (node) report.rootIds.push(node.id)
    }
  }

  if (typeof host.withUndoBlock === 'function') {
    await host.withUndoBlock(`渲染 DSL（${elements.length} 个顶层元素）`, renderAll)
  } else {
    await renderAll()
  }

  report.rootCount = report.rootIds.length
  report.rootNodeIds = [...report.rootIds]

  if (report.unresolvedClasses.length) {
    const sample = report.unresolvedClasses.slice(0, 5).join('、')
    host.notify(
      `⚠️ ${report.unresolvedClasses.length} 个 Tailwind class 未生效（样式丢失）：${sample}`,
      'warning',
    )
  }

  // 渲染后等待布局结算 —— 不 await 就读几何会拿到变更前的值
  await host.waitForLayoutUpdate()

  const rootNodes = report.rootIds
    .map((id) => host.getNodeById(id))
    .filter((n): n is HostNode => Boolean(n))

  if (options.select !== false && rootNodes.length) {
    try {
      await host.setSelection(rootNodes)
    } catch (error) {
      report.skipped.push({ path: 'selection', target: 'selection', reason: (error as Error).message })
    }
  }
  if (options.zoom !== false && rootNodes.length) {
    try {
      await host.zoomToNodes(rootNodes)
    } catch (error) {
      report.skipped.push({ path: 'zoom', target: 'zoom', reason: (error as Error).message })
    }
  }

  // 沙箱侧实测耗时（含字体加载 / 建节点 / 属性下发 / 等布局结算 / 选中聚焦）——
  // 与 `clientRenderMs`（浏览器渲染段）相加才是用户感知到的“生成一次要等多久”。
  report.timing.hostRenderMs = Date.now() - startedAtMs
  return report
}

async function renderElement(
  host: HostAdapter,
  element: DSLElement,
  path: string,
  options: RenderOptions,
  report: RenderReport,
): Promise<HostNode | null> {
  if (!element || typeof element !== 'object') {
    report.skipped.push({ path, target: 'element', reason: '元素不是对象' })
    return null
  }

  const dslType = String(element.type ?? '')

  // group 是唯一「不能先建节点」的类型：Penpot 的 penpot.group(shapes) 必须在调用时
  // 给出成员，因此必须先渲染出子节点再成组。单独走一条路径。
  if (dslType === 'group') {
    return renderGroup(host, element, path, options, report)
  }

  const kind = DSL_TYPE_TO_KIND[dslType]

  if (!kind) {
    const reason = KNOWN_UNSUPPORTED[dslType] ?? `未知的 DSL 元素类型: ${dslType}`
    if (options.strict) {
      throw new Error(`${path} (${dslType}): ${reason}`)
    }
    report.skipped.push({ path, target: dslType || '(缺失 type)', reason })
    return null
  }

  // 未知字段检查：DSL 拼写错误（如 cornerRadii / textAlignment）过去会被静默忽略，
  // 在画布上表现为「样式没生效」而没有任何线索。这里逐字段报告。
  for (const unknownKey of findUnknownFields(element)) {
    report.skipped.push({
      path,
      target: unknownKey,
      reason: `DSL 元素 ${dslType} 不认识字段 ${unknownKey}（拼写错误？）`,
    })
  }

  if (dslType === 'component') {
    report.skipped.push({
      path,
      target: 'component',
      reason: 'Penpot 侧先按 board 落地；真组件化（library.createComponent）尚未接线',
    })
  }

  // ── 1. 创建节点 ──
  //
  // ⚠️ 位置语义（真机踩过，代价很大）：
  //   DSL 里 `position` 是**父层内坐标**（与 MasterGo 的 node.x 一致），
  //   而 Penpot 的 `shape.x/y` 对**非 flex 子层是页面绝对坐标**。
  //   所以「父层在 (2100,400)、子元素 position {x:10,y:10}」如果直接把 10/10 传下去，
  //   子节点会落在页面 (10,10) —— 也就是**父层之外**，视觉上「什么都没画出来」。
  //   flex 父层则相反：位置由布局决定，传了也会被布局覆盖 → 不该传。
  const parent = options.parent ?? null
  const spec = buildNodeSpec(element, kind)
  const position = element.position
  if (position && (position.x !== undefined || position.y !== undefined)) {
    // 父层是否 flex 由**父层递归时解析一次**并传下来（顶层无 parent 时走下面的 !parent 分支）——
    // 不再对每个带 position 的子节点各发一次 readProperties(parent, ['layoutMode'])。
    const parentIsFlex = options.parentIsFlex === true
    if (!parent) {
      if (position.x !== undefined) spec.x = position.x
      if (position.y !== undefined) spec.y = position.y
    } else if (!parentIsFlex) {
      // 非 flex 父层：交给宿主的 relativeToParent 换算（它会先等布局结算，拿到父层最终位置）
      if (position.x !== undefined) spec.x = position.x
      if (position.y !== undefined) spec.y = position.y
      spec.relativeToParent = true
    }
    // flex 父层：位置由布局引擎决定，刻意不传（DSL 里的 position 在这里只是「建议值」）
  }

  let node: HostNode
  try {
    node = await host.createNode(spec, parent)
  } catch (error) {
    if (options.strict || !isUnsupportedHostFeature(error)) throw error
    report.skipped.push({ path, target: dslType, reason: (error as Error).message })
    return null
  }

  report.created.push({ id: node.id, name: element.name ?? node.id, kind, dslType })

  // ── 2. 应用属性（几何 + 外观 + 文本）──
  const { layoutProps, visualProps } = splitProperties(element, dslType)
  // x/y 已在创建时按父层语义换算过；这里必须摘掉，否则会被当成绝对坐标再覆盖一次
  delete (visualProps as Record<string, unknown>).x
  delete (visualProps as Record<string, unknown>).y
  // name / width / height / characters 已在 `createNode(spec)` 里落过（`shape.name=` /
  // `resize()` / `createText(characters)`）—— 再写一遍是**纯重复的跨 iframe 往返**
  // （真机渲染成本主要就在这里：≈9.5ms/次写）。两处取值同源（`spec` 与 `props` 都直接取自
  // `element`），因此摘掉不改变结果；文本 growType 由 §文本 阶段的 `textAutoResize` 独立恢复。
  delete (visualProps as Record<string, unknown>).name
  delete (visualProps as Record<string, unknown>).width
  delete (visualProps as Record<string, unknown>).height
  delete (visualProps as Record<string, unknown>).characters

  // 父层不是 flex 时，`layoutPositioning` 会被宿主直接拒（“节点不在 flex/grid 布局内，无 layoutChild”）——
  // 这是一次纯浪费的往返 + 一条噪声降级。父层布局由递归时从 DSL 得知（零往返），已知非 flex 就不发。
  if (options.parentFlexLayout === false) {
    delete (visualProps as Record<string, unknown>).layoutPositioning
  }
  let applied = 0
  let skipped = 0

  try {
    const result = await host.applyProperties(node, visualProps)
    applied += result.applied.length
    skipped += result.skipped.length
    recordSkips(report, path, result)
  } catch (error) {
    if (options.strict) throw error
    report.skipped.push({ path, target: 'visualProps', reason: (error as Error).message })
  }

  // ── 3. 应用布局（必须先于子元素，否则子元素的 layoutChild 不存在）──
  if (Object.keys(layoutProps).length) {
    try {
      const result = await host.applyProperties(node, layoutProps)
      applied += result.applied.length
      skipped += result.skipped.length
      recordSkips(report, path, result)
    } catch (error) {
      if (options.strict) throw error
      report.skipped.push({ path, target: 'layoutProps', reason: (error as Error).message })
    }
  }

  // ── 3.4 富文本 run（P2-3）：整体 content 已在 visualProps 落完，这里逐段上样式 ──
  // 必须在 §5 令牌绑定之前（绑定是最后一步）。
  if (dslType === 'text' && Array.isArray(element.runs) && element.runs.length) {
    try {
      const result = await host.applyTextRuns(node, element.runs)
      if (result.applied) {
        report.textRuns.elements += 1
        report.textRuns.runs += result.runCount
        report.textRuns.characters += result.characters
      }
      if (result.note) report.skipped.push({ path, target: 'runs', reason: result.note })
    } catch (error) {
      if (options.strict) throw error
      report.skipped.push({ path, target: 'runs', reason: (error as Error).message })
    }
  }

  // ── 3.5 `frame` + `svgContent` → 在内容区放一个 SVG 子节点 ──
  //
  // 这条路是 `data-icon` 图标的主通道：客户端渲染引擎把 `<i data-icon>` 解析成
  // `{ type: 'frame', svgContent }`（见 useClientRender#extractSvgResultNode）。
  // 与 MasterGo 侧 dsl-renderer 同口径：尺寸取扣掉 padding 后的内容区，
  // 非 flex 容器才显式定位（flex 容器由布局引擎摆）。
  //
  // ⚠️ **外层 frame 不能省**（省掉每图标少 6 次宿主调用，但已被明确否决）：
  // 容器是图标「固有比例 + 在布局里伸缩/对齐」的语义载体，裸 path 只剩墨迹尺寸；
  // 而且少了这层会让组件化与回读少一层结构。见 `rules/17-host-differences.md §2.7`“刻意不做”。
  if (dslType === 'frame' && element.svgContent) {
    const padL = element.paddingLeft ?? 0
    const padR = element.paddingRight ?? 0
    const padT = element.paddingTop ?? 0
    const padB = element.paddingBottom ?? 0
    const boxW = element.size?.width ?? 24
    const boxH = element.size?.height ?? 24
    const isLayoutContainer = Boolean(element.layoutMode && element.layoutMode !== 'NONE')

    try {
      const icon = await host.createNode(
        {
          kind: 'svg',
          name: element.name || 'icon',
          svgContent: element.svgContent,
          width: Math.max(1, boxW - padL - padR),
          height: Math.max(1, boxH - padT - padB),
          // ⚠️ 这里给的是**相对父层**的偏移（内容区左上角），必须显式声明：
          // 宿主的 x/y 是页面绝对坐标，按绝对坐标传 (0,0) 会让图标跑到页面原点
          ...(isLayoutContainer ? {} : { x: padL, y: padT, relativeToParent: true }),
        },
        node,
      )
      report.created.push({ id: icon.id, name: element.name || 'icon', kind: 'svg', dslType: 'svg' })

      // 图标颜色可能落在 frame 的 fills 上（手写 DSL 的常见写法）
      const requestedColor = pickColor(element.fills)
      if (requestedColor) {
        const painted = await host.applyProperties(icon, {
          fills: [{ type: 'SOLID', color: requestedColor }],
          strokes: [],
        })
        recordSkips(report, `${path}.svgContent`, painted)
      }

      const sized = await host.applyProperties(icon, {
        width: Math.max(1, boxW - padL - padR),
        height: Math.max(1, boxH - padT - padB),
      })
      recordSkips(report, `${path}.svgContent`, sized)
    } catch (error) {
      report.skipped.push({ path: `${path}.svgContent`, target: 'svgContent', reason: (error as Error).message })
    }
  }

  // ── 4. 递归子元素 ──
  const children = Array.isArray(element.children) ? element.children : []

  /**
   * 父层是否 flex：**同一父层只解析一次**，且**只在真有带 `position` 的子元素时才去问宿主**。
   *
   * 为何不无条件预读：纯 flex 页面的子元素都不带定位，本来一次都不用读 —— 无条件预读反而
   * 每个容器白加一次往返。而一个非 flex 容器下有 N 个带定位的子元素时，原先会读 N 次，现在 1 次。
   */
  let parentIsFlexForChildren: boolean | undefined
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]
    const childPosition = child?.position
    const childHasPosition = Boolean(childPosition && (childPosition.x !== undefined || childPosition.y !== undefined))
    if (parentIsFlexForChildren === undefined && childHasPosition) {
      const mode = host.readProperties(node, ['layoutMode']).layoutMode
      parentIsFlexForChildren = mode === 'HORIZONTAL' || mode === 'VERTICAL'
    }
    await renderElement(host, child, `${path}.children[${i}]`, {
      ...options,
      parent: node,
      parentIsFlex: parentIsFlexForChildren,
      // 父层 flex 与否（DSL 口径，零往返）：仅供子元素决定要不要 `layoutPositioning`
      parentFlexLayout: element.layoutMode === 'HORIZONTAL' || element.layoutMode === 'VERTICAL',
    }, report)
  }

  // ── 5. 令牌绑定（**最后**）──
  // 宿主"直接写属性即解绑"，所以绑定必须在结构、外观、布局、子元素全部落完之后。
  // `data-token-fill` → 属性名 `fill`（Penpot applyToken 的合法枚举，见 typings）。
  const tokenBindings = element.tokenBindings
  if (tokenBindings && typeof tokenBindings === 'object') {
    for (const [property, tokenName] of Object.entries(tokenBindings)) {
      if (!property || !tokenName) continue
      report.tokenBindings.requested += 1
      try {
        const result = await host.applyToken(node, String(tokenName), [property])
        if (result.applied) {
          report.tokenBindings.bound += 1
        } else {
          report.tokenBindings.failed.push({
            path,
            property,
            token: String(tokenName),
            reason: result.note ?? '绑定已下发但宿主回读为空（属性名可能不被该节点类型接受）',
          })
        }
      } catch (error) {
        report.tokenBindings.failed.push({
          path,
          property,
          token: String(tokenName),
          reason: (error as Error).message,
        })
      }
    }
  }

  report.perElement.push({ path, applied, skipped })
  return node
}

/**
 * 渲染 group：先建全部子节点（建在 group 将来所在的位置），再成组。
 *
 * 为什么子节点要建在父位置而不是「先建空组」：两侧宿主都没有「创建空组」的能力
 * （`host.createNode({kind:'group'})` 会抛 UnsupportedHostFeatureError）。
 */
async function renderGroup(
  host: HostAdapter,
  element: DSLElement,
  path: string,
  options: RenderOptions,
  report: RenderReport,
): Promise<HostNode | null> {
  const children = Array.isArray(element.children) ? element.children : []
  const rendered: HostNode[] = []

  for (let i = 0; i < children.length; i += 1) {
    const child = await renderElement(host, children[i], `${path}.children[${i}]`, options, report)
    if (child) rendered.push(child)
  }

  if (!rendered.length) {
    report.skipped.push({ path, target: 'group', reason: 'group 没有任何成功渲染的子节点' })
    return null
  }

  let group: HostNode
  try {
    group = await host.group(rendered)
  } catch (error) {
    if (options.strict || !isUnsupportedHostFeature(error)) throw error
    report.skipped.push({ path, target: 'group', reason: (error as Error).message })
    return null
  }

  report.created.push({ id: group.id, name: element.name ?? group.id, kind: 'group', dslType: 'group' })

  const { layoutProps, visualProps } = splitProperties(element, 'group')
  let applied = 0
  let skipped = 0

  for (const [stage, bag] of [['visualProps', visualProps], ['layoutProps', layoutProps]] as const) {
    if (!Object.keys(bag).length) continue
    try {
      const result = await host.applyProperties(group, bag)
      applied += result.applied.length
      skipped += result.skipped.length
      recordSkips(report, path, result)
    } catch (error) {
      if (options.strict) throw error
      report.skipped.push({ path, target: stage, reason: (error as Error).message })
    }
  }

  report.perElement.push({ path, applied, skipped })
  return group
}

/** 从 DSL 文档上取回客户端渲染阶段标记的未解析 class */
function collectUnresolvedClasses(document: DSLDocumentInput): string[] {
  if (Array.isArray(document)) return []
  const raw = document?._unresolvedClasses
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
}

/** 布局告警（与 `_unresolvedClasses` 平行的一条文档级旁路通道） */
function collectLayoutWarnings(document: DSLDocumentInput): string[] {
  if (Array.isArray(document)) return []
  const raw = document?._layoutWarnings
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
}

/** 客户端渲染段耗时（浏览器渲染 → 实测像素 → DSL），由渲染引擎上报 */
function collectClientRenderMs(document: DSLDocumentInput): number | undefined {
  if (Array.isArray(document)) return undefined
  const raw = document?._clientRenderMs
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

export function recordSkips(report: RenderReport, path: string, result: ApplyResult): void {
  for (const item of result.skipped) {
    report.skipped.push({ path, target: item.property, reason: item.reason })
  }
}

// ═══════════════════════════════════════════════════════════
// DSL → NodeSpec / NodeProperties
// ═══════════════════════════════════════════════════════════

function buildNodeSpec(element: DSLElement, kind: NodeKind): NodeSpec {
  return {
    kind,
    name: element.name,
    // 位置**不在这里传**：DSL 的 position 是「父层内坐标」，而 Penpot 的 shape.x
    // 对非 flex 子层是页面绝对坐标 —— 必须换算，统一在 renderElement 里处理
    width: element.size?.width,
    height: element.size?.height,
    characters: kind === 'text' ? (element.content ?? '') : undefined,
    svgContent: kind === 'svg' ? element.svgContent : undefined,
    // 多边形/星形由宿主按点数生成几何（DSL 只给点数，不给 path data）
    pointCount: kind === 'polygon' || kind === 'star'
      ? (element as DSLElement & { pointCount?: number }).pointCount
      : undefined,
    innerRadius: kind === 'star' ? (element as DSLElement & { innerRadius?: number }).innerRadius : undefined,
    pathData: kind === 'pen' || kind === 'path' ? element.svgPathData : undefined,
  }
}

/** 布局属性单独拆出来，因为它们的应用时机与其它属性不同（见文件头第 1 条） */
function splitProperties(element: DSLElement, dslType: string): {
  layoutProps: NodeProperties
  visualProps: NodeProperties
} {
  const props = toNodeProperties(element, dslType)

  const layoutKeys: (keyof NodeProperties)[] = [
    'layoutMode',
    'itemSpacing',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'primaryAxisAlignItems',
    'counterAxisAlignItems',
    // flexWrap 必须在 layoutMode 之后下发：宿主仅在已有 flex 布局时才接受 wrap，
    // 漏登记会被归入 visualProps（先于 layoutMode）→ 「节点没有 flex 布局」→ 换行静默失效。
    'flexWrap',
  ]

  const layoutProps: NodeProperties = {}
  const visualProps: NodeProperties = { ...props }

  for (const key of layoutKeys) {
    if (props[key] !== undefined) {
      ;(layoutProps as Record<string, unknown>)[key] = props[key]
      delete (visualProps as Record<string, unknown>)[key]
    }
  }

  return { layoutProps, visualProps }
}

export function toNodeProperties(element: DSLElement, dslType: string): NodeProperties {
  const props: NodeProperties = {}

  if (element.name !== undefined) props.name = element.name
  if (element.position?.x !== undefined) props.x = element.position.x
  if (element.position?.y !== undefined) props.y = element.position.y
  if (element.rotation !== undefined) props.rotation = element.rotation

  // 文本尺寸策略（见文件头第 2 条）
  const isText = dslType === 'text'
  const width = element.size?.width
  const height = element.size?.height
  if (isText) {
    if (width !== undefined) props.width = width
    if (width !== undefined && height !== undefined) props.height = height
  } else {
    if (width !== undefined) props.width = width
    if (height !== undefined) props.height = height
  }

  if (element.opacity !== undefined) props.opacity = element.opacity
  if (element.isVisible !== undefined) props.visible = element.isVisible
  if (element.isLocked !== undefined) props.locked = element.isLocked
  if (element.cornerRadius !== undefined) props.cornerRadius = element.cornerRadius
  if (element.topLeftRadius !== undefined) props.topLeftRadius = element.topLeftRadius
  if (element.topRightRadius !== undefined) props.topRightRadius = element.topRightRadius
  if (element.bottomLeftRadius !== undefined) props.bottomLeftRadius = element.bottomLeftRadius
  if (element.bottomRightRadius !== undefined) props.bottomRightRadius = element.bottomRightRadius
  if (element.blendMode !== undefined) props.blendMode = element.blendMode
  // 只有容器（board/frame）才支持裁剪内容；客户端渲染会为**每个**节点写 clipsContent（`cs.overflow === 'hidden'`），
  // 原样下发会让叶子节点逐条报「该节点类型不支持裁剪内容」—— 把真正的降级泄没在噪声里。
  if (element.clipsContent !== undefined && (dslType === 'frame' || dslType === 'component' || dslType === 'instance')) {
    props.clipsContent = element.clipsContent
  }

  // 节点级图片（<img src>）——客户端渲染引擎产出在节点上而非 fills 里
  if (element.imageUrl !== undefined) props.imageUrl = element.imageUrl
  if (element.imageScaleMode !== undefined) props.imageScaleMode = element.imageScaleMode as NodeProperties['imageScaleMode']

  const fills = mapFills(element.fills)
  if (fills.length) props.fills = fills

  const strokes = mapStrokes(element)
  if (strokes.length) props.strokes = strokes

  if (element.strokeWidth !== undefined) props.strokeWidth = element.strokeWidth

  const effects = mapEffects(element.effects)
  if (effects.length) props.effects = effects

  // 布局
  if (element.layoutMode !== undefined) {
    props.layoutMode = element.layoutMode === 'GRID' ? 'NONE' : element.layoutMode
  }
  if (element.itemSpacing !== undefined) props.itemSpacing = element.itemSpacing
  if (element.paddingTop !== undefined) props.paddingTop = element.paddingTop
  if (element.paddingRight !== undefined) props.paddingRight = element.paddingRight
  if (element.paddingBottom !== undefined) props.paddingBottom = element.paddingBottom
  if (element.paddingLeft !== undefined) props.paddingLeft = element.paddingLeft
  if (element.primaryAxisAlignItems !== undefined) props.primaryAxisAlignItems = element.primaryAxisAlignItems
  if (element.counterAxisAlignItems !== undefined) props.counterAxisAlignItems = element.counterAxisAlignItems

  // flexGrow:1 等价于主轴 FILL —— MasterGo 与 Penpot 的表达方式不同，这里做一次归一
  if (element.layoutSizingHorizontal !== undefined) props.layoutSizingHorizontal = element.layoutSizingHorizontal
  else if (element.flexGrow === 1) props.layoutSizingHorizontal = 'FILL'
  if (element.layoutSizingVertical !== undefined) props.layoutSizingVertical = element.layoutSizingVertical

  if (element.layoutPositioning !== undefined) props.layoutPositioning = element.layoutPositioning
  if (element.flexWrap !== undefined) props.flexWrap = element.flexWrap
  if (element.primaryAxisSizingMode !== undefined) props.primaryAxisSizingMode = element.primaryAxisSizingMode
  if (element.counterAxisSizingMode !== undefined) props.counterAxisSizingMode = element.counterAxisSizingMode

  // 文本
  if (element.content !== undefined) props.characters = element.content
  if (element.fontSize !== undefined) props.fontSize = element.fontSize
  if (element.fontName !== undefined) props.fontName = element.fontName
  if (element.fontWeight !== undefined) props.fontWeight = element.fontWeight
  if (element.textAlignHorizontal !== undefined) props.textAlignHorizontal = element.textAlignHorizontal
  if (element.textAlignVertical !== undefined) props.textAlignVertical = element.textAlignVertical

  const lineHeight = normalizeLineHeight(element.lineHeight)
  if (lineHeight) props.lineHeight = lineHeight

  const letterSpacing = normalizeLetterSpacing(element.letterSpacing)
  if (letterSpacing) props.letterSpacing = letterSpacing

  const autoResize = resolveTextAutoResize(element, isText, width, height)
  if (autoResize) props.textAutoResize = autoResize

  return props
}

function normalizeLineHeight(input: DSLElement['lineHeight']): NodeProperties['lineHeight'] | undefined {
  if (input === undefined) return undefined
  if (typeof input === 'number') return { value: input, unit: 'PIXELS' }
  if (!input || input.value === undefined) return undefined
  return { value: input.value, unit: input.unit ?? 'PIXELS' }
}

function normalizeLetterSpacing(input: DSLElement['letterSpacing']): NodeProperties['letterSpacing'] | undefined {
  if (input === undefined) return undefined
  if (typeof input === 'number') return { value: input, unit: 'PIXELS' }
  if (!input || input.value === undefined) return undefined
  return { value: input.value, unit: input.unit === 'PERCENT' ? 'PERCENT' : 'PIXELS' }
}

/**
 * 文本尺寸策略：把 DSL 的尺寸意图翻译成宿主可执行的 growType。
 * 与文件头第 2 条对应 —— 返回 undefined 表示「不显式设置，交给宿主默认」。
 */
function resolveTextAutoResize(
  element: DSLElement,
  isText: boolean,
  width?: number,
  height?: number,
): NodeProperties['textAutoResize'] | undefined {
  if (!isText) return undefined
  if (element.textAutoResize !== undefined) return element.textAutoResize
  if (width !== undefined && height !== undefined) return 'NONE'
  if (width !== undefined) return 'HEIGHT'
  return 'WIDTH_AND_HEIGHT'
}

/**
 * 填充映射。
 *
 * 关键：**不要把 `isVisible` / `alpha` 丢掉**。客户端渲染引擎产出的就是这两个名字
 * （而不是 `visible` / `opacity`）；只认后者会让「隐藏图层」显示出来、透明度失效。
 */
function mapFills(fills?: DSLFill[]): NonNullable<NodeProperties['fills']> {
  if (!Array.isArray(fills)) return []
  const mapped: NonNullable<NodeProperties['fills']> = []

  for (const fill of fills) {
    if (!fill || typeof fill !== 'object') continue
    const raw = fill as DSLFill & Record<string, unknown>
    const type = typeof raw.type === 'string' ? raw.type : undefined

    // 保留原样大小写：归一由 host/gradient.ts 负责（一处归一，两处受益）
    mapped.push({
      type,
      color: raw.color,
      gradientStops: raw.gradientStops as never,
      stops: raw.stops as never,
      gradientHandlePositions: raw.gradientHandlePositions as never,
      transform: raw.transform as never,
      imageUrl: raw.imageUrl,
      imageData: raw.imageData,
      imageScaleMode: raw.imageScaleMode as never,
      opacity: raw.opacity as number | undefined,
      alpha: raw.alpha as number | undefined,
      visible: raw.visible as boolean | undefined,
      isVisible: raw.isVisible as boolean | undefined,
      blendMode: raw.blendMode as string | undefined,
    })
  }

  return mapped
}

/**
 * 描边映射，含单边描边与**渐变描边**归一。
 *
 * - 单边：MasterGo 用 4 个权重字段（`strokeTopWeight` 等），这里归一成 `HostStroke.sides`，
 *   由 HostAdapter 决定「如实报降级」还是「原生支持」。
 * - 渐变：`type: 'GRADIENT_*' + gradientStops + gradientHandlePositions` 原样透传，
 *   Penpot 侧落到 `strokeColorGradient`（边框渐变的唯一正确表达）。
 */
function mapStrokes(element: DSLElement): HostStroke[] {
  const base = Array.isArray(element.strokes) ? element.strokes[0] : undefined

  const sources: DSLStroke[] = Array.isArray(element.strokes) && element.strokes.length
    ? element.strokes
    : base
      ? [base]
      : []

  // strokeWeight 是客户端渲染引擎的写法，与 strokeWidth 同义
  const fallbackWidth = element.strokeWidth ?? element.strokeWeight

  // ── 单边权重模式（CSS border-*-width 语义）──
  //
  // 引擎的 `extractStrokes` 在四边不等时会把四个权重全写出来（没边框的那边是 0），
  // 颜色只放在 `strokes[0]` 里。因此：**有任一边权重字段 ⇒ 进入单边模式**，
  // 每条**权重 > 0** 的边各自成一条 HostStroke（宽度取该边权重），
  // 这样上 1px / 下 2px 会因为宽度不同自然拆成两条叠加路径。
  const SIDES = ['top', 'right', 'bottom', 'left'] as const
  const sideWeightKeys = {
    top: 'strokeTopWeight',
    right: 'strokeRightWeight',
    bottom: 'strokeBottomWeight',
    left: 'strokeLeftWeight',
  } as const
  const hasPerSideWeights = SIDES.some((side) => element[sideWeightKeys[side]] !== undefined)

  /**
   * 把一条 DSL 描边来源映射成 HostStroke。
   * 三种分支（整圈原生 / 单边拆分 / 常规）只差 `width` 与 `sides`，其余字段逐字相同，
   * 因此共用这一个构造器 —— 否则改一个字段要同步改三处（过去就漏过字段）。
   */
  const buildStroke = (
    raw: DSLStroke & Record<string, unknown>,
    width: number | undefined,
    sides?: readonly StrokeSide[],
  ): HostStroke => ({
    type: typeof raw.type === 'string' ? raw.type : undefined,
    color: raw.color,
    gradientStops: raw.gradientStops as never,
    gradientHandlePositions: raw.gradientHandlePositions as never,
    transform: raw.transform as never,
    width,
    opacity: raw.opacity as number | undefined,
    alpha: raw.alpha as number | undefined,
    align: (raw.align as HostStroke['align']) ?? (element.strokeAlign as HostStroke['align']),
    dashPattern: raw.dashPattern as number[] | undefined,
    visible: raw.visible as boolean | undefined,
    isVisible: raw.isVisible as boolean | undefined,
    // 线帽/拐角是**元素级**字段（DSL 契约）→ 落到每条描边上，由宿主决定「两端怎么给」。
    // 以前这里只把字段列进 `KNOWN_DSL_FIELDS`（免得误报拼写错误）就再无下文 ——
    // 结果是线帽/拐角在 Penpot 侧**静默丢失**（比报降级更隐蔽，见 内部笔记）。
    capStart: typeof element.strokeCap === 'string' ? element.strokeCap : undefined,
    capEnd: typeof element.strokeCap === 'string' ? element.strokeCap : undefined,
    join: typeof element.strokeJoin === 'string' ? element.strokeJoin : undefined,
    ...(sides ? { sides: [...sides] } : {}),
  })

  if (hasPerSideWeights && sources.length) {
    const template = sources[0] as DSLStroke & Record<string, unknown>
    const weights = SIDES.map((side) => Number(element[sideWeightKeys[side]] ?? 0))

    // 四边权重相等且非零 → 等价于整圈描边，**走原生**（少 4 个叠加节点，且圆角更准）。
    // 手写 DSL 可能给出四边同权重；引擎在四边相等时只会给 strokeWeight，不会走这里。
    if (weights[0] > 0 && weights.every((w) => w === weights[0])) {
      return [buildStroke(template, weights[0])]
    }

    const out: HostStroke[] = []
    for (const side of SIDES) {
      const weight = element[sideWeightKeys[side]] ?? 0
      if (!(weight > 0)) continue
      out.push(buildStroke(template, weight, [side]))
    }
    return out
  }

  // ── 常规模式：四边同宽 ──
  return sources
    .filter((s) => s && typeof s === 'object')
    .map((s) => buildStroke(s as DSLStroke & Record<string, unknown>, s.width ?? fallbackWidth))
}

function mapEffects(effects?: DSLEffect[]): NonNullable<NodeProperties['effects']> {
  if (!Array.isArray(effects)) return []
  return effects
    .filter((e) => e && typeof e === 'object')
    .map((e) => {
      const raw = e as DSLEffect & Record<string, unknown>
      return {
        type: raw.type as 'DROP_SHADOW',
        offset: raw.offset ? { x: Number(raw.offset.x ?? 0), y: Number(raw.offset.y ?? 0) } : undefined,
        radius: raw.radius as number | undefined,
        spread: raw.spread as number | undefined,
        color: raw.color,
        visible: raw.visible as boolean | undefined,
        isVisible: raw.isVisible as boolean | undefined,
      }
    })
}

// ═══════════════════════════════════════════════════════════
// 字体预加载
// ═══════════════════════════════════════════════════════════

/** 收集整棵树的字体请求并批量加载（宿主侧一次调用比逐个元素调用便宜） */
export async function collectAndLoadFonts(host: HostAdapter, elements: DSLElement[]): Promise<void> {
  const families = new Map<string, { family: string; style?: string }>()

  const walk = (list: DSLElement[]) => {
    for (const element of list) {
      if (!element || typeof element !== 'object') continue
      if (element.type === 'text' && element.fontName?.family) {
        const key = `${element.fontName.family}::${element.fontName.style ?? ''}`
        if (!families.has(key)) {
          families.set(key, { family: element.fontName.family, style: element.fontName.style })
        }
      }
      if (Array.isArray(element.children)) walk(element.children)
    }
  }

  walk(elements)
  if (!families.size) return

  try {
    await host.loadFonts([...families.values()])
  } catch {
    // 字体加载失败不应阻断渲染：字形回退比整页失败好
  }
}

// ─── 供测试使用 ───────────────────────────────────────────

/** DSL 元素上所有被识别的字段（不在此集合内的字段会被报告为拼写问题） */
export const KNOWN_DSL_FIELDS: ReadonlySet<string> = new Set([
  'type',
  'name',
  'id',
  'isVisible',
  'isLocked',
  'position',
  'size',
  'rotation',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
  'fills',
  'strokes',
  'strokeWidth',
  'strokeWeight',
  'strokeAlign',
  // 客户端渲染 extractStrokes 会带出这两个（线帽/连接），属已知字段
  'strokeCap',
  'strokeJoin',
  'imageUrl',
  'imageScaleMode',
  'blendMode',
  'layoutPositioning',
  'flexWrap',
  'primaryAxisSizingMode',
  'counterAxisSizingMode',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
  'effects',
  'opacity',
  'children',
  'layoutMode',
  'itemSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'primaryAxisAlignItems',
  'counterAxisAlignItems',
  'layoutSizingHorizontal',
  'layoutSizingVertical',
  'flexGrow',
  'clipsContent',
  // 声明式令牌绑定（由渲染末端 §5 处理）
  'tokenBindings',
  'content',
  'fontSize',
  'fontWeight',
  'fontName',
  'lineHeight',
  'letterSpacing',
  'textAlignHorizontal',
  'textAlignVertical',
  'textAutoResize',
  // P2-3：多 run 富文本（渲染末端用 applyTextRuns 处理，不是 applyProperties 的字段）
  'runs',
  // 客户端渲染的文本色段元数据（尚未接线，但属于已知字段，不应报“拼写错误”）
  'textSegments',
  // 组件实例 / 换组件 / 变体：这些是合法 DSL 字段（各自有专门的渲染或转发路径）
  'componentId',
  'componentName',
  'componentUkey',
  'componentVariant',
  'overrides',
  'variantProperties',
  'swapNodeIds',
  'swapKeepOriginal',
  'swapKeepSize',
  'swapResetOverrides',
  'svgContent',
  'svgPathData',
  'pointCount',
  'innerRadius',
])

function findUnknownFields(element: DSLElement): string[] {
  return Object.keys(element).filter((key) => !KNOWN_DSL_FIELDS.has(key))
}

