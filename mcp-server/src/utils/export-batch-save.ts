/**
 * 批量导出落盘辅助（服务端）
 *
 * 插件端 `node/exportBatch` 直接返回 base64/文本（受 maxBytes 截断保护）。
 * 当调用方传了 `savePath` 时，由服务端把内容写盘，响应里**不再回传大体积数据**，
 * 避免几十 KB ~ 几 MB 的 base64 灌进对话上下文。
 *
 * 与 `image-export.ts::saveImageToFile` 的口径一致：路径必须落在项目目录内（`isSafeSavePath`）。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isSafeSavePath } from './image-export.js'

/** 插件端 `node/exportBatch` 的返回结构 */
export interface ExportBatchResult {
  success?: boolean
  format?: 'svg' | 'png' | string
  count?: number
  layerIds?: string[]
  /** base64 = 纯 base64 字符串；text = 文本（SVG 源码） */
  encoding?: 'base64' | 'text' | string
  mimeType?: string
  data?: string
  bytes?: number
  truncated?: boolean
  warnings?: string[]
  reason?: string
  message?: string
}

/** 把批量导出结果解码为 Buffer */
function decodeExportData(result: ExportBatchResult): Buffer {
  const data = result.data ?? ''
  if (result.encoding === 'base64' || (result.mimeType?.startsWith('image/') && result.encoding !== 'text')) {
    return Buffer.from(data, 'base64')
  }
  return Buffer.from(data, 'utf-8')
}

/**
 * 构造批量导出的 MCP CallToolResponse。
 *
 * - 传 `savePath`：写盘成功 → 只回传路径/体积/截断标记（不回传数据本体）
 * - 未传 `savePath`：原样回传插件结果（text JSON）
 */
export function buildExportBatchResponse(
  result: ExportBatchResult,
  savePath: string
): { content: Array<{ type: string; text?: string }> } {
  if (!isSafeSavePath(savePath)) {
    throw new Error('Access denied: savePath must be within the project directory')
  }

  const dir = dirname(savePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const buffer = decodeExportData(result)
  writeFileSync(savePath, buffer)

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          format: result.format,
          count: result.count,
          layerIds: result.layerIds,
          filePath: savePath,
          fileSize: buffer.length,
          mimeType: result.mimeType,
          // 截断只影响回传的 data 字段；落盘内容同样来自被截断的数据，如实告知
          truncated: result.truncated ?? false,
          warnings: result.warnings,
        }),
      },
    ],
  }
}
