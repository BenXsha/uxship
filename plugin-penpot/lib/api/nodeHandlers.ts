/**
 * 节点 handler
 *
 * ⚠️ 与 MasterGo 侧的**契约必须一致**（否则服务端的功能会静默失效）：
 *
 * 1. **`node/get` 返回扁平节点对象**，不是 `{ ok, node: {...} }`。
 *    服务端的 `fields` 白名单**只过滤顶层键**（`response-fields.ts`）——
 *    包一层就会变成 `{_fields:{kept:[],missing:["name","fills"]}}`，AI 什么都拿不到。
 * 2. **失败要抛错**，不要返回 `{ok:false}`。抛错会变成 JSON-RPC error，消息完整保留；
 *    返回 `{ok:false}` 时 `reason` 会被 `fields` 过滤或预算截断吃掉。
 * 3. **`node/create` 不重复实现元素创建**，而复用 `renderDsl`
 *    （MasterGo 侧 `dsl-renderer` 与 `nodeHandlers` 各维护一套映射，是已知重复源）。
 */
import type { HandlerContext } from './index'
import type { DSLElement } from '../dsl/types'
import type { HostNode, NodeProperties } from '../host/types'
import { mergeRenderReports, renderDsl } from '../dsl/renderer'
import type { RenderReport } from '../dsl/renderer'

function asElement(value: unknown): DSLElement | null {
  if (!value || typeof value !== 'object') return null
  const element = value as DSLElement
  return typeof element.type === 'string' ? element : null
}

function requireNode(params: Record<string, unknown>, context: HandlerContext): HostNode {
  const nodeId = String(params.nodeId ?? '')
  if (!nodeId) throw new Error('缺少参数: nodeId')
  const node = context.host.getNodeById(nodeId)
  // 抛错而不是 ok:false：见文件头第 2 条
  if (!node) throw new Error(`节点不存在: ${nodeId}（Penpot 只能查当前页）`)
  return node
}

function requireParent(context: HandlerContext, parentId: string): HostNode {
  const parent = context.host.getNodeById(parentId)
  if (!parent) throw new Error(`父节点不存在: ${parentId}（Penpot 只能查当前页）`)
  return parent
}

function resolveParent(params: Record<string, unknown>, context: HandlerContext): HostNode | null {
  const parentId = typeof params.parentId === 'string' ? params.parentId : undefined
  return parentId ? requireParent(context, parentId) : null
}

/**
 * 读元素上的 `parentId`（`node_create` 工具契约的 `nodes[].parentId`）。
 *
 * 为什么需要探测而不是直接 `element.parentId`：DSL 文档本身**没有“父层”概念**（父层是
 * `node/create` 的参数），所以 `DSLElement` 不声明这个字段 —— 但工具契约向调用方承诺了它。
 */
function elementParentId(element: DSLElement): string | undefined {
  // SAFETY: `parentId` 属于 node/create 的工具契约（`nodes[].parentId`）而非 DSL 规范；
  // 只做可缺失探测，不修改 element。
  const raw = (element as unknown as { parentId?: unknown }).parentId
  return typeof raw === 'string' && raw ? raw : undefined
}

/** 摘掉 `parentId`：它不是 DSL 字段，留着会被报成“未知字段（拼写错误？）” */
function detachParentId(element: DSLElement): DSLElement {
  if (elementParentId(element) === undefined) return element
  // SAFETY: 已确认 `parentId` 存在且为字符串，这里只做一次浅拷贝去掉该键；
  // 其余字段原样保留（仍是 DSLElement 的子集）。
  const { parentId: _parentId, ...rest } = element as unknown as DSLElement & { parentId?: string }
  return rest
}

/**
 * `node/create`
 *
 * 两条路径（与服务端的数组形式选路对齐）：
 *   - `element` → 单个 DSL 元素
 *   - `nodes[]` → **`node/batchCreate`** 的入参（服务端按实参形状选路到批量方法）
 */
export async function handleNodeCreate(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const single = asElement(params.element)
  const many = Array.isArray(params.nodes)
    ? (params.nodes as unknown[]).map(asElement).filter((e): e is DSLElement => Boolean(e))
    : []
  const elements: DSLElement[] = single ? [single] : many

  if (!elements.length) {
    throw new Error('node/create 需要 element（单个 DSL 元素）或 nodes（DSL 元素数组）')
  }

  const defaultParent = resolveParent(params, context)
  const renderOptions = {
    zoom: params.focus !== false && params.zoom !== false,
    select: params.select !== false,
  }

  /**
   * 按父层分组渲染：`nodes[].parentId` 是工具契约的一部分（每个节点可以落在不同父层），
   * 而 `renderDsl` 一次只接一个父层。
   *
   * 真机踩到：旧实现把整批元素塞进一次 `renderDsl`（只认 `params.parentId`），于是元素上的
   * `parentId` 被当成「未知字段（拼写错误？）」报出来，节点全落到了页面根。
   *
   * 为什么是“分组”而不是“逐个”：`renderDsl` 每次调用包一个撤销块 —— 逐个渲染会让
   * 「一次批量 = 一次撤销」失效。同一父层的元素仍然共享一个撤销块。
   */
  const groups: Array<{ parent: HostNode | null; elements: DSLElement[] }> = []
  const groupIndexByParent = new Map<string, number>()
  for (const element of elements) {
    const explicit = elementParentId(element)
    const parent = explicit ? requireParent(context, explicit) : defaultParent
    const key = parent?.id ?? ''
    const at = groupIndexByParent.get(key)
    const detached = detachParentId(element)
    if (at === undefined) {
      groupIndexByParent.set(key, groups.length)
      groups.push({ parent, elements: [detached] })
    } else {
      groups[at].elements.push(detached)
    }
  }

  const reports: RenderReport[] = []
  for (const group of groups) {
    reports.push(
      await renderDsl(context.host, { elements: group.elements }, { ...renderOptions, parent: group.parent }),
    )
  }
  return mergeRenderReports(reports)
}

/** `node/batchCreate`：与 node/create 的数组形式同义（服务端按实参形状选路到这里） */
export async function handleNodeBatchCreate(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const nodes = Array.isArray(params.nodes) ? params.nodes : []
  if (!nodes.length) throw new Error('node/batchCreate 需要 nodes 数组')
  return handleNodeCreate({ ...params, nodes }, context)
}

/**
 * `node/get` —— **返回扁平节点对象**（见文件头第 1 条）。
 * 不传 `fields` 时给一套常用字段。
 */
export function handleNodeGet(params: Record<string, unknown>, context: HandlerContext): Record<string, unknown> {
  const node = requireNode(params, context)

  const requested = Array.isArray(params.fields) && params.fields.length
    ? (params.fields as string[])
    : DEFAULT_NODE_FIELDS

  // 扁平返回：{...字段}，不再包 {ok, node}
  return context.host.readProperties(node, requested)
}

const DEFAULT_NODE_FIELDS = [
  'id',
  'type',
  'name',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'visible',
  'fills',
  'strokes',
  'shadows',
  'layoutMode',
  'characters',
] as const

export async function handleNodeUpdate(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  // 合并工具的双形态：服务端按实参形状选路到 node/batchUpdate，
  // 但直接在插件协议上调用时也应成立 —— 少一层“必须知道服务端怎么选路”的隐式契约。
  if (Array.isArray(params.updates) && params.updates.length) {
    return handleNodeBatchUpdate(params, context)
  }

  const node = requireNode(params, context)
  const properties = (params.properties ?? params.props) as NodeProperties | undefined
  if (!properties || typeof properties !== 'object') {
    throw new Error('node/update 需要 properties 对象')
  }

  const result = await context.host.applyProperties(node, properties)

  // 回读校验：几何类修改在 Auto Layout 下可能被引擎覆盖（不假成功）
  const verifyFields = Object.keys(properties).filter((key) =>
    ['width', 'height', 'x', 'y', 'opacity'].includes(key),
  )
  const verify = verifyFields.length ? context.host.readProperties(node, verifyFields) : undefined

  return { ok: result.skipped.length === 0, applied: result.applied, skipped: result.skipped, verify }
}

/**
 * `node/batchUpdate`：`updates: [{ nodeId, properties }]`。
 * 逐项回报 —— 一项失败不应让整批结果变成“都失败了”。
 */
export async function handleNodeBatchUpdate(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const updates = Array.isArray(params.updates) ? (params.updates as Record<string, unknown>[]) : []
  if (!updates.length) throw new Error('node/batchUpdate 需要 updates 数组')

  const results: unknown[] = []
  const failed: { index: number; nodeId?: string; error: string }[] = []

  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index] ?? {}
    try {
      results.push(await handleNodeUpdate({ ...update, ...(update.nodeId ? {} : {}) }, context))
    } catch (error) {
      failed.push({ index, nodeId: update.nodeId as string | undefined, error: (error as Error).message })
    }
  }

  return { success: failed.length === 0, updated: results.length, failed, results }
}

export async function handleNodeDelete(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  // 双形态：nodeIds 数组即批量（与服务端 node/batchDelete 选路等价）
  if (Array.isArray(params.nodeIds) && params.nodeIds.length) {
    return handleNodeBatchDelete(params, context)
  }

  const node = requireNode(params, context)
  const removed = node.id
  await context.host.removeNode(node)
  return { ok: true, removed }
}

/** `node/batchDelete`：`nodeIds: string[]`，逐个回报失败原因 */
export async function handleNodeBatchDelete(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const ids = Array.isArray(params.nodeIds) ? (params.nodeIds as string[]) : []
  if (!ids.length) throw new Error('node/batchDelete 需要 nodeIds 数组')

  const removed: string[] = []
  const failed: { nodeId: string; error: string }[] = []

  for (const nodeId of ids) {
    try {
      const node = context.host.getNodeById(String(nodeId))
      if (!node) throw new Error(`节点不存在: ${nodeId}（Penpot 只能查当前页）`)
      await context.host.removeNode(node)
      removed.push(String(nodeId))
    } catch (error) {
      failed.push({ nodeId: String(nodeId), error: (error as Error).message })
    }
  }

  return { success: failed.length === 0, removed, failed }
}

/** `node/getRoot`：从给定节点往上找根节点（Penpot 的根是当前页 root 的顶层子节点） */
export function handleNodeGetRoot(params: Record<string, unknown>, context: HandlerContext): Record<string, unknown> {
  const node = requireNode(params, context)
  const includeSubtree = params.includeSubtree === true
  const maxDepth = typeof params.maxDepth === 'number' ? params.maxDepth : 4

  // 往上走：parent 为空即到页面层
  let current: HostNode = node
  for (let guard = 0; guard < 64; guard += 1) {
    const parentId = context.host.readProperties(current, ['parentId']).parentId as string | null
    if (!parentId) break
    const parent = context.host.getNodeById(parentId)
    if (!parent) break
    current = parent
  }

  const base = context.host.readProperties(current, ['id', 'type', 'name', 'width', 'height'])
  if (!includeSubtree) return base

  const walk = (target: HostNode, depth: number): Record<string, unknown> => {
    const props = context.host.readProperties(target, ['id', 'type', 'name', 'width', 'height', 'children'])
    const entry: Record<string, unknown> = { ...props }
    const childIds = Array.isArray(props.children) ? (props.children as string[]) : []
    delete entry.children
    if (depth < maxDepth && childIds.length) {
      entry.children = childIds
        .map((id) => context.host.getNodeById(id))
        .filter((n): n is HostNode => Boolean(n))
        .map((child) => walk(child, depth + 1))
    } else if (childIds.length) {
      entry.childCount = childIds.length
    }
    return entry
  }

  return { ...base, ...walk(current, 0) }
}

export async function handleNodeClone(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const source = requireNode(params, context)
  const clone = await context.host.cloneNode(source)

  const overrides: NodeProperties = {}
  if (typeof params.name === 'string') overrides.name = params.name
  if (typeof params.x === 'number') overrides.x = params.x
  if (typeof params.y === 'number') overrides.y = params.y
  if (Object.keys(overrides).length) await context.host.applyProperties(clone, overrides)

  const parent = resolveParent(params, context)
  if (parent) await context.host.appendChild(parent, clone)

  return {
    ok: true,
    nodeId: clone.id,
    source: source.id,
    ...context.host.readProperties(clone, ['name', 'x', 'y', 'width', 'height']),
  }
}

/** `node/move`：改父层与/或同级顺序 */
export async function handleNodeMove(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const node = requireNode(params, context)
  const parent = resolveParent(params, context)
  const index = typeof params.index === 'number' ? params.index : undefined

  const before = context.host.readProperties(node, ['parentId']).parentId as string | null

  if (parent) {
    await context.host.appendChild(parent, node, index)
  } else if (index !== undefined) {
    // 只调同级顺序
    if (!before) throw new Error('node/move: 该节点没有父层，无法调整同级顺序')
    const parentNode = context.host.getNodeById(before)
    if (!parentNode) throw new Error(`父节点不存在: ${before}`)
    await context.host.appendChild(parentNode, node, index)
  } else {
    throw new Error('node/move 需要 parentId 或 index（至少一个）')
  }

  const after = context.host.readProperties(node, ['parentId', 'x', 'y'])
  return { ok: true, nodeId: node.id, movedFrom: before, movedTo: after.parentId, verify: after }
}

export async function handleNodeGroup(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const ids = Array.isArray(params.nodeIds) ? (params.nodeIds as string[]) : []
  if (!ids.length) throw new Error('node/group 需要 nodeIds')

  const nodes = ids.map((id) => {
    const node = context.host.getNodeById(String(id))
    if (!node) throw new Error(`节点不存在: ${id}（Penpot 只能查当前页）`)
    return node
  })

  const group = await context.host.group(nodes)
  if (typeof params.name === 'string') {
    await context.host.applyProperties(group, { name: params.name })
  }
  return { ok: true, nodeId: group.id }
}

/** `text/create`：建文本并应用属性（复用 applyProperties 的文本阶段与顺序约束） */
export async function handleTextCreate(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const content = typeof params.content === 'string' ? params.content : ''
  const node = await context.host.createNode(
    {
      kind: 'text',
      name: typeof params.name === 'string' ? params.name : 'Text',
      characters: content,
      x: typeof params.x === 'number' ? params.x : undefined,
      y: typeof params.y === 'number' ? params.y : undefined,
    },
    resolveParent(params, context),
  )

  const properties: NodeProperties = {}
  for (const key of ['fontSize', 'fontWeight', 'fontName', 'lineHeight', 'letterSpacing', 'textAlignHorizontal', 'textAlignVertical', 'textAutoResize'] as const) {
    if (params[key] !== undefined) (properties as Record<string, unknown>)[key] = params[key]
  }
  if (Array.isArray(params.fills)) (properties as Record<string, unknown>).fills = params.fills

  const result = Object.keys(properties).length
    ? await context.host.applyProperties(node, properties)
    : { applied: [], skipped: [] }

  return {
    ok: result.skipped.length === 0,
    nodeId: node.id,
    applied: result.applied,
    skipped: result.skipped,
  }
}

/**
 * `search/find`：按名字/类型/文本在**当前页**内查找。
 * Penpot 没有服务端检索 API，所以这里遍历页树（`getPageRootNodes` 起）。
 */
export function handleSearchFind(params: Record<string, unknown>, context: HandlerContext): Record<string, unknown> {
  const query = typeof params.query === 'string' ? params.query.toLowerCase() : ''
  const type = typeof params.type === 'string' ? params.type.toLowerCase() : ''
  const limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : 50

  const matches: Record<string, unknown>[] = []
  const stack: HostNode[] = [...context.host.getPageRootNodes()]
  let scanned = 0

  while (stack.length && matches.length < limit) {
    const node = stack.shift() as HostNode
    scanned += 1
    const props = context.host.readProperties(node, ['id', 'type', 'name', 'children', 'characters'])
    const name = String(props.name ?? '')
    const kind = String(props.type ?? '')

    const hitName = !query || name.toLowerCase().includes(query)
    const hitType = !type || kind.toLowerCase().includes(type)
    if (hitName && hitType) {
      matches.push({ id: props.id, type: props.type, name: props.name, characters: props.characters })
    }

    const childIds = Array.isArray(props.children) ? (props.children as string[]) : []
    for (const id of childIds) {
      const child = context.host.getNodeById(String(id))
      if (child) stack.push(child)
    }
  }

  return { count: matches.length, scanned, limited: matches.length >= limit, nodes: matches }
}

/** `node/tree`：导出当前页（或指定节点之下）的结构树 —— 渲染后自查结构用 */
export function handleNodeTree(params: Record<string, unknown>, context: HandlerContext): Record<string, unknown> {
  const rootId = typeof params.nodeId === 'string' ? params.nodeId : undefined
  const maxDepth = typeof params.maxDepth === 'number' ? params.maxDepth : 6

  const root = rootId ? context.host.getNodeById(rootId) : null
  if (rootId && !root) throw new Error(`节点不存在: ${rootId}（Penpot 只能查当前页）`)

  const roots: HostNode[] = root ? [root] : [...context.host.getPageRootNodes()]

  const walk = (node: HostNode, depth: number): Record<string, unknown> => {
    const props = context.host.readProperties(node, ['id', 'type', 'name', 'width', 'height', 'children'])
    const entry: Record<string, unknown> = {
      id: props.id,
      type: props.type,
      name: props.name,
      width: props.width,
      height: props.height,
    }
    const childIds = Array.isArray(props.children) ? (props.children as string[]) : []
    if (depth < maxDepth && childIds.length) {
      entry.children = childIds
        .map((id) => context.host.getNodeById(id))
        .filter((n): n is HostNode => Boolean(n))
        .map((child) => walk(child, depth + 1))
    } else if (childIds.length) {
      entry.childCount = childIds.length
      entry.truncated = true
    }
    return entry
  }

  return { ok: true, roots: roots.map((node) => walk(node, 0)), rootCount: roots.length }
}

