/**
 * DSL 渲染器测试（用 MemoryHost）
 *
 * 这一组测的是**编排逻辑**：元素映射、父布局先于子元素、group 的两段式创建、
 * 单点失败不拖垮整页、报告内容是否足以让上层判断降级。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryHost } from '@lib/host/memory'
import type { HostAdapter } from '@lib/host/types'
import { renderDsl, collectAndLoadFonts, toNodeProperties } from '@lib/dsl/renderer'
import type { DSLDocument, DSLElement } from '@lib/dsl/types'
import { SAMPLE_DSL, SMOKE_DSL } from '@lib/dsl/sample'

let host: MemoryHost

beforeEach(() => {
  host = new MemoryHost()
})

/** 记录调用顺序的宿主代理 —— 用于验证「父布局先于子元素」这类时序约束 */
function recording(inner: HostAdapter): { calls: string[]; host: HostAdapter } {
  const calls: string[] = []
  const proxy = new Proxy(inner as unknown as Record<string, unknown>, {
    get(target, property) {
      const value = target[property as string]
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        const first = args[0] as { name?: string; id?: string } | undefined
        calls.push(`${String(property)}:${first?.name ?? first?.id ?? ''}`)
        return (value as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
  }) as unknown as HostAdapter
  return { calls, host: proxy }
}

describe('元素映射', () => {
  it('渲染冒烟 DSL：创建根节点并回填报告', async () => {
    const report = await renderDsl(host, SMOKE_DSL)

    expect(report.host).toBe('memory')
    expect(report.rootCount).toBe(1)
    expect(report.created.map((c) => c.name)).toContain('uxship Smoke Test')
    expect(report.skipped).toHaveLength(0)
  })

  it('渲染完整样例：层级完整、无失败', async () => {
    const report = await renderDsl(host, SAMPLE_DSL)

    expect(report.rootCount).toBe(1)
    // 完整样例含 1 个 group，group 走的是「先建子再成组」，因此 created 里应有 group 记录
    expect(report.created.some((c) => c.kind === 'group')).toBe(true)
    expect(report.created.every((c) => c.id)).toBe(true)
  })

  it('DSL 也能以数组形式传入', async () => {
    const report = await renderDsl(host, SMOKE_DSL.elements)
    expect(report.rootCount).toBe(1)
  })

  it('空文档如实报告而不是假装成功', async () => {
    const report = await renderDsl(host, { elements: [] })
    expect(report.rootCount).toBe(0)
    expect(report.skipped.some((s) => s.target === 'document')).toBe(true)
  })
})

describe('时序：父布局先于子元素', () => {
  it('父容器的 flex 在其子节点创建之前应用', async () => {
    const { calls, host: spy } = recording(host)

    await renderDsl(spy, {
      elements: [
        {
          type: 'frame',
          name: 'Parent',
          layoutMode: 'VERTICAL',
          children: [
            { type: 'text', name: 'Child1', content: 'a' },
            { type: 'text', name: 'Child2', content: 'b' },
          ],
        },
      ],
    })

    const parentProps = calls.indexOf('applyProperties:Parent')
    const firstChild = calls.indexOf('createNode:Child1')
    expect(parentProps).toBeGreaterThanOrEqual(0)
    expect(firstChild).toBeGreaterThanOrEqual(0)
    // 父的布局必须在子元素创建（也就意味着子元素的 layoutSizing 应用）之前
    expect(parentProps).toBeLessThan(firstChild)
  })

  it('子元素按 DSL 顺序创建（图层顺序不能反转）', async () => {
    await renderDsl(host, {
      elements: [
        {
          type: 'frame',
          name: 'Order',
          children: [
            { type: 'rectangle', name: 'First' },
            { type: 'rectangle', name: 'Second' },
            { type: 'rectangle', name: 'Third' },
          ],
        },
      ],
    })

    const parent = host.flatten().find((node) => node.name === 'Order')
    expect(parent?.children.map((child) => child.name)).toEqual(['First', 'Second', 'Third'])
  })
})

describe('group 的两段式创建', () => {
  it('先建子节点再成组，且子节点被重新挂到组下', async () => {
    const report = await renderDsl(host, {
      elements: [
        {
          type: 'group',
          name: 'My Group',
          children: [
            { type: 'rectangle', name: 'A' },
            { type: 'rectangle', name: 'B' },
          ],
        },
      ],
    })

    const groupCreated = report.created.find((c) => c.kind === 'group')
    expect(groupCreated?.name).toBe('My Group')

    const group = host.flatten().find((node) => node.name === 'My Group')
    expect(group?.children.map((child) => child.name)).toEqual(['A', 'B'])

    // 子节点不应再挂在页面层级
    expect(host.toTree().map((node) => node.name)).toEqual(['My Group'])
  })

  it('group 没有子节点时如实报告', async () => {
    const report = await renderDsl(host, { elements: [{ type: 'group', name: 'Empty', children: [] }] })
    expect(report.rootCount).toBe(0)
    expect(report.skipped.some((s) => s.target === 'group')).toBe(true)
  })

  it('宿主不支持 group 时降级而不是崩溃', async () => {
    const limited = new MemoryHost({ capabilities: { ops: { group: false } as never } })
    const report = await renderDsl(limited, {
      elements: [{ type: 'group', name: 'G', children: [{ type: 'rectangle', name: 'A' }] }],
    })
    expect(report.skipped.some((s) => /group/.test(s.target))).toBe(true)
  })
})

describe('降级报告', () => {
  it('不支持的元素类型进 skipped，其余元素照常渲染', async () => {
    const report = await renderDsl(host, {
      elements: [
        { type: 'rectangle', name: 'OK' },
        { type: 'connector', name: 'Conn' },
      ],
    })

    expect(report.rootCount).toBe(1)
    expect(report.skipped.map((s) => s.target)).toEqual(['connector'])
    // 报告里要能给出原因，不能只报「不支持」
    expect(report.skipped[0].reason).toMatch(/connector/)
  })

  it('instance 缺 componentId/componentName → 给可操作的原因，而不是谎报「尚未接线」', async () => {
    const report = await renderDsl(host, { elements: [{ type: 'instance', name: 'Inst' }] })

    expect(report.rootCount).toBe(0)
    const skip = report.skipped.find((s) => s.target === 'instance')
    expect(skip?.reason).toMatch(/componentId|componentName/)
    // 真机教训：这里曾写「Penpot 组件实例化尚未接线」，而该端口一直存在
    expect(skip?.reason).not.toMatch(/尚未接线/)
  })

  it('instance 真的实例化（本地库组件）—— 声明支持就必须能跑', async () => {
    const master = await host.createNode({ kind: 'frame', name: 'Card', width: 120, height: 80 })
    const component = await host.createComponent([master], 'Card')

    const report = await renderDsl(host, {
      elements: [{ type: 'instance', name: 'CardInstance', componentId: component.componentId }],
    })

    expect(report.skipped).toEqual([])
    expect(report.rootCount).toBe(1)
    expect(report.created[0].dslType).toBe('instance')
  })

  it('能力不支持时真的会抛错（不是静默）', async () => {
    const limited = new MemoryHost({ capabilities: { nodeKinds: ['rectangle'] as never } })
    const report = await renderDsl(limited, { elements: [{ type: 'ellipse', name: 'E' }] })
    expect(report.rootCount).toBe(0)
    expect(report.skipped.some((s) => /不支持/.test(s.reason))).toBe(true)
  })

  it('strict 模式把元素级失败升级为抛错', async () => {
    await expect(
      renderDsl(host, { elements: [{ type: 'connector', name: 'C' }] }, { strict: true }),
    ).rejects.toThrow()
  })

  it('属性级降级计入 skipped，但不影响 ok（rootCount > 0）', async () => {
    const limited = new MemoryHost({ capabilities: { props: { perSideStrokes: false } as never } })
    const report = await renderDsl(limited, {
      elements: [
        {
          type: 'rectangle',
          name: 'SB',
          strokes: [{ color: '#000000', width: 1 }],
          strokeBottomWeight: 2,
        },
      ],
    })

    expect(report.rootCount).toBe(1)
    expect(report.skipped.some((s) => /单边描边/.test(s.reason))).toBe(true)
  })

  it('perElement 统计能定位「大部分属性没生效」的元素', async () => {
    const report = await renderDsl(host, { elements: [{ type: 'rectangle', name: 'R', cornerRadius: 8, opacity: 0.5 }] })
    const entry = report.perElement.find((e) => e.path === 'elements[0]')
    // `applied` 只统计**经 `applyProperties` 落地**的属性；`name` 与几何尺寸由 `createNode(spec)`
    // 落地（不再重复下发，见 renderElement §2 的去重注释），因此这里只预期 cornerRadius + opacity。
    expect(entry?.applied).toBeGreaterThanOrEqual(2)
    expect(entry?.skipped).toBe(0)
  })
})

describe('渲染后行为', () => {
  it('默认选中并聚焦顶层成果', async () => {
    await renderDsl(host, SMOKE_DSL)
    expect(host.getSelection().length).toBe(1)
    expect(host.zoomLog).toHaveLength(1)
  })

  it('select/zoom 可关闭', async () => {
    await renderDsl(host, SMOKE_DSL, { select: false, zoom: false })
    expect(host.getSelection()).toHaveLength(0)
    expect(host.zoomLog).toHaveLength(0)
  })

  it('渲染到指定父节点之下', async () => {
    const parent = await host.createNode({ kind: 'frame', name: 'Host' })
    const report = await renderDsl(host, SMOKE_DSL, { parent })

    const host0 = host.flatten().find((node) => node.name === 'Host')
    expect(host0?.children.map((c) => c.name)).toEqual(['uxship Smoke Test'])
    expect(report.rootCount).toBe(1)
  })
})

describe('字体收集', () => {
  it('只收集文本节点的字体，且按 family+style 去重', async () => {
    const doc: DSLDocument = {
      elements: [
        {
          type: 'frame',
          name: 'F',
          children: [
            { type: 'text', name: 'T1', content: 'a', fontName: { family: 'Inter', style: 'Regular' } },
            { type: 'text', name: 'T2', content: 'b', fontName: { family: 'Inter', style: 'Regular' } },
            { type: 'text', name: 'T3', content: 'c', fontName: { family: 'Inter', style: 'Bold' } },
            { type: 'rectangle', name: 'R' },
          ],
        },
      ],
    }

    await collectAndLoadFonts(host, doc.elements)
    expect(host.loadedFonts).toHaveLength(2)
  })

  it('宿主 loadFonts 抛错时不阻断渲染', async () => {
    const broken = new MemoryHost()
    broken.loadFonts = async () => {
      throw new Error('font service down')
    }
    await expect(collectAndLoadFonts(broken, SAMPLE_DSL.elements)).resolves.toBeUndefined()
  })
})

describe('toNodeProperties：DSL 语义 → 宿主属性', () => {
  it('flexGrow:1 归一为 layoutSizingHorizontal=FILL', () => {
    const props = toNodeProperties({ type: 'frame', name: 'X', flexGrow: 1 }, 'frame')
    expect(props.layoutSizingHorizontal).toBe('FILL')
  })

  it('显式 layoutSizingHorizontal 优先于 flexGrow', () => {
    const props = toNodeProperties({ type: 'frame', name: 'X', flexGrow: 1, layoutSizingHorizontal: 'HUG' }, 'frame')
    expect(props.layoutSizingHorizontal).toBe('HUG')
  })

  it('文本尺寸策略：宽+高 → 固定框；只有宽 → 宽固定高自适应；都没有 → 自适应', () => {
    expect(toNodeProperties({ type: 'text', name: 'T', content: 'x', size: { width: 100, height: 20 } }, 'text').textAutoResize).toBe('NONE')
    expect(toNodeProperties({ type: 'text', name: 'T', content: 'x', size: { width: 100 } }, 'text').textAutoResize).toBe('HEIGHT')
    expect(toNodeProperties({ type: 'text', name: 'T', content: 'x' }, 'text').textAutoResize).toBe('WIDTH_AND_HEIGHT')
  })

  it('显式 textAutoResize 优先于尺寸推断', () => {
    const props = toNodeProperties(
      { type: 'text', name: 'T', content: 'x', size: { width: 100, height: 20 }, textAutoResize: 'TRUNCATE' },
      'text',
    )
    expect(props.textAutoResize).toBe('TRUNCATE')
  })

  it('GRID 布局在 Penpot 侧退化为 NONE（并会被报告）', () => {
    const props = toNodeProperties({ type: 'frame', name: 'X', layoutMode: 'GRID' }, 'frame')
    expect(props.layoutMode).toBe('NONE')
  })

  it('数字形式的 lineHeight 视为像素', () => {
    const props = toNodeProperties({ type: 'text', name: 'T', content: 'x', lineHeight: 20 }, 'text')
    expect(props.lineHeight).toEqual({ value: 20, unit: 'PIXELS' })
  })

  it('单边描边权重归一为 sides', () => {
    const props = toNodeProperties(
      { type: 'rectangle', name: 'R', strokes: [{ color: '#000' }], strokeBottomWeight: 2 },
      'rectangle',
    )
    expect(props.strokes?.[0].sides).toEqual(['bottom'])
  })

  it('四边权重齐备时不带 sides（避免误报降级）', () => {
    const props = toNodeProperties(
      {
        type: 'rectangle',
        name: 'R',
        strokes: [{ color: '#000' }],
        strokeTopWeight: 1,
        strokeRightWeight: 1,
        strokeBottomWeight: 1,
        strokeLeftWeight: 1,
      },
      'rectangle',
    )
    expect(props.strokes?.[0].sides).toBeUndefined()
  })
})

describe('客户端渲染产物接入（P3）', () => {
  it('报告带 rootNodeIds 别名（服务端 code_to_design 靠它建 DesignCache 会话）', async () => {
    const report = await renderDsl(host, SMOKE_DSL)
    expect(report.rootNodeIds).toEqual(report.rootIds)
    expect(report.rootNodeIds.length).toBe(1)
  })

  it('未解析的 Tailwind class 会被回传并触发一次宿主告警', async () => {
    const report = await renderDsl(host, {
      elements: [{ type: 'rectangle', name: 'R' }],
      _unresolvedClasses: ['hover:bg-red-500', 'truncate', 42 as unknown as string],
    })

    // 非字符串项会被过滤，不污染报告
    expect(report.unresolvedClasses).toEqual(['hover:bg-red-500', 'truncate'])
    // 样式丢了就必须让用户看到，不能只在返回值里
    expect(host.notifications.some((n) => /Tailwind class 未生效/.test(n.message))).toBe(true)
    expect(host.notifications.every((n) => n.kind !== 'error')).toBe(true)
  })

  it('没有未解析 class 时不告警（不制造噪声）', async () => {
    await renderDsl(host, SMOKE_DSL)
    expect(host.notifications.filter((n) => /Tailwind/.test(n.message))).toHaveLength(0)
  })

  it('裸元素数组输入时 unresolvedClasses 为空（元数据只存在于文档上）', async () => {
    const report = await renderDsl(host, [{ type: 'rectangle', name: 'R' }])
    expect(report.unresolvedClasses).toEqual([])
  })

  it('客户端渲染引擎的新字段全部能落地（分角圆角 / 绝对定位 / AUTO 尺寸 / 混合模式）', async () => {
    const report = await renderDsl(host, {
      elements: [
        {
          type: 'frame',
          name: 'Flex',
          layoutMode: 'HORIZONTAL',
          primaryAxisSizingMode: 'AUTO',
          flexWrap: 'WRAP',
          children: [
            {
              type: 'rectangle',
              name: 'Abs',
              layoutPositioning: 'ABSOLUTE',
              topLeftRadius: 10,
              bottomRightRadius: 4,
              blendMode: 'MULTIPLY',
              layoutSizingHorizontal: 'AUTO',
            },
          ],
        },
      ],
    })

    // 未知字段检查不应该把这些误报为拼写问题
    expect(report.skipped).toEqual([])

    const abs = host.flatten().find((n) => n.name === 'Abs')
    expect(abs?.props.layoutPositioning).toBe('ABSOLUTE')
    expect(abs?.props.topLeftRadius).toBe(10)
    expect(abs?.props.bottomRightRadius).toBe(4)
    expect(abs?.props.blendMode).toBe('MULTIPLY')
    expect(abs?.props.layoutSizingHorizontal).toBe('AUTO')
  })

  it('节点级 imageUrl 与描边别名（strokeWeight / strokeAlign）透传到属性包', () => {
    const props = toNodeProperties(
      {
        type: 'rectangle',
        name: 'R',
        imageUrl: 'https://example.com/a.png',
        imageScaleMode: 'CROP',
        strokes: [{ color: '#000' }],
        strokeWeight: 2,
        strokeAlign: 'OUTSIDE',
      },
      'rectangle',
    )

    expect(props.imageUrl).toBe('https://example.com/a.png')
    expect(props.imageScaleMode).toBe('CROP')
    expect(props.strokes?.[0].width).toBe(2)
    expect(props.strokes?.[0].align).toBe('OUTSIDE')
  })

  it('显式 fills 与 imageUrl 共存时保留两者（顺序由 PROPERTY_PHASES 决定）', () => {
    const props = toNodeProperties(
      { type: 'rectangle', name: 'R', imageUrl: 'u', fills: [{ type: 'SOLID', color: '#fff' }] },
      'rectangle',
    )
    expect(props.imageUrl).toBe('u')
    expect(props.fills).toHaveLength(1)
  })
})

describe('元素字段映射细节', () => {
  it('isVisible / isLocked 映射到 visible / locked', async () => {
    const report = await renderDsl(host, {
      elements: [{ type: 'rectangle', name: 'R', isVisible: false, isLocked: true } as DSLElement],
    })
    const node = host.flatten().find((n) => n.name === 'R')
    expect(node?.props.visible).toBe(false)
    expect(node?.props.locked).toBe(true)
    expect(report.skipped).toHaveLength(0)
  })

  it('未知属性不会让渲染失败（前向兼容）', async () => {
    const report = await renderDsl(host, {
      elements: [{ type: 'rectangle', name: 'R', someFutureProp: 1 } as unknown as DSLElement],
    })
    expect(report.rootCount).toBe(1)
    expect(report.skipped.some((s) => s.target === 'someFutureProp')).toBe(true)
  })
})

// ───────────────────────── 整次渲染 = 一个撤销块 ─────────────────────────
//
// 落一页通常创建几十个节点，宿主默认"一次操作一步撤销" → 用户得按几十次 Ctrl+Z。
// 包成一个块（`penpot.history.undoBlockBegin/Finish`）后一次撤掉。
// 这里同时钉住**闭合**：替身记录 opened/closed，异常路径漏了 finally 就会被抓到。

describe('撤销块', () => {
  it('renderDsl 把整次渲染包进一个块，并且确实闭合了', async () => {
    await renderDsl(host, { elements: [
      { type: 'rectangle', name: 'R', size: { width: 10, height: 10 } },
      { type: 'rectangle', name: 'R2', size: { width: 10, height: 10 } },
    ] } as never)

    expect(host.undoBlocks).toHaveLength(1)
    expect(host.undoBlocks[0].label).toMatch(/渲染 DSL（2 个顶层元素）/)
    expect(host.undoBlocks[0].closed).toBeLessThan(host.undoBlocks[0].opened) // 已闭合（深度回退）
  })

  it('宿主没有 withUndoBlock 时照常渲染（这是体验优化，不该让渲染失败）', async () => {
    const bare = new MemoryHost() as unknown as Record<string, unknown>
    delete bare.withUndoBlock
    const report = await renderDsl(bare as never, { elements: [{ type: 'rectangle', name: 'X', size: { width: 1, height: 1 } }] } as never)
    expect(report.rootCount).toBe(1)
  })
})

// ───────────────────── flexWrap 时序（真机回归）─────────────────────
//
// 真机现象：带 `flex flex-wrap` 的容器全部不换行（子元素横向溢出）。根因是
// `splitProperties` 把 flexWrap 归给了 visualProps，而 visualProps 先于 layoutProps 下发 →
// 宿主此刻还没有 flex 布局 → 「节点没有 flex 布局」→ 静默失效。
// 本测试钉住：flexWrap 必须与 layoutMode 在**同一次** layoutProps 调用里，且 layoutMode 在前。

describe('flexWrap 时序', () => {
  it('flexWrap 与 layoutMode 同批下发，且 layoutMode 在前', async () => {
    const batchesByNode: Record<string, string[][]> = {}
    const inner = new MemoryHost()
    const recordProps = (...args: unknown[]) => {
      const node = args[0] as { name?: string }
      const props = args[1] as Record<string, unknown>
      ;(batchesByNode[node.name ?? '?'] ??= []).push(Object.keys(props))
      return (inner.applyProperties as (...a: unknown[]) => Promise<unknown>).apply(inner, args)
    }
    const proxy = new Proxy(inner as unknown as Record<string, unknown>, {
      get(target, property) {
        if (property === 'applyProperties') return recordProps
        return Reflect.get(target, property)
      },
    }) as unknown as HostAdapter

    const dsl = {
      elements: [
        {
          type: 'frame',
          name: 'Wrap',
          size: { width: 200, height: 100 },
          layoutMode: 'HORIZONTAL',
          flexWrap: 'WRAP',
          itemSpacing: 8,
          children: [],
        },
      ],
    } as unknown as DSLDocument
    const report = await renderDsl(proxy, dsl)

    const batches = batchesByNode['Wrap'] ?? []
    const wrapBatchIndex = batches.findIndex((keys) => keys.includes('flexWrap'))
    expect(wrapBatchIndex).toBeGreaterThanOrEqual(0)
    // 同批里必须有 layoutMode，且排在其前
    expect(batches[wrapBatchIndex]).toContain('layoutMode')
    expect(batches[wrapBatchIndex].indexOf('layoutMode')).toBeLessThan(batches[wrapBatchIndex].indexOf('flexWrap'))
    expect(report.skipped.some((s) => s.target === 'flexWrap')).toBe(false)
  })
})

// ───────────────────────── 声明式令牌绑定（data-token-*）─────────────────────────
//
// 宿主"直接写属性即解绑"，所以绑定必须发生在**结构与属性全部落完之后**。
// 计量以回读为准（`applied`），不拿"调用没报错"当成功；失败进 failed 并带 reason。

describe('令牌绑定', () => {
  /** 记录 applyProperties / applyToken 的调用顺序，并支持成功/报错两种替身 */
  function tokenHost(behavior: 'ok' | 'throw') {
    const calls: { token: string; props: string[] }[] = []
    const order: string[] = []
    const inner = new MemoryHost()
    const proxy = new Proxy(inner as unknown as Record<string, unknown>, {
      get(target, property) {
        if (property === 'applyProperties') {
          const original = target.applyProperties as (...a: unknown[]) => Promise<unknown>
          return (...args: unknown[]) => {
            order.push('props')
            return original.apply(target, args)
          }
        }
        if (property === 'applyToken') {
          return async (_node: unknown, token: string, props: string[] = ['fill']) => {
            order.push('token')
            calls.push({ token, props: [...props] })
            if (behavior === 'throw') throw new Error(`令牌不存在: ${token}`)
            return { applied: true, tokenId: 'tok', properties: [...props], bound: { fill: token } }
          }
        }
        return Reflect.get(target, property)
      },
    }) as unknown as HostAdapter
    return { host: proxy, calls, order }
  }

  const swatch = (tokenName: string) => ({
    elements: [
      {
        type: 'rectangle',
        name: 'Swatch',
        size: { width: 20, height: 20 },
        fills: [{ type: 'SOLID', color: '#000000' }],
        tokenBindings: { fill: tokenName },
      },
    ],
  }) as unknown as DSLDocument

  it('绑定计数 requested/bound，且调用参数为 (token, [属性名])', async () => {
    const { host: fake, calls } = tokenHost('ok')
    const report = await renderDsl(fake, swatch('system.color.primary'))

    expect(report.tokenBindings.requested).toBe(1)
    expect(report.tokenBindings.bound).toBe(1)
    expect(report.tokenBindings.failed).toEqual([])
    expect(calls).toEqual([{ token: 'system.color.primary', props: ['fill'] }])
  })

  it('绑定发生在属性写入之后（先落属性、最后绑令牌）', async () => {
    const { host: fake, order } = tokenHost('ok')
    await renderDsl(fake, swatch('system.color.primary'))

    const lastProps = order.lastIndexOf('props')
    const tokenAt = order.indexOf('token')
    expect(tokenAt).toBeGreaterThan(lastProps)
  })

  it('令牌不存在（宿主抛错）→ 进 failed，渲染不整体失败', async () => {
    const { host: fake } = tokenHost('throw')
    const report = await renderDsl(fake, swatch('missing.token'))

    expect(report.tokenBindings.requested).toBe(1)
    expect(report.tokenBindings.bound).toBe(0)
    expect(report.tokenBindings.failed[0]).toMatchObject({ property: 'fill', token: 'missing.token' })
    expect(report.tokenBindings.failed[0].reason).toMatch(/令牌不存在/)
    expect(report.rootCount).toBe(1)
  })

  it('MemoryHost 不支持绑定时如实计 failed（不谎报 bound）', async () => {
    const report = await renderDsl(new MemoryHost() as unknown as HostAdapter, swatch('system.color.primary'))
    expect(report.tokenBindings.requested).toBe(1)
    expect(report.tokenBindings.bound).toBe(0)
    expect(report.tokenBindings.failed).toHaveLength(1)
  })
})

// ─── P2-3：富文本 run 的渲染编排 ───

describe('富文本 run（P2-3）', () => {
  it('text 元素带 runs → 渲染后计数进报告，且 run 落到宿主', async () => {
    const doc: DSLDocument = {
      version: '2.0',
      elements: [
        {
          type: 'text',
          name: 'Rich',
          content: 'HelloWorld',
          runs: [
            { text: 'Hello', fontSize: 20, fontWeight: 700, color: '#FF6B35' },
            { text: 'World', fontSize: 14, color: '#0F172A' },
          ],
        } as DSLElement,
      ],
    }
    const report = await renderDsl(host, doc, { zoom: false, select: false })
    expect(report.textRuns).toEqual({ elements: 1, runs: 2, characters: 10 })
    const node = host.getNodeById(report.rootIds[0])!
    expect(host.readTextRuns(node).map((run) => run.text)).toEqual(['Hello', 'World'])
  })

  it('无 runs 的 text 不进计数（不膨胀）', async () => {
    const doc: DSLDocument = { version: '2.0', elements: [{ type: 'text', name: 'Plain', content: 'hi' } as DSLElement] }
    const report = await renderDsl(host, doc, { zoom: false, select: false })
    expect(report.textRuns).toEqual({ elements: 0, runs: 0, characters: 0 })
  })
})

describe('未知字段检查（runs / tokenBindings / textSegments 属已知）', () => {
  it('带 runs / tokenBindings / textSegments 的文本不报「不认识字段」', async () => {
    const doc: DSLDocument = {
      version: '2.0',
      elements: [
        {
          type: 'text',
          name: 'T',
          content: 'ab',
          runs: [{ text: 'a' }, { text: 'b', color: '#FF6B35' }],
          textSegments: [],
          tokenBindings: { fill: 'system.color.primary' },
        } as DSLElement,
      ],
    }
    const report = await renderDsl(host, doc, { zoom: false, select: false })
    const unknown = report.skipped.filter((s) => String(s.reason ?? '').includes('不认识字段'))
    expect(unknown).toEqual([])
  })
})

describe('未知字段检查（客户端渲染产出字段均已知）', () => {
  it('strokeJoin/strokeCap/component*/swap*/overrides 不报「不认识字段」', async () => {
    const doc: DSLDocument = {
      version: '2.0',
      elements: [
        {
          type: 'frame',
          name: 'F',
          strokeJoin: 'MITER',
          strokeCap: 'ROUND',
          componentId: 'c1',
          componentName: 'Card',
          componentUkey: 'uk',
          componentVariant: 'v',
          overrides: {},
          variantProperties: {},
          swapNodeIds: ['x'],
          swapKeepOriginal: true,
          swapKeepSize: true,
          swapResetOverrides: false,
        } as unknown as DSLElement,
      ],
    }
    const report = await renderDsl(host, doc, { zoom: false, select: false })
    const unknown = report.skipped.filter((s) => String(s.reason ?? '').includes('不认识字段'))
    expect(unknown).toEqual([])
  })
})

describe('clipsContent 只对容器下发', () => {
  it('叶子节点（rectangle/text）不写 clipsContent；容器（frame）保留', () => {
    const rect = toNodeProperties({ type: 'rectangle', name: 'R', clipsContent: false } as DSLElement, 'rectangle')
    expect('clipsContent' in rect).toBe(false)

    const text = toNodeProperties({ type: 'text', name: 'T', content: 'x', clipsContent: false } as DSLElement, 'text')
    expect('clipsContent' in text).toBe(false)

    const frame = toNodeProperties({ type: 'frame', name: 'F', clipsContent: false } as DSLElement, 'frame')
    expect(frame.clipsContent).toBe(false)
  })
})

describe('布局告警通道（_layoutWarnings）', () => {
  it('文档上的 _layoutWarnings 被收集进报告', async () => {
    const doc = {
      version: '2.0',
      elements: [{ type: 'frame', name: 'F' } as DSLElement],
      _layoutWarnings: ['文本「查看行程」盒宽偏紧（单行自然宽 49 / 盒宽 48）→ 已按单行收敛'],
    }
    const report = await renderDsl(host, doc as never, { zoom: false, select: false })
    expect(report.layoutWarnings).toEqual(['文本「查看行程」盒宽偏紧（单行自然宽 49 / 盒宽 48）→ 已按单行收敛'])
  })

  it('没有 _layoutWarnings → 空数组（不是 undefined）', async () => {
    const report = await renderDsl(host, { version: '2.0', elements: [] } as never, { zoom: false, select: false })
    expect(report.layoutWarnings).toEqual([])
  })
})
