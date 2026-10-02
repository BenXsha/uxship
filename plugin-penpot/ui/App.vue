<script setup lang="ts">
/**
 * mgMCP for Penpot —— 插件面板
 *
 * 职责边界（与 lib/main.ts 对称）：
 *   - 本组件持有 **WebSocket**（复用 plugin-mastergo 的 useMCPConnection）
 *   - 通过 postMessage 把插件执行请求转给插件沙箱，并把响应回送 hub
 *   - 「自测」按钮**不经过网络**，直接驱动插件渲染内置 DSL —— 用于把
 *     「插件↔宿主↔画布」与「插件↔hub↔AI」两条链的排障解耦
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useMCPConnection } from './composables/useMCPConnection'
import { useLogger } from './composables/useLogger'
import { useTaskProgress } from './composables/useTaskProgress'
import { useSelection } from './composables/useSelection'
import { useCompactMode } from './composables/useCompactMode'
import { useDebugMode } from './composables/useDebugMode'
import TaskProgress from './components/TaskProgress.vue'
import SelectionPanel from './components/SelectionPanel.vue'
import StatusOrb from './components/StatusOrb.vue'
import AboutDialog from './components/AboutDialog.vue'
import { useClientRender } from './composables/useClientRender'
import { PluginMessage, UIMessage, sendMsgToPlugin } from '@messages/sender'
import { MINIMAL_HTML, SAMPLE_HTML } from './sample-html'

const { logs, addLog, clearLogs } = useLogger()

/** 日志过滤 / 复制：面板窄，日志是主要排障入口 */
const errorsOnly = ref(false)
const visibleLogs = computed(() => (errorsOnly.value ? logs.value.filter((entry) => entry.type === 'error') : logs.value))

/** 会话代号（多 session 身份，按文档持久化）：点击可改 —— 服务端 session_list/session_switch 靠它区分实例 */
const editingCodename = ref(false)
const codenameEdit = ref('')
const codenameInput = ref<HTMLInputElement | null>(null)

let codenameCancelled = false

function beginEditCodename(): void {
  codenameEdit.value = codename.value || ''
  editingCodename.value = true
  void nextTick(() => {
    const el = codenameInput.value
    el?.focus()
    el?.select() // 预选，便于整段替换
  })
}

/** 保存（Enter / 失焦）：空值或未改则忽略；下发后沙箱持久化并回广播，UI 再同步服务端 */
function commitCodename(): void {
  if (!editingCodename.value || codenameCancelled) return
  const next = codenameEdit.value.trim()
  editingCodename.value = false
  if (!next || next === codename.value) return
  sendMsgToPlugin({ type: UIMessage.SET_CODENAME, data: { codename: next } })
  addLog('info', `会话代号改为 ${next}（服务端 session_list 将同步）`)
}

/** 取消（Esc）：用标志位挡住随之而来的 blur —— 否则“取消”会被 blur 又提交一次 */
function cancelCodename(): void {
  codenameCancelled = true
  editingCodename.value = false
  void nextTick(() => {
    codenameCancelled = false
  })
}

async function copyLogs(): Promise<void> {
  const text = logs.value.map((entry) => `${entry.time} [${entry.type}] ${entry.message}`).join('\n')
  try {
    await navigator.clipboard.writeText(text)
    addLog('success', `已复制 ${logs.value.length} 条日志`)
  } catch {
    addLog('error', '复制失败（宿主 iframe 可能未授权剪贴板）—— 可手动选中日志文本')
  }
}

/**
 * 客户端渲染引擎（从 plugin-mastergo 逐字移植，宿主无关）。
 *
 * 它做的事：把 HTML+Tailwind 插进隐藏容器 → 交给真实浏览器排版 →
 * `getComputedStyle` + `getBoundingClientRect` 实测 → 产出 DSL。
 * 这是本项目与「让模型猜尺寸」那类方案的本质差别。
 */
const { state: renderState, renderHtml, resetState } = useClientRender()

const defaultHubUrl =
  typeof __DEFAULT_HUB_URL__ === 'string' ? __DEFAULT_HUB_URL__ : 'ws://localhost:15489'

/**
 * 任务步骤（服务端把 AI 的工作拆成步骤下发）。
 *
 * 与 plugin-mastergo 同一套状态机（`useTaskProgress`），差异是成功后会自动收起 ——
 * 完成卡片留在窄面板上会挡住下面的内容。
 */
const {
  activeTask,
  hasActiveTask,
  hasFailed,
  completedCount,
  totalSteps,
  progressPercent,
  currentStepId,
  summaryText,
  handleTaskPlan,
  handleTaskStep,
  handleTaskComplete,
  dismissTask,
} = useTaskProgress()

/**
 * 当前选区（只展示）。数据由沙箱在 `selectionchange` / `pagechange` 时推来 ——
 * 此前 UI 收到 SELECTION_CHANGED 只是写一条日志，"选了什么"在面板上是不可见的。
 */
const { count: selectionCount, details: selectionDetails, truncated: selectionTruncated, error: selectionError, updateSelection } = useSelection()

const connection = useMCPConnection(addLog, {
  defaultServerUrl: defaultHubUrl,
  // 服务端靠这两项把本会话归到 penpot 后端（会话前缀 sess_penpot_）
  clientName: 'Penpot-Plugin',
  clientBackend: 'penpot',
  /**
   * 拦截 `html/render-client`：服务端把预处理过的 HTML 发过来，
   * 我们在插件 UI 的 iframe 里真实渲染并回传 DSL，由插件沙箱落到画布。
   * 只接 `onClientRender` 就会自动接管，无需改 useMCPConnection。
   */
  onClientRender: async (html: string) => {
    addLog('info', `收到客户端渲染请求（HTML ${html.length} 字符）`)
    const dsl = await renderHtml(html)
    const elementCount = countDslElements(dsl)
    addLog('success', `客户端渲染完成：${elementCount} 个元素、${dsl._unresolvedClasses?.length ?? 0} 个未解析 class`)
    return dsl
  },
  onSelectionChange: (data: any) => {
    updateSelection(data ?? {})
    addLog('info', `选区变化：${data?.count ?? '?'} 个节点`)
  },
  onTaskPlan: handleTaskPlan,
  onTaskStep: handleTaskStep,
  onTaskComplete: handleTaskComplete,
})

const {
  status,
  serverUrl,
  serverBackend,
  serverAttributed,
  serverAcceptedBackends,
  serverVersion,
  codename,
  isConnected,
  isConnecting,
  isProcessing,
  statusText,
  connectionButtonText,
  toggleConnection,
  cleanup,
} = connection

// ── 插件侧信息 ──

const documentInfo = ref<{ documentName: string; documentId: string; pageName: string; pageId: string } | null>(null)
const hostName = ref<string>('')
const hostVersion = ref<string>('')
const pluginVersion = ref<string>('')
const capabilities = ref<Record<string, any> | null>(null)
const showCapabilities = ref(false)
/** 「关于 / 调试」弹层：版本、宿主与文档、能力、自测/HTML 这些低频内容收在这里 */
const showAbout = ref(false)

/** 插件版本 vs 服务端版本：两者应一致（插件版本现跟随服务端） */
const versionMismatch = computed(() =>
  Boolean(pluginVersion.value && serverVersion.value && pluginVersion.value !== serverVersion.value),
)

// ── 自测结果 ──

interface RenderReport {
  ok: boolean
  label?: string
  rootCount?: number
  rootNodeIds?: string[]
  host?: string
  skipped?: { path: string; target: string; reason: string }[]
  created?: { id: string; name: string; kind: string; dslType: string }[]
  perElement?: { path: string; applied: number; skipped: number }[]
  verify?: Record<string, unknown>[]
  unresolvedClasses?: string[]
  /** 布局告警（客户端渲染上报，如「刀尖换行」） */
  layoutWarnings?: string[]
  /** 耗时：沙箱落地（hostRenderMs）+ 客户端渲染段（clientRenderMs） */
  timing?: { hostRenderMs?: number; clientRenderMs?: number }
  hint?: string
}

const report = ref<RenderReport | null>(null)
const selfTesting = ref(false)

// ── 本地 HTML → 画布（不经任何服务端）──

const manualHtml = ref(MINIMAL_HTML)
const htmlRendering = ref(false)

function countDslElements(dsl: any): number {
  let count = 0
  const walk = (list: any[]) => {
    for (const node of list || []) {
      count += 1
      if (Array.isArray(node?.children)) walk(node.children)
    }
  }
  walk(dsl?.elements)
  return count
}

/**
 * 本地全链路自测：HTML → 浏览器渲染 → DSL → 插件沙箱 → 画布。
 *
 * 与「冒烟渲染」的区别：冒烟渲染跳过 HTML 这一层（直接下发 DSL），
 * 所以两者结合可以把问题定位到「引擎」还是「落地」。
 */
async function renderManualHtml(): Promise<void> {
  htmlRendering.value = true
  report.value = null
  resetState()

  try {
    addLog('info', `开始客户端渲染（HTML ${manualHtml.value.length} 字符）`)
    const dsl = await renderHtml(manualHtml.value)

    const unresolved: string[] = dsl?._unresolvedClasses ?? []
    addLog(
      unresolved.length ? 'error' : 'success',
      `客户端渲染完成：${countDslElements(dsl)} 个元素` +
        (unresolved.length ? `，${unresolved.length} 个 Tailwind class 未解析（样式会丢）` : ''),
      unresolved.slice(0, 30),
    )

    const requestId = `html-render-${Date.now()}`
    sendMsgToPlugin({
      type: UIMessage.EXECUTE_METHOD,
      data: { request: { jsonrpc: '2.0', id: requestId, method: 'dsl/render', params: { dsl, focus: true, select: true } } },
    })
    addLog('info', 'DSL 已下发给插件沙箱，等待落地结果')
  } catch (error) {
    htmlRendering.value = false
    addLog('error', `客户端渲染失败：${(error as Error).message}`)
  }
}

/**
 * 窗口尺寸请求：**发给沙箱**执行，而不是在这里直接调。
 *
 * `penpot.ui.*` 只存在于插件沙箱（code 上下文），UI iframe 里没有 `penpot` 全局 ——
 * 我第一版就是在这里读 `globalThis.penpot?.ui.resize`，真机点下去只得到兜底提示。
 * 现在：发 `UIMessage.RESIZE` → 沙箱调 `penpot.ui.resize` 并读回 `penpot.ui.size` → 回 `UI_RESIZED`。
 */
const resizeSeq = ref(0)
const pendingResize = new Map<number, (size: { width: number; height: number } | null) => void>()

function requestUiResize(width: number, height: number): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const requestId = ++resizeSeq.value
    pendingResize.set(requestId, resolve)
    sendMsgToPlugin({ type: UIMessage.RESIZE, data: { requestId, width, height } })

    // 沙箱没回报（插件未打开 / 旧版 Penpot）→ 超时交回 null，由 useCompactMode 如实记说明
    setTimeout(() => {
      const pending = pendingResize.get(requestId)
      if (pending) {
        pendingResize.delete(requestId)
        pending(null)
      }
    }, 1500)
  })
}

/**
 * 紧凑模式：点状态球把插件窗口缩成一颗球，再点展开。
 *
 * （更正：我曾断言 Penpot 做不到这件事 —— 错的，官方有 `penpot.ui.resize`。
 * 但又踩了第二层坑：它必须在**沙箱**里调，UI 侧没有 `penpot`。）
 */
const { isCompact, toggle: toggleCompact, notes: compactNotes } = useCompactMode({
  port: { resize: requestUiResize },
  // 打开即一颗球（对齐 MasterGo 版）；点球展开为面板
  initialCompact: true,
})

/**
 * 调试模式：默认关掉「本地自测 / HTML→画布 / 宿主能力清单 / 尺寸说明条」这些开发期区块，
 * 点顶栏版本号可切换（见 useDebugMode）。**隐藏不等于静默** —— 说明条的内容同时进日志。
 */
const { isDebug, toggleDebug } = useDebugMode()

// 尺寸说明条（如"宿主把窗口夹了"）即使面板被隐藏也要留下痕迹
watch(
  () => compactNotes.value.join('|'),
  (joined) => {
    for (const note of joined ? joined.split('|') : []) addLog('info', `窗口：${note}`)
  },
)

const statusDotClass = computed(() => {
  if (isConnected.value) return 'dot dot--connected'
  if (isConnecting.value) return `dot dot--${status.value}`
  return 'dot'
})

/**
 * 连上但后端不对时的告警。
 *
 * 真实踩过的坑：Penpot 插件填了 MasterGo 的 15489，而当时服务端**没有** Penpot 支持
 * （旧构建 / 未共联）—— 插件面板显示「已连接」，而服务端 session_list 为空，
 * 用户只能靠猜。现在 15489 默认就是共联单 hub，但旧服务端与分端口模式仍会产生这种组合，
 * 所以对「已连接但没报后端 / 报的不是 penpot」必须重声告警。
 */
const backendWarning = computed(() => {
  if (!isConnected.value) return ''
  if (!serverAttributed.value) {
    const accepted = serverAcceptedBackends.value.join(', ') || '?'
    return `服务端拒绝归属本会话 —— 它只接受 [${accepted}] 后端。多半是服务端开了分端口模式（Penpot 需连 4404），或是旧版服务端。`
  }
  if (!serverBackend.value) {
    return '服务端未上报后端 —— 多半是旧版服务端。默认 hub 是 15489（同一端口同时服务 MasterGo 与 Penpot）；若服务端开了分端口模式，Penpot 在 4404。'
  }
  if (serverBackend.value !== 'penpot') {
    return `本会话被归属到了 ${serverBackend.value} 后端（与当前宿主不匹配）—— 工具会落到错的设计工具里。Penpot 请连 15489（或分端口模式下的 4404）。`
  }
  return ''
})

const capabilitySummary = computed<{ label: string; ok: boolean; degraded?: boolean }[]>(() => {
  const caps = capabilities.value
  if (!caps) return []
  const props = caps.props ?? {}
  const ops = caps.ops ?? {}
  return [
    { label: '自动布局', ok: Boolean(props.autoLayout) },
    { label: '效果/模糊', ok: Boolean(props.effects) && Boolean(props.backgroundBlur) },
    { label: '渐变填充', ok: Boolean(props.gradients) },
    { label: '单边描边', ok: Boolean(props.perSideStrokes), degraded: true },
    { label: '令牌绑定', ok: Boolean(props.tokenBinding) },
    { label: '组件/变体', ok: Boolean(ops.componentVariants) },
    { label: '团队库', ok: Boolean(ops.teamLibrary) },
    { label: 'UI iframe', ok: Boolean(ops.renderUiIframe) },
  ]
})

/** 插件消息入口 —— 必须过滤 source，Penpot 宿主自己也会发消息到这里 */
function onWindowMessage(event: MessageEvent): void {
  const message = event.data
  if (!message || typeof message !== 'object') return
  if (message.source !== 'mgmcp-plugin') return

  switch (message.type) {
    case PluginMessage.STATUS_CHANGED: {
      const data = message.data ?? {}
      if (data.documentInfo) documentInfo.value = data.documentInfo
      if (data.capabilities) capabilities.value = data.capabilities
      if (data.host) hostName.value = data.host
      if (data.pluginVersion) pluginVersion.value = data.pluginVersion
      if (data.hostVersion) hostVersion.value = data.hostVersion
      // 必须转发给 connection：它负责记录 codename 与 documentInfo（initialize 的 clientInfo 用它），
      // 并在信息后到时重发 initialize。此前只在 App 侧处理，导致 codename 永远为空、
      // 面板只显示 '?'；且 initialize 的 documentId 为空，服务端 sessionId 退化成 clientId。
      connection.handlePluginMessage(event)
      addLog('info', `插件就绪：${data.documentInfo?.documentName || '未命名文档'} / ${data.documentInfo?.pageName || '-'}`)
      break
    }

    case PluginMessage.METHOD_RESULT: {
      // 通用方法结果：交给 useMCPConnection 回送 hub（它按 methodResult 分支处理）
      const handled = connection.handlePluginMessage(event)
      const result = message.data?.response?.result
      // 自测 / 本地 HTML 渲染的结果也走 methodResult，这里顺手展示
      if (result && typeof result === 'object' && 'rootCount' in result) {
        report.value = result as RenderReport
        selfTesting.value = false
        htmlRendering.value = false
        const degraded = (result.skipped ?? []).length
        addLog('success', `落地完成：${result.rootCount} 个顶层节点，降级 ${degraded} 项`)
        if ((result.unresolvedClasses ?? []).length) {
          addLog('error', `${result.unresolvedClasses.length} 个 Tailwind class 未生效：${result.unresolvedClasses.slice(0, 5).join('、')}`)
        }
        for (const warn of result.layoutWarnings ?? []) {
          addLog('error', `布局告警 · ${warn}`)
        }
        if (result.timing) {
          const host = result.timing.hostRenderMs
          const client = result.timing.clientRenderMs
          addLog(
            'info',
            `耗时 · 宿主落地 ${host ?? '?'}ms` + (client === undefined ? '' : ` · 客户端渲染 ${client}ms`),
          )
        }
        for (const skip of result.skipped ?? []) {
          addLog('info', `降级 · ${skip.target}: ${skip.reason}`)
        }
      }
      void handled
      break
    }

    case PluginMessage.METHOD_ERROR: {
      connection.handlePluginMessage(event)
      const id = message.data?.id
      if (id === 'self-test') {
        selfTesting.value = false
        addLog('error', `自测失败：${message.data?.error}`)
      }
      break
    }

    case PluginMessage.ERROR:
      addLog('error', message.data?.message ?? '插件错误')
      break

    case PluginMessage.LOG:
      addLog('info', `插件：${message.data?.message ?? ''}`)
      break

    case PluginMessage.UI_RESIZED: {
      // 沙箱回报窗口尺寸（含被宿主 min/max 夹过的实际值）
      const data = message.data as { requestId?: number; size?: { width: number; height: number } | null; error?: string }
      const pending = data?.requestId !== undefined ? pendingResize.get(data.requestId) : undefined
      if (pending) {
        pendingResize.delete(data.requestId as number)
        pending(data?.size ?? null)
      }
      if (data?.error) addLog('error', `调整窗口尺寸：${data.error}`)
      else if (data?.size) addLog('info', `插件窗口尺寸：${data.size.width}×${data.size.height}`)
      break
    }

    case PluginMessage.SELECTION_CHANGED:
      // 选区只影响面板展示，不涉及 hub —— 不经过 handlePluginMessage
      updateSelection((message.data ?? {}) as Record<string, unknown>)
      break

    default:
      break
  }
}

function runSelfTest(full: boolean): void {
  selfTesting.value = true
  report.value = null
  addLog('info', full ? '开始完整自测（覆盖全部已知宿主差异）' : '开始冒烟自测')
  sendMsgToPlugin({ type: UIMessage.SELF_TEST, data: { id: 'self-test', full } })
}

/**
 * HELLO 重试。
 *
 * 真实踩到的竞态：插件沙箱是先 `penpot.ui.open()` 再 `penpot.ui.onMessage()`，
 * 而 UI iframe 挂载后立刻发 HELLO —— 这一发**会掉在沙箱注册监听之前**。
 * 后果不是报错，而是「面板一切正常、服务端会话里 documentName/pageName 全空」，
 * 看不出在操作哪个文件。所以这里按固定间隔重试，直到确凿收到沙箱的 statusChanged
 * （它的载荷里有 capabilities；文档信息可能合法为空，不适合当信号）。
 */
let helloTimer: ReturnType<typeof setInterval> | null = null
const helloAttempts = ref(0)

function stopHelloRetry(): void {
  if (helloTimer !== null) {
    clearInterval(helloTimer)
    helloTimer = null
  }
}

function refreshDocumentInfo(): void {
  sendMsgToPlugin({ type: UIMessage.HELLO })
}

function startHelloRetry(): void {
  stopHelloRetry()
  helloAttempts.value = 0
  helloTimer = setInterval(() => {
    // 收到过 statusChanged（capabilities 已填）就停
    if (capabilities.value || helloAttempts.value >= 12) {
      stopHelloRetry()
      if (!capabilities.value) addLog('error', '插件沙箱未响应 HELLO —— 宿主能力与文档信息将不可用；试试关闭插件面板重新打开')
      return
    }
    helloAttempts.value += 1
    refreshDocumentInfo()
  }, 400)
}

onMounted(() => {
  window.addEventListener('message', onWindowMessage)
  refreshDocumentInfo()
  startHelloRetry()
})

onUnmounted(() => {
  window.removeEventListener('message', onWindowMessage)
  stopHelloRetry()
  cleanup()
})
</script>

<template>
  <!-- ══ 紧凑态：整个窗口就是这颗球（点击展开）══ -->
  <div v-if="isCompact" class="app-compact">
    <!-- 会话代号：MG 的 CompactBall 就是把代号做成左上角固定胶囊（实时可见）——
         紧凑态是默认态，不画在这里用户就完全看不到自己在哪个 session -->
    <p v-if="codename" class="ball-codename">{{ codename }}</p>
    <StatusOrb
      :status="status"
      :is-connected="isConnected"
      :is-connecting="isConnecting"
      :is-processing="isProcessing"
      :selection-count="selectionCount"
      :has-active-task="hasActiveTask"
      :has-completed-task="Boolean(activeTask) && !hasActiveTask"
      :has-failed="hasFailed"
      :completed-count="completedCount"
      :total-steps="totalSteps"
      :summary-text="summaryText"
      :current-step-id="currentStepId"
      :codename="codename || hostName || 'Penpot'"
      @focus="toggleCompact"
    />
    <!-- 紧凑态也必须有反馈路径：**被宿主夹大 / 没回报尺寸**时在球下面如实说明
         （真机踩过：只在展开态显示说明条，而"被夹"恰恰是在紧凑态发生的） -->
    <p v-if="isDebug && compactNotes.length" class="orb-notes orb-notes--compact">{{ compactNotes.join('；') }}</p>
  </div>

  <!-- ══ 展开态：顶栏状态球 + 全部面板 ══
       必须整体包在 v-else 里：只把顶栏做成 else、面板留在外面的话，
       紧凑态会连六个面板一起显示（窗口只有 132px，直接被撑爆）══ -->
  <template v-else>
  <!-- 展开态**不**放状态球（只有紧凑态才是一颗球）：状态收进下面这个紧凑面板，
       避免顶栏与连接面板重复展示同一份状态（MasterGo 版也是这个信息架构）-->
  <div class="panel">
    <div class="panel__head">
      <span class="row">
        <span :class="statusDotClass"></span>
        <span class="badge" :class="isConnected ? 'badge--ok' : undefined">{{ statusText }}</span>
        <!-- 会话代号（对齐 MasterGo 的 StatusPanel）：彩色胶囊，点它就地编辑；
             Enter/失焦保存、Esc 取消（Esc 用标志位挡住随后的 blur，避免取消后又被提交） -->
        <button
          v-if="!editingCodename"
          class="btn-codename"
          title="点击修改会话代号（服务端用它区分多个 Penpot 会话）"
          @click="beginEditCodename"
        >{{ codename || '?' }}</button>
        <input
          v-else
          ref="codenameInput"
          class="input input--code"
          :value="codenameEdit"
          maxlength="16"
          placeholder="如 Nova"
          @input="codenameEdit = ($event.target as HTMLInputElement).value"
          @keydown.enter.prevent="commitCodename"
          @keydown.esc.prevent="cancelCodename"
          @blur="commitCodename"
        />
        <span v-if="serverBackend" class="badge" :class="serverBackend === 'penpot' ? 'badge--ok' : 'badge--error'">{{ serverBackend }}</span>
        <span v-if="isProcessing" class="badge badge--busy"><span class="badge__spinner"></span>处理中</span>
      </span>
      <span class="panel__actions">
        <button class="btn btn--ghost" title="关于 / 版本 / 调试" @click="showAbout = true">关于</button>
        <button class="btn btn--ghost" title="收起为简略模式" @click="toggleCompact">收起</button>
      </span>
    </div>

    <div class="row">
      <input
        class="input"
        type="text"
        :value="serverUrl"
        placeholder="ws://localhost:15489"
        spellcheck="false"
        :disabled="isConnected || isConnecting"
        @input="serverUrl = ($event.target as HTMLInputElement).value"
      />
      <button class="btn btn--primary" :disabled="isConnecting" @click="toggleConnection">
        {{ connectionButtonText }}
      </button>
    </div>

    <p v-if="backendWarning" class="warn">{{ backendWarning }}</p>
    <p v-else-if="!isConnected" class="hint">未连接 —— AI 暂不能操作本画布</p>
  </div>

  <!-- ══ 任务步骤（AI 在干活时的进度；无任务时不占位）══ -->
  <TaskProgress
    v-if="activeTask"
    :active-task="activeTask"
    :has-active-task="hasActiveTask"
    :completed-count="completedCount"
    :total-steps="totalSteps"
    :progress-percent="progressPercent"
    :summary-text="summaryText"
    @dismiss="dismissTask"
  />

  <!-- ══ 选中（只展示；不存在"发给 AI"的动作）══ -->
  <SelectionPanel
    :count="selectionCount"
    :details="selectionDetails"
    :truncated="selectionTruncated"
    :error="selectionError"
  />

  <!-- ══ 关于 / 版本 / 能力 / 调试工具（低频信息收进弹层）══ -->
  <AboutDialog v-if="showAbout" @close="showAbout = false">
  <!-- ══ 宿主 ══ -->
  <div class="panel">
    <div class="panel__head">
      <h2 class="panel__title">宿主与文档</h2>
      <span class="panel__actions">
        <button class="btn btn--ghost" :class="{ 'btn--on': isDebug }" title="显示/隐藏自测与 HTML→画布工具" @click="toggleDebug">{{ isDebug ? '调试 ●' : '调试' }}</button>
        <span class="badge">{{ hostName || '未探测' }}</span>
      </span>
    </div>

    <div class="field">
      <span class="field__label">文档</span>
      <span class="field__value">{{ documentInfo?.documentName || '—' }}</span>
    </div>
    <div class="field">
      <span class="field__label">页面</span>
      <span class="field__value">{{ documentInfo?.pageName || '—' }}</span>
    </div>
    <!-- 插件版本已上移到弹层署名头部（与 plugin-mastergo 同结构），此处不再重复 -->
    <div class="field">
      <span class="field__label">服务端</span>
      <span class="field__value mono">{{ serverVersion ? `v${serverVersion}` : '（未连接/旧版未上报）' }}</span>
    </div>
    <p v-if="versionMismatch" class="warn">
      插件 v{{ pluginVersion }} 与服务端 v{{ serverVersion }} 不一致 —— 插件版本现跟随服务端构建，请重新构建并加载同一版本。
    </p>

    <div v-if="isDebug" class="panel__head">
      <button class="btn btn--ghost" @click="showCapabilities = !showCapabilities">
        {{ showCapabilities ? '隐藏' : '查看' }}宿主能力（{{ capabilitySummary.filter((c) => c.ok).length }}/{{ capabilitySummary.length }}）
      </button>
    </div>

    <template v-if="isDebug && showCapabilities">
      <div class="field" v-for="cap in capabilitySummary" :key="cap.label">
        <span class="field__label">{{ cap.label }}</span>
        <span class="badge" :class="cap.ok ? 'badge--ok' : cap.degraded ? 'badge--warn' : 'badge--error'">
          {{ cap.ok ? '支持' : cap.degraded ? '降级' : '不支持' }}
        </span>
      </div>
    </template>
  </div>

  <!-- ══ 自测（开发期用；在「关于」里开调试后才显示）══ -->
  <div v-if="isDebug" class="panel">
    <div class="panel__head">
      <h2 class="panel__title">本地自测</h2>
      <span v-if="report" class="badge" :class="report.ok ? 'badge--ok' : 'badge--error'">
        {{ report.ok ? '通过' : '失败' }}
      </span>
    </div>

    <p class="hint">
      不经过任何服务端，直接把内置 DSL 渲染到画布。用于把「插件↔宿主↔画布」与
      「插件↔hub↔AI」两条链的排障解耦。
    </p>

    <div class="row">
      <button class="btn" :disabled="selfTesting" @click="runSelfTest(false)">冒烟渲染</button>
      <button class="btn" :disabled="selfTesting" @click="runSelfTest(true)">完整样例</button>
    </div>

    <template v-if="report">
      <div class="field">
        <span class="field__label">顶层节点</span>
        <span class="field__value">{{ report.rootCount ?? 0 }}</span>
      </div>
      <div class="field">
        <span class="field__label">降级项</span>
        <span class="field__value">{{ (report.skipped || []).length }}</span>
      </div>
      <p v-if="report.hint" class="hint">{{ report.hint }}</p>

      <div v-if="report.skipped && report.skipped.length" class="scroll">
        <div v-for="(skip, index) in report.skipped" :key="index" class="mono">
          <span class="badge badge--warn">{{ skip.target }}</span>
          {{ skip.reason }}
        </div>
      </div>
    </template>
  </div>

  <!-- ══ HTML → 画布（客户端渲染，开发期用；默认隐藏）══ -->
  <div v-if="isDebug" class="panel">
    <div class="panel__head">
      <h2 class="panel__title">HTML → 画布</h2>
      <span v-if="renderState.isRendering" class="badge badge--warn">{{ renderState.progress }}</span>
      <span v-else-if="renderState.error" class="badge badge--error">失败</span>
    </div>

    <p class="hint">
      在插件 UI 的 iframe 里真实渲染 HTML+Tailwind，实测像素后转成 DSL 落到画布。
      <strong>不经任何服务端</strong> —— 用于把「引擎」与「网络」两类问题分开定位。
    </p>

    <textarea
      class="input"
      rows="9"
      spellcheck="false"
      :value="manualHtml"
      @input="manualHtml = ($event.target as HTMLTextAreaElement).value"
    ></textarea>

    <div class="row">
      <button class="btn btn--primary" :disabled="htmlRendering || renderState.isRendering" @click="renderManualHtml">
        {{ htmlRendering || renderState.isRendering ? '渲染中…' : '渲染 HTML 到画布' }}
      </button>
      <button class="btn" :disabled="htmlRendering" @click="manualHtml = SAMPLE_HTML">完整样例</button>
      <button class="btn" :disabled="htmlRendering" @click="manualHtml = MINIMAL_HTML">极简</button>
    </div>

    <p class="hint">
      本地路径不含服务端预处理：图标（<code>data-icon</code>）可客户端解析，
      图表 <code>&lt;chart&gt;</code> 与预设组件 <code>&lt;component&gt;</code> 需要服务端。
    </p>

    <div v-if="report && report.unresolvedClasses && report.unresolvedClasses.length" class="scroll">
      <div class="mono">
        <span class="badge badge--error">{{ report.unresolvedClasses.length }} 个 class 未生效</span>
        {{ report.unresolvedClasses.slice(0, 12).join('、') }}
      </div>
    </div>
  </div>
  </AboutDialog>

  <!-- ══ 日志 ══ -->
  <div class="panel">
    <div class="panel__head">
      <h2 class="panel__title">日志</h2>
      <span class="panel__actions">
        <label class="toggle"><input type="checkbox" :checked="errorsOnly" @change="errorsOnly = ($event.target as HTMLInputElement).checked" />只看问题</label>
        <button class="btn btn--ghost" :disabled="!logs.length" @click="copyLogs">复制</button>
        <button class="btn btn--ghost" :disabled="!logs.length" @click="clearLogs">清空</button>
      </span>
    </div>

    <div v-if="!visibleLogs.length" class="empty">{{ logs.length ? '（已过滤：没有匹配的日志）' : '暂无日志' }}</div>
    <div v-else class="scroll log-list">
      <div v-for="(entry, index) in visibleLogs" :key="index" class="log-line" :class="`log-line--${entry.type}`">
        <span class="log-line__time mono">{{ entry.time }}</span>
        <span class="log-line__text mono">{{ entry.message }}</span>
      </div>
    </div>
  </div>
  </template>
</template>
