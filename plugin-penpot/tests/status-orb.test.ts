/**
 * 状态球（移植 plugin-mastergo 的 CompactBall）的推导逻辑
 *
 * 球本身只是画，**算的都在 `useStatusOrb`**（纯函数式推导、注入 Ref）—— 所以能单测。
 * 这里钉住的都是"一眼看错就会误判状态"的东西：五态配色映射、球心数字的含义、
 * 光轨转速/色相随进度、步骤小点、以及步骤切换闪动只闪一次。
 *
 * 一条刻意的取舍：plugin-mastergo 的球是可以点开/收起的「紧凑模式」开关，
 * 但 Penpot 的插件面板是**固定尺寸 iframe**（`penpot.ui.open({width,height})` 一次定死），
 * 没有折叠通路 —— 所以球改成粘性顶栏里的常驻状态指示，点击只做"滚到相关位置"。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useStatusOrb } from '@ui/composables/useStatusOrb'

function setup(overrides: Record<string, unknown> = {}) {
  const state = {
    status: ref('disconnected'),
    isConnected: ref(false),
    isConnecting: ref(false),
    isProcessing: ref(false),
    selectionCount: ref(0),
    hasActiveTask: ref(false),
    hasCompletedTask: ref(false),
    hasFailed: ref(false),
    completedCount: ref(0),
    totalSteps: ref(0),
    summaryText: ref(''),
    currentStepId: ref<string | null>(null),
    codename: ref('Penpot'),
    ...(overrides as object),
  }
  return { state, orb: useStatusOrb(state as never) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('状态映射（与面板其余部分同一套语义）', () => {
  it('未连接 → 灰 + 「未连接」', () => {
    const { orb } = setup()
    expect(orb.stateClass.value).toBe('orb--idle')
    expect(orb.dotClass.value).toBe('orb-dot--idle')
    expect(orb.label.value).toBe('未连接')
  })

  it('连接中 → 琥珀（与「未连接」区分开）', () => {
    const { orb } = setup({ isConnecting: ref(true), status: ref('connecting') })
    expect(orb.stateClass.value).toBe('orb--connecting')
    expect(orb.dotClass.value).toBe('orb-dot--connecting')
    expect(orb.label.value).toBe('连接中')
  })

  it('已连接 → 成功绿（与连接徽标 badge--ok 同色）', () => {
    const { orb } = setup({ isConnected: ref(true), status: ref('connected') })
    expect(orb.stateClass.value).toBe('orb--connected')
    expect(orb.dotClass.value).toBe('orb-dot--connected')
    expect(orb.label.value).toBe('已连接')
  })

  it('**在忙用靛蓝，不用青绿**（青绿只表示"已完成"，这条上一轮复审纠过）', () => {
    const { orb } = setup({ isConnected: ref(true), isProcessing: ref(true) })
    expect(orb.stateClass.value).toBe('orb--busy')
    expect(orb.dotClass.value).toBe('orb-dot--busy')
    expect(orb.label.value).toBe('处理中')
  })

  it('任务失败优先于一切（即便连接正常）', () => {
    const { orb } = setup({ isConnected: ref(true), isProcessing: ref(true), hasFailed: ref(true) })
    expect(orb.stateClass.value).toBe('orb--failed')
    expect(orb.dotClass.value).toBe('orb-dot--failed')
    expect(orb.label.value).toBe('失败')
  })

  it('完成态优先于"在忙"（处理中标志可能晚一拍才落）', () => {
    const { orb } = setup({ isConnected: ref(true), isProcessing: ref(true), hasCompletedTask: ref(true) })
    expect(orb.stateClass.value).toBe('orb--done')
    expect(orb.label.value).toBe('完成')
  })
})

describe('球心数字', () => {
  it('无任务时显示选中的对象数', () => {
    const { orb } = setup({ selectionCount: ref(3) })
    expect(orb.number.value).toBe(3)
  })

  it('有任务时显示「正在做第几步」（不是已完成数）', () => {
    const { orb } = setup({ hasActiveTask: ref(true), completedCount: ref(2), totalSteps: ref(4), selectionCount: ref(3) })
    expect(orb.number.value).toBe(3)
    expect(orb.label.value).toBe('2/4')
  })

  it('最后一步不越界（completedCount = totalSteps 时仍是 totalSteps）', () => {
    const { orb } = setup({ hasActiveTask: ref(true), completedCount: ref(4), totalSteps: ref(4) })
    expect(orb.number.value).toBe(4)
  })
})

describe('光轨：转速与色相随进度', () => {
  it('无任务时不指定转速（用样式默认）', () => {
    const { orb } = setup()
    expect(orb.ringSpeed.value).toBe('1.2s')
    expect(orb.ringPhaseClass.value).toBe('')
  })

  it('进度越靠后转得越快（0% → 1.5s，100% → 0.7s）', () => {
    const { orb, state } = setup({ hasActiveTask: ref(true), totalSteps: ref(4) })
    expect(orb.ringSpeed.value).toBe('1.50s')

    state.completedCount.value = 2
    expect(orb.ringSpeed.value).toBe('1.10s')

    state.completedCount.value = 4
    expect(orb.ringSpeed.value).toBe('0.70s')
  })

  it('色相分三段：早 / 中 / 晚', () => {
    const { orb, state } = setup({ hasActiveTask: ref(true), totalSteps: ref(3) })
    expect(orb.ringPhaseClass.value).toBe('orb-ring--early')
    state.completedCount.value = 1
    expect(orb.ringPhaseClass.value).toBe('orb-ring--mid')
    state.completedCount.value = 2
    expect(orb.ringPhaseClass.value).toBe('orb-ring--late')
  })
})

describe('步骤小点与浮层', () => {
  it('小点数量 = 总步数，已完成/当前步分别标记', () => {
    const { orb } = setup({ hasActiveTask: ref(true), completedCount: ref(2), totalSteps: ref(4) })
    expect(orb.stepDots.value).toHaveLength(4)
    expect(orb.stepDots.value.map((d) => d.done)).toEqual([true, true, false, false])
    expect(orb.stepDots.value.map((d) => d.active)).toEqual([false, false, true, false])
  })

  it('浮层：有任务时报进度，无任务时报选中数', () => {
    const active = setup({ hasActiveTask: ref(true), completedCount: ref(1), totalSteps: ref(3), summaryText: ref('落地到画布') })
    expect(active.orb.tooltipLines.value.join('|')).toContain('任务进行中：落地到画布')
    expect(active.orb.tooltipLines.value.join('|')).toContain('进度 1/3')

    const idle = setup({ selectionCount: ref(5) })
    expect(idle.orb.tooltipLines.value.join('|')).toContain('已选中 5 个对象')
  })

  it('浮层第一行带上宿主代号（Penpot）', () => {
    const { orb } = setup()
    expect(orb.tooltipLines.value[0]).toContain('Penpot')
  })
})

describe('步骤切换闪动', () => {
  it('切换步骤时闪一次，500ms 后自动收（避免长亮）', async () => {
    const { orb, state } = setup({ hasActiveTask: ref(true), totalSteps: ref(3), currentStepId: ref('a') })
    expect(orb.stepFlash.value).toBe(false)

    state.currentStepId.value = 'b'
    await Promise.resolve()
    expect(orb.stepFlash.value).toBe(true)

    vi.advanceTimersByTime(500)
    expect(orb.stepFlash.value).toBe(false)
  })

  it('首个步骤（从 null 进入）不闪 —— 那是"任务刚开始"，不是"换步"', async () => {
    const { orb, state } = setup({ hasActiveTask: ref(true), totalSteps: ref(3) })
    state.currentStepId.value = 'a'
    await Promise.resolve()
    expect(orb.stepFlash.value).toBe(false)
  })
})
