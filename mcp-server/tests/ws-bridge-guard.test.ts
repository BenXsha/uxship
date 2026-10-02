import { describe, it, expect } from 'vitest'
import { WebSocketBridge } from '../src/server/ws-bridge.js'

/**
 * WS 消息入口健壮性（崩溃类缺陷回归）
 *
 * 历史缺陷：`handleMessage` 直接 `JSON.parse` 后就读 `msg.method`。
 * `JSON.parse('null')` / `'[]'` / `'1'` 都是**合法** JSON，但拿到后读属性会抛 TypeError；
 * 这个异常发生在 `socket.on('message')` 回调里 → 未捕获异常 → **整个服务进程崩溃**。
 * 服务端是插件的常驻通道，一个坏帧就能带走全部会话。
 *
 * 这里直接驱动真实的私有 `handleMessage`（注入假 client），不依赖监听端口。
 */
function makeBridge() {
  const bridge = new WebSocketBridge() as any
  const sent: string[] = []
  const client = {
    id: 1,
    initialized: true,
    clientType: 'mastergo-plugin',
    socket: {
      readyState: 1,
      send: (payload: string) => sent.push(payload),
    },
    documentId: 'doc:1',
    meta: {},
    lastPong: Date.now(),
  }
  bridge.clients.set(1, client)
  return { bridge, sent }
}

describe('WebSocketBridge.handleMessage — 坏帧不应崩溃', () => {
  it('JSON null 帧被忽略且不抛异常', () => {
    const { bridge } = makeBridge()
    expect(() => bridge.handleMessage(1, 'null')).not.toThrow()
  })

  it('数组 / 原始值 / 坏 JSON / 空串都安全', () => {
    const { bridge } = makeBridge()
    for (const frame of ['[]', '[{"method":"x"}]', '1', '"str"', 'true', '{bad json}', '']) {
      expect(() => bridge.handleMessage(1, frame), `frame=${frame}`).not.toThrow()
    }
  })

  it('未知 clientId 不会抛异常', () => {
    const { bridge } = makeBridge()
    expect(() => bridge.handleMessage(999, '{"method":"whatever"}')).not.toThrow()
  })
})

describe('WebSocketBridge.handleMessage — 正常路径未被误伤', () => {
  it('initialize 请求仍会回 initialize 响应', () => {
    const { bridge, sent } = makeBridge()
    bridge.handleMessage(
      1,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'initialize',
        params: { clientInfo: { name: 'MasterGo-Plugin', documentId: 'doc:9', codename: 'Nick' } },
      }),
    )
    expect(sent).toHaveLength(1)
    const response = JSON.parse(sent[0])
    expect(response.id).toBe(7)
    expect(response.result.serverInfo.name).toBe('mcp-server')
  })

  it('插件响应仍能 resolve 对应 pending 请求', () => {
    const { bridge } = makeBridge()
    let resolved: any = null
    bridge.pendingRequests.set('key-1', {
      requestKey: 'key-1',
      resolve: (value: any) => {
        resolved = value
      },
      reject: () => {},
      timeout: setTimeout(() => {}, 1000),
      method: 'node/get',
    })
    bridge.pendingIdIndex.set('42', 'key-1')

    bridge.handleMessage(1, JSON.stringify({ jsonrpc: '2.0', id: 42, result: { content: [{ type: 'text', text: 'ok' }] } }))
    // 响应会被包装成 MCP CallToolResponse 形状，这里只断言“确实 resolve 了且 id 正确”
    expect(resolved).not.toBeNull()
    expect(resolved.id).toBe(42)
    expect(bridge.pendingRequests.has('key-1')).toBe(false)
  })
})
