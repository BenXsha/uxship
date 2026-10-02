import { describe, it, expect, afterEach } from 'vitest'
import { installMgStub, resetMgStub } from './helpers/mg-stub'
import { applyInstanceOverrides, normalizeHexColor } from '../lib/api/instance-overrides'
import { applyComponentSwap } from '../lib/api/swapComponentHandlers'
import { DSLRenderer } from '../lib/api/dsl-renderer'
import { handleRenderDSL } from '../lib/api/dslHandlers'

/**
 * 实例子节点覆写（`data-override-*` → DSL `InstanceElement.overrides`）的**消费端**契约
 *
 * 这条链路（HTML → 客户端渲染引擎 → DSL → 插件端渲染器 → 画布）此前有两个"看起来成功、
 * 其实没生效"的缺口：
 *
 * 1. `fill` 只接受 `#RRGGBB`：旧实现 `parseInt(value.slice(1,3),16)`，传 `rgba(...)` 会写出
 *    `NaN` 颜色（合法但错误）；目标无填充时**静默什么都不做**。
 * 2. 换组件路径（`data-swap-node-id` + `data-override-*`）不转发 `overrides`，覆写被静默丢弃。
 *
 * 本文件锁定：值校验（只收 `#RGB`/`#RRGGBB` 并归一化）、降级可观测（找不到图层 / fill 非法 /
 * 无填充 / 非 TEXT / 未知属性全部收集上报）、实例路径与换组件路径共用同一套语义。
 */

afterEach(() => resetMgStub())

/* ------------------------------------------------------------------ 造桩工具 */

const HEX = (hex: string) => ({
  r: parseInt(hex.slice(1, 3), 16) / 255,
  g: parseInt(hex.slice(3, 5), 16) / 255,
  b: parseInt(hex.slice(5, 7), 16) / 255,
  a: 1,
})

function textNode(name: string, characters = 'Label', fillHex = '#111111'): any {
  return {
    id: `n:${name}`,
    name,
    type: 'TEXT',
    characters,
    visible: true,
    fills: [{ type: 'SOLID', color: HEX(fillHex), opacity: 1 }],
  }
}

function frameChild(name: string): any {
  return {
    id: `n:${name}`,
    name,
    type: 'FRAME',
    visible: true,
    fills: [{ type: 'SOLID', color: HEX('#222222'), opacity: 0.5 }],
  }
}

function noFillChild(name: string): any {
  return { id: `n:${name}`, name, type: 'RECTANGLE', visible: true, fills: [] }
}

/** 带 `findOne` / `resize` 的实例桩（字段名对齐 MasterGo 运行时 INSTANCE） */
function instanceStub(id: string, children: any[], mainComponent: any = null): any {
  const instance: any = {
    id,
    name: 'Button',
    type: 'INSTANCE',
    isVisible: true,
    isLocked: false,
    removed: false,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    fills: [],
    strokes: [],
    mainComponent,
    children,
    findOne(pred: (n: any) => boolean) {
      return this.children.find(pred) || null
    },
    resize(width: number, height: number) {
      this.width = width
      this.height = height
    },
  }
  if (instance.mainComponent && typeof instance.swapComponent !== 'function') {
    instance.swapComponent = function (component: any) {
      this.mainComponent = component
      this.children = childrenForMaster(component)
    }
  }
  return instance
}

/** 模拟"换主组件后实例子树变成新母版的图层结构" */
function childrenForMaster(component: any): any[] {
  return (component.layers || [{ name: 'Label', type: 'TEXT' }]).map((spec: any) =>
    spec.type === 'TEXT'
      ? textNode(spec.name, 'New master text')
      : noFillChild(spec.name),
  )
}

/** 组件桩：`createInstance()` 每次返回新实例（子图层来自 component.layers） */
function componentStub(id: string, name: string, layers?: any[]): any {
  const component: any = {
    id,
    name,
    type: 'COMPONENT',
    isExternal: false,
    layers,
    createInstance() {
      return instanceStub(`inst:${Math.random().toString(36).slice(2)}`, childrenForMaster(component), component)
    },
  }
  return component
}

/* ------------------------------------------------------- 1. 颜色值校验（纯函数） */

describe('normalizeHexColor — 只接受 #RGB / #RRGGBB', () => {
  it('#abc 归一化为 #aabbcc', () => {
    expect(normalizeHexColor('#abc')).toBe('#aabbcc')
  })

  it('#RRGGBB 保留数值、大写降到小写', () => {
    expect(normalizeHexColor('#AABBCC')).toBe('#aabbcc')
    expect(normalizeHexColor('#123456')).toBe('#123456')
  })

  it('前后空白被容忍', () => {
    expect(normalizeHexColor('  #FFF  ')).toBe('#ffffff')
  })

  it('其它形式一律返回 null（不猜颜色）', () => {
    for (const bad of [
      'rgba(255, 0, 102, 0.5)',
      'rgb(255,0,102)',
      'red',
      'transparent',
      '',
      '#abcd',
      '#12345',
      '#12345678',
      'ff0066',
      'linear-gradient(#fff, #000)',
    ]) {
      expect(normalizeHexColor(bad), `应拒绝: ${JSON.stringify(bad)}`).toBeNull()
    }
  })

  it('非字符串返回 null（不抛错）', () => {
    for (const bad of [null, undefined, 42, true, {}, ['#fff']]) {
      expect(normalizeHexColor(bad)).toBeNull()
    }
  })
})

/* ---------------------------------------- 2. applyInstanceOverrides（共享应用函数） */

describe('applyInstanceOverrides — 应用与降级上报', () => {
  it('text / fill(归一化) / visible 都写进命中的子图层', () => {
    const label = textNode('Label')
    const badge = textNode('Badge')
    const instance = instanceStub('1:1', [label, badge])

    const skips = applyInstanceOverrides(instance, {
      Label: { text: '提交', fill: '#abc' },
      Badge: { visible: 'false' },
    })

    expect(skips).toEqual([])
    expect(label.characters).toBe('提交')
    expect(label.fills[0].color).toEqual(HEX('#aabbcc'))
    // 覆写只改颜色：原有填充的其它字段保留
    expect(label.fills[0].opacity).toBe(1)
    expect(label.fills[0].type).toBe('SOLID')
    expect(badge.visible).toBe(false)
  })

  it('fill 非法值：不写 + 留痕（invalid-fill），原填充保持不变', () => {
    const label = textNode('Label')
    const instance = instanceStub('1:1', [label])
    const before = JSON.stringify(label.fills)

    const skips = applyInstanceOverrides(instance, { Label: { fill: 'rgba(0,0,0,0.5)' } })

    expect(JSON.stringify(label.fills)).toBe(before)
    expect(skips).toHaveLength(1)
    expect(skips[0]).toMatchObject({ childName: 'Label', prop: 'fill', reason: 'invalid-fill' })
    expect(skips[0].message).toContain('不是 #RGB / #RRGGBB')
  })

  it('目标无填充：不写 + 留痕（no-fill）', () => {
    const rect = noFillChild('Bg')
    const instance = instanceStub('1:1', [rect])

    const skips = applyInstanceOverrides(instance, { Bg: { fill: '#ff0066' } })

    expect(rect.fills).toEqual([])
    expect(skips).toHaveLength(1)
    expect(skips[0]).toMatchObject({ childName: 'Bg', prop: 'fill', reason: 'no-fill' })
  })

  it('找不到 childName：留痕一次（不逐属性刷屏）', () => {
    const instance = instanceStub('1:1', [])

    const skips = applyInstanceOverrides(instance, {
      Missing: { text: 'x', fill: '#fff', visible: 'false' },
    })

    expect(skips).toHaveLength(1)
    expect(skips[0]).toMatchObject({ childName: 'Missing', reason: 'target-not-found' })
  })

  it('text 落到非 TEXT：留痕（not-text）且不写', () => {
    const box = frameChild('Box')
    const instance = instanceStub('1:1', [box])

    const skips = applyInstanceOverrides(instance, { Box: { text: 'nope' } })

    expect(skips).toHaveLength(1)
    expect(skips[0]).toMatchObject({ childName: 'Box', prop: 'text', reason: 'not-text' })
    expect((box as any).characters).toBeUndefined()
  })

  it('未知 prop：留痕（unknown-prop）', () => {
    const label = textNode('Label')
    const instance = instanceStub('1:1', [label])

    const skips = applyInstanceOverrides(instance, { Label: { color: '#fff' } })

    expect(skips).toHaveLength(1)
    expect(skips[0]).toMatchObject({ childName: 'Label', prop: 'color', reason: 'unknown-prop' })
  })

  it('visible 按字符串解析（仅 "true" 为真，大小写/空白容忍）', () => {
    const a = textNode('A')
    const b = textNode('B')
    const c = textNode('C')
    const instance = instanceStub('1:1', [a, b, c])

    applyInstanceOverrides(instance, {
      A: { visible: 'false' },
      B: { visible: 'true' },
      C: { visible: ' YES ' },
    })

    expect(a.visible).toBe(false)
    expect(b.visible).toBe(true)
    expect(c.visible).toBe(false)
  })

  it('onSkip 回调逐条触发（便于就地接报告通道）', () => {
    const instance = instanceStub('1:1', [noFillChild('Bg')])
    const seen: string[] = []

    applyInstanceOverrides(instance, { Bg: { fill: 'red' } }, (skip) => seen.push(skip.reason))

    expect(seen).toEqual(['invalid-fill'])
  })

  it('无 overrides / overrides 不是对象时安全返回空（不抛错）', () => {
    const instance = instanceStub('1:1', [])
    expect(applyInstanceOverrides(instance, undefined)).toEqual([])
    expect(applyInstanceOverrides(instance, null)).toEqual([])
    expect(applyInstanceOverrides(instance, 'nope' as any)).toEqual([])
  })
})

/* ------------------------------------- 3. DSL 实例渲染路径：消费 + 收集到渲染报告 */

describe('DSLRenderer.renderDSL — 实例覆写消费与上报', () => {
  function renderOneInstance(overrides: Record<string, Record<string, string>>, children: any[]) {
    const component = componentStub('c1', 'Button')
    const created: any[] = []
    component.createInstance = () => {
      const instance = instanceStub('inst:1', children, component)
      created.push(instance)
      return instance
    }
    const stub = installMgStub({ nodes: { c1: component } })

    return DSLRenderer.renderDSL({
      version: '1',
      elements: [
        {
          type: 'instance',
          name: 'Btn',
          componentId: 'c1',
          size: { width: 100, height: 40 },
          overrides,
        } as any,
      ],
    }).then(() => ({ created, stub }))
  }

  it('#abc 归一化后写入（不再是 NaN 颜色）', async () => {
    const label = textNode('Label')
    const { created } = await renderOneInstance({ Label: { fill: '#abc' } }, [label])

    expect(created[0].children[0].fills[0].color.r).toBeCloseTo(0xaa / 255, 6)
    expect(created[0].children[0].fills[0].color.g).toBeCloseTo(0xbb / 255, 6)
    expect(created[0].children[0].fills[0].color.b).toBeCloseTo(0xcc / 255, 6)
    expect(DSLRenderer.takeRenderIssues()).toEqual([])
  })

  it('rgba(...) 被拒且进渲染报告（不再静默 NaN）', async () => {
    const label = textNode('Label')
    const { created } = await renderOneInstance({ Label: { fill: 'rgba(1,2,3,0.4)' } }, [label])

    expect(created[0].children[0].fills[0].color).toEqual(HEX('#111111'))
    const issues = DSLRenderer.takeRenderIssues()
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('不是 #RGB / #RRGGBB')
  })

  it('找不到 childName / 目标无填充 / 非 TEXT 都进渲染报告', async () => {
    await renderOneInstance(
      {
        Missing: { text: 'x' },
        Bg: { fill: '#fff' },
        Box: { text: 'x' },
      },
      [noFillChild('Bg'), frameChild('Box')],
    )

    const issues = DSLRenderer.takeRenderIssues()
    expect(issues).toHaveLength(3)
    expect(issues.join('\n')).toContain('"Missing" 未找到')
    expect(issues.join('\n')).toContain('没有填充')
    expect(issues.join('\n')).toContain('而非 TEXT')
  })

  it('takeRenderIssues 取走后清空（不跨次渲染累积）', async () => {
    await renderOneInstance({ Missing: { text: 'x' } }, [])
    expect(DSLRenderer.takeRenderIssues()).toHaveLength(1)
    expect(DSLRenderer.takeRenderIssues()).toEqual([])
  })

  it('text / visible 正常写入', async () => {
    const label = textNode('Label')
    const { created } = await renderOneInstance({ Label: { text: 'Hello' } }, [label])
    expect(created[0].children[0].characters).toBe('Hello')
  })
})

/* ------------------------------------------- 4. 换组件路径：转发 + 显式覆写优先 */

describe('applyComponentSwap — 换主组件路径应用 overrides', () => {
  /** 实例节点（换主组件模式），swapComponent 后子树变成新母版结构 */
  function setupSwap(overrides?: Record<string, Record<string, string>>) {
    const target = componentStub('c2', 'New Button', [{ name: 'Label', type: 'TEXT' }])
    const node = instanceStub('1:2', [textNode('Label', 'Old')], componentStub('c0', 'Old Button'))
    node.name = 'Target'
    installMgStub({ nodes: { '1:2': node, c2: target } })
    return applyComponentSwap({ nodeIds: ['1:2'], componentId: 'c2', overrides }).then((summary) => ({
      summary,
      node,
    }))
  }

  it('换完组件后显式 overrides 落到了新母版的同名图层上', async () => {
    const { summary, node } = await setupSwap({ Label: { text: '提交', fill: '#abc' } })

    expect(summary.swapped).toBe(1)
    expect(node.children[0].characters).toBe('提交')
    expect(node.children[0].fills[0].color).toEqual(HEX('#aabbcc'))
    expect(summary.results[0].overrideSkips).toBeUndefined()
    expect(summary.warnings || []).toEqual([])
  })

  it('非法 fill 在换组件路径同样被拒且进 warnings / overrideSkips', async () => {
    const { summary } = await setupSwap({ Label: { fill: 'red' } })

    expect(summary.results[0].overrideSkips?.[0]).toMatchObject({
      childName: 'Label',
      reason: 'invalid-fill',
    })
    expect((summary.warnings || []).join('\n')).toContain('显式覆写未生效')
  })

  it('主组件已相同也照样落显式覆写（不能被 already-same 跳过吞掉）', async () => {
    const target = componentStub('c2', 'New Button', [{ name: 'Label', type: 'TEXT' }])
    const node = instanceStub('1:2', [textNode('Label', 'Old')], target)
    installMgStub({ nodes: { '1:2': node, c2: target } })

    const summary = await applyComponentSwap({
      nodeIds: ['1:2'],
      componentId: 'c2',
      overrides: { Label: { text: '仍然要写' } },
    })

    expect(summary.skipped).toBe(0)
    expect(summary.swapped).toBe(1)
    expect(node.children[0].characters).toBe('仍然要写')
  })

  it('没有 overrides 时仍走 already-same 跳过（旧语义不变）', async () => {
    const target = componentStub('c2', 'New Button', [{ name: 'Label', type: 'TEXT' }])
    const node = instanceStub('1:2', [textNode('Label', 'Old')], target)
    installMgStub({ nodes: { '1:2': node, c2: target } })

    const summary = await applyComponentSwap({ nodeIds: ['1:2'], componentId: 'c2' })

    expect(summary.skipped).toBe(1)
    expect(summary.swapped).toBe(0)
  })
})

describe('applyComponentSwap — 原位替换路径：显式覆写优先于按图层名继承', () => {
  function setupReplace(overrides?: Record<string, Record<string, string>>) {
    const component = componentStub('c1', 'Card', [{ name: 'Label', type: 'TEXT' }])
    const original = frameChild('Orig')
    // 被替换的 frame 子树里有一个同名 TEXT：继承覆写会带过来 text='继承的文字'
    const inheritedText = textNode('Label', '继承的文字')
    original.children = [inheritedText]
    original.x = 10
    original.y = 20
    original.width = 120
    original.height = 60
    original.remove = function () {
      this.removed = true
    }

    const stub = installMgStub({ nodes: { '1:9': original, c1: component } })
    const page = stub.document.currentPage
    original.parent = page
    page.children.push(original)

    const created: any[] = []
    const origCreate = component.createInstance
    component.createInstance = () => {
      const inst = origCreate()
      created.push(inst)
      return inst
    }

    return applyComponentSwap({ nodeIds: ['1:9'], componentId: 'c1', overrides }).then((summary) => ({
      summary,
      created,
      original,
    }))
  }

  it('冲突时显式 overrides 覆盖继承来的值（调用方明确写了）', async () => {
    const { summary, created } = await setupReplace({ Label: { text: '显式文字' } })

    expect(summary.replaced).toBe(1)
    expect(created[0].children[0].characters).toBe('显式文字')
    expect(created[0].children[0].characters).not.toBe('继承的文字')
    // 继承确实发生过（便于排查），但被显式值覆盖
    expect(summary.results[0].carriedOverrides?.join(',')).toContain('Label:text')
  })

  it('不冲突的属性互补：继承 fill + 显式 text 都生效', async () => {
    const { created } = await setupReplace({ Label: { fill: '#abc' } })

    expect(created[0].children[0].characters).toBe('继承的文字')
    expect(created[0].children[0].fills[0].color).toEqual(HEX('#aabbcc'))
  })

  it('显式覆写目标不存在：进 warnings / overrideSkips（不静默）', async () => {
    const { summary } = await setupReplace({ Ghost: { text: 'x' } })

    expect(summary.results[0].overrideSkips?.[0]).toMatchObject({
      childName: 'Ghost',
      reason: 'target-not-found',
    })
    expect((summary.warnings || []).join('\n')).toContain('显式覆写未生效')
  })
})

/* ------------------------------------------- 5. handleRenderDSL：渲染报告通道 */

describe('handleRenderDSL — renderIssues 随响应回报', () => {
  it('覆写降级出现在返回体 renderIssues，并 notify 一次汇总', async () => {
    const label = textNode('Label')
    const component = componentStub('c1', 'Button')
    component.createInstance = () => instanceStub('inst:1', [label], component)
    const stub = installMgStub({ nodes: { c1: component } })

    const result: any = await handleRenderDSL(
      {
        dsl: {
          version: '1',
          elements: [
            {
              type: 'instance',
              name: 'Btn',
              componentId: 'c1',
              overrides: { Label: { fill: 'rgba(0,0,0,.5)' }, Missing: { text: 'x' } },
            },
          ],
        },
        focus: false,
      },
      {} as any,
    )

    expect(result.success).toBe(true)
    expect(result.renderIssues).toHaveLength(2)
    expect(result.renderIssues.join('\n')).toContain('不是 #RGB / #RRGGBB')
    expect(result.renderIssues.join('\n')).toContain('"Missing" 未找到')

    const warnings = stub.notifications.filter((n) => n.includes('覆写/换组件未生效'))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('2 项')
  })

  it('无降级时不写 renderIssues 也不 notify', async () => {
    const component = componentStub('c1', 'Button')
    component.createInstance = () => instanceStub('inst:1', [textNode('Label')], component)
    const stub = installMgStub({ nodes: { c1: component } })

    const result: any = await handleRenderDSL(
      {
        dsl: {
          version: '1',
          elements: [
            { type: 'instance', name: 'Btn', componentId: 'c1', overrides: { Label: { text: 'ok' } } },
          ],
        },
        focus: false,
      },
      {} as any,
    )

    expect('renderIssues' in result).toBe(false)
    expect(stub.notifications.filter((n) => n.includes('未生效'))).toEqual([])
  })
})
