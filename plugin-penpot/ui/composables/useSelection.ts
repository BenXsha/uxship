/**
 * 当前选区（面板展示用）
 *
 * 数据来自沙箱：`penpot.on('selectionchange' | 'pagechange')` → 沙箱读一次
 * `{id, type, name}` 推给 UI（见 `lib/main.ts#sendSelection`）。
 *
 * 这里只保存"人能看的那点信息"，不做属性同步 —— 需要完整数据是 AI 调
 * `dsl_export_selection` 的事。这样做的代价是面板上的名称可能不等于宿主里的最新值
 * （改了图层名但没动选区时不会刷新），换来的是不订阅 `shapechange` 的持续开销。
 * 这是**明确的取舍**，不是遗漏：真要实时，再挂 `shapechange` 即可。
 *
 * 纯状态归约，可单测（tests/use-selection.test.ts）。
 */
import { computed, ref } from 'vue'

export interface SelectionItem {
  id: string
  type: string
  name: string
}

export interface SelectionPayload {
  count?: number
  details?: SelectionItem[]
  /** 沙箱只回传前 N 个时的剩余数量 */
  truncated?: number
  /** 沙箱读取选区失败时的原因 */
  error?: string
}

export function useSelection() {
  const count = ref(0)
  const details = ref<SelectionItem[]>([])
  const truncated = ref(0)
  const error = ref('')

  const hasSelection = computed(() => count.value > 0)
  const isEmpty = computed(() => count.value === 0 && !error.value)

  /** 一行摘要：`3 个对象` / `未选中` */
  const summaryText = computed(() => (count.value > 0 ? `${count.value} 个对象` : '未选中'))

  function updateSelection(payload: SelectionPayload = {}): void {
    // 沙箱读失败时**保留上一次的列表**：面板显示"读取失败"比显示空更像真实情况
    if (payload.error) {
      error.value = payload.error
      return
    }
    error.value = ''
    count.value = Math.max(0, Number(payload.count ?? 0))
    details.value = Array.isArray(payload.details) ? payload.details : []
    truncated.value = Math.max(0, Number(payload.truncated ?? 0))
    if (count.value === 0) {
      details.value = []
      truncated.value = 0
    }
  }

  function clearSelection(): void {
    updateSelection({ count: 0, details: [] })
  }

  return { count, details, truncated, error, hasSelection, isEmpty, summaryText, updateSelection, clearSelection }
}
