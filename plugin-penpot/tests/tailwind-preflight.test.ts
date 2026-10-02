/**
 * Tailwind preflight 对齐（真机「直渲框高度异常」的根因）
 *
 * 这条链路**没有加载任何 Tailwind CSS** —— class 全靠 `tailwind-resolver` 翻成内联样式。
 * 于是 Tailwind preflight 负责的两件事没人做，浏览器 UA 默认样式直接生效：
 *
 *   1. `box-sizing` 默认 `content-box` → `w-[300px] p-[14px]` 实测占 **328**
 *      （尺寸把 padding 又加了一遍）。真机实测 `B Box` = 328×76，而 CSS 意图是 300×48。
 *   2. `p` 自带 `margin: 1em 0` → **每个包文字的容器高度 +2em**。14px 文本 + `leading-[20px]`
 *      的包裹层实测 **48**（20 + 14 + 14）而不是 20 —— 一页登录页里所有文本包裹层全部偏高，
 *      文本框里的文字也因此看着"没垂直居中"（下面多出一条 margin 占位）。
 *
 * 这两条直接影响**框的尺寸**，一旦回退就会表现为"整体偏高/偏宽"，很难归因 ——
 * 所以这里逐条钉住。测试用结构化桩对象，不引 jsdom（项目刻意不装 DOM 环境）。
 */
import { describe, expect, it } from 'vitest'
import { applyPreflightDefaults } from '@ui/composables/tailwind-resolver'

const makeEl = (tagName: string) => ({ tagName, style: { boxSizing: '', margin: '' } })

describe('preflight 对齐', () => {
  it('任何元素都补 box-sizing: border-box（否则尺寸把 padding 算两遍）', () => {
    for (const [tag, cls] of [['section', 'w-[300px] p-[14px]'], ['p', 'w-[300px]'], ['div', 'w-[10px]']]) {
      const el = makeEl(tag)
      applyPreflightDefaults(el, cls)
      expect(el.style.boxSizing).toBe('border-box')
    }
  })

  it('<p> 的 UA margin 归零（「包裹层 48 而非 20」的根因）', () => {
    const el = makeEl('P')
    applyPreflightDefaults(el, 'w-[300px] text-[14px] leading-[20px]')
    expect(el.style.margin).toBe('0px')
  })

  it('作者显式写了 margin → 尊重作者，不覆盖', () => {
    const el = makeEl('P')
    applyPreflightDefaults(el, 'w-[300px] mb-[12px]')
    expect(el.style.margin).toBe('')
  })

  it('不带 UA margin 的标签不动 margin（避免误伤 section）', () => {
    const el = makeEl('SECTION')
    applyPreflightDefaults(el, 'flex w-[300px]')
    expect(el.style.margin).toBe('')
  })

  it('h1~h6 / blockquote / dd 等同样归零', () => {
    for (const tag of ['H1', 'H3', 'BLOCKQUOTE', 'DD', 'UL', 'PRE']) {
      const el = makeEl(tag)
      applyPreflightDefaults(el, '')
      expect(el.style.margin).toBe('0px')
    }
  })

  it('大小写不敏感：P / p 都算', () => {
    const lower = makeEl('p'); const upper = makeEl('P')
    applyPreflightDefaults(lower, ''); applyPreflightDefaults(upper, '')
    expect(lower.style.margin).toBe('0px')
    expect(upper.style.margin).toBe('0px')
  })
})
