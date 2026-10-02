import type { MCPTool } from '../../types/mcp-types.js'

/**
 * 批量导出工具（工作流 B）
 *
 * 一个工具覆盖「一次导出多个图层」的两种形态：
 * - svg → 插件方法 `node/exportBatch`（内部走 `mg.exportSvgByLayerIds(layerIds)`）
 * - png → 同一插件方法（内部走 `mg.exportPng({ ids, filterIds, scale })`，多图层合并导出）
 *
 * 已在私有化企业版 MasterGoPrivate 1.10.3 实测这两个宿主 API 可用；
 * 但宿主返回值的形态（SVG 源码 / data URI / 纯 base64）在 typings 里没有保证，
 * 插件端统一归一化成 `encoding: 'text' | 'base64'` 后再回传，服务端不解析二进制。
 */
const exportBatchTool: MCPTool = {
  name: 'node_export_batch',
  description:
    '把多个图层合并导出为一张 SVG（exportSvgByLayerIds）或 PNG（exportPng，可 scale 倍率 / filterIds 排除图层）。不传 layerIds 默认导出当前选区。返回 encoding=text（SVG 源码）或 base64（已剥 data URI 前缀）；内容超 maxBytes 会截断，建议配 savePath 落盘。',
  inputSchema: {
    type: 'object',
    properties: {
      layerIds: {
        type: 'array',
        items: { type: 'string' },
        description: '要导出的图层 ID（多图层合并成一张图）',
      },
      useSelection: {
        type: 'boolean',
        description: '不传 layerIds 时回退选区，默认 true',
      },
      format: {
        type: 'string',
        enum: ['svg', 'png'],
        description: 'svg = 矢量源码文本；png = 位图 base64',
      },
      scale: {
        type: 'number',
        description: 'PNG 倍率（2 = 2x），仅 format=png 生效',
      },
      filterIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'PNG 中要过滤掉的图层 ID',
      },
      savePath: {
        type: 'string',
        description: '写入该绝对路径（项目目录内）而非回传 base64',
      },
      maxBytes: {
        type: 'number',
        description: '回传上限字符数（默认 4MB），超出截断',
      },
    },
    required: ['format'],
  },
}

export function getExportBatchTools(): MCPTool[] {
  return [exportBatchTool]
}
