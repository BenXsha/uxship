import { describe, it, expect } from 'vitest'
import {
  applyTailwindToTree,
  collectTextLayoutHazardClasses,
  collectUnresolvedClasses,
  isTextLikeTag,
  resolveTailwindStyle,
  TEXT_LAYOUT_HAZARD_HINT,
} from '../ui/composables/tailwind-resolver'

/**
 * 文本元素上的背景/内边距/圆角 —— 不许把 `bg-*` 落到 text 节点的 `fills`
 *
 * 背景（外部 51 条实测日志里的真实渲染缺陷，代价是整排文字看不见）：
 * `<p class="bg-[rgba(60,60,67,0.10)] px-2">Ctrl</p>` 渲染后，该 text 节点的 `fills`
 * 被写成那层 10% 灰 —— 等于「用 10% 不透明度画文字」，用户报障原话
 * 「偏白，看不到快捷键内容文本」。用户总结的规避规则是：
 * **背景/圆角/内边距一律写在 `<section>`（frame）上，`<p>` 只负责文字与颜色**。
 *
 * 根因链路（本文件锁住的正是第一环）：
 *   tailwind-resolver 把 `bg-*` 写成元素内联 `background-color`
 *   → useClientRender.extractNode 里 `extractBackgroundFills` 把它落到 `node.fills`
 *   → 随后 `extractTextContent` 因为 `!node.fills` 已不成立而跳过文字颜色
 *   → 背景色顶掉文字色。
 *
 * 因此解析器必须在**文本元素**上拦下这些 class：不落到元素本身，改为可读告警。
 * 注意：`resolveTailwindStyle` / `collectUnresolvedClasses` 是**无元素上下文**的纯函数，
 * 行为保持不变（既有测试断言不许放宽）—— hazard 判定只发生在元素级 / 树级 API 上。
 */

/** 极简 Element 桩：只实现解析器真正用到的接口（本包测试环境是 node，无 DOM） */
function fakeEl(
  tagName: string,
  classAttr: string,
  opts: { children?: any[]; textContent?: string } = {},
): any {
  const attrs: Record<string, string> = { class: classAttr }
  return {
    tagName: tagName.toUpperCase(),
    style: {} as Record<string, any>,
    children: opts.children ?? [],
    // 文本标签默认带文字（真实场景里的 hazard 就发生在有文字时）
    textContent: opts.textContent ?? '',
    getAttribute: (k: string) => attrs[k] ?? null,
    setAttribute: (k: string, v: string) => {
      attrs[k] = v
    },
  }
}

describe('collectTextLayoutHazardClasses — 纯函数判定', () => {
  it('文本标签识别（与 useClientRender 的 inline text 名单一致）', () => {
    expect(isTextLikeTag('p')).toBe(true)
    expect(isTextLikeTag('P')).toBe(true)
    expect(isTextLikeTag('span')).toBe(true)
    expect(isTextLikeTag('section')).toBe(false)
    expect(isTextLikeTag('div')).toBe(false)
    expect(isTextLikeTag(null)).toBe(false)
  })

  it('<p> 上的 bg / padding / rounded 全部被拦下', () => {
    expect(
      collectTextLayoutHazardClasses('text-[#333333] bg-[rgba(60,60,67,0.10)] px-2 rounded-lg', 'p', 'Ctrl'),
    ).toEqual(['bg-[rgba(60,60,67,0.10)]', 'px-2', 'rounded-lg'])
  })

  it('空的 <p>（当装饰块用）不算 hazard：背景/内边距照旧生效', () => {
    // 空文本元素会被渲染成 rectangle/frame，背景是合理的；拦下它反而会弄丢整个节点
    expect(collectTextLayoutHazardClasses('bg-[#000000] px-2', 'p', '')).toEqual([])
    expect(collectTextLayoutHazardClasses('bg-[#000000] px-2', 'p', '   ')).toEqual([])
    // 不传 textContent 时按「可能有文字」保守拦截
    expect(collectTextLayoutHazardClasses('bg-[#000000]', 'p')).toEqual(['bg-[#000000]'])
  })

  it('渐变类同样拦下（会生成 background-image → 一样顶掉文字色）', () => {
    expect(
      collectTextLayoutHazardClasses('bg-gradient-to-r from-[#ffffff] to-[#000000] bg-opacity-50', 'span', 'Ctrl'),
    ).toEqual(['bg-gradient-to-r', 'from-[#ffffff]', 'to-[#000000]', 'bg-opacity-50'])
  })

  it('非文本标签（frame）不拦：背景写在 <section> 上是正确写法', () => {
    expect(collectTextLayoutHazardClasses('bg-[#000000] px-2 rounded-lg', 'section', '文字')).toEqual([])
    expect(collectTextLayoutHazardClasses('bg-[#000000] px-2 rounded-lg', 'div', '文字')).toEqual([])
  })

  it('只影响背景/内边距/圆角：文字与颜色类不受牵连', () => {
    expect(collectTextLayoutHazardClasses('text-[#333333] font-bold text-center leading-tight', 'p', 'Ctrl')).toEqual([])
    // 前缀相近但无关的工具类不能被误伤
    expect(collectTextLayoutHazardClasses('pointer-events-none place-items-center pt-1', 'p', 'Ctrl')).toEqual([
      'pt-1',
    ])
  })

  it('空输入安全', () => {
    expect(collectTextLayoutHazardClasses('', 'p', 'Ctrl')).toEqual([])
    expect(collectTextLayoutHazardClasses(null, 'p', 'Ctrl')).toEqual([])
    expect(collectTextLayoutHazardClasses('bg-white', undefined, 'Ctrl')).toEqual([])
  })
})

describe('applyTailwindToTree — <p> 上的背景不再落到元素（即不再进 text 的 fills）', () => {
  it('bg-[#000000] / px-2 不写进内联样式，且产生可读告警', () => {
    const p = fakeEl('p', 'bg-[#000000] px-2', { textContent: 'Ctrl' })
    const result = applyTailwindToTree(p)

    // 关键：没有 background-color 内联样式 → extractBackgroundFills 拿不到 → text 的 fills 不会被染色
    expect(p.style.backgroundColor).toBeUndefined()
    expect(p.style.paddingLeft).toBeUndefined()
    expect(p.style.paddingRight).toBeUndefined()

    // 这些 class 如实进 unresolved（会随 dsl/render 响应回传 + 画布告警）
    expect(result.unresolved).toContain('bg-[#000000]')
    expect(result.unresolved).toContain('px-2')

    // 告警文案写清替代写法
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('<p')
    expect(result.warnings[0]).toContain('bg-[#000000]')
    expect(result.warnings[0]).toContain('<section>')
    expect(result.warnings[0]).toBe(`<p class="bg-[#000000] px-2">：${TEXT_LAYOUT_HAZARD_HINT}`)
  })

  it('用户实测那一条：bg-[rgba(60,60,67,0.10)] px-2', () => {
    const p = fakeEl('p', 'bg-[rgba(60,60,67,0.10)] px-2', { textContent: 'Ctrl' })
    const result = applyTailwindToTree(p)
    expect(p.style.backgroundColor).toBeUndefined()
    expect(result.unresolved).toEqual(['bg-[rgba(60,60,67,0.10)]', 'px-2'])
    expect(result.warnings).toHaveLength(1)
  })

  it('防回归：正常文字与颜色仍照旧生效', () => {
    const p = fakeEl('p', 'text-[#333333] font-bold text-center leading-tight', { textContent: 'Ctrl' })
    const result = applyTailwindToTree(p)
    expect(p.style.color).toBe('#333333')
    expect(p.style.fontWeight).toBe('700')
    expect(p.style.textAlign).toBe('center')
    expect(p.style.lineHeight).toBe('1.25')
    expect(result.unresolved).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('防回归：空 <p> 当装饰块用 —— 背景照旧生效，节点不会被弄丢', () => {
    const p = fakeEl('p', 'bg-[#000000] w-5 h-5', { textContent: '' })
    const result = applyTailwindToTree(p)
    expect(p.style.backgroundColor).toBe('#000000')
    expect(result.unresolved).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('防回归：<section>/<div>（frame）上的背景、内边距、圆角照旧生效', () => {
    const section = fakeEl('section', 'bg-[#000000] px-2 rounded-lg', { textContent: 'Ctrl' })
    const result = applyTailwindToTree(section)
    expect(section.style.backgroundColor).toBe('#000000')
    expect(section.style.paddingLeft).toBe('0.5rem')
    expect(section.style.paddingRight).toBe('0.5rem')
    expect(section.style.borderRadius).toBe('0.5rem')
    expect(result.unresolved).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('子树遍历：内层 <p> 的 hazard 也会被报出，外层 frame 不受影响', () => {
    const p = fakeEl('p', 'bg-[#eeeeee]', { textContent: 'Ctrl' })
    const section = fakeEl('section', 'bg-white px-4 rounded-2xl', { children: [p], textContent: 'Ctrl' })
    const result = applyTailwindToTree(section)

    expect(section.style.backgroundColor).toBe('#ffffff')
    expect(section.style.paddingLeft).toBe('1rem')
    expect(p.style.backgroundColor).toBeUndefined()

    expect(result.unresolved).toEqual(['bg-[#eeeeee]'])
    expect(result.warnings).toHaveLength(1)
  })

  it('无 class 属性时安全（不抛异常）', () => {
    const div = fakeEl('div', '', { textContent: '' })
    const result = applyTailwindToTree(div)
    expect(result.unresolved).toEqual([])
    expect(result.warnings).toEqual([])
  })
})

describe('无元素上下文的纯函数保持原行为（既有断言不许放宽）', () => {
  it('解析器本身不变：bg-* 仍能解析出 background-color', () => {
    expect(resolveTailwindStyle('bg-white')).toBe('background-color:#ffffff')
    expect(resolveTailwindStyle('bg-[rgba(60,60,67,0.10)]')).toBe('background-color:rgba(60,60,67,0.10)')
    expect(resolveTailwindStyle('px-2')).toBe('padding-left:0.5rem;padding-right:0.5rem')
    // 无上下文时不做 hazard 判定：典型卡片写法仍全部可解析
    expect(
      collectUnresolvedClasses(
        'flex items-center gap-3 px-6 rounded-2xl shadow-lg bg-white text-gray-900 leading-tight',
      ),
    ).toEqual([])
  })
})
