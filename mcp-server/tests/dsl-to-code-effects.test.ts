import { describe, it, expect } from 'vitest'
import { dslToCode } from '../src/utils/dsl-to-code.js'
import { dslToSemantic } from '../src/utils/dsl-to-semantic.js'

/**
 * effects（阴影 / 模糊）回归测试
 *
 * 锁住修复过的问题：
 * 1. `radius: 0` 的硬阴影被 falsy 判断丢弃
 * 2. `isEffectShow: false`（设计器里效果开关关闭）仍被输出
 * 3. 语义路径（默认 hybrid 模式，`design_to_code` 的主路径）丢 `spread` / `inset` / 模糊
 * 4. `blendMode: 'PASS_THROUGH'`（导出默认值）被误当成"不支持"而丢阴影
 */

function makeDsl(effects: any[]) {
  return {
    version: '2.0',
    elements: [
      {
        type: 'frame',
        name: 'Card',
        size: { width: 200, height: 100 },
        fills: [{ type: 'solid', color: '#ffffff' }],
        effects,
        children: [],
      },
    ],
  } as any
}

const dropShadow = (over: Record<string, any> = {}) => ({
  type: 'DROP_SHADOW',
  radius: 10,
  color: '#00000033',
  offset: { x: 0, y: 4 },
  visible: true,
  blendMode: 'PASS_THROUGH',
  spread: 0,
  showShadowBehindNode: false,
  isEffectShow: true,
  ...over,
})

describe('dsl-to-code effects（语义路径 · 默认 hybrid 模式）', () => {
  it('输出阴影并携带 spread、把 8 位 hex 转成 rgba', async () => {
    const { html } = await dslToCode(makeDsl([dropShadow({ spread: 4 })]))
    expect(html).toContain('shadow-[')
    expect(html).toContain('0px 4px 10px 4px rgba(0,0,0,0.20)')
  })

  it('radius=0 的硬阴影不再被丢弃', async () => {
    const { html } = await dslToCode(makeDsl([dropShadow({ radius: 0, offset: { x: 0, y: 2 } })]))
    expect(html).toContain('0px 2px 0px rgba(0,0,0,0.20)')
  })

  it('内阴影输出 inset', async () => {
    const { html } = await dslToCode(makeDsl([dropShadow({ type: 'INNER_SHADOW' })]))
    expect(html).toContain('inset 0px 4px 10px')
  })

  it('isEffectShow=false 时不输出（效果开关关闭）', async () => {
    const { html } = await dslToCode(makeDsl([dropShadow({ isEffectShow: false })]))
    expect(html).not.toContain('shadow-[')
  })

  it('visible=false 时不输出', async () => {
    const { html } = await dslToCode(makeDsl([dropShadow({ visible: false })]))
    expect(html).not.toContain('shadow-[')
  })

  // 运行时形状（插件 node_get 序列化出来的效果用 isVisible，而不是 DSL 的 visible）
  it('运行时形状 isVisible=false 同样不输出（口径统一）', async () => {
    const { html } = await dslToCode(makeDsl([dropShadow({ isVisible: false, visible: undefined })]))
    expect(html).not.toContain('shadow-[')
  })

  it('运行时形状 isVisible=true 正常输出', async () => {
    const { html } = await dslToCode(makeDsl([dropShadow({ isVisible: true, visible: undefined })]))
    expect(html).toContain('shadow-[')
  })

  it('图层模糊输出 blur-[Npx]', async () => {
    const { html } = await dslToCode(
      makeDsl([{ type: 'LAYER_BLUR', radius: 8, visible: true, isEffectShow: true }]),
    )
    expect(html).toContain('blur-[8px]')
  })

  it('背景模糊输出 backdrop-blur-[Npx]', async () => {
    const { html } = await dslToCode(
      makeDsl([{ type: 'BACKGROUND_BLUR', radius: 6, visible: true, isEffectShow: true }]),
    )
    expect(html).toContain('backdrop-blur-[6px]')
  })

  it('invisible 的模糊也不会输出', async () => {
    const { html } = await dslToCode(
      makeDsl([{ type: 'LAYER_BLUR', radius: 8, visible: false, isEffectShow: true }]),
    )
    expect(html).not.toContain('blur-[')
  })
})

describe('dsl-to-code effects（逐元素路径 · mode:html）', () => {
  it('radius=0 的硬阴影不再被丢弃（Tailwind 下划线风格）', async () => {
    const { html } = await dslToCode(makeDsl([dropShadow({ radius: 0, offset: { x: 0, y: 2 } })]), {
      mode: 'html',
    })
    expect(html).toContain('shadow-[0px_2px_0px_0px_#00000033]')
  })

  it('内阴影输出 inset_ 前缀', async () => {
    const { html } = await dslToCode(makeDsl([dropShadow({ type: 'INNER_SHADOW' })]), { mode: 'html' })
    expect(html).toContain('shadow-[inset_0px_4px_10px_0px_#00000033]')
  })

  it('isEffectShow=false 不输出，blendMode=PASS_THROUGH 不影响输出', async () => {
    const disabled = await dslToCode(makeDsl([dropShadow({ isEffectShow: false })]), { mode: 'html' })
    expect(disabled.html).not.toContain('shadow-[')

    const passThrough = await dslToCode(makeDsl([dropShadow()]), { mode: 'html' })
    expect(passThrough.html).toContain('shadow-[')
  })
})

describe('dsl-to-semantic effects', () => {
  it('保留 spread / type，并输出 blur 与 backdropBlur', () => {
    const comps = dslToSemantic(
      makeDsl([
        dropShadow({ spread: 4 }),
        { type: 'LAYER_BLUR', radius: 8, visible: true, isEffectShow: true },
        { type: 'BACKGROUND_BLUR', radius: 6, visible: true, isEffectShow: true },
      ]),
    )
    const style = comps[0]['style'] as any
    expect(style.shadows[0]).toMatchObject({
      type: 'drop_shadow',
      dx: 0,
      dy: 4,
      blur: 10,
      spread: 4,
    })
    expect(style.blur).toBe(8)
    expect(style.backdropBlur).toBe(6)
  })

  it('isEffectShow=false 的阴影与模糊都不进语义样式', () => {
    const comps = dslToSemantic(
      makeDsl([
        dropShadow({ isEffectShow: false }),
        { type: 'LAYER_BLUR', radius: 8, visible: true, isEffectShow: false },
      ]),
    )
    const style = comps[0]['style'] as any
    expect(style?.shadows).toBeUndefined()
    expect(style?.blur).toBeUndefined()
  })

  it('运行时形状 isVisible=false 也不进语义样式', () => {
    const comps = dslToSemantic(
      makeDsl([dropShadow({ isVisible: false, visible: undefined })]),
    )
    const style = comps[0]['style'] as any
    expect(style?.shadows).toBeUndefined()
  })
})
