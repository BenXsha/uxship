/**
 * 能力点检卡（SAMPLE_DSL）的落地回归
 *
 * 这份样例是面板「完整样例」的素材，定位是**能力点检**：每一项都对应一个已知的跨宿主差异。
 * 因此它天然是一个端到端门禁 —— 只要某项能力退化，就会立刻表现为：
 *   - 该节点少了（`report.created` 里找不到）
 *   - 或 `report.skipped` 里**多出**一项
 *
 * 关键断言是最后那条：**降级项必须恰好只有 conic 一项**。
 * 这一条同时锁住了很多东西 —— 颜色量纲、naturalChildOrdering、fontWeight 单独应用、
 * clipsContent 判定、单边描边模拟、逃生口形状生成…… 任何一处退化都会在这里冒出来。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { PenpotHost } from '@lib/host/penpot'
import { renderDsl } from '@lib/dsl/renderer'
import { SAMPLE_DSL, SMOKE_DSL } from '@lib/dsl/sample'
import { installFakePenpot, type FakePenpot } from './helpers/fake-penpot'

let fake: FakePenpot
let host: PenpotHost

beforeEach(async () => {
  const installed = installFakePenpot()
  fake = installed.penpot
  host = new PenpotHost()
  await host.init()
})

const find = (name: string) => fake.__all().find((s) => s.name === name) as unknown as Record<string, any> | undefined

describe('能力点检卡：形状', () => {
  it('基础形状 + 逃生口形状都落地为可编辑矢量', async () => {
    await renderDsl(host, SAMPLE_DSL)

    // 基础
    expect(find('Logo')?.type).toBe('rectangle')
    expect(find('Title')?.type).toBe('text')
    expect(find('Radial')?.type).toBe('ellipse')

    // 逃生口：polygon / star / line / pen 全部是原生 path
    const hexagon = find('Hexagon')
    expect(hexagon?.type).toBe('path')
    expect(String(hexagon?.d).split('L').length).toBe(6) // 正六边形：6 段

    const star = find('Star5')
    expect(star?.type).toBe('path')
    expect(String(star?.d).split('L').length).toBe(10) // 5 外 + 5 内 → 10 段

    const line = find('Segment')
    expect(String(line?.d)).toBe('M 0 20 H 48')
    expect((line?.strokes as unknown[]).length).toBe(1)

    const curve = find('Curve')
    expect(String(curve?.d)).toBe('M 4 32 C 14 4, 30 4, 40 32 Z')
  })
})

describe('能力点检卡：填充', () => {
  it('linear / radial 渐变落地（含椭圆比例），conic 诚实降级', async () => {
    await renderDsl(host, SAMPLE_DSL)

    const linear = (find('Linear')?.fills as Record<string, any>[])[0]
    expect(linear.fillColorGradient?.type).toBe('linear')
    expect(linear.fillColorGradient?.stops.map((s: any) => s.color)).toEqual(['#31EFB8', '#4340EA'])

    const radial = (find('Radial')?.fills as Record<string, any>[])[0]
    expect(radial.fillColorGradient?.type).toBe('radial')
    // 引擎的 transform[0][0]（rx/r）→ Penpot 的 width（椭圆比例）
    expect(radial.fillColorGradient?.width).toBe(0.6)

    // conic：Penpot 没有 → 降级为第一个色标的纯色（不是空白/透明）
    const conic = (find('Conic（预期降级）')?.fills as Record<string, any>[])[0]
    expect(conic.fillColor).toBe('#31EFB8')
    expect(conic.fillColorGradient).toBeUndefined()
  })
})

describe('能力点检卡：边框', () => {
  it('四边同色走原生整圈；单边生成叠加 Path；渐变描边落 strokeColorGradient', async () => {
    await renderDsl(host, SAMPLE_DSL)

    const ring = find('Native Ring')
    expect((ring?.strokes as Record<string, any>[])[0].strokeColor).toBe('#374151')
    expect((ring?.strokes as Record<string, any>[])[0].strokeWidth).toBe(2)

    // 单边：源矩形不再有整圈描边，改为叠加 Path
    const bottomOnly = find('Bottom Only')
    expect(bottomOnly?.strokes).toEqual([])
    const overlay = find('Border Bottom')
    expect(overlay?.type).toBe('path')
    expect((overlay?.strokes as Record<string, any>[])[0].strokeColor).toBe('#31EFB8')

    // 渐变描边：原生 strokeColorGradient
    const gradientStroke = (find('Gradient Border')?.strokes as Record<string, any>[])[0]
    expect(gradientStroke.strokeColorGradient?.type).toBe('linear')
    expect(gradientStroke.strokeWidth).toBe(2)
  })
})

describe('能力点检卡：特效与文本', () => {
  it('四类特效各落到对应成员（shadows / blur / backgroundBlur）', async () => {
    await renderDsl(host, SAMPLE_DSL)

    const drop = (find('DropShadow')?.shadows as Record<string, any>[])[0]
    expect(drop?.style).toBe('drop-shadow')
    expect(drop?.offsetY).toBe(8)

    const inner = (find('InnerShadow')?.shadows as Record<string, any>[])[0]
    expect(inner?.style).toBe('inner-shadow')

    // 图层模糊与背景模糊是**两个独立成员**（Penpot 的 blur / backgroundBlur）
    expect(find('LayerBlur')?.blur).toEqual({ value: 3, hidden: false })
    expect(find('LayerBlur')?.backgroundBlur).toBeFalsy()
    expect(find('BackdropBlur')?.backgroundBlur).toEqual({ value: 6, hidden: false })
  })

  it('只给 fontWeight（没有 fontName）时字重也能落地', async () => {
    await renderDsl(host, SAMPLE_DSL)
    // 引擎经常只产出字重；这条曾经报「字体不可用: undefined」并且把字重丢掉
    expect(String(find('Title')?.fontWeight)).toBe('600')
  })

  it('半透明分隔线与右对齐文本', async () => {
    await renderDsl(host, SAMPLE_DSL)
    const divider = (find('Divider')?.fills as Record<string, any>[])[0]
    expect(divider.fillColor).toBe('#FFFFFF')
    expect(divider.fillOpacity).toBeCloseTo(0x14 / 255, 3)
    expect(find('Right Aligned')?.align).toBe('right')
  })
})

describe('能力点检卡：自检门禁', () => {
  it('降级项必须**恰好**只有 conic 一项（任何其它降级都说明能力退化）', async () => {
    const report = await renderDsl(host, SAMPLE_DSL)

    expect(report.rootCount).toBe(1)
    expect(report.created.length).toBeGreaterThan(40)

    const reasons = report.skipped.map((s) => `${s.target}: ${s.reason}`)
    expect(reasons).toHaveLength(1) // 只允许 conic 那一条
    expect(reasons[0]).toMatch(/GRADIENT_ANGULAR/)
  })

  it('冒烟样例保持零降级（作为「宿主是否接通」的最快判断）', async () => {
    const report = await renderDsl(host, SMOKE_DSL)
    expect(report.rootCount).toBe(1)
    expect(report.skipped).toEqual([])
  })
})
