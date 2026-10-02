import { describe, it, expect } from 'vitest'
import { getExportBatchTools } from '../src/utils/tools/export-batch.js'

/**
 * 批量导出工具定义测试
 *
 * 锁死两件容易回归的事：
 * 1. 发布给 MCP 客户端的 schema —— `format` 必须是必填 + 枚举（否则 LLM 会瞎传 'jpg'/'PNG'）
 * 2. 可选参数集合 —— 少一个参数就意味着某一类导出用法彻底不可达
 * schema 只允许 type/properties/required/items/enum/description：
 * `json-schema-to-zod.ts` 不认识 $ref/anyOf/oneOf，写了会被静默降级成 z.any()。
 *
 * 接线清单（共享文件，本工作流不改，由仓库统一接线）：
 * - `src/utils/tools.ts`：合并 `getExportBatchTools()`；
 * - `src/utils/tools.ts` 的 PLUGIN_METHOD_MAP **必须**补 `node_export_batch: 'node/exportBatch'` ——
 *   默认规则会把每个下划线都换成斜杠，得到插件端并不存在的 `node/export/batch`；
 * - `PLUGIN_REGISTERED_METHODS` 补 `'node/exportBatch'`；
 * - `plugin-mastergo/lib/api/index.ts` 合并 `exportHandlers`（插件端 key 为 `node/exportBatch`）。
 */
const tools = getExportBatchTools()
const tool = tools.find((t) => t.name === 'node_export_batch')

describe('getExportBatchTools', () => {
  it('只导出一个工具，且名为 node_export_batch', () => {
    expect(tools).toHaveLength(1)
    expect(tool).toBeDefined()
    expect(tool!.name).toBe('node_export_batch')
  })

  it('description 说明双格式、返回值形态与截断行为', () => {
    const d = tool!.description
    expect(d).toContain('exportPng')
    expect(d).toContain('exportSvgByLayerIds')
    expect(d).toContain('base64')
    expect(d).toContain('截断')
  })

  it('必填参数只有 format', () => {
    expect(tool!.inputSchema.type).toBe('object')
    expect(tool!.inputSchema.required).toEqual(['format'])
  })

  it('format 是 svg|png 的字符串枚举', () => {
    const format = (tool!.inputSchema.properties as any).format
    expect(format.type).toBe('string')
    expect(format.enum).toEqual(['svg', 'png'])
  })

  it('可选参数集合完整（layerIds/useSelection/scale/filterIds/savePath/maxBytes）', () => {
    const props = tool!.inputSchema.properties as Record<string, any>
    expect(Object.keys(props).sort()).toEqual(
      ['filterIds', 'format', 'layerIds', 'maxBytes', 'savePath', 'scale', 'useSelection'].sort(),
    )
    expect(props.layerIds).toMatchObject({ type: 'array', items: { type: 'string' } })
    expect(props.filterIds).toMatchObject({ type: 'array', items: { type: 'string' } })
    expect(props.useSelection.type).toBe('boolean')
    expect(props.scale.type).toBe('number')
    expect(props.maxBytes.type).toBe('number')
    expect(props.savePath.type).toBe('string')
  })

  it('schema 只用 json-schema-to-zod 支持的关键字（无 $ref/anyOf/oneOf/additionalProperties）', () => {
    const raw = JSON.stringify(tool!.inputSchema)
    for (const banned of ['$ref', 'anyOf', 'oneOf', 'additionalProperties']) {
      expect(raw).not.toContain(banned)
    }
  })

})
