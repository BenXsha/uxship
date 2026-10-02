import { handleGetDocumentInfo, handleGetSelection } from './documentHandlers'
import {
  handleGetNode,
  handleCreateNode,
  handleUpdateNode,
  handleDeleteNode,
  handleBatchCreateNodes,
  handleBatchUpdateNodes,
  handleBatchDeleteNodes,
  handleGroupNodes,
  handleBooleanOperation,
  handleConvertToComponent,
  handleCloneNode,
  handleMoveNode,
  handleDetachInstance,
  handleExportNodeAsImage,
} from './nodeHandlers'
import { handleCreateText } from './textHandlers'
import { handleNotify, handleListFonts, handleSearchFind } from './utilHandlers'
import { handleExportSelection, handleExportNode, handleRenderDSL } from './dslHandlers'
import { handleComponentRender, handleComponentList, handleComponentSearch, handleCreateStateMatrix } from './componentHandlers'
import { handleRegisterStyles } from './libraryHandlers'
import { handleTeamLibraryList, handleTeamComponentImport, handleTeamStyleImport } from './teamLibraryHandlers'
import { handleSwapComponent } from './swapComponentHandlers'
import { handleStyleListColors, handleStyleListText, handleStyleApply } from './styleHandlers'
import { handleDesignDescribe } from './designHandlers'
import { handleZoomToNode, handleZoomToRect, handleSetSelection } from './canvasHandlers'
import { handleGetPages, handleCreatePage, handleDeletePage, handleSwitchPage, handleRenamePage } from './pageHandlers'
import {
  handlePing,
  handleHealthGet,
  handleHealthCheck,
  handleDSLSpec,
  handleCapabilities,
} from './mcpHandlers'
// 变量系统（Design Token）
import { variableHandlers } from './variableHandlers'
// 批量导出（多图层 SVG/PNG）
import { exportHandlers } from './exportHandlers'
// 顶层结构（根节点 / 根父层 / 祖先链）
import { structureHandlers } from './structureHandlers'

export type HandlerFunction = (params: any, context: HandlerContext) => any

/** 处理器上下文接口 */
/** 插件内部通知类型：'info' 为内部约定，由 dispatcher 翻译为 MasterGo 的 'normal' */
export type NotifyType = 'info' | 'normal' | 'warning' | 'error' | 'success' | 'highlight'

export interface HandlerContext {
  document: typeof mg.document
  notify: (message: string, options?: { type?: NotifyType }) => void
}

/**
 * MCP 方法 → 处理函数 映射注册表。
 *
 * 每个 handler 签名为 (params: any, context: HandlerContext) => any，
 * 返回值会作为 JSON-RPC success result 序列化发送。
 * 抛出的 Error 会被 dispatcher 捕获并转为 JSON-RPC error response。
 */
export const handlers: Record<string, HandlerFunction> = {
  // Ping
  'ping': handlePing,

  // 健康检查
  'health/get': handleHealthGet,
  'health/check': handleHealthCheck,

  // 宿主能力探测（apiVersion + 各新 API 运行时可用性）
  'plugin/capabilities': handleCapabilities,
  
  // DSL 规范
  'dsl/spec': handleDSLSpec,
  
  // 文档操作
  'document/getInfo': handleGetDocumentInfo,
  'selection/get': handleGetSelection,
  'selection/set': handleSetSelection,

  // 节点操作
  'node/get': handleGetNode,
  'node/create': handleCreateNode,
  'node/update': handleUpdateNode,
  'node/delete': handleDeleteNode,
  'node/batchCreate': handleBatchCreateNodes,
  'node/batchUpdate': handleBatchUpdateNodes,
  'node/batchDelete': handleBatchDeleteNodes,
  'node/group': handleGroupNodes,
  'node/boolean': handleBooleanOperation,
  'node/convertToComponent': handleConvertToComponent,
  'node/clone': handleCloneNode,
  'node/move': handleMoveNode,
  // 实例分离（改实例子层几何前的官方推荐路径）
  'node/detachInstance': handleDetachInstance,
  'node/swapComponent': handleSwapComponent,
  'node/exportImage': handleExportNodeAsImage,

  // 文本操作
  'text/create': handleCreateText,

  // 工具方法
  'notify': handleNotify,
  'fonts/list': handleListFonts,
  'search/find': handleSearchFind,

  // DSL 操作
  'dsl/exportSelection': handleExportSelection,
  'dsl/exportNode': handleExportNode,
  'dsl/render': handleRenderDSL,

  // 组件渲染（高阶 API）
  'component/render': handleComponentRender,
  // 组件发现
  'component/list': handleComponentList,
  'component/search': handleComponentSearch,
  // 组件状态矩阵
  'component/stateMatrix': handleCreateStateMatrix,

  // 页面管理
  'page/list': handleGetPages,
  'page/create': handleCreatePage,
  'page/delete': handleDeletePage,
  'page/switch': handleSwitchPage,
  'page/rename': handleRenamePage,

  // 画布视图
  'canvas/zoomToNode': handleZoomToNode,
  'canvas/zoomToRect': handleZoomToRect,

  // 设计分析
  'design/describe': handleDesignDescribe,

  // 样式注册（从 Token 面板创建 MasterGo 原生样式）
  'library/registerStyles': handleRegisterStyles,

  // 样式库管理
  'style/listColors': handleStyleListColors,
  'style/listText': handleStyleListText,
  'style/apply': handleStyleApply,

  // 团队组件库
  'teamLibrary/list': handleTeamLibraryList,
  'teamLibrary/importComponent': handleTeamComponentImport,
  'teamLibrary/importStyle': handleTeamStyleImport,

  // 变量系统（Design Token）：variable/list|create|update|delete
  ...variableHandlers,

  // 批量导出：node/exportBatch
  ...exportHandlers,

  // 顶层结构：node/getRoot
  ...structureHandlers,
}

/** 获取所有已注册的方法名 */
export function getRegisteredMethods(): string[] {
  return Object.keys(handlers)
}
