import type { MCPTool } from '../../types/mcp-types.js'

/**
 * 变量系统（Design Token）工具定义
 *
 * 对应插件方法：variable_list / variable_create / variable_update / variable_delete
 * （服务端按 `_` → `/` 映射为 variable/list、variable/create …）
 *
 * 客户端能力：`mg.variables` 可用（私有版实测，MasterGoPrivate 1.10.3）；
 * Design Token 类型：COLOR / NUMBER / STRING / BOOLEAN / PAINT / TEXT / EFFECT / GRID。
 */

/** 变量类型枚举（与 mg.variables 的 VariableType 对齐，共 12 种） */
const VARIABLE_TYPES = [
  'COLOR',
  'NUMBER',
  'STRING',
  'BOOLEAN',
  'PAINT',
  'TEXT',
  'EFFECT',
  'GRID',
  'STROKE_WIDTH',
  'CORNER_RADIUS',
  'PADDING',
  'SPACING',
] as const

/** 变量适用范围（ScopeName），决定该 Token 能绑到哪些图层属性上 */
const SCOPE_NAMES = [
  'all',
  'fill',
  'fillAll',
  'shapeFill',
  'textFill',
  'stroke',
  'effect',
  'grid',
  'widthHeight',
  'cornerRadius',
  'opacity',
  'layoutSpacing',
  'layoutPadding',
  'fontSize',
  'fontWeight',
  'textLineHeight',
  'textLetterSpacing',
  'textParagraphSpacing',
  'fontFamily',
  'textContent',
] as const

const variableListTool: MCPTool = {
  name: 'variable_list',
  description:
    '列出文档的变量（Design Token）：集合、各集合的 Mode、变量清单及各模式下的值，用于在生成设计前了解设计系统里有哪些 Token。空文档或客户端不支持时返回空数组 / available:false，不报错。返回字段口径见 rules/07-mcp-tools.md。',
  inputSchema: {
    type: 'object',
    properties: {
      collectionId: {
        type: 'string',
        description: '只看指定集合 ID',
      },
      type: {
        type: 'string',
        enum: [...VARIABLE_TYPES],
        description: '只看某一类变量，不传返回全部',
      },
      groupPath: {
        type: 'string',
        description: '只看该分组路径的变量，如 "color/brand"',
      },
      includeExternal: {
        type: 'boolean',
        description: '是否包含团队库外部变量，默认 false',
      },
      includeValues: {
        type: 'boolean',
        description: '是否返回值（键为 modeId），默认 true',
      },
    },
  },
}

const variableCreateTool: MCPTool = {
  name: 'variable_create',
  description:
    '创建变量（Design Token）。不传 collectionId 落在第一个集合（没有则先建 "Design Tokens"）。批量传 variables[]。value 形状随 type（COLOR 用十六进制串）。',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '变量名，支持分组路径 color/brand/primary' },
      type: {
        type: 'string',
        enum: [...VARIABLE_TYPES],
        description: '变量类型',
      },
      value: {
        description: '初始值，形状随 type',
      },
      variables: {
        type: 'array',
        description: '批量建令牌：[{name,type,value}]（与 name 二选一）',
        items: { type: 'object' },
      },
      collectionId: { type: 'string', description: '目标集合 ID' },
      description: { type: 'string', description: '变量说明' },
    },
  },
}

const variableUpdateTool: MCPTool = {
  name: 'variable_update',
  description:
    '增量更新变量：name / description / value / codeSyntax / scopes / alias，只写实际传入的字段（applied 精确列出生效项）。传 nodeIds 时改为**绑定**：把该变量绑到这些节点（Penpot 真绑定；集合未激活时绑定不驱动渲染，用 activateSet 激活）。',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '变量 ID（必填）' },
      name: { type: 'string', description: '新变量名（支持 "color/brand/primary" 分组路径）' },
      description: { type: 'string', description: '新的变量描述' },
      value: {
        description: '新值，形状随 type；不传则不改',
      },
      modeId: { type: 'string', description: '写入哪个模式；不传用集合第一个 Mode' },
      codeSyntax: {
        type: 'object',
        properties: {
          web: { type: 'string', description: 'Web 侧代码语法，如 var(--brand-primary)' },
          android: { type: 'string', description: 'Android 侧代码语法，如 BrandPrimary' },
          ios: { type: 'string', description: 'iOS 侧代码语法，如 brandPrimary' },
        },
        description: '代码语法（codeSyntax）：各平台导出代码时使用的标识符',
      },
      scopes: {
        type: 'array',
        items: { type: 'string', enum: [...SCOPE_NAMES] },
        description: '适用范围（enum 见 schema），限制可绑定属性',
      },
      alias: { type: 'string', description: '变量别名（alias，语义化引用名，如 "Brand/Primary"）' },
      nodeIds: {
        type: 'array',
        items: { type: 'string' },
        description: '传则改为绑定：目标节点 ID 列表',
      },
      properties: {
        type: 'array',
        items: { type: 'string' },
        description: '绑定属性，默认 ["fill"]',
      },
      activateSet: { type: 'boolean', description: '顺带激活/停用令牌集合（不激活则绑定不驱动渲染）' },
    },
    required: ['id'],
  },
}

const variableDeleteTool: MCPTool = {
  name: 'variable_delete',
  description:
    '删除变量或整个变量集合（collectionId(s) 会连集合内变量一起删）。支持单个与批量，部分失败不中断（failed 列出）。不可撤销（仅能靠客户端撤销），已绑定到图层的引用会失效——删前先用 variable_list 确认目标。',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '要删除的单个变量 ID' },
      ids: { type: 'array', items: { type: 'string' }, description: '要批量删除的变量 ID 列表（与 id 二选一，同时传则合并去重）' },
      collectionId: { type: 'string', description: '要删除的变量集合 ID（会连其中变量一起删）' },
      collectionIds: { type: 'array', items: { type: 'string' }, description: '要批量删除的集合 ID 列表' },
    },
  },
}

export function getVariableTools(): MCPTool[] {
  return [variableListTool, variableCreateTool, variableUpdateTool, variableDeleteTool]
}
