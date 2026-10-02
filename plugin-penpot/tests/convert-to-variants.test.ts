/**
 * `node/convertToComponent` 的两个新形态：
 *
 *   - `listOnly`：与 `containerId`（推荐）或 `namePrefix` 搭配 → **只列举不转换**（回 `matched[]`）；
 *   - `variantGroups`：按**显式属性表**（setId / propertyName / members[{nodeId,value}]）
 *     合成 Penpot 原生变体集。
 *
 * 三条不可退让的纪律（都是这两形态存在的理由）：
 *   1. listOnly 不得动节点（AI 先看候选，再决定要不要建库）；
 *   2. 属性值必须**按 `component.mainInstance().id` 配对**，不能信 `variantComponents()` 的顺序
 *      （配错就会把 hover 的样式标成 disabled）—— 所以用「顺序故意倒过来」的假宿主来验；
 *   3. 成员不是 board 时，要么如实降级（notes/reason），要么如实说明「包了一层 frame」
 *      （改变节点形态的操作必须写进 notes），绝不静默。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RequestDispatcher } from '@lib/dispatcher'
import { installHost, resetHost, MemoryHost } from '@lib/host/index'
import type { MemoryNode } from '@lib/host/memory'
import { PenpotHost } from '@lib/host/penpot'
import { installFakePenpot, type FakePenpot } from './helpers/fake-penpot'

/** 假宿主里变体句柄的形状（仅测试可读） */
interface PenpotVariantsHandle {
  variants: {
    propertyNames: string[]
    properties: string[]
    variantComponents(): { mainInstance(): { id: string }; variantProperties: Record<number, string> }[]
  }
}

// ═══════════════════════════════════════════════════════════
// 一、MemoryHost：编排语义（包装 / 复用 / 逐组降级）
// ═══════════════════════════════════════════════════════════

describe('node/convertToComponent —— listOnly / variantGroups（MemoryHost）', () => {
  let host: MemoryHost
  let dispatcher: RequestDispatcher

  function boot(options?: ConstructorParameters<typeof MemoryHost>[0]) {
    host = new MemoryHost(options)
    installHost(host)
    dispatcher = new RequestDispatcher()
  }

  beforeEach(() => boot({ capabilities: { ops: { componentVariants: true } } }))

  afterEach(() => {
    dispatcher.destroy()
    resetHost()
  })

  async function result(method: string, params: Record<string, unknown> = {}) {
    const response = await dispatcher.dispatch({ jsonrpc: '2.0', id: 1, method, params } as never)
    if ('error' in response) return { __error: response.error } as Record<string, any>
    return response.result as Record<string, any>
  }

  async function createNode(type: string, name: string, parentId?: string): Promise<string> {
    const params: Record<string, unknown> = {
      element: { type, name, size: { width: 100, height: 60 } },
    }
    if (parentId) params.parentId = parentId
    const r = await result('node/create', params)
    return r.rootIds[0] as string
  }

  function wrapperOf(nodeId: string): string | null {
    return (host.getNodeById(nodeId) as MemoryNode | null)?.parentId ?? null
  }

  describe('listOnly', () => {
    it('只列举不转换：matched[] 给 nodeId/name/type，节点形态与组件库一字未改', async () => {
      const card = await createNode('frame', 'DS_Card')
      const inner = await createNode('rectangle', 'DS_Inner', card) // 也匹配，但祖先是匹配节点
      const loose = await createNode('rectangle', 'DS_Loose')
      await createNode('rectangle', 'Other')

      const r = await result('node/convertToComponent', { namePrefix: 'DS_', listOnly: true })

      expect(r.ok).toBe(true)
      expect(r.listOnly).toBe(true)
      expect(r.namePrefix).toBe('DS_')
      // 只取最外层 → DS_Card + DS_Loose，DS_Inner 被剪枝
      expect(r.matched.map((m: any) => m.name).sort()).toEqual(['DS_Card', 'DS_Loose'])
      expect(r.matched.map((m: any) => m.nodeId).sort()).toEqual([card, loose].sort())
      expect(r.matched[0].type).toBeTruthy()

      // 关键：什么都没转换
      expect(r.count).toBe(2)
      expect(r.components).toEqual([])
      expect(r.skipped).toEqual([])
      expect(host.components).toHaveLength(0)
      expect(host.variantSets).toHaveLength(0)
      // 节点的父子关系没被动过（DS_Inner 还在卡里）
      expect(wrapperOf(inner)).toBe(card)
    })

    it('零命中 → 空 matched（不抛错、不建组件）', async () => {
      await createNode('frame', 'Other')
      const r = await result('node/convertToComponent', { namePrefix: 'ZZ_', listOnly: true })
      expect(r.ok).toBe(true)
      expect(r.matched).toEqual([])
      expect(r.count).toBe(0)
      expect(host.components).toHaveLength(0)
    })

    it('缺作用域（containerId / namePrefix 都没有）→ 如实报缺参（不猜整页）', async () => {
      await createNode('frame', 'DS_Card')
      const r = await result('node/convertToComponent', { listOnly: true })
      expect(r.ok).toBe(false)
      expect(r.matched).toEqual([])
      expect(r.skipped[0].reason).toBe('missing-scope')
    })

    it('listOnly 与 variantGroups 同时出现时以 listOnly 为准（绝不真转换）', async () => {
      const a = await createNode('frame', 'A')
      const b = await createNode('frame', 'B')
      const r = await result('node/convertToComponent', {
        listOnly: true,
        variantGroups: [
          {
            setId: 'DS_X',
            propertyName: 'State',
            members: [
              { nodeId: a, value: 'default' },
              { nodeId: b, value: 'hover' },
            ],
          },
        ],
      })
      expect(r.skipped[0].reason).toBe('missing-scope')
      expect(host.components).toHaveLength(0)
      expect(host.variantSets).toHaveLength(0)
    })

    it('containerId 作用域：只取容器的直接子层（R6 推荐形态）', async () => {
      const section = await createNode('frame', 'Components')
      const btn = await createNode('frame', 'Button_Primary', section)
      const badge = await createNode('frame', 'Badge_Info', section)
      const nested = await createNode('rectangle', 'Button_Inner', btn) // 孙层，不在直接子层
      await createNode('frame', 'Loose_Outside') // 容器外

      const r = await result('node/convertToComponent', { containerId: section, listOnly: true })

      expect(r.ok).toBe(true)
      expect(r.containerId).toBe(section)
      expect(r.matched.map((m: any) => m.name).sort()).toEqual(['Badge_Info', 'Button_Primary'])
      expect(r.matched.map((m: any) => m.nodeId).sort()).toEqual([badge, btn].sort())
      // 什么都没转换
      expect(r.count).toBe(2)
      expect(host.components).toHaveLength(0)
      expect(wrapperOf(nested)).toBe(btn)
    })

    it('containerId 指向不存在的节点 → 报错（不静默回空）', async () => {
      const r = await result('node/convertToComponent', { containerId: 'nope:1', listOnly: true })
      expect(r.__error?.message).toMatch(/containerId 指向的节点不存在/)
    })
  })

  describe('variantGroups', () => {
    it('按 members 顺序合成：values 原样回传，容器名 = setId，成员是 board 时不包装', async () => {
      const a = await createNode('frame', 'Btn/A')
      const b = await createNode('frame', 'Btn/B')
      const c = await createNode('frame', 'Btn/C')

      const r = await result('node/convertToComponent', {
        variantGroups: [
          {
            setId: 'DS_Button',
            propertyName: 'State',
            members: [
              { nodeId: a, value: 'default' },
              { nodeId: b, value: 'hover' },
              { nodeId: c, value: 'disabled' },
            ],
          },
        ],
      })

      expect(r.ok).toBe(true)
      expect(r.variantSets).toEqual([
        {
          setId: 'DS_Button',
          containerId: 'variants-1',
          propertyName: 'State',
          memberCount: 3,
          values: ['default', 'hover', 'disabled'],
          ok: true,
        },
      ])
      expect(r.count).toBe(3)
      expect(r.skipped).toEqual([])
      expect(r.notes).toBeUndefined() // board 成员 → 无包装、无异常

      // 原语收到的就是原节点（没有被包 frame），顺序与 members 一致
      expect(host.variantSets[0]).toMatchObject({
        propertyName: 'State',
        values: ['default', 'hover', 'disabled'],
        nodeIds: [a, b, c],
        containerName: 'DS_Button',
      })
      expect(host.components).toHaveLength(3)
    })

    it('非 board 成员 → 包同尺寸 frame 并在 notes 里如实说明（不静默改形态）', async () => {
      const rect = await createNode('rectangle', 'Btn/Default')
      const text = await createNode('text', 'Btn/Hover')

      const r = await result('node/convertToComponent', {
        variantGroups: [
          {
            setId: 'DS_Button',
            propertyName: 'State',
            members: [
              { nodeId: rect, value: 'default' },
              { nodeId: text, value: 'hover' },
            ],
          },
        ],
      })

      expect(r.ok).toBe(true)
      const wrapped = host.variantSets[0].nodeIds
      expect(wrapped).toHaveLength(2)
      // 传给 createVariantFromComponents 的是**包装 frame**，不是原节点
      expect(wrapped).not.toContain(rect)
      expect(wrapped).not.toContain(text)
      // 原节点成了 frame 的子层
      expect(wrapperOf(rect)).toBe(wrapped[0])
      expect(wrapperOf(text)).toBe(wrapped[1])
      // 包装的 frame 真的被转成了组件母版（否则 createVariantFromComponents 会拒绝）
      expect(r.components.map((entry: any) => entry.nodeId).sort()).toEqual([...wrapped].sort())
      // 形态变化如实说明
      expect((r.notes as string[]).join(' | ')).toMatch(/不是 board/)
      expect((r.notes as string[]).join(' | ')).toMatch(/包一层同尺寸 frame/)
    })

    it('已是组件母版（board）→ 复用，不重复建组件', async () => {
      const a = await createNode('frame', 'Btn/A')
      const b = await createNode('frame', 'Btn/B')
      const first = await result('node/convertToComponent', { nodeIds: [a] })
      expect(host.components).toHaveLength(1)
      const r = await result('node/convertToComponent', {
        variantGroups: [
          {
            setId: 'DS_Button',
            propertyName: 'State',
            members: [
              { nodeId: a, value: 'default' },
              { nodeId: b, value: 'hover' },
            ],
          },
        ],
      })

      expect(r.ok).toBe(true)
      expect(r.components[0].componentId).toBe(first.componentId) // 复用
      expect(host.components).toHaveLength(2) // 只为 b 新建了一个
    })

    it('宿主不支持变体 → ok:false + reason（不抛错），其余组继续', async () => {
      dispatcher.destroy()
      boot() // 默认 componentVariants: false
      const a = await createNode('frame', 'Btn/A')
      const b = await createNode('frame', 'Btn/B')
      const c = await createNode('frame', 'Btn/C')

      const r = await result('node/convertToComponent', {
        variantGroups: [
          {
            setId: 'DS_A',
            propertyName: 'State',
            members: [
              { nodeId: a, value: 'x' },
              { nodeId: b, value: 'y' },
            ],
          },
          {
            setId: 'DS_B',
            propertyName: 'State',
            members: [{ nodeId: c, value: 'z' }], // 只有 1 个成员 → 也会失败
          },
        ],
      })

      expect(r.ok).toBe(false)
      expect(r.variantSets).toHaveLength(2)
      expect(r.variantSets[0].ok).toBe(false)
      expect(r.variantSets[0].reason).toMatch(/componentVariants/)
      expect(r.variantSets[1].reason).toMatch(/不足 2 个/)
      expect((r.notes as string[]).join(' | ')).toMatch(/未合成/)
      // 失败不是抛错：前面的组已经把成员转成组件了（如实回报）
      expect(r.count).toBe(2)
    })

    it('节点不存在 / 可合成成员不足 → 进 skipped，该组 ok:false，其余组不受影响', async () => {
      const a = await createNode('frame', 'Btn/A')
      const b = await createNode('frame', 'Btn/B')

      const r = await result('node/convertToComponent', {
        variantGroups: [
          {
            setId: 'DS_OK',
            propertyName: 'State',
            members: [
              { nodeId: a, value: 'default' },
              { nodeId: b, value: 'hover' },
            ],
          },
          {
            setId: 'DS_Bad',
            propertyName: 'State',
            members: [
              { nodeId: 'not-exist', value: 'default' },
              { nodeId: b, value: 'hover' },
            ],
          },
        ],
      })

      expect(r.variantSets[0].ok).toBe(true)
      expect(r.variantSets[1].ok).toBe(false)
      expect(r.variantSets[1].reason).toMatch(/不足 2 个/)
      expect(r.skipped[0]).toMatchObject({ nodeId: 'not-exist', reason: 'node-not-found' })
      expect(r.ok).toBe(false)
    })

    it('同一母版在一个变体集里重复出现 → 只取首次，进 skipped（不让宿主报重复母版）', async () => {
      const a = await createNode('frame', 'Btn/A')
      const b = await createNode('frame', 'Btn/B')

      const r = await result('node/convertToComponent', {
        variantGroups: [
          {
            setId: 'DS_Dup',
            propertyName: 'State',
            members: [
              { nodeId: a, value: 'default' },
              { nodeId: a, value: 'hover' },
              { nodeId: b, value: 'disabled' },
            ],
          },
        ],
      })

      expect(r.ok).toBe(true)
      expect(r.variantSets[0].values).toEqual(['default', 'disabled'])
      expect(r.skipped[0]).toMatchObject({ nodeId: a, reason: 'duplicate-member' })
      expect(host.variantSets[0].nodeIds).toEqual([a, b])
    })

    it('variantGroups 形态非法 → 抛错（不静默退化成别的形态）', async () => {      const a = await createNode('frame', 'Btn/A')
      expect((await result('node/convertToComponent', { variantGroups: [{ propertyName: 'State', members: [] }] })).__error?.message)
        .toMatch(/setId 缺失/)
      expect((await result('node/convertToComponent', {
        variantGroups: [{ setId: 'DS_X', propertyName: 'State', members: [{ nodeId: a }] }],
      })).__error?.message).toMatch(/缺少轴值/)
      expect((await result('node/convertToComponent', { variantGroups: 'nope' })).__error?.message).toMatch(/需要是数组/)
    })
  })
})

// ═══════════════════════════════════════════════════════════
// 二、PenpotHost：配对正确性（对着「行为像 Penpot」的替身）
// ═══════════════════════════════════════════════════════════

describe('PenpotHost.createVariants —— 按 mainInstance id 配对', () => {
  let fake: FakePenpot
  let restore: () => void

  afterEach(() => restore())

  function bootFake(options: Parameters<typeof installFakePenpot>[0] = {}) {
    const installed = installFakePenpot(options)
    fake = installed.penpot
    restore = installed.restore
    return new PenpotHost()
  }

  async function makeBoard(host: PenpotHost, name: string) {
    return host.createNode({ kind: 'frame', name, width: 100, height: 60 })
  }

  it('variantComponents() 顺序故意倒置也不会配错；addProperty/renameProperty(0)/setVariantProperty(0) 都真的被调了', async () => {
    const host = bootFake({ variants: { shuffleVariantComponents: true } })
    await host.init()

    const a = await makeBoard(host, 'A')
    const b = await makeBoard(host, 'B')
    const c = await makeBoard(host, 'C')

    const r = await host.createVariants([a, b, c], 'State', ['default', 'hover', 'disabled'], {
      containerName: 'DS_Button',
    })

    expect(r.ok).toBe(true)
    expect(r.containerName).toBe('DS_Button')

    // ① 入口被调了，且顺序就是传入顺序（boards）
    const entry = fake.__variantLog.find((entry) => entry.op === 'createVariantFromComponents')
    expect(entry?.args[0]).toEqual([a.id, b.id, c.id])

    // ② 属性轴：复用容器自动带的第 0 轴，只 renameProperty(0, 'State')（不得多调 addProperty）
    const ops = fake.__variantLog.map((entry) => `${entry.op}:${entry.args.map(String).join(',')}`)
    expect(ops).toContain('renameProperty:0,State')
    expect(ops).not.toContain('addProperty:')

    // ③ 容器的名字真的被写成 setId
    const container = fake.__all().find((shape) => shape.id === r.containerId)!
    expect(container.name).toBe('DS_Button')
    expect((container as unknown as PenpotVariantsHandle).variants.propertyNames[0]).toBe('State')

    // ④ 配对：每个母版 id 拿到的必须是**它自己**的值（顺序被倒置了，所以不能靠索引）
    const handle = (container as unknown as PenpotVariantsHandle).variants
    const returned = handle.variantComponents()
    expect(returned).toHaveLength(3)
    expect(returned[0].mainInstance().id).toBe(c.id) // 证明确实是倒序（否则这个用例测不到东西）

    const pairs = new Map(returned.map((component) => [component.mainInstance().id, component.variantProperties[0]]))
    expect(pairs.get(a.id)).toBe('default')
    expect(pairs.get(b.id)).toBe('hover')
    expect(pairs.get(c.id)).toBe('disabled')
    for (const entry of [a, b, c]) {
      expect(ops).toContain(`setVariantProperty:${entry.id},0,${pairs.get(entry.id)}`)
    }
  })

  it('容器名不可写 → ok:true + containerName 是实际值 + note 说明期望/实际（不谎报改名成功）', async () => {
    const host = bootFake({ variants: { containerNameLocked: true } })
    await host.init()
    const a = await makeBoard(host, 'A')
    const b = await makeBoard(host, 'B')

    const r = await host.createVariants([a, b], 'State', ['default', 'hover'], { containerName: 'DS_Button' })

    expect(r.ok).toBe(true) // 变体集本身建成了
    expect(r.containerName).toBe('Variant Container') // 实际值，不是期望值
    expect(r.note).toMatch(/DS_Button/)
    expect(r.note).toMatch(/Variant Container/)
  })

  it('宿主没有 createVariantFromComponents → ok:false + reason（不抛错）', async () => {
    const host = bootFake()
    await host.init()
    fake.__removeApi('createVariantFromComponents')

    const a = await makeBoard(host, 'A')
    const b = await makeBoard(host, 'B')
    const r = await host.createVariants([a, b], 'State', ['default', 'hover'], { containerName: 'DS_X' })

    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/createVariantFromComponents/)
    expect(r.containerId).toBeUndefined()
  })

  it('非 board 成员被原语直接拒绝时给出可执行的原因（包装是调用方的责任）', async () => {
    const host = bootFake({ variants: true })
    await host.init()
    const rect = await host.createNode({ kind: 'rectangle', name: 'R' })
    const text = await host.createNode({ kind: 'text', name: 'T', characters: 'hi' })

    const r = await host.createVariants([rect, text], 'State', ['a', 'b'])

    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/只接受 board/)
  })
})

// ═══════════════════════════════════════════════════════════
// 三、端到端：handler + PenpotHost（矩形 → 包 frame → 原生变体集）
// ═══════════════════════════════════════════════════════════

describe('node/convertToComponent variantGroups —— 在 PenpotHost 上端到端', () => {
  let fake: FakePenpot
  let restore: () => void
  let dispatcher: RequestDispatcher

  beforeEach(async () => {
    const installed = installFakePenpot({ variants: { shuffleVariantComponents: true } })
    fake = installed.penpot
    restore = installed.restore
    const host = new PenpotHost()
    await host.init()
    installHost(host)
    dispatcher = new RequestDispatcher()
  })

  afterEach(() => {
    dispatcher.destroy()
    resetHost()
    restore()
  })

  async function result(method: string, params: Record<string, unknown> = {}) {
    const response = await dispatcher.dispatch({ jsonrpc: '2.0', id: 1, method, params } as never)
    if ('error' in response) return { __error: response.error } as Record<string, any>
    return response.result as Record<string, any>
  }

  it('矩形成员 → 包 frame → 合成变体集，容器名 = setId，配对按 id 正确', async () => {
    const created = await result('node/create', {
      element: {
        type: 'frame',
        name: 'Host',
        size: { width: 400, height: 300 },
        children: [
          { type: 'rectangle', name: 'Btn/Default', size: { width: 100, height: 40 } },
          { type: 'rectangle', name: 'Btn/Hover', size: { width: 100, height: 40 } },
        ],
      },
    })
    expect(created.rootIds).toHaveLength(1)
    const hostNode = fake.__all().find((shape) => shape.name === 'Host')!
    const [defNode, hoverNode] = hostNode.children

    const r = await result('node/convertToComponent', {
      variantGroups: [
        {
          setId: 'DS_Button',
          propertyName: 'State',
          members: [
            { nodeId: defNode.id, value: 'default' },
            { nodeId: hoverNode.id, value: 'hover' },
          ],
        },
      ],
    })

    expect(r.ok).toBe(true)
    expect(r.variantSets[0]).toMatchObject({
      setId: 'DS_Button',
      propertyName: 'State',
      memberCount: 2,
      values: ['default', 'hover'],
      ok: true,
    })
    expect((r.notes as string[]).join(' | ')).toMatch(/包一层同尺寸 frame/)

    const container = fake.__all().find((shape) => shape.name === 'DS_Button')!
    expect(container.id).toBe(r.variantSets[0].containerId)

    const handle = (container as unknown as PenpotVariantsHandle).variants
    expect(handle.propertyNames[0]).toBe('State')
    // 真机回归：第 0 轴复用容器自动带的属性，不得留幽灵 "Property 2"
    expect(handle.properties).toEqual(['State'])

    // 配对断言：包装 frame 里装着哪个成员，就应该拿到哪个成员的轴值
    // （`variantComponents()` 被替身故意倒序，靠索引配对必挂）
    const byMemberName = new Map<string, string | undefined>()
    for (const component of handle.variantComponents()) {
      const main = component.mainInstance()
      const wrapper = fake.__all().find((shape) => shape.id === main.id)!
      byMemberName.set(wrapper.children[0].name, component.variantProperties[0])
      // 包装 frame 真的被挪进了变体容器
      expect(wrapper.parent?.id).toBe(container.id)
    }
    expect(byMemberName.get('Btn/Default')).toBe('default')
    expect(byMemberName.get('Btn/Hover')).toBe('hover')
  })

  it('多轴（properties[] + members[].values[]）→ addProperty 两次 + 每轴 setVariantProperty(pos, value)', async () => {
    const created = await result('node/create', {
      element: {
        type: 'frame',
        name: 'Host2',
        size: { width: 600, height: 300 },
        children: [
          { type: 'rectangle', name: 'Btn/Primary/Default', size: { width: 100, height: 40 } },
          { type: 'rectangle', name: 'Btn/Primary/Hover', size: { width: 100, height: 40 } },
          { type: 'rectangle', name: 'Btn/Secondary/Default', size: { width: 100, height: 40 } },
        ],
      },
    })
    expect(created.rootIds).toHaveLength(1)
    const hostNode = fake.__all().find((shape) => shape.name === 'Host2')!
    const [pd, ph, sd] = hostNode.children

    const r = await result('node/convertToComponent', {
      variantGroups: [
        {
          setId: 'Button',
          properties: ['Variant', 'State'],
          members: [
            { nodeId: pd.id, values: ['Primary', 'Default'] },
            { nodeId: ph.id, values: ['Primary', 'Hover'] },
            { nodeId: sd.id, values: ['Secondary', 'Default'] },
          ],
        },
      ],
    })

    expect(r.ok).toBe(true)
    expect(r.variantSets[0]).toMatchObject({
      setId: 'Button',
      propertyName: 'Variant',
      properties: ['Variant', 'State'],
      memberCount: 3,
      ok: true,
    })

    const container = fake.__all().find((shape) => shape.name === 'Button')!
    const handle = (container as unknown as PenpotVariantsHandle).variants
    // 两个轴都真的上了宿主
    expect(handle.propertyNames.slice(0, 2)).toEqual(['Variant', 'State'])
    // 真机回归：两个轴都复用/新增正确，不得留幽灵 "Property 3"
    expect(handle.properties).toEqual(['Variant', 'State'])

    // 每个成员两个轴位都按 mainInstance id 正确配对（variantComponents() 被替身故意倒序）
    const byMemberName = new Map<string, Record<number, string>>()
    for (const component of handle.variantComponents()) {
      const wrapper = fake.__all().find((shape) => shape.id === component.mainInstance().id)!
      byMemberName.set(wrapper.children[0].name, component.variantProperties)
    }
    expect(byMemberName.get('Btn/Primary/Default')).toMatchObject({ 0: 'Primary', 1: 'Default' })
    expect(byMemberName.get('Btn/Primary/Hover')).toMatchObject({ 0: 'Primary', 1: 'Hover' })
    expect(byMemberName.get('Btn/Secondary/Default')).toMatchObject({ 0: 'Secondary', 1: 'Default' })
  })
})
