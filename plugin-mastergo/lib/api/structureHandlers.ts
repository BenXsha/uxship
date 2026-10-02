/**
 * 顶层结构查询处理器
 *
 * 对应插件方法 `node/getRoot`、MCP 工具 `node_get_root`。
 *
 * 用途：AI 在大文档里「定位一个图层属于哪个层级 / 哪个页面」——
 * 返回该节点的根节点 id、根父层 id、祖先链（自下而上到 PageNode）、
 * 页面归属，以及可选的子树序列化结果。
 *
 * 环境约定（私有化企业版 MasterGoPrivate 1.10.3 实测）：
 * - ✅ `mg.getRootNodeById(id)`        取节点所属的根节点
 * - ✅ `mg.getRootParentLayerId(id)`   取根节点所在的父层 id
 * - ❌ `mg.getTopContainerInfoListByPageID(pageID)` 该版本不可用，本模块**不实现**它
 *
 * 设计约定：
 * - 处理器返回「裸对象」，由 dispatcher 包成 JSON-RPC result（与其它 handler 一致）
 * - 缺 nodeId / 节点不存在：抛中文 Error（dispatcher 转 JSON-RPC error，与 node/get 同）
 * - 宿主缺少根查询 API：不抛错，返回 `{ success: false, reason: 'unsupported' }`，
 *   便于 AI 读 plugin_capabilities 后自行降级
 * - 子树序列化失败只收进 warnings，不影响主体结果
 */
import type { HandlerFunction } from './index'
import { serializeNode } from './serializer'

/** 子树默认递归层数（0 = 仅查询节点自身） */
export const DEFAULT_SUBTREE_MAX_DEPTH = 3

/** 根节点摘要（拿不到完整节点对象时只给 id） */
export interface RootSummary {
  id: string
  name?: string
  type?: string
  width?: number
  height?: number
  x?: number
  y?: number
  parentId?: string
}

/** 祖先链节点摘要 */
export interface AncestorSummary {
  id: string
  name: string
  type: string
}

/** `node/getRoot` 入参 */
export interface GetRootParams {
  /** 目标节点 ID（必填） */
  nodeId: string
  /** 是否附带子树序列化结果（默认 false） */
  includeSubtree?: boolean
  /** 子树递归层数（0 = 仅查询节点自身；缺省 3） */
  maxDepth?: number
}

/** 宿主是否提供根结构查询 API（两个都要求存在） */
export function hasRootStructureApis(): boolean {
  const api = mg as any
  return (
    typeof api?.getRootNodeById === 'function' &&
    typeof api?.getRootParentLayerId === 'function'
  )
}

/**
 * 沿 `node.parent` 向上收集祖先，直到 PageNode（含）为止。
 * 返回顺序固定为「自下而上」（node.parent → … → page）。
 */
function collectAncestors(node: any): {
  ancestors: AncestorSummary[]
  pageId?: string
  pageName?: string
} {
  const ancestors: AncestorSummary[] = []
  const seen = new Set<string>()

  // 查询对象本身就是页面：页面归属即自身，不存在上层图层祖先（Document 不算图层）
  if (node?.type === 'PAGE') {
    return { ancestors, pageId: node.id, pageName: node.name }
  }

  let pageId: string | undefined
  let pageName: string | undefined
  let current: any = node?.parent
  while (current && current.id) {
    if (current.type === 'DOCUMENT') break // Document 不是图层，排除在祖先链之外
    if (seen.has(current.id)) break // 防御异常宿主里的循环引用
    seen.add(current.id)
    ancestors.push({ id: current.id, name: current.name, type: current.type })
    if (current.type === 'PAGE') {
      pageId = current.id
      pageName = current.name
      break
    }
    current = current.parent
  }

  return { ancestors, pageId, pageName }
}

/** 生成根节点摘要；rootNode 为空时只回 id */
function resolveNode(nodeId: string): any {
  // 1) 常规场景节点
  const byId = mg.getNodeById(nodeId)
  if (byId) return byId

  // 2) PAGE / DOCUMENT：getNodeById 不解析这两类，回退到文档树查找
  //    （page_list 拿到的 id 直接丢给本工具是很自然的用法）
  const doc = (mg as any).document
  if (doc?.id === nodeId) return doc
  const pages = Array.isArray(doc?.children) ? doc.children : []
  return pages.find((p: any) => p?.id === nodeId) ?? null
}
function summarizeRoot(rootNode: any, fallbackId: string): RootSummary {
  if (!rootNode) return { id: fallbackId }

  const summary: RootSummary = {
    id: rootNode.id,
    name: rootNode.name,
    type: rootNode.type,
  }
  if (typeof rootNode.width === 'number') summary.width = rootNode.width
  if (typeof rootNode.height === 'number') summary.height = rootNode.height
  if (typeof rootNode.x === 'number') summary.x = rootNode.x
  if (typeof rootNode.y === 'number') summary.y = rootNode.y
  if (rootNode.parent?.id) summary.parentId = rootNode.parent.id
  return summary
}

/**
 * 按 maxDepth 递归序列化子树。
 * maxDepth 表示递归层数：0 = 仅当前节点，1 = 当前节点 + 直接子节点，以此类推。
 * 到了深度上限但仍存在子节点时，打上 `truncated: true` 标记（childIds 仍保留）。
 */
function serializeSubtree(node: any, depth: number, maxDepth: number, warnings: string[]): any {
  const base = serializeNode(node, false)
  if (!base) {
    warnings.push(`子树节点序列化失败：${node?.id ?? '(unknown)'}`)
    return null
  }

  const children: any[] = Array.isArray(node?.children) ? node.children : []
  if (children.length === 0) return base

  if (depth >= maxDepth) {
    ;(base as any).truncated = true
    return base
  }

  const serializedChildren: any[] = []
  for (const child of children) {
    try {
      const childSnapshot = serializeSubtree(child, depth + 1, maxDepth, warnings)
      if (childSnapshot) serializedChildren.push(childSnapshot)
    } catch (err: any) {
      warnings.push(`子树节点序列化失败：${child?.id ?? '(unknown)'} —— ${err?.message || err}`)
    }
  }
  if (serializedChildren.length > 0) {
    ;(base as any).children = serializedChildren
  }
  return base
}

/** 规范化 maxDepth：非负数才生效，否则用默认值 */
function normalizeMaxDepth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : DEFAULT_SUBTREE_MAX_DEPTH
}

/**
 * `node/getRoot`：查询节点的顶层结构信息。
 */
export const handleGetRoot = (params: GetRootParams): any => {
  const nodeId = params?.nodeId
  if (!nodeId) {
    throw new Error('缺少必填参数 nodeId')
  }

  // 节点可能在当前页之外，也可能本身就是 PAGE（mg.getNodeById 不解析 PAGE）
  const node = resolveNode(nodeId)
  if (!node) {
    throw new Error(`未找到节点：${nodeId}（请确认该 id 属于当前文档）`)
  }

  // 宿主缺少根查询 API：不抛错，交由调用方降级
  if (!hasRootStructureApis()) {
    return {
      success: false,
      reason: 'unsupported',
      nodeId,
      message: '当前客户端不支持 getRootNodeById / getRootParentLayerId（可用 plugin_capabilities 复核）',
    }
  }

  const api = mg as any
  const warnings: string[] = []

  let rootNodeId: string | null = null
  try {
    rootNodeId = api.getRootNodeById(nodeId)?.id ?? null
  } catch (err: any) {
    warnings.push(`getRootNodeById 调用失败：${err?.message || err}`)
  }

  let rootParentLayerId: string | null = null
  try {
    rootParentLayerId = api.getRootParentLayerId(nodeId) ?? null
  } catch (err: any) {
    warnings.push(`getRootParentLayerId 调用失败：${err?.message || err}`)
  }

  // 根节点对象可能取不到（例如宿主返回了失效 id），此时只回 id，不报错
  const rootNode = rootNodeId ? mg.getNodeById(rootNodeId) : null
  const root = summarizeRoot(rootNode, rootNodeId ?? nodeId)

  const { ancestors, pageId, pageName } = collectAncestors(node)

  const result: any = {
    success: true,
    nodeId,
    rootNodeId,
    rootParentLayerId,
    root,
    // 祖先链顺序：自下而上（node.parent → … → PageNode，含页面）
    ancestors,
    ancestorsOrder: 'bottom-up',
  }
  if (pageId) result.pageId = pageId
  if (pageName) result.pageName = pageName

  if (params.includeSubtree === true) {
    const maxDepth = normalizeMaxDepth(params.maxDepth)
    result.maxDepth = maxDepth // 回显实际生效的深度，便于 AI 判断是否被截断
    try {
      result.subtree = serializeSubtree(node, 0, maxDepth, warnings)
    } catch (err: any) {
      warnings.push(`子树序列化失败：${err?.message || err}`)
      result.subtree = null
    }
  }

  if (warnings.length > 0) result.warnings = warnings
  return result
}

/**
 * 本模块负责的插件方法注册表。
 * 由 `lib/api/index.ts` 统一接线（合并进 handlers 映射）。
 */
export const structureHandlers: Record<string, HandlerFunction> = {
  'node/getRoot': handleGetRoot,
}
