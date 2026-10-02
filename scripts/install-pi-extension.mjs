#!/usr/bin/env node
/**
 * 把 pi 自动启动扩展安装到 ~/.pi/agent/extensions/
 *
 * 作用：把 integrations/pi/uxship.ts 复制到 pi 的全局扩展目录，并把
 * `__UXSHIP_REPO__` 占位符替换成本仓库的绝对路径（团队每个人的仓库路径不同）。
 *
 * 安装后：pi 每次 session_start 会自动 `ensure` uxship MCP Server（多终端只拉起一个，
 * 且 detached 存活），并提供 `/uxship-server status|start|stop|restart` 命令。
 *
 * 用法：
 *   node scripts/install-pi-extension.mjs            # 安装/覆盖
 *   node scripts/install-pi-extension.mjs --print    # 只打印将写入的内容
 *   PI_EXTENSIONS_DIR=/path/to/dir node scripts/install-pi-extension.mjs
 */
import { promises as fs, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import os from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..')
const SOURCE = join(ROOT_DIR, 'integrations', 'pi', 'uxship.ts')
const EXTENSION_NAME = 'uxship.ts'
const TARGET_DIR =
  process.env.PI_EXTENSIONS_DIR || join(os.homedir(), '.pi', 'agent', 'extensions')
const TARGET = join(TARGET_DIR, EXTENSION_NAME)

const printOnly = process.argv.includes('--print')

async function main() {
  if (!existsSync(SOURCE)) {
    console.error(`❌ 未找到扩展源文件：${SOURCE}`)
    process.exit(1)
  }

  const content = (await fs.readFile(SOURCE, 'utf-8')).replaceAll('__UXSHIP_REPO__', ROOT_DIR)

  if (printOnly) {
    console.log(content)
    return
  }

  await fs.mkdir(TARGET_DIR, { recursive: true })

  // 已存在同内容则跳过（避免无意义改动）
  const existing = existsSync(TARGET) ? await fs.readFile(TARGET, 'utf-8') : null
  if (existing === content) {
    console.log(`✅ 已是最新：${TARGET}`)
    return
  }

  await fs.writeFile(TARGET, content, 'utf-8')
  console.log(`✅ 已安装 pi 扩展：${TARGET}`)
  console.log(`   仓库路径已注入：${ROOT_DIR}`)
  console.log('   下一步：在 pi 里执行 /reload（或新开一个 pi 会话）生效')
  console.log('   手动管理：/uxship-server status|start|stop|restart')
}

main().catch((err) => {
  console.error(`[install-pi-extension] ${err?.message || err}`)
  process.exit(1)
})
