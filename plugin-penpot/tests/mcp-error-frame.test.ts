/**
 * 插件 → 服务端的**错误响应帧**形状（回归测试）
 *
 * 真事故：早期 `sendErrorToMCP` 用 `createJsonRpcRequest('error', { code, message })`
 * 再把 `method` / `params` 删掉 —— 可是错误信息就存在 `params` 里，删完只剩下 `{ jsonrpc, id }`。
 * 服务端入帧分类条件（`mcp-server/src/server/ws-bridge.ts`）是
 * `msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)`，
 * 于是这种空帧被**静默丢弃**：pending 请求要等满 30s 才超时。
 *
 * 后果不是"少一条日志"，而是**插件侧每一个真实错误都退化成 Timeout**——
 * 节点不存在、令牌不存在、参数非法，AI 与人都只能看到 30 秒后的超时，
 * 而 UI 日志还会显示"错误响应已发送到 MCP 服务器"（日志在说谎）。
 *
 * 所以这里直接钉**发出去的字节**：错误必须挂在 `error` 字段上。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMCPConnection } from '@ui/composables/useMCPConnection'

/** 只用到静态常量 `WebSocket.OPEN`，node 环境没有全局 WebSocket */
const WS_OPEN = 1

function setup() {
  const sent: string[] = []
  const conn = useMCPConnection(() => {}, { defaultServerUrl: 'ws://127.0.0.1:15489' })
  const socket = {
    readyState: WS_OPEN,
    send: (payload: string) => {
      sent.push(payload)
    },
    close: () => {},
  }
  conn.ws.value = socket as unknown as WebSocket
  return { conn, sent }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', { OPEN: WS_OPEN })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sendErrorToMCP 发出去的帧', () => {
  it('错误挂在 error 字段上（缺 error/result 的帧会被服务端静默丢弃）', () => {
    const { conn, sent } = setup()

    const ok = conn.sendErrorToMCP(7, '节点不存在: 48f58225-bogus')

    expect(ok).toBe(true)
    expect(sent).toHaveLength(1)

    const frame = JSON.parse(sent[0])
    expect(frame.jsonrpc).toBe('2.0')
    expect(frame.id).toBe(7)
    expect(frame.error).toEqual({ code: -32603, message: '节点不存在: 48f58225-bogus' })

    // 关键：服务端按这两个字段判"这是响应"，两个都没有就是死帧
    expect(frame.error !== undefined || frame.result !== undefined).toBe(true)
    // 也不能残留 method / params（会被当成请求）
    expect(frame.method).toBeUndefined()
    expect(frame.params).toBeUndefined()
    expect(frame.result).toBeUndefined()
  })

  it('WS 未连接时返回 false 且一帧都不发（不制造死帧）', () => {
    const { conn, sent } = setup()
    conn.ws.value = null

    expect(conn.sendErrorToMCP(9, '任意错误')).toBe(false)
    expect(sent).toHaveLength(0)
  })
})
