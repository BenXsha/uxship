<template>
  <div v-if="codename" class="ball-codename">{{ codename }}</div>
  <div
    class="compact-ball"
    :class="[stateClass, { 'ball-processing': isProcessing, 'ball-shake': hasError, 'ball-step-flash': stepFlash }]"
    :style="ringSpeedStyle"
    @click="$emit('toggle')"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <!-- 悬停提示浮层 -->
    <div class="ball-tooltip" :class="{ 'ball-tooltip-visible': visible }">
      <div v-for="(line, i) in tooltipLines" :key="i" class="tooltip-line">{{ line }}</div>
    </div>
    <!-- Siri 风格形变光辉层 -->
    <div class="siri-morph-layer">
      <div class="siri-blob-wrap siri-blob-wrap-1">
        <div class="siri-blob siri-blob-1"></div>
      </div>
      <div class="siri-blob-wrap siri-blob-wrap-2">
        <div class="siri-blob siri-blob-2"></div>
      </div>
      <div class="siri-blob-wrap siri-blob-wrap-3">
        <div class="siri-blob siri-blob-3"></div>
      </div>
      <div class="siri-blob-wrap siri-blob-wrap-4">
        <div class="siri-blob siri-blob-4"></div>
      </div>
      <div class="siri-core"></div>
    </div>
    <!-- 任务中：旋转光轨 -->
    <div v-if="isProcessing || hasActiveTask" class="ball-ring" :class="ringPhaseClass"></div>
    <!-- 完成后：成功光晕 -->
    <div v-if="hasCompletedTask && !hasTaskFailed" class="ball-glow-success"></div>
    <!-- 失败：警示光晕 -->
    <div v-if="hasTaskFailed" class="ball-glow-failed"></div>
    <div class="ball-content">
      <!-- 状态指示 -->
      <div class="ball-status-dot" :class="dotClass"></div>
      <div class="ball-count">{{ displayNumber }}</div>
      <div v-if="hasActiveTask" class="ball-step-row">
        <div class="ball-step-counter">{{ completedCount }}/{{ totalSteps }}</div>
      </div>
      <div v-if="hasActiveTask" class="ball-step-dots">
        <div
          v-for="i in totalSteps"
          :key="i"
          class="ball-step-dot"
          :class="{ 'sdot-done': i <= completedCount, 'sdot-active': i === completedCount + 1, 'sdot-failed': hasTaskFailed && i === completedCount + 1 }"
        ></div>
      </div>
      <div class="ball-label" :class="labelClass">{{ label }}</div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  stateClass: string
  dotClass: string
  labelClass: string
  label: string
  selectionCount: number
  isProcessing: boolean
  hasError: boolean
  isConnected: boolean
  isConnecting: boolean
  statusText: string
  codename: string
  // 任务进度
  hasActiveTask: boolean
  hasCompletedTask: boolean
  hasTaskFailed: boolean
  currentStepId: string | null
  completedCount: number
  totalSteps: number
  summaryText: string
}>()

defineEmits<{
  toggle: []
}>()

const visible = ref(false)
const stepFlash = ref(false)
const prevStepId = ref<string | null>(null)

function onMouseEnter() { visible.value = true }
function onMouseLeave() { visible.value = false }

// 侦测步骤切换 → 触发闪动
watch(() => props.currentStepId, (newId, oldId) => {
  if (newId && newId !== oldId && oldId !== null) {
    stepFlash.value = true
    setTimeout(() => { stepFlash.value = false }, 500)
  }
  prevStepId.value = newId
})

// 球体中央显示：有活跃任务时显示步骤序号 + 百分比
const displayNumber = computed(() => {
  if (props.hasActiveTask) {
    return Math.min(props.completedCount + 1, props.totalSteps)
  }
  return props.selectionCount
})

// 根据进度调整旋转速度
const ringSpeedStyle = computed(() => {
  if (!props.hasActiveTask) return {}
  const pct = props.totalSteps > 0 ? props.completedCount / props.totalSteps : 0
  const speed = 1.5 - pct * 0.8       // 0%→1.5s, 100%→0.7s
  return { '--ring-speed': `${speed}s` } as any
})

// 光轨阶段样式：步骤越靠后色调越暖
const ringPhaseClass = computed(() => {
  if (!props.hasActiveTask) return ''
  const pct = props.totalSteps > 0 ? props.completedCount / props.totalSteps : 0
  if (pct < 0.33) return 'ring-phase-early'
  if (pct < 0.66) return 'ring-phase-mid'
  return 'ring-phase-late'
})

const tooltipLines = computed<string[]>(() => {
  const lines: string[] = []
  if (props.codename) lines.push(`📛 ${props.codename}`)
  if (props.isProcessing) lines.push('⚡ 正在处理任务…')
  else if (props.isConnected) lines.push('🟢 MCP 已连接')
  else if (props.isConnecting) lines.push('🟡 正在连接 MCP…')
  else if (props.hasError) lines.push('🔴 连接异常')
  else lines.push('⚪ MCP 未连接')

  if (props.hasActiveTask && props.summaryText) {
    lines.push(`📋 ${props.completedCount}/${props.totalSteps} ${props.summaryText}`)
  } else if (props.selectionCount) {
    lines.push(`已选中 ${props.selectionCount} 个元素`)
  }

  lines.push('点击展开完整面板')

  return lines
})
</script>

<style scoped>
/* ---- 球体主体（圆形容器，约束阴影和光斑） ---- */
.compact-ball {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: #0c0c1d;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  position: relative;
  z-index: 1;
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 1s ease-out, filter 0.8s ease-out;
  animation: ball-float 5s ease-in-out infinite;
}
.compact-ball:hover {
  transform: scale(1.12) rotate(3deg);
  filter: brightness(1.1);
}
.compact-ball:active {
  transform: scale(0.94);
  transition: transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* ---- 浮动呼吸动画 ---- */
@keyframes ball-float {
  0%, 100% { transform: translateY(0); }
  30%      { transform: translateY(-3px); }
  60%      { transform: translateY(2px); }
  85%      { transform: translateY(-1px); }
}

/* ====== 光斑层 — 不裁剪让光斑自由延展定义有机轮廓 ====== */
.siri-morph-layer {
  position: absolute;
  inset: -6px;
  z-index: 0;
  animation: morph-layer-rotate 20s linear infinite;
}
@keyframes morph-layer-rotate {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
.siri-blob-wrap {
  position: absolute;
  border-radius: 50%;
}
.siri-blob-wrap-1 { inset: -2px;  transform: translate(-4px, -2px); }
.siri-blob-wrap-2 { inset: -12px; transform: translate(4px, 5px); }
.siri-blob-wrap-3 { inset: -6px;  transform: translate(5px, -3px); }
.siri-blob-wrap-4 { inset: -16px; transform: translate(-3px, 6px); }

.siri-blob {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  opacity: 0.82;
  mix-blend-mode: screen;
  will-change: border-radius, transform;
  filter: blur(0.5px);
}

  /* 高亮核心 — Siri 风格珍珠光泽 */
.siri-core {
  position: absolute;
  inset: 26%;
  border-radius: 50%;
  background: radial-gradient(
    circle at 40% 36%,
    rgba(235, 245, 255, 0.94) 0%,
    rgba(190, 215, 255, 0.30) 26%,
    rgba(150, 185, 255, 0.04) 58%,
    transparent 100%
  );
  mix-blend-mode: plus-lighter;
  filter: blur(1px);
  opacity: 0.72;
  z-index: 2;
  animation: siri-core-pulse 3.5s ease-in-out infinite, core-shimmer 6s ease-in-out infinite;
}

/* ====== 光斑形变关键帧 ====== */
@keyframes siri-core-pulse {
  0%, 100% { transform: scale(1) rotate(0deg); opacity: 0.72; }
  25%      { transform: scale(1.15) rotate(90deg); opacity: 0.45; }
  50%      { transform: scale(1.22) rotate(180deg); opacity: 0.28; }
  75%      { transform: scale(1.08) rotate(270deg); opacity: 0.55; }
}
@keyframes core-shimmer {
  0%, 100% { background-position: 40% 36%; }
  25%      { background-position: 55% 30%; }
  50%      { background-position: 60% 50%; }
  75%      { background-position: 35% 55%; }
}
@keyframes siri-morph-1 {
  0%, 100% { border-radius: 60% 40% 70% 30% / 30% 60% 40% 70%; }
  25%      { border-radius: 30% 70% 40% 60% / 70% 30% 60% 40%; }
  50%      { border-radius: 50% 50% 30% 70% / 60% 40% 50% 50%; }
  75%      { border-radius: 40% 60% 60% 40% / 40% 70% 30% 60%; }
}
@keyframes siri-morph-2 {
  0%, 100% { border-radius: 70% 30% 40% 60% / 50% 70% 30% 50%; }
  25%      { border-radius: 40% 60% 70% 30% / 30% 50% 70% 50%; }
  50%      { border-radius: 60% 40% 50% 50% / 70% 30% 40% 60%; }
  75%      { border-radius: 30% 70% 50% 50% / 50% 40% 60% 40%; }
}
@keyframes siri-morph-3 {
  0%, 100% { border-radius: 50% 50% 60% 40% / 70% 30% 60% 40%; }
  25%      { border-radius: 70% 30% 30% 70% / 40% 60% 40% 60%; }
  50%      { border-radius: 30% 70% 60% 40% / 50% 70% 30% 50%; }
  75%      { border-radius: 55% 45% 40% 60% / 35% 55% 70% 30%; }
}
@keyframes siri-morph-4 {
  0%, 100% { border-radius: 40% 60% 30% 70% / 60% 40% 70% 30%; }
  25%      { border-radius: 65% 35% 50% 50% / 30% 70% 40% 60%; }
  50%      { border-radius: 35% 65% 60% 40% / 60% 30% 70% 40%; }
  75%      { border-radius: 50% 50% 35% 65% / 45% 55% 30% 70%; }
}
@keyframes blob-drift-1 {
  0%, 100% { transform: rotate(0deg) translate(0, 0) scale(1); }
  25%      { transform: rotate(12deg) translate(5px, -3px) scale(1.08); }
  50%      { transform: rotate(-8deg) translate(-3px, 4px) scale(0.94); }
  75%      { transform: rotate(6deg) translate(2px, -5px) scale(1.04); }
}
@keyframes blob-drift-2 {
  0%, 100% { transform: rotate(0deg) translate(0, 0) scale(1); }
  25%      { transform: rotate(-14deg) translate(-4px, -5px) scale(0.92); }
  50%      { transform: rotate(9deg) translate(5px, 2px) scale(1.06); }
  75%      { transform: rotate(-5deg) translate(-2px, 4px) scale(0.96); }
}
@keyframes blob-drift-3 {
  0%, 100% { transform: rotate(0deg) translate(0, 0) scale(1); }
  25%      { transform: rotate(16deg) translate(-5px, 4px) scale(1.05); }
  50%      { transform: rotate(-11deg) translate(3px, -4px) scale(0.93); }
  75%      { transform: rotate(8deg) translate(-1px, -3px) scale(1.03); }
}
@keyframes blob-drift-4 {
  0%, 100% { transform: rotate(0deg) translate(0, 0) scale(1); }
  25%      { transform: rotate(-17deg) translate(4px, 5px) scale(0.9); }
  50%      { transform: rotate(11deg) translate(-5px, -3px) scale(1.07); }
  75%      { transform: rotate(-7deg) translate(2px, 1px) scale(0.95); }
}

/* ====== 5 种状态：光斑形变 + 漂移双动画叠加 ====== */

/* — idle — Siri 虹彩光谱：蓝紫青粉交织 */
.ball-idle-state {
  box-shadow: 0 0 25px rgba(110, 181, 255, 0.35), 0 0 50px rgba(155, 138, 255, 0.25), 0 0 80px rgba(94, 234, 212, 0.15);
  animation: ball-float 5s ease-in-out infinite, glow-idle 4s ease-in-out infinite;
}
@keyframes glow-idle {
  0%, 100% { box-shadow: 0 0 20px rgba(110, 181, 255, 0.3), 0 0 45px rgba(155, 138, 255, 0.2), 0 0 70px rgba(94, 234, 212, 0.1); }
  50%      { box-shadow: 0 0 35px rgba(110, 181, 255, 0.45), 0 0 60px rgba(155, 138, 255, 0.32), 0 0 95px rgba(94, 234, 212, 0.2); }
}
.ball-idle-state .siri-blob-1 {
  background: conic-gradient(from 45deg at 35% 25%, #6EB5FF 0%, #4A9EF6 22%, #5EEAD4 48%, #3880EC 74%, #6EB5FF 100%);
  animation: siri-morph-1 7.5s ease-in-out infinite, blob-drift-1 10s ease-in-out infinite;
}
.ball-idle-state .siri-blob-2 {
  background: conic-gradient(from 135deg at 65% 55%, #A78BFA 0%, #C4B5FD 22%, #F9A8D4 48%, #8B5CF6 74%, #A78BFA 100%);
  animation: siri-morph-2 9.5s ease-in-out infinite, blob-drift-2 12s ease-in-out infinite;
}
.ball-idle-state .siri-blob-3 {
  background: conic-gradient(from 225deg at 48% 40%, #5EEAD4 0%, #6EB5FF 22%, #A78BFA 48%, #2DD4BF 74%, #5EEAD4 100%);
  animation: siri-morph-3 8.5s ease-in-out infinite, blob-drift-3 11s ease-in-out infinite;
}
.ball-idle-state .siri-blob-4 {
  background: conic-gradient(from 315deg at 55% 30%, #F9A8D4 0%, #FCD34D 22%, #C4B5FD 48%, #F472B6 74%, #F9A8D4 100%);
  animation: siri-morph-4 11s ease-in-out infinite, blob-drift-4 13s ease-in-out infinite;
}

/* — processing — 蓝紫青高频跃动 */
.ball-processing-state {
  box-shadow: 0 0 30px rgba(59, 130, 246, 0.45), 0 0 60px rgba(139, 92, 246, 0.30), 0 0 90px rgba(6, 182, 212, 0.18);
  animation: ball-float 2.8s ease-in-out infinite, glow-processing 1.6s ease-in-out infinite;
}
@keyframes glow-processing {
  0%, 100% { box-shadow: 0 0 25px rgba(59, 130, 246, 0.35), 0 0 50px rgba(139, 92, 246, 0.22), 0 0 80px rgba(6, 182, 212, 0.12); }
  50%      { box-shadow: 0 0 40px rgba(59, 130, 246, 0.55), 0 0 75px rgba(139, 92, 246, 0.4), 0 0 110px rgba(6, 182, 212, 0.25); }
}
.ball-processing-state .siri-blob-1 {
  background: conic-gradient(from 0deg at 35% 25%, #3B82F6 0%, #2563EB 22%, #06B6D4 48%, #1D4ED8 74%, #3B82F6 100%);
  animation: siri-morph-1 3.5s ease-in-out infinite, blob-drift-1 5.5s ease-in-out infinite;
}
.ball-processing-state .siri-blob-2 {
  background: conic-gradient(from 90deg at 65% 55%, #8B5CF6 0%, #D946EF 22%, #A78BFA 48%, #7C3AED 74%, #8B5CF6 100%);
  animation: siri-morph-2 4.5s ease-in-out infinite, blob-drift-2 6.5s ease-in-out infinite;
}
.ball-processing-state .siri-blob-3 {
  background: conic-gradient(from 180deg at 48% 40%, #06B6D4 0%, #22D3EE 22%, #3B82F6 48%, #0891B2 74%, #06B6D4 100%);
  animation: siri-morph-3 4s ease-in-out infinite, blob-drift-3 6s ease-in-out infinite;
}
.ball-processing-state .siri-blob-4 {
  background: conic-gradient(from 270deg at 55% 30%, #D946EF 0%, #F472B6 22%, #8B5CF6 48%, #C026D3 74%, #D946EF 100%);
  animation: siri-morph-4 5s ease-in-out infinite, blob-drift-4 7s ease-in-out infinite;
}

/* — error — 珊瑚玫红柔化 */
.ball-error-state {
  box-shadow: 0 0 25px rgba(251, 113, 133, 0.40), 0 0 50px rgba(244, 63, 94, 0.25), 0 0 80px rgba(225, 29, 72, 0.12);
  animation: ball-float 4s ease-in-out infinite, glow-error 3.5s ease-in-out infinite, ball-shake 0.5s ease-in-out;
}
@keyframes glow-error {
  0%, 100% { box-shadow: 0 0 20px rgba(251, 113, 133, 0.3), 0 0 40px rgba(244, 63, 94, 0.18), 0 0 65px rgba(225, 29, 72, 0.08); }
  50%      { box-shadow: 0 0 35px rgba(251, 113, 133, 0.5), 0 0 65px rgba(244, 63, 94, 0.32), 0 0 100px rgba(225, 29, 72, 0.16); }
}
.ball-error-state .siri-blob-1 {
  background: conic-gradient(from 45deg at 35% 25%, #FB7185 0%, #F43F5E 22%, #FDA4AF 48%, #E11D48 74%, #FB7185 100%);
  animation: siri-morph-1 4.5s ease-in-out infinite, blob-drift-1 7s ease-in-out infinite;
}
.ball-error-state .siri-blob-2 {
  background: conic-gradient(from 135deg at 65% 55%, #FDA4AF 0%, #FB7185 22%, #FECDD3 48%, #F43F5E 74%, #FDA4AF 100%);
  animation: siri-morph-2 5.5s ease-in-out infinite, blob-drift-2 8s ease-in-out infinite;
}
.ball-error-state .siri-blob-3 {
  background: conic-gradient(from 225deg at 48% 40%, #F43F5E 0%, #FB7185 22%, #FDA4AF 48%, #BE123C 74%, #F43F5E 100%);
  animation: siri-morph-3 5s ease-in-out infinite, blob-drift-3 7.5s ease-in-out infinite;
}
.ball-error-state .siri-blob-4 {
  background: conic-gradient(from 315deg at 55% 30%, #E11D48 0%, #F43F5E 22%, #FB7185 48%, #9F1239 74%, #E11D48 100%);
  animation: siri-morph-4 6s ease-in-out infinite, blob-drift-4 8.5s ease-in-out infinite;
}

@keyframes ball-shake {
  0%, 100% { transform: translateX(0); }
  15%      { transform: translateX(-8px); }
  30%      { transform: translateX(8px); }
  45%      { transform: translateX(-6px); }
  60%      { transform: translateX(6px); }
  75%      { transform: translateX(-3px); }
  90%      { transform: translateX(3px); }
}

/* — connecting — 暖琥珀金 + 青色连接暗示 */
.ball-connecting-state {
  box-shadow: 0 0 20px rgba(245, 158, 11, 0.35), 0 0 45px rgba(252, 211, 77, 0.22), 0 0 70px rgba(94, 234, 212, 0.10);
  animation: ball-float 3.5s ease-in-out infinite, glow-connecting 2.5s ease-in-out infinite;
}
@keyframes glow-connecting {
  0%, 100% { box-shadow: 0 0 15px rgba(245, 158, 11, 0.25), 0 0 35px rgba(252, 211, 77, 0.15), 0 0 55px rgba(94, 234, 212, 0.06); }
  50%      { box-shadow: 0 0 30px rgba(245, 158, 11, 0.5), 0 0 60px rgba(252, 211, 77, 0.32), 0 0 90px rgba(94, 234, 212, 0.16); }
}
.ball-connecting-state .siri-blob-1 {
  background: conic-gradient(from 0deg at 35% 25%, #F59E0B 0%, #D97706 22%, #FBBF24 48%, #B45309 74%, #F59E0B 100%);
  animation: siri-morph-1 6s ease-in-out infinite, blob-drift-1 8s ease-in-out infinite;
}
.ball-connecting-state .siri-blob-2 {
  background: conic-gradient(from 90deg at 65% 55%, #FCD34D 0%, #F59E0B 22%, #FDE68A 48%, #D97706 74%, #FCD34D 100%);
  animation: siri-morph-2 7s ease-in-out infinite, blob-drift-2 9s ease-in-out infinite;
}
.ball-connecting-state .siri-blob-3 {
  background: conic-gradient(from 180deg at 48% 40%, #FBBF24 0%, #F59E0B 22%, #FDE68A 48%, #B45309 74%, #FBBF24 100%);
  animation: siri-morph-3 6.5s ease-in-out infinite, blob-drift-3 8.5s ease-in-out infinite;
}
.ball-connecting-state .siri-blob-4 {
  background: conic-gradient(from 270deg at 55% 30%, #5EEAD4 0%, #2DD4BF 22%, #6EB5FF 48%, #14B8A6 74%, #5EEAD4 100%);
  animation: siri-morph-4 7.5s ease-in-out infinite, blob-drift-4 9.5s ease-in-out infinite;
}

/* — disconnected — 冷灰蓝极低存在感 */
.ball-disconnected-state {
  box-shadow: 0 0 15px rgba(100, 116, 139, 0.12), 0 0 30px rgba(71, 85, 105, 0.06);
  animation: ball-float 7s ease-in-out infinite, glow-disconnected 8s ease-in-out infinite;
}
@keyframes glow-disconnected {
  0%, 100% { box-shadow: 0 0 10px rgba(100, 116, 139, 0.08), 0 0 20px rgba(71, 85, 105, 0.03); }
  50%      { box-shadow: 0 0 20px rgba(100, 116, 139, 0.16), 0 0 40px rgba(71, 85, 105, 0.08); }
}
.ball-disconnected-state .siri-blob-1 {
  background: conic-gradient(from 45deg at 35% 25%, #475569 0%, #334155 22%, #64748B 48%, #1E293B 74%, #475569 100%);
  animation: siri-morph-1 13s ease-in-out infinite, blob-drift-1 15s ease-in-out infinite;
}
.ball-disconnected-state .siri-blob-2 {
  background: conic-gradient(from 135deg at 65% 55%, #64748B 0%, #475569 22%, #78909C 48%, #334155 74%, #64748B 100%);
  animation: siri-morph-2 15s ease-in-out infinite, blob-drift-2 17s ease-in-out infinite;
}
.ball-disconnected-state .siri-blob-3 {
  background: conic-gradient(from 225deg at 48% 40%, #334155 0%, #1E293B 22%, #475569 48%, #0F172A 74%, #334155 100%);
  animation: siri-morph-3 14s ease-in-out infinite, blob-drift-3 16s ease-in-out infinite;
}
.ball-disconnected-state .siri-blob-4 {
  background: conic-gradient(from 315deg at 55% 30%, #475569 0%, #64748B 22%, #334155 48%, #1E293B 74%, #475569 100%);
  animation: siri-morph-4 16s ease-in-out infinite, blob-drift-4 18s ease-in-out infinite;
}

/* ====== 任务状态：各图层渐变配色 + 变形位移提速 ====== */

/* — 任务运行：暖金琥珀渐变，灵动高速 — */
.ball-task-running {
  box-shadow: 0 0 30px rgba(251, 191, 36, 0.4), 0 0 55px rgba(251, 146, 60, 0.25), 0 0 85px rgba(251, 191, 36, 0.12);
  animation: ball-float 2.5s ease-in-out infinite, glow-task-running 1.4s ease-in-out infinite;
}
@keyframes glow-task-running {
  0%, 100% { box-shadow: 0 0 20px rgba(251, 191, 36, 0.3), 0 0 40px rgba(251, 146, 60, 0.15), 0 0 60px rgba(251, 191, 36, 0.08); }
  50%      { box-shadow: 0 0 40px rgba(251, 191, 36, 0.55), 0 0 70px rgba(251, 146, 60, 0.35), 0 0 110px rgba(251, 191, 36, 0.18); }
}
.ball-task-running .siri-blob-1 {
  background: conic-gradient(from 30deg at 35% 25%, #3B82F6 0%, #2563EB 22%, #A78BFA 48%, #1D4ED8 74%, #3B82F6 100%);
  animation: siri-morph-1 2.5s ease-in-out infinite, blob-drift-1 3.5s ease-in-out infinite;
}
.ball-task-running .siri-blob-2 {
  background: conic-gradient(from 120deg at 65% 55%, #8B5CF6 0%, #7C3AED 22%, #FB923C 48%, #6D28D9 74%, #8B5CF6 100%);
  animation: siri-morph-2 3s ease-in-out infinite, blob-drift-2 4.5s ease-in-out infinite;
}
.ball-task-running .siri-blob-3 {
  background: conic-gradient(from 210deg at 48% 40%, #FB923C 0%, #F97316 22%, #34D399 48%, #EA580C 74%, #FB923C 100%);
  animation: siri-morph-3 2.8s ease-in-out infinite, blob-drift-3 4s ease-in-out infinite;
}
.ball-task-running .siri-blob-4 {
  background: conic-gradient(from 300deg at 55% 30%, #34D399 0%, #10B981 22%, #60A5FA 48%, #059669 74%, #34D399 100%);
  animation: siri-morph-4 3.5s ease-in-out infinite, blob-drift-4 5s ease-in-out infinite;
}

/* — 任务完成：翡翠绿渐变 + 蓝青混色，沉稳收束 — */
.ball-task-done {
  box-shadow: 0 0 25px rgba(52, 211, 153, 0.4), 0 0 50px rgba(16, 185, 129, 0.25), 0 0 80px rgba(52, 211, 153, 0.12);
  animation: ball-float 4s ease-in-out infinite, glow-task-done 2s ease-out forwards;
}
@keyframes glow-task-done {
  0%   { box-shadow: 0 0 35px rgba(52, 211, 153, 0.55), 0 0 65px rgba(16, 185, 129, 0.35), 0 0 100px rgba(52, 211, 153, 0.18); }
  50%  { box-shadow: 0 0 20px rgba(52, 211, 153, 0.3), 0 0 40px rgba(16, 185, 129, 0.15), 0 0 60px rgba(52, 211, 153, 0.08); }
  100% { box-shadow: 0 0 10px rgba(52, 211, 153, 0.1), 0 0 20px rgba(16, 185, 129, 0.05), 0 0 30px transparent; }
}
.ball-task-done .siri-blob-1 {
  background: conic-gradient(from 45deg at 35% 25%, #34D399 0%, #10B981 22%, #6EE7B7 48%, #059669 74%, #34D399 100%);
  animation: siri-morph-1 6s ease-in-out infinite, blob-drift-1 8s ease-in-out infinite;
}
.ball-task-done .siri-blob-2 {
  background: conic-gradient(from 135deg at 65% 55%, #6EE7B7 0%, #34D399 22%, #60A5FA 48%, #10B981 74%, #6EE7B7 100%);
  animation: siri-morph-2 7s ease-in-out infinite, blob-drift-2 9s ease-in-out infinite;
}
.ball-task-done .siri-blob-3 {
  background: conic-gradient(from 225deg at 48% 40%, #10B981 0%, #34D399 22%, #A78BFA 48%, #047857 74%, #10B981 100%);
  animation: siri-morph-3 6.5s ease-in-out infinite, blob-drift-3 8.5s ease-in-out infinite;
}
.ball-task-done .siri-blob-4 {
  background: conic-gradient(from 315deg at 55% 30%, #059669 0%, #10B981 22%, #FCD34D 48%, #065F46 74%, #059669 100%);
  animation: siri-morph-4 7.5s ease-in-out infinite, blob-drift-4 10s ease-in-out infinite;
}

/* — 任务失败：珊瑚红渐变 + 橙紫混色 — */
.ball-task-failed {
  box-shadow: 0 0 25px rgba(251, 113, 133, 0.4), 0 0 50px rgba(239, 68, 68, 0.25), 0 0 80px rgba(251, 113, 133, 0.12);
  animation: ball-float 3.5s ease-in-out infinite, glow-task-failed 1.5s ease-in-out infinite, ball-shake 0.5s ease-in-out;
}
@keyframes glow-task-failed {
  0%, 100% { box-shadow: 0 0 20px rgba(251, 113, 133, 0.35), 0 0 40px rgba(239, 68, 68, 0.18), 0 0 65px rgba(251, 113, 133, 0.08); }
  50%      { box-shadow: 0 0 35px rgba(251, 113, 133, 0.55), 0 0 65px rgba(239, 68, 68, 0.35), 0 0 100px rgba(251, 113, 133, 0.18); }
}
.ball-task-failed .siri-blob-1 {
  background: conic-gradient(from 45deg at 35% 25%, #FB7185 0%, #F43F5E 22%, #FDBA74 48%, #E11D48 74%, #FB7185 100%);
  animation: siri-morph-1 3s ease-in-out infinite, blob-drift-1 4.5s ease-in-out infinite;
}
.ball-task-failed .siri-blob-2 {
  background: conic-gradient(from 135deg at 65% 55%, #FDA4AF 0%, #FB7185 22%, #C4B5FD 48%, #F43F5E 74%, #FDA4AF 100%);
  animation: siri-morph-2 3.8s ease-in-out infinite, blob-drift-2 5.5s ease-in-out infinite;
}
.ball-task-failed .siri-blob-3 {
  background: conic-gradient(from 225deg at 48% 40%, #F43F5E 0%, #FB7185 22%, #FB923C 48%, #BE123C 74%, #F43F5E 100%);
  animation: siri-morph-3 3.3s ease-in-out infinite, blob-drift-3 5s ease-in-out infinite;
}
.ball-task-failed .siri-blob-4 {
  background: conic-gradient(from 315deg at 55% 30%, #E11D48 0%, #F43F5E 22%, #A78BFA 48%, #9F1239 74%, #E11D48 100%);
  animation: siri-morph-4 4.2s ease-in-out infinite, blob-drift-4 6s ease-in-out infinite;
}

/* ---- 旋转光轨 ---- */
.ball-ring {
  position: absolute;
  inset: -10px;
  border-radius: 9999px;
  border: 2.5px solid transparent;
  border-top-color: rgba(59, 130, 246, 0.55);
  border-right-color: rgba(139, 92, 246, 0.35);
  border-bottom-color: rgba(6, 182, 212, 0.18);
  border-left-color: rgba(59, 130, 246, 0.35);
  pointer-events: none;
  z-index: 2;
  filter: blur(1.5px);
}
@keyframes ring-spin {
  0%   { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
@keyframes ring-shimmer {
  0%, 100% { border-top-color: rgba(59, 130, 246, 0.55); border-right-color: rgba(139, 92, 246, 0.35); border-bottom-color: rgba(6, 182, 212, 0.18); border-left-color: rgba(59, 130, 246, 0.35); }
  25%      { border-top-color: rgba(139, 92, 246, 0.55); border-right-color: rgba(6, 182, 212, 0.35); border-bottom-color: rgba(59, 130, 246, 0.18); border-left-color: rgba(139, 92, 246, 0.35); }
  50%      { border-top-color: rgba(6, 182, 212, 0.55); border-right-color: rgba(59, 130, 246, 0.35); border-bottom-color: rgba(139, 92, 246, 0.18); border-left-color: rgba(6, 182, 212, 0.35); }
  75%      { border-top-color: rgba(129, 140, 248, 0.5); border-right-color: rgba(6, 182, 212, 0.3); border-bottom-color: rgba(59, 130, 246, 0.15); border-left-color: rgba(139, 92, 246, 0.3); }
}
@keyframes ring-pulse {
  0%, 100% { opacity: 1; filter: blur(1.5px); }
  50%      { opacity: 0.45; filter: blur(2.5px); }
}
.ball-ring {
  animation: ring-spin var(--ring-speed, 1.2s) linear infinite, ring-pulse 1.6s ease-in-out infinite, ring-shimmer 2.4s ease-in-out infinite;
}

/* ---- 悬停提示浮层（顶部居中）---- */
.ball-tooltip {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  pointer-events: none;
  background: rgba(22, 22, 30, 0.94);
  backdrop-filter: blur(12px);
  color: rgba(255, 255, 255, 0.85);
  font-size: 10px;
  font-weight: 450;
  line-height: 1.3;
  padding: 4px 8px;
  border-radius: 8px;
  max-width: 148px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.06);
  opacity: 0;
  transition: opacity 0.12s ease;
}
.ball-tooltip-visible {
  opacity: 1;
}
.tooltip-line {
  white-space: nowrap;
}
.tooltip-line + .tooltip-line {
  margin-top: 1px;
}

/* ---- 状态点 ---- */
.ball-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  margin-bottom: 2px;
  position: relative;
  z-index: 3;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.55), 0 0 4px rgba(0, 0, 0, 0.35);
}
.dot-idle             { background: #22C55E; box-shadow: 0 0 6px rgba(34, 197, 94, 0.5); animation: dot-glow-idle 2.5s ease-in-out infinite; }
.dot-processing       { background: #38BDF8; box-shadow: 0 0 8px rgba(56, 189, 248, 0.6); animation: dot-pulse-fast 0.7s ease-in-out infinite, dot-glow-process 0.7s ease-in-out infinite; }
.dot-error            { background: #FB7185; box-shadow: 0 0 8px rgba(251, 113, 133, 0.6); animation: dot-blink 0.5s step-end infinite; }
.dot-connecting       { background: #F59E0B; box-shadow: 0 0 6px rgba(245, 158, 11, 0.5); animation: dot-pulse-fast 1s ease-in-out infinite, dot-glow-connect 1s ease-in-out infinite; }
.dot-disconnected     { background: #94A3B8; opacity: 0.6; animation: dot-glow-disconnected 4s ease-in-out infinite; }
@keyframes dot-glow-idle {
  0%, 100% { box-shadow: 0 0 4px rgba(34, 197, 94, 0.35); }
  50%      { box-shadow: 0 0 10px rgba(34, 197, 94, 0.65), 0 0 16px rgba(34, 197, 94, 0.25); }
}
@keyframes dot-glow-process {
  0%, 100% { box-shadow: 0 0 6px rgba(56, 189, 248, 0.4); }
  50%      { box-shadow: 0 0 14px rgba(56, 189, 248, 0.75), 0 0 22px rgba(56, 189, 248, 0.3); }
}
@keyframes dot-glow-connect {
  0%, 100% { box-shadow: 0 0 4px rgba(245, 158, 11, 0.35); }
  50%      { box-shadow: 0 0 12px rgba(245, 158, 11, 0.65), 0 0 20px rgba(245, 158, 11, 0.25); }
}
@keyframes dot-glow-disconnected {
  0%, 100% { box-shadow: 0 0 2px rgba(148, 163, 184, 0.2); }
  50%      { box-shadow: 0 0 6px rgba(148, 163, 184, 0.35); }
}
@keyframes dot-pulse-fast {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.35; transform: scale(0.75); }
}
@keyframes dot-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.15; }
}

/* ---- 球体内容层（在光晕之上） ---- */
.ball-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  position: relative;
  z-index: 3;
}

/* ---- 步骤切换闪动 ---- */
.ball-step-flash {
  animation: step-flash 0.5s ease-out !important;
}
@keyframes step-flash {
  0%   { filter: brightness(1.6) saturate(1.4); transform: scale(1.08); }
  100% { filter: brightness(1) saturate(1); transform: scale(1); }
}

/* ---- 完成光晕 ---- */
.ball-glow-success {
  position: absolute;
  inset: -20px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(52, 211, 153, 0.35) 0%, rgba(52, 211, 153, 0.08) 50%, transparent 70%);
  pointer-events: none;
  z-index: 1;
  animation: glow-success-pulse 2s ease-out forwards;
}
@keyframes glow-success-pulse {
  0%   { opacity: 1; transform: scale(0.6); }
  50%  { opacity: 0.7; transform: scale(1.1); }
  100% { opacity: 0; transform: scale(1.3); }
}

/* ---- 失败光晕 ---- */
.ball-glow-failed {
  position: absolute;
  inset: -20px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(251, 113, 133, 0.35) 0%, rgba(251, 113, 133, 0.08) 50%, transparent 70%);
  pointer-events: none;
  z-index: 1;
  animation: glow-failed-pulse 2s ease-out forwards;
}
@keyframes glow-failed-pulse {
  0%   { opacity: 1; transform: scale(0.6); }
  50%  { opacity: 0.7; transform: scale(1.1); }
  100% { opacity: 0; transform: scale(1.3); }
}

/* ---- 光轨阶段色调 ---- */
.ring-phase-early {
  border-top-color: rgba(59, 130, 246, 0.6) !important;
  border-right-color: rgba(96, 165, 250, 0.35) !important;
  border-bottom-color: rgba(147, 197, 253, 0.15) !important;
  border-left-color: rgba(59, 130, 246, 0.4) !important;
}
.ring-phase-mid {
  border-top-color: rgba(139, 92, 246, 0.6) !important;
  border-right-color: rgba(167, 139, 250, 0.35) !important;
  border-bottom-color: rgba(196, 181, 253, 0.15) !important;
  border-left-color: rgba(139, 92, 246, 0.4) !important;
}
.ring-phase-late {
  border-top-color: rgba(6, 182, 212, 0.65) !important;
  border-right-color: rgba(45, 212, 191, 0.35) !important;
  border-bottom-color: rgba(94, 234, 212, 0.15) !important;
  border-left-color: rgba(6, 182, 212, 0.4) !important;
}

/* ---- 光轨动画（支持动态速度） ---- */
.ball-processing .ball-ring,
.ball-ball .ball-ring {
  animation: ring-spin var(--ring-speed, 1.2s) linear infinite, ring-pulse 1.6s ease-in-out infinite, ring-shimmer 2.4s ease-in-out infinite;
}

/* ---- 代号（窗体左上角 fixed） ---- */
.ball-codename {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 9999;
  padding: 4px 12px 3px 10px;
  border-radius: 0 0 10px 0;
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.4px;
  white-space: nowrap;
  box-shadow: 0 1px 6px rgba(0,0,0,0.3);
  user-select: none;
  pointer-events: none;
}

/* ---- 计数字号 ---- */
.ball-count {
  font-size: 28px;
  font-weight: 700;
  color: #ffffff;
  line-height: 1;
  position: relative;
  z-index: 3;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.55), 0 0 14px rgba(255, 255, 255, 0.18);
}

/* ---- 状态标签 ---- */
.ball-label {
  font-size: 9px;
  font-weight: 500;
  position: relative;
  z-index: 3;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}
.label-idle          { color: rgba(255, 255, 255, 0.25); }
.label-processing    { color: rgba(56, 189, 248, 0.7); }
.label-error         { color: rgba(251, 113, 133, 0.7); }
.label-connecting    { color: rgba(245, 158, 11, 0.6); }
.label-disconnected  { color: rgba(148, 163, 184, 0.4); }

/* ---- 步骤圆点行 ---- */
.ball-step-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 1px;
}
.ball-step-counter {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.5px;
}
.ball-step-dots {
  display: flex;
  gap: 3px;
  align-items: center;
  justify-content: center;
  margin-bottom: 2px;
}
.ball-step-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  transition: all 0.3s ease;
}
.ball-step-dot.sdot-done {
  background: rgba(110, 231, 183, 0.8);
  box-shadow: 0 0 4px rgba(110, 231, 183, 0.4);
}
.ball-step-dot.sdot-active {
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.5);
  animation: sdot-pulse 0.8s ease-in-out infinite;
}
.ball-step-dot.sdot-failed {
  background: rgba(251, 113, 133, 0.8);
  box-shadow: 0 0 4px rgba(251, 113, 133, 0.4);
}

@keyframes sdot-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(1.4); opacity: 0.6; }
}
</style>
