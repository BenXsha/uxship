const TAILWIND_ARB_MAP: Record<string, string> = {
  w: 'width', h: 'height',
  p: 'padding', px: 'padding-left|padding-right', py: 'padding-top|padding-bottom',
  pt: 'padding-top', pr: 'padding-right', pb: 'padding-bottom', pl: 'padding-left',
  m: 'margin', mx: 'margin-left|margin-right', my: 'margin-top|margin-bottom',
  mt: 'margin-top', mb: 'margin-bottom',
  gap: 'gap',
  bg: 'background-color',
  rounded: 'border-radius',
  'rounded-t': 'border-top-left-radius|border-top-right-radius',
  'rounded-r': 'border-top-right-radius|border-bottom-right-radius',
  'rounded-b': 'border-bottom-left-radius|border-bottom-right-radius',
  'rounded-l': 'border-top-left-radius|border-bottom-left-radius',
  'rounded-tl': 'border-top-left-radius',
  'rounded-tr': 'border-top-right-radius',
  'rounded-bl': 'border-bottom-left-radius',
  'rounded-br': 'border-bottom-right-radius',
  leading: 'line-height', tracking: 'letter-spacing',
  opacity: 'opacity',
  inset: 'inset', top: 'top', bottom: 'bottom', left: 'left', right: 'right',
  'max-w': 'max-width', 'min-w': 'min-width', 'max-h': 'max-height', 'min-h': 'min-height',
}

/** 中性色子集（高频）：其余 Tailwind 调色板不入白名单，会被收集并告警，提示改用任意值 */
const SIMPLE_COLORS: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  transparent: 'rgba(0,0,0,0)',
}

const GRAY: Record<string, string> = {
  50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db', 400: '#9ca3af',
  500: '#6b7280', 600: '#4b5563', 700: '#374151', 800: '#1f2937', 900: '#111827', 950: '#030712',
}

const SLATE: Record<string, string> = {
  50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8',
  500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a', 950: '#020617',
}

/** 圆角（Tailwind 默认刻度；`rounded-[Npx]` 走任意值分支） */
const RADIUS_SCALE: Record<string, string> = {
  none: '0', sm: '0.125rem', DEFAULT: '0.25rem', md: '0.375rem',
  lg: '0.5rem', xl: '0.75rem', '2xl': '1rem', '3xl': '1.5rem',
}

/** 阴影（Tailwind 默认值；`shadow-[...]` 走任意值分支） */
const SHADOW_SCALE: Record<string, string> = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
}

const LEADING_SCALE: Record<string, string> = {
  none: '1', tight: '1.25', snug: '1.375', normal: '1.5', relaxed: '1.625', loose: '2',
}

/** 由元素级逻辑单独消费的 class（渐变聚合 / bg-opacity），不算“未解析” */
const HANDLED_ELSEWHERE = [
  /^bg-gradient-to-/, /^from-\[/, /^via-\[/, /^to-\[/, /^bg-opacity-\d+$/,
]

/**
 * 会被渲染成 MasterGo **text 节点**的标签（与 useClientRender 的 inline text 名单一致）。
 *
 * text 节点只有文字颜色（fills），没有背景、内边距、圆角 —— 这些能力必须由外层 frame 提供。
 */
const TEXT_LIKE_TAGS = new Set([
  'p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'strong', 'a', 'label',
  'li', 'b', 'i', 'u', 's', 'small', 'sub', 'sup', 'code', 'pre', 'blockquote',
  'figcaption', 'cite', 'time',
])

/**
 * 文本元素上**必须拦下**的 class：
 * - 背景（`bg-*` / 渐变停靠点 `from-*` `via-*` `to-*` / `bg-opacity-*`）
 * - 内边距（`p-*` `px-*` `py-*` `pt-*` `pr-*` `pb-*` `pl-*`，含任意值写法）
 * - 圆角（`rounded` / `rounded-*`）
 *
 * 动机（用户实测的真实缺陷 F-渲染器）：`<p class="bg-[rgba(60,60,67,0.10)] px-2">Ctrl</p>`
 * 渲染后该 text 节点的 `fills` 被写成那层 10% 灰 —— 等于用 10% 不透明度画文字，整排快捷键看不见。
 * 根因链路：本解析器把 `bg-*` 写成元素内联 `background-color` → `useClientRender.extractNode`
 * 里 `extractBackgroundFills` 把它落到 `node.fills` → 之后 `extractTextContent` 因为
 * `!node.fills` 已有值而**不再写文字颜色**，于是背景色顶掉了文字色。
 *
 * 因此文本元素上的这些 class 一律不落到元素本身（背景不会生成，文字颜色也不会被顶掉），
 * 改为汇总成画布告警，引导用户把「背景/圆角/内边距」移到外层 `<section>`。
 */
const TEXT_LAYOUT_HAZARD_PATTERNS = [
  /^bg-/,                       // bg-[...] / bg-white / bg-gray-100 / bg-gradient-to-r / bg-opacity-50
  /^from-\[/, /^via-\[/, /^to-\[/, // 渐变停靠点（配合 bg-gradient-* 生成 background-image）
  /^p[xytblr]?-/,               // padding：p-4 / px-2 / pt-[6px] …
  /^rounded(?:$|-)/,            // 圆角：rounded / rounded-lg / rounded-[16px]
]

/** 标签名是否会被渲染成 text 节点 */
export function isTextLikeTag(tagName: string | null | undefined): boolean {
  if (!tagName) return false
  return TEXT_LIKE_TAGS.has(String(tagName).toLowerCase())
}

/**
 * 挑出「落在文本元素上会被静默丢弃 / 污染文字颜色」的 class（纯函数，便于单测）。
 *
 * 非文本标签（`<section>` / `<div>` 等 frame）一律返回空数组 —— 背景与内边距放在那里是正确写法。
 *
 * `textContent` 传入时用于判「该 text 元素到底有没有文字」：
 * 空 `<p class="bg-x w-5 h-5"></p>` 会被渲染成 rectangle/frame（背景是合理的，也确实要保留），
 * 而只有真有文字时，背景才会被当成文字颜色 —— 所以「无文字 → 不是 hazard」。
 * 不传（`undefined`）时按「可能有文字」保守拦截。
 */
export function collectTextLayoutHazardClasses(
  classAttr: string | null | undefined,
  tagName: string | null | undefined,
  textContent?: string | null,
): string[] {
  if (!classAttr || !isTextLikeTag(tagName)) return []
  // 没有文字就没有「文字被背景染色」的 hazard：让背景/内边距照旧生效
  if (typeof textContent === 'string' && textContent.trim() === '') return []
  return classAttr
    .split(/\s+/)
    .filter((cls) => !!cls && TEXT_LAYOUT_HAZARD_PATTERNS.some((re) => re.test(cls)))
}

/** 文本元素上背景/内边距/圆角的可读替代写法提示（会随 `dsl/render` 响应回传并弹画布告警） */
export const TEXT_LAYOUT_HAZARD_HINT =
  '文本元素上的背景会被当成文字颜色（文字可能整排看不见），内边距/圆角也无处落地；' +
  '请把背景、圆角、内边距写到外层 <section>，<p>/<span> 只保留文字与颜色'

/** 按 Tailwind 默认调色板取色（仅中性色子集） */
function namedColorHex(family: string, shade: string): string | null {
  if (family === 'gray') return GRAY[shade] ?? null
  if (family === 'slate') return SLATE[shade] ?? null
  return null
}

/**
 * 从 class 属性里挑出**解析不了**的 class（纯函数，便于单测与告警）。
 *
 * 动机：解析器是白名单制，未命中的 class 会被**静默丢弃**，用户只看到“样式莫名没生效”。
 * 渲染流程会把本函数的结果回传到 `dsl/render` 响应（`unresolvedClasses`）与插件通知。
 */
export function collectUnresolvedClasses(classAttr: string | null | undefined): string[] {
  if (!classAttr) return []
  const out: string[] = []
  for (const cls of classAttr.split(/\s+/)) {
    if (!cls) continue
    if (HANDLED_ELSEWHERE.some((re) => re.test(cls))) continue
    if (resolveTailwindStyle(cls) === null) out.push(cls)
  }
  return out
}

/** 单个 class → 内联样式字符串（导出供单测与调试；未命中返回 null） */
export function resolveTailwindStyle(className: string): string | null {
  const negArb = className.match(/^-(\w[\w-]*)-\[([^\]]+)\]$/)
  if (negArb) {
    const prefix = negArb[1]
    const rawValue = negArb[2]
    const cssProp = TAILWIND_ARB_MAP[prefix]
    if (cssProp) {
      const numMatch = rawValue.match(/^(-?\d+(?:\.\d+)?)(px)?$/)
      if (numMatch) {
        const negValue = -parseFloat(numMatch[1]) + (numMatch[2] || '')
        if (cssProp.includes('|')) return cssProp.split('|').map(p => `${p}:${negValue}`).join(';')
        return `${cssProp}:${negValue}`
      }
    }
    return null
  }
  const arb = className.match(/^(\w[\w-]*)-\[([^\]]+)\]$/)
  if (arb) {
    const prefix = arb[1]
    const value = arb[2]
    if (prefix === 'text') return value.startsWith('#') ? `color:${value}` : `font-size:${value}`
    if (prefix === 'font') return `font-weight:${value}`
    if (prefix === 'border') {
      if (value.startsWith('#') || value.startsWith('rgb')) return `border-color:${value}`
      return `border-style:solid;border-width:${value}`
    }
    const dirBorderMatch = prefix.match(/^border-([trblxy])$/)
    if (dirBorderMatch) {
      const dirMap: Record<string, string> = { t: 'top', b: 'bottom', l: 'left', r: 'right', x: 'left|right', y: 'top|bottom' }
      const dirs = dirMap[dirBorderMatch[1]].split('|')
      if (value.startsWith('#') || value.startsWith('rgb')) return dirs.map(d => `border-${d}-color:${value}`).join(';')
      return dirs.map(d => `border-${d}-width:${value};border-${d}-style:solid`).join(';')
    }
    if (prefix === 'outline') return `outline:${value}`
    if (prefix === 'shadow') {
      const shadowValue = value.replace(/_/g, ' ').replace(/,/g, ', ')
      return `box-shadow:${shadowValue}`
    }
    if (prefix === 'bg') {
      if (value.startsWith('linear-gradient') || value.startsWith('radial-gradient') || value.startsWith('conic-gradient')) {
        return `background-image:${value}`
      }
      return `background-color:${value}`
    }
    if (prefix === 'blur') return `filter:blur(${value})`
    const cssProp = TAILWIND_ARB_MAP[prefix]
    if (cssProp) {
      if (cssProp.includes('|')) return cssProp.split('|').map(p => `${p}:${value}`).join(';')
      return `${cssProp}:${value}`
    }
    return null
  }
  const named: Record<string, string> = {
    flex: 'display:flex', 'inline-flex': 'display:inline-flex',
    'flex-col': 'flex-direction:column', 'flex-row': 'flex-direction:row',
    'flex-wrap': 'flex-wrap:wrap', 'flex-nowrap': 'flex-wrap:nowrap', 'flex-1': 'flex:1',
    'items-center': 'align-items:center', 'items-start': 'align-items:flex-start',
    'items-end': 'align-items:flex-end', 'items-stretch': 'align-items:stretch',
    'justify-center': 'justify-content:center', 'justify-between': 'justify-content:space-between',
    'justify-start': 'justify-content:flex-start', 'justify-end': 'justify-content:flex-end',
    'text-center': 'text-align:center', 'text-left': 'text-align:left', 'text-right': 'text-align:right',
    'font-bold': 'font-weight:700', 'font-semibold': 'font-weight:600',
    'font-medium': 'font-weight:500', 'font-normal': 'font-weight:400', 'font-light': 'font-weight:300',
    italic: 'font-style:italic', underline: 'text-decoration:underline',
    truncate: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
    border: 'border:1px solid',
    'border-t': 'border-top:1px solid', 'border-b': 'border-bottom:1px solid',
    'border-l': 'border-left:1px solid', 'border-r': 'border-right:1px solid',
    'rounded-full': 'border-radius:9999px',
    hidden: 'display:none', block: 'display:block', 'inline-block': 'display:inline-block',
    relative: 'position:relative', absolute: 'position:absolute', fixed: 'position:fixed',
    'w-full': 'width:100%', 'h-full': 'height:100%', 'w-screen': 'width:100vw', 'h-screen': 'height:100vh',
    'overflow-hidden': 'overflow:hidden', 'overflow-auto': 'overflow:auto',
    'whitespace-nowrap': 'white-space:nowrap',
    'object-cover': 'object-fit:cover', 'object-contain': 'object-fit:contain',
    'flex-shrink-0': 'flex-shrink:0', 'flex-grow-0': 'flex-grow:0',
    'ml-auto': 'margin-left:auto', 'mr-auto': 'margin-right:auto',
    'mt-auto': 'margin-top:auto', 'mb-auto': 'margin-bottom:auto',
    'mx-auto': 'margin-left:auto;margin-right:auto',
    'my-auto': 'margin-top:auto;margin-bottom:auto',
    'backdrop-blur-sm': 'backdrop-filter:blur(4px)', 'backdrop-blur': 'backdrop-filter:blur(8px)',
    'backdrop-blur-md': 'backdrop-filter:blur(12px)', 'backdrop-blur-lg': 'backdrop-filter:blur(16px)',
    'backdrop-blur-xl': 'backdrop-filter:blur(24px)', 'backdrop-blur-2xl': 'backdrop-filter:blur(40px)',
    'blur-sm': 'filter:blur(4px)', 'blur': 'filter:blur(8px)', 'blur-md': 'filter:blur(12px)',
    'blur-lg': 'filter:blur(16px)', 'blur-xl': 'filter:blur(24px)', 'blur-2xl': 'filter:blur(40px)',
  }
  const spacingScale: Record<string, string> = {
    '0': '0', 'px': '1px',
    '0.5': '0.125rem', '1': '0.25rem', '1.5': '0.375rem',
    '2': '0.5rem', '2.5': '0.625rem', '3': '0.75rem', '3.5': '0.875rem',
    '4': '1rem', '5': '1.25rem', '6': '1.5rem', '7': '1.75rem',
    '8': '2rem', '9': '2.25rem', '10': '2.5rem', '11': '2.75rem',
    '12': '3rem', '14': '3.5rem', '16': '4rem', '20': '5rem', '24': '6rem',
    '28': '7rem', '32': '8rem', '36': '9rem', '40': '10rem', '44': '11rem',
    '48': '12rem', '52': '13rem', '56': '14rem', '60': '15rem', '64': '16rem',
    '72': '18rem', '80': '20rem', '96': '24rem',
  }
  const whMatch = className.match(/^([wh])-(\d+(?:\.\d+)?)$/)
  if (whMatch) {
    const val = spacingScale[whMatch[2]]
    if (val) return `${whMatch[1] === 'w' ? 'width' : 'height'}:${val}`
    return null
  }
  const pMatch = className.match(/^p([xytrbl])?-(\d+(?:\.\d+)?)$/)
  if (pMatch) {
    const val = spacingScale[pMatch[2]]
    if (val) {
      const dir = pMatch[1]
      if (!dir) return `padding:${val}`
      if (dir === 'x') return `padding-left:${val};padding-right:${val}`
      if (dir === 'y') return `padding-top:${val};padding-bottom:${val}`
      if (dir === 't') return `padding-top:${val}`
      if (dir === 'b') return `padding-bottom:${val}`
      if (dir === 'l') return `padding-left:${val}`
      if (dir === 'r') return `padding-right:${val}`
    }
    return null
  }
  const mMatch = className.match(/^m([xytrbl])?-(\d+(?:\.\d+)?)$/)
  if (mMatch) {
    const val = spacingScale[mMatch[2]]
    if (val) {
      const dir = mMatch[1]
      if (!dir) return `margin:${val}`
      if (dir === 'x') return `margin-left:${val};margin-right:${val}`
      if (dir === 'y') return `margin-top:${val};margin-bottom:${val}`
      if (dir === 't') return `margin-top:${val}`
      if (dir === 'b') return `margin-bottom:${val}`
      if (dir === 'l') return `margin-left:${val}`
      if (dir === 'r') return `margin-right:${val}`
    }
    return null
  }
  const gapMatch = className.match(/^gap-(\d+(?:\.\d+)?)$/)
  if (gapMatch) {
    const val = spacingScale[gapMatch[1]]
    if (val) return `gap:${val}`
    return null
  }
  const textSizeMatch = className.match(/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/)
  if (textSizeMatch) {
    const fontSizes: Record<string, string> = {
      xs: '0.75rem', sm: '0.875rem', base: '1rem', lg: '1.125rem',
      xl: '1.25rem', '2xl': '1.5rem', '3xl': '1.875rem', '4xl': '2.25rem',
      '5xl': '3rem', '6xl': '3.75rem', '7xl': '4.5rem', '8xl': '6rem', '9xl': '8rem',
    }
    return `font-size:${fontSizes[textSizeMatch[1]]}`
  }
  // —— 颜色（white/black/transparent + gray/slate 调色板）
  const simpleColor = className.match(/^(text|bg|border)-(white|black|transparent)$/)
  if (simpleColor) {
    const hex = SIMPLE_COLORS[simpleColor[2]]
    return colorStyle(simpleColor[1], hex)
  }
  const paletteColor = className.match(/^(text|bg|border)-(gray|slate)-(\d{2,3})$/)
  if (paletteColor) {
    const hex = namedColorHex(paletteColor[2], paletteColor[3])
    if (!hex) return null
    return colorStyle(paletteColor[1], hex)
  }

  // —— 圆角（miss 时落到 named，保留 rounded-full 等已有条目）
  if (className === 'rounded') return `border-radius:${RADIUS_SCALE.DEFAULT}`
  if (className.startsWith('rounded-')) {
    const value = RADIUS_SCALE[className.slice('rounded-'.length)]
    if (value !== undefined) return `border-radius:${value}`
  }

  // —— 阴影
  if (className === 'shadow') return `box-shadow:${SHADOW_SCALE.DEFAULT}`
  if (className.startsWith('shadow-')) {
    const value = SHADOW_SCALE[className.slice('shadow-'.length)]
    if (value !== undefined) return `box-shadow:${value}`
  }

  // —— 行高倍数
  if (className.startsWith('leading-')) {
    const value = LEADING_SCALE[className.slice('leading-'.length)]
    if (value !== undefined) return `line-height:${value}`
  }

  // —— 透明度 / 层级
  const opacityMatch = className.match(/^opacity-(\d{1,3})$/)
  if (opacityMatch) return `opacity:${Number(opacityMatch[1]) / 100}`
  const zMatch = className.match(/^z-(\d{1,3})$/)
  if (zMatch) return `z-index:${zMatch[1]}`

  return named[className] || null
}

function colorStyle(kind: string, hex: string): string {
  if (kind === 'text') return `color:${hex}`
  if (kind === 'bg') return `background-color:${hex}`
  return `border-color:${hex}`
}

function cssPropertyToJs(property: string): string {
  if (property.includes('-')) {
    return property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
  }
  return property
}

function applyTailwindToElement(el: Element): string[] {
  const classes = el.getAttribute('class')
  if (!classes) return []
  const elName = el.getAttribute('data-name') || el.tagName

  // 文本元素上的背景/内边距/圆角：不落到元素本身（背景会被当文字颜色用，文字就看不见了）
  const hazardClasses = new Set(collectTextLayoutHazardClasses(classes, el.tagName, el.textContent))

  // 累积渐变类，需要聚合成一个 background-image
  let gradientDir: string | null = null
  let gradientFrom: string | null = null
  let gradientVia: string | null = null
  let gradientTo: string | null = null
  let bgOpacity: number | null = null

  const DIR_MAP: Record<string, string> = {
    t: 'to top', tr: 'to top right', r: 'to right', br: 'to bottom right',
    b: 'to bottom', bl: 'to bottom left', l: 'to left', tl: 'to top left',
  }

  for (const cls of classes.split(/\s+/)) {
    if (hazardClasses.has(cls)) continue

    const dirMatch = cls.match(/^bg-gradient-to-(t[rl]?|b[rl]?|[rl])$/)
    if (dirMatch) { gradientDir = DIR_MAP[dirMatch[1]]; continue }

    const fromMatch = cls.match(/^from-\[(#[0-9a-fA-F]+)\]$/)
    if (fromMatch) { gradientFrom = fromMatch[1]; continue }
    const viaMatch = cls.match(/^via-\[(#[0-9a-fA-F]+)\]$/)
    if (viaMatch) { gradientVia = viaMatch[1]; continue }
    const toMatch = cls.match(/^to-\[(#[0-9a-fA-F]+)\]$/)
    if (toMatch) { gradientTo = toMatch[1]; continue }

    const opacityMatch = cls.match(/^bg-opacity-(\d+)$/)
    if (opacityMatch) { bgOpacity = parseInt(opacityMatch[1]) / 100; continue }

    const style = resolveTailwindStyle(cls)
    if (style) {
      if (cls.includes('shadow')) {
        console.log(`[DEBUG-SHADOW-APPLY] Applying shadow class "${cls}" to "${elName}":`, style)
      }
      const parts = style.split(';')
      for (const part of parts) {
        const colonIdx = part.indexOf(':')
        if (colonIdx === -1) continue
        const prop = part.substring(0, colonIdx).trim()
        const val = part.substring(colonIdx + 1).trim()
        if (prop && val) {
          (el as HTMLElement).style[cssPropertyToJs(prop) as any] = val
          if (prop === 'box-shadow') {
            console.log(`[DEBUG-SHADOW-STYLE] Set boxShadow style for "${elName}":`, val)
          }
          // 记录 border-radius 值供 extractNode 使用
          if (prop.startsWith('border-') && prop.endsWith('-radius')) {
            const existing = el.getAttribute('data-br') || ''
            const entry = prop + ':' + val
            el.setAttribute('data-br', existing ? existing + '|' + entry : entry)
          }
        }
      }
    }
  }

  if (bgOpacity !== null && (el as HTMLElement).style.backgroundColor) {
    const bg = (el as HTMLElement).style.backgroundColor
    const hexMatch = bg.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/)
    const rgbMatch = bg.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/)
    if (hexMatch) {
      const r = parseInt(hexMatch[1], 16); const g = parseInt(hexMatch[2], 16); const b = parseInt(hexMatch[3], 16)
      ;(el as HTMLElement).style.backgroundColor = `rgba(${r},${g},${b},${bgOpacity})`
    } else if (rgbMatch) {
      ;(el as HTMLElement).style.backgroundColor = `rgba(${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]},${bgOpacity})`
    }
  }

  // 渐变类聚合：设置 background-image
  if (gradientDir && gradientFrom && gradientTo) {
    const stops = [gradientFrom]
    if (gradientVia) stops.push(gradientVia)
    stops.push(gradientTo)
    ;(el as HTMLElement).style.backgroundImage = `linear-gradient(${gradientDir}, ${stops.join(', ')})`
  }

  // ── preflight 对齐（**不是可选项**）──
  //
  // 这条链路**没有加载任何 Tailwind CSS**：class 全靠本解析器翻成内联样式。
  // 于是 Tailwind preflight 负责的两件事都没人做，浏览器 UA 默认样式直接生效：
  //
  //   1. `box-sizing` 默认是 `content-box` → `w-[300px] p-[14px]` 实际占 328（尺寸把 padding
  //      又加了一遍）。实测：`B Box` 被算成 328×76，而 CSS 意图是 300×48。
  //   2. `p` 等标签自带 `margin: 1em 0` → **每个包文字的容器高度 +2em**。
  //      实测：14px 文本 + leading-[20px] 的包裹层是 48 高（20 + 14 + 14），
  //      而不是 20 —— 一页登录页里 4 个这样的包裹层全部偏高，文本框里的文字也因此看起来
  //      “没垂直居中”（下边多出一条 margin 占位）。
  //
  // 只作用于**被注入渲染的那棵子树**（本函数只遍历容器内元素），不会外溢到插件 UI 自身。
  applyPreflightDefaults(el as HTMLElement, classes)

  // 未解析的 class 向上返回，供渲染结果与插件通知展示
  return Array.from(new Set([...collectUnresolvedClasses(classes), ...hazardClasses]))
}

/** 自带 UA margin 的标签（preflight 会归零的那些） */
const UA_MARGIN_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'figure', 'dl', 'dd', 'pre', 'ul', 'ol'])

/** class 里是否显式给了 margin（`m-*` / `mx-*` / `mt-*` …）—— 给了就尊重作者 */
function hasMarginUtility(classes: string): boolean {
  return classes.split(/\s+/).some((cls) => /^-?m[trblxy]?-/.test(cls))
}

/**
 * 把 Tailwind preflight 的关键两条落到内联样式上（见调用处注释）。
 *
 * 抽成独立函数是为了可测：这两条直接影响**框的尺寸**，一旦回退就会出现
 * 「设计稿整体偏高/偏宽」这种很难归因的现象。
 */
export function applyPreflightDefaults(
  el: { tagName: string; style: { boxSizing: string; margin: string } },
  classes: string,
): void {
  el.style.boxSizing = 'border-box'
  if (UA_MARGIN_TAGS.has(el.tagName.toLowerCase()) && !hasMarginUtility(classes)) {
    el.style.margin = '0px'
  }
}

export interface TailwindApplyResult {
  /** 白名单未命中的 class（已去重）—— 这些样式被丢弃了 */
  unresolved: string[]
  /**
   * 人类可读的告警（已去重）：如「<p> 上的 bg-* 不生效，请移到外层 <section>」。
   * 调用方（useClientRender）会把它随 `_unresolvedClasses` 回传，最终变成画布告警文案。
   */
  warnings: string[]
}

/** 把文本元素上的 hazard class 拼成一条可读告警（含替代写法） */
function describeTextLayoutHazard(el: Element, hazards: string[]): string {
  const tag = String(el.tagName || 'p').toLowerCase()
  return `<${tag} class="${hazards.join(' ')}">：${TEXT_LAYOUT_HAZARD_HINT}`
}

export function applyTailwindToTree(root: Element): TailwindApplyResult {
  const unresolved = new Set<string>()
  const warnings = new Set<string>()
  const visit = (el: Element): void => {
    for (const cls of applyTailwindToElement(el)) unresolved.add(cls)
    const hazards = collectTextLayoutHazardClasses(el.getAttribute('class'), el.tagName, el.textContent)
    if (hazards.length > 0) warnings.add(describeTextLayoutHazard(el, hazards))
    for (const child of Array.from(el.children)) visit(child)
  }
  visit(root)
  return { unresolved: Array.from(unresolved), warnings: Array.from(warnings) }
}
