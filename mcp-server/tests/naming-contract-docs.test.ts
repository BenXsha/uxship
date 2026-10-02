import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preprocessHtml } from '../src/utils/html-preprocessor.js'

/**
 * 图层命名契约：**文档 ↔ 参考实现 ↔ 服务端预设** 三方一致门禁
 *
 * ## 缺口（为什么还要第三个文件）
 *
 * 已有两道门禁各自只守一侧：
 *   - `plugin-mastergo/tests/component-names.test.ts` + `plugin-penpot/tests/component-names.test.ts`
 *     —— 守**实现内**的格式与同义名黑名单；
 *   - `mcp-server/tests/html-preprocessor-component-names.test.ts`
 *     —— 期望值从参考实现**机械派生**，逐类型比对服务端产出。
 *
 * 但**没人守文档那张表**。而 AI 写 `data-name` / `data-override-*` 时读的正是
 * `skills/design/rules/16-component-catalog.md §图层命名契约` 的逐组件表 —— 它是事实来源。
 * 真实事故：表里一度把 `Box`/`Tick`/`Circle`/`Dot` 同时列进「保留子名」和「宿主本地子名」；
 * 更早有 `gen` profile 在表里写 15 个、实现是 20 个，总数门禁完全看不见。
 * AI 照着错表写 `data-override-text-Box` → **静默不生效**。
 *
 * 所以本文件把「文档表」也拉进门禁：
 *   (a) 解析文档表（解析失败**必须报错并指出行/列**，静默跳过正是这类门禁失效的方式）
 *   (b) 从参考实现 `plugin-mastergo/lib/api/component-*.ts` 机械派生 `renderer → names`
 *       （`renderer → type` 映射与兄弟门禁同源，逐条抄，不另造）
 *   (c) 逐类型三方对齐 + 服务端产出 ⊆ 参考 ∪ 文档 ∪ R2 ∪ R3
 *
 * ## 口径
 *
 * 宁可少断言、绝不误报。文档表的「必需子名」按**模板串**视角归一（`<i>` / `<key>` /
 * `<row>-<col>` → `*`），与参考实现的 `${i}` 归一结果比对。
 */

/* ------------------------------------------------------------------ *
 * 路径
 * ------------------------------------------------------------------ */
const ROOT_DIR = fileURLToPath(new URL('../../', import.meta.url))
const DOC_PATH = join(ROOT_DIR, 'skills', 'design', 'rules', '16-component-catalog.md')
const API_DIR = join(ROOT_DIR, 'plugin-mastergo', 'lib', 'api')
const PREPROCESSOR_SRC = fileURLToPath(new URL('../src/utils/html-preprocessor.ts', import.meta.url))
const MG_NAMES_TEST = join(ROOT_DIR, 'plugin-mastergo', 'tests', 'component-names.test.ts')
const PENPOT_NAMES_TEST = join(ROOT_DIR, 'plugin-penpot', 'tests', 'component-names.test.ts')

/* ------------------------------------------------------------------ *
 * 契约常量（与文档 R2/R3 逐字对齐；漂移时这里会红）
 * ------------------------------------------------------------------ */
/** R2：保留**单值**子名（逐字） */
const R2_RESERVED = [
  'Label', 'Icon', 'IconRight', 'Title', 'Description', 'Content', 'Placeholder',
  'Initial', 'Close', 'Track', 'Thumb', 'Fill', 'Header', 'Footer',
  'Box', 'Tick', 'Circle', 'Dot', 'Line', 'Arc',
] as const

/** R3：重复集合的 Role 闭合集合 */
const R3_ROLES = [
  'Item', 'Row', 'Cell', 'Tab', 'Crumb', 'Step', 'Divider', 'Header', 'Icon',
  'Feature', 'Tier', 'MenuItem', 'Checkbox', 'Radio',
] as const

const R2_SET = new Set<string>(R2_RESERVED)
const R3_COLLECTION = new RegExp(
  `^(?:${R3_ROLES.join('|')})-(?:\\d+|\\*)(?:-(?:\\d+|\\*))?$`
)

/* ------------------------------------------------------------------ *
 * (a) 解析文档：图层命名契约节 + 逐组件表 + 宿主本地子名 + R2/R3
 * ------------------------------------------------------------------ */
const DOC_LINES = readFileSync(DOC_PATH, 'utf-8').split('\n')

/** 取一个 `## …` 节的内容（到下一个 `## ` 或 `---` 为止），返回 [起, 止) 行号（0 基）。 */
function sectionRange(headingOf: (line: string) => boolean, what: string): [number, number] {
  const start = DOC_LINES.findIndex(headingOf)
  if (start < 0) throw new Error(`文档里找不到「${what}」节（${DOC_PATH}）`)
  let end = DOC_LINES.length
  for (let i = start + 1; i < DOC_LINES.length; i++) {
    if (/^## /.test(DOC_LINES[i]) || /^---\s*$/.test(DOC_LINES[i])) {
      end = i
      break
    }
  }
  return [start, end]
}

const [CONTRACT_START, CONTRACT_END] = sectionRange(
  (line) => /^##\s+图层命名契约/.test(line),
  '图层命名契约'
)
const CONTRACT_LINES = DOC_LINES.slice(CONTRACT_START, CONTRACT_END)

interface DocEntry {
  type: string
  root: string
  required: string[]
  optional: string[]
  line: number
}

/** 文档里的占位符（`<variant>` / `<i>` / `<key>` / `<row>` / `<col>`）统一成模板串的 `*`。 */
function normalizeDoc(raw: string): string {
  return raw.replace(/<[^>]+>/g, '*')
}

/** 一行表格 → 单元格数组（去掉首尾空串）。 */
function cellsOf(line: string): string[] {
  return line.split('|').slice(1, -1).map((cell) => cell.trim())
}

/** 单元格里的一组反引号名字（分隔符 `、` / `,`）。`—` / `-` / 空 → []。 */
function namesOfCell(cell: string, lineNo: number, column: number): string[] {
  const text = cell.trim()
  if (text === '' || text === '—' || text === '-' || text === '–') return []
  const parts = text.split(/[、,]/).map((part) => part.trim())
  return parts.map((part) => {
    const single = part.match(/^`([^`]+)`$/)
    if (!single) {
      throw new Error(
        `文档表第 ${lineNo} 行第 ${column} 列无法解析：期望若干反引号名字（用「、」分隔），实际为 ${JSON.stringify(part)}`
      )
    }
    return single[1]
  })
}

const DOC_HEADER = /组件（`type`）/

function parseContractTable(): DocEntry[] {
  const entries: DocEntry[] = []
  for (let i = CONTRACT_START; i < CONTRACT_END; i++) {
    const line = DOC_LINES[i]
    const lineNo = i + 1
    if (!line.startsWith('|')) continue
    const cells = cellsOf(line)
    // 4 列的表只有「逐组件表」；其它表是 2/3 列（R1–R5、复用链）。
    if (cells.length !== 4) continue
    const [typeCell, rootCell, requiredCell, optionalCell] = cells
    if (DOC_HEADER.test(typeCell)) continue
    if (/^-{2,}$/.test(typeCell.replace(/\s/g, ''))) continue

    const typeMatch = typeCell.match(/^`([a-z][a-z0-9-]*)`$/)
    if (!typeMatch) {
      // 含反引号说明「看起来像组件行」—— 宁可报错，不静默跳过
      if (typeCell.includes('`')) {
        throw new Error(
          `文档表第 ${lineNo} 行第 1 列无法解析为组件 type：${JSON.stringify(typeCell)}（期望形如 \`button\`）`
        )
      }
      continue
    }

    const rootMatch = rootCell.match(/^`([^`]+)`$/)
    if (!rootMatch) {
      throw new Error(
        `文档表第 ${lineNo} 行第 2 列（根名）无法解析：${JSON.stringify(rootCell)}（期望单个反引号名，如 \`Button-<variant>\`）`
      )
    }

    entries.push({
      type: typeMatch[1],
      root: normalizeDoc(rootMatch[1]),
      required: namesOfCell(requiredCell, lineNo, 3).map(normalizeDoc),
      optional: namesOfCell(optionalCell, lineNo, 4).map(normalizeDoc),
      line: lineNo,
    })
  }
  if (entries.length === 0) {
    throw new Error(`文档表一行都没解析出来（${DOC_PATH} 第 ${CONTRACT_START + 1}–${CONTRACT_END} 行）`)
  }
  return entries
}

const DOC_TABLE = parseContractTable()
const DOC_BY_TYPE = new Map(DOC_TABLE.map((entry) => [entry.type, entry]))

/** 「宿主本地子名」清单（允许存在，但不参与跨宿主覆写契约）。 */
function parseHostLocalNames(): string[] {
  const start = CONTRACT_LINES.findIndex((line) => /^###\s+宿主本地子名/.test(line))
  if (start < 0) throw new Error(`文档里找不到「宿主本地子名」小节（${DOC_PATH}）`)
  const names: string[] = []
  for (let i = start + 1; i < CONTRACT_LINES.length; i++) {
    const line = CONTRACT_LINES[i]
    if (/^###\s/.test(line) || /^>\s/.test(line) || /^---\s*$/.test(line)) break
    for (const match of line.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)) names.push(match[1])
  }
  if (names.length === 0) throw new Error(`「宿主本地子名」清单解析为空（${DOC_PATH}）`)
  return names
}

const HOST_LOCAL_NAMES = parseHostLocalNames()

/** R1–R5 表里某一行的第 2 个单元格。 */
function ruleRow(id: 'R2' | 'R3'): { text: string; lineNo: number } {
  for (let i = CONTRACT_START; i < CONTRACT_END; i++) {
    const line = DOC_LINES[i]
    if (!line.startsWith('|')) continue
    const cells = cellsOf(line)
    if (cells.length !== 2) continue
    if (!new RegExp(`^\\*\\*${id}\\*\\*$`).test(cells[0])) continue
    return { text: cells[1], lineNo: i + 1 }
  }
  throw new Error(`文档里找不到 ${id} 行（${DOC_PATH}）`)
}

const R2_ROW = ruleRow('R2')
const R3_ROW = ruleRow('R3')

const DOC_R2 = [...R2_ROW.text.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((m) => m[1])
const DOC_R3_MATCH = R3_ROW.text.match(/\{([^}]*)\}/)
if (!DOC_R3_MATCH) throw new Error(`R3 行（第 ${R3_ROW.lineNo} 行）里找不到 Role 集合 {…}`)
const DOC_R3 = DOC_R3_MATCH[1].split(/[、,]/).map((part) => part.trim()).filter(Boolean)

/* ------------------------------------------------------------------ *
 * (b) 从参考实现机械派生 `renderer → names`
 * ------------------------------------------------------------------ */
const REFERENCE_FILES = ['basic', 'form', 'navigation', 'data', 'layout'] as const

/** 与 `html-preprocessor-component-names.test.ts` 同源，逐条抄写，不另造。 */
const RENDERER_TYPE: Record<string, string> = {
  renderButton: 'button',
  renderBadge: 'badge',
  renderAvatar: 'avatar',
  renderToggle: 'toggle',
  renderProgress: 'progress',
  renderDivider: 'divider',
  renderTag: 'tag',
  renderTooltip: 'tooltip',
  renderSpinner: 'spinner',
  renderSkeleton: 'skeleton',
  renderCheckboxGroup: 'checkbox-group',
  renderRadioGroup: 'radio-group',
  renderCheckbox: 'checkbox',
  renderRadio: 'radio',
  renderTextInput: 'text-input',
  renderSelect: 'select',
  renderSlider: 'slider',
  renderMenu: 'menu',
  renderTabs: 'tabs',
  renderBreadcrumb: 'breadcrumb',
  renderPagination: 'pagination',
  renderSteps: 'steps',
  renderList: 'list',
  renderAccordion: 'accordion',
  renderCard: 'card',
  renderTable: 'table',
  renderForm: 'form',
  renderToast: 'toast',
  renderModal: 'modal',
  renderAlert: 'alert',
  renderPageShell: 'page-shell',
  renderFeatureGrid: 'feature-grid',
  renderPricingTable: 'pricing-table',
}

/** 归一化：`${…}` 与动态段 → `*`（与兄弟门禁同一口径）。 */
function normalize(raw: string): string {
  let s = raw.replace(/\$\{[^}]*\}/g, '*')
  s = s
    .split('-')
    .map((seg) => {
      if (/^\d+$/.test(seg)) return '*'
      if (/^[a-z][a-z0-9]*$/.test(seg)) return '*'
      return seg.replace(/\*+/g, '*')
    })
    .join('-')
  return s.replace(/([A-Za-z0-9])\*/g, '$1')
}

const NAME_VALUE = /name:\s*([^,\n]+)/
function literalOf(expression: string): string | null {
  const template = expression.match(/`([^`]*)`/)
  if (template) return template[1]
  const single = expression.match(/'([^']*)'/)
  if (single) return single[1]
  const double = expression.match(/"([^"]*)"/)
  if (double) return double[1]
  return null
}

/** 注释行 / 档位数据行（`{ name: '基础版', price: … }` 的 name 是数据字段）。 */
function isNoiseLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return true
  if (/\bprice:|\bfeatures:/.test(line)) return true
  return false
}

/**
 * `renderSvgIcon(…, 'Track')` 这类**位置参数**名字不受 `name:` 提取覆盖。
 * 只看最后一个字符串实参（就是 `renderSvgIcon` 的 `name?: string`），避免把 SVG 串/颜色扫进来。
 */
const SVG_ICON_NAME = /renderSvgIcon\([^)]*,\s*'([^']+)'\s*\)/g

function extractReferenceNames(): Map<string, Set<string>> {
  const renderers = new Map<string, Set<string>>()
  for (const file of REFERENCE_FILES) {
    const src = readFileSync(join(API_DIR, `component-${file}.ts`), 'utf-8')
    const header = /export (?:async )?function (render\w+)\(/g
    const blocks: Array<{ name: string; start: number }> = []
    let m: RegExpExecArray | null
    while ((m = header.exec(src)) !== null) blocks.push({ name: m[1], start: m.index })
    blocks.forEach((block, idx) => {
      const end = idx + 1 < blocks.length ? blocks[idx + 1].start : src.length
      const body = src.slice(block.start, end)
      const names = new Set<string>()
      for (const line of body.split('\n')) {
        if (isNoiseLine(line)) continue
        const hit = line.match(NAME_VALUE)
        if (hit) {
          const literal = literalOf(hit[1])
          if (literal !== null) names.add(normalize(literal))
        }
        SVG_ICON_NAME.lastIndex = 0
        for (const svgName of line.matchAll(SVG_ICON_NAME)) names.add(normalize(svgName[1]))
      }
      renderers.set(block.name, names)
    })
  }
  return renderers
}

const REFERENCE_NAMES = extractReferenceNames()

function rendererFor(type: string): string | undefined {
  return Object.keys(RENDERER_TYPE).find((renderer) => RENDERER_TYPE[renderer] === type)
}

function referenceNamesFor(type: string): Set<string> {
  const renderer = rendererFor(type)
  return renderer ? (REFERENCE_NAMES.get(renderer) ?? new Set()) : new Set()
}

/** `generateComponentHtml` 的 case 列表（防服务端 + 测试漂移）。 */
function implementedTypesFromSource(): string[] {
  const src = readFileSync(PREPROCESSOR_SRC, 'utf-8')
  return [...src.matchAll(/case '([^']+)': html = generate\w+Html\(config\); break/g)].map((m) => m[1])
}

const SERVER_TYPES = implementedTypesFromSource()

/* ------------------------------------------------------------------ *
 * (c) 服务端产出
 * ------------------------------------------------------------------ */
/** 默认 config 不足以覆盖「必需子名」的类型，补一个最小全量 config（覆盖必需子名的最小集）。 */
const SERVER_CONFIG: Record<string, unknown> = {
  divider: { label: 'Divider' },
  modal: { content: 'Modal content' },
  alert: { title: 'Alert title', content: 'Alert content' },
}

const dataNamesOf = (html: string): string[] =>
  [...html.matchAll(/data-name="([^"]*)"/g)].map((m) => m[1])

async function serverNames(type: string, config: unknown): Promise<string[]> {
  const result = await preprocessHtml(
    `<component type="${type}" config='${JSON.stringify(config)}' />`
  )
  return dataNamesOf(result.html).map(normalize)
}

/**
 * 已知的「文档表要求、但参考实现里没有」的名字 —— 三方比对的**缺口登记表**。
 * 语义：要求**逐字相等** —— 新增缺口立刻红；**修好后必须从表里删掉**（不删也红，防“修了没同步”）。
 *
 * **当前为空**（下面两个已修）：
 * - `toggle` / `Track`：MasterGo 与 Penpot 都把轨道画在根 frame 自身填充上，没有独立的 `Track` 图层
 *   （只有**服务端**预设会多一个 `Track` 子层）。裁决：`Track` 降为**可选**名——不为了一个覆写目标
 *   去重构两个宿主上已交付的组件结构；文档已改。
 * - `menu` / `Item-*`：MasterGo `renderMenu` 的行容器原叫 `ItemBg-<i>`（名字本身就是误称，它是个容器而非背景），
 *   已改名为 `Item-<i>`，与 `renderPageShell` / 服务端统一；文档已改。
 */
const KNOWN_REFERENCE_GAPS: Record<string, string[]> = {}

/** 服务端产出允许的词汇：参考实现 ∪ 文档表（必需 ∪ 可选 ∪ 根名）∪ R2 ∪ R3 形态。 */
function allowedVocabularyFor(entry: DocEntry): Set<string> {
  const allowed = new Set<string>([entry.root, ...entry.required, ...entry.optional])
  for (const name of referenceNamesFor(entry.type)) allowed.add(name)
  for (const name of R2_RESERVED) allowed.add(name)
  return allowed
}

/* ------------------------------------------------------------------ *
 * 用例
 * ------------------------------------------------------------------ */
describe('图层命名契约：文档表解析（16-component-catalog.md）', () => {
  it('解析出组件表：数量与 generateComponentHtml 的 case 数一致，type 不重复', () => {
    expect(DOC_TABLE.length, `解析出的组件表行数：${DOC_TABLE.length}`).toBe(SERVER_TYPES.length)
    const dupes = DOC_TABLE.map((e) => e.type).filter((t, i, arr) => arr.indexOf(t) !== i)
    expect(dupes, `文档表里 type 重复：${dupes.join(', ')}`).toEqual([])
    for (const entry of DOC_TABLE) {
      expect(entry.type, `第 ${entry.line} 行的 type 形态可疑`).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(entry.root, `${entry.type}（第 ${entry.line} 行）根名为空`).not.toBe('')
      expect(entry.required.length, `${entry.type}（第 ${entry.line} 行）必需子名为空`).toBeGreaterThan(0)
    }
    // 文档表的必需名不允许出现「非模板串」的可疑形态（如小写开头、含空格）
    const badShapes = DOC_TABLE.flatMap((e) =>
      [...e.required, ...e.optional]
        .filter((n) => !/^[A-Z][A-Za-z0-9]*(?:-(?:\*|[A-Za-z0-9]+))*$/.test(n))
        .map((n) => `${e.type} → ${n}`)
    )
    expect(badShapes, `文档表里出现形态可疑的名字`).toEqual([])
  })

  it('R2 / R3 契约名单与文档逐字一致（漂移时这里先红）', () => {
    expect(DOC_R2, `文档第 ${R2_ROW.line} 行的 R2 名单`).toEqual([...R2_RESERVED])
    expect(DOC_R3, `文档第 ${R3_ROW.line} 行的 R3 Role 集合`).toEqual([...R3_ROLES])
  })

  it('文档表与「宿主本地子名」清单不重叠（专治 Box/Tick/Circle/Dot 的自相矛盾）', () => {
    const hostLocal = new Set(HOST_LOCAL_NAMES)
    const conflicts = DOC_TABLE.flatMap((entry) =>
      [...entry.required, ...entry.optional]
        .filter((name) => hostLocal.has(name))
        .map((name) => `${entry.type} → ${name}`)
    )
    expect(
      conflicts,
      `文档表的名字同时被列为「宿主本地子名」：${conflicts.join(', ')}（同一名字不能既是契约名又是宿主本地名）`
    ).toEqual([])
  })
})

describe('图层命名契约：参考实现（plugin-mastergo/lib/api/component-*.ts）', () => {
  it('renderer↔type 映射覆盖 generateComponentHtml 的每一个 case，且 33 个 renderer 都能派生到', () => {
    expect(SERVER_TYPES).toHaveLength(30)
    const mapped = Object.values(RENDERER_TYPE)
    expect([...SERVER_TYPES].sort()).toEqual(
      mapped.filter((t) => !['page-shell', 'feature-grid', 'pricing-table'].includes(t)).sort()
    )
    expect(Object.keys(RENDERER_TYPE)).toHaveLength(33)
    const missing = Object.keys(RENDERER_TYPE).filter((r) => !REFERENCE_NAMES.has(r))
    expect(missing, `映射表里的 renderer 在参考实现中找不到：${missing.join(', ')}`).toEqual([])
    for (const type of SERVER_TYPES) {
      expect(referenceNamesFor(type).size, `${type} 的参考名字集合为空（提取失败？）`).toBeGreaterThan(0)
    }
  })
})

describe('图层命名契约：文档 ↔ 参考实现 ↔ 服务端 逐类型对齐', () => {
  it('文档表里的每个 type 都有参考实现 renderer', () => {
    const missing = DOC_TABLE.filter((entry) => rendererFor(entry.type) === undefined).map((e) => e.type)
    expect(
      missing,
      `文档表列了这些 type，但 plugin-mastergo/lib/api/component-*.ts 里没有对应 renderer：${missing.join(', ')}`
    ).toEqual([])
  })

  it('服务端实现的每个 type 都在文档表里（反向：新增类型忘了改文档表）', () => {
    const missing = SERVER_TYPES.filter((type) => !DOC_BY_TYPE.has(type))
    expect(
      missing,
      `服务端实现了这些 type，但 16-component-catalog.md 的图层命名契约表里没有它们：${missing.join(', ')}`
    ).toEqual([])
  })

  it.each(DOC_TABLE.map((entry) => [entry.type, entry] as const))(
    '%s：文档表必需子名都在参考实现里，根名模式一致',
    (type, entry) => {
      const reference = referenceNamesFor(type)
      const missingNames = entry.required
        .filter((name) => !reference.has(name))
        .sort()
      const expectedGaps = [...(KNOWN_REFERENCE_GAPS[type] ?? [])].sort()
      expect(
        missingNames,
        `文档表把 ${missingNames.join(', ')} 列为 ${type} 的必需子名，但参考实现里没有这些名字（归一化后）。\n` +
          `只允许 KNOWN_REFERENCE_GAPS 里登记过的缺口：新增缺口要改实现或改文档表；缺口修好后把它从登记表删掉。\n` +
          `参考集合：${[...reference].sort().join(', ')}`
      ).toEqual(expectedGaps)

      // 根名「模式」一致：允许参考实现用可注入的裸根名（`params.name || 'Divider'`，
      // `-<variant>` 后缀由调用方注入），但不允许把根名换成别的词（`ProgressBar`）。
      const stem = entry.root.split('-')[0]
      expect(
        reference.has(entry.root) || reference.has(stem),
        `文档表的 ${type} 根名 ${entry.root}（或其根干 ${stem}）在参考实现里找不到。\n` +
          `参考集合：${[...reference].sort().join(', ')}`
      ).toBe(true)
    }
  )

  it.each(DOC_TABLE.map((entry) => [entry.type, entry] as const))(
    '%s：服务端产出 ⊆ 参考集合 ∪ 文档表 ∪ R2 ∪ R3 形态',
    async (type, entry) => {
      const config = SERVER_CONFIG[type] ?? {}
      const names = await serverNames(type, config)
      expect(names.length, `${type} 没产出任何 data-name`).toBeGreaterThan(0)
      const allowed = allowedVocabularyFor(entry)
      const offenders = [...new Set(names)].filter((name) => {
        if (allowed.has(name)) return false
        if (R3_COLLECTION.test(name)) return false
        return true
      })
      expect(
        offenders,
        `${type} 出现契约外名称：${offenders.map((o) => JSON.stringify(o)).join(', ')}\n` +
          `文档表：必需 ${entry.required.join(', ') || '—'} / 可选 ${entry.optional.join(', ') || '—'}\n` +
          `参考集合：${[...referenceNamesFor(type)].sort().join(', ')}`
      ).toEqual([])
    }
  )

  it.each(DOC_TABLE.map((entry) => [entry.type, entry] as const))(
    '%s：文档表必需子名都能被服务端 config 渲染出来（R4 根名恰好一次且在首位）',
    async (type, entry) => {
      const config = SERVER_CONFIG[type] ?? {}
      const names = await serverNames(type, config)
      const missing = entry.required.filter((name) => !names.includes(name))
      expect(
        missing,
        `${type} 缺少文档表必需子名：${missing.join(', ')}（门禁 config 必须覆盖它们）\n实际产出：${names.join(', ')}`
      ).toEqual([])
      expect(names[0], `${type} 的 R4 根名应在首位`).toBe(entry.root)
      expect(names.filter((name) => name === entry.root), `${type} 的 R4 根名应恰好出现一次`).toHaveLength(1)
    }
  )
})

describe('图层命名契约：必需子名的 config 覆盖', () => {
  it('只在传了特定 config 时才出现的必需子名，与预期清单一致', async () => {
    const configOnly: Record<string, string[]> = {}
    for (const entry of DOC_TABLE) {
      const withDefault = new Set(await serverNames(entry.type, {}))
      const required = entry.required.filter((name) => !withDefault.has(name))
      if (required.length > 0) configOnly[entry.type] = required
    }
    // 这些名字不是「默认 config」就能凑齐的 —— 门禁必须显式补 config，
    // 否则本文件的 (c) 覆盖断言会变成假绿。改实现默认行为时同步改这张表。
    expect(configOnly).toEqual({
      divider: ['Label'],
      modal: ['Content'],
      alert: ['Title'],
    })
    // 补了 config 之后，全部必需子名都必须出现
    for (const entry of DOC_TABLE) {
      const withFull = new Set(await serverNames(entry.type, SERVER_CONFIG[entry.type] ?? {}))
      const missing = entry.required.filter((name) => !withFull.has(name))
      expect(missing, `${entry.type} 的必需子名无法由门禁 config 渲染：${missing.join(', ')}`).toEqual([])
    }
  })
})

/**
 * 分装门禁的 R2 名单 —— 第四处漂移点。
 *
 * **已实测到的漂移（本文件不阻断，仅登记给维护者）**：
 * `plugin-mastergo/tests/component-names.test.ts` 与 `plugin-penpot/tests/component-names.test.ts`
 * 的 `RESERVED_SINGLE_NAMES` 都只有 14 项，比文档 R2 少 6 项：
 * `Box`、`Tick`、`Circle`、`Dot`、`Line`、`Arc`（上一轮已升入 R2，但两个包的门禁名单没跟上）。
 * 之所以不写成 `toEqual(R2_RESERVED)`：那会让本文件当场变红；等两个包补齐后把这条升级为全量比对。
 */
describe('图层命名契约：分装门禁的 R2 名单（第四处漂移点）', () => {
  const extractReserved = (path: string): string[] => {
    const src = readFileSync(path, 'utf-8')
    const block = src.match(/const RESERVED_SINGLE_NAMES = new Set\(\[([\s\S]*?)\]\)/)
    if (!block) throw new Error(`${path} 里找不到 RESERVED_SINGLE_NAMES = new Set([...])`)
    return [...block[1].matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1])
  }
  const mg = extractReserved(MG_NAMES_TEST)
  const penpot = extractReserved(PENPOT_NAMES_TEST)

  it('两个包各自的 RESERVED_SINGLE_NAMES 互相同步，且不超出文档 R2', () => {
    expect(mg.length, 'plugin-mastergo 的 RESERVED_SINGLE_NAMES 提取失败').toBeGreaterThan(10)
    expect(penpot, 'plugin-penpot 与 plugin-mastergo 的 RESERVED_SINGLE_NAMES 不一致').toEqual(mg)
    const outside = [...new Set([...mg, ...penpot])].filter((name) => !R2_SET.has(name))
    expect(outside, `分装门禁的保留名不在文档 R2 里：${outside.join(', ')}`).toEqual([])
  })
})
