import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { registerAllTools } from '../utils/register-tools.js'
import { registerAllPrompts } from '../utils/register-prompts.js'
import type { ServerBridge } from './ws-bridge.js'
import type { IncomingMessage, ServerResponse } from 'http'
import { SERVER_VERSION } from '../version.js'

export class SdkServer {
  readonly server: McpServer
  private bridge: ServerBridge
  private sseTransports = new Map<string, { transport: SSEServerTransport; server: McpServer }>()

  constructor(bridge: ServerBridge) {
    this.bridge = bridge
    // STDIO 模式：所有调用属于同一客户端
    this.server = this.createServerInstance('stdio')
  }

  private createServerInstance(sourceId?: string): McpServer {
    const server = new McpServer(
      { name: 'mcp-server', version: SERVER_VERSION },
      { capabilities: { tools: {}, prompts: {} } },
    )
    registerAllTools(server, this.bridge, sourceId)
    registerAllPrompts(server)
    return server
  }

  async startStdio(): Promise<void> {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
  }

  async handleSseConnect(res: ServerResponse): Promise<string> {
    // 每个 SSE 连接使用独立的 McpServer 实例，
    // 并以 transport.sessionId 作为 sourceId，使 session_switch 按客户端隔离。
    // （单例 server 只能绑定一个 transport，第二个连接会抛
    //  "Already connected to a transport" 导致 /sse 返回 500。）
    const transport = new SSEServerTransport('/messages', res)
    const server = this.createServerInstance(transport.sessionId)
    this.sseTransports.set(transport.sessionId, { transport, server })
    await server.connect(transport)
    console.log(`[SSE] client connected: ${transport.sessionId} (active=${this.sseTransports.size})`)

    const heartbeat = setInterval(() => {
      try {
        res.write(': keepalive\n\n')
      } catch {
        clearInterval(heartbeat)
        this.sseTransports.delete(transport.sessionId)
      }
    }, 15000)

    res.on('close', () => {
      clearInterval(heartbeat)
      this.sseTransports.delete(transport.sessionId)
      server.close().catch(() => {})
      console.log(`[SSE] client disconnected: ${transport.sessionId} (active=${this.sseTransports.size})`)
    })

    return transport.sessionId
  }

  async handleSseMessage(req: IncomingMessage, res: ServerResponse, sessionId: string): Promise<void> {
    const entry = this.sseTransports.get(sessionId)
    if (!entry) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'SSE session not found' }))
      return
    }
    await entry.transport.handlePostMessage(req, res)
  }

  async close(): Promise<void> {
    for (const entry of this.sseTransports.values()) {
      await entry.server.close().catch(() => {})
      await entry.transport.close().catch(() => {})
    }
    this.sseTransports.clear()
    await this.server.close()
  }
}
