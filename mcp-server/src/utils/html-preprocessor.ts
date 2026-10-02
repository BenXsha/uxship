import { resolveIconSync, customizeIconSvg, fetchIconSVG } from './icon-utils.js'
import { renderChartToSVG } from './chart-to-svg.js'
import * as dns from 'dns'

const PRIVATE_IP_PREFIXES = ['10.', '172.16.', '192.168.', '127.', '169.254.', '0.']

async function isPrivateHost(url: URL): Promise<boolean> {
  try {
    const addresses = await dns.promises.resolve4(url.hostname)
    for (const addr of addresses) {
      for (const prefix of PRIVATE_IP_PREFIXES) {
        if (addr.startsWith(prefix)) return true
        if (prefix === '172.16.' && addr.startsWith('172.')) {
          const second = parseInt(addr.split('.')[1], 10)
          if (second >= 16 && second <= 31) return true
        }
      }
    }
  } catch {
    return true
  }
  return false
}

async function safeFetchImage(urlStr: string): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  if (!urlStr.startsWith('https://')) {
    throw new Error(`Only HTTPS image URLs are allowed: ${urlStr.substring(0, 80)}`)
  }
  const parsed = new URL(urlStr)
  if (await isPrivateHost(parsed)) {
    throw new Error(`Blocked image URL pointing to private/reserved IP: ${urlStr.substring(0, 80)}`)
  }
  const resp = await fetch(urlStr)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const contentType = resp.headers.get('content-type') || 'image/png'
  const buffer = await resp.arrayBuffer()
  return { buffer, contentType }
}

export interface PreprocessorResult {
  html: string
  warnings: string[]
  stats: {
    iconsProcessed: number
    chartsProcessed: number
    componentsProcessed: number
    imagesProcessed: number
  }
}

export interface PreprocessorOptions {
  fallbackToApi?: boolean
  preserveOriginalAttributes?: boolean
}

const DEFAULT_THEME = {
  brand: '#4340EA',
  brandLight: '#F4F3FF',
  border: '#D0D5DD',
  borderHover: '#4340EA',
  borderDisabled: '#E0E0E0',
  bgWhite: '#FFFFFF',
  bgDisabled: '#F5F5F5',
  bgDisabledChecked: '#E0E0E0',
  textPrimary: '#333333',
  textDisabled: '#999999',
  textTitle: '#1A1A2E',
  checkMark: '#FFFFFF',
  checkMarkDisabled: '#999999',
  containerWidth: 400,
  containerCornerRadius: 16,
  shadowColor: '#0000001A',
  shadowOffset: { x: 0, y: 4 },
  shadowRadius: 12,
  titleFont: { family: 'Inter', style: 'Bold' },
  titleSize: 18,
  labelFont: { family: 'Inter', style: 'Regular' },
  labelSize: 14,
  componentSize: 16,
  componentCornerRadius: 4,
  radioCornerRadius: 8,
  strokeWeight: 1.5,
  rowGap: 20,
  colLabelX: 50,
  containerPadding: 24,
  penPath: 'M12 0L13.4142 1.41421L5.20711 9.62132L0 4.41421L1.41421 3L5.20711 6.79289L12 0Z',
  ellipseSize: 6,
  ellipsePos: { x: 5, y: 5 },
  tabActiveBg: '#4340EA',
  tabInactiveBg: '#F5F5F5',
  tabActiveText: '#FFFFFF',
  tabInactiveText: '#666666',
  tabHeight: 40,
  tabGap: 0,
  tabIndicatorHeight: 3,
  listItemHeight: 48,
  listItemGap: 1,
  listItemPaddingX: 16,
  listIconSize: 20,
  menuItemHeight: 36,
  menuItemPaddingX: 12,
  menuDividerColor: '#E8E8E8',
  menuDividerMargin: 8,
  menuCornerRadius: 8,
  menuShadow: true,
  progressHeight: 8,
  progressTrackColor: '#E8E8E8',
  progressFillColor: '#4340EA',
  progressCornerRadius: 4,
  sliderTrackHeight: 4,
  sliderTrackColor: '#E0E0E0',
  sliderFillColor: '#4340EA',
  sliderHandleSize: 16,
  sliderHandleColor: '#FFFFFF',
  sliderHandleBorder: '#4340EA',
  breadcrumbSeparator: '/',
  breadcrumbSeparatorColor: '#999999',
  breadcrumbFontSize: 13,
  tooltipBg: '#333333',
  tooltipTextColor: '#FFFFFF',
  tooltipFontSize: 12,
  tooltipPadding: 8,
  tooltipCornerRadius: 4,
  dividerColor: '#E0E0E0',
  dividerThickness: 1,
  dividerLabelBg: '#FFFFFF',
  dividerLabelColor: '#999999',
  tagDefaultBg: '#F5F5F5',
  tagDefaultText: '#333333',
  tagPrimaryBg: '#F4F3FF',
  tagPrimaryText: '#4340EA',
  tagSuccessBg: '#E6F7E6',
  tagSuccessText: '#1A7D1A',
  tagWarningBg: '#FFF3E0',
  tagWarningText: '#92400E',
  tagDangerBg: '#FFEBEE',
  tagDangerText: '#C62828',
  tagHeight: 26,
  tagPaddingX: 10,
  tagFontSize: 12,
  tagCornerRadius: 4,
  tagClosableSize: 14,
  spinnerSize: 32,
  spinnerStrokeWidth: 3,
  spinnerColor: '#4340EA',
  spinnerTrackColor: '#E8E8E8',
  modalOverlay: '#00000080',
  modalWidth: 400,
  modalCornerRadius: 16,
  modalPadding: 24,
  modalFooterBorder: '#E8E8E8',
  alertWidth: 380,
  alertCornerRadius: 8,
  alertIconSize: 20,
  alertSuccessBg: '#E6F7E6',
  alertSuccessBorder: '#B7EBB7',
  alertSuccessIcon: '#1A7D1A',
  alertWarningBg: '#FFF8E1',
  alertWarningBorder: '#FFE082',
  alertWarningIcon: '#92400E',
  alertErrorBg: '#FFEBEE',
  alertErrorBorder: '#FFCDD2',
  alertErrorIcon: '#C62828',
  alertInfoBg: '#E3F2FD',
  alertInfoBorder: '#BBDEFB',
  alertInfoIcon: '#1565C0',
  paginationBtnSize: 36,
  paginationActiveBg: '#4340EA',
  paginationActiveText: '#FFFFFF',
  paginationBtnBg: '#F5F5F5',
  paginationBtnText: '#333333',
  paginationBtnCornerRadius: 6,
  paginationBtnGap: 4,
  stepSize: 32,
  stepConnectorColor: '#E0E0E0',
  stepActiveColor: '#4340EA',
  stepCompletedColor: '#4340EA',
  stepInactiveColor: '#D0D5DD',
  stepInactiveText: '#999999',
  stepFontSize: 13,
  accordionHeaderHeight: 48,
  accordionContentPadding: 16,
  accordionBorderColor: '#E8E8E8',
  accordionCornerRadius: 8,
  accordionGap: 0,
}

type Theme = typeof DEFAULT_THEME

const DARK_THEME: Partial<Theme> = {
  bgWhite: '#1A1B2E',
  bgDisabled: '#2A2B3E',
  bgDisabledChecked: '#3F3F50',
  textPrimary: '#E4E4E7',
  textDisabled: '#71717A',
  textTitle: '#FFFFFF',
  border: '#3F3F50',
  borderDisabled: '#2A2B3E',
  shadowColor: '#00000040',
  tabActiveBg: '#4340EA',
  tabInactiveBg: '#2A2B3E',
  tabActiveText: '#FFFFFF',
  tabInactiveText: '#9CA3AF',
  menuDividerColor: '#3F3F50',
  menuShadow: true,
  progressTrackColor: '#3F3F50',
  sliderTrackColor: '#3F3F50',
  sliderHandleColor: '#E4E4E7',
  breadcrumbSeparatorColor: '#71717A',
  tooltipBg: '#E4E4E7',
  tooltipTextColor: '#1A1B2E',
  dividerColor: '#3F3F50',
  dividerLabelBg: '#1A1B2E',
  dividerLabelColor: '#9CA3AF',
  tagDefaultBg: '#2A2B3E',
  tagDefaultText: '#E4E4E7',
  tagPrimaryBg: 'rgba(67,64,234,0.2)',
  tagPrimaryText: '#8B89F5',
  tagSuccessBg: 'rgba(34,197,94,0.15)',
  tagSuccessText: '#4ADE80',
  tagWarningBg: 'rgba(245,158,11,0.15)',
  tagWarningText: '#FBBF24',
  tagDangerBg: 'rgba(239,68,68,0.15)',
  tagDangerText: '#F87171',
  spinnerTrackColor: '#3F3F50',
  modalOverlay: '#000000CC',
  modalFooterBorder: '#3F3F50',
  alertSuccessBg: 'rgba(34,197,94,0.1)',
  alertSuccessBorder: 'rgba(34,197,94,0.3)',
  alertWarningBg: 'rgba(245,158,11,0.1)',
  alertWarningBorder: 'rgba(245,158,11,0.3)',
  alertErrorBg: 'rgba(239,68,68,0.1)',
  alertErrorBorder: 'rgba(239,68,68,0.3)',
  alertInfoBg: 'rgba(59,130,246,0.1)',
  alertInfoBorder: 'rgba(59,130,246,0.3)',
  paginationBtnBg: '#2A2B3E',
  paginationBtnText: '#E4E4E7',
  stepConnectorColor: '#3F3F50',
  stepInactiveColor: '#3F3F50',
  stepInactiveText: '#71717A',
  accordionBorderColor: '#3F3F50',
  accordionHeaderHeight: 48,
}

function mergeTheme(userTheme: any): Theme {
  if (!userTheme) return { ...DEFAULT_THEME }
  const t: any = { ...DEFAULT_THEME }
  for (const k of Object.keys(t)) {
    if (userTheme[k] !== undefined) t[k] = userTheme[k]
  }
  if (userTheme.mode === 'dark') {
    for (const k of Object.keys(DARK_THEME)) {
      if (userTheme[k] === undefined) t[k] = (DARK_THEME as any)[k]
    }
  }
  return t
}

const CHECKBOX_RADIO_STATES: any[] = [
  { key: 'Unchecked', label: 'Unchecked', bg: '#FFFFFF', stroke: '#D0D5DD', checked: false, disabled: false, textColor: '#333333' },
  { key: 'Checked', label: 'Checked', bg: '#4340EA', stroke: '#4340EA', checked: true, disabled: false, textColor: '#333333' },
  { key: 'Hover', label: 'Hover', bg: '#F4F3FF', stroke: '#4340EA', checked: false, disabled: false, textColor: '#333333' },
  { key: 'DisabledUnchecked', label: 'Disabled Unchecked', bg: '#F5F5F5', stroke: '#E0E0E0', checked: false, disabled: true, textColor: '#999999' },
  { key: 'DisabledChecked', label: 'Disabled Checked', bg: '#E0E0E0', stroke: '#E0E0E0', checked: true, disabled: true, textColor: '#999999' },
]

export async function preprocessHtml(
  html: string,
  options: PreprocessorOptions = {}
): Promise<PreprocessorResult> {
  const warnings: string[] = []
  let processedHtml = html
  let iconsProcessed = 0
  let chartsProcessed = 0
  let componentsProcessed = 0
  let imagesProcessed = 0

  processedHtml = await processIcons(processedHtml, options, warnings)
  iconsProcessed = countReplacements(html, processedHtml)

  const beforeCharts = countCharts(processedHtml)
  processedHtml = await processCharts(processedHtml, options, warnings)
  chartsProcessed = beforeCharts - countCharts(processedHtml)

  const beforeComponents = countComponents(processedHtml)
  processedHtml = await processComponents(processedHtml, options, warnings)
  componentsProcessed = beforeComponents - countComponents(processedHtml)

  // 图片内联必须在最后，因为前面步骤可能修改 HTML（如图标分割、组件展开）
  // 确保处理的是最终 HTML 版本中的图片 URL
  const imageResult = await processImages(processedHtml, options, warnings)
  processedHtml = imageResult.html
  imagesProcessed = imageResult.count

  return {
    html: processedHtml,
    warnings,
    stats: {
      iconsProcessed,
      chartsProcessed,
      componentsProcessed,
      imagesProcessed,
    },
  }
}

/**
 * 下载所有 <img src="http..."> 和 background-image: url(http...) 并内联为 data:base64
 * 服务端 fetch 不受 CORS 限制
 */
async function processImages(
  html: string,
  options: PreprocessorOptions,
  warnings: string[]
): Promise<{ html: string; count: number }> {
  let result = html
  let count = 0

  // 1. 处理 <img src="http...">
  const imgRegex = /<img([^>]*)src\s*=\s*['"](https?:\/\/[^'"]+)['"]([^>]*)>/gi
  let match
  const pending: Array<{ full: string; prefix: string; url: string; suffix: string }> = []

  while ((match = imgRegex.exec(html)) !== null) {
    pending.push({
      full: match[0],
      prefix: match[1],
      url: match[2],
      suffix: match[3],
    })
  }

  if (pending.length > 0) {
    const results = await Promise.allSettled(
      pending.map(async (p) => {
        const { buffer, contentType } = await safeFetchImage(p.url)
        const base64 = Buffer.from(buffer).toString('base64')
        const dataUrl = `data:${contentType};base64,${base64}`
        return { original: p.full, replacement: `<img${p.prefix}src="${dataUrl}"${p.suffix}>` }
      })
    )

    for (const r of results) {
      if (r.status === 'fulfilled') {
        const replaced = result.replace(r.value.original, r.value.replacement)
        if (replaced === result) {
          console.warn(`[processImages] 替换失败（字符串未匹配）: ${r.value.original.substring(0, 80)}`)
        } else {
          result = replaced
          count++
        }
      } else {
        warnings.push(`图片下载失败: ${r.reason?.message || 'unknown error'}`)
        console.warn(`[processImages] 图片下载失败: ${r.reason?.message || 'unknown error'}`)
      }
    }
  }

  // 2. 处理 background-image: url(http...) 内联样式
  // 匹配 style="...background-image:\s*url(https?://...)..."
  const bgImgRegex = /(url\s*\(\s*['"]?)(https?:\/\/[^'")\s]+)(['"]?\s*\))/gi
  const bgPending: Array<{ full: string; url: string }> = []
  let bgMatch

  while ((bgMatch = bgImgRegex.exec(result)) !== null) {
    bgPending.push({ full: bgMatch[0], url: bgMatch[2] })
  }

  if (bgPending.length > 0) {
    const bgResults = await Promise.allSettled(
      bgPending.map(async (p) => {
        const { buffer, contentType } = await safeFetchImage(p.url)
        const base64 = Buffer.from(buffer).toString('base64')
        const dataUrl = `data:${contentType};base64,${base64}`
        return { original: p.full, replacement: `url('${dataUrl}')` }
      })
    )

    for (const r of bgResults) {
      if (r.status === 'fulfilled') {
        result = result.replace(r.value.original, r.value.replacement)
        count++
      } else {
        warnings.push(`背景图片下载失败: ${r.reason?.message || 'unknown error'}`)
      }
    }
  }

  return { html: result, count }
}

/**
 * 把 `<i>` 上的属性搬到生成的 `<svg>` 上（`data-icon` 本身除外）。
 *
 * 为何必须搬：这段重写是**整段字符串替换**（`<i …>…</i>` → `<svg>…</svg>`），
 * 以前只搬了 `data-name`，而且**只在本地图标分支里搬** —— 于是
 * `class`（颜色 / 尺寸 / 背景 / 圆角）、`data-token-*`（令牌绑定）、`style`、`aria-*` 全部被吞掉。
 * 真机可见的后果之一：`<i data-icon="lucide:x" class="text-[#DC2626]">` 的图标颜色参数被静默忽略，
 * `currentColor` 按继承解析成了**插件面板自己的文字色**（实测 `#e5e7eb`，设计里根本没有这个色）。
 * 见 `skills/design/rules/06-images.md §5`。
 *
 * 导出是为了能直接单测（网络图标分支无法在 CI 里稳定复现）。
 */
export function copyIconAttributes(beforeAttrs: string, afterAttrs: string): string {
  const out: string[] = []
  const seen = new Set<string>()
  const attrRe = /([a-zA-Z_:][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g
  for (const source of [beforeAttrs, afterAttrs]) {
    for (const match of source.matchAll(attrRe)) {
      const name = match[1].toLowerCase()
      if (name === 'data-icon' || seen.has(name)) continue
      seen.add(name)
      const value = (match[3] ?? match[4] ?? '').replace(/"/g, '&quot;')
      out.push(`${name}="${value}"`)
    }
  }
  return out.join(' ')
}

async function processIcons(
  html: string,
  options: PreprocessorOptions,
  warnings: string[]
): Promise<string> {
  const dataIconRegex = /<i([^>]*)data-icon\s*=\s*['"]([^'"]+)['"]([^>]*?)>([\s\S]*?)<\/i>/gi
  let result = html
  let match

  while ((match = dataIconRegex.exec(html)) !== null) {
    const fullMatch = match[0]
    const beforeAttrs = match[1]
    const iconName = match[2]
    const afterAttrs = match[3]

    const localSvg = resolveIconSync(iconName)
    if (localSvg) {
      let color = '#333333'
      const colorMatch = afterAttrs.match(/class\s*=\s*['"]([^'"]*)['"]/i)
      if (!colorMatch) {
        const colorMatch2 = beforeAttrs.match(/class\s*=\s*['"]([^'"]*)['"]/i)
        if (colorMatch2) {
          const rgbMatch = colorMatch2[1].match(/text-\[rgb\((\d+),\s*(\d+),\s*(\d+)\)\]/i)
          if (rgbMatch) {
            const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0')
            const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0')
            const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0')
            color = `#${r}${g}${b}`
          } else {
            const hexMatch = colorMatch2[1].match(/text-\[#([a-f0-9]{6}|[a-f0-9]{3})\]/i)
            if (hexMatch) {
              color = `#${hexMatch[1]}`
            }
          }
        }
      } else {
        const rgbMatch = colorMatch[1].match(/text-\[rgb\((\d+),\s*(\d+),\s*(\d+)\)\]/i)
        if (rgbMatch) {
          const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0')
          const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0')
          const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0')
          color = `#${r}${g}${b}`
        } else {
          const hexMatch = colorMatch[1].match(/text-\[#([a-f0-9]{6}|[a-f0-9]{3})\]/i)
          if (hexMatch) {
            color = `#${hexMatch[1]}`
          }
        }
      }

      let size = 24
      const sizeMatch = afterAttrs.match(/w-\[(\d+)px\]/)
      if (!sizeMatch) {
        const sizeMatch2 = beforeAttrs.match(/w-\[(\d+)px\]/)
        if (sizeMatch2) {
          size = parseInt(sizeMatch2[1])
        } else {
          // 退而求其次：从 text-[Xpx] 提取尺寸
          const textSizeMatch = afterAttrs.match(/text-\[(\d+)px\]/i) ||
                                beforeAttrs.match(/text-\[(\d+)px\]/i)
          if (textSizeMatch) {
            size = parseInt(textSizeMatch[1])
          }
        }
      } else {
        size = parseInt(sizeMatch[1])
      }

      let customizedSvg = customizeIconSvg(localSvg, color, size)

      // 把 `<i>` 的属性（data-name / class / data-token-* / style …）搬到生成的 `<svg>` 上。
      // 以前这里只搬 data-name，且**只在本地图标分支里搬** —— class 被吞 → 图标颜色/尺寸/背景类全失效。
      const extraAttrs = copyIconAttributes(beforeAttrs, afterAttrs)
      if (extraAttrs) {
        customizedSvg = customizedSvg.replace(/^<svg/i, `<svg ${extraAttrs}`)
      }

      result = result.replace(fullMatch, customizedSvg)
    } else if (options.fallbackToApi !== false) {
      try {
        const svgStr = await fetchIconSVG(iconName)
        let color = '#333333'
        const colorMatch = afterAttrs.match(/class\s*=\s*['"]([^'"]*)['"]/i)
        if (!colorMatch) {
          const colorMatch2 = beforeAttrs.match(/class\s*=\s*['"]([^'"]*)['"]/i)
          if (colorMatch2) {
            const rgbMatch = colorMatch2[1].match(/text-\[rgb\((\d+),\s*(\d+),\s*(\d+)\)\]/i)
            if (rgbMatch) {
              const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0')
              const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0')
              const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0')
              color = `#${r}${g}${b}`
            } else {
              const hexMatch = colorMatch2[1].match(/text-\[#([a-f0-9]{6}|[a-f0-9]{3})\]/i)
              if (hexMatch) color = `#${hexMatch[1]}`
            }
          }
        } else {
          const rgbMatch = colorMatch[1].match(/text-\[rgb\((\d+),\s*(\d+),\s*(\d+)\)\]/i)
          if (rgbMatch) {
            const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0')
            const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0')
            const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0')
            color = `#${r}${g}${b}`
          } else {
            const hexMatch = colorMatch[1].match(/text-\[#([a-f0-9]{6}|[a-f0-9]{3})\]/i)
            if (hexMatch) color = `#${hexMatch[1]}`
          }
        }
        let size = 24
        const sizeMatch = afterAttrs.match(/w-\[(\d+)px\]/)
        if (!sizeMatch) {
          const sizeMatch2 = beforeAttrs.match(/w-\[(\d+)px\]/)
          if (sizeMatch2) size = parseInt(sizeMatch2[1])
        } else {
          size = parseInt(sizeMatch[1])
        }
        let customizedSvg = customizeIconSvg(svgStr, color, size)
        // 属性同样要搬（**以前这条分支连 data-name 都不搬**，网络图标因此连名字都没了）
        const extraAttrs = copyIconAttributes(beforeAttrs, afterAttrs)
        if (extraAttrs) {
          customizedSvg = customizedSvg.replace(/^<svg/i, `<svg ${extraAttrs}`)
        }
        result = result.replace(fullMatch, customizedSvg)

      } catch (e: any) {
        warnings.push(`Icon not found locally and API fetch failed: ${iconName}, will resolve via client`)
      }
    }
  }

  return result
}

async function processCharts(
  html: string,
  options: PreprocessorOptions,
  warnings: string[]
): Promise<string> {
  const chartRegex = /<chart([^>]*)>/gi
  let result = html
  let match

  while ((match = chartRegex.exec(html)) !== null) {
    const fullMatch = match[0]
    const attrs = match[1]

      const optionMatch = attrs.match(/option\s*=\s*'([^']+)'/) || attrs.match(/option\s*=\s*"([^"]+)"/)
      const classMatch = attrs.match(/class\s*=\s*['"]([^'"]+)['"]/)

    if (!optionMatch) {
      warnings.push('Chart missing option attribute, skipping')
      continue
    }

    try {
      const option = JSON.parse(optionMatch[1])
      let width = 400
      let height = 200

      if (classMatch) {
        const wMatch = classMatch[1].match(/w-\[(\d+)px\]/)
        const hMatch = classMatch[1].match(/h-\[(\d+)px\]/)
        if (wMatch) width = parseInt(wMatch[1])
        if (hMatch) height = parseInt(hMatch[1])
      }

      const { svgContent } = await renderChartToSVG(option, width, height)
      const svgWithAttrs = svgContent.replace('<svg', `<svg${attrs}`)
      result = result.replace(fullMatch, svgWithAttrs)
    } catch (error) {
      warnings.push(`Chart rendering failed: ${(error as Error).message}`)
    }
  }

  return result
}

/**
 * Inject outer attributes (class, data-name, style) into the root element
 * of a generated component HTML string.
 */
function injectOuterAttributes(
  html: string,
  attrs: { className?: string; dataName?: string; style?: string }
): string {
  const tagMatch = html.match(/^\s*<(\w+)([^>]*)>/)
  if (!tagMatch) return html

  const [, tagName, existingAttrs] = tagMatch
  const prefix = html.slice(0, tagMatch.index! + tagMatch[0].length)
  const suffix = html.slice(tagMatch.index! + tagMatch[0].length)

  let merged = existingAttrs

  if (attrs.className) {
    const clsMatch = merged.match(/\bclass\s*=\s*['"]([^'"]*)['"]/)
    if (clsMatch) {
      merged = merged.replace(clsMatch[0], `class="${clsMatch[1]} ${attrs.className}"`)
    } else {
      merged += ` class="${attrs.className}"`
    }
  }

  if (attrs.dataName) {
    const dnMatch = merged.match(/\bdata-name\s*=\s*['"][^'"]*['"]/)
    if (dnMatch) {
      merged = merged.replace(dnMatch[0], `data-name="${attrs.dataName}"`)
    } else {
      merged += ` data-name="${attrs.dataName}"`
    }
  }

  if (attrs.style) {
    const styleMatch = merged.match(/\bstyle\s*=\s*['"]([^'"]*)['"]/)
    if (styleMatch) {
      merged = merged.replace(styleMatch[0], `style="${styleMatch[1]}; ${attrs.style}"`)
    } else {
      merged += ` style="${attrs.style}"`
    }
  }

  return `<${tagName}${merged}>${suffix}`
}

async function processComponents(
  html: string,
  options: PreprocessorOptions,
  warnings: string[]
): Promise<string> {
  const componentRegex = /<component([^>]*)>/gi
  let result = html
  let match

  while ((match = componentRegex.exec(html)) !== null) {
    const fullMatch = match[0]
    const attrs = match[1]

    const typeMatch = attrs.match(/type\s*=\s*['"]([^'"]+)['"]/)
    let configMatch = attrs.match(/config\s*=\s*'([^']+)'/)
    if (!configMatch) configMatch = attrs.match(/config\s*=\s*"([^"]+)"/)

    if (!typeMatch) {
      warnings.push('Component missing type attribute, skipping')
      continue
    }

    try {
      const type = typeMatch[1]
      const config = configMatch ? JSON.parse(configMatch[1]) : {}

      const generated = generateComponentHtml(type, config)
      if (generated.warning) warnings.push(generated.warning)
      let componentHtml = generated.html

      // Preserve outer attributes (class, data-name, style) from <component> tag
      const outerClass = attrs.match(/class\s*=\s*['"]([^'"]+)['"]/)
      const outerDataName = attrs.match(/data-name\s*=\s*['"]([^'"]+)['"]/)
      const outerStyle = attrs.match(/style\s*=\s*['"]([^'"]+)['"]/)
      if (outerClass || outerDataName || outerStyle) {
        componentHtml = injectOuterAttributes(componentHtml, {
          className: outerClass ? outerClass[1] : undefined,
          dataName: outerDataName ? outerDataName[1] : undefined,
          style: outerStyle ? outerStyle[1] : undefined,
        })
      }

      result = result.replace(fullMatch, componentHtml)
    } catch (error) {
      warnings.push(`Component rendering failed: ${(error as Error).message}`)
    }
  }

  return result
}

// ─── States 支持 ─────────────────────────────────────────

const STATE_VISUAL: Record<string, { tailwind: string; label: string }> = {
  default: { tailwind: '', label: 'Default' },
  hover: { tailwind: 'brightness-[0.92]', label: 'Hover' },
  active: { tailwind: 'brightness-[0.85]', label: 'Active' },
  disabled: { tailwind: 'opacity-40', label: 'Disabled' },
  loading: { tailwind: 'opacity-70', label: 'Loading' },
  focused: { tailwind: '', label: 'Focused' },
}

function wrapWithStates(html: string, config: any): string {
  const states = config.states as string[] | undefined
  if (!states || states.length <= 1) return html

  const parts: string[] = []
  for (const state of states) {
    const s = STATE_VISUAL[state]
    if (!s) continue

    // Inject state-specific Tailwind classes into the root element's class attribute
    let stateHtml = html
    if (s.tailwind) {
      stateHtml = stateHtml.replace(/class="([^"]*)"/, (_m, cls) => `class="${cls} ${s.tailwind}"`)
    }

    parts.push(`
    <div class="flex flex-col items-center gap-1" data-name="Item-${parts.length}">
      ${stateHtml}
      <p class="text-[10px] leading-[14px] text-gray-400 text-center" data-name="StateLabel-${state}">${s.label}</p>
    </div>`)
  }

  return `<div class="flex flex-row items-start gap-4" data-name="StatesGroup">${parts.join('')}</div>`
}

function generateComponentHtml(type: string, config: any): { html: string; warning?: string } {
  let html: string
  switch (type) {
    case 'button': html = generateButtonHtml(config); break
    case 'badge': html = generateBadgeHtml(config); break
    case 'avatar': html = generateAvatarHtml(config); break
    case 'toggle': html = generateToggleHtml(config); break
    case 'progress': html = generateProgressHtml(config); break
    case 'checkbox': html = generateCheckboxHtml(config); break
    case 'radio': html = generateRadioHtml(config); break
    case 'checkbox-group': html = generateCheckboxGroupHtml(config); break
    case 'radio-group': html = generateRadioGroupHtml(config); break
    case 'text-input': html = generateTextInputHtml(config); break
    case 'select': html = generateSelectHtml(config); break
    case 'menu': html = generateMenuHtml(config); break
    case 'tabs': html = generateTabsHtml(config); break
    case 'list': html = generateListHtml(config); break
    case 'slider': html = generateSliderHtml(config); break
    case 'breadcrumb': html = generateBreadcrumbHtml(config); break
    case 'tooltip': html = generateTooltipHtml(config); break
    case 'divider': html = generateDividerHtml(config); break
    case 'tag': html = generateTagHtml(config); break
    case 'spinner': html = generateSpinnerHtml(config); break
    case 'modal': html = generateModalHtml(config); break
    case 'alert': html = generateAlertHtml(config); break
    case 'pagination': html = generatePaginationHtml(config); break
    case 'steps': html = generateStepsHtml(config); break
    case 'accordion': html = generateAccordionHtml(config); break
    case 'card': html = generateCardHtml(config); break
    case 'table': html = generateTableHtml(config); break
    case 'form': html = generateFormHtml(config); break
    case 'toast': html = generateToastHtml(config); break
    case 'skeleton': html = generateSkeletonHtml(config); break
    default:
      // 未实现的组件类型：仍渲染可见占位（便于人肉排查），但必须告警，
      // 否则调用方会误以为该组件已成功渲染。
      return {
        html: `<div class="border border-dashed border-gray-300 p-4 text-gray-500" data-name="Placeholder">Component: ${type}</div>`,
        warning: `未实现的组件类型 ${type}，已渲染占位`,
      }
  }
  // Wrap with states if config.states is present
  return { html: wrapWithStates(html, config) }
}

function generateButtonHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const variant = config.variant || 'primary'
  const label = config.label || 'Button'
  const size = config.size || {}
  const width = size.width ?? 88
  const height = size.height ?? 32
  const cornerRadius = size.cornerRadius ?? 4

  const variants: Record<string, { bg: string; textColor: string; stroke?: string }> = {
    primary: { bg: t.brand, textColor: '#FFFFFF' },
    secondary: { bg: t.bgWhite, textColor: '#333333' },
    outline: { bg: t.bgWhite, textColor: '#444444', stroke: '#DDDDDD' },
    text: { bg: 'transparent', textColor: t.brand },
  }

  const v = variants[variant] || variants.primary
  const fontStyle = variant === 'primary' ? 'font-bold' : 'font-normal'

  return `
    <section 
      data-name="Button-${variant}"
      class="flex items-center justify-center w-[${width}px] h-[${height}px]"
      style="background-color: ${v.bg}; border-radius: ${cornerRadius}px; ${v.stroke ? `border: 1px solid ${v.stroke};` : 'border-width: 0px;'}"
    >
      <p data-name="Label" style="text-align: center; font-size: 14px; line-height: 20px; font-weight: ${variant === 'primary' ? 700 : 400}; color: ${v.textColor};">${label}</p>
    </section>
  `.trim()
}

function generateBadgeHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const label = config.label || 'Badge'
  const variant = config.variant || 'default'
  const height = config.size?.height ?? 24
  const fontSize = config.size?.fontSize ?? 12

  const badgeVariants: Record<string, { bg: string; text: string }> = {
    default: { bg: '#E8E8E8', text: '#333333' },
    success: { bg: '#E6F7E6', text: '#1A7D1A' },
    warning: { bg: '#FFF3E0', text: '#92400E' },
    danger: { bg: '#FFEBEE', text: '#C62828' },
    info: { bg: '#E3F2FD', text: '#1565C0' },
  }

  const v = badgeVariants[variant] || badgeVariants.default
  const paddingX = config.size?.paddingX ?? 10

  return `
    <div
      class="flex items-center justify-center"
      data-name="Badge-${variant}"
      style="height: ${height}px; background-color: ${v.bg}; color: ${v.text}; border-radius: ${height / 2}px; padding: 0 ${paddingX}px; font-size: ${fontSize}px; width: auto; display: inline-flex;"
    >
      <p data-name="Label" class="font-medium" style="font-size: ${fontSize}px; line-height: ${fontSize + 4}px; color: ${v.text};">${label}</p>
    </div>
  `.trim()
}

function generateAvatarHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const initial = config.initial || 'U'
  const size = config.size?.width ?? 36
  const bg = config.bgColor || t.brand
  const textColor = config.textColor || '#FFFFFF'
  const fontSize = config.fontSize ?? (size * 0.4)

  return `
    <section 
      data-name="Avatar"
      class="rounded-full flex items-center justify-center font-bold"
      style="width: ${size}px; height: ${size}px; background-color: ${bg}; color: ${textColor}; font-size: ${fontSize}px;"
    >
      <p data-name="Initial" style="text-align: center; font-size: ${fontSize}px; line-height: ${fontSize + 4}px; color: ${textColor};">${initial}</p>
    </section>
  `.trim()
}

function generateToggleHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const checked = config.checked !== false
  const trackW = config.size?.width ?? 44
  const trackH = config.size?.height ?? 24
  const knobSize = trackH - 6
  const knobX = checked ? trackW - knobSize - 3 : 3

  const trackColor = checked ? t.brand : '#E0E0E0'
  const knobColor = '#FFFFFF'

  return `
    <div data-name="Toggle" class="relative" style="width: ${trackW}px; height: ${trackH}px;">
      <section data-name="Track" class="rounded-full" style="width: 100%; height: 100%; background-color: ${trackColor};"></section>
      <section data-name="Thumb" class="rounded-full absolute" style="width: ${knobSize}px; height: ${knobSize}px; left: ${knobX}px; top: ${(trackH - knobSize) / 2}px; background-color: ${knobColor}; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></section>
    </div>
  `.trim()
}

function generateProgressHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const width = config.size?.width ?? 300
  const height = config.size?.height ?? t.progressHeight
  const percent = Math.max(0, Math.min(100, config.percent ?? 60))
  const showLabel = config.showLabel !== false
  const fillColor = config.fillColor || t.progressFillColor
  const cornerRadius = config.size?.cornerRadius ?? t.progressCornerRadius

  return `
    <div data-name="Progress" style="width: ${width}px; height: ${showLabel ? height + 22 : height}px;">
      <div 
        data-name="Track"
        class="relative"
        style="width: ${width}px; height: ${height}px; background-color: ${t.progressTrackColor}; border-radius: ${cornerRadius}px; overflow: hidden;"
      >
        <div 
          data-name="Fill"
          style="width: ${percent}%; height: 100%; background-color: ${fillColor}; border-radius: ${cornerRadius}px;"
        ></div>
      </div>
      ${showLabel ? `<div data-name="Label" style="font-size: 12px; font-weight: 500; color: ${t.textPrimary}; text-align: right; margin-top: 4px;">${percent}%</div>` : ''}
    </div>
  `.trim()
}

function generateCheckboxHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const checked = config.checked !== false
  const disabled = config.disabled === true
  const label = config.label || 'Checkbox'
  const size = config.size?.width ?? 16

  const bg = disabled ? (checked ? t.borderDisabled : t.bgDisabled) : (checked ? t.brand : t.bgWhite)
  const stroke = disabled ? t.borderDisabled : (checked ? t.brand : t.border)
  const textColor = disabled ? t.textDisabled : t.textPrimary
  const checkColor = disabled ? t.checkMarkDisabled : t.checkMark

  const checkboxStyle = `width: ${size}px; height: ${size}px; border-radius: ${t.componentCornerRadius}px; background: ${bg}; border: ${t.strokeWeight}px solid ${stroke}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;`

  return `
    <div data-name="Checkbox" class="flex items-center gap-[8px]" style="height: ${size + 8}px;">
      <section data-name="Box" style="${checkboxStyle}">${checked ? `<svg data-name="Icon" width="12" height="9" viewBox="0 0 14 10"><path data-name="Tick" d="${t.penPath}" fill="${checkColor}"/></svg>` : ''}</section>
      <p data-name="Label" style="font-size: 14px; line-height: 20px; color: ${textColor};">${label}</p>
    </div>
  `.trim()
}

function generateRadioHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const checked = config.checked !== false
  const disabled = config.disabled === true
  const label = config.label || 'Radio'
  const size = config.size?.width ?? 16

  const bg = disabled ? t.bgDisabled : (checked ? t.brand : t.bgWhite)
  const stroke = disabled ? t.borderDisabled : (checked ? t.brand : t.border)
  const textColor = disabled ? t.textDisabled : t.textPrimary
  const dotColor = disabled ? t.checkMarkDisabled : t.checkMark

  const innerDot = checked ? `<section class="rounded-full" data-name="Dot" style="width: 8px; height: 8px; background: ${dotColor};"></section>` : ''

  return `
    <div data-name="Radio" class="flex items-center gap-[8px]" style="height: ${size + 8}px;">
      <section data-name="Circle" class="rounded-full flex items-center justify-center" style="width: ${size}px; height: ${size}px; background: ${bg}; border: ${t.strokeWeight}px solid ${stroke}; flex-shrink: 0;">
        ${innerDot}
      </section>
      <p data-name="Label" style="font-size: 14px; line-height: 20px; color: ${textColor};">${label}</p>
    </div>
  `.trim()
}

function generateCheckboxGroupHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const states = config.states || CHECKBOX_RADIO_STATES
  const componentSize = t.componentSize
  const startY = t.containerPadding + (t.titleSize * 1.5)

  let rowsHtml = ''
  states.forEach((s: any, i: number) => {
    const y = startY + i * (componentSize + t.rowGap)
    rowsHtml += `
      <div data-name="Row-${i}" style="position: absolute; left: ${t.containerPadding}px; top: ${y}px;">
        <div 
          data-name="Checkbox-${i}"
          style="width: ${componentSize}px; height: ${componentSize}px; background-color: ${s.bg}; border: ${t.strokeWeight}px solid ${s.stroke}; border-radius: ${t.componentCornerRadius}px;"
        >
          ${s.checked ? `<svg data-name="Icon-${i}" width="14" height="10" viewBox="0 0 14 10" style="margin: 1px 0 0 3px;">
            <path data-name="Tick-${i}" d="${t.penPath}" fill="${s.disabled ? t.checkMarkDisabled : t.checkMark}"/>
          </svg>` : ''}
        </div>
      </div>
      <div 
        data-name="Label-${i}"
        style="position: absolute; left: ${t.colLabelX}px; top: ${y}px; font-size: ${t.labelSize}px; color: ${s.textColor}; font-family: ${t.labelFont.family};"
      >${s.label}</div>
    `
  })

  return `
    <div 
      data-name="CheckboxGroup"
      style="width: ${t.containerWidth}px; height: 320px; background-color: ${t.bgWhite}; border-radius: ${t.containerCornerRadius}px; box-shadow: ${t.shadowOffset.x}px ${t.shadowOffset.y}px ${t.shadowRadius}px ${t.shadowColor}; position: relative; overflow: hidden;"
    >
      <div 
        data-name="Title"
        style="position: absolute; left: ${t.containerPadding}px; top: ${t.containerPadding}px; font-size: ${t.titleSize}px; font-weight: bold; color: ${t.textTitle}; font-family: ${t.titleFont.family};"
      >${config.title || 'Checkbox 复选框状态'}</div>
      ${rowsHtml}
    </div>
  `.trim()
}

function generateRadioGroupHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const states = config.states || CHECKBOX_RADIO_STATES
  const componentSize = t.componentSize
  const startY = t.containerPadding + (t.titleSize * 1.5)

  let rowsHtml = ''
  states.forEach((s: any, i: number) => {
    const y = startY + i * (componentSize + t.rowGap)
    rowsHtml += `
      <div data-name="Row-${i}" style="position: absolute; left: ${t.containerPadding}px; top: ${y}px;">
        <div 
          data-name="Radio-${i}"
          style="width: ${componentSize}px; height: ${componentSize}px; background-color: ${s.bg}; border: ${t.strokeWeight}px solid ${s.stroke}; border-radius: ${t.radioCornerRadius}px;"
        ></div>
        ${s.checked ? `<div 
          data-name="InnerDot"
          style="position: absolute; left: ${t.ellipsePos.x}px; top: ${y + t.ellipsePos.y}px; width: ${t.ellipseSize}px; height: ${t.ellipseSize}px; background-color: ${t.checkMark}; border-radius: 50%;"
        ></div>` : ''}
      </div>
      <div 
        data-name="Label-${i}"
        style="position: absolute; left: ${t.colLabelX}px; top: ${y}px; font-size: ${t.labelSize}px; color: ${s.textColor}; font-family: ${t.labelFont.family};"
      >${s.label}</div>
    `
  })

  return `
    <div 
      data-name="RadioGroup"
      style="width: ${t.containerWidth}px; height: 320px; background-color: ${t.bgWhite}; border-radius: ${t.containerCornerRadius}px; box-shadow: ${t.shadowOffset.x}px ${t.shadowOffset.y}px ${t.shadowRadius}px ${t.shadowColor}; position: relative; overflow: hidden;"
    >
      <div 
        data-name="Title"
        style="position: absolute; left: ${t.containerPadding}px; top: ${t.containerPadding}px; font-size: ${t.titleSize}px; font-weight: bold; color: ${t.textTitle}; font-family: ${t.titleFont.family};"
      >${config.title || 'Radio 单选框状态'}</div>
      ${rowsHtml}
    </div>
  `.trim()
}

function generateTextInputHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const width = config.size?.width ?? 248
  const height = config.size?.height ?? 36
  const placeholder = config.placeholder || '请输入内容...'
  const cornerRadius = config.size?.cornerRadius ?? 6

  return `
    <div 
      data-name="TextInput"
      style="width: ${width}px; height: ${height}px; background-color: ${t.bgWhite}; border: 1px solid ${t.border}; border-radius: ${cornerRadius}px; padding-left: 12px; display: flex; align-items: center; box-sizing: border-box;"
    >
      <span data-name="Placeholder" style="font-size: 14px; color: #64748B; font-family: ${t.labelFont.family};">${placeholder}</span>
    </div>
  `.trim()
}

function generateSelectHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const width = config.size?.width ?? 200
  const height = config.size?.height ?? 36
  const placeholder = config.placeholder || '请选择'
  const cornerRadius = config.size?.cornerRadius ?? 6

  return `
    <div 
      data-name="Select"
      style="width: ${width}px; height: ${height}px; background-color: ${t.bgWhite}; border: 1px solid ${t.border}; border-radius: ${cornerRadius}px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; box-sizing: border-box; position: relative;"
    >
      <span data-name="Placeholder" style="font-size: 14px; color: #64748B; font-family: ${t.labelFont.family};">${placeholder}</span>
      <svg data-name="Icon" width="12.73" height="7.78" viewBox="0 0 12.73 7.78">
        <path data-name="Arrow" d="M1.41421 0L6.36391 4.94972L11.3137 0L12.7279 1.41421L6.36391 7.77822L0 1.41421L1.41421 0Z" fill="#A6A6A6"/>
      </svg>
    </div>
  `.trim()
}

function generateMenuHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const items = config.items || [
    { label: '编辑', icon: '' },
    { label: '复制', icon: '' },
    { type: 'divider' },
    { label: '删除', icon: '', danger: true },
  ]
  const itemHeight = config.size?.height ?? t.menuItemHeight
  const paddingX = config.size?.paddingX ?? t.menuItemPaddingX
  const width = config.size?.width ?? 180

  const totalHeight = items.reduce((h: number, it: any) => h + (it.type === 'divider' ? 9 : itemHeight), 0) + 8
  let itemsHtml = ''
  let y = 4

  items.forEach((item: any, i: number) => {
    if (item.type === 'divider') {
      itemsHtml += `<div data-name="Divider-${i}" style="position: absolute; left: ${t.menuDividerMargin}px; top: ${y + 4}px; width: ${width - t.menuDividerMargin * 2}px; height: 1px; background-color: ${t.menuDividerColor};"></div>`
      y += 9
      return
    }

    const isDanger = item.danger
    const textColor = isDanger ? '#E53935' : t.textPrimary

    itemsHtml += `
      <div data-name="Item-${i}" style="position: absolute; left: 2px; top: ${y}px; width: ${width - 4}px; height: ${itemHeight}px; border-radius: 4px;">
        <div 
          data-name="Label-${i}"
          style="position: absolute; left: ${paddingX}px; top: ${(itemHeight - 20) / 2}px; font-size: 14px; color: ${textColor}; font-family: ${t.labelFont.family};"
        >${item.label}</div>
      </div>
    `
    y += itemHeight
  })

  return `
    <div 
      data-name="Menu"
      style="width: ${width}px; height: ${totalHeight}px; background-color: ${t.bgWhite}; border-radius: ${t.menuCornerRadius}px; ${t.menuShadow ? `box-shadow: 0 4px 12px rgba(0,0,0,0.15);` : ''} position: relative; overflow: hidden;"
    >
      ${itemsHtml}
    </div>
  `.trim()
}

function generateTabsHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const items = config.items || ['Tab 1', 'Tab 2', 'Tab 3']
  const activeIndex = config.activeIndex ?? 0
  const tabHeight = config.size?.height ?? t.tabHeight
  const fontSize = config.size?.fontSize ?? 14
  const width = config.size?.width ?? 400
  const showIndicator = config.showIndicator !== false
  const variant = config.variant || 'default'

  const tabEls = items.map((label: string, i: number) => {
    const isActive = i === activeIndex
    const activeTextColor = variant === 'underline' ? t.brand : (isActive ? t.tabActiveText : t.tabInactiveText)
    const textCol = isActive ? activeTextColor : t.tabInactiveText

    if (variant === 'underline') {
      const borderStyle = isActive && showIndicator
        ? `border-bottom-width: 2px; border-top-width: 0; border-left-width: 0; border-right-width: 0; border-color: ${t.brand}; border-style: solid;`
        : 'border-width: 0;'
      return `
        <section data-name="Tab-${i}" class="flex items-center justify-center flex-1 self-stretch" style="${borderStyle}">
          <p data-name="Label-${i}" style="font-size: ${fontSize}px; line-height: ${fontSize + 6}px; color: ${textCol}; font-weight: ${isActive ? '700' : '400'};">${label}</p>
        </section>
      `
    }
    const bg = isActive ? t.tabActiveBg : 'transparent'
    return `
      <section data-name="Tab-${i}" class="flex items-center justify-center flex-1 self-stretch" style="background-color: ${bg}; border-radius: 6px;">
        <p data-name="Label-${i}" style="font-size: ${fontSize}px; line-height: ${fontSize + 6}px; color: ${textCol}; font-weight: ${isActive ? '700' : '400'};">${label}</p>
      </section>
    `
  }).join('')

  if (variant === 'underline') {
    return `
      <section data-name="Tabs-${variant}" class="flex flex-row w-[${width}px] h-[${tabHeight}px]" style="border-bottom: 1px solid #E5E7EB; background-color: ${t.bgWhite};">
        ${tabEls}
      </section>
    `.trim()
  }

  return `
    <section data-name="Tabs-${variant}" class="flex flex-row gap-[4px] w-[${width}px] h-[${tabHeight}px]" style="padding: 4px; background-color: ${t.bgWhite}; border-radius: 8px;">
      ${tabEls}
    </section>
  `.trim()
}

function generateListHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const items = config.items || [
    { label: '列表项 1', icon: '', badge: '' },
    { label: '列表项 2', icon: '', badge: 'New' },
    { label: '列表项 3', icon: '', badge: '' },
  ]
  const itemHeight = config.size?.height ?? t.listItemHeight
  const width = config.size?.width ?? 320
  const paddingX = config.size?.paddingX ?? t.listItemPaddingX
  const totalH = items.length * (itemHeight + t.listItemGap)

  let itemsHtml = ''
  let y = 0

  items.forEach((item: any, i: number) => {
    const labelX = (item.avatar || item.icon) ? paddingX + 28 : paddingX

    itemsHtml += `
      <div data-name="Item-${i}" style="position: absolute; left: 0; top: ${y}px; width: ${width}px; height: ${itemHeight}px;">
        <div 
          data-name="Label"
          style="position: absolute; left: ${labelX}px; top: ${(itemHeight - 14) / 2}px; font-size: 14px; color: ${t.textPrimary}; font-family: ${t.labelFont.family};"
        >${item.label}</div>
        ${item.badge ? `<div 
          data-name="IconRight"
          style="position: absolute; right: ${paddingX}px; top: ${(itemHeight - 11) / 2}px; font-size: 11px; color: ${t.brand}; font-weight: 500;"
        >${item.badge}</div>` : ''}
        ${i < items.length - 1 ? `<div data-name="Divider-${i}" style="position: absolute; left: ${paddingX}px; bottom: 0; width: ${width - paddingX * 2}px; height: 1px; background-color: #EDEDED;"></div>` : ''}
      </div>
    `
    y += itemHeight + t.listItemGap
  })

  return `
    <div 
      data-name="List"
      style="width: ${width}px; height: ${totalH}px; background-color: ${t.bgWhite}; border-radius: 8px; box-shadow: ${t.shadowOffset.x}px ${t.shadowOffset.y}px ${t.shadowRadius}px ${t.shadowColor}; position: relative; overflow: hidden;"
    >
      ${itemsHtml}
    </div>
  `.trim()
}

function generateSliderHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const width = config.size?.width ?? 260
  const trackH = config.size?.height ?? t.sliderTrackHeight
  const handleSize = config.handleSize ?? t.sliderHandleSize
  const percent = Math.max(0, Math.min(100, config.percent ?? 50))
  const handleX = (width * percent / 100) - (handleSize / 2)

  const trackTop = (Math.max(trackH, handleSize) + 4 - trackH) / 2
  const handleTop = (Math.max(trackH, handleSize) + 4 - handleSize) / 2
  return `
    <div data-name="Slider" style="width: ${width}px; height: ${Math.max(trackH, handleSize) + 4}px; position: relative;">
      <section data-name="Track" class="rounded-full overflow-hidden" style="position: absolute; left: 0; top: ${trackTop}px; width: ${width}px; height: ${trackH}px; background-color: ${t.sliderTrackColor};">
        <section data-name="Fill" style="width: ${percent}%; height: 100%; background-color: ${t.sliderFillColor};"></section>
      </section>
      <section data-name="Thumb" class="rounded-full" style="position: absolute; left: ${handleX}px; top: ${handleTop}px; width: ${handleSize}px; height: ${handleSize}px; background-color: ${t.sliderHandleColor}; border: 2px solid ${t.sliderHandleBorder}; box-shadow: 0 2px 4px rgba(0,0,0,0.15);"></section>
    </div>
  `.trim()
}

function generateBreadcrumbHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const items = config.items || ['首页', '分类', '详情']
  const separator = config.separator ?? t.breadcrumbSeparator
  const fontSize = config.size?.fontSize ?? t.breadcrumbFontSize

  let itemsHtml = ''
  let totalWidth = 0

  items.forEach((label: string, i: number) => {
    const isLast = i === items.length - 1
    const textColor = isLast ? t.textPrimary : t.breadcrumbSeparatorColor
    const fontWeight = isLast ? '600' : 'normal'

    itemsHtml += `
      <span 
        data-name="Crumb-${i}"
        style="font-size: ${fontSize}px; color: ${textColor}; font-family: Inter; font-weight: ${fontWeight}; margin-right: 4px;"
      >${label}</span>
      ${!isLast ? `<span 
        data-name="Divider-${i}"
        style="font-size: ${fontSize}px; color: ${t.breadcrumbSeparatorColor}; margin-right: 4px;"
      >${separator}</span>` : ''}
    `
    totalWidth += label.length * fontSize * 0.6 + 4
    if (!isLast) totalWidth += fontSize * 0.8 + 4
  })

  return `
    <div data-name="Breadcrumb" style="width: ${totalWidth}px; height: ${fontSize * 1.6}px; display: flex; align-items: center;">
      ${itemsHtml}
    </div>
  `.trim()
}

function generateTooltipHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const label = config.label || '提示文字'
  const fontSize = config.size?.fontSize ?? t.tooltipFontSize
  const padding = config.size?.paddingX ?? t.tooltipPadding

  const textWidth = label.length * fontSize * 0.6 + 4
  const textHeight = fontSize * 1.4

  return `
    <div 
      data-name="Tooltip"
      style="width: ${textWidth + padding * 2}px; height: ${textHeight + padding * 1.2}px; background-color: ${t.tooltipBg}; border-radius: ${t.tooltipCornerRadius}px; display: flex; align-items: center; justify-content: center;"
    >
      <span data-name="Label" style="font-size: ${fontSize}px; color: ${t.tooltipTextColor}; font-family: Inter;">${label}</span>
    </div>
  `.trim()
}

function generateDividerHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const isVertical = config.direction === 'vertical'
  const thickness = config.size?.height ?? t.dividerThickness
  const color = config.color || t.dividerColor
  const label = config.label || ''
  const length = isVertical ? (config.size?.height ?? 120) : (config.size?.width ?? 300)

  if (isVertical) {
    return `
      <div data-name="Divider-vertical" style="width: ${thickness}px; height: ${length}px; background-color: ${color};"></div>
    `.trim()
  }

  return `
    <div data-name="Divider-horizontal" style="width: ${length}px; height: ${label ? 28 : thickness + 12}px; position: relative;">
      <div 
        data-name="Line"
        style="position: absolute; left: 0; top: ${label ? 14 - thickness / 2 : 6}px; width: ${length}px; height: ${thickness}px; background-color: ${color};"
      ></div>
      ${label ? `<div 
        data-name="Label"
        style="position: absolute; left: 50%; top: 0; transform: translateX(-50%); padding: 0 10px; font-size: 12px; color: ${t.dividerLabelColor}; background-color: ${t.dividerLabelBg};"
      >${label}</div>` : ''}
    </div>
  `.trim()
}

function generateTagHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const label = config.label || 'Tag'
  const variant = config.variant || 'default'
  const height = config.size?.height ?? t.tagHeight
  const fontSize = config.size?.fontSize ?? t.tagFontSize
  const paddingX = config.size?.paddingX ?? t.tagPaddingX
  const closable = config.closable !== false

  const tagVariants: Record<string, { bg: string; text: string }> = {
    default: { bg: t.tagDefaultBg, text: t.tagDefaultText },
    primary: { bg: t.tagPrimaryBg, text: t.tagPrimaryText },
    success: { bg: t.tagSuccessBg, text: t.tagSuccessText },
    warning: { bg: t.tagWarningBg, text: t.tagWarningText },
    danger: { bg: t.tagDangerBg, text: t.tagDangerText },
  }

  const v = tagVariants[variant] || tagVariants.default
  const closeW = closable ? 14 : 0
  const textWidth = label.length * fontSize * 0.5 + 4
  const totalWidth = textWidth + paddingX * 2 + closeW + (closable ? 4 : 0)

  return `
    <div 
      data-name="Tag-${variant}"
      style="width: ${totalWidth}px; height: ${height}px; background-color: ${v.bg}; border-radius: ${t.tagCornerRadius}px; display: flex; align-items: center; padding: 0 ${paddingX}px; position: relative;"
    >
      <span data-name="Label" style="font-size: ${fontSize}px; color: ${v.text}; font-family: Inter;">${label}</span>
      ${closable ? `<div 
        data-name="Close"
        style="position: absolute; right: ${paddingX - 7}px; top: ${(height - 4) / 2}px; width: 4px; height: 4px;"
      >
        <svg data-name="Icon" width="4" height="4" viewBox="0 0 4 4">
          <line data-name="Icon-0" x1="0" y1="0" x2="4" y2="4" stroke="${v.text}" stroke-width="1.5" stroke-linecap="round"/>
          <line data-name="Icon-1" x1="4" y1="0" x2="0" y2="4" stroke="${v.text}" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>` : ''}
    </div>
  `.trim()
}

function generateSpinnerHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const size = config.size?.width ?? t.spinnerSize
  const strokeWidth = config.size?.height ?? t.spinnerStrokeWidth
  const color = config.color || t.spinnerColor
  const trackColor = t.spinnerTrackColor

  const cx = size / 2
  const cy = size / 2
  const r = (size - strokeWidth) / 2

  // Match plugin componentHandlers.ts SPINNER_ARC path:
  // viewBox 0 0 20 20, arc from (18,10) to (10,2) = 90° right→top
  // Scale arc to current size: arc start at (cx+r, cy), end at (cx, cy-r)
  const ax = cx + r    // right edge
  const ay = cy         // center y
  const bx = cx         // center x
  const by = cy - r     // top edge

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" data-name="Spinner">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${trackColor}" stroke-width="${strokeWidth}" data-name="Track"/>
      <path d="M ${ax} ${ay} A ${r} ${r} 0 1 1 ${bx} ${by}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" data-name="Arc"/>
    </svg>
  `.trim()
}

function generateModalHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const title = config.title || '提示'
  const content = config.content || ''
  const confirmLabel = config.confirmLabel || '确认'
  const cancelLabel = config.cancelLabel || '取消'
  const showCancel = config.showCancel !== false
  const closable = config.closable !== false
  const width = config.size?.width ?? t.modalWidth
  const padding = config.size?.paddingX ?? t.modalPadding
  const cornerRadius = config.size?.cornerRadius ?? t.modalCornerRadius

  const btnH = 34
  const btnW = 80
  const titleH = 22
  const contentH = content ? 16 : 0
  const footerH = showCancel ? 50 : 44
  const cardH = padding * 2 + titleH + 12 + (contentH > 0 ? contentH + 12 : 0) + footerH
  const cardW = width

  return `
    <div 
      data-name="Modal"
      style="width: ${width + 60}px; height: 460px; background-color: ${t.modalOverlay}; display: flex; align-items: center; justify-content: center;"
    >
      <div 
        data-name="Card"
        style="width: ${cardW}px; height: ${cardH}px; background-color: ${t.bgWhite}; border-radius: ${cornerRadius}px; box-shadow: 0 8px 24px rgba(0,0,0,0.15); position: relative; overflow: hidden;"
      >
        <div 
          data-name="Title"
          style="position: absolute; left: ${padding}px; top: ${padding}px; font-size: ${t.titleSize}px; font-weight: bold; color: ${t.textTitle}; font-family: ${t.titleFont.family};"
        >${title}</div>
        ${closable ? `<div data-name="Close" style="position: absolute; right: ${padding}px; top: ${padding + 2}px;">
          <svg data-name="Icon" width="8" height="8" viewBox="0 0 8 8">
            <line data-name="Icon-0" x1="0" y1="0" x2="8" y2="8" stroke="#999999" stroke-width="1.8" stroke-linecap="round"/>
            <line data-name="Icon-1" x1="8" y1="0" x2="0" y2="8" stroke="#999999" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </div>` : ''}
        ${content ? `<div 
          data-name="Content"
          style="position: absolute; left: ${padding}px; top: ${padding + titleH + 12}px; font-size: ${t.labelSize}px; color: ${t.textPrimary}; font-family: ${t.labelFont.family};"
        >${content}</div>` : ''}
        <div 
          data-name="FooterDivider"
          style="position: absolute; left: 0; top: ${padding * 2 + titleH + 12 + (contentH > 0 ? contentH + 12 : 0)}px; width: ${cardW}px; height: 1px; background-color: ${t.modalFooterBorder};"
        ></div>
        <div data-name="Footer" style="position: absolute; right: ${padding}px; bottom: ${(footerH - btnH) / 2}px;">
          ${showCancel ? `<section data-name="Btn-Cancel" class="flex items-center justify-center" style="width: ${btnW}px; height: ${btnH}px; border-radius: 6px; display: inline-flex; margin-right: 12px;">
            <p data-name="Label" style="font-size: 13px; font-weight: 500; color: ${t.textPrimary};">${cancelLabel}</p>
          </section>` : ''}
          <section data-name="Btn-Confirm" class="flex items-center justify-center" style="width: ${btnW}px; height: ${btnH}px; background-color: ${t.brand}; border-radius: 6px; display: inline-flex;">
            <p data-name="Label" style="font-size: 13px; font-weight: 500; color: #FFFFFF;">${confirmLabel}</p>
          </section>
        </div>
      </div>
    </div>
  `.trim()
}

function generateAlertHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const type = config.variant || config.type || 'info'
  const title = config.title || ''
  const content = config.content || config.message || ''
  const width = config.size?.width ?? t.alertWidth

  const alertVariants: Record<string, { bg: string; border: string; iconColor: string; icon: string }> = {
    success: { bg: t.alertSuccessBg, border: t.alertSuccessBorder, iconColor: t.alertSuccessIcon, icon: 'success' },
    warning: { bg: t.alertWarningBg, border: t.alertWarningBorder, iconColor: t.alertWarningIcon, icon: 'warning' },
    error: { bg: t.alertErrorBg, border: t.alertErrorBorder, iconColor: t.alertErrorIcon, icon: 'error' },
    danger: { bg: t.alertErrorBg, border: t.alertErrorBorder, iconColor: t.alertErrorIcon, icon: 'error' },
    info: { bg: t.alertInfoBg, border: t.alertInfoBorder, iconColor: t.alertInfoIcon, icon: 'info' },
  }

  const v = alertVariants[type] || alertVariants.info

  const iconSvg = type === 'success'
    ? `<path data-name="Icon-0-0" d="M20 6L9 17l-5-5" stroke="${v.iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    : type === 'warning'
    ? `<path data-name="Icon-0-0" d="M12 9v4M12 17h.01" stroke="${v.iconColor}" stroke-width="2" stroke-linecap="round"/><circle data-name="Icon-0-1" cx="12" cy="12" r="10" stroke="${v.iconColor}" stroke-width="2"/>`
    : type === 'error' || type === 'danger'
    ? `<path data-name="Icon-0-0" d="M18 6L6 18M6 6l12 12" stroke="${v.iconColor}" stroke-width="2" stroke-linecap="round"/>`
    : `<circle data-name="Icon-0-0" cx="12" cy="12" r="10" stroke="${v.iconColor}" stroke-width="2"/><path data-name="Icon-0-1" d="M12 16v-4M12 8h.01" stroke="${v.iconColor}" stroke-width="2" stroke-linecap="round"/>`

  return `
    <section data-name="Alert-${type}" class="flex flex-row" style="position: relative; width: ${width}px; background-color: ${v.bg}; border: 1px solid ${v.border}; border-radius: ${t.alertCornerRadius}px; padding: 16px; gap: 12px;">
      <section data-name="Icon" style="width: ${t.alertIconSize}px; height: ${t.alertIconSize}px; flex-shrink: 0;">
        <svg data-name="Icon-0" width="${t.alertIconSize}" height="${t.alertIconSize}" viewBox="0 0 24 24" fill="none">${iconSvg}</svg>
      </section>
      <section data-name="Content" class="flex flex-col" style="gap: 4px;">
        ${title ? `<p data-name="Title" style="font-size: ${t.labelSize}px; font-weight: 600; line-height: ${t.labelSize + 4}px; color: ${v.iconColor};">${title}</p>` : ''}
        ${content ? `<p data-name="Description" style="font-size: 13px; line-height: 18px; color: ${v.iconColor};">${content}</p>` : ''}
      </section>
      ${config.closable !== false ? `<div data-name="Close" style="position: absolute; right: 16px; top: 16px;">
        <svg data-name="Icon-1" width="8" height="8" viewBox="0 0 8 8">
          <line data-name="Icon-1-0" x1="0" y1="0" x2="8" y2="8" stroke="${v.iconColor}" stroke-width="1.8" stroke-linecap="round"/>
          <line data-name="Icon-1-1" x1="8" y1="0" x2="0" y2="8" stroke="${v.iconColor}" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </div>` : ''}
    </section>
  `.trim()
}

function generatePaginationHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const current = config.current ?? 1
  const total = config.total ?? 5
  const layout = config.layout || 'absolute'

  // Flex layout: uses flex + divs, matches hand-written HTML pattern
  if (layout === 'flex') {
    const btnSize = config.size?.width ?? 32
    const btnGap = config.btnGap ?? 4
    const cornerRadius = config.cornerRadius ?? 6
    const fontSize = config.fontSize ?? 13

    let html = ''
    for (let i = 1; i <= total; i++) {
      const isActive = i === current
      const bg = isActive ? (t.paginationActiveBg || '#3b82f6') : 'transparent'
      const textColor = isActive ? (t.paginationActiveText || '#FFFFFF') : (t.paginationBtnText || '#374151')
      html += `
        <div data-name="Item-${i - 1}" style="width: ${btnSize}px; height: ${btnSize}px; border-radius: ${cornerRadius}px; background-color: ${bg}; color: ${textColor}; display: flex; align-items: center; justify-content: center; font-size: ${fontSize}px; font-weight: ${isActive ? '500' : '400'}; cursor: pointer;">${i}</div>
      `
    }

    return `
      <div data-name="Pagination" style="display: flex; gap: ${btnGap}px; align-items: center;">
        ${html}
      </div>
    `.trim()
  }

  // Absolute layout (backward compatible)
  const btnSize = t.paginationBtnSize
  const btnGap = t.paginationBtnGap

  let html = ''
  let x = 0

  for (let i = 1; i <= total; i++) {
    const isActive = i === current
    const bg = isActive ? t.paginationActiveBg : t.paginationBtnBg
    const textColor = isActive ? t.paginationActiveText : t.paginationBtnText

    html += `
      <section data-name="Item-${i - 1}" class="flex items-center justify-center" style="position: absolute; left: ${x}px; top: 0; width: ${btnSize}px; height: ${btnSize}px; background-color: ${bg}; border-radius: ${t.paginationBtnCornerRadius}px;">
        <p data-name="Label" style="font-size: 14px; font-weight: ${isActive ? '700' : '400'}; color: ${textColor}; text-align: center;">${i}</p>
      </section>
    `
    x += btnSize + btnGap
  }

  return `
    <div data-name="Pagination" style="width: ${total * (btnSize + btnGap) - btnGap}px; height: ${btnSize}px; position: relative;">
      ${html}
    </div>
  `.trim()
}

function generateStepsHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const items = config.items || ['Step 1', 'Step 2', 'Step 3']
  const activeIndex = config.activeIndex ?? 0

  const stepWidth = 120
  const totalWidth = items.length * stepWidth

  let html = ''
  items.forEach((label: string, i: number) => {
    const isActive = i === activeIndex
    const isCompleted = i < activeIndex
    const isInactive = i > activeIndex

    const stepColor = isCompleted || isActive ? t.stepCompletedColor : t.stepInactiveColor
    const textColor = isInactive ? t.stepInactiveText : t.textPrimary

    html += `
      <div data-name="Item-${i}" style="position: absolute; left: ${i * stepWidth}px; top: 0; width: ${stepWidth}px; text-align: center;">
        <div 
          data-name="Step-${i}"
          style="width: ${t.stepSize}px; height: ${t.stepSize}px; margin: 0 auto; background-color: ${isCompleted || isActive ? stepColor : '#FFFFFF'}; border: 2px solid ${stepColor}; border-radius: 50%; display: flex; align-items: center; justify-content: center;"
        >
          ${isCompleted ? '<svg data-name="Icon" width="14" height="10" viewBox="0 0 14 10"><path data-name="Icon-0" d="M2 5L6 9L12 2" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : isActive ? '<div data-name="Fill" style="width: 8px; height: 8px; background-color: #FFFFFF; border-radius: 50%;"></div>' : `<span data-name="Initial" style="font-size: ${t.stepFontSize}px; color: ${stepColor};">${i + 1}</span>`}
        </div>
        <div data-name="Label-${i}" style="margin-top: 8px; font-size: ${t.stepFontSize}px; color: ${textColor}; font-family: Inter;">${label}</div>
        ${i < items.length - 1 ? `<div 
          data-name="Connector-${i}"
          style="position: absolute; left: ${t.stepSize / 2}px; top: ${t.stepSize / 2}px; width: ${stepWidth - t.stepSize}px; height: 2px; background-color: ${i < activeIndex ? t.stepCompletedColor : t.stepConnectorColor};"
        ></div>` : ''}
      </div>
    `
  })

  return `
    <div data-name="Steps" style="width: ${totalWidth}px; height: ${t.stepSize + 30}px; position: relative;">
      ${html}
    </div>
  `.trim()
}

function generateAccordionHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const items = config.items || [
    { label: 'Section 1', content: 'Content 1' },
    { label: 'Section 2', content: 'Content 2' },
  ]
  const activeIndex = config.activeIndex ?? 0

  let totalHeight = items.length * (t.accordionHeaderHeight + t.accordionGap)
  if (activeIndex >= 0) totalHeight += 40

  let html = ''
  let y = 0

  items.forEach((item: any, i: number) => {
    const isActive = i === activeIndex

    html += `
      <div data-name="Item-${i}" style="position: absolute; left: 0; top: ${y}px; width: 320px;">
        <div 
          data-name="Header-${i}"
          style="width: 320px; height: ${t.accordionHeaderHeight}px; background-color: ${t.bgWhite}; border: 1px solid ${t.accordionBorderColor}; border-radius: ${t.accordionCornerRadius}px; padding: 0 ${t.accordionContentPadding}px; display: flex; align-items: center; justify-content: space-between;"
        >
          <span data-name="Label" style="font-size: 14px; color: ${t.textPrimary}; font-family: ${t.labelFont.family};">${item.label}</span>
          <svg data-name="Chevron" width="12" height="7" viewBox="0 0 12 7" style="${isActive ? 'transform: rotate(180deg);' : ''}">
            <path data-name="Icon" d="M1 1L6 6L11 1" stroke="#999999" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        ${i < items.length - 1 || isActive ? `<div data-name="Divider-${i}" style="width: 320px; height: 1px; background-color: ${t.accordionBorderColor};"></div>` : ''}
        ${isActive ? `<div 
          data-name="Content"
          style="width: 320px; padding: ${t.accordionContentPadding}px; border: 1px solid ${t.accordionBorderColor}; border-top: none; border-radius: 0 0 ${t.accordionCornerRadius}px ${t.accordionCornerRadius}px; margin-top: -1px;"
        >
          <span data-name="Description" style="font-size: 14px; color: ${t.textPrimary}; font-family: ${t.labelFont.family};">${item.content}</span>
        </div>` : ''}
      </div>
    `
    y += t.accordionHeaderHeight + t.accordionGap + (isActive ? 40 : 0)
  })

  return `
    <div data-name="Accordion" style="width: 320px; height: ${totalHeight}px; position: relative;">
      ${html}
    </div>
  `.trim()
}

function generateCardHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const title = config.title || 'Card Title'
  const content = config.content || 'Card content goes here.'
  const width = config.size?.width ?? 320
  const padding = config.size?.paddingX ?? 24
  const cornerRadius = config.size?.cornerRadius ?? 12
  const showFooter = config.footer !== false
  const footerButtons = config.footerButtons || ['Cancel', 'Confirm']

  const titleH = 22
  const contentH = content.length * 0.5 * 14 + 8
  const footerH = showFooter ? 48 : 0
  const totalH = padding * 2 + titleH + 16 + contentH + footerH

  let footerHtml = ''
  if (showFooter) {
    const btnW = 80
    const btnH = 32
    const btnGap = 12
    const btnStartX = width - padding - (footerButtons.length * btnW + (footerButtons.length - 1) * btnGap)

    footerButtons.forEach((label: string, i: number) => {
      const isPrimary = i === footerButtons.length - 1
      const bg = isPrimary ? t.brand : 'transparent'
      const textColor = isPrimary ? '#FFFFFF' : t.textPrimary
      footerHtml += `
        <section data-name="Btn-${i}" class="flex items-center justify-center" style="position: absolute; left: ${btnStartX + i * (btnW + btnGap)}px; bottom: ${(footerH - btnH) / 2}px; width: ${btnW}px; height: ${btnH}px; background-color: ${bg}; border-radius: 6px;">
          <p data-name="Label-${i}" style="font-size: 13px; font-weight: 500; color: ${textColor};">${label}</p>
        </section>
      `
    })
  }

  return `
    <div 
      data-name="Card"
      style="width: ${width}px; height: ${totalH}px; background-color: ${t.bgWhite}; border-radius: ${cornerRadius}px; box-shadow: ${t.shadowOffset.x}px ${t.shadowOffset.y}px ${t.shadowRadius}px ${t.shadowColor}; position: relative; overflow: hidden;"
    >
      <div 
        data-name="Title"
        style="position: absolute; left: ${padding}px; top: ${padding}px; font-size: ${t.titleSize}px; font-weight: bold; color: ${t.textTitle}; font-family: ${t.titleFont.family};"
      >${title}</div>
      <div 
        data-name="Content"
        style="position: absolute; left: ${padding}px; top: ${padding + titleH + 16}px; font-size: ${t.labelSize}px; color: ${t.textPrimary}; font-family: ${t.labelFont.family};"
      >${content}</div>
      ${showFooter ? `<div 
        data-name="FooterDivider"
        style="position: absolute; left: 0; top: ${totalH - footerH}px; width: ${width}px; height: 1px; background-color: ${t.modalFooterBorder};"
      ></div>` : ''}
      ${footerHtml}
    </div>
  `.trim()
}

function generateTableHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const columns = config.columns || ['Column 1', 'Column 2', 'Column 3']
  const rows = config.rows || [
    ['Row 1 Col 1', 'Row 1 Col 2', 'Row 1 Col 3'],
    ['Row 2 Col 1', 'Row 2 Col 2', 'Row 2 Col 3'],
    ['Row 3 Col 1', 'Row 3 Col 2', 'Row 3 Col 3'],
  ]
  const width = config.size?.width ?? 400
  const headerHeight = config.size?.headerHeight ?? 40
  const rowHeight = config.size?.rowHeight ?? 36
  const cellPadding = config.size?.cellPadding ?? 12
  const cornerRadius = config.size?.cornerRadius ?? 8

  const totalH = headerHeight + rows.length * rowHeight
  const colW = width / columns.length

  let headerHtml = ''
  columns.forEach((col: string, i: number) => {
    headerHtml += `
      <div 
        data-name="HeaderCell-${i}"
        style="position: absolute; left: ${i * colW}px; top: 0; width: ${colW}px; height: ${headerHeight}px; background-color: #F5F5F5;"
      >
        <div 
          data-name="Header-${i}"
          style="position: absolute; left: ${cellPadding}px; top: ${(headerHeight - 14) / 2}px; font-size: 14px; font-weight: 600; color: ${t.textTitle}; font-family: Inter;"
        >${col}</div>
        ${i < columns.length - 1 ? `<div 
          data-name="HeaderDivider-${i}"
          style="position: absolute; left: ${(i + 1) * colW - 0.5}px; top: 0; width: 1px; height: ${headerHeight}px; background-color: #E0E0E0;"
        ></div>` : ''}
      </div>
    `
  })

  let rowsHtml = ''
  rows.forEach((row: string[], rowIdx: number) => {
    const rowY = headerHeight + rowIdx * rowHeight
    rowsHtml += `<div 
      data-name="RowDivider-${rowIdx}"
      style="position: absolute; left: 0; top: ${rowY}px; width: ${width}px; height: 1px; background-color: #E8E8E8;"
    ></div>`
    row.forEach((cell: string, colIdx: number) => {
      rowsHtml += `
        <div 
          data-name="Cell-${rowIdx + 1}-${colIdx}"
          style="position: absolute; left: ${colIdx * colW + cellPadding}px; top: ${rowY + (rowHeight - 13) / 2}px; font-size: 13px; color: ${t.textPrimary}; font-family: ${t.labelFont.family};"
        >${cell}</div>
      `
    })
  })

  return `
    <div 
      data-name="Table"
      style="width: ${width}px; height: ${totalH}px; background-color: ${t.bgWhite}; border-radius: ${cornerRadius}px; box-shadow: ${t.shadowOffset.x}px ${t.shadowOffset.y}px ${t.shadowRadius}px ${t.shadowColor}; position: relative; overflow: hidden;"
    >
      ${headerHtml}
      ${rowsHtml}
    </div>
  `.trim()
}

function generateFormHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const fields = config.fields || [
    { label: 'Username', type: 'text', placeholder: 'Enter username' },
    { label: 'Email', type: 'email', placeholder: 'Enter email' },
    { label: 'Password', type: 'password', placeholder: 'Enter password' },
  ]
  const width = config.size?.width ?? 320
  const labelWidth = config.size?.labelWidth ?? 80
  const inputHeight = config.size?.inputHeight ?? 36
  const fieldGap = config.size?.fieldGap ?? 16
  const padding = config.size?.paddingX ?? 24
  const cornerRadius = config.size?.cornerRadius ?? 8

  const totalH = padding * 2 + fields.length * (inputHeight + fieldGap) + 48

  let fieldsHtml = ''
  let y = padding
  fields.forEach((field: any, i: number) => {
    fieldsHtml += `
      <div 
        data-name="Label-${i}"
        style="position: absolute; left: ${padding}px; top: ${y + (inputHeight - 14) / 2}px; font-size: 14px; font-weight: 500; color: ${t.textPrimary}; font-family: Inter;"
      >${field.label}</div>
      <div 
        data-name="Input-${i}"
        style="position: absolute; left: ${padding + labelWidth}px; top: ${y}px; width: ${width - padding * 2 - labelWidth}px; height: ${inputHeight}px; background-color: ${t.bgWhite}; border: 1px solid ${t.border}; border-radius: 6px; padding-left: 12px; display: flex; align-items: center; box-sizing: border-box;"
      >
        <span data-name="Placeholder-${i}" style="font-size: 14px; color: #64748B; font-family: ${t.labelFont.family};">${field.placeholder || ''}</span>
      </div>
    `
    y += inputHeight + fieldGap
  })

  const btnW = 120
  const btnH = 40

  return `
    <div 
      data-name="Form"
      style="width: ${width}px; height: ${totalH}px; background-color: ${t.bgWhite}; border-radius: ${cornerRadius}px; box-shadow: ${t.shadowOffset.x}px ${t.shadowOffset.y}px ${t.shadowRadius}px ${t.shadowColor}; position: relative; overflow: hidden;"
    >
      ${fieldsHtml}
      <section data-name="SubmitBtn" class="flex items-center justify-center" style="position: absolute; right: ${padding}px; bottom: ${padding}px; width: ${btnW}px; height: ${btnH}px; background-color: ${t.brand}; border-radius: 6px;">
        <p data-name="SubmitLabel" style="font-size: 14px; font-weight: 500; color: #FFFFFF;">${config.submitLabel || 'Submit'}</p>
      </section>
    </div>
  `.trim()
}

function generateToastHtml(config: any): string {
  const t = mergeTheme(config.theme)
  const message = config.message || 'Toast message'
  const type = config.type || 'info'
  const width = config.size?.width ?? 280
  const height = config.size?.height ?? 48
  const cornerRadius = config.size?.cornerRadius ?? 8

  const toastVariants: Record<string, { bg: string; text: string; iconColor: string }> = {
    success: { bg: '#E6F7E6', text: '#1A7D1A', iconColor: '#1A7D1A' },
    warning: { bg: '#FFF8E1', text: '#92400E', iconColor: '#92400E' },
    error: { bg: '#FFEBEE', text: '#C62828', iconColor: '#C62828' },
    info: { bg: '#E3F2FD', text: '#1565C0', iconColor: '#1565C0' },
  }

  const v = toastVariants[type] || toastVariants.info
  const iconSize = 20
  const iconX = 16

  let iconHtml = ''
  if (type === 'success') {
    iconHtml = `<svg data-name="Icon" width="${iconSize}" height="${iconSize}" viewBox="0 0 20 20" style="position: absolute; left: ${iconX}px; top: ${(height - iconSize) / 2}px;">
      <path data-name="Icon-0" d="M2 10L8 16L18 4" stroke="${v.iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`
  } else if (type === 'error') {
    iconHtml = `<svg data-name="Icon" width="${iconSize}" height="${iconSize}" viewBox="0 0 20 20" style="position: absolute; left: ${iconX}px; top: ${(height - iconSize) / 2}px;">
      <path data-name="Icon-0" d="M4 4L16 16M16 4L4 16" stroke="${v.iconColor}" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`
  } else if (type === 'warning') {
    iconHtml = `<svg data-name="Icon" width="${iconSize}" height="${iconSize}" viewBox="0 0 20 20" style="position: absolute; left: ${iconX}px; top: ${(height - iconSize) / 2}px;">
      <path data-name="Icon-0" d="M10 4V12M10 16H10.01" stroke="${v.iconColor}" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`
  } else {
    iconHtml = `<div 
      data-name="Icon"
      style="position: absolute; left: ${iconX}px; top: ${(height - iconSize) / 2}px; width: ${iconSize}px; height: ${iconSize}px; border: 2px solid ${v.iconColor}; border-radius: 50%;"
    ></div>`
  }

  return `
    <div 
      data-name="Toast-${type}"
      style="width: ${width}px; height: ${height}px; background-color: ${v.bg}; border-radius: ${cornerRadius}px; position: relative; overflow: hidden;"
    >
      ${iconHtml}
      <div 
        data-name="Description"
        style="position: absolute; left: ${iconX + iconSize + 12}px; top: ${(height - 14) / 2}px; font-size: 14px; color: ${v.text}; font-family: ${t.labelFont.family};"
      >${message}</div>
    </div>
  `.trim()
}

function generateSkeletonHtml(config: any): string {
  const variant = config.variant || 'text'
  const width = config.size?.width ?? 200
  const height = config.size?.height ?? 20
  const rows = config.rows ?? 1
  const rowGap = config.size?.rowGap ?? 8
  const cornerRadius = config.size?.cornerRadius ?? 4

  const totalH = rows * height + (rows - 1) * rowGap

  let rowsHtml = ''
  for (let i = 0; i < rows; i++) {
    const y = i * (height + rowGap)
    const rowW = variant === 'circle' ? height : width
    const rowRadius = variant === 'circle' ? height / 2 : cornerRadius

    rowsHtml += `
      <div 
        data-name="Row-${i}"
        style="position: absolute; left: 0; top: ${y}px; width: ${rowW}px; height: ${height}px; background-color: #E8E8E8; border-radius: ${rowRadius}px;"
      ></div>
    `
  }

  return `
    <div data-name="Skeleton-${variant}" style="width: ${width}px; height: ${totalH}px; position: relative;">
      ${rowsHtml}
    </div>
  `.trim()
}

function countReplacements(original: string, processed: string): number {
  const originalCount = (original.match(/data-icon/g) || []).length
  const processedCount = (processed.match(/data-icon/g) || []).length
  return originalCount - processedCount
}

function countCharts(html: string): number {
  const chartTags = html.match(/<chart[^>]*>/g) || []
  return chartTags.length
}

function countComponents(html: string): number {
  const componentTags = html.match(/<component[^>]*>/g) || []
  return componentTags.length
}