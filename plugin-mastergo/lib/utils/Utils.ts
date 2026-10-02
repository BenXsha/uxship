/**
 * 常量定义
 */

/**
 * WebSocket 连接状态
 */
export const WS_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
} as const

/**
 * JSON-RPC 错误码
 */
export const JSONRPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
} as const

export const MCP_SERVER_URL = 'ws://localhost:15489'

/**
 * 连接配置常量
 */
export const CONNECTION_CONFIG = {
  DEFAULT_HEARTBEAT_INTERVAL: 30000,
  DEFAULT_RECONNECT_DELAY: 1000,
  MAX_RECONNECT_DELAY: 60000,
  MAX_MISSED_HEARTBEATS: 2,
  MAX_RECONNECT_ATTEMPTS: 10,
  MESSAGE_QUEUE_MAX_SIZE: 100
} as const

/**
 * 性能优化常量
 */
export const PERFORMANCE_CONFIG = {
  LOG_MAX_LENGTH: 200,
  LOG_TRUNCATE_SUFFIX: '...',
  REQUEST_TIMEOUT: 30000,
  DEBOUNCE_DELAY: 300
} as const

/**
 * 内存管理常量
 */
export const MEMORY_CONFIG = {
  MAX_LOG_HISTORY: 100,
  MAX_MESSAGE_HISTORY: 50,
  GC_INTERVAL: 60000
} as const

/**
 * 工具函数
 */

/**
 * 防抖函数
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: number | null = null

  return function(this: any, ...args: Parameters<T>) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }

    timeoutId = setTimeout(() => {
      func.apply(this, args)
      timeoutId = null
    }, delay) as unknown as number
  }
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastCallTime = 0
  let timeoutId: number | null = null

  return function(this: any, ...args: Parameters<T>) {
    const now = Date.now()
    const timeSinceLastCall = now - lastCallTime

    if (timeSinceLastCall >= delay) {
      func.apply(this, args)
      lastCallTime = now
    } else {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }

      timeoutId = setTimeout(() => {
        func.apply(this, args)
        lastCallTime = Date.now()
        timeoutId = null
      }, delay - timeSinceLastCall) as unknown as number
    }
  }
}

/**
 * 安全的 JSON 解析
 */
export function safeJsonParse<T = any>(json: string, fallback: T): T {
  try {
    return JSON.parse(json)
  } catch {
    return fallback
  }
}

/**
 * 格式化错误消息
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 深度克隆对象
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as any
  }

  if (obj instanceof Array) {
    return obj.map(item => deepClone(item)) as any
  }

  const clonedObj = {} as T
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      clonedObj[key] = deepClone(obj[key])
    }
  }

  return clonedObj
}

/**
 * 检查对象是否为空
 */
export function isEmpty(obj: any): boolean {
  if (obj === null || obj === undefined) {
    return true
  }

  if (Array.isArray(obj)) {
    return obj.length === 0
  }

  if (typeof obj === 'object') {
    return Object.keys(obj).length === 0
  }

  return false
}

/**
 * 安全的定时器清理
 */
export function safeClearTimeout(timerId: number | null): void {
  if (timerId !== null) {
    clearTimeout(timerId)
  }
}

/**
 * 安全的间隔清理
 */
export function safeClearInterval(intervalId: number | null): void {
  if (intervalId !== null) {
    clearInterval(intervalId)
  }
}
