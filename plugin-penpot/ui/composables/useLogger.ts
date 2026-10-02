import { ref, nextTick } from 'vue'

export interface LogEntry {
  type: string
  time: string
  message: string
  hasJson?: boolean
  jsonData?: any
  jsonExpanded?: boolean
}

export function useLogger() {
  const logs = ref<LogEntry[]>([])

  function addLog(type: string, message: string, jsonData?: any) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    logs.value.push({
      type,
      time,
      message,
      hasJson: !!jsonData,
      jsonData,
      jsonExpanded: false,
    })

    // 滚动到底部
    nextTick(() => {
      const logListRef = document.querySelector('.log-list')
      if (logListRef) {
        logListRef.scrollTop = logListRef.scrollHeight
      }
    })
  }

  function clearLogs() {
    logs.value = []
  }

  function toggleJsonExpand(index: number) {
    if (logs.value[index]) {
      logs.value[index].jsonExpanded = !logs.value[index].jsonExpanded
    }
  }

  return {
    logs,
    addLog,
    clearLogs,
    toggleJsonExpand,
  }
}
