import type { MCPTool } from '../../types/mcp-types.js'

const agentDesignByIntent: MCPTool = {
  name: 'agent_design_by_intent',
  description: ' Design Agent 核心入口。输入自然语言设计需求，Agent 自动规划设计步骤、调用工具、渲染到画布、质量审查并迭代。一次调用完成从需求到设计的完整闭环。支持落地页/仪表盘/表单/列表/详情页等类型。',
  inputSchema: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        description: '自然语言设计需求描述',
      },
      mode: {
        type: 'string',
        enum: ['copilot', 'adviser', 'autonomous'],
        description: '自主执行模式，默认 copilot',
        default: 'copilot',
      },
      maxIterations: {
        type: 'number',
        description: '最大迭代优化次数，默认 3',
        default: 3,
      },
      applyFindings: {
        type: 'boolean',
        description: '把质量检查以注解输出到画布，默认 false',
        default: false,
      },
    },
    required: ['intent'],
  },
}

const agentGetStatus: MCPTool = {
  name: 'agent_get_status',
  description: '查询 Design Agent 会话状态。传入 sessionId 获取当前执行进度、步骤状态和质量报告。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Design Agent 会话 ID',
      },
    },
    required: ['sessionId'],
  },
}

const agentIterateDesign: MCPTool = {
  name: 'agent_iterate_design',
  description: '对已完成的设计会话触发新一轮迭代优化。适用于用户对结果不满意、希望 Agent 继续改进的场景。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Design Agent 会话 ID',
      },
      feedback: {
        type: 'string',
        description: '用户反馈或修改要求，Agent 将据此进行针对性迭代',
      },
    },
    required: ['sessionId'],
  },
}

export function getTools(): MCPTool[] {
  return [agentDesignByIntent, agentGetStatus, agentIterateDesign]
}
