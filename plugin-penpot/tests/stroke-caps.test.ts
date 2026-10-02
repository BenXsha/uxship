/**
 * 线帽 / 拐角映射（DSL → Penpot）
 *
 * 背景（`内部笔记` #6）：这两个字段被列进 `KNOWN_DSL_FIELDS`
 * （免得被当成拼写错误报出来），但**从不被消费** —— 后果是线帽/拐角在 Penpot 侧**静默丢失**，
 * 比"报降级"更隐蔽。现在按官方 `StrokeCap` 关键词表映射：
 *   `round / square / line-arrow / triangle-arrow / square-marker / circle-marker / diamond-marker`
 *
 * 本文件的重点是两条：
 *   1. 能保真的（普通线帽）**真的落到** `strokeCapStart/End`；
 *   2. 保不了真的（Penpot 没有 line-join、箭头帽只该落终点、不认识的值）**必须出现在 `skipped` 里** ——
 *      以后谁把上报删掉，这里就会红。
 */
import { describe, expect, it } from 'vitest'
import { MemoryHost } from '@lib/host/memory'
import { renderDsl } from '@lib/dsl/renderer'
import type { DSLDocument } from '@lib/dsl/types'
import { capFromPenpot, penpotCapFor, toPenpotStrokes } from '@lib/host/penpot-paint'

/** 一条最小可用描边；`extra` 用来挂线帽/拐角 */
function stroke(extra: Record<string, unknown> = {}) {
  return { type: 'SOLID', color: '#111111', width: 2, ...extra }
}

function convert(extra: Record<string, unknown> = {}) {
  return toPenpotStrokes([stroke(extra)] as never)
}

describe('普通线帽：两端同值（CSS stroke-linecap 本就作用于两端）', () => {
  it('ROUND → round', () => {
    const { strokes, skipped } = convert({ capStart: 'ROUND', capEnd: 'ROUND' })
    expect(strokes[0].strokeCapStart).toBe('round')
    expect(strokes[0].strokeCapEnd).toBe('round')
    expect(skipped).toEqual([])
  })

  it('SQUARE → square', () => {
    const { strokes } = convert({ capStart: 'SQUARE', capEnd: 'SQUARE' })
    expect(strokes[0].strokeCapStart).toBe('square')
    expect(strokes[0].strokeCapEnd).toBe('square')
  })

  it('NONE（平头）/ 未声明 → **不写**字段，且不算降级（Penpot 默认即平头）', () => {
    for (const extra of [{ capStart: 'NONE', capEnd: 'NONE' }, {}]) {
      const { strokes, skipped } = convert(extra)
      expect(strokes[0].strokeCapStart).toBeUndefined()
      expect(strokes[0].strokeCapEnd).toBeUndefined()
      expect(skipped).toEqual([])
    }
  })
})

describe('箭头线帽：只落终点 + 如实上报（DSL 不区分起止端）', () => {
  it('ARROW_EQUILATERAL → triangle-arrow 落在 strokeCapEnd', () => {
    const { strokes, skipped } = convert({ capStart: 'ARROW_EQUILATERAL', capEnd: 'ARROW_EQUILATERAL' })
    expect(strokes[0].strokeCapEnd).toBe('triangle-arrow')
    // 起点**不能**也落：两端都落会在起点凭空多一个箭头
    expect(strokes[0].strokeCapStart).toBeUndefined()
    expect(skipped.join(' ')).toContain('只落在')
  })

  it('LINE_ARROW / ROUND_ARROW → line-arrow / circle-marker', () => {
    expect(convert({ capStart: 'LINE_ARROW' }).strokes[0].strokeCapEnd).toBe('line-arrow')
    expect(convert({ capStart: 'ROUND_ARROW' }).strokes[0].strokeCapEnd).toBe('circle-marker')
  })

  it('MasterGo 别名也认：TRIANGLE_ARROW → triangle-arrow、DIAMOND → diamond-marker', () => {
    expect(convert({ capStart: 'TRIANGLE_ARROW' }).strokes[0].strokeCapEnd).toBe('triangle-arrow')
    expect(convert({ capStart: 'DIAMOND' }).strokes[0].strokeCapEnd).toBe('diamond-marker')
  })

  it('Penpot 无对应概念的值（RING / LINE / STROKE）→ 上报，不静默', () => {
    for (const cap of ['RING', 'LINE', 'STROKE']) {
      const { skipped } = convert({ capStart: cap })
      expect(skipped.join(' '), `${cap} 应被上报`).toContain('不认识')
    }
  })
})

describe('保不了的东西必须进 skipped（不许静默）', () => {
  it('不认识的线帽值 → 上报，且不写字段', () => {
    const { strokes, skipped } = convert({ capStart: 'WAT', capEnd: 'WAT' })
    expect(skipped.join(' ')).toContain('不认识')
    expect(strokes[0].strokeCapStart).toBeUndefined()
  })

  it('strokeJoin 非默认（ROUND/BEVEL）→ 上报：Penpot 的 stroke 模型没有 line-join 成员', () => {
    const { skipped } = convert({ capStart: 'ROUND', join: 'ROUND' })
    expect(skipped.join(' ')).toContain('line-join')
  })

  it('strokeJoin = MITER（SVG 默认，两侧一致）→ 不报，避免每根 HTML 边框刷噪声', () => {
    expect(convert({ capStart: 'ROUND', join: 'MITER' }).skipped).toEqual([])
  })
})

describe('回读映射（Penpot → DSL）', () => {  it('capFromPenpot：官方关键词 → DSL 口径；空值 = 平头 → undefined', () => {
    expect(capFromPenpot('round')).toBe('ROUND')
    expect(capFromPenpot('square')).toBe('SQUARE')
    expect(capFromPenpot('triangle-arrow')).toBe('ARROW_EQUILATERAL')
    expect(capFromPenpot('line-arrow')).toBe('LINE_ARROW')
    expect(capFromPenpot('circle-marker')).toBe('ROUND_ARROW')
    expect(capFromPenpot(null)).toBeUndefined()
    expect(capFromPenpot(undefined)).toBeUndefined()
    expect(capFromPenpot('')).toBeUndefined()
  })

  it('capFromPenpot：未知值原样保留（往返不丢信息）', () => {
    expect(capFromPenpot('weird-thing')).toBe('weird-thing')
  })

  it('penpotCapFor：DSL → 官方关键词；NONE/未声明 → undefined', () => {
    expect(penpotCapFor('ROUND')).toBe('round')
    expect(penpotCapFor('round')).toBe('round')
    expect(penpotCapFor('NONE')).toBeUndefined()
    expect(penpotCapFor(undefined)).toBeUndefined()
  })
})

describe('渲染器把**元素级** strokeCap/strokeJoin 落到描边上', () => {
  it('宿主收到的描边带 capStart / capEnd / join（以前这三个字段到这里就断了）', async () => {
    const host = new MemoryHost()
    const report = await renderDsl(
      host,
      {
        elements: [
          {
            type: 'frame',
            name: 'CapProbe',
            size: { width: 40, height: 40 },
            strokes: [{ type: 'SOLID', color: '#111111' }],
            strokeWidth: 2,
            strokeCap: 'ROUND',
            strokeJoin: 'BEVEL',
          },
        ],
      } as unknown as DSLDocument,
      { zoom: false, select: false },
    )

    const node = host.getNodeById(report.rootNodeIds[0])
    const strokes = host.readProperties(node!, ['strokes']).strokes as { capStart?: string; capEnd?: string; join?: string }[]
    expect(strokes[0].capStart).toBe('ROUND')
    expect(strokes[0].capEnd).toBe('ROUND')
    expect(strokes[0].join).toBe('BEVEL')
  })
})
