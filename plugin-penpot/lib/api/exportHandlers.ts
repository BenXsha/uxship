/**
 * 导出 / 布尔 / 组件 handler
 *
 * 契约要点（都是踩过或核对过服务端代码的）：
 *
 * 1. **`node/exportImage` 的返回形状是服务端约定死的**：`{nodeId, format, mimeType, data}` ——
 *    服务端 `image-export.ts#isImageExportResult` 会据此判断，命中后自己负责写文件
 *    （`saveToPath`）与包装成图片 content block。少一个字段就会被当成普通返回值。
 * 2. **枚举命名两侧不同**：DSL 用 `SUBTRACT`，Penpot 叫 `difference`；工具层格式大写（`PNG`），
 *    Penpot 小写（`png`）。换算集中在 HostAdapter，handler 只做参数校验。
 * 3. **失败抛错**（对齐 MasterGo 契约）：`{ok:false}` 会被服务端的 fields 白名单/预算截断吃掉。
 */
import type { HandlerContext } from './index'
import type { BooleanOperation, ExportFormat, HostComponentInfo, HostNode } from '../host/types'

function requireNodes(
  params: Record<string, unknown>,
  context: HandlerContext,
  label: string,
): HostNode[] {
  // 兼容两种调用形态：服务端多数工具用 nodeIds 数组，但 `node_convert_to_component`
  // 的 schema 是单数 `nodeId`。只认一种就会报「需要 nodeIds」而调用方明明传了 id。
  const ids = Array.isArray(params.nodeIds)
    ? (params.nodeIds as string[])
    : typeof params.nodeId === 'string' && params.nodeId
      ? [params.nodeId]
      : []
  if (!ids.length) throw new Error(`${label} 需要 nodeIds（或单个 nodeId）`)
  return ids.map((id) => {
    const node = context.host.getNodeById(String(id))
    if (!node) throw new Error(`节点不存在: ${id}（Penpot 只能查当前页）`)
    return node
  })
}

const OPERATIONS = new Set<BooleanOperation>(['UNION', 'SUBTRACT', 'INTERSECT', 'EXCLUDE'])

/** `node/boolean`：UNION / SUBTRACT / INTERSECT / EXCLUDE */
export async function handleNodeBoolean(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const nodes = requireNodes(params, context, 'node/boolean')
  if (nodes.length < 2) throw new Error('布尔运算至少需要 2 个节点')

  const raw = String(params.operation ?? 'UNION').toUpperCase() as BooleanOperation
  if (!OPERATIONS.has(raw)) {
    throw new Error(`node/boolean 不支持的操作: ${params.operation}（可用 ${[...OPERATIONS].join(' / ')}）`)
  }

  const result = await context.host.booleanOperation(nodes, raw)
  return {
    ok: true,
    nodeId: result.id,
    operation: raw,
    // 回读校验：布尔结果的图层名/尺寸是宿主给的，如实回报便于确认不是空节点
    ...context.host.readProperties(result, ['id', 'type', 'name', 'width', 'height']),
  }
}

/**
 * 批量建库的**作用域**：两种互斥形态。
 *   - `prefix`：按名前缀（从页面根 BFS + 命中即剪枝 → 只取最外层）；旧式，保留兼容。
 *   - `container`：按容器子树（只取容器的**直接子层**，无名字过滤）—— R6 新契约推荐，
 *     `setId` 由服务端按成员名首段解析。
 */
type BuildScope = { kind: 'prefix'; prefix: string } | { kind: 'container'; containerId: string }

interface MatchedNode {
  node: HostNode
  id: string
  name: string
  type: string
}

/** 按作用域收集「最外层」节点（命中即剪枝，不进入其子层） */
function collectInScope(scope: BuildScope, context: HandlerContext): MatchedNode[] {
  const matched: MatchedNode[] = []
  const push = (node: HostNode) => {
    const props = context.host.readProperties(node, ['id', 'name', 'type'])
    matched.push({
      node,
      id: String(props.id),
      name: typeof props.name === 'string' ? props.name : '',
      type: String(props.type ?? ''),
    })
  }

  if (scope.kind === 'container') {
    const container = context.host.getNodeById(scope.containerId)
    if (!container) {
      throw new Error(`containerId 指向的节点不存在: ${scope.containerId}（Penpot 只能查当前页）`)
    }
    const childIds = context.host.readProperties(container, ['children']).children
    for (const id of Array.isArray(childIds) ? childIds : []) {
      const child = context.host.getNodeById(String(id))
      if (child) push(child)
    }
    return matched
  }

  const queue: HostNode[] = [...context.host.getPageRootNodes()]
  while (queue.length) {
    const node = queue.shift() as HostNode
    const props = context.host.readProperties(node, ['id', 'name', 'type', 'children'])
    const name = typeof props.name === 'string' ? props.name : ''
    if (name.startsWith(scope.prefix)) {
      push(node)
      continue // 剪枝：不进入子层
    }
    const childIds = Array.isArray(props.children) ? (props.children as string[]) : []
    for (const id of childIds) {
      const child = context.host.getNodeById(String(id))
      if (child) queue.push(child)
    }
  }
  return matched
}

/**
 * `namePrefix` / `containerId` 形态：按作用域建库。
 *
 * `listOnly: true` 时**只列举不转换**（回 `matched[]`）。注意 `matched` 这个键在两种
 * 形态下类型不同：非 listOnly 是**命中数量**（历史契约，不能改），listOnly 是**节点数组**。
 */
async function convertInScope(
  scope: BuildScope,
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const keepOriginal = params.keepOriginal === true
  const matched = collectInScope(scope, context)

  // 只列举：不建组件、不动节点（AI 先看候选再决定要不要转）
  if (params.listOnly === true) {
    return {
      ok: true,
      listOnly: true,
      ...(scope.kind === 'prefix' ? { namePrefix: scope.prefix } : { containerId: scope.containerId }),
      matched: matched.map((item) => ({ nodeId: item.id, name: item.name, type: item.type })),
      // listOnly 不转换 → `components` 必为空；`count` 给的是**命中数**（列举调用真正关心的量）
      count: matched.length,
      components: [],
      skipped: [],
    }
  }

  // 「已是组件母版」→ 跳过（幂等）：母版形状 id 由 listComponents().masterNodeId 给出
  const masterIds = new Set<string>()
  try {
    for (const component of await context.host.listComponents()) {
      if (component.masterNodeId) masterIds.add(String(component.masterNodeId))
    }
  } catch {
    // 宿主不提供组件清单时无法判断，按未转换处理（后续 createComponent 会如实报错，不谎报成功）
  }

  const components: Record<string, unknown>[] = []
  const skipped: Record<string, unknown>[] = []
  for (const item of matched) {
    if (masterIds.has(item.id)) {
      skipped.push({ nodeId: item.id, name: item.name, reason: 'already-component' })
      continue
    }
    // 逐个转：每个母版各自沿用原名（与 MasterGo 形态 C 同语义）
    const result = await context.host.createComponent([item.node])
    components.push({ nodeId: item.id, componentId: result.componentId, name: result.name })
  }

  const note = keepOriginal
    ? 'Penpot 的 createComponent 会原地把形状变成母版，没有"保留原对象副本"的语义（已忽略 keepOriginal）'
    : undefined

  return {
    ok: components.length > 0,
    ...(scope.kind === 'prefix' ? { namePrefix: scope.prefix } : { containerId: scope.containerId }),
    matched: matched.length,
    count: components.length,
    components,
    skipped,
    ...(note ? { note } : {}),
  }
}

// ───────────────────────── variantGroups 形态 ─────────────────────────

interface VariantGroupMember {
  nodeId: string
  /** = `values[0]`（单轴向后兼容） */
  value: string
  /** 每个轴一个值（与 `VariantGroup.properties` 对齐） */
  values: string[]
}

interface VariantGroup {
  setId: string
  /** = `properties[0]`（单轴向后兼容） */
  propertyName: string
  /** 轴名（≥1）；长度 >1 即多轴（Penpot 原生支持） */
  properties: string[]
  members: VariantGroupMember[]
}

interface VariantSetEntry {
  setId: string
  containerId?: string
  propertyName: string
  /** 轴名列表（多轴时 >1）；旧字段 `propertyName` 保留为 `properties[0]` */
  properties?: string[]
  /** **输入**的成员数（含被跳过/重复的）；真正写入的轴值看 `values` */
  memberCount: number
  /** 实际写入的首轴值，按 `members` 顺序（只含真正进了变体集的成员） */
  values?: string[]
  /** 回读的实际轴名（`Variants.properties`）—— 多轴是否真生效的证据 */
  hostProperties?: string[]
  ok: boolean
  reason?: string
}

/**
 * 解析 `variantGroups`（显式属性表）。**形态非法直接抛错** —— 那是调用方的 bug，
 * 不能静默退化成别的形态（否则会被误以为「已合成」）。
 *
 * 两种线形状都接受：单轴 `{propertyName, members[{value}]}`（向后兼容）与
 * 多轴 `{properties[], members[{values[]}]}`（Penpot 原生多属性轴）。内部统一归一为
 * `properties[]` + `members[].values[]`。
 */
function parseVariantGroups(raw: unknown): VariantGroup[] {
  if (!Array.isArray(raw)) throw new Error('variantGroups 需要是数组')
  return raw.map((item, index) => {
    const group = (item ?? {}) as Record<string, unknown>
    const setId = typeof group.setId === 'string' ? group.setId.trim() : ''
    if (!setId) throw new Error(`variantGroups[${index}].setId 缺失（变体集名，如 'Button'）`)

    // 轴名：properties[]（多轴）优先，否则 propertyName（单轴）
    let properties: string[]
    if (Array.isArray(group.properties)) {
      properties = (group.properties as unknown[]).map((name, axisIndex) => {
        const text = String(name ?? '').trim()
        if (!text) throw new Error(`variantGroups[${index}].properties[${axisIndex}] 是空轴名`)
        return text
      })
      if (!properties.length) throw new Error(`variantGroups[${index}].properties 是空数组`)
    } else {
      const propertyName = typeof group.propertyName === 'string' ? group.propertyName.trim() : ''
      if (!propertyName) {
        throw new Error(`variantGroups[${index}] 缺少轴名：给 properties[]（多轴）或 propertyName（单轴）`)
      }
      properties = [propertyName]
    }

    if (!Array.isArray(group.members)) throw new Error(`variantGroups[${index}].members 需要是数组`)
    const members = (group.members as unknown[]).map((entry, memberIndex) => {
      const member = (entry ?? {}) as Record<string, unknown>
      const nodeId = String(member.nodeId ?? '')
      if (!nodeId) throw new Error(`variantGroups[${index}].members[${memberIndex}].nodeId 缺失`)

      // 轴值：values[]（多轴）优先，否则 value（单轴）；数字显式转字符串，不静默丢
      let values: string[]
      if (Array.isArray(member.values)) {
        values = (member.values as unknown[]).map((value) => String(value ?? ''))
      } else {
        const rawValue = member.value
        if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
          throw new Error(
            `variantGroups[${index}].members[${memberIndex}] 缺少轴值：给 values[]（多轴）或 value（单轴）`,
          )
        }
        values = [String(rawValue)]
      }
      if (values.length !== properties.length) {
        throw new Error(
          `variantGroups[${index}].members[${memberIndex}].values 长度 ${values.length} 与轴数 ${properties.length} 不一致（${properties.join(', ')}）`,
        )
      }
      if (values.some((value) => !value)) {
        throw new Error(`variantGroups[${index}].members[${memberIndex}].values 含空串（轴值不能为空）`)
      }
      return { nodeId, value: values[0], values }
    })

    return { setId, propertyName: properties[0], properties, members }
  })
}

/**
 * `variantGroups` 形态：按显式属性表把一组组件合成**原生变体集**。
 *
 * 逐组处理，**一组失败不影响其余组**（失败原因写进 `variantSets[].reason` / `skipped`）。
 *
 * 三个关键判定：
 *   1. 成员已是组件母版 → 复用（`listComponents().masterNodeId`）；否则 `createComponent` 原地转；
 *   2. 成员不是 board → **包一层同尺寸 frame**（`createVariantFromComponents` 只接受 board），
 *      并在 `notes` 里如实说明「节点形态被改了」（包不了就 `skipped` + 该组 ok:false，不静默）；
 *   3. 合成后把容器名改成 `setId`，由宿主回读校验；不一致就写 `notes`。
 *
 * 配对（nodeId ↔ value）交给 `host.createVariants`：它在 Penpot 侧是按
 * `component.mainInstance()?.id` 配的，**不信** `variantComponents()` 的顺序。
 */
async function convertToVariantSets(
  groups: VariantGroup[],
  context: HandlerContext,
): Promise<unknown> {
  const notes: string[] = []
  const components: { nodeId: string; componentId: string; name: string }[] = []
  const skipped: { nodeId?: string; name?: string; reason: string; message: string }[] = []
  const variantSets: VariantSetEntry[] = []

  if (!groups.length) notes.push('variantGroups 是空数组 —— 未做任何合成')

  // 组件母版索引：母版节点 id → 组件信息。一次拿到，避免逐组重复 listComponents。
  const masters = new Map<string, HostComponentInfo>()
  try {
    for (const component of await context.host.listComponents()) {
      if (component.masterNodeId) masters.set(String(component.masterNodeId), component)
    }
  } catch (error) {
    notes.push(`无法列出组件清单（${(error as Error).message}）—— 已按"都不是组件"处理，可能重复建组件`)
  }

  for (const group of groups) {
    // ⓪ 先做「不可能成功」的预检：成员不足 2 个时**不能**先去建组件（会有无谓的副作用）
    if (group.members.length < 2) {
      variantSets.push({
        setId: group.setId,
        propertyName: group.propertyName,
        memberCount: group.members.length,
        ok: false,
        reason: `可合成成员不足 2 个（实际 ${group.members.length}）—— 变体集至少需要 2 个状态`,
      })
      continue
    }

    // ① 逐成员：包装（必要时）→ 转成/复用组件母版
    const survivors: { frame: HostNode; value: string; values: string[] }[] = []
    const seenNodeIds = new Set<string>()
    for (const member of group.members) {
      // 同一个母版在一个变体集里只能出现一次（两次会让宿主报重复母版）
      if (seenNodeIds.has(member.nodeId)) {
        skipped.push({
          nodeId: member.nodeId,
          reason: 'duplicate-member',
          message: `${member.nodeId} 在同一变体集里重复出现（value=${member.value} 已忽略）`,
        })
        continue
      }
      seenNodeIds.add(member.nodeId)

      const node = context.host.getNodeById(member.nodeId)
      if (!node) {
        skipped.push({
          nodeId: member.nodeId,
          reason: 'node-not-found',
          message: `节点不存在: ${member.nodeId}（Penpot 只能查当前页）`,
        })
        continue
      }

      const props = context.host.readProperties(node, ['name', 'width', 'height', 'type'])
      const name = typeof props.name === 'string' ? props.name : ''
      const hostType = String(props.type ?? '')
      // 成员自己已经是组件母版吗？（母版 id = 形状 id，Penpot 这里保持不变）
      const isMaster = masters.has(node.id)

      // ② 非 board → 包同尺寸 frame。这是**改变节点形态**的操作，必须如实写进 notes。
      let target = node
      if (hostType !== 'board') {
        const width = Number(props.width ?? 0) || 100
        const height = Number(props.height ?? 0) || 100
        try {
          const frame = await context.host.createNode(
            { kind: 'frame', name: name || group.setId, width, height },
            null,
          )
          await context.host.appendChild(frame, node)
          await context.host.applyProperties(node, { x: 0, y: 0 })
          await context.host.applyProperties(frame, { fills: [] })
          target = frame
          notes.push(
            `${name || member.nodeId} 是 ${hostType}（不是 board）—— 已包一层同尺寸 frame 再合成（Penpot 的 createVariantFromComponents 只接受 board）；原节点现在是该 frame 的子层`,
          )
          if (isMaster) {
            notes.push(
              `${name || member.nodeId} 本来是组件母版，但类型不是 board —— 已包 frame 并**另建**一个外层组件参与变体集（内层母版原样保留）`,
            )
          }
        } catch (error) {
          skipped.push({
            nodeId: member.nodeId,
            name,
            reason: 'wrap-failed',
            message: `非 board 成员包 frame 失败（无法合成变体集）：${(error as Error).message}`,
          })
          continue
        }
      }

      // ③ 已是组件母版则复用（只对 board 成员成立）；否则原地转成组件
      const existing = target === node && isMaster ? masters.get(node.id) : undefined
      let componentId: string
      if (existing) {
        componentId = existing.id
      } else {
        try {
          const created = await context.host.createComponent([target])
          componentId = created.componentId
          // 登记进索引：同一次调用里同一节点再出现时不重复建
          masters.set(target.id, {
            id: componentId,
            name: created.name,
            isLocal: true,
            masterNodeId: target.id,
          })
        } catch (error) {
          skipped.push({
            nodeId: member.nodeId,
            name,
            reason: 'create-component-failed',
            message: `转组件失败：${(error as Error).message}`,
          })
          continue
        }
      }

      components.push({ nodeId: target.id, componentId, name: name || group.setId })
      survivors.push({ frame: target, value: member.value, values: member.values })
    }

    // ④ 合成（宿主不支持 → ok:false + reason，不抛错；其余组继续）
    if (survivors.length < 2) {
      variantSets.push({
        setId: group.setId,
        propertyName: group.propertyName,
        memberCount: group.members.length,
        ok: false,
        reason: `可合成成员不足 2 个（实际 ${survivors.length}）—— 变体集至少需要 2 个状态`,
      })
      continue
    }

    // 多轴：把 survivors 的 values[] 按轴转置成 axes[{name, values[]}]（与输入节点顺序对齐）
    const axes = group.properties.map((name, axisIndex) => ({
      name,
      values: survivors.map((item) => item.values[axisIndex]),
    }))
    const result = await context.host.createVariants(
      survivors.map((item) => item.frame),
      group.propertyName,
      survivors.map((item) => item.value),
      { containerName: group.setId, axes },
    )

    if (!result.ok) {
      const reason = result.reason ?? '宿主未说明原因'
      variantSets.push({
        setId: group.setId,
        propertyName: group.propertyName,
        memberCount: group.members.length,
        ok: false,
        reason,
      })
      notes.push(`变体集 ${group.setId} 未合成（${reason}）`)
      if (result.note) notes.push(`变体集 ${group.setId}：${result.note}`)
      continue
    }

    variantSets.push({
      setId: group.setId,
      containerId: result.containerId,
      propertyName: group.propertyName,
      ...(group.properties.length > 1 ? { properties: group.properties } : {}),
      memberCount: group.members.length,
      values: survivors.map((item) => item.value),
      ...(result.properties ? { hostProperties: result.properties } : {}),
      ok: true,
    })
    if (result.containerName === undefined) {
      notes.push(`宿主未回报变体容器名 —— 无法确认"容器名 = ${group.setId}"是否生效`)
    } else if (result.containerName !== group.setId) {
      notes.push(`变体容器改名期望 ${group.setId}，实际 ${result.containerName}`)
    }
    if (result.note) notes.push(`变体集 ${group.setId}：${result.note}`)
  }

  return {
    ok: variantSets.length > 0 && variantSets.every((entry) => entry.ok),
    count: components.length,
    components,
    skipped,
    variantSets,
    ...(notes.length ? { notes } : {}),
  }
}

/**
 * `node/convertToComponent`：把节点转成组件母版。
 *
 * `keepOriginal` 在 Penpot 侧没有对应语义（`createComponent` 会**原地**把形状变成母版），
 * 因此当调用方显式要"保留原对象"时如实说明，而不是静默忽略。
 */
export async function handleNodeConvertToComponent(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const namePrefix = typeof params.namePrefix === 'string' && params.namePrefix ? params.namePrefix : undefined
  const containerId = typeof params.containerId === 'string' && params.containerId ? params.containerId : undefined
  if (namePrefix) return convertInScope({ kind: 'prefix', prefix: namePrefix }, params, context)
  if (containerId) return convertInScope({ kind: 'container', containerId }, params, context)

  // 显式属性表形态：把每个 group 的成员合成原生变体集（与 MasterGo 侧同形）
  // ⚠️ 放在 `listOnly` 判定**之后**：`listOnly` 是「绝不改文档」的承诺，
  // 两个参数同时出现时不能变成一次真转换。
  if (params.listOnly === true) {
    return {
      ok: false,
      listOnly: true,
      matched: [],
      count: 0,
      components: [],
      skipped: [
        {
          reason: 'missing-scope',
          message: 'listOnly 需要同时提供 containerId（推荐）或 namePrefix（按作用域列举候选）',
        },
      ],
    }
  }

  if (params.variantGroups !== undefined) return convertToVariantSets(parseVariantGroups(params.variantGroups), context)

  const nodes = requireNodes(params, context, 'node/convertToComponent')
  const name = typeof params.name === 'string' ? params.name : undefined
  const keepOriginal = params.keepOriginal === true

  const result = await context.host.createComponent(nodes, name)
  const note = keepOriginal
    ? 'Penpot 的 createComponent 会原地把形状变成母版，没有"保留原对象副本"的语义（已忽略 keepOriginal）'
    : undefined

  return { ok: true, ...result, note }
}

/** `node/detachInstance`：断开实例与母版的链接 */
export async function handleNodeDetachInstance(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const nodeId = String(params.nodeId ?? '')
  if (!nodeId) throw new Error('node/detachInstance 需要 nodeId')
  const node = context.host.getNodeById(nodeId)
  if (!node) throw new Error(`节点不存在: ${nodeId}（Penpot 只能查当前页）`)

  const result = await context.host.detachInstance(node)
  return { ok: true, nodeId, ...result }
}

/** `component/list`：本文件库 + 已连接团队库的组件 */
export async function handleComponentList(
  _params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const components = await context.host.listComponents()
  const local = components.filter((c) => c.isLocal)
  const external = components.filter((c) => !c.isLocal)

  const libraries = [...new Map(
    components
      .filter((c) => c.libraryId)
      .map((c) => [c.libraryId as string, { id: c.libraryId as string, name: c.libraryName ?? '', isLocal: c.isLocal === true }]),
  ).values()]

  return {
    ok: true,
    count: components.length,
    localCount: local.length,
    externalCount: external.length,
    // 团队库要先在 Penpot 里「连接库」才会出现在这里（connectLibrary）
    libraries,
    components,
    hint: external.length === 0
      ? '没有外部库组件：团队库需先在 Penpot 里连接（本插件暂未接线 connectLibrary，见 ANALYSIS §13）'
      : undefined,
  }
}

/** `component/search`：按名字/路径模糊匹配 */
export async function handleComponentSearch(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const query = typeof params.query === 'string' ? params.query.trim().toLowerCase() : ''
  const limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : 50
  if (!query) throw new Error('component/search 需要 query')

  const all = await context.host.listComponents()
  const matched: HostComponentInfo[] = []
  for (const component of all) {
    const haystack = `${component.name} ${component.path ?? ''} ${component.libraryName ?? ''}`.toLowerCase()
    if (haystack.includes(query)) matched.push(component)
    if (matched.length >= limit) break
  }

  return {
    ok: true,
    query,
    count: matched.length,
    scanned: all.length,
    limited: matched.length >= limit,
    components: matched,
  }
}

const FORMATS = new Set<ExportFormat>(['PNG', 'JPG', 'WEBP', 'SVG', 'PDF'])

/**
 * `node/exportImage`：导出为 PNG/JPG/WEBP/SVG/PDF。
 *
 * ⚠️ 返回形状必须严格是 `{nodeId, format, mimeType, data, ...}` —— 服务端据此识别并接管
 * 落盘与图片包装（见 image-export.ts）。`data`：SVG 为源码文本，其余为 base64。
 */
export async function handleNodeExportImage(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const nodeId = String(params.nodeId ?? '')
  if (!nodeId) throw new Error('node/exportImage 需要 nodeId')
  const node = context.host.getNodeById(nodeId)
  if (!node) throw new Error(`节点不存在: ${nodeId}（Penpot 只能查当前页）`)

  const formatRaw = String(params.format ?? 'PNG').toUpperCase() as ExportFormat
  if (!FORMATS.has(formatRaw)) throw new Error(`node/exportImage 不支持的格式: ${params.format}`)

  const constraint = (params.constraint ?? {}) as { type?: string; value?: number }
  const options = {
    format: formatRaw,
    ...(constraint.type === 'SCALE' && typeof constraint.value === 'number' ? { scale: constraint.value } : {}),
    ...(constraint.type === 'WIDTH' && typeof constraint.value === 'number' ? { width: constraint.value } : {}),
    ...(constraint.type === 'HEIGHT' && typeof constraint.value === 'number' ? { height: constraint.value } : {}),
  }

  const result = await context.host.exportNode(node, options)
  const nodeName = String(context.host.readProperties(node, ['name']).name ?? '')

  // ── 契约适配：服务端要 data URI ──
  // image-export.ts 的判定是「`data:` 开头」或「format === 'SVG' 的纯文本」，
  // 传裸 base64 会直接报 "Unexpected data format: expected data URI or SVG text"。
  // 历史坑：这里曾经直接透传宿主给的裸 base64 —— 结果是**导 PNG 从来没成功过**，
  // 而单测只断言了 `typeof data === 'string'`，所以一路绿灯。
  const isTextPayload = result.isText || formatRaw === 'SVG'
  const data = isTextPayload || result.data.startsWith('data:')
    ? result.data
    : `data:${result.mimeType};base64,${result.data}`

  return {
    nodeId,
    nodeName,
    format: result.format,
    mimeType: result.mimeType,
    data,
    scale: result.scale,
    ...(result.notes.length ? { notes: result.notes } : {}),
    ...(result.isText ? { text: true } : {}),
  }
}

/**
 * `style/generateCss`：宿主原生 CSS（Penpot：`generateStyle({type:'css'})` + `generateFontFaces`）。
 *
 * 供 `design_to_code` 的可选 `exportCss` 使用。宿主不具备时返回 `available:false` + `reason`，
 * **不伪造 CSS**；`nodeIds` 与 `nodeCount` 供调用方核对覆盖范围。
 */
export async function handleStyleGenerateCss(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const nodes = requireNodes(params, context, 'style/generateCss')
  const result = await context.host.generateCss(nodes)
  return {
    ...result,
    nodeIds: nodes.map((node) => String(context.host.readProperties(node, ['id']).id)),
  }
}
