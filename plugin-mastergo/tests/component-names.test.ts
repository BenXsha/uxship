import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 图层命名契约门禁（MasterGo 命令式预设）
 *
 * ## 为什么需要
 *
 * 整条「组件复用」链是**按图层名查找**的，不是按 id：
 *   - 实例子节点覆写：`lib/api/dsl-renderer.ts` 里 `instance.findOne(n => n.name === childName)`
 *   - 换组件继承覆写：`lib/api/swapComponentHandlers.ts#collectOverridesFromSubtree`（按 `current.name`）
 *
 * 所以同一个预设在各宿主/各实现里如果给同一个语义起了不同的名字（`Knob` vs `Thumb`、
 * `ProgressBar` vs `Progress`），跨宿主复用就会**静默断链** —— 不报错，只是覆写不生效。
 * 本文档把契约（`skills/design/rules/16-component-catalog.md §图层命名契约`）从
 * 「文档承诺」变成「引擎保证」。
 *
 * ## 怎么避免误报（关键取舍）
 *
 * 「宁可宽松，绝不误报」—— 先把现有名字全列出来，再定规则：
 *   1. **只认 `name:` 字面量**（含模板串）。名字通过变量传递（`name: params.name || 'X'`
 *      会被取到 `'X'`；纯变量 `name: btnName` 扫不到）—— 这是已知盲区，写在这里免得
 *      后人误以为覆盖是完备的。
 *   2. **格式规则只有一条**：`PascalCase` 段 + 可选 `-<段>`（段 = 数字 / 字母数字 / `${…}`）。
 *      R2 的保留名单直接放行（它是「语义保留名」，不是唯一合法集）。
 *   3. **不追求把 R3 的 Role 集合做成白名单**：`Chevron` / `Arrow` / `Sidebar` / `PercentLabel`
 *      这类宿主本地子名本来就不参与跨宿主覆写，列白名单只会制造误报。
 *   4. **真正钉死的是「同义替换」**：`BANNED_NAMES` 是逐字断言（`Knob` / `Handle` / `Desc` …）。
 *      它们不是格式问题，是语义漂移 —— 每次改名都必须先把这里补上，防止悄悄改回去。
 */

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'api')

/** 契约覆盖的 5 个命令式预设模块（33 种类型的全部实现） */
const COMPONENT_FILES = [
  'component-basic.ts',
  'component-form.ts',
  'component-navigation.ts',
  'component-data.ts',
  'component-layout.ts',
] as const

/** R2：保留单值子名（逐字；语义一旦命中就必须用这个名字） */
const RESERVED_SINGLE_NAMES = new Set([
  'Label',
  'Icon',
  'IconRight',
  'Title',
  'Description',
  'Content',
  'Placeholder',
  'Initial',
  'Close',
  'Track',
  'Thumb',
  'Fill',
  'Header',
  'Footer',
  // 2026-09-30 从文档 R2 名单同步补入（原先两包都比文档少 6 名，属第四处漂移）
  'Box',
  'Tick',
  'Circle',
  'Dot',
  'Line',
  'Arc',
])

/**
 * R3 的 Role 集合（重复集合 `<Role>-<i>`）。此处**只做文档**，不做白名单校验。
 * 保留它是为了让「R3 写了什么」在这个文件里可查，改契约时不容易漏。
 */
const COLLECTION_ROLES = new Set([
  'Item',
  'Row',
  'Cell',
  'Tab',
  'Crumb',
  'Step',
  'Divider',
  'Header',
  'Icon',
  'Feature',
  'Tier',
  'MenuItem',
  'Checkbox',
  'Radio',
])

/**
 * 合法名字形态：`PascalCase` 段 + 可选 `-<段>`。
 * `<段>` 可以是数字（`Row-0`）、字母数字（`Button-primary`、`Btn-Confirm`）
 * 或已归一化的插值占位 `<>`（`Divider-${i}` → `Divider-<>`）。
 * `<>` 允许紧跟在段后（`Checkbox${a ? '-checked' : ''}${b ? '-disabled' : ''}` → `Checkbox<><>`），
 * 因为这种拼接在运行时展开后本来就是一个合法的 `-` 分隔串（`Checkbox-checked-disabled`）。
 * 隐含拒绝：`/`、空格、下划线、中文、小写开头。
 */
const LAYER_NAME_SHAPE = /^[A-Z][A-Za-z0-9]*(?:<>|-(?:\d+|[A-Za-z0-9]+|<>))*$/

/**
 * `name:` 后跟的值表达式（到行尾或第一个逗号为止）。
 * 名字可能不是紧跟在冒号后的字面量（`name: params.name || 'Progress'`），
 * 所以先取表达式，再从表达式里摘字面量。
 */
const NAME_VALUE = /name:\s*([^,\n]+)/g

/** 从值表达式里摘出名字字面量（模板串优先，其次单/双引号；纯变量返回 null） */
function literalOf(expression: string): string | null {
  const template = expression.match(/`([^`]*)`/)
  if (template) return template[1]
  const single = expression.match(/'([^']*)'/)
  if (single) return single[1]
  const double = expression.match(/"([^"]*)"/)
  if (double) return double[1]
  return null
}

/**
 * 逐字禁用的名字（「自创同义词」黑名单）。
 *
 * 每一条都对应一次真实的跨宿主断链或契约漂移，改名时把新名字加进来即可：
 *   - `Knob`      → `Thumb`      （toggle 的圆点；R2 保留名是 `Thumb`）
 *   - `Handle`    → `Thumb`      （slider 的圆点；与 toggle 同语义）
 *   - `Desc`      → `Description`（R2 保留名）
 *   - `Message`   → `Description`（alert/toast 的说明文案）
 *   - `Measure`   → `Label`      （tooltip 的可见文案节点，旧名是测量期的临时名）
 *   - `Sep`       → `Divider`    （R3 角色集合里的分隔符）
 *   - `ProgressBar` → `Progress` （R4 无 variant 根名，Penpot 侧是 `Progress`）
 */
const BANNED_NAMES = ['Knob', 'Handle', 'Desc', 'Message', 'Measure', 'Sep', 'ProgressBar'] as const

/** 每个模块必须出现的关键名字 —— 防「改过头」把契约名改没了 */
const REQUIRED_NAMES: Record<string, string[]> = {
  'component-basic.ts': ['Thumb', 'Label', 'Icon', 'IconRight', 'Track', 'Fill', 'Initial', 'Close', 'Progress', 'Avatar', 'Toggle'],
  'component-form.ts': ['Thumb', 'Track', 'Fill', 'Placeholder', 'Label', 'Box', 'Tick'],
  'component-navigation.ts': ['Divider-<>', 'Crumb-<>', 'Step-<>', 'Tab-<>', 'Label-<>'],
  'component-data.ts': ['Title', 'Content', 'Description', 'Close', 'Item-<>'],
  'component-layout.ts': ['Description', 'Title', 'Header', 'Feature-<>', 'Tier-<>', 'Item-<>'],
}

interface FoundName {
  file: string
  line: number
  name: string
}

/** `${…}` 插值归一化成 `<>`，让 `Divider-${i}` 与 `Divider-0` 落在同一形态上 */
const normalize = (raw: string): string => raw.replace(/\$\{[^}]*\}/g, '<>')

function extractNames(source: string, file: string): FoundName[] {
  const found: FoundName[] = []
  source.split('\n').forEach((raw, index) => {
    const trimmed = raw.trim()
    // 注释行不算 —— 说明文字里提到某个名字是正常的文档行为
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return
    // 档位数据行：`{ name: '基础版', price: …, features: […] }` 的 name 是**数据字段**，不是图层名
    if (/\bprice:|\bfeatures:/.test(raw)) return
    for (const pattern of [NAME_VALUE]) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(raw)) !== null) {
        const literal = literalOf(match[1])
        if (literal !== null) found.push({ file, line: index + 1, name: normalize(literal) })
      }
    }
  })
  return found
}

const sources = new Map<string, string>(COMPONENT_FILES.map((file) => [file, readFileSync(join(API_DIR, file), 'utf-8')]))
const allNames = [...sources.entries()].flatMap(([file, source]) => extractNames(source, file))

const describeName = (found: FoundName) => `${found.file}:${found.line} → ${found.name}`

describe('图层命名契约：MasterGo 命令式预设', () => {
  it('源码能被读到，且提取到的名字数量合理（正则失配时不能静默变绿）', () => {
    for (const file of COMPONENT_FILES) {
      expect(sources.get(file), `读不到 ${file}`).toBeTruthy()
    }
    expect(allNames.length).toBeGreaterThan(60)
  })

  it('5 个模块都贡献了名字（没有哪个文件的写法逃过提取）', () => {
    for (const file of COMPONENT_FILES) {
      const inFile = allNames.filter((found) => found.file === file)
      expect(inFile.length, `${file} 一个 name: 字面量都没提取到`).toBeGreaterThan(0)
    }
  })

  it('每个图层名都满足 R2 保留名或合法形态（无 /、无空格、无下划线、PascalCase 段）', () => {
    const offenders = allNames
      .filter((found) => !RESERVED_SINGLE_NAMES.has(found.name) && !LAYER_NAME_SHAPE.test(found.name))
      .map(describeName)
    expect(offenders, `图层名不符合命名契约（见 rules/16-component-catalog.md §图层命名契约）：\n${offenders.join('\n')}`).toEqual([])
  })

  it('不出现自创同义词（R2/R3/R4 的保留名不得被同义词顶替）', () => {
    const names = new Set(allNames.map((found) => found.name))
    const offenders = BANNED_NAMES.filter((banned) => names.has(banned))
    expect(
      offenders,
      `出现了被契约禁用的同义名（应改成保留名，见 BANNED_NAMES 注释）：${offenders.join(', ')}`
    ).toEqual([])
    // 逐字钉死 Knob（历史事故：toggle 的圆点叫 Knob，Penpot 侧也照抄，跨宿主覆写直接断）
    for (const [file, source] of sources) {
      expect(source, `${file} 里仍有 name: 'Knob'`).not.toMatch(/name:\s*['"`]Knob['"`]/)
    }
  })

  it('契约要求的名字确实存在（防改过头）', () => {
    const missing: string[] = []
    for (const [file, required] of Object.entries(REQUIRED_NAMES)) {
      const names = new Set(allNames.filter((found) => found.file === file).map((found) => found.name))
      for (const name of required) {
        if (!names.has(name)) missing.push(`${file} 缺少 ${name}`)
      }
    }
    expect(missing, `命名契约回退：\n${missing.join('\n')}`).toEqual([])
  })

  it('R3 的 Role 集合与文档一致（改契约时两边都要动，别只改一边）', () => {
    expect([...COLLECTION_ROLES].sort()).toEqual(
      ['Cell', 'Checkbox', 'Crumb', 'Divider', 'Feature', 'Header', 'Icon', 'Item', 'MenuItem', 'Radio', 'Row', 'Step', 'Tab', 'Tier'].sort()
    )
  })
})
