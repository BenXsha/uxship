/**
 * HTML → SVG 转换器
 *
 * 将预处理后的 HTML+Tailwind 包裹为 SVG+foreignObject，
 * 供插件端通过 createNodeFromSvgAsync 导入。
 *
 * foreignObject 是 SVG 标准标签，允许在 SVG 中嵌入 HTML，
 * MasterGo 的 createNodeFromSvgAsync 会解析它并转换为原生节点。
 */

export interface HtmlToSvgOptions {
  width?: number
  height?: number
  /** SVG 中嵌入原始 HTML 时是否通过 foreignObject */
  useForeignObject?: boolean
}

/**
 * 将 HTML+Tailwind 转换为 SVG 字符串
 * 默认使用 foreignObject 方式嵌入 HTML
 */
export function htmlToSvg(html: string, options: HtmlToSvgOptions = {}): string {
  const useForeignObject = options.useForeignObject !== false

  // 解析 HTML 结构以估算尺寸
  const width = options.width || estimateWidth(html) || 1440
  const height = options.height || 800

  if (useForeignObject) {
    return buildForeignObjectSvg(html, width, height)
  }

  // 未来可扩展为纯 SVG 元素转换（无需 foreignObject）
  return buildForeignObjectSvg(html, width, height)
}

/**
 * 用 SVG+foreignObject 包裹 HTML
 * MasterGo 的 createNodeFromSvgAsync 收到后解析 foreignObject 内的 HTML，
 * 提取每个元素的几何/样式，转换为原生 MasterGo 节点。
 */
function buildForeignObjectSvg(html: string, width: number, height: number): string {
  // 对 HTML 进行 XML 转义（foreignObject 内需要合法的 XML）
  const escapedHtml = escapeXml(html)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <foreignObject width="100%" height="100%" x="0" y="0">`,
    `    ${escapedHtml}`,
    `  </foreignObject>`,
    `</svg>`,
  ].join('\n')
}

/**
 * 从 HTML 中估算合适的 SVG 宽度
 * 查找最外层容器的 Tailwind 宽度类
 */
function estimateWidth(html: string): number {
  // 匹配 w-[数字]px 或 w-数字
  const widthMatch = html.match(/w-\[(\d+)px\]/)
  if (widthMatch) return parseInt(widthMatch[1], 10)
  return 1440
}

/**
 * XML 转义（foreignObject 内容必须是合法 XML）
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 获取完整的 DSL 文档（用于现有的 dsl/render 通道） */
export function buildSvgDslDocument(html: string, options: HtmlToSvgOptions = {}) {
  const svgContent = htmlToSvg(html, options)
  return {
    version: '2.0',
    elements: [
      {
        type: 'svg' as const,
        name: 'svg-import',
        svgContent,
        size: {
          width: options.width || estimateWidth(html) || 1440,
          height: options.height || 800,
        },
      },
    ],
  }
}
