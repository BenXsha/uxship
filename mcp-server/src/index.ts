#!/usr/bin/env node
/**
 * MasterGo MCP Server
 *
 * 支持两种运行模式：
 * - HTTP + WebSocket 模式：通过 HTTP API 供 AI IDE 调用
 * - STDIO 模式：通过标准输入输出与 MCP 客户端通信
 *
 * STDIO 消息链路：
 *   AI IDE -> stdin (JSON-RPC via SDK) -> Server -> MasterGo Plugin (WebSocket) -> stdout (JSON-RPC via SDK)
 */
import { WebSocketBridge } from './server/ws-bridge.js'
import { BridgeRouter } from './server/bridge-router.js'
import { SdkServer } from './server/sdk-server.js'
import { HttpServer } from './server/http-server.js'
import { BackendAdapter } from './utils/backend-adapter.js'
import { logger } from './utils/logger.js'

let isStdioMode = false

const originalConsoleLog = console.log
const originalConsoleError = console.error
const originalConsoleWarn = console.warn

function formatArg(a: unknown): string {
  if (a instanceof Error) {
    return `${a.name}: ${a.message}\n${a.stack || ''}`
  }
  if (typeof a === 'object') {
    try {
      return JSON.stringify(a)
    } catch {
      return String(a)
    }
  }
  return String(a)
}

console.log = (...args: unknown[]) => {
  const message = args.map(formatArg).join(' ')
  logger.info(message)
  if (!isStdioMode) {
    originalConsoleLog.apply(console, args)
  }
}

console.error = (...args: unknown[]) => {
  const message = args.map(formatArg).join(' ')
  logger.error(message)
  originalConsoleError.apply(console, args)
}

console.warn = (...args: unknown[]) => {
  const message = args.map(formatArg).join(' ')
  logger.warn(message)
  originalConsoleWarn.apply(console, args)
}

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    // Support --key=value format
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=')
      if (eqIdx > 0) {
        const key = arg.slice(0, eqIdx)
        const val = arg.slice(eqIdx + 1)
        if (key === '--http-port' || key === '-hp') { parsed.httpPort = val; continue }
        if (key === '--ws-port' || key === '-wp') { parsed.wsPort = val; continue }
        if (key === '--penpot-ws-port') { parsed.penpotWsPort = val; continue }
        if (key === '--penpot-disable') { parsed.penpotDisable = 'true'; continue }
        if (key === '--penpot-separate') { parsed.penpotSeparate = 'true'; continue }
        if (key === '--host' || key === '-H') { parsed.host = val; continue }
        if (key === '--connect-timeout' || key === '-ct') { parsed.connectTimeout = val; continue }
        if (key === '--backend' || key === '-b') { parsed.backend = val; continue }
        if (key === '--stdio' || key === '-s') { parsed.stdio = val; continue }
        if (key === '--help' || key === '-h') { printHelp(); process.exit(0) }
      }
    }
    if (arg === '--http-port' || arg === '-hp') {
      parsed.httpPort = args[++i]
    } else if (arg === '--ws-port' || arg === '-wp') {
      parsed.wsPort = args[++i]
    } else if (arg === '--penpot-ws-port') {
      parsed.penpotWsPort = args[++i]
    } else if (arg === '--penpot-disable') {
      parsed.penpotDisable = 'true'
    } else if (arg === '--penpot-separate') {
      parsed.penpotSeparate = 'true'
    } else if (arg === '--host' || arg === '-H') {
      parsed.host = args[++i]
    } else if (arg === '--stdio' || arg === '-s') {
      parsed.stdio = 'true'
    } else if (arg === '--connect-timeout' || arg === '-ct') {
      parsed.connectTimeout = args[++i]
    } else if (arg === '--backend' || arg === '-b') {
      parsed.backend = args[++i]
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
  }
  return parsed
}

function printHelp(): void {
  console.log(`
MasterGo MCP Server

Usage: mcp-server [options]

Options:
  --http-port, -hp <port>       HTTP 服务端口 (默认: 15490)
  --ws-port, -wp <port>         WebSocket 服务端口（默认: 15489，**同时服务 MasterGo 与 Penpot**）
  --penpot-ws-port <port>       改用分端口模式：Penpot 单独监听该端口（默认共联，不启此模式）
  --penpot-disable              不接 Penpot 客户端（仅 MasterGo）
  --host, -H <addr>             监听地址 (默认: 127.0.0.1，仅本机；跨机访问用 0.0.0.0 并务必配置 token)
  --stdio, -s                   以 STDIO 模式运行（供 MCP 客户端使用）
  --connect-timeout, -ct <sec>  等待后端连接的超时秒数 (默认: 30)
  --backend, -b <mode>          后端模式: auto(默认), http, plugin
  --help, -h                    显示帮助信息

环境变量:
  HTTP_PORT                     HTTP 服务端口
  WS_PORT                       WebSocket 服务端口（默认 15489）
  UXSHIP_MCP_SEPARATE_PORTS   设为 1 时分端口（此时 Penpot 用 PENPOT_WS_PORT，默认 4404）
  PENPOT_WS_PORT                分端口模式下 Penpot 的端口
  UXSHIP_PENPOT_DISABLE       设为 1 则不接 Penpot 客户端
  UXSHIP_MCP_DEFAULT_BACKEND  无显式会话时的默认后端: mastergo(默认) / penpot
  HOST                          监听地址 (默认 127.0.0.1)
  UXSHIP_MODE                 后端模式 (auto/http/plugin)
  UXSHIP_MCP_TOKEN            可选访问令牌；设置后 /sse /messages /mcp 需鉴权（/health 始终公开）
  UXSHIP_MCP_CORS_ORIGIN      可选 CORS 源（默认不发 CORS 头）

多后端说明:
  本服务端同时托管两个插件桥，两者讲同一套 JSON-RPC 协议:
  - MasterGo 插件 (plugin-mastergo)   → 会话前缀 sess_
  - Penpot 插件  (plugin-penpot) → 会话前缀 sess_penpot_
  默认两种插件都连 15489（单 hub，按 initialize 自述的后端分区）；
  initialize **不自述后端**的客户端在共联模式下不会被收编（宁可不给归属，也不猜）。
  工具调用按会话前缀自动路由；session_list 会同时列出两端（带 backend 字段）。
  都不在线时默认落 mastergo（保持历史行为），可用 UXSHIP_MCP_DEFAULT_BACKEND 覆盖。

STDIO 模式说明:
  通过标准输入输出处理 MCP 消息（使用 @modelcontextprotocol/sdk），适用于 Cursor、Claude 等 IDE
  IDE 配置: npx -y mcp-server --stdio

  启动后自动检测 MasterGo 桌面端：
  - 如果检测到桌面端 HTTP API (端口 50678)，自动使用 HTTP 模式
  - 否则等待 plugin-mastergo 插件通过 WebSocket 连接

HTTP 模式说明:
  启动 HTTP + WebSocket 服务器，供外部 HTTP/SSE 调用
`)
}

/**
 * 创建多后端桥路由器。
 *
 * **默认：共联单 hub** —— 一个端口（15489）同时接 MasterGo 与 Penpot 两种插件，
 * initialize 自述的后端决定会话前缀（`sess_` / `sess_penpot_`），路由照旧按最长前缀。
 * 理由：用户只需记一个端口；而两种插件讲的是同一套协议，没必要分两个监听。
 * 代价：后端归属依赖客户端自述（未自述者一律**不收编**）。
 *
 * **可选：分端口**（`UXSHIP_MCP_SEPARATE_PORTS=1` 或 `--penpot-ws-port`）——
 * 端口即后端判别（不可伪造），排障时两条链互不干扰。
 *
 * `UXSHIP_PENPOT_DISABLE=1` / `--penpot-disable`：完全不接 Penpot 客户端。
 */
function createBridgeRouter(
  wsPort: number,
  host: string,
  penpotOptions?: { port: number; disabled: boolean; separate?: boolean },
): { router: BridgeRouter; mastergo: WebSocketBridge; penpot: WebSocketBridge | null } {
  const router = new BridgeRouter({
    defaultBackend: process.env.UXSHIP_MCP_DEFAULT_BACKEND === 'penpot' ? 'penpot' : undefined,
  })

  const disablePenpot = penpotOptions?.disabled === true
  const accepted = disablePenpot ? ['mastergo' as const] : (['mastergo', 'penpot'] as const)

  if (penpotOptions?.separate && !disablePenpot) {
    const mastergo = new WebSocketBridge({ backend: 'mastergo' })
    mastergo.start(wsPort, host)
    router.register('mastergo', mastergo)

    const penpot = new WebSocketBridge({ backend: 'penpot' })
    penpot.start(penpotOptions.port, host)
    router.register('penpot', penpot)

    logger.info('多后端模式：分端口', { mastergo: wsPort, penpot: penpotOptions.port })
    return { router, mastergo, penpot }
  }

  // 共联单 hub
  const hub = new WebSocketBridge({ backend: 'mastergo', acceptedBackends: [...accepted] })
  hub.start(wsPort, host)
  router.register('mastergo', hub)
  if (!disablePenpot) router.register('penpot', hub)

  logger.info('多后端模式：共联单 hub', {
    port: wsPort,
    backends: disablePenpot ? 'mastergo（Penpot 已禁用）' : 'mastergo + penpot',
  })
  return { router, mastergo: hub, penpot: disablePenpot ? null : hub }
}

async function startHttpMode(httpPort: number, wsPort: number, connectTimeoutSec?: number, backendMode?: string, host = '127.0.0.1', penpotOptions?: { port: number; disabled: boolean }): Promise<void> {
  logger.info('Starting MasterGo MCP Server', { mode: 'HTTP+WS', httpPort, wsPort, host })

  if (backendMode) {
    process.env.UXSHIP_MODE = backendMode
  }

  const { router } = createBridgeRouter(wsPort, host, penpotOptions)
  const bridge = router

  const sdkServer = new SdkServer(bridge)

  const httpServer = new HttpServer({
    httpPort,
    bridge,
    sdkServer,
    host,
    token: process.env.UXSHIP_MCP_TOKEN,
    corsOrigin: process.env.UXSHIP_MCP_CORS_ORIGIN,
  })
  httpServer.start()

  // 自动检测后端连接
  const adapter = BackendAdapter.getInstance()
  const detected = await adapter.autoDetect()

  if (detected) {
    logger.info('MasterGo desktop connected via HTTP API', { mode: 'http' })
  } else {
    logger.info('Waiting for plugins via WebSocket...', { mode: 'plugin' })
    waitForPlugin(bridge, connectTimeoutSec ?? 30).catch(() => {})
  }

  const cleanup = async () => {
    logger.info('Shutting down MasterGo MCP Server')
    httpServer.stop()
    await sdkServer.close()
    await router.stop()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('SIGHUP', cleanup)
}

async function startStdioMode(connectTimeoutSec?: number, backendMode?: string, penpotOptions?: { port: number; disabled: boolean }): Promise<void> {
  isStdioMode = true
  logger.info('Starting in STDIO mode')

  // 设置后端模式
  if (backendMode) {
    process.env.UXSHIP_MODE = backendMode
  }

  const { router } = createBridgeRouter(15489, process.env.HOST || '127.0.0.1', penpotOptions)
  const bridge = router

  const sdkServer = new SdkServer(bridge)
  await sdkServer.startStdio()

  // 自动检测后端连接
  const adapter = BackendAdapter.getInstance()
  const detected = await adapter.autoDetect()

  if (detected) {
    logger.info('MasterGo desktop connected via HTTP API', { mode: 'http' })
  } else {
    logger.info('Waiting for plugins via WebSocket...', { mode: 'plugin' })
    // 在后台等待插件连接
    waitForPlugin(bridge, connectTimeoutSec ?? 30).catch(() => {})
  }

  const cleanup = async () => {
    logger.info('Shutting down MasterGo MCP Server (STDIO)')
    await sdkServer.close()
    await router.stop()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('SIGHUP', cleanup)
}

/**
 * 等待插件 WebSocket 连接，超时后停止等待
 */
async function waitForPlugin(bridge: BridgeRouter, timeoutSec: number): Promise<void> {
  const interval = 2000
  const maxAttempts = Math.ceil((timeoutSec * 1000) / interval)
  let attempts = 0

  while (attempts < maxAttempts) {
    if (bridge.isPluginConnected()) {
      const summary = bridge.describeBackends().map((b) => `${b.backend}=${b.clients}`).join(', ')
      logger.info(`Plugin connected via WebSocket (${summary})`)
      return
    }
    attempts++
    await new Promise(resolve => setTimeout(resolve, interval))
  }

  logger.info(`No plugin connected after ${timeoutSec}s timeout`)
  logger.info('Plugins will still be detected if they connect later')
}

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Promise rejection:', reason instanceof Error ? reason.message : String(reason))
})

// 兜底：服务端是插件的常驻通道，不能被单个坏帧 / 单个回调异常带走。
// 记录堆栈后继续运行（连接与 pending 请求的超时机制会自行清理）。
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception (server kept alive):', err instanceof Error ? err.stack || err.message : String(err))
})

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const connectTimeout = args.connectTimeout ? parseInt(args.connectTimeout, 10) : undefined
  const backendMode = args.backend || process.env.UXSHIP_MODE

  // Penpot 接入配置。默认共联（同一端口）；分端口需显式开启。
  const separate = args.penpotSeparate === 'true' || process.env.UXSHIP_MCP_SEPARATE_PORTS === '1'
  const penpotOptions = {
    port: parseInt(args.penpotWsPort || process.env.PENPOT_WS_PORT || '4404', 10),
    disabled: args.penpotDisable === 'true' || process.env.UXSHIP_PENPOT_DISABLE === '1',
    // 显式给了 --penpot-ws-port 默认就当作要分端口（避免用户以为改了端口却在共联）
    separate: separate || args.penpotWsPort !== undefined,
  }

  if (args.stdio === 'true' || process.env.MCP_STDIO === 'true') {
    startStdioMode(connectTimeout, backendMode, penpotOptions).catch((e) => {
      console.error('[FATAL] Failed to start STDIO mode:', e)
      process.exit(1)
    })
  } else {
    const httpPort = parseInt(args.httpPort || process.env.HTTP_PORT || '15490', 10)
    const wsPort = parseInt(args.wsPort || process.env.WS_PORT || '15489', 10)
    const host = args.host || process.env.HOST || '127.0.0.1'
    startHttpMode(httpPort, wsPort, connectTimeout, backendMode, host, penpotOptions).catch((e) => {
      console.error('[FATAL] Failed to start HTTP mode:', e)
      process.exit(1)
    })
  }
}

main()
