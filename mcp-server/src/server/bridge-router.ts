/**
 * 多后端桥路由（BridgeRouter）
 *
 * 问题：一个 MCP 服务端要同时服务 MasterGo 插件（plugin-mastergo）与 Penpot 插件（plugin-penpot）。
 * 两个插件讲的是**同一套 JSON-RPC 协议**（这是 plugin-penpot 零改动复用
 * `ui/composables/useMCPConnection.ts` 的前提），因此差异只在三处：
 *   1. 客户端识别关键字（`MasterGo` / `Penpot`）
 *   2. 会话 id 前缀（`sess_` / `sess_penpot_`）
 *   3. clientId 段位（两个桥的计数器必须错开，否则 `findPluginClientByClientId(1)` 会撞）
 *
 * 设计：**前缀即路由信息**。
 * `tool-handlers.ts` 的 `ToolRouterBridge` 接口只传 `(sessionId?, clientId?)`，
 * 我们没有改任何调用点 —— Router 直接从前缀判断归属，所以：
 *   - `session_list` 返回的每个会话自带 `backend` 字段
 *   - `session_switch({ sessionId })` 天然选对后端
 *   - `_sessionId: 'sess_penpot_xxx'` 单次调用定向也直接生效
 *
 * 无显式会话时的默认后端（`resolveDefaultBackend`）优先级：
 *   1. `UXSHIP_BACKEND` / `defaultBackend` 显式指定（用户说了算）
 *   2. 唯一「有客户端连着」的后端（省得用户每次都要指定）
 *   3. `mastergo`（保持历史行为 —— 不能因为新增 Penpot 支持而改变老用户的默认路由）
 */
import { WebSocketBridge, BRIDGE_PROFILE, type BridgeBackend } from './ws-bridge.js'
import type { JSONRPCRequest, JSONRPCResponse } from '../types/index.js'
import { routeToolCall } from '../utils/tool-handlers.js'
import type { PluginClientInfo, SessionTarget, ToolRouterBridge } from '../utils/tool-handlers.js'

export interface BridgeRouterOptions {
  /** 无显式会话时的默认后端。缺省时按「唯一在线后端 → mastergo」推断 */
  defaultBackend?: BridgeBackend
}

export class BridgeRouter implements ToolRouterBridge {
  private readonly bridges = new Map<BridgeBackend, WebSocketBridge>()
  private defaultBackendOverride?: BridgeBackend

  constructor(options: BridgeRouterOptions = {}) {
    this.defaultBackendOverride = options.defaultBackend
  }

  /** 注册一个后端桥。同一后端重复注册会覆盖（便于测试） */
  register(backend: BridgeBackend, bridge: WebSocketBridge): void {
    this.bridges.set(backend, bridge)
  }

  has(backend: BridgeBackend): boolean {
    return this.bridges.has(backend)
  }

  get(backend: BridgeBackend): WebSocketBridge | undefined {
    return this.bridges.get(backend)
  }

  listBackends(): BridgeBackend[] {
    return [...this.bridges.keys()]
  }

  /** 运行期切换默认后端（`session_switch` 之外的全局偏好） */
  setDefaultBackend(backend: BridgeBackend | undefined): void {
    this.defaultBackendOverride = backend
  }

  // ── 路由决策 ──

  /**
   * 会话 id 前缀 → 归属后端。
   *
   * ⚠️ 必须取**最长前缀**，不能命中即返回：
   * `sess_`（mastergo）是 `sess_penpot_`（penpot）的前缀，命中即返回会把 Penpot
   * 的调用全部路由到 MasterGo —— 设计会画到错误的工具里，而且几乎没有报错。
   *
   * 已注册且前缀最长者优先；未注册但属于已知后端的（如 penpot 桥被 disable 了）
   * 也需识别出来，好让上层给出「后端未启用」这种可执行的错误。
   *
   * 共联模式下两个前缀在**同一个桥**上，所以问桥的 `matchSession()`（它同样取最长），
   * 并按桥实例去重（同一个桥在两个键下会出现两次）。
   */
  backendForSessionId(sessionId?: string): BridgeBackend | null {
    if (!sessionId) return null

    const candidates: { backend: BridgeBackend; length: number }[] = []
    for (const bridge of new Set(this.bridges.values())) {
      const matched = bridge.matchSession(sessionId)
      if (matched) candidates.push(matched)
    }
    // 已知但未注册（桥没启动）：一并参与「最长前缀」竞争，
    // 这样「penpot 被 disable 了，但请求指定了 Penpot 会话」能报准确错误，
    // 而不是被 mastergo 的 `sess_` 前缀默默吃掉。
    const known = Object.entries(BRIDGE_PROFILE) as [BridgeBackend, (typeof BRIDGE_PROFILE)[BridgeBackend]][]
    for (const [backend, profile] of known) {
      if (this.bridges.has(backend)) continue
      if (sessionId.startsWith(profile.sessionPrefix)) {
        candidates.push({ backend, length: profile.sessionPrefix.length })
      }
    }

    if (!candidates.length) return null
    candidates.sort((a, b) => b.length - a.length)
    return candidates[0].backend
  }

  /**
   * clientId → 归属后端。
   *
   * ⚠️ 必须用**客户端自己的 `backend`**，不能返回桥注册的键：
   * 共联模式下两种客户端都挂在同一个桥（注册在 `mastergo` 键下），
   * 拿键当后端会把 Penpot 客户端报成 mastergo。
   */
  backendForClientId(clientId?: number): BridgeBackend | null {
    if (clientId === undefined || clientId === null) return null
    for (const [registeredAs, bridge] of this.bridges) {
      const found = bridge.findPluginClientByClientId(clientId) as unknown as { backend?: BridgeBackend } | null
      if (found) return found.backend ?? registeredAs
    }
    return null
  }

  /**
   * 无显式会话时的默认后端。
   *
   * 注意「唯一在线后端」这一档：只有在**恰好一个**后端有客户端时才自动选中。
   * 两个都在线时必须回落到 mastergo（历史行为），绝不能随机挑一个 ——
   * 猜错后端会把「设计画到另一个工具里」，这是最难发现的一类错误。
   */
  resolveDefaultBackend(): BridgeBackend {
    if (this.defaultBackendOverride) return this.defaultBackendOverride

    const online = this.listBackends().filter((backend) => this.countClients(backend) > 0)
    if (online.length === 1) return online[0]

    if (online.length === 0) {
      // 都没在线时也不猜：报错信息会由各桥自己给（含「请先连接插件」的指引）
      return this.bridges.has('mastergo') ? 'mastergo' : (this.listBackends()[0] ?? 'mastergo')
    }

    return this.bridges.has('mastergo') ? 'mastergo' : online[0]
  }

  /**
   * 某后端的已连接客户端数。
   * 共联模式下两个后端在同一个桥上，必须把 backend 传下去过滤，
   * 否则 `getPluginCount()` 会把两种客户端一起数进来 → 默认后端推断全错。
   */
  /**
   * 某后端的已连接客户端数。
   *
   * 两个坑都在这里：
   *   1. 共联模式下两个后端在同一个桥上，必须把 backend 传下去过滤，
   *      否则 `getPluginCount()` 会把两种客户端一起数进来 → 默认后端推断全错。
   *   2. 共联模式下同一个桥占 `bridges` 的两个键，按 key 遍历会**重复计数** → 按实例去重。
   */
  private countClients(backend: BridgeBackend): number {
    let total = 0
    for (const bridge of new Set(this.bridges.values())) {
      if (!bridge.canServeBackend(backend)) continue
      total += bridge.getPluginCount(backend)
    }
    return total
  }

  /** 综合解析目标后端 */
  resolveBackend(sessionId?: string, clientId?: number): BridgeBackend {
    return this.backendForClientId(clientId) ?? this.backendForSessionId(sessionId) ?? this.resolveDefaultBackend()
  }

  /**
   * 选桥：优先「专门服务该后端的桥」（分端口模式），否则「能服务该后端的共用桥」（共联模式）。
   * 共联模式下两种客户端都挂在同一个桥上，所以不能只查 `bridges.get(backend)`。
   */
  private pickBridge(sessionId?: string, clientId?: number): { backend: BridgeBackend; bridge: WebSocketBridge | undefined } {
    const backend = this.resolveBackend(sessionId, clientId)
    const dedicated = this.bridges.get(backend)
    if (dedicated && dedicated.canServeBackend(backend)) return { backend, bridge: dedicated }
    for (const bridge of new Set(this.bridges.values())) {
      if (bridge.canServeBackend(backend)) return { backend, bridge }
    }
    return { backend, bridge: undefined }
  }

  // ── ToolRouterBridge ──

  async forwardRequest(request: JSONRPCRequest, sessionId?: string, clientId?: number): Promise<JSONRPCResponse> {
    const { backend, bridge } = this.pickBridge(sessionId, clientId)

    if (!bridge) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32000,
          message: `后端未启用: ${backend}（服务端未启动该后端的 WS 桥；请检查 UXSHIP_PENPOT_WS_PORT 等配置）`,
        },
      }
    }
    return bridge.forwardRequest(request, sessionId, clientId)
  }

  listPluginSessions(): PluginClientInfo[] {
    const sessions: PluginClientInfo[] = []
    // 共联模式下同一个桥占 `bridges` 的两个键（mastergo / penpot），
    // 按 key 遍历会把**每个会话列两遍** —— 必须按桥实例去重。
    for (const bridge of new Set(this.bridges.values())) {
      sessions.push(...(bridge.listPluginSessions() as PluginClientInfo[]))
    }
    // 稳定排序：先按后端（mastergo → penpot），再按连接时间
    const order: Record<string, number> = { mastergo: 0, penpot: 1 }
    return sessions.sort((a, b) => {
      const byBackend = (order[String(a.backend)] ?? 9) - (order[String(b.backend)] ?? 9)
      return byBackend !== 0 ? byBackend : a.connectedAt - b.connectedAt
    })
  }

  /**
   * 补齐 `backend` 字段。
   *
   * 桥自己的 `findPluginClientBy*` 返回的是 `PluginClient`（内部结构，不带 backend），
   * 直接透出会让 `session_list` 之外的调用方拿到 `backend: undefined` —— 与
   * `listPluginSessions()` 的口径不一致。统一在这里补齐。
   */
  private withBackend(backend: BridgeBackend, client: PluginClientInfo | null): PluginClientInfo | null {
    if (!client) return null
    return { ...client, backend, clientType: client.clientType ?? `${backend}-plugin` }
  }

  /** 会话列表 + 实时补全（共联下每个桥自己补全，再合并去重） */
  async listPluginSessionsResolved(): Promise<PluginClientInfo[]> {
    const collected: PluginClientInfo[] = []
    for (const bridge of new Set(this.bridges.values())) {
      collected.push(...(await bridge.listPluginSessionsResolved()))
    }
    const order: Record<string, number> = { mastergo: 0, penpot: 1 }
    return collected.sort((a, b) => {
      const byBackend = (order[String(a.backend)] ?? 9) - (order[String(b.backend)] ?? 9)
      return byBackend !== 0 ? byBackend : a.connectedAt - b.connectedAt
    })
  }

  findPluginClientBySessionId(sessionId: string): PluginClientInfo | null {
    const backend = this.backendForSessionId(sessionId)
    if (backend) {
      const bridge = this.pickBridge(sessionId)?.bridge ?? this.bridges.get(backend)
      if (bridge) {
        return this.withBackend(backend, bridge.findPluginClientBySessionId(sessionId) as PluginClientInfo | null)
      }
    }
    // 前缀不匹配 / 后端未注册：逐个找（容忍自定义 sessionPrefix）
    for (const [candidate, bridge] of this.bridges) {
      const found = bridge.findPluginClientBySessionId(sessionId)
      if (found) return this.withBackend(candidate, found as PluginClientInfo)
    }
    return null
  }

  findPluginClientByClientId(clientId: number): PluginClientInfo | null {
    // 先按 clientId → 后端解析，再在能服务该后端的桥里精确查找
    const backend = this.backendForClientId(clientId)
    if (backend) {
      for (const bridge of this.bridges.values()) {
        if (!bridge.canServeBackend(backend)) continue
        const found = bridge.findPluginClientByClientId(clientId)
        if (found) return this.withBackend(backend, found as PluginClientInfo)
      }
    }
    // 兜底：逐个桥找（容忍自定义 clientId 段位）
    for (const [candidate, bridge] of this.bridges) {
      const found = bridge.findPluginClientByClientId(clientId)
      if (found) return this.withBackend(candidate, found as PluginClientInfo)
    }
    return null
  }

  findPluginClientByCodename(codename: string): PluginClientInfo | null {
    for (const [backend, bridge] of this.bridges) {
      const found = bridge.findPluginClientByCodename(codename)
      if (found) return this.withBackend(backend, found as PluginClientInfo)
    }
    return null
  }

  /**
   * 任务进度通知：广播到所有在线后端。
   *
   * 为什么广播而不是只发目标后端：`task_plan/step/complete` 是**UI 展示**用途，
   * 没有任何副作用；而定位「本轮操作到底落在哪个后端」在进度阶段并不可靠
   * （进度通知不带会话上下文）。广播的代价只是另一个插件面板多刷几行。
   */
  sendTaskPlan(steps: { id: string; label: string }[]): void {
    for (const bridge of this.bridges.values()) bridge.sendTaskPlan(steps)
  }

  sendTaskStep(id: string, status: 'pending' | 'running' | 'completed' | 'failed', message?: string): void {
    for (const bridge of this.bridges.values()) bridge.sendTaskStep(id, status, message)
  }

  sendTaskComplete(status: 'success' | 'failed', message?: string): void {
    for (const bridge of this.bridges.values()) bridge.sendTaskComplete(status, message)
  }

  sendNotification(method: string, params: unknown, sessionId?: string): void {
    const backend = this.backendForSessionId(sessionId)
    if (backend) {
      this.bridges.get(backend)?.sendNotification(method, params, sessionId)
      return
    }
    // 指定了 sessionId 但前缀不归属任何桥 → 不发（避免误发给无关插件）
    if (sessionId) return
    for (const bridge of this.bridges.values()) bridge.sendNotification(method, params)
  }

  /**
   * 活跃会话（session_switch 持久化）。
   *
   * target.sessionId 已经携带后端前缀，因此**不需要额外的 backend 字段** ——
   * `base.*` 与 `sess_penpot_*` 各自能唯一归属一个桥。
   */
  setActiveSession(sourceId: string, target: SessionTarget): void {
    for (const bridge of this.bridges.values()) bridge.setActiveSession(sourceId, target)
  }

  getActiveSession(sourceId?: string): SessionTarget | undefined {
    for (const bridge of this.bridges.values()) {
      const target = bridge.getActiveSession(sourceId)
      if (target) return target
    }
    return undefined
  }

  /** 本地工具（icon_search / design_to_code_update …）与服务端同源，随便挑一个桥即可 */
  handleLocalTool(request: JSONRPCRequest): JSONRPCResponse | Promise<JSONRPCResponse> {
    for (const bridge of this.bridges.values()) return bridge.handleLocalTool(request)
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32601, message: 'Method not found' },
    }
  }

  // ── ServerBridge（HttpServer / SdkServer 需要） ──

  isPluginConnected(): boolean {
    return this.listBackends().some((backend) => this.countClients(backend) > 0)
  }

  /**
   * tools/call 入口（HTTP /mcp 用）。
   * 体内转发用的是 `this.forwardRequest` —— 也就是说**每一次工具调用都经 router 重新选后端**，
   * 而不是在入口处就绑定一个后端。这样同一个 HTTP 客户端可以混合操作两个设计工具。
   */
  async handleToolsCall(request: JSONRPCRequest, sourceId?: string): Promise<JSONRPCResponse> {
    return routeToolCall(request, this, this.forwardRequest.bind(this), sourceId)
  }

  // ── 其它 ──

  /** 健康检查用：各后端的连接数 */
  describeBackends(): { backend: BridgeBackend; clients: number }[] {
    return this.listBackends().map((backend) => ({
      backend,
      clients: this.countClients(backend),
    }))
  }

  async stop(): Promise<void> {
    for (const bridge of this.bridges.values()) {
      await bridge.stop()
    }
  }
}
