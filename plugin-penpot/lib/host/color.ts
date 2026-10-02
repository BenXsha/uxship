/**
 * 颜色归一化（宿主无关）
 *
 * 为什么需要单独一层：**DSL 里的颜色有 4 种表示**，而且客户端渲染引擎产出的那一种
 * 恰好在最早被漏掉 —— 结果是「所有实心色变成 [object Object]」这种静默错误。
 *
 * 已确认的 4 种来源：
 *   1. `{ r: 67, g: 64, b: 234, a: 1 }`  → 客户端渲染引擎 `cssColorToRgb()` 的产物（**主路径**）
 *   2. `'#4340EA'` / `'#4340EA80'` / `'#abc'` → 手写 DSL / dsl_export 导出
 *   3. `'rgb(67, 64, 234)'` / `'rgba(67,64,234,0.5)'` → 计算样式透传
 *   4. `'transparent'` / 具名色 → 内联 style 透传
 *
 * 统一出口是 `{ hex: '#RRGGBB', opacity: 0..1 }`，正是 Penpot 的
 * `fillColor` + `fillOpacity` / `strokeColor` + `strokeOpacity` / `color: {color, opacity}` 形态。
 *
 * 约定：无法识别时返回 `null`（**不是黑色的兜底**）——
 * 把「不认识的色值」画成黑色，比留空更难排查。
 */

export interface NormalizedColor {
  /** `#RRGGBB`（大写，无 alpha） */
  hex: string
  /** 0..1 */
  opacity: number
}

/** 常见具名色（只覆盖高频；其余的交给调用方如实跳过） */
const NAMED_COLORS: Record<string, string> = {
  transparent: '#000000',
  black: '#000000',
  white: '#FFFFFF',
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  yellow: '#FFFF00',
  orange: '#FFA500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  silver: '#C0C0C0',
  navy: '#000080',
  teal: '#008080',
  olive: '#808000',
  maroon: '#800000',
  lime: '#00FF00',
  aqua: '#00FFFF',
  cyan: '#00FFFF',
  magenta: '#FF00FF',
  fuchsia: '#FF00FF',
  pink: '#FFC0CB',
  brown: '#A52A2A',
  gold: '#FFD700',
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}

function toHexPair(value: number): string {
  const byte = Math.max(0, Math.min(255, Math.round(value)))
  return byte.toString(16).padStart(2, '0').toUpperCase()
}

/** 0-255 的通道 → hex 通道 */
function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHexPair(r)}${toHexPair(g)}${toHexPair(b)}`
}

/**
 * 归一化任意颜色表示为 `{ hex, opacity }`。
 *
 * 注意 `a` 的语义差异：`{r,g,b,a}` 里 a 是 0..1（引擎约定，等同 CSS alpha），
 * 而 `#RRGGBBAA` 里 AA 是 0..255。两者都按各自约定换算成 0..1 的 opacity。
 * 若同时给了 `a` 与显式 `opacity`，**以显式 opacity 优先**（调用方更明确）。
 */
export function normalizeColor(input: unknown, explicitOpacity?: number): NormalizedColor | null {
  const fallbackOpacity = explicitOpacity === undefined ? undefined : clamp01(explicitOpacity)

  // ── 形态 1：{ r, g, b, a } ──
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>
    const r = Number(record.r)
    const g = Number(record.g)
    const b = Number(record.b)
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      const a = record.a === undefined ? 1 : clamp01(Number(record.a))
      // ⚠️ 通道量纲：**两种都存在**，必须按值判定而不是猜。
      //
      // - 客户端渲染引擎的 `cssColorToRgb()` 把 RGB **除以 255** → 0–1 浮点；
      // - 手写 DSL / Figma 系导出是 0–255 整数。
      //
      // 判定规则**抄自 MasterGo 侧 `color-utils.ts#processColor`**
      // （那边是 `r > 1 || g > 1 || b > 1` → 0–255，否则 0–1；我这边方向相反，
      //   但阈值完全一致 —— 两个宿主必须对同一份 DSL 得出同一个颜色）。
      //
      // 曾经踩的坑：只按 0–255 解释 → 0.61 被 `Math.round` 成 1 →
      // `#9CA3AF` 变成 `#010101`、`#0B1220` 变成 `#000000` —— 整页变黑。
      const looksZeroToOne = !(r > 1 || g > 1 || b > 1)
      const scale = looksZeroToOne ? 255 : 1
      return { hex: rgbToHex(r * scale, g * scale, b * scale), opacity: fallbackOpacity ?? a }
    }
    // 也可能是 { color: ... } 的嵌套（Penpot 的 Color 类型）
    if ('color' in record) return normalizeColor(record.color, explicitOpacity)
    return null
  }

  if (typeof input !== 'string') return null
  const value = input.trim()
  if (!value) return null

  const lower = value.toLowerCase()

  // ── 形态 4a：transparent ──
  if (lower === 'transparent') return { hex: '#000000', opacity: fallbackOpacity ?? 0 }

  // ── 形态 2：hex ──
  const hexMatch = /^#([0-9a-fA-F]{3,8})$/.exec(value)
  if (hexMatch) {
    const raw = hexMatch[1]
    let rgb = raw
    let alpha = 1
    if (raw.length === 3) {
      rgb = raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2]
    } else if (raw.length === 4) {
      rgb = raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2]
      alpha = parseInt(raw[3] + raw[3], 16) / 255
    } else if (raw.length === 6) {
      rgb = raw
    } else if (raw.length === 8) {
      rgb = raw.slice(0, 6)
      alpha = parseInt(raw.slice(6, 8), 16) / 255
    } else {
      return null
    }
    return { hex: `#${rgb.toUpperCase()}`, opacity: fallbackOpacity ?? clamp01(alpha) }
  }

  // ── 形态 3：rgb() / rgba()（含百分比通道）──
  const fnMatch = /^rgba?\(([^)]+)\)$/i.exec(value)
  if (fnMatch) {
    const parts = fnMatch[1].split(/[,/\s]+/).map((p) => p.trim()).filter(Boolean)
    if (parts.length < 3) return null
    const channel = (part: string): number => {
      const numeric = parseFloat(part)
      if (!Number.isFinite(numeric)) return NaN
      return part.includes('%') ? (numeric / 100) * 255 : numeric
    }
    const r = channel(parts[0])
    const g = channel(parts[1])
    const b = channel(parts[2])
    if (![r, g, b].every(Number.isFinite)) return null
    const a = parts[3] === undefined ? 1 : (parts[3].includes('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]))
    return { hex: rgbToHex(r, g, b), opacity: fallbackOpacity ?? clamp01(a) }
  }

  // ── 形态 4b：具名色 ──
  if (lower in NAMED_COLORS) {
    return { hex: NAMED_COLORS[lower], opacity: fallbackOpacity ?? 1 }
  }

  return null
}

/** 把色值渲染成可读文本，用于 `skipped.reason`（让用户一眼看出是哪个色值没认出来） */
export function describeColor(input: unknown): string {
  if (input && typeof input === 'object') {
    try {
      return JSON.stringify(input)
    } catch {
      return '[object]'
    }
  }
  return String(input ?? '')
}
