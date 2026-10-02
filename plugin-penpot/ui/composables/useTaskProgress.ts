/**
 * 任务步骤状态机（**与 plugin-mastergo 同一份实现**）
 *
 * 服务端会把 AI 的工作拆成步骤下发（三条通知）：
 *   `task/plan`     { steps: [{id, label}] }
 *   `task/step`     { id, status, message }
 *   `task/complete` { status, message }
 *
 * 本模块只做**状态归约**，不碰 DOM —— 所以能直接单测（见 tests/task-progress.test.ts）。
 *
 * ⚠️ 本文件与 `plugin-mastergo/ui/composables/useTaskProgress.ts` **保持逐字一致**：
 * 本侧先加的三条改进（成功后自动收起、耗时 `startedAt/finishedAt/elapsedMs`、`task/plan` 去重）
 * 已回移到那边。改这个文件时请**同步改另一边** —— 同名组件分叉后，同一个 bug 要修两次。
 */
import { computed, ref } from 'vue'

export type TaskStepStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface TaskStep {
  id: string
  label: string
  status: TaskStepStatus
  message?: string
  /** 该步开始/结束时间（毫秒时间戳），用于显示耗时 */
  startedAt?: number
  finishedAt?: number
}

export interface TaskPlan {
  steps: TaskStep[]
}

export interface ActiveTask {
  plan: TaskPlan
  status: 'running' | 'success' | 'failed'
  message?: string
  startedAt: number
  finishedAt?: number
}

export interface UseTaskProgressOptions {
  /** 成功后自动收起的延迟（毫秒）；0 = 不自动收起 */
  autoDismissDelayMs?: number
  /** 可注入的时间源，便于测试 */
  now?: () => number
}

export function useTaskProgress(options: UseTaskProgressOptions = {}) {
  const autoDismissDelayMs = options.autoDismissDelayMs ?? 2600
  const now = options.now ?? (() => Date.now())

  const activeTask = ref<ActiveTask | null>(null)
  const elapsedMs = ref(0)
  let tickTimer: ReturnType<typeof setInterval> | null = null
  let dismissTimer: ReturnType<typeof setTimeout> | null = null

  const hasActiveTask = computed(() => activeTask.value?.status === 'running')
  const hasCompletedTask = computed(() => Boolean(activeTask.value) && activeTask.value?.status !== 'running')
  const completedCount = computed(
    () => activeTask.value?.plan.steps.filter((s) => s.status === 'completed' || s.status === 'failed').length ?? 0,
  )
  const totalSteps = computed(() => activeTask.value?.plan.steps.length ?? 0)
  const progressPercent = computed(() =>
    totalSteps.value === 0 ? 0 : Math.round((completedCount.value / totalSteps.value) * 100),
  )
  const currentStepId = computed(() => activeTask.value?.plan.steps.find((s) => s.status === 'running')?.id ?? null)
  /**
   * 是否失败：**任务级或步骤级**任一为失败。
   *
   * 只认步骤级是不够的 —— 服务端可能直接 `task/complete {status:'failed'}` 而没有任何
   * 步骤被标失败（例如参数校验在第一步之前就挂了），这时界面仍然要显示成失败态。
   */
  const hasFailed = computed(() => {
    const task = activeTask.value
    if (!task) return false
    return task.status === 'failed' || task.plan.steps.some((s) => s.status === 'failed')
  })
  const summaryText = computed(() => {
    const task = activeTask.value
    if (!task) return ''
    if (task.status === 'success') return '任务完成'
    if (task.status === 'failed') return `任务失败${task.message ? `：${task.message}` : ''}`
    return task.plan.steps.find((s) => s.status === 'running')?.label ?? '准备中…'
  })

  function stopTimers(): void {
    if (tickTimer !== null) { clearInterval(tickTimer); tickTimer = null }
    if (dismissTimer !== null) { clearTimeout(dismissTimer); dismissTimer = null }
  }

  function startTick(): void {
    if (tickTimer !== null) return
    tickTimer = setInterval(() => {
      const task = activeTask.value
      if (!task) { stopTimers(); return }
      elapsedMs.value = (task.finishedAt ?? now()) - task.startedAt
    }, 500)
  }

  /** 新步骤：第一个 running，其余 pending；已在列表里的 id 跳过（追加模式不重复登记） */
  function appendSteps(plan: { steps: { id: string; label: string }[] }): void {
    const task = activeTask.value
    if (!task) return
    const existing = new Set(task.plan.steps.map((s) => s.id))
    const fresh = plan.steps.filter((s) => !existing.has(s.id))
    if (!fresh.length) return

    // 追加模式：把当前 running 的步骤收尾，新的第一批从 running 开始
    const running = task.plan.steps.find((s) => s.status === 'running')
    if (running) { running.status = 'completed'; running.finishedAt = now() }

    fresh.forEach((step, index) => {
      task.plan.steps.push({
        id: step.id,
        label: step.label,
        status: index === 0 ? 'running' : 'pending',
        ...(index === 0 ? { startedAt: now() } : {}),
      })
    })
  }

  function handleTaskPlan(plan: { steps: { id: string; label: string }[] }): void {
    if (!plan?.steps?.length) return
    if (activeTask.value?.status === 'running') {
      appendSteps(plan)
      return
    }
    // 全新任务
    stopTimers()
    const steps: TaskStep[] = plan.steps.map((step, index) => ({
      id: step.id,
      label: step.label,
      status: index === 0 ? 'running' : 'pending',
      ...(index === 0 ? { startedAt: now() } : {}),
    }))
    activeTask.value = { plan: { steps }, status: 'running', startedAt: now() }
    elapsedMs.value = 0
    startTick()
  }

  function handleTaskStep(step: { id: string; status: TaskStepStatus; message?: string }): void {
    const task = activeTask.value
    if (!task || !step) return
    const target = task.plan.steps.find((s) => s.id === step.id)
    if (!target) return

    target.status = step.status
    if (step.message) target.message = step.message
    if (step.status === 'running' && target.startedAt === undefined) target.startedAt = now()
    if (step.status === 'completed' || step.status === 'failed') target.finishedAt = now()

    // 自动推进下一步：只在"完成"时推进；失败时停住，让用户看清停在哪
    if (step.status === 'completed') {
      const next = task.plan.steps[task.plan.steps.indexOf(target) + 1]
      if (next && next.status === 'pending') {
        next.status = 'running'
        next.startedAt = now()
      }
    }
  }

  function handleTaskComplete(result: { status: 'success' | 'failed'; message?: string }): void {
    const task = activeTask.value
    if (!task || !result) return
    task.status = result.status
    task.message = result.message
    task.finishedAt = now()
    elapsedMs.value = task.finishedAt - task.startedAt
    stopTimers()

    if (result.status === 'success') {
      for (const step of task.plan.steps) {
        if (step.status === 'pending' || step.status === 'running') {
          step.status = 'completed'
          step.finishedAt ??= task.finishedAt
        }
      }
      // 成功 → 稍后自动收起（失败保留，等用户读完原因）
      if (autoDismissDelayMs > 0) {
        dismissTimer = setTimeout(() => { activeTask.value = null }, autoDismissDelayMs)
      }
    }
  }

  function dismissTask(): void {
    stopTimers()
    activeTask.value = null
  }

  return {
    activeTask,
    elapsedMs,
    hasActiveTask,
    hasCompletedTask,
    completedCount,
    totalSteps,
    progressPercent,
    currentStepId,
    hasFailed,
    summaryText,
    handleTaskPlan,
    handleTaskStep,
    handleTaskComplete,
    dismissTask,
  }
}
