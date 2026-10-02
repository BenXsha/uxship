/**
 * 变体组解析 —— 服务端**纯函数**层
 *
 * ## 为什么解析必须放在服务端
 *
 * 「按名建库 + 合成原生变体集」两个宿主都能做，但范式完全不同：
 *   - MasterGo：`mg.combineAsVariants(COMPONENT[])`，属性名与取值**只能靠成员名 `Prop=Value` 喂进去**；
 *   - Penpot：`penpot.createVariantFromComponents(Board[])`，必须**显式** `addProperty()` →
 *     `renameProperty()` → 逐变体 `setVariantProperty()`，且要按 `mainInstance().id` 配对。
 *
 * 把 `<类型>[_轴值…]` → 显式属性表的解析写进插件，就要在两个宿主各写一遍（必然漂移）。
 * 所以名字解析留在服务端这一个纯函数里，插件只接收**显式属性表**（`variantGroups`）去执行。
 *
 * ## 命名契约（R6，已弃 `DS_` 前缀）
 *
 * `接口：<Type>_<轴值…>`，如 `Button_Primary_Default`：
 *   - **首段 = 组件类型**，同时作为变体集容器名（`setId`）——类型留在名字里，便于后续语义查找；
 *   - **第 2 段起拼接 = 轴值**（`_` 是段分隔符）；
 *   - **不带 `DS_` 前缀**：全库范围由调用方的 `containerId` 界定（见 `node_convert_to_component`），
 *     前缀既冗余又会经 `setId` 污染容器名。
 *
 * 本模块：不碰网络、不改入参、不读全局状态 —— 可以逐条单测。
 */

/** 参与分组的节点（只有 id 与图层名，插件 `listOnly` 的 `matched[]` 形状） */
export interface VariantGroupMember {
  nodeId: string
  name: string
}

/** 一个显式变体组：`setId` 对应变体集容器名，`members` 是「成员 → 轴值」的显式映射 */
export interface VariantGroup {
  setId: string
  /** = `properties[0]`（单轴向后兼容字段） */
  propertyName: string
  /** 轴名（多轴时提供；单轴时不发，保持旧线形状不变） */
  properties?: string[]
  members: Array<{ nodeId: string; value: string; values?: string[] }>
}

export interface GroupPlan {
  /** 可合成的组（成员 ≥ 2），按 setId 首次出现顺序 */
  groups: VariantGroup[]
  /** 成员不足 2 个的组：不合成，但在报告里必须出现 */
  singles: VariantGroupMember[]
  /** 服务端侧的解析说明（跳过原因 / 单成员 / 重复轴值），交给编排层加来源前缀 */
  notes: string[]
}

/** 轴名默认值（两个宿主一致；Penpot 侧显式 addProperty 时的名字） */
export const DEFAULT_VARIANT_PROPERTY_NAME = 'State'

const MISSING_TYPE_NOTE = (name: string) => `跳过 "${name}"：缺少组件类型（应为 <类型>_<轴值>，如 Button_Primary）`
const MISSING_VALUE_NOTE = (name: string) =>
  `跳过 "${name}"：只有组件类型、没有轴值（应为 <类型>_<轴值>，如 Button_Default）`
const AXIS_ARITY_NOTE = (name: string, axes: string[], actual: number) =>
  `跳过 "${name}"：轴值段数 ${actual} 与轴数 ${axes.length}（${axes.join(', ')}）不匹配`

/**
 * 把「作用域内的一组节点」解析成显式变体组。
 *
 * 规则（逐字，不引入词表）：
 * 1. 名字按 `_` 切段；首段为空 → 只进 notes
 * 2. 首段 = 组件类型 = `setId`（`Button_Primary` → `Button`）
 * 3. 轴值取第 2 段起：**单轴**（默认）拼成一根值（`Button_Primary_Hover` → `Primary_Hover`）；
 *    **多轴**（`axes` 长度 >1）则逐段对应各轴（`Button_Primary_Hover` + `[Variant,State]` → `[Primary,Hover]`）
 * 4. 只有一段（`Button`）→ 只进 notes（那是变体集容器本身，不是成员）
 * 5. 组内成员 < 2 → 不进 `groups`，进 `singles` 并在 notes 说明
 * 6. 轴名：单轴默认 `State`（可被 `propertyName` 覆盖）；多轴由 `axes` 显式给出
 * 7. 顺序稳定：groups 按 setId 首次出现顺序，组内成员按输入顺序
 * 8. 同一 setId 内出现重复轴值组合 → **保留全部成员**，但 notes 明确告警（不静默去重）
 *
 * 不校验 `DS_` 前缀：范围由调用方（`containerId`）保证，本函数只做结构解析。
 */
export function planVariantGroups(
  nodes: Array<{ nodeId: string; name: string }>,
  options: { propertyName?: string; axes?: string[] } = {},
): GroupPlan {
  // 轴表：显式 `axes`（多轴）优先；否则单轴 `propertyName`（默认 State）
  const explicitAxes = Array.isArray(options?.axes)
    ? options.axes.map((axis) => String(axis ?? '').trim()).filter((axis) => axis.length > 0)
    : []
  const axes =
    explicitAxes.length > 0
      ? explicitAxes
      : [
          typeof options?.propertyName === 'string' && options.propertyName.trim()
            ? options.propertyName.trim()
            : DEFAULT_VARIANT_PROPERTY_NAME,
        ]
  const multiAxis = axes.length > 1
  const propertyName = axes[0]

  const notes: string[] = []
  /** setId 首次出现顺序（规则 7） */
  const order: string[] = []
  /** setId → 成员（保留原始 name 以便 singles 回传） */
  const bySet = new Map<string, Array<VariantGroupMember & { value: string; values: string[] }>>()
  /** 已告警过的 `setId\0value`，避免重复刷屏 */
  const duplicateNoted = new Set<string>()

  for (const node of Array.isArray(nodes) ? nodes : []) {
    const name = typeof node?.name === 'string' ? node.name : ''
    const segments = name.split('_')

    const type = segments[0] ?? ''
    if (type === '') {
      notes.push(MISSING_TYPE_NOTE(name))
      continue
    }
    if (segments.length < 2 || segments.slice(1).join('') === '') {
      // 规则 4：只有类型没有轴值 —— 那是容器/组框本身，不是成员
      notes.push(MISSING_VALUE_NOTE(name))
      continue
    }

    const axisSegments = segments.slice(1)
    // 多轴：段数必须与轴数一致；单轴：整段拼接（兼容旧行为）
    if (multiAxis && axisSegments.length !== axes.length) {
      notes.push(AXIS_ARITY_NOTE(name, axes, axisSegments.length))
      continue
    }
    const values = multiAxis ? axisSegments : [axisSegments.join('_')]

    const setId = type
    const value = values[0]
    const duplicateKey = `${setId}\u0000${values.join('\u0000')}`

    if (!bySet.has(setId)) {
      bySet.set(setId, [])
      order.push(setId)
    }
    const members = bySet.get(setId)!
    if (members.some((member) => member.values.join('\u0000') === values.join('\u0000'))) {
      if (!duplicateNoted.has(duplicateKey)) {
        duplicateNoted.add(duplicateKey)
        notes.push(`"${setId}" 内出现重复轴值 "${values.join(' / ')}"，宿主侧可能出现歧义`)
      }
    }
    members.push({ nodeId: String(node.nodeId), name, value, values })
  }

  const groups: VariantGroup[] = []
  const singles: VariantGroupMember[] = []

  for (const setId of order) {
    const members = bySet.get(setId)!
    if (members.length < 2) {
      // 规则 5：不合成变体集，但不能静默 —— 名字不符合「一组 ≥2 个」的约定，AI 需要知道
      singles.push({ nodeId: members[0].nodeId, name: members[0].name })
      notes.push(`"${setId}" 只有 1 个成员，不合成变体集（已记入 singles，未参与转换）`)
      continue
    }
    groups.push({
      setId,
      propertyName,
      // 多轴才发 properties/values（单轴线形状保持不变）
      ...(multiAxis ? { properties: axes } : {}),
      members: members.map((member) => ({
        nodeId: member.nodeId,
        value: member.value,
        ...(multiAxis ? { values: member.values } : {}),
      })),
    })
  }

  return { groups, singles, notes }
}
