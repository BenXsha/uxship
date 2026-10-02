/**
 * 输出侧预算（output-side budget）—— 服务端结果的字符预算与**结构保持式截断**。
 *
 * 为什么：工具**结果**是每次调用都进 AI 上下文的付费内容。输入侧（`tools/list`）压到地板后，
 * 输出侧成为最大开销来源：`dsl_export_*` / `node_get` / `*_list` 一次能吐几十 KB。
 *
 * 三条原则：
 * 1. **永远输出合法 JSON** —— 不做「字符串切一半」（AI 会读到坏 JSON，比不截更糟）；
 * 2. **只截断、不丢结构** —— 数组截项、长字符串截尾，键名与嵌套层级保留；
 * 3. **必须解释为什么少了、怎么收窄** —— 带 `_budget.hint` 与 `_truncated` 记录，
 *    否则 AI 会把截断结果当成**完整设计**（静默截断是最坏结果）。
 *
 * 本模块是**纯函数**：不依赖 bridge / 不走网络 / 不修改入参（只读 + 构造新对象），可单测。
 */

export interface TruncationNote {
  /** 被截断字段的路径（相对响应根；数组元素用 `[]` 后缀，如 `elements[].children`） */
  field: string
  /** 实际保留的量：数组 = 条数，字符串 = 字符数 */
  shown: number
  /** 原始量：数组 = 原始条数，字符串 = 原始字符数 */
  total: number
}

export interface BudgetInfo {
  /** 本次生效的字符上限 */
  maxChars: number
  /** 返回结果的实际序列化字符数（**截断后**；未截断时等于原始长度） */
  actualChars: number
  /** 是否发生截断 */
  truncated: boolean
  /** 截断记录（最多 MAX_NOTES 条，见下） */
  notes?: TruncationNote[]
  /** 中文收窄建议：告诉 AI 为什么少了、下一步怎么拿全 */
  hint?: string
}

/**
 * 默认上限 24,000 字符（≈6–8k tokens）。
 * 依据：工具面 63 个工具合计约 38.3k 字符仍可接受，而**单次结果** 24k 已覆盖绝大多数正常查询；
 * 真正超出的都是「整页 DSL / 整棵子树 / 全量列表」，这类输出本来就该分段或落盘。
 */
export const DEFAULT_MAX_CHARS = 24_000

/**
 * 受输出预算约束的「重输出」工具（白名单）。
 *
 * 刻意**不在**清单里：
 * - `node_export_image` / `node_export_batch`：插件端已有 `maxBytes` 截断 + `savePath` 落盘机制，
 *   服务端再叠一层会让两套口径互相打架（且二进制/大文件本就该落盘而不是进上下文）；
 * - `health_get` / `dsl_spec` / `mcp_tools` / `plugin_capabilities`：诊断与工具面元数据，
 *   体积小、且是 AI 做决策的依据，截断反而有害；
 * - 写入类工具（`node_create` / `node_update` / …）：结果通常是 `{ success, id }` 级的小回执。
 */
export const HEAVY_OUTPUT_TOOLS: readonly string[] = [
  // DSL 导出（最大头：整页 / 整棵子树）
  'dsl_export_selection',
  'dsl_export_node',
  // DSL → 代码 / 增量更新（返回代码字符串与令牌）
  'design_to_code',
  'design_to_code_update',
  // 单节点 / 根节点（含可选子树快照）
  'node_get',
  'node_get_root',
  // 检索类（命中多时线性膨胀）
  'search_nodes',
  'component_list',
  'component_search',
  'variable_list',
  // 团队库（全量索引 / 全量样式）
  'team_library_list',
  'team_component_search',
  'team_style_list',
  // 代码库结构（目录树可能上万行）
  'codebase_get_structure',
  // 字体 / 样式 / 图标 / 页面清单（真机实测：fonts_list 在真实文档里可达 ~96KB，远超客户端单次输出上限）
  'fonts_list',
  'style_list_colors',
  'style_list_text',
  'icon_search',
  'page_list',
  // 轻量摘要 —— 已经是「收窄手段」，但 depth 传大时同样会膨胀，一并纳入
  'design_describe',
]

/** 单字段字符串的起始截断阈值（DSL 里的长文本、代码字符串等；后续档位逐步收紧） */
const STRING_LIMIT_STEPS = [4_000, 4_000, 2_000, 1_000, 400, 200]
/** 数组保留条数档位：从 50 起逐次减半，直到序列化长度进预算 */
const ARRAY_LIMIT_STEPS = [50, 25, 12, 6, 3, 1]
/** 兜底信封保留的原文预览长度（上限；预算很小时按比例收缩） */
const PREVIEW_CHARS = 2_000
/** 兜底信封在额度充裕时的 preview 上限（字段多的对象场景，多给一点更有用） */
const FALLBACK_PREVIEW_CAP = 8_000
/** `_budget.notes` 最多保留多少条（截断字段极多时避免「说明本身撑爆预算」） */
const MAX_NOTES = 20
/** 兜底信封里的 maxNotes 上限（比常规路径更紧，因为信封只留给 preview） */
const FALLBACK_MAX_NOTES = 8
/** 数组元素在路径里的后缀 */
const ITEM_SUFFIX = '[]'

/** 序列化（返回 undefined 表示不能序列化：循环引用 / BigInt / 顶层 undefined） */
function serialize(value: unknown): string | undefined {
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' ? text : undefined
  } catch {
    return undefined
  }
}

function measure(value: unknown): number {
  return serialize(value)?.length ?? Number.POSITIVE_INFINITY
}

function capNotes(notes: TruncationNote[], limit = MAX_NOTES): TruncationNote[] {
  return notes.length > limit ? notes.slice(0, limit) : notes
}

/** 小额度的分界：低于此额度只保留**第一条**建议 —— hint 变长会挤占 preview（见 buildFallback 的 40% 规则） */
const SMALL_BUDGET_CHARS = 2_000

/**
 * 「工具名 → 该工具真正适用的收窄手段」映射表。
 *
 * 为什么按工具分：不同工具的超限原因与收窄手段完全不同 —— `node_get` 该用 `fields`、`dsl_export_*` 该传
 * `maxDepth`、`*_list` / `search_nodes` 该调 `limit`、`codebase_get_structure` 该换个更小的目录。
 * 通用四条建议会让 AI 去用**不适用于当前工具**的参数（例如对 `search_nodes` 传 `maxDepth`），白烧一轮。
 *
 * 每个条目是最多两条**具体可执行**的建议（不要四条都堆；只写真正适用的）。
 */
const TOOL_ADVICE: Record<string, readonly string[]> = {
  // 字体 / 样式清单：客户端是「全量枚举」，没有过滤参数 → 提示收窄方式
  fonts_list: [
    '字体清单是本文件的全量枚举（可达 90KB+），没有过滤参数：需要某个节点的字体就直接 node_get 读它的 fontName，不要靠全量清单比对',
  ],
  style_list_colors: ['样式清单是全量枚举：只需要某个节点的填充就 node_get 读 fills；或先用 style_list_* 的返回值确认 styleId 后按需引用'],
  style_list_text: ['样式清单是全量枚举：只需要某个节点的文字样式就 node_get 读 fontSize/fontName'],
  // 节点查询：字段白名单是首选（id 始终返回）
  node_get: ['用 fields 只取需要的字段（如 fields:["id","name","fills"]；id 始终返回）'],
  node_get_root: [
    '用 fields 只取需要的顶层字段（如 fields:["id","name"]；id 始终返回）',
    '或传 includeSubtree:false / 调小 maxDepth，只要根与祖先信息',
  ],
  // DSL 导出：限深
  dsl_export_node: ['传 maxDepth 限制导出深度（如 maxDepth:2）', '只要布局概览时改用 design_describe'],
  dsl_export_selection: ['传 maxDepth 限制导出深度（如 maxDepth:2）', '只要布局概览时改用 design_describe'],
  // 轻量摘要：已经是收窄手段，只是 depth 传大了
  design_describe: ['传 depth 限制递归层数（如 depth:2）', '不需要样式时保持 includeStyle:false'],
  // DSL → 代码：缩小导出范围 / 走不进上下文的资产通道
  design_to_code: ['只导出子树（传 nodeId 收窄范围）', '或走 convertToCode 的 DSL 资产通道（不进上下文）'],
  design_to_code_update: ['只导出子树（传 nodeId 收窄范围）', '或走 convertToCode 的 DSL 资产通道（不进上下文）'],
  // 检索类：收窄条件
  search_nodes: [
    '收窄搜索条件（name / types / colors）或调小 limit',
    '需要整体概览时改用 design_describe 拿摘要',
  ],
  // 列表类：用各自的过滤参数
  component_list: ['用过滤参数缩小结果集（limit / type）', '或先 component_search 按名缩小范围'],
  component_search: ['调小 limit，或用 query 收窄匹配范围'],
  team_component_search: ['调小 limit，或用 library / query 收窄范围'],
  variable_list: ['用 type / collectionId 过滤变量集合'],
  team_library_list: ['用 library 指定单个团队库，避免全量索引'],
  team_style_list: ['用 library 指定单个团队库'],
  // 代码库结构：换更小的目录
  codebase_get_structure: ['传更具体的 dir 子目录（如 src/utils）', '或调小 depth'],
}

/** 其它工具（不在映射表里）的通用建议 */
const DEFAULT_ADVICE: readonly string[] = [
  '用 design_describe 拿轻量摘要',
  '或缩小查询范围 / 调大 maxChars（如 maxChars: 60000）',
]

/**
 * 生成**工具感知**的中文收窄提示。
 *
 * - 统一前缀：`输出已被截断（原 N 字符 > 上限 M）：`；
 * - 之后接该工具真正适用的建议（见 {@link TOOL_ADVICE}）；
 * - `maxChars < 2000` 时**只保留第一条建议**：小额度的额度要留给 preview（至少 40%），
 *   长提示会把 preview 挤到几乎没有（真机实测：maxChars=600 时 preview 只剩 8 个字符）。
 */
export function hintFor(toolName: string, originalChars: number, maxChars: number): string {
  const advices = TOOL_ADVICE[toolName] ?? DEFAULT_ADVICE
  const picked = maxChars < SMALL_BUDGET_CHARS ? advices.slice(0, 1) : advices
  return `输出已被截断（原 ${originalChars} 字符 > 上限 ${maxChars}）：${picked.join('；')}`
}

interface CarveResult {
  value: unknown
  /** 本层「无处安放」的截断记录：数组与长字符串自身不能挂 `_truncated`，交给最近的祖先对象 */
  homeless: TruncationNote[]
  /** 本层及以下全部截断记录（供 `_budget.notes` 汇总，每个字段只记一次） */
  all: TruncationNote[]
}

/**
 * 递归截断：超长数组截项、超长字符串截尾，标量/短字段原样保留。
 * 对象节点会把「直接子级」的截断记录挂成兄弟键 `_truncated`（数组/字符串自己挂不了键）。
 */
function carve(value: unknown, arrayLimit: number, stringLimit: number, path: string): CarveResult {
  if (typeof value === 'string') {
    if (value.length > stringLimit) {
      const note: TruncationNote = { field: path || '$', shown: stringLimit, total: value.length }
      return { value: value.slice(0, stringLimit), homeless: [note], all: [note] }
    }
    return { value, homeless: [], all: [] }
  }

  if (Array.isArray(value)) {
    const homeless: TruncationNote[] = []
    const all: TruncationNote[] = []
    const kept = value.length > arrayLimit ? value.slice(0, arrayLimit) : value
    if (kept.length < value.length) {
      // 数组自身的记录用「数组字段的路径」，元素用 `字段[]`，便于 AI 定位
      const note: TruncationNote = { field: path || '$', shown: kept.length, total: value.length }
      homeless.push(note)
      all.push(note)
    }
    const items = kept.map((item) => {
      const carved = carve(item, arrayLimit, stringLimit, `${path}${ITEM_SUFFIX}`)
      homeless.push(...carved.homeless)
      all.push(...carved.all)
      return carved.value
    })
    return { value: items, homeless, all }
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    const direct: TruncationNote[] = []
    const all: TruncationNote[] = []
    for (const [key, child] of Object.entries(source)) {
      const childPath = path ? `${path}.${key}` : key
      const carved = carve(child, arrayLimit, stringLimit, childPath)
      direct.push(...carved.homeless)
      all.push(...carved.all)
      out[key] = carved.value
    }
    if (direct.length > 0) {
      // 单条 → 对象；多条 → 数组（同一层多个字段被截时只占一个兄弟键）
      out._truncated = direct.length === 1 ? direct[0] : direct
    }
    return { value: out, homeless: [], all }
  }

  // number / boolean / null / undefined：原样保留
  return { value, homeless: [], all: [] }
}

/**
 * 把预算对象挂到结果上：
 * - 根是对象 → 直接在根上追加 `_budget`（结构不变，`_truncated` 由 carve 已挂好）；
 * - 根是数组/标量 → 包一层 `{ _budget, _truncated?, data }` 信封（不丢数据，只补一层）。
 */
function rootWithBudget(carved: CarveResult, budget: BudgetInfo): Record<string, unknown> {
  const value = carved.value
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>), _budget: budget }
  }
  const envelope: Record<string, unknown> = { _budget: budget, data: value }
  if (carved.homeless.length > 0) {
    envelope._truncated = carved.homeless.length === 1 ? carved.homeless[0] : carved.homeless
  }
  return envelope
}

/** 定长点：`actualChars` 的位数会影响自身长度，迭代到稳定（通常 2 轮内收敛） */
function finalize(envelope: Record<string, unknown>): void {
  const budget = envelope._budget as BudgetInfo
  for (let i = 0; i < 4; i++) {
    const len = serialize(envelope)?.length ?? 0
    if (budget.actualChars === len) break
    budget.actualChars = len
  }
}

/**
 * 兜底信封：所有档位都放不下时（例如上万个短字段的巨型对象），
 * 只保留原文预览 + 说明，**绝不允许输出远超上限**。
 */
function buildFallback(originalText: string, maxChars: number, notes: TruncationNote[], hint: string): { payload: Record<string, unknown>; budget: BudgetInfo } {
  const total = originalText.length
  const keptNotes = capNotes(notes, FALLBACK_MAX_NOTES)

  // 小额度的坑（真机实测）：一旦 hint 写成「四条通用建议」（~180 字符），maxChars=600 时它会吃光大局部额，
  // preview 只剩 8 个字符 —— 等于什么数据都没看到。所以：
  //   ① 额度小时 hintFor 已只给**第一条**建议（短提示）；② 仍保证 preview 至少拿到 40% 额度
  //      （连第一条建议都放不下时可被压到最短，甚至丢 hint）。
  const minPreview = Math.floor(maxChars * 0.4)
  const effectiveHint = hint

  const makeBudget = (withNotes: boolean, withHint: boolean): BudgetInfo => ({
    maxChars,
    actualChars: 0,
    truncated: true,
    ...(withNotes && keptNotes.length > 0 ? { notes: keptNotes } : {}),
    ...(withHint ? { hint: effectiveHint } : {}),
  })

  // 逐字段明细已在 _budget.notes 里；顶层 `_truncated` 说明的是「preview 被截了」
  const build = (previewChars: number, withNotes = true, withHint = true): Record<string, unknown> => ({
    _budget: makeBudget(withNotes, withHint),
    _truncated: { field: '$', shown: previewChars, total },
    preview: originalText.slice(0, previewChars),
  })

  // 先量「说明部分」（budget + hint）占多少，剩余额度才留给 preview，
  // 再用一次收缩迭代兜住估算误差 —— 保证兜底信封不超预算
  let shellChars = serialize(build(0))?.length ?? 0
  // 额度太小 → 逐级降配说明：先丢 notes，再丢 hint，只为把 preview 留到 minPreview
  let dropNotes = false
  let dropHint = false
  if (maxChars - shellChars < minPreview) {
    dropNotes = true
    shellChars = serialize(build(0, false, true))?.length ?? 0
    if (maxChars - shellChars < minPreview) {
      dropHint = true
      shellChars = serialize(build(0, false, false))?.length ?? 0
    }
  }

  // 额度充裕时应该多给可用数据：兜底路径的典型场景是「字段很多的对象」（如目录结构），
  // 多给几千字符预览是有用信息；而巨型单值字符串走的是字符串截断档，不会落到这里。
  const previewCap = Math.max(PREVIEW_CHARS, Math.min(FALLBACK_PREVIEW_CAP, maxChars - shellChars))
  let previewChars = Math.max(0, Math.min(previewCap, maxChars - shellChars))
  let envelope = build(previewChars, !dropNotes, !dropHint)
  for (let i = 0; i < 4; i++) {
    finalize(envelope) // 先把 actualChars 写成定长点，再量（否则末次修正会多出几位数）
    const over = measure(envelope) - maxChars
    if (over <= 0 || previewChars === 0) break
    previewChars = Math.max(0, previewChars - over)
    envelope = build(previewChars, !dropNotes, !dropHint)
  }
  finalize(envelope)
  // 返回信封里那份（而不是另建对象）：避免「_budget 与返回值不一致」的隐蔽 bug
  return { payload: envelope, budget: envelope._budget as BudgetInfo }
}

/**
 * 对工具结果套用输出预算。
 *
 * 口径：
 * - `maxChars` 缺省 = {@link DEFAULT_MAX_CHARS}；**传 0 或负数 = 不限制**（逃生阀，原样返回且不带 budget）；
 * - 未超限 → **原样返回同一引用**，只附带 `budget.truncated: false`（不重排 JSON 字节）；
 * - 超限 → 结构保持式截断 + `_budget` / `_truncated`；`actualChars` = **截断后**实际序列化长度；
 * - `payload` 是 `undefined` / 循环引用等无法度量的对象 → 不介入（原样返回，避免把响应改坏）；
 * - `toolName` 仅用于调用侧白名单接线与日志上下文，**预算口径对任何工具名一致**。
 */
export function applyResponseBudget(
  toolName: string,
  payload: unknown,
  options?: { maxChars?: number },
): { payload: unknown; budget?: BudgetInfo } {
  // 预算口径与工具名无关；toolName 只用来选 hintFor 的工具感知建议
  const rawMax = options?.maxChars
  const maxChars = typeof rawMax === 'number' && Number.isFinite(rawMax) ? rawMax : DEFAULT_MAX_CHARS

  // 逃生阀：0 / 负数 = 明确要求「不要限制」
  if (maxChars <= 0) return { payload }

  const originalText = serialize(payload)
  if (originalText === undefined) return { payload }
  const original = originalText.length

  if (original <= maxChars) {
    return { payload, budget: { maxChars, actualChars: original, truncated: false } }
  }

  const hint = hintFor(toolName, original, maxChars)

  // 逐档收紧（数组条数减半 + 字符串阈值收缩），第一个进预算的档位即结果
  let tightest: CarveResult = { value: payload, homeless: [], all: [] }
  for (let i = 0; i < ARRAY_LIMIT_STEPS.length; i++) {
    const carved = carve(payload, ARRAY_LIMIT_STEPS[i], STRING_LIMIT_STEPS[i], '')
    tightest = carved
    const budget: BudgetInfo = {
      maxChars,
      actualChars: 0,
      truncated: true,
      ...(carved.all.length > 0 ? { notes: capNotes(carved.all) } : {}),
      hint,
    }
    const candidate = rootWithBudget(carved, budget)
    finalize(candidate)
    if (measure(candidate) <= maxChars) return { payload: candidate, budget }
  }

  // 兜底：连最紧的档位都放不下
  return buildFallback(originalText, maxChars, tightest.all, hint)
}
