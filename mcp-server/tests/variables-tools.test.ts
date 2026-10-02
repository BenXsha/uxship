import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { getVariableTools } from '../src/utils/tools/variables.js'
import { resolvePluginMethod, arrayFormMethodMap } from '../src/utils/tools.js'
import { jsonSchemaToZod } from '../src/utils/json-schema-to-zod.js'

/**
 * 变量系统（Design Token）工具定义测试
 *
 * 只针对 `getVariableTools()` 的产物做断言（不经过全局注册表，接线由统一流程完成）：
 * - 工具名与插件方法（variable/list|create|update|delete）一一对应
 * - 必填参数、枚举值（type / scopes）
 * - inputSchema 不越界使用 $ref / anyOf / oneOf / additionalProperties
 * - 经 json-schema-to-zod 转换后 required / enum 仍然保真（MCP 客户端实际看到的 schema）
 */

const TOOL_NAMES = ['variable_list', 'variable_create', 'variable_update', 'variable_delete']

const tools = getVariableTools()
const byName = (name: string) => {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`未定义工具: ${name}`)
  return tool
}

/** MCP 客户端实际会看到的 schema（SDK 由 zod 生成的同一路径） */
const published = (name: string) => z.toJSONSchema(jsonSchemaToZod(byName(name).inputSchema)) as any

describe('getVariableTools', () => {
  it('导出 4 个工具，名称与插件方法一一对应', () => {
    expect(tools.map((t) => t.name)).toEqual(TOOL_NAMES)
    // 服务端按下划线 → 斜杠映射到插件方法
    for (const name of TOOL_NAMES) {
      expect(name.replace(/_/g, '/')).toMatch(/^variable\/(list|create|update|delete)$/)
    }
  })

  it('每个工具都有中文描述，且不复述客户端能力矩阵（口径归 plugin_capabilities 与技能文档）', () => {
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.description.length).toBeLessThanOrEqual(260)
      expect(tool.description).not.toContain('mg.variables')
      expect(tool.description).not.toContain('私有版实测')
      expect(tool.inputSchema.type).toBe('object')
    }
  })
})

describe('variable_list', () => {
  it('全部参数可选，无 required', () => {
    const schema = byName('variable_list').inputSchema
    expect(schema.required).toBeUndefined()
    expect(Object.keys(schema.properties as any).sort()).toEqual([
      'collectionId',
      'groupPath',
      'includeExternal',
      'includeValues',
      'type',
    ])
  })

  it('type 枚举与 Design Token 类型一致，且经转换后保真', () => {
    const schema = byName('variable_list').inputSchema as any
    expect(schema.properties.type.enum).toEqual([
      'COLOR',
      'NUMBER',
      'STRING',
      'BOOLEAN',
      'PAINT',
      'TEXT',
      'EFFECT',
      'GRID',
      'STROKE_WIDTH',
      'CORNER_RADIUS',
      'PADDING',
      'SPACING',
    ])
    expect(published('variable_list').properties.type.enum).toEqual(schema.properties.type.enum)
  })
})

describe('variable_create', () => {
  it('支持批量形态：variables[] 与 name/type 二选一（schema 不再硬性 required）', () => {
    const schema = byName('variable_create').inputSchema as any
    // 批形态只传 variables、不传 name/type —— 若保留 required 会在 schema 层被拒
    expect(schema.required).toBeUndefined()
    expect(schema.properties.variables.type).toBe('array')
    // 单条形态的 name/type 校验下沉到插件（缺 name 时报错）
  })

  it('value 不限制类型（可为数字/字符串/布尔/对象），只保留描述', () => {
    const schema = byName('variable_create').inputSchema as any
    expect(schema.properties.value.type).toBeUndefined()
    expect(schema.properties.value.description).toContain('初始值')

    const publishedValue = published('variable_create').properties.value
    // 未声明 type 的属性放开为任意类型（anyOf/oneOf 之类会被转换函数直接忽略）
    expect(JSON.stringify(publishedValue)).not.toContain('anyOf')
  })

  it('可选参数：value / variables / collectionId / description', () => {
    const schema = byName('variable_create').inputSchema as any
    expect(Object.keys(schema.properties).sort()).toEqual([
      'collectionId',
      'description',
      'name',
      'type',
      'value',
      'variables',
    ])
  })
})

describe('variable_update', () => {
  it('id 必填，值字段 + 绑定字段都可选', () => {
    const schema = byName('variable_update').inputSchema as any
    expect(schema.required).toEqual(['id'])
    expect(Object.keys(schema.properties).sort()).toEqual([
      'activateSet',
      'alias',
      'codeSyntax',
      'description',
      'id',
      'modeId',
      'name',
      'nodeIds',
      'properties',
      'scopes',
      'value',
    ])
    expect(published('variable_update').required).toEqual(['id'])
  })

  it('传 nodeIds 时按实参形状选路到 variable/apply（绑定而非改值）', () => {
    // 同一工具名的第二条语义：不新增第 68 个工具（工具面预算硬门禁）
    expect(arrayFormMethodMap().variable_update).toEqual({ param: 'nodeIds', method: 'variable/apply' })
    expect(resolvePluginMethod('variable_update', { id: 'tok-1', nodeIds: ['n-1'] })).toBe('variable/apply')
    expect(resolvePluginMethod('variable_update', { id: 'tok-1', value: '#FF0000' })).toBe('variable/update')
    // 空数组不算绑定意图（与 node_delete 同口径：给出数组即走批量/绑定）
    expect(resolvePluginMethod('variable_update', { id: 'tok-1', nodeIds: [] })).toBe('variable/update')
  })

  it('传 variables[] 时按实参形状选路到 variable/batchCreate（批量建令牌）', () => {
    expect(arrayFormMethodMap().variable_create).toEqual({ param: 'variables', method: 'variable/batchCreate' })
    expect(resolvePluginMethod('variable_create', { variables: [{ name: 'a', type: 'COLOR', value: '#000' }] })).toBe('variable/batchCreate')
    expect(resolvePluginMethod('variable_create', { name: 'a', type: 'COLOR', value: '#000' })).toBe('variable/create')
    expect(resolvePluginMethod('variable_create', { variables: [] })).toBe('variable/create')
  })

  it('scopes 的 items 是 ScopeName 枚举且经转换后保真', () => {
    const schema = byName('variable_update').inputSchema as any
    expect(schema.properties.scopes.type).toBe('array')
    expect(schema.properties.scopes.items.enum).toContain('fill')
    expect(schema.properties.scopes.items.enum).toContain('cornerRadius')

    const publishedItems = published('variable_update').properties.scopes.items
    expect(publishedItems.enum).toEqual(schema.properties.scopes.items.enum)
  })

  it('codeSyntax 是 web / android / ios 三个字符串字段', () => {
    const schema = byName('variable_update').inputSchema as any
    expect(Object.keys(schema.properties.codeSyntax.properties).sort()).toEqual(['android', 'ios', 'web'])
  })
})

describe('variable_delete', () => {
  it('id / ids 二选一，均非必填', () => {
    const schema = byName('variable_delete').inputSchema as any
    expect(schema.required).toBeUndefined()
    expect(schema.properties.ids).toMatchObject({ type: 'array', items: { type: 'string' } })
    expect(published('variable_delete').properties.ids).toMatchObject({ type: 'array' })
  })
})

describe('schema 支持面', () => {
  it('不使用 $ref / anyOf / oneOf / additionalProperties', () => {
    const walk = (node: any, path: string) => {
      if (!node || typeof node !== 'object') return
      for (const key of ['$ref', 'anyOf', 'oneOf', 'additionalProperties']) {
        expect(node[key], `${path} 不应使用 ${key}`).toBeUndefined()
      }
      for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`)
    }
    for (const tool of tools) walk(tool.inputSchema, tool.name)
  })

  it('每个工具都能被 jsonSchemaToZod 转成 object schema，且必填校验仍然生效', () => {
    for (const tool of tools) {
      const parsed = jsonSchemaToZod(tool.inputSchema).safeParse({})
      expect(published(tool.name).type).toBe('object')
      if ((tool.inputSchema.required ?? []).length > 0) {
        expect(parsed.success, `${tool.name} 缺必填参数时应校验失败`).toBe(false)
      }
    }
  })
})
