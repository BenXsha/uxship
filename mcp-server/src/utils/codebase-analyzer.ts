/**
 * 代码库结构分析器
 * 
 * 轻量工具：扫描目录结构，识别模块边界和入口文件，
 * 为 AI 的代码可视化提供结构化输入。
 * 不做 AST 解析，只做文件级结构分析。
 */

import fs from 'node:fs'
import path from 'node:path'

export interface CodebaseModule {
  name: string
  path: string
  type: 'file' | 'directory'
  language?: string
  size?: number
  children?: CodebaseModule[]
}

export interface CodebaseStructure {
  rootName: string
  language: string
  framework: string | null
  entryPoints: string[]
  moduleCount: number
  fileCount: number
  tree: CodebaseModule[]
  config: Record<string, any>
}

const LANG_MAP: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript (React)', js: 'JavaScript',
  jsx: 'JavaScript (React)', py: 'Python', rs: 'Rust',
  java: 'Java', kt: 'Kotlin', go: 'Go', rb: 'Ruby',
  php: 'PHP', cs: 'C#', swift: 'Swift', vue: 'Vue',
  svelte: 'Svelte', dart: 'Dart', scala: 'Scala',
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '__pycache__', 'dist', 'build',
  '.next', '.nuxt', 'target', '.idea', '.vscode', '.DS_Store',
  'coverage', '.nyc_output', 'vendor', '.venv', 'venv',
  '.turbo', '.cache', 'out', '.svelte-kit', '.expo',
])

const MAX_FILES = 500

function detectLanguage(dir: string): string {
  const files = fs.readdirSync(dir)
  const exts = new Set<string>()
  for (const f of files) {
    const ext = path.extname(f).replace('.', '')
    if (ext) exts.add(ext)
  }
  const langs = [...exts].map(e => LANG_MAP[e]).filter(Boolean)
  return [...new Set(langs)].slice(0, 3).join(', ') || 'Unknown'
}

function detectFramework(dir: string): string | null {
  const pkgPath = path.join(dir, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (deps.next) return 'Next.js'
      if (deps['@nestjs/core']) return 'NestJS'
      if (deps.react || deps['react-dom']) return deps['react-native'] ? 'React Native' : 'React'
      if (deps.vue || deps['@vue/cli-service']) return 'Vue'
      if (deps.express) return 'Express'
      if (deps.nuxt || deps.nuxt3) return 'Nuxt'
      if (deps.svelte || deps['@sveltejs/kit']) return 'Svelte'
      if (deps.electron) return 'Electron'
      return 'Node.js'
    } catch { return null /* 文件不存在或无权限 */ }
  }
  const cargoPath = path.join(dir, 'Cargo.toml')
  if (fs.existsSync(cargoPath)) return 'Rust (Cargo)'
  const pyprojectPath = path.join(dir, 'pyproject.toml')
  if (fs.existsSync(pyprojectPath)) return 'Python (Poetry)'
  const reqPath = path.join(dir, 'requirements.txt')
  if (fs.existsSync(reqPath)) return 'Python (pip)'
  return null
}

function findEntryPoints(dir: string, baseDir: string): string[] {
  const entries: string[] = []
  const candidates = [
    'package.json', 'index.ts', 'index.tsx', 'main.ts', 'main.tsx',
    'app.ts', 'app.tsx', 'server.ts', 'index.js', 'main.py',
    'app.py', 'main.rs', 'lib.rs', 'main.go', 'main.java',
  ]
  for (const c of candidates) {
    const p = path.join(dir, c)
    if (fs.existsSync(p)) {
      entries.push(path.relative(baseDir, p))
    }
  }
  return entries
}

function scanDir(dir: string, baseDir: string, depth: number): CodebaseModule[] {
  if (depth > 4) return []
  let results: CodebaseModule[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    let totalFiles = 0
    for (const entry of entries) {
      if (totalFiles > MAX_FILES) break
      const fullPath = path.join(dir, entry.name)
      const relPath = path.relative(baseDir, fullPath)
      if (SKIP_DIRS.has(entry.name)) continue
      if (entry.name.startsWith('.')) continue

      if (entry.isDirectory()) {
        totalFiles++
        const children = scanDir(fullPath, baseDir, depth + 1)
        if (children.length > 0 || hasSourceFiles(fullPath)) {
          results.push({
            name: entry.name,
            path: relPath,
            type: 'directory',
            children: depth < 3 ? children : [],
          })
        }
      } else if (entry.isFile()) {
        totalFiles++
        const ext = path.extname(entry.name).replace('.', '')
        const lang = LANG_MAP[ext] || ext.toUpperCase()
        if (entry.name === 'package.json' || entry.name === 'Cargo.toml' ||
            entry.name === 'pyproject.toml' || entry.name === 'tsconfig.json') {
          results.push({ name: entry.name, path: relPath, type: 'file', language: 'Config' })
        } else if (lang) {
          const stat = fs.statSync(fullPath)
          results.push({
            name: entry.name,
            path: relPath,
            type: 'file',
            language: lang,
            size: stat.size,
          })
        }
      }
    }
    results.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  } catch { /* 跳过无权限目录 */ }
  return results
}

function hasSourceFiles(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir)
    for (const e of entries) {
      if (SKIP_DIRS.has(e) || e.startsWith('.')) continue
      const fullPath = path.join(dir, e)
      const stat = fs.statSync(fullPath)
      if (stat.isFile()) {
        const ext = path.extname(e).replace('.', '')
        if (LANG_MAP[ext]) return true
      } else if (stat.isDirectory()) {
        if (hasSourceFiles(fullPath)) return true
      }
    }
  } catch { /* 跳过无权限子目录 */ }
  return false
}

function countSourceFiles(dir: string): number {
  let count = 0
  try {
    const entries = fs.readdirSync(dir)
    for (const e of entries) {
      if (SKIP_DIRS.has(e) || e.startsWith('.')) continue
      const fullPath = path.join(dir, e)
      const stat = fs.statSync(fullPath)
      if (stat.isFile()) {
        const ext = path.extname(e).replace('.', '')
        if (LANG_MAP[ext]) count++
      } else if (stat.isDirectory()) {
        count += countSourceFiles(fullPath)
      }
    }
  } catch { /* 跳过无权限子目录 */ }
  return count
}

function readConfig(dir: string): Record<string, any> {
  const config: Record<string, any> = {}
  const configFiles = ['package.json', 'tsconfig.json', 'Cargo.toml', 'pyproject.toml']
  for (const cf of configFiles) {
    const cfPath = path.join(dir, cf)
    if (fs.existsSync(cfPath)) {
      try {
        const content = fs.readFileSync(cfPath, 'utf-8')
        if (cf === 'package.json') {
          const pkg = JSON.parse(content)
          config.name = pkg.name
          config.version = pkg.version
          config.scripts = pkg.scripts ? Object.keys(pkg.scripts).slice(0, 10) : undefined
          config.dependencies = pkg.dependencies ? Object.keys(pkg.dependencies).slice(0, 20) : undefined
        } else if (cf === 'tsconfig.json') {
          const ts = JSON.parse(content)
          config.typescript = { strict: ts.compilerOptions?.strict, target: ts.compilerOptions?.target }
        }
      } catch { /* 配置文件解析失败，跳过 */ }
    }
  }
  return config
}

export function analyzeCodebase(dir: string): CodebaseStructure {
  const resolvedDir = path.resolve(dir)
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Directory not found: ${resolvedDir}`)
  }
  const stat = fs.statSync(resolvedDir)
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${resolvedDir}`)
  }
  const rootName = path.basename(resolvedDir)
  const language = detectLanguage(resolvedDir)
  const framework = detectFramework(resolvedDir)
  const entryPoints = findEntryPoints(resolvedDir, resolvedDir)
  const tree = scanDir(resolvedDir, resolvedDir, 0)
  const fileCount = countSourceFiles(resolvedDir)
  const moduleCount = tree.filter(m => m.type === 'directory').length
  const config = readConfig(resolvedDir)

  return {
    rootName,
    language,
    framework,
    entryPoints,
    moduleCount,
    fileCount,
    tree,
    config,
  }
}
