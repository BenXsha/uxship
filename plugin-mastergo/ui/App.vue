<template>
  <!-- ==================== 紧凑模式 ==================== -->
  <div v-if="compactMode" class="container compact-container">
    <CompactBall
      :state-class="ballStateClass"
      :dot-class="ballDotClass"
      :label-class="ballLabelClass"
      :label="ballLabel"
      :selection-count="selectedElements.count"
      :is-processing="isProcessing"
      :has-error="hasError"
      :is-connected="isConnected"
      :is-connecting="isConnecting"
      :status-text="statusText"
      :codename="codename"
      :has-active-task="hasActiveTask"
      :has-completed-task="hasCompletedTask"
      :has-task-failed="hasFailed"
      :current-step-id="currentStepId"
      :completed-count="completedCount"
      :total-steps="totalSteps"
      :summary-text="summaryText"
      @toggle="toggleCompactMode"
    />
  </div>

  <!-- ==================== 全模式 ==================== -->
  <div v-else class="container full-container">
    <StatusPanel
      :status-class="statusClass"
      :status-text="statusText"
      :server-url="serverUrl"
      :is-connecting="isConnecting"
      :is-connected="isConnected"
      :connection-button-text="connectionButtonText"
      :codename="codename"
      @update:server-url="serverUrl = $event"
      @toggle-connection="toggleConnection"
    />

    <SelectionPanel
      :elements="selectedElements"
    />

    <TaskProgress
      v-if="hasActiveTask || hasCompletedTask"
      :active-task="activeTask"
      :has-active-task="hasActiveTask"
      :completed-count="completedCount"
      :total-steps="totalSteps"
      :progress-percent="progressPercent"
      :summary-text="summaryText"
      @dismiss="dismissTask"
    />

    <LogPanel
      :logs="logs"
      @clear="clearLogs"
      @toggle-json="toggleJsonExpand"
    />

    <button class="btn-about" @click="showAbout = true" title="关于">?</button>

    <button class="btn-toggle-mode btn-toggle-collapse" @click="toggleCompactMode" title="收起为简略模式">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 19v-2a2 2 0 0 1 2-2h2M15 5v2a2 2 0 0 0 2 2h2M5 15h2a2 2 0 0 1 2 2v2M5 9h2a2 2 0 0 0 2-2V5" />
      </svg>
    </button>

    <AboutDialog v-if="showAbout" @close="showAbout = false" />
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { sendMsgToPlugin, UIMessage } from '@messages/sender'
import { MCP_SERVER_URL } from '@lib/utils/Utils'
import { useLogger } from './composables/useLogger'
import { useSelection } from './composables/useSelection'
import { useMCPConnection } from './composables/useMCPConnection'
import { simplifyJson } from './utils/helpers'
import CompactBall from './components/CompactBall.vue'
import StatusPanel from './components/StatusPanel.vue'
import SelectionPanel from './components/SelectionPanel.vue'
import LogPanel from './components/LogPanel.vue'
import AboutDialog from './components/AboutDialog.vue'
import TaskProgress from './components/TaskProgress.vue'
import { useTaskProgress } from './composables/useTaskProgress'
import { useClientRender } from './composables/useClientRender'

const DEBUG_MODE = true
const DEFAULT_SERVER_URL = MCP_SERVER_URL

// ==================== View Mode ====================
const compactMode = ref(true)

function resizeWindow(width: number, height: number) {
  sendMsgToPlugin({
    type: UIMessage.RESIZE,
    data: { width, height },
  })
}

function toggleCompactMode() {
  compactMode.value = !compactMode.value
  if (compactMode.value) {
    resizeWindow(180, 180)
  } else {
    resizeWindow(375, 812)
  }
}

// ==================== Composables ====================
const { logs, addLog, clearLogs, toggleJsonExpand } = useLogger()
const { selectedElements, updateSelection } = useSelection()

function handleSelectionChange(data: any) {
  updateSelection({
    count: data.count || 0,
    layerIds: data.layerIds || [],
    details: data.details || [],
  })
}

const {
  activeTask,
  hasActiveTask,
  hasCompletedTask,
  completedCount,
  totalSteps,
  progressPercent,
  summaryText,
  currentStepId,
  hasFailed,
  handleTaskPlan,
  handleTaskStep,
  handleTaskComplete,
  dismissTask,
} = useTaskProgress()

const {
  state: clientRenderState,
  renderHtml,
} = useClientRender()

const {
  status,
  serverUrl,
  isConnected,
  isConnecting,
  isProcessing,
  hasError,
  lastError,
  statusText,
  statusClass,
  connectionButtonText,
  codename,
  toggleConnection,
  handleWebSocketMessage,
  handlePluginMessage,
  autoConnect,
  cleanup: cleanupMCP,
} = useMCPConnection(addLog, {
  defaultServerUrl: DEFAULT_SERVER_URL,
  debugMode: DEBUG_MODE,
  onSelectionChange: handleSelectionChange,
  onTaskPlan: handleTaskPlan,
  onTaskStep: handleTaskStep,
  onTaskComplete: handleTaskComplete,
  onClientRender: renderHtml,
})

// ==================== Computed: Compact Ball ====================
const dominantState = computed(() => {
  if (hasFailed.value) return 'task-failed'
  if (hasActiveTask.value) return 'task-running'
  if (hasCompletedTask.value) return 'task-done'
  if (isProcessing.value) return 'processing'
  if (hasError.value) return 'error'
  if (isConnected.value) return 'idle'
  if (isConnecting.value) return 'connecting'
  return 'disconnected'
})

const ballStateClass = computed(() => {
  const map: Record<string, string> = {
    'task-failed': 'ball-task-failed',
    'task-running': 'ball-task-running',
    'task-done': 'ball-task-done',
    processing: 'ball-processing-state',
    error: 'ball-error-state',
    idle: 'ball-idle-state',
    connecting: 'ball-connecting-state',
    disconnected: 'ball-disconnected-state',
  }
  return map[dominantState.value] || 'ball-disconnected-state'
})

const ballDotClass = computed(() => {
  const map: Record<string, string> = {
    'task-failed': 'dot-task-failed',
    'task-running': 'dot-task-running',
    'task-done': 'dot-task-done',
    processing: 'dot-processing',
    error: 'dot-error',
    idle: 'dot-idle',
    connecting: 'dot-connecting',
    disconnected: 'dot-disconnected',
  }
  return map[dominantState.value] || 'dot-disconnected'
})

const ballLabelClass = computed(() => {
  const map: Record<string, string> = {
    'task-failed': 'label-task-failed',
    'task-running': 'label-task-running',
    'task-done': 'label-task-done',
    processing: 'label-processing',
    error: 'label-error',
    idle: 'label-idle',
    connecting: 'label-connecting',
    disconnected: 'label-disconnected',
  }
  return map[dominantState.value] || 'label-disconnected'
})

const ballLabel = computed(() => {
  const map: Record<string, string> = {
    'task-failed': 'failed',
    'task-running': summaryText.value || 'running',
    'task-done': 'complete',
    processing: 'running',
    error: 'error',
    idle: 'idle',
    connecting: 'linking…',
    disconnected: 'offline',
  }
  return map[dominantState.value] || 'offline'
})

// ==================== UI State ====================

// 任务完成后自动延迟清除状态，使动画平滑回归 idle
let dismissTimer: ReturnType<typeof setTimeout> | null = null
watch(hasCompletedTask, (done) => {
  if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null }
  if (done) {
    dismissTimer = setTimeout(() => {
      dismissTask()
      dismissTimer = null
    }, 4000)
  }
})
const showAbout = ref(false)

// ==================== Methods ====================
// 注：“发送选中为 DSL”已于本回合移除：它走的 `dsl/exportSelection` 请求服务端入站不路由、
// 后续 `context/update` 通知也被忽略，整条链是死的（详见 components/SelectionPanel.vue 注释）。

// ==================== Lifecycle ====================
onMounted(() => {
  resizeWindow(180, 180)
  window.addEventListener('message', handlePluginMessage)
  sendMsgToPlugin({ type: UIMessage.GET_STATUS })
  autoConnect(1000)
})

onUnmounted(() => {
  if (dismissTimer) clearTimeout(dismissTimer)
  window.removeEventListener('message', handlePluginMessage)
  cleanupMCP()
})
</script>

<style>
/* ====== 全局重置 ====== */
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: #1e1e1e; border-radius: 4px; }
::-webkit-scrollbar-thumb { background: #424242; border-radius: 4px; border: 2px solid #1e1e1e; }
::-webkit-scrollbar-thumb:hover { background: #616161; }
::-webkit-scrollbar-thumb:active { background: #757575; }
* { scrollbar-width: thin; scrollbar-color: #424242 #1e1e1e; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #1e1e1e;
  color: #e0e0e0;
  font-size: 12px;
}

.container {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

/* ====== 紧凑模式容器 ====== */
.compact-container {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1e1e1e;
}

/* ====== 全模式容器 ====== */
.full-container {
  padding: 12px;
  gap: 12px;
}

/* ====== 浮动切换按钮 ====== */
.btn-toggle-mode {
  position: fixed;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.2px solid rgba(255, 255, 255, 0.1);
  background: rgba(45, 45, 45, 0.85);
  color: rgba(158, 158, 158, 0.6);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  backdrop-filter: blur(4px);
  z-index: 500;
  padding: 0;
}
.btn-toggle-mode:hover {
  background: rgba(66, 66, 66, 0.95);
  color: #e0e0e0;
  border-color: rgba(255, 255, 255, 0.25);
}
.btn-toggle-expand { bottom: 6px; right: 6px; }
.btn-toggle-collapse { bottom: 12px; right: 12px; }

/* ====== 关于按钮 ====== */
.btn-about {
  position: fixed;
  bottom: 12px;
  left: 12px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #2d2d2d;
  border: 1px solid #424242;
  color: #9e9e9e;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn-about:hover {
  background: #424242;
  color: #e0e0e0;
}

</style>
