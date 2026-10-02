import { dslToCode } from '../src/utils/dsl-to-code.ts'
import type { DSLElement } from '../src/dsl-types.ts'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = join(__dirname, '..', '..', 'skills', 'design', 'rules', '09-dsl-to-code-test-samples.md')

/** 与 dslToCode 的入参形状一致（BaseElement[] 不含 children/layoutMode 等 DSL 字段） */
type SampleDocument = { version: string; elements: DSLElement[] }

const samples = {
  card: { version: '2.0', elements: [{ type: 'frame', name: 'Card', size: { width: 280, height: 180 }, fills: [{ type: 'solid', color: '#ffffff' }], effects: [{ type: 'DROP_SHADOW', radius: 16, color: '#00000020', offset: { x: 0, y: 4 }, spread: 0 }], cornerRadius: 12, children: [{ type: 'rectangle', name: 'Cover', position: { x: 20, y: 20 }, size: { width: 240, height: 80 }, fills: [{ type: 'gradient_linear', gradientStops: [{ position: 0, color: '#667eea' }, { position: 1, color: '#764ba2' }], gradientHandlePositions: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], cornerRadius: 8 }, { type: 'text', name: 'Title', content: '卡片标题', fontSize: 16, fontName: { family: 'Inter', style: 'Bold' }, fills: [{ type: 'solid', color: '#1a1a2e' }] }, { type: 'text', name: 'Desc', content: '一段卡片描述文字', fontSize: 13, fontName: { family: 'Inter', style: 'Regular' }, fills: [{ type: 'solid', color: '#666666' }] }], layoutMode: 'VERTICAL', itemSpacing: 8, paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20, clipsContent: true }] },
  button: { version: '2.0', elements: [{ type: 'frame', name: 'PrimaryButton', size: { width: 120, height: 40 }, fills: [{ type: 'solid', color: '#4340ea' }], cornerRadius: 8, layoutMode: 'HORIZONTAL', paddingLeft: 16, paddingRight: 16, children: [{ type: 'text', name: 'Label', content: 'Primary', fontSize: 14, fontName: { family: 'Inter', style: 'Bold' }, fills: [{ type: 'solid', color: '#ffffff' }], textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT' }], clipsContent: true }] },
  input: { version: '2.0', elements: [{ type: 'frame', name: 'TextInput', size: { width: 248, height: 36 }, fills: [{ type: 'solid', color: '#ffffff' }], strokes: [{ type: 'solid', color: '#d0d0d0' }], strokeWidth: 1, strokeAlign: 'INSIDE', cornerRadius: 6, layoutMode: 'HORIZONTAL', paddingLeft: 12, paddingRight: 12, children: [{ type: 'text', name: 'Placeholder', content: '请输入内容...', fontSize: 14, fontName: { family: 'Inter', style: 'Regular' }, fills: [{ type: 'solid', color: '#aaaaaa' }], textAutoResize: 'WIDTH_AND_HEIGHT' }], clipsContent: true }] },
  badge: { version: '2.0', elements: [{ type: 'frame', name: 'Badge', size: { width: 60, height: 24 }, fills: [{ type: 'solid', color: '#ff4757' }], cornerRadius: 12, layoutMode: 'HORIZONTAL', paddingLeft: 12, paddingRight: 12, children: [{ type: 'text', name: 'Label', content: 'New', fontSize: 12, fontName: { family: 'Inter', style: 'Bold' }, fills: [{ type: 'solid', color: '#ffffff' }], textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT' }], clipsContent: true }] },
  avatar: { version: '2.0', elements: [{ type: 'frame', name: 'Avatar', size: { width: 48, height: 48 }, fills: [{ type: 'solid', color: '#56ab2f' }], cornerRadius: 24, children: [{ type: 'text', name: 'Initial', content: 'U', fontSize: 20, fontName: { family: 'Inter', style: 'Bold' }, fills: [{ type: 'solid', color: '#ffffff' }], textAlignHorizontal: 'CENTER', textAlignVertical: 'CENTER' }] }] },
  toggle: { version: '2.0', elements: [{ type: 'frame', name: 'Toggle', size: { width: 44, height: 24 }, fills: [{ type: 'solid', color: '#4340ea' }], cornerRadius: 12, layoutMode: 'HORIZONTAL', paddingLeft: 3, paddingRight: 3, children: [{ type: 'ellipse', name: 'Knob', size: { width: 18, height: 18 }, fills: [{ type: 'solid', color: '#ffffff' }] }], clipsContent: true }] },
  select: { version: '2.0', elements: [{ type: 'frame', name: 'Select', size: { width: 200, height: 36 }, fills: [{ type: 'solid', color: '#ffffff' }], strokes: [{ type: 'solid', color: '#d0d0d0' }], strokeWidth: 1, strokeAlign: 'INSIDE', cornerRadius: 6, layoutMode: 'HORIZONTAL', paddingLeft: 12, paddingRight: 8, children: [{ type: 'text', name: 'Placeholder', content: '请选择', fontSize: 14, fontName: { family: 'Inter', style: 'Regular' }, fills: [{ type: 'solid', color: '#aaaaaa' }], flexGrow: 1 }, { type: 'text', name: 'Arrow', content: '▼', fontSize: 10, fills: [{ type: 'solid', color: '#888888' }] }], clipsContent: true }] },
} satisfies Record<string, SampleDocument>

let report = '# dsl-to-code 测试样本报告\n\n'
report += `生成日期: ${new Date().toISOString().slice(0, 10)}\n`
report += '样本来源: MasterGo 画布实时渲染 + DSL 导出\n\n'

report += `| 样本 | 元素数 | 组件 | 文本 | 输出状态 | 特性覆盖 |\n`
report += `|------|--------|------|------|----------|----------|\n`

for (const [name, dsl] of Object.entries(samples)) {
  const result = await dslToCode(dsl, { includeDataAttributes: false })
  const stats = result.stats
  const warnings = result.warnings.length > 0 ? result.warnings.join('; ') : '全部覆盖'
  report += `| ${name} | ${stats.elementsConverted} | ${stats.componentsDetected} | ${stats.textNodes} | ✅ | ${warnings} |\n`
}

report += '\n## 各样本输出\n\n'

for (const [name, dsl] of Object.entries(samples)) {
  const result = await dslToCode(dsl, { includeDataAttributes: false })
  report += `### ${name}\n\n`
  report += '```html\n' + result.html + '\n```\n\n'
  if (result.warnings.length > 0) {
    report += `> ⚠️ 警告: ${result.warnings.join(', ')}\n\n`
  }
}

mkdirSync(dirname(OUT_PATH), { recursive: true })
writeFileSync(OUT_PATH, report)
console.log(`Report written to ${OUT_PATH}`)
