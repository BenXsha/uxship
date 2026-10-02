/**
 * 画布 → DSL（反向导出）
 *
 * 与 `renderer.ts`（DSL → 画布）构成闭环。刻意做成**宿主无关**：只读 HostAdapter 的
 * `readProperties` / `children`，因此同一份导出逻辑对 Penpot / MasterGo / 内存宿主都成立。
 *
 * 三条原则（对应项目里反复强调的那几条）：
 *
 * 1. **字段名逐字对齐 DSL 规范**（`content` 而不是 `characters`、`position/size` 而不是 x/y），
 *    这样「导出 → 渲染」能真正闭环，而不是导出一份只有自己能读的私有结构。
 * 2. **拿不到的不编**：Penpot 的 `svg-raw` 没有 markup getter、instance 的母版可能查不到 ——
 *    这些都不猜，写进 `_notes` 并省略字段（历史教训：母版信息用 `'unknown'` 兜底，
 *    导致把本地母版误判成外部库）。
 * 3. **能力缺失要显式**：宿主没有的字段（如单边描边权重）不伪造；只在宿主确实提供了
 *    （Penpot 侧由 `mgmcp:sideBorderSpecs` 记录）时才还原。
 */
import type { HandlerContext } from '../api/index'
import type { HostComponentInfo, HostNode } from '../host/types'
import type { DSLElement, DSLDocument } from './types'
import { normalizeColor } from '../host/color'
import { normalizeFillType } from '../host/gradient'

/** 宿主类型词 → DSL 类型（`board`/`FRAME` 都归到 `frame`） */
const TYPE_TO_DSL: Record<string, string> = {
  board: 'frame',
  frame: 'frame',
  rect: 'rectangle',
  rectangle: 'rectangle',
  ellipse: 'ellipse',
  circle: 'ellipse',
  text: 'text',
  path: 'path',
  group: 'group',
  bool: 'boolean_operation',
  boolean: 'boolean_operation',
  boolean_operation: 'boolean_operation',
  instance: 'instance',
  component: 'component',
  star: 'star',
  polygon: 'polygon',
  line: 'line',
  'svg-raw': 'svg',
  svg: 'svg',
  image: 'svg',
}

/** 导出时读取的字段（一次读全，避免逐字段往返） */
const EXPORT_FIELDS = [
  'id', 'type', 'name', 'x', 'y', 'width', 'height', 'rotation',
  'visible', 'locked', 'opacity', 'blendMode', 'children',
  'fills', 'strokes', 'strokeWidth', 'strokeAlign', 'shadows', 'effects',
  'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
  'clipsContent', 'layoutMode', 'itemSpacing',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'primaryAxisAlignItems', 'counterAxisAlignItems',
  'primaryAxisSizingMode', 'counterAxisSizingMode', 'layoutSizingHorizontal', 'layoutSizingVertical',
  'characters', 'fontSize', 'fontWeight', 'fontName', 'lineHeight', 'letterSpacing',
  'textAlignHorizontal', 'textAlignVertical', 'textAutoResize',
  'componentId', 'svgContent', 'pathData',
] as const

export interface ExportOptions {
  /** 递归深度（缺省不限） */
  depth?: number
  /** 节点数上限护栏（缺省 2000）—— 超了就截断并如实标注 */
  maxNodes?: number
}

export interface ExportResult extends DSLDocument {
  /** 导出过程中的如实说明：哪些东西**没能**进 DSL、为什么 */
  _notes?: string[]
}

interface ExportState {
  visited: number
  truncatedNodes: number
  notes: Set<string>
  componentsByMaster: Map<string, HostComponentInfo>
  checkPluginData: ((node: HostNode, key: string) => string | undefined) | null
}

/** 颜色 → DSL 色值（统一 16 进制；量纲判定复用 host/color.ts，两个宿主口径一致） */
function toHex(color: unknown, opacity?: number): string | undefined {
  const normalized = normalizeColor(color, opacity)
  return normalized?.hex
}

/** 填充 → DSLFill（DSL 方言：`SOLID` / `GRADIENT_LINEAR` + `gradientStops`） */
function exportPaints(paints: unknown, path: string, state: ExportState): Record<string, unknown>[] | undefined {
  if (!Array.isArray(paints) || paints.length === 0) return undefined

  const out: Record<string, unknown>[] = []
  for (const paint of paints as Record<string, unknown>[]) {
    const type = normalizeFillType(paint.type) ?? 'SOLID'
    const entry: Record<string, unknown> = { type }

    if (type === 'SOLID') {
      const hex = toHex(paint.color, typeof paint.opacity === 'number' ? paint.opacity : (typeof paint.alpha === 'number' ? paint.alpha : undefined))
      if (hex) entry.color = hex
      else state.notes.add(`${path}: 纯色填充取不到色值（宿主未提供该字段），该填充被省略色值`)
    } else if (type.startsWith('GRADIENT')) {
      const stops = (paint.gradientStops ?? paint.stops) as { position?: number; offset?: number; color?: unknown }[] | undefined
      if (stops?.length) {
        entry.gradientStops = stops.map((stop) => ({
          position: stop.position ?? stop.offset ?? 0,
          color: toHex(stop.color) ?? '#000000',
        }))
      } else {
        state.notes.add(`${path}: 渐变填充没有色标，导出后无法还原渐变`)
      }
      if (paint.gradientHandlePositions) entry.gradientHandlePositions = paint.gradientHandlePositions
      if (paint.transform) entry.transform = paint.transform
    } else if (paint.imageUrl || paint.imageData) {
      entry.imageUrl = paint.imageUrl ?? paint.imageData
      entry.imageScaleMode = paint.imageScaleMode
    }

    if (paint.visible === false || paint.isVisible === false) entry.visible = false
    if (typeof paint.opacity === 'number') entry.opacity = paint.opacity
    if (paint.blendMode) entry.blendMode = paint.blendMode
    out.push(entry)
  }
  return out
}

/** 效果（阴影/模糊）：DSL 里可见性字段叫 `visible`（paints 用 `isVisible`，历史约定） */
function exportEffects(effects: unknown, path: string, state: ExportState): Record<string, unknown>[] | undefined {
  if (!Array.isArray(effects) || effects.length === 0) return undefined
  return (effects as Record<string, unknown>[]).map((effect) => {
    const entry: Record<string, unknown> = { type: effect.type ?? 'DROP_SHADOW' }
    if (effect.offset) entry.offset = effect.offset
    if (typeof effect.radius === 'number') entry.radius = effect.radius
    if (typeof effect.spread === 'number') entry.spread = effect.spread
    const hex = toHex(effect.color, typeof effect.opacity === 'number' ? effect.opacity : undefined)
    if (hex) entry.color = hex
    if (effect.visible === false || effect.isVisible === false) entry.visible = false
    else if (!('visible' in effect) && !('isVisible' in effect)) {
      void path
    }
    return entry
  })
}

/** 数值字段：宿主可能给字符串（Penpot 的排版字段都是字符串）→ 归一成数字 */
function toNumber(input: unknown): number | undefined {
  if (typeof input === 'number') return input
  if (typeof input === 'string' && input.trim() !== '' && !Number.isNaN(Number(input))) return Number(input)
  return undefined
}

/** 行高/字距：DSL 口径是 `{ value, unit }`，与渲染器一致（闭环的前提） */
function exportMetric(input: unknown): number | { unit: 'PIXELS' | 'PERCENT' | 'AUTO'; value?: number } | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input === 'number') return input
  if (typeof input === 'object') {
    const record = input as { value?: unknown; unit?: unknown }
    const value = toNumber(record.value)
    if (value === undefined) return undefined
    return { unit: (record.unit as 'PIXELS' | 'PERCENT' | 'AUTO') ?? 'PIXELS', value }
  }
  const value = toNumber(input)
  return value === undefined ? undefined : { unit: 'PIXELS', value }
}

function buildElement(
  context: HandlerContext,
  node: HostNode,
  path: string,
  state: ExportState,
  depth: number,
  options: ExportOptions,
): DSLElement | null {
  if (state.visited >= (options.maxNodes ?? 2000)) {
    state.truncatedNodes += 1
    return null
  }
  state.visited += 1

  // SAFETY: EXPORT_FIELDS 是 as const 的字面量元组，readProperties 只读遍历；断言把它当普通 string[] 传入，不改变运行时取值。
  const props = context.host.readProperties(node, EXPORT_FIELDS as unknown as string[])
  const hostType = String(props.type ?? '')
  const dslType = TYPE_TO_DSL[hostType.toLowerCase()]
  const name = String(props.name ?? '')
  const label = path ? `${path}/${name}` : name

  if (!dslType) {
    state.notes.add(`${label}: 宿主类型 ${hostType} 在 DSL 里没有对应类型 → 未导出（不静默改类型）`)
    return null
  }

  const element: DSLElement = { type: dslType, name, id: String(props.id ?? node.id) }

  if (props.visible === false) element.isVisible = false
  if (props.locked === true) element.isLocked = true

  const x = toNumber(props.x)
  const y = toNumber(props.y)
  if (x !== undefined && y !== undefined) element.position = { x, y }
  const width = toNumber(props.width)
  const height = toNumber(props.height)
  if (width !== undefined && height !== undefined) element.size = { width, height }

  const rotation = toNumber(props.rotation)
  if (rotation) element.rotation = rotation
  const opacity = toNumber(props.opacity)
  if (opacity !== undefined && opacity !== 1) element.opacity = opacity
  if (props.blendMode) element.blendMode = props.blendMode as string

  // ── 填充 / 描边 ──
  const fills = exportPaints(props.fills, label, state)
  if (fills) element.fills = fills as DSLElement['fills']

  const strokes = exportPaints(props.strokes, label, state)
  if (strokes) {
    element.strokes = strokes as DSLElement['strokes']
    const strokeWidth = toNumber(props.strokeWidth)
    if (strokeWidth !== undefined) element.strokeWidth = strokeWidth
    if (props.strokeAlign) element.strokeAlign = props.strokeAlign as DSLElement['strokeAlign']

    // 线帽（元素级单值，见 `lib/dsl/types.ts#strokeCap`）：只有**所有**描边给出同一顶帽子时才写。
    // DSL 表达不了“混合线帽”，遇到就记 note —— 不静默丢（原来是全丢：字段连声明都没有）。
    const rawStrokes: { capStart?: unknown }[] = Array.isArray(props.strokes) ? props.strokes : []
    const caps = rawStrokes.map((s) => s.capStart).filter((cap): cap is string => typeof cap === 'string')
    if (caps.length) {
      const unique = new Set(caps)
      const uniform = caps.length === rawStrokes.length && unique.size === 1
      if (!uniform) {
        state.notes.add(`${label}: 描边的线帽不一致（${[...unique].join(' / ')}）→ DSL 只有元素级 strokeCap，未导出`)
      } else if ([...unique][0] !== 'NONE') {
        element.strokeCap = [...unique][0]
      }
    }
  }

  // 单边描边：Penpot 侧用叠加 Path 模拟（见 host/border-sides.ts），规格记在 pluginData 里。
  // 导出时还原成 DSL 的四边权重 —— 这是「往返不丢语义」的关键一步。
  if (state.checkPluginData) {
    const spec = state.checkPluginData(node, 'mgmcp:sideBorderSpecs')
    if (spec) {
      try {
        const parsed = JSON.parse(spec) as { top?: number; right?: number; bottom?: number; left?: number }
        element.strokeTopWeight = parsed.top ?? 0
        element.strokeRightWeight = parsed.right ?? 0
        element.strokeBottomWeight = parsed.bottom ?? 0
        element.strokeLeftWeight = parsed.left ?? 0
      } catch {
        state.notes.add(`${label}: 单边描边规格（pluginData）解析失败，四边权重未能还原`)
      }
    }
    // 合成出来的那条 Path 不是用户画的东西 → 不进 DSL
    if (state.checkPluginData(node, 'mgmcp:sideBorders')) return null
  }

  const effects = exportEffects(props.effects ?? props.shadows, label, state)
  if (effects) {
    // SAFETY: exportEffects 返回的 DSL 效果数组与 DSLElement['effects'] 是同一结构（写读两侧共用同一套字段），断言仅抹平 unknown 中转。
    element.effects = effects as unknown as DSLElement['effects']
  }

  // ── 圆角 ──
  const radius = toNumber(props.cornerRadius)
  if (radius !== undefined && radius !== 0) element.cornerRadius = radius
  for (const [key, dslKey] of [
    ['topLeftRadius', 'topLeftRadius'],
    ['topRightRadius', 'topRightRadius'],
    ['bottomLeftRadius', 'bottomLeftRadius'],
    ['bottomRightRadius', 'bottomRightRadius'],
  ] as const) {
    const value = toNumber(props[key])
    if (value !== undefined) {
      ;/* SAFETY: dslKey 是四个分角圆角字段名的字面量集合，DSLElement 上均有对应成员且为 number；按 Record 写入不改变运行时形状。 */ (element as unknown as Record<string, unknown>)[dslKey] = value
    }
  }

  // ── 容器 / 自动布局 ──
  const layoutMode = props.layoutMode
  if (layoutMode && layoutMode !== 'NONE') element.layoutMode = layoutMode as DSLElement['layoutMode']
  const itemSpacing = toNumber(props.itemSpacing)
  if (itemSpacing !== undefined) element.itemSpacing = itemSpacing
  for (const key of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) {
    const value = toNumber(props[key])
    if (value !== undefined && value !== 0) element[key] = value
  }
  if (props.primaryAxisAlignItems) element.primaryAxisAlignItems = props.primaryAxisAlignItems as DSLElement['primaryAxisAlignItems']
  if (props.counterAxisAlignItems) element.counterAxisAlignItems = props.counterAxisAlignItems as DSLElement['counterAxisAlignItems']
  if (props.primaryAxisSizingMode) element.primaryAxisSizingMode = props.primaryAxisSizingMode as DSLElement['primaryAxisSizingMode']
  if (props.counterAxisSizingMode) element.counterAxisSizingMode = props.counterAxisSizingMode as DSLElement['counterAxisSizingMode']
  if (props.layoutSizingHorizontal) element.layoutSizingHorizontal = props.layoutSizingHorizontal as DSLElement['layoutSizingHorizontal']
  if (props.layoutSizingVertical) element.layoutSizingVertical = props.layoutSizingVertical as DSLElement['layoutSizingVertical']
  if (props.clipsContent === true) element.clipsContent = true

  // ── 文本 ──
  if (dslType === 'text') {
    if (typeof props.characters === 'string') element.content = props.characters
    const fontSize = toNumber(props.fontSize)
    if (fontSize !== undefined) element.fontSize = fontSize
    const fontWeight = toNumber(props.fontWeight)
    if (fontWeight !== undefined) element.fontWeight = fontWeight
    if (props.fontName && typeof props.fontName === 'object') element.fontName = props.fontName as DSLElement['fontName']
    const lineHeight = exportMetric(props.lineHeight)
    if (lineHeight !== undefined) element.lineHeight = lineHeight
    const letterSpacing = exportMetric(props.letterSpacing)
    if (letterSpacing !== undefined) element.letterSpacing = letterSpacing
    if (props.textAlignHorizontal) element.textAlignHorizontal = props.textAlignHorizontal as DSLElement['textAlignHorizontal']
    if (props.textAlignVertical) element.textAlignVertical = props.textAlignVertical as DSLElement['textAlignVertical']
    if (props.textAutoResize) element.textAutoResize = props.textAutoResize as DSLElement['textAutoResize']
    // 富文本 run（P2-3）：只在真的多 run 时写（单 run 不膨胀）；读回失败不阻断导出
    try {
      const runs = context.host.readTextRuns(node)
      if (runs.length > 1) element.runs = runs.map((run) => ({ ...run }))
    } catch (error) {
      state.notes.add(`${label}: 富文本 run 读回失败（${(error as Error).message}）→ 按单 run 导出`)
    }
  }

  // ── 组件实例 ──
  // 导出成 `frame` + `componentId` + `isExpandedInstance`（与 MasterGo 导出器同一约定）：
  // 导出的树是**展开后的真实形状**，因此逐字可再渲染，不依赖目标文档里还有这个组件。
  const ownComponentId = typeof props.componentId === 'string' && props.componentId ? props.componentId : undefined
  const isInstance = dslType === 'instance' || Boolean(ownComponentId)
  if (isInstance) {
    if (dslType === 'instance') element.type = 'frame'
    element.isExpandedInstance = true
    const component = ownComponentId ? state.componentsByMaster.get(ownComponentId) : undefined
    if (ownComponentId) {
      element.componentId = ownComponentId
      if (component?.name) element.componentName = component.name
      // 只有宿主给出可靠的本地/外部标记时才写（拿不到就省略，不猜 —— 历史坑：用 'unknown' 兜底会被当成外部库）
      if (component?.isLocal !== undefined) element.isLocalMaster = component.isLocal
    } else {
      state.notes.add(`${label}: 是组件实例，但 componentId 取不到 → 无法标注母版来源（children 仍是真实形状树）`)
    }
  }

  // ── 矢量 ──
  if (dslType === 'svg') {
    const svgContent = typeof props.svgContent === 'string' ? props.svgContent : undefined
    if (svgContent) element.svgContent = svgContent
    else {
      // 单节点回读：本仓库 typings 未声明 `svg-raw` 的源码/markup getter（所以这里拿不到 SVG 源码）；
      // 但整棵形状可以用 `penpot.generateMarkup(shapes, {type:'svg'})` 导出 SVG —— 两条要分清。
      // 之前这里写成"无法回读 markup"，是错的（把"没有 getter"读成了"导不出来"）。
      state.notes.add(
        `${label}: svg-raw 单节点取不到 SVG 源码（宿主无该 getter）→ 只导出位置尺寸；` +
        '如需 SVG 请用 penpot.generateMarkup(shapes, {type:"svg"})（见 内部笔记 #4）',
      )
    }
  }
  const pathData = typeof props.pathData === 'string' ? props.pathData : undefined
  if (dslType === 'path' && pathData) element.svgPathData = pathData
  else if (dslType === 'path' && !pathData) {
    state.notes.add(`${label}: path 的 d 取不到 → 只导出位置尺寸`)
  }

  // ── 子节点 ──
  const childIds = (props.children as string[] | undefined) ?? []
  if (childIds.length) {
    if (options.depth !== undefined && depth >= options.depth) {
      state.notes.add(`${label}: 已达 depth=${options.depth}，${childIds.length} 个子节点未导出`)
    } else {
      const children: DSLElement[] = []
      for (const childId of childIds) {
        const child = context.host.getNodeById(childId)
        if (!child) {
          state.notes.add(`${label}: 子节点 ${childId} 读不到（可能已删除）`)
          continue
        }
        const built = buildElement(context, child, label, state, depth + 1, options)
        if (built) children.push(built)
      }
      if (children.length) element.children = children
    }
  }

  return element
}

/** 建立「组件 → 组件信息」索引（用于给实例补 componentName / isLocalMaster） */
async function buildComponentIndex(context: HandlerContext): Promise<Map<string, HostComponentInfo>> {
  const map = new Map<string, HostComponentInfo>()
  if (!context.host.getCapabilities().ops.componentInstances) return map
  try {
    for (const component of await context.host.listComponents()) {
      if (component.masterNodeId) map.set(component.masterNodeId, component)
      map.set(component.id, component)
    }
  } catch {
    // 组件库读不到不影响导出，只是实例还原不了（由 _notes 说明）
  }
  return map
}

async function exportNodes(
  context: HandlerContext,
  roots: readonly HostNode[],
  options: ExportOptions,
): Promise<ExportResult> {
  const state: ExportState = {
    visited: 0,
    truncatedNodes: 0,
    notes: new Set<string>(),
    componentsByMaster: await buildComponentIndex(context),
    checkPluginData:
      typeof context.host.getNodePluginData === 'function'
        ? (node, key) => context.host.getNodePluginData?.(node, key)
        : null,
  }

  const elements: DSLElement[] = []
  for (const root of roots) {
    const built = buildElement(context, root, '', state, 0, options)
    if (built) elements.push(built)
  }

  const notes = [...state.notes]
  if (state.truncatedNodes > 0) {
    notes.push(`节点数超过上限（${options.maxNodes ?? 2000}），有 ${state.truncatedNodes} 个节点未导出 —— 缩小范围或调大 maxNodes`)
  }

  return {
    version: '2.0',
    elements,
    ...(notes.length ? { _notes: notes } : {}),
  }
}

/** `dsl/exportSelection`：导出当前选区 */
export async function handleDSLExportSelection(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<ExportResult> {
  const selection = context.host.getSelection()
  if (!selection.length) {
    throw new Error('没有选中任何节点（先 selection/set 或用 nodeId 指定节点）')
  }
  return await exportNodes(context, selection, {
    depth: typeof params.depth === 'number' ? params.depth : undefined,
    maxNodes: typeof params.maxNodes === 'number' ? params.maxNodes : undefined,
  })
}

/** `dsl/exportNode`：导出指定节点的子树 */
export async function handleDSLExportNode(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<ExportResult> {
  const nodeId = typeof params.nodeId === 'string' ? params.nodeId : undefined
  if (!nodeId) {
    const selection = context.host.getSelection()
    if (selection.length === 1) return await handleDSLExportSelection(params, context)
    if (!selection.length) throw new Error('dsl/exportNode 需要 nodeId（或先选中恰好一个节点）')
    throw new Error(`选中了 ${selection.length} 个节点：请传 nodeId 指定要导出的那个`)
  }

  const node = context.host.getNodeById(nodeId)
  if (!node) throw new Error(`节点不存在: ${nodeId}（Penpot 只能查当前页）`)

  return await exportNodes(context, [node], {
    depth: typeof params.depth === 'number' ? params.depth : undefined,
    maxNodes: typeof params.maxNodes === 'number' ? params.maxNodes : undefined,
  })
}
