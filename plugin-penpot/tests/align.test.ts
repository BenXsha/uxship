/**
 * `node/align` —— 对象**之间**的对齐与等距分布
 *
 * 先分清两件事（这是本功能存在的理由）：
 *   - 容器内对齐 = flex 的 `primaryAxisAlignItems` / `counterAxisAlignItems`（改容器属性）——
 *     插件早就支持，服务端指令引擎也有中文关键词；
 *   - 对象之间对齐（本组）= 把若干个**被选中对象**互相摆齐（改各自坐标）——
 *     此前两边都没有，所以"把这三个对象左对齐"只会落到容器语义（错的）。
 *
 * 这里钉三件事：几何口径（包围盒 / 相邻间隙相等）、原生与兜底两条路径、以及边界（数量不够、
 * flex 父层写不进去、选区回退）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { RequestDispatcher } from '@lib/dispatcher'
import { installHost, MemoryHost } from '@lib/host/index'
import { computeAlignment, computeDistribution } from '@lib/align'

let host: MemoryHost
let dispatcher: RequestDispatcher

function boot(options?: ConstructorParameters<typeof MemoryHost>[0]) {
  host = new MemoryHost(options)
  installHost(host)
  dispatcher = new RequestDispatcher()
}

beforeEach(() => boot())

async function call(method: string, params: Record<string, unknown> = {}) {
  const response = await dispatcher.dispatch({ jsonrpc: '2.0', id: 1, method, params } as never)
  if ('error' in response) return { __error: response.error } as Record<string, any>
  return response.result as Record<string, any>
}

const box = (name: string) => {
  const node = host.flatten().find((entry) => entry.name === name)!
  const props = host.readProperties(node, ['x', 'y', 'width', 'height'])
  return { x: props.x as number, y: props.y as number, width: props.width as number, height: props.height as number }
}

/** 在指定父层下建三个不同位置的矩形 */
async function makeThree(parentId?: string) {
  const ids: string[] = []
  const spots = [
    { name: 'A', x: 0, y: 0, w: 100, h: 40 },
    { name: 'B', x: 130, y: 50, w: 60, h: 80 },
    { name: 'C', x: 400, y: 10, w: 40, h: 20 },
  ]
  for (const spot of spots) {
    const created = await call('node/create', {
      parentId,
      element: { type: 'rectangle', name: spot.name, position: { x: spot.x, y: spot.y }, size: { width: spot.w, height: spot.h } },
    })
    ids.push(created.rootIds[0] as string)
  }
  return ids
}

describe('纯几何口径（lib/align.ts）', () => {
  const boxes = [
    { x: 0, y: 0, width: 100, height: 40 },
    { x: 130, y: 50, width: 60, height: 80 },
    { x: 400, y: 10, width: 40, height: 20 },
  ]

  it('左对齐 = 各对象 x 对齐到包围盒左边', () => {
    const deltas = computeAlignment(boxes, 'HORIZONTAL', 'MIN')
    expect(deltas.map((d) => d.dx)).toEqual([0, -130, -400])
    expect(deltas.every((d) => d.dy === 0)).toBe(true) // 不顺手改另一个轴
  })

  it('水平居中 = 各对象中心对齐到包围盒中心', () => {
    const deltas = computeAlignment(boxes, 'HORIZONTAL', 'CENTER')
    // 包围盒 0..440，中心 220
    expect(deltas[0].dx).toBe(220 - 50)
    expect(deltas[2].dx).toBe(220 - 420)
  })

  it('右对齐 = 各对象右边缘对齐到包围盒右边（注意宽度不同）', () => {
    const deltas = computeAlignment(boxes, 'HORIZONTAL', 'MAX')
    expect(deltas.map((d) => d.dx)).toEqual([340, 250, 0])
  })

  it('垂直方向同理（顶/中/底）', () => {
    expect(computeAlignment(boxes, 'VERTICAL', 'MIN').map((d) => d.dy)).toEqual([0, -50, -10])
    // 底边：A 40、B 130、C 30 → 包围盒底 130 → A +90、B 0、C +100
    expect(computeAlignment(boxes, 'VERTICAL', 'MAX').map((d) => d.dy)).toEqual([90, 0, 100])
  })

  it('等距分布：两端固定、相邻间隙相等', () => {
    // 0..440（含 C 的右缘），总宽 200 → 间隙 (440-200)/2 = 120
    const deltas = computeDistribution(boxes, 'HORIZONTAL')
    const after = boxes.map((b, i) => ({ ...b, x: b.x + deltas[i].dx }))
    const sorted = after.slice().sort((a, b) => a.x - b.x)
    const gaps = [sorted[1].x - (sorted[0].x + sorted[0].width), sorted[2].x - (sorted[1].x + sorted[1].width)]
    expect(gaps[0]).toBeCloseTo(gaps[1], 6)
    expect(sorted[0].x).toBe(0)         // 第一个不动
    expect(sorted[2].x + sorted[2].width).toBe(440) // 最后一个右缘不动
  })

  it('数量不够时返回全零位移（由 handler 给明确原因）', () => {
    expect(computeAlignment([boxes[0]], 'HORIZONTAL', 'MIN')).toEqual([{ dx: 0, dy: 0 }])
    expect(computeDistribution(boxes.slice(0, 2), 'HORIZONTAL')).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }])
  })
})

describe('node/align handler', () => {
  it('左对齐（几何兜底）：坐标真的变了，并如实回报每个对象的位移', async () => {
    boot({ capabilities: { ops: { alignNodes: false } } })
    const ids = await makeThree()

    const r = await call('node/align', { nodeIds: ids, mode: 'align', axis: 'HORIZONTAL', direction: 'MIN' })
    expect(r.ok).toBe(true)
    expect(r.path).toBe('geometry')
    expect(r.moved).toBe(2) // A 本来就在最左
    expect(box('A').x).toBe(0)
    expect(box('B').x).toBe(0)
    expect(box('C').x).toBe(0)
    expect(r.nodes.find((n: any) => n.name === 'B').dx).toBe(-130)
  })

  it('走宿主原生时 path=native（接管后坐标由宿主决定，仍在替身上生效）', async () => {
    boot({ capabilities: { ops: { alignNodes: true } } })
    const ids = await makeThree()

    const r = await call('node/align', { nodeIds: ids, mode: 'align', axis: 'VERTICAL', direction: 'MIN' })
    expect(r.path).toBe('native')
    expect(r.notes.join(' ')).toMatch(/宿主原生/)
    expect(host.alignCalls.at(-1)).toMatchObject({ axis: 'VERTICAL', direction: 'MIN' })
    expect(box('B').y).toBe(0)
  })

  it('等距分布', async () => {
    const ids = await makeThree()
    const r = await call('node/align', { nodeIds: ids, mode: 'distribute', axis: 'HORIZONTAL' })
    expect(r.ok).toBe(true)
    expect(r.mode).toBe('distribute')
    const xs = ['A', 'B', 'C'].map((n) => box(n).x).sort((a, b) => a - b)
    // 两端固定后中间那个被重排
    expect(xs[0]).toBe(0)
  })

  it('数量不够 → ok:false + 说明原因（不静默不做）', async () => {
    const one = await call('node/create', { element: { type: 'rectangle', name: 'Solo', size: { width: 10, height: 10 } } })
    const align = await call('node/align', { nodeIds: [one.rootIds[0]], mode: 'align' })
    expect(align.ok).toBe(false)
    expect(align.reason).toMatch(/至少需要 2 个对象/)

    const two = await makeThree()
    const dist = await call('node/align', { nodeIds: two.slice(0, 2), mode: 'distribute' })
    expect(dist.ok).toBe(false)
    expect(dist.reason).toMatch(/至少需要 3 个对象/)
  })

  it('不传 nodeIds → 回退当前选区；选区也不够时给同样的原因', async () => {
    const ids = await makeThree()
    await call('selection/set', { nodeIds: ids })
    const r = await call('node/align', { mode: 'align', direction: 'MIN' })
    expect(r.ok).toBe(true)
    expect(r.total).toBe(3)

    await call('selection/set', { nodeIds: [] })
    const empty = await call('node/align', { mode: 'align' })
    expect(empty.ok).toBe(false)
    expect(empty.total).toBe(0)
  })

  it('flex 父层的对象：位置由布局决定 → 不写坐标，并在 notes 里说明', async () => {
    boot({ capabilities: { ops: { alignNodes: false } } })
    const row = await call('node/create', {
      element: { type: 'frame', name: 'Row', size: { width: 400, height: 60 }, layoutMode: 'HORIZONTAL', itemSpacing: 10 },
    })
    const rowId = row.rootIds[0] as string
    const ids = await makeThree(rowId)

    const r = await call('node/align', { nodeIds: ids, mode: 'align', axis: 'HORIZONTAL', direction: 'MIN' })
    // 即使它们本来就左对齐（本次零位移）也要如实标注 —— 否则"请求对齐 flex 子元素"看起来成功、其实没做
    expect(r.notes.join(' ')).toMatch(/flex/)
    expect(r.nodes.every((n: any) => n.skipped === 'flex-parent')).toBe(true)
    expect(r.moved).toBe(0)
  })

  it('节点不存在 → 抛错（参数错就该整批拒绝）', async () => {
    const r = await call('node/align', { nodeIds: ['ghost'], mode: 'align' })
    expect(r.__error?.message).toMatch(/节点不存在: ghost/)
  })
})
