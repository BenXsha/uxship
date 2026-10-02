import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { jsonSchemaToZod, toolInputSchemaToZod } from '../src/utils/json-schema-to-zod.js'
import { tools } from '../src/utils/tools.js'

/**
 * 工具 schema 保真回归测试
 *
 * 背景：register-tools.ts 曾把每个属性降级成 `z.any().optional()`，
 * MCP 客户端 tools/list 里既没有 required 也没有 enum —— LLM 无从知道
 * 哪些参数必填、哪些取值合法。这里用 `z.toJSONSchema()`（SDK 发布 schema 的同一路径）
 * 断言保真度。
 */
function published(schema: any) {
  return z.toJSONSchema(jsonSchemaToZod(schema)) as any
}

describe('jsonSchemaToZod', () => {
  it('preserves required', () => {
    const json = published({
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '节点 ID' },
        properties: { type: 'object', description: '属性' },
      },
      required: ['nodeId', 'properties'],
    })
    expect(json.required).toEqual(['nodeId', 'properties'])
    expect(json.properties.nodeId.type).toBe('string')
  })

  it('preserves string enums', () => {
    const json = published({
      type: 'object',
      properties: { type: { type: 'string', enum: ['rectangle', 'text', 'frame'] } },
      required: ['type'],
    })
    expect(json.properties.type.enum).toEqual(['rectangle', 'text', 'frame'])
  })

  it('preserves nested object/array requirements', () => {
    const json = published({
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { type: { type: 'string' }, properties: { type: 'object' } },
            required: ['type'],
          },
        },
      },
      required: ['nodes'],
    })
    expect(json.properties.nodes.items.required).toEqual(['type'])
  })

  it('keeps passthrough so routing params survive', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: { nodeId: { type: 'string' } },
      required: ['nodeId'],
    })
    expect(schema.parse({ nodeId: '1:2', _sessionId: 'sess_x' })).toMatchObject({
      nodeId: '1:2',
      _sessionId: 'sess_x',
    })
  })

  it('keeps nested object passthrough (自由 config / 属性覆写)', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: { config: { type: 'object' } },
    })
    expect(schema.parse({ config: { anything: [1, 2, 3] } })).toEqual({ config: { anything: [1, 2, 3] } })
  })

  it('does not inject defaults', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: { focus: { type: 'boolean', default: true } },
    })
    expect(schema.parse({})).toEqual({})
  })

  it('unknown type 降级为 z.any，但 description 与 anyOf 都保留', () => {
    const json = published({
      type: 'object',
      properties: { weird: { anyOf: [{ type: 'string' }, { type: 'number' }], description: '复杂结构' } },
    })
    expect(json.properties.weird.description).toBe('复杂结构')
    expect(json.properties.weird.anyOf).toEqual([{ type: 'string' }, { type: 'number' }])
  })

  it('anyOf / oneOf / allOf 原样透传到发布 schema（zod 类型表达不出跨字段约束）', () => {
    // 发布出去的 schema 是 z.toJSONSchema(zod) 生成的，源头是 zod 类型，
    // 而「这几个字段至少给一组」这类约束 zod 表达不出来 —— 必须靠 .meta() 透传。
    const json = published({
      type: 'object',
      properties: { nodeId: { type: 'string' }, updates: { type: 'array' } },
      anyOf: [{ required: ['nodeId'] }, { required: ['updates'] }],
    })
    expect(json.anyOf).toEqual([{ required: ['nodeId'] }, { required: ['updates'] }])
    // 透传不得破坏同层的 properties
    expect(json.properties.nodeId.type).toBe('string')

    expect(published({ type: 'object', oneOf: [{ required: ['a'] }] }).oneOf).toEqual([{ required: ['a'] }])
    expect(published({ type: 'object', allOf: [{ required: ['b'] }] }).allOf).toEqual([{ required: ['b'] }])
  })

  it('空的组合关键字不产生空数组（未声明 anyOf 的工具输出与改动前逐字节一致）', () => {
    const json = published({ type: 'object', properties: { a: { type: 'string' } }, anyOf: [] })
    expect(json.anyOf).toBeUndefined()
  })

  it('treats empty schema as a permissive object', () => {
    expect(toolInputSchemaToZod(undefined).parse({ anything: 1 })).toEqual({ anything: 1 })
  })
})

describe('真实工具 schema 保真', () => {
  it('node_update 单体/批量两形式都保留参数类型，且二选一约束发布到 anyOf', () => {
    const tool = tools.find((t) => t.name === 'node_update')!
    const json = published(tool.inputSchema)
    expect(json.properties.nodeId.type).toBe('string')
    expect(json.properties.properties.type).toBe('object')
    // 批量内层仍强制 nodeId + properties
    expect(json.properties.updates.items.required).toEqual(expect.arrayContaining(['nodeId', 'properties']))
    // 合并工具没有顶层 required，靠 anyOf 表达「单体组 / 批量组至少给一组」
    expect(json.required).toBeUndefined()
    expect(json.anyOf).toEqual([{ required: ['nodeId', 'properties'] }, { required: ['updates'] }])
  })

  it('合并「单体 / 批量」的工具必须发布二选一约束（防止模型发空 {} 被服务端拒）', () => {
    // 这 4 个工具在服务端按实参形状选路（见 tools.ts 的 ARRAY_FORM_METHOD_MAP 与
    // resolvePluginMethod），合并时顶层 required 丢了；anyOf 是模型唯一能看到的
    // 「至少给一组」信号 —— 实测缺它会连续重试同一个空参调用。
    const merged: Record<string, unknown[]> = {
      node_create: [{ required: ['type'] }, { required: ['nodes'] }],
      node_update: [{ required: ['nodeId', 'properties'] }, { required: ['updates'] }],
      node_delete: [{ required: ['nodeId'] }, { required: ['nodeIds'] }],
      design_suggest: [{ required: ['instruction'] }, { required: ['instructions'] }],
    }
    for (const [name, expected] of Object.entries(merged)) {
      const tool = tools.find((t) => t.name === name)
      expect(tool, `工具 ${name} 不存在`).toBeTruthy()
      expect(published(tool!.inputSchema).anyOf, `${name} 的二选一约束漂移`).toEqual(expected)
    }
  })

  it('每个声明了 anyOf 的工具，发布出去的 schema 都逐字保留了它（自维护断言）', () => {
    const drifted = tools
      .filter((t) => Array.isArray((t.inputSchema as any).anyOf) && (t.inputSchema as any).anyOf.length > 0)
      .filter((t) => {
        const json = published(t.inputSchema) as any
        return JSON.stringify(json.anyOf) !== JSON.stringify((t.inputSchema as any).anyOf)
      })
      .map((t) => t.name)
    expect(drifted).toEqual([])
  })

  it('node_create 的 type 枚举完整（10 种）', () => {
    const tool = tools.find((t) => t.name === 'node_create')!
    const json = published(tool.inputSchema)
    expect(json.properties.type.enum).toHaveLength(10)
  })

  it('每个声明了 required 的工具，发布出去的 schema 都保留了 required（自维护断言）', () => {
    const drifted = tools
      .filter((t) => Array.isArray((t.inputSchema as any).required) && (t.inputSchema as any).required.length > 0)
      .filter((t) => {
        const json = published(t.inputSchema) as any
        const publishedRequired = new Set<string>(json.required ?? [])
        return !(t.inputSchema as any).required.every((key: string) => publishedRequired.has(key))
      })
      .map((t) => t.name)
    expect(drifted).toEqual([])
  })

  it('无参数工具数量保持在小范围内（防止 schema 被静默清空）', () => {
    const empty = tools.filter((t) => {
      const json = published(t.inputSchema) as any
      return Object.keys(json.properties ?? {}).length === 0
    })
    // 已知的无参数工具：document_get_info / selection_get / component_list /
    // style_list_colors / style_list_text / page_list / session_list / get_version …
    expect(empty.length).toBeLessThan(12)
  })

  it('必需参数缺失时被 schema 拦下（不再静默透传到 handler）', () => {
    const tool = tools.find((t) => t.name === 'node_gen') ?? tools.find((t) => t.name === 'node_get')!
    const schema = jsonSchemaToZod(tool.inputSchema)
    expect(() => schema.parse({})).toThrow()
  })
})
