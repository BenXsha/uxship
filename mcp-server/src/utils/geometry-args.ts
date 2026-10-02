/**
 * 几何参数归一化（服务端做一次，两个宿主都受益）
 *
 * ## 为什么需要它
 *
 * 工具面的口径与宿主端口的口径**不一致**，而且**两个宿主都一样错**：
 *
 * | 位置 | 期望的形状 |
 * |------|-----------|
 * | `node_create` 的**文档说明** | 单体：`type` + `properties`；批量：`nodes[]` |
 * | `node_create` 的**插件实现** | 只有 `element`（单个 DSL 元素）或 `nodes`（DSL 元素数组）—— MasterGo `nodeHandlers.ts` 与 Penpot 同 |
 * | DSL 元素 | 嵌套几何：`position:{x,y}` / `size:{width,height}` |
 * | 宿主端口（`applyProperties`） | **扁平** `x` / `y` / `width` / `height` |
 *
 * 后果（真机踩过两次，2026-09-30）：
 *   - 按说明传 `type`+`properties` → 插件报 `node/create 需要 element …`，**单体创建必失败**；
 *   - 批量里带 `properties` → 被当作「DSL 元素的不认识字段」**静默丢弃**，于是节点只有默认样式；
 *   - `node_update` 传 DSL 风格的 `position`/`size` → 宿主回 `尚未映射该属性`（宿主只认扁平键）。
 *
 * 修在**服务端**而不是各宿主：一处改动同时修两边，而且纯函数可离线单测
 * （宿主的实现只有真机才跑得到，这正是上面几个坑能潜伏下来的原因）。
 *
 * ## 规则
 *
 * - **显式优先**：已经给了目标形状（`element` / `nodes` / 扁平键 / `position` / `size`）的一律不覆盖。
 * - **不丢信息**：折叠成嵌套形状后删掉被折叠的扁平键，避免同一语义出现两份；
 *   `node_update` 折叠后同样删掉 `position`/`size`，否则宿主会回一堆「尚未映射」的噪声。
 */
/** 工具参数（服务端不做完整 schema 校验，只做归一化） */
type MCPToolArgs = Record<string, unknown>

type Dict = Record<string, unknown>

const isDict = (value: unknown): value is Dict =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 扁平几何 → DSL 嵌套几何（`position` / `size` 已存在时不动它） */
function foldGeometry(input: Dict): Dict {
  const out: Dict = { ...input }
  const x = out.x
  const y = out.y
  if ((x !== undefined || y !== undefined) && out.position === undefined) {
    const position: Dict = {}
    if (x !== undefined) position.x = x
    if (y !== undefined) position.y = y
    out.position = position
  }
  const width = out.width
  const height = out.height
  if ((width !== undefined || height !== undefined) && out.size === undefined) {
    const size: Dict = {}
    if (width !== undefined) size.width = width
    if (height !== undefined) size.height = height
    out.size = size
  }
  delete out.x
  delete out.y
  delete out.width
  delete out.height
  return out
}

/** DSL 嵌套几何 → 宿主端口的扁平几何（扁平键已存在时不覆盖） */
function expandGeometry(input: Dict): Dict {
  const out: Dict = { ...input }
  const position = out.position
  if (isDict(position)) {
    if (out.x === undefined && position.x !== undefined) out.x = position.x
    if (out.y === undefined && position.y !== undefined) out.y = position.y
  }
  const size = out.size
  if (isDict(size)) {
    if (out.width === undefined && size.width !== undefined) out.width = size.width
    if (out.height === undefined && size.height !== undefined) out.height = size.height
  }
  delete out.position
  delete out.size
  return out
}

/**
 * `node_create`：把「`type` + `properties`」或「`nodes[]` 里带 `properties`」的写法
 * 归一成插件真正接受的 **DSL 元素**形状。
 *
 * 已经传了 `element` / 已是 DSL 元素的 `nodes[]` 时**原样返回**（幂等）。
 */
export function normalizeCreateArgs(args: MCPToolArgs): MCPToolArgs {
  const out: MCPToolArgs = { ...args }

  if (!out.element && typeof out.type === 'string') {
    const { type, properties, ...rest } = out as Dict & { type: string; properties?: unknown }
    const props = isDict(properties) ? properties : {}
    out.element = foldGeometry({ ...props, ...rest, type })
    delete out.type
    delete out.properties
  }

  if (Array.isArray(out.nodes)) {
    out.nodes = out.nodes.map((node) => {
      if (!isDict(node)) return node
      const hasProperties = isDict(node.properties)
      const hasFlatGeometry = node.x !== undefined || node.y !== undefined || node.width !== undefined || node.height !== undefined
      if (!hasProperties && !hasFlatGeometry) return node
      const { properties, ...rest } = node
      const props = isDict(properties) ? properties : {}
      return foldGeometry({ ...props, ...rest })
    })
  }

  return out
}

/**
 * `node_update`：把 DSL 风格的 `position` / `size` 展开成宿主端口的扁平键。
 *
 * 覆盖单体（`properties`）与批量（`updates[].properties`）两种形态。
 */
export function normalizeUpdateArgs(args: MCPToolArgs): MCPToolArgs {
  const out: MCPToolArgs = { ...args }

  if (isDict(out.properties)) {
    out.properties = expandGeometry(out.properties)
  }

  if (Array.isArray(out.updates)) {
    out.updates = out.updates.map((entry) => {
      if (!isDict(entry) || !isDict(entry.properties)) return entry
      return { ...entry, properties: expandGeometry(entry.properties as Dict) }
    })
  }

  return out
}

/** 按工具名分派（供 `routeToolCall` 在转发前调用） */
export function normalizeGeometryArgs(toolName: string, args: MCPToolArgs): MCPToolArgs {
  if (toolName === 'node_create') return normalizeCreateArgs(args)
  if (toolName === 'node_update') return normalizeUpdateArgs(args)
  return args
}
