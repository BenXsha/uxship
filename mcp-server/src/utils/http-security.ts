/**
 * HTTP 边界安全：CORS 与可选 token 鉴权
 *
 * 背景：服务端此前对所有响应写 `Access-Control-Allow-Origin: *`，且监听 `0.0.0.0`、
 * 无任何鉴权 —— 任意网页（浏览器可从 localhost 发跨源请求）或同局域网主机都能
 * 驱动本机插件建/删节点。
 *
 * 现在的策略：
 * 1. **默认只监听 127.0.0.1**（见 index.ts 的 `--host` / `HOST`），跨机访问需显式配置
 * 2. **默认不发 CORS 头**；只有显式配置 `UXSHIP_MCP_CORS_ORIGIN` 才回显该源
 * 3. **可选 token**（`UXSHIP_MCP_TOKEN`）：配置后 `/sse`、`/messages`、`/mcp` 需带
 *    `Authorization: Bearer <token>` 或 `?token=<token>`；`/health` 始终公开（供守护脚本探活）
 */
import { timingSafeEqual } from 'crypto'

/** 返回应写入的 Access-Control-Allow-Origin，null 表示不发 CORS 头 */
export function resolveCorsOrigin(configured: string | undefined, requestOrigin: string | undefined): string | null {
  const allowed = (configured || '').trim()
  if (!allowed) return null
  if (allowed === '*') return '*' // 显式要求才放开（不推荐，仅兼容旧行为）
  return requestOrigin && requestOrigin === allowed ? allowed : null
}

/** 从请求头或 query 中取出 token */
export function extractToken(headers: Record<string, any>, url: string): string | null {
  const auth = String(headers?.['authorization'] || '').trim()
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)
  if (bearer) return bearer[1].trim()
  const query = /[?&]token=([^&]+)/.exec(url || '')
  return query ? decodeURIComponent(query[1]) : null
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** 是否通过鉴权；未配置 token 视为未启用鉴权（返回 true） */
export function isAuthorized(
  headers: Record<string, any>,
  url: string,
  expectedToken: string | undefined,
): boolean {
  const expected = (expectedToken || '').trim()
  if (!expected) return true
  const provided = extractToken(headers, url)
  if (!provided) return false
  return constantTimeEqual(provided, expected)
}

/** 该路径是否需要鉴权（/health 永远公开，供守护脚本/监控探活） */
export function requiresAuth(pathname: string): boolean {
  return pathname !== '/health'
}
