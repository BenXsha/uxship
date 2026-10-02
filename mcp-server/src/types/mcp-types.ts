/**
 * MCP 协议类型定义
 * 参考: https://spec.modelcontextprotocol.io/
 */

/**
 * MCP 工具定义
 */
export interface MCPTool {
  /**
   * 工具名称（用于 MCP 协议），例如 document_getInfo
   * 转发到插件时自动转换为 document/getInfo
   */
  name: string

  /**
   * 工具描述
   */
  description: string
  
  /**
   * 输入参数 Schema
   *
   * `anyOf` / `oneOf` / `allOf` 是 JSON Schema 的**组合关键字**，用于表达 zod 类型
   * 表达不出的跨字段约束（最典型：「单体 / 批量」合并工具的「至少给一组」）。
   * 它们经 `utils/json-schema-to-zod.ts` 的 `.meta()` 原样透传到 `tools/list`。
   */
  inputSchema: {
    type: string
    properties?: Record<string, unknown>
    required?: string[]
    anyOf?: unknown[]
    oneOf?: unknown[]
    allOf?: unknown[]
  }

  /**
   * MCP annotations（客户端据此放行只读 / 确认破坏性操作）
   * 口径与登记见 `utils/tool-annotations.ts`
   */
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
  }
}

/**
 * MCP 资源定义
 */
export interface MCPResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

/**
 * MCP 能力
 */
export interface MCPCapabilities {
  tools?: {}
  resources?: {}
  prompts?: {}
}

/**
 * 初始化请求
 */
export interface InitializeRequest {
  protocolVersion: string
  capabilities: MCPCapabilities
  clientInfo: {
    name: string
    version: string
  }
}

/**
 * 初始化响应
 */
export interface InitializeResponse {
  protocolVersion: string
  capabilities: MCPCapabilities
  serverInfo: {
    name: string
    version: string
  }
}

/**
 * 工具调用请求
 */
export interface CallToolRequest {
  name: string
  arguments: Record<string, unknown>
}

/**
 * 工具调用响应
 */
export interface CallToolResponse {
  content: Array<{
    type: 'text' | 'image'
    text?: string
    data?: string
    mimeType?: string
  }>
  isError?: boolean
}

/**
 * 资源列表响应
 */
export interface ListResourcesResponse {
  resources: MCPResource[]
}

/**
 * 资源读取请求
 */
export interface ReadResourceRequest {
  uri: string
}

/**
 * 资源读取响应
 */
export interface ReadResourceResponse {
  contents: Array<{
    uri: string
    mimeType: string
    text?: string
    blob?: string
  }>
}

/**
 * MCP Prompt 定义
 */
export interface MCPPrompt {
  name: string
  description: string
  arguments?: Array<{
    name: string
    description?: string
    required?: boolean
  }>
}

/**
 * Prompts 列表响应
 */
export interface ListPromptsResponse {
  prompts: MCPPrompt[]
}

/**
 * Prompt 消息内容
 */
export interface PromptMessage {
  role: 'user' | 'assistant'
  content: {
    type: 'text'
    text: string
  }
}

/**
 * Prompt 获取响应
 */
export interface GetPromptResponse {
  description?: string
  messages: PromptMessage[]
}