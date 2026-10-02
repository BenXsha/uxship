/**
 * 单边描边的**模拟子系统**（Penpot 插件 API 没有 per-side 描边）
 *
 * 从 `penpot.ts` 拆出（内聚单元：规格读写 + 叠加 Path 的建 / 删 / 落位校验）。
 * Penpot 的表达方式是「叠加一条 Path，并把规格记在**源形状的 pluginData** 上」——
 * 规格读写与这条形状管线是同一件事的两半，分居两个文件会让人以为可以各改各的。
 *
 * 依赖方向单向：`PenpotHost` → 本模块。宿主原语（插入 / 查节点 / 等布局 / 抹默认涂色 /
 * pluginData）通过 `SideBorderDeps` 传入，模块内**不反向摸 `PenpotHost`**。
 *
 * 本文件属于 Penpot 宿主适配层（见 README「约定（续）」R1'），因此可以直接调
 * `penpot.createPath()` 这类**无状态宿主原语**；状态型助手一律走 deps。
 */
import { buildSidesPath, describeSides } from './border-sides'
import { containerChildren, flexOf } from './penpot-runtime'
import type { SideBorderSpec } from './penpot-paint'

/**
 * 单边描边叠加节点的 id 记录（存在**源形状的 pluginData** 上）。
 * 用途：重渲染/重应用时先删旧的再建新的，避免每渲染一次就叠一层边框。
 */
/**
 * 说明：`mgmcp:` 前缀是项目旧名的遗留，**刻意保留不改**。
 *
 * 这些键会通过 `setPluginData` **持久化进用户文档**；改名会让既有的 Penpot 文档
 * 丢失单边描边往返能力（重渲染后四边框变回普通描边）。本次迁移只改了用户可见的展示名
 * （`mgmcp` → `uxship`），内部持久化键保持稳定。
 */
export const SIDE_BORDER_DATA_KEY = 'mgmcp:sideBorders'

/** 单边描边**规格**的 pluginData 键（与叠加层 id 分开存：规格可能暂时无对应节点） */
export const SIDE_BORDER_SPECS_KEY = 'mgmcp:sideBorderSpecs'

/**
 * 真实宿主里能承载子节点的类型（frame=board / group / bool / svg-raw）。
 * 见 plugins/shape.cljs 的 `not-valid :insertChild (:type shape)` 判定。
 */
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['board', 'group', 'boolean', 'svg-raw'])

/**
 * 本模块需要的**宿主状态型原语**（薄包装，全部来自 `PenpotHost`）。
 * 无状态原语（`penpot.createPath()`、`flexOf`、`containerChildren`）直接用，不进 deps。
 */
export interface SideBorderDeps {
  /** 统一的插入入口（`PenpotHost.insertChild` —— 索引语义随 naturalChildOrdering 变） */
  insertChild(container: PenpotContainerShape, child: PenpotShape, index?: number): void
  /** 按 id 在当前页查形状（`PenpotHost.getNodeById` —— Penpot 只能查当前页） */
  findShapeById(id: string): PenpotShape | null
  /** 等宿主布局结算（Path 的 `d` 是页面绝对坐标，读 shape.x/y 前必须等） */
  waitForLayoutUpdate(): Promise<void>
  /** 抹掉宿主给新建图形注入的默认涂色（Path 自带「黑 1px 居中描边」） */
  resetDefaultPaint(shape: PenpotShape): void
  readPluginData(shape: PenpotShape, key: string): string | undefined
  writePluginData(shape: PenpotShape, key: string, value: string): void
}

/**
 * 用叠加 Path 模拟单边描边。
 *
 * 落地策略（两条路，取决于源形状是不是容器）：
 *   - **容器**（board/group/bool）→ 叠加层作为它的子节点；flex 容器下需 absolute，
 *     否则会被布局引擎当成一个 flex item 挪走；
 *   - **叶子**（矩形/文本/路径…，Penpot 不允许它们有子节点）→ 叠加层作为**同级节点**
 *     插在源形状之后，按 `resolveBorderContainer` 决定用绝对还是父级相对坐标。
 *
 * 幂等：叠加层 id 记在源形状的 pluginData 上，重应用时先删旧的再建新的。
 */
export async function applySideBorders(
  deps: SideBorderDeps,
  shape: PenpotShape,
): Promise<{ applied: boolean; skipped: string[] }> {
  const skipped: string[] = []
  const specs = readSideBorderSpecs(deps, shape)
  if (!specs.length) {
    // 规格被清空（例如改为四边描边）→ 只清理旧的叠加层
    removeSideBorderOverlays(deps, shape)
    return { applied: false, skipped }
  }

  // 先清理上一次的叠加层（否则每次渲染都会叠一层边框）
  removeSideBorderOverlays(deps, shape)

  const width = shape.width
  const height = shape.height
  if (!(width > 0) || !(height > 0)) {
    skipped.push('单边描边模拟需要已知宽高（当前为 0）')
    return { applied: false, skipped }
  }

  const container = resolveBorderContainer(shape, skipped)
  if (!container) return { applied: false, skipped }

  const isChildOfShape = container.host === shape
  const parent = shape.parent

  // ⚠️ **先等布局结算再读位置**。真实踩到的坑：祖先的 flex/auto-layout 还没跑完，
  // `shape.x/y` 读到的是陈旧值，于是边框被画到 (499,2.5) 而不是 (20,318) —— 整体偏移。
  // Path 的 `d` 是**页面绝对坐标**，所以必须用结算后的父层位置来换算。
  await deps.waitForLayoutUpdate()

  const shapeIsFlex = Boolean(flexOf(shape))
  const parentIsFlex = Boolean(parent && flexOf(parent))

  // 叠加层自己的父层（容器时是 shape 自己，叶子时是 shape 的父层）的**结算后绝对位置**
  const overlayParent = isChildOfShape ? shape : (parent as PenpotShape)
  const overlayParentAbs = { x: overlayParent.x, y: overlayParent.y }
  // 叠加层在父层内的相对偏移：容器内贴左上角（0,0）；作为同级则与源形状同位
  const localOffset = isChildOfShape
    ? { x: 0, y: 0 }
    : { x: shape.parentX, y: shape.parentY }

  const placement = {
    offsetX: overlayParentAbs.x + localOffset.x,
    offsetY: overlayParentAbs.y + localOffset.y,
    // 父层有布局时，叠加层必须 absolute 才能不被当成布局元素挪走
    absolute: isChildOfShape ? shapeIsFlex : parentIsFlex,
  }

  // 同组（同色同宽同虚线）的边合成**一条 Path 的多个子路径** → 一个节点搞定
  const groups = new Map<string, SideBorderSpec[]>()
  for (const spec of specs) {
    const bucket = groups.get(spec.groupKey) ?? []
    bucket.push(spec)
    groups.set(spec.groupKey, bucket)
  }

  const createdIds: string[] = []
  let appliedAny = false

  for (const bucket of groups.values()) {
    const sides = [...new Set(bucket.flatMap((spec) => spec.sides))]
    const first = bucket[0]
    const d = buildSidesPath(sides, width, height, first.width, placement.offsetX, placement.offsetY)

    let path: PenpotShape
    try {
      const node = penpot.createPath()
      deps.resetDefaultPaint(node)
      path = node
      ;/* SAFETY: 叠加层 path 由 penpot.createPath() 创建，运行时就是 PenpotPath；只是变量声明为 PenpotShape，写 d 前需窄化。 */ (path as unknown as PenpotPath).d = d
    } catch (error) {
      skipped.push(`单边描边模拟失败（创建路径）: ${(error as Error).message}`)
      continue
    }

    // 描边：与整圈描边同一套映射（颜色/渐变/宽度/虚线），中心对齐 + 已内缩半宽
    const stroke: PenpotStroke = {
      strokeWidth: first.width,
      strokeStyle: first.dashPattern?.length ? 'dashed' : 'solid',
      strokeAlignment: 'center',
    }
    if (first.gradient) stroke.strokeColorGradient = first.gradient
    else if (first.color) {
      stroke.strokeColor = first.color.hex
      stroke.strokeOpacity = first.color.opacity
    }
    path.strokes = [stroke]
    path.fills = []
    path.name = describeSides(sides)

    try {
      if (isChildOfShape) {
        deps.insertChild(container.container, path, undefined)
      } else {
        const index = (shape.parentIndex ?? 0) + 1
        deps.insertChild(container.container, path, index)
      }
      // flex 父层：必须 absolute，否则会被布局引擎当成 flex item 挪走
      if (placement.absolute) {
        if (path.layoutChild) {
          path.layoutChild.absolute = true
        } else {
          // 拿不到 layoutChild 就无法脱离布局流 → 边框会被挪走。
          // 不静默：如实报出来，让人知道这条边框位置不可信。
          skipped.push('单边描边叠加层无法标为 absolute（宿主未给出 layoutChild），位置可能被布局挪动')
        }
      }
    } catch (error) {
      skipped.push(`单边描边模拟失败（插入节点）: ${(error as Error).message}`)
      path.remove?.()
      continue
    }

    // 回读校验：等布局结算后，断言**叠加层落在目标盒子里**。
    //
    // 为什么不是「比对落点原点」：叠加层的 x/y 是它的**包围盒左上角**，
    // 对下边框来说天然比落点原点低一个盒高 —— 那样比会把正常情况误报成偏移。
    // 真正要守的不变量是「边框贴在盒子上，没跑偏」：
    await deps.waitForLayoutUpdate()
    const boxAbs = { x: shape.x, y: shape.y, width: shape.width, height: shape.height }
    const overlayBox = { x: path.x, y: path.y, width: path.width, height: path.height }
    const tolerance = 1
    const inside =
      overlayBox.x >= boxAbs.x - tolerance &&
      overlayBox.y >= boxAbs.y - tolerance &&
      overlayBox.x + overlayBox.width <= boxAbs.x + boxAbs.width + tolerance &&
      overlayBox.y + overlayBox.height <= boxAbs.y + boxAbs.height + tolerance
    if (!inside) {
      skipped.push(
        `单边描边叠加层超出目标盒子（盒子 ${Math.round(boxAbs.x)},${Math.round(boxAbs.y)} ` +
          `${Math.round(boxAbs.width)}×${Math.round(boxAbs.height)}；叠加层 ${Math.round(overlayBox.x)},${Math.round(overlayBox.y)} ` +
          `${Math.round(overlayBox.width)}×${Math.round(overlayBox.height)}）—— 坐标可能未随布局结算`,
      )
    }

    createdIds.push(path.id)
    appliedAny = true
  }

  if (createdIds.length) {
    deps.writePluginData(shape, SIDE_BORDER_DATA_KEY, JSON.stringify(createdIds))
  }

  return { applied: appliedAny, skipped }
}

/** 把单边描边规格写进 pluginData（供末尾统一落地 + 重渲染幂等） */
export function writeSideBorderSpecs(deps: SideBorderDeps, shape: PenpotShape, specs: SideBorderSpec[]): void {
  if (!specs.length) {
    deps.writePluginData(shape, SIDE_BORDER_SPECS_KEY, '')
    return
  }
  deps.writePluginData(shape, SIDE_BORDER_SPECS_KEY, JSON.stringify(specs))
}

/** 读回单边描边规格（坏了就当没有，下一次写入会覆盖） */
export function readSideBorderSpecs(deps: SideBorderDeps, shape: PenpotShape): SideBorderSpec[] {
  const raw = deps.readPluginData(shape, SIDE_BORDER_SPECS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as SideBorderSpec[]
    return Array.isArray(parsed) ? parsed.filter((spec) => Array.isArray(spec?.sides) && spec.sides.length) : []
  } catch {
    return []
  }
}

/** 删掉上一次的叠加层（读 pluginData 记录） */
export function removeSideBorderOverlays(deps: SideBorderDeps, shape: PenpotShape): void {
  const raw = deps.readPluginData(shape, SIDE_BORDER_DATA_KEY)
  if (!raw) return
  try {
    const ids = JSON.parse(raw) as string[]
    for (const id of Array.isArray(ids) ? ids : []) {
      const node = deps.findShapeById(id)
      node?.remove?.()
    }
  } catch {
    /* 记录坏了就忽略；下一次写会覆盖 */
  }
  deps.writePluginData(shape, SIDE_BORDER_DATA_KEY, '')
}

/**
 * 叠加层挂哪里：容器挂自己，叶子挂同级。
 *
 * ⚠️ 判定必须**按类型**，不能按「有没有 insertChild 方法」：
 * 真实宿主里 Rectangle/Text 等也会代理出 insertChild，但调用会抛
 * `not-valid :insertChild (:type shape)`（plugins/shape.cljs）。
 * 按方法存在性判定会把叶子误当容器 → 叠加层挂到矩形下面（实际不可能）。
 */
function resolveBorderContainer(
  shape: PenpotShape,
  skipped: string[],
): { host: PenpotShape; container: PenpotContainerShape } | null {
  if (CONTAINER_TYPES.has(shape.type) && containerChildren(shape)) {
    // SAFETY: 上一行已确认 shape.type 在 CONTAINER_TYPES 内且 children 是数组，这里把已核实的容器交给 TS。
    return { host: shape, container: shape as unknown as PenpotContainerShape }
  }

  const parent = shape.parent
  if (!parent) {
    skipped.push('单边描边模拟失败：节点无父层（页面根下无法插入同级节点）')
    return null
  }
  // SAFETY: parent 是 PenpotShape（可能不是容器）；按 Partial 探测 insertChild/children，两者齐全才作为叠加层落点。
  const parentContainer = parent as unknown as Partial<PenpotContainerShape>
  if (typeof parentContainer.insertChild !== 'function' || !Array.isArray(parentContainer.children)) {
    skipped.push(`单边描边模拟失败：父层 ${parent.id}(${parent.type}) 不是容器`)
    return null
  }
  // SAFETY: 上一处 typeof insertChild + Array.isArray(children) 已确认 parent 是运行时容器。
  return { host: parent, container: parent as unknown as PenpotContainerShape }
}
