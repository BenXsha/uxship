import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { auditA11y, contrastRatio, parseDescribeRoots } from '../src/utils/a11y-review.js'

/**
 * P1-3 可访问性自动检查的回归。
 *
 * 这里的重点是**两种宿主的 describe 形态都要成立**：
 *   - MasterGo：`{ tree }`，样式在 `node.fills`（hex 字符串）/ `node.style.textColor` / `node.stroke.weight`
 *   - Penpot：`{ nodes:[…] }`，样式在 `node.style.fills`（`"#hex @100%"`）/ `node.style.strokes`（`"#hex w=2"`）
 *
 * 原来的对比度检查要求 `{r,g,b}` 对象（两个宿主都不这么给）→ 恒不触发；tree 解析只认 `{tree}`
 * → Penpot 恒空。这两条死路径正是本文件要钉住的。
 */

describe('parseDescribeRoots：兼容两宿主的 describe 形态', () => {
  it('MasterGo：{ tree } → 单根数组', () => {
    const roots = parseDescribeRoots({ tree: { name: 'Card', type: 'FRAME' } })
    expect(roots).toHaveLength(1)
    expect(roots[0].name).toBe('Card')
  })

  it('Penpot：{ nodes:[…] } → 多根数组（原实现恒得 {}）', () => {
    const roots = parseDescribeRoots({ ok: true, summary: {}, nodes: [{ name: 'A' }, { name: 'B' }] })
    expect(roots.map((node) => node.name)).toEqual(['A', 'B'])
  })

  it('异常输入 → 空数组（不抛）', () => {
    expect(parseDescribeRoots(null)).toEqual([])
    expect(parseDescribeRoots('x')).toEqual([])
    expect(parseDescribeRoots({})).toEqual([])
  })
})

describe('contrastRatio：真正的 WCAG 相对亮度', () => {
  it('白底黑字 = 21:1，白底白字 = 1:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
  })

  it('#777777 on #FFFFFF ≈ 4.48（正常字号差一点，大字号达标）', () => {
    const ratio = contrastRatio('#777777', '#FFFFFF')
    expect(ratio).not.toBeNull()
    expect(ratio as number).toBeGreaterThan(4.4)
    expect(ratio as number).toBeLessThan(4.5)
  })
})

describe('对比度审计', () => {
  const penpotText = (over: Record<string, unknown> = {}) => ({
    name: 'Body',
    type: 'text',
    text: '正文',
    w: 100,
    h: 20,
    style: { fills: ['#0F172A @100%'], fontSize: 14 },
    ...over,
  })

  it('Penpot 形态：取祖先 style.fills 作背景，达标不报', () => {
    const roots = [{ name: 'Card', type: 'frame', style: { fills: ['#FFFFFF @100%'] }, children: [penpotText()] }]
    const result = auditA11y(roots)
    expect(result.issues).toEqual([])
    expect(result.checked.text).toBe(1)
  })

  it('Penpot 形态：低对比度报 error（带 foreground/background 证据）', () => {
    const roots = [{
      name: 'Card',
      type: 'frame',
      style: { fills: ['#FFFFFF @100%'] },
      children: [penpotText({ style: { fills: ['#777777 @100%'], fontSize: 14 } })],
    }]
    const result = auditA11y(roots)
    const issue = result.issues.find((i) => i.rule === 'contrast')
    expect(issue?.severity).toBe('error')
    expect(issue?.evidence).toMatchObject({ foreground: '#777777', background: '#FFFFFF', required: 4.5 })
    expect(issue?.path).toContain('Body')
  })

  it('大字号阈值 3:1：#777777 在 24px 下不报', () => {
    const roots = [{
      name: 'Card',
      type: 'frame',
      style: { fills: ['#FFFFFF @100%'] },
      children: [penpotText({ style: { fills: ['#777777 @100%'], fontSize: 24 } })],
    }]
    expect(auditA11y(roots).issues).toEqual([])
  })

  it('MasterGo 形态：node.fills + style.textColor', () => {
    const roots = [{
      name: 'Card',
      type: 'FRAME',
      fills: ['#FFFFFF'],
      width: 200,
      height: 100,
      children: [{ name: 'Label', type: 'TEXT', text: 'Hi', width: 50, height: 16, fills: ['#111111'], style: { textColor: '#111111', fontSize: 14 } }],
    }]
    const result = auditA11y(roots)
    expect(result.issues).toEqual([])
    expect(result.checked.text).toBe(1)
  })

  it('半透明填充不当作背景 → 进 skipped（不谎报通过）', () => {
    const roots = [{
      name: 'Card',
      type: 'frame',
      style: { fills: ['#FFFFFF @40%'] },
      children: [penpotText()],
    }]
    const result = auditA11y(roots)
    expect(result.issues).toEqual([])
    expect(result.skipped.some((s) => s.includes('取不到不透明背景色'))).toBe(true)
  })
})

describe('焦点环审计', () => {
  it('`_Focus` 成员有 ≥2px 描边 → 通过；无描边 → error', () => {
    const ok = auditA11y([{ name: 'Input_Default_Focus', type: 'frame', w: 240, h: 44, style: { strokes: ['#4340EA w=2'] } }])
    expect(ok.issues).toEqual([])

    const bad = auditA11y([{ name: 'Input_Default_Focus', type: 'frame', w: 240, h: 44, style: { strokes: ['#4340EA w=1'] } }])
    const issue = bad.issues.find((i) => i.rule === 'focus-ring')
    expect(issue?.severity).toBe('error')
    expect(issue?.evidence).toMatchObject({ strokeWeight: 1, required: 2 })
  })

  it('MasterGo 形态：node.stroke.weight', () => {
    expect(auditA11y([{ name: 'Btn_Focus', type: 'FRAME', width: 44, height: 44, stroke: { color: '#4340EA', weight: 2 } }]).issues).toEqual([])
  })

  it('文档用的 `State-Focus`（非 `_Focus` 后缀）不参与检查', () => {
    const result = auditA11y([{ name: 'State-Focus', type: 'frame', w: 160, h: 60 }])
    expect(result.issues).toEqual([])
    expect(result.checked.focus).toBe(0)
  })
})

describe('最小点击区审计', () => {
  it('32–44 之间 → warning；< 32 → error；≥ 44 → 通过', () => {
    const warn = auditA11y([{ name: 'Button_Primary_Default', type: 'frame', w: 120, h: 40 }])
    expect(warn.issues.map((i) => i.severity)).toEqual(['warning'])

    const err = auditA11y([{ name: 'Button_Primary_Default', type: 'frame', w: 120, h: 24 }])
    expect(err.issues[0]).toMatchObject({ rule: 'hit-area', severity: 'error' })

    expect(auditA11y([{ name: 'Toggle_Default_On', type: 'frame', w: 44, h: 44 }]).issues).toEqual([])
  })

  it('名字里没有交互角色词 → 不检查点击区', () => {
    const result = auditA11y([{ name: 'Hero Banner', type: 'frame', w: 20, h: 20 }])
    expect(result.issues).toEqual([])
    expect(result.checked.interactive).toBe(0)
  })

  it('Penpot 形态：w/h 与 MasterGo 形态 width/height 都认', () => {
    expect(auditA11y([{ name: 'Input_Default', type: 'frame', w: 240, h: 40 }]).checked.interactive).toBe(1)
    expect(auditA11y([{ name: 'Input_Default', type: 'FRAME', width: 240, height: 40 }]).checked.interactive).toBe(1)
  })
})

/**
 * 模板文本色的 WCAG 门禁 —— 直接扫 `ds-library.html` 里所有 `text-[#hex]`。
 * 真机 `design_review` 曾在这里报出 30+ 条对比度 error（`#94A3B8` 只有 2.45:1），
 * 修复后必须每个都达标，否则下次改模板又会静默退化。
 */
describe('ds-library.html 模板文本色全部达标（WCAG AA）', () => {
  const TEMPLATE_URL = new URL('../../skills/design/templates/ds-library.html', import.meta.url)
  // 模板里文字所在的两种浅底色（白 / 极浅灰）
  const BACKGROUNDS = ['#FFFFFF', '#F8FAFC']

  it('每个 text-[#hex] 对浅底色都 ≥ 4.5:1', () => {
    const html = readFileSync(TEMPLATE_URL, 'utf8')
    const colors = [...new Set([...html.matchAll(/text-\[#([0-9A-Fa-f]{6})\]/g)].map((m) => `#${m[1].toUpperCase()}`))]
    expect(colors.length).toBeGreaterThan(3)
    for (const color of colors) {
      for (const background of BACKGROUNDS) {
        const ratio = contrastRatio(color, background) as number
        expect(ratio, `${color} on ${background} = ${ratio?.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('组件主题的两个受质疑色也已修正（placeholder / warning 文字）', () => {
    // 旧值：placeholder #AAAAAA 在白色上 2.32:1；warning #CC7A00 在 #FFF3E0 上 3.01:1
    expect(contrastRatio('#64748B', '#FFFFFF') as number).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#92400E', '#FFF3E0') as number).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#92400E', '#FFF8E1') as number).toBeGreaterThanOrEqual(4.5)
  })
})
