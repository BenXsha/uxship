import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { getToolList } from '../src/utils/tools.js'
import { PROFILE_NAMES, type ToolProfile } from '../src/utils/tool-profiles.js'
import { toolProfileStats } from '../src/utils/register-tools.js'

/**
 * 技能包文档一致性门禁
 *
 * 为什么需要：`skills/design/` 是 AI 调用本 MCP 时的**唯一说明书**（会同步成 opencode/pi 的 skill）。
 * 文档里出现「已删除的工具名」「过期的工具计数」「指向不存在文件的交叉引用」时，AI 会照着调用一个不存在的工具
 * —— 表现为 `tool not found`，排查成本极高（真实踩过：AGENTS.md 里 `node_create_batch` 在 v2.5.0 被合并后失效）。
 *
 * 本门禁只查**确定性**的漂移（名字 / 计数 / 文件引用），不评判文档写得好不好。
 */

const SKILL_DIR = resolve(process.cwd(), '..', 'skills', 'design')

/** 分发同步 / 漂移门禁脚本（根目录）。它守的就是本文件守不到的那一段：**产物**。 */
const SYNC_SCRIPT = resolve(process.cwd(), '..', 'scripts', 'sync-skill.mjs')

/** v2.5.0 起被合并掉的工具名（不得作为“可用工具”出现在文档里） */
const REMOVED_TOOLS = ['node_create_batch', 'node_update_batch', 'node_delete_batch', 'design_suggest_batch']
/** 出现这些词说明该行是在说明“已移除”，属于合理提及 */
const REMOVAL_MARKERS = ['不再有', '已合并', '已删除', '已移除', '改成']

/** `N 个业务工具` 必须是这个数；`N 个诊断工具` 必须是 2 */
const EXPECTED_BUSINESS_TOOL_COUNT = 67
const EXPECTED_DIAGNOSTIC_TOOL_COUNT = 2
/** 裸写 `N 个工具` 且 N ≥ 这个阈值时必须等于业务/全集数（小数字指 profile 子集或元工具，不在此约束） */
const BARE_COUNT_THRESHOLD = 30
/** 裸写 `N 个工具` 时允许的取值：业务数 / 业务+诊断 / 再加 mcp_tools 元工具 */
const ALLOWED_BARE_TOOL_COUNTS = new Set([
  EXPECTED_BUSINESS_TOOL_COUNT,
  EXPECTED_BUSINESS_TOOL_COUNT + EXPECTED_DIAGNOSTIC_TOOL_COUNT,
  EXPECTED_BUSINESS_TOOL_COUNT + EXPECTED_DIAGNOSTIC_TOOL_COUNT + 1,
])

function skillFiles(): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) files.push(full)
    }
  }
  walk(SKILL_DIR)
  return files
}

const files = existsSync(SKILL_DIR) ? skillFiles() : []

describe('技能包文档一致性', () => {
  it('技能包存在且能读到文档（路径没漂）', () => {
    expect(files.length, `未在 ${SKILL_DIR} 找到任何 .md`).toBeGreaterThan(5)
  })

  it('不把已删除的工具名当作可用工具（排除“已移除”说明行）', () => {
    const offenders: string[] = []
    for (const file of files) {
      for (const [index, line] of readFileSync(file, 'utf-8').split('\n').entries()) {
        for (const removed of REMOVED_TOOLS) {
          if (!line.includes(removed)) continue
          if (REMOVAL_MARKERS.some((marker) => line.includes(marker))) continue
          offenders.push(`${file.replace(SKILL_DIR + '/', '')}:${index + 1} → ${removed}`)
        }
      }
    }
    expect(offenders, `文档里仍在教 AI 调用已合并的工具：\n${offenders.join('\n')}`).toEqual([])
  })

  it('工具计数与实际一致（业务 67 / 诊断 2）', () => {
    const offenders: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf-8')
      const rel = file.replace(SKILL_DIR + '/', '')
      for (const match of text.matchAll(/(\d+)\s*个业务工具/g)) {
        if (Number(match[1]) !== EXPECTED_BUSINESS_TOOL_COUNT) offenders.push(`${rel}: 「${match[0]}」`)
      }
      for (const match of text.matchAll(/(\d+)\s*个诊断工具/g)) {
        if (Number(match[1]) !== EXPECTED_DIAGNOSTIC_TOOL_COUNT) offenders.push(`${rel}: 「${match[0]}」`)
      }
      for (const match of text.matchAll(/(\d+)\s*个工具(?!业务|诊断)/g)) {
        const count = Number(match[1])
        // 只约束「像总线工具数」的数字（≥30）；更小的数字指的是 profile 子集 / 元工具 / 单次调用个数
        if (count < BARE_COUNT_THRESHOLD) continue
        if (!ALLOWED_BARE_TOOL_COUNTS.has(count)) offenders.push(`${rel}: 「${match[0]}」`)
      }
    }
    expect(offenders, `工具计数过期（实际业务 ${getToolList().length} 个）：\n${offenders.join('\n')}`).toEqual([])
  })

  it('工具索引文档覆盖了全部业务工具', () => {
    const index = readFileSync(join(SKILL_DIR, 'rules', '07-mcp-tools.md'), 'utf-8')
    const missing = getToolList()
      .map((tool) => tool.name)
      .filter((name) => !index.includes(name))
    expect(missing, `rules/07-mcp-tools.md 未收录：${missing.join(', ')}`).toEqual([])
  })

  it('交叉引用的 rules/*.md 文件都存在', () => {
    const missing: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf-8')
      for (const match of text.matchAll(/(?:rules\/)?(\d{2}-[a-z0-9-]+\.md)/g)) {
        const target = join(SKILL_DIR, 'rules', match[1])
        if (!existsSync(target)) missing.push(`${file.replace(SKILL_DIR + '/', '')} → ${match[1]}`)
      }
    }
    expect(missing, `文档引用了不存在的规则文件：\n${[...new Set(missing)].join('\n')}`).toEqual([])
  })

  /**
   * 散文级断言：默认 profile 已从 `full` 改成 `gen`。
   *
   * 为何要单独守这一句：上面那些门禁只查**数字**（「N 个工具」/ profile 表的「N / ≈Mk」），
   * 而真实漂移恰恰发生在**句子**里 —— `07-mcp-tools.md` 第 5 行的「> 默认 `full`（全量）…」
   * 在改默认值时被漏掉，而全部数字门禁都是绿的（AI 会因此以为要配 `full` 才全量，
   * 或反过来以为默认就是全量）。这类断言不是穷尽语义，只钉最容易复发的一句。
   */
  it('不得把 full 写成默认 profile（默认已是 gen）', () => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = file.replace(SKILL_DIR + '/', '')
      for (const [index, line] of readFileSync(file, 'utf-8').split('\n').entries()) {
        // 看「默认」后面紧接的 12 个字符：出现 full 且没有 gen 才算错
        // （「默认 gen，要全量写 full」是合法表述，不能报）
        let at = line.indexOf('默认')
        while (at >= 0) {
          const window = line.slice(at, at + 14)
          if (/full/.test(window) && !/gen/.test(window)) {
            offenders.push(`${rel}:${index + 1} → ${line.trim().slice(0, 80)}`)
            break
          }
          at = line.indexOf('默认', at + 2)
        }
      }
    }
    expect(
      offenders,
      `文档仍把 full 当默认（默认已改为 gen，全量需显式 UXSHIP_MCP_PROFILE=full）：\n${offenders.join('\n')}`
    ).toEqual([])
  })

  /**
   * 逐 profile 的数字必须与实现一致。
   *
   * **为何必需**：上面的工具计数门禁只查**总**数（67）与索引覆盖，
   * 看不到 profile 表里的逐 profile 数字。真实发生过：`gen` 在表里写 **15 个**、
   * 实现却是 **20 个**（漂了 5 个工具 / +52% 字符），**总数量门禁完全看不到**。
   * 口径与 `mcp_tools({action:'status'})` 同源（`toolProfileStats`）。
   */
  it('07-mcp-tools.md 的 profile 表与实现一致（数量精确 / 字符容差 10%）', () => {    const doc = readFileSync(join(SKILL_DIR, 'rules', '07-mcp-tools.md'), 'utf-8')
    const offenders: string[] = []
    const seen = new Set<string>()

    // 只解析「工具面按 profile 暴露」节里的那张表 —— 文档其它表也有以反引号词开头的行
    // （例如 `| `design` | 设计指南 / 设计系统… |`），全文档扫描会误命中。
    const sectionStart = doc.indexOf('## 工具面按 profile 暴露')
    const ends = ['\n**常驻工具**', '\n### ', '\n## ']
      .map((marker) => doc.indexOf(marker, sectionStart + 1))
      .filter((i) => i > sectionStart)
    const section =
      sectionStart < 0 ? '' : doc.slice(sectionStart, ends.length ? Math.min(...ends) : undefined)
    expect(section, '未定位到 profile 表所在小节（标题被改？）').not.toBe('')

    for (const line of section.split('\n')) {
      const idMatch = line.match(/^\|\s*\*{0,2}`([a-z_]+)`\*{0,2}/)
      if (!idMatch) continue
      const name = idMatch[1] as ToolProfile
      if (!PROFILE_NAMES.includes(name)) continue
      seen.add(name)

      const cells = line.split('|').map((c) => c.trim()).filter(Boolean)
      const last = cells[cells.length - 1] ?? ''
      // 形如：**15 / ≈7.9k**   或   18 / ≈5.9k
      const parsed = last.match(/(\d+)\s*\/\s*≈?\s*([\d.]+)\s*k?/)
      if (!parsed) {
        offenders.push(`${name}: 末列解析不出「N / ≈Mk」→「${last}」`)
        continue
      }
      const docCount = Number(parsed[1])
      const docChars = Math.round(Number(parsed[2]) * 1000)
      const { count, chars } = toolProfileStats(name)
      if (docCount !== count) offenders.push(`${name}: 文档 ${docCount} 个 ≠ 实现 ${count} 个`)
      const drift = Math.abs(docChars - chars) / chars
      if (drift > 0.1) {
        offenders.push(
          `${name}: 文档 ≈${docChars} 字符 vs 实现 ${chars}（偏 ${Math.round(drift * 100)}%）`
        )
      }
    }

    const missing = PROFILE_NAMES.filter((n) => !seen.has(n))
    if (missing.length) offenders.push(`表中缺少 profile：${missing.join(', ')}`)

    const actual = PROFILE_NAMES.map((n) => {
      const s = toolProfileStats(n)
      return `${n}=${s.count}个/${s.chars}`
    }).join(' ')
    expect(
      offenders,
      `profile 表与实现不一致（实测：${actual}）：\n${offenders.join('\n')}`
    ).toEqual([])
  })
})

/**
 * 部署副本漂移门禁（**产物侧**）
 *
 * 上面的用例全部只读 `skills/design`（源）—— 而 AI 读的是各 IDE skill 目录下的**副本**。
 * 真实踩过：源已是「`gen` 20 个 / ≈11.6k」，而安装副本还写着「15 个 / ≈7.9k」且缺
 * `node_create` 的 anyOf 约束说明 —— AI 照着过期说明书绕路、撞参数必填错误，
 * 排查方向完全错（看起来像服务端 bug）。
 *
 * 所以这里拿 `scripts/sync-skill.mjs --check` 跑一遍：**只要本机存在副本，就必须与源一致**。
 * 副本不在（CI / 别人机器）时自动跳过 —— 这是环境相关门禁，不是通用断言。
 */
describe('技能包部署副本与源一致（产物侧）', () => {
  const probe = spawnSync(process.execPath, [SYNC_SCRIPT, '--check', '--json'], {
    encoding: 'utf-8',
    env: { ...process.env, UXSHIP_SKILL_DIRS: '' },
  })

  let report: any = null
  try {
    report = JSON.parse(probe.stdout || '{}')
  } catch {
    report = null
  }

  it('同步脚本可执行且输出机器可读结果', () => {
    expect(existsSync(SYNC_SCRIPT), `未找到 ${SYNC_SCRIPT}`).toBe(true)
    expect(report, `sync-skill.mjs --check --json 输出无法解析：\n${probe.stdout}\n${probe.stderr}`).not.toBeNull()
    expect(Array.isArray(report.targets)).toBe(true)
  })

  it('每个已部署副本都与源一致（不一致就跑 `npm run skill:sync`）', () => {
    const targets = (report?.targets ?? []) as Array<{
      path: string
      missing: string[]
      differing: string[]
    }>
    if (targets.length === 0) {
      // 本机没有部署副本 → 门禁无对象（CI / 新机器）。不静默装绿：留一行说明。
      console.log('[skill-docs-consistency] 未发现已部署的 skill 副本，跳过产物侧门禁')
      return
    }

    const drifted = targets
      .filter((t) => t.missing.length > 0 || t.differing.length > 0)
      .map((t) => {
        const files = [...t.missing.map((f) => `缺失 ${f}`), ...t.differing.map((f) => `内容不同 ${f}`)]
        const shown = files.slice(0, 6).join('\n      ')
        + (files.length > 6 ? `\n      …另有 ${files.length - 6} 个` : '')
        return `${t.path}\n      ${shown}`
      })

    expect(
      drifted,
      `技能包副本与源不一致（AI 正读着过期说明书）—— 跑 \`npm run skill:sync\` 修复：\n\n${drifted.join('\n\n')}`
    ).toEqual([])
  })
})
