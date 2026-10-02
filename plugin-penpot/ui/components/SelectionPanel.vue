<template>
  <div class="panel">
    <div class="panel__head">
      <h2 class="panel__title">选中</h2>
      <span v-if="error" class="badge badge--error">读取失败</span>
      <span v-else class="badge" :class="hasSelection ? 'badge--ok' : undefined">{{ summaryText }}</span>
    </div>

    <p v-if="error" class="hint">{{ error }}</p>

    <div v-else-if="!hasSelection" class="empty">在画布上选择对象后，这里会显示它们的图层类型与名称</div>

    <ul v-else class="sel-list">
      <li v-for="(item, index) in details" :key="item.id" class="sel-row" :style="{ '--row-index': index }">
        <span class="sel-row__type">{{ item.type || '—' }}</span>
        <span class="sel-row__name">{{ item.name || item.id }}</span>
      </li>
      <li v-if="truncated" class="sel-row sel-row--more">…还有 {{ truncated }} 个未列出</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * 选中对象卡片（与 plugin-mastergo 的 `SelectionPanel` 同一定位：**只展示**）
 *
 * ⚠️ MG 侧原来有个「DSL」按钮（把选中对象的 DSL 推给服务端当上下文），**已在本仓库两侧一起移除**
 * —— 整条链都是死的（核实于 `mcp-server/src/server/ws-bridge.ts#handleMessage`）：
 *   1. 按钮发的是 `dsl/exportSelection` **请求**，而服务端 WS 入站只处理
 *      `initialize` / `codename/update` / 响应，其余一律“其他通知（忽略）” → **永远等不到响应**；
 *   2. 就算等得到，随后的 `context/update` 通知也会被同一条兜底丢掉。
 * 想给 AI 喂画布内容，用 MCP 工具主动拉：`design_describe` / `design_to_code` / `dsl_export_selection`。
 */
import { computed } from 'vue'
import type { SelectionItem } from '../composables/useSelection'

const props = defineProps<{
  count: number
  details: SelectionItem[]
  truncated: number
  error: string
}>()

const hasSelection = computed(() => props.count > 0)
const summaryText = computed(() => (props.count > 0 ? `${props.count} 个对象` : '未选中'))
</script>
