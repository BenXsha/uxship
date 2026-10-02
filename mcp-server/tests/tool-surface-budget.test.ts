import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getToolList } from '../src/utils/tools.js'
import { toolsForProfiles, PROFILE_NAMES, GEN_TOOLS, type ToolProfile } from '../src/utils/tool-profiles.js'
import { registerAllTools } from '../src/utils/register-tools.js'
import {
  classifiedToolNames,
  readOnlyToolNames,
  destructiveToolNames,
  getToolAnnotations,
} from '../src/utils/tool-annotations.js'

/**
 * 工具面预算门禁
 *
 * 背景：MCP 的 `tools/list` 会**整份注入 AI 上下文**，所以工具面的体积与形状是产品指标，不是风格问题。
 * 一次实测（v2.4.0，67 个工具）：`tools/list` JSON 46,349 字符 ≈ 12–17k tokens/会话，
 * 而典型设计生成只用 11 个工具（5,828 字符）；同时 4 组「单体 + _batch」孪生工具共存，
 * 而**近似同名正是文献点名的首要误选来源**。
 * 业界阈值（Anthropic / 工程综述）：>40–50 个工具选择准确率明显下滑；工具定义 >10k tokens 建议按需发现。
 *
 * 本批压缩结果（v2.5.0 → v2.8.0）：67 → **63 个工具**，47,663 → **34,572 字符（−27.5%）**：
 * - 合并 4 组孪生（`node_create` 的 `nodes[]` / `node_update` 的 `updates[]` / `node_delete` 的 `nodeIds[]` /
 *   `design_suggest` 的 `instructions[]`，服务端按实参形状选路，见 `resolvePluginMethod`）
 * - 工具描述全部 ≤260 字符（能力矩阵/教程搬进 `rules/07-mcp-tools.md` 与 `plugin_capabilities`）
 * - 参数描述全部 ≤40 字符（253 个参数）
 * - **`component_render` 的 39 个扁平参数折叠成 `type`/`props`/`position`/`theme`**（schema 4,725 → 816 字符，
 *   −82.7%；类型专属参数目录写进 `rules/16-component-catalog.md`，插件端 `mergeComponentParams` 保证**平铺写法依旧可用**）
 *
 * 为何不再往下压（地板测算）：63 个工具的名字+描述 ≈ 7.9k；253 个参数的「名字+类型+JSON 骨架」
 * 本身就约 19k，把参数描述全删也只能省 ~2.2k。再往下需要**按任务渐进披露**（已做，见 `tool-profiles.ts`）
 * 与**输出侧预算**（已做，见 `response-budget.ts`），而不是继续压 schema。
 * 一处故意不做：`nodes[]` / `updates[]` 的内层 schema **不去重** —— 批量化是推荐路径，
 * 为 ~410 字符放弃内层必填校验不划算；`task_plan` / `task_step` / `task_complete` 也暂不三合一
 * （只省 ~300 字符 / 2 槽位，却要改插件进度协议 + 文档 + 提示词）。
 *
 * 触顶时不要直接改阈值 —— 先问「这个工具/参数真的需要出现在 tools/list 里吗」。
 */

/** tools/list 整份 JSON 的字符上限（67 个工具实测 35,429） */
const MAX_TOTAL_CHARS = 36_900
/** 单工具描述字符上限（只放决策信息；教程/能力矩阵请写进技能文档） */
const MAX_DESCRIPTION_CHARS = 260
/** 单参数描述字符上限 */
const MAX_PARAM_DESCRIPTION_CHARS = 40
/**
 * 单工具 inputSchema 字符上限。
 * `component_render` 折叠成 `props` 后（4,725 → 816）最大的是 `search_nodes`（1,477），
 * 阈值按它收紧 —— 新增/改动工具若越线，优先想「参数能不能并进一个自由对象 + 目录写进文档」。
 */
const MAX_SCHEMA_CHARS = 1_600

/**
 * **线上** `tools/list` 的字符上限（发布形态）。
 *
 * 为什么单独量：紧凑 `inputSchema`（上面那些断言量的）并不是 AI 真正看到的东西 ——
 * MCP 客户端收到的是经 `zod → JSON Schema` 转换后的发布形态（`$schema` 头 + 空 `additionalProperties` + `execution` 等），
 * 实测（66 个工具）：紧凑业务数组 38,327 字符 → **线上 payload 47,471 字符（1.24×）**。
 * （踩过的坑：用 python `json.dumps` 默认分隔符重序列化会把同一个 payload 量成 87k，
 *  那是重加了空格导致的假象；一律用 `JSON.stringify` / 原始字节长度才能反映真实开销。）
 */
const MAX_WIRE_CHARS = 44_200

/**
 * 默认 profile（`gen`）的**线上** `tools/list` 上限。
 *
 * 为什么单独量：2026-09-30 起默认 profile 从 `full` 改成 `gen`，于是「客户端默认收到多少」
 * 这个数字本身成了产品指标 —— 它是**每个会话的固定支出**。
 * 实测：gen 紧凑 11,603 字符 → 线上约 1.4 万（含常驻的 session_* / task_* 协议工具）。
 * 留 ~50% 余量，余量被吃掉时先问「这个工具真需要默认出现吗」。
 */
const MAX_DEFAULT_WIRE_CHARS = 22_000

/** 复现「客户端真实收到的 tools/list」（经 SDK 注册 + zod 转换） */
function wirePayload(profile?: ToolProfile): unknown[] {
  // 实测口径必须显式指定 profile：默认已是 gen，不显式给 full 就量不到全量上限
  process.env.UXSHIP_MCP_PROFILE = profile ?? 'full'
  const server = new McpServer({ name: 'budget', version: '0' })
  const bridge = { forwardRequest: async () => ({}) } as any
  registerAllTools(server, bridge)
  const registered = (server as any)._registeredTools as Record<string, any>
  // 注意：registry 的**键**才是工具名（条目本身不带 name）
  return Object.entries(registered).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.inputSchema),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  }))
}

/**
 * 复原环境变量：本文件不再保证只有自己改 `UXSHIP_MCP_PROFILE`，
 * 被污染会让后面的断言静默量错 profile（历史踩过「假绿」）。
 */
const originalProfile = process.env.UXSHIP_MCP_PROFILE
afterEach(() => {
  if (originalProfile === undefined) delete process.env.UXSHIP_MCP_PROFILE
  else process.env.UXSHIP_MCP_PROFILE = originalProfile
})

const tools = getToolList()

describe('工具面预算', () => {
  it('tools/list 整份 JSON 不超过字符预算', () => {
    const total = JSON.stringify(tools).length
    expect(
      total,
      `工具面 ${total} 字符超预算 ${MAX_TOTAL_CHARS}（新增工具前先想：能否并进已有工具？）`
    ).toBeLessThanOrEqual(MAX_TOTAL_CHARS)
  })

  it('线上发布形态（客户端真实收到的 tools/list）也在预算内', () => {
    const payload = wirePayload('full')
    const chars = JSON.stringify(payload).length
    // 发布形态比紧凑 schema 大约 1.24×（zod → JSON Schema 转换、$schema 头、空 additionalProperties、execution）
    expect(
      chars,
      `线上工具面 ${chars} 字符超预算 ${MAX_WIRE_CHARS}（profile=full，${tools.length} 个工具）`
    ).toBeLessThanOrEqual(MAX_WIRE_CHARS)
    // 防假绿：payload 为空/极少时上面那条断言会平凡通过（实测量级 ~45k）
    expect(chars, `线上工具面只有 ${chars} 字符，疑似 wirePayload() 没量到东西`).toBeGreaterThan(40_000)
    // 同一个 payload，用 python 风格的「带空格」序列化会大很多 —— 此处用 JSON.stringify（紧凑）作为口径
  })

  it('默认 profile（gen）的线上工具面在预算内（这是客户端默认收到的东西）', () => {
    delete process.env.UXSHIP_MCP_PROFILE
    const payload = wirePayload('gen')
    const names = payload.map((t: any) => t.name)
    const chars = JSON.stringify(payload).length

    expect(
      chars,
      `默认工具面 ${chars} 字符超预算 ${MAX_DEFAULT_WIRE_CHARS}（profile=gen）`
    ).toBeLessThanOrEqual(MAX_DEFAULT_WIRE_CHARS)
    // 防假绿：默认量级 ~1.4 万
    expect(chars, `默认工具面只有 ${chars} 字符，疑似没量到东西`).toBeGreaterThan(10_000)
    // 省上下文的部分：领域工具确实不在默认面里
    for (const hidden of ['variable_list', 'page_list', 'team_library_list', 'style_apply']) {
      expect(names, `${hidden} 不应出现在默认工具面`).not.toContain(hidden)
    }
    // 但协议级工具必须留下（否则技能文档规定的 session_list / task_plan 流程无法执行）
    for (const name of ['session_list', 'session_switch', 'task_plan', 'task_step', 'task_complete']) {
      expect(names, `${name} 是协议级常驻工具，不能在默认面里被省掉`).toContain(name)
    }
  })

  it('每个工具的描述都在字符预算内', () => {
    const over = tools
      .filter((t) => (t.description || '').length > MAX_DESCRIPTION_CHARS)
      .map((t) => `${t.name}(${(t.description || '').length})`)
    expect(over, `描述过长：${over.join(', ')}`).toEqual([])
  })

  it('每个参数描述都在字符预算内', () => {
    const over: string[] = []
    for (const tool of tools) {
      const props = (tool.inputSchema?.properties || {}) as Record<string, any>
      for (const [key, value] of Object.entries(props)) {
        const len = (value?.description || '').length
        if (len > MAX_PARAM_DESCRIPTION_CHARS) over.push(`${tool.name}.${key}(${len})`)
      }
    }
    expect(over, `参数描述过长：${over.join(', ')}`).toEqual([])
  })

  it('每个工具的 inputSchema 都在字符预算内', () => {
    const over = tools
      .filter((t) => JSON.stringify(t.inputSchema || {}).length > MAX_SCHEMA_CHARS)
      .map((t) => `${t.name}(${JSON.stringify(t.inputSchema || {}).length})`)
    expect(over, `schema 过大：${over.join(', ')}`).toEqual([])
  })

  it('不存在「单体 + _batch」孪生工具（近似同名是首要误选来源）', () => {
    const names = new Set(tools.map((t) => t.name))
    const twins = [...names]
      .filter((n) => n.endsWith('_batch'))
      .filter((n) => names.has(n.replace(/_batch$/, '')))
    expect(twins, `孪生工具：${twins.join(', ')}（合并为带数组参数的单工具）`).toEqual([])
  })
})

/**
 * 逐 profile 的线上体积上限。
 *
 * **为何必需**：`full` 有 `MAX_WIRE_CHARS`、`gen` 在 `tool-profiles.test.ts` 里有专项预算门禁，
 * 但 **`core` / `design` / `tokens` / `ops` / `agent` 五个 profile 当时没有任何上限** ——
 * 它们可以静默膨胀。本块补齐这一空白，并把七个 profile 放在同一张表里便于对照。
 *
 * 口径与服务端 `mcp_tools({action:'status'})` 完全一致：
 * `JSON.stringify(toolsForProfiles(tools, [profile])).length`。
 *
 * 触顶时不要直接抬阈值 —— 先问「这个工具真的需要默认出现在这个 profile 里吗」，
 * 以及「能不能按分区重新划」。
 */
const MAX_PROFILE_CHARS: Record<ToolProfile, number> = {
  /** 镜像 `tool-profiles.test.ts` 的「gen profile 预算门禁」（那里是权威口径） */
  gen: 17_000,
  core: 11_000,
  design: 32_000,
  tokens: 15_500,
  ops: 7_500,
  agent: 1_400,
  /** 与上面 `MAX_WIRE_CHARS` 同值：full 的发布形态上限 */
  full: MAX_WIRE_CHARS,
}

describe('逐 profile 工具面预算', () => {
  it('每个 profile 都不超自己的字符预算', () => {
    const measured = PROFILE_NAMES.map((name) => ({
      name,
      chars: JSON.stringify(toolsForProfiles(tools, [name])).length,
      count: toolsForProfiles(tools, [name]).length,
    }))
    const over = measured
      .filter((m) => m.chars > MAX_PROFILE_CHARS[m.name])
      .map((m) => `${m.name} ${m.chars} > ${MAX_PROFILE_CHARS[m.name]}`)
    expect(
      over,
      `profile 工具面超预算：\n${over.join('\n')}\n` +
        `完整实测：${measured.map((m) => `${m.name}=${m.count}个/${m.chars}`).join(' ')}\n` +
        `（先按任务精简清单，或把工具移到按需加载，不要先抬阈值）`
    ).toEqual([])
  })

  it('每个 profile 都非空（防 profile 名改了而清单没跟上）', () => {
    for (const name of PROFILE_NAMES) {
      expect(toolsForProfiles(tools, [name]).length, `profile ${name} 为空`).toBeGreaterThan(0)
    }
  })

  it('GEN_TOOLS 里的名字都真实存在（防拼写漂移导致静默少工具）', () => {
    const gen = toolsForProfiles(tools, ['gen']).map((t) => t.name)
    const known = new Set(tools.map((t) => t.name))
    const typo = GEN_TOOLS.filter((n) => !known.has(n))
    expect(
      typo,
      `GEN_TOOLS 含不存在的工具名（会被 toolsForProfiles 静默丢弃）：${typo.join(', ')}`
    ).toEqual([])
    expect(
      gen.length,
      `gen 实得 ${gen.length} 个 ≠ GEN_TOOLS ${GEN_TOOLS.length} 个（清单有重复或失效项）`
    ).toBe(GEN_TOOLS.length)
  })
})

describe('工具 annotations（读 / 写信号）', () => {
  it('每个业务工具都在 annotations 策略里显式登记（新增工具必须想过副作用）', () => {
    const classified = new Set(classifiedToolNames())
    const missing = tools.map((t) => t.name).filter((n) => !classified.has(n))
    expect(missing, `未登记：${missing.join(', ')}`).toEqual([])
    const names = new Set(tools.map((t) => t.name))
    // health_get / dsl_spec 是诊断工具，在 register-tools 里单独注册，不在 getToolList() 里
    const diagnostics = new Set(['health_get', 'dsl_spec'])
    const stale = classifiedToolNames().filter((n) => !names.has(n) && !diagnostics.has(n))
    expect(stale, `策略里有多余条目（工具已删/改名）：${stale.join(', ')}`).toEqual([])
  })

  it('只读工具带 readOnlyHint，且绝不带 destructiveHint', () => {
    for (const name of readOnlyToolNames()) {
      const tool = tools.find((t) => t.name === name)
      if (!tool) continue // health_get / dsl_spec 在 register-tools 单独注册
      expect(getToolAnnotations(name)?.readOnlyHint, `${name} 应带 readOnlyHint`).toBe(true)
      expect(tool.annotations?.destructiveHint, `${name} 不应带 destructiveHint`).toBeUndefined()
    }
  })

  it('破坏性工具带 destructiveHint，且不会同时声明只读', () => {
    for (const name of destructiveToolNames()) {
      const tool = tools.find((t) => t.name === name)
      expect(tool, `破坏性工具 ${name} 不在工具列表里`).toBeDefined()
      expect(tool?.annotations?.destructiveHint, `${name} 应带 destructiveHint`).toBe(true)
      expect(tool?.annotations?.readOnlyHint, `${name} 不应声明只读`).toBeUndefined()
    }
  })

  it('普通写入类工具不挂空注解（annotations 也占 tools/list 字节）', () => {
    for (const tool of tools) {
      if (!tool.annotations) continue
      expect(Object.keys(tool.annotations).length, `${tool.name} 挂了空注解`).toBeGreaterThan(0)
    }
  })
})
