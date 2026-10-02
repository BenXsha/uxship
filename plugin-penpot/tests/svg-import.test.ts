/**
 * 简单 SVG 分析器测试
 *
 * 这一层的价值在于「把图标变成一条可编辑矢量」是 Penpot 侧唯一能正常 resize/改色的做法
 * （`createShapeFromSvg` 返回的 Group 尺寸由子元素推导，resize 基本无效）。
 * 而它的风险也最大：转换错就等于把图标的形状画错，所以**拿不准时必须返回 null 回退**。
 */
import { describe, expect, it } from 'vitest'
import { analyzeSimpleSvg, normalizeSvgSize, scalePathData } from '@lib/host/svg-import'

describe('可转换的情况', () => {
  it('Remix 风格：fill 单色 path', () => {
    const result = analyzeSimpleSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#31EFB8" d="M12 2 2 22h20L12 2Z"/></svg>',
    )
    expect(result).not.toBeNull()
    expect(result?.paint).toBe('fill')
    expect(result?.color).toBe('#31efb8')
    expect(result?.d).toContain('M12 2')
    expect(result?.viewBox).toEqual({ minX: 0, minY: 0, width: 24, height: 24 })
    expect(result?.elementCount).toBe(1)
  })

  it('Lucide 风格：根标签声明 stroke，子元素不写颜色（靠继承）', () => {
    const result = analyzeSimpleSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="5" y1="5" x2="19" y2="19"/></svg>',
    )
    expect(result?.paint).toBe('stroke')
    expect(result?.color).toBe('#f87171')
    expect(result?.strokeWidth).toBe(2)
    // circle + line 都被转成路径
    expect(result?.elementCount).toBe(2)
    expect(result?.d).toMatch(/a 9 9/)
    expect(result?.d).toMatch(/M 5 5 L 19 19/)
  })

  it('子元素颜色覆盖根标签', () => {
    const result = analyzeSimpleSvg(
      '<svg viewBox="0 0 10 10" fill="#111111"><path d="M0 0h10v10H0z" fill="#222222"/></svg>',
    )
    expect(result?.color).toBe('#222222')
  })

  it('多子路径合并为一条 d（同一 Path 的多个子路径）', () => {
    const result = analyzeSimpleSvg(
      '<svg viewBox="0 0 24 24"><path fill="#fff" d="M1 1h2v2H1z"/><path fill="#fff" d="M5 5h2v2H5z"/></svg>',
    )
    expect(result!.d.split('M').length - 1).toBe(2)
    expect(result?.elementCount).toBe(2)
  })

  // 线帽：Lucide / Remix 系列线条图标默认 `stroke-linecap="round"`，而 Penpot 的 Path 默认平头 ——
  // 不提取就每个圆头图标都变方头（真机可见）。Penpot 侧有 strokeCapStart/End，所以这项能保真。
  it('提取线帽：根标签上的 stroke-linecap 被子元素继承（Lucide 写法）', () => {
    const result = analyzeSimpleSvg(
      '<svg viewBox="0 0 24 24" fill="none" stroke="#111" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/></svg>',
    )
    expect(result?.cap).toBe('ROUND')
  })

  it('提取线帽：子元素自己的 stroke-linecap 优先，square 也能认', () => {
    const result = analyzeSimpleSvg(
      '<svg viewBox="0 0 24 24" stroke="#111" stroke-linecap="round"><path stroke-linecap="square" d="M4 12h16"/></svg>',
    )
    expect(result?.cap).toBe('SQUARE')
  })

  it('未声明线帽 / butt → 不写 cap（Penpot 默认就是平头，不伪造 NONE）', () => {
    expect(analyzeSimpleSvg('<svg viewBox="0 0 10 10" stroke="#111"><path d="M0 0h10"/></svg>')?.cap).toBeUndefined()
    expect(
      analyzeSimpleSvg('<svg viewBox="0 0 10 10" stroke="#111" stroke-linecap="butt"><path d="M0 0h10"/></svg>')?.cap,
    ).toBeUndefined()
  })

  it('多种线帽 → 返回 null（一条 Path 只有一个 stroke，表达不了混合）', () => {
    const result = analyzeSimpleSvg(
      '<svg viewBox="0 0 24 24" stroke="#111"><path stroke-linecap="round" d="M0 0h10"/><path stroke-linecap="square" d="M0 5h10"/></svg>',
    )
    expect(result).toBeNull()
  })

  it('rect（含圆角）/ polygon / polyline / ellipse 都能转换', () => {
    const result = analyzeSimpleSvg(
      '<svg viewBox="0 0 40 40" fill="#fff">' +
        '<rect x="2" y="2" width="10" height="8" rx="2"/>' +
        '<polygon points="20,2 30,2 25,12"/>' +
        '<polyline points="2,20 10,24 18,20"/>' +
        '<ellipse cx="30" cy="30" rx="6" ry="4"/>' +
        '</svg>',
    )
    expect(result?.elementCount).toBe(4)
    expect(result?.d).toMatch(/A 2 2/) // 圆角
    expect(result?.d).toMatch(/Z/) // polygon 闭合
  })

  it('currentColor 视为继承（不算多色）', () => {
    const result = analyzeSimpleSvg(
      '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h24v24H0z"/></svg>',
    )
    expect(result?.color).toBeNull() // 交给调用方决定颜色
    expect(result?.paint).toBe('fill')
  })

  it('未指定颜色时按 SVG 默认的填充色处理（paint=fill）', () => {
    const result = analyzeSimpleSvg('<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>')
    expect(result?.paint).toBe('fill')
    expect(result?.color).toBeNull()
  })

  it('只有 width/height、没有 viewBox 时可用', () => {
    const result = analyzeSimpleSvg('<svg width="16" height="16"><path fill="#000" d="M0 0h4v4H0z"/></svg>')
    expect(result?.viewBox).toEqual({ minX: 0, minY: 0, width: 16, height: 16 })
  })
})

describe('必须回退（返回 null）的情况', () => {
  const cases: [string, string][] = [
    ['多色图标', '<svg viewBox="0 0 24 24"><path fill="#f00" d="M0 0h1v1H0z"/><path fill="#0f0" d="M2 2h1v1H2z"/></svg>'],
    ['混合填充与描边', '<svg viewBox="0 0 24 24"><path fill="#fff" d="M0 0h1v1H0z"/><path stroke="#fff" d="M2 2h1v1H2z"/></svg>'],
    ['多种描边宽度', '<svg viewBox="0 0 24 24" fill="none" stroke="#fff"><path stroke-width="1" d="M0 0h1v1H0z"/><path stroke-width="2" d="M2 2h1v1H2z"/></svg>'],
    ['含 transform', '<svg viewBox="0 0 24 24"><path transform="translate(2 2)" fill="#fff" d="M0 0h1v1H0z"/></svg>'],
    ['内嵌位图', '<svg viewBox="0 0 24 24"><image href="a.png" width="24" height="24"/></svg>'],
    ['含文本', '<svg viewBox="0 0 24 24"><text x="0" y="10">hi</text></svg>'],
    ['使用 use 引用', '<svg viewBox="0 0 24 24"><use href="#a"/></svg>'],
    ['含渐变定义', '<svg viewBox="0 0 24 24"><defs><linearGradient id="g"/></defs><path fill="url(#g)" d="M0 0h1v1H0z"/></svg>'],
    ['使用裁剪', '<svg viewBox="0 0 24 24"><path clip-path="url(#c)" fill="#fff" d="M0 0h1v1H0z"/></svg>'],
    ['内联样式表', '<svg viewBox="0 0 24 24"><style>.a{fill:red}</style><path class="a" d="M0 0h1v1H0z"/></svg>'],
    ['缺少尺寸信息', '<svg><path fill="#fff" d="M0 0h1v1H0z"/></svg>'],
    ['没有任何图元', '<svg viewBox="0 0 24 24"></svg>'],
    ['不是 SVG', 'hello world'],
    ['空字符串', ''],
  ]

  for (const [label, svg] of cases) {
    it(`${label} → null`, () => {
      expect(analyzeSimpleSvg(svg)).toBeNull()
    })
  }
})

describe('健壮性', () => {
  it('属性用单引号 / 无引号也能读', () => {
    expect(analyzeSimpleSvg("<svg viewBox='0 0 8 8'><path fill='#fff' d='M0 0h8v8H0z'/></svg>")?.color).toBe('#fff')
    // 无引号只能承载不含空格的值（标准的 HTML/SVG 解析规则）
    const unquoted = analyzeSimpleSvg('<svg viewBox="0 0 8 8"><path fill=#abcdef d="M0 0h8v8H0z"/></svg>')
    expect(unquoted?.color).toBe('#abcdef')
    // 含空格的 viewBox 写成无引号本来就不是合法标记，返回 null（而不是猜一个错的）
    expect(analyzeSimpleSvg('<svg viewBox=0 0 8 8><path fill="#fff" d="M0 0h8v8H0z"/></svg>')).toBeNull()
  })

  it('行内 style 优先于属性', () => {
    const result = analyzeSimpleSvg('<svg viewBox="0 0 8 8"><path fill="#111111" style="fill:#222222" d="M0 0h1v1H0z"/></svg>')
    expect(result?.color).toBe('#222222')
  })

  it('fill="none" 不会被当颜色', () => {
    const result = analyzeSimpleSvg(
      '<svg viewBox="0 0 8 8" fill="none" stroke="#abcdef"><path d="M0 0h8v8H0z"/></svg>',
    )
    expect(result?.color).toBe('#abcdef')
    expect(result?.paint).toBe('stroke')
  })

  it('非字符串输入不抛错', () => {
    expect(analyzeSimpleSvg(undefined as unknown as string)).toBeNull()
    expect(analyzeSimpleSvg(null as unknown as string)).toBeNull()
  })
})

// ───────────────────────── 按目标尺寸缩放（真机 bug 的回归） ─────────────────────────
//
// 真机现象（HTML→Penpot 渲染一页登录页后量出来的）：
//   `Email Icon` 板在 (914,321)、子 path 的墨迹**不在框内**（框内墨迹 0px）；
//   logo 被压成 27×18；特性图标只剩 17×7 的条状碎片。
// 根因：`path.d` 用的是 viewBox 坐标，而对 Path 调 `resize(w,h)` **不缩放几何** ——
// 画布上看到的是「24×24 画面里的一个 18×18 窗口」。
// 修法：写 `d` 之前就按目标尺寸缩放坐标（scalePathData），并把墨迹平移到 (0,0)。

describe('按目标尺寸缩放 path data', () => {
  it('绝对命令：坐标 × scale，并按墨迹最小值归零', () => {
    // 24×24 viewBox 里 12→20 的方块，缩放到 12×12（s=0.5），墨迹应落在 0..4
    const fitted = scalePathData('M12 2 L22 2 L22 12 Z', 0.5)
    expect(fitted).not.toBeNull()
    expect(fitted!.d).toBe('M0 0 L5 0 L5 5 Z')
    expect(fitted!.ink).toEqual({ width: 5, height: 5 })
  })

  it('相对命令只缩放增量（不加平移），H/V 单轴处理', () => {
    // 起点 (12,2) → 平移归零；h20 是增量 → 只 ×0.5
    const fitted = scalePathData('M12 2 h20 v20 h-20 Z', 0.5)
    expect(fitted!.d).toBe('M0 0 h10 v10 h-10 Z')
    expect(fitted!.ink).toEqual({ width: 10, height: 10 })
  })

  it('圆弧：rx/ry 缩放，rotation/flags 不动，终点按绝对/相对分别处理', () => {
    const fitted = scalePathData('M10 10 A 8 8 0 1 0 18 10', 0.5)
    // rx/ry 8→4；rotation 0 / largeArc 1 / sweep 0 原样；终点 (18,10) → (18-10)*0.5 = 4
    expect(fitted!.d).toBe('M0 0 A4 4 0 1 0 4 0')
  })

  it('多次 M 子路径 / 闭合 / 科学计数法都能过', () => {
    const fitted = scalePathData('M0 0 L10 0 M20 0 L30 0 Z', 1)
    expect(fitted!.d).toBe('M0 0 L10 0 M20 0 L30 0 Z')
    const sci = scalePathData('M1e1 1e1 L2e1 2e1', 0.5)
    expect(sci!.d).toBe('M0 0 L5 5')
  })

  it('非整数结果不能被二次缩放（7.5 不能变成 5.625）', () => {
    // 回归：格式化时误用了会乘 scale 的 helper → 已变换的值被再乘一次 scale，
    // 且**整数看起来正常**（15 不变），所以只有非整数比例能暴露它
    const fitted = scalePathData('M12 2 L22 2 L22 22 L12 22 Z', 0.75)!
    expect(fitted.d).toBe('M0 0 L7.5 0 L7.5 15 L0 15 Z')
    expect(fitted.ink).toEqual({ width: 7.5, height: 15 })
  })

  it('非法输入返回 null（由调用方回退到 createShapeFromSvg）', () => {
    expect(scalePathData('M0 0 L', 1)).toBeNull()
    expect(scalePathData('', 1)).toBeNull()
  })
})

describe('analyzeSimpleSvg 的目标尺寸', () => {
  const ICON = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 L22 2 L22 12 Z"/></svg>'

  it('给了目标尺寸 → 坐标缩放到目标内（不再依赖 resize）', () => {
    const a = analyzeSimpleSvg(ICON, { width: 12, height: 12 })!
    expect(a.scale).toBeCloseTo(0.5, 6)
    // 墨迹 10×10 → 缩放到 5×5
    expect(a.ink).toEqual({ width: 5, height: 5 })
    expect(a.d).toBe('M0 0 L5 0 L5 5 Z')
  })

  it('没给目标尺寸 → 保持原样（形状自然尺寸即墨迹尺寸）', () => {
    const a = analyzeSimpleSvg(ICON)!
    expect(a.scale).toBe(1)
    expect(a.d).toBe('M12 2 L22 2 L22 12 Z')
    expect(a.ink).toEqual({ width: 10, height: 10 })
  })

  it('非等比目标按较小比例缩放（与浏览器 preserveAspectRatio 同口径）', () => {
    const a = analyzeSimpleSvg(ICON, { width: 24, height: 12 })!
    expect(a.scale).toBeCloseTo(0.5, 6)
  })

  it('描边宽度跟着缩放（否则小图标的线会显得过粗）', () => {
    const strokeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4 L20 20"/></svg>'
    const a = analyzeSimpleSvg(strokeIcon, { width: 12, height: 12 })!
    expect(a.strokeWidth).toBeCloseTo(1, 6)
  })
})

describe('normalizeSvgSize（回退路径用）', () => {
  it('改写 1em 尺寸为像素尺寸（Iconify 返回的就是 1em）', () => {
    const out = normalizeSvgSize('<svg width="1em" height="1em" viewBox="0 0 24 24"><path d="M0 0"/></svg>', { width: 18, height: 18 })
    expect(out).toContain('width="18"')
    expect(out).toContain('height="18"')
    expect(out).not.toContain('1em')
    expect(out).toContain('viewBox="0 0 24 24"') // viewBox 不动，靠它等比放大
  })

  it('只给一个维度时按 viewBox 比例推另一个', () => {
    const out = normalizeSvgSize('<svg viewBox="0 0 24 12"><path d="M0 0"/></svg>', { width: 40 })
    expect(out).toContain('width="40"')
    expect(out).toContain('height="20"')
  })

  it('没有目标尺寸 / 不是 svg 时原样返回', () => {
    const svg = '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>'
    expect(normalizeSvgSize(svg, {})).toBe(svg)
    expect(normalizeSvgSize('not an svg', { width: 10 })).toBe('not an svg')
  })
})
