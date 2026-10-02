/**
 * `node/align` —— **对象之间**的对齐与等距分布
 *
 * ⚠️ 先说清楚它**不是**什么：这不是"容器内对齐"。
 *   - 容器内对齐 = flex 的 `primaryAxisAlignItems` / `counterAxisAlignItems`（改容器属性，
 *     让子元素在容器里怎么排）—— 本插件早就支持，服务端的指令引擎也有中文关键词
 *     （`居中对齐` / `左对齐` / `两端对齐` / `垂直居中` …）。
 *   - **本方法** = 把若干个**被选中的对象**互相摆齐（改每个对象的 x/y）。
 *     Penpot 原语：`alignHorizontal/Vertical`、`distributeHorizontal/Vertical`。
 *     这一层此前两边都没有 —— 所以 AI 说"把这三个对象左对齐"时只能落到容器语义（错的）。
 *
 * 两条实现路径：
 *   1. **宿主原生**（Penpot 有那四个方法）：与该宿主 UI 的行为一致（设计师看到的就是这个）；
 *   2. **几何兜底**（`lib/align.ts`）：宿主没有时用本项目的口径算 —— 对齐到**选区包围盒**、
 *      分布按**相邻间隙相等**（两端固定）。
 *
 * ⚠️ 两条路径的"对齐参考系"可能不同：Penpot 文档只写 *"relative to one of them"*，
 * 没写是哪一个；本文件的口径是选区包围盒。所以返回值里带 `path: 'native' | 'geometry'`，
 * 调用方与测试都能看出走的哪条；真机核对项见返回的 `notes`。
 */
import type { HandlerContext } from './index'
import type { HostNode } from '../host/types'
import {
  MIN_ALIGN_NODES,
  MIN_DISTRIBUTE_NODES,
  computeAlignment,
  computeDistribution,
  type AlignAxis,
  type AlignBox,
  type AlignDirection,
} from '../align'

interface AlignParams {
  nodeIds?: string[]
  useSelection?: boolean
  mode?: 'align' | 'distribute'
  axis?: AlignAxis
  direction?: AlignDirection
}

interface AlignResult {
  ok: boolean
  mode: 'align' | 'distribute'
  axis: AlignAxis
  direction?: AlignDirection
  /** 走的哪条路：宿主原生 or 本项目的几何兜底 */
  path: 'native' | 'geometry'
  total: number
  /** 实际发生位移的对象数（用前后坐标量出来的，不是"调过 API 就算动了"） */
  moved: number
  nodes: { nodeId: string; name: string; dx: number; dy: number; skipped?: 'flex-parent' }[]
  notes?: string[]
  reason?: string
}

const AXES: AlignAxis[] = ['HORIZONTAL', 'VERTICAL']
const DIRECTIONS: AlignDirection[] = ['MIN', 'CENTER', 'MAX']

function resolveNodes(context: HandlerContext, params: AlignParams): HostNode[] {
  const ids = Array.isArray(params.nodeIds) ? params.nodeIds.filter((id) => typeof id === 'string') : []
  if (ids.length) {
    return ids.map((id) => {
      const node = context.host.getNodeById(id)
      if (!node) throw new Error(`节点不存在: ${id}（Penpot 只能查当前页）`)
      return node
    })
  }

  if (params.useSelection === false) return []
  return [...context.host.getSelection()]
}

function boxesOf(context: HandlerContext, nodes: readonly HostNode[]): AlignBox[] {
  return nodes.map((node) => {
    const props = context.host.readProperties(node, ['x', 'y', 'width', 'height'])
    return {
      x: Number(props.x ?? 0),
      y: Number(props.y ?? 0),
      width: Number(props.width ?? 0),
      height: Number(props.height ?? 0),
    }
  })
}

/** 父层是 flex 时位置由布局决定，写 x/y 不会生效 —— 这种对象要单独说明 */
function flexParentIds(context: HandlerContext, nodes: readonly HostNode[]): Set<string> {
  const flex = new Set<string>()
  for (const node of nodes) {
    const parentId = context.host.readProperties(node, ['parentId']).parentId as string | undefined
    if (!parentId) continue
    const parent = context.host.getNodeById(parentId)
    if (!parent) continue
    const layoutMode = context.host.readProperties(parent, ['layoutMode']).layoutMode
    if (layoutMode && layoutMode !== 'NONE') flex.add(node.id)
  }
  return flex
}

export async function handleNodeAlign(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<AlignResult> {
  const input = params as AlignParams
  const mode: 'align' | 'distribute' = input.mode === 'distribute' ? 'distribute' : 'align'
  const axis: AlignAxis = AXES.includes(input.axis as AlignAxis) ? (input.axis as AlignAxis) : 'HORIZONTAL'
  const direction: AlignDirection = DIRECTIONS.includes(input.direction as AlignDirection)
    ? (input.direction as AlignDirection)
    : 'MIN'

  const nodes = resolveNodes(context, input)
  const need = mode === 'distribute' ? MIN_DISTRIBUTE_NODES : MIN_ALIGN_NODES

  if (nodes.length < need) {
    return {
      ok: false,
      mode,
      axis,
      ...(mode === 'align' ? { direction } : {}),
      path: 'geometry',
      total: nodes.length,
      moved: 0,
      nodes: [],
      reason:
        mode === 'distribute'
          ? `等距分布至少需要 ${MIN_DISTRIBUTE_NODES} 个对象（当前 ${nodes.length} 个）—— 两个对象之间没有"中间项"可分布`
          : `对齐至少需要 ${MIN_ALIGN_NODES} 个对象（当前 ${nodes.length} 个）—— 一个对象对齐到自己没有意义`,
    }
  }

  const before = boxesOf(context, nodes)
  const notes: string[] = []

  // 路径 1：宿主原生（与该宿主 UI 行为一致）
  const capabilities = context.host.getCapabilities()
  const canNative = capabilities.ops.alignNodes &&
    (mode === 'align'
      ? typeof context.host.alignNodes === 'function'
      : typeof context.host.distributeNodes === 'function')

  let path: 'native' | 'geometry' = 'geometry'
  if (canNative) {
    try {
      if (mode === 'align') {
        await context.host.alignNodes!(nodes, { axis, direction })
      } else {
        await context.host.distributeNodes!(nodes, { axis })
      }
      path = 'native'
      notes.push(
        '走宿主原生对齐/分布 —— 参考系由宿主决定（Penpot 文档只写 "relative to one of them"，' +
        '未说明是哪一个；若与预期不符，可用 node_update 手动修，或告知我们改用几何口径）',
      )
    } catch (error) {
      notes.push(`宿主原生对齐失败：${(error as Error).message} → 回退到几何兜底`)
    }
  } else {
    notes.push(
      capabilities.ops.alignNodes
        ? '宿主能力位允许但方法缺失 → 用几何兜底'
        : '宿主未提供对齐能力 → 用几何兜底（对齐到选区包围盒、分布按相邻间隙相等）',
    )
  }

  // flex 父层的对象：位置由布局决定，写 x/y 不生效 —— **无论本次有没有位移都要报**
  // （否则"请求对齐 flex 子元素"会看起来成功、其实什么都没做 = 静默失败）
  const flexNodes = flexParentIds(context, nodes)

  // 路径 2：几何兜底
  if (path === 'geometry') {
    const deltas = mode === 'align'
      ? computeAlignment(before, axis, direction)
      : computeDistribution(before, axis)

    const blocked: string[] = []
    for (let i = 0; i < nodes.length; i += 1) {
      const { dx, dy } = deltas[i]
      if (!dx && !dy) continue
      if (flexNodes.has(nodes[i].id)) {
        blocked.push(String(context.host.readProperties(nodes[i], ['name']).name ?? nodes[i].id))
        continue
      }
      await context.host.applyProperties(nodes[i], { x: before[i].x + dx, y: before[i].y + dy } as never)
    }
    void blocked
  }

  /**
   * flex 父层的对象**无论有没有发生位移都要说明**。
   *
   * 早先只在"算出了位移但被挡住"时才提示，于是"请求对齐一组本来就已左对齐的 flex 子元素"
   * 会得到「ok:true、没有任何说明」—— 看起来成功、其实什么都没做（静默失败）。
   * 这类对象的 x/y 由布局决定，用户需要知道"该改的是父层的对齐属性"。
   */
  const flexNames = nodes
    .filter((node) => flexNodes.has(node.id))
    .map((node) => String(context.host.readProperties(node, ['name']).name ?? node.id))
  if (flexNames.length) {
    notes.push(
      `${flexNames.join('、')}: 父层是自动布局（flex）→ 位置由布局决定，本次未写入坐标；` +
      '要摆这类对象，请改父层的对齐属性（容器内对齐）或先 detach',
    )
  }

  // 用**前后坐标**量"谁真的动了"，而不是"调过 API 就算动了"
  const after = boxesOf(context, nodes)
  const report = nodes.map((node, index) => ({
    nodeId: node.id,
    name: String(context.host.readProperties(node, ['name']).name ?? ''),
    dx: Number((after[index].x - before[index].x).toFixed(2)),
    dy: Number((after[index].y - before[index].y).toFixed(2)),
    ...(flexNodes.has(node.id) ? { skipped: 'flex-parent' as const } : {}),
  }))

  return {
    ok: true,
    mode,
    axis,
    ...(mode === 'align' ? { direction } : {}),
    path,
    total: nodes.length,
    moved: report.filter((entry) => entry.dx !== 0 || entry.dy !== 0).length,
    nodes: report,
    ...(notes.length ? { notes } : {}),
  }
}
