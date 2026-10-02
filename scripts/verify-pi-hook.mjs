#!/usr/bin/env node
/**
 * pi 启动钩子自检
 *
 * 钩子（`integrations/pi/uxship.ts` → 安装到 `~/.pi/agent/extensions/`）对用户的承诺只有一句
 * 「打开 pi 就别管服务端了」，但它背后压着三条不变量 —— 任意一条破了，症状都是**用户侧的**：
 *   1. **幂等**     —— 已在跑时只探测、不重复拉起（同时开 N 个 pi 终端，也只有一个服务端）
 *   2. **并发独占** —— N 个终端同时启动时只有一个真正拉起，其余等它就绪（靠目录锁）
 *   3. **不误杀**   —— 端口被陌生程序占用时只告警，绝不 kill（避免杀掉别人的进程）
 * 外加两条：钩子确实注册在 `session_start` 上；未运行时确实能把服务端拉起来。
 *
 * ⚠️ 全部检查跑在**备用端口**上（默认 15891/15892，陌生端口 15893），因此**不碰**
 * 正在服务的 15489/15490 —— 跑自检不会踢掉 Penpot / MasterGo 插件的连接。
 * 检查顺序也是刻意的：「陌生端口」一条排在任何实例启动**之前**，因为 PID 文件不区分端口
 * （见文件末「已知边界」），带着自己人的 PID 去查陌生端口会走进「先 stop 再拉起」那条路。
 *
 * 用法：
 *   node scripts/verify-pi-hook.mjs                 # 默认端口组
 *   node scripts/verify-pi-hook.mjs --http-port 15891 --ws-port 15892 --foreign-port 15893
 *   node scripts/verify-pi-hook.mjs --json
 * 退出码：0 全过 / 1 有失败 / 2 用法错误
 */
import { spawn } from 'node:child_process'
import { existsSync, renameSync, rmSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..')
const MANAGER = join(ROOT_DIR, 'scripts', 'uxship-server.mjs')
const EXTENSION = join(
  process.env.PI_EXTENSIONS_DIR || join(homedir(), '.pi', 'agent', 'extensions'),
  'uxship.ts',
)

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  if (i === -1) return fallback
  const value = args[i + 1]
  if (!value || value.startsWith('--')) {
    console.error(`❌ ${name} 需要取值`)
    process.exit(2)
  }
  return value
}

const HTTP_PORT = Number(flag('--http-port', 15891))
const WS_PORT = Number(flag('--ws-port', 15892))
const FOREIGN_PORT = Number(flag('--foreign-port', 15893))

// 必须在 import 管理器/hook 之前设置：两者都在模块顶层读 env（见 uxship-server.mjs 顶部）
process.env.HTTP_PORT = String(HTTP_PORT)
process.env.WS_PORT = String(WS_PORT)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isListening = (port) =>
  new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const settle = (value) => {
      socket.removeAllListeners()
      socket.destroy()
      done(value)
    }
    socket.setTimeout(400)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail })
  if (!asJson) console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `\n     ${detail}` : ''}`)
}

/** 跑一次 CLI ensure（子进程），返回解析后的 JSON */
function ensureInChild() {
  return new Promise((done) => {
    const child = spawn(process.execPath, [MANAGER, 'ensure', '--json'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('close', () => {
      try {
        done(JSON.parse(out))
      } catch {
        done({ ok: false, reason: 'unparsable', message: (err || out).trim().slice(0, 300) })
      }
    })
  })
}

// ── 把 PID 文件挪开：它不区分端口（见文件末「已知边界」），
//    否则「陌生端口」那条检查会按它去 stop，把别的端口上的自己人停掉 ──
const STATE_DIR = join(ROOT_DIR, 'mcp-server', '.uxship')
const PID_FILE = join(STATE_DIR, 'server.pid')
const PID_BACKUP = join(STATE_DIR, 'server.pid.verify-bak')
let pidStashed = false
// 上一次自检若崩在 cleanup 之前会留下备份：它指向的进程早已不在，
// 留着会让下一次 restore 把「过期 PID」当成真状态还回去。先清掉。
if (existsSync(PID_BACKUP)) rmSync(PID_BACKUP, { force: true })
if (existsSync(PID_FILE)) {
  rmSync(PID_BACKUP, { force: true })
  renameSync(PID_FILE, PID_BACKUP)
  pidStashed = true
}

const manager = await import(pathToFileURL(MANAGER).href)
let foreignServer = null

async function cleanup() {
  try {
    await manager.stopServer({ httpPort: HTTP_PORT })
  } catch {
    /* ignore */
  }
  if (foreignServer) {
    // 刻意不 await 回调：Server.close() 要等已有连接结束，而探测用的那个连接可能还挂着 ——
    // 等它就成了「顶层 await 永不落地」（Node 直接以 13 退出）。这里只需不再监听。
    try {
      foreignServer.close()
      foreignServer.unref()
    } catch {
      /* ignore */
    }
    foreignServer = null
  }
  if (pidStashed) {
    try {
      rmSync(PID_FILE, { force: true })
      renameSync(PID_BACKUP, PID_FILE)
    } catch {
      /* ignore */
    }
    pidStashed = false
  }
}

async function main() {
  // ── 0. 前置：备用端口必须是空的（否则后面的结论都不成立）──
  const busy = []
  for (const port of [HTTP_PORT, WS_PORT, FOREIGN_PORT]) {
    if (await isListening(port)) busy.push(port)
  }
  if (busy.length) {
    check(
      `备用端口空闲（${HTTP_PORT}/${WS_PORT}/${FOREIGN_PORT}）`,
      false,
      `已被占用: ${busy.join(', ')} —— 用 --http-port/--ws-port/--foreign-port 换一组`,
    )
    return
  }

  // ── 1. 钩子注册 ──
  if (!existsSync(EXTENSION)) {
    check('钩子已安装', false, `未找到 ${EXTENSION}（先跑 npm run pi:install-extension）`)
    return
  }
  const handlers = {}
  const commands = {}
  const mod = await import(pathToFileURL(EXTENSION).href)
  mod.default({
    on: (event, fn) => {
      handlers[event] = fn
    },
    registerCommand: (name, spec) => {
      commands[name] = spec
    },
  })
  check(
    '钩子注册在 session_start 上',
    typeof handlers.session_start === 'function',
    `已注册事件: ${Object.keys(handlers).join(', ') || '(无)'} · 命令: /${Object.keys(commands).join(', /') || '(无)'}`,
  )
  if (typeof handlers.session_start !== 'function') return

  // ── 2. 陌生进程占端口时绝不抢占（必须在任何实例启动之前跑，见文件末）──
  foreignServer = createServer(() => {})
  await new Promise((r) => foreignServer.listen(FOREIGN_PORT, '127.0.0.1', r))
  const refused = await manager.ensureRunning({ httpPort: FOREIGN_PORT, wsPort: WS_PORT })
  check(
    '端口被陌生进程占用时拒绝启动',
    refused.ok === false && refused.reason === 'port-in-use-by-other',
    `ensure → ok=${refused.ok} reason=${refused.reason}${refused.message ? ` · ${refused.message}` : ''}`,
  )
  check('陌生进程未被误杀', await isListening(FOREIGN_PORT), `仍在监听 ${FOREIGN_PORT}`)

  // ── 3. 未运行时，钩子把服务端拉起来 ──
  const notices = []
  await handlers.session_start({}, { ui: { notify: (msg, level) => notices.push({ msg, level }) } })
  const startedByHook = notices.find((n) => /已自动启动/.test(n.msg))
  check(
    '未运行时由钩子自动拉起',
    Boolean(startedByHook) && (await isListening(HTTP_PORT)),
    startedByHook ? startedByHook.msg : `钩子未上报启动（notify: ${JSON.stringify(notices)}）`,
  )

  // ── 4. 幂等：已在跑时不再拉一个、也不再打扰用户 ──
  const idle = await manager.ensureRunning({ httpPort: HTTP_PORT, wsPort: WS_PORT })
  check(
    '已在运行时幂等（不重复启动）',
    idle.ok === true && idle.started === false && idle.status === 'already-running',
    `ensure → started=${idle.started} status=${idle.status}`,
  )
  const quiet = []
  await handlers.session_start({}, { ui: { notify: (msg, level) => quiet.push({ msg, level }) } })
  check('已在运行时钩子保持安静（不刷通知）', quiet.length === 0, quiet.length ? JSON.stringify(quiet) : '无通知')

  // ── 5. 并发独占：5 个终端同时 ensure，只有一个真正拉起 ──
  await manager.stopServer({ httpPort: HTTP_PORT })
  const runs = await Promise.all(Array.from({ length: 5 }, () => ensureInChild()))
  const starters = runs.filter((r) => r.started === true)
  check(
    '5 个终端并发启动，只有 1 个真正拉起',
    starters.length === 1 && runs.every((r) => r.ok) && (await isListening(HTTP_PORT)),
    `started=true 的个数=${starters.length}（PID ${starters.map((r) => r.pid).join(',') || '-'}）· 状态分布=${JSON.stringify(runs.map((r) => r.status ?? r.reason))}`,
  )
}

try {
  await main()
} catch (error) {
  check('自检执行未抛异常', false, String(error?.stack || error))
}
await cleanup()
await sleep(50)

const failed = results.filter((r) => !r.ok)
if (asJson) {
  console.log(
    JSON.stringify(
      { ok: failed.length === 0, ports: { HTTP_PORT, WS_PORT, FOREIGN_PORT }, results },
      null,
      2,
    ),
  )
} else {
  console.log(
    failed.length
      ? `\n❌ pi 启动钩子自检失败（${failed.length}/${results.length}）—— 未通过：${failed.map((r) => r.name).join('；')}`
      : `\n🎉 pi 启动钩子自检全部通过（${results.length} 项）· 全程只用 ${HTTP_PORT}/${WS_PORT}/${FOREIGN_PORT}，未触碰 15489/15490`,
  )
}
process.exitCode = failed.length === 0 ? 0 : 1

/**
 * 已知边界（自检已规避，值得知道）：
 * `uxship-server.mjs` 的 PID 文件 / 锁 / profile 都**不区分端口**，设计前提是
 * 「同一时间只有一个实例」。于是若带着自己人的 PID 去 ensure 一个**被陌生进程占着**的端口，
 * `ensureRunning` 会先 `stopServer()`（按 PID 文件，可能停在别的端口上的自己人）、
 * 再尝试在该端口拉起、最后卡到 25s 超时返回 `not-ready` —— 而不是直接的
 * `port-in-use-by-other`。单实例前提下这不会发生（端口唯一），多端口并存才需要给 PID 文件加端口维度。
 */
