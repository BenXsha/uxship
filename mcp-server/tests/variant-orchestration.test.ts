import { describe, it, expect } from 'vitest'
import type { JSONRPCRequest, JSONRPCResponse } from '../src/types/index.js'
import { routeToolCall, type ToolRouterBridge } from '../src/utils/tool-handlers.js'

/**
 * `node_convert_to_component` 服务端编排（按容器建库 + 合成原生变体集）
 *
 * 锁住三件事：
 *   1. 转发**次数与参数**：不带 combineVariants 只转 1 次；带则转 2 次（列举 → 执行），
 *      且服务端修饰符（combineVariants / variantPropertyName）绝不进插件协议；
 *   2. `_sessionId` **透传**：两次转发都落在同一个会话上，且不作为普通参数发给插件；
 *   3. 响应合并：variantSets / components / skipped / notes（服务端解析 + 插件执行前缀）。
 */

interface Forward {
  method?: string
  id: string | number
  params: Record<string, any>
  sessionId?: string
  clientId?: number
}

/** 记录每一次转发，并按 method+params 返回可编程的插件响应 */
function makeHarness(responder: (forward: Forward, call: number) => Record<string, any>) {
  const forwards: Forward[] = []
  const bridge: ToolRouterBridge = {
    forwardRequest: async (req: JSONRPCRequest, sessionId?: string, clientId?: number) => {
      const forward: Forward = {
        method: req.method,
        id: req.id,
        params: (req.params || {}) as Record<string, any>,
        sessionId,
        clientId,
      }
      forwards.push(forward)
      const payload = responder(forward, forwards.length)
      if (payload && '__error' in payload) {
        return { jsonrpc: '2.0', id: req.id, error: payload.__error as any } as JSONRPCResponse
      }
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
      } as JSONRPCResponse
    },
    listPluginSessions: () => [],
    findPluginClientBySessionId: () => null,
    setActiveSession: () => {},
    getActiveSession: () => undefined,
    sendNotification: () => {},
    sendTaskPlan: () => {},
    sendTaskStep: () => {},
    sendTaskComplete: () => {},
    handleLocalTool: (req: JSONRPCRequest) =>
      ({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } }) as JSONRPCResponse,
  }
  return { bridge, forwards }
}

function call(args: Record<string, unknown>, id: string | number = 1): JSONRPCRequest {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'node_convert_to_component', arguments: args } }
}

function text(response: JSONRPCResponse): string {
  return (response as any).result?.content?.[0]?.text ?? ''
}

/** 范围内成员：首段 = 类型（Button/Badge）；单段名是容器/组框本身，会被跳过 */
const MATCHED = [
  { nodeId: '1:1', name: 'Button_Primary', type: 'FRAME' },
  { nodeId: '1:2', name: 'Button_Secondary', type: 'FRAME' },
  { nodeId: '1:3', name: 'Badge_Only', type: 'FRAME' },
  { nodeId: '1:4', name: 'Components', type: 'FRAME' },
]

const SCOPE = { containerId: 'comp:1' }
const SCOPE_LABEL = 'containerId=comp:1'

describe('node_convert_to_component — 不带 combineVariants（与今天行为一致）', () => {
  it('nodeId 形态只转发 1 次，参数原样（透传 containerId 之外的形态也一样）', async () => {
    const { bridge, forwards } = makeHarness(() => ({ success: true, componentId: '9:9' }))
    const response = await routeToolCall(call({ nodeId: '1:1', keepOriginal: true }), bridge, bridge.forwardRequest)

    expect(forwards).toHaveLength(1)
    expect(forwards[0].method).toBe('node/convertToComponent')
    expect(forwards[0].params).toEqual({ nodeId: '1:1', keepOriginal: true })
    expect(text(response)).toBe('{"success":true,"componentId":"9:9"}')
  })

  it('listOnly 单独用时直接转发并原样回传 matched（1 次）', async () => {
    const { bridge, forwards } = makeHarness(() => ({ ok: true, matched: MATCHED, count: 0, components: [], skipped: [] }))
    const response = await routeToolCall(
      call({ ...SCOPE, listOnly: true }),
      bridge,
      bridge.forwardRequest,
    )

    expect(forwards).toHaveLength(1)
    expect(forwards[0].params).toEqual({ ...SCOPE, listOnly: true })
    const payload = JSON.parse(text(response))
    expect(payload.matched).toEqual(MATCHED)
  })

  it('服务端修饰符不进插件协议（combineVariants/variantPropertyName 被剔除）', async () => {
    const { bridge, forwards } = makeHarness(() => ({ ok: true }))
    await routeToolCall(
      call({ nodeId: '1:1', combineVariants: false, variantPropertyName: 'State' }),
      bridge,
      bridge.forwardRequest,
    )

    expect(forwards).toHaveLength(1)
    expect(forwards[0].params).toEqual({ nodeId: '1:1' })
    expect(forwards[0].params.combineVariants).toBeUndefined()
    expect(forwards[0].params.variantPropertyName).toBeUndefined()
  })

  it('插件报错时原样返回（不做合并）', async () => {
    const { bridge, forwards } = makeHarness(() => ({ __error: { code: -32000, message: 'plugin fail' } }))
    const response = await routeToolCall(call({ nodeId: '1:1' }), bridge, bridge.forwardRequest)

    expect(forwards).toHaveLength(1)
    expect((response as any).error.message).toBe('plugin fail')
  })
})

describe('node_convert_to_component — combineVariants 编排（containerId 作用域）', () => {
  const pluginApply = {
    ok: true,
    success: true,
    count: 2,
    components: [
      { nodeId: '1:1', componentId: '9:1', name: 'State=Primary' },
      { nodeId: '1:2', componentId: '9:2', name: 'State=Secondary' },
    ],
    skipped: [],
    variantSets: [
      { setId: 'Button', containerId: '7:1', propertyName: 'State', memberCount: 2, values: ['Primary', 'Secondary'], ok: true },
    ],
    notes: ['宿主把 Set 放在页面末尾'],
  }

  it('转发 2 次：先 {containerId,listOnly} 后 {variantGroups,keepOriginal}', async () => {
    const { bridge, forwards } = makeHarness((forward) =>
      forward.params.listOnly ? { ok: true, matched: MATCHED } : pluginApply,
    )
    await routeToolCall(
      call({ ...SCOPE, combineVariants: true, keepOriginal: true }),
      bridge,
      bridge.forwardRequest,
    )

    expect(forwards).toHaveLength(2)
    expect(forwards[0].method).toBe('node/convertToComponent')
    expect(forwards[0].params).toEqual({ ...SCOPE, listOnly: true })
    expect(forwards[1].method).toBe('node/convertToComponent')
    expect(forwards[1].params).toEqual({
      variantGroups: [
        {
          setId: 'Button',
          propertyName: 'State',
          members: [
            { nodeId: '1:1', value: 'Primary' },
            { nodeId: '1:2', value: 'Secondary' },
          ],
        },
      ],
      keepOriginal: true,
    })
  })

  it('variantPropertyName 覆盖轴名并写进 variantGroups（不进插件顶层参数）', async () => {
    const { bridge, forwards } = makeHarness((forward) =>
      forward.params.listOnly ? { ok: true, matched: MATCHED } : pluginApply,
    )
    await routeToolCall(
      call({ ...SCOPE, combineVariants: true, variantPropertyName: 'Variant' }),
      bridge,
      bridge.forwardRequest,
    )

    expect(forwards[1].params.variantGroups[0].propertyName).toBe('Variant')
    expect(forwards[1].params.variantPropertyName).toBeUndefined()
    expect(forwards[0].params.variantPropertyName).toBeUndefined()
  })

  it('variantPropertyName 逗号多轴 → variantGroups 带 properties[]/values[]（同一套生成基准）', async () => {
    const matchedMulti = [
      { nodeId: '1:1', name: 'Button_Primary_Default', type: 'FRAME' },
      { nodeId: '1:2', name: 'Button_Secondary_Hover', type: 'FRAME' },
    ]
    const { bridge, forwards } = makeHarness((forward) =>
      forward.params.listOnly ? { ok: true, matched: matchedMulti } : pluginApply,
    )
    await routeToolCall(
      call({ ...SCOPE, combineVariants: true, variantPropertyName: 'Variant, State' }),
      bridge,
      bridge.forwardRequest,
    )

    expect(forwards[1].params.variantGroups).toEqual([
      {
        setId: 'Button',
        propertyName: 'Variant',
        properties: ['Variant', 'State'],
        members: [
          { nodeId: '1:1', value: 'Primary', values: ['Primary', 'Default'] },
          { nodeId: '1:2', value: 'Secondary', values: ['Secondary', 'Hover'] },
        ],
      },
    ])
    expect(forwards[1].params.variantPropertyName).toBeUndefined()
  })

  it('合并响应：variantSets/components 来自插件，notes 带作用域前缀，singles 进 skipped', async () => {
    const { bridge } = makeHarness((forward) =>
      forward.params.listOnly ? { ok: true, matched: MATCHED } : pluginApply,
    )
    const response = await routeToolCall(
      call({ ...SCOPE, combineVariants: true }),
      bridge,
      bridge.forwardRequest,
    )

    const payload = JSON.parse(text(response))
    expect(payload.ok).toBe(true)
    expect(payload.success).toBe(true) // 插件回传的 success 一并带上（与旧三形态一致）
    expect(payload.count).toBe(2)
    expect(payload.variantSets).toEqual(pluginApply.variantSets)
    expect(payload.components).toHaveLength(2)
    // 无轴值的容器名 + 单成员组都进服务端 notes
    expect(payload.notes).toContain(
      `服务端解析（${SCOPE_LABEL}）：跳过 "Components"：只有组件类型、没有轴值（应为 <类型>_<轴值>，如 Button_Default）`,
    )
    expect(payload.notes).toContain(
      `服务端解析（${SCOPE_LABEL}）："Badge" 只有 1 个成员，不合成变体集（已记入 singles，未参与转换）`,
    )
    // 插件 notes 加另一个前缀
    expect(payload.notes).toContain('插件执行：宿主把 Set 放在页面末尾')
    // 单成员组成员如实记入 skipped（匹配到但没转换，不静默）
    expect(payload.skipped).toContainEqual({
      nodeId: '1:3',
      name: 'Badge_Only',
      reason: 'variant-group-too-small',
      message: '只有 1 个成员，不合成变体集',
    })
  })

  it('缺少作用域（containerId / namePrefix 都没有）→ -32602，且一次转发都不发', async () => {
    const { bridge, forwards } = makeHarness(() => ({ ok: true }))
    const response = await routeToolCall(
      call({ nodeId: '1:1', combineVariants: true }),
      bridge,
      bridge.forwardRequest,
    )

    expect(forwards).toHaveLength(0)
    expect((response as any).error.code).toBe(-32602)
    expect((response as any).error.message).toMatch(/containerId/)
  })

  it('namePrefix 旧式作用域仍可用（向后兼容）', async () => {
    const { bridge, forwards } = makeHarness((forward) =>
      forward.params.listOnly ? { ok: true, matched: MATCHED } : pluginApply,
    )
    await routeToolCall(
      call({ namePrefix: 'Button_', combineVariants: true }),
      bridge,
      bridge.forwardRequest,
    )

    expect(forwards[0].params).toEqual({ namePrefix: 'Button_', listOnly: true })
  })

  it('没有成员 ≥2 的组 → 只发 1 次（不空转第 2 次），ok:false + notes', async () => {
    const { bridge, forwards } = makeHarness((forward) =>
      forward.params.listOnly
        ? { ok: true, matched: [{ nodeId: '1:1', name: 'Badge_Only' }] }
        : pluginApply,
    )
    const response = await routeToolCall(
      call({ ...SCOPE, combineVariants: true }),
      bridge,
      bridge.forwardRequest,
    )

    expect(forwards).toHaveLength(1)
    const payload = JSON.parse(text(response))
    expect(payload.ok).toBe(false)
    expect(payload.count).toBe(0)
    expect(payload.variantSets).toEqual([])
    expect(payload.notes.join('\n')).toMatch(/没有成员 ≥2 的组/)
    expect(payload.skipped).toHaveLength(1)
  })

  it('插件未返回 matched[]（旧版插件）→ ok:false + 明确 notes，不抛错', async () => {
    const { bridge, forwards } = makeHarness(() => ({ ok: true, matched: 3 }))
    const response = await routeToolCall(
      call({ ...SCOPE, combineVariants: true }),
      bridge,
      bridge.forwardRequest,
    )

    expect(forwards).toHaveLength(1)
    const payload = JSON.parse(text(response))
    expect(payload.ok).toBe(false)
    expect(payload.notes.join('\n')).toMatch(/插件未返回 matched\[\]/)
  })

  it('列举步骤插件报错 → 原样返回，不发第 2 次', async () => {
    const { bridge, forwards } = makeHarness(() => ({ __error: { code: -32603, message: 'findAll missing' } }))
    const response = await routeToolCall(
      call({ ...SCOPE, combineVariants: true }),
      bridge,
      bridge.forwardRequest,
    )

    expect(forwards).toHaveLength(1)
    expect((response as any).error.message).toBe('findAll missing')
  })

  it('执行步骤插件报错 → 原样返回（不吞掉宿主错误）', async () => {
    const { bridge, forwards } = makeHarness((forward) =>
      forward.params.listOnly
        ? { ok: true, matched: MATCHED }
        : { __error: { code: -32000, message: 'createVariantFromComponents 抛错' } },
    )
    const response = await routeToolCall(
      call({ ...SCOPE, combineVariants: true }),
      bridge,
      bridge.forwardRequest,
    )

    expect(forwards).toHaveLength(2)
    expect((response as any).error.message).toBe('createVariantFromComponents 抛错')
  })
})

describe('node_convert_to_component — _sessionId 路由透传', () => {
  it('两次转发都带 _sessionId 指向的会话，且参数里不残留 _sessionId', async () => {
    const { bridge, forwards } = makeHarness((forward) =>
      forward.params.listOnly
        ? { ok: true, matched: MATCHED }
        : { ok: true, count: 2, components: [], skipped: [], variantSets: [] },
    )
    await routeToolCall(
      call({ ...SCOPE, combineVariants: true, _sessionId: 'sess_penpot_A', _clientId: 42 }),
      bridge,
      bridge.forwardRequest,
    )

    expect(forwards).toHaveLength(2)
    for (const forward of forwards) {
      expect(forward.sessionId).toBe('sess_penpot_A')
      expect(forward.clientId).toBe(42)
      expect(forward.params._sessionId).toBeUndefined()
      expect(forward.params._clientId).toBeUndefined()
    }
  })

  it('单次转发路径同样透传 _sessionId', async () => {
    const { bridge, forwards } = makeHarness(() => ({ ok: true }))
    await routeToolCall(call({ nodeId: '1:1', _sessionId: 'sess_mg_B' }), bridge, bridge.forwardRequest)

    expect(forwards).toHaveLength(1)
    expect(forwards[0].sessionId).toBe('sess_mg_B')
    expect(forwards[0].params._sessionId).toBeUndefined()
  })
})
