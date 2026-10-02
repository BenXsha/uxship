import type { MCPTool } from '../../types/mcp-types.js'

const componentListTool: MCPTool = {
  name: 'component_list',
  description: '列出当前文档中的所有 Component Master（可复用的组件定义），返回每个组件的 id、name、description 和 alias。在生成新设计前调用此工具发现已有设计系统组件，然后在 HTML 中使用 data-component-id 引用它们',
  inputSchema: {
    type: 'object',
    properties: {},
  },
}

const componentSearchTool: MCPTool = {
  name: 'component_search',
  description: '按名称模糊搜索当前文档中的 Component Master，返回匹配的组件列表及匹配类型（exact/prefix/fuzzy/description）。适合在不知道完整组件名时使用',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词，按组件名称/描述/别名模糊匹配' },
      limit: { type: 'number', description: '返回结果数量限制，默认 20' },
    },
    required: ['query'],
  },
}

const componentRenderTool: MCPTool = {
  name: 'component_render',
  description:
    '高阶组件渲染：一次调用创建完整 UI 组件，支持 33 种类型（见 type enum）。类型专属参数放入 props 自由对象（参数目录见 rules/16-component-catalog.md），也兼容历史平铺写法（平铺优先）。新增类型时在插件端 plugin-mastergo/lib/api/componentHandlers.ts 的 COMPONENT_RENDERERS 登记。',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['checkbox-group', 'radio-group', 'checkbox', 'radio', 'button', 'text-input', 'badge', 'avatar', 'toggle', 'select', 'menu', 'tabs', 'progress', 'list', 'slider', 'breadcrumb', 'tooltip', 'divider', 'tag', 'spinner', 'modal', 'alert', 'pagination', 'steps', 'accordion', 'card', 'table', 'form', 'toast', 'skeleton', 'page-shell', 'feature-grid', 'pricing-table'],
        description: '组件类型（33 种，参数目录见 16-component-catalog.md）',
      },
      props: {
        type: 'object',
        description: '组件专属参数（目录见 16-component-catalog.md）；平铺等效',
      },
      position: { type: 'object', description: '画布位置', properties: { x: { type: 'number', description: 'X 坐标' }, y: { type: 'number', description: 'Y 坐标' } } },
      theme: { type: 'object', description: '设计令牌覆盖，支持 mode: "dark"' },
    },
    required: ['type'],
  },
}

const componentStateMatrixTool: MCPTool = {
  name: 'component_state_matrix',
  description:
    '为指定组件类型生成交互状态矩阵：创建各状态的 COMPONENT master 并排展示。naming="variant" 会 combineAsVariants 合成 ComponentSet（Assets 面板可见多态属性）。支持的组件类型与状态清单见 rules/07-mcp-tools.md。',
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', description: '组件类型（默认 button）' },
      config: { type: 'object', description: '组件配置，同 component_render 参数' },
      states: { type: 'array', items: { type: 'string' }, description: '状态列表（默认 default/hover/active 等 5 态）' },
      naming: { type: 'string', enum: ['default', 'variant'], description: '命名模式：default（DS_ 前缀）/ variant（原生变体组）' },
      variantPropertyName: { type: 'string', description: 'naming=variant 时的属性名（默认 State）' },
      position: { type: 'object', description: '渲染位置', properties: { x: { type: 'number', description: 'X 坐标，默认 100' }, y: { type: 'number', description: 'Y 坐标，默认 100' } } },
    },
  },
}

export function getTools(): MCPTool[] {
  return [componentListTool, componentSearchTool, componentRenderTool, componentStateMatrixTool]
}
