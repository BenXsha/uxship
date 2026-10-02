/**
 * 宿主往返计数（性能门禁）
 *
 * 为什么单独测这个：Penpot 插件 API 是**跨 iframe 代理** —— 每一次属性读写都是一次往返，
 * 所以「一次渲染慢不慢」基本等于「发了多少次宿主调用」。JS 计算不是瓶颈，往返次数才是。
 *
 * 本用例用**计数代理**包住 MemoryHost，把一个代表性 DSL 的宿主调用量钉成数字：
 * 任何让调用数暴涨的改动会在 CI 就暴露，而不是等真机渲染变卡。
 *
 * 口径：
 *   - `props` = 所有 `applyProperties` 里**非 undefined** 的属性个数（≈ 写往返次数）
 *   - `fields` = 所有 `readProperties` 的字段个数（≈ 读往返次数）
 *   - `creates` = `createNode` 次数
 */
import { describe, expect, it } from 'vitest'
import { MemoryHost } from '@lib/host/memory'
import type { HostAdapter } from '@lib/host/types'
import { renderDsl } from '@lib/dsl/renderer'
import type { DSLDocument, DSLElement } from '@lib/dsl/types'

interface Stats {
  applyProperties: number
  props: number
  reads: number
  fields: number
  creates: number
  /** 实际写过的属性名（用于断言「某项根本没下发」，而不只是数总数） */
  keys: string[]
}

/** 计数代理：不改行为，只数「跨宿主往返」的次数 */
function counting(inner: MemoryHost): { host: HostAdapter; stats: Stats } {
  const stats: Stats = { applyProperties: 0, props: 0, reads: 0, fields: 0, creates: 0, keys: [] }
  const target = inner as unknown as Record<string, unknown>
  const proxy = new Proxy(target, {
    get(obj, prop: string) {
      const value = obj[prop]
      if (typeof value !== 'function') return value
      if (prop === 'applyProperties') {
        return async (node: unknown, props: Record<string, unknown>) => {
          stats.applyProperties += 1
          for (const [k, v] of Object.entries(props)) {
            if (v === undefined) continue
            stats.props += 1
            stats.keys.push(k)
          }
          return (value as (...a: unknown[]) => unknown).apply(obj, [node, props])
        }
      }
      if (prop === 'readProperties') {
        return (node: unknown, fields: string[]) => {
          stats.reads += 1
          stats.fields += fields.length
          return (value as (...a: unknown[]) => unknown).apply(obj, [node, fields])
        }
      }
      if (prop === 'createNode') {
        return async (spec: unknown, parent?: unknown) => {
          stats.creates += 1
          return (value as (...a: unknown[]) => unknown).apply(obj, [spec, parent])
        }
      }
      return (value as (...a: unknown[]) => unknown).bind(obj)
    },
  })
  return { host: proxy as unknown as HostAdapter, stats }
}

/** 代表性 DSL：一个画板 + 两行容器 + 4 个文本（贴近真实生成页的形状） */
const DOC: DSLDocument = {
  version: '2.0',
  elements: [
    {
      type: 'frame',
      name: 'Page',
      size: { width: 390, height: 400 },
      fills: [{ type: 'SOLID', color: '#FFFFFF' }],
      layoutMode: 'VERTICAL',
      itemSpacing: 12,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      children: [
        {
          type: 'frame',
          name: 'Row',
          position: { x: 16, y: 16 },
          size: { width: 358, height: 40 },
          fills: [{ type: 'SOLID', color: '#F1F5F9' }],
          cornerRadius: 8,
          layoutMode: 'HORIZONTAL',
          itemSpacing: 8,
          paddingTop: 8,
          paddingRight: 8,
          paddingBottom: 8,
          paddingLeft: 8,
          primaryAxisAlignItems: 'CENTER',
          counterAxisAlignItems: 'CENTER',
          children: [
            { type: 'text', name: 'A', content: 'Hello', size: { width: 60, height: 20 }, fontSize: 14, fontWeight: 600, fills: [{ type: 'SOLID', color: '#0F172A' }], textAutoResize: 'WIDTH_AND_HEIGHT' } as DSLElement,
            { type: 'text', name: 'B', content: 'World', size: { width: 60, height: 20 }, fontSize: 14, fills: [{ type: 'SOLID', color: '#64748B' }], textAutoResize: 'WIDTH_AND_HEIGHT' } as DSLElement,
          ],
        },
        {
          type: 'frame',
          name: 'Row2',
          position: { x: 16, y: 68 },
          size: { width: 358, height: 40 },
          fills: [{ type: 'SOLID', color: '#F1F5F9' }],
          cornerRadius: 8,
          layoutMode: 'HORIZONTAL',
          itemSpacing: 8,
          paddingTop: 8,
          paddingRight: 8,
          paddingBottom: 8,
          paddingLeft: 8,
          primaryAxisAlignItems: 'CENTER',
          counterAxisAlignItems: 'CENTER',
          children: [
            { type: 'text', name: 'C', content: 'Foo', size: { width: 60, height: 20 }, fontSize: 14, fills: [{ type: 'SOLID', color: '#0F172A' }], textAutoResize: 'WIDTH_AND_HEIGHT' } as DSLElement,
            { type: 'text', name: 'D', content: 'Bar', size: { width: 60, height: 20 }, fontSize: 14, fills: [{ type: 'SOLID', color: '#64748B' }], textAutoResize: 'WIDTH_AND_HEIGHT' } as DSLElement,
          ],
        },
      ],
    } as DSLElement,
  ],
}

describe('渲染的宿主往返计数（性能门禁）', () => {
  it('7 个节点：调用量不超过既定上限', async () => {
    const base = new MemoryHost()
    const { host, stats } = counting(base)
    const report = await renderDsl(host, { ...DOC, _clientRenderMs: 12 } as unknown as DSLDocument, { zoom: false, select: false })
    expect(report.rootCount).toBe(1)
    // 供人工核对与调优（真实往返次数直接决定真机渲染耗时）
    console.log('[host-calls]', JSON.stringify(stats), 'hostRenderMs=', report.timing.hostRenderMs)

    // 耗时拆段：沙箱侧实测 + 客户端渲染段（由引擎上报的 _clientRenderMs 透传）
    expect(typeof report.timing.hostRenderMs).toBe('number')
    expect(report.timing.hostRenderMs).toBeGreaterThanOrEqual(0)
    expect(report.timing.clientRenderMs).toBe(12)

    expect(stats.creates).toBe(7)
    expect(stats.applyProperties).toBe(10)
    // 写往返 = 7 个节点的非 undefined 属性数。
    // 67 → 46 ：「去掉 name/width/height 的重复下发」；46 → 42：再去掉 4 个文本节点的 characters
    //（均在 `createNode(spec)` 里已落，两处取值同源）。
    // 若渲染器新增了**合法**属性，请连同这个数字更新；但变大前先确认不是重复下发。
    expect(stats.props).toBe(42)
    // 读往返：同一父层只解析一次，且只在真有带 position 的子元素时读
    expect(stats.reads).toBe(1)
    expect(stats.fields).toBe(1)
  })

  it('父层不是 flex 时不发 layoutPositioning（宿主必拒：白花一次往返 + 一条噪声降级）', async () => {
    const doc = (layoutMode?: string): DSLDocument =>
      ({
        elements: [
          {
            type: 'frame',
            name: 'Outer',
            size: { width: 100, height: 100 },
            ...(layoutMode ? { layoutMode } : {}),
            children: [
              {
                type: 'frame',
                name: 'Inner',
                size: { width: 50, height: 50 },
                position: { x: 10, y: 10 },
                layoutPositioning: 'AUTO',
              } as unknown as DSLElement,
            ],
          } as unknown as DSLElement,
        ],
      }) as unknown as DSLDocument

    const nonFlex = counting(new MemoryHost())
    await renderDsl(nonFlex.host, doc(), { zoom: false, select: false })
    expect(nonFlex.stats.keys).not.toContain('layoutPositioning')

    // 对照：flex 父层下必须照发（这是它真正的语义场景）
    const flex = counting(new MemoryHost())
    await renderDsl(flex.host, doc('VERTICAL'), { zoom: false, select: false })
    expect(flex.stats.keys).toContain('layoutPositioning')
  })
})
