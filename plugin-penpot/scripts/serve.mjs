#!/usr/bin/env node
/**
 * 插件站点本地服务器
 *
 * Penpot 的插件是「由插件作者自己托管」的（官方文档原话），本脚本把 `dist/` 用作插件
 * 站点根目录，供 Penpot 插件管理器按 manifest URL 安装：
 *
 *   http://localhost:4400/manifest.json
 *
 * 为什么不用 `vite preview`：
 *   - 需要显式 CORS（Penpot 域名与插件站点不同源）
 *   - 需要明确的 manifest URL 提示，降低「装错地址」的概率
 *   - 零依赖，不额外增加安装负担
 *
 * 用法：
 *   node scripts/serve.mjs [--port 4405] [--host 127.0.0.1] [--root dist]
 *   环境变量：PENPOT_PLUGIN_PORT / PENPOT_PLUGIN_HOST
 *
 * 默认端口 4405 而非 4400：Penpot 官方 MCP 的插件站占用 4400–4403，
 * 同号会直接端口冲突（两边都想启插件站时没法共存）。
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)))

function readArg(flag) {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const PORT = Number(readArg('--port') || process.env.PENPOT_PLUGIN_PORT || 4405)
const HOST = readArg('--host') || process.env.PENPOT_PLUGIN_HOST || '127.0.0.1'

/** 站点根目录；`--root` 可指向 harness-dist 等非发布目录 */
const ROOT_DIR = readArg('--root')
  ? resolve(process.cwd(), readArg('--root'))
  : ROOT

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

/** 防目录穿越：必须落在 ROOT_DIR 内（用「目录 + 分隔符」做边界判断） */
function resolveSafe(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0])
  const target = resolve(normalize(join(ROOT_DIR, clean)))
  if (target !== ROOT_DIR && !target.startsWith(ROOT_DIR + sep)) return null
  return target
}

/**
 * 陈旧构建检测。
 *
 * 存下来的坑：本地源码改完、watch 构建中间态或忘了重新 build，Penpot 里加载的就是
 * 旧包，报出来的错（如 "xxx is not a function"）会在当前源码里找不到任何痕迹 ——
 * 排查方向全错。所以启动时直接比时间：产物比源码旧就大声警告。
 */
function checkStale() {
  const bundle = join(ROOT_DIR, 'plugin.js')
  if (!existsSync(bundle)) {
    console.log('  ⚠️  未找到 dist/plugin.js —— 先执行 yarn build')
    return
  }

  const bundleTime = statSync(bundle).mtimeMs
  const sourceRoot = resolve(ROOT, '..')
  let newest = 0
  let newestFile = ''

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (['dist', 'harness-dist', 'scripts', 'tests'].includes(entry.name)) continue
        walk(full)
        continue
      }
      if (!/\.(ts|vue|html|json)$/.test(entry.name)) continue
      const time = statSync(full).mtimeMs
      if (time > newest) {
        newest = time
        newestFile = full.replace(sourceRoot + sep, '')
      }
    }
  }

  for (const dir of ['lib', 'ui', 'messages', 'typings']) {
    const full = join(sourceRoot, dir)
    if (existsSync(full)) walk(full)
  }

  const ageSeconds = Math.round((newest - bundleTime) / 1000)
  if (newest > bundleTime + 1000) {
    console.log(`  ⚠️  产物比源码旧（${ageSeconds}s，最新：${newestFile}）—— 请先 yarn build`)
    console.log('      否则 Penpot 里跑的是旧包，报的错可能已在源码里不存在。')
  } else {
    const built = new Date(bundleTime).toLocaleTimeString('zh-CN', { hour12: false })
    console.log(`  产物       : dist/plugin.js（${built} 构建，与源码同步）`)
  }
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  let filePath = resolveSafe(req.url || '/')
  if (!filePath) {
    res.writeHead(403).end('Forbidden')
    return
  }

  try {
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, 'index.html')
    }
  } catch {
    /* fall through to 404 */
  }

  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`404 Not Found: ${req.url}\n\n插件站点根目录: ${ROOT_DIR}\n提示: 先执行 yarn build`)
    return
  }

  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error('')
    console.error(`  ❌ 端口 ${PORT} 已被占用 —— 插件站点启不来。`)
    console.error('     常见原因：Penpot 官方 MCP（npx @penpot/mcp）的插件站占着 4400–4403。')
    console.error(`     换个端口：node scripts/serve.mjs --port ${PORT + 5}`)
    console.error('')
    process.exit(1)
  }
  console.error(`  ❌ 插件站点启动失败: ${error.message}`)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  const manifestUrl = `http://${HOST}:${PORT}/manifest.json`
  console.log('')
  console.log('  mgMCP for Penpot — 插件站点已启动')
  console.log(`  根目录     : ${ROOT_DIR}`)
  console.log(`  监听       : http://${HOST}:${PORT}`)
  checkStale()
  console.log('')
  console.log('  在 Penpot 里安装：')
  console.log(`    1. 打开任意设计文件 → Plugins 菜单（⌘⌥P / Ctrl+Alt+P）`)
  console.log(`    2. 填入 manifest URL: ${manifestUrl}`)
  console.log(`    3. 打开插件面板，点「连接 MCP 服务端」（默认 hub 已是 15489 共联端口）`)
  console.log('')
  console.log('  注意：Chromium 142+ 访问 localhost 需要允许「私有网络访问」弹窗；')
  console.log('        Brave 需对本站点关闭 Shield。')
  console.log('')
})
