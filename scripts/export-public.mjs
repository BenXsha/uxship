#!/usr/bin/env node
/**
 * 公开快照导出 / 发布前检查（scripts/export-public.mjs）
 *
 * 为什么需要它：公开仓是内部仓的**子集**，靠人肉 `cp -r` + 记性剔除内部件必然漏。
 * 而漏一份内部计划文档进公开仓，等于永久留在 git 历史里 —— 删不干净。
 * 所以这里用 `git ls-files` 作为唯一事实来源（被 .gitignore 挡住的内部件天然不会出现），
 * 再把「禁止项」和「个人信息」做成硬断言 —— 宁可发布失败，也不要静默带出去。
 *
 * 分工：
 *   - 本脚本     → 内部文档 / 个人信息 / 必需文件
 *   - gitleaks   → 令牌与密钥（CI 的 secret-scan job）
 *   - license:check → 第三方许可
 *
 * 用法：
 *   node scripts/export-public.mjs                  # 只检查（等价 --check）
 *   node scripts/export-public.mjs --check          # 显式只检查
 *   node scripts/export-public.mjs --out <dir>      # 导出快照到目录（导出后再自查一遍）
 *   node scripts/export-public.mjs --out <dir> --clean   # 导出前先清空目标目录
 *   node scripts/export-public.mjs --json           # 机器可读输出（给 CI / 测试用）
 *
 * 退出码：0 干净 / 1 命中禁止项 / 2 用法或环境错误
 */
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const clean = args.includes('--clean')
const outIdx = args.indexOf('--out')
const outDir = outIdx >= 0 ? args[outIdx + 1] : null

if (outIdx >= 0 && !outDir) fail('--out 需要一个目录参数')
const checkOnly = !outDir

/**
 * 禁止进入公开仓的路径（按仓库相对路径匹配）。
 *
 * 这里是**兜底**，不是主力 —— 主力是 .gitignore：这些路径本来就不该被 git 跟踪。
 * 但 .gitignore 会被改名/移动打穿（真实事故：计划文档从 docs/ 挪到 docs/plan/，
 * 规则只挡 docs/plans/，于是它又暴露了），所以再断言一次。
 */
const DENY_PATHS = [
  { re: /^docs\/(plan|plans|reports)\//, why: '内部计划 / 调研文档' },
  { re: /open-source-plan/, why: '开源计划自身' },
  { re: /^\.agent-sessions\//, why: 'agent 会话记录' },
  { re: /^\.uxship\//, why: '团队库索引缓存' },
  { re: /^\.mgpilot\//, why: '旧运行时目录' },
  { re: /^\.export\//, why: '导出产物' },
  { re: /(^|\/)\.env(\.|$)/, why: '环境变量文件' },
  { re: /(^|\/)id_(rsa|ed25519|ecdsa)$/, why: '私钥' },
]

/**
 * 个人信息 / 本机绝对路径（在文本文件内容里扫）。
 *
 * 政策 —— 分清「署名」与「功能 URL」：
 *   - **署名面**（LICENSE 版权主体、About 弹层、安装器文案、包 `author`）
 *     不得出现个人 handle；本机绝对路径哪里都不许有。
 *   - **例外**：`https://github.com/<handle>/uxship` 这种必须能解析的**结构性 URL**。
 *     GitHub 的 issue 模板联系链接要求绝对 URL，写成相对路径会直接坏掉；
 *     公开仓本来就是该 handle 名下，写它不算泄露。
 * 所以扫描时先把结构性 URL 抠掉，再看剩下的内容里有没有 handle。
 *
 * ⚠️ 下面这些字符串是**故意拆开拼接**的：本文件自己也在被扫描的集合里，
 * 写成一整个字面量的话，脚本会命中自己 —— 发布前检查表里那条
 * `git grep -niE '<个人标识>'` 也会因为本文件而永远失败。
 */
const HANDLE = ['Ben', 'Xsha'].join('')
const PERSONAL_PATTERN = new RegExp(
  [HANDLE, ['Ben', 'Shawn'].join(''), ['benx', 'share'].join('')].join('|'),
  'i'
)
/** 结构性仓库 URL —— 允许出现（必须能解析），扫描前先抠掉 */
const STRUCTURAL_URL_PATTERN = new RegExp('(?:git\\+)?https://github\\.com/' + HANDLE + '/uxship', 'g')

/** 公开仓必须存在的文件 —— 少一个都说明导出/打包漏了东西 */
const REQUIRED = ['LICENSE', 'README.md', 'THIRD-PARTY-NOTICES.md', 'package.json', 'mcp-server/package.json']

/** 只扫这些后缀的内容，避免二进制误报 */
const TEXT_EXT = new Set([
  '.md', '.json', '.jsonc', '.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.vue',
  '.css', '.html', '.yml', '.yaml', '.txt', '.sh', '.example',
])

function fail(message) {
  if (asJson) console.log(JSON.stringify({ ok: false, error: message }))
  else console.error(`❌ ${message}`)
  process.exit(2)
}

/** `git ls-files` —— 唯一事实来源：只有被跟踪的文件才可能进公开仓 */
function trackedFiles() {
  try {
    const raw = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' })
    return raw.split('\0').filter(Boolean).sort()
  } catch (err) {
    fail(`读不到 git 跟踪文件列表（需要在 git 仓库里跑）：${err?.message || err}`)
  }
}

/** 路径层面：有没有不该被跟踪的内部件 */
function checkPaths(files) {
  const problems = []
  for (const rel of files) {
    for (const { re, why } of DENY_PATHS) {
      if (re.test(rel)) problems.push({ kind: 'path', file: rel, why })
    }
  }
  return problems
}

/** 内容层面：个人信息 / 本机绝对路径（rootDir 参数化：导出后要对副本再扫一遍）*/
async function checkContents(rootDir, files) {
  const problems = []
  for (const rel of files) {
    const ext = rel.slice(rel.lastIndexOf('.'))
    if (!TEXT_EXT.has(ext)) continue
    let text
    try {
      text = await fs.readFile(join(rootDir, rel), 'utf-8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      // 结构性 URL 先抠掉，只看「是否真把 handle 当署名用」
      const line = lines[i].replace(STRUCTURAL_URL_PATTERN, '')
      if (PERSONAL_PATTERN.test(line)) {
        problems.push({ kind: 'content', file: rel, line: i + 1, why: '个人标识 / 本机绝对路径' })
      }
    }
  }
  return problems
}

/** 必需文件是否齐全 */
function checkRequired() {
  const missing = REQUIRED.filter((rel) => !existsSync(join(ROOT, rel)))
  return missing.map((rel) => ({ kind: 'missing', file: rel, why: '公开仓必需文件' }))
}

/** 导出快照：只复制 git 跟踪的文件，并保留可执行位 */
async function exportSnapshot(target) {
  const files = trackedFiles()
  if (existsSync(target) && clean) await fs.rm(target, { recursive: true, force: true })
  let copied = 0
  for (const rel of files) {
    const src = join(ROOT, rel)
    const dest = join(target, rel)
    if (!existsSync(src)) continue
    await fs.mkdir(dirname(dest), { recursive: true })
    await fs.copyFile(src, dest)
    await fs.chmod(dest, statSync(src).mode)
    copied++
  }
  return { copied, files }
}

function report(problems, files, extra = {}) {
  const ok = problems.length === 0
  if (asJson) {
    console.log(JSON.stringify({ ok, sourceFiles: files.length, problems, ...extra }, null, 2))
  } else {
    console.log(`扫描 ${files.length} 个 git 跟踪文件（内部件不应出现在其中）`)
    if (ok) {
      console.log('✅ 无内部文档、无个人信息、必需文件齐全')
    } else {
      for (const p of problems) {
        const at = p.line ? `${p.file}:${p.line}` : p.file
        console.log(`  ❌ ${at}  —— ${p.why}`)
      }
      console.log(`\n❌ ${problems.length} 处问题 —— 公开快照已阻断。`)
      console.log('   内部文档：确认已在 .gitignore 里，并且 `git rm --cached <path>`')
      console.log('   个人信息：改成中性主语（如 `uxship contributors`）')
    }
  }
  return ok
}

const files = trackedFiles()
const problems = [...checkPaths(files), ...checkRequired(), ...(await checkContents(ROOT, files))]

if (checkOnly) {
  const ok = report(problems, files, { mode: 'check' })
  process.exit(ok ? 0 : 1)
}

// ── 导出模式 ──
// 先自查：源都不干净的话，导出的副本一定也不干净
if (!report(problems, files, { mode: 'export-precheck' })) process.exit(1)

const target = resolve(outDir)
if (target === ROOT) fail('--out 不能是仓库根目录（会自我覆盖）')
if (ROOT.startsWith(target + '/')) fail('--out 不能是仓库的父目录')

const { copied } = await exportSnapshot(target)

// 导出后对**副本**再扫一遍内容（路径层已由 trackedFiles 保证）
const exportedFiles = []
async function walk(dir, base = '') {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) await walk(join(dir, entry.name), rel)
    else exportedFiles.push(rel)
  }
}
await walk(target)
const postProblems = [
  ...checkPaths(exportedFiles),
  ...(await checkContents(target, exportedFiles)),
]
const postOk = postProblems.length === 0

let sha = 'unknown'
try {
  sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' }).trim()
} catch {
  /* 无 HEAD（全新仓库）不影响导出 */
}

if (!asJson) {
  console.log(`\n📦 已导出 ${copied} 个文件 → ${relative(process.cwd(), target) || target}`)
  if (postOk) console.log('✅ 副本复查通过')
  else for (const p of postProblems) console.log(`  ❌ ${p.file}${p.line ? ':' + p.line : ''} —— ${p.why}`)
  console.log(`\n建议在该目录里初始化并提交：`)
  console.log(`  cd ${relative(process.cwd(), target) || target} && git init -b main`)
  console.log(`  git add -A && git commit -m "chore(release): public snapshot from ${sha}"`)
} else {
  console.log(JSON.stringify({ ok: postOk, mode: 'export', target, copied, sourceSha: sha, problems: postProblems }, null, 2))
}

process.exit(postOk ? 0 : 1)
