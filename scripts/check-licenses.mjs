#!/usr/bin/env node
/**
 * 依赖与资产许可门禁（CI）
 *
 * 策略与依据：内部协议审计结论（不为每篇报告留路径引用，报告本身不随公开仓分发）
 *
 * 三条规则：
 *   1. **运行时依赖**（`dependencies` 的传递闭包）里禁止强 copyleft
 *      —— GPL / AGPL / LGPL / SSPL / CC-BY-SA / EUPL / OSL / CPAL
 *      —— 也无法接受「许可未知」，未知即拒（否则审计结论不成立）
 *   2. **构建期依赖**（devDependencies 及其传递闭包）允许强 copyleft，但打印出来；
 *      它们不进分发产物（`dist/` 未跟踪、npm 包依赖外部化），所以只告警不拦
 *   3. **资产**：`src/assets/` 下只允许白名单集合；并断言 `THIRD-PARTY-NOTICES.md` 存在
 *      —— Remix Icon License v1.0 §5 要求「分发图标库实质部分时随附许可」
 *
 * 退出码：0 = 通过；1 = 违反策略。
 *
 * 用法：node scripts/check-licenses.mjs
 *       （需要在三个包目录里先装好依赖：CI 里已由前面的步骤完成）
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 强 copyleft：运行时依赖里出现即失败 */
const STRONG_COPYLEFT = /^(A?GPL|LGPL|SSPL|CC-BY-SA|EUPL|OSL|CPAL|RPL|CDDL|EPL|CPL)/i
/** 弱/文件级 copyleft：允许，但必须打印（不得修改其文件、不得改许可） */
const WEAK_COPYLEFT = /^(MPL|CDDL|EPL|CPL)/i

/** src/assets/ 下允许出现的集合目录（新增集合必须同时补 THIRD-PARTY-NOTICES 条目） */
const ALLOWED_ASSET_COLLECTIONS = new Set(['remixicon'])

const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const GREEN = '\x1b[32m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const problems = []
const warnings = []

// ---------------------------------------------------------------- 工具

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

/** 归一化 license 字段（可能是 string / array / {type} / 缺失） */
function normalizeLicense(pkg) {
  if (!pkg) return 'UNKNOWN'
  let lic = pkg.license
  if (!lic && pkg.licenses) {
    lic = Array.isArray(pkg.licenses)
      ? pkg.licenses.map((l) => (typeof l === 'string' ? l : l?.type)).filter(Boolean).join(' OR ')
      : (pkg.licenses.type ?? String(pkg.licenses))
  }
  if (!lic || String(lic).trim() === '') return 'UNKNOWN'
  return String(lic).trim()
}

/** 收集 node_modules 下所有已安装包：name -> { version, license, deps } */
function collectInstalled(nmDir, out = new Map()) {
  let entries
  try {
    entries = readdirSync(nmDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.bin') continue
    const full = join(nmDir, entry.name)

    if (entry.name.startsWith('@')) {
      let scoped
      try {
        scoped = readdirSync(full, { withFileTypes: true })
      } catch {
        continue
      }
      for (const s of scoped) {
        if (!s.isDirectory()) continue
        const pkgDir = join(full, s.name)
        const pkg = readJson(join(pkgDir, 'package.json'))
        if (pkg?.name && !out.has(pkg.name)) {
          out.set(pkg.name, {
            version: pkg.version ?? '?',
            license: normalizeLicense(pkg),
            deps: Object.keys(pkg.dependencies ?? {}),
          })
        }
        collectInstalled(join(pkgDir, 'node_modules'), out)
      }
      continue
    }

    const pkg = readJson(join(full, 'package.json'))
    if (pkg?.name && !out.has(pkg.name)) {
      out.set(pkg.name, {
        version: pkg.version ?? '?',
        license: normalizeLicense(pkg),
        deps: Object.keys(pkg.dependencies ?? {}),
      })
    }
    collectInstalled(join(full, 'node_modules'), out)
  }
  return out
}

/** 从一组根依赖出发，在已安装图上求传递闭包 */
function closure(roots, installed) {
  const seen = new Set()
  const queue = [...roots]
  while (queue.length) {
    const name = queue.pop()
    if (!name || seen.has(name)) continue
    seen.add(name)
    const node = installed.get(name)
    if (!node) continue
    for (const d of node.deps) if (!seen.has(d)) queue.push(d)
  }
  return seen
}

function classify(license) {
  if (license === 'UNKNOWN') return 'block'
  if (STRONG_COPYLEFT.test(license)) return 'block'
  if (WEAK_COPYLEFT.test(license)) return 'warn'
  return 'ok'
}

// ---------------------------------------------------------------- 依赖扫描

/** name -> 包目录（相对 ROOT）；新增包一定要加进来，否则它会静默跳过许可核验 */
const PACKAGES = ['mcp-server', 'plugin-mastergo', 'plugin-penpot', 'packages/response-budget']

console.log(`${DIM}解析已安装依赖树…${RESET}`)

for (const pkgName of PACKAGES) {
  const pkgDir = join(ROOT, pkgName)
  const manifest = readJson(join(pkgDir, 'package.json'))
  if (!manifest) {
    problems.push(`${pkgName}: 读不到 package.json`)
    continue
  }

  const installed = collectInstalled(join(pkgDir, 'node_modules'))
  const prodRoots = Object.keys(manifest.dependencies ?? {})
  const devRoots = Object.keys(manifest.devDependencies ?? {})
  const prodClosure = closure(prodRoots, installed)
  const devClosure = closure(devRoots, installed)

  console.log(`\n${pkgName}  ${DIM}安装 ${installed.size} 个包；运行时闭包 ${prodClosure.size} 个${RESET}`)

  // 运行时依赖 —— 严格
  for (const name of [...prodClosure].sort()) {
    const node = installed.get(name)
    if (!node) {
      problems.push(`${pkgName}: 运行时依赖 "${name}" 未安装（无法核验许可）`)
      continue
    }
    const verdict = classify(node.license)
    if (verdict === 'block') {
      problems.push(`${pkgName}: 运行时依赖 ${name}@${node.version} 许可为 ${node.license} —— 禁止`)
    } else if (verdict === 'warn') {
      warnings.push(`${pkgName}: 运行时依赖 ${name}@${node.version} 为 ${node.license}（文件级 copyleft，允许但要知悉）`)
    }
  }

  // 构建期依赖 —— 仅告警
  for (const name of [...devClosure].sort()) {
    if (prodClosure.has(name)) continue
    const node = installed.get(name)
    if (!node) continue
    if (classify(node.license) === 'block') {
      warnings.push(`${pkgName}: 构建期依赖 ${name}@${node.version} 为 ${node.license}（不进分发产物，仅提示）`)
    }
  }

  // 统计概览
  const tally = new Map()
  for (const name of installed.keys()) {
    const lic = installed.get(name).license
    tally.set(lic, (tally.get(lic) ?? 0) + 1)
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`  ${top.map(([l, n]) => `${l}×${n}`).join('  ')}`)
}

// ---------------------------------------------------------------- 资产扫描

console.log('\n资产与声明：')

for (const pkgName of PACKAGES) {
  const assetsDir = join(ROOT, pkgName, 'src', 'assets')
  if (!existsSync(assetsDir)) continue
  for (const entry of readdirSync(assetsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!ALLOWED_ASSET_COLLECTIONS.has(entry.name)) {
      problems.push(
        `${relative(ROOT, join(assetsDir, entry.name))}: 未审计的第三方资产集合 ` +
          `—— 请先补 THIRD-PARTY-NOTICES 条目，再把它加入 ALLOWED_ASSET_COLLECTIONS`
      )
    } else {
      console.log(`  ${GREEN}✓${RESET} ${pkgName}/src/assets/${entry.name}（白名单内）`)
    }
  }
}

if (!existsSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'))) {
  problems.push('缺少 THIRD-PARTY-NOTICES.md（Remix Icon License v1.0 §5 要求随分发）')
} else {
  console.log(`  ${GREEN}✓${RESET} THIRD-PARTY-NOTICES.md 存在`)
}

// ---------------------------------------------------------------- 结论

if (warnings.length) {
  console.log(`\n${YELLOW}提示（不拦截）：${RESET}`)
  for (const w of warnings) console.log(`  ${YELLOW}•${RESET} ${w}`)
}

if (problems.length) {
  console.error(`\n${RED}许可门禁失败：${RESET}`)
  for (const p of problems) console.error(`  ${RED}✗${RESET} ${p}`)
  // 「未安装」是环境问题、不是许可问题 —— 分开说，否则很容易被当成真的许可违规
  if (problems.some((p) => p.includes('未安装'))) {
    console.error(
      `\n${DIM}提示：带「未安装」的条目说明依赖树不在本地 —— 先跑${RESET} ` +
        `npm ci${DIM}（mcp-server）与${RESET} yarn install${DIM}（两个 plugin）再重跑。` +
        `\n      这也是 CI 里本门禁必须放在「装完依赖」之后的 job 的原因。${RESET}`
    )
  }
  console.error(`\n依据：仓库内部协议审计（运行时依赖零强 copyleft / 资产集合已审计）`)
  process.exit(1)
}

console.log(`\n${GREEN}许可门禁通过${RESET}：运行时依赖无强 copyleft，资产集合已审计。`)
if (warnings.length) console.log(`${DIM}（有 ${warnings.length} 条提示，见上）${RESET}`)
