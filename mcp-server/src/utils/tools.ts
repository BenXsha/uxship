/**
 * MCP 工具定义 — 编排器
 *
 * 从 tools/ 目录下各分区模块导入工具定义，合并为统一工具列表导出。
 * 路由函数（getPluginMethod, isTaskProgressTool）在此维护。
 */
import type { MCPTool } from '../types/mcp-types.js'
import { getTools as getDesignContextTools } from './tools/design-context.js'
import { getTools as getNodeOperationsTools } from './tools/node-operations.js'
import { getTools as getDesignPipelineTools } from './tools/design-pipeline.js'
import { getTools as getAnalysisTools } from './tools/analysis.js'
import { getTools as getComponentsTools } from './tools/components.js'
import { getTools as getResourcesTools } from './tools/resources.js'
import { getTools as getInfrastructureTools } from './tools/infrastructure.js'
import { getTools as getAgentTools } from './tools/agent-operations.js'
import { getTools as getTeamLibraryTools } from './tools/team-library.js'
import { getVariableTools } from './tools/variables.js'
import { getExportBatchTools } from './tools/export-batch.js'
import { getStructureTools } from './tools/structure.js'
import { applyToolAnnotations } from './tool-annotations.js'

/**
 * 根据工具名称推导对应的插件方法名。
 * 本地工具和 server 处理工具返回 undefined。
 * icon_render 特殊映射到 dsl/render（非标准映射）。
 */
const LOCAL_TOOLS = new Set([
  'design_to_code', 'icon_search',
  'code_to_design',
  'task_plan', 'task_step', 'task_complete',
  'design_suggest', 'design_suggest_batch',
  'design_review',
  'design_to_code_update',
  'codebase_get_structure',
  'session_list', 'session_switch',
  'agent_design_by_intent', 'agent_get_status', 'agent_iterate_design',
  'get_version', 'get_guidelines',
  // 团队库：索引检索/同步在服务端完成（读缓存文件），仅导入类工具转发插件
  'team_library_list', 'team_component_search', 'team_style_list', 'team_library_sync',
  // 变体集编排：名字解析（<类型>_<轴值> → 显式属性表）只能在服务端做一次，
  // 插件只接收 variantGroups 显式属性表（两宿主范式不同，见 variant-groups.ts）
  'node_convert_to_component',
])

/**
 * 插件方法名映射：纯 snake_case 工具名 → 插件端方法名
 * 默认规则：name.replace(/_/g, '/')
 * 例外在此显式映射。
 */
const PLUGIN_METHOD_MAP: Record<string, string> = {
  // 命名重整映射（保持插件协议不变）
  document_get_info: 'document/getInfo',
  search_nodes: 'search/find',
  node_create_batch: 'node/batchCreate',
  node_update_batch: 'node/batchUpdate',
  node_delete_batch: 'node/batchDelete',
  // 注意：node_convert_to_component 在 LOCAL_TOOLS 里（服务端编排，按实参决定转发 1 或 2 次），
  // 这里保留条目只为记录插件方法名：编排层显式转发到 'node/convertToComponent'。
  node_convert_to_component: 'node/convertToComponent',
  node_swap_component: 'node/swapComponent',
  node_export_image: 'node/exportImage',
  // 批量导出：双下划线段会误推成 node/export/batch，这里显式压平
  node_export_batch: 'node/exportBatch',
  // 多段工具名会误推成 node/get/root，显式压平
  node_get_root: 'node/getRoot',
  // 多段工具名会误推成 node/detach/instance，显式压平
  node_detach_instance: 'node/detachInstance',
  dsl_export_selection: 'dsl/exportSelection',
  dsl_export_node: 'dsl/exportNode',
  component_state_matrix: 'component/stateMatrix',
  canvas_zoom_to_node: 'canvas/zoomToNode',
  canvas_zoom_to_rect: 'canvas/zoomToRect',
  style_list_colors: 'style/listColors',
  style_list_text: 'style/listText',
  // 特殊映射
  icon_render: 'dsl/render',
  library_register_styles: 'library/registerStyles',
  // 团队组件库
  team_component_import: 'teamLibrary/importComponent',
  team_style_import: 'teamLibrary/importStyle',
}

export function getPluginMethod(name: string): string | undefined {
  if (LOCAL_TOOLS.has(name)) return undefined
  if (PLUGIN_METHOD_MAP[name]) return PLUGIN_METHOD_MAP[name]
  return name.replace(/_/g, '/')
}

/**
 * 数组形式 → 批量插件方法。
 *
 * 为什么：`tools/list` 里不再出现「单体 + _batch」孪生工具（近似同名是工具选择的**首要误选来源**），
 * 合并后的工具按**实参形状**在服务端选路：传数组即走批量方法，否则走单体方法。
 * 插件方法本身不变（`node/create` / `node/batchCreate` 都还在），只是不再各占一个工具面。
 */
const ARRAY_FORM_METHOD_MAP: Record<string, { param: string; method: string }> = {
  node_create: { param: 'nodes', method: 'node/batchCreate' },
  node_update: { param: 'updates', method: 'node/batchUpdate' },
  node_delete: { param: 'nodeIds', method: 'node/batchDelete' },
  // 同一个工具名的第二条语义：传 nodeIds = 把变量**绑定**到这些节点（而非改值）
  variable_update: { param: 'nodeIds', method: 'variable/apply' },
  // 批量建令牌（palette 一键落地）：传 variables[] 走批处理，单条仍走 variable/create
  variable_create: { param: 'variables', method: 'variable/batchCreate' },
}

/** 按实参解析插件方法（合并工具的批量路径在此选路） */
export function resolvePluginMethod(
  name: string,
  args: Record<string, unknown> = {}
): string | undefined {
  const arrayForm = ARRAY_FORM_METHOD_MAP[name]
  if (arrayForm) {
    const value = args?.[arrayForm.param]
    if (Array.isArray(value) && value.length > 0) return arrayForm.method
  }
  return getPluginMethod(name)
}

/** 数组形式选路表（供测试断言合并工具的两条路径都可达） */
export function arrayFormMethodMap(): Record<string, { param: string; method: string }> {
  return { ...ARRAY_FORM_METHOD_MAP }
}

/**
 * 仅在服务端执行的工具名集合（供测试与路由断言使用）
 */
export function getLocalToolNames(): string[] {
  return Array.from(LOCAL_TOOLS)
}

/**
 * 插件端已注册的方法名集合（来自 plugin-mastergo/lib/api/index.ts 的 handlers 表）。
 * 用于断言「每个工具要么映射到已注册的插件方法，要么在服务端本地执行」，
 * 避免新增工具后静默转发到不存在的方法。
 */
export const PLUGIN_REGISTERED_METHODS: ReadonlySet<string> = new Set([
  'ping', 'health/get', 'health/check', 'dsl/spec',
  'document/getInfo', 'selection/get', 'selection/set',
  'plugin/capabilities',
  'node/get', 'node/create', 'node/update', 'node/delete',
  'node/batchCreate', 'node/batchUpdate', 'node/batchDelete',
  'node/group', 'node/boolean', 'node/align', 'node/convertToComponent', 'node/clone', 'node/move', 'node/swapComponent', 'node/exportImage',
  'node/detachInstance',
  'node/exportBatch', 'node/getRoot',
  'variable/list', 'variable/create', 'variable/update', 'variable/delete', 'variable/apply',
  'variable/batchCreate',
  'text/create', 'notify', 'fonts/list', 'search/find',
  'dsl/exportSelection', 'dsl/exportNode', 'dsl/render',
  'component/render', 'component/list', 'component/search', 'component/stateMatrix',
  'page/list', 'page/create', 'page/delete', 'page/switch', 'page/rename',
  'canvas/zoomToNode', 'canvas/zoomToRect',
  'design/describe',
  'library/registerStyles',
  'style/listColors', 'style/listText', 'style/apply',
  'teamLibrary/list', 'teamLibrary/importComponent', 'teamLibrary/importStyle',
])

/**
 * 判断是否为任务进度工具（由 server 直接发送通知，不转发给插件请求/响应）
 */
export function isTaskProgressTool(name: string): boolean {
  return name === 'task_plan' || name === 'task_step' || name === 'task_complete'
}

// 合并各分区工具列表，并统一挂上 annotations（读 / 写信号，口径见 tool-annotations.ts）
export const tools: MCPTool[] = [
  ...getDesignContextTools(),
  ...getNodeOperationsTools(),
  ...getDesignPipelineTools(),
  ...getAnalysisTools(),
  ...getComponentsTools(),
  ...getResourcesTools(),
  ...getInfrastructureTools(),
  ...getAgentTools(),
  ...getTeamLibraryTools(),
  ...getVariableTools(),
  ...getExportBatchTools(),
  ...getStructureTools(),
].map(applyToolAnnotations)

// 工具映射
export const toolsMap: Record<string, MCPTool> = tools.reduce((acc, tool) => {
  acc[tool.name] = tool
  return acc
}, {} as Record<string, MCPTool>)

/**
 * 获取工具列表
 */
export function getToolList(): MCPTool[] {
  return tools
}

/**
 * 根据名称获取工具
 */
export function getTool(name: string): MCPTool | undefined {
  return toolsMap[name]
}
