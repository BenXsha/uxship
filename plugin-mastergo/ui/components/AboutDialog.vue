<template>
  <div class="about-overlay" @click.self="$emit('close')">
    <div class="about-dialog" role="dialog" aria-modal="true" aria-label="关于 uxship">
      <!-- 署名头部：与 plugin-penpot 的 AboutDialog 结构一致（uxship + 版本号 + ×） -->
      <div class="about-head">
        <span class="about-name">uxship</span>
        <span class="about-version">v{{ pluginVersion }}</span>
        <button class="btn-close" aria-label="关闭" @click="$emit('close')">×</button>
      </div>
      <p class="about-meta">
        <span>Apache-2.0</span>
      </p>

      <div class="about-body">
        <section class="about-section">
          <h3 class="about-section-title">宿主</h3>
          <div class="about-item">
            <span class="about-label">宿主</span>
            <span class="about-value">MasterGo</span>
          </div>
          <div class="about-item">
            <span class="about-label">服务端</span>
            <span class="about-value mono">{{ serverUrl || '—' }}</span>
          </div>
          <div class="about-item">
            <span class="about-label">连接</span>
            <span class="about-value" :class="connected ? 'is-ok' : 'is-off'">
              {{ connected ? '已连接' : '未连接' }}
            </span>
          </div>
        </section>

        <section class="about-section">
          <h3 class="about-section-title">能力</h3>
          <ul class="about-list">
            <li>代码转设计：HTML+Tailwind 真实渲染后写入画布，自动处理 <code>data-icon</code> 图标与 <code>&lt;chart&gt;</code> 图表</li>
            <li>设计转代码：画布节点导出为 DSL + SVG 资产</li>
            <li>组件：33 种标准组件、交互状态矩阵、团队库检索导入、换组件</li>
            <li>画布：批量节点操作、自然语言修改、设计自检、渲染后自动聚焦</li>
            <li>多会话：同时对接多个文档，按代号切换</li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
/** 版本号由 vite define 从 package.json 注入（单一来源，与 plugin-penpot 同口径） */
const pluginVersion = __PLUGIN_VERSION__

defineProps<{
  /** 当前 MCP 服务端地址 */
  serverUrl?: string
  /** 是否已连上服务端 */
  connected?: boolean
}>()

defineEmits<{
  close: []
}>()
</script>

<style scoped>
.about-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.about-dialog {
  background: #2d2d2d;
  border-radius: 8px;
  padding: 16px;
  max-width: 400px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
}

/* ====== 署名头部（与 penpot 侧同结构）====== */
.about-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.about-name {
  font-size: 16px;
  font-weight: 600;
  color: #e0e0e0;
}
.about-version {
  font-size: 11px;
  color: #757575;
}
.btn-close {
  margin-left: auto;
  align-self: center;
  background: transparent;
  border: none;
  color: #9e9e9e;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s;
}
.btn-close:hover {
  color: #e0e0e0;
}
.about-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 12px;
  font-size: 11px;
  color: #757575;
}

/* ====== 正文 ====== */
.about-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.about-section {
  background: #1e1e1e;
  border-radius: 6px;
  padding: 12px;
}
.about-section-title {
  font-size: 12px;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 8px;
}
.about-item {
  display: flex;
  gap: 8px;
  font-size: 11px;
  padding: 3px 0;
}
.about-label {
  color: #757575;
  flex-shrink: 0;
  min-width: 48px;
}
.about-value {
  color: #e0e0e0;
  word-break: break-all;
}
.about-value.is-ok {
  color: #a5d6a7;
}
.about-value.is-off {
  color: #9e9e9e;
}
.about-list {
  list-style: none;
  padding-left: 0;
}
.about-list li {
  color: #9e9e9e;
  font-size: 11px;
  line-height: 1.6;
  padding: 3px 0 3px 12px;
  position: relative;
}
.about-list li::before {
  content: '•';
  position: absolute;
  left: 0;
  color: #616161;
}
.about-list code {
  background: #2d2d2d;
  border-radius: 3px;
  padding: 0 3px;
  color: #a5d6a7;
  font-size: 10px;
}
.mono {
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
</style>
