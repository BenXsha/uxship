/**
 * 安全的 JSON.parse 包装
 * 替代直接调用 JSON.parse，防止无效 JSON 导致服务崩溃
 */
export function safeJsonParse<T = any>(text: string | undefined | null, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

/**
 * 解析成**普通对象**，否则返回 null。
 *
 * 动机：`JSON.parse('null')` / `'[]'` / `'1'` 都是合法 JSON，但拿到后直接读
 * `msg.method` 会抛 TypeError。WS 消息处理器里这个异常发生在 `socket.on('message')`
 * 回调中，属于未捕获异常，会直接杀死服务进程。
 */
export function safeParseObject<T = Record<string, unknown>>(text: string | undefined | null): T | null {
  if (!text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return parsed as T
}
