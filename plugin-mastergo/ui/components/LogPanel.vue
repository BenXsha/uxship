<template>
  <div class="log-panel">
    <div class="log-header">
      <span>操作日志</span>
      <button class="btn-clear" @click="$emit('clear')">清空</button>
    </div>
    <div class="log-list" ref="listRef">
      <div v-if="logs.length === 0" class="log-empty">暂无日志</div>
      <div
        v-for="(log, index) in logs"
        :key="index"
        class="log-item"
        :class="log.type"
      >
        <span class="log-time">{{ log.time }}</span>
        <span class="log-message">
          <span v-if="!log.hasJson">{{ log.message }}</span>
          <span v-else class="log-json-container">
            <span class="log-json-summary">{{ log.message }}</span>
            <button
              v-if="log.jsonData"
              class="btn-toggle-json"
              @click="$emit('toggleJson', index)"
            >
              {{ log.jsonExpanded ? '收起' : '展开' }}
            </button>
            <div v-if="log.jsonExpanded" class="log-json-detail">
              {{ JSON.stringify(log.jsonData, null, 2) }}
            </div>
          </span>
        </span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue'

defineProps<{
  logs: Array<{
    type: string
    time: string
    message: string
    hasJson?: boolean
    jsonData?: any
    jsonExpanded?: boolean
  }>
}>()

defineEmits<{
  clear: []
  toggleJson: [index: number]
}>()

const listRef = ref<HTMLElement | null>(null)

defineExpose({ listRef })
</script>

<style scoped>
.log-panel {
  background: #2d2d2d;
  border-radius: 6px;
  padding: 10px 12px;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 600;
  font-size: 13px;
  color: #e0e0e0;
}
.btn-clear {
  background: transparent;
  border: 1px solid #424242;
  border-radius: 4px;
  padding: 2px 8px;
  color: #9e9e9e;
  font-size: 10px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-clear:hover {
  border-color: #616161;
  color: #e0e0e0;
}
.log-list {
  flex: 1;
  overflow-y: auto;
  background: #1e1e1e;
  border-radius: 4px;
  padding: 8px;
  font-family: 'Courier New', monospace;
  font-size: 10px;
}
.log-empty {
  color: #9e9e9e;
  text-align: center;
  padding: 20px;
}
.log-item {
  padding: 4px 0;
  border-bottom: 1px solid #2d2d2d;
  display: flex;
  gap: 6px;
  align-items: flex-start;
}
.log-item:last-child {
  border-bottom: none;
}
.log-time {
  color: #757575;
  flex-shrink: 0;
  font-size: 9px;
  padding-top: 2px;
}
.log-message {
  color: #e0e0e0;
  word-break: break-word;
  flex: 1;
}
.log-item.success .log-message { color: #81c784; }
.log-item.error .log-message { color: #e57373; }
.log-item.warn .log-message { color: #ffb74d; }
.log-item.info .log-message { color: #64b5f6; }
.log-json-container {
  display: inline;
}
.log-json-summary {
  color: #9e9e9e;
  font-style: italic;
}
.btn-toggle-json {
  background: transparent;
  border: 1px solid #424242;
  border-radius: 3px;
  padding: 1px 6px;
  color: #9e9e9e;
  font-size: 9px;
  cursor: pointer;
  margin-left: 6px;
  transition: all 0.2s;
}
.btn-toggle-json:hover {
  border-color: #616161;
  color: #e0e0e0;
}
.log-json-detail {
  margin-top: 6px;
  padding: 6px;
  background: #2d2d2d;
  border-radius: 4px;
  color: #a5d6a7;
  white-space: pre-wrap;
  font-size: 9px;
  line-height: 1.4;
}
</style>
