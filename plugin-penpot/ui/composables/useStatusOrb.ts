/**
 * 状态球（移植 plugin-mastergo 的 `CompactBall`）的**纯推导**部分
 *
 * plugin-mastergo 那个球是"紧凑模式"的载体：面板折叠成一个悬浮球，点开展开。
 *
 * ⚠️ 这里曾经写着"Penpot 面板是固定尺寸 iframe、没有折叠通路"—— **那是错的**。
 * 官方 API 有 `penpot.ui.resize(width, height)` 与 `penpot.ui.size`，
 * 所以紧凑模式是可实现的（见 `useCompactMode.ts`）。球因此有两个形态：
 *   展开态：粘性顶栏里的状态指示（滚到日志区也能一眼看到状态）；
 *   紧凑态：整个窗口就是这颗球（点击展开）。
 *
 * 本模块只管**推导**（状态→配色/文案/转速/小点），与形态无关。
 *
 * 派生逻辑抽在这里（不碰 DOM）→ 可直接单测；组件只负责画。
 *
 * ⚠️ 颜色语义与面板其余部分**保持一致**（这是上一轮视觉复审的一条结论）：
 *   - 已连接 = 成功绿（与连接徽标 `badge--ok` 同色）
 *   - 处理中/任务在跑 = 靛蓝 `--progress`（与进度条同色，**不用青绿**，青绿只表示"已完成"）
 *   - 失败 = 红；连接中 = 琥珀；未连接 = 灰
 * 所以球心数字、状态点、光轨阶段色都从这一套里取，不引入第二套配色。
 */
import { computed, ref, watch, type Ref } from 'vue'

export interface OrbInput {
  /** 连接状态（useMCPConnection 的 status） */
  status: Ref<string>
  isConnected: Ref<boolean>
  isConnecting: Ref<boolean>
  isProcessing: Ref<boolean>
  /** 选中的对象个数（无任务时球心显示它） */
  selectionCount: Ref<number>
  /** 任务状态 */
  hasActiveTask: Ref<boolean>
  hasCompletedTask: Ref<boolean>
  hasFailed: Ref<boolean>
  completedCount: Ref<number>
  totalSteps: Ref<number>
  summaryText: Ref<string>
  currentStepId: Ref<string | null>
  /** 宿主代号（Penpot）—— 浮层第一行 */
  codename?: Ref<string>
}

export function useStatusOrb(input: OrbInput) {
  /** 状态点色（5 态，与面板其余部分同一套语义） */
  const dotClass = computed(() => {
    if (input.hasFailed.value) return 'orb-dot--failed'
    if (input.hasCompletedTask.value) return 'orb-dot--done'
    if (input.isProcessing.value || input.hasActiveTask.value) return 'orb-dot--busy'
    if (input.isConnected.value) return 'orb-dot--connected'
    if (input.isConnecting.value) return 'orb-dot--connecting'
    return 'orb-dot--idle'
  })

  /** 球体整体状态（决定光斑配色与呼吸节奏） */
  const stateClass = computed(() => {
    if (input.hasFailed.value) return 'orb--failed'
    if (input.hasCompletedTask.value) return 'orb--done'
    if (input.isProcessing.value || input.hasActiveTask.value) return 'orb--busy'
    if (input.isConnected.value) return 'orb--connected'
    if (input.isConnecting.value) return 'orb--connecting'
    return 'orb--idle'
  })

  /**
   * 球心数字：有任务时显示「当前第几步」，否则显示选中的对象数。
   *
   * 与 plugin-mastergo 同口径（`min(completedCount + 1, totalSteps)`）—— 它表达的是
   * "正在做第几步"，而不是"已完成几步"，和旁边的 `2/4` 配合不重复。
   */
  const number = computed(() => {
    if (input.hasActiveTask.value) return Math.min(input.completedCount.value + 1, input.totalSteps.value)
    return input.selectionCount.value
  })

  const label = computed(() => {
    if (input.hasFailed.value) return '失败'
    if (input.hasCompletedTask.value) return '完成'
    if (input.hasActiveTask.value) return `${input.completedCount.value}/${input.totalSteps.value}`
    if (input.isProcessing.value) return '处理中'
    if (input.isConnected.value) return '已连接'
    if (input.isConnecting.value) return '连接中'
    return '未连接'
  })

  /** 光轨转速：进度越靠后转得越快（0% → 1.5s，100% → 0.7s） */
  const ringSpeed = computed(() => {
    if (!input.hasActiveTask.value) return '1.2s'
    const total = input.totalSteps.value
    const ratio = total > 0 ? input.completedCount.value / total : 0
    return `${(1.5 - ratio * 0.8).toFixed(2)}s`
  })

  /** 光轨色相阶段：早/中/晚 */
  const ringPhaseClass = computed(() => {
    if (!input.hasActiveTask.value) return ''
    const total = input.totalSteps.value
    const ratio = total > 0 ? input.completedCount.value / total : 0
    if (ratio < 0.33) return 'orb-ring--early'
    if (ratio < 0.66) return 'orb-ring--mid'
    return 'orb-ring--late'
  })

  /** 步骤小点：总数、已完成数、当前步、失败步的位置由组件按索引渲染 */
  const stepDots = computed(() =>
    Array.from({ length: input.totalSteps.value }, (_, index) => ({
      index: index + 1,
      done: index + 1 <= input.completedCount.value,
      active: index + 1 === input.completedCount.value + 1,
    })),
  )

  /** 悬停浮层（与 plugin-mastergo 的多行提示同风格） */
  const tooltipLines = computed<string[]>(() => {
    const lines: string[] = []
    const codename = input.codename?.value
    if (codename) lines.push(`宿主：${codename}`)

    if (input.hasFailed.value) lines.push('任务失败 —— 面板下方的任务卡片有原因')
    else if (input.hasActiveTask.value) lines.push(`任务进行中：${input.summaryText.value}`)
    else if (input.isProcessing.value) lines.push('正在处理一次工具调用…')
    else if (input.isConnected.value) lines.push('MCP 已连接')
    else if (input.isConnecting.value) lines.push('正在连接 MCP…')
    else lines.push('MCP 未连接')

    if (input.hasActiveTask.value) lines.push(`进度 ${input.completedCount.value}/${input.totalSteps.value}`)
    else if (input.selectionCount.value > 0) lines.push(`已选中 ${input.selectionCount.value} 个对象`)
    else lines.push('未选中任何对象')

    return lines
  })

  /**
   * 步骤切换闪动。
   *
   * plugin-mastergo 的做法是 `watch(currentStepId)` 后置一个 500ms 的 flag；
   * 这里保留同一行为（球体亮一下，提示"换步了"），用 `now` 注入便于测试。
   */
  const stepFlash = ref(false)
  let flashTimer: ReturnType<typeof setTimeout> | null = null

  watch(
    () => input.currentStepId.value,
    (next, previous) => {
      if (!next || next === previous || previous === null) return
      stepFlash.value = true
      if (flashTimer !== null) clearTimeout(flashTimer)
      flashTimer = setTimeout(() => {
        stepFlash.value = false
        flashTimer = null
      }, 500)
    },
  )

  return { stateClass, dotClass, number, label, ringSpeed, ringPhaseClass, stepDots, tooltipLines, stepFlash }
}
