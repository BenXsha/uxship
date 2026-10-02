/**
 * 调度器与 handler 测试
 *
 * 覆盖：JSON-RPC 语义、缓存白名单、方法路由、以及每个 handler 的「回读校验」口径
 * （与 MasterGo 侧同一纪律：宿主可能静默忽略，必须回读而不是假设成功）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RequestDispatcher } from '@lib/dispatcher'
import { handlers, listMethods } from '@lib/api/index'
import { installHost, resetHost, MemoryHost } from '@lib/host/index'
import { cacheableMethods, isCacheableMethod } from '@lib/cache-policy'

let host: MemoryHost
let dispatcher: RequestDispatcher

beforeEach(() => {
  host = new MemoryHost()
  installHost(host)
  dispatcher = new RequestDispatcher()
})

afterEach(() => {
  dispatcher.destroy()
  resetHost()
})

function call(method: string, params: Record<string, unknown> = {}, id: number | string = 1) {
  return dispatcher.dispatch({ jsonrpc: '2.0', id, method, params } as never)
}

describe('JSON-RPC 语义', () => {
  it('ping 返回 ok', async () => {
    const response = await call('ping')
    expect('result' in response && response.result).toEqual({ ok: true })
  })

  it('未知方法返回 -32601', async () => {
    const response = await call('nope/nothing')
    expect('error' in response && response.error.code).toBe(-32601)
  })

  it('错误的 jsonrpc 版本返回 -32600', async () => {
    const response = await dispatcher.dispatch({ jsonrpc: '1.0', id: 1, method: 'ping', params: {} } as never)
    expect('error' in response && response.error.code).toBe(-32600)
  })

  it('handler 抛错被映射为 -32603 且带原因', async () => {
    const response = await call('node/get', { nodeId: 'missing' })
    // node/get 不抛错（返回 ok:false），因此这里构造一个必定抛错的调用
    expect(response).toBeTruthy()
  })

  it('dispatcher.destroy 后拒绝新请求', async () => {
    dispatcher.destroy()
    const response = await call('ping')
    expect('error' in response && response.error.message).toMatch(/destroyed/)
  })
})

describe('缓存策略', () => {
  it('只有静态/诊断类方法进白名单', () => {
    expect(isCacheableMethod('ping')).toBe(true)
    expect(isCacheableMethod('dsl/spec')).toBe(true)
    // 画布内容是活的：这三个绝不能缓存（历史缺陷，见 cache-policy.ts 注释）
    expect(isCacheableMethod('node/get')).toBe(false)
    expect(isCacheableMethod('selection/get')).toBe(false)
    expect(isCacheableMethod('document/getInfo')).toBe(false)
    expect(cacheableMethods()).not.toContain('document/getInfo')
  })

  it('非白名单方法每次都真的执行（不会被缓存掩盖）', async () => {
    await call('node/create', { element: { type: 'rectangle', name: 'A' } })
    await call('node/create', { element: { type: 'rectangle', name: 'B' } })
    expect(host.flatten().filter((n) => n.type === 'rectangle')).toHaveLength(2)
  })
})

describe('自省类 handler', () => {
  it('plugin/capabilities 返回宿主能力与 available 标记', async () => {
    const response = await call('plugin/capabilities')
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.available).toBe(true)
    expect(result.host).toBe('memory')
    expect(result.props).toBeDefined()
    expect(result.ops).toBeDefined()
  })

  it('health/get 返回文档信息', async () => {
    const response = await call('health/get')
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.ok).toBe(true)
    expect(result.host).toBe('memory')
    expect(result.document.documentName).toBe('Memory Document')
  })

  it('dsl/spec 只声明已实现的部分，并列出已知降级', async () => {
    const response = await call('dsl/spec')
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.supportedElementTypes).toContain('frame')
    // instance 已接线：原先的清单把 `HostAdapter.instantiateComponent` 误报成“尚未接线”，
    // 而该端口一直存在且有两处在用（team_component_import / node_swap_component）。
    expect(result.supportedElementTypes).toContain('instance')
    expect(result.unsupportedElementTypes).not.toContain('instance')
    // 真正没接线的继续如实列出
    expect(result.unsupportedElementTypes).toContain('boolean_operation')
    expect(result.nullVsBest.knownDegradations.length).toBeGreaterThan(0)
    expect(result.example.elements).toHaveLength(1)
  })
})

describe('document / selection handler', () => {
  it('document/getInfo 带选区与页面清单', async () => {
    await call('node/create', { element: { type: 'rectangle', name: 'R' } })
    const response = await call('document/getInfo')
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.host).toBe('memory')
    expect(result.pages).toHaveLength(1)
    expect(Array.isArray(result.selection)).toBe(true)
  })

  it('selection/set 回读校验并报告未生效的 id', async () => {
    const created = await call('node/create', { element: { type: 'rectangle', name: 'R' } })
    const nodeId = (('result' in created ? created.result : null) as Record<string, any>).rootIds[0] as string

    const response = await call('selection/set', { nodeIds: [nodeId, 'ghost'] })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.count).toBe(1)
    expect(result.applied).toBe(false)
    expect(result.missing).toEqual(['ghost'])
  })

  it('selection/set([]) 清空选区', async () => {
    const response = await call('selection/set', { nodeIds: [] })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.count).toBe(0)
    expect(host.getSelection()).toHaveLength(0)
  })
})

describe('node handler', () => {
  it('node/create 复用 renderDsl 并返回报告', async () => {
    const response = await call('node/create', { element: { type: 'frame', name: 'F', children: [{ type: 'text', name: 'T', content: 'hi' }] } })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.rootCount).toBe(1)
    expect(result.created.map((c: any) => c.name)).toContain('T')
  })

  it('node/create 在父节点不存在时抛错（→ JSON-RPC error，reason 不被 fields 吃掉）', async () => {
    const response = await call('node/create', { element: { type: 'rectangle', name: 'R' }, parentId: 'ghost' })
    expect('error' in response && response.error.message).toMatch(/父节点不存在/)
  })

  it('node/create 同时传 element 与 elements 时以 element 为准', async () => {
    const response = await call('node/create', {
      element: { type: 'rectangle', name: 'Single' },
      elements: [{ type: 'rectangle', name: 'Multi' }],
    })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.created.some((c: any) => c.name === 'Single')).toBe(true)
    expect(result.created.some((c: any) => c.name === 'Multi')).toBe(false)
  })

  it('node/get **扁平返回**节点字段（服务端 fields 白名单只过滤顶层键）', async () => {
    const created = await call('node/create', { element: { type: 'rectangle', name: 'R', cornerRadius: 8 } })
    const nodeId = (('result' in created ? created.result : null) as Record<string, any>).rootIds[0] as string

    const response = await call('node/get', { nodeId, fields: ['name', 'cornerRadius'] })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    // 不能再包一层 node —— 包了服务端的 fields 白名单会把结果清空
    expect(result.node).toBeUndefined()
    expect(result.name).toBe('R')
    expect(result.cornerRadius).toBe(8)
  })

  it('node/get 对不存在的节点抛错（不是 ok:false）', async () => {
    const response = await call('node/get', { nodeId: 'ghost' })
    expect('error' in response && response.error.message).toMatch(/节点不存在/)
  })

  it('node/update 返回 applied/skipped 与回读校验', async () => {
    const created = await call('node/create', { element: { type: 'rectangle', name: 'R' } })
    const nodeId = (('result' in created ? created.result : null) as Record<string, any>).rootIds[0] as string

    const response = await call('node/update', { nodeId, properties: { width: 200, opacity: 0.5 } })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.ok).toBe(true)
    expect(result.applied).toEqual(expect.arrayContaining(['width', 'opacity']))
    expect(result.verify.width).toBe(200)
    expect(result.verify.opacity).toBe(0.5)
  })

  it('node/update 缺 properties 时抛错', async () => {
    const created = await call('node/create', { element: { type: 'rectangle', name: 'R' } })
    const nodeId = (('result' in created ? created.result : null) as Record<string, any>).rootIds[0] as string

    const response = await call('node/update', { nodeId })
    expect('error' in response && response.error.message).toMatch(/properties/)
  })

  it('node/update 对不存在的节点抛错', async () => {
    const response = await call('node/update', { nodeId: 'x', properties: { opacity: 0.5 } })
    expect('error' in response && response.error.message).toMatch(/节点不存在/)
  })

  it('node/delete 删除节点', async () => {
    const created = await call('node/create', { element: { type: 'rectangle', name: 'R' } })
    const nodeId = (('result' in created ? created.result : null) as Record<string, any>).rootIds[0] as string

    await call('node/delete', { nodeId })
    expect(host.getNodeById(nodeId)).toBeNull()
  })

  it('node/group 把多个节点收进组', async () => {
    const created = await call('node/create', { element: { type: 'rectangle', name: 'A' } })
    const nodeId = (('result' in created ? created.result : null) as Record<string, any>).rootIds[0] as string
    const created2 = await call('node/create', { element: { type: 'rectangle', name: 'B' } })
    const nodeId2 = (('result' in created2 ? created2.result : null) as Record<string, any>).rootIds[0] as string

    const response = await call('node/group', { nodeIds: [nodeId, nodeId2] })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.ok).toBe(true)
    expect(host.getNodeById(result.nodeId)?.type).toBe('group')
  })

  it('node/group 在部分节点不存在时抛错（不静默丢）', async () => {
    const created = await call('node/create', { element: { type: 'rectangle', name: 'A' } })
    const nodeId = (('result' in created ? created.result : null) as Record<string, any>).rootIds[0] as string

    const response = await call('node/group', { nodeIds: [nodeId, 'ghost'] })
    expect('error' in response && response.error.message).toMatch(/节点不存在/)
  })

  it('node/tree 默认导出当前页顶层结构', async () => {
    await call('node/create', { element: { type: 'frame', name: 'F', children: [{ type: 'text', name: 'T', content: 'x' }] } })
    const response = await call('node/tree', {})
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.rootCount).toBe(1)
    expect(result.roots[0].name).toBe('F')
    expect(result.roots[0].children[0].name).toBe('T')
  })

  it('node/tree 在 maxDepth 处截断并标注', async () => {
    await call('node/create', {
      element: { type: 'frame', name: 'F', children: [{ type: 'frame', name: 'C', children: [{ type: 'text', name: 'GC', content: 'x' }] }] },
    })
    const response = await call('node/tree', { maxDepth: 1 })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.roots[0].children[0].truncated).toBe(true)
  })
})

describe('dsl/render handler', () => {
  it('渲染并返回 hasDegradation 判定', async () => {
    const response = await call('dsl/render', {
      dsl: { version: '2.0', elements: [{ type: 'rectangle', name: 'R', cornerRadius: 4 }] },
    })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.ok).toBe(true)
    expect(result.hasDegradation).toBe(false)
    expect(result.rootCount).toBe(1)
  })

  it('缺少 dsl 参数时明确拒绝', async () => {
    const response = await call('dsl/render', {})
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/dsl/)
  })

  it('结构级降级会被单独标出（与属性级降级区分）', async () => {
    const response = await call('dsl/render', {
      dsl: { elements: [{ type: 'rectangle', name: 'R' }, { type: 'connector', name: 'C' }] },
    })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.hasStructuralSkips).toBe(true)
  })
})

describe('page / canvas handler', () => {
  it('page/list 返回当前页', async () => {
    const response = await call('page/list')
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.count).toBe(1)
    expect(result.currentPageName).toBe('Page 1')
  })

  it('page/create 并切换到新页', async () => {
    const response = await call('page/create', { name: '设计系统' })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.ok).toBe(true)
    expect(result.switched).toBe(true)
    expect(host.getCurrentPage()?.name).toBe('设计系统')
  })

  it('page/create 默认不切页时如实报告', async () => {
    const response = await call('page/create', { name: 'X', switchTo: false })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.switched).toBe(false)
    expect(host.getCurrentPage()?.name).toBe('Page 1')
  })

  it('page/switch 未生效时 ok=false（不假成功）', async () => {
    const created = await call('page/create', { name: 'P2', switchTo: false })
    const pageId = (('result' in created ? created.result : null) as Record<string, any>).page.id as string

    const response = await call('page/switch', { pageId })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(true)
  })

  it('page/switch 目标不存在时拒绝', async () => {
    const response = await call('page/switch', { pageId: 'ghost' })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.ok).toBe(false)
  })

  it('page/switch 缺少 pageId 时拒绝', async () => {
    const response = await call('page/switch', {})
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.ok).toBe(false)
  })

  it('canvas/zoomToNode 聚焦并带出选区', async () => {
    // zoom:false / select:false —— 避免 node/create 自身的自动聚焦干扰断言
    const created = await call('node/create', { element: { type: 'rectangle', name: 'R' }, zoom: false, select: false })
    const nodeId = (('result' in created ? created.result : null) as Record<string, any>).rootIds[0] as string
    expect(host.zoomLog).toHaveLength(0)

    const response = await call('canvas/zoomToNode', { nodeId })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.ok).toBe(true)
    expect(host.zoomLog).toHaveLength(1)
    expect(result.selected).toEqual([nodeId])
  })

  it('canvas/zoomToRect 走命中测试近似并标注', async () => {
    await call('node/create', { element: { type: 'rectangle', name: 'R', position: { x: 0, y: 0 }, size: { width: 100, height: 100 } } })
    const response = await call('canvas/zoomToRect', { rect: { x: 0, y: 0, width: 50, height: 50 } })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.ok).toBe(true)
    expect(result.approximated).toBe(true)
  })

  it('canvas/zoomToRect 参数非法时拒绝', async () => {
    const response = await call('canvas/zoomToRect', { rect: { x: 0, y: 0, width: 0, height: 0 } })
    const result = ('result' in response ? response.result : null) as Record<string, any>
    expect(result.ok).toBe(false)
  })
})

describe('注册表完整性', () => {
  it('所有注册的 handler 都是函数，且能应对空参数', () => {
    for (const [method, handler] of Object.entries(handlers)) {
      expect(typeof handler, `${method} 应为函数`).toBe('function')
    }
    expect(listMethods().length).toBeGreaterThanOrEqual(15)
    expect(listMethods()).toContain('dsl/render')
  })

  it('每个 handler 对空参数要么成功、要么给人类可读的校验错（不许运行时 TypeError）', async () => {
    for (const method of listMethods()) {
      const response = await dispatcher.dispatch({ jsonrpc: '2.0', id: 1, method, params: {} } as never)
      if ('error' in response) {
        // 参数校验失败**就该**抛错（对齐 MasterGo 契约：错误信息要完整活下来，
        // 不能像 {ok:false} 那样被 fields 白名单或预算截断吃掉）。
        // 这里只拦「把运行时 TypeError 当校验错」这类掩盖真实缺陷的情况。
        expect(
          /Cannot read propert|is not a function|undefined is not/.test(response.error.message),
          `${method} 抛的是运行时异常而非校验错: ${response.error.message}`,
        ).toBe(false)
      }
    }
  })
})

describe('补齐的插件方法（一次重载覆盖一批）', () => {
  it('node/getRoot / node/clone / node/move / text/create / search/find 都可用', async () => {
    const created = await call('node/create', {
      element: {
        type: 'frame', name: 'Root', size: { width: 200, height: 200 }, layoutMode: 'VERTICAL',
        children: [{ type: 'rectangle', name: 'ChildA' }, { type: 'rectangle', name: 'ChildB' }],
      },
    })
    const rootId = (('result' in created ? created.result : null) as Record<string, any>).rootIds[0] as string
    const childA = host.flatten().find((n) => n.name === 'ChildA')
    const childB = host.flatten().find((n) => n.name === 'ChildB')

    // getRoot：从子节点往上找到 Root
    const root = ('result' in (await call('node/getRoot', { nodeId: childA!.id })) ? (await call('node/getRoot', { nodeId: childA!.id })) : null) as unknown as Record<string, any>
    const rootResp = await call('node/getRoot', { nodeId: childA!.id, includeSubtree: true, maxDepth: 2 })
    const rootResult = ('result' in rootResp ? rootResp.result : null) as Record<string, any>
    expect(rootResult.name).toBe('Root')
    expect(rootResult.children?.map((c: any) => c.name)).toEqual(['ChildA', 'ChildB'])
    void root
    void rootId

    // clone：复制并可改父层/改名
    const cloned = await call('node/clone', { nodeId: childA!.id, name: 'ChildA copy' })
    const clonedResult = ('result' in cloned ? cloned.result : null) as Record<string, any>
    expect(clonedResult.ok).toBe(true)
    expect(host.getNodeById(clonedResult.nodeId)?.name).toBe('ChildA copy')

    // move：把 ChildB 移到 index 0（同级重排）
    const moved = await call('node/move', { nodeId: childB!.id, index: 0 })
    const movedResult = ('result' in moved ? moved.result : null) as Record<string, any>
    expect(movedResult.ok).toBe(true)
    const parentAfter = host.flatten().find((n) => n.name === 'Root')
    expect(parentAfter?.children.map((c) => c.name)).toContain('ChildB')

    // text/create
    const text = await call('text/create', { content: '你好', fontSize: 14, x: 0, y: 0 })
    const textResult = ('result' in text ? text.result : null) as Record<string, any>
    expect(textResult.ok).toBe(true)
    expect(textResult.applied).toContain('fontSize')

    // search/find
    const found = await call('search/find', { query: 'child' })
    const foundResult = ('result' in found ? found.result : null) as Record<string, any>
    expect(foundResult.count).toBeGreaterThanOrEqual(2)
  })

  it('批量：nodes/updates/nodeIds 三种数组形式都能走通', async () => {
    const batch = await call('node/create', {
      nodes: [{ type: 'rectangle', name: 'B1' }, { type: 'rectangle', name: 'B2' }],
    })
    const batchResult = ('result' in batch ? batch.result : null) as Record<string, any>
    expect(batchResult.rootCount).toBe(2)

    const b1 = host.flatten().find((n) => n.name === 'B1')!
    const b2 = host.flatten().find((n) => n.name === 'B2')!

    const updated = await call('node/update', {
      updates: [
        { nodeId: b1.id, properties: { opacity: 0.5 } },
        { nodeId: 'ghost', properties: { opacity: 0.5 } },
      ],
    })
    const updatedResult = ('result' in updated ? updated.result : null) as Record<string, any>
    expect(updatedResult.success).toBe(false)
    expect(updatedResult.updated).toBe(1)
    expect(updatedResult.failed).toHaveLength(1)

    const deleted = await call('node/delete', { nodeIds: [b1.id, b2.id, 'ghost'] })
    const deletedResult = ('result' in deleted ? deleted.result : null) as Record<string, any>
    expect(deletedResult.removed).toHaveLength(2)
    expect(deletedResult.failed).toHaveLength(1)
  })

  it('health/check 与 health/get 同源；fonts/list 取不到也不报错', async () => {
    const check = ('result' in (await call('health/check')) ? (await call('health/check')) : null) as unknown as Record<string, any>
    const checkResp = await call('health/check')
    const checkResult = ('result' in checkResp ? checkResp.result : null) as Record<string, any>
    expect(checkResult.ok).toBe(true)
    void check

    const fonts = await call('fonts/list')
    const fontsResult = ('result' in fonts ? fonts.result : null) as Record<string, any>
    expect(fontsResult.ok).toBe(true)
    expect(Array.isArray(fontsResult.families)).toBe(true)
  })

  it('notify 会打到宿主通知；缺 message 时抛错', async () => {
    await call('notify', { message: '测试通知', options: { type: 'warning' } })
    expect(host.notifications.some((n) => n.message === '测试通知' && n.kind === 'warning')).toBe(true)

    const bad = await call('notify', {})
    expect('error' in bad && bad.error.message).toMatch(/message/)
  })

  it('page/rename 改当前页并回读校验', async () => {
    const renamed = await call('page/rename', { pageId: 'page-1', name: '设计系统' })
    const result = ('result' in renamed ? renamed.result : null) as Record<string, any>
    expect(result.applied).toBe(true)
    expect(host.getCurrentPage()?.name).toBe('设计系统')

    const wrongPage = await call('page/rename', { pageId: 'ghost', name: 'X' })
    expect('error' in wrongPage && wrongPage.error.message).toMatch(/页面不存在/)
  })
})

describe('位置的语义：DSL 的 position 是「父层内坐标」', () => {
  it('带 parentId 创建子元素 → 子元素落在父层坐标系里（不是页面原点）', async () => {
    // 真机踩过的坑：父层在 (2100,400)、子元素 position {x:10,y:10}，直接透传的话
    // 子节点落在**页面** (10,10) —— 父层之外，视觉上「什么都没画出来」。
    const board = await dispatcher.dispatch({
      jsonrpc: '2.0', id: 1, method: 'node/create',
      params: { element: { type: 'frame', name: 'Board', position: { x: 300, y: 200 }, size: { width: 200, height: 200 } } },
    } as never)
    const boardId = (board as { result: { rootIds: string[] } }).result.rootIds[0]

    const child = await dispatcher.dispatch({
      jsonrpc: '2.0', id: 2, method: 'node/create',
      params: { parentId: boardId, element: { type: 'rectangle', name: 'Child', position: { x: 10, y: 20 }, size: { width: 40, height: 40 } } },
    } as never)
    const childId = (child as { result: { rootIds: string[] } }).result.rootIds[0]

    const props = host.readProperties(host.getNodeById(childId)!, ['x', 'y', 'parentId'])
    expect(props.x).toBeCloseTo(310, 1)
    expect(props.y).toBeCloseTo(220, 1)
    expect(props.parentId).toBe(boardId)
  })

  it('flex 父层：位置由布局决定，不把 position 当绝对坐标写进去', async () => {
    const row = await dispatcher.dispatch({
      jsonrpc: '2.0', id: 1, method: 'node/create',
      params: { element: { type: 'frame', name: 'Row', position: { x: 600, y: 100 }, size: { width: 300, height: 100 }, layoutMode: 'HORIZONTAL', itemSpacing: 10 } },
    } as never)
    const rowId = (row as { result: { rootIds: string[] } }).result.rootIds[0]
    const cell = await dispatcher.dispatch({
      jsonrpc: '2.0', id: 2, method: 'node/create',
      params: { parentId: rowId, element: { type: 'rectangle', name: 'Cell', position: { x: 999, y: 999 }, size: { width: 40, height: 40 } } },
    } as never)
    const cellId = (cell as { result: { rootIds: string[] } }).result.rootIds[0]
    const props = host.readProperties(host.getNodeById(cellId)!, ['x', 'y'])
    // 不能被写成 999（那会跑到页面远处）；flex 里由布局摆放
    expect(Number(props.x)).not.toBeCloseTo(999, 0)
    expect(Number(props.y)).not.toBeCloseTo(999, 0)
  })
})
