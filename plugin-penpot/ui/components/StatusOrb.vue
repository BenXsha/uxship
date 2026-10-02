<template>
  <button
    class="orb"
    :class="[stateClass, { 'orb--flash': stepFlash, 'orb--busy': hasActiveTask || isProcessing }]"
    :style="{ '--ring-speed': ringSpeed }"
    :title="tooltipLines.join('\n')"
    @click="emit('focus')"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
  >
    <!-- Siri 式形变光斑层（4 片 + 珍珠核心），整体慢速自转 -->
    <span class="orb__morph">
      <span class="orb__blob-wrap orb__blob-wrap--1"><span class="orb__blob orb__blob--1"></span></span>
      <span class="orb__blob-wrap orb__blob-wrap--2"><span class="orb__blob orb__blob--2"></span></span>
      <span class="orb__blob-wrap orb__blob-wrap--3"><span class="orb__blob orb__blob--3"></span></span>
      <span class="orb__blob-wrap orb__blob-wrap--4"><span class="orb__blob orb__blob--4"></span></span>
      <span class="orb__core"></span>
    </span>

    <!-- 在忙：旋转光轨（转速与色相随进度） -->
    <span v-if="hasActiveTask || isProcessing" class="orb__ring" :class="ringPhaseClass"></span>
    <!-- 完成 / 失败：一次性光晕 -->
    <span v-if="hasCompletedTask && !failed" class="orb__glow orb__glow--ok"></span>
    <span v-if="failed" class="orb__glow orb__glow--bad"></span>

    <span class="orb__content">
      <span class="orb__dot" :class="dotClass"></span>
      <span class="orb__number">{{ number }}</span>
      <span class="orb__label">{{ label }}</span>
      <span v-if="hasActiveTask && stepDots.length" class="orb__dots">
        <i
          v-for="dot in stepDots"
          :key="dot.index"
          class="orb__step"
          :class="{ 'orb__step--done': dot.done, 'orb__step--active': dot.active, 'orb__step--failed': failed && dot.active }"
        ></i>
      </span>
    </span>

    <!-- 悬停浮层 -->
    <span v-if="hovering" class="orb__tip">
      <span v-for="(line, index) in tooltipLines" :key="index" class="orb__tip-line">{{ line }}</span>
    </span>
  </button>
</template>

<script setup lang="ts">
/**
 * 常驻状态球（移植自 plugin-mastergo 的 `CompactBall`）
 *
 * 两种形态都用这颗球（plugin-mastergo 同款体验，靠 `penpot.ui.resize` 实现，见 useCompactMode）：
 *   - **展开态**：粘在面板顶栏，滚到日志区也能一眼看到「连没连上 / 在忙什么 / 任务到哪步 / 选中多少」；
 *   - **紧凑态**：整个插件窗口缩成这颗球，点一下展开。
 *
 * 组件本身不区分形态（`.app--compact` 负责居中放大），只负责画 + 上报点击。
 *
 * 保留原设计的全部视觉语言：Siri 形变光斑（4 片 + 珍珠核心）、在处理时的旋转光轨
 * （转速与色相随进度）、完成/失败光晕、步骤切换闪动、悬停多行浮层。
 * 与 plugin-mastergo 的差异只有一处：状态点配色沿用本面板的语义（见 useStatusOrb 注释）。
 */
import { computed, ref } from 'vue'
import { useStatusOrb, type OrbInput } from '../composables/useStatusOrb'

const props = defineProps<{
  status: string
  isConnected: boolean
  isConnecting: boolean
  isProcessing: boolean
  selectionCount: number
  hasActiveTask: boolean
  hasCompletedTask: boolean
  hasFailed: boolean
  completedCount: number
  totalSteps: number
  summaryText: string
  currentStepId: string | null
  codename: string
}>()

const emit = defineEmits<{ focus: [] }>()

// 用 computed 代理成 Ref，喂给纯推导的 useStatusOrb（组件只画，不算）
const asRef = <T,>(getter: () => T) => computed(getter)
const orb = useStatusOrb({
  status: asRef(() => props.status),
  isConnected: asRef(() => props.isConnected),
  isConnecting: asRef(() => props.isConnecting),
  isProcessing: asRef(() => props.isProcessing),
  selectionCount: asRef(() => props.selectionCount),
  hasActiveTask: asRef(() => props.hasActiveTask),
  hasCompletedTask: asRef(() => props.hasCompletedTask),
  hasFailed: asRef(() => props.hasFailed),
  completedCount: asRef(() => props.completedCount),
  totalSteps: asRef(() => props.totalSteps),
  summaryText: asRef(() => props.summaryText),
  currentStepId: asRef(() => props.currentStepId),
  codename: asRef(() => props.codename),
} satisfies OrbInput)

const { stateClass, dotClass, number, label, ringSpeed, ringPhaseClass, stepDots, tooltipLines, stepFlash } = orb
const hovering = ref(false)
</script>
