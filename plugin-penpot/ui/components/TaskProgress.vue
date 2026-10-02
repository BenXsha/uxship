<template>
  <Transition name="task-card">
    <section v-if="activeTask" class="task" :class="{ 'task--done': !hasActiveTask, 'task--failed': activeTask.status === 'failed' }">
      <header class="task__head">
        <span class="task__pulse" :class="{ 'task__pulse--run': hasActiveTask }"></span>
        <span class="task__summary">{{ headText }}</span>
        <span class="task__spacer"></span>
        <span v-if="elapsedText" class="task__elapsed mono">{{ elapsedText }}</span>
        <span class="task__count mono">{{ completedCount }}/{{ totalSteps }}</span>
        <button v-if="!hasActiveTask" class="task__close" title="关闭" @click="emit('dismiss')">✕</button>
      </header>

      <div class="task__track">
        <div
          class="task__fill"
          :class="{ 'task__fill--ok': activeTask.status === 'success', 'task__fill--bad': activeTask.status === 'failed' }"
          :style="{ width: `${progressPercent}%` }"
        ></div>
      </div>

      <ol class="task__steps">
        <li
          v-for="(step, index) in activeTask.plan.steps"
          :key="step.id"
          class="step"
          :class="`step--${step.status}`"
          :style="{ '--step-index': index }"
        >
          <span class="step__mark">
            <svg v-if="step.status === 'running'" class="step__spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10" stroke-linecap="round" />
            </svg>
            <svg v-else-if="step.status === 'completed'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <svg v-else-if="step.status === 'failed'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            <i v-else class="step__dot"></i>
          </span>
          <span class="step__label">{{ step.label }}</span>
          <span v-if="step.message" class="step__message">{{ step.message }}</span>
        </li>
      </ol>
    </section>
  </Transition>
</template>

<script setup lang="ts">
/**
 * 任务步骤卡片 —— 对齐 plugin-mastergo 的 `TaskProgress.vue`
 *
 * 差异只有两点，都是为了放进 Penpot 插件的窄面板：
 *   - 配色改用本插件的设计 token（面板是深色系，直接搬 plugin-mastergo 的 #252525 会撞色）；
 *   - 加了动画：卡片进出场、进度条过渡、运行中步骤的呼吸与扫光、步骤逐条入场。
 *
 * 纯展示组件：状态全部来自 `useTaskProgress`，这里不做任何归约。
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

const emit = defineEmits<{ dismiss: [] }>()

/** 耗时显示：运行中实时走，结束后定格 */
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
