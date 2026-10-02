import type { MCPTool } from '../../types/mcp-types.js'

const CHAIN_CONVERT_PARAMS = {
  convertToCode: { type: 'boolean', description: 'true 时返回原始 DSL+SVG 资产，不进 AI 上下文，默认 false' },
  exportSvgs: { type: 'boolean', description: '仅 convertToCode 时导出图标 SVG，默认 false' },
  svgOutputDir: { type: 'string', description: 'SVG 输出目录名，默认 "icons"' },
}

const codeToDesignTool: MCPTool = {
  name: 'code_to_design',
  description:
    '⭐ HTML+Tailwind → MasterGo 画布的唯一推荐路径：服务端预处理（图标/图表/组件）→ 客户端浏览器真实渲染 → 提取精确像素 → 画布。传 filePath 或 html 字符串，不要自己传 DSL。渲染完自动聚焦并选中新节点（focus/select 可关）。',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'HTML 文件绝对路径（与 html 二选一，优先）' },
      html: { type: 'string', description: 'HTML+Tailwind 代码字符串（与 filePath 二选一）' },
      renderMode: { type: 'string', enum: ['client'], description: '渲染模式。仅支持 client：插件浏览器渲染→提取像素→建图' },
      focus: { type: 'boolean', description: '渲染后自动聚焦新设计，默认 true', default: true },
      select: { type: 'boolean', description: '自动聚焦时是否同时选中根节点（默认 true）', default: true },
      options: {
        type: 'object',
        description: '可选渲染配置',
        properties: {
          version: { type: 'string', description: 'DSL 版本号，默认 "2.0"' },
          defaultWidth: { type: 'number', description: '默认画板宽度' },
          defaultHeight: { type: 'number', description: '默认画板高度' },
        },
      },
    },
  },
}

const exportSelectionTool: MCPTool = {
  name: 'dsl_export_selection',
  description: '将当前选中的节点导出为DSL格式。设置 convertToCode: true 可跳过 AI 上下文直接获得原始 DSL + SVG 资产，AI 直读渲染',
  inputSchema: {
    type: 'object',
    properties: { ...CHAIN_CONVERT_PARAMS },
  },
}

const exportNodeTool: MCPTool = {
  name: 'dsl_export_node',
  description: '根据节点 ID 将指定节点导出为 DSL 格式。设置 convertToCode: true 可跳过 AI 上下文直接获得原始 DSL + SVG 资产，AI 直读渲染',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: '要导出的节点 ID' },
      ...CHAIN_CONVERT_PARAMS,
    },
    required: ['nodeId'],
  },
}

const designToCodeTool: MCPTool = {
  name: 'design_to_code',
  description: '将 MasterGo DSL JSON 转换为可直接使用的格式。输入为 DSL 文档对象（由 dsl_exportSelection 或 dsl_exportNode 导出）或 nodeId（服务端自行调插件导出）。返回原始 DSL + SVG 资产，AI 直读渲染。支持 exportSvgs 选项导出图标文件。',
  inputSchema: {
    type: 'object',
    properties: {
      dsl: {
        type: 'object',
        description: 'DSL 文档对象，包含 version 和 elements 数组',
        properties: {
          version: { type: 'string', description: 'DSL 版本号，如 "2.0"' },
          elements: { type: 'array', description: 'DSL 元素数组' },
        },
        required: ['version', 'elements'],
      },
      options: {
        type: 'object',
        description: '可选配置',
        properties: {
          exportSvgs: { type: 'boolean', description: '导出 __svg 图标为独立文件，默认 false', default: false },
          svgOutputDir: { type: 'string', description: 'SVG 输出目录，默认 "icons"', default: 'icons' },
          exportTokens: { type: 'boolean', description: '提取设计令牌（CSS/Tailwind/DTCG）', default: false },
          exportCss: { type: 'boolean', description: '导出宿主原生 CSS + @font-face（需 nodeId）', default: false },
          syncTokens: { type: 'boolean', description: '把 palette 写入画布令牌并激活集合', default: false },
          darkMode: { type: 'boolean', description: '暗色主题（令牌导出）', default: false },
          theme: { type: 'object', description: '主题色（令牌导出）', properties: { brand: { type: 'string', description: '品牌色' } } },
        },
      },
    },
    // 不声明 required：dsl 与 nodeId 二者其一即可（handler 校验），
    // 声明 required:['dsl'] 会让只传 nodeId 的调用在 schema 层就被拒
  },
}

const designToCodeUpdateTool: MCPTool = {
  name: 'design_to_code_update',
  description: '基于 DesignCache session 增量导出并转换代码。传入 sessionId 和变化的节点 ID，服务端只重新生成变化的子树代码，极大节省 token。首次调用需先通过 dsl_exportSelection({ convertToCode: true }) 创建 session',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'DesignCache 会话 ID（首次导出时返回）' },
      nodeIds: { type: 'array', items: { type: 'string' }, description: '变化的节点 ID 列表（非全量导出，只传变化的节点）' },
      framework: { type: 'string', enum: ['html', 'react', 'vue3'], description: '输出框架。html（默认）输出 HTML+Tailwind' },
    },
    required: ['sessionId', 'nodeIds'],
  },
}

export function getTools(): MCPTool[] {
  return [codeToDesignTool, exportSelectionTool, exportNodeTool, designToCodeTool, designToCodeUpdateTool]
}
