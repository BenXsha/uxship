import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerBridge } from '../server/ws-bridge.js'
import type { MCPTool } from '../types/mcp-types.js'
import { tools, toolsMap } from './tools.js'
import { toolInputSchemaToZod } from './json-schema-to-zod.js'
import { SERVER_VERSION } from '../version.js'
import { routeToolCall } from './tool-handlers.js'
import { DSL_SPEC } from './dsl-spec.js'
import { BackendAdapter } from './backend-adapter.js'
import {
  ALWAYS_ON_TOOLS,
  MCP_TOOLS_TOOL_NAME,
  PROFILE_NAMES,
  TOOL_PROFILES,
  isToolProfile,
  parseProfiles,
  toolsForProfiles,
  type ToolProfile,
} from './tool-profiles.js'

function toMcpResult(response: any): any {
  if (!response || 'error' in response) {
    const errMsg = response?.error?.message || 'Unknown error'
    return { content: [{ type: 'text' as const, text: errMsg }], isError: true }
  }

  const result = response.result
  if (result && typeof result === 'object' && 'content' in result) {
    return { content: result.content }
  }

  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
}

function getHealthStatus(): any {
  const uptime = process.uptime()
  const memoryUsage = process.memoryUsage()
  return {
    status: 'healthy',
    serverInfo: { name: 'mcp-server', version: SERVER_VERSION },
    uptime: {
      seconds: Math.floor(uptime),
      formatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
    },
    resources: {
      memory: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
      },
    },
    timestamp: new Date().toISOString(),
  }
}

/** 文本结果（元工具统一出口） */
function textResult(value: unknown, isError = false): any {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  }
}

/**
 * 把任意入参规整为字符串列表：
 * 兼容 `string` / `string[]`，并允许单个元素内用逗号分隔（`"gen,ops"`）。
 */
function toStringList(value: unknown): string[] {
  if (value === undefined || value === null) return []
  const raw = Array.isArray(value) ? value : [value]
  return raw
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function registerAllTools(server: McpServer, bridge: ServerBridge, sourceId?: string): void {
  const bridgeAsToolRouter = bridge as any
  const backendAdapter = BackendAdapter.getInstance()

  // 初始工具面由环境变量决定；未配置 → DEFAULT_PROFILE（gen，见 tool-profiles.ts）
  const profiles = parseProfiles(process.env.UXSHIP_MCP_PROFILE)

  /**
   * 已注册工具名集合。双重用途：
   * 1. `mcp_tools enable` 的幂等判定（SDK 的 registerTool 对重名会直接抛错）
   * 2. `mcp_tools status` 的数据来源（以「真正发布出去的集合」为准，而不是按配置推算）
   */
  const registered = new Set<string>()

  /**
   * 注册单个业务工具（所有工具走同一份 config 构造，避免两处漂移）。
   * @param tool 工具定义
   */
  const registerOne = (tool: MCPTool): void => {
    if (registered.has(tool.name)) return

    // 之前这里把每个属性降级为 z.any().optional()，导致 tools/list 上看不到
    // required / enum / 类型（详见 json-schema-to-zod.ts 的注释）。
    // 保留 .passthrough()：_sessionId 等路由参数必须原样透传。
    const schema = toolInputSchemaToZod(tool.inputSchema)

    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: schema,
      // annotations：只读 / 破坏性信号（未分类工具不挂，省 tools/list 字节）
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    }, async (args) => {
      const response = await routeToolCall(
        {
          jsonrpc: '2.0',
          id: `sdk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          method: 'tools/call',
          params: { name: tool.name, arguments: args as Record<string, unknown> },
        } as any,
        bridgeAsToolRouter,
        bridge.forwardRequest.bind(bridge) as any,
        // 每个 MCP 连接（SSE/STDIO）传入各自的身份，
        // 使 session_switch 的目标按客户端隔离，而不是全局共享
        sourceId,
        backendAdapter,
      )
      return toMcpResult(response)
    })

    registered.add(tool.name)
  }

  // 1) 按 profile 注册业务工具
  for (const tool of toolsForProfiles(tools, profiles)) registerOne(tool)

  // 2) 常驻工具：plugin_capabilities 属于 infrastructure 分区（只有 ops profile 会暴露），
  //    但技能文档要求「接入新 API 前先调用」，因此任何 profile 下都显式保留。
  for (const name of ALWAYS_ON_TOOLS) {
    const tool = toolsMap[name]
    if (tool) registerOne(tool)
  }

  // 3) 诊断工具（非标准 MCP 方法注册为工具，保持原有的单独注册方式）
  server.registerTool('health_get', {
    description: '获取服务器整体健康状态，包括运行时间、内存使用等',
    inputSchema: z.object({}).passthrough(),
    annotations: { readOnlyHint: true },
  }, async () => {
    return { content: [{ type: 'text' as const, text: JSON.stringify(getHealthStatus(), null, 2) }] }
  })
  registered.add('health_get')

  server.registerTool('dsl_spec', {
    description: '获取 DSL 规范信息，包含所有支持的标签、属性、布局规则等',
    inputSchema: z.object({}).passthrough(),
    annotations: { readOnlyHint: true },
  }, async () => {
    return { content: [{ type: 'text' as const, text: JSON.stringify(DSL_SPEC, null, 2) }] }
  })
  registered.add('dsl_spec')

  // 4) 元工具：查看 / 扩展当前暴露的工具集
  server.registerTool(MCP_TOOLS_TOOL_NAME, {
    // 描述口径：「查看/扩展当前暴露的 MCP 工具集」；默认 gen（可用 UXSHIP_MCP_PROFILE=full 全量），
    // 其余工具用 profile 或具体 tool 名按需加载
    description:
      '查看/扩展当前暴露的 MCP 工具集。默认 gen；用 profile（full/design/tokens/ops/agent/core）或具体 tool 名可按需加载被隐藏的工具，之后客户端会收到工具列表变更通知',
    inputSchema: toolInputSchemaToZod({
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'enable'], description: 'status 查看当前工具面 / enable 加载工具' },
        profile: { type: 'array', items: { type: 'string' }, description: 'profile 名，可多个（也支持逗号分隔）' },
        tool: { type: 'array', items: { type: 'string' }, description: '具体工具名，可多个' },
      },
      required: ['action'],
    }),
  }, async (args) => {
    const input = (args ?? {}) as { action?: unknown; profile?: unknown; tool?: unknown }
    const action = typeof input.action === 'string' ? input.action : ''

    if (action === 'status') {
      const hiddenTools = tools.filter((tool) => !registered.has(tool.name))
      const byProfile: Record<string, string[]> = {}
      for (const profile of PROFILE_NAMES) {
        byProfile[profile] = toolsForProfiles(hiddenTools, [profile]).map((tool) => tool.name)
      }

      return textResult({
        profile: profiles,
        tools: { count: registered.size, names: [...registered].sort() },
        hidden: {
          count: hiddenTools.length,
          byProfile,
          names: hiddenTools.map((tool) => tool.name).sort(),
        },
        profiles: PROFILE_NAMES.map((name) => ({
          name,
          label: TOOL_PROFILES[name].label,
          description: TOOL_PROFILES[name].description,
          // 推荐 profile 排在最前并显式标注，便于 AI 一眼选中
          ...(TOOL_PROFILES[name].recommended ? { recommended: true } : {}),
          toolCount: toolsForProfiles(tools, [name]).length,
          chars: JSON.stringify(toolsForProfiles(tools, [name])).length,
        })),
        alwaysOn: [...ALWAYS_ON_TOOLS],
      })
    }

    if (action === 'enable') {
      const unknown: string[] = []
      const enabled: string[] = []
      const alreadyActive: string[] = []

      // profile：未知值不抛错，进 unknown（附合法值提示）
      const requestedProfiles: ToolProfile[] = []
      for (const raw of toStringList(input.profile)) {
        const name = raw.toLowerCase()
        if (isToolProfile(name)) {
          if (!requestedProfiles.includes(name)) requestedProfiles.push(name)
        } else if (!unknown.includes(raw)) {
          unknown.push(raw)
        }
      }

      // 目标工具名：profile 命中的 + 显式指定的，去重后逐个注册
      const targets = new Set<string>()
      for (const tool of toolsForProfiles(tools, requestedProfiles)) targets.add(tool.name)
      for (const name of toStringList(input.tool)) {
        const tool = toolsMap[name]
        if (tool) {
          targets.add(tool.name)
        } else if (registered.has(name) || ALWAYS_ON_TOOLS.includes(name)) {
          // 诊断工具 / 元工具不在业务工具数组里（没有 MCPTool 定义），但它们始终已注册
          targets.add(name)
        } else if (!unknown.includes(name)) {
          unknown.push(name)
        }
      }

      for (const name of targets) {
        if (registered.has(name)) {
          alreadyActive.push(name)
          continue
        }
        const tool = toolsMap[name]
        if (!tool) {
          if (!unknown.includes(name)) unknown.push(name)
          continue
        }
        registerOne(tool)
        enabled.push(name)
      }

      // 有新工具真正上线才通知客户端刷新 tools/list
      if (enabled.length > 0) server.sendToolListChanged()

      return textResult({
        enabled,
        alreadyActive,
        unknown,
        profile: profiles,
        ...(unknown.length > 0
          ? {
              hint: `未知 profile / 工具名：${unknown.join(', ')}。合法 profile：${PROFILE_NAMES.join(' / ')}；工具名可先调 mcp_tools({ action: 'status' }) 查看`,
            }
          : {}),
      })
    }

    return textResult(
      `未知 action：${action || '(空)'}。合法值：status（查看当前工具面）/ enable（加载被隐藏的工具）`,
      true,
    )
  })
  registered.add(MCP_TOOLS_TOOL_NAME)
}

/** 供测试与文档使用的工具面统计（按 profile 过滤后的工具数与整份 JSON 字符数） */
export function toolProfileStats(profile: ToolProfile): { count: number; chars: number; names: string[] } {
  const list = toolsForProfiles(tools, [profile])
  return { count: list.length, chars: JSON.stringify(list).length, names: list.map((tool) => tool.name) }
}
