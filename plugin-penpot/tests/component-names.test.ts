import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SUPPORTED_COMPONENT_TYPES } from '@lib/api/componentHandlers'

/**
 * 图层命名契约门禁（Penpot DSL 预设）
 *
 * ## 为什么需要
 *
 * 复用/覆写**按图层名查找**，不是按 id：
 *   - `lib/api/dsl-renderer.ts`（MasterGo 侧同名实现）：`instance.findOne(n => n.name === childName)`
 *   - `lib/api/swapComponentHandlers.ts#collectCarryOver`：按 `props.name`（本仓）
 *
 * 所以 MasterGo 侧建出来的预设，和这里建出来的预设，**同名节点必须逐字一致**，
 * 否则跨宿主换组件时覆写静默丢失。契约正文：`skills/design/rules/16-component-catalog.md`
 * §图层命名契约。
 *
 * ## 与 MasterGo 侧的差异（刻意的）
 *
 * 这里额外断言**根名不含 `/`**：Penpot 侧早期用 `Button / primary`（MasterGo 侧是
 * `Button-primary`），同一个语义两种写法 —— `Button / ` 这个关键词不得再出现。
 *
 * ## 怎么避免误报
 *
 * 只扫 `frame(` / `text(` / `svgPath(` 的**第一个位置参数**（就是这些构造器的 `name`），
 * 不扫全量字符串字面量（`#FFFFFF`、`M 3 8 L…` 这类参数会淹掉结果）。
 * 格式规则只有一条（PascalCase 段 + 可选 `-<段>`），`BANNED_SOURCE_SNIPPETS` 逐字钉死
 * 已修掉的漂移 —— 宁可宽松，绝不误报。
 */

const HANDLERS_FILE = join(import.meta.dirname, '..', 'lib', 'api', 'componentHandlers.ts')
const source = readFileSync(HANDLERS_FILE, 'utf-8')

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

/** 合法形态：`PascalCase` 段 + 可选 `-<段>`（段 = 数字 / 字母数字 / `${…}` 归一化的 `<>`） */
const LAYER_NAME_SHAPE = /^[A-Z][A-Za-z0-9]*(?:<>|-(?:\d+|[A-Za-z0-9]+|<>))*$/

/**
 * `frame('Name', …)` / `text('Name', …)` / `svgPath('Name', …)`。
 *
 * 只匹配**紧跟在左括号后**的第一个参数，确保不会把构造器签名、颜色、SVG path 扫进来。
 */
const NAME_ARGUMENT = /\b(?:frame|text|svgPath)\(\s*(?:'([^']*)'|`([^`]*)`)/g

/**
 * 逐条对应一次真实的命名漂移；改名时把旧名补进来，防止悄悄改回去。
 *
 * 写成**调用前缀**（`frame('Knob'`）而不是裸名字：`'Message'` 这类字符串
 * 还可能是**文案内容**（`text('Description', str(…, 'Message'))`），裸名字会误报。
 */
const BANNED_SOURCE_SNIPPETS = [
  // R4：根名分隔符只用 `-`，禁止 `/` 与空格
  '`Button / ',
  '`Badge / ',
  '`Tag / ',
  '`Alert / ',
  "'Text Input'",
  // 自创同义词 → R2 保留名
  "frame('Knob'", // → Thumb
  "text('Initials'", // → Initial
  "text('Value'", // → Placeholder
  "text('Body'", // → Content
  "text('Message'", // → Description
  // 跨宿主分歧：MasterGo 侧 checkbox 的勾叫 Tick
  "svgPath('Check'",
  // 带空格的行名（骨架屏）
  '`Line ',
] as const

/** 必须出现的关键名字（防改过头） */
const REQUIRED_NAMES = [
  'Button-<>',
  'Badge-<>',
  'Tag-<>',
  'Alert-<>',
  'TextInput',
  'Toggle',
  'Thumb',
  'Avatar',
  'Initial',
  'Checkbox',
  'Box',
  'Tick',
  'Radio',
  'Dot',
  'Divider',
  'Progress',
  'Fill',
  'Spinner',
  'Track',
  'Arc',
  'Skeleton',
  'Card',
  'Content',
  'Tooltip',
  'Label',
  'Title',
  'Description',
  'Row-<>',
] as const

/** `${…}` 插值归一化成 `<>`，让 `` `Button-${variant}` `` 与 `Button-primary` 落在同一形态上 */
const normalize = (raw: string): string => raw.replace(/\$\{[^}]*\}/g, '<>')

function extractNames(text: string): string[] {
  const names: string[] = []
  NAME_ARGUMENT.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = NAME_ARGUMENT.exec(text)) !== null) {
    names.push(normalize(match[1] ?? match[2] ?? ''))
  }
  return names
}

const names = extractNames(source)

describe('图层命名契约：Penpot DSL 预设', () => {
  it('能读到 source，且提取到的名字数量合理（正则失配时不能静默变绿）', () => {
    expect(source.length).toBeGreaterThan(1000)
    expect(names.length).toBeGreaterThan(30)
  })

  it('每个名字都满足 R2 保留名或合法形态（无 /、无空格）', () => {
    const offenders = [...new Set(names)].filter(
      (name) => !RESERVED_SINGLE_NAMES.has(name) && !LAYER_NAME_SHAPE.test(name)
    )
    expect(offenders, `图层名不符合命名契约：${offenders.join(', ')}`).toEqual([])
  })

  it('根名不含 `/`（`Button / ` 这类写法不得再出现）', () => {
    const slashed = [...new Set(names)].filter((name) => name.includes('/'))
    expect(slashed, `根名仍用 / 当分隔符：${slashed.join(', ')}`).toEqual([])
    const spaced = [...new Set(names)].filter((name) => /\s/.test(name))
    expect(spaced, `图层名含空格：${spaced.join(', ')}`).toEqual([])
    for (const snippet of BANNED_SOURCE_SNIPPETS) {
      expect(source.includes(snippet), `源码里仍有漂移写法：${snippet}（应改成契约名）`).toBe(false)
    }
  })

  it('契约要求的名字确实存在（防改过头）', () => {
    const present = new Set(names)
    const missing = REQUIRED_NAMES.filter((name) => !present.has(name))
    expect(missing, `命名契约回退：缺 ${missing.join(', ')}`).toEqual([])
  })

  it('覆盖范围仍是 15/33（本任务只改名字，不新增预设）', () => {
    expect(SUPPORTED_COMPONENT_TYPES.length).toBe(15)
  })
})
