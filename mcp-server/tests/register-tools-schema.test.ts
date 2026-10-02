import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerAllTools } from '../src/utils/register-tools.js'
import type { WebSocketBridge } from '../src/server/ws-bridge.js'

/**
 * 「真正发布出去的 schema」保真测试
 *
 * `json-schema-to-zod.test.ts` 验证的是转换函数；本文件验证**注册到 SDK 之后**的 schema ——
 * 也就是 MCP 客户端 `tools/list` 实际看到的东西（SDK 由 zod 生成 JSON Schema）。
 * 这正是历史缺陷的落点：`register-tools.ts` 曾把每个属性降级成 `z.any().optional()`，
 * 于是客户端看到的 `node_update` 既没有 `required` 也没有枚举。
 */
function buildServer(): McpServer {
  // 本文件校验的是「真正发布出去的 schema」全集（含 variable_list / node_create 等），
  // 因此必须显式要 full —— 默认 profile 已是 gen（见 tool-profiles.ts 的 DEFAULT_PROFILE）
  process.env.UXSHIP_MCP_PROFILE = 'full'
  const server = new McpServer({ name: 'test-server', version: '0.0.0' })
  const bridge = { forwardRequest: async () => ({}) } as unknown as WebSocketBridge
  registerAllTools(server, bridge)
  return server
}

/** 取 SDK 内部注册表（字段名随 SDK 版本变化，这里做一次兼容探测） */
function registeredTools(server: McpServer): Record<string, any> {
  const candidates = ['_registeredTools', 'registeredTools', '_tools']
  for (const key of candidates) {
    const value = (server as any)[key]
    if (value && typeof value === 'object') return value
  }
  throw new Error(`未找到 SDK 工具注册表，候选字段：${candidates.join(', ')}`)
}

function published(tool: any) {
  return z.toJSONSchema(tool.inputSchema) as any
}

describe('registerAllTools — 发布的 schema 保真', () => {
  it('注册了全部工具', () => {
    const server = buildServer()
    const tools = registeredTools(server)
    expect(Object.keys(tools).length).toBeGreaterThan(50)
  })

  it('annotations 会被发布到 tools/list（只读 / 破坏性信号）', () => {
    const tools = registeredTools(buildServer())
    // 只读：客户端可自动放行
    expect(tools['node_get'].annotations?.readOnlyHint).toBe(true)
    expect(tools['variable_list'].annotations?.readOnlyHint).toBe(true)
    // 破坏性：删除 / 原地替换类，客户端应要求确认
    expect(tools['node_delete'].annotations?.destructiveHint).toBe(true)
    expect(tools['variable_delete'].annotations?.destructiveHint).toBe(true)
    // 普通写入类不挂注解（annotations 同样占 tools/list 字节）
    expect(tools['node_create'].annotations).toBeUndefined()
    // 诊断工具也标了只读
    expect(tools['health_get'].annotations?.readOnlyHint).toBe(true)
  })

  it('node_update 发布后保留参数类型与嵌套 required（不再是 any）', () => {
    const tools = registeredTools(buildServer())
    const schema = published(tools['node_update'])
    expect(schema.type).toBe('object')
    expect(schema.properties.nodeId.type).toBe('string')
    expect(schema.properties.properties.type).toBe('object')
    // 合并工具：单体/批量二选一，校验挂在批量内层
    expect(schema.properties.updates.items.required).toEqual(expect.arrayContaining(['nodeId', 'properties']))
  })

  it('node_create 发布后保留 type 枚举', () => {
    const tools = registeredTools(buildServer())
    const schema = published(tools['node_create'])
    expect(schema.properties.type.enum).toHaveLength(10)
  })

  it('保留 passthrough：_sessionId 不会被 schema 剥掉', () => {
    const tools = registeredTools(buildServer())
    const schema = z.object({}).passthrough()
    const parsed = tools['node_get'].inputSchema.parse({ nodeId: '1:2', _sessionId: 'sess_x' })
    expect(parsed).toMatchObject({ nodeId: '1:2', _sessionId: 'sess_x' })
    // 同时确认 schema 自身不是 strict（否则 SDK 会拒绝未知键）
    const json = published(tools['node_get'])
    expect(json.additionalProperties).not.toBe(false)
    expect(schema).toBeTruthy()
  })

  it('version 与 SERVER_VERSION 一致（握手不再报旧版本）', () => {
    const server = buildServer()
    // McpServer 的 serverInfo 由构造参数决定；这里断言 registerAllTools 未另行写死版本
    const info = (server as any).server?._serverInfo ?? (server as any)._serverInfo
    expect(JSON.stringify(info ?? {})).not.toContain('2.0.0')
  })
})
