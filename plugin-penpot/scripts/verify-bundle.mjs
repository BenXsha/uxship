#!/usr/bin/env node
/**
 * 构建产物验证 —— 直接跑 `dist/plugin.js`
 *
 * 为什么需要它：单测跑的是 **源码**（vitest 直接 import .ts），而 Penpot 跑的是
 * **打包压缩后的 IIFE**。两者的差异（tree-shaking / 压缩重命名 / 作用域提升）只会在
 * 真机或本脚本里暴露 —— 「测试全绿但插件报 xxx is not a function」就是这么来的。
 *
 * 本脚本用假的 `penpot` 全局加载 dist/plugin.js，走一遍插件沙箱的真实入口
 * （ui.onMessage → SELF_TEST → dsl/render），并打印结果。
 *
 * 用法：node scripts/verify-bundle.mjs [--full]
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const BUNDLE = resolve(ROOT, 'dist/plugin.js')

if (!existsSync(BUNDLE)) {
  console.error(`❌ 找不到 ${BUNDLE} —— 先执行 yarn build`)
  process.exit(1)
}

// ── 最小可用的假宿主：只覆盖插件启动 + 自测渲染需要的那部分 ──
let idSeq = 0
const nextId = (prefix) => `${prefix}-${++idSeq}`
const all = []

function makeShape(type, overrides = {}) {
  const shape = {
    id: nextId(type),
    type,
    name: type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    opacity: 1,
    visible: true,
    blocked: false,
    borderRadius: 0,
    // 真实 board 有 clipContent；缺了会让适配器误判「该类型不支持裁剪内容」
    clipContent: type === 'board' ? true : undefined,
    blendMode: 'normal',
    fills: [],
    strokes: [],
    shadows: [],
    parent: null,
    children: [],
    resize(w, h) {
      this.width = w
      this.height = h
      if (this.type === 'text') this.growType = 'fixed'
    },
    remove() {},
    clone() {
      return makeShape(this.type)
    },
    setParentIndex() {},
    insertChild(index, child) {
      if (child.parent) child.parent.children = child.parent.children.filter((c) => c.id !== child.id)
      this.children.splice(Math.min(index, this.children.length), 0, child)
      child.parent = this
      // 进入有布局的容器 → 宿主会给出 layoutChild（真实行为；缺了会让 FILL 子节点被误判）
      if (this.flex && !child.layoutChild) {
        child.layoutChild = { absolute: false, zIndex: 0, horizontalSizing: 'fix', verticalSizing: 'fix' }
      }
    },
    appendChild(child) {
      this.insertChild(0, child)
    },
    addFlexLayout() {
      this.flex = { dir: 'row', rowGap: 0, columnGap: 0, remove: () => { delete this.flex } }
      return this.flex
    },
    isVariantContainer: () => false,
    bringToFront() {},
    sendToBack() {},
    applyToken() {},
    ...overrides,
  }
  all.push(shape)
  return shape
}

const root = makeShape('board', { name: 'Root' })
const sent = []
let onMessageHandler = null

globalThis.penpot = {
  version: '2.15.0',
  currentFile: { id: 'f1', name: 'Bundle Verify' },
  currentPage: { id: 'p1', name: 'Page 1', root, getShapeById: (id) => all.find((s) => s.id === id) ?? null },
  selection: [],
  theme: 'dark',
  fonts: {
    all: [],
    // 必须给出 variants：真实宿主里字体总是带变体，没有变体则 fontName 无法落地 ——
    // 替身偷懒会让「字体应用失败」被误报成产品问题
    findByName: () => {
      const variants = [
        { name: 'Regular', fontId: 'inter-400', fontWeight: '400', fontFamily: 'Inter' },
        { name: 'SemiBold', fontId: 'inter-600', fontWeight: '600', fontFamily: 'Inter' },
      ]
      return {
        name: 'Inter', fontId: 'inter-400', fontFamily: 'Inter', fontWeight: '400', variants,
        applyToText: (t, v) => { if (v) { t.fontId = v.fontId; t.fontFamily = v.fontFamily; t.fontWeight = v.fontWeight } },
      }
    },
    findById: () => null,
    findAllByName: () => [],
    findAllById: () => [],
  },
  library: { local: { tokens: { addSet: () => ({}) }, components: [], createComponent: () => ({ instance: () => makeShape('board') }) }, connected: [], availableLibraries: async () => [], connectLibrary: async () => ({}) },
  ui: {
    open: () => {},
    size: { width: 400, height: 560 },
    resize: () => {},
    sendMessage: (msg) => sent.push(msg),
    onMessage: (cb) => { onMessageHandler = cb },
  },
  localStorage: { store: new Map(), getItem(k) { return this.store.get(k) ?? null }, setItem(k, v) { this.store.set(k, v) }, removeItem(k) { this.store.delete(k) } },
  viewport: { zoomIntoView: () => {}, zoomReset: () => {} },
  createBoard: () => { const b = makeShape('board'); root.insertChild(root.children.length, b); return b },
  createRectangle: () => makeShape('rectangle'),
  createEllipse: () => makeShape('ellipse'),
  createPath: () => makeShape('path'),
  createText: (t) => makeShape('text', { characters: t, growType: 'fixed' }),
  createShapeFromSvg: (svg) => (svg.includes('<svg') ? makeShape('group') : null),
  createShapeFromSvgWithImages: async (svg) => (svg.includes('<svg') ? makeShape('group') : null),
  createBoolean: () => makeShape('boolean'),
  createPage: () => ({ id: nextId('page'), name: 'New' }),
  createVariantFromComponents: () => makeShape('board'),
  openPage: async () => {},
  group: (shapes) => { const g = makeShape('group'); for (const s of shapes) g.insertChild(g.children.length, s); return g },
  uploadMediaUrl: async (name) => ({ name, width: 1, height: 1 }),
  uploadMediaData: async (name) => ({ name, width: 1, height: 1 }),
  closePlugin: () => {},
}

// ── 加载打包产物（IIFE）──
const code = readFileSync(BUNDLE, 'utf-8')
try {
  // eslint-disable-next-line no-new-func
  new Function(code)()
} catch (error) {
  console.error(`❌ 加载 dist/plugin.js 抛异常: ${error.message}`)
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  await sleep(50)
  if (typeof onMessageHandler !== 'function') {
    console.error('❌ 插件未注册 ui.onMessage —— bootstrap 可能失败了')
    console.error('   已发送的消息:', JSON.stringify(sent, null, 2))
    process.exit(1)
  }

  // 1. 握手（插件 → UI 的 ready 通知）
  onMessageHandler({ source: 'mgmcp-ui', type: 'Hello!' })
  await sleep(20)
  const ready = sent.find((m) => m.type === 'statusChanged')
  console.log(ready ? '✅ 握手成功（statusChanged 已发出）' : '⚠️ 未收到握手消息')

  // 2. 冒烟自测 / 完整自测
  const full = process.argv.includes('--full')
  onMessageHandler({ source: 'mgmcp-ui', type: 'selfTest', data: { id: 'self-test', full } })
  await sleep(300)

  const errorMsg = sent.find((m) => m.type === 'methodError')
  const resultMsg = sent.find((m) => m.type === 'methodResult')

  if (errorMsg) {
    console.error(`❌ 自测失败: ${errorMsg.data?.error}`)
    console.error('   这是打包产物层面的真实失败，不是测试环境差异。')
    process.exit(1)
  }
  if (!resultMsg) {
    console.error('❌ 未收到自测结果')
    console.error('   已发送:', JSON.stringify(sent.map((m) => m.type)))
    process.exit(1)
  }

  const result = resultMsg.data?.response?.result ?? {}
  console.log(`✅ 自测通过（${full ? '完整' : '冒烟'}）`)
  console.log(`   顶层节点      : ${result.rootCount}`)
  console.log(`   创建节点      : ${result.created?.length ?? 0}`)
  console.log(`   降级项        : ${result.skipped?.length ?? 0}`)
  console.log(`   rootNodeIds   : ${JSON.stringify(result.rootNodeIds ?? [])}`)
  console.log(`   未解析 class  : ${result.unresolvedClasses?.length ?? 0}`)
  const skipped = result.skipped ?? []
  for (const skip of skipped) {
    console.log(`     · ${skip.target}: ${skip.reason}`)
  }

  // ── 降级项硬门禁 ──
  //
  // 这份样例（SAMPLE_DSL）是**能力点检卡**：每项都对应一个已知的跨宿主差异。
  // 因此「降级项清单」就是一张能力体检表 —— 只允许出现**明确预期**的降级；
  // 多出任何一项都意味着某项能力悄悄退化了（颜色量纲、子节点顺序、字体应用、
  // 单边描边模拟、逃生口形状生成…… 都会在这里冒出来）。
  // 而 verify-bundle 用的是**打包产物**，所以它还能抓到"单测过、真机挂"的打包期问题。
  const ALLOWED = [/GRADIENT_ANGULAR|GRADIENT_DIAMOND/]
  const unexpected = skipped.filter((skip) => !ALLOWED.some((re) => re.test(`${skip.target} ${skip.reason}`)))
  if (full && unexpected.length) {
    console.error(`\n❌ 出现 ${unexpected.length} 项**非预期**降级（样例是能力点检卡，多出即能力退化）：`)
    for (const skip of unexpected) console.error(`   · ${skip.target}: ${skip.reason}`)
    process.exit(1)
  }

  console.log('\n🎉 打包产物行为与源码一致')
  // 插件内部有 setInterval（dispatcher 缓存回收），不会自然退出
  process.exit(0)
}

main().catch((error) => {
  console.error(`❌ 验证脚本异常: ${error.stack}`)
  process.exit(1)
})
