#!/usr/bin/env node
/**
 * Markdown 相对链接门禁
 *
 * 为什么需要它：本仓库有 30+ 篇 Markdown（README、skills/design/rules、两份插件 README、
 * docs/**），它们互相引用。**一旦有文件被移出仓库**（例如把内部调研笔记从公开快照里剔除），
 * 那些引用就变成死链 —— 而 Markdown 死链不会报错，只会让读者点空。
 *
 * 检查范围：仓库内所有 `.md`（跳过 node_modules / dist / 构建产物目录）。
 * 检查对象：`[text](target)` 与 `![alt](target)` 里的**相对**路径。
 *   - 跳过 `http(s)://` / `mailto:` / `tel:` / `data:` / 纯锚点 `#...`
 *   - 去掉 `#anchor` 与 `?query` 后再解析
 *   - `%20` 等百分号转义会解码
 *
 * 用法：
 *   node scripts/check-docs-links.mjs            # 检查，有死链 exit 1
 *   node scripts/check-docs-links.mjs --json     # 机器可读输出
 *   node scripts/check-docs-links.mjs --list     # 只列出被扫描的文件
 *
 * 退出码：0 = 无死链；1 = 有死链；2 = 用法/环境错误
 */
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 不扫描的目录（构建产物 / 依赖 / 仓库外） */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.tmp',
  '_preview',
  'harness-dist',
  '.vitest',
  '.agent-sessions',
])

/** 外部链接协议前缀，一律跳过 */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const listOnly = args.includes('--list')

// ------------------------------------------------------------------ 收集文件

async function collectMarkdown(dir, out = []) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await collectMarkdown(join(dir, entry.name), out)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

// ------------------------------------------------------------------ 链接提取

/** 提取一行里的 markdown 链接目标（含图片） */
function extractTargets(line) {
  const targets = []
  const re = /!?\[[^\]]*\]\(\s*(<[^>]*>|[^()\s]+)(?:\s+"[^"]*")?\s*\)/g
  let m
  while ((m = re.exec(line)) !== null) {
    let target = m[1]
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
    targets.push({ target, index: m.index })
  }
  return targets
}

function stripDecoration(target) {
  return decodeURIComponent(target.split('#')[0].split('?')[0])
}

// ------------------------------------------------------------------ 主流程

const collected = await collectMarkdown(ROOT)
const files = collected.sort()

if (listOnly) {
  for (const f of files) console.log(relative(ROOT, f))
  console.log(`\n${files.length} 个 Markdown 文件`)
  process.exit(0)
}

const broken = []
let checked = 0

for (const file of files) {
  const content = await fs.readFile(file, 'utf-8')
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    for (const { target } of extractTargets(lines[i])) {
      const raw = stripDecoration(target)
      if (!raw) continue // 纯锚点
      if (EXTERNAL.test(target)) continue
      checked++
      const resolved = raw.startsWith('/')
        ? join(ROOT, raw)
        : resolve(dirname(file), raw)
      const ok = existsSync(resolved) || existsSync(resolved + '.md')
      if (!ok) {
        broken.push({
          file: relative(ROOT, file),
          line: i + 1,
          target,
          resolved: relative(ROOT, resolved),
        })
      }
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({ files: files.length, checked, broken }, null, 2))
} else {
  console.log(`扫描 ${files.length} 个 Markdown 文件，检查 ${checked} 条相对链接`)
  if (broken.length) {
    console.error(`\n发现 ${broken.length} 条死链：`)
    for (const b of broken) {
      console.error(`  ${b.file}:${b.line}  ->  ${b.target}   （解析为 ${b.resolved}，不存在）`)
    }
  } else {
    console.log('无死链 ✅')
  }
}

process.exit(broken.length ? 1 : 0)
