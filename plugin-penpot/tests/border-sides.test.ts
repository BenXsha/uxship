/**
 * 单边描边（per-side border）测试
 *
 * 背景：**Penpot 的插件 API 没有 per-side 描边**（内部模型有
 * `:stroke-width-top/right/bottom/left`，但 `app.plugins.parser/parse-stroke` 不认，
 * 传了会被固定 map 丢掉）。所以用 **Path + d + 原生 stroke** 把需要的边画出来 ——
 * 它是真正的矢量描边，能在 Penpot 里再改色/改宽/改虚线，且全部走文档化 API。
 *
 * 这一组同时锁住三件容易做错的事：
 *   1. **合并**：同色同宽的多条边应只占一条 Path（多子路径），不是每边一个节点；
 *   2. **坐标语义**：flex 父层下要 absolute + 父级相对坐标，否则边框整体偏移；
 *   3. **幂等**：重应用/重渲染不能每来一次就叠一层边框。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { PenpotHost } from '@lib/host/penpot'
import { MemoryHost } from '@lib/host/memory'
import { renderDsl } from '@lib/dsl/renderer'
import { buildSidesPath, describeSides, sideGroupKey, SIDE_ORDER } from '@lib/host/border-sides'
import { installFakePenpot, type FakePenpot } from './helpers/fake-penpot'

let fake: FakePenpot
let host: PenpotHost

beforeEach(async () => {
  const installed = installFakePenpot()
  fake = installed.penpot
  host = new PenpotHost()
  await host.init()
})

const shape = (name: string) => fake.__all().find((s) => s.name === name) as unknown as Record<string, any>
const borders = (prefix = 'Border') => fake.__all().filter((s) => String(s.name).startsWith(prefix))

// ─────────────────────────────  几何（纯函数）  ─────────────────────────────

describe('buildSidesPath —— 几何', () => {
  it('单边：线心内缩半个描边宽，使色带落在盒子内侧（对齐 CSS border-box）', () => {
    expect(buildSidesPath(['bottom'], 200, 100, 4)).toBe('M 0 98 H 200')
    expect(buildSidesPath(['top'], 200, 100, 4)).toBe('M 0 2 H 200')
    expect(buildSidesPath(['left'], 200, 100, 4)).toBe('M 2 0 V 100')
    expect(buildSidesPath(['right'], 200, 100, 4)).toBe('M 198 0 V 100')
  })

  it('多边合成一条 d 的多个子路径（顺序固定为 top→right→bottom→left）', () => {
    const d = buildSidesPath(['bottom', 'top'], 100, 50, 2)
    expect(d).toBe('M 0 1 H 100 M 0 49 H 100')
    // 顺序与传入顺序无关，保证同样输入产出同样 d（便于 diff）
    expect(buildSidesPath(['top', 'bottom'], 100, 50, 2)).toBe(d)
  })

  it('支持整体平移（用于父级相对坐标）', () => {
    expect(buildSidesPath(['top'], 100, 50, 2, 30, 40)).toBe('M 30 41 H 130')
  })

  it('SIDE_ORDER 固定；describeSides 给出可读图层名', () => {
    expect(SIDE_ORDER).toEqual(['top', 'right', 'bottom', 'left'])
    expect(describeSides(['bottom'])).toBe('Border Bottom')
    expect(describeSides(['bottom', 'left'])).toBe('Border Bottom+Left')
    expect(describeSides(['top', 'right', 'bottom', 'left'])).toBe('Border')
  })

  it('分组键包含颜色/宽度/虚线/对齐/渐变 —— 任一项不同就不能共用一条 Path', () => {
    const base = { colorKey: 'solid:#000000:1', width: 1, dashKey: '', alignKey: 'inner', gradientKey: '' }
    expect(sideGroupKey(base)).toBe(sideGroupKey({ ...base }))
    expect(sideGroupKey(base)).not.toBe(sideGroupKey({ ...base, width: 2 }))
    expect(sideGroupKey(base)).not.toBe(sideGroupKey({ ...base, colorKey: 'solid:#FF0000:1' }))
    expect(sideGroupKey(base)).not.toBe(sideGroupKey({ ...base, dashKey: '4,4' }))
  })
})

// ─────────────────────────────  集成：真机上会落的节点  ─────────────────────────────

describe('PenpotHost —— 单边描边落地', () => {
  it('单边描边会创建一条叠加 Path，且源形状不再被涂成整圈', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'Card', width: 200, height: 100 })
    const result = await host.applyProperties(rect, {
      strokes: [{ color: '#1F2937', width: 2, sides: ['bottom'] }],
    })

    expect(result.applied).toContain('strokes.sides')
    // 源形状本身不该有整圈描边（那是旧的降级行为）
    expect(shape('Card').strokes).toEqual([])

    const overlay = borders()
    expect(overlay).toHaveLength(1)
    expect(overlay[0].name).toBe('Border Bottom')
    expect(overlay[0].d).toBe('M 0 99 H 200')
    expect(overlay[0].fills).toEqual([])
    const strokes = overlay[0].strokes as { strokeColor: string; strokeWidth: number; strokeAlignment: string }[]
    expect(strokes[0].strokeColor).toBe('#1F2937')
    expect(strokes[0].strokeWidth).toBe(2)
    expect(strokes[0].strokeAlignment).toBe('center')
  })

  it('同色同宽的多条边只占**一条** Path（多子路径合并）', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'Box', width: 120, height: 60 })
    await host.applyProperties(rect, {
      strokes: [
        { color: '#111111', width: 1, sides: ['top'] },
        { color: '#111111', width: 1, sides: ['bottom'] },
      ],
    })

    const overlay = borders()
    expect(overlay).toHaveLength(1)
    expect(overlay[0].d).toBe('M 0 0.5 H 120 M 0 59.5 H 120')
    expect(overlay[0].name).toBe('Border Top+Bottom')
  })

  it('颜色或宽度不同的边会拆成多条 Path', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'Box2', width: 120, height: 60 })
    await host.applyProperties(rect, {
      strokes: [
        { color: '#111111', width: 1, sides: ['top'] },
        { color: '#FF0000', width: 3, sides: ['bottom'] },
      ],
    })
    expect(borders()).toHaveLength(2)
  })

  it('幂等：重复应用描边不会叠加出多层边框', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'Repeat', width: 100, height: 50 })
    const props = { strokes: [{ color: '#000000', width: 1, sides: ['bottom'] }] } as never

    await host.applyProperties(rect, props)
    expect(borders()).toHaveLength(1)
    await host.applyProperties(rect, props)
    expect(borders()).toHaveLength(1)
    await host.applyProperties(rect, props)
    expect(borders()).toHaveLength(1)
  })

  it('改为四边描边后，旧的叠加层会被清掉', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'Switch', width: 100, height: 50 })
    await host.applyProperties(rect, { strokes: [{ color: '#000000', width: 1, sides: ['bottom'] }] })
    expect(borders()).toHaveLength(1)

    await host.applyProperties(rect, { strokes: [{ color: '#000000', width: 1 }] })
    expect(borders()).toHaveLength(0)
    expect((shape('Switch').strokes as unknown[]).length).toBe(1)
  })

  it('渐变单边描边也能落（Penpot 的 stroke 支持渐变）', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'GradBorder', width: 100, height: 50 })
    await host.applyProperties(rect, {
      strokes: [
        {
          type: 'gradient_linear',
          gradientStops: [
            { position: 0, color: { r: 49 / 255, g: 239 / 255, b: 184 / 255, a: 1 } },
            { position: 1, color: { r: 67 / 255, g: 64 / 255, b: 234 / 255, a: 1 } },
          ],
          gradientHandlePositions: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
          width: 2,
          sides: ['bottom'],
        } as never,
      ],
    })

    const overlay = borders()
    expect(overlay).toHaveLength(1)
    const strokes = overlay[0].strokes as { strokeColorGradient?: { stops: { color: string }[] } }[]
    expect(strokes[0].strokeColorGradient?.stops.map((s) => s.color)).toEqual(['#31EFB8', '#4340EA'])
  })

  it('flex 容器里的单边描边会被标成 absolute（不然会被布局引擎挪走）', async () => {
    const frame = await host.createNode({ kind: 'frame', name: 'FlexCard', width: 100, height: 50 })
    // 先应用布局，再应用描边（与 renderer 的实际顺序一致：外观 → 布局 → 末尾重建叠加层）
    await host.applyProperties(frame, { strokes: [{ color: '#000000', width: 1, sides: ['bottom'] }] })
    await host.applyProperties(frame, { layoutMode: 'VERTICAL' })

    const overlay = borders()
    expect(overlay).toHaveLength(1)
    expect(overlay[0].layoutChild?.absolute).toBe(true)
    // flex 容器下的子节点用局部坐标（0..W/H）
    expect(overlay[0].d).toBe('M 0 49.5 H 100')
  })

  it('叶子节点（矩形/文本）的叠加层落在同级，位置用绝对坐标', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'Leaf', width: 80, height: 40 })
    await host.applyProperties(rect, { x: 25, y: 30 })
    await host.applyProperties(rect, { strokes: [{ color: '#000000', width: 2, sides: ['left'] }] })

    const overlay = borders()
    expect(overlay).toHaveLength(1)
    // 与源形状同级：同一父层（叶子不能承载子节点）
    expect(overlay[0].parent?.id).toBe(shape('Leaf').parent?.id)
    expect(overlay[0].d).toBe('M 26 30 V 70')
  })

  it('尺寸为 0 时如实说明无法模拟（而不是画一条错位的线）', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'Zero', width: 0, height: 0 })
    const result = await host.applyProperties(rect, { strokes: [{ color: '#000000', width: 1, sides: ['bottom'] }] })
    expect(result.skipped.some((s) => /需要已知宽高/.test(s.reason))).toBe(true)
    expect(borders()).toHaveLength(0)
  })
})

describe('整条链路：DSL 里的单边描边', () => {
  it('渲染 DSL（strokeBottomWeight）→ 叠加层出现，且源 frame 不再被整圈描边', async () => {
    const report = await renderDsl(host, {
      elements: [
        {
          type: 'frame',
          name: 'DSLCard',
          size: { width: 300, height: 80 },
          layoutMode: 'VERTICAL',
          fills: [{ type: 'SOLID', color: '#FFFFFF' }],
          strokes: [{ color: '#1F2937', width: 1 }],
          strokeBottomWeight: 2,
        } as never,
      ],
    })

    expect(report.rootCount).toBe(1)
    expect(report.skipped.some((s) => /单边描边/.test(s.reason))).toBe(false)

    const overlay = borders()
    expect(overlay).toHaveLength(1)
    expect(overlay[0].name).toBe('Border Bottom')
    expect((overlay[0].strokes as { strokeWidth: number }[])[0].strokeWidth).toBe(2)
    // ⚠️ 只有下边框 —— 这是 CSS border-*-width 的语义（给了权重就是单边模式，
    // 未给权重的边不存在），所以源 frame **不该**有整圈描边。
    expect(shape('DSLCard').strokes).toEqual([])
  })

  it('MemoryHost 侧不模拟（能力声明 perSideStrokes=true 表示原生支持）', async () => {
    const memory = new MemoryHost()
    expect(memory.getCapabilities().props.perSideStrokes).toBe(true)
    expect(memory.getCapabilities().ops.naturalChildOrdering).toBe(true)
  })
})

describe('回归：坐标必须是「结算后的绝对坐标」（实测踩过整体偏移）', () => {
  it('读父层位置前必须等布局结算 —— 否则边框被画在陈旧位置', async () => {
    const { penpot } = installFakePenpot({ withWaitForLayoutUpdate: true })
    const probe = new PenpotHost()
    await probe.init()

    const frame = await probe.createNode({ kind: 'frame', name: 'Late', width: 200, height: 80 })
    const frameShape = penpot.__all().find((s) => s.name === 'Late')!

    // 模拟「祖先 flex/auto-layout 稍后才把这一层摆到位」：
    // 第一次 waitForLayoutUpdate 时把它挪到最终位置 (100, 200)。
    let moved = false
    ;(penpot as unknown as Record<string, unknown>).waitForLayoutUpdate = async () => {
      if (!moved) {
        moved = true
        frameShape.x = 100
        frameShape.y = 200
      }
    }

    await probe.applyProperties(frame, { strokes: [{ color: '#000000', width: 2, sides: ['bottom'] }] })

    const overlay = penpot.__all().find((s) => String(s.name).startsWith('Border'))!
    // 结算后父层在 (100,200)、盒高 80、描边 2 → 下边线心 y = 200 + 80 - 1 = 279
    expect(overlay.d).toBe('M 100 279 H 300')
    expect(overlay.x).toBe(100)
    expect(overlay.y).toBe(279)
  })

  it('父子坐标互转：relativeToParent 才会加上父层绝对位置', async () => {
    const { penpot } = installFakePenpot()
    const probe = new PenpotHost()
    await probe.init()

    const frame = await probe.createNode({ kind: 'frame', name: 'Host2', width: 200, height: 100 })
    await probe.applyProperties(frame, { x: 50, y: 60 })

    // 默认：x/y 是页面绝对坐标
    await probe.createNode({ kind: 'rectangle', name: 'AbsChild', x: 5, y: 7 }, frame)
    const abs = penpot.__all().find((s) => s.name === 'AbsChild')!
    expect({ x: abs.x, y: abs.y }).toEqual({ x: 5, y: 7 })

    // relativeToParent：x/y 相对父层（图标放进内容区用的就是这条）
    const relativeChild = await probe.createNode(
      { kind: 'rectangle', name: 'RelChild', x: 5, y: 7, relativeToParent: true },
      frame,
    )
    void relativeChild
    const rel = penpot.__all().find((s) => s.name === 'RelChild')!
    expect({ x: rel.x, y: rel.y }).toEqual({ x: 55, y: 67 })
  })

  it('图标子节点用 relativeToParent —— 父层移动后仍跟着父层（不再跑到页面原点）', async () => {
    const { penpot } = installFakePenpot()
    const probe = new PenpotHost()
    await probe.init()

    const card = await probe.createNode({ kind: 'frame', name: 'IconHost', width: 100, height: 100 })
    await probe.applyProperties(card, { x: 300, y: 400, paddingTop: 8, paddingLeft: 12 })

    const icon = await probe.createNode({ kind: 'svg', name: 'Ico', svgContent: '<svg viewBox="0 0 8 8"><path fill="#fff" d="M0 0h8v8H0z"/></svg>', x: 12, y: 8, relativeToParent: true }, card)
    void icon
    const path = penpot.__all().find((s) => s.name === 'Ico' && s.type === 'path')!
    expect({ x: path.x, y: path.y }).toEqual({ x: 312, y: 408 })

    // 父层再移动 → 图标保持在父层内的相对位置（312-300=12, 408-400=8）
    await probe.applyProperties(card, { x: 500, y: 600 })
    expect(path.parentX).toBe(12)
    expect(path.parentY).toBe(8)
  })
})

describe('A 方案（描边）的刻意取舍：角部重叠是已知代价，不是 bug', () => {
  it('相邻异色的两条边各画整长（角部重叠）—— 若要改成 45° 对角切分需切到填充梯形', () => {
    return (async () => {
      const rect = await host.createNode({ kind: 'rectangle', name: 'Corners', width: 100, height: 50 })
      await host.applyProperties(rect, {
        strokes: [
          { color: '#FF0000', width: 4, sides: ['left'] },
          { color: '#0000FF', width: 4, sides: ['bottom'] },
        ],
      })

      const paths = fake.__all().filter((s) => String(s.name).startsWith('Border'))
      // 两条边颜色不同 → 拆成两条路径（无法合并，因为一条 Path 只有一个 stroke）
      expect(paths).toHaveLength(2)

      const left = paths.find((s) => s.name === 'Border Left')
      const bottom = paths.find((s) => s.name === 'Border Bottom')
      // 两条都画满整条边（左：0→50 全高；下：0→100 全宽）→ 角上 (0,46)-(4,50) 重叠
      expect(left?.d).toBe('M 2 0 V 50')
      expect(bottom?.d).toBe('M 0 48 H 100')
      // 明确记录：这里**不做** 45° 切分（那需要填充梯形，会失去 Strokes 面板可编辑性）
    })()
  })

  it('同色相邻边仍然合并成一条路径（角部无重叠问题）', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'SameColor', width: 100, height: 50 })
    await host.applyProperties(rect, {
      strokes: [
        { color: '#1F2937', width: 2, sides: ['left'] },
        { color: '#1F2937', width: 2, sides: ['bottom'] },
      ],
    })
    const paths = fake.__all().filter((s) => String(s.name).startsWith('Border'))
    expect(paths).toHaveLength(1)
    expect(paths[0].name).toBe('Border Bottom+Left')
    // 子路径顺序固定按 SIDE_ORDER（top→right→bottom→left）→ bottom 在前
    expect(paths[0].d).toBe('M 0 49 H 100 M 1 0 V 50')
  })
})
