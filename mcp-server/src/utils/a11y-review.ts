/**
 * 可访问性自动检查（计划 P1-3）—— 纯函数，只吃 `design/describe` 的树，不碰宿主。
 *
 * 为什么单独成模块：`design_review` 原来那条对比度检查是**死代码** ——
 * 它要求 `node.style.fills[0].color` 是 `{r,g,b}` 对象，而两个宿主实际给的都是
 * **十六进制字符串**（MasterGo `node.fills: ["#0F172A"]` / Penpot `style.fills: ["#0F172A @100%"]`）。
 * 于是"对比度不足"这条从来没触发过。本模块用真正的 WCAG 相对亮度公式重写，并补齐
 * 焦点环与最小点击区；纯函数便于钉住口径。
 *
 * 口径（与 `skills/design/ds-spec.md §5` 一致）：
 *   - 对比度：WCAG 2.1 AA —— 正常字号 ≥ 4.5:1，大字号（≥24px，或 ≥18.66px 且 bold）≥ 3:1；
 *   - 焦点环：名字以 `_Focus` 结尾的成员必须有 **≥2px 描边**（不得仅靠颜色变化）；
 *   - 最小点击区：交互元素（Button/Input/Toggle/…）桌面密排 ≥32×32（低于即 error），
 *     推荐 ≥44×44（介于两者即 warning）。
 *
 * 诚实边界：渐变色、图片填充、半透明填充、取不到背景色的文本 → 进 `skipped` 如实上报，
 * 不猜、不谎报通过。
 */

type AnyNode = Record<string, any>

export type A11yRule = 'contrast' | 'focus-ring' | 'hit-area'

export interface A11yIssue {
  severity: 'error' | 'warning'
  category: 'accessibility'
  rule: A11yRule
  message: string
  path: string
  nodeId?: string
  evidence?: Record<string, unknown>
}

export interface A11yAuditResult {
  issues: A11yIssue[]
  checked: { text: number; interactive: number; focus: number }
  skipped: string[]
}

export interface A11yOptions {
  /** 正常字号最小对比度（默认 4.5） */
  minRatio?: number
  /** 大字号最小对比度（默认 3） */
  minLargeRatio?: number
  /** 交互元素硬下限（默认 32） */
  minHit?: number
  /** 交互元素推荐下限（默认 44） */
  recommendedHit?: number
  /** `_Focus` 成员最小描边宽度（默认 2） */
  minFocusStroke?: number
}

const DEFAULTS = { minRatio: 4.5, minLargeRatio: 3, minHit: 32, recommendedHit: 44, minFocusStroke: 2 }

/** 交互元素名字里的角色词（`Button_Primary_Default` / `Input_Default_Focus` / `Toggle_…`） */
const INTERACTIVE_RE = /(^|[_\-\s])(button|btn|input|toggle|checkbox|radio|link|tab|switch|select|slider)([_\-\s]|$)/i

const HEX_RE = /#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?/

interface FillEntry {
  hex: string
  opacity: number
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/**
 * 从节点抽「实心填充」列表，兼容两种宿主格式：
 *   - MasterGo：`node.fills: string[]`（`"#0F172A"`）
 *   - Penpot：`node.style.fills: string[]`（`"#0F172A @100%"`）
 * 顺带解析 alpha（`#RRGGBBAA`）与 `@NN%` 不透明度 —— 用于判定"是否完全不透明"。
 */
function fillEntries(node: AnyNode): FillEntry[] {
  const out: FillEntry[] = []
  const consider = (value: unknown): void => {
    if (typeof value !== 'string') return
    const match = value.match(HEX_RE)
    if (!match) return
    let opacity = 1
    if (match[2]) opacity = Number.parseInt(match[2], 16) / 255
    const at = value.match(/@\s*(\d+(?:\.\d+)?)\s*%/)
    if (at) opacity = Math.min(opacity, Number(at[1]) / 100)
    out.push({ hex: `#${match[1].toUpperCase()}`, opacity })
  }
  if (Array.isArray(node.fills)) node.fills.forEach(consider)
  if (Array.isArray(node.style?.fills)) node.style.fills.forEach(consider)
  return out
}

function firstOpaqueHex(node: AnyNode): string | undefined {
  return fillEntries(node).find((fill) => fill.opacity >= 0.999)?.hex
}

/** 文本色：MasterGo 在 `style.textColor`，Penpot 在 `style.fills`（文本节点的填充即字色） */
function textColorHex(node: AnyNode): string | undefined {
  if (typeof node.style?.textColor === 'string') {
    const match = node.style.textColor.match(HEX_RE)
    if (match) return `#${match[1].toUpperCase()}`
  }
  return firstOpaqueHex(node)
}

/** 最近的、完全不透明的祖先背景色（从内到外） */
function backgroundHex(ancestors: AnyNode[]): string | undefined {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const hex = firstOpaqueHex(ancestors[i])
    if (hex) return hex
  }
  return undefined
}

/** 描边宽度：MasterGo `node.stroke.weight`；Penpot `style.strokes: ["#4340EA w=2"]` */
function strokeWeight(node: AnyNode): number | undefined {
  const direct = num(node.stroke?.weight)
  if (direct !== undefined) return direct
  const strokes = node.style?.strokes
  if (Array.isArray(strokes)) {
    for (const stroke of strokes) {
      if (typeof stroke !== 'string') continue
      const match = stroke.match(/w\s*=\s*([\d.]+)/)
      if (match) return Number(match[1])
    }
  }
  return undefined
}

function dimensions(node: AnyNode): { w: number; h: number } | undefined {
  const w = num(node.w ?? node.width)
  const h = num(node.h ?? node.height)
  if (w === undefined || h === undefined) return undefined
  return { w, h }
}

function relativeLuminance(hex: string): number | null {
  const match = hex.match(/^#([0-9a-fA-F]{6})$/)
  if (!match) return null
  const int = Number.parseInt(match[1], 16)
  const channels = [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff]
  const linear = channels.map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

/** WCAG 对比度比值（1–21）；任一色值非法返回 null（调用方进 skipped） */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = relativeLuminance(foreground)
  const bg = relativeLuminance(background)
  if (fg === null || bg === null) return null
  const hi = Math.max(fg, bg)
  const lo = Math.min(fg, bg)
  return (hi + 0.05) / (lo + 0.05)
}

/** 字号是否算「大字号」（WCAG：≥24px，或 ≥18.66px 且 bold） */
function isLargeText(fontSize: number | undefined, fontWeight: number | undefined): boolean {
  if (fontSize === undefined) return false
  if (fontSize >= 24) return true
  return fontSize >= 18.66 && (fontWeight ?? 0) >= 700
}

/**
 * 把 `design/describe` 的返回归一成**根节点数组**，兼容两种宿主形态：
 *   - MasterGo：`{ tree }`（单根对象）
 *   - Penpot：`{ ok, summary, nodes: [...] }`（多根数组）
 *
 * 这是原 `design_review` 的死路径根源：服务端只认 `parsed.tree`，
 * 在 Penpot 上恒得 `{}` → 永远 0 问题。
 */
export function parseDescribeRoots(parsed: unknown): AnyNode[] {
  if (!parsed || typeof parsed !== 'object') return []
  const obj = parsed as Record<string, unknown>
  if (Array.isArray(obj.nodes)) return obj.nodes.filter((node): node is AnyNode => Boolean(node) && typeof node === 'object')
  if (obj.tree && typeof obj.tree === 'object') return [obj.tree as AnyNode]
  return []
}

/**
 * 跑一遍可访问性审计。`roots` 是归一化后的根节点数组（见 `parseDescribeRoots`）。
 */
export function auditA11y(roots: AnyNode[], options: A11yOptions = {}): A11yAuditResult {
  const opts = { ...DEFAULTS, ...options }
  const issues: A11yIssue[] = []
  const skipped: string[] = []
  const checked = { text: 0, interactive: 0, focus: 0 }

  const walk = (node: AnyNode, ancestors: AnyNode[], path: string[]): void => {
    const name = typeof node.name === 'string' ? node.name : ''
    const label = name || String(node.id ?? '?')
    const currentPath = [...path, label]
    const pathText = currentPath.join(' > ')
    const type = String(node.type ?? '').toLowerCase()

    // ① 文本对比度（WCAG 2.1 AA）
    if (type === 'text' && typeof node.text === 'string' && node.text.trim()) {
      checked.text += 1
      const fg = textColorHex(node)
      const bg = backgroundHex(ancestors)
      if (!fg) {
        skipped.push(`对比度：${pathText}（取不到文字色）`)
      } else if (!bg) {
        skipped.push(`对比度：${pathText}（取不到不透明背景色）`)
      } else {
        const ratio = contrastRatio(fg, bg)
        if (ratio === null) {
          skipped.push(`对比度：${pathText}（色值无法解析）`)
        } else {
          const large = isLargeText(num(node.style?.fontSize), num(node.style?.fontWeight))
          const min = large ? opts.minLargeRatio : opts.minRatio
          if (ratio + 1e-9 < min) {
            issues.push({
              severity: 'error',
              category: 'accessibility',
              rule: 'contrast',
              message: `文字对比度不足：${ratio.toFixed(2)}:1 < ${min}:1（${large ? '大字号' : '正常字号'}，前景 ${fg} / 背景 ${bg}）`,
              path: pathText,
              ...(node.id ? { nodeId: String(node.id) } : {}),
              evidence: { ratio: Number(ratio.toFixed(2)), required: min, foreground: fg, background: bg },
            })
          }
        }
      }
    }

    // ② 焦点环：`_Focus` 成员必须有 ≥2px 描边（不得仅靠颜色变化）
    if (/_focus$/i.test(name)) {
      checked.focus += 1
      const weight = strokeWeight(node)
      if (weight === undefined || weight < opts.minFocusStroke) {
        issues.push({
          severity: 'error',
          category: 'accessibility',
          rule: 'focus-ring',
          message: `焦点态缺少 ≥${opts.minFocusStroke}px 描边（不得仅靠颜色变化）${weight === undefined ? '：未读到描边' : `：当前 ${weight}px`}`,
          path: pathText,
          ...(node.id ? { nodeId: String(node.id) } : {}),
          evidence: { strokeWeight: weight ?? null, required: opts.minFocusStroke },
        })
      }
    }

    // ③ 最小点击区：交互元素
    if (INTERACTIVE_RE.test(name)) {
      const size = dimensions(node)
      if (size) {
        checked.interactive += 1
        if (size.w < opts.minHit || size.h < opts.minHit) {
          issues.push({
            severity: 'error',
            category: 'accessibility',
            rule: 'hit-area',
            message: `点击区过小：${Math.round(size.w)}×${Math.round(size.h)} < ${opts.minHit}×${opts.minHit}（桌面密排下限）`,
            path: pathText,
            ...(node.id ? { nodeId: String(node.id) } : {}),
            evidence: { width: Math.round(size.w), height: Math.round(size.h), required: opts.minHit },
          })
        } else if (size.w < opts.recommendedHit || size.h < opts.recommendedHit) {
          issues.push({
            severity: 'warning',
            category: 'accessibility',
            rule: 'hit-area',
            message: `点击区偏小：${Math.round(size.w)}×${Math.round(size.h)} < ${opts.recommendedHit}×${opts.recommendedHit}（触控推荐值；桌面可用，触控需留白补足）`,
            path: pathText,
            ...(node.id ? { nodeId: String(node.id) } : {}),
            evidence: { width: Math.round(size.w), height: Math.round(size.h), required: opts.recommendedHit },
          })
        }
      } else {
        checked.interactive += 1
        skipped.push(`点击区：${pathText}（取不到宽高）`)
      }
    }

    const children = Array.isArray(node.children) ? node.children : []
    for (const child of children) {
      if (child && typeof child === 'object') walk(child, [...ancestors, node], currentPath)
    }
  }

  for (const root of roots) walk(root, [], [])
  return { issues, checked, skipped }
}
