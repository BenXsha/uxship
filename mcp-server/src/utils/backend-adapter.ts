/**
 * 双模后端适配器
 *
 * 同时支持两种后端通信模式：
 * - plugin: WebSocket → plugin-mastergo 插件
 * - http:    HTTP → MasterGo 桌面端 API
 *
 * 默认 auto 模式：启动时自动检测 MasterGo 桌面端 HTTP API，
 * 检测到则使用 http 模式，否则回退到 plugin 模式。
 * 可通过 UXSHIP_MODE 环境变量强制指定 (plugin/http/auto)。
 */

import { MastergoApi } from './mastergo-api.js'
import type { JSONRPCRequest, JSONRPCResponse } from '../types/index.js'

export type BackendMode = 'plugin' | 'http' | 'auto'

let globalAdapter: BackendAdapter | null = null

function getMode(): BackendMode {
  const mode = process.env.UXSHIP_MODE || 'auto'
  if (mode === 'http') return 'http'
  if (mode === 'plugin') return 'plugin'
  return 'auto'
}

// ====== 插件方法名 → HTTP API 端点映射 ======

const PLUGIN_TO_HTTP: Record<string, { method: 'get' | 'post'; path: string; paramMap?: (params: any) => any }> = {
  // 只读
  'document/getInfo':    { method: 'get', path: '/getUserInfo' },
  'selection/get':       { method: 'get', path: '/getSelectionNode' },
  'node/get':            { method: 'get', path: '/getSelectionNode', paramMap: (p) => ({ id: p.nodeId }) },
  'search/find':         { method: 'get', path: '/getSelectionNode', paramMap: () => ({}) },
  'fonts/list':          { method: 'get', path: '/getFonts' },
  'component/list':      { method: 'get', path: '/getComponentInfo' },
  'component/search':    { method: 'get', path: '/getComponentInfo' },
  'style/listColors':    { method: 'get', path: '/getVariables' },
  'style/listText':      { method: 'get', path: '/getVariables' },
  'dsl/exportSelection': { method: 'get', path: '/getFrontendCode', paramMap: () => ({ framework: 'json' }) },
  'dsl/exportNode':      { method: 'get', path: '/getFrontendCode', paramMap: (p) => ({ id: p.nodeId, framework: 'json' }) },

  // 写入
  'page/create':         { method: 'post', path: '/createPage' },
  'page/delete':         { method: 'post', path: '/removeNode' },
  'node/create':         { method: 'post', path: '/createPage' },
  'node/update':         { method: 'post', path: '/updateNode' },
  'node/delete':         { method: 'post', path: '/removeNode' },
  'node/batchCreate':    { method: 'post', path: '/createPage' },
  'node/batchUpdate':    { method: 'post', path: '/updateNode' },
  'node/batchDelete':    { method: 'post', path: '/removeNode' },
  'node/duplicate':      { method: 'post', path: '/updateNode' },
  'node/reorder':        { method: 'post', path: '/updateNode' },
  'node/moveTo':         { method: 'post', path: '/updateNode' },
  'node/convertToComponent': { method: 'post', path: '/createComponent' },
  'node/exportImage':    { method: 'get', path: '/getScreenshot' },
  'component/render':    { method: 'post', path: '/createComponent' },
  'component/stateMatrix': { method: 'post', path: '/createComponent' },
  'dsl/render':          { method: 'post', path: '/createPage' },
  'html/render-client':  { method: 'post', path: '/createPage' },
  'text/create':         { method: 'post', path: '/updateNode' },
  'notify':              { method: 'post', path: '/updateNode' },
  'canvas/zoomToNode':   { method: 'post', path: '/updateNode' },
  'canvas/zoomToRect':   { method: 'post', path: '/updateNode' },
  'library/registerStyles': { method: 'post', path: '/updateNode' },
}

// ====== 后端适配器 ======

export class BackendAdapter {
  private mode: BackendMode
  private httpApi: MastergoApi

  constructor(mode?: BackendMode) {
    this.mode = mode ?? getMode()
    this.httpApi = new MastergoApi()
  }

  getMode(): BackendMode {
    return this.mode
  }

  setMode(mode: BackendMode): void {
    this.mode = mode
    console.log(`[BackendAdapter] Switched to mode: ${mode}`)
  }

  /**
   * 自动检测 MasterGo 桌面端 HTTP API 是否可用
   * 返回 true 表示检测成功，false 表示不可用
   */
  async autoDetect(): Promise<boolean> {
    if (this.mode === 'plugin') return false
    if (this.mode === 'http') {
      const ok = await this.httpApi.checkConnection()
      if (ok) console.log('[MasterGo API] Auto-detected MasterGo desktop (HTTP mode)')
      return ok
    }
    // auto 模式
    const ok = await this.httpApi.checkConnection()
    if (ok) {
      this.mode = 'http'
      console.log('[MasterGo API] Auto-detected MasterGo desktop, switched to HTTP mode')
    } else {
      this.mode = 'plugin'
      console.log('[MasterGo API] MasterGo desktop not reachable, will use plugin mode (WebSocket)')
    }
    return ok
  }

  /**
   * 获取全局共享的 BackendAdapter 实例
   */
  static getInstance(): BackendAdapter {
    if (!globalAdapter) {
      globalAdapter = new BackendAdapter()
    }
    return globalAdapter
  }

  /**
   * 调用后端端点（统一接口）
   * @param pluginMethod 插件方法名 (如 node/update)
   * @param params 参数
   * @param forwardFallback 插件模式的转发回调
   */
  async callEndpoint(
    pluginMethod: string,
    params: any,
    forwardFallback: (request: JSONRPCRequest) => Promise<JSONRPCResponse>,
  ): Promise<any> {
    if (this.mode === 'plugin') {
      return this.callPlugin(pluginMethod, params, forwardFallback)
    }
    // HTTP mode: try HTTP first, fall back to plugin if not mapped
    const result = await this.callHttp(pluginMethod, params)
    if (result?.error?.includes('No HTTP mapping')) {
      return this.callPlugin(pluginMethod, params, forwardFallback)
    }
    return result
  }

  private async callPlugin(
    method: string,
    params: any,
    forwardFallback: (request: JSONRPCRequest) => Promise<JSONRPCResponse>,
  ): Promise<any> {
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }
    return forwardFallback(request)
  }

  private async callHttp(pluginMethod: string, params: any): Promise<any> {
    const mapping = PLUGIN_TO_HTTP[pluginMethod]
    if (!mapping) {
      return { error: `No HTTP mapping for method: ${pluginMethod}` }
    }

    const actualParams = mapping.paramMap ? mapping.paramMap(params) : params

    let result: any
    if (mapping.method === 'get') {
      result = await this.httpApi.get(mapping.path, actualParams)
    } else {
      result = await this.httpApi.post(mapping.path, actualParams)
    }

    if (result.error) {
      return { error: result.error }
    }

    // 包装为与插件响应兼容的格式
    return {
      result: {
        content: [{ type: 'text', text: JSON.stringify(result.data) }],
      },
    }
  }

  /**
   * 检测 MasterGo HTTP API 是否可用
   */
  async checkHttpConnection(): Promise<boolean> {
    return this.httpApi.checkConnection()
  }

  /**
   * 获取 HTTP API 客户端实例（供需要直接调用的工具使用）
   */
  getHttpApi(): MastergoApi {
    return this.httpApi
  }
}
