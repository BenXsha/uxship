<template>
  <!--
    关于弹层。署名头部（uxship + 版本号 + ×）与 plugin-mastergo 的 AboutDialog 结构一致；
    正文由调用方通过默认插槽注入（宿主/文档、调试面板等低频内容）。
  -->
  <div class="about-mask" @click.self="$emit('close')">
    <div class="about" role="dialog" aria-modal="true" aria-label="关于 uxship">
      <div class="about-head">
        <span class="about-name">uxship</span>
        <span class="about-version">v{{ pluginVersion }}</span>
        <button class="btn-close" aria-label="关闭" @click="$emit('close')">×</button>
      </div>
      <p class="about-meta">
        <span>Apache-2.0</span>
        <span class="about-sep">·</span>
        <a class="link-text" href="https://github.com/BenXsha/uxship" target="_blank" rel="noopener">
          github.com/BenXsha/uxship
        </a>
      </p>

      <div class="about-body">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/** 版本号由 vite define 从 package.json 注入（单一来源，与 plugin-mastergo 同口径） */
const pluginVersion = __PLUGIN_VERSION__

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

/* ====== 署名头部（与 mastergo 侧同结构）====== */
.about-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-3);
}
.about-name {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text);
}
.about-version {
  font-size: var(--text-xs);
  color: var(--muted);
}
.btn-close {
  margin-left: auto;
  align-self: center;
  padding: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: color 0.15s;
}
.btn-close:hover {
  color: var(--text);
}
.about-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 var(--space-3) var(--space-3);
  font-size: var(--text-xs);
  color: var(--muted);
}
.about-sep {
  color: var(--border);
}
.link-text {
  color: var(--accent);
  text-decoration: none;
}
.link-text:hover {
  text-decoration: underline;
}

/* ====== 正文 ====== */
.about-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border-top: 1px solid var(--border);
  overflow-y: auto;
}
</style>
