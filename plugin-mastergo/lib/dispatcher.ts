import type { JSONRPCSuccessResponse, JSONRPCErrorResponse, Request } from '@lib/mcp/types'
import { handlers, type HandlerContext, type NotifyType } from '@lib/api'
import { logger } from './utils/Logger'
import { JSONRPC_ERROR_CODES, formatError } from './utils/Utils'
import { isCacheableMethod } from './cache-policy'

/**
 * 优化的 MCP 请求调度器
 * 
 * 优化要点：
 * - 改进错误处理和错误恢复
 * - 添加请求验证和参数检查
 * - 性能优化：缓存、去重、异步处理
 * - 内存管理：清理、引用管理
 * - 日志优化：减少冗余日志
 */
export class RequestDispatcher {
  private context: HandlerContext
  private destroyed = false
  private requestCache: Map<string, { result: any; timestamp: number }> = new Map()
  private readonly CACHE_TTL = 5000
  private cleanupTimer: number | null = null

  constructor() {
    logger.info('[RequestDispatcher] Initializing request dispatcher')
    this.context = this.createContext()
    this.startCacheCleanup()
    logger.info('[RequestDispatcher] Dispatcher initialized successfully')
  }

  private createContext(): HandlerContext {
    return {
      document: mg.document,
      notify: (message: string, options?: { type?: NotifyType }) => {
        logger.info('[RequestDispatcher] Sending notification', { message, type: options?.type })
        // 'info' 是插件内部约定，MasterGo 原生只认 normal/highlight/error/warning/success
        const type = options?.type === 'info' ? 'normal' : options?.type
        try {
          mg.notify(message, { type: type || 'normal' })
        } catch (error) {
          logger.error('[RequestDispatcher] Failed to send notification', error)
        }
      },
    }
  }

  /**
   * 调度处理一个 JSON-RPC 请求
   * @param request - JSON-RPC 请求对象
   * @returns 处理结果或错误响应
   */
  async dispatch(request: Request): Promise<JSONRPCSuccessResponse | JSONRPCErrorResponse> {
    if (this.destroyed) {
      logger.warn('[RequestDispatcher] Cannot dispatch request on destroyed dispatcher')
      return this.createErrorResponse(
        request.id || 0,
        JSONRPC_ERROR_CODES.INTERNAL_ERROR,
        'Dispatcher is destroyed'
      )
    }

    const { method, params, id } = request

    // 请求验证
    if (!this.validateRequest(request)) {
      return this.createErrorResponse(
        id || 0,
        JSONRPC_ERROR_CODES.INVALID_REQUEST,
        'Invalid Request format'
      )
    }

    // 检查缓存
    const cacheKey = this.getCacheKey(method, params)
    // 缓存策略：白名单制（见 lib/cache-policy.ts）。
    // 以前是黑名单，node/get、selection/get、document/getInfo 默认被缓存 5s，
    // 用户在画布上改完图层后 agent 仍读到旧值。
    const cacheable = isCacheableMethod(method)
    if (cacheable) {
      const cached = this.requestCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        logger.debug('[RequestDispatcher] Returning cached result', { method, cacheKey })
        return this.createSuccessResponse(id, cached.result)
      }
    }

    // 查找对应的处理器
    const handler = handlers[method]
    if (!handler) {
      logger.warn('[RequestDispatcher] Method not found', { method })
      return this.createErrorResponse(
        id,
        JSONRPC_ERROR_CODES.METHOD_NOT_FOUND,
        `Method not found: ${method}`
      )
    }

    try {
      logger.debug('[RequestDispatcher] Executing handler', { method, params })
      
      // 调用处理器执行实际业务逻辑（支持异步）
      const result = await handler(params || {}, this.context)
      
      // 缓存结果（仅白名单方法）
      if (cacheable) {
        this.requestCache.set(cacheKey, {
          result,
          timestamp: Date.now()
        })
      }

      logger.debug('[RequestDispatcher] Handler executed successfully', { method })
      return this.createSuccessResponse(id, result)
    } catch (error) {
      logger.error('[RequestDispatcher] Handler execution failed', { method, error })
      
      return this.createErrorResponse(
        id,
        JSONRPC_ERROR_CODES.INTERNAL_ERROR,
        `Internal error: ${formatError(error)}`
      )
    }
  }

  /**
   * 刷新处理器上下文（如页面切换后）
   */
  refreshContext(): void {
    logger.info('[RequestDispatcher] Refreshing handler context')
    this.context = this.createContext()
    this.clearCache()
    logger.info('[RequestDispatcher] Handler context refreshed')
  }

  /**
   * 销毁调度器，释放资源
   */
  destroy(): void {
    logger.info('[RequestDispatcher] Destroying dispatcher')
    this.destroyed = true
    this.clearCache()
    this.stopCacheCleanup()
    logger.info('[RequestDispatcher] Dispatcher destroyed')
  }

  // ---- 私有方法 ----

  private validateRequest(request: Request): boolean {
    if (!request || typeof request !== 'object') {
      logger.error('[RequestDispatcher] Invalid request: not an object')
      return false
    }

    if (request.jsonrpc !== '2.0') {
      logger.error('[RequestDispatcher] Invalid request: wrong JSON-RPC version')
      return false
    }

    if (!request.method || typeof request.method !== 'string') {
      logger.error('[RequestDispatcher] Invalid request: missing or invalid method')
      return false
    }

    if (request.id === undefined) {
      logger.error('[RequestDispatcher] Invalid request: missing id')
      return false
    }

    return true
  }

  private createSuccessResponse(id: string | number, result: any): JSONRPCSuccessResponse {
    return {
      jsonrpc: '2.0',
      id,
      result
    }
  }

  private createErrorResponse(
    id: string | number,
    code: number,
    message: string
  ): JSONRPCErrorResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: { code, message }
    }
  }

  private getCacheKey(method: string, params: any): string {
    try {
      return `${method}:${JSON.stringify(params || {})}`
    } catch {
      return method
    }
  }

  private clearCache(): void {
    this.requestCache.clear()
    logger.debug('[RequestDispatcher] Cache cleared')
  }

  private startCacheCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      if (this.destroyed) return

      const now = Date.now()
      for (const [key, value] of this.requestCache.entries()) {
        if (now - value.timestamp > this.CACHE_TTL) {
          this.requestCache.delete(key)
        }
      }
    }, this.CACHE_TTL) as unknown as number
  }

  private stopCacheCleanup(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }
}
