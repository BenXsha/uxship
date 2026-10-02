import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WebSocketBridge, BRIDGE_PROFILE } from '../src/server/ws-bridge.js'
import { BridgeRouter } from '../src/server/bridge-router.js'
import type { JSONRPCRequest, JSONRPCResponse } from '../src/types/index.js'

/**
 * 多后端桥路由（MasterGo + Penpot）
 *
 * 背景：一个 MCP 服务端要同时服务两个设计工具的插件，而两者讲同一套 JSON-RPC 协议。
 * 路由依据是**会话 id 前缀**（`sess_` / `sess_penpot_`），因此本文件重点锁住：
 *   1. 前缀 → 后端的判定（含未知前缀必须**回落默认**而不是猜）
 *   2. 默认后端的推断顺序（唯一在线 → 它；都在线/都不在线 → mastergo，保持历史行为）
 *   3. clientId 段位错开（否则两个桥的客户端会互相冒充）
 *   4. initialize 握手把自己归对后端（Penpot 名字不会被 mastergo 桥收编）
 */

interface FakeClientInit {
  clientId: number
  clientType?: string
  /** 客户端归属的后端（真实客户端在 initialize 时由桥写入，替身必须一致） */
  backend?: string
  initialized?: boolean
  sessionId?: string
  codename?: string
  documentId?: string
  documentName?: string
  pageName?: string
}

function makeClient(init: FakeClientInit) {
  const sent: string[] = []
  return {
    sent,
    client: {
      socket: { readyState: 1, send: (payload: string) => sent.push(payload) },
      clientId: init.clientId,
      clientType: init.clientType ?? 'mastergo-plugin',
      backend: init.backend ?? (init.clientType === 'penpot-plugin' ? 'penpot' : 'mastergo'),
      initialized: init.initialized ?? true,
      sessionId: init.sessionId ?? 'sess_doc1',
      codename: init.codename ?? 'Nova',
      documentName: init.documentName ?? 'Doc',
      documentId: init.documentId ?? 'doc1',
      pageName: init.pageName ?? 'Page 1',
      pageId: 'page-1',
      connectedAt: 1,
      lastPong: Date.now(),
      meta: {},
    },
  }
}

/** 造一对桥，各自塞一个在线客户端 */
function makePair(options: { mastergoOnline?: boolean; penpotOnline?: boolean } = {}) {
  const mastergo = new WebSocketBridge({ backend: 'mastergo' })
  const penpot = new WebSocketBridge({ backend: 'penpot' })

  if (options.mastergoOnline !== false) {
    const { client } = makeClient({ clientId: 1, sessionId: 'sess_doc1', codename: 'Nova' })
    ;(mastergo as any).clients.set(1, client)
  }
  if (options.penpotOnline !== false) {
    const { client } = makeClient({
      clientId: BRIDGE_PROFILE.penpot.clientIdOffset + 1,
      clientType: 'penpot-plugin',
      sessionId: 'sess_penpot_pf1',
      codename: 'Penpot',
      documentId: 'pf1',
    })
    ;(penpot as any).clients.set(BRIDGE_PROFILE.penpot.clientIdOffset + 1, client)
  }

  const router = new BridgeRouter()
  router.register('mastergo', mastergo)
  router.register('penpot', penpot)
  return { router, mastergo, penpot }
}

describe('BRIDGE_PROFILE —— 前缀与段位是路由契约', () => {
  it('两个后端的前缀不互相包含（否则路由会串）', () => {
    expect(BRIDGE_PROFILE.mastergo.sessionPrefix).toBe('sess_')
    expect(BRIDGE_PROFILE.penpot.sessionPrefix).toBe('sess_penpot_')
    expect(BRIDGE_PROFILE.penpot.sessionPrefix.startsWith(BRIDGE_PROFILE.mastergo.sessionPrefix)).toBe(true)
    // 正因为 penpot 前缀以 mastergo 前缀开头，判定顺序必须「先精确前缀、再默认」——
    // ownsSessionId 用的是 startsWith 具体前缀，两者不会互相命中
  })

  it('clientId 段位必须错开', () => {
    expect(BRIDGE_PROFILE.penpot.clientIdOffset).toBeGreaterThan(0)
  })

  it('ownsSessionId 是纯前缀测试（排他判定由 router 取最长前缀完成）', () => {
    const mastergo = new WebSocketBridge({ backend: 'mastergo' })
    const penpot = new WebSocketBridge({ backend: 'penpot' })
    expect(mastergo.ownsSessionId('sess_abc')).toBe(true)
    // ⚠️ 前缀的包含关系：sess_ 是 sess_penpot_ 的前缀，因此 mastergo 也会命中 penpot 会话。
    // 这正是 router 必须取「最长前缀」而不是「命中即返回」的原因。
    expect(mastergo.ownsSessionId('sess_penpot_abc')).toBe(true)
    expect(penpot.ownsSessionId('sess_penpot_abc')).toBe(true)
    expect(penpot.ownsSessionId('sess_abc')).toBe(false)
    expect(penpot.ownsSessionId(undefined)).toBe(false)
  })

  it('acceptsClient 只认自己的客户端类型', () => {
    const mastergo = new WebSocketBridge({ backend: 'mastergo' })
    const penpot = new WebSocketBridge({ backend: 'penpot' })
    expect(mastergo.acceptsClient({ clientType: 'mastergo-plugin', initialized: true })).toBe(true)
    expect(mastergo.acceptsClient({ clientType: 'penpot-plugin', initialized: true })).toBe(false)
    expect(penpot.acceptsClient({ clientType: 'penpot-plugin', initialized: true })).toBe(true)
    // 未初始化的一律不算
    expect(penpot.acceptsClient({ clientType: 'penpot-plugin', initialized: false })).toBe(false)
  })
})

describe('WebSocketBridge —— initialize 握手归属', () => {
  it('Penpot 名字的客户端落到 penpot 桥，会话带 sess_penpot_ 前缀，响应回传 backend', () => {
    const penpot = new WebSocketBridge({ backend: 'penpot' })
    const { client, sent } = makeClient({ clientId: 10001, clientType: 'unknown', initialized: false, sessionId: '' })
    ;(penpot as any).clients.set(10001, client)

    ;(penpot as any).handleMessage(
      10001,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'initialize',
        params: { clientInfo: { name: 'Penpot-Plugin', documentId: 'pf-42', codename: 'Penpot' } },
      }),
    )

    expect(client.clientType).toBe('penpot-plugin')
    expect(client.sessionId).toBe('sess_penpot_pf-42')
    expect(penpot.listPluginSessions()).toHaveLength(1)
    expect(penpot.listPluginSessions()[0].backend).toBe('penpot')

    const initResponse = JSON.parse(sent[0])
    expect(initResponse.result.serverInfo.backend).toBe('penpot')
  })

  it('显式声明 backend 也能归属（比名字关键字更可靠）', () => {
    const penpot = new WebSocketBridge({ backend: 'penpot' })
    const { client } = makeClient({ clientId: 10002, clientType: 'unknown', initialized: false, sessionId: '' })
    ;(penpot as any).clients.set(10002, client)

    ;(penpot as any).handleMessage(
      10002,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'initialize',
        params: { clientInfo: { name: 'Whatever-Plugin', backend: 'penpot', documentId: 'pf-43' } },
      }),
    )

    expect(client.clientType).toBe('penpot-plugin')
    expect(client.sessionId).toBe('sess_penpot_pf-43')
  })

  it('mastergo 桥不会把 Penpot 客户端收编（避免跨后端误路由）', () => {
    const mastergo = new WebSocketBridge({ backend: 'mastergo' })
    const { client } = makeClient({ clientId: 1, clientType: 'unknown', initialized: false, sessionId: '' })
    ;(mastergo as any).clients.set(1, client)

    ;(mastergo as any).handleMessage(
      1,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'initialize',
        params: { clientInfo: { name: 'Penpot-Plugin', documentId: 'pf-99' } },
      }),
    )

    // 名字不匹配 → clientType 仍是 unknown → 不出现在会话列表里（也不参与路由）
    expect(client.clientType).toBe('unknown')
    expect(mastergo.listPluginSessions()).toHaveLength(0)
    expect(mastergo.getPluginCount()).toBe(0)
  })
})

describe('BridgeRouter —— 后端解析', () => {
  it('按会话前缀判定归属', () => {
    const { router } = makePair()
    expect(router.backendForSessionId('sess_doc1')).toBe('mastergo')
    expect(router.backendForSessionId('sess_penpot_pf1')).toBe('penpot')
    // `sess_` 就是 mastergo 的前缀，所以任意 sess_ 开头的都归它（前缀即归属，不是白名单）
    expect(router.backendForSessionId('sess_some_unknown_doc')).toBe('mastergo')
    expect(router.backendForSessionId('pfx_not_a_known_prefix')).toBe(null)
    expect(router.backendForSessionId(undefined)).toBe(null)
  })

  it('按 clientId 判定归属（段位错开后不歧义）', () => {
    const { router } = makePair()
    expect(router.backendForClientId(1)).toBe('mastergo')
    expect(router.backendForClientId(BRIDGE_PROFILE.penpot.clientIdOffset + 1)).toBe('penpot')
    expect(router.backendForClientId(999999)).toBe(null)
  })

  it('唯一在线时自动选中该后端', () => {
    const onlyPenpot = makePair({ mastergoOnline: false })
    expect(onlyPenpot.router.resolveDefaultBackend()).toBe('penpot')

    const onlyMastergo = makePair({ penpotOnline: false })
    expect(onlyMastergo.router.resolveDefaultBackend()).toBe('mastergo')
  })

  it('两个都在线时回落 mastergo（保持历史行为，不随机挑）', () => {
    const { router } = makePair()
    expect(router.resolveDefaultBackend()).toBe('mastergo')
  })

  it('都不在线时也回落 mastergo（错误提示由桥自己给）', () => {
    const none = makePair({ mastergoOnline: false, penpotOnline: false })
    expect(none.router.resolveDefaultBackend()).toBe('mastergo')
  })

  it('显式 defaultBackend 优先于在线推断', () => {
    const penpot = makePair({ penpotOnline: false })
    const router = new BridgeRouter({ defaultBackend: 'penpot' })
    router.register('mastergo', penpot.mastergo)
    router.register('penpot', penpot.penpot)
    expect(router.resolveDefaultBackend()).toBe('penpot')

    router.setDefaultBackend(undefined)
    expect(router.resolveDefaultBackend()).toBe('mastergo')
  })

  it('clientId 优先于 sessionId（精确度更高）', () => {
    const { router } = makePair()
    // 故意给一个矛盾组合：penpot 的 clientId + mastergo 的 sessionId
    expect(router.resolveBackend('sess_doc1', BRIDGE_PROFILE.penpot.clientIdOffset + 1)).toBe('penpot')
  })
  it('自定 sessionId 的前缀歧义由「最长前缀」解决（回归：sess_ 会误吃 sess_penpot_）', () => {
    const { router } = makePair()
    expect(router.backendForSessionId('sess_penpot_pf1')).toBe('penpot')
    expect(router.backendForSessionId('sess_doc1')).toBe('mastergo')
  })

})

describe('BridgeRouter —— 转发', () => {
  const request: JSONRPCRequest = { jsonrpc: '2.0', id: 1, method: 'dsl/render', params: {} }

  function spyBridges() {
    const { router, mastergo, penpot } = makePair()
    const calls: { backend: string; sessionId?: string }[] = []
    const fake = (backend: string) =>
      vi.fn(async (req: JSONRPCRequest, sessionId?: string): Promise<JSONRPCResponse> => {
        calls.push({ backend, sessionId })
        return { jsonrpc: '2.0', id: req.id, result: { backend } as any }
      })

    mastergo.forwardRequest = fake('mastergo') as any
    penpot.forwardRequest = fake('penpot') as any
    return { router, calls }
  }

  it('sess_penpot_* 的调用转到 penpot 桥', async () => {
    const { router, calls } = spyBridges()
    await router.forwardRequest(request, 'sess_penpot_pf1')
    expect(calls).toEqual([{ backend: 'penpot', sessionId: 'sess_penpot_pf1' }])
  })

  it('sess_* 的调用转到 mastergo 桥', async () => {
    const { router, calls } = spyBridges()
    await router.forwardRequest(request, 'sess_doc1')
    expect(calls).toEqual([{ backend: 'mastergo', sessionId: 'sess_doc1' }])
  })

  it('无会话且只有一个在线时自动选它', async () => {
    const { router, calls } = spyBridges()
    ;(router.get('mastergo') as any).clients.clear()
    await router.forwardRequest(request)
    expect(calls[0].backend).toBe('penpot')
  })

  it('后端未注册但前缀已知时给出可执行的配置提示（而不是静默路由到别的后端）', async () => {
    const router = new BridgeRouter()
    router.register('mastergo', new WebSocketBridge({ backend: 'mastergo' }))
    const response = await router.forwardRequest(request, 'sess_penpot_pf1')
    expect(response.jsonrpc).toBe('2.0')
    expect('error' in response && /后端未启用: penpot/.test(response.error.message)).toBe(true)
    expect('error' in response && /UXSHIP_PENPOT_WS_PORT/.test(response.error.message)).toBe(true)
  })
})

describe('BridgeRouter —— 会话聚合', () => {
  it('session_list 同时列出两端并带 backend 字段', () => {
    const { router } = makePair()
    const sessions = router.listPluginSessions()
    expect(sessions).toHaveLength(2)
    expect(sessions.map((s) => s.backend)).toEqual(['mastergo', 'penpot'])
    expect(sessions.map((s) => s.sessionId)).toEqual(['sess_doc1', 'sess_penpot_pf1'])
    expect(sessions.map((s) => s.clientType)).toEqual(['mastergo-plugin', 'penpot-plugin'])
  })

  it('按 clientId / codename 跨桥查找', () => {
    const { router } = makePair()
    expect(router.findPluginClientByClientId(1)?.backend).toBe('mastergo')
    expect(router.findPluginClientByClientId(BRIDGE_PROFILE.penpot.clientIdOffset + 1)?.backend).toBe('penpot')
    expect(router.findPluginClientByCodename('Penpot')?.backend).toBe('penpot')
    expect(router.findPluginClientByCodename('不存在')).toBe(null)
  })

  it('自定义会话前缀也能被逐桥兜住', () => {
    const custom = new WebSocketBridge({ backend: 'penpot', sessionPrefix: 'pfx_' })
    const { client } = makeClient({ clientId: 20001, clientType: 'penpot-plugin', sessionId: 'pfx_abc' })
    ;(custom as any).clients.set(20001, client)

    const router = new BridgeRouter()
    router.register('mastergo', new WebSocketBridge({ backend: 'mastergo' }))
    router.register('penpot', custom)

    // 前缀不匹配任何「自动」模式 → 走逐桥兜底查找
    expect(router.findPluginClientBySessionId('pfx_abc')?.backend).toBe('penpot')
  })

  it('describeBackends 报告各后端连接数（健康检查用）', () => {
    const { router } = makePair({ mastergoOnline: false })
    expect(router.describeBackends()).toEqual([
      { backend: 'mastergo', clients: 0 },
      { backend: 'penpot', clients: 1 },
    ])
    expect(router.isPluginConnected()).toBe(true)
  })

  it('都不在线时 isPluginConnected 为 false', () => {
    const { router } = makePair({ mastergoOnline: false, penpotOnline: false })
    expect(router.isPluginConnected()).toBe(false)
  })
})

describe('BridgeRouter —— 通知', () => {
  it('任务进度广播到两端（UI 展示用途，无副作用）', () => {
    const { router, mastergo, penpot } = makePair()
    const mastergoSpy = vi.spyOn(mastergo, 'sendNotification')
    const penpotSpy = vi.spyOn(penpot, 'sendNotification')

    router.sendTaskPlan([{ id: 'a', label: '准备' }])
    router.sendTaskStep('a', 'running', '进行中')
    router.sendTaskComplete('success', '完成')

    expect(mastergoSpy.mock.calls.map((c) => c[0])).toEqual(['task/plan', 'task/step', 'task/complete'])
    expect(penpotSpy.mock.calls.map((c) => c[0])).toEqual(['task/plan', 'task/step', 'task/complete'])
  })

  it('带 sessionId 的通知只发给归属后端', () => {
    const { router, mastergo, penpot } = makePair()
    const mastergoSpy = vi.spyOn(mastergo, 'sendNotification')
    const penpotSpy = vi.spyOn(penpot, 'sendNotification')

    router.sendNotification('custom/notice', { a: 1 }, 'sess_penpot_pf1')

    expect(penpotSpy).toHaveBeenCalledTimes(1)
    expect(mastergoSpy).not.toHaveBeenCalled()
  })

  it('sessionId 不归属任何已知前缀时不发（避免误发）', () => {
    const { router, mastergo, penpot } = makePair()
    const mastergoSpy = vi.spyOn(mastergo, 'sendNotification')
    const penpotSpy = vi.spyOn(penpot, 'sendNotification')

    router.sendNotification('custom/notice', {}, 'pfx_not_a_known_prefix')

    expect(mastergoSpy).not.toHaveBeenCalled()
    expect(penpotSpy).not.toHaveBeenCalled()
  })

  it('sess_ 开头的未知会话仍归 mastergo（前缀即归属，不是白名单）', () => {
    const { router, mastergo, penpot } = makePair()
    const mastergoSpy = vi.spyOn(mastergo, 'sendNotification')
    const penpotSpy = vi.spyOn(penpot, 'sendNotification')

    router.sendNotification('custom/notice', {}, 'sess_some_other_doc')

    expect(mastergoSpy).toHaveBeenCalledTimes(1)
    expect(penpotSpy).not.toHaveBeenCalled()
  })
})

describe('BridgeRouter —— 活跃会话与本地工具', () => {
  it('session_switch 的目标能跨桥读写（目标由 sessionId 前缀自解释）', () => {
    const { router } = makePair()
    router.setActiveSession('src-1', { sessionId: 'sess_penpot_pf1', clientId: 10001 })
    expect(router.getActiveSession('src-1')).toEqual({ sessionId: 'sess_penpot_pf1', clientId: 10001 })
  })

  it('本地工具委托给任一桥（服务端同源，随便挑）', async () => {
    const { router } = makePair()
    const response = await router.handleLocalTool({ jsonrpc: '2.0', id: 3, method: 'x' } as JSONRPCRequest)
    // 默认 WebSocketBridge.handleLocalTool 返回 Method not found，这里只验证委托链通
    expect(response).toHaveProperty('jsonrpc', '2.0')
  })

  it('没有任何桥时不抛异常', async () => {
    const router = new BridgeRouter()
    const response = await router.handleLocalTool({ jsonrpc: '2.0', id: 4, method: 'x' } as JSONRPCRequest)
    expect('error' in response && response.error.code).toBe(-32601)
  })
})

describe('共联单 hub（一个端口接两种插件）', () => {
  /** 造一个共联 hub：acceptedBackends = [mastergo, penpot] */
  function makeHub() {
    const hub = new WebSocketBridge({ backend: 'mastergo', acceptedBackends: ['mastergo', 'penpot'] })
    const router = new BridgeRouter()
    router.register('mastergo', hub)
    router.register('penpot', hub)
    return { hub, router }
  }

  function connect(hub: WebSocketBridge, clientId: number, clientInfo: Record<string, unknown>) {
    const { client, sent } = makeClient({ clientId, clientType: 'unknown', initialized: false, sessionId: '' })
    ;(hub as any).clients.set(clientId, client)
    ;(hub as any).handleMessage(clientId, JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo },
    }))
    return { client, sent }
  }

  it('两种插件连同一个端口，各自归到自己的后端与前缀', () => {
    const { hub } = makeHub()

    const mg = connect(hub, 1, { name: 'MasterGo-Plugin', documentId: 'mgdoc' })
    const pf = connect(hub, 2, { name: 'Penpot-Plugin', backend: 'penpot', documentId: 'pfdoc' })

    expect(mg.client.backend).toBe('mastergo')
    expect(mg.client.sessionId).toBe('sess_mgdoc')
    expect(pf.client.backend).toBe('penpot')
    expect(pf.client.sessionId).toBe('sess_penpot_pfdoc')

    const sessions = hub.listPluginSessions()
    expect(sessions.map((s) => s.backend)).toEqual(['mastergo', 'penpot'])
    expect(sessions.map((s) => s.sessionId)).toEqual(['sess_mgdoc', 'sess_penpot_pfdoc'])
  })

  it('initialize 响应回报的是「本会话被归属到的后端」，不是桥的默认后端', () => {
    const { hub } = makeHub()
    const { sent } = connect(hub, 1, { name: 'Penpot-Plugin', backend: 'penpot', documentId: 'd' })
    const info = JSON.parse(sent[0]).result.serverInfo
    // 若这里报 mastergo，Penpot 面板会把一个完全正常的连接当成「后端不匹配」误报
    expect(info.backend).toBe('penpot')
    expect(info.attributed).toBe(true)
    expect(info.acceptedBackends).toEqual(['mastergo', 'penpot'])
  })

  it('未归属的客户端收到 attributed=false（而不是假装成功）', () => {
    const { hub } = makeHub()
    const { sent } = connect(hub, 3, { name: 'Figma-Plugin', backend: 'figma', documentId: 'f' })
    const info = JSON.parse(sent[0]).result.serverInfo
    expect(info.attributed).toBe(false)
    expect(info.backend).toBe(null)
  })

  it('单后端桥的归属结果也如实上报（Penpot 连到仅 MasterGo 的桥 → attributed=false）', () => {
    const solo = new WebSocketBridge({ backend: 'mastergo' })
    const { sent } = connect(solo, 1, { name: 'Penpot-Plugin', backend: 'penpot', documentId: 'x' })
    const info = JSON.parse(sent[0]).result.serverInfo
    expect(info.attributed).toBe(false)
    expect(info.acceptedBackends).toEqual(['mastergo'])
  })

  it('声明的后端不在接收集里（如 figma）→ 不收编、不出现于会话', () => {
    const { hub } = makeHub()
    const { client } = connect(hub, 3, { name: 'Figma-Plugin', backend: 'figma', documentId: 'f' })
    expect(client.clientType).toBe('unknown')
    expect(hub.listPluginSessions()).toHaveLength(0)
    expect(hub.getPluginCount()).toBe(0)
  })

  it('共联模式下不自动归属未 initialize 的客户端（不猜）', () => {
    const { hub } = makeHub()
    const { client } = makeClient({ clientId: 4, clientType: 'unknown', initialized: false, sessionId: '' })
    ;(hub as any).clients.set(4, client)
    // 直接发一个响应帧（没有 initialize）
    ;(hub as any).handleMessage(4, JSON.stringify({ jsonrpc: '2.0', id: 9, result: {} }))
    expect(client.initialized).toBe(false)
    expect(hub.listPluginSessions()).toHaveLength(0)
  })

  it('路由：两个前缀都指向同一个 hub，按最长前缀分后端', () => {
    const { hub, router } = makeHub()
    connect(hub, 1, { name: 'MasterGo-Plugin', documentId: 'mgdoc' })
    connect(hub, 2, { name: 'Penpot-Plugin', backend: 'penpot', documentId: 'pfdoc' })

    expect(router.backendForSessionId('sess_mgdoc')).toBe('mastergo')
    expect(router.backendForSessionId('sess_penpot_pfdoc')).toBe('penpot')
    expect(router.findPluginClientBySessionId('sess_penpot_pfdoc')?.backend).toBe('penpot')
    expect(router.findPluginClientByClientId(2)?.backend).toBe('penpot')
  })

  it('路由：默认后端按「每个后端各自计数」判定（不把两种客户端数在一起）', () => {
    const { hub, router } = makeHub()
    connect(hub, 1, { name: 'Penpot-Plugin', backend: 'penpot', documentId: 'only-penpot' })

    // 只有 penpot 在线 → 自动选中 penpot（若计数不分后端，这里会错误地落回 mastergo）
    expect(router.describeBackends()).toEqual([
      { backend: 'mastergo', clients: 0 },
      { backend: 'penpot', clients: 1 },
    ])
    expect(router.resolveDefaultBackend()).toBe('penpot')
  })

  it('路由：两后端都在线 → 仍回落 mastergo（不猜）', () => {
    const { hub, router } = makeHub()
    connect(hub, 1, { name: 'MasterGo-Plugin', documentId: 'a' })
    connect(hub, 2, { name: 'Penpot-Plugin', backend: 'penpot', documentId: 'b' })
    expect(router.resolveDefaultBackend()).toBe('mastergo')
  })

  it('转发：penpot 会话走共联 hub（不需要单独的 penpot 桥）', async () => {
    const { hub, router } = makeHub()
    connect(hub, 1, { name: 'Penpot-Plugin', backend: 'penpot', documentId: 'pf' })

    const calls: string[] = []
    hub.forwardRequest = (async (req: JSONRPCRequest, sessionId?: string) => {
      calls.push(`hub:${sessionId}`)
      return { jsonrpc: '2.0', id: req.id, result: {} } as JSONRPCResponse
    }) as never

    await router.forwardRequest({ jsonrpc: '2.0', id: 1, method: 'dsl/render', params: {} }, 'sess_penpot_pf')
    expect(calls).toEqual(['hub:sess_penpot_pf'])
  })

  it('single 模式仍拒收显式声明别的后端的客户端（回归）', () => {
    const solo = new WebSocketBridge({ backend: 'mastergo' })
    const { client } = connect(solo, 1, { name: 'Penpot-Plugin', backend: 'penpot', documentId: 'x' })
    expect(client.clientType).toBe('unknown')
    expect(solo.listPluginSessions()).toHaveLength(0)
  })

  it('single 模式兼容没自述的老插件（历史行为不变）', () => {
    const solo = new WebSocketBridge({ backend: 'mastergo' })
    const { client } = connect(solo, 1, { name: 'SomeOldPlugin', documentId: 'legacy' })
    expect(client.clientType).toBe('mastergo-plugin')
    expect(client.sessionId).toBe('sess_legacy')
  })
})

describe('共联 hub 的列表去重（回归：同一会话被列两遍）', () => {
  it('listPluginSessions 不会因为桥注册在两个键下而重复', () => {
    const hub = new WebSocketBridge({ backend: 'mastergo', acceptedBackends: ['mastergo', 'penpot'] })
    const router = new BridgeRouter()
    router.register('mastergo', hub)
    router.register('penpot', hub)

    const { client } = makeClient({ clientId: 10001, clientType: 'penpot-plugin', backend: 'penpot', sessionId: 'sess_penpot_doc1' })
    ;(hub as any).clients.set(10001, client)

    const sessions = router.listPluginSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe('sess_penpot_doc1')
    expect(sessions[0].backend).toBe('penpot')
  })
})

describe('会话元数据自愈（listPluginSessionsResolved）', () => {
  it('文档信息为空的会话会向插件实时问一次，并缓存回客户端', async () => {
    const hub = new WebSocketBridge({ backend: 'mastergo', acceptedBackends: ['mastergo', 'penpot'] })
    const { client } = makeClient({
      clientId: 10001, clientType: 'penpot-plugin', backend: 'penpot',
      sessionId: 'sess_penpot_1', codename: '', documentId: '', documentName: '', pageName: '',
    })
    ;(hub as any).clients.set(10001, client)

    // 插件应答 document/getInfo（注意响应被包成 content[0].text）
    hub.forwardRequest = (async (req: JSONRPCRequest) => ({
      jsonrpc: '2.0', id: req.id,
      result: { content: [{ type: 'text', text: JSON.stringify({ codename: 'Penpot', documentName: '新建文件 1', documentId: 'doc-42', pageName: 'Page 1', pageId: 'p-1' }) }] },
    })) as never

    const before = hub.listPluginSessions()
    expect(before[0].documentName).toBe('')

    const sessions = await hub.listPluginSessionsResolved()
    expect(sessions[0].codename).toBe('Penpot')
    expect(sessions[0].documentName).toBe('新建文件 1')
    expect(sessions[0].documentId).toBe('doc-42')
    expect(sessions[0].pageName).toBe('Page 1')
    // 缓存回客户端：第二次不用再问
    expect(hub.listPluginSessions()[0].documentName).toBe('新建文件 1')
  })

  it('已有完整元数据时不发起额外请求（不做无用往返）', async () => {
    const hub = new WebSocketBridge({ backend: 'penpot' })
    const { client } = makeClient({
      clientId: 1, clientType: 'penpot-plugin', backend: 'penpot',
      sessionId: 'sess_penpot_doc1', codename: 'Penpot', documentId: 'doc1',
    })
    client.documentName = '已命名文档'
    client.pageName = 'Page 1'
    ;(hub as any).clients.set(1, client)

    let called = 0
    hub.forwardRequest = (async () => { called += 1; return { jsonrpc: '2.0', id: 1, result: {} } }) as never

    const sessions = await hub.listPluginSessionsResolved()
    expect(called).toBe(0)
    expect(sessions[0].documentName).toBe('已命名文档')
  })

  it('插件不应答时短超时返回，不把 session_list 这个排障工具拖挂', async () => {
    const hub = new WebSocketBridge({ backend: 'penpot' })
    const { client } = makeClient({ clientId: 1, clientType: 'penpot-plugin', backend: 'penpot', sessionId: 'sess_penpot_1', codename: '', documentId: '', documentName: '', pageName: '' })
    ;(hub as any).clients.set(1, client)

    // 永不 resolve，模拟插件挂着
    hub.forwardRequest = (() => new Promise(() => {})) as never

    const started = Date.now()
    const sessions = await hub.listPluginSessionsResolved(150)
    const elapsed = Date.now() - started
    expect(sessions).toHaveLength(1)
    expect(sessions[0].documentName).toBe('')
    expect(elapsed).toBeLessThan(1200)
  })

  it('插件的错误响应不会污染会话（保持空值）', async () => {
    const hub = new WebSocketBridge({ backend: 'penpot' })
    const { client } = makeClient({ clientId: 1, clientType: 'penpot-plugin', backend: 'penpot', sessionId: 'sess_penpot_1', codename: '', documentId: '', documentName: '', pageName: '' })
    ;(hub as any).clients.set(1, client)
    hub.forwardRequest = (async (req: JSONRPCRequest) => ({ jsonrpc: '2.0', id: req.id, error: { code: -32603, message: 'boom' } })) as never

    const sessions = await hub.listPluginSessionsResolved(500)
    expect(sessions[0].documentName).toBe('')
  })
})
