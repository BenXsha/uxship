/**
 * Penpot 媒体（图片）规则：允许的 MIME、体积上限、裸 base64 的格式嗅探。
 *
 * 为什么单独一处：这些是**宿主的硬限制**（出自 Penpot 2.18.1 后端
 * `app/media/validation.clj` 的 `image-types` 与 `media-max-file-size`）。
 * 上传前先判能给出可读原因（"avif 不在 Penpot 允许的 5 种里"），
 * 而不是把宿主的 `media-type-not-allowed` 原样穿透给调用方。
 *
 * 这条链路实测过：`uploadMediaUrl`（后端代拉）与 `uploadMediaData`（收二进制）
 * 都过同一套校验，所以两处共用本模块的常量。
 */

/** Penpot 2.18.1 `app.common.media/image-types` —— **只有这 5 种**，avif/bmp/tiff 一律拒收 */
export const PENPOT_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
])

/** `media-max-file-size` 默认值（可被 `PENPOT_MEDIA_MAX_FILE_SIZE` 覆盖；这里按默认值预检） */
export const PENPOT_MEDIA_MAX_BYTES = 30 * 1024 * 1024

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
}

/** 内联图片（裸 base64 / data URI）上传用的文件名 —— 前缀 `inline.` 便于在宿主媒体库里辨认来源 */
export function inlineMediaName(mimeType: string): string {
  return `inline.${EXT_BY_MIME[mimeType] ?? 'bin'}`
}

/** `data:image/png;base64,…` → `image/png`（认不出返回 undefined） */
export function mimeTypeFromDataUri(value: string): string | undefined {
  const match = /^data:([^;,]+)[;,]/.exec(value)
  return match?.[1]?.trim().toLowerCase() || undefined
}

/** 从 URL 扩展名猜 MIME（猜不出返回 undefined）——裸 base64 之外的最后一道线索 */
export function mimeTypeFromUrl(url?: string): string | undefined {
  if (!url) return undefined
  const clean = url.split('?')[0].split('#')[0]
  const dot = clean.lastIndexOf('.')
  if (dot < 0 || dot === clean.length - 1) return undefined
  return MIME_BY_EXT[clean.slice(dot + 1).toLowerCase()]
}

/**
 * base64 → 字节。
 *
 * 客户端渲染引擎产出的是**裸 base64**（不是 data URI），所以解码前别假设有前缀。
 * 空白（换行）先剔除：有些渲染路径会折行。
 */
export function decodeBase64(payload: string): Uint8Array {
  let binary: string
  try {
    binary = atob(payload.replace(/\s+/g, ''))
  } catch {
    throw new Error('base64 解码失败（图片数据不是合法 base64）')
  }
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = ''
  for (let i = start; i < start + length && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i])
  return out
}

/**
 * 从 magic bytes 嗅探图片 MIME（认不出返回 undefined）。
 *
 * 用途：裸 base64 没有 MIME 标签，而 Penpot 的 `uploadMediaData` **必须**收到正确的
 * `mimeType`（它据此走 ImageMagick）。客户端渲染出来的固定是 PNG，但服务端预取
 * （`enrichDslWithImageData`）写进去的是任意格式，所以这里按内容判定而不是猜。
 */
export function sniffImageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG' && bytes[4] === 0x0d) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && ascii(bytes, 0, 4) === 'GIF8') return 'image/gif'
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'

  // SVG 是文本：允许前置空白与 XML 声明
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase()
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml'

  return undefined
}

/**
 * 判定一张图能不能交给 Penpot（MIME + 体积），返回可读原因或 null。
 * 只在**已经拿到 MIME 之后**调用；嗅探失败不算通过。
 */
export function penpotMediaRejection(mimeType: string | undefined, byteLength: number): string | null {
  if (!mimeType || !PENPOT_IMAGE_MIME_TYPES.has(mimeType)) {
    return `图片格式不在 Penpot 允许的 5 种之内（jpeg/png/webp/gif/svg+xml）: ${mimeType ?? '无法识别'}`
  }
  if (byteLength > PENPOT_MEDIA_MAX_BYTES) {
    const mb = (byteLength / 1024 / 1024).toFixed(1)
    return `图片超过 Penpot 媒体上限（${mb}MB > 30MB，后端 media-max-file-size）`
  }
  return null
}
