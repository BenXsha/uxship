/**
 * PenpotHost 映射正确性测试
 *
 * 这些用例覆盖的都是「只在真实宿主上才会暴露」的差异（颜色透明度、shadows 结构、
 * flex 枚举、resize 打回 growType、单边描边降级、insertChild 顺序）。它们的价值在于：
 * 以后 Penpot 升级 API 时，这批用例是第一道防线。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PenpotHost, splitHexColor } from '@lib/host/penpot'
import { UnsupportedHostFeatureError } from '@lib/host/errors'
import type { HostNode, NodeProperties } from '@lib/host/types'
import { installFakePenpot, type FakePenpot } from './helpers/fake-penpot'

let fake: FakePenpot
let restore: () => void
let host: PenpotHost

beforeEach(async () => {
  const installed = installFakePenpot({ withWaitForLayoutUpdate: false })
  fake = installed.penpot
  restore = installed.restore
  host = new PenpotHost()
  await host.init()
})

afterEach(() => restore())

async function makeFrame(name = 'Frame', props: NodeProperties = {}): Promise<HostNode> {
  const node = await host.createNode({ kind: 'frame', name })
  if (Object.keys(props).length) await host.applyProperties(node, props)
  return node
}

describe('颜色/渐变的旧兼容入口（已废弃，新代码用 host/color.ts）', () => {
  it('splitHexColor 仍然可用，但不应该在新代码里出现', () => {
    expect(splitHexColor('#4340ea')).toEqual({ hex: '#4340EA', opacity: 1 })
    expect(splitHexColor('#0F172A80').opacity).toBeCloseTo(128 / 255, 4)
  })
})

describe('能力探测', () => {
  it('不做副作用探测（不创建任何节点）', async () => {
    const fresh = installFakePenpot()
    try {
      const probeHost = new PenpotHost()
      await probeHost.init()
      probeHost.getCapabilities()
      expect(fresh.penpot.__all()).toHaveLength(1) // 只有页面根
    } finally {
      fresh.restore()
    }
  })

  it('如实声明 Penpot 的能力缺口', () => {
    const caps = host.getCapabilities()
    expect(caps.host).toBe('penpot')
    // Penpot 的 Stroke 无 per-side —— 这是本项目在 MasterGo 侧有、Penpot 侧没有的能力
    expect(caps.props.perSideStrokes).toBe(false)
    // 令牌绑定是 Penpot 强于本项目现状的地方（applyToken）
    expect(caps.props.tokenBinding).toBe(true)
    expect(caps.props.autoLayout).toBe(true)
    expect(caps.props.imageFromUrl).toBe(true)
    expect(caps.ops.renderUiIframe).toBe(true)
    expect(caps.ops.componentVariants).toBe(true)
  })
})

describe('createNode', () => {
  it('用 insertChild 追加，保持创建顺序', async () => {
    await makeFrame('A')
    await makeFrame('B')
    await makeFrame('C')

    const names = fake.currentPage.root.children.map((child) => child.name)
    // 若误用 appendChild（替身实现为插到开头），这里会变成 C, B, A
    expect(names).toEqual(['A', 'B', 'C'])
  })

  it('文本默认高度自适应（而非 Penpot 默认的 fixed）', async () => {
    const text = await host.createNode({ kind: 'text', name: 'T', characters: '你好' })
    expect(host.readProperties(text, ['growType']).growType).toBe('auto-height')
  })

  it('svg 走 createShapeFromSvg，含 <image> 时走 WithImages 变体', async () => {
    const plain = await host.createNode({
      kind: 'svg',
      name: 'Icon',
      svgContent: '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>',
    })
    expect(host.readProperties(plain, ['name']).name).toBe('Icon')

    const withImage = await host.createNode({
      kind: 'svg',
      name: 'Photo',
      svgContent: '<svg viewBox="0 0 1 1"><image href="x.png"/></svg>',
    })
    expect(host.readProperties(withImage, ['name']).name).toBe('Photo')
  })

  it('对未实现的 kind 抛 UnsupportedHostFeatureError（不静默丢）', async () => {
    await expect(host.createNode({ kind: 'section', name: 'S' })).rejects.toBeInstanceOf(UnsupportedHostFeatureError)
    await expect(host.createNode({ kind: 'slice', name: 'S' })).rejects.toBeInstanceOf(UnsupportedHostFeatureError)
    await expect(host.createNode({ kind: 'connector', name: 'C' })).rejects.toBeInstanceOf(UnsupportedHostFeatureError)
  })

  it('polygon / star / line 用「生成 d + 原生 Path」落地（不需要绕过 API）', async () => {
    const poly = await host.createNode({ kind: 'polygon', name: 'Hex', width: 100, height: 100, pointCount: 6 })
    const star = await host.createNode({ kind: 'star', name: 'Star5', width: 100, height: 100, pointCount: 5, innerRadius: 0.4 })
    const line = await host.createNode({ kind: 'line', name: 'Seg', width: 80, height: 10 })

    expect(fake.__all().find((s) => s.name === 'Hex')?.type).toBe('path')
    // 正六边形：6 段 L + 闭合
    const hexD = String(fake.__all().find((s) => s.name === 'Hex')?.d ?? '')
    expect(hexD.split('L').length).toBe(6)
    expect(hexD.endsWith('Z')).toBe(true)
    // 星形：10 个顶点（5 外 + 5 内）→ 9 段 L
    expect(String(fake.__all().find((s) => s.name === 'Star5')?.d ?? '').split('L').length).toBe(10)
    expect(String(fake.__all().find((s) => s.name === 'Seg')?.d ?? '')).toBe('M 0 5 H 80')
    void poly
    void star
    void line
  })

  it('path/pen 需要 pathData（缺失时明确抛错，而不是建一条空路径）', async () => {
    await expect(host.createNode({ kind: 'path', name: 'P' })).rejects.toThrow(/pathData/)
    const node = await host.createNode({ kind: 'pen', name: 'Pen', pathData: 'M0 0 L10 10' })
    expect(String(fake.__all().find((s) => s.name === 'Pen')?.d ?? '')).toBe('M0 0 L10 10')
    void node
  })

  it('group 给出可执行的替代方案提示', async () => {
    await expect(host.createNode({ kind: 'group', name: 'G' })).rejects.toThrow(/host\.group\(nodes\)/)
  })
})

describe('applyProperties — 外观', () => {
  it('把 alpha 拆到 fillOpacity', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'R' })
    await host.applyProperties(rect, { fills: [{ type: 'SOLID', color: '#4340EA40' }] })

    const fills = fake.__all().find((s) => s.name === 'R')?.fills as { fillColor: string; fillOpacity: number }[]
    expect(fills[0].fillColor).toBe('#4340EA')
    expect(fills[0].fillOpacity).toBeCloseTo(64 / 255, 4)
  })

  it('渐变映射为 fillColorGradient，并把 stop 拆成 color + opacity', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'G' })
    await host.applyProperties(rect, {
      fills: [{ type: 'GRADIENT_LINEAR', gradientStops: [{ position: 0, color: '#00000080' }, { position: 1, color: '#FFFFFF' }] }],
    })

    const fills = fake.__all().find((s) => s.name === 'G')?.fills as {
      fillColorGradient: { type: string; stops: { color: string; opacity: number; offset: number }[] }
    }[]
    const gradient = fills[0].fillColorGradient
    expect(gradient.type).toBe('linear')
    expect(gradient.stops[0].color).toBe('#000000')
    expect(gradient.stops[0].opacity).toBeCloseTo(128 / 255, 4)
    expect(gradient.stops[1].offset).toBe(1)
  })

  it('不支持的角度渐变进 skipped 而不是变成黑块', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'AG' })
    const result = await host.applyProperties(rect, {
      fills: [{ type: 'GRADIENT_ANGULAR', gradientStops: [{ position: 0, color: '#FF0000' }] }],
    })
    expect(result.skipped.some((s) => s.property === 'fills')).toBe(true)
  })

  it('缺少 imageData 的图片填充进 skipped（Penpot 需要 ImageData）', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'IMG' })
    const result = await host.applyProperties(rect, {
      fills: [{ type: 'IMAGE', imageUrl: 'https://example.com/a.png' }],
    })
    expect(result.skipped.some((s) => s.property === 'fills' && /imageData/.test(s.reason))).toBe(true)
  })

  it('四边描边走原生 strokes（不创建叠加层）', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'SB4' })
    const result = await host.applyProperties(rect, { strokes: [{ color: '#000000', width: 1 }] })
    expect(result.applied).toContain('strokes')
    const created = fake.__all().filter((s) => s.name.startsWith('Border'))
    expect(created).toHaveLength(0)
    const strokes = fake.__all().find((s) => s.name === 'SB4')?.strokes as { strokeWidth: number }[]
    expect(strokes).toHaveLength(1)
  })

  it('阴影与两种模糊映射到 Penpot 的 shadows / blur / backgroundBlur 三个成员', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'FX' })
    await host.applyProperties(rect, {
      effects: [
        { type: 'DROP_SHADOW', offset: { x: 0, y: 4 }, radius: 12, spread: -2, color: '#0F172A80' },
        { type: 'INNER_SHADOW', offset: { x: 0, y: 1 }, radius: 2, color: '#00000040' },
        { type: 'LAYER_BLUR', radius: 4 },
        { type: 'BACKGROUND_BLUR', radius: 8 },
      ],
    })

    const shape = fake.__all().find((s) => s.name === 'FX')
    const shadows = shape?.shadows as { style: string; blur: number; color: { color: string; opacity: number } }[]
    expect(shadows).toHaveLength(2)
    expect(shadows[0].style).toBe('drop-shadow')
    expect(shadows[0].blur).toBe(12)
    expect(shadows[0].color.color).toBe('#0F172A')
    expect(shadows[1].style).toBe('inner-shadow')
    expect(shape?.blur).toEqual({ value: 4, hidden: false })
    expect(shape?.backgroundBlur).toEqual({ value: 8, hidden: false })
  })
})

describe('applyProperties — 自动布局', () => {
  it('layoutMode / itemSpacing / padding / 对齐映射到 FlexLayout', async () => {
    const frame = await makeFrame('L', {
      layoutMode: 'VERTICAL',
      itemSpacing: 16,
      paddingTop: 20,
      paddingRight: 12,
      paddingBottom: 20,
      paddingLeft: 12,
      primaryAxisAlignItems: 'SPACE_BETWEEN',
      counterAxisAlignItems: 'CENTER',
    })

    const flex = fake.__all().find((s) => s.name === 'L')?.flex as Record<string, unknown>
    expect(flex.dir).toBe('column')
    expect(flex.rowGap).toBe(16)
    expect(flex.columnGap).toBe(16)
    expect(flex.topPadding).toBe(20)
    expect(flex.leftPadding).toBe(12)
    expect(flex.justifyContent).toBe('space-between')
    expect(flex.alignItems).toBe('center')
    expect(host.readProperties(frame, ['layoutMode']).layoutMode).toBe('VERTICAL')
  })

  it('layoutMode NONE 会移除 flex（而不是残留上一轮布局）', async () => {
    const frame = await makeFrame('N', { layoutMode: 'HORIZONTAL' })
    expect(host.readProperties(frame, ['layoutMode']).layoutMode).toBe('HORIZONTAL')

    await host.applyProperties(frame, { layoutMode: 'NONE' })
    expect(host.readProperties(frame, ['layoutMode']).layoutMode).toBe('NONE')
  })

  it('子元素尺寸语义映射到 layoutChild（FILL → fill）', async () => {
    const board = fake.__all().find((s) => s.name === 'Parent') ?? (await makeFrame('Parent', { layoutMode: 'VERTICAL' }))
    const child = await host.createNode({ kind: 'rectangle', name: 'Child' }, board)
    // 模拟宿主：子节点在布局内才带 layoutChild
    const childShape = fake.__all().find((s) => s.name === 'Child')
    if (childShape) childShape.layoutChild = { horizontalSizing: 'fix', verticalSizing: 'fix' }

    const result = await host.applyProperties(child, { layoutSizingHorizontal: 'FILL' })
    expect(result.applied).toContain('layoutSizingHorizontal')
    expect(childShape?.layoutChild?.horizontalSizing).toBe('fill')
  })

  it('不在布局内的子元素设置 sizing 时如实跳过', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'Loose' })
    const result = await host.applyProperties(rect, { layoutSizingHorizontal: 'FILL' })
    expect(result.skipped.some((s) => s.property === 'layoutSizingHorizontal')).toBe(true)
  })
})

describe('applyProperties — 属性应用顺序（关键正确性约束）', () => {
  it('几何先于文本自适应，避免 resize 把 growType 打回 fixed', async () => {
    const text = await host.createNode({ kind: 'text', name: 'T', characters: '内容' })

    // 故意把 textAutoResize 放在 width 之前传入 —— 应用顺序应由 PROPERTY_PHASES 决定，
    // 而不是对象键顺序
    await host.applyProperties(text, { textAutoResize: 'HEIGHT', width: 320 } as NodeProperties)

    const growType = host.readProperties(text, ['growType']).growType
    expect(growType).toBe('auto-height')
  })

  it('WIDTH_AND_HEIGHT（不换行、容器随文本扩展）映射为 auto-width，而非 auto-height', async () => {
    // 真机缺陷：两者曾合并成 auto-height（固定宽 + 自动高），宿主字体比浏览器测得宽几 px 时，
    // 「短标签」被硬折成两行（Hero Tag Text：引擎 106×18 → 画布 113×36）。
    const text = await host.createNode({ kind: 'text', name: 'Tag', characters: '本地优先 · 不出内网' })
    await host.applyProperties(text, {
      textAutoResize: 'WIDTH_AND_HEIGHT',
      width: 106,
      height: 18,
    } as NodeProperties)

    expect(host.readProperties(text, ['growType']).growType).toBe('auto-width')
  })

  it('非文本节点上的文本属性进 skipped', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'R' })
    const result = await host.applyProperties(rect, { characters: '不该出现在矩形上' })
    expect(result.skipped.some((s) => s.property === 'characters')).toBe(true)
  })
})

describe('applyProperties — 文本', () => {
  it('字号 / 行高（px 换算成倍数）/ 对齐 / 字体变体', async () => {
    const text = await host.createNode({ kind: 'text', name: 'T', characters: '标题' })
    const result = await host.applyProperties(text, {
      fontSize: 16,
      lineHeight: { unit: 'PIXELS', value: 24 },
      letterSpacing: { unit: 'PIXELS', value: 0.5 },
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'CENTER',
      fontName: { family: 'Inter', style: 'SemiBold' },
      fontWeight: 600,
    })

    const shape = fake.__all().find((s) => s.name === 'T')
    expect(shape?.fontSize).toBe('16')
    // 24 / 16 = 1.5（Penpot 的行高是相对倍数）
    expect(shape?.lineHeight).toBe('1.5')
    expect(shape?.letterSpacing).toBe('0.5')
    expect(shape?.align).toBe('center')
    expect(shape?.verticalAlign).toBe('center')
    expect(shape?.fontFamily).toBe('Inter')
    expect(shape?.fontWeight).toBe('600')
    expect(result.skipped).toHaveLength(0)
  })

  it('字体不可用时如实报告，而不是静默用回退字体', async () => {
    const text = await host.createNode({ kind: 'text', name: 'T', characters: 'x' })
    const result = await host.applyProperties(text, { fontName: { family: 'NoSuchFont' } })
    expect(result.skipped.some((s) => /字体不可用/.test(s.reason))).toBe(true)
  })

  it('lineHeight AUTO 不支持时进 skipped', async () => {
    const text = await host.createNode({ kind: 'text', name: 'T', characters: 'x' })
    const result = await host.applyProperties(text, { lineHeight: { unit: 'AUTO', value: 0 } })
    expect(result.skipped.some((s) => s.property === 'lineHeight')).toBe(true)
  })
})

describe('applyProperties — 客户端渲染引擎产出的字段（P3）', () => {
  it('分角圆角映射到 Penpot 的 borderRadiusXxx 四成员', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'R' })
    const result = await host.applyProperties(rect, {
      topLeftRadius: 12,
      topRightRadius: 4,
      bottomLeftRadius: 0,
      bottomRightRadius: 8,
    })

    const shape = fake.__all().find((s) => s.name === 'R') as unknown as Record<string, number>
    expect(shape.borderRadiusTopLeft).toBe(12)
    expect(shape.borderRadiusTopRight).toBe(4)
    expect(shape.borderRadiusBottomLeft).toBe(0)
    expect(shape.borderRadiusBottomRight).toBe(8)
    expect(result.skipped).toHaveLength(0)
  })

  it('layoutSizing 接受 AUTO（客户端渲染引擎的写法，与 HUG 同义）', async () => {
    const board = await makeFrame('P', { layoutMode: 'VERTICAL' })
    const child = await host.createNode({ kind: 'rectangle', name: 'C' }, board)
    const childShape = fake.__all().find((s) => s.name === 'C')
    if (childShape) childShape.layoutChild = { horizontalSizing: 'fix', verticalSizing: 'fix' }

    const result = await host.applyProperties(child, { layoutSizingHorizontal: 'AUTO', layoutSizingVertical: 'FILL' })
    expect(result.applied).toEqual(expect.arrayContaining(['layoutSizingHorizontal', 'layoutSizingVertical']))
    expect(childShape?.layoutChild?.horizontalSizing).toBe('auto')
    expect(childShape?.layoutChild?.verticalSizing).toBe('fill')
  })

  it('layoutPositioning=ABSOLUTE 映射到 layoutChild.absolute（脱离布局流）', async () => {
    const board = await makeFrame('P2', { layoutMode: 'VERTICAL' })
    const child = await host.createNode({ kind: 'rectangle', name: 'Abs' }, board)
    const childShape = fake.__all().find((s) => s.name === 'Abs')
    if (childShape) childShape.layoutChild = { absolute: false, horizontalSizing: 'fix', verticalSizing: 'fix' }

    await host.applyProperties(child, { layoutPositioning: 'ABSOLUTE' })
    expect(childShape?.layoutChild?.absolute).toBe(true)

    await host.applyProperties(child, { layoutPositioning: 'AUTO' })
    expect(childShape?.layoutChild?.absolute).toBe(false)
  })

  it('主轴/交叉轴尺寸模式按 dir 换算（row 下主轴 = horizontal）', async () => {
    const row = await makeFrame('Row', { layoutMode: 'HORIZONTAL' })
    await host.applyProperties(row, { primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'FIXED' })
    const rowFlex = fake.__all().find((s) => s.name === 'Row')?.flex as Record<string, string>
    expect(rowFlex.horizontalSizing).toBe('auto')
    expect(rowFlex.verticalSizing).toBe('fix')

    const column = await makeFrame('Col', { layoutMode: 'VERTICAL' })
    await host.applyProperties(column, { primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'FIXED' })
    const colFlex = fake.__all().find((s) => s.name === 'Col')?.flex as Record<string, string>
    // 方向翻转后主轴应落在 vertical —— 若写死 horizontal 就会错
    expect(colFlex.verticalSizing).toBe('auto')
    expect(colFlex.horizontalSizing).toBe('fix')
  })

  it('flexWrap 映射到 wrap / nowrap', async () => {
    const board = await makeFrame('W', { layoutMode: 'HORIZONTAL' })
    await host.applyProperties(board, { flexWrap: 'WRAP' })
    expect((fake.__all().find((s) => s.name === 'W')?.flex as Record<string, unknown>)?.wrap).toBe('wrap')
  })

  it('混合模式 SCREAMING_SNAKE → Penpot 的 kebab-case', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'B' })
    await host.applyProperties(rect, { blendMode: 'MULTIPLY' })
    expect(fake.__all().find((s) => s.name === 'B')?.blendMode).toBe('multiply')

    const unsupported = await host.createNode({ kind: 'rectangle', name: 'B2' })
    const result = await host.applyProperties(unsupported, { blendMode: 'PASS_THROUGH' })
    expect(result.skipped.some((s) => s.property === 'blendMode')).toBe(true)
  })

  it('strokeAlign 改已有描边的对齐（没有描边时如实跳过）', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'S' })
    const noStroke = await host.applyProperties(rect, { strokeAlign: 'OUTSIDE' })
    expect(noStroke.skipped.some((s) => s.property === 'strokeAlign')).toBe(true)

    await host.applyProperties(rect, { strokes: [{ color: '#000000', width: 1 }] })
    await host.applyProperties(rect, { strokeAlign: 'OUTSIDE' })
    const strokes = fake.__all().find((s) => s.name === 'S')?.strokes as { strokeAlignment: string }[]
    expect(strokes[0].strokeAlignment).toBe('outer')
  })
})

describe('applyProperties — 节点级图片（imageUrl）', () => {
  it('远程图片走 uploadMediaUrl 变成图片填充', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'IMG' })
    const result = await host.applyProperties(rect, { imageUrl: 'https://example.com/a.png' })

    expect(result.skipped).toHaveLength(0)
    const fills = fake.__all().find((s) => s.name === 'IMG')?.fills as { fillImage?: unknown }[]
    expect(fills[0].fillImage).toBeDefined()
    expect(fake.__uploads).toEqual(['https://example.com/a.png'])
  })

  it('同一 URL 只拉取一次（缓存）', async () => {
    const a = await host.createNode({ kind: 'rectangle', name: 'I1' })
    const b = await host.createNode({ kind: 'rectangle', name: 'I2' })
    await host.applyProperties(a, { imageUrl: 'https://example.com/same.png' })
    await host.applyProperties(b, { imageUrl: 'https://example.com/same.png' })
    expect(fake.__uploads).toHaveLength(1)
  })

  it('拉取失败时如实报降级，而不是留个空框', async () => {
    ;(fake as unknown as Record<string, unknown>).uploadMediaUrl = async () => {
      throw new Error('network down')
    }
    const rect = await host.createNode({ kind: 'rectangle', name: 'BAD' })
    const result = await host.applyProperties(rect, { imageUrl: 'https://example.com/x.png' })

    expect(result.skipped.some((s) => s.property === 'imageUrl' && /图片拉取失败/.test(s.reason))).toBe(true)
  })

  it('宿主没有 uploadMediaUrl 时给能力提示', async () => {
    const fresh = installFakePenpot()
    try {
      delete (fresh.penpot as unknown as Record<string, unknown>).uploadMediaUrl
      const probeHost = new PenpotHost()
      await probeHost.init()
      expect(probeHost.getCapabilities().props.imageFromUrl).toBe(false)

      const rect = await probeHost.createNode({ kind: 'rectangle', name: 'N' })
      const result = await probeHost.applyProperties(rect, { imageUrl: 'https://example.com/y.png' })
      expect(result.skipped.some((s) => /uploadMediaUrl/.test(s.reason))).toBe(true)
    } finally {
      fresh.restore()
    }
  })

  it('imageScaleMode 单独提供时如实跳过（Penpot 的贴合模式属于图片填充）', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'SM' })
    const result = await host.applyProperties(rect, { imageScaleMode: 'CROP' })
    expect(result.skipped.some((s) => s.property === 'imageScaleMode')).toBe(true)
  })
})

describe('文档 / 选区 / 视图 / 通知', () => {
  it('getDocumentInfo 带宿主与版本', () => {
    const info = host.getDocumentInfo()
    expect(info.host).toBe('penpot')
    expect(info.documentName).toBe('Fake File')
    expect(info.pageName).toBe('Page 1')
    expect(info.hostVersion).toBe('2.15.0')
  })

  it('getPageRootNodes 返回页面顶层子节点', async () => {
    await makeFrame('A')
    await makeFrame('B')
    expect(host.getPageRootNodes().map((n) => n.name)).toEqual(['A', 'B'])
  })

  it('setSelection 走 penpot.selection 赋值', async () => {
    const frame = await makeFrame('Sel')
    await host.setSelection([frame])
    expect(fake.selection.map((s) => s.name)).toEqual(['Sel'])
  })

  it('zoomToNodes 优先用 viewport.zoomIntoView', async () => {
    const a = await makeFrame('Z1')
    await host.zoomToNodes([a])
    expect(fake.viewport.zoomed).toHaveLength(1)
  })

  it('notify 转发到插件 UI（Penpot 无原生 toast）', () => {
    host.notify('测试通知', 'warning')
    const messages = fake.ui.sent as { type?: string; kind?: string; message?: string }[]
    const forwarded = messages.find((m) => m.message === '测试通知')
    expect(forwarded).toBeDefined()
    expect(forwarded?.kind).toBe('warning')
  })

  it('waitForLayoutUpdate 在 API 缺失时降级而不是抛错', async () => {
    await expect(host.waitForLayoutUpdate()).resolves.toBeUndefined()
  })

  it('waitForLayoutUpdate 存在时会调用宿主实现', async () => {
    const fresh = installFakePenpot({ withWaitForLayoutUpdate: true })
    try {
      let called = false
      ;(fresh.penpot as unknown as Record<string, unknown>).waitForLayoutUpdate = async () => {
        called = true
      }
      const probeHost = new PenpotHost()
      await probeHost.waitForLayoutUpdate()
      expect(called).toBe(true)
    } finally {
      fresh.restore()
    }
  })

  it('getNodeById 在跨页/不存在时返回 null 而不是抛错', () => {
    expect(host.getNodeById('does-not-exist')).toBeNull()
  })
})

describe('按内容自适应（hug）：不依赖 flex 布局', () => {
  it('无 flex 的 board 也能落地 horizontalSizing/verticalSizing = auto', async () => {
    // 真机现象：引擎在**非 flex 帧**上用 primaryAxisSizingMode=AUTO 表达「按内容自适应」，
    // 老实现「没有 flex 就跳过」→ 一页登录页丢掉 54 条自适应设置，
    // 输入框的文本包裹层被撑成整行高、文本贴顶 13px。
    const node = await host.createNode({ kind: 'frame', name: 'HugBox' })
    const applied = await host.applyProperties(node, {
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'AUTO',
    })
    expect(applied.skipped).toEqual([])
    const shape = fake.__all().find((s) => s.id === (node as unknown as { id: string }).id) as unknown as Record<string, any>
    expect(shape.horizontalSizing).toBe('auto')
    expect(shape.verticalSizing).toBe('auto')
  })

  it('FIXED → fix；且 flex 下仍按主轴/交叉轴换算（row 时主轴=水平）', async () => {
    const node = await host.createNode({ kind: 'frame', name: 'HugBox2' })
    const fixed = await host.applyProperties(node, { primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED' })
    expect(fixed.skipped).toEqual([])
    const shape = fake.__all().find((s) => s.id === (node as unknown as { id: string }).id) as unknown as Record<string, any>
    expect(shape.horizontalSizing).toBe('fix')
    expect(shape.verticalSizing).toBe('fix')
  })
})

describe('SVG 图标：按目标尺寸缩放几何（真机 bug 的接线级回归）', () => {
  const ICON = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 L22 2 L22 22 L12 22 Z"/></svg>'

  it('createNode(svg, 18×18) 写进去的 d 已经是缩放后的坐标（≤18）', async () => {
    const icon = await host.createNode({ kind: 'svg', name: 'Icon', svgContent: ICON, width: 18, height: 18 })
    const shape = fake.__all().find((x) => x.id === (icon as unknown as { id: string }).id) as unknown as Record<string, any>
    expect(shape.type).toBe('path')
    // 24 viewBox → 18：坐标必须落在 0..18 内，而不是 viewBox 的 0..24
    const numbers = String(shape.d).match(/-?\d+(\.\d+)?/g)!.map(Number)
    expect(Math.max(...numbers)).toBeLessThanOrEqual(18.001)
    // 墨迹 10×20（viewBox 24）按 s=0.75 缩放 → 7.5×15；形状**不做 resize**，
    // 自然尺寸就是缩放后的墨迹尺寸（再 resize 会把非方形图标拉变形）
    expect(shape.width).toBeCloseTo(7.5, 1)
    expect(shape.height).toBeCloseTo(15, 1)
  })

  it('给了目标尺寸时墨迹居中偏移会体现在 x/y 上', async () => {
    const icon = await host.createNode({ kind: 'svg', name: 'Icon2', svgContent: ICON, width: 18, height: 18, x: 100, y: 200 })
    const shape = fake.__all().find((x) => x.id === (icon as unknown as { id: string }).id) as unknown as Record<string, any>
    // 墨迹 7.5×15 放进 18×18 → 偏移 (5.25, 1.5)
    expect(shape.x).toBeCloseTo(105.25, 1)
    expect(shape.y).toBeCloseTo(201.5, 1)
  })
})

describe('字体应用：只在能判定时才报「未生效」', () => {
  async function makeText() {
    return await host.createNode({ kind: 'text', name: 'T', characters: '你好', width: 100, height: 20 })
  }

  it('正常应用 → 不报错', async () => {
    const text = await makeText()
    const applied = await host.applyProperties(text, { fontName: { family: 'Inter', style: 'Regular' } })
    expect(applied.skipped).toEqual([])
    expect(applied.applied).toContain('fontName')
  })

  it('宿主真的没应用（applyToText 空转）→ 报错并带出回读 fontId', async () => {
    const font = fake.fonts.findByName('Inter') as unknown as { applyToText: () => void }
    font.applyToText = () => {}
    const text = await makeText()
    const applied = await host.applyProperties(text, { fontName: { family: 'Inter', style: 'Regular' } })
    expect(applied.skipped.map((s) => s.reason).join(' ')).toMatch(/字体应用未生效.*回读 fontId/)
  })

  it('变体没有 fontId（Penpot 的 FontVariant 未必带）→ 不误报', async () => {
    // 真机现象：每次应用都报「字体应用未生效」，让人去查一个并不存在的问题 ——
    // 根因是回读校验写了 `text.fontId !== variant.fontId`，而 variant.fontId 为 undefined 时恒真
    const font = fake.fonts.findByName('Inter') as unknown as { variants: { fontId?: string }[] }
    for (const variant of font.variants) delete variant.fontId
    const text = await makeText()
    const applied = await host.applyProperties(text, { fontName: { family: 'Inter', style: 'Regular' } })
    expect(applied.skipped).toEqual([])
  })

  it('字体族不存在 → 如实说不认识（不是「未生效」）', async () => {
    const text = await makeText()
    const applied = await host.applyProperties(text, { fontName: { family: 'NoSuchFont', style: 'Regular' } })
    expect(applied.skipped.map((s) => s.reason).join(' ')).toMatch(/字体不可用: NoSuchFont/)
  })
})

// ───────────────────────── 内联图片（data: URI） ─────────────────────────
//
// 官方 API 有 `uploadMediaData(name, data: Uint8Array, mimeType)` —— 收二进制；
// 而 `uploadMediaUrl` 是让**后端去拉**一个 URL。AI 生成的 HTML 里 `<img src="data:...">`
// 很常见，把 data URI 交给 uploadMediaUrl 必然失败（这条路以前就是用不了的）。

describe('data: URI 图片走 uploadMediaData', () => {
  it('内联 PNG 会被解码后交给宿主（不是让后端去拉）', async () => {
    const node = await host.createNode({ kind: 'rectangle', name: 'Img', width: 10, height: 10 })
    // 1x1 透明 PNG
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAB/wD/AH8AfwAAAABJRU5ErkJggg=='
    const applied = await host.applyProperties(node, { imageUrl: png } as never)

    expect(applied.skipped.map((x) => x.reason).join(' ')).not.toMatch(/uploadMediaUrl/)
    // 替身记录了 uploadMediaData 的调用（名字 + 认出了 mime）
    expect(fake.__uploads.some((entry) => entry.includes('inline.png'))).toBe(true)
  })

  it('宿主没有 uploadMediaData 时**如实说明**，不静默丢弃', async () => {
    fake.__removeApi('uploadMediaData')
    const node = await host.createNode({ kind: 'rectangle', name: 'Img2', width: 10, height: 10 })
    const applied = await host.applyProperties(node, { imageUrl: 'data:image/png;base64,AAAA' } as never)
    expect(applied.skipped.map((x) => x.reason).join(' ')).toMatch(/uploadMediaData/)
  })
})

// ───────────────────────── 真机暴露的两处（由"查看我选中了什么"顺手发现） ─────────────────────────

describe('node/get 超时：不再退化成全页扫描', () => {
  it('宿主有 getShapeById 却查不到 → 立即返回 null（不扫全页）', async () => {
    // 真机症状：node/get 超时（"Timeout waiting for plugin response"），而 selection/get、
    // component/list 秒回 —— 因为它们是唯一不做"按 id 查找"的三个接口。
    // 根因：插件 API 是跨 iframe 代理，scanFor 逐节点读 children，大文档上直接把查找拖爆。
    const missing = 'no-such-id'
    const started = Date.now()
    expect(host.getNodeById(missing)).toBeNull()
    expect(Date.now() - started).toBeLessThan(50) // 必须"立刻"，不是"遍历完再说"
  })

  it('同一页内正常的 id 仍能查到（不因修复而失效）', async () => {
    const node = await host.createNode({ kind: 'rectangle', name: 'Found', width: 10, height: 10 })
    expect(host.getNodeById((node as unknown as { id: string }).id)).not.toBeNull()
  })
})

describe('component/list 去重（真机返回 4 条而只有 2 个组件）', () => {
  it('connected 里含本文件库时不重复登记', async () => {
    // 替身默认**不登记**组件（既有用例依赖 listComponents() 为空）；这里开变体替身才会登记
    installFakePenpot({ variants: true })
    const freshHost = new PenpotHost()
    await freshHost.init()

    // 造两个组件
    const a = await freshHost.createNode({ kind: 'rectangle', name: 'BtnA', width: 10, height: 10 })
    const b = await freshHost.createNode({ kind: 'rectangle', name: 'BtnB', width: 10, height: 10 })
    await freshHost.createComponent([a], 'Button')
    await freshHost.createComponent([b], 'Avatar')

    const components = await freshHost.listComponents()
    const ids = components.map((component) => component.id)
    expect(new Set(ids).size).toBe(ids.length) // 无重复 id
    expect(components.filter((component) => component.name === 'Button')).toHaveLength(1)
  })
})

// ─────────────── 库样式 upsert（真机 2026-10-02：`Body / Default` 曾无限翻倍） ───────────────

describe('库样式按名 upsert：Penpot 把 `/` 当文件夹分隔且每段 trim', () => {
  it('颜色：`Brand / Brand Primary` 第二次注册命中已存在（不新建）', async () => {
    // 真机语义：写 `name='Brand / Brand Primary'` → 存成 name `Brand Primary` / path `Brand`
    const first = await host.createColorStyle({ name: 'Brand / Brand Primary', color: '#3366FF' })
    expect(first.name).toBe('Brand Primary')
    expect(first.path).toBe('Brand')

    const updated = await host.updateColorStyle({ name: 'Brand / Brand Primary', color: '#7C3AED' })
    expect(updated).not.toBeNull()
    expect(updated?.color).toBe('#7C3AED')
    // 宿主库仍是 1 条（`connected` 含本库 → 列表按 id 去重后再数）
    const colors = await host.listColorStyles()
    expect(new Set(colors.map((style) => style.id)).size).toBe(1)
  })

  it('文本：`Body / Default` 第二次注册命中已存在（真机曾因此每次 +4）', async () => {
    const first = await host.createTextStyle({ name: 'Body / Default', fontSize: 14, fontWeight: 400 })
    expect(first.name).toBe('Default')
    expect(first.path).toBe('Body')

    const updated = await host.updateTextStyle({ name: 'Body / Default', fontSize: 16 })
    expect(updated).not.toBeNull()
    expect(updated?.fontSize).toBe('16')
    const texts = await host.listTextStyles()
    expect(new Set(texts.map((style) => style.id)).size).toBe(1)
  })

  it('叶子名不同 → 不互相误命中；未知名 → 返回 null（走新建分支）', async () => {
    await host.createTextStyle({ name: 'Body / Regular', fontSize: 14 })
    await host.createTextStyle({ name: 'Body / Strong', fontSize: 14, fontWeight: 600 })
    expect(await host.updateTextStyle({ name: 'Body / Missing' })).toBeNull()
    expect(new Set((await host.listTextStyles()).map((style) => style.id)).size).toBe(2)
  })
})

// ─────────────── P1-4：全页搜索走 `page.findShapes()`（功能性探测 + 递归兜底） ───────────────

describe('P1-4 全页搜索走 page.findShapes（功能性探测 + 递归兜底）', () => {
  async function seed(target: PenpotHost): Promise<void> {
    await target.createToken({ name: 'color.brand.primary', type: 'color', value: '#FF4D3D' })
    const rect = await target.createNode({ kind: 'rectangle', name: 'Probe' })
    await target.applyToken(rect, 'color.brand.primary', ['fill'])
    // 等价于 variable_update({ value })：改值后靠 propagateToken 回流
    await target.updateToken({ name: 'color.brand.primary', value: '#0066FF' })
  }

  it('findShapes 可用 → 传播经它列形状（命中 spy）且行为不变', async () => {
    await seed(host)
    let calls = 0
    const original = fake.currentPage.findShapes
    fake.currentPage.findShapes = (criteria) => {
      calls += 1
      return original(criteria)
    }

    const result = await host.propagateToken({ tokenName: 'color.brand.primary' })

    expect(calls).toBeGreaterThan(0) // 确实走了宿主 API，而不是手写递归
    expect(result).toMatchObject({ matched: 1, rewritten: 1 })
  })

  it('findShapes 恒返回 []（真实社区缺陷）→ 功能性探测判死、退回递归，行为一致', async () => {
    const installed = installFakePenpot({ withWaitForLayoutUpdate: false, findShapesBroken: true })
    try {
      const brokenHost = new PenpotHost()
      await brokenHost.init()
      await seed(brokenHost)

      const result = await brokenHost.propagateToken({ tokenName: 'color.brand.primary' })

      expect(brokenHost.getCapabilities().ops.findShapes).toBe(false)
      expect(result).toMatchObject({ matched: 1, rewritten: 1 })
    } finally {
      installed.restore()
    }
  })
})

// ─────────────── P1-5：宿主原生 CSS（generateStyle + generateFontFaces） ───────────────

describe('P1-5 generateCss（generateStyle + generateFontFaces）', () => {
  it('返回真实 CSS 与 @font-face，并带上覆盖节点数', async () => {
    const node = await host.createNode({ kind: 'rectangle', name: 'Card' })

    const result = await host.generateCss([node])

    expect(result.available).toBe(true)
    expect(result.css).toContain('fake-css:1')
    expect(result.fontFaces).toContain('fake-font-faces:1')
    expect(result.nodeCount).toBe(1)
  })

  it('能力位 ops.generateCss 为 true（Penpot 有 generateStyle）', () => {
    expect(host.getCapabilities().ops.generateCss).toBe(true)
  })

  it('旧宿主没有 generateFontFaces → 只回 CSS，并在 reason 里说明（不静默吞掉）', async () => {
    const installed = installFakePenpot({ withWaitForLayoutUpdate: false })
    delete (installed.penpot as unknown as { generateFontFaces?: unknown }).generateFontFaces
    try {
      const oldHost = new PenpotHost()
      await oldHost.init()
      const node = await oldHost.createNode({ kind: 'rectangle', name: 'Card' })

      const result = await oldHost.generateCss([node])

      expect(result.available).toBe(true)
      expect(result.css).toContain('fake-css:1')
      expect(result.fontFaces).toBe('')
      expect(String(result.reason ?? '')).toContain('generateFontFaces')
    } finally {
      installed.restore()
    }
  })
})

// ─────────────── P2-3：富文本 run（getRange + TextRange） ───────────────

describe('P2-3 applyTextRuns / readTextRuns（富文本区间）', () => {
  it('按 run 拼接 characters、逐段写样式；读回按样式分组', async () => {
    const text = await host.createNode({ kind: 'text', name: 'Rich', characters: 'HelloWorld' })

    const result = await host.applyTextRuns(text, [
      { text: 'Hello', fontSize: 20, fontWeight: 700, color: '#FF6B35' },
      { text: 'World', fontSize: 14, fontWeight: 400, color: '#0F172A' },
    ])

    expect(result).toMatchObject({ applied: true, runCount: 2, characters: 10 })
    expect(host.readProperties(text, ['characters']).characters).toBe('HelloWorld')

    const runs = host.readTextRuns(text)
    expect(runs.map((run) => run.text)).toEqual(['Hello', 'World'])
    expect(runs[0]).toMatchObject({ fontSize: 20, fontWeight: 700, color: '#FF6B35' })
    expect(runs[1]).toMatchObject({ fontSize: 14, fontWeight: 400, color: '#0F172A' })
  })

  it('非文本节点抛错（不静默当空）', async () => {
    const rect = await host.createNode({ kind: 'rectangle', name: 'R' })
    await expect(host.applyTextRuns(rect, [{ text: 'x' }])).rejects.toThrow(/文本节点/)
    expect(() => host.readTextRuns(rect)).toThrow(/文本节点/)
  })

  it('runs 为空 → applied:false（不谎报）', async () => {
    const text = await host.createNode({ kind: 'text', name: 'T', characters: 'x' })
    expect(await host.applyTextRuns(text, [])).toMatchObject({ applied: false })
  })
})

// ─────────────── 多 session：会话代号（按文档持久化） ───────────────

describe('多 session：会话代号按文档持久化', () => {
  it('首次自动生成并写入 localStorage；重复调用稳定', () => {
    fake.currentFile.id = 'doc-codename-1'
    const first = host.getDocumentCodename()
    expect(first).toMatch(/^[A-Z][a-z]+$/)
    expect(host.getDocumentCodename()).toBe(first)
    expect(fake.localStorage.store.get('mgmcp:codename:doc-codename-1')).toBe(first)
  })

  it('setDocumentCodename 改名、持久化，并同步到 getDocumentInfo()', () => {
    fake.currentFile.id = 'doc-codename-2'
    host.getDocumentCodename() // 先确保该文档有一份
    expect(host.setDocumentCodename('Quadrant')).toBe('Quadrant')
    expect(host.getDocumentCodename()).toBe('Quadrant')
    expect(host.getDocumentInfo().codename).toBe('Quadrant')
    expect(fake.localStorage.store.get('mgmcp:codename:doc-codename-2')).toBe('Quadrant')
    // 空串忽略（返回当前值）
    expect(host.setDocumentCodename('   ')).toBe('Quadrant')
  })

  it('代号按文档隔离：不同文档各自持有一份', () => {
    fake.currentFile.id = 'doc-a'
    host.setDocumentCodename('Alpha')
    fake.currentFile.id = 'doc-b'
    host.setDocumentCodename('Beta')
    expect(host.getDocumentCodename()).toBe('Beta')

    fake.currentFile.id = 'doc-a'
    expect(host.getDocumentCodename()).toBe('Alpha')
    fake.currentFile.id = 'doc-b'
    expect(host.getDocumentCodename()).toBe('Beta')
  })
})

describe('多 session：文档 id 缺失时不污染存储', () => {
  it('拿不到文档 id → 内存生成，不写 unknown 键', () => {
    const savedId = fake.currentFile.id
    fake.currentFile.id = ''
    const name = host.getDocumentCodename()
    expect(name).toMatch(/^[A-Z][a-z]+$/)
    expect(fake.localStorage.store.has('mgmcp:codename:unknown')).toBe(false)
    fake.currentFile.id = savedId
  })
})
