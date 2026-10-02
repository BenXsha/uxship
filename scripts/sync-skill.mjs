#!/usr/bin/env node
/**
 * 技能包分发同步 / 漂移门禁（uxship-design）
 *
 * 背景（真实踩过）：`skills/design/` 是 skill 的**唯一源**，但 AI 实际读的是各 IDE 的
 * skill 目录（opencode / pi / trae / costrict / codebuddy …）下的**副本**。副本与源漂移时，
 * AI 会照着一份过期说明书调用工具、承诺不存在的能力，而且**报错信息看起来像服务端 bug**
 * （例：安装副本里 `gen` 仍是「15 个 / ≈7.9k」、缺 `node_create` 的 anyOf 约束说明，
 * 而实现早已是 20 个 / ≈11.6k）。
 *
 * `mcp-server/tests/skill-docs-consistency.test.ts` 只守**源**（`skills/design`），
 * 守不住**产物** —— 这个脚本补的就是那一段：把源同步到每个已存在的部署副本，或检查它们是否漂移。
 *
 * 用法：
 *   node scripts/sync-skill.mjs                 # 同步（把源覆盖到每个已存在的副本）
 *   node scripts/sync-skill.mjs --check         # 只检查，有漂移则 exit 1（门禁）
 *   node scripts/sync-skill.mjs --list          # 打印解析到的目标（去重后的真实路径）
 *   node scripts/sync-skill.mjs --json          # 机器可读输出（给测试用）
 *   node scripts/sync-skill.mjs --prune         # 同步时删掉副本里多余的文件（默认只报告）
 *
 * 目标解析顺序：
 *   1. 环境变量 `UXSHIP_SKILL_DIRS`（用 `path.delimiter` 分隔；显式指定时不看默认列表）
 *   2. 默认候选列表里**已存在**的那些（见 SKILL_TARGET_CANDIDATES）
 * 软链接会按 realpath 去重（`~/.pi/agent/skills/uxship-design` 就指向 opencode 那份）。
 *
 * 退出码：0 无漂移 / 1 有漂移（`--check`）/ 2 用法或环境错误
 *
 * 旧名副本（`mastergo-design`）会被**显式**报出来 —— 见 LEGACY_SKILL_DIR_CANDIDATES。
 */
import { promises as fs } from 'node:fs'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..')
const SOURCE_DIR = join(ROOT_DIR, 'skills', 'design')

/**
 * 各 IDE / agent 的 skill 目录候选（相对 $HOME）。
 *
 * 顺序无关紧要（会去重）。新增宿主时在这里加一行即可 —— 找不到的候选会被静默跳过，
 * 所以列表可以放心列全，不会在别人机器上报错。
 */
const SKILL_TARGET_CANDIDATES = [
  '.config/opencode/skills/uxship-design',
  // opencode 的「mcp」命名空间分组（本机历史布局）
  '.config/opencode/skills/mcp/uxship-design',
  '.pi/agent/skills/uxship-design',
  '.claude/skills/uxship-design',
  '.codex/skills/uxship-design',
  '.trae-cn/skills/uxship-design',
  '.costrict/skills/uxship-design',
  '.codebuddy/skills/uxship-design',
  // 打包安装形态（scripts/package.mjs 产出的 zip 解到这两处）
  '.uxship/skills/uxship-design',
  '.local/share/uxship/skills/uxship-design',
]

/** 参与同步的文件类型（技能包就是文档 + 模板，不含构建产物） */
const SYNC_EXTENSIONS = new Set(['.md', '.html', '.json', '.svg', '.css', '.js', '.txt'])

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const listOnly = args.includes('--list')
const prune = args.includes('--prune')
const asJson = args.includes('--json')

function fail(message) {
  if (asJson) console.log(JSON.stringify({ ok: false, error: message }))
  else console.error(`❌ ${message}`)
  process.exit(2)
}

/** 递归收集参与同步的文件（相对路径 → Buffer），跳过点文件 / 点目录 */
async function collectFiles(root) {
  const out = new Map()
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const ext = entry.name.slice(entry.name.lastIndexOf('.'))
      if (!SYNC_EXTENSIONS.has(ext)) continue
      out.set(relative(root, full).split(sep).join('/'), await fs.readFile(full))
    }
  }
  if (!existsSync(root)) return null
  await walk(root)
  return out
}

/**
 * 旧名副本（历史遗留）—— 本仓库把 skill 从 `mastergo-design` 改名为 `uxship-design`，
 * 但本机实际存在的副本可能仍叫旧名。
 *
 * 为什么必须单独检：候选列表只认新名时，`resolveTargets()` 返回空，脚本会打印
 * 「没有发现任何已部署的 skill 副本」并 exit 0 —— 门禁**假绿**，而 AI 读的其实是
 * 旧名目录下那份过期说明书（里面可能还在教不存在的环境变量与路径）。
 * 静默跳过比报错危险得多，所以这里宁可让门禁红。
 */
const LEGACY_SKILL_DIR_CANDIDATES = [
  '.pi/agent/skills/mastergo-design',
  '.config/opencode/skills/mastergo-design',
  '.claude/skills/mastergo-design',
  '.codex/skills/mastergo-design',
]

/** 已存在的旧名副本（显式指定 UXSHIP_SKILL_DIRS 时不检，那是调用方的明确意图） */
function resolveLegacyTargets() {
  if (process.env.UXSHIP_SKILL_DIRS) return []
  return LEGACY_SKILL_DIR_CANDIDATES.map((rel) => join(os.homedir(), rel)).filter((p) => existsSync(p))
}

/** 解析目标：env 显式指定优先，否则取默认候选里已存在的；按 realpath 去重 */
function resolveTargets() {
  const envRaw = process.env.UXSHIP_SKILL_DIRS
  const candidates = envRaw
    ? envRaw.split(delimiter).map((p) => p.trim()).filter(Boolean).map((p) => resolve(p))
    : SKILL_TARGET_CANDIDATES.map((rel) => join(os.homedir(), rel))

  const targets = []
  const seen = new Set()
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    let real
    try {
      real = realpathSync(candidate)
    } catch {
      continue
    }
    if (!statSync(real).isDirectory()) continue
    if (seen.has(real)) continue
    seen.add(real)
    targets.push({ path: candidate, real, viaEnv: Boolean(envRaw) })
  }
  return targets
}

/** 比较单个目标与源，返回 { missing, differing, extra } */
async function diffTarget(target) {
  const source = await collectFiles(SOURCE_DIR)
  const deployed = await collectFiles(target.real)
  const missing = []
  const differing = []
  const extra = []

  if (deployed === null) {
    return { missing: [...source.keys()], differing, extra, absent: true }
  }
  for (const [rel, buf] of source) {
    const other = deployed.get(rel)
    if (other === undefined) missing.push(rel)
    else if (!other.equals(buf)) differing.push(rel)
  }
  for (const rel of deployed.keys()) {
    if (!source.has(rel)) extra.push(rel)
  }
  return {
    missing: missing.sort(),
    differing: differing.sort(),
    extra: extra.sort(),
    absent: false,
  }
}

async function syncTarget(target, drift) {
  const written = []
  for (const rel of [...drift.missing, ...drift.differing]) {
    const dest = join(target.real, rel)
    await fs.mkdir(dirname(dest), { recursive: true })
    await fs.copyFile(join(SOURCE_DIR, rel), dest)
    written.push(rel)
  }
  const pruned = []
  if (prune) {
    for (const rel of drift.extra) {
      await fs.rm(join(target.real, rel), { force: true })
      pruned.push(rel)
    }
  }
  return { written, pruned }
}

const sourceFiles = await collectFiles(SOURCE_DIR)
if (sourceFiles === null) fail(`源目录不存在：${SOURCE_DIR}`)

const targets = resolveTargets()
const legacyTargets = resolveLegacyTargets()

// 假绿的唯一形状：新名一个都没找到，旧名却有 —— 什么都没同步，却报「无需同步」。
// 注意：旧名与新名同时存在时不算阻断（只是有个陈旧副本要清），但也要报出来。
const legacyBlocker = targets.length === 0 && legacyTargets.length > 0

if (listOnly) {
  const payload = targets.map((t) => ({ path: t.path, real: t.real, viaEnv: t.viaEnv }))
  const legacy = legacyTargets.map((p) => ({ path: p, legacy: true }))
  console.log(
    asJson
      ? JSON.stringify({ ok: true, targets: payload, legacyTargets: legacy }, null, 2)
      : [...payload.map((t) => t.real), ...legacy.map((l) => `${l.path}   ← 旧名副本`)].join('\n')
  )
  process.exit(0)
}

const results = []
for (const target of targets) {
  const drift = await diffTarget(target)
  const drifted = drift.missing.length > 0 || drift.differing.length > 0
  const entry = { path: target.real, viaEnv: target.viaEnv, ...drift, drifted }
  if (!checkOnly && drifted) {
    const applied = await syncTarget(target, drift)
    entry.written = applied.written
    entry.pruned = applied.pruned
  }
  results.push(entry)
}

const driftedTargets = results.filter((r) => r.drifted)
const extraTargets = results.filter((r) => r.extra.length > 0)

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ok: driftedTargets.length === 0 && !legacyBlocker,
        mode: checkOnly ? 'check' : 'sync',
        source: SOURCE_DIR,
        sourceFiles: sourceFiles.size,
        targets: results,
        legacyTargets,
        legacyBlocker,
      },
      null,
      2
    )
  )
} else {
  if (legacyTargets.length > 0) {
    console.log('⚠️  发现旧名副本（本仓库已改名为 uxship-design）：')
    for (const p of legacyTargets) console.log(`       ${p}`)
    console.log('    这些目录不会被同步 —— 它们不在候选列表里。请改名或删除：')
    console.log('       mv <上面的路径> "$(dirname <上面的路径>)/uxship-design"   # 或直接 rm -rf')
    console.log('')
  }

  if (targets.length === 0) {
    if (legacyBlocker) {
      console.log('❌ 一个候选副本都没找到，但存在旧名副本 —— 这是门禁**假绿**：')
      console.log('   脚本「什么都没同步」却会 exit 0，而 AI 正在读旧名目录下的过期说明书。')
      console.log('   请先把上面的旧名目录改名成 uxship-design，再重跑。')
    } else {
      console.log('ℹ️  没有发现任何已部署的 skill 副本（候选目录都不存在），无需同步。')
      console.log('   候选列表见 scripts/sync-skill.mjs 的 SKILL_TARGET_CANDIDATES，或用 UXSHIP_SKILL_DIRS 指定。')
    }
  } else {
    console.log(`${checkOnly ? '检查' : '同步'}技能包：${SOURCE_DIR}（${sourceFiles.size} 个文件）`)
    console.log(`发现 ${targets.length} 个已部署副本\n`)
    for (const r of results) {
      if (!r.drifted && r.extra.length === 0) {
        console.log(`  ✅ ${r.path}`)
        continue
      }
      if (r.drifted && checkOnly) {
        console.log(`  ❌ ${r.path}  漂移 ${r.missing.length + r.differing.length} 个文件`)
      } else if (r.drifted) {
        console.log(`  🔧 ${r.path}  已写入 ${r.written.length} 个文件`)
      } else {
        console.log(`  ⚠️  ${r.path}  无漂移，但有 ${r.extra.length} 个多余文件`)
      }
      for (const rel of r.missing.slice(0, 5)) console.log(`       ← 缺失 ${rel}`)
      if (r.missing.length > 5) console.log(`       ← …另有 ${r.missing.length - 5} 个缺失文件`)
      for (const rel of r.differing.slice(0, 5)) console.log(`       ≠ 内容不同 ${rel}`)
      if (r.differing.length > 5) console.log(`       ≠ …另有 ${r.differing.length - 5} 个不同文件`)
      if (r.extra.length > 0) {
        for (const rel of r.extra.slice(0, 3)) console.log(`       + 副本独有 ${rel}`)
        if (r.extra.length > 3) console.log(`       + …另有 ${r.extra.length - 3} 个副本独有文件`)
      }
    }
    console.log('')
    if (driftedTargets.length > 0) {
      console.log(
        checkOnly
          ? `❌ ${driftedTargets.length} 个副本与源不一致 —— 跑 \`npm run skill:sync\` 修（AI 正读着过期说明书）。`
          : `✅ 已同步 ${driftedTargets.length} 个副本。`
      )
    } else {
      console.log('✅ 所有副本与源一致。')
    }
    if (extraTargets.length > 0 && !prune) {
      console.log(`ℹ️  ${extraTargets.length} 个副本含源里没有的文件（未删除；要删加 --prune）。`)
    }
  }
}

process.exit(checkOnly && (driftedTargets.length > 0 || legacyBlocker) ? 1 : 0)
