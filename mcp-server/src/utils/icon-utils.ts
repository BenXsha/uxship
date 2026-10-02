import https from 'https'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { URL } from 'url'

const ICONIFY_API = 'https://api.iconify.design'

/**
 * 本地集前缀 → Iconify 集合前缀（仅用于**运行时回退**）。
 *
 * `logo` 曾对应随包分发的 brand-logos 目录（已移除，见 ADR-0002）；
 * Iconify 上同一套集合（gilbarbara/logos，CC0）的前缀是 `logos`，
 * 这里做一次映射，让 `logo:github` 这种既有写法继续可用（改为运行时获取）。
 */
const ICONIFY_PREFIX_ALIAS: Record<string, string> = { logo: 'logos' }

/** 把本地集前缀映射为 Iconify 集合前缀 */
function iconifyPrefix(prefix: string): string {
  return ICONIFY_PREFIX_ALIAS[prefix] ?? prefix
}

// ============================================================
//  可扩展图标集合注册机制
//  添加新图标集：只需在 ICON_COLLECTIONS 数组中新增一条记录
// ============================================================

/**
 * 图标集合描述符
 * 每个集合对应 src/assets/ 下的一个子目录
 */
interface IconCollection {
  /** 查询时的前缀，如 "ri", "mdi", "fa" */
  prefix: string
  /** src/assets/ 下的子目录名 */
  dirName: string
  /** 人类可读的名称（日志用） */
  displayName: string
  /** 无明确前缀时是否作为默认回退集合（仅一个集合可设为 true） */
  defaultPrefix?: boolean
  /** 集合特有的名称别名（AI 常用缩写 → 官方文件名），仅在该集合内生效 */
  aliases?: Record<string, string>
  /**
   * 自定义文件名到图标名的提取逻辑
   * 默认: 去除 .svg 后缀
   * 例如 Material Design Icons 文件名 "ic_search_24px.svg" → 提取 "search"
   */
  nameExtractor?: (filename: string) => string
}

/**
 * 📌 图标集合注册表 —— 唯一扩展点
 *
 * 添加新图标集的步骤：
 * 1. 在 src/assets/ 下新建目录（如 "material-design-icons/"）
 * 2. 将 SVG 文件放入该目录
 * 3. 在这里添加一条 IconCollection 记录
 * 4. 确保 package.json build 脚本会复制该目录到 dist/
 */
const ICON_COLLECTIONS: IconCollection[] = [
  {
    prefix: 'ri',
    dirName: 'remixicon',
    displayName: 'Remix Icon',
    defaultPrefix: true,
    aliases: {
      'info': 'information',
      'loading': 'loader',
      'copy': 'file-copy',
      'warning': 'error-warning',
      'success': 'checkbox-circle',
      'profile': 'user',
      'account': 'user',
      'logout': 'logout-box',
      'login': 'login-box',
      'notification': 'notification',
      'dropdown': 'arrow-down-s',
      'collapse': 'arrow-up-s',
      'expand': 'arrow-down-s',
    },
  },
  // 第三方品牌 Logo **不再随包分发**（见 THIRD-PARTY-NOTICES.md / ADR-0002）：
  // 公司 Logo 是各自所有者的商标，随仓库分发会带来商标暴露面与 ~19MB 体积。
  // 需要时改走 Iconify 的 `logos` 集合在**运行时**获取 ——
  // `logo:<name>` 会自动映射为 `logos:<name>`（见 ICONIFY_PREFIX_ALIAS）。
  //
  // 示例：未来可添加更多图标集合
  // {
  //   prefix: 'mdi',
  //   dirName: 'material-design-icons',
  //   displayName: 'Material Design Icons',
  //   aliases: { 'magnify': 'search' },
  // },
]

// ============================================================
//  内部实现
// ============================================================

/** 模块根目录 assets/ 路径 */
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ASSETS_ROOT = path.resolve(__dirname, '..', 'assets')

/**
 * 两层索引结构: collectionPrefix → { iconName(小写) → filePath }
 * 模块加载时一次性构建，之后只读查询
 */
const collectionFileMap = new Map<string, Map<string, string>>()

/** 运行时内存缓存: "{prefix}:{name}" → SVG 字符串 */
const iconSvgCache = new Map<string, string>()

/** 默认前缀（无显式前缀时的回退集合） */
let defaultCollectionPrefix = 'ri'
let iconFileMapInitialized = false

/**
 * 确保图标文件索引已构建（惰性初始化）
 * 替代模块级副作用，仅在首次需要时加载
 */
function ensureIconFileMap(): void {
  if (iconFileMapInitialized) return
  iconFileMapInitialized = true

  for (const col of ICON_COLLECTIONS) {
    const colDir = path.join(ASSETS_ROOT, col.dirName)
    const fileMap = new Map<string, string>()

    try {
      const entries = fs.readdirSync(colDir, { withFileTypes: true })
      const nameExtractor = col.nameExtractor || ((f: string) => f.replace(/\.svg$/i, ''))

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // 子分类目录（如 remixicon/Business/, remixicon/Design/）
          const catDir = path.join(colDir, entry.name)
          let files: string[]
          try { files = fs.readdirSync(catDir) } catch { continue }
          for (const file of files) {
            if (!file.toLowerCase().endsWith('.svg')) continue
            const name = nameExtractor(file).toLowerCase()
            if (!fileMap.has(name)) {
              fileMap.set(name, path.join(catDir, file))
            }
          }
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.svg')) {
          // 扁平目录（SVG 直接放在集合目录下）
          const name = nameExtractor(entry.name).toLowerCase()
          if (!fileMap.has(name)) {
            fileMap.set(name, path.join(colDir, entry.name))
          }
        }
      }

      collectionFileMap.set(col.prefix, fileMap)
      if (col.defaultPrefix) {
        defaultCollectionPrefix = col.prefix
      }
      console.log(`[icon-utils] Loaded collection "${col.prefix}" (${col.displayName}): ${fileMap.size} icons`)
    } catch {
      console.warn(`[icon-utils] Collection directory not found: ${colDir} (prefix: "${col.prefix}")`)
    }
  }
}

/**
 * 在指定集合中解析别名
 */
function resolveAliasInCollection(collection: IconCollection, name: string): string {
  if (!collection.aliases) return name
  for (const [from, to] of Object.entries(collection.aliases)) {
    if (name.startsWith(from + '-') || name === from) {
      return name.replace(from, to)
    }
  }
  return name
}

/**
 * 从本地 SVG 文件按需加载图标（同步，带内存缓存）
 *
 * 支持的格式:
 *   "ri:search-line"     — 显式指定集合前缀
 *   "mdi:account"        — 其他集合前缀
 *   "search-line"        — 无前缀时先在默认集合查找，再尝试其他集合
 *
 * 查找顺序（无显式前缀时）:
 *   1. 默认集合（ri）直接匹配
 *   2. 默认集合别名匹配
 *   3. 其他集合逐个尝试（直接匹配 + 别名匹配）
 *
 * @returns 完整的 SVG 字符串，或 null（未找到）
 */
export function resolveIconSync(iconAttr: string): string | null {
  ensureIconFileMap()
  const { prefix, name } = parseIconName(iconAttr)

  const hasExplicitPrefix = iconAttr.includes(':')
  const lookupName = name.toLowerCase()

  // 辅助：在指定集合中查找并加载
  const tryLoadFrom = (colPrefix: string, nameToTry: string): string | null => {
    const cacheKey = `${colPrefix}:${nameToTry}`
    // 内存缓存
    const cached = iconSvgCache.get(cacheKey)
    if (cached !== undefined) return cached

    const fileMap = collectionFileMap.get(colPrefix)
    if (!fileMap) return null

    const tryName = nameToTry.toLowerCase()
    let filePath = fileMap.get(tryName)
    if (!filePath) {
      // 别名匹配
      const col = ICON_COLLECTIONS.find(c => c.prefix === colPrefix)
      if (col) {
        const aliased = resolveAliasInCollection(col, tryName)
        if (aliased !== tryName) {
          filePath = fileMap.get(aliased)
        }
      }
    }
    if (!filePath) return null

    try {
      const svg = fs.readFileSync(filePath, 'utf8')
      iconSvgCache.set(cacheKey, svg)
      return svg
    } catch {
      return null
    }
  }

  // 1. 有显式前缀：仅在该集合中查找
  if (hasExplicitPrefix) {
    return tryLoadFrom(prefix, lookupName)
  }

  // 2. 无显式前缀：先在默认集合中查找
  const fromDefault = tryLoadFrom(defaultCollectionPrefix, lookupName)
  if (fromDefault) return fromDefault

  // 3. 默认集合未命中，尝试其他集合
  for (const col of ICON_COLLECTIONS) {
    if (col.prefix === defaultCollectionPrefix) continue
    const result = tryLoadFrom(col.prefix, lookupName)
    if (result) return result
  }

  return null
}

/**
 * 自定义 SVG 字符串：替换 currentColor → 实际颜色，设置目标尺寸
 * 兼容本地 SVG（可能无 width/height 属性）和 Iconify SVG（width="1em" height="1em"）
 */
export function customizeIconSvg(svg: string, fill: string, size: number): string {
  let result = svg
  // 颜色：**fill 与 stroke 都要替换**（不要只认 `fill="currentColor"`）。
  //
  // 以前这里只替换 `fill="currentColor"` —— 描边型图标（Lucide / Remix 线条图标，颜色写在
  // `stroke="currentColor"` 上）的颜色参数被**静默忽略**，`currentColor` 最后按 CSS 继承解析，
  // 渲染出来是**宿主环境的文字色**：真机实测 Penpot 插件面板的 `#e5e7eb`（设计里根本没有这个色）。
  // 见 `skills/design/rules/06-images.md §5`。
  result = result.replace(/currentColor/gi, fill)

  // 处理 width/height
  if (result.includes('width=') && result.includes('height=')) {
    // Iconify 格式：width="1em" height="1em" → 替换为目标尺寸
    result = result.replace(/width="[^"]*"/, `width="${size}"`)
    result = result.replace(/height="[^"]*"/, `height="${size}"`)
  } else {
    // 本地 remixicon SVG 无 width/height → 注入到 <svg> 标签
    result = result.replace(/<svg([^>]*)>/, `<svg$1 width="${size}" height="${size}">`)
  }

  // 给所有没有 fill 的矢量元素注入显式 fill（Remix Icon 等图标将 fill 放在 <svg> 上，路径继承，
  // 但 createNodeFromSvgAsync 不会传递 SVG 级别的 fill 到子节点）
  if (fill) {
    result = result.replace(/<(path|circle|rect|ellipse|polygon|polyline|line)([^>]*?)(\/?>)/gi,
      (match, tag, attrs, closing) => {
        if (!/fill\s*=\s*["']/i.test(attrs)) {
          return `<${tag}${attrs} fill="${fill}"${closing}`
        }
        return match
      }
    )
  }

  return result
}

export interface SvgPathItem {
  d: string
  fill: string | null
  stroke: string | null
  strokeWidth: number | null
}

interface IconResult {
  svgPathData: string
  viewBox: { width: number; height: number }
  iconName: string
  paths: SvgPathItem[]
  /** 原始 SVG 字符串，供 SVG 导入模式使用 */
  rawSvg: string
}

interface SearchResult {
  icons: string[]
  total: number
  collections: Record<string, string>
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // `new URL()` 对非法输入会抛 TypeError，必须先接住，否则表现为 unhandled rejection
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      reject(new Error(`Invalid icon URL: ${url}`))
      return
    }
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'mcp-server/1.0',
        'Accept': 'application/json, image/svg+xml',
      },
      timeout: 10000,
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data)
        } else if (res.statusCode === 404) {
          reject(new Error(`Icon not found (HTTP ${res.statusCode})`))
        } else {
          reject(new Error(`Iconify API returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')) })
    req.end()
  })
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const regex = /(\w[\w-]*)\s*=\s*"([^"]*)"/g
  let match
  while ((match = regex.exec(attrString)) !== null) {
    attrs[match[1]] = match[2]
  }
  return attrs
}

function parseSVGPaths(svgContent: string): { paths: SvgPathItem[]; viewBox: { width: number; height: number } } {
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/)
  let viewBox = { width: 24, height: 24 }
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].split(/\s+/).map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      viewBox = { width: parts[2], height: parts[3] }
    }
  }

  const tagRegex = /<(\/?)(\w+)([^>]*)>/g
  let match
  const contextStack: Array<{ fill: string | null; stroke: string | null; strokeWidth: number | null }> = []
  let currentCtx = { fill: null as string | null, stroke: null as string | null, strokeWidth: null as number | null }
  const paths: SvgPathItem[] = []

  while ((match = tagRegex.exec(svgContent)) !== null) {
    const isClosing = match[1] === '/'
    const tagName = match[2]
    const attrString = match[3]

    if (tagName === 'g' && !isClosing) {
      contextStack.push({ ...currentCtx })
      const attrs = parseAttributes(attrString)
      if (attrs.fill !== undefined) currentCtx.fill = attrs.fill === 'none' ? null : attrs.fill
      if (attrs.stroke !== undefined) currentCtx.stroke = attrs.stroke === 'none' ? null : attrs.stroke
      if (attrs.strokeWidth !== undefined) currentCtx.strokeWidth = Number(attrs.strokeWidth)
    } else if (tagName === 'g' && isClosing) {
      currentCtx = contextStack.pop() || { fill: null, stroke: null, strokeWidth: null }
    } else if (tagName === 'path' && !isClosing) {
      const attrs = parseAttributes(attrString)
      if (attrs.d) {
        const fill = attrs.fill !== undefined ? (attrs.fill === 'none' || attrs.fill === 'transparent' ? null : attrs.fill) : currentCtx.fill
        const stroke = attrs.stroke !== undefined ? (attrs.stroke === 'none' ? null : attrs.stroke) : currentCtx.stroke
        const sw = attrs.strokeWidth !== undefined ? Number(attrs.strokeWidth) : currentCtx.strokeWidth

        paths.push({
          d: attrs.d,
          fill,
          stroke,
          strokeWidth: sw || null,
        })
      }
    }
  }

  if (paths.length === 0) {
    throw new Error('No path data found in SVG')
  }

  return { paths, viewBox }
}

function parseIconName(name: string): { prefix: string; name: string } {
  const trimmed = name.trim()
  const colonIdx = trimmed.indexOf(':')
  if (colonIdx > 0 && colonIdx < 10) {
    return {
      prefix: trimmed.slice(0, colonIdx),
      name: trimmed.slice(colonIdx + 1),
    }
  }
  let normalized = trimmed
  if (normalized.startsWith('ri-') || normalized.startsWith('ri/')) {
    normalized = normalized.replace(/^(ri[-/])/, '')
  }
  if (normalized.startsWith('remix-') || normalized.startsWith('remix/')) {
    normalized = normalized.replace(/^(remix[-/])/, '')
  }
  return { prefix: 'ri', name: normalized }
}

export async function fetchIcon(iconName: string, height: number = 24): Promise<IconResult> {
  const { prefix, name } = parseIconName(iconName)
  const url = `${ICONIFY_API}/${iconifyPrefix(prefix)}/${name}.svg?height=${height}`
  const svgContent = await httpsGet(url)
  const { paths, viewBox } = parseSVGPaths(svgContent)

  return {
    svgPathData: paths.map(p => p.d).join(' '),
    viewBox,
    iconName: `${prefix}:${name}`,
    paths,
    rawSvg: svgContent,
  }
}

export async function searchIcons(query: string, limit: number = 20, prefix?: string): Promise<SearchResult> {
  const prefixParam = prefix ? `&prefix=${prefix}` : ''
  const url = `${ICONIFY_API}/search?query=${encodeURIComponent(query)}&limit=${Math.min(limit, 100)}${prefixParam}`
  const data = await httpsGet(url)
  try {
    return JSON.parse(data) as SearchResult
  } catch {
    return { icons: [], total: 0, collections: {} } as SearchResult
  }
}

export async function fetchIconSVG(iconName: string): Promise<string> {
  const { prefix, name } = parseIconName(iconName)
  const url = `${ICONIFY_API}/${iconifyPrefix(prefix)}/${name}.svg`
  return await httpsGet(url)
}

/**
 * 将 Iconify 图标转为 DSL (SVG 导入模式)
 *
 * 使用 type:'svg' + svgContent 而非旧的 type:'pen' + svgPathData，
 * 插件端通过 mg.createNodeFromSvgAsync() 直接导入完整 SVG，
 * 避免 pen.penPaths 路径变形，原生支持多色图标。
 */
export function buildIconDSL(icon: IconResult, options: {
  x?: number
  y?: number
  size?: number
  color?: string
  strokeWidth?: number
  bgColor?: string
  cornerRadius?: number
}): object {
  const fallbackColor = options.color || '#333333'
  const x = options.x ?? 0
  const y = options.y ?? 0
  const targetSize = options.size || 24

  // 用 customizeIconSvg 定制颜色与尺寸
  // - 单色图标: currentColor → 目标颜色
  // - 多色图标(如国旗): 保留原始颜色，仅设置尺寸
  const svgContent = customizeIconSvg(icon.rawSvg, fallbackColor, targetSize)

  // 有背景色时才需要包裹 Frame
  if (options.bgColor) {
    return {
      type: 'frame',
      name: `Icon_${icon.iconName}`,
      size: { width: targetSize, height: targetSize },
      position: { x, y },
      fills: [{ type: 'solid', color: options.bgColor }],
      cornerRadius: options.cornerRadius ?? 0,
      clipsContent: true,
      children: [{
        type: 'svg',
        name: `Icon_${icon.iconName}`,
        svgContent,
        size: { width: targetSize, height: targetSize },
      }],
    }
  }

  // 无背景色：直接返回 svg 元素，避免多余嵌套
  return {
    type: 'svg',
    name: `Icon_${icon.iconName}`,
    svgContent,
    size: { width: targetSize, height: targetSize },
    position: { x, y },
  }
}
