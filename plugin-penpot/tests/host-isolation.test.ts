/**
 * 宿主隔离门禁
 *
 * 这是 `HostAdapter` 抽象**是否真实存在**的自动验证。没有这道门禁，抽象会在几周内退化：
 * 某个 handler 为了方便顺手写一句 `penpot.selection = [...]`，移植性就没了，而且没有任何信号。
 *
 * 规则（与 plugin-penpot/README.md「约定」一节一一对应）：
 *   R1'. 文档/画布类宿主 API（create* / library / fonts / currentPage / viewport / selection …）
 *        只允许出现在**Penpot 宿主适配层**（`lib/host/penpot*.ts`，在 ADAPTER_LAYER_FILES 里显式列名）。
 *        其余任何文件需要宿主能力一律走 `HostAdapter`（接口缺什么就补接口，不要就地伸手）——
 *        没有这道门禁，抽象会在几周内退化：某个 handler 为了方便顺手写一句 `penpot.selection = [...]`，
 *        移植性就没了，而且没有任何信号。
 *   R2. 宿主探测（`typeof penpot !== 'undefined'`）只允许出现在 `lib/host/index.ts`。
 *   R3. 插件**自身 UI 通道**（`penpot.ui.*`）是消息边界，允许出现在
 *       `lib/main.ts` 与 `messages/sender.ts` —— 它与设计文档无关，不属于宿主端口职责。
 *   R4. 不允许出现 MasterGo 残留（`mg.` / `plugin-mastergo` 的 `mg` 全局）—— 复制粘贴的典型事故。
 *
 * 变更记录（2026-10-01）：适配层原本只有一个文件，R1 因此写成「文件名」规则；
 * 拆簇后适配层变成多个文件（penpot-runtime / -side-borders / -tokens / -styles / -components），
 * 于是把 R1 升级为**层次规则**（R1'），并补两条**补偿控制**：
 *   ① 方向检查（见 describe("R1' 方向检查")）：适配层模块只允许被 `lib/host/` 内部引用 ——
 *      这一条重新建立起「单文件规则」原本天然提供的保证；
 *   ② 宿主调用计数下限（见 R1' 的第 2 个用例）：防止某次拆分把宿主调用成批搬空或搬进未登记文件。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')

const SCAN_DIRS = ['lib', 'ui', 'messages']

const DOC_API_PATTERN =
  /\bpenpot\.(create[A-Z]\w*|library|fonts|currentPage|currentFile|viewport|selection|openPage|group|ungroup|version|localStorage|root|theme|shapesColors|replaceColor|align\w+|distribute\w+|flatten|generateStyle|generateMarkup|uploadMedia\w*)\b/g

const UI_CHANNEL_PATTERN = /\bpenpot\.ui\./g

/**
 * 允许出现文档类 API 的**宿主适配层文件**（显式列名，**不用 glob / 前缀匹配**）。
 *
 * 为什么必须显式列名：R1' 的意图是「宿主全局不许逸出宿主适配层」，而拆簇之后适配层不再只有一个
 * 文件。显式列名的用意见就在这里 —— **新增适配层文件必须被有意加进本列表**；
 * 一个通配符 `lib/host/penpot*.ts` 会把未来所有文件都放进来，门禁就名存实亡了。
 * （`penpot-paint.ts` / `penpot-enums.ts` / `penpot-read.ts` 目前没有任何宿主调用，
 * 所以刻意不列；哪天它们真调了宿主，就该被门禁拦下来、由人决定加不加。）
 */
const ADAPTER_LAYER_FILES = [
  'lib/host/penpot.ts',
  'lib/host/penpot-runtime.ts',
  'lib/host/penpot-side-borders.ts',
  'lib/host/penpot-components.ts',
  'lib/host/penpot-styles.ts',
  'lib/host/penpot-tokens.ts',
  // P2-多 session：会话代号按文档持久化在 penpot.localStorage
  'lib/host/penpot-codename.ts',
]

/**
 * 适配层的**实现细节模块**：除 `lib/host/` 内部外，任何文件都不许 import（见方向检查）。
 * 名字写的是模块基名（不带扩展名），因为 import 说明符两种写法都要能匹配：
 * `@lib/host/penpot` 与 `./penpot`。
 */
const ADAPTER_MODULES = [
  'penpot',
  'penpot-runtime',
  'penpot-side-borders',
  'penpot-components',
  'penpot-styles',
  'penpot-tokens',
  'penpot-codename',
]

/** 允许做宿主探测的文件 */
const DETECT_ALLOWLIST = ['lib/host/index.ts']
/** 允许触碰插件 UI 通道的文件 */
const UI_CHANNEL_ALLOWLIST = ['lib/main.ts', 'messages/sender.ts']

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      listSourceFiles(full, acc)
      continue
    }
    if (/\.(ts|vue)$/.test(entry)) acc.push(full)
  }
  return acc
}

/**
 * 去掉字符串字面量。理由：报错文案里会提到 "penpot.createBoolean 尚未接线" 这类文字，
 * 那不是宿主调用。只保留代码部分再匹配，否则门禁会被自己的文案绊倒。
 */
function stripStringLiterals(line: string): string {
  return line
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

function scan(): { file: string; line: number; text: string }[] {
  const results: { file: string; line: number; text: string }[] = []
  for (const dir of SCAN_DIRS) {
    for (const file of listSourceFiles(join(ROOT, dir))) {
      const lines = readFileSync(file, 'utf-8').split('\n')
      lines.forEach((raw, index) => {
        // 跳过注释行（行注释 / 块注释内容），注释里提到 API 名是正常的文档行为
        const trimmed = raw.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return
        results.push({
          file: relative(ROOT, file).split(sep).join('/'),
          line: index + 1,
          text: stripStringLiterals(raw),
        })
      })
    }
  }
  return results
}

const scanned = scan()

function matches(pattern: RegExp, allowlist: string[]): { file: string; line: number; text: string }[] {
  return scanned.filter((entry) => {
    if (allowlist.includes(entry.file)) return false
    pattern.lastIndex = 0
    return pattern.test(entry.text)
  })
}

describe("R1' 文档类宿主 API 只在宿主适配层", () => {
  it('没有适配层之外的文件直接调用 penpot.create* / library / selection / viewport 等', () => {
    const violations = matches(DOC_API_PATTERN, [...ADAPTER_LAYER_FILES, ...DETECT_ALLOWLIST])
    expect(
      violations.map((v) => `${v.file}:${v.line}  ${v.text.trim()}`),
      '宿主 API 泄漏到端口之外 —— 请改为通过 HostAdapter 表达；接口缺能力就补接口',
    ).toEqual([])
  })

  it('宿主调用集中在适配层（抽象没有名存实亡）', () => {
    const count = (file: string) =>
      (readFileSync(join(ROOT, file), 'utf-8').match(new RegExp(DOC_API_PATTERN.source, 'g')) ?? []).length
    const total = ADAPTER_LAYER_FILES.reduce((sum, file) => sum + count(file), 0)

    // 拆簇前的基线：`lib/host/penpot.ts` 单文件 **69** 处（2026-10-01 实测）。
    // 拆簇只搬代码，但新模块的**文件头注释**里又提到了几个 API 名，而本计数与旧用例一样
    // 算的是**原文匹配**（含注释）—— 所以「适配层合计」现在是 **74**（其中代码行 59 处，
    // 与拆簇前只数代码行的 59 完全相等，证明宿主调用没有丢也没有散）。
    // 下限留在 50：既容忍正常的宿主调用增删，也挡得住「某次拆分把宿主调用成批搬空 / 搬进未登记的文件」。
    expect(total).toBeGreaterThan(50)
  })
})

describe("R1' 方向检查：适配层模块只被 lib/host/ 内部引用", () => {
  it('lib / ui / messages 里没有外部文件直接 import 适配层模块', () => {
    const offenders: string[] = []
    for (const dir of SCAN_DIRS) {
      for (const file of listSourceFiles(join(ROOT, dir))) {
        const rel = relative(ROOT, file).split(sep).join('/')
        // 适配层内部互相 import 是正常的（penpot.ts → penpot-tokens.ts）
        if (rel.startsWith('lib/host/')) continue
        const source = readFileSync(file, 'utf-8')
        for (const hit of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
          const specifier = hit[1]
          const base = specifier.split('/').pop() ?? ''
          if (ADAPTER_MODULES.includes(base)) offenders.push(`${rel}  ←  ${specifier}`)
        }
      }
    }
    expect(
      offenders,
      '适配层是 HostAdapter 背后的实现细节：外部一律经 lib/host/index.ts 的 getHost() 取宿主。' +
        '原来「单文件规则」天然保证宿主调用不外泄，拆簇后由这条方向检查重建该保证',
    ).toEqual([])
  })
})

describe('R3 插件 UI 通道只在消息边界', () => {
  it('penpot.ui.* 只出现在 main.ts 与 messages/sender.ts', () => {
    const violations = matches(UI_CHANNEL_PATTERN, UI_CHANNEL_ALLOWLIST)
    expect(violations.map((v) => `${v.file}:${v.line}  ${v.text.trim()}`)).toEqual([])
  })
})

describe('R4 没有 MasterGo 残留', () => {
  it('不应出现 mg.* / @mastergo / plugin-typings', () => {
    const violations = scanned.filter((entry) => /\bmg\.\w|\bmg\.document|@mastergo|@mastergo\/plugin-typings/.test(entry.text))
    expect(violations.map((v) => `${v.file}:${v.line}  ${v.text.trim()}`)).toEqual([])
  })
})

describe('R2 宿主探测只在 host/index.ts', () => {
  it('对「全局 penpot 是否存在」的探测只允许一处', () => {
    // 只禁裸 `typeof penpot`；`typeof penpot.ui.open` 这类单 API 能力探测是 penpot.ts 的份内事
    const violations = matches(/typeof penpot\b(?!\.)/g, DETECT_ALLOWLIST)
    expect(violations.map((v) => `${v.file}:${v.line}  ${v.text.trim()}`)).toEqual([])
  })
})

describe('门禁自身的有效性', () => {
  it('门禁能扫到文件（否则规则是空转的）', () => {
    expect(scanned.length).toBeGreaterThan(20)
  })

  it('门禁对「人为注入的违规」会报错（元测试）', () => {
    const injected = { file: 'lib/api/evil.ts', line: 1, text: 'penpot.createBoard()' }
    const caught = [injected].filter((entry) => {
      if (ADAPTER_LAYER_FILES.includes(entry.file)) return false
      DOC_API_PATTERN.lastIndex = 0
      return DOC_API_PATTERN.test(entry.text)
    })
    expect(caught).toHaveLength(1)
  })
})
