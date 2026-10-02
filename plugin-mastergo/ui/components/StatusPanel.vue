<template>
  <div class="status-panel">
    <div class="status-row">
      <div class="codename-area" @click="startEdit" title="点击修改插件代号">
        <span v-if="!editing" class="codename-badge">{{ codename || '?' }}</span>
        <input
          v-else
          ref="editInput"
          v-model="editValue"
          class="codename-input"
          @blur="finishEdit"
          @keydown.enter="finishEdit"
          @keydown.escape="cancelEdit"
        />
      </div>
      <span class="status-badge" :class="statusClass">{{ statusText }}</span>
      <input
        :value="serverUrl"
        type="text"
        class="server-url-input"
        placeholder="ws://localhost:8080"
        :disabled="isConnecting"
        @input="$emit('update:serverUrl', ($event.target as HTMLInputElement).value)"
      />
      <button
        class="btn btn-sm"
        :class="isConnected ? 'btn-danger' : 'btn-primary'"
        :disabled="isConnecting"
        @click="$emit('toggleConnection')"
      >
        {{ connectionButtonText }}
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, nextTick } from 'vue'
import { sendMsgToPlugin, UIMessage } from '@messages/sender'

const props = defineProps<{
  statusClass: string
  statusText: string
  serverUrl: string
  isConnecting: boolean
  isConnected: boolean
  connectionButtonText: string
  codename: string
}>()

defineEmits<{
  'update:serverUrl': [value: string]
  toggleConnection: []
}>()

const editing = ref(false)
const editValue = ref('')
const editInput = ref<HTMLInputElement | null>(null)

function startEdit() {
  editValue.value = props.codename || ''
  editing.value = true
  nextTick(() => editInput.value?.focus())
}

function finishEdit() {
  editing.value = false
  const val = editValue.value.trim()
  if (val && val !== props.codename) {
    sendMsgToPlugin({ type: UIMessage.SET_CODENAME, data: { codename: val } })
  }
}

function cancelEdit() {
  editing.value = false
}
</script>

<style scoped>
.status-panel {
  background: #2d2d2d;
  border-radius: 6px;
  padding: 6px 8px;
}
.status-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.status-label {
  font-weight: 600;
  font-size: 11px;
  color: #e0e0e0;
  flex-shrink: 0;
}
.status-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 500;
  flex-shrink: 0;
}
.status-connected {
  background: #2e7d32;
  color: #a5d6a7;
}
.status-disconnected {
  background: #424242;
  color: #9e9e9e;
}
.status-connecting {
  background: #f57c00;
  color: #ffe0b2;
}
.server-url-input {
  flex: 1;
  background: #1e1e1e;
  border: 1px solid #424242;
  border-radius: 4px;
  padding: 4px 8px;
  color: #e0e0e0;
  font-size: 11px;
  outline: none;
  min-width: 0;
}
.server-url-input:focus {
  border-color: #1976d2;
}
.server-url-input:disabled {
  opacity: 0.5;
}
.btn {
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-sm {
  padding: 3px 8px;
  font-size: 9px;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-primary {
  background: #1976d2;
  color: white;
}

/* ---- 代号区域 ---- */
.codename-area {
  flex-shrink: 0;
  cursor: pointer;
}
.codename-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  background: linear-gradient(135deg, #7c3aed, #2563eb);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.3px;
  white-space: nowrap;
  transition: opacity 0.15s;
}
.codename-badge:hover {
  opacity: 0.8;
}
.codename-input {
  width: 80px;
  background: #1e1e1e;
  border: 1px solid #7c3aed;
  border-radius: 4px;
  padding: 2px 6px;
  color: #fff;
  font-size: 11px;
  outline: none;
}
.btn-primary:hover:not(:disabled) {
  background: #1565c0;
}
.btn-danger {
  background: #d32f2f;
  color: white;
}
.btn-danger:hover:not(:disabled) {
  background: #c62828;
}
</style>
