<template>
  <div class="selection-panel">
    <div class="selection-header">
      <span>选中</span>
      <div class="selection-actions">
        <span v-if="elements.count > 0" class="selection-count">{{ elements.count }}</span>
      </div>
    </div>
    <div class="selection-content">
      <div v-if="elements.count === 0" class="selection-empty">未选中</div>
      <div v-else class="selection-list">
        <div
          v-for="item in elements.details"
          :key="item.id"
          class="selection-item"
        >
          <span class="selection-item-type">{{ item.type }}</span>
          <span class="selection-item-id">{{ item.id }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 选中对象卡片（**只展示**，与 plugin-penpot 的 `SelectionPanel` 同一定位）
 *
 * ⚠️ 这里曾经有一个「DSL」按钮（`emit('sendDsl')` → `dsl/exportSelection` 请求 →
 * `context/update` 通知），**已移除**：整条链是死的，真机上只会日志停在“正在导出…”。
 * 核实依据（两半都是死的）：
 *   1. 服务端 WS 入站只处理 `initialize` / `codename/update` / 响应，其余一律
 *      “其他通知（忽略）”（`mcp-server/src/server/ws-bridge.ts#handleMessage` 第 5 步）
 *      —— 所以 `dsl/exportSelection` **永远不会有响应**；
 *   2. 就算有响应，随后的 `context/update` 通知也会被同一条兵底丢掉。
 * 想给 AI 喂画布内容，用 MCP 工具主动拉：`design_describe` / `design_to_code` / `dsl_export_selection`。
 */
defineProps<{
  elements: {
    count: number
    details: Array<{ id: string; type: string }>
  }
}>()
</script>

<style scoped>
.selection-panel {
  background: #2d2d2d;
  border-radius: 6px;
  padding: 10px 12px;
  height: 160px;
  display: flex;
  flex-direction: column;
}
.selection-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 600;
  font-size: 13px;
  color: #e0e0e0;
}
.selection-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.selection-count {
  background: #1976d2;
  color: white;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 500;
  min-width: 20px;
  text-align: center;
}
.selection-content {
  flex: 1;
  overflow-y: auto;
  background: #1e1e1e;
  border-radius: 4px;
  padding: 8px;
}
.selection-empty {
  color: #9e9e9e;
  text-align: center;
  padding: 20px;
  font-size: 11px;
}
.selection-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.selection-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: #2d2d2d;
  border-radius: 4px;
  font-size: 11px;
}
.selection-item-type {
  color: #4fc3f7;
  font-weight: 500;
  flex-shrink: 0;
}
.selection-item-id {
  color: #9e9e9e;
  flex-shrink: 0;
}
</style>
