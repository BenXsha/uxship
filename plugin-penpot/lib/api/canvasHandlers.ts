/**
 * 画布视图 handler
 *
 * Penpot 侧只有 `viewport.zoomIntoView(shapes)` / `zoomReset` / `zoomToFitAll`，
 * **没有 MasterGo 的 `zoomToRect` 语义**。`canvas/zoomToRect` 因此需要人工换算：
 * 找出与矩形区域相交的节点集合，再 zoomIntoView —— 语义上是近似，会如实标注。
 */
import type { HandlerContext } from './index'
import type { HostNode } from '../host/types'

export async function handleZoomToNode(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const ids = Array.isArray(params.nodeIds)
    ? (params.nodeIds as string[])
    : params.nodeId
      ? [String(params.nodeId)]
      : []

  if (!ids.length) return { ok: false, reason: 'canvas/zoomToNode 需要 nodeId 或 nodeIds' }

  const nodes = ids
    .map((id) => context.host.getNodeById(String(id)))
    .filter((node): node is HostNode => Boolean(node))

  if (!nodes.length) return { ok: false, reason: '未找到任何目标节点（Penpot 只能查当前页）' }

  await context.host.zoomToNodes(nodes)

  // Penpot 的 zoomIntoView 不改选区，MasterGo 的 canvas_zoom_to_node 会同时选中。
  // 为了两个宿主行为一致（且本项目的画布约定是「聚焦即选中成果」），默认一并设选区；
  // select:false 可关闭。
  if (params.select !== false) {
    await context.host.setSelection(nodes)
  }

  // 回读校验
  const selection = context.host.getSelection()
  return {
    ok: true,
    zoomed: nodes.map((n) => n.id),
    missing: ids.filter((id) => !nodes.some((n) => n.id === id)),
    selected: selection.map((n) => n.id),
  }
}

export async function handleZoomToRect(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const rect = params.rect as { x?: number; y?: number; width?: number; height?: number } | undefined
  if (!rect || typeof rect !== 'object') {
    return { ok: false, reason: 'canvas/zoomToRect 需要 rect {x,y,width,height}' }
  }

  const x = Number(rect.x ?? 0)
  const y = Number(rect.y ?? 0)
  const width = Number(rect.width ?? 0)
  const height = Number(rect.height ?? 0)
  if (width <= 0 || height <= 0) return { ok: false, reason: 'rect 的 width/height 必须为正数' }

  // Penpot 无 zoomToRect：改为命中测试 —— 选出与目标矩形相交的顶层节点再聚焦
  const candidates = context.host.getPageRootNodes()
  const hits = candidates.filter((node) => {
    const props = context.host.readProperties(node, ['x', 'y', 'width', 'height'])
    const nx = Number(props.x ?? 0)
    const ny = Number(props.y ?? 0)
    const nw = Number(props.width ?? 0)
    const nh = Number(props.height ?? 0)
    return nx < x + width && nx + nw > x && ny < y + height && ny + nh > y
  })

  if (!hits.length) {
    return { ok: false, reason: '矩形区域内没有节点（Penpot 无 zoomToRect，走的是命中测试近似）' }
  }

  await context.host.zoomToNodes(hits)

  return {
    ok: true,
    approximated: true,
    note: 'Penpot 无 zoomToRect，已用「矩形命中测试 + zoomIntoView」近似',
    zoomed: hits.map((n) => n.id),
  }
}

