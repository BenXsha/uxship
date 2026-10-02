import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  getToolList,
  getTool,
  getPluginMethod,
  resolvePluginMethod,
  PLUGIN_REGISTERED_METHODS,
} from '../src/utils/tools.js'
import { resolvePartition } from '../src/utils/partition-router.js'
import {
  classifiedToolNames,
  readOnlyToolNames,
  destructiveToolNames,
  getToolAnnotations,
} from '../src/utils/tool-annotations.js'
import { registerAllTools } from '../src/utils/register-tools.js'
import type { WebSocketBridge } from '../src/server/ws-bridge.js'

/**
 * 本批新增 4 个工具的契约门禁
 *
 * 背景：插件端早已实现 `node/group` / `node/boolean` / `fonts/list`，但服务端从未声明对应工具
 * （外部用户文档点名要求过）；`node/detachInstance` 是本次新增的插件能力。
 * 这些工具最容易出的一类错误是**名字映射**：`node_detach_instance` 走默认
 * `name.replace(/_/g, '/')` 会推成 `node/detach/instance`（插件端没有这个方法），
 * 而 `tools.test.ts` 的孤儿检查只在 `PLUGIN_REGISTERED_METHODS` 里也能找到时才会通过
 * ——所以这里额外把「映射结果」和「映射不是默认推导值」都钉死。
 *
 * 另一类是**参数形状漂移**：schema 必须与插件 handler 的真实入参一致（不编造参数）。
 * 插件端契约（`plugin-mastergo/lib/api/nodeHandlers.ts` / `utilHandlers.ts`）：
 * - `node/group`      → `{ nodeIds: string[]; groupName?: string }`
 * - `node/boolean`    → `{ nodeIds: string[]; operation: 'union'|'subtract'|'intersect'|'exclude' }`
 * - `node/detachInstance` → `{ nodeId: string }`
 * - `fonts/list`      → 无入参（handler 忽略 params）
 */

const NEW_TOOLS = ['node_group', 'node_boolean', 'node_detach_instance', 'fonts_list'] as const

/** 照抄 register-tools-schema.test.ts 的 helper：拿真正注册进 SDK 的工具表 */
function registeredTools(): Record<string, any> {
  // 本文件校验的 4 个新工具（node_group / node_boolean / node_detach_instance / fonts_list）
  // 都不在 gen 清单里，所以必须显式要 full（默认 profile 已是 gen）
  process.env.UXSHIP_MCP_PROFILE = 'full'
  const server = new McpServer({ name: 'test-server', version: '0.0.0' })
  const bridge = { forwardRequest: async () => ({}) } as unknown as WebSocketBridge
  registerAllTools(server, bridge)
  return (server as any)._registeredTools as Record<string, any>
}

const registered = registeredTools()

describe('新增工具的声明与登记', () => {
  it('4 个工具都在工具列表里且名字唯一', () => {
    const names = getToolList().map((t) => t.name)
    for (const name of NEW_TOOLS) expect(names, `${name} 未出现在 getToolList()`).toContain(name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('每个工具都有非空描述与 inputSchema', () => {
    for (const name of NEW_TOOLS) {
      const tool = getTool(name)
      expect(tool, `${name} 不存在`).toBeDefined()
      expect((tool?.description || '').length, `${name} 缺描述`).toBeGreaterThan(0)
      expect(tool?.inputSchema?.type).toBe('object')
    }
  })

  it('每个工具都登记了分区（profile 路由依赖它）', () => {
    for (const name of NEW_TOOLS) expect(resolvePartition(name), `${name} 未登记分区`).toBeDefined()
    expect(resolvePartition('node_group')).toBe('core')
    expect(resolvePartition('node_boolean')).toBe('core')
    expect(resolvePartition('node_detach_instance')).toBe('core')
    expect(resolvePartition('fonts_list')).toBe('resources')
  })
})

describe('插件方法映射（防止默认推导把工具打到不存在的方法）', () => {
  it('node_detach_instance 显式压平到 node/detachInstance', () => {
    expect(getPluginMethod('node_detach_instance')).toBe('node/detachInstance')
    // 反面：默认 `_`→`/` 规则会推成 node/detach/instance，插件端没有这个方法
    expect(getPluginMethod('node_detach_instance')).not.toBe('node/detach/instance')
    expect(resolvePluginMethod('node_detach_instance', { nodeId: '1:2' })).toBe('node/detachInstance')
  })

  it('node_group / node_boolean / fonts_list 走默认映射（无多段歧义）', () => {
    expect(getPluginMethod('node_group')).toBe('node/group')
    expect(getPluginMethod('node_boolean')).toBe('node/boolean')
    expect(getPluginMethod('fonts_list')).toBe('fonts/list')
  })

  it('4 个映射目标都在 PLUGIN_REGISTERED_METHODS 里（不会静默转发到不存在的方法）', () => {
    for (const name of NEW_TOOLS) {
      const method = getPluginMethod(name)
      expect(method, `${name} 未映射`).toBeDefined()
      expect(PLUGIN_REGISTERED_METHODS.has(method as string), `${method} 未登记为插件已注册方法`).toBe(true)
    }
  })

  it('新工具都是插件转发（不是服务端本地工具）', () => {
    for (const name of NEW_TOOLS) expect(getPluginMethod(name)).toBeTruthy()
  })
})

describe('参数形状与插件 handler 入参一致', () => {
  it('node_group：nodeIds 必填（数组），groupName 可选', () => {
    const schema = getTool('node_group')?.inputSchema as any
    expect(Object.keys(schema.properties).sort()).toEqual(['groupName', 'nodeIds'])
    expect(schema.required).toEqual(['nodeIds'])
    expect(schema.properties.nodeIds.type).toBe('array')
    expect(schema.properties.nodeIds.items.type).toBe('string')
    expect(schema.properties.groupName.type).toBe('string')
  })

  it('node_boolean：nodeIds + operation 都必填，operation 是四值枚举', () => {
    const schema = getTool('node_boolean')?.inputSchema as any
    expect(Object.keys(schema.properties).sort()).toEqual(['nodeIds', 'operation'])
    expect(schema.required).toEqual(['nodeIds', 'operation'])
    expect(schema.properties.operation.enum).toEqual(['union', 'subtract', 'intersect', 'exclude'])
    expect(schema.properties.nodeIds.items.type).toBe('string')
  })

  it('node_detach_instance：只有 nodeId，且必填', () => {
    const schema = getTool('node_detach_instance')?.inputSchema as any
    expect(Object.keys(schema.properties)).toEqual(['nodeId'])
    expect(schema.required).toEqual(['nodeId'])
    expect(schema.properties.nodeId.type).toBe('string')
  })

  it('fonts_list：无入参（插件 handler 忽略 params），因此没有 required', () => {
    const schema = getTool('fonts_list')?.inputSchema as any
    expect(schema.properties).toEqual({})
    expect(schema.required).toBeUndefined()
  })

  it('发布形态（客户端真实看到的 schema）保留必填与枚举', () => {
    expect(z.toJSONSchema(registered['node_group'].inputSchema).required).toEqual(['nodeIds'])
    const boolean = z.toJSONSchema(registered['node_boolean'].inputSchema) as any
    expect(boolean.required).toEqual(['nodeIds', 'operation'])
    expect(boolean.properties.operation.enum).toEqual(['union', 'subtract', 'intersect', 'exclude'])
    expect(z.toJSONSchema(registered['node_detach_instance'].inputSchema).required).toEqual(['nodeId'])
    const fonts = z.toJSONSchema(registered['fonts_list'].inputSchema) as any
    expect(fonts.type).toBe('object')
    // 转换器不支持的结构会静默退化成 any —— 这里确保没写进去
    for (const name of NEW_TOOLS) {
      const raw = JSON.stringify(z.toJSONSchema(registered[name].inputSchema))
      expect(raw, `${name} 的 schema 含 anyOf/$ref`).not.toMatch(/\$ref|anyOf/)
    }
  })
})

describe('annotations 分类', () => {
  it('4 个工具都被显式登记（门禁要求「想过副作用」）', () => {
    const classified = new Set(classifiedToolNames())
    for (const name of NEW_TOOLS) expect(classified.has(name), `${name} 未登记 annotations`).toBe(true)
  })

  it('node_detach_instance 是破坏性（丢主组件关联）：带 destructiveHint，不声明只读', () => {
    expect(destructiveToolNames()).toContain('node_detach_instance')
    expect(getToolAnnotations('node_detach_instance')?.destructiveHint).toBe(true)
    expect(getTool('node_detach_instance')?.annotations?.destructiveHint).toBe(true)
    expect(registered['node_detach_instance'].annotations?.destructiveHint).toBe(true)
    expect(getToolAnnotations('node_detach_instance')?.readOnlyHint).toBeUndefined()
  })

  it('fonts_list 是只读：带 readOnlyHint，不带 destructiveHint', () => {
    expect(readOnlyToolNames()).toContain('fonts_list')
    expect(getToolAnnotations('fonts_list')?.readOnlyHint).toBe(true)
    expect(getTool('fonts_list')?.annotations?.readOnlyHint).toBe(true)
    expect(registered['fonts_list'].annotations?.readOnlyHint).toBe(true)
    expect(getToolAnnotations('fonts_list')?.destructiveHint).toBeUndefined()
  })

  it('node_group / node_boolean 是普通写入：登记但**不挂注解**（省 tools/list 字节）', () => {
    const classified = new Set(classifiedToolNames())
    expect(classified.has('node_group')).toBe(true)
    expect(classified.has('node_boolean')).toBe(true)
    expect(readOnlyToolNames()).not.toContain('node_group')
    expect(destructiveToolNames()).not.toContain('node_group')
    expect(readOnlyToolNames()).not.toContain('node_boolean')
    expect(destructiveToolNames()).not.toContain('node_boolean')
    for (const name of ['node_group', 'node_boolean']) {
      expect(getToolAnnotations(name), `${name} 不应挂空注解`).toBeUndefined()
      expect(getTool(name)?.annotations).toBeUndefined()
      expect(registered[name].annotations).toBeUndefined()
    }
  })
})
