/**
 * DSL → HTML+Tailwind 转换 CLI
 *
 * 用法:
 *   node scripts/convert-to-code.mjs <input.json> [output.html]
 *
 * 示例:
 *   node scripts/convert-to-code.mjs dsl.json output.html
 *   node scripts/convert-to-code.mjs dsl.json              # 输出到 input.coverd.html 同目录
 *
 * 说明:
 *   - input.json 应包含 { version, elements } 格式的 DSL（由 dsl_exportNode 或 dsl_exportSelection 导出）
 *   - 自动清理导出冗余字段（isLocked, removed, expanded 等），只保留转换器需要的字段
 *   - 输出为 HTML+Tailwind 代码，不含 html/head/body 包装，适合直接嵌入
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname, basename, extname, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

// ============== 字段白名单 ==============
// 只保留转换器实际用到的 DSL 字段，其余全部剥离
const ALLOWED_FIELDS = new Set([
  'type', 'name', 'id', 'position', 'size', 'rotation',
  'fills', 'strokes', 'strokeWidth', 'strokeAlign', 'strokeCap', 'strokeJoin',
  'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
  'opacity', 'effects', 'constraints', 'blendMode',
  'layoutMode', 'itemSpacing', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'clipsContent', 'primaryAxisAlignItems', 'counterAxisAlignItems',
  'primaryAxisSizingMode', 'counterAxisSizingMode',
  'flexWrap', 'crossAxisSpacing', 'primaryAxisAlignContent', 'counterAxisAlignContent',
  'flexGrow', 'layoutPositioning', 'layoutSizingHorizontal', 'layoutSizingVertical',
  'alignSelf', 'layoutAlign',
  'characters', 'content', 'fontSize', 'fontWeight', 'fontName',
  'textAlignHorizontal', 'textAlignVertical', 'textAutoResize',
  'lineHeight', 'letterSpacing', 'textDecoration', 'textCase', 'paragraphSpacing',
  'isVisible', 'isLocked', 'pointCount', 'innerRadius',
  'booleanOperation', 'svgPathData', 'pathData', 'svgContent', 'chartOption',
  'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'isClosed', 'windingRule', 'cornerSmooth',
  'imageRef', 'imageScaleMode', 'imageData', 'imageRatio', 'scaleMode', 'ratio',
  'children',
])

function cleanElement(el) {
  if (!el || typeof el !== 'object') return el
  const out = {}
  for (const [k, v] of Object.entries(el)) {
    if (ALLOWED_FIELDS.has(k)) {
      out[k] = k === 'children' && Array.isArray(v) ? v.map(cleanElement) : v
    }
  }
  return out
}

// ============== 主逻辑 ==============

async function main() {
  const args = process.argv.slice(2)
  if (args.length < 1) {
    console.error('用法: node scripts/convert-to-code.mjs <input.json> [output.html]')
    process.exit(1)
  }

  const inputPath = resolve(process.cwd(), args[0])
  if (!existsSync(inputPath)) {
    console.error(`错误: 文件不存在: ${inputPath}`)
    process.exit(1)
  }

  // 确定输出路径
  let outputPath = args[1]
  if (!outputPath) {
    const base = basename(inputPath, extname(inputPath))
    outputPath = join(dirname(inputPath), `${base}.coverd.html`)
  } else {
    outputPath = resolve(process.cwd(), outputPath)
  }

  // 读 DSL
  let raw
  try {
    raw = JSON.parse(readFileSync(inputPath, 'utf-8'))
  } catch (e) {
    console.error(`错误: JSON 解析失败: ${e.message}`)
    process.exit(1)
  }

  if (!raw.elements || !Array.isArray(raw.elements)) {
    console.error('错误: DSL 缺少 elements 数组')
    process.exit(1)
  }

  // 清理
  const dsl = { version: raw.version || '2.0', elements: raw.elements.map(cleanElement) }
  console.log(`DSL 加载: ${dsl.elements.length} 个根元素`)

  // 导入转换器并执行（使用 Node 内置的 pathToFileURL，跨平台安全）
  const converterPath = join(projectRoot, 'dist', 'utils', 'dsl-to-code.js')
  const { dslToCode } = await import(pathToFileURL(converterPath).href)

  const result = await dslToCode(dsl, {
    indent: 2,
    useSemanticTags: true,
    includeDataAttributes: false,
  })

  // 写入
  writeFileSync(outputPath, result.html, 'utf-8')

  // 打印统计
  console.log(`\n输出: ${outputPath}`)
  console.log(`大小: ${result.html.length} bytes`)
  console.log(`圆角: ${(result.html.match(/rounded-/g) || []).length}`)
  console.log(`阴影: ${(result.html.match(/shadow-\[/g) || []).length}`)
  console.log(`类型: ${result.stats.elementsConverted} 元素 (${result.stats.textNodes} text, ${result.stats.frames} frame)`)

  if (result.warnings.length > 0) {
    console.log(`\n警告 (${result.warnings.length}):`)
    result.warnings.forEach(w => console.log(`  - ${w}`))
  }

  process.exit(0)
}

main().catch(err => {
  console.error('转换失败:', err)
  process.exit(1)
})
