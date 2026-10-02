<template>
  <!--
    关于 / 设置弹层（对齐 plugin-mastergo 的信息架构）：
    默认视图只留「状态 + 连接 / 选中 / 任务 / 日志」，版本、宿主与文档、能力清单、
    自测与 HTML→画布等低频内容统一收进这里 —— 这是让面板“简洁”的关键。
  -->
  <div class="about-mask" @click.self="$emit('close')">
    <div class="about" role="dialog" aria-modal="true" aria-label="关于与调试">
      <div class="about__head">
        <span class="about__title">关于 / 调试</span>
        <button class="btn btn--ghost" @click="$emit('close')">关闭</button>
      </div>
      <div class="about__body">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineEmits<{ close: [] }>()
</script>

<style scoped>
.about-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: var(--space-3);
  background: rgba(0, 0, 0, 0.5);
}

.about {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 100%;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.about__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--border);
}

.about__title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text);
}

.about__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  overflow-y: auto;
}
</style>
