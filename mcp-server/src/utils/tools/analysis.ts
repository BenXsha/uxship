import type { MCPTool } from '../../types/mcp-types.js'

const designDescribeTool: MCPTool = {
  name: 'design_describe',
  description: '获取节点的轻量结构化摘要（替代 DSL 导出），递归遍历子树返回扁平摘要。比 DSL 小 60-80%，适合 AI 快速理解布局结构后进行自然语言调整。返回节点名称、类型、位置、文本内容、布局概览',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '节点 ID' },
      depth: { type: 'number', description: '递归深度（默认 3，0 表示只返回当前节点）' },
      includeStyle: { type: 'boolean', description: '是否包含样式摘要（颜色、字体等），默认 false' },
    },
    required: ['nodeId'],
  },
}

const designSuggestTool: MCPTool = {
  name: 'design_suggest',
  description: '用自然语言指令修改设计（单体或批量）。单体：instruction 一条；批量：instructions 数组。AI 应先用 design_describe 看结构，并用自身 LLM 把复杂意图拆成原子指令（如 ["标题字号28","间距16"]）。返回 unmatched 即未被引擎匹配的指令。',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '目标节点 ID（画板、容器或具体元素）' },
      instruction: { type: 'string', description: '单体修改指令，如 "改成蓝色"、"间距加大"、"居中对齐圆角8"' },
      instructions: {
        type: 'array',
        items: { type: 'string' },
        description: '批量原子指令数组，给出即走批量路径',
      },
      autoApply: { type: 'boolean', description: 'true 直接应用到画布，默认 false 仅建议' },
      sessionId: { type: 'string', description: 'DesignCache 会话 ID，autoApply 后更新缓存' },
    },
    required: ['nodeId'],
    // 单体 instruction / 批量 instructions 二选一
    anyOf: [{ required: ['instruction'] }, { required: ['instructions'] }],
  },
}

const designReviewTool: MCPTool = {
  name: 'design_review',
  description: '对指定节点做设计自检：结构启发式（命名/字号/空容器/阴影裁剪）+ 可访问性硬指标（WCAG 对比度 4.5:1、大字号 3:1；`_Focus` 成员须 ≥2px 描边；交互元素点击区 ≥32×32 推荐 44×44）。返回 issues 与 a11y.skipped（取不到颜色/尺寸的项，不谎报通过）。',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '目标节点 ID' },
      depth: { type: 'number', description: '递归深度（默认 3）' },
    },
    required: ['nodeId'],
  },
}

export function getTools(): MCPTool[] {
  return [designDescribeTool, designSuggestTool, designReviewTool]
}
