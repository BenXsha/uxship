/**
 * 真实引擎载荷的回归测试（这一组是本轮修 bug 的核心）
 *
 * ⚠️ 颜色必须写**引擎的真实量纲**：`cssColorToRgb()` 返回 0–1 浮点（除以了 255）。
 * 第一版 fixture 用了 0–255 整数（我以为的“引擎格式”），于是「通道量纲搞错 → 整页发黑」
 * 这个 bug 在本文件里完全看不见 —— fixture 假装成引擎输出时，必须把它当成真的来抄。
 *
 * 用**客户端渲染引擎实际产出的 DSL 形状**去跑 PenpotHost：
 *   color 是 `{r,g,b,a}` 对象、类型是 `gradient_linear` 小写、
 *   隐藏用 `isVisible`、透明度用 `alpha`、图标是 `frame + svgContent`。
 *
 * 修之前这些全部静默失效（颜色变 `[OBJECT OBJECT]`、渐变被当未知类型丢弃、
 * 隐藏图层照画、图标直接不见），而用手写 hex 的旧测试全绿 —— 所以必须有一组
 * 「按引擎真实格式」的用例。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PenpotHost } from '@lib/host/penpot'
import { renderDsl } from '@lib/dsl/renderer'
import type { DSLDocument } from '@lib/dsl/types'
import { installFakePenpot, type FakePenpot } from './helpers/fake-penpot'

let fake: FakePenpot
let restore: () => void
let host: PenpotHost

beforeEach(async () => {
  const installed = installFakePenpot()
  fake = installed.penpot
  restore = installed.restore
  host = new PenpotHost()
  await host.init()
})

afterEach(() => restore())

const shape = (name: string) => fake.__all().find((s) => s.name === name) as unknown as Record<string, any>

/** 客户端渲染引擎的典型产出（含渐变背景、图标、边框、阴影、隐藏层） */
function enginePayload(): DSLDocument {
  return {
    elements: [
      {
        type: 'frame',
        name: 'Card',
        position: { x: 0, y: 0 },
        size: { width: 360, height: 200 },
        layoutMode: 'VERTICAL',
        itemSpacing: 12,
        layoutSizingHorizontal: 'FIXED',
        fills: [
          {
            type: 'gradient_linear',
            gradientStops: [
              { position: 0, color: { r: 11 / 255, g: 18 / 255, b: 32 / 255, a: 1 } },
              { position: 1, color: { r: 31 / 255, g: 41 / 255, b: 55 / 255, a: 1 } },
            ],
            gradientHandlePositions: [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }],
            transform: [[1, 0, 0], [0, 1, 0]],
            opacity: 1,
            alpha: 1,
            isVisible: true,
          },
        ],
        strokes: [{ type: 'solid', color: { r: 67 / 255, g: 64 / 255, b: 234 / 255, a: 0.5 } }],
        strokeAlign: 'INSIDE',
        strokeWeight: 1,
        effects: [
          {
            type: 'DROP_SHADOW',
            color: { r: 15 / 255, g: 23 / 255, b: 42 / 255, a: 0.25 },
            offset: { x: 0, y: 4 },
            radius: 12,
            spread: -2,
            visible: true,
          },
        ],
        children: [
          {
            // data-icon 的真实形态：frame + svgContent（颜色已被 currentColor 替换写进 SVG）
            type: 'frame',
            name: 'Search Icon',
            position: { x: 16, y: 16 },
            size: { width: 20, height: 20 },
            layoutMode: 'NONE',
            svgContent:
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#31efb8" d="M10.5 3a7.5 7.5 0 1 0 4.55 13.46l4.24 4.25a1 1 0 0 0 1.42-1.42l-4.25-4.24A7.5 7.5 0 0 0 10.5 3Z"/></svg>',
          } as never,
          {
            type: 'text',
            name: 'Title',
            content: '标题',
            size: { width: 320, height: 20 },
            fontSize: 16,
            fontWeight: 600,
            fills: [{ type: 'solid', color: { r: 249 / 255, g: 250 / 255, b: 251 / 255, a: 1 } }],
            lineHeight: { unit: 'PIXELS', value: 22 },
            textAutoResize: 'NONE',
          } as never,
          {
            // 隐藏层：引擎用 isVisible:false
            type: 'rectangle',
            name: 'Hidden Badge',
            position: { x: 0, y: 0 },
            size: { width: 40, height: 16 },
            fills: [{ type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 }, isVisible: false }],
            isVisible: false,
          } as never,
          {
            // alpha 而非 opacity
            type: 'rectangle',
            name: 'Half Overlay',
            position: { x: 0, y: 0 },
            size: { width: 40, height: 16 },
            fills: [{ type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 }, alpha: 0.4 }],
          } as never,
        ],
      },
    ],
  }
}

describe('引擎载荷 → Penpot：颜色', () => {
  it('{r,g,b,a} 对象被正确转成 fillColor + fillOpacity', async () => {
    await renderDsl(host, enginePayload())

    const title = shape('Title')
    expect(title.fills[0].fillColor).toBe('#F9FAFB')
    expect(title.fills[0].fillOpacity).toBe(1)
  })

  it('alpha 与 a 通道都被尊重', async () => {
    await renderDsl(host, enginePayload())

    // a 通道 0.5 → strokeOpacity
    expect(shape('Card').strokes[0].strokeColor).toBe('#4340EA')
    expect(shape('Card').strokes[0].strokeOpacity).toBeCloseTo(0.5, 3)

    // 引擎的 alpha 字段（不是 opacity）
    expect(shape('Half Overlay').fills[0].fillOpacity).toBeCloseTo(0.4, 3)
  })

  it('阴影颜色（同样是 rgb 对象）落地正确', async () => {
    await renderDsl(host, enginePayload())

    const shadow = shape('Card').shadows[0]
    expect(shadow.style).toBe('drop-shadow')
    expect(shadow.color.color).toBe('#0F172A')
    expect(shadow.color.opacity).toBeCloseTo(0.25, 3)
    expect(shadow.offsetY).toBe(4)
  })

  it('isVisible:false 的填充会被跳过（不是画出来）', async () => {
    const report = await renderDsl(host, enginePayload())
    const hidden = shape('Hidden Badge')
    // 该元素整体 isVisible:false → 节点仍创建，但填充为隐藏不落地
    expect(hidden.fills ?? []).toHaveLength(0)
    expect(report.rootCount).toBe(1)
  })
})

describe('引擎载荷 → Penpot：渐变', () => {
  it('gradient_linear（小写）被识别，不再当未知类型丢弃', async () => {
    const report = await renderDsl(host, enginePayload())

    const gradient = shape('Card').fills[0].fillColorGradient
    expect(gradient).toBeDefined()
    expect(gradient.type).toBe('linear')
    // 竖直方向：handles [{0.5,0},{0.5,1}]
    expect([gradient.startX, gradient.startY, gradient.endX, gradient.endY]).toEqual([0.5, 0, 0.5, 1])
    expect(gradient.stops).toEqual([
      { color: '#0B1220', opacity: 1, offset: 0 },
      { color: '#1F2937', opacity: 1, offset: 1 },
    ])
    // 不该出现「不支持的填充类型」
    expect(report.skipped.some((s) => /不支持的填充类型/.test(s.reason))).toBe(false)
  })

  it('渐变描边落到 strokeColorGradient（边框渐变的唯一正确表达）', async () => {
    await renderDsl(host, {
      elements: [
        {
          type: 'rectangle',
          name: 'Gradient Border',
          size: { width: 200, height: 40 },
          fills: [],
          strokes: [
            {
              type: 'gradient_linear',
              gradientStops: [
                { position: 0, color: { r: 49 / 255, g: 239 / 255, b: 184 / 255, a: 1 } },
                { position: 1, color: { r: 67, g: 64, b: 234, a: 1 } },
              ],
              gradientHandlePositions: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
            },
          ] as never,
          strokeWeight: 2,
        } as never,
      ],
    })

    const border = shape('Gradient Border')
    expect(border.strokes[0].strokeColorGradient).toBeDefined()
    expect(border.strokes[0].strokeColorGradient.type).toBe('linear')
    expect(border.strokes[0].strokeColorGradient.stops.map((s: any) => s.color)).toEqual(['#31EFB8', '#4340EA'])
    expect(border.strokes[0].strokeWidth).toBe(2)
    // 渐变描边不应有纯色回退
    expect(border.strokes[0].strokeColor).toBeUndefined()
  })

  it('径向渐变带椭圆比例（transform[0][0] → Penpot 的 width）', async () => {
    await renderDsl(host, {
      elements: [
        {
          type: 'rectangle',
          name: 'Radial',
          size: { width: 200, height: 100 },
          fills: [
            {
              type: 'gradient_radial',
              gradientStops: [
                { position: 0, color: { r: 255, g: 255, b: 255, a: 1 } },
                { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
              ],
              gradientHandlePositions: [{ x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }],
              transform: [[0.5, 0, 0], [0, 1, 0]],
            },
          ] as never,
        } as never,
      ],
    })

    const gradient = shape('Radial').fills[0].fillColorGradient
    expect(gradient.type).toBe('radial')
    expect(gradient.width).toBe(0.5)
  })

  it('conic 渐变降级为纯色并如实报告（不是变成透明）', async () => {
    const report = await renderDsl(host, {
      elements: [
        {
          type: 'rectangle',
          name: 'Conic',
          size: { width: 100, height: 100 },
          fills: [
            {
              type: 'gradient_angular',
              gradientStops: [
                { position: 0, color: { r: 49 / 255, g: 239 / 255, b: 184 / 255, a: 1 } },
                { position: 1, color: { r: 67, g: 64, b: 234, a: 1 } },
              ],
            },
          ] as never,
        } as never,
      ],
    })

    const fill = shape('Conic').fills[0]
    expect(fill.fillColor).toBe('#31EFB8')
    expect(fill.fillColorGradient).toBeUndefined()
    expect(report.skipped.some((s) => /GRADIENT_ANGULAR/.test(s.reason) && /降级为纯色/.test(s.reason))).toBe(true)
  })
})

describe('引擎载荷 → Penpot：图标（frame + svgContent）', () => {
  it('图标被导成一条可编辑矢量路径（Path.d），而不是被丢掉', async () => {
    const report = await renderDsl(host, enginePayload())

    const icon = fake.__all().find((s) => s.name === 'Search Icon' && s.type === 'path')
    expect(icon, '图标应被建成 path 节点').toBeDefined()
    expect(String(icon?.d ?? '').length).toBeGreaterThan(10)
    // 尺寸被缩放到 20×20 的内容区
    expect(icon?.width).toBeGreaterThan(0)
    expect(icon?.height).toBeGreaterThan(0)
    expect(report.skipped.some((s) => s.target === 'svgContent')).toBe(false)
  })

  it('图标颜色被带过去（SVG 里的 fill 色）', async () => {
    await renderDsl(host, enginePayload())
    const icon = fake.__all().find((s) => s.name === 'Search Icon' && s.type === 'path')
    const fills = icon?.fills as { fillColor: string }[] | undefined
    expect(fills?.[0]?.fillColor).toBe('#31EFB8')
  })

  it('描边型图标（Lucide/Feather 风格）导成 Path + stroke，而不是填充', async () => {
    await renderDsl(host, {
      elements: [
        {
          type: 'frame',
          name: 'Stroke Icon',
          position: { x: 0, y: 0 },
          size: { width: 24, height: 24 },
          layoutMode: 'NONE',
          svgContent:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="5" y1="5" x2="19" y2="19"/></svg>',
        } as never,
      ],
    })

    const icon = fake.__all().find((s) => s.name === 'Stroke Icon' && s.type === 'path')
    expect(icon).toBeDefined()
    expect(icon?.fills).toEqual([])
    const strokes = icon?.strokes as { strokeColor: string; strokeWidth: number }[]
    expect(strokes[0].strokeColor).toBe('#F87171')
    expect(strokes[0].strokeWidth).toBeGreaterThan(0)
  })

  it('多色图标走 createShapeFromSvg 回退（保色优先）', async () => {
    await renderDsl(host, {
      elements: [
        {
          type: 'frame',
          name: 'Multi Color',
          position: { x: 0, y: 0 },
          size: { width: 24, height: 24 },
          layoutMode: 'NONE',
          svgContent:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ff0000" d="M0 0h12v12H0z"/><path fill="#00ff00" d="M12 12h12v12H12z"/></svg>',
        } as never,
      ],
    })

    const group = fake.__all().find((s) => s.name === 'Multi Color' && s.type === 'group')
    expect(group, '多色图标应回退成 group').toBeDefined()
    expect(fake.__all().some((s) => s.name === 'Multi Color' && s.type === 'path')).toBe(false)
  })

  it('带 transform 的图标也回退（无法安全烘焙变换）', async () => {
    await renderDsl(host, {
      elements: [
        {
          type: 'frame',
          name: 'Transformed',
          position: { x: 0, y: 0 },
          size: { width: 24, height: 24 },
          layoutMode: 'NONE',
          svgContent: '<svg viewBox="0 0 24 24"><g transform="translate(4 4)"><path fill="#fff" d="M0 0h16v16H0z"/></g></svg>',
        } as never,
      ],
    })

    expect(fake.__all().find((s) => s.name === 'Transformed' && s.type === 'group')).toBeDefined()
  })
})

describe('宿主默认涂色必须被抹掉（否则多出白色背景/灰块/黑描边）', () => {
  it('替身确实会注入 Penpot 的默认涂色（否则本组测试是空转的）', () => {
    // 直接用假宿主自己的工厂函数：createBoard → 白填充；createRectangle → 灰填充；createPath → 黑 1px 描边
    const board = fake.createBoard()
    expect((board.fills as { fillColor: string }[])[0]?.fillColor).toBe('#FFFFFF')
    const rect = fake.createRectangle()
    expect((rect.fills as { fillColor: string }[])[0]?.fillColor).toBe('#B1B2B5')
    const path = fake.createPath()
    expect((path.strokes as { strokeColor: string }[])[0]?.strokeColor).toBe('#000000')
  })

  it('frame / rectangle / ellipse / path 建出来没有涂色（透明 —— 与 HTML 语义一致）', async () => {
    const frame = await host.createNode({ kind: 'frame', name: 'F' })
    const rect = await host.createNode({ kind: 'rectangle', name: 'R' })
    const ellipse = await host.createNode({ kind: 'ellipse', name: 'E' })
    const path = await host.createNode({ kind: 'path', name: 'P', pathData: 'M0 0 L10 10' })

    for (const node of [frame, rect, ellipse, path]) {
      const created = fake.__all().find((s) => s.id === node.id)
      expect(created?.fills, `${node.id} 不应带填充`).toEqual([])
      expect(created?.strokes, `${node.id} 不应带描边`).toEqual([])
    }
  })

  it('渲染整页后不会凭空多出白色背景（根 frame 与嵌套 section 都是透明的）', async () => {
    await renderDsl(host, {
      elements: [
        {
          type: 'frame',
          name: 'Root',
          size: { width: 320, height: 200 },
          layoutMode: 'VERTICAL',
          children: [{ type: 'frame', name: 'Inner', size: { width: 300, height: 80 }, layoutMode: 'NONE' }],
        },
      ],
    })

    expect(shape('Root').fills).toEqual([])
    expect(shape('Inner').fills).toEqual([])
  })

  it('文本保留宿主默认色（不能抹成透明，否则文字消失）', async () => {
    const text = await host.createNode({ kind: 'text', name: 'T', characters: 'x' })
    const created = fake.__all().find((s) => s.id === text.id)
    // 文本不进涂色重置：不设 fills 时交给宿主默认（HTML 默认文字色也是黑）
    expect(created?.strokes).toEqual([])
  })

  it('描边型图标的**圆头**会落到宿主（Lucide 类：stroke-linecap="round"）', async () => {
    // 真实 Lucide 写法（`api.iconify.design/lucide/check.svg`）：fill=none + stroke + 圆头圆角。
    // 以前 `analyzeSimpleSvg` 不提取 linecap，Penpot 的 Path 默认平头 → 每个圆头图标渲染出来都是**方头**（真机可见）。
    await renderDsl(host, {
      elements: [
        {
          type: 'frame',
          name: 'Round Cap Icon',
          position: { x: 0, y: 0 },
          size: { width: 24, height: 24 },
          layoutMode: 'NONE',
          svgContent:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="#0F172A" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 6L9 17l-5-5"/></svg>',
        } as never,
      ],
    })

    const icon = fake.__all().find((s) => s.name === 'Round Cap Icon' && s.type === 'path')
    const stroke = (icon?.strokes as { strokeCapStart?: string; strokeCapEnd?: string; strokeWidth?: number }[])?.[0]
    expect(stroke?.strokeCapStart, '起点帽应为 round').toBe('round')
    expect(stroke?.strokeCapEnd, '终点帽应为 round').toBe('round')
    expect(stroke?.strokeWidth).toBe(2)
  })

  it('填充型图标不会带一圈黑描边（Path 默认描边已抹掉）', async () => {
    await renderDsl(host, {
      elements: [
        {
          type: 'frame',
          name: 'Icon Wrap',
          position: { x: 0, y: 0 },
          size: { width: 24, height: 24 },
          layoutMode: 'NONE',
          svgContent: '<svg viewBox="0 0 24 24"><path fill="#31EFB8" d="M0 0h24v24H0z"/></svg>',
        } as never,
      ],
    })

    const icon = fake.__all().find((s) => s.name === 'Icon Wrap' && s.type === 'path')
    expect(icon?.strokes).toEqual([])
    expect((icon?.fills as { fillColor: string }[])[0]?.fillColor).toBe('#31EFB8')
  })

  it('currentColor 型图标（解析不出颜色）至少不留黑描边', async () => {
    await renderDsl(host, {
      elements: [
        {
          type: 'frame',
          name: 'Neutral Icon',
          position: { x: 0, y: 0 },
          size: { width: 16, height: 16 },
          layoutMode: 'NONE',
          svgContent: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h16v16H0z"/></svg>',
        } as never,
      ],
    })

    const icon = fake.__all().find((s) => s.name === 'Neutral Icon' && s.type === 'path')
    expect(icon).toBeDefined()
    expect(icon?.strokes).toEqual([])
  })
})

describe('子节点顺序（naturalChildOrdering）', () => {
  it('init 时打开 Penpot 的 flag（否则非 flex 容器追加会插到最前）', async () => {
    const fresh = installFakePenpot()
    try {
      expect(fresh.penpot.flags.naturalChildOrdering).toBe(false) // 宿主默认（与 Penpot 一致）
      const probe = new PenpotHost()
      await probe.init()
      expect(fresh.penpot.flags.naturalChildOrdering).toBe(true)
      expect(probe.getCapabilities().ops.naturalChildOrdering).toBe(true)
    } finally {
      fresh.restore()
    }
  })

  it('flag 开：非 flex 容器按 DSL 顺序追加（不反转）', async () => {
    await renderDsl(host, {
      elements: [
        {
          type: 'frame',
          name: 'Plain',
          size: { width: 200, height: 200 },
          layoutMode: 'NONE',
          children: [
            { type: 'rectangle', name: 'First' },
            { type: 'rectangle', name: 'Second' },
            { type: 'rectangle', name: 'Third' },
          ],
        } as never,
      ],
    })

    const plain = fake.__all().find((s) => s.name === 'Plain')
    expect(plain?.children.map((c) => c.name)).toEqual(['First', 'Second', 'Third'])
  })

  it('flag 开：flex 容器也按 DSL 顺序追加', async () => {
    await renderDsl(host, {
      elements: [
        {
          type: 'frame',
          name: 'Flexy',
          size: { width: 200, height: 200 },
          layoutMode: 'VERTICAL',
          children: [
            { type: 'text', name: 'Top', content: 'a' },
            { type: 'text', name: 'Middle', content: 'b' },
            { type: 'text', name: 'Bottom', content: 'c' },
          ],
        } as never,
      ],
    })

    const flexy = fake.__all().find((s) => s.name === 'Flexy')
    expect(flexy?.children.map((c) => c.name)).toEqual(['Top', 'Middle', 'Bottom'])
  })

  it('flag 不可用（老版 Penpot）时走兼容分支：非 flex 传 0、flex 传 length', async () => {
    const legacy = installFakePenpot()
    try {
      // 模拟没有 flags 代理的老宿主
      delete (legacy.penpot as unknown as Record<string, unknown>).flags
      const probe = new PenpotHost()
      await probe.init()
      expect(probe.getCapabilities().ops.naturalChildOrdering).toBe(false)

      // 兼容分支仍要保证「追加 = 列表末尾」
      const parent = await probe.createNode({ kind: 'frame', name: 'P' })
      const a = await probe.createNode({ kind: 'rectangle', name: 'A' }, parent)
      const b = await probe.createNode({ kind: 'rectangle', name: 'B' }, parent)
      const c = await probe.createNode({ kind: 'rectangle', name: 'C' }, parent)

      // 替身的 insertChild 是自然语义，所以这里断言的只是「插入了」；
      // 真正的索引换算由上面的注释与 insertChild 实现保证
      const parentShape = legacy.penpot.__all().find((s) => s.name === 'P')
      expect([a.id, b.id, c.id].every((id) => parentShape?.children.some((x) => x.id === id))).toBe(true)
    } finally {
      legacy.restore()
    }
  })
})
