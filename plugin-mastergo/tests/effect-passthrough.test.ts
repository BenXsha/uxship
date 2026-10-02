import { describe, it, expect, vi, afterEach } from 'vitest'
import { applyEffects, applyNodeProperties } from '../lib/utils/node-utils'
import { isItemVisible, serializeEffects } from '../lib/api/visual-utils'
import { installMgStub, resetMgStub } from './helpers/mg-stub'
import { handleUpdateNode } from '../lib/api/nodeHandlers'

/**
 * 属性链路透传测试
 *
 * 覆盖三件事：
 * 1. 新效果类型（LIQUID_GLASS / MOTION_BLUR）字段完整透传；未知效果类型不再丢弃，改为原样透传并产生 warning
 * 2. `properties.content` / `properties.text` → `characters` 别名（`characters` 显式传入优先）
 * 3. 非文本节点不会被写入 `characters`
 *
 * 可见性口径统一复用 `visual-utils.isItemVisible`，不另立判断。
 */

function makeTextNode(): any {
  return {
    type: 'TEXT',
    characters: '输入文本',
    setRangeFontSize: () => {},
    setRangeFontName: () => {},
    setRangeLetterSpacing: () => {},
    setRangeLineHeight: () => {},
  }
}

afterEach(() => {
  resetMgStub()
  vi.restoreAllMocks()
})

describe('applyEffects：新效果类型透传', () => {
  it('LIQUID_GLASS 字段完整透传（含 visible → isVisible 归一化）', () => {
    const node: any = { type: 'RECTANGLE' }
    applyEffects(node, [
      {
        type: 'LIQUID_GLASS',
        depth: 12,
        dispersion: 0.4,
        refraction: 1.2,
        lightIntensity: 0.8,
        lightAngle: 45,
        radius: 8,
        blendMode: 'SCREEN',
        visible: false,
      },
    ] as any)

    expect(node.effects).toHaveLength(1)
    const out = node.effects[0]
    expect(out).toMatchObject({
      type: 'LIQUID_GLASS',
      depth: 12,
      dispersion: 0.4,
      refraction: 1.2,
      lightIntensity: 0.8,
      lightAngle: 45,
      radius: 8,
      blendMode: 'SCREEN',
    })
    // 视觉可见性口径复用 isItemVisible（DSL 的 visible:false 也要被判为隐藏）
    expect(isItemVisible(out)).toBe(false)
  })

  it('MOTION_BLUR 字段完整透传', () => {
    const node: any = { type: 'RECTANGLE' }
    applyEffects(node, [
      { type: 'MOTION_BLUR', radius: 6, angle: 30, blendMode: 'MULTIPLY', isVisible: true },
    ] as any)

    const out = node.effects[0]
    expect(out).toMatchObject({
      type: 'MOTION_BLUR',
      radius: 6,
      angle: 30,
      blendMode: 'MULTIPLY',
    })
    expect(isItemVisible(out)).toBe(true)
  })

  it('未知效果类型原样透传（字段不丢）并把 warning 交给调用方', () => {
    const node: any = { type: 'RECTANGLE' }
    const warnings: string[] = []
    applyEffects(node, [{ type: 'FANCY_GLOW', amount: 3, extra: { nested: true } }] as any, warnings)

    expect(node.effects).toHaveLength(1)
    expect(node.effects[0]).toEqual({ type: 'FANCY_GLOW', amount: 3, extra: { nested: true } })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('已透传未知效果类型 FANCY_GLOW')
  })

  it('调用方未传 warnings 时退化为 console.warn（不静默丢弃）', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const node: any = { type: 'RECTANGLE' }
    applyEffects(node, [{ type: 'FANCY_GLOW', amount: 3 }] as any)

    expect(node.effects[0]).toEqual({ type: 'FANCY_GLOW', amount: 3 })
    expect(spy).toHaveBeenCalled()
    expect(String(spy.mock.calls[0]?.[0] ?? '')).toContain('已透传未知效果类型 FANCY_GLOW')
  })

  it('已知类型不受影响：阴影 / 模糊仍走原归一化', () => {
    const node: any = { type: 'RECTANGLE' }
    const warnings: string[] = []
    applyEffects(node, [
      { type: 'DROP_SHADOW', radius: 4 },
      { type: 'LAYER_BLUR', radius: 2 },
    ] as any, warnings)

    expect(node.effects.map((e: any) => e.type)).toEqual(['DROP_SHADOW', 'LAYER_BLUR'])
    expect(node.effects[0].showShadowBehindNode).toBe(false)
    expect(node.effects[1].radius).toBe(2)
    expect(warnings).toEqual([])
  })
})

describe('applyNodeProperties：content / text → characters 别名', () => {
  it('content 映射到 characters', () => {
    const node = makeTextNode()
    applyNodeProperties(node, { content: '文案' })
    expect(node.characters).toBe('文案')
  })

  it('text 映射到 characters', () => {
    const node = makeTextNode()
    applyNodeProperties(node, { text: '标题' })
    expect(node.characters).toBe('标题')
  })

  it('characters 显式传入时优先级最高', () => {
    const node = makeTextNode()
    applyNodeProperties(node, { content: '来自 content', text: '来自 text', characters: '来自 characters' })
    expect(node.characters).toBe('来自 characters')
  })

  it('content 与 text 同时传入时 content 优先', () => {
    const node = makeTextNode()
    applyNodeProperties(node, { content: 'A', text: 'B' })
    expect(node.characters).toBe('A')
  })

  it('非文本节点不会写入 characters', () => {
    const rect: any = { type: 'RECTANGLE' }
    applyNodeProperties(rect, { content: '不该出现在矩形上' })
    expect('characters' in rect).toBe(false)
  })

  it('别名生效时不再把 content/text 当作未知属性重复跳过', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const node = makeTextNode()
    applyNodeProperties(node, { content: '文案' })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('warning 透传到工具响应', () => {
  it('node_update 遇到未知效果类型时把 warning 并入响应', () => {
    const node: any = { id: '1:2', name: 'R', type: 'RECTANGLE', effects: [], removed: false }
    installMgStub({ nodes: { '1:2': node } })

    const res = handleUpdateNode({
      nodeId: '1:2',
      properties: { effects: [{ type: 'FANCY_GLOW', amount: 2 }] },
    })

    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toContain('已透传未知效果类型 FANCY_GLOW')
    expect(node.effects[0]).toEqual({ type: 'FANCY_GLOW', amount: 2 })
  })

  it('没有 warning 时不额外增加 warnings 字段（保持旧响应形状）', () => {
    const node: any = { id: '1:3', name: 'R2', type: 'RECTANGLE', effects: [], removed: false }
    installMgStub({ nodes: { '1:3': node } })

    const res = handleUpdateNode({ nodeId: '1:3', properties: { opacity: 0.5 } })
    expect('warnings' in res).toBe(false)
  })
})

describe('回读链路（serializer 复用 visual-utils）', () => {
  it('新效果类型不会被类型白名单丢掉（通用字段透传）', () => {
    const readback = serializeEffects([
      { type: 'LIQUID_GLASS', isVisible: true, radius: 6, blendMode: 'NORMAL' },
      { type: 'MOTION_BLUR', isVisible: false, radius: 3, angle: 90 },
    ])
    expect(readback.map((e) => e.type)).toEqual(['LIQUID_GLASS', 'MOTION_BLUR'])
    expect(isItemVisible(readback[0])).toBe(true)
    expect(isItemVisible(readback[1])).toBe(false)
  })
})
