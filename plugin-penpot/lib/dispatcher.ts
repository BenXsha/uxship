/**
 * JSON-RPC 2.0 请求调度器
 *
 * 移植自 `plugin-mastergo/lib/dispatcher.ts`。移植时只改了一处：`HandlerContext` 里的
 * `document: mg.document` 换成 `host: HostAdapter` —— 这正是宿主端口带来的替换点，
 * 之后的缓存策略、请求校验、错误映射逻辑逐字保留。
 */
import type { JSONRPCErrorResponse, JSONRPCRequest, JSONRPCSuccessResponse, Request } from './mcp/types'
import { handlers, type HandlerContext, type NotifyKind } from './api/index'
import { logger } from './utils/Logger'
import { JSONRPC_ERROR_CODES, formatError } from './utils/Utils'
import { isCacheableMethod } from './cache-policy'
import { getHost } from './host/index'

export class RequestDispatcher {
  private context: HandlerContext
  private destroyed = false
  private requestCache = new Map<string, { result: unknown; timestamp: number }>()
  private readonly CACHE_TTL = 5000
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.context = this.createContext()
    this.startCacheCleanup()
  }

  private createContext(): HandlerContext {
    return {
      // 宿主端口是唯一的宿主访问路径（这里不再出现任何 penpot.* 直接调用）
      host: getHost(),
      notify: (message: string, kind: NotifyKind = 'info') => {
        try {
          getHost().notify(message, kind)
        } catch (error) {
          logger.error('[RequestDispatcher] notify failed', error)
        }
      },
    }
  }

  async dispatch(request: Request | JSONRPCRequest): Promise<JSONRPCSuccessResponse | JSONRPCErrorResponse> {
    if (this.destroyed) {
      return this.errorResponse(request?.id ?? 0, JSONRPC_ERROR_CODES.INTERNAL_ERROR, 'Dispatcher is destroyed')
    }

    const { method, params, id } = request

    if (!this.validateRequest(request)) {
      return this.errorResponse(id ?? 0, JSONRPC_ERROR_CODES.INVALID_REQUEST, 'Invalid Request format')
    }

    // 缓存：白名单制（见 lib/cache-policy.ts）。黑名单制会让用户在画布上改完图层后
    // agent 仍读到旧值 —— 这是移植时原样保留的既有结论。
    const cacheKey = this.getCacheKey(method, params)
    const cacheable = isCacheableMethod(method)
    if (cacheable) {
      const cached = this.requestCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return this.successResponse(id, cached.result)
      }
    }

    const handler = handlers[method]
    if (!handler) {
      logger.warn('[RequestDispatcher] Method not found', { method })
      return this.errorResponse(id, JSONRPC_ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${method}`)
    }

    try {
      const result = await handler(params ?? {}, this.context)
      if (cacheable) {
        this.requestCache.set(cacheKey, { result, timestamp: Date.now() })
      }
      return this.successResponse(id, result)
    } catch (error) {
      logger.error('[RequestDispatcher] Handler execution failed', { method, error })
      return this.errorResponse(id, JSONRPC_ERROR_CODES.INTERNAL_ERROR, `Internal error: ${formatError(error)}`)
    }
  }

  /** 页面切换 / 宿主重新安装后刷新上下文 */
  refreshContext(): void {
    this.context = this.createContext()
    this.clearCache()
  }

  destroy(): void {
    this.destroyed = true
    this.clearCache()
    this.stopCacheCleanup()
  }

  // ── 私有 ──

  private validateRequest(request: Request | JSONRPCRequest): boolean {
    if (!request || typeof request !== 'object') return false
    if (request.jsonrpc !== '2.0') return false
    if (!request.method || typeof request.method !== 'string') return false
    return request.id !== undefined
  }

  private successResponse(id: string | number, result: unknown): JSONRPCSuccessResponse {
    return { jsonrpc: '2.0', id, result }
  }

  private errorResponse(id: string | number, code: number, message: string): JSONRPCErrorResponse {
    return { jsonrpc: '2.0', id, error: { code, message } }
  }

  private getCacheKey(method: string, params: unknown): string {
    try {
      return `${method}:${JSON.stringify(params ?? {})}`
    } catch {
      return method
    }
  }

  private clearCache(): void {
    this.requestCache.clear()
  }

  private startCacheCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      if (this.destroyed) return
      const now = Date.now()
      for (const [key, value] of this.requestCache.entries()) {
        if (now - value.timestamp > this.CACHE_TTL) this.requestCache.delete(key)
      }
    }, this.CACHE_TTL)
  }

  private stopCacheCleanup(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }
}
