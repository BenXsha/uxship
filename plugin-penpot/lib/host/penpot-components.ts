/**
 * 组合 / 组件 / 实例化与变体
 *
 * 从 `penpot.ts` 拆出（内聚单元：跨形状的组合操作 + 库级组件与变体）。
 * `createVariants` 原本被放在「设计令牌」段末尾（**放错分区**），本次一并归位到「组件实例化与变体」。
 *
 * 依赖方向单向：`PenpotHost` → 本模块。宿主**状态型**原语（requireShape / requireContainer /
 * currentRoot / insertChild）通过 `ComponentDeps` 传入，模块内**不反向摸 `PenpotHost`**；
 * 无状态原语（`penpot.createBoolean` / `align*` / `distribute*` / `createVariantFromComponents`）
 * 直接调用 —— 本文件属于 Penpot 宿主适配层（见 README「约定（续）」R1'）。
 */
import { HostArgumentError, UnsupportedHostFeatureError } from './errors'
import { libraryPools } from './penpot-runtime'
import type {
  BooleanOperation,
  CreateVariantsOptions,
  CreateVariantsResult,
  HostComponentInfo,
  HostNode,
  VariantAxis,
} from './types'

/** 本模块需要的**宿主状态型原语**（薄包装，全部来自 `PenpotHost`） */
export interface ComponentDeps {
  /** HostNode → 宿主形状（PenpotHost 层两者是同一对象，只是端口不额外包装） */
  requireShape(node: HostNode, feature: string): PenpotShape
  /** 形状 → 容器；非容器抛 `HostArgumentError` */
  requireContainer(shape: PenpotShape, feature: string): PenpotContainerShape
  /** 当前页的根 board；无打开页面时抛 `HostArgumentError` */
  currentRoot(): PenpotBoard
  /** 统一的插入入口（`PenpotHost.insertChild` —— 索引语义随 naturalChildOrdering 变） */
  insertChild(container: PenpotContainerShape, child: PenpotShape, index?: number): void
}

// ── 组合与组件（布尔运算 / 对齐分布 / 撤销块 / 组件与实例） ──

/** 布尔运算：DSL 的 UNION/SUBTRACT/INTERSECT/EXCLUDE → Penpot 的小写类型名 */
export async function booleanOperation(deps: ComponentDeps, nodes: readonly HostNode[], operation: BooleanOperation): Promise<HostNode> {
  if (nodes.length < 2) throw new HostArgumentError('布尔运算至少需要 2 个节点')
  const shapes = nodes.map((node) => deps.requireShape(node, 'booleanOperation'))
  const boolTypeMap: Record<BooleanOperation, 'union' | 'difference' | 'intersection' | 'exclude'> = {
    UNION: 'union',
    SUBTRACT: 'difference', // 命名差异：MasterGo/Figma 叫 SUBTRACT，Penpot 叫 difference
    INTERSECT: 'intersection',
    EXCLUDE: 'exclude',
  }
  const result = penpot.createBoolean(boolTypeMap[operation], shapes)
  if (!result) throw new HostArgumentError(`penpot.createBoolean 返回 null（${operation}）`)
  // SAFETY: penpot.createBoolean 返回的 PenpotBoolean 即宿主节点，断言仅做端口类型转换。
  return result as unknown as HostNode
}

/** 转组件母版：`library.local.createComponent(shapes)`，返回母版形状与组件 id */
export async function createComponent(deps: ComponentDeps,
  nodes: readonly HostNode[],
  name?: string,
): Promise<{ componentId: string; nodeId: string; name: string }> {
  const local = libraryPools().local
  if (!local || typeof local.createComponent !== 'function') {
    throw new UnsupportedHostFeatureError('createComponent', '宿主未提供 library.local.createComponent')
  }
  if (!nodes.length) throw new HostArgumentError('createComponent 至少需要 1 个节点')

  const shapes = nodes.map((node) => deps.requireShape(node, 'createComponent'))
  const component = local.createComponent(shapes)
  if (!component) throw new HostArgumentError('library.local.createComponent 返回空')

  if (name) {
    try {
      component.name = name
    } catch {
      /* 名称不可写不影响组件创建 */
    }
  }

  // 母版形状用来告诉调用方"组件落在哪个节点上"；拿不到就退回第一个输入节点
  let masterId = shapes[0]?.id ?? ''
  try {
    masterId = component.mainInstance()?.id ?? masterId
  } catch {
    /* 某些版本没有 mainInstance，退回输入节点 */
  }
  return { componentId: component.id, nodeId: masterId, name: component.name }
}

/** 对象之间对齐（Penpot 原生；官方语义"相对其中之一"，与本文件的包围盒口径可能不同） */
export async function alignNodes(deps: ComponentDeps,
  nodes: readonly HostNode[],
  input: { axis: 'HORIZONTAL' | 'VERTICAL'; direction: 'MIN' | 'CENTER' | 'MAX' },
): Promise<void> {
  // SAFETY: typings 把 alignHorizontal/alignVertical 声明为必填方法，这里按“可缺失”探测以兼容旧版宿主；调用前已 typeof 校验。
  const context = penpot as unknown as {
    alignHorizontal?: (shapes: PenpotShape[], direction: 'left' | 'center' | 'right') => void
    alignVertical?: (shapes: PenpotShape[], direction: 'top' | 'center' | 'bottom') => void
  }
  const shapes = nodes.map((node) => deps.requireShape(node, 'alignNodes'))

  if (input.axis === 'HORIZONTAL') {
    if (typeof context.alignHorizontal !== 'function') {
      throw new UnsupportedHostFeatureError('alignNodes', '宿主未提供 alignHorizontal')
    }
    const direction = input.direction === 'MIN' ? 'left' : input.direction === 'CENTER' ? 'center' : 'right'
    context.alignHorizontal(shapes, direction)
    return
  }

  if (typeof context.alignVertical !== 'function') {
    throw new UnsupportedHostFeatureError('alignNodes', '宿主未提供 alignVertical')
  }
  const direction = input.direction === 'MIN' ? 'top' : input.direction === 'CENTER' ? 'center' : 'bottom'
  context.alignVertical(shapes, direction)
}

/** 对象之间等距分布（Penpot 原生） */
export async function distributeNodes(deps: ComponentDeps, nodes: readonly HostNode[], input: { axis: 'HORIZONTAL' | 'VERTICAL' }): Promise<void> {
  // SAFETY: distributeHorizontal/distributeVertical 未收录进 typings/penpot.d.ts；按可缺失探测，调用前 typeof 校验。
  const context = penpot as unknown as {
    distributeHorizontal?: (shapes: PenpotShape[]) => void
    distributeVertical?: (shapes: PenpotShape[]) => void
  }
  const shapes = nodes.map((node) => deps.requireShape(node, 'distributeNodes'))
  const method = input.axis === 'HORIZONTAL' ? context.distributeHorizontal : context.distributeVertical
  if (typeof method !== 'function') {
    throw new UnsupportedHostFeatureError('distributeNodes', `宿主未提供 distribute${input.axis === 'HORIZONTAL' ? 'Horizontal' : 'Vertical'}`)
  }
  method.call(penpot, shapes)
}

/**
 * 撤销块（`penpot.history.undoBlockBegin(): Symbol` + `undoBlockFinish(id)`）。
 *
 * 官方原文：`undoBlockBegin(): Symbol` / `undoBlockFinish(blockId: Symbol): void`。
 * 注意 `finish` 必须**同参数成对**调用 —— 所以这里用 try/finally 保证异常路径也会闭合，
 * 否则会把后续所有操作都吞进同一个撤销块（症状：撤销行为变得很怪）。
 */
export async function withUndoBlock<T>(label: string, run: () => Promise<T>): Promise<T> {
  // SAFETY: penpot.history（undoBlockBegin/undoBlockFinish）未收录进 typings/penpot.d.ts；按可缺失探测，旧宿主走无撤销块分支。
  const history = (penpot as unknown as {
    history?: { undoBlockBegin?: () => unknown; undoBlockFinish?: (id: unknown) => void }
  }).history
  if (typeof history?.undoBlockBegin !== 'function' || typeof history?.undoBlockFinish !== 'function') {
    // 旧宿主：不阻塞渲染，但也不假装有了撤销块
    console.log(`[host] 宿主未提供 history，${label} 未包撤销块`)
    return await run()
  }

  const blockId = history.undoBlockBegin()
  try {
    return await run()
  } finally {
    try {
      history.undoBlockFinish(blockId)
    } catch (error) {
      console.warn('[host] undoBlockFinish 失败（撤销块未闭合）', error)
    }
  }
}

/**
 * 换主组件（原生）：`shape.swapComponent(component)`。
 *
 * 官方文档原文：*"Swaps the component instance for another component, keeping the overrides
 * when possible. Similar to the "swap component" action on the Penpot interface.
 * The current shape must be a component copy instance."*
 * 所以：**要求是实例**（不是实例时调用方会回退到合成实现），覆写保留由宿主负责。
 */
export async function swapComponent(deps: ComponentDeps,
  node: HostNode,
  input: { componentId?: string; componentName?: string; libraryName?: string },
): Promise<{ componentId: string; componentName: string }> {
  const shape = deps.requireShape(node, 'swapComponent')
  // SAFETY: shape 级 swapComponent 未在 typings 的形状基类声明（只在 LibraryComponent 上有）；按可缺失探测，非实例走合成实现。
  const holder = shape as unknown as { swapComponent?: (component: PenpotLibraryComponent) => void }
  if (typeof holder.swapComponent !== 'function') {
    throw new UnsupportedHostFeatureError('swapComponent', '宿主未提供 shape.swapComponent（旧版 Penpot）')
  }

  const found = findComponentObject(input.componentId, input.componentName, input.libraryName)
  if (!found) {
    throw new HostArgumentError(
      `组件未找到: ${input.componentId ?? input.componentName}` +
      (input.libraryName ? `（库 ${input.libraryName}）` : '') +
      ' —— 团队库需先 connectLibrary',
    )
  }

  holder.swapComponent(found.component)

  // 回读：宿主可能因覆写缺失而给出不同结果，真实归属以读回为准
  // SAFETY: 换组件后的回读：component 引用既可能是属性也可能是方法（与 readProperties.componentId 同处理），两种都兼容。
  const applied = shape as unknown as {
    component?: { id?: string; name?: string } | null | (() => { id?: string; name?: string } | null)
  }
  const raw = typeof applied.component === 'function' ? applied.component() : applied.component
  return {
    componentId: raw?.id ?? found.component.id,
    componentName: raw?.name ?? found.component.name ?? '',
  }
}

/** 清空实例覆写（官方 `shape.resetOverrides()`） */
export async function resetOverrides(deps: ComponentDeps, node: HostNode): Promise<void> {
  const shape = deps.requireShape(node, 'resetOverrides')
  // SAFETY: shape.resetOverrides 未收录进 typings；按可缺失探测，旧版宿主抛 UnsupportedHostFeatureError。
  const holder = shape as unknown as { resetOverrides?: () => void }
  if (typeof holder.resetOverrides !== 'function') {
    throw new UnsupportedHostFeatureError('resetOverrides', '宿主未提供 shape.resetOverrides（旧版 Penpot）')
  }
  holder.resetOverrides()
}

/** 分离实例：`shape.detach()`。非实例节点调用是无害的（Penpot 会忽略） */
export async function detachInstance(deps: ComponentDeps, node: HostNode): Promise<{ detached: boolean; note?: string }> {
  const shape = deps.requireShape(node, 'detachInstance')
  const detach = shape.detach
  if (typeof detach !== 'function') {
    throw new UnsupportedHostFeatureError('detachInstance', '宿主未提供 shape.detach()')
  }
  detach.call(shape)
  return { detached: true }
}

/** 列出组件：本文件库 + 已连接的团队库（带 libraryName 便于辨识来源） */
export async function listComponents(): Promise<HostComponentInfo[]> {
  const library = libraryPools()
  const out: HostComponentInfo[] = []

  const push = (lib: PenpotLibrary | undefined, isLocal: boolean) => {
    const components = lib?.components
    if (!Array.isArray(components)) return
    for (const component of components) {
      out.push({
        id: component.id,
        name: component.name,
        path: component.path,
        libraryId: lib?.id,
        libraryName: lib?.name,
        isVariant: typeof component.isVariant === 'function' ? component.isVariant() : undefined,
        // 母版节点 id：换组件时用它判断"被替换对象是不是母版"（是则必须拒绝）
        masterNodeId: (() => {
          try {
            return component.mainInstance()?.id
          } catch {
            return undefined
          }
        })(),
        isLocal,
      })
    }
  }

  push(library?.local, true)

  /**
   * 已连接库：**跳过与本地同 id 的那个**，并按 component id 全局去重。
   *
   * 真机踩到（用户问"我选中了什么"时顺手查组件库暴露的）：`component/list` 返回 4 条
   * 而实际只有 2 个组件 —— 同一个 `Button`/`Avatar` 各出现两次，因为 Penpot 的
   * `library.connected` 里**也含本文件库**（或同一库被列了两次）。重复条目会让 AI 选错、
   * 也会污染"按名匹配组件"的逻辑。
   */
  const localId = library?.local?.id
  const seen = new Set(out.map((component) => component.id))
  for (const connected of Array.isArray(library?.connected) ? library.connected : []) {
    if (localId && connected?.id === localId) continue
    const before = out.length
    push(connected, false)
    // push 是批量写入，这里逐条剔除已登记过的 id
    for (let i = out.length - 1; i >= before; i -= 1) {
      if (seen.has(out[i].id)) out.splice(i, 1)
      else seen.add(out[i].id)
    }
  }
  return out
}

// ── 组件实例化与变体 ──

/** 在本地库与已连接库里找到原始 LibraryComponent（不是归一化后的 info） */
function findComponentObject(componentId?: string, componentName?: string, libraryName?: string): {
  component: PenpotLibraryComponent
  library?: PenpotLibrary
} | null {
  const library = libraryPools()
  const pools: PenpotLibrary[] = [
    ...(library?.local ? [library.local] : []),
    ...(Array.isArray(library?.connected) ? library.connected : []),
  ]
  const wantedLibrary = libraryName?.trim().toLowerCase()

  for (const pool of pools) {
    if (wantedLibrary && (pool.name ?? '').trim().toLowerCase() !== wantedLibrary && pool.id !== libraryName) continue
    for (const candidate of pool.components ?? []) {
      if (componentId && candidate.id === componentId) return { component: candidate, library: pool }
      if (!componentId && componentName && candidate.name === componentName) return { component: candidate, library: pool }
    }
  }

  // 指定了库名却没命中 → 明确区分"库不存在"与"库里没这个组件"
  if (wantedLibrary) {
    const known = pools.find((pool) => (pool.name ?? '').trim().toLowerCase() === wantedLibrary)
    if (!known) {
      throw new HostArgumentError(
        `团队库未连接或不存在: ${libraryName}（Penpot 需先在 UI 里连接该库；本插件暂未接线 connectLibrary）`,
      )
    }
  }
  return null
}

export async function instantiateComponent(deps: ComponentDeps, input: {
  componentId?: string
  componentName?: string
  libraryName?: string
  parent?: HostNode | null
  x?: number
  y?: number
  width?: number
  height?: number
  name?: string
}): Promise<{ nodeId: string; componentId: string; componentName: string; libraryName?: string }> {
  if (!input.componentId && !input.componentName) {
    throw new HostArgumentError('instantiateComponent 需要 componentId 或 componentName')
  }
  const found = findComponentObject(input.componentId, input.componentName, input.libraryName)
  if (!found) {
    throw new HostArgumentError(
      `组件未找到: ${input.componentId ?? input.componentName}` +
        (input.libraryName ? `（库 ${input.libraryName}）` : '') +
        ' —— 可先用 component/search 查可用组件',
    )
  }

  const instance = found.component.instance()
  if (!instance) throw new HostArgumentError('component.instance() 返回空')

  if (input.name) instance.name = input.name
  if (input.width !== undefined || input.height !== undefined) {
    instance.resize(input.width ?? instance.width, input.height ?? instance.height)
  }

  const target = input.parent ? deps.requireShape(input.parent, 'instantiateComponent(parent)') : deps.currentRoot()
  deps.insertChild(deps.requireContainer(target, 'instantiateComponent'), instance, undefined)

  if (input.x !== undefined) instance.x = input.x
  if (input.y !== undefined) instance.y = input.y

  return {
    nodeId: instance.id,
    componentId: found.component.id,
    componentName: found.component.name,
    libraryName: found.library?.name,
  }
}

export async function switchVariant(deps: ComponentDeps,
  node: HostNode,
  propertyName: string,
  value: string,
): Promise<{ switched: boolean; note?: string }> {
  const shape = deps.requireShape(node, 'switchVariant')
  // SAFETY: shape 级 switchVariant 未收录进 typings；按可缺失探测，非变体实例返回 switched:false。
  const switchFn = (shape as unknown as { switchVariant?: (pos: string, value: string) => void }).switchVariant
  if (typeof switchFn !== 'function') {
    return {
      switched: false,
      note: '该节点不是变体实例（Penpot 的 switchVariant 只在变体实例上可用）',
    }
  }
  // Penpot 的 switchVariant 第一个参数是**属性名**（pos），不是下标
  switchFn.call(shape, propertyName, value)
  return { switched: true }
}

/**
 * 合成原生变体集。
 *
 * 这才是 Penpot 侧的"正确姿势"：`createVariantFromComponents(boards)` 产出 VariantContainer，
 * `Variants.addProperty() + renameProperty(0, name)` 定义属性轴，
 * 再用 `setVariantProperty(0, value)` 给每个变体打值。
 *
 * ⚠️ 属性值必须**按母版形状 id 配对**，不能依赖 `variantComponents()` 的顺序
 * （它按库内顺序返回，不保证等于传入顺序）—— 配错就会把 hover 的样式标成 disabled。
 */
export async function createVariants(deps: ComponentDeps,
  nodes: readonly HostNode[],
  propertyName: string,
  values: readonly string[],
  options: CreateVariantsOptions = {},
): Promise<CreateVariantsResult> {
  // SAFETY: typings 把 createVariantFromComponents 声明为必填；按可缺失探测以兼容旧版宿主，缺失时返回 ok:false 说明原因。
  const createVariantFromComponents = (penpot as unknown as {
    createVariantFromComponents?: (shapes: PenpotBoard[]) => PenpotShape
  }).createVariantFromComponents
  if (typeof createVariantFromComponents !== 'function') {
    return { ok: false, reason: '宿主未提供 penpot.createVariantFromComponents（需要 Penpot 支持组件变体）' }
  }
  if (nodes.length < 2) {
    return { ok: false, reason: '变体集至少需要 2 个节点' }
  }

  const boards = nodes.map((node) => deps.requireShape(node, 'createVariants'))
  const notBoard = boards.find((board) => board.type !== 'board')
  if (notBoard) {
    return {
      ok: false,
      reason: `createVariantFromComponents 只接受 board（${notBoard.type} 不是 board）—— 请先把每个状态放进一个 frame`,
    }
  }

  const container = createVariantFromComponents.call(penpot, boards as PenpotBoard[])
  const note: string[] = []

  // 容器改名：VariantContainer 是 board 子类型，照理 `name` 可写 —— 但**回读校验**，
  // 不生效就如实说明期望值与实际值（不谎报）。
  let containerName: string | undefined
  if (options.containerName !== undefined) {
    const wanted = options.containerName
    try {
      ;/* SAFETY: VariantContainer 是 board 子类型、运行时 name 可写；createVariantFromComponents 的返回被本处断言成 PenpotShape，故按可写 name 探测并回读校验。 */ (container as unknown as { name?: string }).name = wanted
    } catch (error) {
      note.push(`容器改名为 ${wanted} 失败：${(error as Error).message}`)
    }
    try {
      // SAFETY: 回读容器改名结果；name 可能是字符串也可能读不到（版本差异），按 unknown 承接后再做 typeof 判定。
      const actual = (container as unknown as { name?: unknown }).name
      containerName = typeof actual === 'string' ? actual : undefined
    } catch {
      containerName = undefined
    }
    if (containerName !== wanted) {
      note.push(`容器改名期望 ${wanted}，实际 ${containerName ?? '<读不到 name>'}（变体集已创建，可在 Penpot 里手动改）`)
    }
  }

  // SAFETY: variants 句柄只在 VariantContainer 上声明；容器返回类型被断言成 PenpotShape，故按可缺失的 PenpotVariants 探测。
  const variants = (container as unknown as { variants?: PenpotVariants | null }).variants
  if (!variants) {
    return {
      ok: false,
      containerId: container?.id,
      ...(containerName !== undefined ? { containerName } : {}),
      reason: '变体容器创建后没有 variants 句柄',
      ...(note.length ? { note: note.join('；') } : {}),
    }
  }

  // 归一成显式轴表：显式 `axes` 优先，否则用单轴 `propertyName`/`values`（向后兼容）。
  const axes: readonly VariantAxis[] =
    options.axes && options.axes.length ? options.axes : [{ name: propertyName, values }]

  // 真机实测（Penpot）：`createVariantFromComponents` **已经自动带一个属性**（默认名 "Property 1"）。
  // 所以第 0 轴只 **rename** 复用它，额外轴才 addProperty —— 否则每调一次 addProperty
  // 就多一个幽灵属性（单轴会变成 [State, Property 2]，双轴 [Variant, State, Property 3]）。
  const existingPropertyCount = (() => {
    try {
      // SAFETY: `properties` 在 typings 里是 string[]；旧版宿主可能不可读，按 unknown 承接。
      const raw = (variants as unknown as { properties?: unknown }).properties
      return Array.isArray(raw) ? raw.length : 0
    } catch {
      return 0
    }
  })()
  try {
    axes.forEach((axis, i) => {
      if (i >= existingPropertyCount) variants.addProperty()
      variants.renameProperty(i, axis.name)
    })
  } catch (error) {
    note.push(`属性轴设置失败（变体集已创建）：${(error as Error).message}`)
  }

  const componentIds: string[] = []
  const variantValues: Record<string, Record<string, string>> = {}
  for (const component of variants.variantComponents()) {
    componentIds.push(component.id)
    const mainId = (() => {
      try {
        return component.mainInstance()?.id
      } catch {
        return undefined
      }
    })()
    const index = boards.findIndex((board) => board.id === mainId)
    if (index < 0 || axes.some((axis) => axis.values[index] === undefined)) {
      note.push(`变体 ${component.name} 未能配对到输入节点（属性值留空，可在 Penpot 里补）`)
      continue
    }
    const applied: Record<string, string> = {}
    axes.forEach((axis, i) => {
      try {
        component.setVariantProperty(i, axis.values[index])
        applied[axis.name] = axis.values[index]
      } catch (error) {
        note.push(`变体 ${component.name} 设置 ${axis.name}=${axis.values[index]} 失败：${(error as Error).message}`)
      }
    })
    variantValues[component.id] = applied
  }

  // 回读：`Variants.properties` 是宿主实际生成的轴名列表 —— 这是多轴是否真的生效的真机证据。
  const readBackProperties = (() => {
    try {
      // SAFETY: `properties` 在 typings 里是 string[]；宿主真实实现可能不允读取，故按 unknown 承接后校验。
      const raw = (variants as unknown as { properties?: unknown }).properties
      return Array.isArray(raw) ? raw.map((entry) => String(entry)) : undefined
    } catch {
      return undefined
    }
  })()

  return {
    ok: true,
    // SAFETY: VariantContainer 一定有 id（ShapeBase 声明），但返回类型被断言成 PenpotShape 后取 id 需窄化；此处只读。
    containerId: (container as unknown as { id: string }).id,
    componentIds,
    ...(readBackProperties ? { properties: readBackProperties } : {}),
    ...(Object.keys(variantValues).length ? { variantValues } : {}),
    ...(containerName !== undefined ? { containerName } : {}),
    ...(note.length ? { note: note.join('；') } : {}),
  }
}
