#!/usr/bin/env node
/**
 * `mcp-response-budget` 唯一源 → mcp-server 副本的同步 / 漂移门禁
 *
 * 背景（为什么会有「副本」这种东西）：`packages/response-budget/src/index.ts` 是唯一源，
 * 但 mcp-server 的 tsc 配置是 `rootDir: ./src` —— 引用包外的文件会直接编译失败
 * （TS6059: File is not under 'rootDir'）。而让 mcp-server 依赖一个**尚未发布**的包又会
 * 把 `npm ci` 打断。所以现阶段先用「逐字节副本 + 门禁」：复制是机械的，漂移是可检测的。
 *
 * 为什么必须有门禁：双写最大的风险是**静默漂移** —— 有人只改了 mcp-server 那份，
 * 于是发出去的独立包与 mcp-server 实际跑的逻辑不是同一套，而且没有任何测试会失败。
 * 本门禁把这种漂移变成红色。
 *
 * 用法：
 *   node scripts/sync-response-budget.mjs            # 把唯一源写到副本
 *   node scripts/sync-response-budget.mjs --check    # 只检查，有漂移 exit 1（CI 用）
 *   node scripts/sync-response-budget.mjs --json     # 机器可读
 *
 * 退出码：0 一致 / 1 漂移 / 2 用法或环境错误
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 唯一源（随 npm 包发布） */
const SOURCE = resolve(ROOT, 'packages/response-budget/src/index.ts')
/** 逐字节副本（mcp-server 因为 rootDir 限制不能直接引用唯一源） */
const TARGET = resolve(ROOT, 'mcp-server/src/utils/response-budget.ts')

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const asJson = args.includes('--json')

function fail(message) {
  if (asJson) console.log(JSON.stringify({ ok: false, error: message }))
  else console.error(`❌ ${message}`)
  process.exit(2)
}

for (const [label, path] of [['唯一源', SOURCE], ['副本', TARGET]]) {
  if (!existsSync(path)) fail(`${label}不存在：${relative(ROOT, path)}`)
}

const source = readFileSync(SOURCE)
const target = readFileSync(TARGET)
const same = source.equals(target)

const rel = (p) => relative(ROOT, p)

if (asJson) {
  console.log(
    JSON.stringify({ ok: same, mode: checkOnly ? 'check' : 'sync', source: rel(SOURCE), target: rel(TARGET), bytes: source.length }, null, 2)
  )
} else if (same) {
  console.log(`✅ response-budget 唯一源与副本一致（${source.length} 字节）`)
  console.log(`   ${rel(SOURCE)}  ≡  ${rel(TARGET)}`)
} else if (checkOnly) {
  console.error('❌ response-budget 双写已漂移：')
  console.error(`   唯一源 ${rel(SOURCE)}（${source.length} 字节）`)
  console.error(`   副本   ${rel(TARGET)}（${target.length} 字节）`)
  console.error('\n   跑 `npm run sync:response-budget` 修。')
  console.error('   若是**故意改逻辑**：请改唯一源（packages/response-budget/src/index.ts），再同步过去；')
  console.error('   只改副本会让发布的独立包与 mcp-server 实际跑的逻辑不是同一套。')
} else {
  writeFileSync(TARGET, source)
  console.log(`🔧 已同步：${rel(SOURCE)} → ${rel(TARGET)}（${source.length} 字节）`)
}

process.exit(same || !checkOnly ? 0 : 1)
