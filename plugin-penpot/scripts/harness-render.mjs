#!/usr/bin/env node
/**
 * 离线渲染检查：**真引擎 + 真浏览器**，不碰 Penpot
 *
 * 解决的问题：画布上「尺寸/位置不对」时，第一步必须分清是
 *   (a) **引擎给错了尺寸**（HTML→DSL 实测阶段），还是
 *   (b) **宿主没兑现 DSL**（DSL→画布阶段）。
 * 以前只能渲到真画布再回读 —— 有副作用、还会被宿主侧的其它 bug 干扰，分不清责任方。
 *
 * 做法：借用仓库自带的 harness（`yarn harness:build` 产物，内部是 useClientRender +
 * MemoryHost + renderDsl 的同一条链路），用 CDP 驱动一个**带合成器的无头 Chrome**
 * （注意：headless-shell 不触发 requestAnimationFrame，引擎会卡住），调用
 * `window.__renderHtml(html)` 拿回引擎实测产出的 DSL。
 *
 * 用法：
 *   yarn harness:build
 *   node scripts/serve.mjs --root harness-dist --port 4406 &
 *   node scripts/harness-render.mjs <html 文件路径>
 *
 * 输出：引擎 DSL 的逐节点 size / 布局字段（缩进表示层级）。
 * 想同时看「落地后的几何」，在页面里读返回值的 `created` 即可（见 dev/harness.ts 的 __renderHtml）。
 */
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolveChrome, chromeNotFoundMessage, extraChromeFlags } from './chrome.mjs'

const HARNESS_URL = process.env.HARNESS_URL ?? 'http://127.0.0.1:4406/dev/harness.html'
const CDP_PORT = Number(process.env.CDP_PORT ?? 9333)

// 浏览器定位与 `--no-sandbox` 那个坑的来龙去脉，都在 scripts/chrome.mjs 的头部注释里
const CHROME = resolveChrome()
if (!CHROME) {
  console.error(chromeNotFoundMessage())
  process.exit(2)
}

const target = process.argv[2]
if (!target) {
  console.error('用法: node scripts/harness-render.mjs <html 文件路径>')
  process.exit(2)
}
const html = readFileSync(target, 'utf-8')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  `--user-data-dir=${process.env.CDP_PROFILE ?? '/tmp/harness-cdp-profile'}`,
  ...extraChromeFlags(),
  'about:blank',
], { stdio: 'ignore' })

async function findPageTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch { /* 还没起来 */ }
    await sleep(250)
  }
  throw new Error('CDP 未就绪（Chrome 没启动成功？）')
}

const ws = new WebSocket(await findPageTarget())
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))

let nextId = 0
const pending = new Map()
const consoleLogs = []
ws.addEventListener('message', (event) => {
  // CDP 帧理应是 JSON。解析不了说明帧被截断或协议变了 —— 不静默吞掉（记一条可见日志），
  // 但也不让一次坏帧炸掉整轮渲染：渲染要跑几十秒，半路崩掉会让人误以为是引擎的问题。
  let message
  try {
    message = JSON.parse(event.data)
  } catch {
    consoleLogs.push(`[harness] 无法解析的 CDP 帧（已跳过）：${String(event.data).slice(0, 200)}`)
    return
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    consoleLogs.push(message.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
})
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId
  pending.set(id, resolve)
  ws.send(JSON.stringify({ id, method, params }))
})

try {
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: HARNESS_URL })
  await sleep(2500)

  const evaluated = await send('Runtime.evaluate', {
    expression: `(async () => JSON.stringify(await window.__renderHtml(${JSON.stringify(html)})))()`,
    awaitPromise: true,
    returnByValue: true,
  })
  const value = evaluated?.result?.result?.value
  if (!value) {
    console.error('❌ 渲染失败')
    console.error(JSON.stringify(evaluated).slice(0, 600))
    if (consoleLogs.length) console.error('页面日志:\n' + consoleLogs.slice(-6).join('\n'))
    process.exit(1)
  }

  const { dsl, skipped } = JSON.parse(value)
  console.log(`=== 引擎实测产出的 DSL（${target}）===`)
  const walk = (el, depth = 0) => {
    const size = el.size ?? {}
    const extras = [
      el.layoutMode && el.layoutMode !== 'NONE' ? el.layoutMode : '',
      el.paddingTop || el.paddingRight || el.paddingBottom || el.paddingLeft
        ? `pad=${el.paddingTop ?? 0}/${el.paddingRight ?? 0}/${el.paddingBottom ?? 0}/${el.paddingLeft ?? 0}` : '',
      el.itemSpacing ? `gap=${el.itemSpacing}` : '',
      el.primaryAxisSizingMode ? `primary=${el.primaryAxisSizingMode}` : '',
      el.counterAxisSizingMode ? `counter=${el.counterAxisSizingMode}` : '',
    ].filter(Boolean).join(' ')
    console.log(
      `${'  '.repeat(depth)}${String(el.name ?? '').slice(0, 30).padEnd(32)}${String(el.type).padEnd(10)}` +
      `${String(size.width ?? '?').padStart(7)} x ${String(size.height ?? '?').padEnd(7)} ${extras}`,
    )
    for (const child of el.children ?? []) walk(child, depth + 1)
  }
  for (const el of dsl.elements ?? []) walk(el)

  // 文档级旁路通道也要打出来：否则「class 没解析」「节点被丢弃」「文本按单行收敛」这些
  // 只能从 DSL 树里反推（或根本看不出来）——它们是「不静默降级」承诺的可观测面。
  const reportedClasses = dsl._unresolvedClasses ?? []
  if (reportedClasses.length) {
    console.log(`\n未解析 class / 客户端渲染告警 ${reportedClasses.length} 条：`)
    for (const item of reportedClasses) console.log(`  ${String(item).slice(0, 160)}`)
  }
  const layoutWarnings = dsl._layoutWarnings ?? []
  if (layoutWarnings.length) {
    console.log(`\n布局告警 ${layoutWarnings.length} 条：`)
    for (const item of layoutWarnings) console.log(`  ${String(item).slice(0, 160)}`)
  }

  if (skipped?.length) {
    console.log(`\n落地降级 ${skipped.length} 条：`)
    for (const s of skipped.slice(0, 10)) console.log(`  ${s.target}: ${String(s.reason).slice(0, 80)}`)
  }
} finally {
  chrome.kill()
}
