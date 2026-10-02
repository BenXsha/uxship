#!/usr/bin/env node
/**
 * UI 截图检查：用**假 hub** 把真实通知发给插件面板，然后截图
 *
 * 为什么需要：UI 的问题（任务卡片不出现、步骤永远转圈、进度条不动、面板被撑爆）
 * 都不是单测能覆盖的 —— 单测只验状态机，验不了"接进去没有"。而真机验证要开 Penpot、
 * 还要让 AI 真的发起一次调用，太重。
 *
 * 做法：起一个最小 WS 服务端（冒充 hub），按协议回 `initialize`，再依次推
 * `task/plan` → `task/step` → `task/complete`，用 CDP 在关键节点截图。
 *
 * 用法：
 *   node scripts/ui-shot.mjs <输出目录> [--url http://127.0.0.1:4405/index.html]
 *
 * 依赖：ws（已列在 devDependencies，`yarn install` 后即可用）。
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { WebSocketServer } = require('ws')

const outDir = process.argv[2] ?? '/tmp/ui-shots'
const url = process.argv[3] ?? 'http://127.0.0.1:4405/index.html'
const WS_PORT = 15999
const CDP_PORT = 9444
const CHROME = `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── 假 hub ──
const wss = new WebSocketServer({ port: WS_PORT })
let socket = null

wss.on('connection', (ws) => {
  socket = ws
  ws.on('message', (raw) => {
    let message
    try { message = JSON.parse(String(raw)) } catch { return }

    if (message.method === 'initialize') {
      ws.send(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: {
          sessionId: 'sess_penpot_fake', protocolVersion: '1.0',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake-hub', version: '0.0.0' },
        },
      }))
    } else if (message.id) {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }))
    }

    // 连上后自动演一遍任务流程（把动画的每个阶段都过一遍）
    if (message.method === 'initialize') {
      setTimeout(() => notify('task/plan', {
        steps: [
          { id: 'fetch', label: '读取画布选区' },
          { id: 'render', label: '浏览器实测像素' },
          { id: 'land', label: '落地到画布' },
          { id: 'verify', label: '逐框核对' },
        ],
      }), 400)
      setTimeout(() => notify('task/step', { id: 'fetch', status: 'completed', message: '12 个节点' }), 1100)
      setTimeout(() => notify('task/step', { id: 'render', status: 'completed', message: '55 个元素' }), 2100)
      setTimeout(() => notify('task/step', { id: 'land', status: 'running' }), 2150)
    }
  })
})

function notify(method, params) {
  socket?.send(JSON.stringify({ jsonrpc: '2.0', method, params }))
}

// ── CDP ──
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=420,1000', `--user-data-dir=/tmp/ui-shot-profile`,
  'about:blank',
], { stdio: 'ignore' })

async function findTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch { /* 未就绪 */ }
    await sleep(250)
  }
  throw new Error('CDP 未就绪')
}

const ws = new WebSocket(await findTarget())
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
let id = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
})
const send = (method, params = {}) => new Promise((resolve) => {
  const mid = ++id
  pending.set(mid, resolve)
  ws.send(JSON.stringify({ id: mid, method, params }))
})

/**
 * 截图 + **同时读 DOM 断言**。
 *
 * 只截图不够：像素比对会被面板自身的配色干扰（accent/surface 到处都是），
 * 所以每张图都附一份"事实清单"——卡片在不在、各步骤什么状态、进度条多宽。
 * 这份清单跟截图一起给视觉审查，避免它对着图猜。
 */
const probes = []
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const data = result?.result?.data
  if (!data) { console.log(`  ⚠️ ${name} 截图失败`); return }
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, 'base64'))

  const probe = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      // ── 设计 token 与几何断言（把复审的每条结论变成可复跑的检查，而不是靠目视）──
      tokens: (() => {
        const track = document.querySelector('.task__track')
        const fill = document.querySelector('.task__fill')
        const pulse = document.querySelector('.task__pulse')
        const cs = (el) => (el ? getComputedStyle(el) : null)
        return {
          trackBg: cs(track)?.backgroundColor ?? null,
          fillBg: cs(fill)?.backgroundColor ?? null,
          pulseBg: cs(pulse)?.backgroundColor ?? null,
          barHeight: track ? Math.round(track.getBoundingClientRect().height) : null,
        }
      })(),
      nameColumnLefts: [...document.querySelectorAll('.sel-row')].map((el) =>
        Math.round(el.querySelector('.sel-row__name')?.getBoundingClientRect().left ?? -1)),
      codeBox: (() => {
        const ta = document.querySelector('textarea.input')
        if (!ta) return null
        const cs = getComputedStyle(ta)
        return {
          height: Math.round(ta.getBoundingClientRect().height),
          lineHeight: cs.lineHeight,
          resize: cs.resize,
          // 注意：clientHeight **含 padding**，判"整行高度"必须先减掉上下 padding
          // —— 第一版忘了减，于是把一个正确的框报成"有半截行"（量具自己也要校准）
          contentHeight: ta.clientHeight - (parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)),
          hasHalfLine: (() => {
            const lh = parseFloat(cs.lineHeight)
            const content = ta.clientHeight - (parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom))
            return Math.abs(content - Math.round(content / lh) * lh) > 1
          })(),
        }
      })(),
      compact: {
        panels: document.querySelectorAll('.panel').length,
        isCompact: !document.querySelector('.panel'),
        orbCount: document.querySelectorAll('.orb').length,
        resizeCalls: (window.__resizeCalls ?? []),
      },
      orbNotes: [...document.querySelectorAll('.orb-notes')].map((el) => el.textContent.trim()),
      // 面板清单 + 调试开关状态（默认 UI 应当只有"必要"的几块）
      panels: [...document.querySelectorAll('.panel__title')].map((el) => el.textContent.trim()),
      debugOn: /调试/.test(document.querySelector('.orb-bar__ver')?.textContent ?? ''),
      // 滚动条事实（用户反馈"默认滚动条碍眼"后加的断言）：
      //   pageScrolls = 页面级出现滚动条（scrollHeight 超过 clientHeight）
      //   scrollbarWidth = 竖直滚动条实际占掉的宽度（>0 说明真的有滚动条）
      scroll: {
        pageScrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
        scrollbarWidth: window.innerWidth - document.documentElement.clientWidth,
        appScrolls: (() => {
          const app = document.getElementById('app')
          return app ? app.scrollHeight > app.clientHeight + 1 : null
        })(),
        // 自定义滚动条是否真的落在滚动容器上（标准属性，Chromium 121+ 支持）
        appScrollbarColor: (() => {
          const app = document.getElementById('app')
          return app ? getComputedStyle(app).scrollbarColor : null
        })(),
      },
      hasSelection: !!document.querySelector('.sel-list'),
      selectionRows: [...document.querySelectorAll('.sel-row')].map((el) => el.textContent.trim()),
      selectionBadge: [...document.querySelectorAll('.badge')].map((b) => b.textContent.trim()).find((t) => /个对象|未选中|读取失败/.test(t)) ?? null,
      hasTask: !!document.querySelector('.task'),
      failed: !!document.querySelector('.task--failed'),
      summary: document.querySelector('.task__summary')?.textContent ?? null,
      count: document.querySelector('.task__count')?.textContent ?? null,
      elapsed: document.querySelector('.task__elapsed')?.textContent ?? null,
      fillWidth: document.querySelector('.task__fill')?.style.width ?? null,
      steps: [...document.querySelectorAll('.step')].map((el) => ({
        label: el.querySelector('.step__label')?.textContent,
        status: [...el.classList].find((c) => c.startsWith('step--'))?.slice(6) ?? null,
        spinning: !!el.querySelector('.step__spin'),
      })),
    })`,
    returnByValue: true,
  })
  const facts = JSON.parse(probe?.result?.result?.value ?? '{}')
  probes.push({ name, ...facts })
  console.log(`  📸 ${name}.png  ${JSON.stringify(facts)}`)
}

try {
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 1000, deviceScaleFactor: 2, mobile: false })
  // 关键：默认动画下截到的常是"中间帧"（实测：完成态被截在 72% 进度、步骤行只有 0.34 不透明度）。
  // 模拟「减少动效」偏好，等价于用户开了系统开关 → 拿到的是稳定态，且顺带验证了降级样式生效。
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await send('Page.navigate', { url })
  await sleep(1500)

  // 面板默认状态
  await shot('01-idle')

  // 连到假 hub（面板上的输入框 + 连接按钮）
  await send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.querySelector('input.input')
      if (!input) return 'no-input'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'ws://127.0.0.1:${WS_PORT}')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      // ⚠️ 用**精确选择器**：状态球也是 <button>，而它的标签是「未连接/已连接」——
      // 早先用 /连接|断开/ 正则会匹配到球，于是"连接"这步实际把面板折叠了（量具第四次出错）
      const button = document.querySelector('.panel .btn--primary')
      if (!button) return 'no-connect-button'
      button.click()
      return 'clicked'
    })()`,
    returnByValue: true,
  })

  // 连接成功与否**要断言**，不能"点了就当连上"（早先那版点错按钮，后面一路都是错的）
  const connected = await send('Runtime.evaluate', {
    expression: `JSON.stringify({ badge: [...document.querySelectorAll('.badge')].map((b) => b.textContent.trim()).find((t) => /已连接|连接中|未连接/.test(t)) ?? null,
      panels: document.querySelectorAll('.panel').length })`,
    returnByValue: true,
  })
  console.log(`  连接后：${connected?.result?.result?.value}`)

  // 任务流程推进的各个节点各来一张（覆盖：计划刚出、两步完成、完成态）
  await sleep(1200); await shot('02-task-plan')
  await sleep(1400); await shot('03-task-progress')
  await sleep(1200); await shot('04-task-running')
  notify('task/complete', { status: 'success', message: '落地完成' })
  await sleep(700); await shot('05-task-done')
  await sleep(2600); await shot('06-auto-dismissed')

  // 选区面板的数据来自**沙箱**（postMessage），不是 hub —— 这里按真实形态注入一条。
  // 顺带覆盖三种边界：多选、超量截断、读取失败。
  const injectSelection = (data) => send('Runtime.evaluate', {
    expression: `window.postMessage(${JSON.stringify({ source: 'mgmcp-plugin', type: 'selectionChanged', data })}, '*')`,
    returnByValue: true,
  })

  await injectSelection({
    count: 3,
    details: [
      { id: 'a1', type: 'board', name: 'Login Page' },
      { id: 'a2', type: 'text', name: '欢迎回来' },
      { id: 'a3', type: 'path', name: 'Email Icon' },
    ],
    truncated: 0,
  })
  await sleep(400); await shot('07-selection')

  await injectSelection({
    count: 12,
    details: [{ id: 'b1', type: 'board', name: 'Login Page' }],
    truncated: 11,
  })
  await sleep(400); await shot('08-selection-truncated')

  await injectSelection({ count: 0, details: [] })
  await sleep(400); await shot('09-selection-empty')

  // ── 紧凑模式：整个窗口缩成一颗球 ──
  //
  // ⚠️ 这里必须模拟**插件沙箱**，而不是打桩 `window.penpot`：
  // `penpot.ui.*` 只存在于沙箱（code 上下文），UI iframe 没有 `penpot` 全局。
  // （早先打桩 `window.penpot` 的写法让脚本"看起来通过"了，而真机上是永远走兜底分支的 —— 真踩过。）
  // 现在按真实协议：UI 发 `resize` 消息 → 这里当沙箱异步回 `uiResized`。
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.__resizeCalls = [];
      window.__clampTo = window.__clampTo ?? null;
      window.addEventListener('message', (event) => {
        const m = event.data;
        if (!m || m.source !== 'mgmcp-ui' || m.type !== 'resize') return;
        const req = m.data ?? {};
        window.__resizeCalls.push([req.width, req.height]);
        const size = window.__clampTo
          ? { width: Math.max(window.__clampTo.width, req.width), height: Math.max(window.__clampTo.height, req.height) }
          : { width: req.width, height: req.height };
        setTimeout(() => window.postMessage(
          { source: 'mgmcp-plugin', type: 'uiResized', data: { requestId: req.requestId, size } }, '*'), 30);
      });
      return 'fake-sandbox-ready';
    })()`,
    returnByValue: true,
  })

  const clickOrb = () => send('Runtime.evaluate', {
    expression: `(() => { const orb = document.querySelector('.orb'); if (!orb) return 'no-orb'; orb.click(); return 'clicked' })()`,
    returnByValue: true,
  })

  // 默认 UI 应当干净：只剩必要区块（本地自测 / HTML→画布 都被收起）
  await shot('09b-clean-ui')

  // 点顶栏版本号 → 调试面板出现（不删功能，只是默认不占地方）
  await send('Runtime.evaluate', {
    expression: `(() => { document.querySelector('.orb-bar__ver')?.click(); return 'toggled' })()`,
    returnByValue: true,
  })
  await sleep(400)
  await shot('09c-debug-ui')
  await send('Runtime.evaluate', {
    expression: `(() => { document.querySelector('.orb-bar__ver')?.click(); return 'toggled-back' })()`,
    returnByValue: true,
  })
  await sleep(300)

  await clickOrb()
  await sleep(500)
  await shot('10-compact-ball')

  await clickOrb()
  await sleep(500)
  await shot('11-expanded-again')

  // 宿主 min/max 把球窗口夹大 → 面板必须**如实提示**，而不是假装成功
  await send('Runtime.evaluate', { expression: `window.__clampTo = { width: 240, height: 240 }; 'clamp-on'`, returnByValue: true })
  await clickOrb()
  await sleep(600)
  await shot('12-compact-clamped')
  writeFileSync(join(outDir, 'probes.json'), JSON.stringify(probes, null, 2))
  console.log(`\n事实清单: ${join(outDir, 'probes.json')}`)
} finally {
  chrome.kill()
  wss.close()
}
