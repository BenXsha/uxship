/**
 * `component/render` —— 预设组件渲染（33 种类型的**子集**）
 *
 * ## 为什么不是照抄 MasterGo 侧
 *
 * MasterGo 侧是 ~2,957 行**命令式**节点树（`makeNode('frame', {...})` × 33 个渲染器，
 * 且每个都跟 `design-theme` 的几十个 token 耦合）。本项目已经把「画布怎么写」这件事
 * 收敛进 **DSL 渲染器**（`lib/dsl/renderer.ts`）—— 它是唯一一处知道"怎么在宿主上落节点"
 * 的地方，并且有降级上报、字体加载、尺寸结算、边框模拟等一整套已测行为。
 *
 * 所以这里把预设写成 **DSL 模板**：一个预设 ≈ 一个 `DSLElement`（10–25 行声明），
 * 而不是 90 行命令式代码。收益：
 *   - 复用渲染器（宿主无关，两个宿主都能跑）；
 *   - 预设即数据 —— 人能读、AI 能改（`dsl/render` 直接吃同一份结构）；
 *   - 不重复实现布局/字体/降级逻辑。
 *
 * ## 覆盖范围（**刻意显式**）
 *
 * 服务端登记了 33 种类型，这里移植的是**原子/高频**的子集。未移植的类型**不静默兜底成
 * 别的东西**，而是返回 `available:false` + 已支持清单 + 指引（`dsl/render` 能渲染任意
 * HTML+Tailwind，能力严格更全）。这比"33 个里 20 个长得像但其实不对"要诚实得多。
 */
import type { HandlerContext } from './index'
import type { DSLElement } from '../dsl/types'
import type { RenderReport } from '../dsl/renderer'
import { handleRenderDsl } from './dslHandlers'

/** 设计令牌（对应 MasterGo 侧 design-theme 的极简子集；够预设用，且可整体覆盖） */
interface Theme {
  brand: string
  brandFg: string
  bg: string
  bgSubtle: string
  border: string
  fg: string
  fgMuted: string
  radius: number
  fontSize: number
  fontFamily: string
  height: number
}

const LIGHT: Theme = {
  brand: '#3366FF',
  brandFg: '#FFFFFF',
  bg: '#FFFFFF',
  bgSubtle: '#F3F4F6',
  border: '#E5E7EB',
  fg: '#111827',
  fgMuted: '#6B7280',
  radius: 6,
  fontSize: 14,
  fontFamily: 'Inter',
  height: 40,
}

const DARK: Theme = {
  ...LIGHT,
  bg: '#111827',
  bgSubtle: '#1F2937',
  border: '#374151',
  fg: '#F9FAFB',
  fgMuted: '#9CA3AF',
}

function resolveTheme(raw: unknown): Theme {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<Theme> & { mode?: string }
  const base = input.mode === 'dark' ? DARK : LIGHT
  const merged: Theme = { ...base }
  for (const key of Object.keys(base) as (keyof Theme)[]) {
    const value = input[key]
    if (value !== undefined && value !== null && value !== '') {
      ;/* SAFETY: key 取自 Object.keys(base) 且 base 是 Theme，故 key ∈ keyof Theme；按 Record 写回同名字段不改变运行时形状。 */ (merged as unknown as Record<string, unknown>)[key] = value
    }
  }
  return merged
}

// ── 极简 DSL 构造器（只是对象字面量，便于阅读与比对） ──

const solid = (color: string) => [{ type: 'SOLID', color }]

const frame = (
  name: string,
  options: Omit<DSLElement, 'type' | 'name'>,
  children?: DSLElement[],
): DSLElement => ({
  type: 'frame',
  name,
  ...options,
  ...(children && children.length ? { children } : {}),
})

const text = (name: string, content: string, options: Partial<DSLElement> = {}): DSLElement => ({
  type: 'text',
  name,
  content,
  textAutoResize: 'NONE',
  ...options,
})

const svgPath = (name: string, svgPathData: string, options: Partial<DSLElement> = {}): DSLElement => ({
  type: 'path',
  name,
  svgPathData,
  ...options,
})

/** 组件尺寸语义：把 `size` 参数（sm/md/lg 或具体尺寸）收敛成 { height, fontSize, paddingX, radius } */
function sizeTier(theme: Theme, input: unknown): { height: number; fontSize: number; paddingX: number; radius: number } {
  const tier = typeof input === 'string' ? input : 'md'
  if (tier === 'sm') return { height: Math.round(theme.height * 0.8), fontSize: theme.fontSize - 2, paddingX: 12, radius: Math.max(0, theme.radius - 1) }
  if (tier === 'lg') return { height: Math.round(theme.height * 1.15), fontSize: theme.fontSize + 2, paddingX: 20, radius: theme.radius + 2 }
  return { height: theme.height, fontSize: theme.fontSize, paddingX: 16, radius: theme.radius }
}

const str = (input: unknown, fallback = ''): string => (typeof input === 'string' && input ? input : fallback)

/**
 * 估算文本宽度。
 *
 * MasterGo 侧就是这么干的（`estCharW = fontSize * 0.5`）—— 因为它一次调用就要给出确定的
 * 尺寸，不能等宿主排版。全角字符按 1 个字宽算，其余按 0.55。
 *
 * ⚠️ 为什么不靠"hug 内容"（`primaryAxisSizingMode: AUTO`）：Penpot 侧确实支持，但
 * 那样预设的尺寸就由宿主排版决定，两个宿主会给出不同结果（且导出/截图对比不稳定）。
 * 这里选择**确定性**：给显式尺寸，与 MasterGo 侧可对齐。
 */
function estimateTextWidth(content: string, fontSize: number): number {
  let width = 0
  for (const char of content) {
    width += (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char) ? 1 : 0.55) * fontSize
  }
  return Math.ceil(width)
}

/** 横向 hugging 容器的尺寸：内容宽 + 左右内边距 */
const rowWidth = (content: string, fontSize: number, paddingX: number, extra = 0): number =>
  estimateTextWidth(content, fontSize) + paddingX * 2 + extra

// ── 预设（每个都是 (props, theme) → DSLElement） ──

type Preset = (props: Record<string, unknown>, theme: Theme) => DSLElement

const Presets: Record<string, Preset> = {
  button: (p, t) => {
    const variant = str(p.variant, 'primary')
    const size = sizeTier(t, p.size ?? p.tier)
    const variantPaint: Record<string, { bg: string; fg: string; stroke?: string }> = {
      primary: { bg: t.brand, fg: t.brandFg },
      secondary: { bg: t.bgSubtle, fg: t.fg },
      outline: { bg: t.bg, fg: t.fg, stroke: t.border },
      text: { bg: t.bg, fg: t.brand },
    }
    const paint = variantPaint[variant] ?? variantPaint.primary
    const pill = p.shape === 'pill' || p.pill === true
    const label = str(p.label, 'Button')
    // R4：预设渲染根名 `<Type>-<variant>`，分隔符只用 `-`
    return frame(
      `Button-${variant}`,
      {
        size: { width: rowWidth(label, size.fontSize, size.paddingX), height: size.height },
        layoutMode: 'HORIZONTAL',
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'CENTER',
        itemSpacing: 6,
        paddingLeft: size.paddingX,
        paddingRight: size.paddingX,
        cornerRadius: pill ? size.height / 2 : size.radius,
        fills: solid(paint.bg),
        ...(paint.stroke ? { strokes: solid(paint.stroke), strokeWidth: 1 } : {}),
      },
      [text('Label', label, { fontSize: size.fontSize, fontWeight: 600, lineHeight: { unit: 'PIXELS', value: size.fontSize + 6 } })],
    )
  },

  'text-input': (p, t) => {
    const size = sizeTier(t, p.size ?? p.tier)
    const disabled = p.disabled === true
    // R4：根名不带空格（旧写法 `Text Input`）
    return frame(
      'TextInput',
      {
        size: { width: 240, height: size.height },
        layoutMode: 'HORIZONTAL',
        counterAxisAlignItems: 'CENTER',
        paddingLeft: 12,
        paddingRight: 12,
        cornerRadius: size.radius,
        fills: solid(t.bg),
        strokes: solid(t.border),
        strokeWidth: 1,
      },
      [
        text('Placeholder', str(p.value ?? p.placeholder, 'Placeholder'), {
          fontSize: size.fontSize,
          fills: solid(disabled ? t.fgMuted : p.value ? t.fg : t.fgMuted),
        }),
      ],
    )
  },

  badge: (p, t) => {
    const tone = str(p.tone ?? p.variant, 'neutral')
    const tones: Record<string, { bg: string; fg: string }> = {
      neutral: { bg: t.bgSubtle, fg: t.fg },
      brand: { bg: t.brand, fg: t.brandFg },
      success: { bg: '#DCFCE7', fg: '#166534' },
      warning: { bg: '#FEF3C7', fg: '#92400E' },
      danger: { bg: '#FEE2E2', fg: '#991B1B' },
    }
    const paint = tones[tone] ?? tones.neutral
    const label = str(p.label ?? p.text, 'Badge')
    return frame(
      `Badge-${tone}`,
      {
        size: { width: rowWidth(label, 12, 8), height: 20 },
        layoutMode: 'HORIZONTAL',
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'CENTER',
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 2,
        paddingBottom: 2,
        cornerRadius: 999,
        fills: solid(paint.bg),
      },
      [text('Label', label, { fontSize: 12, fontWeight: 600, fills: solid(paint.fg) })],
    )
  },

  tag: (p, t) => {
    const tone = str(p.tone ?? p.variant, 'neutral')
    const paints: Record<string, { bg: string; fg: string; stroke: string }> = {
      neutral: { bg: t.bgSubtle, fg: t.fg, stroke: t.border },
      brand: { bg: '#EFF6FF', fg: t.brand, stroke: '#BFDBFE' },
    }
    const paint = paints[tone] ?? paints.neutral
    const label = str(p.label, 'Tag')
    return frame(
      `Tag-${tone}`,
      {
        size: { width: rowWidth(label, 12, 8), height: 24 },
        layoutMode: 'HORIZONTAL',
        counterAxisAlignItems: 'CENTER',
        itemSpacing: 4,
        paddingLeft: 8,
        paddingRight: 8,
        cornerRadius: Math.max(0, t.radius - 2),
        fills: solid(paint.bg),
        strokes: solid(paint.stroke),
        strokeWidth: 1,
      },
      [text('Label', label, { fontSize: 12, fills: solid(paint.fg) })],
    )
  },

  avatar: (p, t) => {
    const size = typeof p.size === 'number' ? p.size : 40
    return frame(
      'Avatar',
      {
        size: { width: size, height: size },
        cornerRadius: p.shape === 'square' ? Math.max(0, t.radius - 2) : size / 2,
        fills: solid(t.brand),
        layoutMode: 'HORIZONTAL',
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'CENTER',
      },
      [
        text('Initial', str(p.label ?? p.initials, 'AB').slice(0, 2).toUpperCase(), {
          fontSize: Math.round(size * 0.4),
          fontWeight: 600,
          fills: solid(t.brandFg),
        }),
      ],
    )
  },

  checkbox: (p, t) => {
    const checked = p.checked === true
    const label = str(p.label, 'Checkbox')
    return frame(
      'Checkbox',
      {
        size: { width: 16 + 8 + estimateTextWidth(label, t.fontSize), height: Math.max(16, t.fontSize + 4) },
        layoutMode: 'HORIZONTAL',
        counterAxisAlignItems: 'CENTER',
        itemSpacing: 8,
      },
      [
        frame('Box', {
          size: { width: 16, height: 16 },
          cornerRadius: 4,
          fills: solid(checked ? t.brand : t.bg),
          strokes: solid(checked ? t.brand : t.border),
          strokeWidth: 1,
          layoutMode: 'HORIZONTAL',
          primaryAxisAlignItems: 'CENTER',
          counterAxisAlignItems: 'CENTER',
        }, checked ? [svgPath('Tick', 'M3 8 L6.5 11.5 L13 4.5', { strokes: solid('#FFFFFF'), strokeWidth: 2, fills: [] })] : []),
        text('Label', label, { fontSize: t.fontSize, fills: solid(t.fg) }),
      ],
    )
  },

  radio: (p, t) => {
    const selected = p.selected === true || p.checked === true
    const label = str(p.label, 'Option')
    return frame(
      'Radio',
      {
        size: { width: 16 + 8 + estimateTextWidth(label, t.fontSize), height: Math.max(16, t.fontSize + 4) },
        layoutMode: 'HORIZONTAL', counterAxisAlignItems: 'CENTER', itemSpacing: 8,
      },
      [
        frame('Dot', {
          size: { width: 16, height: 16 },
          cornerRadius: 999,
          fills: solid(t.bg),
          strokes: solid(selected ? t.brand : t.border),
          strokeWidth: selected ? 5 : 1,
          layoutMode: 'HORIZONTAL',
          primaryAxisAlignItems: 'CENTER',
          counterAxisAlignItems: 'CENTER',
        }),
        text('Label', label, { fontSize: t.fontSize, fills: solid(t.fg) }),
      ],
    )
  },

  toggle: (p, t) => {
    const on = p.checked === true || p.value === true
    const track = { size: { width: 40, height: 22 }, cornerRadius: 999, fills: solid(on ? t.brand : t.border), layoutMode: 'HORIZONTAL' as const, primaryAxisAlignItems: (on ? 'MAX' : 'MIN') as 'MAX' | 'MIN', counterAxisAlignItems: 'CENTER' as const, paddingLeft: 2, paddingRight: 2 }
    return frame('Toggle', track, [
      frame('Thumb', { size: { width: 18, height: 18 }, cornerRadius: 999, fills: solid('#FFFFFF') }),
    ])
  },

  spinner: (p, t) => {
    const size = typeof p.size === 'number' ? p.size : 20
    return frame('Spinner', { size: { width: size, height: size }, fills: [] }, [
      svgPath('Track', `M ${size / 2} 2 A ${size / 2 - 2} ${size / 2 - 2} 0 1 0 ${size / 2} ${size - 2}`, {
        strokes: solid(t.border),
        strokeWidth: 2,
        fills: [],
      }),
      svgPath('Arc', `M ${size / 2} 2 A ${size / 2 - 2} ${size / 2 - 2} 0 1 1 2 ${size / 2}`, {
        strokes: solid(t.brand),
        strokeWidth: 2,
        fills: [],
      }),
    ])
  },

  divider: (p, t) => {
    const vertical = p.orientation === 'vertical' || p.vertical === true
    return frame('Divider', {
      size: vertical ? { width: 1, height: 24 } : { width: 240, height: 1 },
      fills: solid(t.border),
    })
  },

  progress: (p, t) => {
    const value = Math.max(0, Math.min(100, Number(p.value ?? 40)))
    const width = typeof p.width === 'number' ? p.width : 240
    const height = typeof p.height === 'number' ? Math.max(2, p.height) : 8
    return frame('Progress', { size: { width, height }, cornerRadius: height / 2, fills: solid(t.bgSubtle) }, [
      frame('Fill', { size: { width: Math.round((width * value) / 100), height }, cornerRadius: height / 2, fills: solid(t.brand) }),
    ])
  },

  alert: (p, t) => {
    const tone = str(p.tone ?? p.variant, 'info')
    const tones: Record<string, { bg: string; fg: string; stroke: string }> = {
      info: { bg: '#EFF6FF', fg: '#1E40AF', stroke: '#BFDBFE' },
      success: { bg: '#F0FDF4', fg: '#166534', stroke: '#BBF7D0' },
      warning: { bg: '#FFFBEB', fg: '#92400E', stroke: '#FDE68A' },
      danger: { bg: '#FEF2F2', fg: '#991B1B', stroke: '#FECACA' },
    }
    const paint = tones[tone] ?? tones.info
    return frame(
      `Alert-${tone}`,
      {
        size: { width: 320, height: 12 + (t.fontSize + 4) + 4 + (t.fontSize - 1 + 4) + 12 },
        layoutMode: 'VERTICAL',
        itemSpacing: 4,
        paddingTop: 12,
        paddingBottom: 12,
        paddingLeft: 16,
        paddingRight: 16,
        cornerRadius: t.radius,
        fills: solid(paint.bg),
        strokes: solid(paint.stroke),
        strokeWidth: 1,
      },
      [
        text('Title', str(p.title ?? p.label, 'Title'), { fontSize: t.fontSize, fontWeight: 600, fills: solid(paint.fg) }),
        text('Description', str(p.message ?? p.description, 'Message'), { fontSize: t.fontSize - 1, fills: solid(paint.fg) }),
      ],
    )
  },

  card: (p, t) => frame(
    'Card',
    {
      size: { width: 320, height: (p.image === false ? 0 : 140 + 12) + (t.fontSize + 4 + 6) + 12 + (t.fontSize + 6) + 32 },
      layoutMode: 'VERTICAL',
      itemSpacing: 12,
      paddingTop: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      paddingRight: 16,
      cornerRadius: t.radius + 2,
      fills: solid(t.bg),
      strokes: solid(t.border),
      strokeWidth: 1,
    },
    [
      ...(p.image === false ? [] : [frame('Cover', { size: { width: 288, height: 140 }, cornerRadius: t.radius, fills: solid(t.bgSubtle) })]),
      text('Title', str(p.title ?? p.label, 'Card title'), { fontSize: t.fontSize + 4, fontWeight: 600, fills: solid(t.fg) }),
      text('Content', str(p.body ?? p.description, 'Supporting copy for the card.'), { fontSize: t.fontSize, fills: solid(t.fgMuted) }),
    ],
  ),

  tooltip: (p, t) => {
    const label = str(p.label ?? p.text, 'Tooltip')
    return frame(
      'Tooltip',
      {
        size: { width: rowWidth(label, 12, 10), height: 26 },
        layoutMode: 'HORIZONTAL',
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'CENTER',
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 10,
        paddingRight: 10,
        cornerRadius: Math.max(0, t.radius - 2),
        fills: solid('#111827'),
      },
      [text('Label', label, { fontSize: 12, fills: solid('#F9FAFB') })],
    )
  },

  skeleton: (p, t) => {
    const lines = Math.max(1, Math.min(6, Number(p.lines ?? 3)))
    const width = typeof p.width === 'number' ? p.width : 240
    return frame(
      'Skeleton',
      { layoutMode: 'VERTICAL', itemSpacing: 8, size: { width } },
      Array.from({ length: lines }, (_, index) =>
        frame(`Row-${index}`, {
          size: { width: index === lines - 1 ? Math.round(width * 0.6) : width, height: 12 },
          cornerRadius: 6,
          fills: solid(t.bgSubtle),
        }),
      ),
    )
  },
}

export const SUPPORTED_COMPONENT_TYPES = Object.keys(Presets).sort()

/** 服务端登记的全部 33 种（用于如实报告"未移植哪些"） */
const ALL_SERVER_TYPES = [
  'checkbox-group', 'radio-group', 'checkbox', 'radio', 'button', 'text-input', 'badge', 'avatar',
  'toggle', 'select', 'menu', 'tabs', 'progress', 'list', 'slider', 'breadcrumb', 'tooltip',
  'divider', 'tag', 'spinner', 'modal', 'alert', 'pagination', 'steps', 'accordion', 'card',
  'table', 'form', 'toast', 'skeleton', 'page-shell', 'feature-grid', 'pricing-table',
]

export async function handleComponentRender(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const type = typeof params.type === 'string' ? params.type : 'button'
  const preset = Presets[type]

  if (!preset) {
    return {
      available: false,
      reason: `component_render 的 ${type} 预设尚未移植到 Penpot 侧（已移植 ${SUPPORTED_COMPONENT_TYPES.length}/${ALL_SERVER_TYPES.length}）`,
      supportedTypes: SUPPORTED_COMPONENT_TYPES,
      unsupportedTypes: ALL_SERVER_TYPES.filter((name) => !Presets[name]),
      hint: '改用 dsl/render 直接渲染 HTML+Tailwind（能力严格更全，且不受预设清单限制）；或把该预设的 DSL 模板补进 lib/api/componentHandlers.ts',
    }
  }

  const theme = resolveTheme(params.theme)
  const props = ((params.props && typeof params.props === 'object' ? params.props : {}) ?? {}) as Record<string, unknown>
  // 兼容历史平铺写法：类型专属参数直接在顶层（平铺优先，与 MasterGo 侧一致）
  for (const [key, value] of Object.entries(params)) {
    if (['type', 'props', 'theme', 'position', 'parentId'].includes(key)) continue
    if (props[key] === undefined) props[key] = value
  }

  const element = preset(props, theme)
  const position = (params.position ?? {}) as { x?: number; y?: number }
  if (typeof position.x === 'number') element.position = { x: position.x, y: position.y ?? 0 }

  // 通过 DSL 渲染器落地 —— 不自己写第二套"往画布落节点"的逻辑
  const rendered = await handleRenderDsl(
    {
      dsl: { version: '2.0', elements: [element] },
      parentId: params.parentId,
      zoom: params.zoom,
      select: params.select,
    },
    context,
  )

  // rendered 的静态类型是 unknown（handleRenderDsl 声明如此）：这里按渲染报告的可选字段视图读，
  // 拿不到就退回默认 —— 不再用 Record<string, any> 抹掉全部字段契约。
  const report = rendered as Partial<RenderReport>
  // 渲染报告的字段名（renderer.ts）：rootIds / rootNodeIds
  const rootId = report?.rootIds?.[0] ?? report?.rootNodeIds?.[0]

  return {
    ...report,
    componentType: type,
    componentName: str(element.name, type),
    ...(rootId ? { nodeId: rootId } : {}),
    themeMode: (params.theme as { mode?: string } | undefined)?.mode === 'dark' ? 'dark' : 'light',
  }
}
