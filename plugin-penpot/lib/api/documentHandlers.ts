/**
 * 文档 / 选区 handler
 */
import type { HandlerContext } from './index'
import type { HostNode } from '../host/types'

function summarize(node: HostNode, context: HandlerContext): Record<string, unknown> {
  try {
    return context.host.readProperties(node, ['id', 'type', 'name', 'x', 'y', 'width', 'height'])
  } catch {
    return { id: node.id, type: node.type, name: node.name }
  }
}

export function handleDocumentGetInfo(_params: Record<string, unknown>, context: HandlerContext): unknown {
  const selection = context.host.getSelection()
  return {
    ...context.host.getDocumentInfo(),
    selection: selection.map((node) => summarize(node, context)),
    selectionCount: selection.length,
    pages: context.host.listPages(),
  }
}

export function handleSelectionGet(_params: Record<string, unknown>, context: HandlerContext): unknown {
  const selection = context.host.getSelection()
  return {
    count: selection.length,
    nodes: selection.map((node) => summarize(node, context)),
  }
}

export async function handleSelectionSet(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const ids = Array.isArray(params.nodeIds) ? (params.nodeIds as string[]) : []

  if (ids.length === 0) {
    await context.host.setSelection([])
    return { count: 0 }
  }

  const nodes = ids
    .map((id) => context.host.getNodeById(String(id)))
    .filter((node): node is HostNode => Boolean(node))

  await context.host.setSelection(nodes)

  // 回读校验：与 MasterGo 侧 `selection_set` 同一口径 —— 宿主可能静默丢弃不属于当前页的节点
  const applied = context.host.getSelection()
  const missing = ids.filter((id) => !applied.some((n) => n.id === id))

  return {
    count: applied.length,
    requested: ids.length,
    missing,
    applied: missing.length === 0,
  }
}
