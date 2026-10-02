import { describe, it, expect } from 'vitest'
import type { JSONRPCRequest, JSONRPCResponse } from '../src/types/index.js'
import { routeToolCall, type ToolRouterBridge } from '../src/utils/tool-handlers.js'
import { getLocalToolNames } from '../src/utils/tools.js'
import { executeLocalTool } from '../src/utils/local-tools.js'

/**
 * 工具路由回归测试
 *
 * 背景：LOCAL_TOOLS（icon_search / design_to_code_update …）曾统一落到
 * bridge.handleLocalTool()，而 ws-bridge 的实现固定返回 Method not found，
 * 导致这些工具在真实链路上完全不可用。这里锁住修复后的行为：
 * 本地工具交给 executeLocalTool 执行，插件工具才转发。
 */

/** routeToolCall 中在 getPluginMethod 之前就被显式分支处理的工具名 */
const EXPLICITLY_HANDLED = [
  'code_to_design',
  'task_plan', 'task_step', 'task_complete',
  'design_suggest', 'design_suggest_batch', 'design_review',
  'codebase_get_structure',
  'session_list', 'session_switch',
  'agent_design_by_intent', 'agent_get_status', 'agent_iterate_design',
  'get_version', 'get_guidelines',
  'team_library_list', 'team_component_search', 'team_style_list', 'team_library_sync',
  // 服务端编排：按名建库 + 合成原生变体集（按实参转发 1 或 2 次，见 handleConvertToComponent）
  'node_convert_to_component',
]

function makeBridge(overrides: Partial<ToolRouterBridge> = {}): ToolRouterBridge {
  return {
    forwardRequest: async (req) =>
      ({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'plugin stub' } }) as JSONRPCResponse,
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
    ...overrides,
  }
}

function call(name: string, args: Record<string, unknown>, id = 1): JSONRPCRequest {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }
}

function text(response: JSONRPCResponse): string {
  return (response as any).result?.content?.[0]?.text ?? ''
}

const MINIMAL_DSL = {
  version: '2.0',
  elements: [{ type: 'frame', name: 'Root', size: { width: 200, height: 120 }, children: [] }],
}

describe('routeToolCall — 服务端本地工具', () => {
  it('executes design_to_code_update locally instead of forwarding to a missing plugin method', async () => {
    const bridge = makeBridge()
    const response = await routeToolCall(
      call('design_to_code_update', { sessionId: 'sess_test', dsl: MINIMAL_DSL, framework: 'html' }),
      bridge,
      bridge.forwardRequest,
    )

    expect((response as any).error).toBeUndefined()
    const payload = JSON.parse(text(response))
    expect(payload.sessionId).toBe('sess_test')
    expect(payload.framework).toBe('html')
    expect(typeof payload.html).toBe('string')
    expect(payload.parts).toBeTruthy()
  })

  it('surfaces real local-tool errors as isError text (not Method not found)', async () => {
    const bridge = makeBridge()
    const response = await routeToolCall(
      call('design_to_code_update', { dsl: MINIMAL_DSL }), // 缺少 sessionId
      bridge,
      bridge.forwardRequest,
    )

    expect((response as any).result.isError).toBe(true)
    expect(text(response)).toMatch(/sessionId is required/)
  })

  it('returns invalid-DSL diagnostics instead of throwing', async () => {
    const bridge = makeBridge()
    const response = await routeToolCall(
      call('design_to_code_update', { sessionId: 's', dsl: { version: '2.0', elements: [] } }),
      bridge,
      bridge.forwardRequest,
    )

    const payload = JSON.parse(text(response))
    expect(payload.valid).toBe(false)
    expect(payload.errors.join(' ')).toMatch(/empty/i)
  })

  it('every LOCAL_TOOLS entry is handled explicitly or implemented in local-tools', async () => {
    const unimplemented: string[] = []
    for (const name of getLocalToolNames()) {
      if (EXPLICITLY_HANDLED.includes(name)) continue
      try {
        await executeLocalTool(name, {})
      } catch (err: any) {
        if (/^Unknown local tool/.test(err?.message || '')) unimplemented.push(name)
      }
    }
    expect(unimplemented).toEqual([])
  })
})

describe('routeToolCall — 插件工具转发', () => {
  it('routes node_get to node/get without local interception', async () => {
    let forwardedMethod = ''
    const bridge = makeBridge({
      forwardRequest: async (req) => {
        forwardedMethod = req.method
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: { content: [{ type: 'text', text: '{"id":"1:2"}' }] },
        } as JSONRPCResponse
      },
    })

    const response = await routeToolCall(call('node_get', { nodeId: '1:2' }), bridge, bridge.forwardRequest)
    expect(forwardedMethod).toBe('node/get')
    expect(text(response)).toBe('{"id":"1:2"}')
  })

  it('routes node_swap_component to node/swapComponent', async () => {
    let forwardedMethod = ''
    let forwardedParams: any = null
    const bridge = makeBridge({
      forwardRequest: async (req) => {
        forwardedMethod = req.method
        forwardedParams = req.params
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: { content: [{ type: 'text', text: '{"swapped":1}' }] },
        } as JSONRPCResponse
      },
    })

    const response = await routeToolCall(
      call('node_swap_component', { nodeId: '1:2', ukey: 'uk1', variant: 'Hover' }),
      bridge,
      bridge.forwardRequest,
    )
    expect(forwardedMethod).toBe('node/swapComponent')
    expect(forwardedParams).toMatchObject({ nodeId: '1:2', ukey: 'uk1', variant: 'Hover' })
    expect(text(response)).toBe('{"swapped":1}')
  })

  it('routes canvas_zoom_to_node to canvas/zoomToNode with focus params', async () => {
    let forwardedMethod = ''
    let forwardedParams: any = null
    const bridge = makeBridge({
      forwardRequest: async (req) => {
        forwardedMethod = req.method
        forwardedParams = req.params
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: { content: [{ type: 'text', text: '{"success":true,"focusedNodeIds":["1:2"]}' }] },
        } as JSONRPCResponse
      },
    })

    const response = await routeToolCall(
      call('canvas_zoom_to_node', { nodeId: '1:2', select: false, zoom: 1 }),
      bridge,
      bridge.forwardRequest,
    )
    expect(forwardedMethod).toBe('canvas/zoomToNode')
    expect(forwardedParams).toMatchObject({ nodeId: '1:2', select: false, zoom: 1 })
    expect(text(response)).toContain('focusedNodeIds')
  })

  it('routes selection_set to selection/set', async () => {
    let forwardedMethod = ''
    const bridge = makeBridge({
      forwardRequest: async (req) => {
        forwardedMethod = req.method
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: { content: [{ type: 'text', text: '{"selectedCount":2}' }] },
        } as JSONRPCResponse
      },
    })

    await routeToolCall(call('selection_set', { nodeIds: ['1:2', '3:4'] }), bridge, bridge.forwardRequest)
    expect(forwardedMethod).toBe('selection/set')
  })

  it('routes team_component_import to teamLibrary/importComponent', async () => {
    let forwardedMethod = ''
    let forwardedParams: any = null
    const bridge = makeBridge({
      forwardRequest: async (req) => {
        forwardedMethod = req.method
        forwardedParams = req.params
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: { content: [{ type: 'text', text: '{"count":1}' }] },
        } as JSONRPCResponse
      },
    })

    const response = await routeToolCall(
      call('team_component_import', { ukey: 'uk1', x: 10, y: 20 }),
      bridge,
      bridge.forwardRequest,
    )
    expect(forwardedMethod).toBe('teamLibrary/importComponent')
    expect(forwardedParams).toMatchObject({ ukey: 'uk1', x: 10, y: 20 })
    expect(text(response)).toBe('{"count":1}')
  })
})
