/**
 * 色彩推导引擎（计划 P2-2）—— 给定一个**种子色**，生成可用的三层色板。
 *
 * 层次（与 `skills/design/ds-spec.md` 的令牌三层一致）：
 *   - `reference`：原始色阶（`primary.50 … primary.900`），只由种子色的色相/饱和度 + 明度阶梯推出；
 *   - `system`：角色语义（`color.primary` / `color.primary-hover` / `color.on-primary` / `color.text` …），
 *     由 reference 里最合适的那一档 + 固定的中性/语义色组成；
 *   - `component`：组件专属覆写（`button.bg` / `button.fg` / `focus.ring` …）。
 *
 * 纯函数、零依赖、确定性（同一 seed 恒等输出）—— 便于单测与跨宿主复用。
 *
 * 为什么是 HSL 而不是 OKLCH：本插件运行在两宿主的插件沙箱里，不能引入色彩库；HSL 的明度阶梯
 * 对 UI 中性色/主色足够好用，且实现可审计。代价是**感知均匀性不如 OKLCH**——已记入 `notes`，
 * 后续若要更均匀的阶梯再换（接口不变）。
 */

export interface DerivedPalette {
  /** 参与推导的种子色（规范化为 `#RRGGBB` 大写） */
  seed: string
  /** 明/暗模式（暗色会抬高 primary、翻转中性色） */
  mode: PaletteMode
  /** 原始色阶：`primary.50 … primary.900`（两模式一致 —— 色阶是原始值） */
  reference: Record<string, string>
  /** 角色语义：`color.primary` / `color.primary-hover` / `color.on-primary` / `color.text` … */
  system: Record<string, string>
  /** 组件覆写：`button.bg` / `button.fg` / `input.border` / `focus.ring` … */
  component: Record<string, string>
  /** 如实说明推导的假设与限制（不静默） */
  notes: string[]
}

export type PaletteMode = 'light' | 'dark'

interface Rgb {
  r: number
  g: number
  b: number
}

interface Hsl {
  h: number
  s: number
  l: number
}

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function parseHex(input: string): Rgb | null {
  const match = String(input ?? '').trim().match(HEX_RE)
  if (!match) return null
  let body = match[1]
  if (body.length === 3) body = body.split('').map((char) => char + char).join('')
  const int = Number.parseInt(body, 16)
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toHex({ r, g, b }: Rgb): string {
  const part = (channel: number) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase()
}

/** sRGB → HSL（h 0–360，s/l 0–1） */
function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  const l = (max + min) / 2
  if (delta === 0) return { h: 0, s: 0, l }
  const s = delta / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / delta) % 6
  else if (max === gn) h = (bn - rn) / delta + 2
  else h = (rn - gn) / delta + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t
  if (tt < 0) tt += 1
  if (tt > 1) tt -= 1
  if (tt < 1 / 6) return p + (q - p) * 6 * tt
  if (tt < 1 / 2) return q
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
  return p
}

/** HSL → sRGB（h 0–360，s/l 0–1） */
function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hn = ((h % 360) + 360) % 360 / 360
  if (s === 0) {
    const grey = l * 255
    return { r: grey, g: grey, b: grey }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: hueToRgb(p, q, hn + 1 / 3) * 255,
    g: hueToRgb(p, q, hn) * 255,
    b: hueToRgb(p, q, hn - 1 / 3) * 255,
  }
}

/** WCAG 相对亮度 */
function relativeLuminance({ r, g, b }: Rgb): number {
  const linear = [r, g, b].map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

/** WCAG 对比度比值 */
export function contrastRatio(a: string, b: string): number | null {
  const rgbA = parseHex(a)
  const rgbB = parseHex(b)
  if (!rgbA || !rgbB) return null
  const la = relativeLuminance(rgbA)
  const lb = relativeLuminance(rgbB)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** 在候选前景色里挑对比度最高者（默认白 / 近黑） */
function readableOn(background: string, candidates: string[] = ['#FFFFFF', '#0F172A']): string {
  let best = candidates[0]
  let bestRatio = -1
  for (const candidate of candidates) {
    const ratio = contrastRatio(background, candidate) ?? -1
    if (ratio > bestRatio) {
      bestRatio = ratio
      best = candidate
    }
  }
  return best
}

/** reference 色阶的明度阶梯（浅 → 深）；50/100 近白，900 近黑 */
const SCALE_STEPS: Array<{ key: string; l: number }> = [
  { key: '50', l: 0.97 },
  { key: '100', l: 0.94 },
  { key: '200', l: 0.86 },
  { key: '300', l: 0.76 },
  { key: '400', l: 0.66 },
  { key: '500', l: 0.56 },
  { key: '600', l: 0.47 },
  { key: '700', l: 0.38 },
  { key: '800', l: 0.29 },
  { key: '900', l: 0.2 },
]

/**
 * 把种子色推导成三层色板。非法种子色抛错（调用方负责给默认值）。
 */
export function deriveSystemPalette(
  seedInput: string,
  options?: { mode?: PaletteMode },
): DerivedPalette {
  const mode: PaletteMode = options?.mode === 'dark' ? 'dark' : 'light'
  const rgb = parseHex(seedInput)
  if (!rgb) throw new Error(`无法解析种子色: ${seedInput}（需 #RGB / #RRGGBB）`)
  const seed = toHex(rgb)
  const hsl = rgbToHsl(rgb)
  // 近灰的种子色（饱和度极低）无法作为品牌色阶；保底给一个可用饱和度并记入 notes
  const notes: string[] = []
  const saturation = hsl.s < 0.08 ? 0.55 : clamp(hsl.s, 0.2, 0.95)
  if (hsl.s < 0.08) notes.push('种子色接近中性灰（饱和度 < 8%），色阶按 55% 饱和度推导以保持可辨识')
  notes.push('色阶由 HSL 明度阶梯推导（感知均匀性弱于 OKLCH）；如需更均匀的阶梯可后续替换引擎实现')

  const reference: Record<string, string> = {}
  for (const { key, l } of SCALE_STEPS) {
    reference[`primary.${key}`] = toHex(hslToRgb({ h: hsl.h, s: saturation, l }))
  }

  // 中性色调都用种子色相做极低饱和，让整体色调统一（而不是纯灰）
  const neutralHue = hsl.h
  const neutrals =
    mode === 'dark'
      ? {
          surface: toHex(hslToRgb({ h: neutralHue, s: 0.12, l: 0.11 })),
          surfaceMuted: toHex(hslToRgb({ h: neutralHue, s: 0.1, l: 0.17 })),
          border: toHex(hslToRgb({ h: neutralHue, s: 0.09, l: 0.3 })),
          text: toHex(hslToRgb({ h: neutralHue, s: 0.08, l: 0.96 })),
          textMuted: toHex(hslToRgb({ h: neutralHue, s: 0.08, l: 0.72 })),
        }
      : {
          surface: toHex(hslToRgb({ h: neutralHue, s: 0.04, l: 1 })),
          surfaceMuted: toHex(hslToRgb({ h: neutralHue, s: 0.06, l: 0.97 })),
          border: toHex(hslToRgb({ h: neutralHue, s: 0.08, l: 0.9 })),
          text: toHex(hslToRgb({ h: neutralHue, s: 0.18, l: 0.13 })),
          textMuted: toHex(hslToRgb({ h: neutralHue, s: 0.1, l: 0.46 })),
        }

  // 暗色下品牌色需要抬亮才能在深底上可见（标准做法：用更浅的品牌色阶）
  const primaryL = mode === 'dark' ? clamp(Math.max(hsl.l, 0.64), 0.56, 0.82) : hsl.l
  const primary = mode === 'dark' ? toHex(hslToRgb({ h: hsl.h, s: saturation, l: primaryL })) : seed
  if (mode === 'dark' && primary !== seed) {
    notes.push('暗色模式把品牌色抬亮到与深底可辨（primary ≠ 种子色）；如需保持原色请显式覆写')
  }
  const primaryHover = toHex(hslToRgb({ h: hsl.h, s: saturation, l: clamp(primaryL + (mode === 'dark' ? 0.08 : -0.07), 0.1, 0.92) }))
  const primaryActive = toHex(hslToRgb({ h: hsl.h, s: saturation, l: clamp(primaryL + (mode === 'dark' ? 0.15 : -0.14), 0.1, 0.95) }))
  const onPrimary = readableOn(primary)
  if ((contrastRatio(primary, onPrimary) ?? 0) < 4.5) {
    notes.push(`primary ${primary} 对 ${onPrimary} 对比度不足 4.5:1——建议改用更深/更浅的品牌色`)
  }
  notes.push('语义色（success/warning/danger/info）不随种子推导，采用通用值；如需品牌化请显式覆写')

  // 暗底上语义色也要抬亮，否则与深底对比不足
  const semantic =
    mode === 'dark'
      ? { success: '#22C55E', warning: '#F59E0B', danger: '#F87171', info: '#38BDF8' }
      : { success: '#16A34A', warning: '#D97706', danger: '#DC2626', info: '#0284C7' }

  const system: Record<string, string> = {
    'color.primary': primary,
    'color.primary-hover': primaryHover,
    'color.primary-active': primaryActive,
    'color.on-primary': onPrimary,
    'color.surface': neutrals.surface,
    'color.surface-muted': neutrals.surfaceMuted,
    'color.border': neutrals.border,
    'color.text': neutrals.text,
    'color.text-muted': neutrals.textMuted,
    'color.success': semantic.success,
    'color.warning': semantic.warning,
    'color.danger': semantic.danger,
    'color.info': semantic.info,
  }

  const component: Record<string, string> = {
    'button.bg': primary,
    'button.bg-hover': primaryHover,
    'button.bg-active': primaryActive,
    'button.fg': onPrimary,
    'input.border': neutrals.border,
    'input.border-focus': primary,
    'focus.ring': primary,
  }

  return { seed, mode, reference, system, component, notes }
}
