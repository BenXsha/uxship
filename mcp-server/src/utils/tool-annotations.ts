/**
 * MCP 工具 annotations 策略（读 / 写信号）
 *
 * 为什么单独一份：MCP 的 `annotations` 是**给客户端用的机器可读信号**——
 * 客户端据此决定「只读工具可直接放行」「破坏性工具要弹确认」。
 * 把它集中在一处而不是散落在 60+ 个工具定义里，好处是：
 * 1. 新增工具必须在这里显式登记（门禁断言），不会漏想「这工具有没有副作用」；
 * 2. 评审「哪些工具会让 AI 改画布」时只看这一个文件。
 *
 * 口径（保守，宁少勿多）：
 * - `readOnlyHint`：不改变设计内容。**改选区 / 切页面 / 聚焦视口也算只读**（不算设计改动）。
 * - `destructiveHint`：删除或原地替换（可能丢内容）——即使可撤销，也值得让客户端先确认。
 * - 其余写入类（创建 / 修改 / 导入 / 落盘）只登记、不标注，避免每个工具都背一份注解开销。
 *
 * JSON 体积考虑：annotations 会进 `tools/list`，所以**只有分类到的工具才真正挂注解**，
 * 未分类（普通写入类）的工具不产生任何字节。
 */

/** 工具的 MCP annotations（子集；未分类的工具不挂） */
export interface ToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
}

/** 只读：不改设计内容（查文档/节点/样式/团队库/变量，或只动选区与视口） */
const READ_ONLY: readonly string[] = [
  // 文档 / 节点 / 搜索
  'document_get_info', 'selection_get', 'node_get', 'node_get_root',
  'dsl_export_selection', 'dsl_export_node',
  // 设计分析 / 代码桥接（纯读取与转换）
  'design_describe', 'design_review', 'design_to_code', 'design_to_code_update',
  // 组件 / 图标 / 样式查询
  'component_list', 'component_search', 'icon_search', 'style_list_colors', 'style_list_text', 'fonts_list',
  // 页面与会话
  'page_list', 'page_switch', 'session_list', 'session_switch',
  // 画布视图（只动视口）
  'canvas_zoom_to_node', 'canvas_zoom_to_rect',
  // 团队库 / 变量查询
  'team_library_list', 'team_component_search', 'team_style_list', 'variable_list',
  // 环境 / 规则 / 代码库
  'plugin_capabilities', 'codebase_get_structure', 'get_version', 'get_guidelines',
  // Agent 状态查询
  'agent_get_status',
  // 诊断工具（在 register-tools 中单独注册）
  'health_get', 'dsl_spec',
]

/** 破坏性：删除或原地替换，可能丢内容 */
const DESTRUCTIVE: readonly string[] = [
  'node_delete',
  'node_convert_to_component', 'node_swap_component',
  'node_detach_instance',
  'page_delete', 'variable_delete',
]

/** 有副作用但非破坏性：显式登记，便于门禁保证「每个工具都被想过一遍」 */
const MUTATING: readonly string[] = [
  // 节点写入
  'node_create', 'node_update',
  'node_clone', 'node_move', 'node_export_image', 'node_export_batch', 'search_nodes',
  'node_group', 'node_boolean',
  // 设计生成 / 修改
  'code_to_design', 'design_suggest',
  'component_render', 'component_state_matrix', 'icon_render',
  // 样式 / 库
  'library_register_styles', 'style_apply',
  // 页面 / 选区 / 会话与会话内动作
  'page_create', 'page_rename', 'selection_set', 'notify',
  'task_plan', 'task_step', 'task_complete',
  // 团队库导入 / 同步（同步会写缓存文件）
  'team_component_import', 'team_style_import', 'team_library_sync',
  // 变量写入
  'variable_create', 'variable_update',
  // Agent 执行
  'agent_design_by_intent', 'agent_iterate_design',
]

/** 分类表：工具名 → annotations（未分类工具不产生字节） */
const ANNOTATION_MAP: Record<string, ToolAnnotations> = {}
for (const name of READ_ONLY) ANNOTATION_MAP[name] = { readOnlyHint: true }
for (const name of DESTRUCTIVE) ANNOTATION_MAP[name] = { destructiveHint: true }
for (const name of MUTATING) ANNOTATION_MAP[name] = {}

/** 查注解：未登记返回 undefined（工具定义里就不挂 annotations 字段） */
export function getToolAnnotations(name: string): ToolAnnotations | undefined {
  const annotations = ANNOTATION_MAP[name]
  // 空对象（纯写入类）不返回，省掉 tools/list 里的字节
  if (!annotations || Object.keys(annotations).length === 0) return undefined
  return annotations
}

/** 已显式登记的工具名（门禁断言用：每个工具都必须被想过一遍） */
export function classifiedToolNames(): string[] {
  return Object.keys(ANNOTATION_MAP)
}

/** 只读工具名（门禁断言用） */
export function readOnlyToolNames(): string[] {
  return [...READ_ONLY]
}

/** 破坏性工具名（门禁断言用） */
export function destructiveToolNames(): string[] {
  return [...DESTRUCTIVE]
}

/** 给工具定义挂上 annotations（不改动原对象的其它字段） */
export function applyToolAnnotations<T extends { name: string }>(tool: T): T & { annotations?: ToolAnnotations } {
  const annotations = getToolAnnotations(tool.name)
  return annotations ? { ...tool, annotations } : tool
}
