import { serializeNode } from './serializer'

import { applyNodeProperties, createNodeByType } from '../utils/node-utils'

/** 将 Uint8Array 编码为 base64 字符串（兼容无 btoa 的沙盒环境） */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    chunks.push(String.fromCharCode(...slice))
  }
  // 尝试使用 btoa（如果可用），否则手动编码
  if (typeof btoa === 'function') {
    return btoa(chunks.join(''))
  }
  // 手动 base64 编码
  const binary = chunks.join('')
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let result = ''
  for (let i = 0; i < binary.length; i += 3) {
    const b1 = binary.charCodeAt(i)
    const b2 = binary.charCodeAt(i + 1)
    const b3 = binary.charCodeAt(i + 2)
    result += chars[(b1 >> 2) & 0x3F]
    result += chars[((b1 << 4) | (b2 >> 4)) & 0x3F]
    result += i + 1 < binary.length ? chars[((b2 << 2) | (b3 >> 6)) & 0x3F] : '='
    result += i + 2 < binary.length ? chars[b3 & 0x3F] : '='
  }
  return result
}

/** 属性应用告警（如未知效果类型被透传）非空时并入响应；空时不加字段，保持旧响应形状 */
function withWarnings(result: any, warnings: string[]): any {
  if (warnings.length === 0) return result
  // 去重：插入父层后二次应用几何属性会再次经过 applyNodeProperties，同一条告警不必报两遍
  return { ...result, warnings: Array.from(new Set(warnings)) }
}

/**
 * 插入父层后需要二次应用的几何类属性。
 *
 * 宿主的 `appendChild()` 会按父层（尤其是自动布局）重算子节点几何，把节点插进去之后再写
 * `x/y/width/height` 才可能生效；此前在 `appendChild()` **之前**写，导致 instance 落到 y≈-5000、
 * frame 落 (0,0)。二次应用的模式与 DSL 渲染路径的 `layout-applier.applyFrameLayoutProps()`
 * （注释即「用于节点加入文档后的二次设置」）保持一致。
 */
const GEOMETRY_REAPPLY_KEYS = [
  'x', 'y', 'width', 'height',
  'layoutSizingHorizontal', 'layoutSizingVertical',
  'layoutPositioning', 'constraints', 'rotation',
] as const

/** 从用户原始属性里挑出「实际传了的」几何字段，交给 applyNodeProperties 二次应用 */
function pickGeometryProps(properties?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!properties) return undefined
  const picked: Record<string, unknown> = {}
  for (const key of GEOMETRY_REAPPLY_KEYS) {
    if (properties[key] !== undefined) picked[key] = properties[key]
  }
  return Object.keys(picked).length > 0 ? picked : undefined
}

/**
 * GROUP 护栏命中判定用的几何键。
 *
 * 宿主里 GROUP 是「松散集合」：它的 x/y/width/height 由子层**并集**推导，并且会反过来
 * 对子层做等比缩放。因此对 GROUP 子层写几何、或往 GROUP 里塞新节点，都会推动宿主做
 * 组级重算（实测：组边界 80×14 → 6135×1472；16×16 图标被拉成 18.63×18）。
 * 这属于宿主既有行为，插件**不阻断**，但必须如实告警（走响应 warnings 通道）。
 */
const GROUP_GEOMETRY_KEYS = ['x', 'y', 'width', 'height', 'rotation'] as const

/** GROUP 内新建节点的告警文案 */
const GROUP_CREATE_WARNING =
  '在 GROUP 内新建节点会触发组级坐标重算（组边界会被炸开）——建议建在父 Frame 里；若已执行请 node_get 父层核对尺寸'

/** GROUP 子层改几何的告警文案 */
const GROUP_UPDATE_WARNING =
  'GROUP 子层改几何会触发组级等比缩放（图标/文字会被拉伸）——建议先用 code_to_design 重建或让用户在 UI 里解组/转 Frame'

/**
 * GROUP 护栏：命中「在 GROUP 内建节点」或「改 GROUP 直接子层几何」时，把中文告警 push 进
 * `warnings`（由 `withWarnings` 并入响应）。
 *
 * - `action: 'create'`：`node` 为刚建好的节点，直接看它的 `parent.type`；
 * - `action: 'update'`：只有当 `properties` 里确实包含 `x/y/width/height/rotation` 才告警
 *   （改 fills/文字等非几何属性不会触发组级缩放，避免误报）。
 *
 * 只告警、不阻断：这是宿主行为不是参数错误，抛错会让「明知要整组重排」的调用方无路可走。
 */
function groupHazardWarning(
  node: any,
  action: 'create' | 'update',
  warnings: string[],
  properties?: Record<string, unknown>,
): void {
  const parent = node?.parent
  if (parent?.type !== 'GROUP') return

  if (action === 'update') {
    const keys = properties ? Object.keys(properties) : []
    const touchesGeometry = keys.some((key) => (GROUP_GEOMETRY_KEYS as readonly string[]).includes(key))
    if (!touchesGeometry) return
    warnings.push(GROUP_UPDATE_WARNING)
    return
  }

  warnings.push(GROUP_CREATE_WARNING)
}

/** 复制节点的布局/样式属性到目标节点 */
function copyNodeProperties(source: any, target: any): void {
  const layoutProps = ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'cornerRadius']
  for (const prop of layoutProps) {
    if (prop in source) {
      try { (target as any)[prop] = (source as any)[prop] } catch (err) { console.error('[NodeHandlers] 复制布局属性失败（宿主可能不支持该属性，已跳过）:', prop, err) }
    }
  }

  const geometryProps = ['fills', 'strokes', 'strokeWeight', 'strokeAlign', 'strokeCap', 'strokeJoin']
  for (const prop of geometryProps) {
    if (prop in source) {
      try { (target as any)[prop] = (source as any)[prop] } catch (err) { console.error('[NodeHandlers] 复制几何/描边属性失败（宿主可能不支持该属性，已跳过）:', prop, err) }
    }
  }

  const autoLayoutProps = [
    'flexMode', 'itemSpacing',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'mainAxisAlignItems', 'crossAxisAlignItems',
    'mainAxisSizingMode', 'crossAxisSizingMode',
    'clipsContent',
  ]
  for (const prop of autoLayoutProps) {
    if (prop in source) {
      try { (target as any)[prop] = (source as any)[prop] } catch (err) { console.error('[NodeHandlers] 复制自动布局属性失败（宿主可能不支持该属性，已跳过）:', prop, err) }
    }
  }

  if (source.type === 'PEN' || source.type === 'VECTOR') {
    if (source.penPaths) {
      try {
        if (typeof source.penPaths.data === 'string') {
          target.setPenPaths([{ windingRule: source.penPaths.windingRule || 'Nonzero', data: source.penPaths.data }])
        } else {
          target.penPaths = source.penPaths
        }
      } catch (err) {
        // 非致命：老版本宿主没有 penPaths，属预期内的兼容降级
        console.error('[NodeHandlers] 复制 penPaths 失败（宿主可能不支持，已跳过）:', err)
      }
    }
  }
}

/**
 * 把单个节点原位转成组件母版（三种形态共用的内核）。
 *
 * 调用前须自行确认节点存在且**不是** COMPONENT —— 幂等跳过由调用方记入 `skipped`：
 * 批量 / 按名前缀建库时「已是组件」不该让整批失败（旧实现直接抛 `already a component`）。
 */
function convertNodeToComponentMaster(node: any, name?: string, keepOriginal = false): any {
  const parent = node.parent
  const savedX = 'x' in node ? (node as any).x : undefined
  const savedY = 'y' in node ? (node as any).y : undefined
  const savedWidth = 'width' in node ? (node as any).width : undefined
  const savedHeight = 'height' in node ? (node as any).height : undefined

  const component = mg.createComponent()
  // 母版名：显式 name 优先（建「有名字的组件库」），否则沿用原节点名
  component.name = typeof name === 'string' && name ? name : node.name

  // Copy all visual properties
  copyNodeProperties(node, component)

  // Move children from original node to component
  if ('children' in node && Array.isArray(node.children) && node.children.length > 0) {
    const children: any[] = Array.from(node.children as any[])
    for (const child of children) {
      try { component.appendChild(child) } catch (err) { console.error('[NodeHandlers] 迁移子节点失败（跳过该子节点）:', err) }
    }
  }

  // Add component to parent at original position
  if (parent && 'appendChild' in parent) {
    parent.appendChild(component)
  } else {
    mg.document.currentPage.appendChild(component)
  }

  // Restore position (appendChild may reset it)
  if (savedX !== undefined) { try { (component as any).x = savedX } catch (err) { console.error('[NodeHandlers] 还原 x 失败（宿主不支持写入，已跳过）:', err) } }
  if (savedY !== undefined) { try { (component as any).y = savedY } catch (err) { console.error('[NodeHandlers] 还原 y 失败（宿主不支持写入，已跳过）:', err) } }
  if (savedWidth !== undefined) { try { (component as any).width = savedWidth } catch (err) { console.error('[NodeHandlers] 还原 width 失败（宿主不支持写入，已跳过）:', err) } }
  if (savedHeight !== undefined) { try { (component as any).height = savedHeight } catch (err) { console.error('[NodeHandlers] 还原 height 失败（宿主不支持写入，已跳过）:', err) } }

  // Remove or keep the original node（keepOriginal 语义与旧实现完全一致）
  if (!keepOriginal) {
    node.remove()
  }

  mg.commitUndo()

  const action = keepOriginal ? '已复制为组件' : '已转换为组件'
  mg.notify(`${action}: ${component.name}`, { type: 'normal' })
  return component
}

/** 形态 A（单个）：响应与旧版逐字段兼容，另补 `componentId` */
function convertSingleToComponent(nodeId: string, name: string | undefined, keepOriginal: boolean): any {
  const node = mg.getNodeById(nodeId)
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`)
  }
  // 幂等：已是组件不再抛错，如实回报后由调用方决定下一步
  if (node.type === 'COMPONENT') {
    return {
      success: true,
      converted: false,
      componentId: null,
      skipped: [{ nodeId, name: node.name, reason: 'already-component' }],
      note: `节点 "${node.name}" 已是组件，已跳过（幂等）`,
    }
  }
  const component = convertNodeToComponentMaster(node, name, keepOriginal)
  // 母版是新建节点、id 与传入的 nodeId **不同**：必须显式回传 componentId，
  // 否则调用方只拿到裸节点快照就再也定位不到这个 Master（旧版漏传，用户被迫翻 UI）。
  return { ...serializeNode(component), componentId: component.id }
}

/** 形态 B / C（多节点）：逐个转，单节点失败不中断整批，降级全部记入 `skipped` */
function convertEachToComponent(
  ids: string[],
  name: string | undefined,
  keepOriginal: boolean,
  note?: string,
): any {
  const components: any[] = []
  const skipped: any[] = []

  for (const id of ids) {
    const node = mg.getNodeById(id)
    if (!node) {
      skipped.push({ nodeId: id, reason: 'not-found', message: `Node not found: ${id}` })
      continue
    }
    if (node.type === 'COMPONENT') {
      skipped.push({ nodeId: id, name: node.name, reason: 'already-component', message: `"${node.name}" 已是组件，已跳过` })
      continue
    }
    try {
      const component = convertNodeToComponentMaster(node, name, keepOriginal)
      components.push({ nodeId: id, componentId: component.id, name: component.name })
    } catch (err: any) {
      skipped.push({ nodeId: id, name: node.name, reason: 'convert-failed', message: err?.message || String(err) })
    }
  }

  return {
    success: components.length > 0,
    count: components.length,
    components,
    skipped,
    ...(note ? { notes: [note] } : {}),
  }
}

/**
 * `namePrefix` 形态的候选收集：当前页里名字以该前缀开头的节点，**只取最外层**
 * （祖先也匹配的节点丢弃 —— 先转父节点会让子节点 id 失效）。
 *
 * `listOnly` 形态复用同一套过滤逻辑，保证「列举看到的候选」与「真转换动的节点」完全一致。
 */
function collectOutermostByPrefix(namePrefix: string): any[] {
  const page = mg.document?.currentPage as any
  if (!page || typeof page.findAll !== 'function') {
    throw new Error('node/convertToComponent(namePrefix) 需要宿主提供 page.findAll')
  }
  const matched = (page.findAll(
    (node: any) => typeof node?.name === 'string' && node.name.startsWith(namePrefix),
  ) || []) as any[]
  const matchedSet = new Set(matched)
  return matched.filter((node: any) => {
    let parent = node?.parent
    while (parent) {
      if (matchedSet.has(parent)) return false
      parent = parent.parent
    }
    return true
  })
}

/** 变体集合成的最少成员数：宿主 `combineAsVariants` 至少要两个组件才能推导出属性轴 */
const MIN_VARIANT_MEMBERS = 2

/** 单个变体成员：`master` 与 `componentEntry` 指向同一份数据，改名后同步回读进 `components` */
interface VariantMemberPlan {
  nodeId: string
  value: string
  values: string[]
  master: any
  componentEntry: { nodeId: string; componentId: string; name: string }
}

interface VariantGroupPlan {
  setId: string
  propertyName: string
  properties: string[]
  members: VariantMemberPlan[]
  /** 尚未进入合成阶段就已判定失败的原因（members 为空） */
  preFailReason?: string
}

/**
 * 形态 E：按显式属性表把一组组件合成原生变体集（`variantGroups[]`）。
 *
 * MasterGo 的变体合成是**名驱动**的：`mg.combineAsVariants(COMPONENT[])` 从**成员名**里的
 * `Prop=Value` 推导属性轴（既有实现见 componentHandlers.ts 的 `compName = \`${propName}=${state}\``，
 * 注释写着 "Use MasterGo variant naming convention for manual Combine as Variants support"）。
 * 因此本形态必须把每个成员组件改名为 `${propertyName}=${value}` —— **成员自己的 `DS_*` 名会被覆盖**，
 * 但子层名不变（覆写链安全），这是设计上接受的取舍，如实写进 `notes`。
 *
 * 顺序：**先把所有 group 的成员都转成母版，再逐组合成**。
 * 单组失败（宿主无 `combineAsVariants` / 成员不足 / combine 抛错）只让该组 `ok:false`，
 * 不中断其它组、不抛错；宿主能力缺失时**不改名**（改名是破坏性的，合成不了就不该毁掉原名）。
 */
function convertToVariantSets(groups: any[], keepOriginal: boolean): any {
  const components: Array<{ nodeId: string; componentId: string; name: string }> = []
  const skipped: any[] = []
  const notes: string[] = []
  let reusedCount = 0

  // variantGroups 形态下 keepOriginal 不适用：成员必须**原位**转成母版。
  // 若保留原节点，母版就是副本，而「成员」指向副本 —— 调用方手里的 nodeId 与合成结果对不上。
  if (keepOriginal) {
    notes.push('variantGroups 形态下 keepOriginal 不适用（已按 false 处理）：成员必须原位转为母版，否则会留下原节点副本、成员指向副本，nodeId 与合成结果对不上')
  }

  // ── 阶段 1：先把所有 group 的成员都转成母版（复用既有内核，不另写一套转换） ──
  const plans: VariantGroupPlan[] = []
  groups.forEach((raw, groupIndex) => {
    const setId = typeof raw?.setId === 'string' && raw.setId ? raw.setId : `DS_VariantGroup_${groupIndex + 1}`
    // 轴名：properties[]（多轴）优先，否则 propertyName（单轴）—— 与服务端同一套生成基准
    const rawProperties = Array.isArray(raw?.properties) ? (raw.properties as unknown[]).map(String) : undefined
    const properties =
      rawProperties && rawProperties.length
        ? rawProperties
        : [typeof raw?.propertyName === 'string' && raw.propertyName ? raw.propertyName : 'State']
    const propertyName = properties[0]
    const rawMembers: any[] = Array.isArray(raw?.members) ? raw.members : []
    const members: VariantMemberPlan[] = []
    const preFailReason = rawMembers.length === 0
      ? `members 为空：变体集至少需要 ${MIN_VARIANT_MEMBERS} 个成员`
      : undefined

    rawMembers.forEach((rawMember, memberIndex) => {
      const memberNodeId = typeof rawMember?.nodeId === 'string' ? rawMember.nodeId : undefined
      const label = `variantGroups[${groupIndex}].members[${memberIndex}]`
      // 轴值：values[]（多轴）优先，否则 value（单轴）
      const rawValues = Array.isArray(rawMember?.values) ? (rawMember.values as unknown[]).map(String) : undefined
      const values =
        rawValues && rawValues.length
          ? rawValues
          : typeof rawMember?.value === 'string' && rawMember.value
            ? [rawMember.value]
            : undefined
      const value = values?.[0]
      if (!memberNodeId) {
        skipped.push({ reason: 'invalid-member', message: `${label} 缺少 nodeId（已跳过该成员）` })
        return
      }
      if (!values || value === undefined) {
        skipped.push({ nodeId: memberNodeId, reason: 'invalid-member', message: `${label} 缺少轴值（给 values[] 或 value，已跳过该成员）` })
        return
      }
      if (values.length !== properties.length) {
        skipped.push({
          nodeId: memberNodeId,
          reason: 'invalid-member',
          message: `${label} 轴值个数 ${values.length} 与轴数 ${properties.length}（${properties.join(', ')}）不一致（已跳过该成员）`,
        })
        return
      }

      const existing = mg.getNodeById(memberNodeId) as any
      if (!existing) {
        skipped.push({ nodeId: memberNodeId, reason: 'not-found', message: `Node not found: ${memberNodeId}` })
        return
      }

      let master = existing
      if (existing.type !== 'COMPONENT') {
        try {
          master = convertNodeToComponentMaster(existing)
        } catch (err: any) {
          skipped.push({ nodeId: memberNodeId, name: existing.name, reason: 'convert-failed', message: err?.message || String(err) })
          return
        }
      } else {
        // 已是 COMPONENT：直接复用（不重复转换、不报 success:false）
        reusedCount++
      }

      const componentEntry = { nodeId: memberNodeId, componentId: String(master.id), name: String(master.name ?? '') }
      components.push(componentEntry)
      members.push({ nodeId: memberNodeId, value, values, master, componentEntry })
    })

    plans.push({ setId, propertyName, properties, members, preFailReason })
  })

  // ── 阶段 2：逐组合成（单组失败不影响其它组） ──
  const variantSets: any[] = []
  plans.forEach((plan) => {
    const { setId, propertyName, properties } = plan
    const multiAxis = properties.length > 1

    if (plan.preFailReason) {
      variantSets.push({ setId, propertyName, memberCount: 0, ok: false, reason: plan.preFailReason })
      return
    }

    // 前置检查 1：成员数（宿主至少要两个组件才能推导属性轴）
    if (plan.members.length < MIN_VARIANT_MEMBERS) {
      variantSets.push({
        setId, propertyName, memberCount: plan.members.length, ok: false,
        reason: `成员不足 ${MIN_VARIANT_MEMBERS} 个（实际 ${plan.members.length} 个可用成员，无法推导属性轴）`,
      })
      return
    }

    // 前置检查 2：宿主能力（typings 有声明不等于私有化客户端运行时可用）
    // 放在改名之前：改名会覆盖成员原名，合成不了就不该做破坏性改动。
    const combineAsVariants = (mg as any).combineAsVariants
    if (typeof combineAsVariants !== 'function') {
      variantSets.push({
        setId, propertyName, memberCount: plan.members.length, ok: false,
        reason: `宿主未提供 combineAsVariants（${plan.members.length} 个成员已就绪但未改名，可手动选中后右键 Combine as Variants；plugin_capabilities 的 variants 块可复核）`,
      })
      return
    }

    // 改名：MasterGo 只从成员名推导属性轴（写法与 componentHandlers.ts 的 compName 一致）
    const renamedNodes: any[] = []
    const renamedValues: string[] = []
    let renameMismatch = 0
    plan.members.forEach((member) => {
      // 单轴：`Prop=Value`；多轴：MasterGo/Figma 约定 `Prop1=Value1, Prop2=Value2`
      const targetName = member.values.map((value, axisIndex) => `${properties[axisIndex]}=${value}`).join(', ')
      try {
        member.master.name = targetName
      } catch (err: any) {
        skipped.push({
          nodeId: member.nodeId, name: member.master.name, reason: 'rename-failed',
          message: `成员改名失败（宿主拒绝 "${targetName}"：${err?.message || err}，已排除出本次合成）`,
        })
        return
      }
      const actualName = String(member.master.name ?? '')
      if (actualName !== targetName) {
        // 宿主机灵改名会让属性轴推导出错，但组件仍可合成 —— 如实记 skipped，不阻断
        renameMismatch++
        skipped.push({
          nodeId: member.nodeId, reason: 'rename-rejected',
          message: `宿主把成员名 "${targetName}" 改成了 "${actualName}"（属性轴值可能推导错误）`,
        })
      }
      // 回读到的真实名字写进 components，便于调用方对账
      member.componentEntry.name = actualName
      renamedNodes.push(member.master)
      renamedValues.push(member.value)
    })

    if (renamedNodes.length < MIN_VARIANT_MEMBERS) {
      variantSets.push({
        setId, propertyName, memberCount: renamedNodes.length, values: renamedValues, ok: false,
        reason: `改名后可用成员不足 ${MIN_VARIANT_MEMBERS} 个（实际 ${renamedNodes.length} 个）`,
      })
      return
    }

    notes.push(`变体集 "${setId}"：${renamedNodes.length} 个成员组件已改名为 "${properties.map((p) => `${p}=<value>`).join(', ')}"（${plan.members.map((m) => m.values.join('/')).join(' / ')}）——宿主只从成员名推导属性轴，成员自身的原名（如 DS_*）被覆盖；子层名未改动，覆写链安全`)
    if (multiAxis) {
      notes.push(`变体集 "${setId}"：多轴（${properties.join(', ')}）以 "Prop1=Value1, Prop2=Value2" 名编码后交给 combineAsVariants —— 宿主能推导出几个轴未经验证，以回读 hostProperties 为准`)
    }
    if (renameMismatch > 0) {
      notes.push(`变体集 "${setId}"：有 ${renameMismatch} 个成员的名字被宿主改写，属性轴值可能与 members[].value 不一致（详见 skipped）`)
    }

    try {
      const variantSet = combineAsVariants.call(mg, renamedNodes)
      if (!variantSet) {
        variantSets.push({
          setId, propertyName, memberCount: renamedNodes.length, values: renamedValues, ok: false,
          reason: '宿主 combineAsVariants 未返回变体集容器（返回 null/undefined）',
        })
        return
      }

      // 合成后把 set 名设为 setId，并**回读实际名字**（宿主可能拒绝改名）
      let actualSetId = setId
      let nameReason: string | undefined
      try {
        variantSet.name = setId
        actualSetId = String(variantSet.name ?? '')
      } catch (err: any) {
        actualSetId = String(variantSet.name ?? '')
        nameReason = `变体集改名失败：期望 "${setId}"，实际 "${actualSetId}"（宿主拒绝：${err?.message || err}）`
      }
      if (!nameReason && actualSetId !== setId) {
        nameReason = `宿主拒绝了变体集改名：期望 "${setId}"，实际 "${actualSetId}"`
      }
      if (nameReason) notes.push(nameReason)

      // 回读：宿主实际推导出的属性轴（ComponentSet 的属性定义）—— 多轴是否真生效的证据
      const hostProperties = (() => {
        try {
          const defs = (variantSet as any)?.componentPropertyDefinitions
          if (defs && typeof defs === 'object') return Object.keys(defs)
          const props = (variantSet as any)?.variantProperties
          if (Array.isArray(props)) return props.map(String)
          return undefined
        } catch {
          return undefined
        }
      })()

      variantSets.push({
        setId: actualSetId, containerId: variantSet.id, propertyName,
        ...(multiAxis ? { properties } : {}),
        memberCount: renamedNodes.length, values: renamedValues, ok: true,
        ...(hostProperties ? { hostProperties } : {}),
        ...(nameReason ? { reason: nameReason } : {}),
      })
    } catch (err: any) {
      const message = err?.message || String(err)
      // 与 componentHandlers 同一兜底：给用户可手动完成的路（成员名已改成 Prop=Value，手动 Combine 直接可用）
      mg.notify(`合成变体集 "${setId}" 失败：${message}，可手动选中后右键 Combine as Variants`, { type: 'warning' })
      variantSets.push({
        setId, propertyName, memberCount: renamedNodes.length, values: renamedValues, ok: false,
        reason: `combineAsVariants 抛错：${message}（成员名已改为 "${properties.map((p) => `${p}=<value>`).join(', ')}" 且未回滚，可手动合成）`,
      })
    }
  })

  if (reusedCount > 0) {
    notes.push(`有 ${reusedCount} 个成员本来就是 COMPONENT，已直接复用（未二次转换）`)
  }

  const ok = variantSets.length > 0 && variantSets.every((entry: any) => entry.ok === true)
  mg.commitUndo()
  return { ok, success: ok, count: components.length, components, skipped, variantSets, notes }
}

/**
 * 将已有节点转换为组件 Master（或合成为原生变体集）。
 *
 * 五种形态（互斥，见工具 schema 的 anyOf）：
 * - A `nodeId`（+ 可选 `name`）：转一个，母版名 = `name ?? 原节点名`；
 * - B `nodeIds[]`：逐个转，各自保留自己的名字（不接受共用 `name`，传了则忽略并回 notes）；
 * - C `namePrefix`：按名建库 —— 当前页里名字以该前缀开头的节点，**只取最外层**
 *   （祖先也匹配的节点丢弃，否则先转父节点会让子节点 id 失效），各自用自己的名字；
 * - D `listOnly: true`（与 C / B / A 搭配）：**只列举不转换**，回 `matched: [{nodeId,name,type}]`；
 * - E `variantGroups[]`：按显式属性表（`members[].value`）改名并合成原生变体集。
 */
export function handleConvertToComponent(params: any): any {
  const nodeId = typeof params?.nodeId === 'string' ? params.nodeId : undefined
  const nodeIds = Array.isArray(params?.nodeIds) ? (params.nodeIds as any[]).map((id) => String(id)) : undefined
  const namePrefix = typeof params?.namePrefix === 'string' && params.namePrefix ? params.namePrefix : undefined
  const name = typeof params?.name === 'string' && params.name ? params.name : undefined
  const keepOriginal = params?.keepOriginal === true
  const listOnly = params?.listOnly === true
  const variantGroups = Array.isArray(params?.variantGroups) ? (params.variantGroups as any[]) : undefined

  // 形态 E：按显式属性表合成原生变体集
  if (variantGroups) {
    if (variantGroups.length === 0) {
      throw new Error('variantGroups 为空数组：至少需要一个 { setId, propertyName, members[] }')
    }
    if (listOnly) {
      throw new Error('listOnly 与 variantGroups 互斥：listOnly 只列举不转换，variantGroups 会改名并合成')
    }
    return convertToVariantSets(variantGroups, keepOriginal)
  }

  // 形态 D：仅列举（不转换）—— 与 A/B/C 任一形态搭配，过滤逻辑与真转换完全一致
  if (listOnly) {
    const candidates: Array<{ nodeId: string; node: any }> = []
    if (namePrefix) {
      for (const node of collectOutermostByPrefix(namePrefix)) {
        candidates.push({ nodeId: String(node.id), node })
      }
    } else if (nodeIds && nodeIds.length > 0) {
      for (const id of nodeIds) candidates.push({ nodeId: id, node: mg.getNodeById(id) as any })
    } else if (nodeId) {
      candidates.push({ nodeId, node: mg.getNodeById(nodeId) as any })
    } else {
      throw new Error('listOnly=true 需要与 namePrefix（或 nodeIds / nodeId）搭配')
    }

    const matched: Array<{ nodeId: string; name: string; type: string }> = []
    const skipped: any[] = []
    for (const candidate of candidates) {
      if (!candidate.node) {
        skipped.push({ nodeId: candidate.nodeId, reason: 'not-found', message: `Node not found: ${candidate.nodeId}` })
        continue
      }
      matched.push({
        nodeId: String(candidate.node.id),
        name: String(candidate.node.name ?? ''),
        type: String(candidate.node.type ?? 'UNKNOWN'),
      })
    }

    return {
      ok: true,
      success: true,
      listOnly: true,
      count: matched.length,
      components: [],
      matched,
      skipped,
      ...(namePrefix ? { namePrefix } : {}),
      notes: ['listOnly=true：仅列举匹配节点，未做任何转换（不新建组件、不写 undo 快照）'],
    }
  }

  // 形态 C：按名前缀建库
  if (namePrefix) {
    const outermost = collectOutermostByPrefix(namePrefix)
    const result = convertEachToComponent(outermost.map((node) => String(node.id)), undefined, keepOriginal)
    return { ...result, namePrefix, matched: outermost.length }
  }

  // 形态 B：批量（各自保留自己的名字；传了 name 且批量时忽略并说明，不静默）
  if (nodeIds && nodeIds.length > 0) {
    const sharedName = name && nodeIds.length === 1 ? name : undefined
    const note = name && nodeIds.length > 1
      ? 'nodeIds 批量转换不接受共用 name：每个母版各自沿用原节点名（已忽略 name）'
      : undefined
    return convertEachToComponent(nodeIds, sharedName, keepOriginal, note)
  }

  // 形态 A：单个（可指定母版名）
  if (nodeId) {
    return convertSingleToComponent(nodeId, name, keepOriginal)
  }

  throw new Error('Missing required parameter: nodeId / nodeIds / namePrefix（三种形态择一）')
}

/** 获取节点详情 */
export function handleGetNode(params: { nodeId: string; deep?: boolean }): any {
  if (!params.nodeId) {
    throw new Error('Missing required parameter: nodeId')
  }
  const node = mg.getNodeById(params.nodeId)
  if (!node) {
    throw new Error(`Node not found: ${params.nodeId}`)
  }
  return serializeNode(node, params.deep ?? false)
}

/** 创建节点 */
export function handleCreateNode(params: {
  type: string
  properties?: Record<string, unknown>
  parentId?: string
}): any {
  if (!params.type) {
    throw new Error('Missing required parameter: type')
  }

  // 处理 instance 类型：从 componentId 创建实例
  if (params.type === 'instance') {
    const componentId = typeof params.properties?.componentId === 'string' ? params.properties.componentId : undefined
    if (!componentId) {
      throw new Error('Missing required parameter: properties.componentId for instance creation')
    }
    const component = mg.getNodeById(componentId) as ComponentNode | null
    if (!component || typeof component.createInstance !== 'function') {
      throw new Error(`Component not found or not a component: ${componentId}`)
    }
    const node = component.createInstance()

    // 设置实例属性（含样式 / 文本等非几何字段）
    const warnings: string[] = []
    if (params.properties) {
      applyNodeProperties(node, params.properties, warnings)
    }

    // 添加到父节点
    if (params.parentId) {
      const parent = mg.getNodeById(params.parentId)
      if (parent && 'appendChild' in parent) {
        ;(parent as any).appendChild(node)
      }
    } else {
      mg.document.currentPage.appendChild(node)
    }

    // 插入后二次应用几何属性：appendChild 会按父层自动布局重置几何，先写会被覆盖
    const geometry = pickGeometryProps(params.properties)
    if (geometry) {
      applyNodeProperties(node, geometry, warnings)
    }

    // GROUP 护栏：落进 GROUP 会炸组边界，如实告警不阻断
    groupHazardWarning(node, 'create', warnings)

    mg.commitUndo()
    return withWarnings(serializeNode(node), warnings)
  }

  const node = createNodeByType(params.type)

  // 应用属性
  const warnings: string[] = []
  if (params.properties) {
    applyNodeProperties(node, params.properties, warnings)
  }

  // 如果指定了父容器，添加到父节点
  if (params.parentId) {
    const parent = mg.getNodeById(params.parentId)
    if (parent && 'appendChild' in parent) {
      ;(parent as any).appendChild(node)
    }
  }

  // 插入后重新应用几何属性（x/y/width/height/rotation/…）。
  // 关键：必须在 appendChild 之后 —— 宿主插入到自动布局父层时会按父层重写子节点几何，
  // 之前写在 appendChild 之前的 x/y 会被丢弃（frame 落 (0,0)、instance 落 y≈-5000）。
  // width/height 对实例会联动比例，这是宿主行为，不做「修正」，只如实回读。
  const geometry = pickGeometryProps(params.properties)
  if (geometry) {
    applyNodeProperties(node, geometry, warnings)
  }

  // GROUP 护栏：落进 GROUP 会炸组边界，如实告警不阻断
  groupHazardWarning(node, 'create', warnings)

  mg.commitUndo()
  return withWarnings(serializeNode(node), warnings)
}

export function handleUpdateNode(params: {
  nodeId: string
  properties: Record<string, unknown>
}): any {
  if (!params.nodeId) {
    throw new Error('Missing required parameter: nodeId')
  }
  if (!params.properties) {
    throw new Error('Missing required parameter: properties')
  }

  const node = mg.getNodeById(params.nodeId)
  if (!node) {
    throw new Error(`Node not found: ${params.nodeId}`)
  }

  const warnings: string[] = []
  applyNodeProperties(node, params.properties, warnings)

  // GROUP 护栏：GROUP 子层改几何会触发组级等比缩放，如实告警不阻断
  groupHazardWarning(node, 'update', warnings, params.properties)

  mg.commitUndo()
  return withWarnings(serializeNode(node), warnings)
}

export function handleDeleteNode(params: { nodeId: string }): any {
  if (!params.nodeId) {
    throw new Error('Missing required parameter: nodeId')
  }

  const node = mg.getNodeById(params.nodeId)
  if (!node) {
    throw new Error(`Node not found: ${params.nodeId}`)
  }

  const id = node.id
  node.remove()
  mg.commitUndo()
  return { success: true, deletedId: id }
}

/** 批量创建节点 */
export function handleBatchCreateNodes(params: {
  nodes: Array<{
    type: string
    properties?: Record<string, unknown>
    parentId?: string
  }>
}): any {
  if (!params.nodes || !Array.isArray(params.nodes)) {
    throw new Error('Missing required parameter: nodes (array)')
  }

  const results: any[] = []
  const currentPage = mg.document.currentPage

  for (const nodeConfig of params.nodes) {
    try {
      if (!nodeConfig.type) {
        results.push({ success: false, error: 'Missing type parameter' })
        continue
      }

      let node: any
      const nodeWarnings: string[] = []

      if (nodeConfig.type === 'instance') {
        const componentId = typeof nodeConfig.properties?.componentId === 'string' ? nodeConfig.properties.componentId : undefined
        if (!componentId) {
          results.push({ success: false, error: 'Missing properties.componentId for instance' })
          continue
        }
        const component = mg.getNodeById(componentId) as ComponentNode | null
        if (!component || typeof component.createInstance !== 'function') {
          results.push({ success: false, error: `Component not found: ${componentId}` })
          continue
        }
        node = component.createInstance()
      } else {
        node = createNodeByType(nodeConfig.type)
      }

      if (nodeConfig.properties) {
        applyNodeProperties(node, nodeConfig.properties, nodeWarnings)
      }

      // parentId 是生效的：指定父层时插入父层，未指定时（非 instance）插入当前页
      if (nodeConfig.parentId) {
        const parent = mg.getNodeById(nodeConfig.parentId)
        if (parent && 'appendChild' in parent) {
          ;(parent as any).appendChild(node)
        }
      } else if (nodeConfig.type !== 'instance') {
        currentPage.appendChild(node)
      }

      // 插入后二次应用几何属性：宿主 appendChild 会按父层自动布局重置 x/y/尺寸。
      // 这里复用 applyNodeProperties 的几何子集，比旧的「只补 x/y/width/height」多覆盖
      // rotation / layoutPositioning / layoutSizing* / constraints。
      const geometry = pickGeometryProps(nodeConfig.properties)
      if (geometry) {
        applyNodeProperties(node, geometry, nodeWarnings)
      }

      // GROUP 护栏：落进 GROUP 会炸组边界，如实告警不阻断
      groupHazardWarning(node, 'create', nodeWarnings)

      results.push({ success: true, node: serializeNode(node), ...(nodeWarnings.length > 0 ? { warnings: Array.from(new Set(nodeWarnings)) } : {}) })
    } catch (error) {
      results.push({ success: false, error: (error as Error).message })
    }
  }

  mg.commitUndo()

  const successCount = results.filter(r => r.success).length
  const failCount = results.length - successCount
  const msg = failCount > 0 ? `已创建 ${successCount} 个节点，${failCount} 个失败` : `已创建 ${successCount} 个节点`
  mg.notify(msg, { type: failCount > 0 ? 'warning' : 'normal' })
  return { success: true, created: successCount, failed: failCount, results }
}

/**
 * 批量更新节点（逐项回报，与 batchCreate / batchDelete 同口径）
 *
 * 2026-09 真实踩坑修正：
 * - 单项失败**不中断**后续（旧版一条坏 nodeId 就让整批停摆）；
 * - 旧版把坏 nodeId 丢回宿主 JSON 桥，报出 `value at updates[i].nodeId is not JSON-serializable`
 *   这种内部错（用户因此废掉两个脚本）。因此这里**只接受字符串 nodeId**，非字符串
 *   （undefined / 节点对象 / 带 parent 循环引用的代理对象）就地报
 *   `updates[i].nodeId 缺失或不是字符串`，且绝不把它放进响应体（那正是旧报错的根因）；
 * - 失败项汇总为 `failed: [{ index, nodeId, error }]`，`results` 保留逐项明细（含 warnings）。
 */
export function handleBatchUpdateNodes(params: {
  updates: Array<{
    nodeId: string
    properties: Record<string, unknown>
  }>
}): any {
  if (!params.updates || !Array.isArray(params.updates)) {
    throw new Error('Missing required parameter: updates (array)')
  }

  const results: any[] = []
  const failed: Array<{ index: number; nodeId?: string; error: string }> = []

  for (let i = 0; i < params.updates.length; i++) {
    const update = params.updates[i] as any
    // 只在 nodeId 确实是字符串时回显：node 对象带 parent 反向引用，放进去就会炸 JSON 桥
    const rawNodeId = update?.nodeId
    const nodeId = typeof rawNodeId === 'string' ? rawNodeId : undefined

    /** 组装失败明细（nodeId 合法时才带上） */
    const pushFailure = (error: string): void => {
      failed.push(nodeId ? { index: i, nodeId, error } : { index: i, error })
      results.push({ success: false, index: i, ...(nodeId ? { nodeId } : {}), error })
    }

    try {
      if (!nodeId) {
        pushFailure(`updates[${i}].nodeId 缺失或不是字符串（实际类型：${rawNodeId === null ? 'null' : typeof rawNodeId}）`)
        continue
      }

      const node = mg.getNodeById(nodeId)
      if (!node) {
        pushFailure(`节点不存在: ${nodeId}`)
        continue
      }

      if (update.properties == null || typeof update.properties !== 'object') {
        pushFailure(`updates[${i}].properties 缺失或不是对象（节点 ${nodeId}）`)
        continue
      }

      const updateWarnings: string[] = []
      applyNodeProperties(node, update.properties, updateWarnings)
      // GROUP 护栏：GROUP 子层改几何会触发组级等比缩放，如实告警不阻断
      groupHazardWarning(node, 'update', updateWarnings, update.properties)

      results.push({
        success: true,
        index: i,
        nodeId,
        node: serializeNode(node),
        ...(updateWarnings.length > 0 ? { warnings: Array.from(new Set(updateWarnings)) } : {}),
      })
    } catch (error) {
      pushFailure((error as Error)?.message || String(error))
    }
  }

  mg.commitUndo()

  const successCount = results.filter(r => r.success).length
  const failCount = failed.length
  const msg = failCount > 0 ? `已更新 ${successCount} 个节点，${failCount} 个失败` : `已更新 ${successCount} 个节点`
  mg.notify(msg, { type: failCount > 0 ? 'warning' : 'normal' })
  // success 表示「整批无失败」（逐项明细看 results / failed）
  return { success: failCount === 0, updated: successCount, failed, results }
}

/** 批量删除节点 */
export function handleBatchDeleteNodes(params: {
  nodeIds: string[]
}): any {
  if (!params.nodeIds || !Array.isArray(params.nodeIds)) {
    throw new Error('Missing required parameter: nodeIds (array)')
  }

  const results: any[] = []

  for (const nodeId of params.nodeIds) {
    try {
      const node = mg.getNodeById(nodeId)
      if (!node) {
        results.push({ success: false, error: `Node not found: ${nodeId}` })
        continue
      }

      node.remove()
      results.push({ success: true, deletedId: nodeId })
    } catch (error) {
      results.push({ success: false, error: (error as Error).message })
    }
  }

  mg.commitUndo()

  const successCount = results.filter(r => r.success).length
  const failCount = results.length - successCount
  const msg = failCount > 0 ? `已删除 ${successCount} 个节点，${failCount} 个失败` : `已删除 ${successCount} 个节点`
  mg.notify(msg, { type: failCount > 0 ? 'warning' : 'normal' })
  return { success: true, deleted: successCount, failed: failCount, results }
}

/** 将节点组合 */
export function handleGroupNodes(params: {
  nodeIds: string[]
  groupName?: string
}): any {
  if (!params.nodeIds || !Array.isArray(params.nodeIds)) {
    throw new Error('Missing required parameter: nodeIds (array)')
  }

  if (params.nodeIds.length < 2) {
    throw new Error('At least 2 nodes are required for grouping')
  }

  const nodes: any[] = []
  for (const nodeId of params.nodeIds) {
    const node = mg.getNodeById(nodeId)
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`)
    }
    nodes.push(node)
  }

  const group = mg.group(nodes)

  if (params.groupName && 'name' in group) {
    group.name = params.groupName
  }

  mg.commitUndo()

  return { success: true, group: serializeNode(group) }
}

/** 布尔操作（联合、减去、相交、排除） */
export function handleBooleanOperation(params: {
  nodeIds: string[]
  operation: 'union' | 'subtract' | 'intersect' | 'exclude'
}): any {
  if (!params.nodeIds || !Array.isArray(params.nodeIds)) {
    throw new Error('Missing required parameter: nodeIds (array)')
  }

  if (params.nodeIds.length < 2) {
    throw new Error('At least 2 nodes are required for boolean operation')
  }

  const validOperations = ['union', 'subtract', 'intersect', 'exclude']
  if (!validOperations.includes(params.operation)) {
    throw new Error(`Invalid operation: ${params.operation}. Must be one of: ${validOperations.join(', ')}`)
  }

  const nodes: any[] = []
  for (const nodeId of params.nodeIds) {
    const node = mg.getNodeById(nodeId)
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`)
    }
    nodes.push(node)
  }

  let result: any
  switch (params.operation) {
    case 'union':
      result = mg.union(nodes)
      break
    case 'subtract':
      result = mg.subtract(nodes)
      break
    case 'intersect':
      result = mg.intersect(nodes)
      break
    case 'exclude':
      result = mg.exclude(nodes)
      break
  }

  mg.commitUndo()

  return { success: true, operation: params.operation, result: serializeNode(result) }
}

/** 克隆节点到目标父节点 */
export function handleCloneNode(params: {
  nodeId: string
  parentId?: string
  x?: number
  y?: number
  name?: string
}): any {
  if (!params.nodeId) {
    throw new Error('Missing required parameter: nodeId')
  }

  const node = mg.getNodeById(params.nodeId)
  if (!node) {
    throw new Error(`Node not found: ${params.nodeId}`)
  }

  // 克隆节点
  const cloned = node.clone()
  if (!cloned) {
    throw new Error(`Failed to clone node: ${params.nodeId}`)
  }

  // 可选重命名
  if (params.name && 'name' in cloned) {
    cloned.name = params.name
  }

  // 添加到目标父节点或当前页面
  if (params.parentId) {
    const parent = mg.getNodeById(params.parentId)
    if (!parent) {
      throw new Error(`Parent node not found: ${params.parentId}`)
    }
    if (!('appendChild' in parent)) {
      throw new Error(`Parent node does not support children: ${params.parentId}`)
    }
    parent.appendChild(cloned)
  } else {
    mg.document.currentPage.appendChild(cloned)
  }

  // x/y 必须写在 appendChild **之后**：跨父级克隆会保留源节点的绝对坐标，
  // 且宿主插入父层时会按父层（尤其自动布局）重算几何，写在插入前会被覆盖。
  if (params.x !== undefined && 'x' in cloned) {
    try { cloned.x = params.x } catch (_) { /* ignore */ }
  }
  if (params.y !== undefined && 'y' in cloned) {
    try { cloned.y = params.y } catch (_) { /* ignore */ }
  }

  mg.commitUndo()

  // 信封里额外补顶层 `id`：node_get / node_update 返回的是**裸节点**，而本方法返回
  // `{success, node}` 信封。混用时 `res.id` 会取到 undefined — 再把 undefined 当 nodeId 传给
  // 其它方法，就会撞上宿主 JSON 桥的 `not JSON-serializable` 内部错。补 `id` 后两种读法都安全。
  return { success: true, id: cloned.id, node: serializeNode(cloned) }
}

/**
 * 移动节点到目标父节点。
 *
 * `index` 是**真参数**（旧版只 `console.warn` 后固定 appendChild 到末尾，导致用户发明
 * 「依次 move 所有兄弟」的笨办法）：宿主 `ChildrenMixin.insertChild(index, child)`
 * （typings：`insertChild(index: number, child: SceneNode): void`）能精确定位。
 * 宿主不支持 / 调用抛错时回退 appendChild，并如实给一条中文 warning（不静默降级）。
 */
export function handleMoveNode(params: {
  nodeId: string
  parentId: string
  index?: number
}): any {
  if (!params.nodeId) {
    throw new Error('Missing required parameter: nodeId')
  }
  if (!params.parentId) {
    throw new Error('Missing required parameter: parentId')
  }

  const node = mg.getNodeById(params.nodeId)
  if (!node) {
    throw new Error(`Node not found: ${params.nodeId}`)
  }

  const parent = mg.getNodeById(params.parentId) as any
  if (!parent) {
    throw new Error(`Parent node not found: ${params.parentId}`)
  }

  if (!('appendChild' in parent)) {
    throw new Error(`Parent node does not support children: ${params.parentId}`)
  }

  const warnings: string[] = []
  const requestedIndex = params.index
  let appliedIndex: number | undefined

  if (requestedIndex !== undefined) {
    if (typeof requestedIndex !== 'number' || !Number.isInteger(requestedIndex) || requestedIndex < 0) {
      // 非法序号：不揣测意图，落到末尾并说明
      warnings.push(`index 不是非负整数（实际：${String(requestedIndex)}），已忽略并追加到末尾`)
      parent.appendChild(node)
    } else if (typeof parent.insertChild === 'function') {
      try {
        parent.insertChild(requestedIndex, node)
        appliedIndex = requestedIndex
      } catch (error) {
        warnings.push(
          `宿主未支持按序号插入（insertChild 调用失败：${(error as Error)?.message || error}），已追加到末尾`,
        )
        parent.appendChild(node)
      }
    } else {
      warnings.push('宿主未支持按序号插入（父层缺少 insertChild），已追加到末尾')
      parent.appendChild(node)
    }
  } else {
    // 未传 index：与旧版一致，追加到末尾
    parent.appendChild(node)
  }

  mg.commitUndo()

  const result: any = { success: true, node: serializeNode(node) }
  // 只有真的按序号插进去才回显 index，避免调用方误以为生效
  if (appliedIndex !== undefined) result.index = appliedIndex
  return withWarnings(result, warnings)
}

/**
 * 分离组件实例（detach）。
 *
 * 用途：**改实例子层几何前，先 detach 是官方推荐路径**。
 * 实例的子层属性由主组件约束：直接写 x/y/width/height 往往不生效，或触发实例级等比缩放；
 * 用户在 MasterGo UI 里的习惯做法就是先「分离实例」（detach）把实例变成普通 FRAME/GROUP，
 * 再自由改几何。此前插件端没有这个 handler，AI 只能靠人工去 UI 点。
 *
 * 宿主 API（typings `InstanceNode`）：`detachInstance(): FrameNode` —— 同步方法，返回分离后
 * 的普通节点（不同宿主可能返回新 id，故**回读**后如实给出 `newId`/`newType`）。
 * 额外兼容部分运行时暴露的 `node.detach()`；两者都不存在时返回 `{success:false, reason:'unsupported'}`
 * （不抛错，便于调用方读 plugin_capabilities 后自行降级）。
 */
export function handleDetachInstance(params: { nodeId: string }): any {
  if (!params?.nodeId) {
    throw new Error('缺少必填参数 nodeId')
  }

  const node = mg.getNodeById(params.nodeId) as any
  if (!node) {
    throw new Error(`未找到节点：${params.nodeId}`)
  }

  if (node.type !== 'INSTANCE') {
    throw new Error(`节点不是组件实例（type=${node.type}），无法 detach：${params.nodeId}`)
  }

  const detachFn = typeof node.detachInstance === 'function'
    ? node.detachInstance.bind(node)
    : typeof node.detach === 'function'
      ? node.detach.bind(node)
      : null

  if (!detachFn) {
    return {
      success: false,
      reason: 'unsupported',
      nodeId: params.nodeId,
      message: '当前客户端不支持实例分离（detachInstance / detach 均缺失，可用 plugin_capabilities 复核）',
    }
  }

  let detached: any = null
  try {
    detached = detachFn()
  } catch (error) {
    throw new Error(`实例分离失败（${params.nodeId}）：${(error as Error)?.message || error}`)
  }

  mg.commitUndo()

  // 回读优先级：宿主 detach 的返回值（权威）→ 文档里同/新 id 的节点 → 兜底 UNKNOWN
  // （宿主不返回新 id 时按同 id 处理）
  const newId = typeof detached?.id === 'string' ? detached.id : params.nodeId
  const readback = detached && typeof detached.type === 'string'
    ? detached
    : (mg.getNodeById(newId) ?? null)
  const newType = readback?.type ?? 'UNKNOWN'

  const warnings: string[] = []
  if (newId !== params.nodeId) {
    warnings.push(`detach 后节点 id 已变为 ${newId}，后续操作请用 newId（旧 id 可能失效）`)
  }

  const result: any = { success: true, nodeId: params.nodeId, newId, newType }
  if (warnings.length > 0) result.warnings = warnings
  return result
}

/** 将节点导出为图片（PNG/JPG/WEBP/SVG/PDF） */
export async function handleExportNodeAsImage(params: {
  nodeId: string
  format?: 'PNG' | 'JPG' | 'WEBP' | 'SVG' | 'PDF'
  constraint?: { type: 'SCALE' | 'WIDTH' | 'HEIGHT'; value: number }
  useAbsoluteBounds?: boolean
  useRenderBounds?: boolean
}): Promise<any> {
  if (!params.nodeId) {
    throw new Error('Missing required parameter: nodeId')
  }

  const node = mg.getNodeById(params.nodeId)
  if (!node) {
    throw new Error(`Node not found: ${params.nodeId}`)
  }

  if (typeof (node as any).exportAsync !== 'function') {
    throw new Error(`Node type "${node.type}" does not support image export`)
  }

  const format = params.format || 'PNG'

  const settings: any = { format }
  if (params.constraint) {
    settings.constraint = params.constraint
  }
  if (params.useAbsoluteBounds !== undefined) {
    settings.useAbsoluteBounds = params.useAbsoluteBounds
  }
  if (params.useRenderBounds !== undefined) {
    settings.useRenderBounds = params.useRenderBounds
  }

  let result: Uint8Array | string
  try {
    result = await (node as any).exportAsync(settings)
  } catch (error) {
    throw new Error(`Export failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Uint8Array → base64 (栅格格式); string (SVG) 直接返回
  if (result instanceof Uint8Array) {
    // 手动 base64 编码（兼容无 btoa 的沙盒环境）
    const base64 = uint8ArrayToBase64(result)
    const mimeType = format === 'JPG' ? 'image/jpeg'
      : format === 'WEBP' ? 'image/webp'
      : format === 'PDF' ? 'application/pdf'
      : 'image/png'
    return {
      nodeId: params.nodeId,
      nodeName: node.name,
      format,
      mimeType,
      data: `data:${mimeType};base64,${base64}`,
    }
  }

  // SVG 返回纯文本
  return {
    nodeId: params.nodeId,
    nodeName: node.name,
    format: 'SVG',
    mimeType: 'image/svg+xml',
    data: result,
  }
}
