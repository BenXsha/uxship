import { HandlerFunction } from './index'

/**
 * 批量导出处理器（node/exportBatch）
 *
 * 宿主 API（MasterGoPrivate 1.10.3 实测可用，见 skills/design/rules/12-limitations.md）：
 * - `mg.exportPng({ ids, filterIds, scale })` —— 导出多个图层组成的 png 图片，可过滤图层 id、设置缩放倍率
 * - `mg.exportSvgByLayerIds(layerIds)` —— 导出多个图层组成的 svg 图片
 *
 * 这两个 API 的返回值在 typings 里只声明为 `string`，实际可能是三种形态之一：
 * 「SVG 源码文本」/「data:...;base64,... 数据 URI」/「纯 base64」。插件端不猜，统一由
 * `normalizeExportPayload` 归一化成 { encoding, data } 再回传。
 * （`document.currentPage.getExportList()` 私有版不支持，本工作流不使用。）
 *
 * 设计约定（与 node/exportImage 的处理器保持一致）：
 * - 处理器返回「裸对象」，由 dispatcher 包成 JSON-RPC result
 * - 「客户端不支持该 API」「宿主抛错」都不冒泡，而是返回 { success: false, reason, message }，
 *   让上层能区分「客户端不支持」与「参数不对」——私有版客户端能力面差异大，这种区分很重要
 * - 大图不硬塞：超过 maxBytes 截断并给出中文 warning，提示改用 savePath 落盘
 */

/** 默认体积上限 4 MB（按字符数计：base64 字符数 ≈ 字节数，SVG 文本为 UTF-8 近似） */
export const DEFAULT_MAX_BYTES = 4 * 1024 * 1024

export type ExportFormat = 'svg' | 'png'

export interface NormalizedExportPayload {
  /** text = 原始文本（SVG 源码）；base64 = 纯 base64（data URI 前缀已剥离） */
  encoding: 'text' | 'base64'
  data: string
}

/** data URI 前缀：data:image/png;base64, / data:image/svg+xml,<svg … */
const DATA_URI_PREFIX_RE = /^data:([^,;]*)((?:;[^,;]*)*),/i

/** base64 字符集（Standard + URL-safe 都接受，避免宿主换编码风格时误判） */
const BASE64_CHARS_RE = /^[A-Za-z0-9+/=_-]+$/

/** 将 Uint8Array 编码为 base64（兼容无 btoa 的沙盒环境，与 nodeHandlers 同款实现） */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    chunks.push(String.fromCharCode(...slice))
  }
  if (typeof btoa === 'function') {
    return btoa(chunks.join(''))
  }
  const binary = chunks.join('')
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let result = ''
  for (let i = 0; i < binary.length; i += 3) {
    const b1 = binary.charCodeAt(i)
    const b2 = binary.charCodeAt(i + 1)
    const b3 = binary.charCodeAt(i + 2)
    result += chars[(b1 >> 2) & 0x3F]
    result += chars[((b1 << 4) | (b2 >> 4)) & 0x3F]
    result += i + 1 < binary.length ? chars[((b2 << 2) | (b3 >> 6)) & 0x3F] : '='
    result += i + 2 < binary.length ? chars[b3 & 0x3F] : '='
  }
  return result
}

/** 去掉 BOM 与首部空白后，是否像 XML/SVG 源码 */
function looksLikeMarkup(text: string): boolean {
  return text.replace(/^\uFEFF/, '').trimStart().startsWith('<')
}

/**
 * 是否「像纯 base64」。
 *
 * 只按「字符集 + 长度是 4 的倍数 + 至少 8 字符」判定：base64 长度必然是 4 的倍数，
 * 而宿主返回的普通文本（如 `export error: xxx`）既含空格也不满足长度约束，会被判成 text，
 * 避免把报错文案当 base64 回传给上层。
 */
function looksLikeBase64(compact: string): boolean {
  if (compact.length < 8 || compact.length % 4 !== 0) return false
  return BASE64_CHARS_RE.test(compact)
}

/**
 * 归一化宿主导出返回值 —— 纯函数，方便单测直接覆盖。
 *
 * 判定顺序（内容优先，format 只作为兜底提示）：
 * 1. 非字符串（null/undefined/数字/对象）→ 视为空内容：{ encoding: 'base64', data: '' }，由调用方判失败
 * 2. Uint8Array / ArrayBuffer（宿主未来若改返回二进制）→ 直接 base64 编码
 * 3. `data:` 数据 URI → 按 `;base64` 标记决定：剥离前缀后取 base64，或按 URI 解码取文本
 * 4. 像 XML/SVG 源码（去 BOM 后以 `<` 开头）→ { encoding: 'text' }
 * 5. 像纯 base64 → { encoding: 'base64' }（去掉换行/空白）
 * 6. 其它（宿主报错文案等）→ 按 text 原样返回，不伪装成 base64
 */
export function normalizeExportPayload(raw: unknown, format: ExportFormat): NormalizedExportPayload {
  if (typeof raw !== 'string') {
    if (raw instanceof Uint8Array) {
      return { encoding: 'base64', data: raw.length > 0 ? uint8ArrayToBase64(raw) : '' }
    }
    if (typeof ArrayBuffer !== 'undefined' && raw instanceof ArrayBuffer) {
      return { encoding: 'base64', data: raw.byteLength > 0 ? uint8ArrayToBase64(new Uint8Array(raw)) : '' }
    }
    return { encoding: 'base64', data: '' }
  }

  const text = raw.replace(/^\uFEFF/, '').trim()
  if (text === '') return { encoding: 'base64', data: '' }

  // data URI：前缀里带 ;base64 才是 base64，否则是 URL 编码的文本（如 data:image/svg+xml,<svg…）
  const uri = DATA_URI_PREFIX_RE.exec(text)
  if (uri) {
    const meta = uri[0].toLowerCase()
    const body = text.slice(uri[0].length)
    if (meta.includes(';base64')) {
      return { encoding: 'base64', data: body.replace(/\s+/g, '') }
    }
    try {
      return { encoding: 'text', data: decodeURIComponent(body) }
    } catch {
      return { encoding: 'text', data: body }
    }
  }

  if (looksLikeMarkup(text)) return { encoding: 'text', data: text }

  const compact = text.replace(/\s+/g, '')
  if (looksLikeBase64(compact)) return { encoding: 'base64', data: compact }

  // 剩下的情况：既非 XML 源码也不像 base64。私有版客户端在这种「未知返回形态」下多半是
  // 回了一段说明性文案而非导出结果 —— 按文本原样回传（不伪装成 base64），由调用方判定失败。
  console.warn(`[ExportBatch] 未识别的 ${format} 导出返回形态，按文本回传`)
  return { encoding: 'text', data: text }
}

/** 收集待导出图层 ID：显式 layerIds 优先，缺省且 useSelection !== false 时回退当前选区 */
function collectLayerIds(params: any): string[] {
  const explicit = Array.isArray(params?.layerIds)
    ? params.layerIds.filter((id: unknown) => typeof id === 'string' && id.trim() !== '')
    : []
  if (explicit.length > 0) return Array.from(new Set(explicit))

  if (params?.useSelection === false) return []

  const selection = mg.document?.currentPage?.selection || []
  const selected = Array.from(selection)
    .map((node: any) => (node && typeof node.id === 'string' ? node.id : ''))
    .filter((id: string) => id !== '')
  return Array.from(new Set(selected))
}

/** 批量导出多个图层为 SVG / PNG */
export const handleExportBatch: HandlerFunction = (params: any) => {
  const format: ExportFormat | undefined = params?.format === 'svg' ? 'svg' : params?.format === 'png' ? 'png' : undefined
  if (!format) {
    return { success: false, reason: 'invalid-params', message: 'format 必须是 "svg" 或 "png"' }
  }

  const layerIds = collectLayerIds(params)
  if (layerIds.length === 0) {
    return {
      success: false,
      reason: 'no-layers',
      message: '没有可导出的图层：请选择图层或传 layerIds',
    }
  }

  const api = mg as any
  const hostFnName = format === 'svg' ? 'exportSvgByLayerIds' : 'exportPng'
  if (typeof api[hostFnName] !== 'function') {
    return {
      success: false,
      reason: 'unsupported',
      message: '当前客户端不支持 exportSvgByLayerIds / exportPng（可用 plugin_capabilities 复核）',
    }
  }

  // 宿主抛错不冒泡：转成结构化失败，避免整条 JSON-RPC 请求变成 Internal error
  let raw: unknown
  try {
    if (format === 'svg') {
      raw = api.exportSvgByLayerIds(layerIds)
    } else {
      // 只透传显式提供的参数：私有版客户端对 undefined 参数的处理未经实测，不冒险
      const settings: { ids: string[]; filterIds?: string[]; scale?: number } = { ids: layerIds }
      if (Array.isArray(params?.filterIds)) {
        settings.filterIds = params.filterIds.filter((id: unknown) => typeof id === 'string' && id.trim() !== '')
      }
      if (typeof params?.scale === 'number' && Number.isFinite(params.scale)) {
        settings.scale = params.scale
      }
      raw = api.exportPng(settings)
    }
  } catch (error) {
    return {
      success: false,
      reason: 'export-failed',
      message: `批量导出失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const { encoding, data } = normalizeExportPayload(raw, format)
  if (!data) {
    return {
      success: false,
      reason: 'export-failed',
      message: '批量导出返回空内容：请确认图层仍在当前页面，或用 plugin_capabilities 复核导出 API',
    }
  }

  const maxBytes = typeof params?.maxBytes === 'number' && params.maxBytes > 0
    ? Math.floor(params.maxBytes)
    : DEFAULT_MAX_BYTES

  const warnings: string[] = []
  let payload = data
  let truncated = false
  if (payload.length > maxBytes) {
    payload = payload.slice(0, maxBytes)
    truncated = true
    warnings.push('导出内容超过上限，已截断；建议改用 savePath 落盘或缩小范围')
  }

  return {
    success: true,
    format,
    count: layerIds.length,
    layerIds,
    encoding,
    mimeType: format === 'svg' ? 'image/svg+xml' : 'image/png',
    data: payload,
    bytes: payload.length,
    truncated,
    warnings,
  }
}

/**
 * 插件方法注册表（由 lib/api/index.ts 的 handlers 合并接线）
 *
 * 服务端 `node_export_batch` 默认按下划线→斜杠映射为该 key。
 */
export const exportHandlers: Record<string, HandlerFunction> = {
  'node/exportBatch': handleExportBatch,
}
