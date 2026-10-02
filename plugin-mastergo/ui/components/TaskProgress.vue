<template>
  <div v-if="activeTask" class="task-progress" :class="{ 'task-done': !hasActiveTask }">
    <div class="task-header">
      <span class="task-summary">{{ headText }}</span>
      <div class="task-actions">
        <span v-if="elapsedText" class="task-elapsed">{{ elapsedText }}</span>
        <span class="task-count">{{ completedCount }}/{{ totalSteps }}</span>
        <button v-if="!hasActiveTask" class="btn-dismiss" @click="dismiss" title="关闭">✕</button>
      </div>
    </div>

    <div class="progress-bar-track">
      <div class="progress-bar-fill" :style="{ width: progressPercent + '%' }"
        :class="{ 'fill-success': activeTask.status === 'success', 'fill-failed': activeTask.status === 'failed' }">
      </div>
    </div>

    <div class="step-list">
      <div v-for="step in activeTask.plan.steps" :key="step.id" class="step-item"
        :class="'step-' + step.status">
        <div class="step-icon">
          <svg v-if="step.status === 'running'" class="icon-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10" stroke-linecap="round"/>
          </svg>
          <svg v-else-if="step.status === 'completed'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <svg v-else-if="step.status === 'failed'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          <span v-else class="dot-pending"></span>
        </div>
        <span class="step-label">{{ step.label }}</span>
        <span v-if="step.message" class="step-message">{{ step.message }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 任务步骤卡片
 *
 * 与 plugin-penpot 的 `TaskProgress.vue` **同一套逻辑**（props/emits 逐字相同，组件可直接互换），
 * 差异只在样式：那边是深色面板 + BEM + 动画，这里是本插件的 kebab 类名与配色。
 * 耗时的显示/走表逻辑本侧先没有，已从 plugin-penpot 回移。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import type { ActiveTask } from '../composables/useTaskProgress'

const props = defineProps<{
  activeTask: ActiveTask | null
  hasActiveTask: boolean
  completedCount: number
  totalSteps: number
  progressPercent: number
  summaryText: string
}>()

const emit = defineEmits<{
  dismiss: []
}>()

function dismiss() {
  emit('dismiss')
}

/** 耗时显示：运行中实时走，结束后定格（与 plugin-penpot 侧同一套） */
const elapsedMs = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

function syncElapsed(): void {
  const task = props.activeTask
  if (!task) { elapsedMs.value = 0; return }
  elapsedMs.value = (task.finishedAt ?? Date.now()) - task.startedAt
}

watch(
  () => props.activeTask?.status,
  (status) => {
    if (timer !== null) { clearInterval(timer); timer = null }
    syncElapsed()
    if (status === 'running') timer = setInterval(syncElapsed, 500)
  },
  { immediate: true },
)

onUnmounted(() => { if (timer !== null) clearInterval(timer) })

/**
 * header 摘要。
 *
 * 运行中加「正在：」前缀：否则它会和下面那条高亮步骤是**同一串字**，读起来像复读。
 * 完成任务没有名字（协议里只有步骤），所以完成态直接给"任务完成/失败"。
 */
const headText = computed(() => (props.hasActiveTask ? `正在：${props.summaryText}` : props.summaryText))

const elapsedText = computed(() => {
  if (!elapsedMs.value || props.activeTask?.status !== 'running' && elapsedMs.value < 1000) return ''
  const seconds = Math.max(0, elapsedMs.value / 1000)
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
})
</script>

<style scoped>
.task-progress {
  background: #252525;
  border-radius: 10px;
  padding: 10px 12px;
  border: 1px solid #333;
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.task-summary {
  font-size: 11px;
  font-weight: 500;
  color: #ccc;
}

.task-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.task-count {
  font-size: 10px;
  color: #888;
}

/* 耗时（与 plugin-penpot 侧同一套显示规则）：运行中实时走，结束后定格 */
.task-elapsed {
  font-size: 10px;
  color: #888;
  font-variant-numeric: tabular-nums;
}

.btn-dismiss {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: none;
  background: #444;
  color: #999;
  font-size: 9px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: all 0.15s;
}

.btn-dismiss:hover {
  background: #666;
  color: #fff;
}

/* progress bar */
.progress-bar-track {
  height: 3px;
  background: #333;
  border-radius: 2px;
  margin-bottom: 8px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: #3B82F6;
  border-radius: 2px;
  transition: width 0.4s ease;
}

.fill-success {
  background: #22C55E;
}

.fill-failed {
  background: #FB7185;
}

/* step list */
.step-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: #888;
  transition: color 0.2s;
}

.step-running {
  color: #60A5FA;
}

.step-completed {
  color: #6EE7B7;
}

.step-failed {
  color: #FB7185;
}

.step-icon {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.dot-pending {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #555;
}

.icon-spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.step-label {
  flex: 1;
}

.step-message {
  font-size: 9px;
  color: #666;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-done {
  opacity: 0.85;
}
</style>
