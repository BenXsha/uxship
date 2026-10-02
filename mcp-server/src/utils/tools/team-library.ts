import type { MCPTool } from '../../types/mcp-types.js'

const teamLibraryListTool: MCPTool = {
  name: 'team_library_list',
  description: '列出团队组件库（团队库 / 团队组件库）及其内容概览：库名、组件数、样式数。数据来自团队库索引缓存（.uxship/team-library.json），缓存缺失或过期时自动向 MasterGo 插件拉取。生成设计前先调用它了解可用团队资产，再用 team_component_search 找到具体组件的 ukey，最后用 team_component_import 实例化到画布。',
  inputSchema: {
    type: 'object',
    properties: {
      library: { type: 'string', description: '只查看指定团队库（按库名或库 id，支持模糊匹配），不传则列出全部' },
      includeComponents: { type: 'boolean', description: '是否返回组件清单（含 ukey），默认 true' },
      includeStyles: { type: 'boolean', description: '是否返回样式分组明细，默认 false' },
      refresh: { type: 'boolean', description: '忽略缓存强制重新向插件拉取团队库索引，默认 false' },
    },
  },
}

const teamComponentSearchTool: MCPTool = {
  name: 'team_component_search',
  description: '在团队组件库中搜索组件（Component / ComponentSet），返回名称、所属库、ukey、尺寸与匹配类型。ukey 可直接传给 team_component_import 导入并实例化，或在 HTML 中用 data-library-component="<ukey>" 引用。支持按库过滤、按类型过滤、限制返回条数。',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词，留空列出全部' },
      library: { type: 'string', description: '限定团队库（库名或库 id，支持模糊匹配）' },
      type: { type: 'string', enum: ['COMPONENT', 'COMPONENT_SET'], description: '限定组件类型，不传不过滤' },
      limit: { type: 'number', description: '返回条数上限，默认 20' },
      refresh: { type: 'boolean', description: '忽略缓存强制刷新团队库索引，默认 false' },
    },
    required: ['query'],
  },
}

const teamComponentImportTool: MCPTool = {
  name: 'team_component_import',
  description: '把团队组件库中的组件导入当前文档并创建实例（Instance）放到画布上。支持按 ukey 精确引用，或按 component(+library) 名称自动解析。可一次导入多个（components 数组）并按 row/column/grid 自动排布。组件集（COMPONENT_SET）会自动落到指定 variant 或第一个 variant。导入后可用 overrides 覆写子节点文字/颜色/可见性。',
  inputSchema: {
    type: 'object',
    properties: {
      ukey: { type: 'string', description: '团队组件 ukey，最精确的引用方式' },
      component: { type: 'string', description: '组件名称（无 ukey 时按名称解析，需存在于团队库中）' },
      library: { type: 'string', description: '团队库名或 id，配合 component 名称缩小搜索范围' },
      type: { type: 'string', enum: ['COMPONENT', 'COMPONENT_SET'], description: '组件类型提示（决定导入 API）' },
      variant: { type: 'string', description: '组件集变体名片段，如 "Hover"' },
      variantProperties: { type: 'object', description: '变体属性覆写，如 {"State":"Hover"}' },
      x: { type: 'number', description: '实例 X 坐标（默认按布局游标，起始 100）' },
      y: { type: 'number', description: '实例 Y 坐标（默认按布局游标，起始 100）' },
      width: { type: 'number', description: '实例宽度覆盖（默认继承组件尺寸）' },
      height: { type: 'number', description: '实例高度覆盖（默认继承组件尺寸）' },
      parentId: { type: 'string', description: '父节点 ID，指定后实例会 appendChild 到该容器并使用容器坐标' },
      name: { type: 'string', description: '实例名称（默认使用组件名）' },
      overrides: { type: 'object', description: '按子节点名覆写文字/颜色/可见性' },
      components: { type: 'array', description: '批量导入，元素与顶层参数同构' },
      layout: { type: 'string', enum: ['row', 'column', 'none'], description: '批量导入时的自动排布方式，默认 row；none 表示不做排布（用元素自身坐标）' },
      columns: { type: 'number', description: 'layout=row 时每行个数（网格排布），不传则单行' },
      gap: { type: 'number', description: '自动排布间距，默认 24' },
      startX: { type: 'number', description: '自动排布起始 X，默认 100' },
      startY: { type: 'number', description: '自动排布起始 Y，默认 100' },
    },
  },
}

const teamStyleListTool: MCPTool = {
  name: 'team_style_list',
  description: '列出团队组件库中的样式令牌（团队样式库）：颜色(paints)、文本(texts)、效果(effects)、网格(grids)、描边宽(strokeWidths)、圆角(cornerRadiuses)、内边距(paddings)、间距(spacings)。返回样式名与 ukey，可传给 team_style_import 导入当前文档并应用。',
  inputSchema: {
    type: 'object',
    properties: {
      group: { type: 'string', enum: ['paints', 'effects', 'texts', 'grids', 'strokeWidths', 'cornerRadiuses', 'paddings', 'spacings'], description: '样式分组，不传则返回全部组' },
      library: { type: 'string', description: '限定团队库（库名或库 id）' },
      query: { type: 'string', description: '按样式名/描述过滤' },
      limit: { type: 'number', description: '返回条数上限，默认 50' },
      refresh: { type: 'boolean', description: '忽略缓存强制刷新团队库索引，默认 false' },
    },
  },
}

const teamStyleImportTool: MCPTool = {
  name: 'team_style_import',
  description: '把团队样式库中的样式导入当前文档（进入本地样式库），可选同时应用到指定节点。支持按 ukey 或按名称解析，可批量（ukeys）。颜色样式可应用到 fill 或 stroke，文本样式应用 textStyleId，效果应用 effectStyleId 等。',
  inputSchema: {
    type: 'object',
    properties: {
      ukey: { type: 'string', description: '团队样式 ukey（从 team_style_list 获取）' },
      ukeys: { type: 'array', items: { type: 'string' }, description: '批量导入的样式 ukey 列表' },
      name: { type: 'string', description: '样式名称（无 ukey 时按名称解析）' },
      library: { type: 'string', description: '团队库名或 id，配合 name 缩小范围' },
      group: { type: 'string', enum: ['paints', 'effects', 'texts', 'grids', 'strokeWidths', 'cornerRadiuses', 'paddings', 'spacings'], description: '样式分组提示，用于按名称解析时缩小范围' },
      applyTo: { type: 'string', description: '要应用样式的目标节点 ID（可选）' },
      applyAs: { type: 'string', enum: ['fill', 'stroke'], description: '颜色样式（paints）应用位置：fill(默认) 或 stroke' },
    },
  },
}

const teamLibrarySyncTool: MCPTool = {
  name: 'team_library_sync',
  description: '同步团队组件库索引到本地缓存文件，供后续 team_library_list / team_component_search / team_style_list 离线检索使用。返回缓存路径、库数量、组件与样式统计。团队库发生变化后（新增/改名/删除组件）调用一次即可。',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '缓存路径覆盖，默认 .uxship/team-library.json' },
      includeCover: { type: 'boolean', description: '是否缓存组件封面图地址（体积大），默认 false' },
    },
  },
}

export function getTools(): MCPTool[] {
  return [
    teamLibraryListTool,
    teamComponentSearchTool,
    teamComponentImportTool,
    teamStyleListTool,
    teamStyleImportTool,
    teamLibrarySyncTool,
  ]
}
