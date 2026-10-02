import type { MCPTool } from '../../types/mcp-types.js'

const iconSearchTool: MCPTool = {
  name: 'icon_search',
  description: '搜索 Iconify 平台上的图标。默认搜索 Remix Icon (ri)，可指定其他图标集前缀。返回匹配的图标名称列表，搜索结果可直接在 HTML 中通过 data-icon 属性使用（由 code_to_design 自动渲染为 SVG），也可传入 icon_render 直接渲染到画布',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '图标名关键词' },
      prefix: { type: 'string', description: '图标集前缀，如 "ri"；不传搜全部' },
      limit: { type: 'number', description: '返回结果数量限制，默认 20，最大 100', default: 20 },
    },
    required: ['query'],
  },
}

const iconRenderTool: MCPTool = {
  name: 'icon_render',
  description: '从 Iconify API 获取图标并直接渲染到设计画布。使用 "prefix:name" 格式指定图标，如 "ri:search-line"。自动完成：在线获取图标 → 生成 DSL → 渲染到画布。',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '图标名，"ri:search-line" 或 "search-line"' },
      x: { type: 'number', description: 'X 坐标（默认 0）' },
      y: { type: 'number', description: 'Y 坐标（默认 0）' },
      size: { type: 'number', description: '图标尺寸（默认 24）' },
      color: { type: 'string', description: '图标颜色，十六进制格式，如 "#ff0000"（默认 "#333333"）' },
      bgColor: { type: 'string', description: '背景色（可选），十六进制格式' },
      cornerRadius: { type: 'number', description: '背景圆角（默认 0，仅在 bgColor 存在时生效）' },
      strokeWidth: { type: 'number', description: '描边宽度（可选）' },
    },
    required: ['name'],
  },
}

const libraryRegisterStylesTool: MCPTool = {
  name: 'library_register_styles',
  description: '从 Token 面板的节点树中提取设计令牌，创建为 MasterGo 原生样式（Paint/Text/Effect/Spacing Style）。在 code_to_design 渲染 Token 面板后调用此工具，将视觉令牌注册到样式库中，后续可通过 getLocalPaintStyles() 等 API 读取。返回创建的样式列表。',
  inputSchema: {
    type: 'object',
    properties: {
      parentId: { type: 'string', description: 'Token 面板的父节点 ID（最外层的 section/frame 节点）' },
    },
    required: ['parentId'],
  },
}

const styleListColorsTool: MCPTool = {
  name: 'style_list_colors',
  description: '列出当前文档中的所有颜色样式（Paint Style），包括样式 id、名称、颜色类型、色值和透明度。适用于查看和管理设计系统中的颜色令牌。返回样式列表，含 paints 原始数据供 AI 分析。',
  inputSchema: {
    type: 'object',
    properties: {},
  },
}

const styleListTextTool: MCPTool = {
  name: 'style_list_text',
  description: '列出当前文档中的所有文本样式（Text Style），包括样式 id、名称、字体、字号、字重、行高、字间距。适用于查看设计系统的排版规范。',
  inputSchema: {
    type: 'object',
    properties: {},
  },
}

const styleApplyTool: MCPTool = {
  name: 'style_apply',
  description: '将指定样式（颜色/文本）应用到画布上的节点。支持 fill（填充颜色）、stroke（描边颜色）、text（文本样式）三种样式类型。调用前请先用 style_listColors / style_listText 获取样式的 id。',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '目标节点 ID' },
      styleId: { type: 'string', description: '要应用的样式 ID' },
      styleType: { type: 'string', enum: ['fill', 'stroke', 'text'], description: '样式类型：fill=填充颜色, stroke=描边颜色, text=文本样式' },
    },
    required: ['nodeId', 'styleId', 'styleType'],
  },
}

const fontsListTool: MCPTool = {
  name: 'fonts_list',
  description:
    '列出当前文档可用字体（family / style / referrer）。创建或更新文本前先用它确认字体可用，避免指定了宿主机没有的字体而静默回退；同一文档内结果稳定，不必重复调用。',
  inputSchema: {
    type: 'object',
    properties: {},
  },
}

export function getTools(): MCPTool[] {
  return [iconSearchTool, iconRenderTool, libraryRegisterStylesTool, styleListColorsTool, styleListTextTool, styleApplyTool, fontsListTool]
}
