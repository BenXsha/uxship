/**
 * 画布视图（viewport）与选区处理器
 *
 * 官方插件 API：
 * - `mg.viewport.scrollAndZoomIntoView(nodes)` — 自动调整可视区，使给定节点在屏幕上可见
 * - `mg.viewport.zoom` / `mg.viewport.center` — 读写缩放比例（1 = 100%）与可视区中心
 *   （center 必须整体赋值，`mg.viewport.center.x = 1` 无效）
 * - `mg.document.currentPage.selection` — 数组本身只读，需整体赋值才能改变选中
 *
 * `focusNodes()` 同时被 DSL 渲染链路复用，实现「设计完成后自动聚焦到刚完工的对象」。
 */

export interface ViewportSnapshot {
  zoom: number
  center: { x: number; y: number }
  bound: { x: number; y: number; width: number; height: number }
}

export interface FocusOptions {
  /** 是否同时选中目标节点（默认 true） */
  select?: boolean
  /** 可选：聚焦后强制设置的缩放比例（1 = 100%） */
  zoom?: number
}

/** 当前可视区快照，供调用方验证聚焦结果 */
export function getViewportSnapshot(): ViewportSnapshot {
  const center = mg.viewport.center
  const bound = mg.viewport.bound
  return {
    zoom: mg.viewport.zoom,
    center: { x: center.x, y: center.y },
    bound: { x: bound.x, y: bound.y, width: bound.width, height: bound.height },
  }
}

/**
 * 等可视区属性落定。
 * `mg.viewport.zoom` / `center` 写入后立即读取会拿到新值，但 `mg.viewport.bound`
 * 由原生层惰性重算（会滞后一帧），直接读会拿到旧值，所以快照前先等一拍。
 */
export async function settleViewport(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 32))
}

/** 可视区像素尺寸（CSS px）·用于把画布坐标换算成适配缩放比例 */
function viewportPixelSize(): { width: number; height: number } {
  const dom = (mg.viewport as any).positionOnDom
  if (dom && dom.width > 0 && dom.height > 0) {
    return { width: dom.width, height: dom.height }
  }
  // 回退：bound 是当前缩放下的画布坐标范围，乘回 zoom 得到固定不变的视口像素尺寸
  const zoom = mg.viewport.zoom || 1
  const bound = mg.viewport.bound
  return { width: bound.width * zoom, height: bound.height * zoom }
}

/**
 * 聚焦节点：滚动 + 自动缩放使其完整可见，可选同时选中。
 * 返回真正被聚焦的节点（用于调用方回报结果）。
 */
export function focusNodes(nodes: any[], opts: FocusOptions = {}): any[] {
  const targets = (nodes || []).filter((node) => node && !node.removed)
  if (targets.length === 0) return []

  mg.viewport.scrollAndZoomIntoView(targets as any)

  if (typeof opts.zoom === 'number' && opts.zoom > 0) {
    mg.viewport.zoom = opts.zoom
  }

  if (opts.select !== false) {
    try {
      mg.document.currentPage.selection = targets as any
    } catch (err) {
      console.warn('[Canvas] 设置选区失败:', err)
    }
  }

  return targets
}

/** 按 ID 取节点（忽略不存在的），并给出一致的错误信息 */
export function resolveNodes(params: {
  nodeId?: string
  nodeIds?: string[]
  useSelection?: boolean
}): { nodes: any[]; missing: string[] } {
  const ids: string[] = []
  if (Array.isArray(params.nodeIds)) {
    for (const id of params.nodeIds) {
      if (id) ids.push(String(id))
    }
  }
  if (params.nodeId) ids.push(String(params.nodeId))

  const nodes: any[] = []
  const missing: string[] = []
  const seen = new Set<string>()

  for (const id of ids) {
    const node = mg.getNodeById(id)
    if (!node) {
      missing.push(id)
      continue
    }
    if (seen.has(node.id)) continue
    seen.add(node.id)
    nodes.push(node)
  }

  if (ids.length === 0 && params.useSelection !== false) {
    for (const node of mg.document.currentPage.selection) {
      if (seen.has(node.id)) continue
      seen.add(node.id)
      nodes.push(node)
    }
  }

  return { nodes, missing }
}

/**
 * canvas/zoomToNode — 聚焦指定节点（不传则聚焦当前选区）
 */
export async function handleZoomToNode(params: {
  nodeId?: string
  nodeIds?: string[]
  useSelection?: boolean
  select?: boolean
  zoom?: number
}): Promise<any> {
  const { nodes, missing } = resolveNodes(params)

  if (nodes.length === 0) {
    throw new Error(
      missing.length > 0
        ? `节点不存在: ${missing.join(', ')}`
        : '没有可聚焦的节点：请传 nodeId / nodeIds，或先在画布上选中节点。',
    )
  }

  const focused = focusNodes(nodes, { select: params.select, zoom: params.zoom })
  await settleViewport()

  return {
    success: true,
    focusedNodeIds: focused.map((node) => node.id),
    focusedNodeNames: focused.map((node) => node.name),
    ...(missing.length > 0 ? { missingNodeIds: missing } : {}),
    selected: params.select !== false,
    viewport: getViewportSnapshot(),
  }
}

/**
 * canvas/zoomToRect — 聚焦画布坐标上的矩形区域
 *
 * 注：`mg.viewport.scrollAndZoomIntoView()` 只接受真实节点（传普通矩形对象会被原生层
 * 报 “Cannot pass non-string to std::string”），因此矩形区域改为用官方可写的
 * `mg.viewport.center` + `mg.viewport.zoom` 自行计算适配缩放。
 */
export async function handleZoomToRect(params: {
  x: number
  y: number
  width?: number
  height?: number
  zoom?: number
  padding?: number
}): Promise<any> {
  if (params.x === undefined || params.y === undefined) {
    throw new Error('Missing required parameters: x, y')
  }

  const width = params.width && params.width > 0 ? params.width : 100
  const height = params.height && params.height > 0 ? params.height : 100
  const rect = { x: params.x, y: params.y, width, height }

  const { width: pixelWidth, height: pixelHeight } = viewportPixelSize()
  const padding = typeof params.padding === 'number' && params.padding > 0 ? params.padding : 0.9

  let zoom =
    typeof params.zoom === 'number' && params.zoom > 0
      ? params.zoom
      : Math.min(pixelWidth / width, pixelHeight / height) * padding
  // 缩放范围保护（1 = 100%）
  zoom = Math.max(0.02, Math.min(zoom, 64))

  mg.viewport.zoom = zoom
  mg.viewport.center = { x: rect.x + width / 2, y: rect.y + height / 2 }
  await settleViewport()

  return { success: true, rect, viewport: getViewportSnapshot() }
}

/**
 * 取节点所属页面 id（沿 parent 链向上找 type === 'PAGE'）。
 * 无法判定时返回 null —— 不阻断调用，交由赋值后的回读校验兜底。
 */
export function pageIdOf(node: any): string | null {
  let cur = node?.parent
  let guard = 0
  while (cur && guard++ < 50) {
    if (cur.type === 'PAGE') return cur.id === undefined ? null : String(cur.id)
    cur = cur.parent
  }
  return null
}

/**
 * selection/set — 改变画布选中（nodeIds 传空数组即清空选中）
 */
export function handleSetSelection(params: {
  nodeIds?: string[]
  selectAll?: boolean
  addToSelection?: boolean
}): any {
  const page = mg.document.currentPage

  if (params.selectAll) {
    page.selectAll()
    return {
      success: true,
      mode: 'all',
      selectedNodeIds: page.selection.map((node: any) => node.id),
      selectedCount: page.selection.length,
    }
  }

  const ids = Array.isArray(params.nodeIds) ? params.nodeIds.filter(Boolean).map(String) : []
  const { nodes, missing } = resolveNodes({ nodeIds: ids, useSelection: false })

  if (ids.length > 0 && nodes.length === 0) {
    throw new Error(`节点不存在: ${missing.join(', ')}`)
  }

  const next = params.addToSelection
    ? Array.from(page.selection).concat(nodes as any)
    : (nodes as any)

  // 去重后整体赋值（selection 数组本身只读）
  const seen = new Set<string>()
  const unique = (next as any[]).filter((node: any) => {
    if (!node || seen.has(node.id)) return false
    seen.add(node.id)
    return true
  })

  // 预检：选区是**页面级**的，跨页节点赋值会被 MasterGo 静默忽略（旧实现会返回假成功）
  const offPage = unique.filter((node: any) => {
    const owner = pageIdOf(node)
    return owner !== null && owner !== String(page.id)
  })
  if (offPage.length > 0) {
    throw new Error(
      `以下节点不在当前页面（"${page.name}"），无法选中：${offPage.map((n: any) => `${n.name}(${n.id})`).join(', ')}。` +
        '请先用 page_switch 切到节点所在页面。',
    )
  }

  try {
    page.selection = unique as any
  } catch (err: any) {
    throw new Error(
      `设置选区失败（节点可能不在当前页面 "${page.name}"）：${err?.message || err}`,
    )
  }

  // 回读校验：MasterGo 可能静默过滤掉不可选节点 —— 不能拿请求参数当结果返回
  const actual = Array.from(page.selection) as any[]
  const actualIds = new Set(actual.map((node: any) => node.id))
  const notSelected = unique.filter((node: any) => !actualIds.has(node.id))
  if (notSelected.length > 0) {
    throw new Error(
      `选区未完全生效，未选中的节点：${notSelected.map((n: any) => `${n.name}(${n.id})`).join(', ')}` +
        `（MasterGo 已忽略这些节点，常见原因：不在当前页面 "${page.name}" ）。`,
    )
  }

  return {
    success: true,
    mode: params.addToSelection ? 'add' : 'replace',
    selectedNodeIds: actual.map((node: any) => node.id),
    selectedCount: actual.length,
    ...(missing.length > 0 ? { missingNodeIds: missing } : {}),
  }
}
