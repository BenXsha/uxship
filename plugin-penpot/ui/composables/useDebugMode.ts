/**
 * 调试模式开关
 *
 * 面板里有一批**开发期才有用**的区块：本地自测、HTML→画布、宿主能力清单、
 * 以及"宿主夹了窗口尺寸"这类说明条。它们在真机排查时很关键，但日常使用只会让面板变吵。
 *
 * 所以做法是**默认隐藏、按需打开**（而不是删掉）：
 *   - 默认：只剩 状态球 / 连接 / 选中 / 任务步骤 / 宿主与文档 / 日志；
 *   - 打开：点顶栏右侧的 **「调试」开关**（显式按钮；此前是“点版本号”的隐藏入口，不好发现）。
 *
 * 状态持久化在 localStorage（关掉面板再开仍然记得），并且**注入式**：
 * 存储与 URL 都从外面传进来，于是可以直接单测、也可以在非浏览器环境降级。
 *
 * 另外一条纪律：**隐藏 ≠ 静默**。调试面板里的信息如果代表"出问题了"（例如宿主把窗口
 * 尺寸夹掉了），仍然要往日志里写一条 —— 面板可以干净，问题不能消失。
 */
import { ref, type Ref } from 'vue'

export interface DebugModeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface UseDebugModeOptions {
  storage?: DebugModeStorage | null
  search?: string
  storageKey?: string
}

export function useDebugMode(options: UseDebugModeOptions = {}) {
  const storageKey = options.storageKey ?? 'mgmcp:debug'
  const storage = options.storage ?? (typeof localStorage === 'object' ? localStorage : null)
  const search = options.search ?? (typeof location === 'object' ? location.search : '')

  /**
   * 初始值的三级优先级（语义要明确，否则"谁赢"会变成猜）：
   *   1. 存储里明确记过 → **完全听存储的**（用户手动关过就不该被 URL 顶开）；
   *   2. 没记过 → `?debug=1` 可以开（浏览器里直接打开 UI 调试时方便）；
   *   3. 都没有 → 关（默认干净）。
   */
  const readInitial = (): boolean => {
    try {
      const remembered = storage?.getItem(storageKey)
      if (remembered === '1') return true
      if (remembered === '0') return false
    } catch {
      /* 隐私模式等场景读不到 —— 退回查询串/默认 */
    }
    return /(?:^|[?&])debug=1(?:&|$)/.test(search)
  }

  const isDebug = ref(readInitial()) as Ref<boolean>

  function setDebug(value: boolean): void {
    isDebug.value = value
    try {
      storage?.setItem(storageKey, value ? '1' : '0')
    } catch {
      /* 写不进去不影响本次会话 */
    }
  }

  function toggleDebug(): void {
    setDebug(!isDebug.value)
  }

  return { isDebug, setDebug, toggleDebug }
}
