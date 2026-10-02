import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preprocessHtml } from '../src/utils/html-preprocessor.js'

/**
 * `<component>` 展开后的图层名契约门禁（R1–R4）
 *
 * ## 为什么需要
 *
 * 整条「组件复用」链**按图层名查找，不按 id**：
 *   - 实例子节点覆写：`plugin-mastergo/lib/api/dsl-renderer.ts` → `instance.findOne(n => n.name === childName)`
 *   - 换组件继承覆写：`plugin-mastergo/lib/api/swapComponentHandlers.ts#collectOverridesFromSubtree`（按 `node.name`）
 *
 * 所以「同一语义在两个实现里名字不同」= **静默断链**（不报错，只是覆写不生效）。
 * 唯一裁决者是参考实现 `plugin-mastergo/lib/api/component-*.ts` 的 33 个 `render*` 函数
 * —— 本文件的门禁**机械地从源码派生期望值**，不手写「服务端该叫什么」的名字表。
 *
 * ## 上一版门禁为什么不够
 *
 * 旧版只断言「名字落在**全局**词汇表里」。于是 checkbox 的 `Icon` / `Icon` / `Icon`
 * （section / svg / path 三层）全部通过 —— 但 `findOne` 只返回**第一个** `Icon`（那个 section），
 * `data-override-text-Icon` 覆写必然打错节点。本版把三件事分开钉死：
 *   (a) 期望值从参考实现派生 + renderer↔type 映射覆盖全部 case（防漏）
 *   (b) **逐类型**集合比对（不是全局）：服务端产出 ⊆ 该类型参考集合 ∪ R2 ∪ R3 ∪ 本类型根名，
 *       且 ⊇ 规范表的必需名（规范化后）
 *   (c) 同级唯一：手工栈式解析 HTML 建树，每个元素恰好一个 `data-name`，
 *       且**每个元素的直接子元素 data-name 互不相同**
 *
 * 规范化把动态段（`${variant}` / `${i}` / `${s.key}` / `${rowIdx}-${colIdx}`）统一成 `*`：
 * `Button-primary` → `Button-*`，`Cell-0-1` → `Cell-*-*`，`Button-${variant}` → `Button-*`。
 */

const ROOT_DIR = fileURLToPath(new URL('../../', import.meta.url))
const API_DIR = join(ROOT_DIR, 'plugin-mastergo', 'lib', 'api')
const PREPROCESSOR_SRC = fileURLToPath(new URL('../src/utils/html-preprocessor.ts', import.meta.url))

/* ------------------------------------------------------------------ *
 * R2：保留单值子名（逐字；语义一旦命中就必须用这个名字）
 * 见 `skills/design/rules/16-component-catalog.md §图层命名契约`
 * ------------------------------------------------------------------ */
const R2_RESERVED = new Set([
  'Label', 'Icon', 'IconRight', 'Title', 'Description', 'Content', 'Placeholder',
  'Initial', 'Close', 'Track', 'Thumb', 'Fill', 'Header', 'Footer',
  // 本次升入 R2（原先散落在「宿主本地子名」清单里，自相矛盾）：
  // checkbox/radio 的 Box/Tick/Circle/Dot、divider 的 Line、spinner 的 Arc。
  'Box', 'Tick', 'Circle', 'Dot', 'Line', 'Arc',
])

/* ------------------------------------------------------------------ *
 * R3：重复集合 `<Role>-<i>`（二维 `Cell-<row>-<col>`），i 从 0 起。
 * 门禁跑在**规范化后**的名字上，所以索引位允许 `\d+` 或 `*`。
 * ------------------------------------------------------------------ */
const R3_COLLECTION =
  /^(Item|Row|Cell|Tab|Crumb|Step|Divider|Header|Icon|Feature|Tier|MenuItem|Checkbox|Radio)-(?:\d+|\*)(?:-(?:\d+|\*))?$/

/* ------------------------------------------------------------------ *
 * 唯一规范表（任务给定的逐字规范，**必需名**即括号外的部分）。
 * `root` = R4 根名（`*` 填默认 variant）。这里手写的是「规范」，不是「实现里的名字」。
 * ------------------------------------------------------------------ */
interface SpecEntry {
  root: string
  required: string[]
  optional: string[]
}
const SPEC_TABLE: Record<string, SpecEntry> = {
  button: { root: 'Button-*', required: ['Button-*', 'Label'], optional: ['Icon', 'IconRight'] },
  badge: { root: 'Badge-*', required: ['Badge-*', 'Label'], optional: [] },
  avatar: { root: 'Avatar', required: ['Avatar', 'Initial'], optional: [] },
  toggle: { root: 'Toggle', required: ['Toggle', 'Track', 'Thumb'], optional: [] },
  progress: { root: 'Progress', required: ['Progress', 'Track', 'Fill', 'Label'], optional: [] },
  divider: { root: 'Divider-*', required: ['Divider-*', 'Line', 'Label'], optional: ['LabelBg'] },
  tag: { root: 'Tag-*', required: ['Tag-*', 'Label', 'Close'], optional: [] },
  tooltip: { root: 'Tooltip', required: ['Tooltip', 'Label'], optional: [] },
  spinner: { root: 'Spinner', required: ['Spinner', 'Track', 'Arc'], optional: [] },
  skeleton: { root: 'Skeleton-*', required: ['Skeleton-*', 'Row-*'], optional: [] },
  'checkbox-group': {
    root: 'CheckboxGroup',
    required: ['CheckboxGroup', 'Title', 'Checkbox-*', 'Label-*'],
    optional: ['Tick-*'],
  },
  'radio-group': { root: 'RadioGroup', required: ['RadioGroup', 'Title', 'Radio-*', 'Label-*'], optional: [] },
  checkbox: { root: 'Checkbox', required: ['Checkbox', 'Box', 'Tick', 'Label'], optional: [] },
  radio: { root: 'Radio', required: ['Radio', 'Circle', 'Dot', 'Label'], optional: [] },
  'text-input': { root: 'TextInput', required: ['TextInput', 'Placeholder'], optional: ['Icon', 'Suffix'] },
  select: { root: 'Select', required: ['Select', 'Placeholder', 'Arrow'], optional: [] },
  slider: { root: 'Slider', required: ['Slider', 'Track', 'Fill', 'Thumb'], optional: [] },
  menu: { root: 'Menu', required: ['Menu', 'Item-*', 'Label-*', 'Divider-*'], optional: ['Icon-*'] },
  tabs: { root: 'Tabs-*', required: ['Tabs-*', 'Tab-*', 'Label-*'], optional: ['Indicator'] },
  breadcrumb: { root: 'Breadcrumb', required: ['Breadcrumb', 'Crumb-*', 'Divider-*'], optional: ['Label', 'Ellipsis'] },
  pagination: { root: 'Pagination', required: ['Pagination', 'Item-*', 'Label'], optional: ['Ellipsis'] },
  steps: { root: 'Steps', required: ['Steps', 'Step-*', 'Label-*', 'Connector-*'], optional: ['Title'] },
  list: { root: 'List', required: ['List', 'Item-*', 'Label', 'Divider-*'], optional: ['Icon', 'Badge', 'IconRight'] },
  accordion: { root: 'Accordion', required: ['Accordion', 'Header-*', 'Label', 'Chevron', 'Content', 'Divider-*'], optional: [] },
  card: { root: 'Card', required: ['Card', 'Title', 'Content', 'FooterDivider', 'Label-*'], optional: ['Btn-*'] },
  table: {
    root: 'Table',
    required: ['Table', 'HeaderCell-*', 'Header-*', 'HeaderDivider-*', 'RowDivider-*', 'Cell-*-*'],
    optional: [],
  },
  form: {
    root: 'Form',
    required: ['Form', 'Label-*', 'Input-*', 'Placeholder-*', 'SubmitBtn', 'SubmitLabel'],
    optional: [],
  },
  toast: { root: 'Toast-*', required: ['Toast-*', 'Icon', 'Description'], optional: ['IconCircle'] },
  modal: {
    root: 'Modal',
    required: ['Modal', 'Title', 'Content', 'Card', 'Close', 'FooterDivider', 'Btn-Confirm', 'Btn-Cancel', 'Label'],
    optional: [],
  },
  alert: { root: 'Alert-*', required: ['Alert-*', 'Title', 'Content', 'Close'], optional: [] },
}

/* ------------------------------------------------------------------ *
 * 参考实现：renderer → 组件类型（33 条，写在测试里，断言覆盖 generateComponentHtml 的每个 case）
 * ------------------------------------------------------------------ */
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

const REFERENCE_FILES = ['basic', 'form', 'navigation', 'data', 'layout'] as const

/** 默认 config 不足以触发全部必需分支的类型，补一个最小「全量」config。 */
const FULL_CONFIG: Record<string, unknown> = {
  divider: { label: 'Divider' },
  modal: { content: 'Modal content' },
  alert: { title: 'Alert title', content: 'Alert content' },
}

/* ------------------------------------------------------------------ *
 * 规范化：动态段 → `*`
 * ------------------------------------------------------------------ */
function normalize(raw: string): string {
  // 1) 模板插值（`${variant}` / `${i}` / `${s.key}` / `${rowIdx}-${colIdx}`）→ `*`
  let s = raw.replace(/\$\{[^}]*\}/g, '*')
  // 2) 逐段归一：纯数字索引、纯小写 variant 值 → `*`
  s = s
    .split('-')
    .map((seg) => {
      if (/^\d+$/.test(seg)) return '*'
      if (/^[a-z][a-z0-9]*$/.test(seg)) return '*'
      return seg.replace(/\*+/g, '*')
    })
    .join('-')
  // 3) 去掉紧贴词尾（前面不是 `-`）的 `*`：`Checkbox${…}` → `Checkbox*` → `Checkbox`
  s = s.replace(/([A-Za-z0-9])\*/g, '$1')
  return s
}

/* ------------------------------------------------------------------ *
 * (a) 从参考实现机械派生「renderer → 名字集合」
 * ------------------------------------------------------------------ */
/** `name:` 后跟的值表达式（到行尾或第一个逗号为止）。 */
const NAME_VALUE = /name:\s*([^,\n]+)/

/** 从值表达式里摘出名字字面量（模板串优先，其次单/双引号；纯变量返回 null）。 */
function literalOf(expression: string): string | null {
  const template = expression.match(/`([^`]*)`/)
  if (template) return template[1]
  const single = expression.match(/'([^']*)'/)
  if (single) return single[1]
  const double = expression.match(/"([^"]*)"/)
  if (double) return double[1]
  return null
}

/** 注释行 / 档位数据行（`{ name: '基础版', price: …, features: […] }` 的 name 是数据字段）不算图层名。 */
function isNoiseLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return true
  if (/\bprice:|\bfeatures:/.test(line)) return true
  return false
}

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
        if (!hit) continue
        const literal = literalOf(hit[1])
        if (literal !== null) names.add(normalize(literal))
      }
      renderers.set(block.name, names)
    })
  }
  return renderers
}

const REFERENCE_NAMES = extractReferenceNames()

/** 某个组件类型的参考名字集合（实现类型的 renderer 恰好一个）。 */
function referenceNamesFor(type: string): Set<string> {
  const renderer = Object.keys(RENDERER_TYPE).find((r) => RENDERER_TYPE[r] === type)
  return renderer ? (REFERENCE_NAMES.get(renderer) ?? new Set()) : new Set()
}

/** `generateComponentHtml` 的 case 列表（防测试与实现漂移）。 */
function implementedTypesFromSource(): string[] {
  const src = readFileSync(PREPROCESSOR_SRC, 'utf-8')
  return [...src.matchAll(/case '([^']+)': html = generate\w+Html\(config\); break/g)].map((mm) => mm[1])
}

/* ------------------------------------------------------------------ *
 * (c) 栈式 HTML 解析器（无依赖，只够本用：扫标签 + 建树）
 * ------------------------------------------------------------------ */
interface Element {
  tag: string
  attrs: string
  children: Element[]
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

function parseTree(html: string): Element {
  const root: Element = { tag: '#root', attrs: '', children: [] }
  const stack: Element[] = [root]
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(html)) !== null) {
    const [, closing, tag, attrs, selfClose] = m
    if (closing === '/') {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i
          break
        }
      }
      continue
    }
    const el: Element = { tag, attrs, children: [] }
    stack[stack.length - 1].children.push(el)
    if (!selfClose && !VOID_TAGS.has(tag.toLowerCase())) stack.push(el)
  }
  return root
}

function allElements(root: Element): Element[] {
  const out: Element[] = []
  const walk = (el: Element) => {
    for (const child of el.children) {
      out.push(child)
      walk(child)
    }
  }
  walk(root)
  return out
}

const dataNamesOf = (html: string): string[] => [...html.matchAll(/data-name="([^"]*)"/g)].map((mm) => mm[1])

/** 从元素属性里取 data-name（恰好一个才有意义）。 */
function nameOfAttrs(attrs: string): string {
  return attrs.match(/data-name="([^"]*)"/)?.[1] ?? ''
}

/* ------------------------------------------------------------------ *
 * 用例
 * ------------------------------------------------------------------ */
const componentHtml = (attrs: string) => `<component ${attrs} />`

describe('component 展开：图层名契约（机械派生 + 逐类型 + 同级唯一）', () => {
  it('(a) renderer↔type 映射覆盖 generateComponentHtml 的每一个 case，且 33 个 renderer 都能派生到', () => {
    const caseTypes = implementedTypesFromSource()
    expect(caseTypes).toHaveLength(30)

    // 映射表覆盖全部实现类型（防漏）
    expect([...caseTypes].sort()).toEqual(
      Object.values(RENDERER_TYPE).filter((t) => !['page-shell', 'feature-grid', 'pricing-table'].includes(t)).sort()
    )

    // 33 条映射一个不多一个不少，且源码里确实有这些 renderer
    expect(Object.keys(RENDERER_TYPE)).toHaveLength(33)
    const missing = Object.keys(RENDERER_TYPE).filter((r) => !REFERENCE_NAMES.has(r))
    expect(missing, `映射表里的 renderer 在参考实现中找不到：${missing.join(', ')}`).toEqual([])

    // 每个实现的类型都能派生出非空参考集合（正则失配时不能静默变绿）
    for (const type of caseTypes) {
      expect(referenceNamesFor(type).size, `${type} 的参考名字集合为空（提取失败？）`).toBeGreaterThan(0)
    }
  })

  it.each(Object.keys(SPEC_TABLE))(
    '(b) %s：服务端产出 ⊆ 参考集合 ∪ R2 ∪ R3 ∪ 根名，且 ⊇ 必需名',
    async (type) => {
      const spec = SPEC_TABLE[type]
      const config = JSON.stringify(FULL_CONFIG[type] ?? {})
      const result = await preprocessHtml(componentHtml(`type="${type}" config='${config}'`))

      expect(result.stats.componentsProcessed).toBe(1)
      expect(result.warnings).toEqual([])

      const raw = dataNamesOf(result.html)
      expect(raw.length, `${type} 没产出任何 data-name`).toBeGreaterThan(0)
      const norm = raw.map(normalize)
      const reference = referenceNamesFor(type)

      // 服务端产出必须落在「该类型的参考集合 ∪ R2 ∪ R3 形态 ∪ 本类型根名」内
      const offenders = [...new Set(norm)].filter((name) => {
        if (name === spec.root) return false
        if (reference.has(name)) return false
        if (R2_RESERVED.has(name)) return false
        if (R3_COLLECTION.test(name)) return false
        return true
      })
      expect(
        offenders,
        `${type} 出现契约外名称（参考集合：${[...reference].sort().join(', ')}）：${offenders.map((o) => JSON.stringify(o)).join(', ')}`
      ).toEqual([])

      // 规范表的必需名必须出现
      const missing = spec.required.filter((required) => !norm.includes(required))
      expect(missing, `${type} 缺少规范表必需名：${missing.join(', ')}`).toEqual([])

      // R4：根名恰好出现一次且在首位
      expect(norm[0]).toBe(spec.root)
      expect(norm.filter((n) => n === spec.root)).toHaveLength(1)
    }
  )

  it.each(Object.keys(SPEC_TABLE))('(c) %s：每个元素恰好一个 data-name，且直接子元素互不同名', async (type) => {
    const config = JSON.stringify(FULL_CONFIG[type] ?? {})
    const result = await preprocessHtml(componentHtml(`type="${type}" config='${config}'`))
    const tree = parseTree(result.html)
    const elements = allElements(tree)

    expect(elements.length).toBeGreaterThan(0)
    for (const el of elements) {
      const count = (el.attrs.match(/data-name=/g) ?? []).length
      expect(count, `${type}: <${el.tag}> 缺 data-name 或重复 ${count} 次`).toBe(1)
    }
    for (const el of elements) {
      const childNames = el.children.map((child) => nameOfAttrs(child.attrs))
      const dupes = [...new Set(childNames.filter((n, i) => n !== '' && childNames.indexOf(n) !== i))]
      expect(
        dupes,
        `${type}: <${el.tag}> 的直接子元素出现同名：${dupes.join(', ')}（findOne 会命中第一个 → 覆写错位）`
      ).toEqual([])
    }
  })

  it('(d) 未实现类型进 warnings 且仍是可见占位', async () => {
    for (const type of ['page-shell', 'feature-grid', 'pricing-table']) {
      const result = await preprocessHtml(componentHtml(`type="${type}" config='{}'`))
      expect(result.warnings.some((w) => w.includes(type))).toBe(true)
      expect(result.html).toContain(type)
      expect(result.html).toContain('data-name=')
    }
  })

  it('(d) 标签自带 data-name 时替换根名（不追加，同一元素只有一个 data-name）', async () => {
    const result = await preprocessHtml(
      componentHtml(`type="button" config='{}' data-name="DS_Button_Primary"`)
    )
    const rootTag = (result.html.match(/<[a-zA-Z][^>]*>/) ?? [''])[0]
    expect((rootTag.match(/data-name=/g) ?? []).length).toBe(1)
    expect(rootTag).toContain('data-name="DS_Button_Primary"')
    // 生成器的根名被替换掉，而不是同时留下两个
    expect(result.html).not.toContain('Button-primary')
  })
})
