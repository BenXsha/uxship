/**
 * 字段白名单过滤（`fields` 参数）—— 输出侧的**主动**收窄手段。
 *
 * 与 `response-budget.ts` 的关系：预算是「超限后的被动截断」，`fields` 是「调用前的主动选择」。
 * AI 只想要 `id` / `name` / `fills` 时，不该把整棵树拉进上下文再被截断 —— 那样既费钱又丢信息。
 *
 * 语义（刻意保持简单可预测）：
 * - **只过滤顶层**，不递归子对象（嵌套子树可能正是要看的内容，递归会出意外）；
 * - **`id` 永远保留**（AI 定位/续查节点必需）；
 * - 数组 → 对每个元素逐个过滤（`missing` 取并集）；
 * - 未命中的字段名进 `missing` —— 这是**关键反馈**：AI 能立刻知道自己字段名写错了；
 * - 本模块是**纯函数**：不修改入参（只读 + 构造新对象），可单测。
 */

export interface FieldFilterResult {
  /** 过滤后的新 payload（未过滤时原样返回同一引用） */
  payload: unknown
  /** 实际保留下来的字段名（含自动保留的 `id`） */
  kept: string[]
  /** 请求了但源对象里不存在的字段名（说明字段名写错或层级不对） */
  missing: string[]
}

/** 永远保留的字段：AI 用它定位节点、继续查询 */
const ALWAYS_KEPT = 'id'

/**
 * 解析 `fields` 参数：数组或逗号分隔字符串 → 去重去空。
 * 大小写**不做归一**（JSON 键大小写敏感；写错会在 `missing` 里回报，而不是被静默纠正）。
 */
export function parseFields(raw: unknown): string[] {
  let items: unknown[]
  if (Array.isArray(raw)) items = raw
  else if (typeof raw === 'string') items = raw.split(',')
  else return []

  const out: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (typeof item !== 'string') continue // 数组里混进数字/对象 → 忽略
    const name = item.trim()
    if (name.length === 0 || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

function hasKey(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key)
}

/** 过滤单个对象：只留列出的键（+ 永远保留 id），并把未命中项记进 missing */
function filterObject(
  source: Record<string, unknown>,
  fields: string[],
): { value: Record<string, unknown>; kept: string[]; missing: string[] } {
  const value: Record<string, unknown> = {}
  const kept: string[] = []
  const missing: string[] = []
  for (const name of fields) {
    if (hasKey(source, name)) {
      value[name] = source[name]
      kept.push(name)
    } else {
      missing.push(name)
    }
  }
  // id 始终保留（若请求里已含 id 则上面已处理；源里没有 id 则自然进 missing）
  if (hasKey(source, ALWAYS_KEPT) && !hasKey(value, ALWAYS_KEPT)) {
    value[ALWAYS_KEPT] = source[ALWAYS_KEPT]
    kept.push(ALWAYS_KEPT)
  }
  return { value, kept, missing }
}

/**
 * 按 `fields` 过滤 payload。
 *
 * - `fields` 为空 → 原样返回（`kept` / `missing` 为空数组）；
 * - 对象 → 只保留列出的键 + 永远保留 `id`；
 * - 数组 → 对每个元素递归过滤（只下钻一层数组，元素内部不再递归）；`missing` 取并集；
 * - 非对象元素（字符串 / 数字 / null）原样通过；
 * - `null` / `undefined` → 安全返回。
 */
export function filterFields(payload: unknown, fields: string[]): FieldFilterResult {
  if (!Array.isArray(fields) || fields.length === 0) {
    return { payload, kept: [], missing: [] }
  }

  if (Array.isArray(payload)) {
    const keptSet = new Set<string>()
    const missingSet = new Set<string>()
    const value = payload.map((item) => {
      // 数组元素逐个过滤；非对象元素（字符串/数字/null）原样通过
      if (item === null || typeof item !== 'object' || Array.isArray(item)) return item
      const filtered = filterObject(item as Record<string, unknown>, fields)
      for (const name of filtered.kept) keptSet.add(name)
      for (const name of filtered.missing) missingSet.add(name)
      return filtered.value
    })
    return { payload: value, kept: [...keptSet], missing: [...missingSet] }
  }

  if (payload !== null && typeof payload === 'object') {
    const filtered = filterObject(payload as Record<string, unknown>, fields)
    return { payload: filtered.value, kept: filtered.kept, missing: filtered.missing }
  }

  // 顶层标量：无从过滤，原样返回
  return { payload, kept: [], missing: [] }
}
