/**
 * 紧凑模式（把插件窗口缩成一个状态球）
 *
 * 这是 plugin-mastergo 那套体验里最显眼的一块：面板可以折叠成一个悬浮球，点一下再展开。
 * 一开始我以为 Penpot 做不到（以为面板尺寸在 `open()` 时定死）—— **错了**：
 * 官方 API 有
 *   `penpot.ui.resize(width, height) => void`   // "Resizes the plugin UI."
 *   `penpot.ui.size: {width,height} | null`     // 当前尺寸，未打开时为 null
 * 所以这条路是通的，这里把它实现出来。
 *
 * ⚠️ 官方在 `open()` 的说明里提到尺寸有 **min/max 限制**，但没有给出具体数值。
 * 因此策略是「请求 → **读回** → 以读回的为准」：如果宿主把球的大尺寸夹到了最小值，
 * 我们如实记录（`lastApplied`）而不是假设自己拿到了想要的大小；紧凑态布局本身也必须
 * 能在被夹大的窗口里居中显示（见 `.app--compact`）。
 *
 * ⚠️ **调用方在沙箱，不在 UI**：`penpot.ui.*` 只存在于插件沙箱（code 上下文），
 * UI iframe 里没有 `penpot` 全局 —— 这是本项目自己的分层。我第一版把 `resize` 写在 UI 侧
 * （去读 `globalThis.penpot?.ui`），真机点下去只会得到兜底提示「当前环境没有 penpot.ui.resize」。
 * 现在：UI 发 `UIMessage.RESIZE` → 沙箱调 `penpot.ui.resize` 并读回尺寸 → 回 `UI_RESIZED`。
 *
 * 因此本模块的尺寸端口是**异步**的（返回 Promise<实际尺寸|null>），这样可以：
 *   1. 直接单测（断言下发了什么、宿主回夹大时怎么提示）；
 *   2. 在脱离插件的环境（harness / ui-shot / 纯浏览器）里优雅降级 —— 视觉切换照常，
 *      超时/无响应时如实记一条说明，而不是假装成功。
 */
import { computed, ref, type Ref } from 'vue'

/**
 * 尺寸端口：**异步**下发并返回宿主实际给到的尺寸。
 *
 * 返回 `null` 表示没拿到确切尺寸（无响应 / 宿主不支持）—— 那种情况下界面切换照常，
 * 但要记一条说明（不静默）。
 */
export interface UiSizePort {
  resize?(width: number, height: number): Promise<{ width: number; height: number } | null> | { width: number; height: number } | null
}

export interface UseCompactModeOptions {
  /** 展开尺寸（与 main.ts 里 `penpot.ui.open` 的初始尺寸保持一致） */
  expanded?: { width: number; height: number }
  /** 折叠尺寸：只要装得下那颗球。官方有最小值，被夹大也能用（布局居中） */
  compact?: { width: number; height: number }
  /** 端口：默认从全局 `penpot.ui` 取，取不到就降级 */
  port?: UiSizePort | null
  /** 打开时是否直接以紧凑球形态（默认 false；App 传 true 以对齐 MasterGo 版） */
  initialCompact?: boolean
}

export function useCompactMode(options: UseCompactModeOptions = {}) {
  const expanded = options.expanded ?? { width: 400, height: 560 }
  // 与 plugin-mastergo 的紧凑尺寸一致（180×180）：球 84px + 光斑溢出 ~13px + 内边距，
  // 再留一行空间给"宿主夹尺寸"的说明条。太小会把说明条挤没。
  const compact = options.compact ?? { width: 180, height: 180 }

  /**
   * 端口由调用方注入（UI 侧接的是"发消息给沙箱"的实现）。
   *
   * 这里**刻意不去读全局 `penpot`**：UI iframe 里没有它。第一版就是那么写的，
   * 于是真机上永远走"没有 resize 能力"的兜底分支。
   */
  const resolvePort = (): UiSizePort | null => options.port ?? null

  const isCompact = ref(options.initialCompact === true)
  /** 最近一次下发/读回的结果，供界面如实展示（被宿主夹过时不静默） */
  const lastApplied = ref<{ width: number; height: number } | null>(null)
  const notes = ref<string[]>([])

  const canResize = computed(() => typeof resolvePort()?.resize === 'function')

  function addNote(note: string): void {
    if (!notes.value.includes(note)) notes.value = [...notes.value, note]
  }

  /** 尺寸下发的序号：只认最后一次请求的结果（快速连点时不回退、不串台） */
  let pendingSeq = 0

  async function applySize(target: { width: number; height: number }): Promise<void> {
    const port = resolvePort()
    if (typeof port?.resize !== 'function') {
      addNote('当前 UI 没接上尺寸端口（脱离插件时属正常），窗口尺寸未改变')
      lastApplied.value = null
      return
    }

    const seq = ++pendingSeq
    let actual: { width: number; height: number } | null = null
    try {
      actual = (await port.resize(target.width, target.height)) ?? null
    } catch (error) {
      addNote(`调整窗口尺寸失败：${(error as Error).message}`)
      return
    }
    // 连点场景：后发的请求已经生效，这次结果作废
    if (seq !== pendingSeq) return

    if (!actual) {
      addNote('沙箱没有回报窗口尺寸（插件未打开 / 旧版 Penpot），窗口尺寸可能未改变')
      lastApplied.value = null
      return
    }

    lastApplied.value = actual
    if (Math.abs(actual.width - target.width) > 1 || Math.abs(actual.height - target.height) > 1) {
      addNote(`宿主把窗口尺寸从 ${target.width}×${target.height} 调成了 ${actual.width}×${actual.height}（官方对插件窗口有 min/max 限制）`)
    }
  }

  function collapse(): void {
    isCompact.value = true
    void applySize(compact)
  }

  function expand(): void {
    isCompact.value = false
    void applySize(expanded)
  }

  function toggle(): void {
    isCompact.value ? expand() : collapse()
  }

  return { isCompact: isCompact as Ref<boolean>, canResize, lastApplied, notes, collapse, expand, toggle, compactSize: compact, expandedSize: expanded }
}
