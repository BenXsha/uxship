/**
 * 变量系统（Design Token）处理器
 *
 * 通过 MasterGo 插件 API `mg.variables`（VariableAPI）读写文档级 Design Token：
 * - `variable/list`   — 列出变量集合 / 模式 / 变量（可选值）；空文档返回空结果，不报错
 * - `variable/create` — 创建变量（文档内无集合时自动建一个 "Design Tokens"），可顺带写入初始值
 * - `variable/update` — 按传入字段增量更新（name / description / value / codeSyntax / scopes / alias）
 * - `variable/delete` — 按 id 或 ids 批量删除，逐个回报失败原因
 *
 * 设计约定：
 * - 处理器返回「裸对象」，由 dispatcher 包成 JSON-RPC result（与 component/list 等保持一致）
 * - `mg.variables` 整体缺失（老客户端）时 `variable/list` 返回 `available:false` 且**不抛错**；
 *   写操作则抛明确错误（写不了必须让调用方知道）
 * - 单个宿主方法缺失 / 单个变量操作失败时收集 warnings / failed，不让整单崩
 * - 变量值统一来自 `Variable.modes`（modeId → 值数组）：长度为 1 时取标量，0 个或多个原样返回数组
 * - 宿主实测（MasterGoPrivate 1.10.3）：mg.variables 全组可用，但文档可能没有任何变量数据
 */

import type { HandlerContext, HandlerFunction } from './index'

// ─── 类型 ────────────────────────────────────────────

/** 归一化后的变量（跨 mode 的值见 values） */
export interface NormalizedVariable {
  id: string
  name: string
  type: string
  description: string
  alias: string
  isExternal: boolean
  supportScope: boolean
  codeSyntax?: { web?: string; android?: string; ios?: string }
  scopes?: string[]
  /** modeId → 值（单值 mode 取标量，多值 mode 原样数组）；includeValues === false 时不返回该字段 */
  values?: Record<string, unknown>
}

export interface VariableListParams {
  collectionId?: string
  type?: string
  groupPath?: string
  includeExternal?: boolean
  includeValues?: boolean
}

export interface VariableCreateParams {
  name: string
  type: string
  value?: any
  collectionId?: string
  description?: string
}

export interface VariableUpdateParams {
  id: string
  name?: string
  description?: string
  value?: any
  modeId?: string
  codeSyntax?: { web?: string; android?: string; ios?: string }
  scopes?: string[]
  alias?: string
}

export interface VariableDeleteParams {
  id?: string
  ids?: string[]
}

const NOT_SUPPORTED_MSG =
  '当前客户端不支持变量 API（mg.variables 不可用）。' +
  '请升级 MasterGo 桌面端 / 插件 API 版本后重试（Design Token 能力依赖该 API）。'

// ─── API 可用性 ───────────────────────────────────────

function variableApi(): any {
  return (mg as any)?.variables
}

/** mg.variables 是否可用（以 getCollections 为探针） */
export function isVariableApiSupported(): boolean {
  return typeof variableApi()?.getCollections === 'function'
}

function errMsg(err: any): string {
  return err instanceof Error ? err.message : String(err)
}

/** 安全调用：宿主方法抛错时返回 fallback，并把原因收进 warnings */
function tryCall<T>(warnings: string[], label: string, fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (err) {
    warnings.push(`${label}失败：${errMsg(err)}`)
    return fallback
  }
}

/** 提交撤销记录（宿主不保证提供 commitUndo） */
function commitUndo(): void {
  const fn = (mg as any)?.commitUndo
  if (typeof fn === 'function') fn()
}

// ─── 归一化 ───────────────────────────────────────────

/** `Variable.modes` → 扁平值表：单值 mode 取标量，多值 mode 原样数组 */
function normalizeValues(modes: any, includeValues: boolean): Record<string, unknown> | undefined {
  if (!includeValues) return undefined
  const out: Record<string, unknown> = {}
  if (!modes || typeof modes !== 'object') return out
  for (const [modeId, raw] of Object.entries(modes as Record<string, unknown>)) {
    const list = Array.isArray(raw) ? raw : [raw]
    out[modeId] = list.length === 1 ? list[0] : list
  }
  return out
}

function normalizeVariable(raw: any, includeValues = true): NormalizedVariable {
  const out: NormalizedVariable = {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? ''),
    type: String(raw?.type ?? ''),
    description: String(raw?.description ?? ''),
    alias: String(raw?.alias ?? ''),
    isExternal: raw?.isExternal === true,
    supportScope: raw?.supportScope === true,
  }
  if (raw?.codeSyntax && typeof raw.codeSyntax === 'object') out.codeSyntax = raw.codeSyntax
  if (Array.isArray(raw?.scopes) && raw.scopes.length > 0) out.scopes = raw.scopes.map((s: any) => String(s))
  const values = normalizeValues(raw?.modes, includeValues)
  if (values) out.values = values
  return out
}

/** 集合的模式 → [{ id, name }] */
function normalizeModes(rawModes: any): Array<{ id: string; name: string }> {
  const list = Array.isArray(rawModes) ? rawModes : []
  return list.map((m: any) => ({ id: String(m?.id ?? ''), name: String(m?.name ?? '') }))
}

/** 读取变量（宿主缺方法 / 抛错时不崩，返回 null） */
function lookupVariable(api: any, id: string, warnings: string[]): any {
  if (typeof api?.getVariableById !== 'function') return null
  return tryCall(warnings, `读取变量 ${id}`, () => api.getVariableById(id) ?? null, null)
}

/** 静默读取（探查默认 mode 时不需要噪音 warning） */
function readQuiet(fn: () => any): any {
  try {
    return fn()
  } catch {
    return null
  }
}

/**
 * 求「所属集合的第一个 mode」
 * 顺序：getModes(collectionId) → 变量自身 modes 的键 → collection.modes
 */
function resolveDefaultModeId(api: any, collectionId: string, variable?: any): string {
  if (collectionId && typeof api?.getModes === 'function') {
    const list = readQuiet(() => api.getModes(collectionId)) || []
    if (list[0]?.id) return String(list[0].id)
  }
  const fromVariable = Object.keys(variable?.modes || {})[0]
  if (fromVariable) return fromVariable
  if (collectionId && typeof api?.getCollectionById === 'function') {
    const col = readQuiet(() => api.getCollectionById(collectionId))
    if (col?.modes?.[0]?.id) return String(col.modes[0].id)
  }
  return ''
}

// ─── variable/list ────────────────────────────────────

/**
 * 列出变量集合 / 模式 / 变量
 *
 * 空集合、零变量都返回空数组；`mg.variables` 缺失时返回 `available:false`（不抛错），
 * 这样 AI 在旧客户端上仍能拿到结构化结果而不是一条报错。
 */
async function handleVariableList(params: VariableListParams = {}): Promise<any> {
  const api = variableApi()
  if (typeof api?.getCollections !== 'function') {
    return {
      available: false,
      collections: [],
      stats: { collections: 0, variables: 0 },
      reason: '当前客户端不支持变量 API (mg.variables)',
    }
  }

  const warnings: string[] = []
  const includeExternal = params.includeExternal === true
  const includeValues = params.includeValues !== false
  const wantedType = params.type ? String(params.type) : ''
  const groupPath = params.groupPath ? String(params.groupPath) : ''

  const rawCollections = tryCall<any[]>(
    warnings,
    '读取变量集合',
    () => api.getCollections(includeExternal) || [],
    [],
  )
  const allCollections = Array.isArray(rawCollections) ? rawCollections : []

  let selected = allCollections
  if (params.collectionId) {
    selected = allCollections.filter((c: any) => String(c?.id) === String(params.collectionId))
    if (selected.length === 0) {
      const available = allCollections.map((c: any) => `${c?.name}(${c?.id})`).join(', ')
      warnings.push(
        `未找到变量集合 "${params.collectionId}"，可用集合：${available || '（无）'}`,
      )
    }
  }

  const canGetVariables = typeof api.getVariables === 'function'
  if (!canGetVariables) {
    warnings.push('当前客户端未提供 mg.variables.getVariables()，无法列出变量')
  }

  const collections: any[] = []
  let total = 0

  for (const col of selected) {
    const variables: NormalizedVariable[] = []

    if (canGetVariables) {
      const options: any = { collectionId: col?.id }
      if (wantedType) options.type = wantedType
      if (groupPath) options.groupPath = groupPath

      const rawList = tryCall<any[]>(
        warnings,
        `读取集合 "${col?.name ?? col?.id}" 的变量`,
        () => api.getVariables(options) || [],
        [],
      )

      for (const raw of Array.isArray(rawList) ? rawList : []) {
        // type 兜底过滤：部分客户端不按 type 过滤，这里再筛一遍
        if (wantedType && String(raw?.type ?? '') !== wantedType) continue
        variables.push(normalizeVariable(raw, includeValues))
      }
    }

    total += variables.length
    collections.push({
      id: String(col?.id ?? ''),
      name: String(col?.name ?? ''),
      isExternal: col?.isExternal === true,
      modes: normalizeModes(col?.modes),
      variableCount: variables.length,
      variables,
    })
  }

  return {
    available: true,
    collections,
    stats: { collections: collections.length, variables: total },
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

// ─── variable/create ──────────────────────────────────

/**
 * 创建变量
 *
 * collectionId 缺省时取文档里的第一个集合；一个集合都没有则先创建 "Design Tokens"。
 * 传入 value 时用该集合的第一个 mode 调 `setVariableValue`（失败只记 warning，变量已创建）。
 */
async function handleVariableCreate(params: VariableCreateParams): Promise<any> {
  const name = typeof params?.name === 'string' ? params.name.trim() : ''
  const type = typeof params?.type === 'string' ? params.type.trim() : ''
  if (!name) {
    throw new Error('缺少必需参数: name（变量名，支持 "color/brand/primary" 这样的分组路径）')
  }
  if (!type) {
    throw new Error(
      '缺少必需参数: type（Design Token 类型：STRING / BOOLEAN / COLOR / NUMBER / PAINT / TEXT / EFFECT / GRID 之一）',
    )
  }
  if (!isVariableApiSupported()) throw new Error(NOT_SUPPORTED_MSG)

  const api = variableApi()
  const warnings: string[] = []
  let collectionId = params.collectionId ? String(params.collectionId) : ''
  let createdCollectionId: string | undefined

  if (!collectionId) {
    let collections: any[] = []
    if (typeof api.getCollections === 'function') {
      collections = tryCall<any[]>(warnings, '读取变量集合', () => api.getCollections(false) || [], [])
    } else {
      warnings.push('当前客户端未提供 mg.variables.getCollections()')
    }
    const first = Array.isArray(collections) ? collections[0] : null
    if (first?.id) {
      collectionId = String(first.id)
    } else {
      if (typeof api.createCollection !== 'function') {
        throw new Error(
          '文档中没有任何变量集合，且当前客户端未提供 mg.variables.createCollection()，无法自动创建集合',
        )
      }
      const created = await api.createCollection('Design Tokens')
      if (!created?.id) {
        throw new Error('自动创建变量集合失败：createCollection() 返回空（可显式传 collectionId）')
      }
      collectionId = String(created.id)
      createdCollectionId = collectionId
    }
  }

  if (typeof api.createVariable !== 'function') {
    throw new Error('当前客户端未提供 mg.variables.createVariable()，无法创建变量')
  }

  const options: any = { name, type, collectionId }
  if (params.description !== undefined) options.description = String(params.description)

  const created = await api.createVariable(options)
  if (!created?.id) {
    throw new Error(`变量创建失败：createVariable() 未返回变量（name=${name}, type=${type}）`)
  }

  let current = created
  if (params.value !== undefined) {
    const modeId = resolveDefaultModeId(api, collectionId, created)
    if (!modeId) {
      warnings.push('该变量集合没有可用 mode，已跳过初始值写入')
    } else if (typeof api.setVariableValue !== 'function') {
      warnings.push('当前客户端未提供 mg.variables.setVariableValue()，已跳过初始值写入')
    } else {
      try {
        const updated = await api.setVariableValue({ id: created.id, value: params.value, modeId })
        // 回读复核：宿主写值异步生效，直接回传会让 AI 以为没写上
        const fresh = await confirmValueWrite(api, created.id, params.value, modeId, warnings)
        if (fresh) current = fresh
        else if (updated) current = updated
      } catch (err) {
        warnings.push(`写入初始值失败（变量已创建）：${errMsg(err)}`)
      }
    }
  }

  commitUndo()

  return {
    success: true,
    variable: normalizeVariable(current, true),
    ...(createdCollectionId ? { createdCollectionId } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

// ─── variable/update ──────────────────────────────────

/**
 * 增量更新变量
 *
 * 只调用与「实际传入字段」对应的宿主方法，未传的字段一律不触碰
 * （`applied` 精确回报真正生效的字段，宿主缺方法 / 单步失败进 warnings）。
 */
async function handleVariableUpdate(params: VariableUpdateParams): Promise<any> {
  const id = typeof params?.id === 'string' ? params.id : ''
  if (!id) {
    throw new Error('缺少必需参数: id（变量 ID，可用 variable_list 获取）')
  }

  const writableFields = ['name', 'description', 'value', 'codeSyntax', 'scopes', 'alias'] as const
  const provided = writableFields.filter((key) => (params as any)[key] !== undefined)
  if (provided.length === 0) {
    throw new Error(
      '未提供任何可更新字段：至少传入 name / description / value / codeSyntax / scopes / alias 之一',
    )
  }
  if (!isVariableApiSupported()) throw new Error(NOT_SUPPORTED_MSG)

  const api = variableApi()
  const warnings: string[] = []
  const applied: string[] = []
  /** 宿主返回的最新变量（任一步返回即刷新） */
  let latest: any = null

  // 1) name → renameVariable(variableId, name)
  if (params.name !== undefined) {
    if (typeof api.renameVariable !== 'function') {
      warnings.push('当前客户端未提供 mg.variables.renameVariable()，已跳过 name 更新')
    } else {
      try {
        api.renameVariable(id, String(params.name))
        applied.push('name')
      } catch (err) {
        warnings.push(`重命名失败：${errMsg(err)}`)
      }
    }
  }

  // 2) description → setVariableDescription
  if (params.description !== undefined) {
    if (typeof api.setVariableDescription !== 'function') {
      warnings.push('当前客户端未提供 mg.variables.setVariableDescription()，已跳过 description 更新')
    } else {
      try {
        const updated = await api.setVariableDescription(id, String(params.description))
        if (updated) latest = updated
        applied.push('description')
      } catch (err) {
        warnings.push(`更新描述失败：${errMsg(err)}`)
      }
    }
  }

  // 3) value → setVariableValue（modeId 缺省用该变量所属集合的第一个 mode）
  if (params.value !== undefined) {
    const target = lookupVariable(api, id, warnings)
    const modeId = params.modeId
      ? String(params.modeId)
      : resolveDefaultModeId(api, String(target?.collectionId ?? ''), target)

    if (!modeId) {
      warnings.push('无法确定变量所属集合的 mode，已跳过 value 更新（可显式传 modeId）')
    } else if (typeof api.setVariableValue !== 'function') {
      warnings.push('当前客户端未提供 mg.variables.setVariableValue()，已跳过 value 更新')
    } else {
      try {
        const updated = await api.setVariableValue({ id, value: params.value, modeId })
        const fresh = await confirmValueWrite(api, id, params.value, modeId, warnings)
        if (fresh) latest = fresh
        else if (updated) latest = updated
        applied.push('value')
      } catch (err) {
        warnings.push(`写入变量值失败：${errMsg(err)}`)
      }
    }
  }

  // 4) codeSyntax → setCodeSyntax
  if (params.codeSyntax !== undefined) {
    if (typeof api.setCodeSyntax !== 'function') {
      warnings.push('当前客户端未提供 mg.variables.setCodeSyntax()，已跳过 codeSyntax 更新')
    } else {
      try {
        const updated = await api.setCodeSyntax(id, params.codeSyntax)
        if (updated) latest = updated
        applied.push('codeSyntax')
      } catch (err) {
        warnings.push(`更新 codeSyntax 失败：${errMsg(err)}`)
      }
    }
  }

  // 5) scopes → setVariableScopes
  if (params.scopes !== undefined) {
    if (typeof api.setVariableScopes !== 'function') {
      warnings.push('当前客户端未提供 mg.variables.setVariableScopes()，已跳过 scopes 更新')
    } else {
      try {
        const scopes = Array.isArray(params.scopes) ? params.scopes : [params.scopes]
        const updated = await api.setVariableScopes(id, scopes as any)
        if (updated) latest = updated
        applied.push('scopes')
      } catch (err) {
        warnings.push(`更新 scopes 失败：${errMsg(err)}`)
      }
    }
  }

  // 6) alias → setVariableAlias
  if (params.alias !== undefined) {
    if (typeof api.setVariableAlias !== 'function') {
      warnings.push('当前客户端未提供 mg.variables.setVariableAlias()，已跳过 alias 更新')
    } else {
      try {
        const updated = await api.setVariableAlias(id, String(params.alias))
        if (updated) latest = updated
        applied.push('alias')
      } catch (err) {
        warnings.push(`更新 alias 失败：${errMsg(err)}`)
      }
    }
  }

  let variable: any
  if (!latest) latest = lookupVariable(api, id, warnings)
  if (latest) {
    variable = normalizeVariable(latest, true)
  } else {
    warnings.push('未能回读变量最新状态，仅返回变量 id')
    variable = { id }
  }

  if (applied.length > 0) commitUndo()

  return {
    success: true,
    variable,
    applied,
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

// ─── variable/delete ──────────────────────────────────

/**
 * 删除变量（单个 id 或批量 ids）或整个变量集合（collectionId / collectionIds）
 *
 * 逐个删除，部分失败不中断：全部成功才 `success: true`。
 * 集合删除会连其中变量一起删除（MasterGo `deleteCollection` 语义），返回值里如实列出集合 id。
 */
async function handleVariableDelete(params: VariableDeleteParams): Promise<any> {
  const rawCollectionIds: any[] = Array.isArray((params as any)?.collectionIds)
    ? (params as any).collectionIds
    : (params as any)?.collectionId !== undefined
      ? [(params as any).collectionId]
      : []
  const collectionIds: string[] = [
    ...new Set(rawCollectionIds.map((v: any) => String(v ?? '')).filter((v: string) => v.length > 0)),
  ]

  const rawIds = Array.isArray(params?.ids)
    ? params.ids
    : params?.id !== undefined
      ? [params.id]
      : []
  const ids = [...new Set(rawIds.map((v) => String(v ?? '')).filter((v) => v.length > 0))]

  if (ids.length === 0 && collectionIds.length === 0) {
    throw new Error('需要提供 id / ids（变量）或 collectionId / collectionIds（集合，会连其中变量一起删除）')
  }

  const api = variableApi()
  const deleted: string[] = []
  const deletedCollections: string[] = []
  const failed: Array<{ id: string; error: string }> = []

  // 1) 集合删除（含集合内变量）
  if (collectionIds.length > 0) {
    if (typeof api?.deleteCollection !== 'function') {
      const reason = '当前客户端未提供 mg.variables.deleteCollection()'
      for (const collectionId of collectionIds) failed.push({ id: collectionId, error: reason })
    } else {
      for (const collectionId of collectionIds) {
        try {
          api.deleteCollection(collectionId)
          deletedCollections.push(collectionId)
        } catch (err) {
          failed.push({ id: collectionId, error: errMsg(err) })
        }
      }
    }
  }

  // 2) 变量删除
  if (ids.length > 0) {
    if (typeof api?.deleteVariable !== 'function') {
      const reason = '当前客户端未提供 mg.variables.deleteVariable()'
      for (const id of ids) failed.push({ id, error: reason })
    } else {
      for (const id of ids) {
        try {
          api.deleteVariable(id)
          deleted.push(id)
        } catch (err) {
          failed.push({ id, error: errMsg(err) })
        }
      }
    }
  }

  if (deleted.length > 0 || deletedCollections.length > 0) commitUndo()

  return {
    success: failed.length === 0,
    deleted,
    ...(deletedCollections.length > 0 ? { deletedCollections } : {}),
    failed,
  }
}

// ─── 处理器注册表 ─────────────────────────────────────

/** 变量 mode 值的颜色元组（兼容 `{r,g,b,a}` 与宿主的 `{floatData:[r,g,b,a]}`） */
function toColorTuple(value: any): number[] | null {
  if (!value || typeof value !== 'object') return null
  if (typeof value.r === 'number') return [value.r, value.g, value.b, value.a ?? 1]
  if (Array.isArray(value.floatData)) return value.floatData
  return null
}

/** 宽松比较「写入的变量值」与「宿主的 mode 值」（形状/浮点误差都要容忍） */
export function sameVariableValue(requested: any, actual: any): boolean {
  const unwrap = (v: any) => (Array.isArray(v) && v.length === 1 ? v[0] : v)
  const req = unwrap(requested)
  const act = unwrap(actual)
  if (req === act) return true

  const a = toColorTuple(req)
  const b = toColorTuple(act)
  if (a && b) {
    return a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < 1e-3)
  }

  if (req === null || act === null) return false
  if (typeof req !== 'object' || typeof act !== 'object') return false
  try {
    return JSON.stringify(req) === JSON.stringify(act)
  } catch {
    return false
  }
}

/**
 * 写值后确认回读。
 *
 * 实测（私有版 1.10.3）：`setVariableValue` 解析后**同一拍回读仍是旧值**（异步生效），
 * 直接回传会误导 AI「值没写上」。所以：先直接读一次，不匹配就等一拍再读，
 * 仍不匹配则如实告警（不谎报成功）。
 */
async function confirmValueWrite(
  api: any,
  id: string,
  requested: any,
  modeId: string,
  warnings: string[]
): Promise<any | null> {
  const modeValue = (v: any) => v?.modes?.[modeId]
  let fresh = lookupVariable(api, id, [])
  if (fresh && sameVariableValue(requested, modeValue(fresh))) return fresh

  try {
    // 让出一拍：宿主变量值异步提交
    await new Promise((resolve) => setTimeout(resolve, 20))
  } catch {
    // 无常量定时器的宿主环境：跳过等待，直接复核
  }
  fresh = lookupVariable(api, id, []) ?? fresh
  if (!fresh || !sameVariableValue(requested, modeValue(fresh))) {
    warnings.push(
      '值已提交，但客户端回读尚未刷新（MasterGo 变量值异步生效），稍后可用 variable_list 复核'
    )
  }
  return fresh
}

/**
 * 变量（Design Token）方法注册表
 *
 * 键为插件方法名，由 dispatcher 按 `variable_list` → `variable/list` 的映射转发。
 * 注意：本文件只导出注册表，接入 `lib/api/index.ts` 由统一接线完成。
 */
export const variableHandlers: Record<string, HandlerFunction> = {
  'variable/list': handleVariableList,
  'variable/create': handleVariableCreate,
  'variable/update': handleVariableUpdate,
  'variable/delete': handleVariableDelete,
  'variable/apply': handleVariableApply,
}

/**
 * `variable/apply`（MasterGo 侧）：**运行时探测**能不能把变量绑到图层属性。
 *
 * 为什么是探测而不是实现：`mg.variables` 在本项目里是 `any`（`plugin-mastergo/typings/`
 * 没有变量绑定的类型声明），而**声明存在也不代表运行时存在**。审计结论（
 * `内部笔记` §145/§172）是本插件从未回写变量绑定，
 * 且 MasterGo 侧没有 `setBoundVariable/boundVariable` 这条通道 —— 与 Penpot 的
 * `shape.applyToken()` 真绑定形成对照。
 *
 * 所以这里只做两件事：探测（把证据带出来）、如实回 `available:false`。
 * 探到疑似 API 也不调 —— 参数契约未核对前调它就是猜（按 `17-host-differences.md` §7 纪律）。
 */
export async function handleVariableApply(params: any, context: HandlerContext): Promise<any> {
  const name = String(params?.name ?? params?.variableId ?? '')
  const nodeIds: string[] = [
    ...(Array.isArray(params?.nodeIds) ? params.nodeIds.map(String) : []),
    ...(typeof params?.nodeId === 'string' && params.nodeId ? [params.nodeId] : []),
  ]

  const evidence: string[] = []

  // 1) 宿主变量命名空间上是否有绑定形方法
  const api = variableApi()
  const apiCandidates = ['bindToNode', 'applyToNode', 'setBoundVariable', 'bindToNodes']
  const foundOnApi = apiCandidates.filter((key) => typeof api?.[key] === 'function')
  evidence.push(
    foundOnApi.length
      ? `mg.variables 上探测到 ${foundOnApi.join('/')}（契约未核对，未调用）`
      : `mg.variables 无绑定形方法（已查 ${apiCandidates.join('/')}）`,
  )

  // 2) 节点上是否有绑定字段/方法（用调用方给的第一个节点做样本）
  if (nodeIds.length > 0) {
    const sample = mg.getNodeById(nodeIds[0]) as any
    if (sample) {
      const hasField = sample.boundVariables !== undefined
      const hasMethod = typeof sample.setBoundVariable === 'function'
      evidence.push(
        hasMethod || hasField
          ? `节点样本 ${nodeIds[0]} 探测到 ${hasMethod ? 'setBoundVariable()' : 'boundVariables'}（契约未核对，未调用）`
          : `节点样本 ${nodeIds[0]} 无 boundVariables / setBoundVariable`,
      )
    } else {
      evidence.push(`节点样本 ${nodeIds[0]} 未取到（跳过节点探测）`)
    }
  }

  return {
    available: false,
    model: 'mastergo-variables',
    ...(name ? { name } : {}),
    total: nodeIds.length,
    applied: 0,
    reason: 'MasterGo 侧本插件没有把变量绑定到图层属性的实现（DSL 渲染不回写绑定）',
    probe: evidence,
    hint: '改用 variable_update 直接改值，或回到 Penpot 侧走 shape.applyToken 的真绑定',
  }
}
