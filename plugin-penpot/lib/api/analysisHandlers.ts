/**
 * 设计分析（design/describe）与状态矩阵（component/stateMatrix）
 *
 * 两者都刻意做成**宿主无关**（只依赖 HostAdapter 原语），因此对 Penpot / MasterGo / 内存宿主
 * 都成立 —— 这也是「把能力放在能复用的那一层」的收益：不需要为每个宿主各写一遍。
 */
import type { HandlerContext } from './index'
import type { CreateVariantsResult, HostNode, NodeProperties } from '../host/types'
import { normalizeColor } from '../host/color'

// ───────────────────────── design/describe ─────────────────────────

interface DescribeOptions {
  maxDepth: number
  includeStyle: boolean
}

/**
 * describe 输出的单个节点条目。
 *
 * 字段**随情况增减**（`hidden` 只在隐藏时出现、`layout` 只在有布局时出现、
 * `children` 在截断时是描述字符串），所以这里刻意是开放记录而不是封闭接口 ——
 * 但它是**具名类型**，调用方不会拿到无标记的 `unknown`。
 */
type DescribeNodeEntry = Record<string, unknown>

/** `design/describe` 的返回：顶层小结 + 节点树 */
interface DescribeResult {
  ok: true
  summary: {
    roots: number
    visited: number
    truncatedBranches?: number
    source: 'nodeId' | 'selection' | 'page'
  }
  depth: number
  includeStyle: boolean
  nodes: DescribeNodeEntry[]
}

/**
 * 把宿主类型词归一化到**跨宿主共享词汇**（frame/text/rect/…）。
 *
 * 理由：`design/describe` 的输出是给 AI 写 `design_suggest` 指令用的，而同一句指令要能
 * 两个宿主通用。宿主原生词（Penpot `board` / MasterGo `FRAME`）放在 `hostType` 里保留。
 */
const TYPE_ALIASES: Record<string, string> = {
  board: 'frame', frame: 'frame',
  rect: 'rect', rectangle: 'rect',
  ellipse: 'ellipse', circle: 'ellipse',
  text: 'text', path: 'path', group: 'group', bool: 'boolean', boolean: 'boolean',
  component: 'component', instance: 'instance',
  star: 'star', polygon: 'polygon', line: 'line', svgraw: 'svg',
}

function normalizeType(hostType: unknown): string {
  const raw = String(hostType ?? '').toLowerCase()
  return TYPE_ALIASES[raw] ?? raw
}

/** 一句话描述布局，例如 `HORIZONTAL gap=12 pad=16/16/16/16 align=center/start` */
function layoutSummary(context: HandlerContext, node: HostNode): string | undefined {
  const props = context.host.readProperties(node, ['layoutMode'])
  const mode = props.layoutMode
  if (mode !== 'HORIZONTAL' && mode !== 'VERTICAL') return undefined
  return String(mode)
}

/** 样式摘要：颜色/字体/圆角/不透明度（只在 includeStyle 时收集，避免输出膨胀） */
function styleSummary(context: HandlerContext, node: HostNode): Record<string, unknown> | undefined {
  const props = context.host.readProperties(node, ['fills', 'strokes', 'fontSize', 'fontWeight', 'cornerRadius', 'opacity'])

  const out: Record<string, unknown> = {}
  const fills = props.fills as { type?: string; color?: unknown; opacity?: number; gradientStops?: { color: unknown }[] }[] | undefined
  if (Array.isArray(fills) && fills.length) {
    out.fills = fills.map((fill) => {
      const type = String(fill.type ?? '').toUpperCase()
      if (type.startsWith('GRADIENT')) {
        return `GRADIENT(${(fill.gradientStops ?? []).map((stop) => normalizeColor(stop.color)?.hex ?? '?').join('→')})`
      }
      const color = normalizeColor(fill.color, fill.opacity)
      return color ? `${color.hex} @${Math.round(color.opacity * 100)}%` : type
    })
  }

  const strokes = props.strokes as { color?: unknown; width?: number }[] | undefined
  if (Array.isArray(strokes) && strokes.length) {
    out.strokes = strokes.map((stroke) => {
      const color = normalizeColor(stroke.color)
      return `${color?.hex ?? '?'} w=${stroke.width ?? 1}`
    })
  }

  if (props.fontSize !== undefined) out.fontSize = props.fontSize
  if (props.fontWeight !== undefined) out.fontWeight = props.fontWeight
  if (props.cornerRadius !== undefined && props.cornerRadius !== 0) out.cornerRadius = props.cornerRadius
  if (typeof props.opacity === 'number' && props.opacity !== 1) out.opacity = props.opacity

  return Object.keys(out).length ? out : undefined
}

/**
 * `design/describe`：节点的**轻量结构化摘要**（比 DSL 小 60–80%）。
 *
 * 用途是让 AI 快速理解布局结构后再做自然语言调整（配合 design_suggest）。
 * 刻意不返回像素级细节与完整样式树 —— 那是 DSL 导出的职责。
 */
export function handleDesignDescribe(
  params: Record<string, unknown>,
  context: HandlerContext,
): DescribeResult {
  let roots: HostNode[]
  const nodeId = typeof params.nodeId === 'string' ? params.nodeId : undefined

  if (nodeId) {
    const node = context.host.getNodeById(nodeId)
    if (!node) throw new Error(`节点不存在: ${nodeId}（Penpot 只能查当前页）`)
    roots = [node]
  } else {
    const selection = context.host.getSelection()
    roots = selection.length ? [...selection] : [...context.host.getPageRootNodes()]
  }

  const options: DescribeOptions = {
    maxDepth: typeof params.depth === 'number' ? Math.max(0, params.depth) : 3,
    includeStyle: params.includeStyle === true,
  }

  let visited = 0
  let truncated = 0

  const walk = (node: HostNode, depth: number): DescribeNodeEntry => {
    visited += 1
    const props = context.host.readProperties(node, ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'children', 'characters', 'visible'])
    const entry: DescribeNodeEntry = {
      name: props.name,
      type: normalizeType(props.type),
      hostType: props.type,
      x: Math.round(Number(props.x ?? 0)),
      y: Math.round(Number(props.y ?? 0)),
      w: Math.round(Number(props.width ?? 0)),
      h: Math.round(Number(props.height ?? 0)),
    }
    if (props.visible === false) entry.hidden = true

    const layout = layoutSummary(context, node)
    if (layout) entry.layout = layout

    const text = props.characters
    if (typeof text === 'string' && text) {
      entry.text = text.length > 60 ? `${text.slice(0, 60)}…` : text
    }

    if (options.includeStyle) {
      const style = styleSummary(context, node)
      if (style) entry.style = style
    }

    const childIds = (props.children as string[] | undefined) ?? []
    if (childIds.length) {
      if (depth >= options.maxDepth) {
        truncated += 1
        entry.children = `${childIds.length}（已截断，depth=${options.maxDepth}）`
      } else {
        entry.children = childIds
          .map((id) => context.host.getNodeById(id))
          .filter((child): child is HostNode => Boolean(child))
          .map((child) => walk(child, depth + 1))
      }
    }
    return entry
  }

  const tree = roots.map((root) => walk(root, 0))

  return {
    ok: true,
    // 顶层给一个小结，AI 常先读这个
    summary: {
      roots: tree.length,
      visited,
      ...(truncated ? { truncatedBranches: truncated } : {}),
      source: nodeId ? 'nodeId' : context.host.getSelection().length ? 'selection' : 'page',
    },
    depth: options.maxDepth,
    includeStyle: options.includeStyle,
    nodes: tree,
  }
}

// ───────────────────────── component/stateMatrix ─────────────────────────

/**
 * 各状态的**预设视觉差异**（刻意保守）。
 *
 * 只做「无需品牌信息就能确定」的变换；需要品牌色/描边风格的（如 focused 的焦点环）
 * 不猜，改为在 `presetsSkipped` 里如实列出，交给 AI 用 node_update 补。
 */
interface StatePreset {
  opacity?: number
  /** 填充加深比例（0–1） */
  darken?: number
  skip?: string
}

const STATE_PRESETS: Record<string, StatePreset> = {
  default: {},
  hover: { darken: 0.08 },
  active: { darken: 0.16 },
  pressed: { darken: 0.16 },
  selected: { darken: 0.12 },
  disabled: { opacity: 0.4 },
  loading: { opacity: 0.6 },
  focused: { skip: '需要品牌色画焦点环/描边 —— 不做猜测，请用 node_update 补' },
  error: { skip: '需要语义色 —— 不做猜测' },
}

const DEFAULT_STATES = ['default', 'hover', 'active', 'disabled', 'focused']

/** 把颜色按比例变暗（用于 hover/active 的预设） */
function darkenHex(color: string, ratio: number): string | null {
  const normalized = normalizeColor(color)
  if (!normalized) return null
  const hex = normalized.hex.replace('#', '')
  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
  const darkened = channels.map((value) => Math.max(0, Math.round(value * (1 - ratio))))
  return `#${darkened.map((value) => value.toString(16).padStart(2, '0').toUpperCase()).join('')}`
}

/**
 * `component/stateMatrix`：把「一个组件在 N 个状态下的样子」做成**变体集**。
 *
 * Penpot 侧的做法（比 MasterGo 更原生）：
 *   1. 复制源节点 N 份；
 *   2. **非 board 的源包一层同尺寸 frame**（Penpot 的 createVariantFromComponents 只接受 board）；
 *   3. 应用各状态的保守预设（见 STATE_PRESETS）；
 *   4. `createVariants(nodes, 'State', states)` → 原生 VariantContainer + 属性轴。
 *      宿主不支持变体时降级为 `naming: 'default'`（`DS_<State>` 前缀命名），并如实说明。
 *
 * 与 MasterGo 侧的差别：那里的状态视觉由 `component_render` + 内置组件模板产生；
 * Penpot 侧尚未接线 component_render，因此**必须给 nodeId 指定已画好的组件**。
 */
export async function handleComponentStateMatrix(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const nodeId = typeof params.nodeId === 'string' ? params.nodeId : undefined
  if (!nodeId) {
    return {
      available: false,
      reason: 'Penpot 侧尚未接线 component_render（33 种预设组件），无法按组件类型自动生成状态矩阵',
      hint: '先在画布上画好一个组件（或用 component_list 取一个母版/实例），再把它的 nodeId 传进来；本方法会复制 N 份并合成为原生变体集',
    }
  }

  const source = context.host.getNodeById(nodeId)
  if (!source) throw new Error(`节点不存在: ${nodeId}（Penpot 只能查当前页）`)

  const states = Array.isArray(params.states) && params.states.length
    ? (params.states as string[]).map(String)
    : DEFAULT_STATES
  const naming = String(params.naming ?? 'variant')
  const variantPropertyName = String(params.variantPropertyName ?? 'State')
  const position = (params.position ?? {}) as { x?: number; y?: number }
  const startX = typeof position.x === 'number' ? position.x : 100
  const startY = typeof position.y === 'number' ? position.y : 100

  const sourceProps = context.host.readProperties(source, ['name', 'width', 'height'] as never)
  const sourceName = String(sourceProps.name ?? 'Component')
  const boxW = Number(sourceProps.width ?? 0) || 100
  const boxH = Number(sourceProps.height ?? 0) || 100

  const created: HostNode[] = []
  const presetsApplied: Record<string, string[]> = {}
  const presetsSkipped: Record<string, string> = {}
  /** 源是组件时，哪些状态的副本被 detach 成了普通 board（真机必需，见下方注释） */
  const detachedStates: string[] = []

  for (let index = 0; index < states.length; index += 1) {
    const state = states[index]
    const clone = await context.host.cloneNode(source)
    await context.host.applyProperties(clone, { name: `${sourceName} / ${state}` })

    /**
     * 源本身是组件（母版 / 副本实例）时，`cloneNode` 出来的是**组件副本实例**；
     * 而 Penpot 的 `createVariantFromComponents` 只接受普通 board —— 副本实例会被后端拒：
     * `Value not valid: [object ShapeProxy],… Code: :shapes`。
     *
     * 真机实测（对照）：源是普通 board 时合成成功；源是组件母版时，**即使先 `createComponent`
     * 也照样被拒** —— 因为副本实例的身份没变。所以先把副本 detach 成普通 board 再进变体集。
     */
    if (context.host.readProperties(clone, ['isComponentCopyInstance'] as never).isComponentCopyInstance === true) {
      const detached = await context.host.detachInstance(clone)
      if (detached.detached) detachedStates.push(state)
      else if (detached.note) presetsSkipped[state] = detached.note
    }

    // 非 board 的源包一层 frame：createVariantFromComponents 只接受 board
    let frame = clone
    if (clone.type !== 'board') {
      frame = await context.host.createNode(
        { kind: 'frame', name: `${sourceName} / ${state}`, width: boxW, height: boxH },
        null,
      )
      await context.host.appendChild(frame, clone)
      await context.host.applyProperties(clone, { x: 0, y: 0 })
      await context.host.applyProperties(frame, { fills: [] })
    }

    // 状态预设（保守；不猜品牌相关的）
    const preset = STATE_PRESETS[state.toLowerCase()] ?? {}
    if (preset.skip) {
      presetsSkipped[state] = preset.skip
    } else {
      const patch: NodeProperties = {}
      const applied: string[] = []
      if (preset.opacity !== undefined) {
        patch.opacity = preset.opacity
        applied.push(`opacity=${preset.opacity}`)
      }
      if (preset.darken !== undefined) {
        const fills = (context.host.readProperties(clone, ['fills']).fills as { type?: string; color?: unknown }[] | undefined) ?? []
        const solid = fills.find((fill) => String(fill.type ?? '').toUpperCase() === 'SOLID')
        const darkened = solid?.color ? darkenHex(String(solid.color), preset.darken) : null
        if (darkened && fills.length) {
          patch.fills = fills.map((fill) =>
            String(fill.type ?? '').toUpperCase() === 'SOLID' ? { ...fill, color: darkened } : fill,
          ) as never
          applied.push(`fill→${darkened}`)
        } else if (fills.length) {
          presetsSkipped[state] = '没有可加深的纯色填充（渐变/图片不猜）'
        }
      }
      if (Object.keys(patch).length) {
        const result = await context.host.applyProperties(clone, patch)
        if (result.skipped.length) presetsSkipped[state] = result.skipped.map((skip) => skip.reason).join('；')
      }
      presetsApplied[state] = applied
    }

    // 排布：状态之间横向摆放，便于人眼对比
    await context.host.applyProperties(frame, { x: startX + index * (boxW + 24), y: startY })
    created.push(frame)
  }

  /**
   * 合成变体集（宿主支持时走原生）。
   *
   * ⚠️ 两个真机坑，都在这里堆过：
   *
   * 1. **成员必须先转成组件母版**。Penpot 的 `createVariantFromComponents` 只接受**组件**，
   *    直接喂普通 board 会被后端拒：`Value not valid: [object ShapeProxy],… Code: :shapes`。
   *    走得通的 `combineVariants` 路径（`exportHandlers.ts`）也是先逐个 `createComponent` 再合成 ——
   *    这里对齐它。`createComponent` 是**原位**转母版（节点 id 不变），`created` 仍然有效。
   * 2. **宿主抛错必须就地兜住**。否则异常穿透到 MCP 层，调用方只看到 `Internal error`，
   *    连为这个场景准备好的 `DS_<State>` 降级都跑不到，画布上还留一堆半成品。
   */
  let variants: CreateVariantsResult = { ok: false, reason: 'naming=default：按约定命名，不合成变体集' }
  if (naming === 'variant') {
    let convertFailure: string | undefined
    for (let index = 0; index < created.length; index += 1) {
      try {
        await context.host.createComponent([created[index]])
      } catch (error) {
        convertFailure = `${states[index]}: ${(error as Error).message}`
        break
      }
    }

    if (convertFailure) {
      variants = { ok: false, reason: `状态转组件母版失败（${convertFailure}）` }
    } else {
      try {
        variants = await context.host.createVariants(created, variantPropertyName, states)
      } catch (error) {
        variants = {
          ok: false,
          reason: `宿主拒绝合成变体集：${(error as Error).message}（${created.length} 个状态已原地转成组件母版）`,
        }
      }
    }
  }

  if (naming === 'variant' && !variants.ok) {
    // 降级：改名成 DS_<State> 约定，并如实说明（不静默）
    for (let index = 0; index < created.length; index += 1) {
      await context.host.applyProperties(created[index], { name: `DS_${states[index]}` })
    }
  }

  const notes: string[] = []
  if (detachedStates.length > 0) {
    notes.push(
      `源是组件，克隆出的副本已 detach 成普通 board（Penpot 的变体合成只接受普通 board）：${detachedStates.join('、')}`,
    )
  }
  if (naming === 'variant' && !variants.ok) {
    notes.push(`未合成原生变体集（${variants.reason}）→ 已降级为 DS_<State> 命名约定`)
  }
  if (Object.keys(presetsSkipped).length) {
    notes.push('部分状态没有套用预设视觉（不做猜测，请用 node_update 补）')
  }

  return {
    ok: true,
    sourceNodeId: nodeId,
    sourceName,
    states,
    naming,
    ...(naming === 'variant' && variants.ok
      ? { variantContainerId: variants.containerId, variantComponentIds: variants.componentIds }
      : {}),
    nodeIds: created.map((node) => node.id),
    presetsApplied,
    ...(Object.keys(presetsSkipped).length ? { presetsSkipped } : {}),
    ...(notes.length ? { notes } : {}),
    ...(variants.ok && 'note' in variants && variants.note ? { variantNotes: variants.note } : {}),
  }
}
