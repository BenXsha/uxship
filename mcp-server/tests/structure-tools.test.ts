import { describe, it, expect } from 'vitest'
import { getStructureTools } from '../src/utils/tools/structure.js'

/**
 * 顶层结构查询工具定义测试
 *
 * 锁死 `node_get_root` 的对外契约：名称、必填参数 nodeId、可选参数集合与类型。
 * 这些字段会被 `json-schema-to-zod` 转成 zod 再注册到 SDK，
 * 一旦被降级/漏声明，MCP 客户端 tools/list 里就会丢 required/类型。
 */
describe('getStructureTools', () => {
  const tools = getStructureTools()
  const tool = tools.find(t => t.name === 'node_get_root')

  it('只导出 node_get_root 一个工具', () => {
    expect(tools.map(t => t.name)).toEqual(['node_get_root'])
  })

  it('工具存在且描述包含用途关键词', () => {
    expect(tool).toBeDefined()
    expect(tool!.description).toContain('根')
    expect(tool!.description).toContain('祖先')
  })

  it('inputSchema 为 object 且 nodeId 必填', () => {
    const schema: any = tool!.inputSchema
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['nodeId'])
  })

  it('参数集合与类型符合约定', () => {
    const props: any = (tool!.inputSchema as any).properties
    expect(Object.keys(props).sort()).toEqual(['fields', 'includeSubtree', 'maxDepth', 'nodeId'])
    expect(props.nodeId.type).toBe('string')
    expect(props.includeSubtree.type).toBe('boolean')
    expect(props.maxDepth.type).toBe('number')
    // fields：白名单（只过滤顶层；id 始终返回）
    expect(props.fields.type).toBe('array')
    expect(props.fields.items.type).toBe('string')
  })

  it('inputSchema 只使用受支持的 JSON Schema 关键字', () => {
    const schema: any = tool!.inputSchema
    expect(Object.keys(schema).sort()).toEqual(['properties', 'required', 'type'])
    for (const prop of Object.values<any>(schema.properties)) {
      expect(['string', 'boolean', 'number', 'array']).toContain(prop.type)
      expect(prop.$ref).toBeUndefined()
      expect(prop.anyOf).toBeUndefined()
      expect(prop.oneOf).toBeUndefined()
      expect(prop.additionalProperties).toBeUndefined()
    }
    // 数组参数只用 items（不用 items + minItems 等额外关键字，避免插件端转换出竞态）
    expect((schema.properties as any).fields.items).toEqual({ type: 'string' })
  })

  it('描述精简（≤260 字符）且不复述客户端能力矩阵（能力事实归 plugin_capabilities 与技能文档）', () => {
    expect(tool!.description.length).toBeLessThanOrEqual(260)
    expect(tool!.description).not.toContain('私有版')
    expect(tool!.description).not.toContain('getTopContainerInfoListByPageID')
  })
})
