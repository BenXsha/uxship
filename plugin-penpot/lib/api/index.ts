/**
 * 处理器注册表
 *
 * 与 MasterGo 侧的 `lib/api/index.ts` 保持同一套方法命名（`node/create`、`dsl/render`…），
 * 这样服务端 / 自建 WS hub 可以用同一份路由表对接两个宿主。
 *
 * 与 MasterGo 侧的关键差异：`HandlerContext` 里不再有 `document: mg.document`，
 * 只有 `host: HostAdapter`。**handler 里不允许出现 `penpot.*`** —— 这是移植性门禁。
 */
import type { HostAdapter } from '../host/index'
import {
  handleHealthGet,
  handleHealthCheck,
  handleFontsList,
  handleNotify,
  handlePing,
  handleCapabilities,
  handleDSLSpec,
} from './mcpHandlers'
import { handleDocumentGetInfo, handleSelectionGet, handleSelectionSet } from './documentHandlers'
import {
  handleNodeCreate,
  handleNodeBatchCreate,
  handleNodeGet,
  handleNodeGetRoot,
  handleNodeUpdate,
  handleNodeBatchUpdate,
  handleNodeDelete,
  handleNodeBatchDelete,
  handleNodeGroup,
  handleNodeClone,
  handleNodeMove,
  handleNodeTree,
  handleSearchFind,
  handleTextCreate,
} from './nodeHandlers'
import { handleRenderDsl } from './dslHandlers'
import { handleDSLExportNode, handleDSLExportSelection } from '../dsl/exporter'
import { handlePageCreate, handlePageList, handlePageSwitch, handlePageRename } from './pageHandlers'
import { handleNodeSwapComponent } from './swapComponentHandlers'
import { handleDesignDescribe, handleComponentStateMatrix } from './analysisHandlers'
import { handleLibraryRegisterStyles } from './libraryStyleHandlers'
import { handleNodeAlign } from './alignHandlers'
import { handleComponentRender } from './componentHandlers'
import {
  handleNodeExportBatch,
  handlePageDelete,
  handleTeamComponentImport,
  handleTeamLibraryList,
  handleTeamStyleImport,
} from './teamLibraryHandlers'
import {
  handleStyleApply,
  handleStyleListColors,
  handleStyleListText,
  handleVariableApply,
  handleVariableBatchCreate,
  handleVariableCreate,
  handleVariableDelete,
  handleVariableList,
  handleVariableUpdate,
} from './tokenHandlers'
import {
  handleComponentList,
  handleComponentSearch,
  handleNodeBoolean,
  handleNodeConvertToComponent,
  handleNodeDetachInstance,
  handleNodeExportImage,
  handleStyleGenerateCss,
} from './exportHandlers'
import { handleZoomToNode, handleZoomToRect } from './canvasHandlers'

export type NotifyKind = 'info' | 'normal' | 'warning' | 'error' | 'success'

export interface HandlerContext {
  /** 宿主端口 —— handler 访问宿主的唯一路径 */
  host: HostAdapter
  notify: (message: string, kind?: NotifyKind) => void
}

export type HandlerFunction = (params: Record<string, unknown>, context: HandlerContext) => unknown

export const handlers: Record<string, HandlerFunction> = {
  // ── 诊断 ──
  ping: handlePing,
  'health/get': handleHealthGet,
  'health/check': handleHealthCheck,
  'fonts/list': handleFontsList,
  notify: handleNotify,
  'plugin/capabilities': handleCapabilities,
  'dsl/spec': handleDSLSpec,

  // ── 文档 / 选区 ──
  'document/getInfo': handleDocumentGetInfo,
  'selection/get': handleSelectionGet,
  'selection/set': handleSelectionSet,

  // ── 节点 ──
  'node/create': handleNodeCreate,
  'node/batchCreate': handleNodeBatchCreate,
  'node/get': handleNodeGet,
  'node/getRoot': handleNodeGetRoot,
  'node/update': handleNodeUpdate,
  'node/batchUpdate': handleNodeBatchUpdate,
  'node/delete': handleNodeDelete,
  'node/batchDelete': handleNodeBatchDelete,
  'node/group': handleNodeGroup,
  'node/clone': handleNodeClone,
  'node/move': handleNodeMove,
  'node/boolean': handleNodeBoolean,
  // 对象**之间**的对齐/等距分布（不是容器内对齐 —— 那是 flex 的 primary/counterAxisAlignItems）
  'node/align': handleNodeAlign,
  'node/convertToComponent': handleNodeConvertToComponent,
  'node/detachInstance': handleNodeDetachInstance,
  'node/exportImage': handleNodeExportImage,
  'node/exportBatch': handleNodeExportBatch,
  'node/swapComponent': handleNodeSwapComponent,
  'component/list': handleComponentList,
  'component/search': handleComponentSearch,
  'component/stateMatrix': handleComponentStateMatrix,
  'component/render': handleComponentRender,

  // ── 设计分析 ──
  'design/describe': handleDesignDescribe,

  // ── 设计令牌（Penpot：tokens；MasterGo：variables）──
  'variable/list': handleVariableList,
  'variable/create': handleVariableCreate,
  'variable/batchCreate': handleVariableBatchCreate,
  'variable/update': handleVariableUpdate,
  'variable/delete': handleVariableDelete,
  'variable/apply': handleVariableApply,

  // ── 样式资产 ──
  'style/listColors': handleStyleListColors,
  'style/listText': handleStyleListText,
  'style/apply': handleStyleApply,
  'style/generateCss': handleStyleGenerateCss,
  'library/registerStyles': handleLibraryRegisterStyles,

  // ── 团队库 ──
  'teamLibrary/list': handleTeamLibraryList,
  'teamLibrary/importComponent': handleTeamComponentImport,
  'teamLibrary/importStyle': handleTeamStyleImport,
  'text/create': handleTextCreate,
  'search/find': handleSearchFind,
  'node/tree': handleNodeTree,

  // ── 设计管线（进出双向）──
  'dsl/render': handleRenderDsl,
  'dsl/exportNode': handleDSLExportNode,
  'dsl/exportSelection': handleDSLExportSelection,

  // ── 页面 ──
  'page/list': handlePageList,
  'page/create': handlePageCreate,
  'page/switch': handlePageSwitch,
  'page/rename': handlePageRename,
  'page/delete': handlePageDelete,

  // ── 画布视图 ──
  'canvas/zoomToNode': handleZoomToNode,
  'canvas/zoomToRect': handleZoomToRect,
}

export function listMethods(): string[] {
  return Object.keys(handlers).sort()
}
