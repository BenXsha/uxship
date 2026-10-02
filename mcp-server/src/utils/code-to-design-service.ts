/**
 * code_to_design 共享服务层
 *
 * 抽取 index.ts 和 ws-bridge.ts 中重复的：
 * - 文件/HTML 内容读取
 * - 图片资源预取
 * - HTML 预处理调度
 */
import * as dns from 'dns'
import { existsSync, readFileSync } from 'fs'
import { resolve, normalize, sep } from 'path'

const MAX_HTML_BYTES = 1 * 1024 * 1024 // 1MB
const ALLOWED_BASE_DIRS = [resolve(process.cwd())]

/**
 * 路径是否可读。
 *
 * 同 `image-export.isSafeSavePath`：必须用「目录 + 路径分隔符」边界判断，
 * 否则同前缀兄弟目录会被绕过。导出给单测（`tests/path-guard.test.ts`）。
 */
export function isSafePath(filePath: string): boolean {
  const resolved = resolve(normalize(filePath))
  return ALLOWED_BASE_DIRS.some((dir) => resolved === dir || resolved.startsWith(dir + sep))
}

export interface HtmlSource {
  html: string
  sourceType: 'file' | 'inline'
  filePath?: string
}

/**
 * 从工具参数中读取 HTML 内容
 * 支持 filePath（文件路径）或 html（内联字符串）两种来源
 */
export async function readHtmlContent(args: Record<string, any> | undefined): Promise<HtmlSource> {
  const filePath = args?.filePath as string | undefined
  const htmlString = args?.html as string | undefined

  if (filePath && typeof filePath === 'string') {
    if (!isSafePath(filePath)) {
      throw new Error(`Access denied: filePath must be within the project directory`)
    }
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }
    return { html: readFileSync(filePath, 'utf-8'), sourceType: 'file', filePath }
  }

  if (htmlString && typeof htmlString === 'string') {
    if (htmlString.length > MAX_HTML_BYTES) {
      throw new Error(`HTML input exceeds maximum size of ${MAX_HTML_BYTES / 1024 / 1024}MB`)
    }
    return { html: htmlString, sourceType: 'inline' }
  }

  throw new Error('Either filePath or html parameter is required')
}

/**
 * 从完整 HTML 文档中提取 <body> 内容
 */
export function extractBodyContent(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
  return bodyMatch ? bodyMatch[1].trim() : html
}

/**
 * 渲染模式解析
 */
export function resolveRenderMode(_args: Record<string, any> | undefined): 'client' {
  return 'client'
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB
const PRIVATE_IP_RANGES = [
  { prefix: '10.', mask: null },
  { prefix: '172.16.', mask: (ip: string) => {
    const parts = ip.split('.')
    if (parts.length < 2) return false
    const second = parseInt(parts[1], 10)
    return second >= 16 && second <= 31
  }},
  { prefix: '192.168.', mask: null },
  { prefix: '127.', mask: null },
  { prefix: '169.254.', mask: null },
  { prefix: '0.', mask: null },
]

async function isPrivateHost(url: URL): Promise<boolean> {
  try {
    const addresses = await dns.promises.resolve4(url.hostname)
    for (const addr of addresses) {
      for (const range of PRIVATE_IP_RANGES) {
        if (addr.startsWith(range.prefix)) {
          if (!range.mask) return true
          if (range.mask(addr)) return true
        }
      }
    }
  } catch {
    // DNS resolution failure — treat as suspicious, reject
    return true
  }
  return false
}

async function fetchWithLimit(urlStr: string): Promise<ArrayBuffer> {
  if (!urlStr.startsWith('https://')) {
    throw new Error('Only HTTPS image URLs are allowed')
  }

  const parsed = new URL(urlStr)
  if (await isPrivateHost(parsed)) {
    throw new Error(`Blocked image URL pointing to private/reserved IP: ${urlStr}`)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const res = await fetch(urlStr, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response body')

    const chunks: Uint8Array[] = []
    let total = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_IMAGE_SIZE) {
        reader.cancel()
        throw new Error(`Image too large (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)`)
      }
      chunks.push(value)
    }

    const combined = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.byteLength
    }
    return combined.buffer as ArrayBuffer
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 扫描 DSL 元素，预取 HTTPS 图片并转 base64 作为 imageData
 * 安全限制：仅 HTTPS、拒绝私有 IP、最大 10MB、15s 超时
 */
export async function enrichDslWithImageData(dsl: any): Promise<void> {
  const tasks: Promise<void>[] = []

  const collect = (elements: any[]) => {
    for (const el of elements) {
      for (const fill of [...(el.fills || []), ...(el.strokes || [])]) {
        if ((fill.type || '').toUpperCase() === 'IMAGE' && fill.imageUrl &&
            fill.imageUrl.startsWith('https://')) {
          tasks.push(
            fetchWithLimit(fill.imageUrl)
              .then(buf => {
                fill.imageData = Buffer.from(buf).toString('base64')
                console.log(`[code_to_design] 图片预取成功: ${fill.imageUrl} (${buf.byteLength} bytes)`)
              })
              .catch(err => {
                console.warn(`[code_to_design] 图片预取失败: ${fill.imageUrl}: ${err.message}`)
              })
          )
        }
      }
      if (el.children) {
        collect(el.children)
      }
    }
  }

  if (dsl.elements) {
    collect(dsl.elements)
  }
  await Promise.all(tasks)
}
