#!/usr/bin/env node
/**
 * 上下文成本基准（context-cost benchmark）
 *
 * 为什么需要它：本项目的核心卖点是「为 agent 预算而设计」—— 工具面 67 → 20（约 −68%）、
 * 输出侧结构保持式截断。卖点必须是**可复现的数字**，否则只是说法。
 *
 * 本脚本只测**可本地测量**的部分，不碰画布：
 *   1. 每个 profile 的工具数与序列化字符数（= 每次请求都要重发的量）；
 *   2. 输出侧预算：同一份超限载荷在截断前后的字符数，以及截断后是否仍是合法 JSON。
 *
 * 它**不测**保真度/像素差异 —— 那需要真实画布与截图对比，见 docs/benchmarks.md 的「没测什么」。
 *
 * 前置：需要 mcp-server 的构建产物（脚本跑的是 dist，不是源码，避免引入 tsx 依赖）
 *   npm run build:server
 *
 * 用法：
 *   node scripts/benchmark-context.mjs                 # 人类可读
 *   node scripts/benchmark-context.mjs --json          # 机器可读（stdout）
 *   node scripts/benchmark-context.mjs --out <file>    # 同时写原始数据 JSON
 *
 * 退出码：0 成功 / 2 前置不满足
 */
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, 'mcp-server/dist')

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const outIdx = args.indexOf('--out')
const outFile = outIdx >= 0 ? resolve(args[outIdx + 1]) : null

function fail(message) {
  console.error(`❌ ${message}`)
  process.exit(2)
}

if (!existsSync(resolve(DIST, 'utils/tools.js'))) {
  fail('缺少 mcp-server 构建产物（脚本跑的是 dist，不是源码）—— 先跑 `npm run build:server`')
}

const tools = await import(pathToFileURL(resolve(DIST, 'utils/tools.js')).href)
const profiles = await import(pathToFileURL(resolve(DIST, 'utils/tool-profiles.js')).href)
const budget = await import(pathToFileURL(resolve(DIST, 'utils/response-budget.js')).href)

const all = tools.getToolList()

// ── 1) 工具面：每个 profile 每次请求要重发的字符数 ──
const surface = profiles.PROFILE_NAMES.map((name) => {
  const list = profiles.toolsForProfiles(all, [name])
  const chars = JSON.stringify(list).length
  return { profile: name, tools: list.length, chars }
})
const full = surface.find((s) => s.profile === 'full')
for (const row of surface) {
  row.charsVsFullPct = full.chars ? Number((((full.chars - row.chars) / full.chars) * 100).toFixed(1)) : 0
  row.toolsVsFullPct = full.tools ? Number((((full.tools - row.tools) / full.tools) * 100).toFixed(1)) : 0
}

// ── 2) 输出侧预算：截断前后 ──
const BIG = 500
const payload = {
  total: BIG,
  nodes: Array.from({ length: BIG }, (_, i) => ({ id: `n${i}`, name: 'x'.repeat(40) })),
}
const before = JSON.stringify(payload).length
const { payload: after, budget: info } = budget.applyResponseBudget('search_nodes', payload)
const afterText = JSON.stringify(after)
let stillValidJson = true
try {
  JSON.parse(afterText)
} catch {
  stillValidJson = false
}

const report = {
  generatedAt: new Date().toISOString(),
  note: '本地可测部分；保真度/像素对比不在此列（见 docs/benchmarks.md）',
  toolSurface: {
    unit: 'serialized JSON characters of the tool definitions',
    defaultProfile: 'gen',
    full: { tools: full.tools, chars: full.chars },
    profiles: surface,
  },
  outputBudget: {
    tool: 'search_nodes',
    defaultMaxChars: budget.DEFAULT_MAX_CHARS,
    payloadNodes: BIG,
    beforeChars: before,
    afterChars: afterText.length,
    savedPct: Number((((before - afterText.length) / before) * 100).toFixed(1)),
    truncated: info?.truncated ?? false,
    shownNodes: after.nodes?.length ?? null,
    stillValidJson,
  },
}

if (outFile) {
  writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n')
  if (!asJson) console.log(`📄 原始数据已写入 ${relative(process.cwd(), outFile)}`)
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log('\n工具面（每次请求重发）')
  console.log('  profile   工具    字符     vs full')
  for (const row of surface) {
    console.log(
      `  ${row.profile.padEnd(8)} ${String(row.tools).padStart(4)}  ${String(row.chars).padStart(6)}   ${String(row.charsVsFullPct).padStart(5)}% 更小`
    )
  }
  console.log('\n输出侧预算')
  console.log(`  ${BIG} 节点 payload：${before} → ${afterText.length} 字符（省 ${report.outputBudget.savedPct}%）`)
  console.log(`  保留 ${report.outputBudget.shownNodes}/${BIG} 项 · 仍是合法 JSON：${stillValidJson ? '是' : '否（这是个 bug）'}`)
  console.log('')
}

process.exit(stillValidJson ? 0 : 1)
