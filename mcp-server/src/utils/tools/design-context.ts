import type { MCPTool } from '../../types/mcp-types.js'

const getDocumentInfoTool: MCPTool = {
  name: 'document_get_info',
  description: '获取当前 MasterGo 文档的基本信息，包括文件名、页面数量等',
  inputSchema: {
    type: 'object',
    properties: {},
  },
}

const getSelectionTool: MCPTool = {
  name: 'selection_get',
  description: '获取当前选中的节点列表',
  inputSchema: {
    type: 'object',
    properties: {},
  },
}

const getNodeTool: MCPTool = {
  name: 'node_get',
  description: '根据节点 ID 获取节点详情，包括位置、尺寸、样式等属性',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '节点的唯一标识符' },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: '只返回这些字段（省上下文）；id 始终返回；见 07-mcp-tools.md',
      },
    },
    required: ['nodeId'],
  },
}

const searchFindTool: MCPTool = {
  name: 'search_nodes',
  description:
    '在当前页面中搜索符合条件的节点。条件：name（传字符串即可，包含匹配）/ types / colors / 尺寸 / 阴影等；命中节点默认被选中——只查不改、不想动用户选区时传 select:false。',
  inputSchema: {
    type: 'object',
    properties: {
      // 联合形状（字符串或对象）不声明 type：声明 type:'object' 会让传字符串的调用
      // 在 zod 校验层就被拒（走不到插件端的形状归一化）
      name: {
        description: '名称过滤：字符串（包含匹配）或 {value, matchType}',
      },
      types: {
        type: 'array',
        items: { type: 'string', enum: ['RECTANGLE', 'TEXT', 'ELLIPSE', 'FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'BOOLEAN_OPERATION', 'LINE', 'PEN', 'POLYGON', 'STAR'] },
        description: '按节点类型过滤',
      },
      colors: {
        description: '颜色过滤：["#fff"] 或 [{color,type,tolerance}]',
      },
      hasShadow: { type: 'boolean', description: '是否有阴影效果' },
      hasBlur: { type: 'boolean', description: '是否有模糊效果' },
      minSize: {
        description: '最小尺寸：数字 或 {width,height}',
      },
      maxSize: {
        description: '最大尺寸：数字 或 {width,height}',
      },
      opacity: { type: 'object', description: '透明度范围', properties: { min: { type: 'number', minimum: 0, maximum: 1, description: '最小透明度' }, max: { type: 'number', minimum: 0, maximum: 1, description: '最大透明度' } } },
      limit: { type: 'number', description: '返回结果数量限制，默认为100' },
      select: { type: 'boolean', description: '是否把命中节点设为选区（默认 true）；false 不动选区' },
    },
  },
}

export function getTools(): MCPTool[] {
  return [getDocumentInfoTool, getSelectionTool, getNodeTool, searchFindTool]
}
