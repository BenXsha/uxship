import { describe, it, expect } from 'vitest'
import { serializeNode, serializeNodes } from '../lib/api/serializer'

/**
 * 节点序列化字段完整性门禁
 *
 * 这是本仓库最容易静默回归的地方：`node_get` / `selection_get` / 所有写操作的
 * 返回值都经由 `serializeNode`，而"少序列化一个字段"类型检查发现不了。
 * 2026-09 的真实缺陷就是 `effects` 整个漏掉（fills/strokes 有、effects 没有）。
 *
 * 本文件的契约：**凡是运行时节点上存在、且 AI 需要回读验证的字段，都必须出现在输出里**。
 */

/** 造一个"真实形状"的 FRAME（字段名与 MasterGo 运行时一致：effects 用 isVisible） */
function fakeFrame(over: Record<string, any> = {}) {
  return {
    id: '24:7265',
    name: '外框/存储架构卡片',
    type: 'FRAME',
    removed: false,
    isVisible: true,
    isLocked: false,
    parent: { id: '26:2950' },
    children: [{ id: '24:7266' }, { id: '24:7267' }],
    x: 747,
    y: 1267,
    width: 320,
    height: 466,
    rotation: 0,
    opacity: 1,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
    strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
    strokeWeight: 1,
    strokeAlign: 'INSIDE',
    strokeCap: 'NONE',
    strokeJoin: 'MITER',
    strokeTopWeight: 1,
    strokeBottomWeight: 1,
    strokeLeftWeight: 1,
    strokeRightWeight: 1,
    cornerRadius: 12,
    effects: [
      {
        type: 'DROP_SHADOW',
        isVisible: true,
        radius: 10,
        spread: 0,
        blendMode: 'PASS_THROUGH',
        showShadowBehindNode: false,
        isEffectShow: true,
        color: { r: 0, g: 0, b: 0, a: 0.3 },
        offset: { x: 0, y: 4 },
      },
    ],
    flexMode: 'NONE',
    itemSpacing: 10,
    paddingTop: 10,
    paddingRight: 10,
    paddingBottom: 10,
    paddingLeft: 10,
    mainAxisAlignItems: 'FLEX_START',
    crossAxisAlignItems: 'FLEX_START',
    mainAxisSizingMode: 'AUTO',
    crossAxisSizingMode: 'AUTO',
    clipsContent: true,
    ...over,
  }
}

describe('serializeNode — 字段完整性', () => {
  it('序列化 effects（本次回归的核心）', () => {
    const out = serializeNode(fakeFrame()) as any
    expect(out.effects).toHaveLength(1)
    expect(out.effects[0]).toMatchObject({
      type: 'DROP_SHADOW',
      isVisible: true,
      radius: 10,
      spread: 0,
      isEffectShow: true,
      color: { r: 0, g: 0, b: 0, a: 0.3 },
      offset: { x: 0, y: 4 },
    })
  })

  it('序列化 fills / strokes / 几何 / 布局 / 描边细节', () => {
    const out = serializeNode(fakeFrame()) as any
    expect(out.fills).toEqual([{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }])
    expect(out.strokes).toEqual([{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }])
    for (const key of ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'cornerRadius']) {
      expect(out[key]).toBeTypeOf('number')
    }
    for (const key of ['strokeWeight', 'strokeAlign', 'strokeCap', 'strokeJoin', 'strokeTopWeight', 'strokeLeftWeight']) {
      expect(out[key]).toBeDefined()
    }
    for (const key of ['flexMode', 'itemSpacing', 'paddingTop', 'mainAxisAlignItems', 'clipsContent']) {
      expect(out[key]).toBeDefined()
    }
  })

  it('没有 effects 的节点不产生空数组（保持输出精简）', () => {
    const out = serializeNode(fakeFrame({ effects: [] })) as any
    expect('effects' in out).toBe(false)
    expect(serializeNode(fakeFrame({ effects: undefined }))).not.toHaveProperty('effects')
  })

  it('隐藏的效果也照实序列化（序列化负责描述，不负责过滤）', () => {
    const out = serializeNode(
      fakeFrame({ effects: [{ type: 'LAYER_BLUR', isVisible: false, radius: 8 }] }),
    ) as any
    expect(out.effects[0].isVisible).toBe(false)
    expect(out.effects[0].radius).toBe(8)
  })

  it('文本节点序列化文字与字体', () => {
    const text = {
      id: '24:7272',
      name: '标题/存储架构',
      type: 'TEXT',
      removed: false,
      isVisible: true,
      isLocked: false,
      parent: { id: '24:7265' },
      x: 0,
      y: 0,
      width: 56,
      height: 20,
      rotation: 0,
      opacity: 1,
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
      strokes: [],
      characters: '存储架构',
      textAlignHorizontal: 'LEFT',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      textStyles: [{ textStyle: { fontSize: 14, fontName: { family: 'Source Han Sans', style: 'Bold' }, lineHeight: { unit: 'PIXELS', value: 20 }, letterSpacing: { unit: 'PERCENT', value: 0 } } }],
    }
    const out = serializeNode(text) as any
    expect(out.characters).toBe('存储架构')
    expect(out.fontSize).toBe(14)
    expect(out.fontName).toEqual({ family: 'Source Han Sans', style: 'Bold' })
  })

  it('deep=true 递归子节点，false 只给 childIds', () => {
    const parent = fakeFrame({
      children: [fakeFrame({ id: '24:7266', name: '子卡片', effects: [{ type: 'INNER_SHADOW', isVisible: true, radius: 2 }] })],
    })
    const shallow = serializeNode(parent, false) as any
    expect(shallow.childIds).toEqual(['24:7266'])
    expect(shallow.children).toBeUndefined()

    const deep = serializeNode(parent, true) as any
    expect(deep.children).toHaveLength(1)
    expect(deep.children[0].effects[0].type).toBe('INNER_SHADOW')
  })

  it('已移除节点返回 null（不能返回半成品对象）', () => {
    expect(serializeNode(fakeFrame({ removed: true }))).toBeNull()
    expect(serializeNode(null)).toBeNull()
  })

  it('serializeNodes 过滤 null 且保持顺序', () => {
    const out = serializeNodes([fakeFrame(), fakeFrame({ id: 'x', removed: true }), fakeFrame({ id: 'y' })])
    expect(out.map((n: any) => n.id)).toEqual(['24:7265', 'y'])
  })
})
