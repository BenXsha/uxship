import type { MCPTool } from '../../types/mcp-types.js'

const canvasZoomToNodeTool: MCPTool = {
  name: 'canvas_zoom_to_node',
  description: '把画布可视区聚焦到指定节点（自动滚动 + 缩放使节点完整可见），可选同时选中它。设计/渲染完成后用它把用户视角带到刚完工的对象。不传 nodeId/nodeIds 时对当前选区生效。返回聚焦后的缩放比例、可视区边界与真正被聚焦的节点。',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '要聚焦的单个节点 ID' },
      nodeIds: { type: 'array', items: { type: 'string' }, description: '批量聚焦的节点 ID 列表（会框住这些节点的范围）' },
      useSelection: { type: 'boolean', description: '未传 nodeId/nodeIds 时是否回退到当前选区，默认 true', default: true },
      select: { type: 'boolean', description: '聚焦后是否同时选中这些节点，默认 true；false 则保留用户原选区', default: true },
      zoom: { type: 'number', description: '强制缩放比例（1 = 100%），不传自动' },
    },
  },
}

const canvasZoomToRectTool: MCPTool = {
  name: 'canvas_zoom_to_rect',
  description: '把画布可视区聚焦到画布坐标上的矩形区域（自动滚动 + 缩放）。适合聚焦一个已知位置的范围（如某块区域的 x/y/width/height）。不改变选中状态。',
  inputSchema: {
    type: 'object',
    properties: {
      x: { type: 'number', description: '矩形左上角 X 坐标（画布坐标，必填）' },
      y: { type: 'number', description: '矩形左上角 Y 坐标（画布坐标，必填）' },
      width: { type: 'number', description: '矩形宽度，默认 100' },
      height: { type: 'number', description: '矩形高度，默认 100' },
      zoom: { type: 'number', description: '可选：聚焦后强制设置的缩放比例（1 = 100%）' },
    },
    required: ['x', 'y'],
  },
}

const selectionSetTool: MCPTool = {
  name: 'selection_set',
  description: '改变画布选中状态：按节点 ID 选中、追加选中、全选或清空。常与 canvas_zoom_to_node 搭配（先选中再聚焦）。nodeIds 传空数组即清空选中。',
  inputSchema: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: '要选中的节点 ID 列表；传空数组 [] 表示清空选中' },
      addToSelection: { type: 'boolean', description: '是否追加到现有选区（默认 false，即替换选区）', default: false },
      selectAll: { type: 'boolean', description: '选中当前页面所有节点（优先级高于 nodeIds）', default: false },
    },
  },
}

const pluginCapabilitiesTool: MCPTool = {
  name: 'plugin_capabilities',
  description:
    '探测宿主（MasterGo 客户端）插件 API 版本与能力开关（teamLibrary / node / export / variables / misc 各新 API 的运行时可用性）。接入任何新插件 API 前先调用：typings 只是声明，实际支持取决于客户端版本。',
  inputSchema: { type: 'object', properties: {} },
}

const pageListTool: MCPTool = {
  name: 'page_list',
  description: '列出当前文档中的所有页面，返回每个页面的 id、name 和 type，以及当前页面 ID',
  inputSchema: { type: 'object', properties: {} },
}

const pageCreateTool: MCPTool = {
  name: 'page_create',
  description: '创建新页面。**新页不会自动成为当前页**：响应给 currentPageId 与 hint；要马上在新页建节点就传 switchToNew:true，或随后显式 page_switch。',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: '新页面名称' }, switchToNew: { type: 'boolean', description: '创建后立即切到新页（默认 false）' } },
    required: ['name'],
  },
}

const pageDeleteTool: MCPTool = {
  name: 'page_delete',
  description: '删除指定页面',
  inputSchema: {
    type: 'object',
    properties: { pageId: { type: 'string', description: '要删除的页面 ID' } },
    required: ['pageId'],
  },
}

const pageSwitchTool: MCPTool = {
  name: 'page_switch',
  description: '切换到指定页面。响应含 applied（是否已回读确认为目标页）——宿主切页可能排队异步，applied:false 时请在 page_list 复核后再做跨页操作；已是当前页则 alreadyCurrent:true。',
  inputSchema: {
    type: 'object',
    properties: { pageId: { type: 'string', description: '目标页面 ID' } },
    required: ['pageId'],
  },
}

const pageRenameTool: MCPTool = {
  name: 'page_rename',
  description: '重命名指定页面',
  inputSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: '要重命名的页面 ID' },
      name: { type: 'string', description: '新页面名称' },
    },
    required: ['pageId', 'name'],
  },
}

const taskPlanTool: MCPTool = {
  name: 'task_plan',
  description: '向插件端发送任务执行计划，插件会显示步骤列表和实时进度。在多步操作前先调用此工具制定计划，每步执行后调用 task_step 更新状态，完成时调用 task_complete。',
  inputSchema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        description: '步骤列表，每个步骤包含 id 和 label',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '步骤唯一标识（kebab-case）' },
            label: { type: 'string', description: '步骤中文描述' },
          },
          required: ['id', 'label'],
        },
      },
    },
    required: ['steps'],
  },
}

const taskStepTool: MCPTool = {
  name: 'task_step',
  description: '更新任务步骤的执行状态。每步开始设为 running，完成设为 completed，失败设为 failed。',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '步骤 ID（与 task_plan 中一致）' },
      status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'], description: '步骤状态' },
      message: { type: 'string', description: '可选的附加信息（如错误原因）' },
    },
    required: ['id', 'status'],
  },
}

const taskCompleteTool: MCPTool = {
  name: 'task_complete',
  description: '标记整个任务执行完成（成功或失败）。所有步骤执行完毕后调用。',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['success', 'failed'], description: '任务最终状态' },
      message: { type: 'string', description: '可选的总结信息' },
    },
    required: ['status'],
  },
}

const sessionListTool: MCPTool = {
  name: 'session_list',
  description: '列出当前所有已连接的 MasterGo 插件会话，每个会话对应一个打开的设计文档。返回每个会话的 sessionId、文档信息、页面信息和连接时间。在生成新设计前应先调用此工具了解可用文档。',
  inputSchema: { type: 'object', properties: {} },
}

const sessionSwitchTool: MCPTool = {
  name: 'session_switch',
  description: '切换目标插件会话，后续调用路由到它。定位：clientId（最精确，推荐）/ codename（如 Nova）/ sessionId。同一文档多个插件实例时 sessionId 相同，须用 clientId 或 codename；session_list 返回体里有这两个字段。',
  inputSchema: {
    type: 'object',
    properties: {
      clientId: { type: 'number', description: '目标客户端 ID，多实例时最精确（推荐）' },
      codename: { type: 'string', description: '插件代号（如 "Nova"），不保证唯一' },
      sessionId: { type: 'string', description: '目标会话 ID；多实例同文档时相同' },
    },
  },
}

const notifyTool: MCPTool = {
  name: 'notify',
  description: '在 MasterGo 画布上显示通知消息，用于提示用户操作结果',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: '通知消息内容' },
      options: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['info', 'warning', 'error'], description: '通知类型（默认 info）' },
        },
      },
    },
    required: ['message'],
  },
}

const serverVersionTool: MCPTool = {
  name: 'get_version',
  description: '获取 MasterGo MCP 服务器版本信息，包括版本号、Node.js 版本、运行时间等。调试和确认服务器状态时使用',
  inputSchema: { type: 'object', properties: {} },
}

const getGuidelinesTool: MCPTool = {
  name: 'get_guidelines',
  description: '获取 MasterGo 设计规则文档。AI 在设计前应调用此工具加载相关规则，确保生成的 HTML+Tailwind 符合设计系统规范。支持按 topic 过滤（如 layout/chart/dsl/design/quickstart/pitfalls），不传 topic 返回全部规则的索引',
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: '规则主题；不传返回索引（取值见工具文档）',
      },
    },
  },
}

const codebaseGetStructureTool: MCPTool = {
  name: 'codebase_get_structure',
  description: '扫描指定目录的源代码结构，返回模块树、入口文件、语言框架、配置文件摘要。是 AI 进行代码可视化（流程图/架构图）的前置分析工具。自动跳过 node_modules/.git/dist 等目录。',
  inputSchema: {
    type: 'object',
    properties: {
      dir: { type: 'string', description: '要分析的目录路径（绝对路径）。不传则使用当前工作目录' },
      depth: { type: 'number', description: '目录树深度（默认 3，最大 5）', default: 3 },
    },
  },
}

export function getTools(): MCPTool[] {
  return [
    pageListTool, pageCreateTool, pageDeleteTool, pageSwitchTool, pageRenameTool,
    canvasZoomToNodeTool, canvasZoomToRectTool, selectionSetTool,
    pluginCapabilitiesTool,
    taskPlanTool, taskStepTool, taskCompleteTool,
    sessionListTool, sessionSwitchTool,
    notifyTool, codebaseGetStructureTool,
    serverVersionTool, getGuidelinesTool,
  ]
}
