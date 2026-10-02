import type { JSONRPCRequest, JSONRPCResponse } from '../types/index.js'
import { readHtmlContent, extractBodyContent } from './code-to-design-service.js'
import { preprocessHtml } from './html-preprocessor.js'
import { analyzeCodebase } from './codebase-analyzer.js'
import { getPluginMethod, resolvePluginMethod, isTaskProgressTool } from './tools.js'
import { normalizeGeometryArgs } from './geometry-args.js'
import { executeLocalTool } from './local-tools.js'
import { getGuidelines, getGuidelinesIndex } from './guidelines.js'
import { fetchIcon, buildIconDSL } from './icon-utils.js'
import { isImageExportResult, buildImageExportResponse } from './image-export.js'
import { buildExportBatchResponse } from './export-batch-save.js'
import { safeJsonParse, safeParseObject } from './safe-json.js'
import { planVariantGroups } from './variant-groups.js'
import { applyResponseBudget, HEAVY_OUTPUT_TOOLS } from './response-budget.js'
import { filterFields, parseFields } from './response-fields.js'
import type { DSLElement } from '../dsl-types.js'
import { safeCatch, safeCatchAsync } from './tool-error.js'
import { BackendAdapter } from './backend-adapter.js'
import {
  interpretIntention,
  createPlan,
  createSession,
  getSession,
  removeSession,
  pushCheckpoint,
  rollbackToPrevious,
  updateSessionStatus,
  advanceStep,
  updateStepResult,
  evaluateQuality,
  shouldIterate,
  getMaxIterations,
  intentionToPrompt,
  ROOT_NODE_ID_PLACEHOLDER,
} from '../agent/index.js'

/** 从 JSON-RPC 响应中安全提取首个文本内容 */
function extractResponseText(response: JSONRPCResponse): string | undefined {
  if ('error' in response || !response.result) return undefined
  const result = response.result as Record<string, unknown>
  const content = result.content
  if (!Array.isArray(content) || content.length === 0) return undefined
  const first = content[0] as Record<string, unknown>
  return typeof first.text === 'string' ? first.text : undefined
}
import { isPartitionRoutingEnabled, logRoute, resolvePartition } from './partition-router.js'
import { auditA11y, parseDescribeRoots } from './a11y-review.js'
import { SERVER_VERSION } from '../version.js'
import {
  handleTeamLibraryListTool,
  handleTeamComponentSearchTool,
  handleTeamStyleListTool,
  handleTeamLibrarySyncTool,
} from './team-library-service.js'

export interface PluginClientInfo {
  sessionId: string
  codename: string
  documentName: string
  documentId: string
  pageName: string
  pageId: string
  clientId: number
  connectedAt: number
  /** 后端标识（多后端聚合时由 BridgeRouter 填充；单桥模式下由桥自身填充） */
  backend?: string
  /** 客户端类型（如 mastergo-plugin / penpot-plugin），便于排查“连上了但没 announce” */
  clientType?: string
}

/**
 * 路由目标。
 * 同一文档下多个插件实例（如 Nova / Pixel）的 sessionId 相同，只有 clientId 唯一，
 * 因此 clientId 优先级高于 sessionId。
 */
export interface SessionTarget {
  sessionId?: string
  clientId?: number
}

/** 没有 sourceId 的客户端（HTTP POST /mcp、SSE SDK 路径）共用的兜底源标识 */
const DEFAULT_SESSION_SOURCE = '__default__'

export interface ToolRouterBridge {
  forwardRequest(request: JSONRPCRequest, sessionId?: string, clientId?: number): Promise<JSONRPCResponse>
  listPluginSessions(): Array<PluginClientInfo>
  /**
   * 会话列表 + 按需实时补全文档元数据（可选）。
   *
   * 实现它就启用「会话元数据自愈」：插件在 initialize 那一刻可能还不知道文档信息
   * （UI iframe 挂载早于沙箱注册消息监听 → 那一发 HELLO 会丢），实时问一次就能拿到。
   */
  listPluginSessionsResolved?(): Promise<PluginClientInfo[]>
  findPluginClientBySessionId(sessionId: string): PluginClientInfo | null
  findPluginClientByClientId(clientId: number): PluginClientInfo | null
  findPluginClientByCodename(codename: string): PluginClientInfo | null
  setActiveSession(sourceId: string, target: SessionTarget): void
  getActiveSession(sourceId?: string): SessionTarget | undefined
  sendNotification(method: string, params: any, sessionId?: string): void
  sendTaskPlan(steps: { id: string; label: string }[]): void
  sendTaskStep(id: string, status: 'pending' | 'running' | 'completed' | 'failed', message?: string): void
  sendTaskComplete(status: 'success' | 'failed', message?: string): void
  handleLocalTool(request: JSONRPCRequest): JSONRPCResponse | Promise<JSONRPCResponse>
}

/**
 * 输出侧预算接线：对「重输出」工具（HEAVY_OUTPUT_TOOLS）的 JSON 文本结果做**结构保持式截断**。
 *
 * 口径：
 * - 只改 `content[0].text` 的内容，**响应封装形状不变**（客户端仍收到 content[0].text）；
 * - 仅白名单工具生效，且**不碰** node_export_image / node_export_batch（自带 maxBytes / savePath 机制，
 *   叠两层会互相打架）与 health_get / dsl_spec / mcp_tools（诊断与工具面元数据，截断有害）；
 * - 调用方传 `maxChars`（数字）即作为本次上限，`0` = 不限（逃生阀）；
 * - 文本不是合法 JSON（错误文本等）或未超预算 → 原样返回，绝不重写字节；
 *   例外：命中了 `fields` 白名单时会按过滤后的结果重写（这是**调用方明确要求**的收窄，与预算无关）；
 * - `node_get` / `node_get_root` 支持 `fields` 白名单：在套用预算**之前**先过滤字段（只过滤顶层，
 *   嵌套子对象原样保留；`id` 始终返回），并把 `kept` / `missing` 写进 `_fields` —— `missing` 让 AI
 *   立刻知道自己字段名写错了，而不是以为「这个节点没有该字段」。
 */
function withOutputBudget(
  toolName: string,
  toolArgs: Record<string, unknown>,
  response: JSONRPCResponse,
): JSONRPCResponse {
  if (!HEAVY_OUTPUT_TOOLS.includes(toolName)) return response
  if (!('result' in response) || !response.result) return response

  const result = response.result as Record<string, unknown>
  const content = result.content
  if (!Array.isArray(content) || content.length === 0) return response
  const first = content[0] as Record<string, unknown> | undefined
  if (!first || typeof first.text !== 'string') return response

  let parsed: unknown
  try {
    parsed = JSON.parse(first.text)
  } catch {
    return response // 非 JSON 响应（错误文本 / 纯文案）→ 跳过预算，不破坏原响应
  }

  // `fields` 白名单：主动收窄优于超限后被动截断（只对节点查询类工具生效）
  let fieldsApplied = false
  if (toolName === 'node_get' || toolName === 'node_get_root') {
    const requested = parseFields((toolArgs as { fields?: unknown }).fields)
    if (requested.length > 0) {
      const filtered = filterFields(parsed, requested)
      parsed = filtered.payload
      // `_fields` 只能挂在对象根上；数组/标量根（异常形状）就只做过滤，不补说明
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsed = {
          ...(parsed as Record<string, unknown>),
          _fields: { kept: filtered.kept, missing: filtered.missing },
        }
      }
      fieldsApplied = true // 过滤本身就是结果变更，即使没超预算也要写回
    }
  }

  const rawMax = (toolArgs as { maxChars?: unknown }).maxChars
  const maxChars = typeof rawMax === 'number' && Number.isFinite(rawMax) ? rawMax : undefined
  const { payload, budget } = applyResponseBudget(toolName, parsed, { maxChars })
  // 未截断（或调用方用 maxChars: 0 关闭预算）且没做 fields 过滤 → 保持原字节
  if (!budget?.truncated && !fieldsApplied) return response

  return {
    ...response,
    result: {
      ...result,
      content: [{ ...first, text: JSON.stringify(payload) }, ...content.slice(1)],
    },
  }
}

/**
 * 处理仅在服务端执行的工具（LOCAL_TOOLS）。
 *
 * 优先交给 executeLocalTool（local-tools.ts）；若该工具不在本地实现中，
 * 回退到 bridge.handleLocalTool，保持 Method not found 的协议语义。
 * 本地执行抛出的真实错误以 isError 文本返回，不再静默变成 Method not found。
 */
async function handleLocalToolCall(
  request: JSONRPCRequest,
  bridge: ToolRouterBridge,
): Promise<JSONRPCResponse> {
  const callParams = request.params as { name: string; arguments?: Record<string, unknown> }
  const toolName = callParams.name
  const toolArgs = callParams.arguments || {}
  const id = request.id as string | number

  try {
    const result = await executeLocalTool(toolName, toolArgs)
    return withOutputBudget(toolName, toolArgs, {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
    })
  } catch (err: any) {
    const message = err?.message || String(err)
    if (/^Unknown local tool/.test(message)) {
      return bridge.handleLocalTool(request)
    }
    console.error(`[LocalTool] ${toolName} failed:`, message)
    return {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: message }], isError: true },
    }
  }
}

export async function routeToolCall(
  request: JSONRPCRequest,
  bridge: ToolRouterBridge,
  forwardToPluginRaw: (request: JSONRPCRequest, sessionId?: string, clientId?: number) => Promise<JSONRPCResponse>,
  sourceId?: string,
  backendAdapter?: BackendAdapter,
): Promise<JSONRPCResponse> {
  const callParams = request.params as { name: string; arguments?: Record<string, unknown> }
  const toolName = callParams.name
  const toolArgs = callParams.arguments || {}
  const id = request.id as string | number

  // 双模适配：如果 UXSHIP_MODE=http 且传入了 adapter，尝试走 HTTP
  const adapter = backendAdapter || new BackendAdapter()
  const forwardToPlugin = async (fwdRequest: JSONRPCRequest, sessionId?: string, clientId?: number): Promise<JSONRPCResponse> => {
    if (adapter.getMode() === 'http' && fwdRequest.method) {
      const result = await adapter.callEndpoint(fwdRequest.method, fwdRequest.params, null as any)
      if (result?.result) return result as JSONRPCResponse
      if (result?.error) {
        return {
          jsonrpc: '2.0',
          id: fwdRequest.id,
          result: { content: [{ type: 'text' as const, text: result.error }], isError: true },
        }
      }
    }
    return forwardToPluginRaw(fwdRequest, sessionId, clientId)
  }

  // 分区路由日志（PARTITION_ROUTING_ENABLED=true 时启用）
  if (isPartitionRoutingEnabled()) {
    const partition = resolvePartition(toolName)
    logRoute(toolName)
    console.error(`[Partition] ${toolName} → ${partition ?? 'unknown'}`)
  }

  // 任务进度工具
  if (isTaskProgressTool(toolName)) {
    if (toolName === 'task_plan') bridge.sendTaskPlan(toolArgs.steps as any[])
    else if (toolName === 'task_step') bridge.sendTaskStep(toolArgs.id as string, toolArgs.status as 'pending' | 'running' | 'completed' | 'failed', toolArgs.message as string | undefined)
    else if (toolName === 'task_complete') bridge.sendTaskComplete(toolArgs.status as 'success' | 'failed', toolArgs.message as string | undefined)
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] } }
  }

  // 共享工具（server 端处理）
  if (toolName === 'code_to_design') return handleCodeToDesign(toolArgs, id, bridge)
  if (toolName === 'design_suggest') {
    // 单体 / 批量合并：传 instructions 数组即走批量路径（见 analysis.ts 的工具定义）
    const instructions = toolArgs.instructions
    const isBatch = Array.isArray(instructions) && instructions.length > 0
    return isBatch
      ? handleDesignSuggestBatch(toolArgs, id, bridge)
      : handleDesignSuggest(toolArgs, id, bridge)
  }
  if (toolName === 'design_suggest_batch') return handleDesignSuggestBatch(toolArgs, id, bridge)
  if (toolName === 'design_review') return handleDesignReview(toolArgs, id, bridge)
  if (toolName === 'codebase_get_structure') return withOutputBudget(toolName, toolArgs, await handleCodebaseGetStructure(toolArgs, id))
  if (toolName === 'get_version') return handleGetVersion(toolArgs, id)
  if (toolName === 'get_guidelines') return handleGetGuidelines(toolArgs, id)
  if (toolName === 'design_to_code') return withOutputBudget(toolName, toolArgs, await handleDesignToCode(toolArgs, id, forwardToPlugin, bridge, sourceId))

  // 团队组件库：索引检索与同步在服务端完成（缓存文件），导入类工具上面已映射到插件方法
  if (toolName === 'team_library_list') return withOutputBudget(toolName, toolArgs, await handleTeamLibraryListTool(toolArgs, id, forwardToPlugin))
  if (toolName === 'team_component_search') return withOutputBudget(toolName, toolArgs, await handleTeamComponentSearchTool(toolArgs, id, forwardToPlugin))
  if (toolName === 'team_style_list') return withOutputBudget(toolName, toolArgs, await handleTeamStyleListTool(toolArgs, id, forwardToPlugin))
  if (toolName === 'team_library_sync') return handleTeamLibrarySyncTool(toolArgs, id, forwardToPlugin)

  // Design Agent 工具
  if (toolName === 'agent_design_by_intent') return handleAgentDesignByIntent(toolArgs, id, forwardToPlugin, bridge, sourceId)
  if (toolName === 'agent_get_status') return handleAgentGetStatus(toolArgs, id)
  if (toolName === 'agent_iterate_design') return handleAgentIterateDesign(toolArgs, id, forwardToPlugin, bridge, sourceId)

  // 会话管理工具
  if (toolName === 'session_list') {
    // 优先走「实时补全」版本：会话元数据不应依赖握手时序
    const sessions = bridge.listPluginSessionsResolved
      ? await bridge.listPluginSessionsResolved()
      : bridge.listPluginSessions()
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ sessions, total: sessions.length }) }] } }
  }
  if (toolName === 'session_switch') {
    const target = resolveSwitchTarget(toolArgs, bridge)
    if ('error' in target) return { jsonrpc: '2.0', id, error: target.error }
    const client = target.client
    // sourceId 为空时（HTTP /mcp、SSE SDK 路径）写入全局兜底源，保证切换依然生效
    bridge.setActiveSession(sourceId || DEFAULT_SESSION_SOURCE, { sessionId: client.sessionId, clientId: client.clientId })
    return {
      jsonrpc: '2.0', id, result: {
        content: [{ type: 'text', text: JSON.stringify({
          sessionId: client.sessionId, codename: client.codename,
          documentName: client.documentName, documentId: client.documentId,
          pageName: client.pageName, pageId: client.pageId,
          clientId: client.clientId, connectedAt: client.connectedAt, switched: true,
        }) }],
      },
    }
  }

  const target = extractTarget(toolArgs as Record<string, unknown>, bridge, sourceId)
  // 已带 clientId 的转发包装：helpers 仍只需传 sessionId，clientId 自动透传
  const targetForward = (req: JSONRPCRequest, sessionIdOverride?: string) =>
    forwardToPlugin(req, sessionIdOverride || target.sessionId, target.clientId)

  // 服务端编排：按名建库 + 合成原生变体集。
  // 必须放在 extractTarget 之后 —— _sessionId / _clientId 已被提取并固化进 targetForward，
  // 编排里的每一次转发（1 次或 2 次）都走同一路由，不会把 _sessionId 当普通参数发给插件。
  if (toolName === 'node_convert_to_component') {
    return withOutputBudget(toolName, toolArgs, await handleConvertToComponent(toolArgs, id, targetForward))
  }

  const pluginMethod = resolvePluginMethod(toolName, toolArgs)
  if (!pluginMethod) {
    return handleLocalToolCall(request, bridge)
  }

  // 转发到插件
  let forwardParams = { ...toolArgs }

  // 几何口径归一化（服务端做一次，两个宿主同一套口径）：
  // `node_create` 的说明写 `type`+`properties`，而两宿主的插件只认 `element`/`nodes`（DSL 元素）；
  // `node_update` 的调用方习惯写 DSL 风格的 `position`/`size`，而宿主端口是扁平 `x/y/width/height`。
  // 不归一化就会出现「单体创建必失败」「批量静默丢样式」「回一堆尚未映射」——都已在真机踩过。
  forwardParams = normalizeGeometryArgs(toolName, forwardParams)

  if (toolName === 'icon_render') {
    const name = forwardParams.name as string
    if (!name || typeof name !== 'string') return { jsonrpc: '2.0', id, error: { code: -32602, message: 'name parameter is required' } }
    try {
      const x = (forwardParams.x as number) || 0; const y = (forwardParams.y as number) || 0
      const size = (forwardParams.size as number) || 24; const color = (forwardParams.color as string) || '#333333'
      const bgColor = forwardParams.bgColor as string | undefined
      const cornerRadius = (forwardParams.cornerRadius as number) || 0; const strokeWidth = forwardParams.strokeWidth as number | undefined
      const icon = await fetchIcon(name)
      const dslElement = buildIconDSL(icon, { x, y, size, color, bgColor, cornerRadius: bgColor ? cornerRadius : undefined, strokeWidth })
      forwardParams = { dsl: { version: '2.0', elements: [dslElement] } }
    } catch (err: any) {
      return { jsonrpc: '2.0', id, error: { code: -32603, message: `Failed to fetch icon: ${err.message}` } }
    }
  }

  if (needsProgress(toolName, toolArgs)) {
    const steps = getToolProgressSteps(toolName, toolArgs)
    if (steps) { bridge.sendTaskPlan(steps); bridge.sendTaskStep('prepare', 'completed'); bridge.sendTaskStep('execute', 'running') }
  }

  const isExportTool = toolName === 'dsl_export_selection' || toolName === 'dsl_export_node'
  const origParams = callParams.arguments || {}

  const forwardRequest: JSONRPCRequest = { jsonrpc: '2.0', id, method: pluginMethod, params: forwardParams }
  const response = await targetForward(forwardRequest)

  // 图片导出后处理
  if (toolName === 'node_export_image' && 'result' in response && response.result) {
    const wrapped = response.result as any
    const pluginResult = wrapped?.content?.[0]?.text ? safeJsonParse(wrapped.content[0].text, wrapped) : wrapped
    if (isImageExportResult(pluginResult)) {
      const saveToPath = toolArgs.saveToPath as string | undefined
      return { jsonrpc: '2.0', id, result: buildImageExportResponse(pluginResult, saveToPath) }
    }
  }

  // 批量导出落盘后处理（传了 savePath 才介入；未传时原样回传，由插件端的 maxBytes 截断保护）
  if (toolName === 'node_export_batch' && 'result' in response && response.result) {
    const wrapped = response.result as any
    const pluginResult = wrapped?.content?.[0]?.text ? safeJsonParse(wrapped.content[0].text, wrapped) : wrapped
    const savePath = toolArgs.savePath as string | undefined
    if (savePath && typeof pluginResult?.data === 'string' && pluginResult.data) {
      return { jsonrpc: '2.0', id, result: buildExportBatchResponse(pluginResult, savePath) }
    }
  }

  // 链式转换：convertToCode — 返回原始 DSL + SVG 资产，AI 直读渲染
  if (isExportTool && origParams.convertToCode && 'result' in response && response.result) {
    const wrapped = response.result as any
    const dslStr = wrapped?.content?.[0]?.text
    const dsl = dslStr ? safeJsonParse(dslStr, wrapped) : wrapped
    try {
      // 预处理：自动标记图标容器为 __svg（画布 + DSL 同步）
      if (origParams.exportSvgs) {
        await semanticizeIcons(dsl, targetForward, target.sessionId, id)
      }
      let files: Record<string, string> | undefined
      if (origParams.exportSvgs) {
        const { generateSvgFiles } = await import('./dsl-to-code.js')
        const svgResult = await generateSvgFiles(dsl, { exportSvgs: true, svgOutputDir: origParams.svgOutputDir as string || 'icons' })
        files = svgResult.files
        await postProcessSvgFiles({ files, svgNodeIds: svgResult.svgNodeIds }, targetForward, target.sessionId, id)
      }
      return withOutputBudget(toolName, toolArgs, {
        jsonrpc: '2.0', id, result: {
          content: [{ type: 'text', text: JSON.stringify({ dsl, files, _converted: true, _framework: 'ai-direct', _sessionId: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }) }],
        },
      })
    } catch (err: any) {
      return { jsonrpc: '2.0', id, result: { ...dsl, _convertError: err.message, _converted: false } }
    }
  }

  if (needsProgress(toolName, toolArgs)) {
    if ('error' in response && response.error) { bridge.sendTaskStep('execute', 'failed', response.error.message); bridge.sendTaskComplete('failed', response.error.message) }
    else { bridge.sendTaskStep('execute', 'completed'); bridge.sendTaskComplete('success') }
  }

  // 输出侧预算：插件转发的重输出结果在此统一截断（仅 HEAVY_OUTPUT_TOOLS 生效）
  return withOutputBudget(toolName, toolArgs, response)
}

// ======== SVG 后处理（插件原生导出替换）========

async function postProcessSvgFiles(
  codeResult: any,
  forwardToPlugin: (request: JSONRPCRequest, sessionId?: string) => Promise<JSONRPCResponse>,
  targetSessionId: string | undefined,
  baseId: string | number,
): Promise<void> {
  const svgNodeIds = codeResult.svgNodeIds as Record<string, string> | undefined
  if (!svgNodeIds || Object.keys(svgNodeIds).length === 0 || !codeResult.files) {
    console.log(`[SVG] No svgNodeIds to process (keys=${svgNodeIds ? Object.keys(svgNodeIds).length : 0}, files=${!!codeResult.files})`)
    return
  }
  console.log(`[SVG] Processing ${Object.keys(svgNodeIds).length} node IDs concurrently`)
  const entries = Object.entries(svgNodeIds).filter(([, nodeId]) => nodeId)
  await Promise.all(entries.map(async ([svgPath, nodeId]) => {
    try {
      const exportReq: JSONRPCRequest = { jsonrpc: '2.0', id: `${baseId}_svg_${svgPath}`, method: 'node/exportImage', params: { nodeId, format: 'SVG' } }
      const exportRes = await forwardToPlugin(exportReq, targetSessionId)
      if ('error' in exportRes) { console.error(`[SVG] Error for ${svgPath}: ${JSON.stringify(exportRes.error)}`); return }
      if (!('result' in exportRes) || !exportRes.result) { console.log(`[SVG] No result for ${svgPath}`); return }
      const wrapped = exportRes.result as any
      const pluginText = wrapped?.content?.[0]?.text
      if (!pluginText) { console.log(`[SVG] No pluginText for ${svgPath}`); return }
      const pluginResult = safeJsonParse<{ data?: string; format?: string }>(pluginText, {})
      if (pluginResult.data && pluginResult.format === 'SVG') {
        const oldSize = (codeResult.files[svgPath] || '').length
        codeResult.files[svgPath] = pluginResult.data
        console.log(`[SVG] Replaced ${svgPath}: ${oldSize}B → ${pluginResult.data.length}B`)
      }
    } catch (e) { console.error(`[SVG] Exception for ${svgPath}: ${e instanceof Error ? e.message : String(e)}`) }
  }))
}

// ======== 图标语义化预处理（自动标记 __svg）========

/**
 * 扫描 DSL 树，将图标容器自动添加 __svg 后缀。
 * 同时通过 node_update 同步到画布，确保后续导出可识别。
 */
async function semanticizeIcons(
  dsl: any,
  forwardToPlugin: (request: JSONRPCRequest, sessionId?: string) => Promise<JSONRPCResponse>,
  targetSessionId: string | undefined,
  baseId: string | number,
): Promise<void> {
  const updates: { nodeId: string; name: string }[] = []

  function walk(el: any): void {
    if (!el || typeof el !== 'object') return
    const name = el.name || ''
    const typ = el.type || ''
    const size = el.size || {}
    const w = size.width || 0
    const h = size.height || 0

    // 条件：INSTANCE 或 FRAME，≤24px，名称不含 __svg
    if ((typ === 'instance' || typ === 'frame') && w > 0 && h > 0 && w <= 24 && h <= 24 && !name.includes('__svg')) {
      const newName = `${name}__svg`
      el.name = newName
      if (el.id) updates.push({ nodeId: el.id, name: newName })
    }

    for (const c of el.children || []) walk(c)
  }

  if (dsl?.elements) for (const e of dsl.elements) walk(e)

  // 批量同步到画布
  if (updates.length > 0) {
    try {
      await forwardToPlugin({
        jsonrpc: '2.0', id: `${baseId}_svgsem`,
        method: 'node/batchUpdate',
        params: { updates: updates.map(u => ({ nodeId: u.nodeId, properties: { name: u.name } })) },
      }, targetSessionId)
      console.log(`[Semantic] Renamed ${updates.length} icon containers to __svg on canvas`)
    } catch (e) {
      console.warn(`[Semantic] Failed to update canvas: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

function extractTarget(
  toolArgs: Record<string, unknown>,
  bridge: ToolRouterBridge,
  sourceId?: string,
): SessionTarget {
  const target: SessionTarget = {}

  // 单次调用定向（优先级最高）：_clientId > _sessionId > 持久化的 session_switch 目标
  const explicitClientId = toolArgs['_clientId']
  if (explicitClientId !== undefined && explicitClientId !== null) {
    const parsed = Number(explicitClientId)
    if (Number.isFinite(parsed)) target.clientId = parsed
    delete toolArgs['_clientId']
  }
  const explicitSessionId = toolArgs['_sessionId'] as string | undefined
  if (explicitSessionId) {
    target.sessionId = explicitSessionId
    delete toolArgs['_sessionId']
  }

  const active = bridge.getActiveSession(sourceId)
  if (active) {
    if (target.clientId === undefined && active.clientId !== undefined) target.clientId = active.clientId
    if (!target.sessionId && active.sessionId) target.sessionId = active.sessionId
  }

  return target
}

/**
 * 解析 session_switch 的目标客户端。
 * 支持 clientId（最精确）/ sessionId / codename 三种定位方式。
 */
function resolveSwitchTarget(
  toolArgs: Record<string, unknown>,
  bridge: ToolRouterBridge,
): { client: PluginClientInfo } | { error: { code: number; message: string } } {
  const sessionId = toolArgs.sessionId as string | undefined
  const clientIdRaw = toolArgs.clientId
  const codename = toolArgs.codename as string | undefined

  if (clientIdRaw !== undefined && clientIdRaw !== null) {
    const clientId = Number(clientIdRaw)
    if (!Number.isFinite(clientId)) {
      return { error: { code: -32602, message: `Invalid clientId: ${String(clientIdRaw)}` } }
    }
    const client = bridge.findPluginClientByClientId(clientId)
    if (!client) return { error: { code: -32000, message: `Plugin client not found: clientId=${clientId}` } }
    return { client }
  }

  if (codename) {
    const client = bridge.findPluginClientByCodename(codename)
    if (!client) return { error: { code: -32000, message: `Plugin codename not found: ${codename}` } }
    return { client }
  }

  if (sessionId) {
    const client = bridge.findPluginClientBySessionId(sessionId)
    if (!client) return { error: { code: -32000, message: `Plugin session not found: ${sessionId}` } }
    return { client }
  }

  return { error: { code: -32602, message: 'session_switch requires one of: clientId (recommended), codename, sessionId' } }
}

// ======== design_to_code 统一处理器（支持 nodeId/dsl + SVG 后处理）========

async function handleDesignToCode(
  toolArgs: Record<string, unknown>,
  id: string | number,
  forwardToPlugin: (request: JSONRPCRequest, sessionId?: string, clientId?: number) => Promise<JSONRPCResponse>,
  bridge: ToolRouterBridge,
  sourceId?: string,
): Promise<JSONRPCResponse> {
  const { generateSvgFiles, validateDSL } = await import('./dsl-to-code.js')

  const target = extractTarget(toolArgs, bridge, sourceId)
  const targetForward = (req: JSONRPCRequest, sessionIdOverride?: string) =>
    forwardToPlugin(req, sessionIdOverride || target.sessionId, target.clientId)
  const targetSessionId = target.sessionId

  const options = (toolArgs.options as Record<string, unknown>) || {}
  let dsl: unknown = toolArgs.dsl

  // nodeId 模式：服务端内部导出 DSL
  if (!dsl && toolArgs.nodeId) {
    const exportReq: JSONRPCRequest = { jsonrpc: '2.0', id: `${id}_dsl`, method: 'dsl/exportNode', params: { nodeId: toolArgs.nodeId } }
    const exportRes = await targetForward(exportReq)
    if ('error' in exportRes) return { jsonrpc: '2.0', id, error: exportRes.error }
    if (!('result' in exportRes) || !exportRes.result) return { jsonrpc: '2.0', id, error: { code: -32000, message: 'Failed to export DSL from node' } }
    const dslStr = extractResponseText(exportRes)
    if (!dslStr) return { jsonrpc: '2.0', id, error: { code: -32000, message: 'Empty DSL response from plugin' } }
    dsl = safeJsonParse(dslStr, null)
  }

  // 验证 DSL
  if (!dsl || typeof dsl !== 'object') {
    return { jsonrpc: '2.0', id, error: { code: -32602, message: 'dsl parameter or nodeId is required' } }
  }
  const dslObj = dsl as any
  const validation = validateDSL(dslObj)
  if (!validation.valid) {
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ valid: false, errors: validation.errors }) }] } }
  }

  // 预处理：自动标记图标容器为 __svg
  if (options.exportSvgs) {
    await semanticizeIcons(dslObj, targetForward, targetSessionId, id)
  }

  // 生成 SVG 资产
  let files: Record<string, string> | undefined
  if (options.exportSvgs) {
    const svgResult = await generateSvgFiles(dslObj as { version: string; elements: DSLElement[] }, { exportSvgs: true, svgOutputDir: (options.svgOutputDir as string) || 'icons' })
    files = svgResult.files
    await postProcessSvgFiles({ files, svgNodeIds: svgResult.svgNodeIds }, targetForward, targetSessionId, id)
  }

  // 提取令牌
  let tokens: any
  if (options.exportTokens) {
    const { dslToTokens } = await import('./dsl-tokens.js')
    const tokenResult = dslToTokens(dslObj as { version: string; elements: DSLElement[] }, {
      darkMode: !!options.darkMode,
      brand: ((options.theme as any)?.brand) as string | undefined,
    })
    tokens = { css: tokenResult.css, tailwind: tokenResult.tailwind, dtcg: tokenResult.dtcg, collection: tokenResult.collection, ...(tokenResult.palette ? { palette: tokenResult.palette } : {}) }
  }

  // 宿主原生 CSS（Penpot：generateStyle + generateFontFaces）—— 比从 DSL 手写字段映射更保真
  let hostCss: unknown
  if (options.exportCss) {
    if (toolArgs.nodeId) {
      const cssReq: JSONRPCRequest = { jsonrpc: '2.0', id: `${id}_css`, method: 'style/generateCss', params: { nodeId: toolArgs.nodeId } }
      const cssRes = await targetForward(cssReq)
      hostCss = 'error' in cssRes && cssRes.error
        ? { available: false, reason: cssRes.error.message }
        : safeJsonParse(extractResponseText(cssRes) || '{}', { available: false, reason: '空响应' })
    } else {
      hostCss = { available: false, reason: 'exportCss 需要 nodeId（原生 CSS 由宿主按真实节点生成）' }
    }
  }

  // palette 一键落地（P2-1/P2-2 的“渲出”）：把推导出的 system 层批量写入令牌并激活集合
  let syncedTokens: unknown
  if (options.syncTokens) {
    const palette = (tokens as { palette?: { mode?: string; system?: Record<string, string> } } | undefined)?.palette
    if (palette?.system) {
      const dark = palette.mode === 'dark'
      const variables = Object.entries(palette.system).map(([key, value]) => ({ name: `system.${key}`, type: 'COLOR', value }))
      const syncReq: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: `${id}_sync`,
        method: 'variable/batchCreate',
        params: { variables, collectionName: dark ? 'Design Tokens (Dark)' : 'Design Tokens', activate: true },
      }
      const syncRes = await targetForward(syncReq)
      syncedTokens = 'error' in syncRes && syncRes.error
        ? { ok: false, reason: syncRes.error.message }
        : safeJsonParse(extractResponseText(syncRes) || '{}', {})
    } else {
      syncedTokens = { ok: false, reason: 'syncTokens 需要 exportTokens + theme.brand（先推导 palette）' }
    }
  }

  const responseText = JSON.stringify({ dsl: dslObj, files, tokens, hostCss, syncedTokens })
  return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: responseText }] } }
}

export function getToolProgressSteps(
  toolName: string,
  args: Record<string, unknown> = {}
): { id: string; label: string }[] | null {
  if (toolName === 'component_render') {
    return [
      { id: 'prepare', label: '准备组件参数' },
      { id: 'render', label: '渲染组件到画布' },
    ]
  }
  // 合并后的批量路径：node_create + nodes[] / node_delete + nodeIds[]
  if (toolName === 'node_create' && isNonEmptyArray(args.nodes)) {
    return [
      { id: 'prepare', label: '验证参数' },
      { id: 'execute', label: '执行批量创建' },
    ]
  }
  if (toolName === 'node_delete' && isNonEmptyArray(args.nodeIds)) {
    return [
      { id: 'prepare', label: '验证参数' },
      { id: 'execute', label: '执行批量删除' },
    ]
  }
  return null
}

function isNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

export function needsProgress(toolName: string, args: Record<string, unknown> = {}): boolean {
  return getToolProgressSteps(toolName, args) !== null
}

/**
 * `node_convert_to_component` 的**服务端编排**。
 *
 * 为什么不是一次纯转发：`combineVariants`（按名分组合成原生变体集）需要先「列举」再
 * 「按名解析成显式属性表」再「执行」——名字解析只能在服务端做一次（两宿主的合成 API 范式不同，
 * 见 `variant-groups.ts`），插件只接收显式的 `variantGroups`。
 *
 * 转发次数：
 * - 不带 `combineVariants`（含单独 `listOnly`）：**1 次**，实参与今天完全一致；
 * - 带 `combineVariants`：**2 次** —— `{containerId|namePrefix, listOnly:true}` 取 `matched[]`，
 *   再 `{variantGroups, keepOriginal}` 执行转换 + 合成（没有可合成的组时第 2 次不发）。
 *
 * 路由（`_sessionId` / `_clientId`）：由调用方传入的 `forwardToPlugin` 携带（`routeToolCall` 里
 * 的 `targetForward`），本函数不做任何路由参数处理 —— 两次转发因此落在**同一个会话**上。
 */
export async function handleConvertToComponent(
  args: Record<string, unknown>,
  id: string | number,
  forwardToPlugin: (request: JSONRPCRequest, sessionId?: string) => Promise<JSONRPCResponse>,
): Promise<JSONRPCResponse> {
  const combineVariants = args.combineVariants === true
  const namePrefix = typeof args.namePrefix === 'string' && args.namePrefix ? args.namePrefix : undefined
  const containerId = typeof args.containerId === 'string' && args.containerId ? args.containerId : undefined
  /** 批量作用域：优先 `containerId`（新契约，R6 已弃 DS_ 前缀），保留 `namePrefix` 兼容旧调用 */
  const scope: Record<string, unknown> | undefined = containerId
    ? { containerId }
    : namePrefix
      ? { namePrefix }
      : undefined
  const scopeLabel = containerId ? `containerId=${containerId}` : `namePrefix=${namePrefix}`
  const keepOriginal = args.keepOriginal === true
  // `variantPropertyName` 支持逗号多轴（如 "Variant,State"）—— 单一生成基准，插件各自适配
  const rawPropertyName = typeof args.variantPropertyName === 'string' ? args.variantPropertyName : undefined
  const axes = rawPropertyName
    ? rawPropertyName.split(',').map((axis) => axis.trim()).filter((axis) => axis.length > 0)
    : undefined

  // 服务端修饰符不进插件协议（插件只认 listOnly / variantGroups，见冻结接口）
  const baseParams: Record<string, unknown> = { ...args }
  delete baseParams.combineVariants
  delete baseParams.variantPropertyName

  const convertRequest = (requestId: string | number, params: Record<string, unknown>): JSONRPCRequest => ({
    jsonrpc: '2.0',
    id: requestId,
    method: 'node/convertToComponent',
    params,
  })
  const asResult = (payload: Record<string, unknown>): JSONRPCResponse => ({
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] },
  })

  // 与今天行为一致：1 次转发（listOnly 也在这一条路径上原样透传）
  if (!combineVariants) {
    return forwardToPlugin(convertRequest(id, baseParams))
  }

  if (!scope) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32602,
        message:
          'combineVariants 需要提供作用域：containerId（推荐，如第 ② 段 Components frame）或 namePrefix（旧式）—— 先列举匹配成员，再按 <类型>[_轴值…] 分组合成变体集',
      },
    }
  }

  // ① 列举：只拿 matched[]，不动画布（子请求用独立 id，便于桥按 id 关联响应）
  const listed = await forwardToPlugin(convertRequest(`${id}_cv_list`, { ...scope, listOnly: true }))
  if ('error' in listed && listed.error) return listed
  const listedPayload = safeParseObject<Record<string, unknown>>(extractResponseText(listed))
  if (!listedPayload) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: 'combineVariants: 列举步骤返回的不是 JSON 对象，无法解析 matched[]' },
    }
  }

  const rawMatched = listedPayload.matched
  if (!Array.isArray(rawMatched)) {
    // 插件版本过旧（matched 是数字）时不能静默：分组无从谈起，如实回报
    return asResult({
      ok: false,
      success: false,
      count: 0,
      components: [],
      skipped: [],
      variantSets: [],
      notes: [
        `服务端解析：插件未返回 matched[] 清单（实际为 ${rawMatched === undefined ? 'undefined' : typeof rawMatched}）——` +
          ' 需要插件侧支持 namePrefix + listOnly + matched[]，本机插件可能过旧，无法按名分组',
      ],
    })
  }

  const plan = planVariantGroups(
    rawMatched
      .filter((node: any) => node && typeof node.nodeId === 'string')
      .map((node: any) => ({ nodeId: node.nodeId as string, name: typeof node.name === 'string' ? node.name : '' })),
    axes && axes.length ? { axes } : {},
  )
  const serverNotes = plan.notes.map((note) => `服务端解析（${scopeLabel}）：${note}`)
  // 成员不足 2 个的组：匹配到了但**不会**被转换，除了 notes 也如实记入 skipped（不静默丢弃）
  const singleSkips = plan.singles.map((single) => ({
    nodeId: single.nodeId,
    name: single.name,
    reason: 'variant-group-too-small',
    message: '只有 1 个成员，不合成变体集',
  }))

  if (plan.groups.length === 0) {
    // 没有可合成的组就不发第 2 次请求（插件那次调用会是空操作）
    return asResult({
      ok: false,
      success: false,
      count: 0,
      components: [],
      skipped: singleSkips,
      variantSets: [],
      notes: [...serverNotes, '服务端解析：没有成员 ≥2 的组，未执行转换（想先看会合成哪些，请只传 listOnly）'],
    })
  }

  // ② 执行：插件只吃显式属性表
  const applied = await forwardToPlugin(
    convertRequest(`${id}_cv_apply`, { variantGroups: plan.groups, keepOriginal }),
  )
  if ('error' in applied && applied.error) return applied
  const appliedPayload = safeParseObject<Record<string, unknown>>(extractResponseText(applied)) ?? {}

  const pluginComponents = Array.isArray(appliedPayload.components) ? appliedPayload.components : []
  const pluginSkipped = Array.isArray(appliedPayload.skipped) ? appliedPayload.skipped : []
  const pluginNotes = Array.isArray(appliedPayload.notes)
    ? appliedPayload.notes.map((note) => `插件执行：${String(note)}`)
    : []

  return asResult({
    ok: appliedPayload.ok !== false,
    // 插件（MasterGo）会额外回 `success`：合并路径把它一并带上，与三种旧形态的响应保持一致
    ...(appliedPayload.success !== undefined ? { success: appliedPayload.success } : {}),
    count: typeof appliedPayload.count === 'number' ? appliedPayload.count : pluginComponents.length,
    components: pluginComponents,
    skipped: [...pluginSkipped, ...singleSkips],
    variantSets: Array.isArray(appliedPayload.variantSets) ? appliedPayload.variantSets : [],
    notes: [...serverNotes, ...pluginNotes],
  })
}

/**
 * 处理 code_to_design 请求
 * 服务端预处理（图标、图表、组件）后转发到客户端渲染
 * 渲染成功后创建 DesignCache session 并返回 sessionId
 */
export async function handleCodeToDesign(
  args: Record<string, unknown>,
  id: string | number,
  bridge: ToolRouterBridge,
): Promise<JSONRPCResponse> {
  try {
    const source = await readHtmlContent(args)
    let htmlContent = extractBodyContent(source.html)

    bridge.sendTaskPlan([
      { id: 'prepare', label: '准备设计数据' },
      { id: 'preprocess', label: '预处理：图标、图表、组件' },
      { id: 'send', label: '发送 HTML 到客户端渲染器' },
      { id: 'render', label: '渲染到画布' },
    ])
    bridge.sendTaskStep('prepare', 'completed')

    bridge.sendTaskStep('preprocess', 'running')

    // 自动组件映射：查询画布上已有的 Component Master，自动注入 data-component-id
    // （本地组件不存在时，团队组件库会作为兜底注入 data-library-ukey）
    const { autoMapComponents, resolveTeamLibraryRefs } = await import('./component-auto-map.js')
    htmlContent = await autoMapComponents(htmlContent, bridge.forwardRequest)

    const preprocessResult = await preprocessHtml(htmlContent)
    htmlContent = preprocessResult.html
    if (preprocessResult.warnings.length > 0) {
      console.warn('[code_to_design] Preprocess warnings:', preprocessResult.warnings)
    }

    // 团队组件库引用解析：data-library-component="ukey|库名/组件名" → data-library-ukey="<ukey>"
    await safeCatchAsync('code_to_design/teamLibraryRefs', async () => {
      const teamRefs = await resolveTeamLibraryRefs(htmlContent, bridge.forwardRequest)
      htmlContent = teamRefs.html
      if (teamRefs.resolved.length > 0) {
        console.log(
          '[code_to_design] 团队组件引用已解析:',
          teamRefs.resolved.map((r) => `${r.library}/${r.component}`).join(', '),
        )
      }
      if (teamRefs.warnings.length > 0) {
        console.warn('[code_to_design] Team library warnings:', teamRefs.warnings)
      }
    }, undefined)

    bridge.sendTaskStep('preprocess', 'completed')

    // client 模式：HTML → 插件浏览器渲染 → 提取像素
    bridge.sendTaskStep('send', 'completed')
    bridge.sendTaskStep('render', 'running')

    const forwardRequest: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method: 'html/render-client',
      params: {
        html: htmlContent,
        // 渲染后自动聚焦（插件端 dsl/render 处理）——focus:false / select:false 可关闭
        ...(args.focus === false ? { focus: false } : {}),
        ...(args.select === false ? { select: false } : {}),
      },
    }

    const pluginResponse = await bridge.forwardRequest(forwardRequest)

    if ('error' in pluginResponse && pluginResponse.error) {
      bridge.sendTaskStep('render', 'failed', pluginResponse.error.message)
      bridge.sendTaskComplete('failed', pluginResponse.error.message)
      return pluginResponse
    }

    bridge.sendTaskStep('render', 'completed')

    // 从插件响应中提取 rootNodeIds 并创建 DesignCache session
    let sessionId: string | undefined
    await safeCatchAsync('code_to_design/session', async () => {
      const resultText = extractResponseText(pluginResponse)
      if (resultText) {
        const parsed = safeJsonParse<{ rootNodeIds?: string[] }>(resultText, {})
        const rootNodeIds: string[] = parsed.rootNodeIds || []
        const rootNodeId = rootNodeIds.length > 0 ? rootNodeIds[0] : ''

        if (rootNodeId) {
          const { globalDesignCache } = await import('./design-cache.js')
          const session = globalDesignCache.createSession(rootNodeId, 'html')
          sessionId = session.sessionId
          session.rootNodeIds = rootNodeIds
        }
      }
    }, undefined)

    bridge.sendTaskComplete('success')

    if (sessionId) {
      const parsed = safeCatch('code_to_design/response', () => {
        const resultText = extractResponseText(pluginResponse)
        return resultText ? safeJsonParse(resultText, {}) : {}
      }, {})
      if (Object.keys(parsed).length > 0) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({ ...parsed, sessionId }),
            }],
          },
        }
      }
    }
    return pluginResponse
  } catch (e: any) {
    bridge.sendTaskComplete('failed', e.message)
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: `code_to_design failed: ${e.message}` },
    }
  }
}

/**
 * 在 autoApply 后，如果传了 sessionId，则清除对应节点的缓存标记
 */
async function invalidateSessionCache(sessionId: string | undefined, nodeId: string): Promise<void> {
  if (!sessionId) return
  await safeCatchAsync('cache/invalidate', async () => {
    const { globalDesignCache } = await import('./design-cache.js')
    const session = globalDesignCache.getSession(sessionId)
    if (session) {
      session.elements.delete(nodeId)
    }
  }, undefined)
}

/**
 * 把「对象之间对齐/分布」提案从其它提案里分出来。
 *
 * 为什么单独一条路径：`design_suggest` 的常规应用是"把 properties 合并后发给
 * `node/batchUpdate`（单节点属性补丁）"；而对象对齐是**多节点几何操作**，
 * 参数与目标都不同（作用于当前选区），所以转发到插件的 `node/align`。
 *
 * 两者可以同时存在（"左对齐并改成蓝色"）：先做对齐，再打属性补丁。
 */
function splitNodeAlignmentProposals(proposals: { type: string; properties?: Record<string, unknown> }[]): {
  alignOps: { mode: 'align' | 'distribute'; axis?: string; direction?: string }[]
  rest: { type: string; properties?: Record<string, unknown> }[]
} {
  const alignOps: { mode: 'align' | 'distribute'; axis?: string; direction?: string }[] = []
  const rest: { type: string; properties?: Record<string, unknown> }[] = []
  for (const proposal of proposals) {
    if (proposal.type === 'align-nodes' || proposal.type === 'distribute-nodes') {
      alignOps.push({
        mode: proposal.type === 'align-nodes' ? 'align' : 'distribute',
        axis: typeof proposal.properties?.axis === 'string' ? proposal.properties.axis : undefined,
        direction: typeof proposal.properties?.direction === 'string' ? proposal.properties.direction : undefined,
      })
    } else {
      rest.push(proposal)
    }
  }
  return { alignOps, rest }
}

/**
 * 处理 design_suggest 请求
 * 自然语言指令 → 导出结构 → 规则引擎匹配 → 返回/应用修改
 */
export async function handleDesignSuggest(
  args: Record<string, unknown>,
  id: string | number,
  bridge: ToolRouterBridge,
): Promise<JSONRPCResponse> {
  const nodeId = args.nodeId as string
  const instruction = args.instruction as string
  const autoApply = args.autoApply === true

  if (!nodeId || !instruction) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: 'nodeId and instruction are required' },
    }
  }

  bridge.sendTaskPlan([
    { id: 'describe', label: '分析当前设计结构' },
    { id: 'parse', label: '理解修改指令' },
    { id: 'apply', label: autoApply ? '应用修改' : '生成修改建议' },
  ])

  try {
    bridge.sendTaskStep('describe', 'running')

    const describeRequest: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method: 'design/describe',
      params: { nodeId, depth: 3, includeStyle: true },
    }

    const describeResponse = await bridge.forwardRequest(describeRequest)

    if ('error' in describeResponse && describeResponse.error) {
      bridge.sendTaskComplete('failed', describeResponse.error.message)
      return describeResponse
    }

    bridge.sendTaskStep('describe', 'completed')
    bridge.sendTaskStep('parse', 'running')

    const structure: Record<string, unknown> = safeCatch('design_suggest/parse', () => {
      const describeText = extractResponseText(describeResponse) || '{}'
      const parsed = safeJsonParse<{ tree?: Record<string, unknown> }>(describeText, {})
      return parsed.tree ?? {}
    }, {})

    const { suggestChanges } = await import('./design-suggest-engine.js')
    const { proposals, unmatched } = suggestChanges(structure, instruction)

    if (proposals.length === 0) {
      bridge.sendTaskStep('parse', 'completed')
      bridge.sendTaskComplete('success')
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              instruction,
              proposals: [],
              unmatched: [instruction],
              hints: ['请使用更明确的表达：颜色如"改成蓝色/#0071e3"', '间距如"间距加大/间距16"', '圆角如"圆角8/圆点"', '对齐如"居中对齐/顶部对齐"'],
              message: '未能理解该指令，AI 应尝试用自己的 LLM 能力将自然语言分解为引擎支持的原子指令后重试',
            }),
          }],
        },
      }
    }

    bridge.sendTaskStep('parse', 'completed')

    if (autoApply) {
      bridge.sendTaskStep('apply', 'running')

      const mergedProperties: Record<string, unknown> = {}
      for (const p of proposals) {
        Object.assign(mergedProperties, p.properties)
      }

      // 对象之间对齐/分布：走插件的 node/align（作用于当前选区，不是单节点属性）
      const { alignOps, rest } = splitNodeAlignmentProposals(proposals as never)
      const alignResponses: unknown[] = []
      for (const op of alignOps) {
        const alignResponse = await bridge.forwardRequest({
          jsonrpc: '2.0',
          id,
          method: 'node/align',
          params: { mode: op.mode, axis: op.axis, direction: op.direction, useSelection: true },
        })
        if ('error' in alignResponse && alignResponse.error) {
          bridge.sendTaskStep('apply', 'failed', alignResponse.error.message)
          bridge.sendTaskComplete('failed', alignResponse.error.message)
          return alignResponse
        }
        alignResponses.push(safeCatch('design_suggest/align', () => safeJsonParse(extractResponseText(alignResponse) || '{}', {}), {}))
      }

      // 其余提案仍是单节点属性补丁；只有还有属性时才发 batchUpdate
      const updateResponse = Object.keys(mergedProperties).length === 0
        ? { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, skipped: true, reason: '本次只有对齐/分布操作，没有属性补丁' }) }] } } as JSONRPCResponse
        : await bridge.forwardRequest({
            jsonrpc: '2.0',
            id,
            method: 'node/batchUpdate',
            params: { updates: [{ nodeId, properties: mergedProperties }] },
          } as JSONRPCRequest)
      void rest

      if ('error' in updateResponse && updateResponse.error) {
        bridge.sendTaskStep('apply', 'failed', updateResponse.error.message)
        bridge.sendTaskComplete('failed', updateResponse.error.message)
        return updateResponse
      }

      bridge.sendTaskStep('apply', 'completed')
      bridge.sendTaskComplete('success')

      // 如果传了 sessionId，清除该节点缓存
      const sessionId = (args as any).sessionId as string | undefined
      await invalidateSessionCache(sessionId, nodeId)

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              instruction,
              applied: true,
              proposals,
              unmatched,
              message: `已应用: ${proposals.map((p: any) => p.description).join('; ')}`,
            }),
          }],
        },
      }
    }

    bridge.sendTaskComplete('success')
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            instruction,
            applied: false,
            nodeId,
            proposals,
            unmatched,
            hitCount: proposals.length,
          }),
        }],
      },
    }
  } catch (e: any) {
    bridge.sendTaskComplete('failed', e.message)
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: `design_suggest failed: ${e.message}` },
    }
  }
}

/**
 * 处理 design_suggest_batch 请求（批量原子指令）
 */
export async function handleDesignSuggestBatch(
  args: Record<string, unknown>,
  id: string | number,
  bridge: ToolRouterBridge,
): Promise<JSONRPCResponse> {
  const nodeId = args.nodeId as string
  const instructions = (args.instructions as string[]) || []
  const autoApply = args.autoApply === true

  if (!nodeId || !instructions.length) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: 'nodeId and instructions are required' },
    }
  }

  bridge.sendTaskPlan([
    { id: 'describe', label: '分析设计结构' },
    { id: 'parse-batch', label: `解析 ${instructions.length} 条原子指令` },
    { id: 'apply', label: autoApply ? '批量应用修改' : '生成修改建议' },
  ])

  try {
    bridge.sendTaskStep('describe', 'running')

    const describeRequest: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method: 'design/describe',
      params: { nodeId, depth: 3, includeStyle: true },
    }

    const describeResponse = await bridge.forwardRequest(describeRequest)

    if ('error' in describeResponse && describeResponse.error) {
      bridge.sendTaskComplete('failed', describeResponse.error.message)
      return describeResponse
    }

    bridge.sendTaskStep('describe', 'completed')
    bridge.sendTaskStep('parse-batch', 'running')

    const structure: Record<string, unknown> = safeCatch('design_suggest_batch/parse', () => {
      const describeText = extractResponseText(describeResponse) || '{}'
      const parsed = JSON.parse(describeText)
      return (parsed?.tree as Record<string, unknown>) ?? {}
    }, {})

    const { suggestChanges } = await import('./design-suggest-engine.js')

    const allProposals: any[] = []
    const allUnmatched: string[] = []

    for (const instr of instructions) {
      const { proposals, unmatched } = suggestChanges(structure, instr)
      allProposals.push(...proposals)
      allUnmatched.push(...unmatched)
    }

    bridge.sendTaskStep('parse-batch', 'completed')

    if (autoApply && allProposals.length > 0) {
      bridge.sendTaskStep('apply', 'running')

      const mergedProperties: Record<string, unknown> = {}
      for (const p of allProposals) {
        Object.assign(mergedProperties, p.properties)
      }

      // 对象之间对齐/分布走插件 node/align（作用于选区），其余才是属性补丁
      const { alignOps } = splitNodeAlignmentProposals(allProposals as never)
      for (const op of alignOps) {
        const alignResponse = await bridge.forwardRequest({
          jsonrpc: '2.0',
          id,
          method: 'node/align',
          params: { mode: op.mode, axis: op.axis, direction: op.direction, useSelection: true },
        })
        if ('error' in alignResponse && alignResponse.error) {
          bridge.sendTaskStep('apply', 'failed', alignResponse.error.message)
          bridge.sendTaskComplete('failed', alignResponse.error.message)
          return alignResponse
        }
      }

      const updateResponse = Object.keys(mergedProperties).length === 0
        ? { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, skipped: true, reason: '本次只有对齐/分布操作' }) }] } } as JSONRPCResponse
        : await bridge.forwardRequest({
            jsonrpc: '2.0',
            id,
            method: 'node/batchUpdate',
            params: { updates: [{ nodeId, properties: mergedProperties }] },
          } as JSONRPCRequest)

      if ('error' in updateResponse && updateResponse.error) {
        bridge.sendTaskStep('apply', 'failed', updateResponse.error.message)
        bridge.sendTaskComplete('failed', updateResponse.error.message)
        return updateResponse
      }

      bridge.sendTaskStep('apply', 'completed')

      // 如果传了 sessionId，清除该节点缓存
      const batchSessionId = (args as any).sessionId as string | undefined
      await invalidateSessionCache(batchSessionId, nodeId)
    }

    bridge.sendTaskComplete('success')
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            applied: autoApply,
            nodeId,
            total: instructions.length,
            matched: allProposals.length,
            unmatchedCount: allUnmatched.length,
            allUnmatched,
            message: autoApply
              ? `已批量应用 ${allProposals.length} 项修改${allUnmatched.length ? `，${allUnmatched.length} 条未匹配` : ''}`
              : `共 ${instructions.length} 条指令，匹配 ${allProposals.length} 项${allUnmatched.length ? `，${allUnmatched.length} 条未匹配` : ''}`,
          }),
        }],
      },
    }
  } catch (e: any) {
    bridge.sendTaskComplete('failed', e.message)
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: `design_suggest_batch failed: ${e.message}` },
    }
  }
}

/**
 * 设计自检 — 启发式分析 design_describe 输出，返回潜在问题
 */
function reviewNode(node: any, path: string[], issues: any[]): void {
  if (!node) return
  const currentPath = [...path, node.name || node.id]

  // 1. 检查缺少 data-name
  if (node.name && /^(div|section|p|span|button|frame|rectangle|ellipse|text|svg)$/i.test(node.name)) {
    issues.push({
      severity: 'warning',
      category: 'naming',
      message: `节点缺少有意义的 data-name: "${node.name}"`,
      path: currentPath.join(' > '),
      nodeId: node.id,
    })
  }

  // 2. 检查文字字号过小
  if (node.style?.fontSize !== undefined && node.style.fontSize < 10) {
    issues.push({
      severity: 'warning',
      category: 'typography',
      message: `字号过小: ${node.style.fontSize}px (建议 ≥ 10px)`,
      path: currentPath.join(' > '),
      nodeId: node.id,
    })
  }

  // 3. 检查透明文字
  if (node.type === 'TEXT' && node.style?.textColor === '#00000000') {
    issues.push({
      severity: 'warning',
      category: 'visibility',
      message: '文字颜色完全透明',
      path: currentPath.join(' > '),
      nodeId: node.id,
    })
  }

  // 4. 检查空容器
  if ((node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') &&
      node.childCount === 0 && !node.fills && !node.stroke) {
    issues.push({
      severity: 'info',
      category: 'structure',
      message: '空容器，无子节点且无填充/描边',
      path: currentPath.join(' > '),
      nodeId: node.id,
    })
  }

  // 5. 检查 clipsContent 缺失（有 shadow 但没有 clipsContent）
  if (node.effects?.some((e: any) => e.type === 'DROP_SHADOW') && !node.clipsContent) {
    issues.push({
      severity: 'info',
      category: 'overflow',
      message: '有阴影效果但 clipsContent 未设置（通常不需裁剪）',
      path: currentPath.join(' > '),
      nodeId: node.id,
    })
  }

  // 6. 检查对比度：浅色背景上的浅色文字（潜在可读性问题）
  if (node.type === 'TEXT' && node.style?.fills && node.style?.background) {
    const textColor = node.style.fills?.[0]?.color
    const bgColor = node.style.background?.fills?.[0]?.color || node.style.background
    if (textColor && bgColor && typeof textColor === 'object' && typeof bgColor === 'object') {
      const luminance = (r: number, g: number, b: number) => {
        const rs = r / 255, gs = g / 255, bs = b / 255
        return 0.299 * rs + 0.587 * gs + 0.114 * bs
      }
      const textLum = luminance(textColor.r || 0, textColor.g || 0, textColor.b || 0)
      const bgLum = luminance(bgColor.r || 0, bgColor.g || 0, bgColor.b || 0)
      const contrast = Math.abs(textLum - bgLum)
      if (contrast < 0.3) {
        issues.push({
          severity: 'warning',
          category: 'accessibility',
          message: `文字与背景对比度不足 (差值: ${contrast.toFixed(2)}, 建议 ≥ 0.4)`,
          path: currentPath.join(' > '),
          nodeId: node.id,
        })
      }
    }
  }

  // 7. 检查字号不统一（兄弟节点中字号差异超过 4px）
  if (node.children && node.children.length >= 2) {
    const fontSizes = node.children
      .filter((c: any) => c.style?.fontSize)
      .map((c: any) => c.style.fontSize)
    if (fontSizes.length >= 2) {
      const max = Math.max(...fontSizes)
      const min = Math.min(...fontSizes)
      if (max - min > 4 && fontSizes.length > 2) {
        // 仅当超过 2 个文本节点时给出建议（标题+正文的组合是合理的）
        issues.push({
          severity: 'info',
          category: 'typography',
          message: `兄弟节点字号跨度较大: ${min}px ~ ${max}px，建议检查是否意图使然`,
          path: currentPath.join(' > '),
          nodeId: node.id,
        })
      }
    }
  }

  // 递归子节点
  if (node.children) {
    for (const child of node.children) {
      reviewNode(child, currentPath, issues)
    }
  }
}

/**
 * 处理 design_review 请求
 * 获取 design_describe 结果 → 启发式分析 → 返回问题列表
 */
export async function handleDesignReview(
  args: Record<string, unknown>,
  id: string | number,
  bridge: ToolRouterBridge,
): Promise<JSONRPCResponse> {
  const nodeId = args.nodeId as string
  const depth = (args.depth as number) ?? 3

  if (!nodeId) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: 'nodeId is required' },
    }
  }

  bridge.sendTaskPlan([
    { id: 'describe', label: '分析设计结构' },
    { id: 'review', label: '执行启发式检查' },
  ])

  try {
    bridge.sendTaskStep('describe', 'running')

    const describeRequest: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method: 'design/describe',
      params: { nodeId, depth, includeStyle: true },
    }

    const describeResponse = await bridge.forwardRequest(describeRequest)

    if ('error' in describeResponse && describeResponse.error) {
      bridge.sendTaskComplete('failed', describeResponse.error.message)
      return describeResponse
    }

    bridge.sendTaskStep('describe', 'completed')
    bridge.sendTaskStep('review', 'running')

    const roots: Record<string, unknown>[] = safeCatch('design_review/parse', () => {
      const describeText = extractResponseText(describeResponse) || '{}'
      return parseDescribeRoots(safeJsonParse<unknown>(describeText, {}))
    }, [])

    const issues: any[] = []
    for (const root of roots) reviewNode(root, [], issues)

    // 可访问性硬指标（对比度 / 焦点环 / 最小点击区）—— 真正的 WCAG 口径，见 a11y-review.ts
    const a11y = auditA11y(roots)
    issues.push(...a11y.issues)

    bridge.sendTaskStep('review', 'completed')
    bridge.sendTaskComplete('success')

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            nodeId,
            totalIssues: issues.length,
            issues,
            a11y: {
              checked: a11y.checked,
              ...(a11y.skipped.length ? { skipped: a11y.skipped } : {}),
            },
            summary: issues.length > 0
              ? `发现 ${issues.length} 个问题`
              : '未发现明显问题',
          }),
        }],
      },
    }
  } catch (e: any) {
    bridge.sendTaskComplete('failed', e.message)
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: `design_review failed: ${e.message}` },
    }
  }
}

/**
 * 处理 codebase_getStructure 请求
 * 扫描目录返回代码库结构
 */
export async function handleCodebaseGetStructure(
  args: Record<string, unknown>,
  id: string | number,
): Promise<JSONRPCResponse> {
  try {
    const dir = (args.dir as string) || process.cwd()
    const result = analyzeCodebase(dir)
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      },
    }
  } catch (e: any) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: `codebase_getStructure failed: ${e.message}` },
    }
  }
}

/**
 * 处理 get_version 请求
 */
export function handleGetVersion(
  _args: Record<string, unknown>,
  id: string | number,
): JSONRPCResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{
        type: 'text',
        text: JSON.stringify({
          server: 'mcp-server',
          version: SERVER_VERSION,
          node: process.version,
          platform: process.platform,
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        }, null, 2),
      }],
    },
  }
}

/**
 * 处理 get_guidelines 请求
 * 加载 design rules 作为 AI context
 */
export function handleGetGuidelines(
  args: Record<string, unknown>,
  id: string | number,
): JSONRPCResponse {
  try {
    const topic = args.topic as string | undefined

    if (!topic) {
      const index = getGuidelinesIndex()
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              total: index.length,
              guidelines: index,
              hint: '使用 topic 参数获取具体规则内容，如 get_guidelines({ topic: "layout" })',
            }, null, 2),
          }],
        },
      }
    }

    const rules = getGuidelines(topic)
    if (rules.length === 0) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              topic,
              total: 0,
              message: `未找到与 "${topic}" 匹配的规则。可用主题: quickstart, core-tags, layout, chart, freeze, pitfalls, image, tools, dsl, design, example, limitation, codebase-viz`,
            }, null, 2),
          }],
        },
      }
    }

    const result = rules.map(r => ({
      id: r.id,
      title: r.title,
      content: r.content,
    }))

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({ topic, total: rules.length, guidelines: result }, null, 2),
        }],
      },
    }
  } catch (e: any) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: `get_guidelines failed: ${e.message}` },
    }
  }
}

/**
 * 将质量检查结果以画板形式输出到原页面
 * 在原设计稿右侧创建 QA Report 画板，逐项列出各维度评分和改进建议
 */
async function createQualityAnnotations(
  rootNodeId: string,
  report: import('../agent/types.js').QualityReport,
  bridge: ToolRouterBridge,
  forwardToPlugin: (request: JSONRPCRequest, sessionId?: string) => Promise<JSONRPCResponse>,
  sourceId: string | undefined,
  baseId: string,
): Promise<void> {
  const fwd = (method: string, params: Record<string, unknown>) =>
    forwardToPlugin({ jsonrpc: '2.0', id: `${baseId}`, method, params }, sourceId)

  let anchorX = 0
  let anchorY = 0
  let anchorW = 1440
  try {
    const nodeResp = await fwd('node/get', { nodeId: rootNodeId })
    if ('result' in nodeResp && nodeResp.result) {
      const node = (nodeResp.result as any)?.node || nodeResp.result
      anchorX = node.x ?? 0
      anchorY = node.y ?? 0
      anchorW = node.width ?? 1440
    }
  } catch { /* node/get 失败则用默认锚点（非关键） */ }

  const gap = 40
  const qaX = anchorX + anchorW + gap
  const qaY = anchorY
  const annotationWidth = 360

  const gateColors: Record<string, string> = {
    LayoutGate: '#3B82F6',
    ColorGate: '#8B5CF6',
    ConsistencyGate: '#10B981',
    CompletenessGate: '#F59E0B',
    ResponsiveGate: '#EC4899',
  }

  const headerRequest: JSONRPCRequest = {
    jsonrpc: '2.0', id: `${baseId}-frame`,
    method: 'tools/call',
    params: {
      name: 'node_create',
      arguments: {
        type: 'frame',
        properties: {
          name: 'QA Report',
          x: qaX, y: qaY,
          width: annotationWidth,
          height: 40,
          layoutMode: 'VERTICAL',
          paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16,
          itemSpacing: 8,
          fills: [{ type: 'SOLID', color: '#1e1e2e' }],
          cornerRadius: 12,
          opacity: 0.95,
        },
      },
    },
  }
  const qaFrame = await routeToolCall(headerRequest, bridge, forwardToPlugin, sourceId)
  const qaNodeId = 'result' in qaFrame && qaFrame.result
    ? (qaFrame.result as any)?.id || ''
    : ''
  if (!qaNodeId) return

  const titleRequest: JSONRPCRequest = {
    jsonrpc: '2.0', id: `${baseId}-title`,
    method: 'tools/call',
    params: {
      name: 'node_create',
      arguments: {
        type: 'text',
        properties: {
          name: 'QA Title',
          characters: `QA Report — ${Math.round(report.overallScore * 100)}%`,
          fontSize: 18,
          fontWeight: 700,
          fills: [{ type: 'SOLID', color: report.passed ? '#4ADE80' : '#F87171' }],
        },
        parentId: qaNodeId,
      },
    },
  }
  await routeToolCall(titleRequest, bridge, forwardToPlugin, sourceId)

  for (let i = 0; i < report.gates.length; i++) {
    const gate = report.gates[i]
    const color = gateColors[gate.gate] || '#94A3B8'
    const icon = gate.pass ? '✓' : '✗'

    const gateRequest: JSONRPCRequest = {
      jsonrpc: '2.0', id: `${baseId}-gate-${i}`,
      method: 'tools/call',
      params: {
        name: 'node_create',
        arguments: {
          type: 'text',
          properties: {
            name: `QA ${gate.gate}`,
            characters: `${icon} ${gate.gate}: ${Math.round(gate.score * 100)}%`,
            fontSize: 13,
            fontWeight: 600,
            fills: [{ type: 'SOLID', color }],
          },
          parentId: qaNodeId,
        },
      },
    }
    await routeToolCall(gateRequest, bridge, forwardToPlugin, sourceId)

    if (gate.details.length > 0) {
      const detailRequest: JSONRPCRequest = {
        jsonrpc: '2.0', id: `${baseId}-detail-${i}`,
        method: 'tools/call',
        params: {
          name: 'node_create',
          arguments: {
            type: 'text',
            properties: {
              name: `QA ${gate.gate} details`,
              characters: gate.details.join(' | '),
              fontSize: 11,
              fontWeight: 400,
              fills: [{ type: 'SOLID', color: '#94A3B8' }],
            },
            parentId: qaNodeId,
          },
        },
      }
      await routeToolCall(detailRequest, bridge, forwardToPlugin, sourceId)
    }

    if (!gate.pass && gate.suggestions.length > 0) {
      for (let j = 0; j < gate.suggestions.length; j++) {
        const suggestionRequest: JSONRPCRequest = {
          jsonrpc: '2.0', id: `${baseId}-suggest-${i}-${j}`,
          method: 'tools/call',
          params: {
            name: 'node_create',
            arguments: {
              type: 'text',
              properties: {
                name: `QA Suggestion`,
                characters: `→ ${gate.suggestions[j]}`,
                fontSize: 11,
                fontWeight: 400,
                fills: [{ type: 'SOLID', color: '#FBBF24' }],
              },
              parentId: qaNodeId,
            },
          },
        }
        await routeToolCall(suggestionRequest, bridge, forwardToPlugin, sourceId)
      }
    }
  }
}

/**
 * 处理 agent_design_by_intent — Design Agent 核心入口
 */
async function handleAgentDesignByIntent(
  args: Record<string, unknown>,
  id: string | number,
  forwardToPlugin: (request: JSONRPCRequest, sessionId?: string) => Promise<JSONRPCResponse>,
  bridge: ToolRouterBridge,
  sourceId?: string,
): Promise<JSONRPCResponse> {
  const intentText = args.intent as string
  if (!intentText) {
    return { jsonrpc: '2.0', id, error: { code: -32602, message: 'intent is required' } }
  }

  const mode = (args.mode as string) || 'copilot'
  const maxIterations = (args.maxIterations as number) || 3
  const config = { mode: mode as 'copilot' | 'adviser' | 'autonomous', maxIterations }

  bridge.sendTaskPlan([
    { id: 'interpret', label: '理解设计需求' },
    { id: 'plan', label: '规划设计方案' },
    { id: 'generate', label: '生成设计元素' },
    { id: 'review', label: '审查设计质量' },
  ])
  bridge.sendTaskStep('interpret', 'running', '正在分析设计需求...')

  const intention = await interpretIntention(intentText)
  bridge.sendTaskStep('interpret', 'completed', '设计需求分析完成')

  bridge.sendTaskStep('plan', 'running', '正在规划设计步骤...')
  const plan = createPlan(intention)
  const session = createSession(plan, config)
  bridge.sendTaskStep('plan', 'completed', `已规划 ${plan.steps.length} 个步骤`)

  updateSessionStatus(session.sessionId, 'executing')
  bridge.sendTaskStep('generate', 'running', '开始执行设计...')

  const errors: string[] = []

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]
    pushCheckpoint(session.sessionId, step.id)
    updateStepResult(session.sessionId, step.id, 'running')

    for (const tc of step.toolCalls) {
      try {
        const resolvedParams = JSON.parse(
          JSON.stringify(tc.params).replace(
            new RegExp(`"${ROOT_NODE_ID_PLACEHOLDER}"`, 'g'),
            JSON.stringify(session.context.rootNodeId || ''),
          ),
        )
        const stepRequest: JSONRPCRequest = {
          jsonrpc: '2.0',
          id: `${id}-${step.id}`,
          method: 'tools/call',
          params: { name: tc.tool, arguments: resolvedParams },
        }
        const response = await routeToolCall(stepRequest, bridge, forwardToPlugin, sourceId)
        if ('result' in response && response.result) {
          const text = extractResponseText(response)
          if (text) {
            try {
              const parsed = JSON.parse(text)
              if (parsed.id || parsed.nodeId) {
                const nodeId = parsed.id || parsed.nodeId
                session.context.rootNodeId = nodeId
                const existing = (session.context.nodeIds as string[]) || []
                session.context.nodeIds = [...existing, nodeId]
              }
            } catch { /* 非 JSON 输出/无 id 时忽略（非关键） */ }
          }
        }
      } catch (err: any) {
        if (step.fallback) {
          errors.push(`${step.id}/${tc.tool}: ${err.message} → fallback: ${step.fallback}`)
          continue
        }
        errors.push(`${step.id}/${tc.tool}: ${err.message}`)
        updateStepResult(session.sessionId, step.id, 'failed', undefined, err.message)
      }
    }

    updateStepResult(session.sessionId, step.id, 'completed')
    advanceStep(session.sessionId)
  }

  bridge.sendTaskStep('review', 'running', '正在审查设计质量...')
  updateSessionStatus(session.sessionId, 'reviewing')

  const queryPlugin = async (method: string, params: Record<string, unknown>) => {
    try {
      return await forwardToPlugin({ jsonrpc: '2.0', id: `${id}-query`, method, params }, sourceId)
    } catch {
      return null
    }
  }

  const qualityReport = await evaluateQuality(session, queryPlugin)
  let iteration = 0

  while (shouldIterate(qualityReport, iteration)) {
    iteration++
    bridge.sendTaskStep('generate', 'running', `第 ${iteration} 次迭代优化 (评分: ${Math.round(qualityReport.overallScore * 100)}%)`)

    for (const gate of qualityReport.gates) {
      if (!gate.pass && gate.suggestions.length > 0) {
        try {
          const stepRequest: JSONRPCRequest = {
            jsonrpc: '2.0',
            id: `${id}-iterate-${iteration}`,
            method: 'tools/call',
            params: { name: 'design_suggest_batch', arguments: { instructions: gate.suggestions } },
          }
          await routeToolCall(stepRequest, bridge, forwardToPlugin, sourceId)
        } catch {
          // non-critical
        }
      }
    }

    const updatedSession = getSession(session.sessionId)
    if (updatedSession) {
      const newReport = await evaluateQuality(updatedSession, queryPlugin)
      Object.assign(qualityReport, newReport)
      qualityReport.iteration = iteration
    }
  }

  bridge.sendTaskStep('review', 'completed',
    qualityReport.passed
      ? `设计质量通过 (评分: ${Math.round(qualityReport.overallScore * 100)}%)`
      : `设计质量需关注 (评分: ${Math.round(qualityReport.overallScore * 100)}%)`)

  updateSessionStatus(session.sessionId, 'completed')
  bridge.sendTaskComplete('success', '设计完成')

  const applyFindings = args.applyFindings === true
  if (applyFindings && session.context.rootNodeId) {
    bridge.sendTaskStep('review', 'running', '正在生成质量注解...')
    await createQualityAnnotations(
      session.context.rootNodeId as string,
      qualityReport,
      bridge,
      forwardToPlugin,
      sourceId,
      `${id}-qa`,
    )
  }

  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{
        type: 'text',
        text: JSON.stringify({
          sessionId: session.sessionId,
          mode: config.mode,
          intention: {
            pageType: intention.pageType,
            layout: intention.layout,
            components: intention.components.length,
            theme: intention.theme,
          },
          plan: {
            totalSteps: plan.steps.length,
            steps: plan.steps.map(s => ({
              id: s.id, type: s.type, description: s.description, status: s.status || 'pending',
            })),
          },
          quality: {
            overallScore: qualityReport.overallScore,
            passed: qualityReport.passed,
            details: qualityReport.gates.map(g => ({
              gate: g.gate, pass: g.pass, score: g.score, suggestions: g.suggestions,
            })),
          },
          iterations: iteration,
          errors: errors.length > 0 ? errors : undefined,
          message: qualityReport.passed
            ? '设计已完成并通过质量审查'
            : '设计已完成，部分质量指标未达标，建议使用 agent_iterate_design 继续优化',
        }, null, 2),
      }],
    },
  }
}

async function handleAgentGetStatus(
  args: Record<string, unknown>,
  id: string | number,
): Promise<JSONRPCResponse> {
  const sessionId = args.sessionId as string
  if (!sessionId) {
    return { jsonrpc: '2.0', id, error: { code: -32602, message: 'sessionId is required' } }
  }
  const session = getSession(sessionId)
  if (!session) {
    return { jsonrpc: '2.0', id, error: { code: -32000, message: `Session not found: ${sessionId}` } }
  }
  const currentStep = session.currentStepIndex < session.plan.steps.length
    ? session.plan.steps[session.currentStepIndex]
    : null
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{
        type: 'text',
        text: JSON.stringify({
          sessionId: session.sessionId,
          status: session.status,
          progress: `${session.currentStepIndex}/${session.plan.steps.length}`,
          currentStep: currentStep ? {
            id: currentStep.id, type: currentStep.type,
            description: currentStep.description, status: currentStep.status,
          } : null,
          config: session.config,
        }, null, 2),
      }],
    },
  }
}

async function handleAgentIterateDesign(
  args: Record<string, unknown>,
  id: string | number,
  forwardToPlugin: (request: JSONRPCRequest, sessionId?: string) => Promise<JSONRPCResponse>,
  bridge: ToolRouterBridge,
  sourceId?: string,
): Promise<JSONRPCResponse> {
  const sessionId = args.sessionId as string
  const feedback = args.feedback as string
  if (!sessionId) {
    return { jsonrpc: '2.0', id, error: { code: -32602, message: 'sessionId is required' } }
  }
  const session = getSession(sessionId)
  if (!session) {
    return { jsonrpc: '2.0', id, error: { code: -32000, message: `Session not found: ${sessionId}` } }
  }

  bridge.sendTaskPlan([
    { id: 'iterate', label: `迭代优化${feedback ? ': ' + feedback : ''}` },
    { id: 'review', label: '重新审查' },
  ])

  updateSessionStatus(session.sessionId, 'executing')
  rollbackToPrevious(session.sessionId)

  if (feedback) {
    bridge.sendTaskStep('iterate', 'running', `基于反馈优化: ${feedback}`)
    try {
      const stepRequest: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: `${id}-iterate-feedback`,
        method: 'tools/call',
        params: { name: 'design_suggest_batch', arguments: { instructions: [feedback] } },
      }
      await routeToolCall(stepRequest, bridge, forwardToPlugin, sourceId)
    } catch { /* non-critical */ }
    bridge.sendTaskStep('iterate', 'completed', '优化完成')
  }

  const updatedSession = getSession(session.sessionId)
  if (updatedSession) {
    const report = await evaluateQuality(updatedSession)
    bridge.sendTaskStep('review', 'completed', `质量评分: ${Math.round(report.overallScore * 100)}%`)
    updateSessionStatus(session.sessionId, 'completed')
    bridge.sendTaskComplete('success', '迭代完成')
    return {
      jsonrpc: '2.0', id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            sessionId: session.sessionId,
            quality: {
              overallScore: report.overallScore,
              passed: report.passed,
              gates: report.gates.map(g => ({ gate: g.gate, pass: g.pass, score: g.score })),
            },
            message: report.passed ? '迭代后设计质量通过' : '迭代已完成，质量仍有提升空间',
          }, null, 2),
        }],
      },
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32603, message: '迭代失败: 无法获取会话状态' } }
}
