/**
 * `node/swapComponent` —— 用宿主已有原语**在插件端合成**「换组件」
 *
 * 背景：Penpot 的插件 API 里 `instance.component()` 是**只读** getter，没有"换主组件"的写入路径。
 * 但这件事完全可以用已有原语拼出来 —— 因此它不该是一个 `available:false` 的降级，
 * 而应该是**插件端行为**：MCP 接口保持原样暴露，语义在插件侧补齐。
 * （与「单边描边用叠加 Path 模拟」是同一条思路。）
 *
 * 照抄 MasterGo 侧的语义（`plugin-mastergo/lib/api/swapComponentHandlers.ts`）：
 *   - 目标是**普通对象** → **原位替换**：建实例 → 插回原父层与图层顺序 → 继承位置/宽高/名字
 *     → 按图层名带过文字与可见性 → 默认删掉原对象（`keepOriginal: true` 保留）
 *   - 目标是**实例** → 语义上等价于"换成另一个主组件"，本实现同样按原位替换处理
 *   - 被替换对象是 `COMPONENT` / `COMPONENT_SET` → **拒绝**（改母版不是"换组件"）
 *   - `variantProperties` → 实例化后走 `switchVariant`
 *
 * 明确不做并如实说明的（Penpot 无对应概念）：`ukey`（团队库标识）、`properties`（组件属性插槽）、
 * `resetOverrides`（Penpot 新实例天然无覆写，等价于已重置）。
 */
import type { HandlerContext } from './index'
import type { HostNode } from '../host/types'

export interface SwapParams {
  nodeId?: string
  nodeIds?: string[]
  useSelection?: boolean
  componentId?: string
  ukey?: string
  component?: string
  library?: string
  type?: string
  variant?: string
  variantProperties?: Record<string, string>
  properties?: Record<string, unknown>
  resetOverrides?: boolean
  keepSize?: boolean
  keepOriginal?: boolean
  carryOverOverrides?: boolean
  name?: string
}

interface SwapResult {
  nodeId: string
  sourceNodeId: string
  name: string
  success: boolean
  error?: string
  carriedOver?: number
  notes?: string[]
  /** 是否走了宿主原生 swapComponent（否则是合成实现） */
  native?: boolean
  /** 换过去的组件（原生路径下是宿主回读值） */
  componentId?: string
  componentName?: string
}

/** 读一个节点的父层 id 与在父层中的下标（跨宿主可用：靠父层的 children 顺序算，不依赖宿主字段） */
function locate(context: HandlerContext, node: HostNode): {
  parentId: string | null
  index: number | null
  parentIsFlex: boolean
} {
  const parentId = (context.host.readProperties(node, ['parentId']).parentId as string | null) ?? null
  if (!parentId) return { parentId: null, index: null, parentIsFlex: false }

  const parent = context.host.getNodeById(parentId)
  if (!parent) return { parentId, index: null, parentIsFlex: false }

  const childIds = (context.host.readProperties(parent, ['children']).children as string[] | undefined) ?? []
  const index = childIds.indexOf(node.id)
  const layoutMode = context.host.readProperties(parent, ['layoutMode']).layoutMode

  return { parentId, index: index >= 0 ? index : null, parentIsFlex: layoutMode === 'HORIZONTAL' || layoutMode === 'VERTICAL' }
}

/**
 * 收集子树里「图层名 → 可继承属性」。
 * 只收文本内容与**隐藏**状态 —— 与 MasterGo 侧 `carryOverOverrides` 的口径一致。
 *
 * ⚠️ 可见性**只在 `false` 时收**：宿主（Penpot/MemoryHost）回读 `visible` 永远是布尔值，
 * 无条件记下它会让**每一个**命名节点都进入这张表，于是 `carriedOver` 变成「与母版同名的
 * 节点数」（连根节点都算一次），而不是「真的带过了几项覆写」。
 * 真机实测：Demo 3 里 B 的子层叫 `Card Title B` / `Card Body B`，与母版的 A 后缀完全不匹配，
 * 文字一项都没带过去，`carriedOver` 却报 2 —— 那 2 是 `Feature Card B`（根）与 `path`（图标
 * 矢量，两侧同名）的 `visible:true` 空写。MasterGo 侧一直是 `if (current.isVisible === false)`，
 * 这里对齐它。
 */
function collectCarryOver(context: HandlerContext, root: HostNode, acc = new Map<string, { characters?: string; visible?: boolean }>()) {
  const props = context.host.readProperties(root, ['name', 'children', 'characters', 'visible'])
  const name = String(props.name ?? '')
  const entry: { characters?: string; visible?: boolean } = {}
  if (typeof props.characters === 'string' && props.characters) entry.characters = props.characters
  // 只在「确实隐藏」时继承；true 是默认态，记下来只会污染计数
  if (props.visible === false) entry.visible = false
  if (Object.keys(entry).length && name) acc.set(name, entry)

  for (const childId of (props.children as string[] | undefined) ?? []) {
    const child = context.host.getNodeById(childId)
    if (child) collectCarryOver(context, child, acc)
  }
  return acc
}

/** 把继承信息应用到新实例的对应名字节点上；返回实际带过的条数 */
async function applyCarryOver(
  context: HandlerContext,
  root: HostNode,
  source: Map<string, { characters?: string; visible?: boolean }>,
): Promise<number> {
  let applied = 0
  const props = context.host.readProperties(root, ['name', 'children'])
  const name = String(props.name ?? '')
  const inherited = source.get(name)

  if (inherited) {
    const patch: Record<string, unknown> = {}
    if (inherited.characters !== undefined) patch.characters = inherited.characters
    if (inherited.visible !== undefined) patch.visible = inherited.visible
    if (Object.keys(patch).length) {
      const result = await context.host.applyProperties(root, patch as never)
      if (result.skipped.length === 0) applied += 1
    }
  }

  for (const childId of (props.children as string[] | undefined) ?? []) {
    const child = context.host.getNodeById(childId)
    if (child) applied += await applyCarryOver(context, child, source)
  }
  return applied
}

/** 被替换对象是母版吗（是则拒绝 —— 改母版不是"换组件"） */
async function isComponentMaster(context: HandlerContext, node: HostNode): Promise<boolean> {
  /**
   * **以 `isComponentRoot()` 为准**（Penpot 官方成员），`masterNodeId` 只作兜底。
   *
   * 真机实测发现的差异：用户选中一个组件母版本体时，`isComponentRoot()` 与
   * `isComponentInstance()` **同时为真**（母版本体既是"根"又是该组件的实例）；而
   * 组件库里 `mainInstance()?.id` 给出的 `masterNodeId` 指向的是**另一个节点**。
   * 也就是说：只靠 `masterNodeId === node.id` 会**漏判母版** —— 而这条判定的作用是
   * 「被替换对象是母版 → 拒绝」（改母版不是换组件），漏判就会误改母版。
   *
   * `mainInstance()` 在变体成员上的具体语义待真机核对
   * （见 内部笔记）。
   */
  // 官方成员 `isComponentMainInstance()`：*"true if the current shape is inside a component
  // **main** instance"* —— 这才是"母版（及子树）"的判据。
  // （`isComponentRoot()` 是"组件树的根"，副本实例的根也为真 → 不能用来判母版；
  //   `isComponentInstance()` 是"在实例内部"，母版/副本都算 → 也不能。）
  const mainInstance = context.host.readProperties(node, ['isComponentMainInstance']).isComponentMainInstance
  if (typeof mainInstance === 'boolean') return mainInstance

  // 兜底（旧宿主没有该成员时）：按组件库的母版节点 id 比对
  const components = await context.host.listComponents()
  return components.some((component) => component.masterNodeId === node.id)
}

/**
 * 换组件（单节点）。返回结果与说明；失败原因通过 `success:false + error` 回报，
 * 由调用方决定是整体失败还是逐项失败（批量时后者更有用）。
 */
async function swapOne(
  context: HandlerContext,
  source: HostNode,
  params: SwapParams,
): Promise<SwapResult> {
  const base: SwapResult = { nodeId: source.id, sourceNodeId: source.id, name: '', success: false }
  const notes: string[] = []

  if (await isComponentMaster(context, source)) {
    return { ...base, error: '被替换对象是组件母版（COMPONENT）—— 改母版不是「换组件」，请改用 node_update' }
  }

  const before = context.host.readProperties(source, ['name', 'x', 'y', 'width', 'height', 'rotation'])
  const sourceName = String(before.name ?? '')
  const sourceBox = {
    x: Number(before.x ?? 0),
    y: Number(before.y ?? 0),
    width: Number(before.width ?? 0),
    height: Number(before.height ?? 0),
  }

  const location = locate(context, source)
  const parent = location.parentId ? context.host.getNodeById(location.parentId) : null

  /**
   * **原生优先**：Penpot 有 `shape.swapComponent(component)`
   * （官方原文：*"Swaps the component instance for another component, keeping the overrides
   * when possible. Similar to the "swap component" action on the Penpot interface.
   * The current shape must be a component copy instance."*）。
   *
   * 触发条件三个都要满足：源对象**是实例**（原生要求）、宿主声明了该能力、方法真的在。
   * 任一不满足就落到下面的合成实现（旧宿主 / 源是普通对象）。
   *
   * 这一整块曾被我误判为"Penpot 做不到"而只写了合成实现 —— 见 §14 的教训：
   * 说宿主做不到之前先 grep api.yml。
   */
  // 原生 `swapComponent` 要求"当前形状是组件**副本**实例"（官方原文：
  // "The current shape must be a component copy instance."）→ 用 `isComponentCopyInstance()`，
  // 而不是宽泛的 `isComponentInstance()`（后者对母版与子节点也为真）。
  const sourceIsInstance =
    context.host.readProperties(source, ['isComponentCopyInstance']).isComponentCopyInstance === true
  const nativeSwap = sourceIsInstance &&
    context.host.getCapabilities().ops.swapComponent &&
    typeof context.host.swapComponent === 'function'

  if (nativeSwap) {
    try {
      const swapped = await context.host.swapComponent!(source, {
        componentId: params.componentId,
        componentName: params.component,
        libraryName: params.library,
      })
      const applied: Record<string, unknown> = {}
      if (params.name) applied.name = params.name

      // 尺寸：原生语义是"尽可能保留覆写"，尺寸通常已保留；这里只做**显式**对齐，
      // 避免"我以为宿主会保留"这种假设（keepSize 缺省 true）。
      const keepSize = params.keepSize !== false
      const sourceBox = {
        width: Number(before.width ?? 0),
        height: Number(before.height ?? 0),
      }
      if (keepSize && sourceBox.width > 0 && sourceBox.height > 0) {
        applied.width = sourceBox.width
        applied.height = sourceBox.height
      }
      if (Object.keys(applied).length) {
        await context.host.applyProperties(source, applied as never)
      }

      // `carryOverOverrides: false` → 原生换组件会保留覆写，需要显式清掉
      if (params.carryOverOverrides === false) {
        if (typeof context.host.resetOverrides === 'function') {
          try {
            await context.host.resetOverrides(source)
            notes.push('carryOverOverrides=false → 已调用宿主的 resetOverrides 清掉覆写')
          } catch (error) {
            notes.push(`carryOverOverrides=false 但清覆写失败：${(error as Error).message}`)
          }
        } else {
          notes.push('carryOverOverrides=false：宿主未提供 resetOverrides，覆写可能仍在（如实告知）')
        }
      }

      notes.push(`走宿主原生 shape.swapComponent（覆盖保留由宿主负责）→ ${swapped.componentName || swapped.componentId}`)
      return {
        ...base,
        name: params.name ?? sourceName,
        success: true,
        componentId: swapped.componentId,
        componentName: swapped.componentName,
        notes,
        native: true,
      }
    } catch (error) {
      // 原生失败不静默：记下来，再走合成实现
      notes.push(`原生换组件失败：${(error as Error).message} → 回退到合成实现`)
    }
  } else if (!sourceIsInstance) {
    notes.push('源对象不是组件实例 → 用合成实现（原生 swapComponent 要求实例）')
  } else {
    notes.push('宿主未提供 shape.swapComponent（旧版 Penpot）→ 用合成实现')
  }

  // 按图层名收集要继承的文字/可见性（必须在建新实例**之前**收，原对象随后会被删）
  const carryOver = params.carryOverOverrides === false ? null : collectCarryOver(context, source)

  let instance: { nodeId: string; componentId: string; componentName: string }
  try {
    instance = await context.host.instantiateComponent({
      componentId: params.componentId,
      componentName: params.component,
      libraryName: params.library,
      // 插到原父层，随后再调图层顺序 —— 先插末尾能保证下标计算不受删除影响
      parent: parent ?? null,
      name: params.name ?? sourceName,
    })
  } catch (error) {
    return { ...base, name: sourceName, error: (error as Error).message }
  }

  const newNode = context.host.getNodeById(instance.nodeId)
  if (!newNode) {
    return { ...base, name: sourceName, error: `实例化后找不到新节点: ${instance.nodeId}` }
  }

  // 尺寸：非实例原位替换默认保持原宽高（keepSize 缺省 true）
  const keepSize = params.keepSize !== false
  const patch: Record<string, unknown> = {}
  if (keepSize && sourceBox.width > 0 && sourceBox.height > 0) {
    patch.width = sourceBox.width
    patch.height = sourceBox.height
  }
  if (typeof before.rotation === 'number' && before.rotation !== 0) patch.rotation = before.rotation
  // 位置：flex 父层由布局决定（插到同一下标即同位），普通父层才显式设 x/y
  if (!location.parentIsFlex) {
    patch.x = sourceBox.x
    patch.y = sourceBox.y
  } else if (parent) {
    notes.push('父层是 flex 布局 → 位置由布局决定（已插回原图层顺序，位置随之保持一致）')
  }
  if (Object.keys(patch).length) {
    await context.host.applyProperties(newNode, patch as never)
  }

  // 图层顺序：插回原下标（原对象还没删，所以目标下标就是它原来的位置）
  if (parent && location.index !== null) {
    try {
      await context.host.appendChild(parent, newNode, location.index)
    } catch (error) {
      notes.push(`图层顺序未复位: ${(error as Error).message}`)
    }
  }

  // 带过文字/可见性
  let carriedOver = 0
  if (carryOver && carryOver.size) {
    carriedOver = await applyCarryOver(context, newNode, carryOver)
  }

  // 变体属性
  const variantProperties = params.variantProperties
  if (variantProperties && typeof variantProperties === 'object' && Object.keys(variantProperties).length) {
    for (const [property, value] of Object.entries(variantProperties)) {
      const switched = await context.host.switchVariant(newNode, property, String(value))
      if (!switched.switched) notes.push(switched.note ?? `变体属性 ${property}=${value} 未生效`)
    }
  } else if (typeof params.variant === 'string' && params.variant.trim()) {
    const switched = await context.host.switchVariant(newNode, 'variant', params.variant.trim())
    if (!switched.switched) notes.push(switched.note ?? `变体 ${params.variant} 未生效`)
  }

  // 默认删掉原对象（keepOriginal: true 则保留）
  if (params.keepOriginal !== true) {
    try {
      await context.host.removeNode(source)
    } catch (error) {
      notes.push(`原对象删除失败，可能残留: ${(error as Error).message}`)
    }
  }

  if (params.resetOverrides === true) {
    notes.push('resetOverrides 在 Penpot 上无需处理：新实例天然没有覆写（等价于已重置）')
  }
  if (params.properties && Object.keys(params.properties).length) {
    notes.push('properties（组件属性插槽）在 Penpot 无对应概念，已忽略')
  }
  if (params.type === 'COMPONENT_SET') {
    notes.push('Penpot 的组件集是 createVariantFromComponents 的产物；这里按普通组件实例化')
  }

  return {
    nodeId: instance.nodeId,
    sourceNodeId: source.id,
    name: params.name ?? sourceName,
    success: true,
    ...(carriedOver ? { carriedOver } : {}),
    ...(notes.length ? { notes } : {}),
  }
}

/**
 * `node/swapComponent`（工具名 `node_swap_component`）
 *
 * 支持 `nodeId` / `nodeIds[]` / `useSelection`（默认 true）三种定位，
 * 批量时**逐项回报**（一项失败不该让整批变成"都失败"）。
 */
export async function handleNodeSwapComponent(
  params: SwapParams,
  context: HandlerContext,
): Promise<unknown> {
  if (typeof params.ukey === 'string' && params.ukey && !params.componentId && !params.component) {
    return {
      available: false,
      reason: 'ukey 是 MasterGo 团队库的标识，Penpot 侧没有对应概念',
      hint: '改用 component(+library) 按名字解析，或先用 component/search 拿到组件 id 后传 componentId',
    }
  }
  if (!params.componentId && !params.component) {
    throw new Error('node/swapComponent 需要 componentId 或 component（组件名）')
  }

  const ids = params.nodeIds?.length ? params.nodeIds : params.nodeId ? [params.nodeId] : []
  let sources: HostNode[]
  if (ids.length) {
    sources = ids.map((id) => {
      const node = context.host.getNodeById(String(id))
      if (!node) throw new Error(`节点不存在: ${id}（Penpot 只能查当前页）`)
      return node
    })
  } else if (params.useSelection !== false) {
    sources = [...context.host.getSelection()]
  } else {
    throw new Error('node/swapComponent 没有可替换的对象（传 nodeId / nodeIds，或先选中节点）')
  }

  if (!sources.length) throw new Error('node/swapComponent 没有可替换的对象（当前选区为空）')

  // ⚠️ 先读取全部源信息再逐个替换：批量替换时前面的操作可能改变后续节点的父层顺序
  const results: SwapResult[] = []
  for (const source of sources) {
    results.push(await swapOne(context, source, params))
  }

  const succeeded = results.filter((result) => result.success)
  return {
    ok: succeeded.length > 0,
    total: results.length,
    replaced: succeeded.length,
    failed: results.length - succeeded.length,
    results,
    ...(succeeded.length !== results.length
      ? { note: '存在失败项，见 results[].error —— 逐项回报，未整批回滚' }
      : {}),
  }
}
