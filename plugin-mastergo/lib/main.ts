import { RequestDispatcher } from './dispatcher'
import { PluginMessage, sendMsgToUI, UIMessage } from '@messages/sender'
import { logger } from './utils/Logger'
import { PERFORMANCE_CONFIG, MCP_SERVER_URL } from './utils/Utils'

/** 内置代号池 */
const CODENAMES = [
  'Nova', 'Pixel', 'Flux', 'Nexus', 'Apex',
  'Orbit', 'Echo', 'Luna', 'Spark', 'Shift',
  'Trace', 'Vapor', 'Drift', 'Gleam', 'Haven',
  'Joule', 'Quest', 'Ridge', 'Swift', 'Zenith',
]

/** 代号内存缓存：clientStorage 是异步 API（getAsync/setAsync），需缓存后才能同步读取 */
let cachedCodename: string | null = null

function generateCodename(): string {
  return CODENAMES[Math.floor(Math.random() * CODENAMES.length)]
}

/** 持久化代号（异步写入，失败不阻断） */
function persistCodename(name: string): void {
  try {
    const p = mg.clientStorage?.setAsync?.('mgmcp_codename', name)
    if (p && typeof p.catch === 'function') p.catch(() => { /* ignore */ })
  } catch { /* ignore */ }
}

function saveCodename(name: string): void {
  cachedCodename = name
  persistCodename(name)
}

/**
 * 启动时从 clientStorage 恢复代号（异步）。
 * 未存储过则生成一个并写回。
 */
async function loadCodenameFromStorage(): Promise<string> {
  if (cachedCodename) return cachedCodename
  try {
    const stored = await mg.clientStorage?.getAsync?.('mgmcp_codename')
    if (typeof stored === 'string' && stored) {
      cachedCodename = stored
      return stored
    }
  } catch { /* ignore */ }
  cachedCodename = generateCodename()
  persistCodename(cachedCodename)
  return cachedCodename
}

/**
 * 同步获取代号（内存缓存）
 */
function getOrCreateCodename(): string {
  if (!cachedCodename) cachedCodename = generateCodename()
  return cachedCodename
}

/**
 * 插件生命周期状态
 */
enum PluginLifecycle {
  INITIALIZING = 'initializing',
  READY = 'ready',
  RUNNING = 'running',
  DESTROYING = 'destroying',
  DESTROYED = 'destroyed'
}

/**
 * 优化的插件主入口
 * 
 * 优化要点：
 * - 生命周期管理：初始化、运行、销毁
 * - 内存管理：清理事件监听器、定时器
 * - 性能优化：防抖、节流、日志优化
 * - 错误处理：统一的错误处理和恢复
 * - 状态管理：清晰的状态转换
 */
class PluginManager {
  private static instance: PluginManager | null = null
  private dispatcher: RequestDispatcher | null = null
  private lifecycle: PluginLifecycle = PluginLifecycle.INITIALIZING
  private eventHandlers: Map<string, Function[]> = new Map()
  private cleanupFunctions: Function[] = []

  private constructor() {
    logger.info('[PluginManager] Creating plugin manager instance')
  }

  /**
   * 获取单例实例
   */
  static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager()
    }
    return PluginManager.instance
  }

  /**
   * 初始化插件
   */
  async initialize(): Promise<void> {
    if (this.lifecycle !== PluginLifecycle.INITIALIZING) {
      logger.warn('[PluginManager] Plugin already initialized or destroyed')
      return
    }

    try {
      logger.info('[PluginManager] Starting plugin initialization...')
      
      this.registerEventHandlers()
      await this.initializeDispatcher()
      await this.setupMasterGoEvents()
      
      this.lifecycle = PluginLifecycle.READY
      logger.info('[PluginManager] Plugin initialization completed successfully')

      // 恢复持久化代号（clientStorage 为异步 API）
      await loadCodenameFromStorage()

      const codename = getOrCreateCodename()
      const docInfo = {
        documentName: mg.document.name,
        documentId: mg.document.id,
        pageName: mg.document.currentPage.name,
        pageId: mg.document.currentPage.id,
      }
      this.notifyUI({
        type: PluginMessage.STATUS_CHANGED,
        data: {
          status: 'ready',
          serverUrl: MCP_SERVER_URL,
          documentInfo: docInfo,
          codename,
        },
      })
    } catch (error) {
      logger.error('[PluginManager] Plugin initialization failed', error)
      this.handleInitializationError(error)
    }
  }

  async destroy(): Promise<void> {
    if (this.lifecycle === PluginLifecycle.DESTROYING || 
        this.lifecycle === PluginLifecycle.DESTROYED) {
      logger.warn('[PluginManager] Plugin already destroyed or being destroyed')
      return
    }

    try {
      logger.info('[PluginManager] Starting plugin destruction...')
      this.lifecycle = PluginLifecycle.DESTROYING

      this.unregisterEventHandlers()
      this.cleanupMasterGoEvents()
      this.runCleanupFunctions()
      
      if (this.dispatcher) {
        this.dispatcher.destroy()
        this.dispatcher = null
      }

      this.lifecycle = PluginLifecycle.DESTROYED
      logger.info('[PluginManager] Plugin destroyed successfully')
    } catch (error) {
      logger.error('[PluginManager] Plugin destruction failed', error)
      this.lifecycle = PluginLifecycle.DESTROYED
    }
  }

  private registerEventHandlers(): void {
    logger.info('[PluginManager] Registering UI message handlers')
    
    this.eventHandlers.set('ui-message', [
      this.handleUIMessage.bind(this)
    ])

    this.cleanupFunctions.push(() => {
      this.eventHandlers.delete('ui-message')
    })
  }

  private unregisterEventHandlers(): void {
    logger.info('[PluginManager] Unregistering UI message handlers')
    this.eventHandlers.clear()
  }

  private async initializeDispatcher(): Promise<void> {
    logger.info('[PluginManager] Initializing request dispatcher')
    
    this.dispatcher = new RequestDispatcher()
    this.cleanupFunctions.push(() => {
      if (this.dispatcher) {
        this.dispatcher.destroy()
      }
    })
  }

  private async setupMasterGoEvents(): Promise<void> {
    logger.info('[PluginManager] Setting up MasterGo event listeners')
    
    const selectionChangeHandler = this.handleSelectionChange.bind(this)
    mg.on('selectionchange', selectionChangeHandler)
    
    this.cleanupFunctions.push(() => {
      try {
        mg.off('selectionchange', selectionChangeHandler)
      } catch (error) {
        logger.warn('[PluginManager] Failed to unregister selectionchange handler', error)
      }
    })

    const uiMessageHandler = this.handleUIMessage.bind(this)
    mg.ui.onmessage = uiMessageHandler
    
    this.cleanupFunctions.push(() => {
      try {
        mg.ui.onmessage = undefined
      } catch (error) {
        logger.warn('[PluginManager] Failed to unregister ui.onmessage handler', error)
      }
    })

    logger.info('[PluginManager] MasterGo event listeners registered')
  }

  private cleanupMasterGoEvents(): void {
    logger.info('[PluginManager] Cleaning up MasterGo event listeners')
  }

  private runCleanupFunctions(): void {
    logger.info('[PluginManager] Running cleanup functions')
    
    for (const cleanupFn of this.cleanupFunctions) {
      try {
        cleanupFn()
      } catch (error) {
        logger.warn('[PluginManager] Cleanup function failed', error)
      }
    }
    
    this.cleanupFunctions = []
  }

  private async handleUIMessage(msg: { type: UIMessage; data?: any }): Promise<void> {
    if (this.lifecycle === PluginLifecycle.DESTROYED) {
      logger.warn('[PluginManager] Ignoring UI message on destroyed plugin')
      return
    }

    const { type, data } = msg
    logger.debug('[PluginManager] Received UI message', { type })

    switch (type) {
      case UIMessage.EXECUTE_METHOD:
        await this.handleExecuteMethod(data)
        break

      case UIMessage.GET_STATUS:
        this.handleGetStatus()
        break

      case UIMessage.RESIZE:
        this.handleResize(data)
        break

      case UIMessage.SET_CODENAME:
        this.handleSetCodename(data)
        break

      default:
        logger.warn('[PluginManager] Unknown UI message type', { type })
        break
    }
  }

  private async handleExecuteMethod(data: any): Promise<void> {
    if (!this.dispatcher || !data?.request) {
      logger.error('[PluginManager] Invalid EXECUTE_METHOD message', { 
        hasDispatcher: !!this.dispatcher, 
        hasRequest: !!data?.request 
      })
      return
    }

    try {
      logger.debug('[PluginManager] Dispatching request', { 
        method: data.request.method 
      })

      const response = await this.dispatcher.dispatch(data.request)
      
      this.notifyUI({
        type: PluginMessage.METHOD_RESULT,
        data: {
          id: data.request.id,
          response,
        },
      })

      logger.debug('[PluginManager] Method execution completed')
    } catch (error) {
      logger.error('[PluginManager] Method execution failed', error)
      
      this.notifyUI({
        type: PluginMessage.METHOD_ERROR,
        data: {
          id: data.request.id,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  private handleGetStatus(): void {
    logger.debug('[PluginManager] Handling GET_STATUS request')
    const codename = getOrCreateCodename()
    
    this.notifyUI({
      type: PluginMessage.STATUS_CHANGED,
      data: {
        status: this.lifecycle === PluginLifecycle.READY ? 'ready' : 'initializing',
        serverUrl: MCP_SERVER_URL,
        codename,
      },
    })
  }

  /**
   * 处理窗口大小调整请求
   */
  private handleResize(data: { width: number; height: number }): void {
    logger.debug('[PluginManager] Handling RESIZE request', data)
    try {
      mg.ui.resize(data.width, data.height)
    } catch (error) {
      logger.error('[PluginManager] Failed to resize UI', error)
    }
  }

  /**
   * 处理代号修改请求
   */
  private handleSetCodename(data: { codename: string }): void {
    logger.debug('[PluginManager] Handling SET_CODENAME request', data)
    if (!data?.codename || typeof data.codename !== 'string') return
    saveCodename(data.codename.trim())
    const codename = data.codename.trim()
    this.notifyUI({
      type: PluginMessage.STATUS_CHANGED,
      data: { codename },
    })
  }

  /**
   * 处理选中变化
   */
  private handleSelectionChange(selectionLayerIds: string[]): void {
    if (this.lifecycle === PluginLifecycle.DESTROYED) {
      return
    }

    logger.debug('[PluginManager] Selection changed', { layerIds: selectionLayerIds })
    
    try {
      const selection = mg.document.currentPage.selection
      
      // 获取选中元素的详细信息
      const selectionDetails = selection.map((node: any) => ({
        id: node.id,
        type: node.type || 'UNKNOWN',
        name: node.name || ''
      }))
      
      this.notifyUI({
        type: PluginMessage.SELECTION_CHANGED,
        data: {
          count: selection.length,
          layerIds: selectionLayerIds,
          details: selectionDetails,
        },
      })

      logger.debug('[PluginManager] Selection change processed', { 
        count: selection.length 
      })
    } catch (error) {
      logger.error('[PluginManager] Failed to handle selection change', error)
    }
  }

  /**
   * 通知 UI
   */
  private notifyUI(message: any): void {
    try {
      sendMsgToUI(message)
    } catch (error) {
      logger.error('[PluginManager] Failed to send message to UI', error)
    }
  }

  /**
   * 处理初始化错误
   */
  private handleInitializationError(error: unknown): void {
    logger.error('[PluginManager] Handling initialization error', error)
    
    this.notifyUI({
      type: PluginMessage.ERROR,
      data: {
        message: `Plugin initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    })

    this.lifecycle = PluginLifecycle.DESTROYED
  }
}

// ==================== 插件启动 ====================

/**
 * 启动插件
 */
async function startPlugin(): Promise<void> {
  logger.info('[Main] Plugin starting...')
  
  try {
    mg.showUI(__html__, { width: 180, height: 180 })
    logger.info('[Main] UI shown successfully')

    const pluginManager = PluginManager.getInstance()
    
    await new Promise(resolve => setTimeout(resolve, PERFORMANCE_CONFIG.DEBOUNCE_DELAY))
    await pluginManager.initialize()
    
    logger.info('[Main] Plugin started successfully')
  } catch (error) {
    logger.error('[Main] Plugin startup failed', error)
    
    sendMsgToUI({
      type: PluginMessage.ERROR,
      data: {
        message: `Plugin startup failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    })
  }
}

// ==================== 插件销毁 ====================

/**
 * 销毁插件（在插件卸载时调用）
 */
async function destroyPlugin(): Promise<void> {
  logger.info('[Main] Plugin destroying...')
  
  try {
    const pluginManager = PluginManager.getInstance()
    await pluginManager.destroy()
    
    logger.info('[Main] Plugin destroyed successfully')
  } catch (error) {
    logger.error('[Main] Plugin destruction failed', error)
  }
}

// ==================== 启动插件 ====================

startPlugin().catch(error => {
  logger.error('[Main] Unhandled plugin startup error', error)
})

// 导出销毁函数（供外部调用）
;(globalThis as any).destroyPlugin = destroyPlugin
