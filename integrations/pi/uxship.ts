/**
 * uxship.ts — pi 扩展：自动确保 MasterGo MCP Server 常驻
 *
 * 解决的问题：MasterGo 插件需要一个**常驻**的 WebSocket 服务端（默认 ws://localhost:15489），
 * MCP 客户端（pi / opencode）通过 HTTP+SSE（默认 15490）连接。以前每次都得手动
 * `npm run dev`；一旦忘记，插件就连不上。
 *
 * 本扩展在每次 `session_start` 时调用仓库里的 `scripts/uxship-server.mjs ensure`：
 * - 已在运行 → 什么都不做（多个 pi 终端同时开着也只有一个服务端）
 * - 未运行 → 以 detached 方式拉起，**pi 退出后依然存活**（插件连接不中断）
 * - 端口被别的程序占用 → 只告警，绝不 kill（避免误杀）
 *
 * 并发安全由脚本内的目录锁保证（多个终端同时启动时只有一个会真正拉起，其它只等待）。
 *
 * 手动管理：`/uxship-server [status|start|stop|restart]`，或仓库命令
 * `npm run server:status|server:ensure|server:stop|server:restart`。
 *
 * 可用环境变量覆盖脚本路径：UXSHIP_MCP_SCRIPT
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// __UXSHIP_REPO__ 由 `npm run pi:install-extension` 替换为本仓库绝对路径
const SCRIPT_PATH =
  process.env.UXSHIP_MCP_SCRIPT || '__UXSHIP_REPO__/scripts/uxship-server.mjs'

const STATE_DIR = join(homedir(), '.pi', 'agent', 'state')
const LOG_FILE = join(STATE_DIR, 'uxship.log')

/** session_start 里最多等多久（保证不卡住启动；超时后后台继续） */
const ENSURE_TIMEOUT_MS = 15_000

function record(line: string): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* 日志失败不影响主流程 */
  }
}

type EnsureResult = {
  ok: boolean
  started?: boolean
  status?: string
  reason?: string
  message?: string
  pid?: number
  health?: { pluginConnected?: boolean; backendMode?: string; uptime?: number }
}

async function loadManager(): Promise<any> {
  return import(pathToFileURL(SCRIPT_PATH).href)
}

async function ensureRunning(): Promise<EnsureResult> {
  const mod = await loadManager()
  return (await mod.ensureRunning()) as EnsureResult
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

function summarize(result: EnsureResult): string {
  if (result.ok) {
    const how =
      result.started
        ? `已自动启动（PID ${result.pid}）`
        : result.status === 'already-running'
          ? '已在运行'
          : result.status === 'started-by-other'
            ? '由其它终端启动'
            : '就绪'
    const plugin = result.health?.pluginConnected ? '插件已连接' : '插件未连接（请在 MasterGo 里打开 plugin-mastergo）'
    return `MasterGo MCP Server ${how} · ${plugin}`
  }
  return `MasterGo MCP Server 未就绪：${result.message || result.reason || '未知原因'}`
}

export default function (pi: any) {
  // 会话启动时确保服务端在跑（新开会话 / reload / resume 都会触发）
  pi.on('session_start', async (_event: any, ctx: any) => {
    try {
      const result = await withTimeout(ensureRunning(), ENSURE_TIMEOUT_MS)
      if (!result) {
        record('ensure: timeout, still running in background')
        ctx.ui?.notify?.('MasterGo MCP Server 仍在后台启动中…', 'info')
        return
      }
      record(`ensure: ${JSON.stringify(result)}`)
      // 已经在跑是最常见情况，保持安静；只有「刚拉起」或「失败」才提示
      if (result.started) ctx.ui?.notify?.(summarize(result), 'info')
      else if (!result.ok) ctx.ui?.notify?.(summarize(result), 'error')
    } catch (err: any) {
      record(`ensure: failed ${err?.message || err}`)
      ctx.ui?.notify?.(`MasterGo MCP Server 自动启动失败：${err?.message || err}`, 'error')
    }
  })

  // 手动管理：/uxship-server status | start | stop | restart
  pi.registerCommand('uxship-server', {
    description: '查看/管理 MasterGo MCP Server（status | start | stop | restart）',
    handler: async (args: string, ctx: any) => {
      const action = (args || 'status').trim().split(/\s+/)[0]
      try {
        const mod = await loadManager()
        if (action === 'status') {
          const health = await mod.probeHealth()
          const pid = mod.readPid?.()
          const text = health
            ? `运行中 ✅ backendMode=${health.backendMode} · 插件${health.pluginConnected ? '已连接' : '未连接'} · uptime=${Math.round(health.uptime)}s · PID=${pid ?? '未知'}`
            : '未运行 ❌（用 /uxship-server start 启动）'
          record(`status: ${JSON.stringify({ health, pid })}`)
          ctx.ui?.notify?.(text, health ? 'info' : 'error')
        } else if (action === 'start') {
          const result = await ensureRunning()
          record(`start: ${JSON.stringify(result)}`)
          ctx.ui?.notify?.(summarize(result), result.ok ? 'info' : 'error')
        } else if (action === 'stop') {
          const result = await mod.stopServer()
          record(`stop: ${JSON.stringify(result)}`)
          ctx.ui?.notify?.(
            result.ok ? `已停止${result.pid ? `（PID ${result.pid}）` : ''}，插件将失去连接` : `停止失败：${result.message || result.reason}`,
            result.ok ? 'info' : 'error',
          )
        } else if (action === 'restart') {
          const stopped = await mod.stopServer()
          const started = await ensureRunning()
          record(`restart: ${JSON.stringify({ stopped, started })}`)
          ctx.ui?.notify?.(summarize(started), started.ok ? 'info' : 'error')
        } else {
          ctx.ui?.notify?.(`未知子命令 "${action}"，可用：status | start | stop | restart`, 'error')
        }
      } catch (err: any) {
        record(`command ${action}: failed ${err?.message || err}`)
        ctx.ui?.notify?.(`管理命令失败：${err?.message || err}`, 'error')
      }
    },
  })
}
