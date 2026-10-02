export type Partition =
  | 'core'
  | 'design-gen'
  | 'analysis'
  | 'components'
  | 'resources'
  | 'infrastructure'
  | 'agent'

export interface PartitionInfo {
  name: Partition
  label: string
  description: string
}

export const PARTITIONS: Record<Partition, PartitionInfo> = {
  core: { name: 'core', label: 'Core Nodes', description: '节点 CRUD、文档上下文、搜索' },
  'design-gen': { name: 'design-gen', label: 'Design Gen', description: 'HTML→设计、DSL 导出、代码桥接' },
  analysis: { name: 'analysis', label: 'Analysis', description: '设计描述、自然语言修改、设计自检' },
  components: { name: 'components', label: 'Components', description: '组件发现、渲染、状态矩阵' },
  resources: { name: 'resources', label: 'Resources', description: '图标搜索渲染、样式库注册与管理' },
  infrastructure: { name: 'infrastructure', label: 'Infrastructure', description: '页面管理、会话管理、任务进度、通知、代码库分析' },
  agent: { name: 'agent', label: 'Design Agent', description: 'AI 设计 Agent：自然语言→设计意图→自动规划→执行→审查→迭代' },
}

const PARTITION_MAP: Record<string, Partition> = {
  // Core Nodes
  document_get_info: 'core',
  selection_get: 'core',
  node_get: 'core',
  search_nodes: 'core',
  node_create: 'core',
  node_update: 'core',
  node_delete: 'core',
  node_convert_to_component: 'core',
  node_clone: 'core',
  node_move: 'core',
  node_swap_component: 'core',
  node_export_image: 'core',
  node_export_batch: 'core',
  node_get_root: 'core',
  node_group: 'core',
  node_boolean: 'core',
  node_detach_instance: 'core',

  // 画布视图 / 选区
  plugin_capabilities: 'infrastructure',
  canvas_zoom_to_node: 'infrastructure',
  canvas_zoom_to_rect: 'infrastructure',
  selection_set: 'infrastructure',

  // Design Gen
  code_to_design: 'design-gen',
  dsl_export_selection: 'design-gen',
  dsl_export_node: 'design-gen',
  design_to_code: 'design-gen',
  design_to_code_update: 'design-gen',

  // Analysis
  design_describe: 'analysis',
  design_suggest: 'analysis',
  design_review: 'analysis',

  // Components
  component_list: 'components',
  component_search: 'components',
  component_render: 'components',
  component_state_matrix: 'components',
  team_library_list: 'components',
  team_component_search: 'components',
  team_component_import: 'components',
  team_library_sync: 'components',

  // Resources
  icon_search: 'resources',
  icon_render: 'resources',
  library_register_styles: 'resources',
  style_list_colors: 'resources',
  style_list_text: 'resources',
  style_apply: 'resources',
  fonts_list: 'resources',
  // 变量系统（Design Token）
  variable_list: 'resources',
  variable_create: 'resources',
  variable_update: 'resources',
  variable_delete: 'resources',
  variable_apply: 'resources',
  team_style_list: 'resources',
  team_style_import: 'resources',

  // Infrastructure
  page_list: 'infrastructure',
  page_create: 'infrastructure',
  page_delete: 'infrastructure',
  page_switch: 'infrastructure',
  page_rename: 'infrastructure',
  task_plan: 'infrastructure',
  task_step: 'infrastructure',
  task_complete: 'infrastructure',
  session_list: 'infrastructure',
  session_switch: 'infrastructure',
  notify: 'infrastructure',
  codebase_get_structure: 'infrastructure',
  get_version: 'infrastructure',
  get_guidelines: 'infrastructure',

  // Design Agent
  agent_design_by_intent: 'agent',
  agent_get_status: 'agent',
  agent_iterate_design: 'agent',
}

const ENABLED = process.env.PARTITION_ROUTING_ENABLED === 'true'

export function isPartitionRoutingEnabled(): boolean {
  return ENABLED
}

export function resolvePartition(toolName: string): Partition | undefined {
  return PARTITION_MAP[toolName]
}

export function logRoute(toolName: string): void {
  if (!ENABLED) return
  const partition = resolvePartition(toolName)
  if (partition) {
    const info = PARTITIONS[partition]
    console.error(`[Partition] ${toolName} → ${info.label} (${info.name})`)
  }
}
