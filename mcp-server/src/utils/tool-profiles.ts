/**
 * 工具面 profile —— 按任务渐进披露工具
 *
 * 背景：MCP 的 `tools/list` 会**整份注入 AI 上下文**。压缩到 63 个业务工具 / 约 3.8 万字符后，
 * 参数骨架已接近地板（253 个参数的「名字+类型+JSON 骨架」≈1.9 万字符不可再压）。
 * 唯一剩下的大杠杆是**按任务只暴露需要的工具**：典型设计生成只用到 11–20 个工具，
 * 其余工具的 schema 属于纯上下文浪费，也是工具误选的主要来源。
 *
 * 两类 profile（语义不同，别混用）：
 * - **任务形状**：`gen` —— 显式工具清单，「从需求/HTML 到画布」这条路真正会用到的工具，
 *   目标 ≤20 个工具 / ≤8k 字符，是设计生成会话的推荐默认。
 * - **领域全集**：`core` / `design` / `tokens` / `ops` / `agent` —— 按 `partition-router.ts`
 *   的分区映射，语义是「这个领域的所有工具」（如 `design` 含组件 / 样式 / 团队库 / 变量查询）。
 *
 * 设计原则：
 * 1. 领域 profile **按分区映射，不逐个工具手写清单** —— 新工具只要在 `partition-router.ts`
 *    里登记了分区，就自动落进对应 profile；漏登记会被 `tests/tools.test.ts` 拦住。
 * 2. 默认（不设 `UXSHIP_MCP_PROFILE`）是 **`gen`**（见 `DEFAULT_PROFILE`）。
 *    实测代价：`full` 67 个 / 35,843 字符，`gen` 20 个 / 11,603 字符 —— 默认值直接决定
 *    每个会话固定支出的上下文。要全量就显式 `UXSHIP_MCP_PROFILE=full`（不是删掉变量）。
 * 3. 被隐藏的工具不是没了：`mcp_tools({ action: 'enable' })` 可随时按 profile 或按工具名
 *    动态注册，并通知客户端刷新工具列表。
 *
 * ⚠️ 改默认值时的检查清单（真实踩过）：**窄 profile 会连带隐藏「协议级」工具**。
 * `session_list` / `task_plan` 这类不属任何设计领域，但技能文档要求「每次任务开始先
 * `session_list`」「≥2 步操作必须 `task_plan`」—— 它们被隐藏会让**文档规定的流程无法执行**。
 * 所以协议/元工具一律进 `ALWAYS_ON_TOOLS`，而不是靠默认 profile 兜住。
 */
import { PARTITIONS, resolvePartition, type Partition } from './partition-router.js'

/** 全部分区（顺序即工具索引顺序；全量 profile 用） */
const ALL_PARTITIONS = Object.keys(PARTITIONS) as Partition[]

/**
 * 工具 profile 名。
 * - `gen`    设计生成常用工具（任务形状，最省上下文，**设计生成会话推荐**）
 * - `core`   仅核心节点操作（最省上下文的领域集）
 * - `design` 设计领域全集（core + 设计管线 + 分析 + 组件 + 设计系统资产）
 * - `tokens` 设计系统资产（变量 / 样式 / 团队库 / 组件）
 * - `ops`    运维与宿主能力（页面、画布视图、会话、任务进度、通知、代码库分析）
 * - `agent`  Design Agent 三件套
 * - `full`   全部工具（**需要显式 `UXSHIP_MCP_PROFILE=full`**；不再是默认值）
 */
export type ToolProfile = 'gen' | 'core' | 'design' | 'tokens' | 'ops' | 'agent' | 'full'

/**
 * `gen` 的显式工具清单 ——「从需求 / HTML 到画布」这条路真正会用到的工具。
 *
 * 收录口径：判断标准是「设计生成这条路真的会用」，而**不是**「字符数好看」。
 * 刻意排除 team_* / variable_* / style_* / page_* / session_* / task_* / agent_*，
 * 但**旗舰生成能力一律开箱可用**：`component_render` / `icon_render` /
 * `node_export_image` / `node_export_batch` / `selection_set` **都在清单内**
 * （`selection_set` 是「生成后选中成果」的固有步骤，与 `canvas_zoom_to_node` 配对）。
 * - 设计上下文：`document_get_info` / `selection_get` / `node_get` / `search_nodes`
 * - 节点读写（含批量形态）：`node_create` / `node_update` / `node_delete` / `node_clone` / `node_move`
 * - 设计管线与组件：`code_to_design` / `component_render`
 * - 素材与分析：`icon_search` / `icon_render` / `design_describe`
 * - 产出与收尾：`node_export_image` / `node_export_batch` / `selection_set` / `canvas_zoom_to_node`
 * - 规则与自省：`plugin_capabilities` / `get_guidelines`
 *
 * **预算由测试执行，不靠本注释**：见 `tests/tool-profiles.test.ts` 的
 * 「gen profile 预算门禁（设计生成主战场）」—— 工具数 ≤ 21、整份 JSON ≤ 17000 字符
 * （实测 20 个 / 11,417 字符，对比 `full` 的 35,588 约省 68%）；
 * 同处还断言上面那 5 个旗舰工具**必须在**清单里：
 * 不允许为了省字符把它们踢出 gen。**要更少工具应当新增一个更窄的 profile，而不是削 gen。**
 *
 * ⚠️ **历史教训（2026-09-22 校）**：本注释曾写「为何只有 15 个（8k 字符预算的硬约束）」
 * 并声称刻意不含那 5 个 —— 与实现（20 个）不符，`skills/design/rules/07-mcp-tools.md`
 * 的 profile 表也跟着错了很久，直到补上逐 profile 文档校验才发现。
 * 本注释因此**不再重复具体字符数**（曾引用的 `component_render = 5,039 字符` 是早期草稿数字，
 * 实测 inputSchema 仅 775、整工具 1,027）：需要数字时看 `mcp_tools({action:'status'})` 或那条门禁。
 */
export const GEN_TOOLS: readonly string[] = [
  // 上下文 / 读取
  'document_get_info',
  'selection_get',
  'selection_set',
  'node_get',
  'search_nodes',
  'design_describe',
  // 节点写入
  'node_create',
  'node_update',
  'node_delete',
  'node_clone',
  'node_move',
  // 管线与组件（生成主力）
  'code_to_design',
  'component_render',
  'icon_search',
  'icon_render',
  // 产出与收尾
  'node_export_image',
  'node_export_batch',
  'canvas_zoom_to_node',
  // 规则与能力
  'plugin_capabilities',
  'get_guidelines',
]

export interface ToolProfileInfo {
  /** 中文短标签（`mcp_tools` status 展示用） */
  label: string
  /** 一句话说明（写清与其它 profile 的区别） */
  description: string
  /** 该 profile 覆盖的分区（领域全集类 profile 用；与 `tools` 取并集） */
  partitions: Partition[]
  /** 显式工具清单（任务形状的 profile 用） */
  tools?: readonly string[]
  /** 是否推荐 profile（status 里标「推荐：设计生成」） */
  recommended?: boolean
}

/** profile → 元信息（`partitions` / `tools` 决定实际暴露哪些工具） */
export const TOOL_PROFILES: Record<ToolProfile, ToolProfileInfo> = {
  gen: {
    label: '设计生成（推荐）',
    description:
      '设计生成常用（任务形状，最省上下文）：需求/HTML → 画布的上下文、节点读写、管线与组件渲染、图标、导出、分析、聚焦；不含样式/变量/团队库/页面/会话/任务/Agent（缺的工具用 mcp_tools enable 临时加载）',
    partitions: [],
    tools: GEN_TOOLS,
    recommended: true,
  },
  core: {
    label: '核心节点',
    description: '节点 CRUD、文档上下文、搜索（领域集，不含设计管线与素材）',
    partitions: ['core'],
  },
  design: {
    label: '设计领域全集',
    description:
      '设计领域全集（含组件/样式/团队库/变量查询）：节点 + 设计管线 + 设计分析 + 组件 + 设计系统资产，比 gen 大得多',
    partitions: ['core', 'design-gen', 'analysis', 'components', 'resources'],
  },
  tokens: {
    label: '设计系统资产',
    description: '变量（Design Token）、样式、团队库、组件',
    partitions: ['resources', 'components'],
  },
  ops: {
    label: '运维与宿主',
    description: '页面管理、画布视图、会话、任务进度、通知、代码库分析',
    partitions: ['infrastructure'],
  },
  agent: {
    label: 'Design Agent',
    description: 'Design Agent 三件套：意图成稿、状态查询、迭代修改',
    partitions: ['agent'],
  },
  full: {
    label: '全量',
    description: '全部工具；需显式 UXSHIP_MCP_PROFILE=full（默认已是 gen，不再等价于未配置）',
    partitions: ALL_PARTITIONS,
  },
}

/** 合法 profile 的稳定顺序（错误提示 / status 展示都用它；`gen` 排最前 = 推荐） */
export const PROFILE_NAMES: ToolProfile[] = ['gen', 'core', 'design', 'tokens', 'ops', 'agent', 'full']

/**
 * 默认 profile —— 未配置 `UXSHIP_MCP_PROFILE` 时生效。
 *
 * 为什么是 `gen` 而不是 `full`：`tools/list` 是**每个会话的固定支出**。
 * 实测 `full` = 67 个工具 / 35,843 字符，`gen` = 20 个 / 11,603 字符（省 68%），
 * 而 `gen` 含全部旗舰生成能力（`code_to_design` / `component_render` / `icon_render` /
 * `node_export_image` / `selection_set`），长尾工具用 `mcp_tools({action:'enable'})` 按需加载。
 *
 * 注意「省的是 schema 不是能力」：被隐藏的工具可随时取回，且 `mcp_tools` 在 `ALWAYS_ON_TOOLS` 里。
 */
export const DEFAULT_PROFILE: ToolProfile = 'gen'

/**
 * 常驻工具：**无论什么 profile 都注册**。
 *
 * 口径：**「协议/元能力」而非「设计领域能力」**。判据是「隐藏它会不会让技能文档规定的流程
 * 无法执行」——不会，就别放进来（放进来等于对每个 profile 收税）。
 *
 * - `plugin_capabilities`：技能文档要求「接入新 API 前先调用」，属于 infrastructure 分区
 *   （只有 `ops` 会暴露），因此在 `registerAllTools` 里要显式保留；
 * - `health_get` / `dsl_spec`：诊断工具，本来就在 `register-tools.ts` 单独注册；
 * - `mcp_tools`：工具面自省 / 扩展的元工具，被隐藏就再也拿不回工具了；
 * - `session_list` / `session_switch`：**路由**。技能文档要求「每次任务开始时先执行
 *   `session_list`」；多插件实例下不先看会话就不知道该画到哪个文档；
 * - `task_plan` / `task_step` / `task_complete`：**进度**。技能文档要求「≥2 步的操作必须
 *   先发计划」；被隐藏会让 AI 无法向插件端上报进度（用户侧表现为「卡住不动」）。
 *
 * 这 5 个（会话 2 + 任务 3）是 2026-09-30 把默认 profile 从 `full` 改成 `gen` 时补进来的：
 * `gen` 清单**刻意不含** `session_*` / `task_*`（见 `GEN_TOOLS` 的收录口径与对应测试），
 * 若仅靠默认 profile 兜住，任何窄 profile 都会静默打断这两个流程。
 */
export const ALWAYS_ON_TOOLS: readonly string[] = [
  'plugin_capabilities',
  'health_get',
  'dsl_spec',
  'mcp_tools',
  // 会话路由（技能文档：每次任务开始时先执行 session_list）
  'session_list',
  'session_switch',
  // 任务进度（技能文档：≥2 步的操作必须先 task_plan）
  'task_plan',
  'task_step',
  'task_complete',
]

/** 元工具名（`register-tools.ts` 与测试共用，避免硬编码漂移） */
export const MCP_TOOLS_TOOL_NAME = 'mcp_tools'

/** 类型守卫：字符串是否为合法 profile 名（大小写不敏感） */
export function isToolProfile(value: string): value is ToolProfile {
  return (PROFILE_NAMES as string[]).includes(value.toLowerCase())
}

/**
 * 解析环境变量 / 参数里的 profile 列表。
 * - 逗号分隔、去空格、大小写不敏感、去重
 * - 空 / 未定义 → `['full']`
 * - 出现未知 profile → 抛中文 Error 并列出合法值（配置错误应当在启动时就炸）
 */
export function parseProfiles(raw: string | undefined): ToolProfile[] {
  if (raw === undefined || raw.trim() === '') return [DEFAULT_PROFILE]

  const result: ToolProfile[] = []
  const unknown: string[] = []
  for (const part of raw.split(',')) {
    const name = part.trim().toLowerCase()
    if (!name) continue
    if (!isToolProfile(name)) {
      if (!unknown.includes(name)) unknown.push(name)
      continue
    }
    if (!result.includes(name)) result.push(name)
  }

  if (unknown.length > 0) {
    throw new Error(
      `未知的工具 profile：${unknown.join(', ')}。合法值：${PROFILE_NAMES.join(' / ')}（可用逗号组合，如 "gen,ops"）`
    )
  }
  return result.length > 0 ? result : [DEFAULT_PROFILE]
}

/**
 * 按 profile 过滤工具（纯 profile 过滤，**不含**常驻工具）。
 * 命中规则：显式清单命中 **或** 工具所属分区被 profile 覆盖。
 * 常驻工具由 `registerAllTools` 用 `ALWAYS_ON_TOOLS` 单独并入，避免两处口径耦合。
 */
export function toolsForProfiles<T extends { name: string }>(tools: T[], profiles: ToolProfile[]): T[] {
  if (profiles.length === 0) return []
  if (profiles.includes('full')) return [...tools]

  const partitions = new Set<Partition>()
  const explicit = new Set<string>()
  for (const profile of profiles) {
    const info = TOOL_PROFILES[profile]
    for (const partition of info.partitions) partitions.add(partition)
    for (const name of info.tools ?? []) explicit.add(name)
  }

  return tools.filter((tool) => {
    if (explicit.has(tool.name)) return true
    const partition = resolvePartition(tool.name)
    return partition !== undefined && partitions.has(partition)
  })
}

/**
 * 该工具所属的所有 profile（供 `mcp_tools({ action: 'status' })` 输出用）。
 * 未登记分区的工具只属于 `full`。
 */
export function profileOfTool(name: string): ToolProfile[] {
  const partition = resolvePartition(name)
  return PROFILE_NAMES.filter((profile) => {
    if (profile === 'full') return true
    const info = TOOL_PROFILES[profile]
    if ((info.tools ?? []).includes(name)) return true
    return partition !== undefined && info.partitions.includes(partition)
  })
}
