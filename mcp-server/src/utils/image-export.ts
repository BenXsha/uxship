/**
 * 图片导出文件写入工具
 *
 * 将插件返回的 base64 图片数据解码为二进制写入文件，
 * 并构造 MCP CallToolResponse 格式的响应。
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { isWithinAllowedDirs, pathDeniedMessage } from './path-guard.js'

/**
 * 路径是否可写入。
 *
 * 口径（信任根、`..` 逃逸、同前缀兄弟目录）统一在 `path-guard.ts` —— 本文件不再自带一份白名单。
 * 导出给单测（`tests/path-guard.test.ts`）与 `export-batch-save.ts`。
 */
export function isSafeSavePath(filePath: string): boolean {
  return isWithinAllowedDirs(filePath)
}

interface ImageExportResult {
  nodeId: string
  nodeName: string
  format: string
  mimeType: string
  data: string  // base64 data URI or SVG text
}

/**
 * 判断插件响应是否为图片导出结果
 */
export function isImageExportResult(result: unknown): result is ImageExportResult {
  if (!result || typeof result !== 'object') return false
  const r = result as Record<string, unknown>
  return typeof r.nodeId === 'string'
    && typeof r.format === 'string'
    && typeof r.mimeType === 'string'
    && typeof r.data === 'string'
}

/**
 * 将图片导出结果写入文件
 *
 * @param result 插件返回的图片导出结果
 * @param saveToPath 目标文件路径（绝对路径）
 * @returns 写入信息
 */
export function saveImageToFile(
  result: ImageExportResult,
  saveToPath: string
): { filePath: string; fileSize: number; mimeType: string } {
  if (!isSafeSavePath(saveToPath)) {
    throw new Error(pathDeniedMessage('saveToPath'))
  }
  // 确保目录存在
  const dir = dirname(saveToPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  let buffer: Buffer

  if (result.data.startsWith('data:')) {
    // base64 data URI → 解码为 Buffer
    const base64 = result.data.split(',')[1]
    if (!base64) {
      throw new Error('Invalid data URI: no base64 data found')
    }
    buffer = Buffer.from(base64, 'base64')
  } else if (result.format === 'SVG') {
    // SVG 纯文本
    buffer = Buffer.from(result.data, 'utf-8')
  } else {
    throw new Error(`Unexpected data format: expected data URI or SVG text`)
  }

  writeFileSync(saveToPath, buffer)

  return {
    filePath: saveToPath,
    fileSize: buffer.length,
    mimeType: result.mimeType,
  }
}

/**
 * 根据格式推导默认文件扩展名
 */
export function formatToExtension(format: string): string {
  switch (format.toUpperCase()) {
    case 'PNG': return '.png'
    case 'JPG': return '.jpg'
    case 'WEBP': return '.webp'
    case 'SVG': return '.svg'
    case 'PDF': return '.pdf'
    default: return '.png'
  }
}

/**
 * 构造图片导出的 MCP CallToolResponse
 *
 * 当 saveToPath 存在时：写入文件 + 返回 text(路径信息) + image(文件内容)
 * 当 saveToPath 不存在时：返回 text(base64数据)
 */
export function buildImageExportResponse(
  result: ImageExportResult,
  saveToPath?: string
): { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> } {
  if (saveToPath) {
    const info = saveImageToFile(result, saveToPath)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodeId: result.nodeId,
            nodeName: result.nodeName,
            format: result.format,
            filePath: info.filePath,
            fileSize: info.fileSize,
            mimeType: info.mimeType,
          }),
        },
        {
          type: 'image',
          data: result.data.startsWith('data:')
            ? result.data.split(',')[1]  // raw base64 (without data URI prefix)
            : Buffer.from(result.data).toString('base64'),
          mimeType: result.mimeType,
        },
      ],
    }
  }

  // 不写文件：返回完整 base64 数据
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result),
      },
    ],
  }
}
