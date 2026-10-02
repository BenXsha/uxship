/**
 * 任务步骤状态机（对齐 plugin-mastergo 的 `useTaskProgress`）
 *
 * 服务端把 AI 的工作拆成三条通知下发，UI 必须把它们归约成"看得懂的进度"：
 *   task/plan → 建计划（第一步 running，其余 pending）
 *   task/step → 改单步状态，**完成时自动推进下一步**
 *   task/complete → 收尾（成功补齐剩余步骤；失败**停住**并保留卡片）
 *
 * 这些归约规则一旦错，表现是"进度条卡住 / 步骤永远转圈 / 卡片不消失"——
 * 都属于用户第一时间能看到的问题，所以逐条钉住。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTaskProgress } from '@ui/composables/useTaskProgress'

let clock = 1_000_000
const now = () => clock

function setup(autoDismissDelayMs = 0) {
  return useTaskProgress({ autoDismissDelayMs, now })
}

beforeEach(() => {
  clock = 1_000_000
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const PLAN = { steps: [{ id: 'a', label: '解析 HTML' }, { id: 'b', label: '实测像素' }, { id: 'c', label: '落地画布' }] }

describe('计划与推进', () => {
  it('task/plan：第一步 running、其余 pending，进度 0%', () => {
    const task = setup()
    task.handleTaskPlan(PLAN)

    expect(task.activeTask.value?.status).toBe('running')
    expect(task.activeTask.value?.plan.steps.map((s) => s.status)).toEqual(['running', 'pending', 'pending'])
    expect(task.hasActiveTask.value).toBe(true)
    expect(task.completedCount.value).toBe(0)
    expect(task.progressPercent.value).toBe(0)
    expect(task.summaryText.value).toBe('解析 HTML')
    expect(task.currentStepId.value).toBe('a')
  })

  it('task/step 完成 → **自动把下一步置为 running**（否则界面会停在原地）', () => {
    const task = setup()
    task.handleTaskPlan(PLAN)
    task.handleTaskStep({ id: 'a', status: 'completed', message: '3 个元素' })

    const steps = task.activeTask.value!.plan.steps
    expect(steps[0].status).toBe('completed')
    expect(steps[0].message).toBe('3 个元素')
    expect(steps[1].status).toBe('running')
    expect(task.completedCount.value).toBe(1)
    expect(task.progressPercent.value).toBe(33)
    expect(task.summaryText.value).toBe('实测像素')
  })

  it('task/step 失败 → 不推进下一步（要看清停在哪）', () => {
    const task = setup()
    task.handleTaskPlan(PLAN)
    task.handleTaskStep({ id: 'a', status: 'failed', message: '宿主不支持' })

    expect(task.activeTask.value!.plan.steps.map((s) => s.status)).toEqual(['failed', 'pending', 'pending'])
    expect(task.hasFailed.value).toBe(true)
  })

  it('未知 step id 被忽略（服务端可能下发过期计划）', () => {
    const task = setup()
    task.handleTaskPlan(PLAN)
    task.handleTaskStep({ id: 'ghost', status: 'completed' })
    expect(task.activeTask.value!.plan.steps.map((s) => s.status)).toEqual(['running', 'pending', 'pending'])
  })

  it('空计划不下发任何状态（避免出现空卡片）', () => {
    const task = setup()
    task.handleTaskPlan({ steps: [] })
    expect(task.activeTask.value).toBeNull()
  })
})

describe('收尾', () => {
  it('成功：补齐剩余步骤 → 100%，并在延迟后**自动收起**', () => {
    const task = setup(2600)
    task.handleTaskPlan(PLAN)
    task.handleTaskStep({ id: 'a', status: 'completed' })
    task.handleTaskComplete({ status: 'success' })

    expect(task.activeTask.value?.status).toBe('success')
    expect(task.progressPercent.value).toBe(100)
    expect(task.summaryText.value).toBe('任务完成')
    expect(task.hasActiveTask.value).toBe(false)

    // 延迟前还在（用户能看到"完成"），延迟后收起
    vi.advanceTimersByTime(1000)
    expect(task.activeTask.value).not.toBeNull()
    vi.advanceTimersByTime(2000)
    expect(task.activeTask.value).toBeNull()
  })

  it('失败：**不自动收起**，卡片保留（用户要读原因）', () => {
    const task = setup(2600)
    task.handleTaskPlan(PLAN)
    task.handleTaskComplete({ status: 'failed', message: '节点不存在' })

    vi.advanceTimersByTime(10_000)
    expect(task.activeTask.value).not.toBeNull()
    expect(task.summaryText.value).toContain('节点不存在')
    expect(task.hasFailed.value).toBe(true)
  })

  it('手动关闭', () => {
    const task = setup(0)
    task.handleTaskPlan(PLAN)
    task.dismissTask()
    expect(task.activeTask.value).toBeNull()
  })
})

describe('追加模式（多轮工具调用共用一个面板）', () => {
  it('运行中再来一批计划 → 追加，且**不重复登记已有 id**', () => {
    const task = setup()
    task.handleTaskPlan(PLAN)
    task.handleTaskStep({ id: 'a', status: 'completed' })

    // 服务端重试/下一轮：同一批计划再发一次（a 已完成，不应重复）
    task.handleTaskPlan(PLAN)
    expect(task.activeTask.value!.plan.steps.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    // 当前 running 的 b 被收尾，新的第一批（c 之后的新 id）从 running 开始
    task.handleTaskPlan({ steps: [{ id: 'd', label: '导出图片' }] })
    const steps = task.activeTask.value!.plan.steps
    expect(steps.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(steps.find((s) => s.id === 'b')!.status).toBe('completed')
    expect(steps.find((s) => s.id === 'd')!.status).toBe('running')
    expect(task.currentStepId.value).toBe('d')
  })
})

describe('耗时', () => {
  it('按注入的时间源计算，结束时定格', () => {
    const task = setup(0)
    task.handleTaskPlan(PLAN)
    clock += 1500
    task.handleTaskStep({ id: 'a', status: 'completed' })
    task.handleTaskComplete({ status: 'success' })
    expect(task.elapsedMs.value).toBe(1500)

    clock += 5000 // 结束之后时间继续走，但耗时不再变
    expect(task.elapsedMs.value).toBe(1500)
  })
})
