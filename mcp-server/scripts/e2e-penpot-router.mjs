#!/usr/bin/env node
/**
 * 端到端验证（手动、需先 `npm run build`）
 *
 * 覆盖两种多后端模式：
 *   A. **共联单 hub（默认）**：Penpot 与 MasterGo 客户端连**同一个端口**，按 initialize 自述分区
 *   B. **分端口**：Penpot 单独一个端口（`--penpot-ws-port`）
 *
 * 每个模式都验：握手 → session_list → `_sessionId` 定向转发 → 唯一在线自动路由 → task/* 通知。
 *
 * 用法：
 *   node scripts/e2e-penpot-router.mjs            # 两种模式都跑
 *   node scripts/e2e-penpot-router.mjs --shared   # 只跑共联
 *   node scripts/e2e-penpot-router.mjs --separate # 只跑分端口
 */
import { spawn } from 'node:child_process'
import { WebSocket } from 'ws'

const HTTP_PORT = 15499
const WS_PORT = 15498
const PENPOT_WS_PORT = 4407 // 避开用户实际使用的 4404，避免 e2e 与真实实例抢端口

const onlyShared = process.argv.includes('--shared')
const onlySeparate = process.argv.includes('--separate')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function makeServer(extraArgs) {
  const server = spawn('node', ['dist/index.js', '--http-port', String(HTTP_PORT), '--ws-port', String(WS_PORT), ...extraArgs], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  server.stdout.on('data', (d) => logs.push(`[out] ${d}`))
  server.stderr.on('data', (d) => logs.push(`[err] ${d}`))
  return { server, logs }
}

async function waitFor(cond, label, ctx, timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return
    await sleep(200)
  }
  console.error(`\n❌ 等待超时: ${label}`)
  if (ctx?.logs) console.error(ctx.logs.join(''))
  process.exit(1)
}

/**
 * 跑一个模式。
 * @param {'shared'|'separate'} mode
 */
async function runMode(mode) {
  const separate = mode === 'separate'
  const { server, logs } = makeServer(separate ? ['--penpot-ws-port', String(PENPOT_WS_PORT)] : [])
  const ctx = { logs }
  const penpotPort = separate ? PENPOT_WS_PORT : WS_PORT

  console.log(`\n──────── ${separate ? 'B. 分端口' : 'A. 共联单 hub'}（Penpot 连 ${penpotPort}）────────`)

  const cleanup = () => server.kill('SIGKILL')

  try {
    await waitFor(async () => {
      try { return (await fetch(`http://127.0.0.1:${HTTP_PORT}/health`)).ok } catch { return false }
    }, 'HTTP /health 就绪', ctx)

    const health = await (await fetch(`http://127.0.0.1:${HTTP_PORT}/health`)).json()
    void health

    // ── 假 Penpot 插件 ──
    const plugin = new WebSocket(`ws://127.0.0.1:${penpotPort}`)
    const received = []
    const pendingFromServer = []
    await new Promise((resolve, reject) => {
      plugin.once('open', resolve)
      plugin.once('error', reject)
    })
    plugin.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      received.push(msg)
      if (msg.method && msg.id !== undefined) pendingFromServer.push(msg)
    })

    plugin.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'Penpot-Plugin',
          backend: 'penpot',
          version: '0.1.0',
          codename: 'Penpot',
          documentName: 'E2E 文档',
          documentId: 'e2e-doc',
          pageName: 'Page 1',
          pageId: 'page-1',
        },
      },
    }))

    await waitFor(() => received.some((m) => m.id === 1 && m.result), 'initialize 响应', ctx)
    const initResult = received.find((m) => m.id === 1).result
    // 两种模式下都必须把 Penpot 客户端归属给 penpot —— 这才是真正的不变量
    if (initResult.serverInfo.attributed !== true) {
      throw new Error(`服务端未归属本会话: ${JSON.stringify(initResult.serverInfo)}`)
    }
    if (initResult.serverInfo.backend !== 'penpot') {
      throw new Error(`本会话被归属到了错误的后端: ${JSON.stringify(initResult.serverInfo)}`)
    }
    console.log('✅ 1. 插件握手成功，且被归属到 penpot 后端')

    const call = async (name, args = {}) => {
      const res = await fetch(`http://127.0.0.1:${HTTP_PORT}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method: 'tools/call', params: { name, arguments: args } }),
      })
      const body = await res.json()
      const text = body?.result?.content?.[0]?.text
      try { return JSON.parse(text) } catch { return text }
    }

    // ── session_list：Penpot 会话必须被归属 ──
    const sessions = await call('session_list')
    const penpotSession = sessions.sessions?.find((s) => s.backend === 'penpot')
    if (!penpotSession) throw new Error(`session_list 没有 penpot 会话: ${JSON.stringify(sessions)}`)
    if (penpotSession.sessionId !== 'sess_penpot_e2e-doc') {
      throw new Error(`会话前缀不对: ${penpotSession.sessionId}`)
    }
    console.log(`✅ 2. session_list 列出 penpot 会话: ${penpotSession.sessionId}`)

    // ── _sessionId 定向 ──
    const callPromise = call('document_get_info', { _sessionId: 'sess_penpot_e2e-doc' })
    await waitFor(() => pendingFromServer.length > 0, '插件侧收到转发请求', ctx)
    const forwarded = pendingFromServer.shift()
    if (forwarded.method !== 'document/getInfo') throw new Error(`转发的方法名不对: ${forwarded.method}`)
    if ('_sessionId' in (forwarded.params || {})) throw new Error('路由参数 _sessionId 泄漏到插件参数里')
    plugin.send(JSON.stringify({
      jsonrpc: '2.0',
      id: forwarded.id,
      // 契约：插件 handler 返回**裸数据**，服务端负责包成 CallToolResult
      result: { host: 'penpot', documentName: 'E2E 文档', pageName: 'Page 1' },
    }))
    const docInfo = await callPromise
    if (docInfo?.documentName !== 'E2E 文档') throw new Error(`HTTP 侧未拿到插件回包: ${JSON.stringify(docInfo)}`)
    console.log(`✅ 3. _sessionId 定向转发成功: ${forwarded.method}`)

    // ── 唯一在线自动路由（只有 Penpot 在线）──
    const autoPromise = call('plugin_capabilities')
    await waitFor(() => pendingFromServer.length > 0, '自动路由的请求到达插件', ctx)
    const autoForwarded = pendingFromServer.shift()
    plugin.send(JSON.stringify({
      jsonrpc: '2.0',
      id: autoForwarded.id,
      result: { host: 'penpot', pluginVersion: '0.1.0', available: true },
    }))
    const caps = await autoPromise
    if (caps?.host !== 'penpot') throw new Error(`自动路由未落到 penpot: ${JSON.stringify(caps)}`)
    console.log(`✅ 4. 唯一在线后端自动选中（无 _sessionId）: ${autoForwarded.method}`)

    // ── task/* 通知 ──
    const before = received.filter((m) => String(m.method || '').startsWith('task/')).length
    await call('task_plan', { steps: [{ id: 's1', label: '准备' }] })
    await waitFor(() => received.filter((m) => String(m.method || '').startsWith('task/')).length > before, 'task/plan 到达插件', ctx)
    console.log('✅ 5. 任务进度通知已透传到 Penpot 插件')

    plugin.close()
    console.log(`🎉 ${separate ? '分端口' : '共联单 hub'} 模式全部通过`)
  } finally {
    cleanup()
    await sleep(600)
  }
}

async function main() {
  if (!onlySeparate) await runMode('shared')
  if (!onlyShared) await runMode('separate')
  console.log('\n🎉 端到端验证全部通过')
}

main().catch((error) => {
  console.error(`\n❌ ${error.stack || error}`)
  process.exit(1)
})
