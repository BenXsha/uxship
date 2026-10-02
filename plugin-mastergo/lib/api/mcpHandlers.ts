/**
 * 插件内部工具处理器
 */
import { HandlerFunction } from './index'
import { getRegisteredMethods } from './index'

/**
 * 处理 ping 请求
 */
export const handlePing: HandlerFunction = (_params, _context) => {
  return {}
}

// 插件沙箱不保证提供 Node 的 process，自行记录启动时间计算运行时长
const PLUGIN_START_AT = Date.now()

function pluginUptimeSeconds(): number {
  return Math.floor((Date.now() - PLUGIN_START_AT) / 1000)
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}h ${m}m ${s}s`
}

/**
 * 处理 health/get 请求
 */
export const handleHealthGet: HandlerFunction = (_params, _context) => {
  const uptimeSeconds = pluginUptimeSeconds()
  return {
    status: 'healthy',
    serverInfo: {
      name: 'uxship',
      version: __PLUGIN_VERSION__,
      mastergoApiVersion: String((mg as any).apiVersion ?? 'unknown'),
    },
    uptime: {
      seconds: uptimeSeconds,
      formatted: formatUptime(uptimeSeconds)
    },
    components: {
      websocket: {
        status: 'healthy',
        message: 'WebSocket server is running'
      },
      jsonrpc: {
        status: 'healthy',
        message: 'JSON-RPC protocol handler is operational'
      },
      tools: {
        status: 'healthy',
        message: `Tool system is ready with ${getRegisteredMethods().length} tools`
      }
    },
    timestamp: new Date().toISOString()
  }
}

/**
 * 处理 health/check 请求
 */
export const handleHealthCheck: HandlerFunction = (params, _context) => {
  const components = (params as any)?.components || []

  const componentChecks: Record<string, unknown> = {}

  if (components.length === 0 || components.includes('websocket')) {
    componentChecks.websocket = {
      status: 'healthy',
      message: 'WebSocket server is running',
      details: {
        supported: true,
        connections: 1
      }
    }
  }

  if (components.length === 0 || components.includes('jsonrpc')) {
    componentChecks.jsonrpc = {
      status: 'healthy',
      message: 'JSON-RPC protocol handler is operational',
      details: {
        version: '2.0',
        methods: getRegisteredMethods()
      }
    }
  }

  if (components.length === 0 || components.includes('tools')) {
    const toolList = getRegisteredMethods()
    componentChecks.tools = {
      status: 'healthy',
      message: `Tool system is ready with ${toolList.length} tools available`,
      details: {
        toolCount: toolList.length,
        tools: toolList
      }
    }
  }

  return {
    status: 'healthy',
    components: componentChecks,
    timestamp: new Date().toISOString()
  }
}

/**
 * 处理 plugin/capabilities 请求
 *
 * 为什么要它：`@mastergo/plugin-typings` 只是**声明**，实际能否调用取决于客户端版本
 * （比如 `mg.apiVersion` / 私有化企业版 MasterGoPrivate 通常落后主线很多）。
 * 接入任何新 API（variables / exportPng / intelligentContainer / publishedTeamLibrary …）前，
 * 先用它探测运行时可用性，不要凭 typings 直接上。
 */
export const handleCapabilities: HandlerFunction = (_params, _context) => {
  const api = mg as any
  const page = api.document?.currentPage
  const viewport = api.viewport
  // 实例/节点专属方法：用页面上真实存在的节点去探测（拿不到就是 null）
  const anyInstance = typeof page?.findOne === 'function' ? page.findOne((n: any) => n.type === 'INSTANCE') : null
  const anyNode = typeof page?.findOne === 'function' ? page.findOne((n: any) => n.type === 'FRAME' || n.type === 'RECTANGLE') : null

  const has = (fn: any) => typeof fn === 'function'

  return {
    /** 宿主（MasterGo 客户端）插件 API 版本 */
    mastergoApiVersion: String(api.apiVersion ?? 'unknown'),
    /** 本插件版本（构建期从 package.json 注入） */
    pluginVersion: __PLUGIN_VERSION__,
    /** 运行模式：inspect / design / codegen / snippetgen */
    mode: api.mode ?? null,
    documentId: api.documentId ?? null,
    /** 团队库能力（现有 tools 依赖） */
    teamLibrary: {
      getTeamLibraryAsync: has(api.getTeamLibraryAsync),
      importComponentByKeyAsync: has(api.importComponentByKeyAsync),
      importComponentSetByKeyAsync: has(api.importComponentSetByKeyAsync),
      importStyleByKeyAsync: has(api.importStyleByKeyAsync),
      getPublishedTeamLibraryAsync: has(api.getPublishedTeamLibraryAsync),
      getComponentListVal: has(api.getComponentListVal),
    },
    /** 节点/实例能力 */
    node: {
      swapComponent: anyInstance ? has(anyInstance.swapComponent) : null,
      detachInstance: anyInstance ? has(anyInstance.detachInstance) : null,
      componentProperties: anyInstance ? Array.isArray(anyInstance.componentProperties) : null,
      setProperties: anyInstance ? has(anyInstance.setProperties) : null,
      insertChild: has(page?.insertChild),
      findAllWithCriteria: has(page?.findAllWithCriteria),
      getRootNodeById: has(api.getRootNodeById),
      getRootParentLayerId: has(api.getRootParentLayerId),
      getTopContainerInfoListByPageID: has(api.getTopContainerInfoListByPageID),
      createIntelligentContainer: has(api.createIntelligentContainer),
      getNodeByPosition: has(api.getNodeByPosition),
    },
    /** 导出能力 */
    export: {
      nodeExportAsync: anyNode ? has(anyNode.exportAsync) : null,
      exportPng: has(api.exportPng),
      exportSvgByLayerIds: has(api.exportSvgByLayerIds),
      pageGetExportList: has(page?.getExportList),
    },
    /** 变量（Design Token 一等公民） */
    variables: {
      available: !!api.variables,
      getCollections: has(api.variables?.getCollections),
      getCollectionById: has(api.variables?.getCollectionById),
      createCollection: has(api.variables?.createCollection),
    },
    /**
     * 变体集（Combine as Variants）能力
     *
     * `node_convertToComponent` 的 variantGroups 形态依赖这些 API：typings（@mastergo/plugin-typings
     * 声明了 `combineAsVariants` / `ComponentSetNode`）只是**声明**，私有化企业版客户端往往落后主线，
     * 所以照本文件惯例用 `has()` 实时探测运行时。
     *
     * 多属性轴（Variant + State 两个独立属性）：适配层已按成员名 `Prop1=Value1, Prop2=Value2`
     * 编码（无显式 addProperty），但**能否推导出两轴未在真机验证** —— 登录客户端后以回读的
     * `hostProperties`（componentPropertyDefinitions）为准；未验证前按单轴用。
     * `componentSetName` 没有专属 API：变体集容器的改名与普通节点共用 `set.name`，
     * 这里探测节点是否暴露 `name`（为 false 时 variantGroups 的 setId 改名必然失败）。
     */
    variants: {
      combineAsVariants: has(api.combineAsVariants),
      setVariantPropertyValues: anyInstance ? has(anyInstance.setVariantPropertyValues) : null,
      componentSetName: anyNode ? 'name' in anyNode : null,
    },
    /** 其它新 API */
    misc: {
      uiSetCloseConfirm: has(api.ui?.setCloseConfirm),
      webSocket: has(api.WebSocket?.connect),
      positionOnDom: !!viewport?.positionOnDom,
      scrollAndZoomIntoView: has(viewport?.scrollAndZoomIntoView),
      viewportCenterWritable: 'center' in (viewport || {}),
      viewportZoomWritable: 'zoom' in (viewport || {}),
      clientStorage: !!api.clientStorage,
    },
  }
}

/**
 * 处理 dsl/spec 请求
 */
export const handleDSLSpec: HandlerFunction = (_params, _context) => {
  return {
    version: '2.0',
    description: 'MasterGo MCP DSL 规范',
    elements: [
      { type: 'rectangle', description: '矩形元素', requiredProperties: ['type', 'name'] },
      { type: 'text', description: '文本元素', requiredProperties: ['type', 'name', 'content'] },
      { type: 'frame', description: '框架元素', requiredProperties: ['type', 'name', 'children'] }
    ],
    colorFormat: '十六进制格式 (#RRGGBB 或 #RRGGBBAA)',
    coordinateSystem: '左上角为原点 (0, 0)，X 轴向右，Y 轴向下，单位为像素'
  }
}
