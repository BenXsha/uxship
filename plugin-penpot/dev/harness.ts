/**
 * 客户端渲染 harness —— 在**真实浏览器**里验证 P3 的整条链路
 *
 * 为什么不写在 vitest 里：这条链路的本质是「交给浏览器排版再实测」，
 * 而 jsdom / happy-dom **没有布局引擎**（`getBoundingClientRect` 全返回 0），
 * 用它们测出来的只是「代码不抛错」，而不是「布局是对的」。
 *
 * 本 harness 用真实 Chromium 跑：
 *   HTML(+Tailwind) → 浏览器排版 → 实测像素 → DSL → MemoryHost（真宿主端的同一份渲染器）
 * 因此它同时验证了「引擎」与「DSL 能否被消费」两件事，且不依赖 Penpot。
 *
 * 用法（见 package.json 的 harness:build / harness:serve）：
 *   1. yarn harness:build
 *   2. node scripts/serve.mjs --root harness-dist --port 4406
 *   3. 用**真实浏览器**打开 http://127.0.0.1:4406/dev/harness.html，读 `window.__harness`
 *      （结果也会渲染到页面的 #harness-summary，便于 --dump-dom 抓取）
 *
 * ⚠️ 已经踩到的坑：**`chrome-headless-shell` 不触发 `requestAnimationFrame`**，
 * 而渲染引擎在测像素前会 `await requestAnimationFrame(...)`，于是 harness 会永远卡在
 * 第一个样例（DOM 里能看到注入的容器，但没有 #harness-result）。
 * 要用无头环境跑，请用带合成器的 Chrome（如 `--headless=new`），而不是 headless-shell。
 */
import { useClientRender } from '../ui/composables/useClientRender'
import { MINIMAL_HTML, SAMPLE_HTML } from '../ui/sample-html'
import { MemoryHost } from '../lib/host/memory'
import { renderDsl } from '../lib/dsl/renderer'

interface CheckResult {
  name: string
  ok: boolean
  detail: string
}

interface HarnessResult {
  ok: boolean
  checks: CheckResult[]
  dsl: Record<string, unknown>
  rawSampleDsl?: unknown
  error?: string
}

const checks: CheckResult[] = []

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail })
}

function summarizeDsl(dsl: any) {
  const root = dsl?.elements?.[0]
  const flat: any[] = []
  const walk = (list: any[]) => {
    for (const node of list || []) {
      flat.push(node)
      if (Array.isArray(node?.children)) walk(node.children)
    }
  }
  walk(dsl?.elements)

  return {
    elementCount: flat.length,
    rootName: root?.name,
    rootSize: root?.size,
    rootLayoutMode: root?.layoutMode,
    types: [...new Set(flat.map((n) => n.type))],
    fillTypes: [...new Set(flat.flatMap((n) => (n.fills || []).map((f: any) => f.type)))],
    // 填充/节点类型自引擎归一化后统一小写（`gradient_linear` / `image`），比较前先大写。
    hasGradient: flat.some((n) => (n.fills || []).some((f: any) => String(f.type).toUpperCase().startsWith('GRADIENT'))),
    hasImageFill: flat.some((n) => n.imageUrl || (n.fills || []).some((f: any) => String(f.type).toUpperCase() === 'IMAGE')),
    // 解析后的图标/内联 SVG 以 `{ type: 'frame', svgContent }` 表达（见 extractSvgResultNode），
    // 落宿主时由 DSL 渲染器在内容区建一个 SVG 子节点 —— 不是旧的 `type: 'svg'`。
    hasSvg: flat.some((n) => Boolean(n.svgContent)),
    textContents: flat.filter((n) => n.type === 'text').map((n) => String(n.content ?? '').slice(0, 24)),
    hasPerCornerRadius: flat.some((n) => n.cornerRadius !== undefined || n.topLeftRadius !== undefined),
    unresolvedClasses: dsl?._unresolvedClasses ?? [],
  }
}

async function run(): Promise<HarnessResult> {
  const { renderHtml } = useClientRender()

  // ── 1. 极简样例：完全不依赖网络 ──
  const minimalDsl: any = await renderHtml(MINIMAL_HTML)
  const minimal = summarizeDsl(minimalDsl)

  check('极简样例产出 DSL', minimal.elementCount > 0, `${minimal.elementCount} 个元素`)
  check(
    '根节点尺寸是实测值（非 0）',
    Number(minimal.rootSize?.width) > 0 && Number(minimal.rootSize?.height) > 0,
    `${minimal.rootSize?.width}×${minimal.rootSize?.height}`,
  )
  check('极简样例无未解析 Tailwind class', minimal.unresolvedClasses.length === 0, `${minimal.unresolvedClasses.length} 个`)

  const minimalHost = new MemoryHost()
  const minimalReport = await renderDsl(minimalHost, minimalDsl)
  check('极简 DSL 能被宿主渲染器消费', minimalReport.rootCount > 0, `rootCount=${minimalReport.rootCount}`)
  check(
    '极简 DSL 无结构性降级',
    minimalReport.skipped.filter((s) => s.target !== 'fills' && s.target !== 'strokes' && s.target !== 'effects').length === 0,
    `${minimalReport.skipped.length} 项降级`,
  )

  // ── 2. 完整样例：渐变 / data-icon / 远程图片 ──
  const sampleDsl: any = await renderHtml(SAMPLE_HTML)
  const sample = summarizeDsl(sampleDsl)

  check('完整样例产出 DSL', sample.elementCount > 0, `${sample.elementCount} 个元素`)
  check('渐变填充被识别', sample.hasGradient, `填充类型: ${sample.fillTypes.join(',')}`)
  check('data-icon 被解析为 SVG', sample.hasSvg, `类型: ${sample.types.join(',')}`)
  check('文本内容被提取', sample.textContents.length >= 2, sample.textContents.join(' | '))
  check('圆角被提取', sample.hasPerCornerRadius, '存在圆角字段')
  check(
    '远程图片被识别为图片填充',
    sample.hasImageFill,
    sample.hasImageFill ? 'imageUrl / IMAGE fill 存在' : '(未识别)',
  )

  const sampleHost = new MemoryHost()
  const sampleReport = await renderDsl(sampleHost, sampleDsl)
  check('完整 DSL 能被宿主渲染器消费', sampleReport.rootCount > 0, `rootCount=${sampleReport.rootCount} / created=${sampleReport.created.length}`)
  check(
    '完整 DSL 的图层名语义化（data-name 未丢）',
    sampleReport.created.every((c) => c.name && !/^(div|frame|section)_?\d*$/.test(c.name)),
    sampleReport.created.slice(0, 6).map((c) => c.name).join(', '),
  )

  return {
    ok: checks.every((c) => c.ok),
    checks,
    dsl: { minimal, sample },
    /** 原始 DSL（调试用：看引擎实际产出的字段，而不是我对它的概括） */
    rawSampleDsl: sampleDsl,
  }
}

// SAFETY: `window.__harness` 是本文件 `publish()` 注入的调试钩子，不属于标准 Window 类型；断言后仍按可选字段读（未注入时为 undefined）。
const target = window as unknown as { __harness?: HarnessResult | { status: string; error: string } }

/**
 * 把结果同时写进 DOM。
 * 理由：无头验证只需 `chrome-headless-shell --dump-dom`，不必依赖 Playwright JS ——
 * 对 CI / 沙箱环境更强健。
 */
function publish(result: HarnessResult | { status: string; error: string }): void {
  target.__harness = result
  const pre = document.createElement('pre')
  pre.id = 'harness-result'
  pre.textContent = JSON.stringify(result, null, 2)
  document.body.appendChild(pre)

  const summary = document.createElement('ul')
  summary.id = 'harness-summary'
  for (const check of (result as HarnessResult).checks ?? []) {
    const li = document.createElement('li')
    li.textContent = `${check.ok ? 'PASS' : 'FAIL'} | ${check.name} | ${check.detail}`
    summary.appendChild(li)
  }
  document.body.appendChild(summary)
}

/**
 * 调试钩子：渲染**任意** HTML 并回传「引擎实测出的 DSL」+「MemoryHost 落地后的几何」。
 *
 * 为什么需要：排查「画布上高度不对」这类问题时，必须先分清是**引擎给错了尺寸**，
 * 还是**宿主没兑现 DSL**。以前只能靠把样例渲到真画布上再回读（有副作用、且分不清责任方），
 * 有了这个钩子就能离线二分：
 *
 *   await window.__renderHtml('<section data-name="X" ...>…</section>')
 *   → { dsl, created }   dsl = 引擎产出（含它实测的 size），created = 落地后的节点
 */
// SAFETY: `window.__renderHtml` 是本文件末尾挂载的调试钩子；断言后用前仍以 `?.` 判定缺失分支。
const debugTarget = window as unknown as {
  __renderHtml?: (html: string, options?: { width?: number }) => Promise<unknown>
}

// `options` 预留给调用方（曾用于指定渲染宽度），当前实现不用它 —— 前缀 `_` 表明是有意保留的签名。
debugTarget.__renderHtml = async (html: string, _options: { width?: number } = {}) => {
  const renderer = useClientRender()
  // SAFETY: `useClientRender()` 返回对象上的 `renderHtml` 未收进公开类型；断言仅用于调用，返回值形状由本文件自查。
  const dsl = (await (renderer as unknown as {
    renderHtml: (input: string) => Promise<Record<string, unknown>>
  }).renderHtml(html)) as { elements?: unknown[] }

  const host = new MemoryHost()
  await host.init()
  const report = await renderDsl(host, dsl as { elements?: never[] }, { zoom: false, select: false, loadFonts: false })

  return { dsl, created: report.created, skipped: report.skipped }
}

run()
  .then((result) => {
    publish(result)
    document.title = result.ok ? '✅ harness 通过' : '❌ harness 失败'
  })
  .catch((error: Error) => {
    publish({ status: 'error', error: error?.message ?? String(error) })
    document.title = '❌ harness 异常'
  })
