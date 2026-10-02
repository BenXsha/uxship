import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import type { ServerBridge } from './ws-bridge.js'
import { SdkServer } from './sdk-server.js'
import { BackendAdapter } from '../utils/backend-adapter.js'
import type { JSONRPCRequest } from '../types/index.js'
import { killPort, findPortOwners } from '../utils/process.js'
import { isAuthorized, requiresAuth, resolveCorsOrigin } from '../utils/http-security.js'

/**
 * 解析 `/mcp` 精简端点收到的 JSON-RPC 消息。
 *
 * `/mcp` **只支持 `tools/call`**（完整 MCP 协议走 GET /sse + POST /messages）。
 *
 * 抽成纯函数的原因：历史实现把任何请求都直接交给 `bridge.handleToolsCall`，而后者假设
 * `params.name` 存在 —— 于是客户端发 `initialize` 时会抛出
 * `Cannot read properties of undefined (reading 'replace')`，再被 catch 包装成
 * 一个误导性的「Parse error」，让人以为是自己请求格式写错了（排查成本很高）。
 */
export function resolveDirectMcpMessage(message: any):
  | { kind: 'call'; name: string }
  | { kind: 'notification' }
  | { kind: 'error'; code: number; message: string } {
  const method = message?.method
  if (method === 'tools/call') {
    const name = message?.params?.name
    if (typeof name !== 'string' || name.trim() === '') {
      return { kind: 'error', code: -32602, message: 'Invalid params: tools/call 需要 params.name（工具名）' }
    }
    return { kind: 'call', name }
  }
  if (typeof method === 'string' && method.startsWith('notifications/')) {
    return { kind: 'notification' }
  }
  const hint = method === 'initialize'
    ? '/mcp 是本服务的精简端点，只支持 tools/call；完整 MCP 协议请用 GET /sse（再 POST /messages）'
    : `/mcp 只支持 tools/call（收到：${typeof method === 'string' ? method : '(无 method 字段)'}）`
  return { kind: 'error', code: -32601, message: `Method not found: ${hint}` }
}

export interface HttpServerOptions {
  httpPort?: number
  bridge: ServerBridge
  sdkServer: SdkServer
  /** 监听地址，默认 127.0.0.1（仅本机）；跨机访问需显式设为 0.0.0.0 并配置 token */
  host?: string
  /** 可选访问令牌；设置后除 /health 外的端点都需鉴权 */
  token?: string
  /** 可选 CORS 源（默认不发 CORS 头，阻断浏览器跨源调用） */
  corsOrigin?: string
}

export class HttpServer {
  private server: Server | null = null
  private bridge: ServerBridge
  private sdkServer: SdkServer

  constructor(private options: HttpServerOptions) {
    this.bridge = options.bridge
    this.sdkServer = options.sdkServer
  }

  start(): void {
    const port = this.options.httpPort || 15490
    const host = this.options.host || '127.0.0.1'
    const token = this.options.token

    // 只清理自己的旧实例；陌生进程占用时只报告（不再无差别 kill）
    const { refused } = killPort(port)
    if (refused.length > 0) {
      console.error(
        `[HTTP Server] 端口 ${port} 被非本服务进程占用，已拒绝强杀：` +
          refused.map((o) => `${o.pid} (${o.command.slice(0, 80)})`).join(', ') +
          `\n  请先停掉占用者，或用 HTTP_PORT / --http-port 换端口。`,
      )
    }

    this.server = createServer(async (req, res) => {
      // CORS：默认不发头（浏览器跨源调用会被预检拦住）；仅当显式配置 UXSHIP_MCP_CORS_ORIGIN 才回显
      const corsOrigin = resolveCorsOrigin(this.options.corsOrigin, req.headers.origin as string | undefined)
      if (corsOrigin) {
        res.setHeader('Access-Control-Allow-Origin', corsOrigin)
        res.setHeader('Vary', 'Origin')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization')
      }
      res.setHeader('Cache-Control', 'no-cache')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const url = new URL(req.url || '/', `http://localhost:${port}`)

      // 可选 token 鉴权（/health 始终公开，供守护脚本与监控探活）
      if (requiresAuth(url.pathname) && !isAuthorized(req.headers as Record<string, any>, req.url || '', token)) {
        this.sendJson(res, 401, { error: 'Unauthorized: missing or invalid token' })
        return
      }

      try {
        if (req.method === 'GET' && url.pathname === '/sse') {
          await this.sdkServer.handleSseConnect(res)
          return
        }

        if (req.method === 'POST' && url.pathname === '/messages') {
          const sessionId = url.searchParams.get('sessionId')
          if (!sessionId) {
            this.sendJson(res, 400, { error: 'Missing sessionId' })
            return
          }
          await this.sdkServer.handleSseMessage(req, res, sessionId)
          return
        }

        if (req.method === 'POST' && url.pathname === '/mcp') {
          await this.handleDirectMcpRequest(req, res)
          return
        }

        if (req.method === 'GET' && url.pathname === '/health') {
          const adapter = BackendAdapter.getInstance()
          const backendMode = adapter.getMode()
          this.sendJson(res, 200, {
            status: 'ok',
            mode: 'sse+websocket (SDK)',
            backendMode,
            pluginConnected: this.bridge.isPluginConnected(),
            host,
            authRequired: Boolean((token || '').trim()),
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
          })
          return
        }

        this.sendJson(res, 404, { error: 'Not found' })
      } catch (error: any) {
        console.error('[HTTP Server] Unhandled error:', error)
        if (!res.headersSent) {
          this.sendJson(res, 500, { error: 'Internal server error' })
        }
      }
    })

    this.server.listen(port, host, () => {
      console.log(`[HTTP Server] Listening on http://${host}:${port} (host=${host})`)
      console.log(`[HTTP Server] Endpoints: GET /sse, POST /messages, POST /mcp, GET /health`)
      if (!(token || '').trim()) {
        console.warn('[HTTP Server] 未启用鉴权（UXSHIP_MCP_TOKEN 未设置）：默认仅监听本机 127.0.0.1；若要跨机访问请同时设置 token')
      }
      if (host !== '127.0.0.1' && host !== 'localhost' && !(token || '').trim()) {
        console.warn(`[HTTP Server] ⚠️ 监听 ${host} 但未设置 token，同网络其它主机可无鉴权访问本服务`)
      }
    })

    this.server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        const owners = findPortOwners(port)
        console.error(
          `[HTTP Server] Port ${port} is already in use` +
            (owners.length > 0
              ? `：${owners.map((o) => `${o.pid} (${o.command.slice(0, 100)})`).join(', ')}`
              : '') +
            `\n  用 HTTP_PORT / --http-port 换一个端口，或先停掉占用进程。`,
        )
      } else {
        console.error('[HTTP Server] Error:', error)
      }
      process.exit(1)
    })
  }

  private async handleDirectMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let message: any
    try {
      const body = await this.readBody(req)
      message = JSON.parse(body)
    } catch (error: any) {
      // 只有「body 不是合法 JSON」才算 Parse error
      this.sendJson(res, 400, {
        jsonrpc: '2.0',
        id: 0,
        error: { code: -32700, message: 'Parse error: ' + error.message }
      })
      return
    }

    const resolved = resolveDirectMcpMessage(message)
    if (resolved.kind === 'notification') {
      // JSON-RPC 通知不需要响应
      res.statusCode = 202
      res.end()
      return
    }
    if (resolved.kind === 'error') {
      this.sendJson(res, 200, {
        jsonrpc: '2.0',
        id: message?.id ?? 0,
        error: { code: resolved.code, message: resolved.message }
      })
      return
    }

    try {
      const response = await this.bridge.handleToolsCall(message as JSONRPCRequest)
      this.sendJson(res, 200, response)
    } catch (error: any) {
      this.sendJson(res, 200, {
        jsonrpc: '2.0',
        id: message?.id ?? 0,
        error: { code: -32603, message: 'Internal error: ' + error.message }
      })
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    const json = JSON.stringify(data)
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json, 'utf-8')
    })
    res.end(json)
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }
}
