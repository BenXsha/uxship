<template>
  <div class="about-overlay" @click.self="$emit('close')">
    <div class="about-dialog">
      <div class="about-header">
        <h2 class="about-title">uxship for MasterGo</h2>
        <button class="btn-close" @click="$emit('close')">×</button>
      </div>
      <div class="about-content">
        <div class="about-section">
          <h3 class="about-section-title">功能说明</h3>
          <p class="about-desc">本插件用于对接专属 MCP Server，实现 AI 大模型与 MasterGo 设计工具之间的双向通信与操作。</p>
          <ul class="about-list">
            <li>代码转设计：HTML+Tailwind 经客户端真实渲染后写入画布，支持 <code>data-icon</code> 图标与 <code>&lt;chart&gt;</code> 图表自动处理</li>
            <li>设计转代码：将画布节点导出为 DSL + SVG 资产，可直接生成 HTML</li>
            <li>高阶组件：一键生成 33 种标准 UI 组件（按钮/表单/弹窗/表格/骨架屏等）</li>
            <li>组件状态矩阵：批量生成 default/hover/active/disabled/focused 多态组件</li>
            <li>团队组件库：检索并导入团队库组件与样式令牌，支持组件集变体选择</li>
            <li>换组件：实例替换主组件；普通对象（画板/矩形/文本等）可原位替换为组件实例，保持父容器与图层顺序、按图层名带过文字</li>
            <li>画布聚焦：设计渲染完成后自动滚动 + 缩放到成果并选中；也可按节点/矩形区域/选区手动聚焦</li>
            <li>设计系统：注册颜色/文本/效果/间距样式，并提供样式查询与应用</li>
            <li>图标能力：Iconify 20 万+ 图标搜索、导入与矢量渲染</li>
            <li>设计与分析：节点批量操作、结构化摘要、自然语言修改、设计自检</li>
            <li>多会话：同时对接多个 MasterGo 文档，按代号切换目标文档</li>
          </ul>
        </div>
        <div class="about-section">
          <h3 class="about-section-title">项目</h3>
          <div class="author-info">
            <div class="author-item">
              <span class="author-label">仓库：</span>
              <span class="author-value">
                <a href="https://github.com/BenXsha/uxship" target="_blank" class="link-text">github.com/BenXsha/uxship</a>
              </span>
            </div>
            <div class="author-item">
              <span class="author-label">许可：</span>
              <span class="author-value">Apache-2.0</span>
            </div>
            <div class="author-item">
              <span class="author-label">本地端口：</span>
              <span class="author-value">15489</span>
            </div>
            <div class="author-item">
              <span class="author-label">插件版本：</span>
              <span class="author-value">v{{ pluginVersion }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
/** 版本号由 vite define 从 package.json 注入（单一来源） */
const pluginVersion = __PLUGIN_VERSION__

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
  padding: 20px;
  max-width: 400px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
}
.about-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.about-title {
  font-size: 16px;
  font-weight: 600;
  color: #e0e0e0;
}
.btn-close {
  background: transparent;
  border: none;
  color: #9e9e9e;
  font-size: 20px;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.btn-close:hover {
  color: #e0e0e0;
}
.about-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.about-section {
  background: #1e1e1e;
  border-radius: 6px;
  padding: 12px;
}
.about-section-title {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 8px;
}
.about-list {
  list-style: none;
  padding-left: 0;
}
.about-list li {
  color: #9e9e9e;
  font-size: 11px;
  padding: 4px 0;
  padding-left: 12px;
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
.link-text {
  color: #64b5f6;
  text-decoration: none;
  font-size: 11px;
}
.link-text:hover {
  text-decoration: underline;
}
.author-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.author-item {
  display: flex;
  gap: 6px;
  font-size: 11px;
}
.author-label {
  color: #757575;
  flex-shrink: 0;
}
.author-value {
  color: #e0e0e0;
}
</style>
