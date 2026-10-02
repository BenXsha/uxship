#!/usr/bin/env node
/**
 * uxship MCP Server 进程管理（单一实例守护）
 *
 * 背景：MasterGo 插件需要一个**常驻**的 WebSocket 服务端（默认 ws://localhost:15489），
 * 而 MCP 客户端（pi / opencode）通过 HTTP+SSE（默认 15490）连接。手动 `npm run dev`
 * 容易忘记启动，且在多个终端里同时启动会互相抢端口（服务端启动时会 killPort）。
 *
 * 本脚本把「确保有一个、且只有一个服务端在跑」这件事收敛成一处：
 * - ensure   ：没在跑就 detached 拉起（父进程退出后依然存活），已在跑则直接返回
 * - status   ：打印端口、/health、插件是否已连接、PID 与日志路径
 * - start    ：强制启动（已在跑则报错退出）
 * - stop     ：停止（优先 PID 文件，回退按端口 lsof）
 * - restart  ：stop + start
 *
 * 并发安全：用 `.uxship/server.lock` 目录（mkdir 原子）做互斥，抢不到锁的一方
 * 只等待（不重复拉起）；锁超过 90s 视为陈旧可抢占。
 *
 * 可用环境变量覆盖：
 *   UXSHIP_MCP_HOME   服务端目录（默认仓库内 mcp-server）
 *   UXSHIP_MCP_NODE   node 可执行文件（默认当前 node）
 *   UXSHIP_MCP_PROFILE 工具面 profile（gen / core / design / tokens / ops / agent / full，可逗号组合）
 *                       默认 gen（20 个工具 / 线上约 1.7 万字符）；全量需显式写 full（67 个 / ≈35.6k 字符）
 *   HTTP_PORT / WS_PORT 端口（默认 15490 / 15489）
 *
 * 用法：node scripts/uxship-server.mjs <ensure|status|start|stop|restart> [--json]
 */
import { spawn, execFileSync } from 'node:child_process'
import { promises as fs, openSync, closeSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { createConnection } from 'node:net'
import { get } from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import os from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..')

export const HTTP_PORT = Number(process.env.HTTP_PORT || 15490)
export const WS_PORT = Number(process.env.WS_PORT || 15489)
export const SERVER_HOME = resolve(process.env.UXSHIP_MCP_HOME || join(ROOT_DIR, 'mcp-server'))
export const NODE_BIN = process.env.UXSHIP_MCP_NODE || process.execPath

const STATE_DIR = join(SERVER_HOME, '.uxship')
/** 记录上次启动使用的工具面 profile（status 显示用） */
export const PROFILE_FILE = join(STATE_DIR, 'profile')
const LOCK_DIR = join(STATE_DIR, 'server.lock')
const PID_FILE = join(STATE_DIR, 'server.pid')
const OUT_LOG = join(STATE_DIR, 'server.out.log')
const ERR_LOG = join(STATE_DIR, 'server.err.log')
const ENTRY = join(SERVER_HOME, 'dist', 'index.js')

const LOCK_STALE_MS = 90_000

function log(...args) {
  if (!process.argv.includes('--json')) console.log(...args)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** 端口是否有进程在监听 */
export function isListening(port, timeout = 400) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const done = (result) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** 请求 /health，返回 JSON 或 null */
export function probeHealth(port = HTTP_PORT, timeout = 800) {
  return new Promise((resolve) => {
    const req = get({ host: '127.0.0.1', port, path: '/health', timeout }, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          resolve(parsed && parsed.status === 'ok' ? parsed : null)
        } catch {
          resolve(null)
        }
      })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
  })
}

async function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await probeHealth(port, 800)
    if (health) return health
    await sleep(400)
  }
  return null
}

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
}

/** 抢占锁：返回 true 表示由本进程负责拉起 */
function acquireLock() {
  ensureStateDir()
  try {
    mkdirSync(LOCK_DIR)
    writeFileSync(join(LOCK_DIR, 'owner'), `${process.pid} ${new Date().toISOString()}\n`)
    return true
  } catch (err) {
    if (err.code !== 'EEXIST') throw err
  }

  // 陈旧锁（超时未释放）→ 抢占一次
  try {
    const age = Date.now() - statSync(LOCK_DIR).mtimeMs
    if (age > LOCK_STALE_MS) {
      rmSync(LOCK_DIR, { recursive: true, force: true })
      mkdirSync(LOCK_DIR)
      writeFileSync(join(LOCK_DIR, 'owner'), `${process.pid} ${new Date().toISOString()} (stale-takeover)\n`)
      return true
    }
  } catch {
    /* 竞态下让别人赢 */
  }
  return false
}

function releaseLock() {
  try {
    rmSync(LOCK_DIR, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

/** 读取 PID 文件（不存在/已失效返回 null） */
export function readPid() {
  try {
    const pid = Number(readFileSync(PID_FILE, 'utf-8').trim())
    if (!Number.isFinite(pid) || pid <= 0) return null
    process.kill(pid, 0)
    return pid
  } catch {
    return null
  }
}

/** 端口占用者 PID（回退手段） */
function pidOnPort(port) {
  try {
    const out = execFileSync('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], { encoding: 'utf-8' }).trim()
    const pid = Number(out.split('\n').filter(Boolean)[0])
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

function spawnServer({ httpPort, wsPort, profile }) {
  // 显式传入（CLI --profile 或环境变量）才注入；否则**不设**，让服务端用自身的
  // `DEFAULT_PROFILE`（gen，见 mcp-server/src/utils/tool-profiles.ts）
  // —— 默认值只应存一份，在这里再写一个字面量就等着两边漂。
  const explicitProfile = profile || process.env.UXSHIP_MCP_PROFILE || ''
  if (!existsSync(ENTRY)) {
    throw new Error(`未找到服务端入口：${ENTRY}（先执行 npm run build:server）`)
  }
  ensureStateDir()
  const outFd = openSync(OUT_LOG, 'a')
  const errFd = openSync(ERR_LOG, 'a')

  const child = spawn(NODE_BIN, [ENTRY], {
    cwd: SERVER_HOME,
    detached: true, // 与当前终端/agent 解耦：pi 退出后继续存活
    stdio: ['ignore', outFd, errFd],
    env: {
      ...process.env,
      HTTP_PORT: String(httpPort),
      WS_PORT: String(wsPort),
      UXSHIP_MODE: process.env.UXSHIP_MODE || 'auto',
      LOG_LEVEL: process.env.LOG_LEVEL || 'INFO',
      // 工具面 profile：不注入就是服务端的默认（gen）
      ...(explicitProfile ? { UXSHIP_MCP_PROFILE: explicitProfile } : {}),
    },
  })
  child.unref()
  closeSync(outFd)
  closeSync(errFd)

  if (child.pid) {
    writeFileSync(PID_FILE, `${child.pid}\n`)
    // 记下本次启动用的 profile，供 status 显示（子进程可能由别的终端用不同 env 启动）
    writeFileSync(PROFILE_FILE, `${explicitProfile || 'default'}\n`)
  }
  return child.pid
}

/**
 * 确保服务端在跑：
 * - 已在跑 → { started: false, status: 'already-running' }
 * - 别的进程正在拉 → 等待就绪 → { started: false, status: 'started-by-other' }
 * - 端口被非本服务占用 → { ok: false, reason: 'port-in-use-by-other' }（绝不 kill）
 */
export async function ensureRunning({ httpPort = HTTP_PORT, wsPort = WS_PORT, profile } = {}) {
  const existing = await probeHealth(httpPort)
  if (existing) return { ok: true, started: false, status: 'already-running', health: existing }

  if (await isListening(httpPort)) {
    // 端口被占但没有 /health 响应：
    // - PID 文件指向我们自己的进程 → 疑似卡死/半死，重启它
    // - 否则 → 视为别人的程序，绝不 kill（避免误杀）
    const ownPid = readPid()
    if (ownPid) {
      await stopServer({ httpPort })
    } else {
      return {
        ok: false,
        started: false,
        reason: 'port-in-use-by-other',
        message: `端口 ${httpPort} 已被其它进程占用，且 /health 不是 uxship MCP Server（不自动 kill，避免误杀）`,
      }
    }
  }

  if (!acquireLock()) {
    // 其它终端正在拉起：等它就绪
    const health = await waitForHealth(httpPort, 20_000)
    return health
      ? { ok: true, started: false, status: 'started-by-other', health }
      : { ok: false, started: false, reason: 'lock-held-but-not-ready', message: '另一个进程持有启动锁但服务端未就绪' }
  }

  try {
    // 双检：等锁期间别人可能已经拉起来了
    const again = await probeHealth(httpPort)
    if (again) return { ok: true, started: false, status: 'already-running', health: again }

    const pid = spawnServer({ httpPort, wsPort, profile })
    const health = await waitForHealth(httpPort, 25_000)
    if (!health) {
      return { ok: false, started: true, pid, reason: 'not-ready', message: `已拉起 PID ${pid}，但 ${httpPort} 在 25s 内未就绪，请查看 ${ERR_LOG}` }
    }
    return { ok: true, started: true, status: 'started-by-us', pid, health }
  } finally {
    releaseLock()
  }
}

/** 停止服务端（PID 文件优先，回退端口） */
export async function stopServer({ httpPort = HTTP_PORT } = {}) {
  const pid = readPid() ?? pidOnPort(httpPort)
  if (!pid) {
    const running = await probeHealth(httpPort)
    return running
      ? { ok: false, reason: 'pid-unknown', message: `服务端在跑（${httpPort}）但找不到 PID` }
      : { ok: true, stopped: false, status: 'not-running' }
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch (err) {
    if (err.code !== 'ESRCH') throw err
  }

  for (let i = 0; i < 25; i++) {
    if (!(await isListening(httpPort))) {
      try {
        rmSync(PID_FILE, { force: true })
      } catch {
        /* ignore */
      }
      return { ok: true, stopped: true, pid }
    }
    await sleep(200)
  }
  return { ok: false, stopped: false, pid, reason: 'still-listening', message: `PID ${pid} 未在 5s 内退出` }
}

const COMMANDS = new Set(['ensure', 'status', 'start', 'stop', 'restart'])

/**
 * 读取运行中服务端的 profile。
 * 只认启动时写入的 PROFILE_FILE —— **不要**回退到 process.env：
 * 那显示的是当前 shell 的环境变量，而不是正在运行的那个进程的，会误导。
 */
function readProfile() {
  try {
    if (existsSync(PROFILE_FILE)) return readFileSync(PROFILE_FILE, 'utf-8').trim() || null
  } catch {}
  return null
}

function printStatus(health, extra = {}) {
  const lines = []
  lines.push(`服务端目录: ${SERVER_HOME}`)
  lines.push(`node:      ${NODE_BIN}`)
  lines.push(`端口:      http=${HTTP_PORT} ws=${WS_PORT}`)
  if (health) {
    lines.push(`状态:      运行中 ✅  backendMode=${health.backendMode}  插件已连接=${health.pluginConnected ? '是' : '否'}  监听=${health.host ?? '127.0.0.1'}  鉴权=${health.authRequired ? '已启用' : '未启用'}  uptime=${Math.round(health.uptime)}s`)
    lines.push(`PID:       ${readPid() ?? pidOnPort(HTTP_PORT) ?? '未知'}`)
    const profile = readProfile()
    if (!profile) {
      lines.push('工具面:    profile 未记录（该进程启动于本功能上线前，重启后有记录）')
    } else if (profile === 'default') {
      lines.push('工具面:    profile=默认（gen，20 个工具；要全量用 UXSHIP_MCP_PROFILE=full 重启）')
    } else {
      lines.push(
        `工具面:    profile=${profile}${profile === 'full' ? '（全部工具）' : '（按任务精简暴露；可用 mcp_tools 临时启用更多）'}`
      )
    }
  } else {
    lines.push('状态:      未运行 ❌')
  }
  if (extra.message) lines.push(`说明:      ${extra.message}`)
  lines.push(`日志:      ${OUT_LOG}`)
  lines.push(`           ${ERR_LOG}`)
  console.log(lines.join('\n'))
}

async function main() {
  const cmd = (process.argv[2] || 'ensure').toLowerCase()
  const asJson = process.argv.includes('--json')
  const profileFlagIndex = process.argv.indexOf('--profile')
  const profile = profileFlagIndex > 0 ? process.argv[profileFlagIndex + 1] : undefined
  if (profileFlagIndex > 0 && !profile) {
    console.error('--profile 需要取值：gen|core|design|tokens|ops|agent|full（可逗号组合，设计生成推荐 gen）')
    process.exit(2)
  }
  if (!COMMANDS.has(cmd)) {
    console.error(`未知命令：${cmd}\n用法：node scripts/uxship-server.mjs <${[...COMMANDS].join('|')}> [--json]`)
    process.exit(2)
  }

  let result
  switch (cmd) {
    case 'ensure':
      result = await ensureRunning({ profile })
      break
    case 'status': {
      const health = await probeHealth()
      result = { ok: !!health, running: !!health, health, pid: readPid() ?? pidOnPort(HTTP_PORT) }
      break
    }
    case 'start': {
      const existing = await probeHealth()
      result = existing
        ? { ok: false, reason: 'already-running', health: existing }
        : await ensureRunning({ profile })
      break
    }
    case 'stop':
      result = await stopServer()
      break
    case 'restart':
      result = { stopped: await stopServer(), started: await ensureRunning({ profile }) }
      break
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2))
  } else if (cmd === 'status') {
    printStatus(result.health, result)
  } else if (cmd === 'ensure' || cmd === 'start') {
    if (result.ok) {
      const verb = result.started ? `已启动（PID ${result.pid}）` : result.status === 'already-running' ? '已在运行' : '其它终端已启动'
      console.log(`✅ uxship MCP Server ${verb}：http://localhost:${HTTP_PORT}/sse，插件通道 ws://localhost:${WS_PORT}`)
    } else {
      console.error(`❌ ${result.message || result.reason}`)
      process.exitCode = 1
    }
  } else if (cmd === 'stop') {
    console.log(result.ok ? `✅ 已停止${result.pid ? `（PID ${result.pid}）` : ''}` : `❌ ${result.message || result.reason}`)
    if (!result.ok) process.exitCode = 1
  } else if (cmd === 'restart') {
    console.log(JSON.stringify(result, null, 2))
  }

  // 保证进程能退出（被 unref 的子进程不会阻止退出）
  process.exit(process.exitCode ?? 0)
}

// 仅在直接执行时跑 CLI（被 import 时只导出函数）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[uxship-server] ${err?.message || err}`)
    releaseLock()
    process.exit(1)
  })
}

// 供扩展 import 的聚合入口（扩展里只需调用这一个）
export async function ensureServerForAgent() {
  return ensureRunning()
}

export const paths = { SERVER_HOME, ENTRY, OUT_LOG, ERR_LOG, STATE_DIR, LOCK_DIR, PID_FILE }
export { waitForHealth }
