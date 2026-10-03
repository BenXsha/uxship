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

/**
 * UTF-8 编码。
 *
 * ⚠️ 不用 `TextEncoder`：Penpot 插件 iframe 沙箱里**没有它**（真机报
 * "TextDecoder is not a constructor"；`TextEncoder` 同源风险）。自己编码虽然短一截，
 * 但它是这条链路能跑的前提。
 */
export function utf8Bytes(value: string): Uint8Array {
  const out: number[] = []
  for (const ch of value) {
    const cp = ch.codePointAt(0) as number
    if (cp < 0x80) out.push(cp)
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
  }
  return new Uint8Array(out)
}

/** 字节 → base64。注：`btoa` 在插件沙箱里**有**（`atob` 也用过），沙箱里缺的是 `TextEncoder`/`TextDecoder`。 */
export function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/**
 * data URI → base64 载荷（DSL `imageData` 字段的口径）。非 data URI 返回 undefined。
 *
 * ⚠️ 只有 `;base64` 的才是 base64。percent-encoded 的 data URI（SVG 常见）必须把
 * `decodeURIComponent` 的结果按 UTF-8 编码再 base64 —— 旧代码一律 `url.substring(comma+1)`，
 * 于是 DSL 里写进一段 `%3Csvg…`，下游 `decodeBase64` 直接失败（真机背景图踩到过）。
 */
export function dataUriToBase64Payload(url: string): string | undefined {
  if (!url.startsWith('data:')) return undefined
  const comma = url.indexOf(',')
  if (comma < 0) return undefined
  const meta = url.slice(0, comma)
  const payload = url.slice(comma + 1)
  return /;base64/i.test(meta) ? payload : base64FromBytes(utf8Bytes(decodeURIComponent(payload)))
}

/**
 * UTF-8 解码（与 `utf8Bytes` 互逆）。
 *
 * ⚠️ 同样不能依赖 `TextDecoder` —— SVG 导出（`shape.export` 返回 Uint8Array）走的就是它，
 * 真机报 `Internal error: TextDecoder is not a constructor`。非法序列退化成 U+FFFD，不抛错。
 */
export function utf8Decode(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b0 = bytes[i]
    let cp: number
    let extra: number
    if (b0 < 0x80) {
      cp = b0
      extra = 0
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = b0 & 0x1f
      extra = 1
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = b0 & 0x0f
      extra = 2
    } else if ((b0 & 0xf8) === 0xf0) {
      cp = b0 & 0x07
      extra = 3
    } else {
      cp = 0xfffd
      extra = 0
    }
    i += 1
    for (let k = 0; k < extra; k += 1) {
      if (i >= bytes.length || (bytes[i] & 0xc0) !== 0x80) {
        cp = 0xfffd
        break
      }
      cp = (cp << 6) | (bytes[i] & 0x3f)
      i += 1
    }
    out += String.fromCodePoint(cp)
  }
  return out
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = ''
  for (let i = start; i < start + length && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i])
  return out
}

/** 跳过前置空白后，字节是否以 `<svg` 或 `<?xml` 开头（逐字节 ASCII，不依赖 TextDecoder） */
function startsWithSvgMarkup(bytes: Uint8Array): boolean {
  const isSpace = (b: number) => b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d
  let i = 0
  while (i < bytes.length && i < 64 && isSpace(bytes[i])) i += 1

  const startsWith = (text: string): boolean => {
    if (i + text.length > bytes.length) return false
    for (let k = 0; k < text.length; k += 1) {
      const lower = text.charCodeAt(k)
      const upper = lower - 32
      if (bytes[i + k] !== lower && bytes[i + k] !== upper) return false
    }
    return true
  }

  return startsWith('<svg') || startsWith('<?xml')
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

  // SVG 是文本：允许前置空白与 XML 声明。逐字节判定，**不用 TextDecoder** ——
  // Penpot 插件沙箱里没有它（真机报 "TextDecoder is not a constructor"）。
  if (startsWithSvgMarkup(bytes)) return 'image/svg+xml'

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
