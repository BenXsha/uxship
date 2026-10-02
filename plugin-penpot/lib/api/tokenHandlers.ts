/**
 * 设计令牌（variable_*）与样式资产（style_*）handler
 *
 * ⚠️ **模型差异必须显式带到响应里**，不能假装两边一样：
 *   - MasterGo：变量 = 集合 + 多模式取值（modeId → value），只能 CRUD，**不能绑定到图层属性**；
 *   - Penpot：令牌 = 集合（TokenSet）+ 主题（TokenTheme，激活哪些集合），
 *     且 `token.applyToShapes()` 是**真绑定**（改令牌全稿联动）。
 *
 * 因此响应统一带 `model` 字段：`penpot-tokens` / `mastergo-variables`。
 * 归一化时把值放进 `default` 伪模式，让习惯 MasterGo 形状的调用方仍能直接读。
 */
import type { HandlerContext } from './index'
import type { HostTokenSet } from '../host/types'

/** Penpot 的 TokenType → 最接近的 MasterGo 变量类型（仅用于让调用方复用既有判断） */
const TYPE_MAP: Record<string, string> = {
  color: 'COLOR',
  dimension: 'NUMBER',
  spacing: 'SPACING',
  opacity: 'NUMBER',
  borderRadius: 'CORNER_RADIUS',
  borderWidth: 'STROKE_WIDTH',
  shadow: 'EFFECT',
  typography: 'TEXT',
  fontSizes: 'STRING',
  fontWeights: 'STRING',
  fontFamilies: 'STRING',
  letterSpacing: 'STRING',
  textCase: 'STRING',
  textDecoration: 'STRING',
}

function normalizeToken(token: HostTokenSet['tokens'][number], includeValues: boolean) {
  return {
    id: token.id,
    name: token.name,
    /** 近似的 MasterGo 类型（便于沿用既有判断） */
    type: TYPE_MAP[token.hostType] ?? token.hostType.toUpperCase(),
    /** 宿主原始类型 —— 类型词表两边不同，必须带出来 */
    hostType: token.hostType,
    description: token.description ?? '',
    /** 值是 `{color.primary}` 形态即视为别名引用 */
    alias: typeof token.value === 'string' && /^\{.+\}$/.test(token.value) ? token.value : '',
    isExternal: false,
    supportScope: true,
    scopes: [],
    ...(includeValues ? { values: { default: token.value }, resolvedValue: token.resolvedValue } : {}),
  }
}

/**
 * `variable/list`
 *
 * 参数沿用 MasterGo 的口径（`collectionId` / `type` / `groupPath` / `includeExternal` / `includeValues`），
 * 但在 Penpot 上：
 *   - `collectionId` → 令牌集合 id
 *   - `groupPath` → 按名字前缀过滤（Penpot 没有分组字段，名字用 `.` 分层，如 `color.primary`）
 *   - `includeExternal` → 目前恒为本文件库（团队库令牌需先连接库，尚未接线）
 */
export async function handleVariableList(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const includeValues = params.includeValues !== false
  const wantedType = params.type ? String(params.type).toUpperCase() : ''
  const wantedCollection = params.collectionId ? String(params.collectionId) : ''
  const groupPath = params.groupPath ? String(params.groupPath) : ''

  let sets: HostTokenSet[]
  try {
    sets = await context.host.listTokenSets()
  } catch (error) {
    // 与 MasterGo 侧同一口径：能力缺失返回 available:false，不抛错
    return {
      available: false,
      model: 'penpot-tokens',
      collections: [],
      stats: { collections: 0, variables: 0 },
      reason: (error as Error).message,
    }
  }

  const warnings: string[] = []
  const collections = []
  let total = 0

  for (const set of sets) {
    if (wantedCollection && set.id !== wantedCollection) continue

    const variables = []
    for (const token of set.tokens) {
      const normalized = normalizeToken(token, includeValues)
      if (wantedType && normalized.type !== wantedType && normalized.hostType.toUpperCase() !== wantedType) continue
      if (groupPath && !token.name.startsWith(groupPath)) continue
      variables.push(normalized)
    }
    total += variables.length

    collections.push({
      id: set.id,
      name: set.name,
      isExternal: false,
      /** Penpot 没有"变量多模式"；这里给出单模式占位，真实模型见 model/note */
      modes: [{ modeId: 'default', name: 'Default' }],
      variableCount: variables.length,
      active: set.active,
      variables,
    })
  }

  if (params.includeExternal === true) {
    warnings.push('Penpot 侧暂未接线团队库令牌（需先连接库）；当前只返回本文件库')
  }

  return {
    available: true,
    model: 'penpot-tokens',
    note:
      'Penpot 令牌模型：TokenSet=集合、TokenTheme=激活哪些集合（不是变量多模式取值）；' +
      '值以 default 伪模式呈现。与 MasterGo 变量不同，Penpot 的令牌可**真绑定**到图层属性。',
    collections,
    stats: { collections: collections.length, variables: total },
    ...(warnings.length ? { warnings } : {}),
  }
}

/** `variable/create`：按 name 幂等（同名视为更新），并在需要时新建集合 */
export async function handleVariableCreate(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const name = String(params.name ?? '')
  const value = params.value
  if (!name) throw new Error('variable/create 需要 name')
  if (value === undefined || value === null) throw new Error('variable/create 需要 value')

  const type = String(params.type ?? 'COLOR')
  // MasterGo 类型 → Penpot TokenType（缺省按 COLOR 处理）
  const penpotType = Object.entries(TYPE_MAP).find(([, mastergo]) => mastergo === type.toUpperCase())?.[0] ?? 'color'

  const result = await context.host.createToken({
    name,
    type: penpotType,
    value: String(value),
    setName: typeof params.collectionName === 'string' ? params.collectionName : undefined,
    description: typeof params.description === 'string' ? params.description : undefined,
  })

  // 新建集合默认**未激活**（真机实测）→ 此时绑定只是引用，**渲染不会跟着令牌走**。
  // 这里如实带上集合状态并给可操作指引 —— 否则调用方会以为"建了令牌、也绑上了、却没反应"是自己弄错了。
  let setActive: boolean | undefined
  try {
    const sets = await context.host.listTokenSets()
    setActive = sets.find((set) => set.id === result.setId)?.active
  } catch {
    /* 读不到就不报，不影响创建结果 */
  }

  return {
    ok: true,
    created: result.created,
    nodeId: result.token.id,
    name: result.token.name,
    type: result.token.hostType,
    value: result.token.value,
    setId: result.setId,
    setName: result.setName,
    ...(setActive === undefined ? {} : { setActive }),
    ...(result.created ? {} : { note: '同名令牌已存在 → 已按更新处理（幂等，不产生重复）' }),
    ...(result.created && setActive === false
      ? {
          hint:
            '新建集合默认未激活 → 现在绑定不会驱动渲染；用 variable_update({ id, activateSet: true }) 激活后再验',
        }
      : {}),
  }
}

/**
 * `variable/batchCreate`：批量建/更新令牌，可选建完**激活集合**。
 *
 * 用途：`design_to_code` 把推导出的 palette（亮/暗）一键落到画布 —— 一次把 system 层写完并激活，
 * 而不是让调用方循环 N 次（那既慢又会在中途留下“半套令牌”）。
 *
 * 语义：逐条走宿主 `createToken`（同名幂等）；单条失败**不静默**，进 `errors[]`，其余继续。
 */
export async function handleVariableBatchCreate(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const raw = Array.isArray(params.variables) ? params.variables : []
  if (!raw.length) throw new Error('variable/batchCreate 需要非空 variables')
  const setName = typeof params.collectionName === 'string' && params.collectionName ? params.collectionName : undefined

  const created: { name: string; value: string }[] = []
  const updated: { name: string; value: string }[] = []
  const errors: { name: unknown; reason: string }[] = []
  let setId = ''
  let resolvedSetName = setName ?? ''

  for (const item of raw as Record<string, unknown>[]) {
    try {
      const name = String(item?.name ?? '')
      const value = item?.value
      if (!name) throw new Error('缺少 name')
      if (value === undefined || value === null) throw new Error('缺少 value')
      const type = String(item?.type ?? 'COLOR')
      const penpotType = Object.entries(TYPE_MAP).find(([, mastergo]) => mastergo === type.toUpperCase())?.[0] ?? 'color'
      const result = await context.host.createToken({
        name,
        type: penpotType,
        value: String(value),
        setName,
        description: typeof item?.description === 'string' ? item.description : undefined,
      })
      setId = result.setId
      resolvedSetName = result.setName
      ;(result.created ? created : updated).push({ name: result.token.name, value: String(result.token.value ?? '') })
    } catch (error) {
      errors.push({ name: item?.name, reason: (error as Error).message })
    }
  }

  // 集合激活：暗色主题要求“建完即生效”（未激活时绑定不驱动渲染）
  let setActive: boolean | undefined
  if (params.activate === true && resolvedSetName) {
    try {
      const activated = await context.host.setTokenSetActive({ setName: resolvedSetName, active: true })
      setActive = activated.active
    } catch (error) {
      errors.push({ name: resolvedSetName, reason: `激活集合失败：${(error as Error).message}` })
    }
  } else {
    try {
      const sets = await context.host.listTokenSets()
      setActive = sets.find((set) => set.id === setId)?.active
    } catch {
      /* 读不到就不报，不影响创建结果 */
    }
  }

  return {
    ok: errors.length === 0,
    model: 'penpot-tokens',
    createdCount: created.length,
    updatedCount: updated.length,
    created,
    updated,
    setId,
    setName: resolvedSetName,
    ...(setActive === undefined ? {} : { setActive }),
    ...(errors.length ? { errors } : {}),
  }
}

/** `variable/update`：按 name 定位，改 value / description */
/**
 * 解析「改哪个令牌」与「改成什么名字」。
 *
 * 为何必须做这层：`variable_update` 工具 schema 的必填字段是 `id`（为 MasterGo 的形状），
 * 而 Penpot 的宿主方法按 **name** 定位 —— 直接把 `name ?? variableId` 当选择器，会让调用方
 * 拿 `variable_create` 返回的 id 去更新时**必失败**。这对"渲染后统一改 tokens"是致命的：
 * 一次循环里 id 就是上一环的输出。
 *
 * 口径（与 MasterGo 对齐，两宿主同义）：
 * - 传了 `id` → id 是**选择器**，`name` 是**新名字**（改名）
 * - 只传 `name` / `variableId` → 按名字定位（Penpot 原有用法，保持兼容）
 */
async function resolveTokenTarget(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<{ name: string; newName?: string; collectionName?: string }> {
  const collectionName = typeof params.collectionName === 'string' ? params.collectionName : undefined
  const id = typeof params.id === 'string' ? params.id : ''

  if (id) {
    // Penpot 只能列当前文档的令牌；用 id 反查名字，失败时给出可操作的原因
    let sets: Awaited<ReturnType<typeof context.host.listTokenSets>> = []
    try {
      sets = await context.host.listTokenSets()
    } catch (error) {
      throw new Error(`无法按 id 定位令牌（列出令牌集合失败）：${(error as Error).message}`)
    }
    for (const set of sets) {
      if (collectionName && set.name !== collectionName) continue
      const hit = set.tokens.find((token) => token.id === id)
      if (hit) {
        const newName = typeof params.name === 'string' && params.name ? params.name : undefined
        return { name: hit.name, ...(newName ? { newName } : {}), ...(collectionName ? { collectionName } : {}) }
      }
    }
    throw new Error(`令牌不存在: id=${id}（先用 variable_list 确认；Penpot 只能查当前文档）`)
  }

  const name = String(params.name ?? params.variableId ?? '')
  if (!name) throw new Error('需要 id 或 name（二选一）')
  return { name, ...(collectionName ? { collectionName } : {}) }
}

/** `variable/update`：按 id（优先）或 name 定位；改 value / name（改名）/ description */
export async function handleVariableUpdate(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const target = await resolveTokenTarget(params, context)

  const result = await context.host.updateToken({
    name: target.name,
    value: params.value === undefined ? undefined : String(params.value),
    description: typeof params.description === 'string' ? params.description : undefined,
    setName: target.collectionName,
  })

  const updated = [...result.updated]
  let finalName = result.token.name
  const warnings: string[] = []

  // 改名走独立方法（选择器与新名字不共用字段，见 host/types.ts）——
  // 只给 id + name 时就是一次纯改名，所以 ok 的判据必须把 renamed 算进去
  if (target.newName) {
    const renamed = await context.host.renameToken({
      name: finalName,
      newName: target.newName,
      setName: target.collectionName,
    })
    if (renamed.renamed) updated.push('name')
    finalName = renamed.token.name
  }

  // 集合激活：绑定只是"引用"，集合不激活时渲染不跟着令牌走（真机实测见 host/types.ts）——
  // 所以它必须与改值在同一个工具里可用，否则"改一次令牌、全稿联动"就差这一步。
  let setActive: boolean | undefined
  if (typeof params.activateSet === 'boolean') {
    const activation = await context.host.setTokenSetActive({
      tokenName: finalName,
      setName: target.collectionName,
      active: params.activateSet,
    })
    setActive = activation.active
    if (activation.changed) updated.push('setActive')
    if (activation.note) return {
      ok: updated.length > 0,
      name: finalName,
      updated,
      setActive,
      note: activation.note,
    }
  }

  // 改值 ≠ 全稿联动：宿主**不会**自动回写已绑定形状（真机实测：集合已 active、引用也在，
  // 但 fills 与渲染都不变；而面板手改却会刷新 —— 差别就是面板会重下发）。
  // 所以值一改就跟一次官方传播 `Token.applyToShapes()`，并把 matched/rewritten 如实带回：
  // "改了几块"必须是回读数，不是乐观值。
  let propagated: { matched: number; rewritten: number; mechanism: string; note?: string } | undefined
  if (params.value !== undefined) {
    try {
      propagated = await context.host.propagateToken({
        tokenName: finalName,
        setName: target.collectionName,
      })
    } catch (error) {
      warnings.push(`令牌值已写入，但传播失败（已绑定形状可能仍是旧值）：${(error as Error).message}`)
    }
  }

  return {
    ok: updated.length > 0,
    name: finalName,
    updated,
    ...(setActive === undefined ? {} : { setActive }),
    ...(propagated ? { propagated } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...(updated.length
      ? {}
      : { reason: '没有需要更新的字段（传 value / name（改名）/ description / activateSet）' }),
  }
}

/** `variable/delete`：按 id（优先）或 name 定位删除 */
export async function handleVariableDelete(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const target = await resolveTokenTarget(params, context)

  const result = await context.host.deleteToken({
    name: target.name,
    setName: target.collectionName,
  })
  return { ok: true, deleted: result.deleted }
}

/**
 * `variable/apply`（**绑定**）：把令牌挂到节点属性上，而不是把值拷过去。
 *
 * 为什么必须是独立 op：绑定是**引用**。改令牌值 → 全稿联动（Penpot：`shape.applyToken`）。
 * 但它同时意味着**顺序敏感** —— 宿主"直接改属性即解绑"，所以绑定必须发生在
 * 属性写入**之后**；已经绑好的节点再 `node_update` 写 fills 会静默掉落引用。
 *
 * 校验只认 `readNodeTokens`（`shape.tokens`）的回读，不认"调用没报错"。
 */
export async function handleVariableApply(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const target = await resolveTokenTarget(params, context)
  const name = target.name

  const nodeIds = [
    ...(Array.isArray(params.nodeIds) ? params.nodeIds.map(String) : []),
    ...(typeof params.nodeId === 'string' && params.nodeId ? [params.nodeId] : []),
  ].filter((id, index, all) => all.indexOf(id) === index)
  if (nodeIds.length === 0) throw new Error('variable/apply 需要 nodeId 或 nodeIds')

  const properties =
    Array.isArray(params.properties) && params.properties.length > 0
      ? params.properties.map(String)
      : ['fill']
  const setName = typeof params.collectionName === 'string' ? params.collectionName : undefined

  const nodes: { nodeId: string; applied: boolean; bound: Record<string, string>; note?: string }[] = []
  const skipped: { nodeId: string; reason: string }[] = []

  for (const nodeId of nodeIds) {
    const node = context.host.getNodeById(nodeId)
    if (!node) {
      skipped.push({ nodeId, reason: '节点不存在（Penpot 只能查当前页）' })
      continue
    }
    try {
      const result = await context.host.applyToken(node, name, properties)
      nodes.push({
        nodeId,
        applied: result.applied,
        bound: result.bound,
        ...(result.note ? { note: result.note } : {}),
      })
    } catch (error) {
      const message = (error as Error).message
      // 能力缺失 → available:false（与 variable/list 同一口径），其余（如令牌不存在）逐节点如实上报
      if (/UnsupportedHostFeature|未提供|不支持/.test(message)) {
        return {
          available: false,
          model: 'penpot-tokens',
          name,
          reason: message,
          hint: '该宿主不能把令牌绑定到图层属性；可改用 variable_update 直接改值，或用 style_apply 走样式通道',
        }
      }
      skipped.push({ nodeId, reason: message })
    }
  }

  const applied = nodes.filter((entry) => entry.applied).length

  // 绑上≠看得见：集合未激活时宿主不把令牌值应用到渲染（真机实测：shape.tokens 有引用，
  // 但改值后 fills 仍为旧色）。这里如实带上集合状态，避免 AI 把"界面没变"误判成"绑定无效"。
  let setActive: boolean | undefined
  if (applied > 0) {
    try {
      const sets = await context.host.listTokenSets()
      setActive = sets.find((set) => set.tokens.some((token) => token.name === name))?.active
    } catch {
      /* 读不到就不报，不影响绑定结果 */
    }
  }

  let note: string
  if (applied === 0) {
    note = '没有任何节点绑上 —— 看 nodes[].bound（shape.tokens 回读）判断宿主是否接受了该属性名'
  } else if (setActive === false) {
    note =
      '绑定已建立，但**令牌集合未激活 → 渲染不会跟着令牌走**；' +
      '用 variable_update({ activateSet: true }) 激活后再验'
  } else {
    note = '绑定是引用：改令牌值会全稿联动；但**再写这些属性会解绑**，需要重新绑定'
  }

  return {
    ok: applied > 0,
    model: 'penpot-tokens',
    name,
    ...(setName ? { setName } : {}),
    properties,
    total: nodeIds.length,
    applied,
    ...(setActive === undefined ? {} : { setActive }),
    ...(skipped.length ? { skipped, failed: skipped.length } : {}),
    nodes,
    note,
  }
}

// ── 样式资产 ──

/** `style/listColors`：颜色样式（Penpot：library.local.colors，含已连接库） */
export async function handleStyleListColors(
  _params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const styles = await context.host.listColorStyles()
  const local = styles.filter((style) => style.isLocal)
  return {
    available: true,
    count: styles.length,
    localCount: local.length,
    externalCount: styles.length - local.length,
    styles,
  }
}

/** `style/listText`：文本样式（Penpot：library.local.typographies，含已连接库） */
export async function handleStyleListText(
  _params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const styles = await context.host.listTextStyles()
  const local = styles.filter((style) => style.isLocal)
  return {
    available: true,
    count: styles.length,
    localCount: local.length,
    externalCount: styles.length - local.length,
    styles,
  }
}

const STYLE_TYPES = new Set(['fill', 'stroke', 'text'])

/**
 * `style/apply`：把样式应用到节点。
 *
 * fill/stroke 走 `LibraryColor.asFill()/asStroke()`（保住样式引用，而非一次性赋值）；
 * text 走 `applyToText(shape)`。回读校验，宿主静默忽略时如实说明。
 */
export async function handleStyleApply(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const nodeId = String(params.nodeId ?? '')
  const styleId = String(params.styleId ?? '')
  const styleType = String(params.styleType ?? 'fill').toLowerCase()

  if (!nodeId) throw new Error('style/apply 需要 nodeId')
  if (!styleId) throw new Error('style/apply 需要 styleId')
  if (!STYLE_TYPES.has(styleType)) {
    throw new Error(`style/apply 的 styleType 只能是 fill / stroke / text（收到 ${styleType}）`)
  }

  const node = context.host.getNodeById(nodeId)
  if (!node) throw new Error(`节点不存在: ${nodeId}（Penpot 只能查当前页）`)

  const result = await context.host.applyStyle(node, styleId, styleType as 'fill' | 'stroke' | 'text')
  return {
    ok: result.applied,
    nodeId,
    styleId,
    styleType,
    ...(result.note ? { note: result.note } : {}),
  }
}
