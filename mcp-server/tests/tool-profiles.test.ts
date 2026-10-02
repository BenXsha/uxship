import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerAllTools, toolProfileStats } from '../src/utils/register-tools.js'
import { getToolList } from '../src/utils/tools.js'
import { resolvePartition } from '../src/utils/partition-router.js'
import type { WebSocketBridge } from '../src/server/ws-bridge.js'
import {
  ALWAYS_ON_TOOLS,
  DEFAULT_PROFILE,
  GEN_TOOLS,
  MCP_TOOLS_TOOL_NAME,
  PROFILE_NAMES,
  TOOL_PROFILES,
  parseProfiles,
  profileOfTool,
  toolsForProfiles,
  type ToolProfile,
} from '../src/utils/tool-profiles.js'

const allTools = getToolList()

/** 照抄 `register-tools-schema.test.ts` 的 helper：拿到真正注册进 SDK 的工具表 */
function buildServer(): McpServer {
  const server = new McpServer({ name: 'test-server', version: '0.0.0' })
  const bridge = { forwardRequest: async () => ({}) } as unknown as WebSocketBridge
  registerAllTools(server, bridge)
  return server
}

function registeredTools(server: McpServer): Record<string, any> {
  const candidates = ['_registeredTools', 'registeredTools', '_tools']
  for (const key of candidates) {
    const value = (server as any)[key]
    if (value && typeof value === 'object') return value
  }
  throw new Error(`未找到 SDK 工具注册表，候选字段：${candidates.join(', ')}`)
}

describe('parseProfiles — 环境变量解析', () => {
  it('未定义 / 空串 → 默认 gen（DEFAULT_PROFILE）', () => {
    expect(DEFAULT_PROFILE).toBe('gen')
    expect(parseProfiles(undefined)).toEqual(['gen'])
    expect(parseProfiles('')).toEqual(['gen'])
    expect(parseProfiles('   ')).toEqual(['gen'])
    expect(parseProfiles(',,')).toEqual(['gen'])
  })

  it('full 仍可用（改成显式选择而不是默认）', () => {
    expect(parseProfiles('full')).toEqual(['full'])
    expect(parseProfiles('FULL')).toEqual(['full'])
  })

  it('单个 profile', () => {
    expect(parseProfiles('design')).toEqual(['design'])
    expect(parseProfiles('gen')).toEqual(['gen'])
  })

  it('逗号分隔 + 去空格 + 去重', () => {
    expect(parseProfiles('design, ops')).toEqual(['design', 'ops'])
    expect(parseProfiles('gen,design')).toEqual(['gen', 'design'])
    expect(parseProfiles('ops,ops , OPS')).toEqual(['ops'])
  })

  it('大小写不敏感', () => {
    expect(parseProfiles('GeN')).toEqual(['gen'])
    expect(parseProfiles('TOKENS')).toEqual(['tokens'])
  })

  it('未知值抛错且错误信息含合法值', () => {
    expect(() => parseProfiles('nope')).toThrowError(/未知的工具 profile/)
    expect(() => parseProfiles('gen,bogus')).toThrowError(/bogus/)
    let message = ''
    try {
      parseProfiles('nope')
    } catch (error) {
      message = (error as Error).message
    }
    for (const name of PROFILE_NAMES) expect(message).toContain(name)
  })
})

describe('toolsForProfiles — 按 profile 过滤', () => {
  it('full 返回全部业务工具（与 getToolList() 等长）', () => {
    expect(toolsForProfiles(allTools, ['full'])).toHaveLength(allTools.length)
    expect(toolsForProfiles(allTools, []).length).toBe(0)
  })

  it('ops 只含 infrastructure 分区的工具', () => {
    const filtered = toolsForProfiles(allTools, ['ops'])
    expect(filtered.length).toBeGreaterThan(0)
    for (const tool of filtered) expect(resolvePartition(tool.name)).toBe('infrastructure')
  })

  it('design 只含 core / design-gen / analysis / components / resources 分区的工具', () => {
    const allowed = new Set(['core', 'design-gen', 'analysis', 'components', 'resources'])
    const filtered = toolsForProfiles(allTools, ['design'])
    expect(filtered.length).toBeGreaterThan(0)
    for (const tool of filtered) expect(allowed.has(resolvePartition(tool.name) as string)).toBe(true)
    // 覆盖完整性：这五个分区的工具一个都不能漏
    const expected = allTools.filter((t) => allowed.has(resolvePartition(t.name) as string))
    expect(filtered.map((t) => t.name).sort()).toEqual(expected.map((t) => t.name).sort())
  })

  it('gen 是显式清单（不是分区），且 gen ⊂ full', () => {
    const filtered = toolsForProfiles(allTools, ['gen'])
    expect(filtered.map((t) => t.name).sort()).toEqual([...GEN_TOOLS].sort())
    for (const tool of filtered) expect(allTools.some((t) => t.name === tool.name)).toBe(true)
  })

  it('多 profile 取并集', () => {
    const gen = new Set(toolsForProfiles(allTools, ['gen']).map((t) => t.name))
    const ops = new Set(toolsForProfiles(allTools, ['ops']).map((t) => t.name))
    const both = new Set(toolsForProfiles(allTools, ['gen', 'ops']).map((t) => t.name))
    expect(both.size).toBe(new Set([...gen, ...ops]).size)
    for (const name of gen) expect(both.has(name)).toBe(true)
    for (const name of ops) expect(both.has(name)).toBe(true)
  })

  it('design + ops + agent 的并集 == full（覆盖完整性）', () => {
    const union = new Set([
      ...toolsForProfiles(allTools, ['design']),
      ...toolsForProfiles(allTools, ['ops']),
      ...toolsForProfiles(allTools, ['agent']),
    ].map((t) => t.name))
    expect(union.size).toBe(allTools.length)
    expect([...union].sort()).toEqual(allTools.map((t) => t.name).sort())
  })

  it('每个业务工具至少属于一个非 full 的 profile（不留死角）', () => {
    const uncovered = allTools
      .filter((tool) => profileOfTool(tool.name).filter((p) => p !== 'full').length === 0)
      .map((tool) => tool.name)
    expect(uncovered, `没有任何 profile 能暴露：${uncovered.join(', ')}`).toEqual([])
  })

  it('profileOfTool 反映实际归属', () => {
    // 节点 CRUD 在 gen / core / design / full
    expect(profileOfTool('node_create').sort()).toEqual(['core', 'design', 'full', 'gen'].sort())
    // 团队库只在 design / tokens / full
    expect(profileOfTool('team_library_list').sort()).toEqual(['design', 'full', 'tokens'].sort())
    // 页面管理只在 ops / full
    expect(profileOfTool('page_list').sort()).toEqual(['full', 'ops'].sort())
    // Agent 三件套只在 agent / full
    expect(profileOfTool('agent_get_status').sort()).toEqual(['agent', 'full'].sort())
  })
})

describe('profile 定义（TOOL_PROFILES）', () => {
  it('每个 profile 的 label / description 非空', () => {
    for (const name of PROFILE_NAMES) {
      const info = TOOL_PROFILES[name]
      expect(info.label.length, `${name} 缺 label`).toBeGreaterThan(0)
      expect(info.description.length, `${name} 缺 description`).toBeGreaterThan(0)
      expect(info.partitions.length + (info.tools?.length ?? 0), `${name} 未映射任何工具`).toBeGreaterThan(0)
    }
  })

  it('gen 是推荐 profile，且 description 写清与 design 的区别', () => {
    expect(TOOL_PROFILES.gen.recommended).toBe(true)
    expect(TOOL_PROFILES.gen.label).toContain('推荐')
    expect(TOOL_PROFILES.gen.description).toContain('最省上下文')
    expect(TOOL_PROFILES.design.description).toContain('设计领域全集')
  })
})

describe('gen profile 预算门禁（设计生成主战场）', () => {
  it('工具数 ≤ 21', () => {
    const gen = toolsForProfiles(allTools, ['gen'])
    expect(gen.length, `gen 有 ${gen.length} 个工具，超过 21`).toBeLessThanOrEqual(21)
  })

  it('整份 JSON ≤ 17000 字符（对比 full 的 ~38.3k，约省 55%）', () => {
    const stats = toolProfileStats('gen')
    expect(
      stats.chars,
      `gen 工具面 ${stats.count} 个工具 / ${stats.chars} 字符超预算 17000`,
    ).toBeLessThanOrEqual(17_000)
    // 同口径下 full 的量级对照（防止有人把预算调成「相对值」）
    expect(toolProfileStats('full').chars).toBeGreaterThan(30_000)
  })

  it('生成工作流必须开箱可用（旗舰能力不允许为了省字符被踢出 gen）', () => {
    const gen = new Set(toolsForProfiles(allTools, ['gen']).map((tool) => tool.name))
    for (const required of [
      'code_to_design',
      'component_render',
      'icon_render',
      'node_create',
      'node_update',
      'node_delete',
      'node_export_image',
      'selection_set',
      'canvas_zoom_to_node',
      'design_describe',
    ]) {
      expect(gen.has(required), `gen 缺少生成主力工具：${required}`).toBe(true)
    }
  })

  it('不含 variable_* / team_* / style_* / page_* / session_* / task_* / agent_*（防止被顺手加进去撑大）', () => {
    const forbidden = /^(variable_|team_|style_|page_|session_|task_|agent_)/
    const violators = toolsForProfiles(allTools, ['gen'])
      .map((t) => t.name)
      .filter((name) => forbidden.test(name))
    expect(violators, `gen 混入了领域工具：${violators.join(', ')}`).toEqual([])
  })
})

describe('core ⊂ 领域 profile 的覆盖关系', () => {
  const names = (profile: ToolProfile) => new Set(toolsForProfiles(allTools, [profile]).map((t) => t.name))

  it('core ⊂ design', () => {
    const core = names('core')
    const design = names('design')
    for (const name of core) expect(design.has(name), `${name} 不在 design 里`).toBe(true)
  })

  it('core ⊂ full，且 full 是所有人的超集', () => {
    const full = names('full')
    for (const profile of PROFILE_NAMES) {
      for (const name of names(profile)) expect(full.has(name), `${name} 不在 full 里`).toBe(true)
    }
  })

  it('tokens ⊂ design（设计系统资产是设计领域的一部分）', () => {
    const tokens = names('tokens')
    const design = names('design')
    for (const name of tokens) expect(design.has(name), `${name} 不在 design 里`).toBe(true)
  })

  it('gen 与 agent 互不相交；与 ops 的重叠仅限画布聚焦 / 宿主自省类', () => {
    const gen = names('gen')
    for (const name of names('agent')) expect(gen.has(name), `gen 混入 agent 工具：${name}`).toBe(false)
    // canvas_zoom_to_node / selection_set（生成后聚焦与选中）与 plugin_capabilities / get_guidelines
    // （接入新 API 前先探能力、先读规则）虽属 infrastructure 分区，但是生成路径的固有步骤，故有意重叠
    const overlap = [...names('ops')].filter((name) => gen.has(name)).sort()
    expect(overlap).toEqual(['canvas_zoom_to_node', 'get_guidelines', 'plugin_capabilities', 'selection_set'].sort())
  })
})

describe('registerAllTools — 按 profile 注册', () => {
  const originalProfile = process.env.UXSHIP_MCP_PROFILE
  afterEach(() => {
    if (originalProfile === undefined) delete process.env.UXSHIP_MCP_PROFILE
    else process.env.UXSHIP_MCP_PROFILE = originalProfile
  })

  it('默认（不设环境变量）注册 gen + 常驻 + 诊断 + 元工具（不再是 full）', () => {
    delete process.env.UXSHIP_MCP_PROFILE
    const tools = registeredTools(buildServer())
    const names = Object.keys(tools)

    // gen 清单全部在
    for (const name of GEN_TOOLS) expect(names).toContain(name)
    // 常驻 + 诊断 + 元工具
    expect(names).toContain('health_get')
    expect(names).toContain('dsl_spec')
    expect(names).toContain(MCP_TOOLS_TOOL_NAME)
    // ⚠️ 回归钉：窄默认 profile 不得连带隐藏「协议级」工具
    // （技能文档要求「每次任务开始先 session_list」「≥2 步必须先 task_plan」）
    for (const name of ['session_list', 'session_switch', 'task_plan', 'task_step', 'task_complete']) {
      expect(names, `${name} 是协议级工具，必须是常驻的`).toContain(name)
    }
    // 领域工具仍被隐藏（省上下文的那部分）
    for (const name of ['variable_list', 'page_list', 'team_library_list', 'style_apply']) {
      expect(names, `${name} 不应出现在默认（gen）工具面里`).not.toContain(name)
    }

    const alwaysOnBusiness = ALWAYS_ON_TOOLS.filter((name) => allTools.some((t) => t.name === name))
    const expected = new Set([
      ...GEN_TOOLS,
      ...alwaysOnBusiness,
      'health_get',
      'dsl_spec',
      MCP_TOOLS_TOOL_NAME,
    ])
    expect(names.slice().sort()).toEqual([...expected].sort())
  })

  it("UXSHIP_MCP_PROFILE='full' 时注册全部工具（全量现在是显式选择）", () => {
    process.env.UXSHIP_MCP_PROFILE = 'full'
    const names = Object.keys(registeredTools(buildServer()))
    expect(names.length).toBeGreaterThanOrEqual(allTools.length + 2 + 1)
    for (const name of allTools.map((t) => t.name)) expect(names).toContain(name)
  })

  it("UXSHIP_MCP_PROFILE='ops' 时工具数明显变少，且常驻工具仍在", () => {
    process.env.UXSHIP_MCP_PROFILE = 'ops'
    const tools = registeredTools(buildServer())
    const names = Object.keys(tools)

    expect(names.length).toBeLessThan(allTools.length)
    // 常驻 + 诊断 + 元工具
    expect(names).toContain(MCP_TOOLS_TOOL_NAME)
    expect(names).toContain('plugin_capabilities')
    expect(names).toContain('health_get')
    expect(names).toContain('dsl_spec')
    // ops 领域工具在，设计工具不在
    expect(names).toContain('page_list')
    expect(names).not.toContain('node_create')
  })

  it("UXSHIP_MCP_PROFILE='gen' 时只注册 gen 清单 + 常驻工具", () => {
    process.env.UXSHIP_MCP_PROFILE = 'gen'
    const names = Object.keys(registeredTools(buildServer()))
    expect(names).not.toContain('variable_list')
    expect(names).not.toContain('page_list')
    expect(names).not.toContain('team_library_list')
    expect(names).toContain('code_to_design')
    // plugin_capabilities 本来就是 gen 清单成员，且是常驻工具（只出现一次）
    expect(names.filter((n) => n === 'plugin_capabilities')).toHaveLength(1)
    for (const on of ALWAYS_ON_TOOLS) expect(names).toContain(on)
  })

  it('常驻工具不会重复注册（否则 SDK 会抛 already registered）', () => {
    process.env.UXSHIP_MCP_PROFILE = 'full'
    const names = Object.keys(registeredTools(buildServer()))
    const duplicated = names.filter((name, index) => names.indexOf(name) !== index)
    expect(duplicated).toEqual([])
  })

  it('常驻工具在每个 profile 下都在（含最窄的 agent / core）', () => {
    for (const profile of ['agent', 'core', 'gen', 'ops'] as ToolProfile[]) {
      process.env.UXSHIP_MCP_PROFILE = profile
      const names = Object.keys(registeredTools(buildServer()))
      for (const name of ALWAYS_ON_TOOLS) {
        expect(names, `${profile} 下缺常驻工具 ${name}`).toContain(name)
      }
    }
  })

  /** 直接调用已注册的元工具 handler（未连接 transport，sendToolListChanged 会安全 no-op） */
  async function callMeta(server: McpServer, args: Record<string, unknown>): Promise<any> {
    const tool = registeredTools(server)[MCP_TOOLS_TOOL_NAME]
    expect(tool, 'mcp_tools 未注册').toBeDefined()
    const result = await tool.handler(args, {})
    return JSON.parse(result.content[0].text)
  }

  describe('mcp_tools — status', () => {
    it('full 下没有隐藏工具，且 profiles 里 gen 排最前并标 recommended', async () => {
      process.env.UXSHIP_MCP_PROFILE = 'full'
      const server = buildServer()
      const status = await callMeta(server, { action: 'status' })

      expect(status.profile).toEqual(['full'])
      expect(status.hidden.count).toBe(0)
      expect(status.tools.count).toBeGreaterThanOrEqual(allTools.length + 3)
      expect(status.tools.names).toContain('node_create')
      expect(status.alwaysOn).toContain(MCP_TOOLS_TOOL_NAME)
      expect(status.alwaysOn).toContain('plugin_capabilities')

      expect(status.profiles[0].name).toBe('gen')
      expect(status.profiles[0].recommended).toBe(true)
      expect(status.profiles[0].label).toContain('推荐')
      expect(status.profiles[0].toolCount).toBe(GEN_TOOLS.length)
      expect(status.profiles.map((p: any) => p.name)).toEqual(PROFILE_NAMES)
    })

    it('ops 下隐藏设计工具，byProfile 能定位每个工具属于哪个 profile', async () => {
      process.env.UXSHIP_MCP_PROFILE = 'ops'
      const status = await callMeta(buildServer(), { action: 'status' })

      expect(status.profile).toEqual(['ops'])
      expect(status.hidden.count).toBeGreaterThan(0)
      expect(status.hidden.names).toContain('node_create')
      // 按 profile 找隐藏工具：gen 里能拿到 node_create，ops 里拿不到（已经全注册了）
      expect(status.hidden.byProfile.gen).toContain('node_create')
      expect(status.hidden.byProfile.ops).toEqual([])
      expect(status.hidden.byProfile.agent).toContain('agent_get_status')
    })
  })

  describe('mcp_tools — enable（幂等）', () => {
    it('按 tool 名加载：首次 enabled，重复则 alreadyActive，且不抛错', async () => {
      process.env.UXSHIP_MCP_PROFILE = 'ops'
      const server = buildServer()
      expect(Object.keys(registeredTools(server))).not.toContain('node_create')

      const first = await callMeta(server, { action: 'enable', tool: ['node_create'] })
      expect(first.enabled).toEqual(['node_create'])
      expect(first.alreadyActive).toEqual([])
      expect(first.unknown).toEqual([])
      expect(first.profile).toEqual(['ops'])
      expect(Object.keys(registeredTools(server))).toContain('node_create')

      const second = await callMeta(server, { action: 'enable', tool: ['node_create'] })
      expect(second.enabled).toEqual([])
      expect(second.alreadyActive).toEqual(['node_create'])
      // 幂等：注册表里仍然只有一份
      const names = Object.keys(registeredTools(server))
      expect(names.filter((n) => n === 'node_create')).toHaveLength(1)
    })

    it('按 profile 加载（gen），未知 profile / 工具名进 unknown 且给中文提示', async () => {
      process.env.UXSHIP_MCP_PROFILE = 'ops'
      const server = buildServer()

      const result = await callMeta(server, {
        action: 'enable',
        profile: ['gen', 'bogus'],
        tool: ['node_export_batch', 'not_a_tool'],
      })
      expect(result.unknown.sort()).toEqual(['bogus', 'not_a_tool'])
      expect(result.hint).toContain('合法 profile')
      expect(result.hint).toContain('gen')
      expect(result.profile).toEqual(['ops'])

      const names = Object.keys(registeredTools(server))
      // profile 命中 + 显式命中（plugin_capabilities / canvas_zoom_to_node 已在 gen 里，不重复）
      for (const name of GEN_TOOLS) expect(names, `${name} 未加载`).toContain(name)
      expect(names).toContain('node_export_batch')
      // 未加载的仍隐藏
      expect(names).not.toContain('variable_list')
      expect(result.enabled).not.toContain('bogus')

      // 再次 status：gen 已无隐藏工具
      const status = await callMeta(server, { action: 'status' })
      expect(status.hidden.byProfile.gen).toEqual([])
      expect(status.hidden.names).toContain('variable_list')
    })

    it('enable 视为已激活：常驻工具与诊断工具不会被重复注册', async () => {
      process.env.UXSHIP_MCP_PROFILE = 'gen'
      const server = buildServer()
      const result = await callMeta(server, {
        action: 'enable',
        tool: ['plugin_capabilities', 'health_get', 'dsl_spec', MCP_TOOLS_TOOL_NAME],
      })
      expect(result.enabled).toEqual([])
      expect(result.alreadyActive.sort()).toEqual([MCP_TOOLS_TOOL_NAME, 'dsl_spec', 'health_get', 'plugin_capabilities'].sort())
      expect(result.unknown).toEqual([])
    })

    it('未知 action 返回错误文案而不是抛错', async () => {
      const server = buildServer()
      const tool = registeredTools(server)[MCP_TOOLS_TOOL_NAME]
      const result = await tool.handler({ action: 'nope' }, {})
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('未知 action')
    })

    it('mcp_tools 的发布 schema 保留 action 枚举与必填，且只用了 type/properties/required/items/enum/description', () => {
      const server = buildServer()
      const tool = registeredTools(server)[MCP_TOOLS_TOOL_NAME]
      const schema = z.toJSONSchema(tool.inputSchema) as any
      const raw = JSON.stringify(schema)

      expect(schema.type).toBe('object')
      expect(schema.required).toContain('action')
      expect(schema.properties.action.enum).toEqual(['status', 'enable'])
      expect(schema.properties.profile.items.type).toBe('string')
      expect(schema.properties.tool.items.type).toBe('string')
      // 转换器不支持 anyOf / $ref，写进去会静默退化成 z.any()
      expect(raw).not.toContain('anyOf')
      expect(raw).not.toContain('$ref')
    })
  })
})
