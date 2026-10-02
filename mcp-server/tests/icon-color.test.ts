/**
 * 图标颜色与属性保留（服务端重写：`<i data-icon>` → `<svg>`）
 *
 * 真机发现的缺陷（见 `skills/design/rules/06-images.md §5`）：
 *   `<i data-icon="lucide:check" class="text-[24px] text-[#DC2626]">` 渲出来是**灰的**（`#e5e7eb`），
 *   而同一页 `<p class="text-[#0F172A]">` 的文字颜色完全正确。根因两段：
 *     1. `customizeIconSvg` 只替换 `fill="currentColor"`，不管 `stroke="currentColor"`
 *        → 描边型图标（Lucide / Remix 线条图标）的颜色参数被**静默忽略**，
 *          最后按 CSS 继承解析成宿主环境的文字色；
 *     2. 这段重写是**整段字符串替换**，却只搬了 `data-name`（且**只在本地图标分支里搬**）
 *        → `class` / `data-token-*` / `style` 全被吞掉。
 *
 * 本文件把两条都钉住：颜色必须落在 fill **与** stroke 上；`<i>` 的属性必须被搬过去。
 */
import { describe, expect, it } from 'vitest'
import { customizeIconSvg } from '../src/utils/icon-utils'
import { copyIconAttributes, preprocessHtml } from '../src/utils/html-preprocessor'

/** 真实 Lucide 图标（`api.iconify.design/lucide/check.svg`）：颜色写在 stroke 上 */
const LUCIDE_CHECK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">' +
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 6L9 17l-5-5"/>' +
  '</svg>'

describe('customizeIconSvg：颜色替换', () => {
  it('**描边型**图标的 stroke="currentColor" 必须被替换（这条以前漏了）', () => {
    const out = customizeIconSvg(LUCIDE_CHECK, '#DC2626', 24)
    expect(out).toContain('stroke="#DC2626"')
    expect(out).not.toMatch(/currentColor/i)
  })

  it('填充型图标的 fill="currentColor" 照样替换（保持原行为）', () => {
    const out = customizeIconSvg(
      '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h24v24H0z"/></svg>',
      '#31EFB8',
      20,
    )
    expect(out).toContain('fill="#31EFB8"')
    expect(out).not.toMatch(/currentColor/i)
  })

  it('尺寸：Iconify 的 1em 与"本地图标无尺寸"两种写法都要落到目标尺寸', () => {
    expect(customizeIconSvg(LUCIDE_CHECK, '#111111', 32)).toContain('width="32"')
    const local = customizeIconSvg('<svg viewBox="0 0 24 24"><path d="M0 0h24"/></svg>', '#111111', 16)
    expect(local).toMatch(/<svg[^>]*width="16"[^>]*height="16"/)
  })
})

describe('copyIconAttributes：把 <i> 的属性搬到 <svg> 上', () => {
  it('class / data-name / data-token-* / style 都要搬，data-icon 不搬', () => {
    const attrs = copyIconAttributes(
      '',
      ' data-name="Icon X" class="text-[24px] text-[#DC2626] p-[4px]" data-token-fill="brand/600" style="opacity:.5"',
    )
    expect(attrs).toContain('data-name="Icon X"')
    expect(attrs).toContain('class="text-[24px] text-[#DC2626] p-[4px]"')
    expect(attrs).toContain('data-token-fill="brand/600"')
    expect(attrs).toContain('style="opacity:.5"')
    expect(attrs).not.toContain('data-icon')
  })

  it('写在 data-icon 之前的属性也能拿到（beforeAttrs），重名只留第一份', () => {
    const attrs = copyIconAttributes(' data-name="前"', ' data-name="后" class="c"')
    expect(attrs).toBe('data-name="前" class="c"')
  })
})

describe('端到端：重写后属性仍在（用本地图标集，离线可跑）', () => {
  it('class 与 data-name 都出现在产出的 <svg> 上，data-icon 被消费掉', async () => {
    const html =
      '<section data-name="S"><i data-icon="ri:check-line" data-name="Icon X" class="text-[24px] text-[#DC2626]"></i></section>'
    const out = await preprocessHtml(html, {})
    expect(out.html).toContain('data-name="Icon X"')
    expect(out.html).toContain('class="text-[24px] text-[#DC2626]"')
    expect(out.html).not.toContain('data-icon')
  })
})
