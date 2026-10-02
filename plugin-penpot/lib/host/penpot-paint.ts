/**
 * 填充 / 描边 / 效果的 DSL → Penpot 映射
 *
 * 从 `penpot.ts` 拆出（内聚单元：纯数据映射，不触碰宿主状态、不调用 `this`）。
 * 三条函数各自负责把 DSL 的声明翻译成 Penpot 的 `PenpotFill` / `PenpotStroke` / 阴影+模糊，
 * 并把「宿主表达不了」的项目如实收进 `skipped`（不静默丢弃）。
 */
import { describeColor, normalizeColor } from './color'
import { buildPenpotGradient, isFillVisible, normalizeFillType, readFillOpacity } from './gradient'
import { sideGroupKey, type BorderSide } from './border-sides'
import type { HostEffect, HostFill, HostStroke } from './types'

export interface PenpotColorSpec {
  hex: string
  opacity: number
}

/**
 * 单边描边的落地规格。
 * 同 `groupKey` 的多条边会合进**一条 Path 的多个子路径**（一条 Path 只有一个 stroke）。
 */
export interface SideBorderSpec {
  sides: BorderSide[]
  width: number
  dashPattern?: number[]
  groupKey: string
  color?: PenpotColorSpec
  gradient?: PenpotGradient
}

export function toPenpotFills(fills: HostFill[]): { fills: PenpotFill[]; skipped: string[] } {
  const out: PenpotFill[] = []
  const skipped: string[] = []

  for (const fill of fills) {
    // 引擎用 isVisible，DSL 用 visible —— 两个都要认
    if (!isFillVisible(fill)) continue

    const kind = normalizeFillType(fill.type)
    const fillOpacity = readFillOpacity(fill)

    // ── 纯色 ──
    // 注意：缺 type 但有 color 也当纯色（引擎/手写 DSL 都可能省 type）
    if (kind === 'SOLID' || (kind === 'UNKNOWN' && fill.color !== undefined)) {
      const color = normalizeColor(fill.color, fillOpacity)
      if (!color) {
        skipped.push(`纯色填充的色值无法识别: ${describeColor(fill.color)}`)
        continue
      }
      out.push({ fillColor: color.hex, fillOpacity: color.opacity })
      continue
    }

    // ── 渐变（linear / radial）──
    if (kind === 'GRADIENT_LINEAR' || kind === 'GRADIENT_RADIAL') {
      const result = buildPenpotGradient(fill)
      if (!result.ok) {
        // 降级为纯色：宁可“平”一点，也不能留空白让文本变成透明
        if (result.fallback) {
          out.push({ fillColor: result.fallback.hex, fillOpacity: result.fallback.opacity })
        }
        skipped.push(result.reason)
        continue
      }
      out.push({
        fillColorGradient: result.gradient,
        fillOpacity: fillOpacity ?? 1,
      })
      continue
    }

    // ── conic / diamond：Penpot 只有 linear / radial ──
    if (kind === 'GRADIENT_ANGULAR' || kind === 'GRADIENT_DIAMOND') {
      const result = buildPenpotGradient(fill)
      if (!result.ok && result.fallback) {
        out.push({ fillColor: result.fallback.hex, fillOpacity: result.fallback.opacity })
      }
      skipped.push(result.ok ? `Penpot 不支持 ${kind}` : result.reason)
      continue
    }

    // ── 图片 ──
    if (kind === 'IMAGE') {
      // IMAGE fill 需要 ImageData。节点级 imageUrl 已走 uploadMediaUrl；
      // 填充里的 imageData 由服务端预取（enrichDslWithImageData）负责。
      if (!fill.imageData) {
        skipped.push('IMAGE 填充缺少 imageData（Penpot 需先 uploadMedia* 拿到 ImageData）')
        continue
      }
      skipped.push('IMAGE 填充需要 uploadMediaData 生成 ImageData，本版本尚未接线')
      continue
    }

    skipped.push(`不支持的填充类型: ${String(fill.type)}`)
  }

  return { fills: out, skipped }
}

/**
 * DSL 线帽（MasterGo 语义）→ Penpot `StrokeCap` 关键词。
 *
 * 关键词表出处：官方文档 <https://doc.plugins.penpot.app/types/StrokeCap>
 * `"round" | "square" | "line-arrow" | "triangle-arrow" | "square-marker" | "circle-marker" | "diamond-marker"`。
 *
 * ⚠️ **没有 `butt` 字面量** —— 平头就是默认值。所以 `NONE` 我们**故意不写该字段**（见 `applyStrokeCaps`），
 * 而不是写 `null`：typings 只声明了 `string`，写 `null` 需绕过类型且真机没验过；
 * 对本管线（路径都是**新建**的）省略与平头等价，差别只在“把圆帽改回平头”的改值场景（已记入限制清单）。
 */
const CAP_TO_PENPOT: Record<string, string> = {
  ROUND: 'round',
  SQUARE: 'square',
  LINE_ARROW: 'line-arrow',
  ARROW_EQUILATERAL: 'triangle-arrow',
  ROUND_ARROW: 'circle-marker',
  // ── 别名：DSL 是两侧共用词汇，MasterGo 侧自己就叫 TRIANGLE_ARROW / DIAMOND
  //（见 `plugin-mastergo/lib/api/dsl-renderer.ts#convertStrokeCap` 的 supportedCaps），
  // 不认它们的话，"MG 导出 → Penpot 渲染"的往返会凭空多一条"不认识"的降级。
  TRIANGLE_ARROW: 'triangle-arrow',
  DIAMOND: 'diamond-marker',
  // 认不了（Penpot 无对应概念，会进 skipped 如实上报）：RING / LINE / STROKE
}

/** Penpot `StrokeCap` → DSL 口径（回读用）；未知值原样保留，避免往返丢信息 */
const CAP_FROM_PENPOT: Record<string, string> = {
  round: 'ROUND',
  square: 'SQUARE',
  'line-arrow': 'LINE_ARROW',
  'triangle-arrow': 'ARROW_EQUILATERAL',
  'square-marker': 'SQUARE',
  'circle-marker': 'ROUND_ARROW',
  'diamond-marker': 'DIAMOND',
}

/** 箭头型（端点标记）线帽：两端都落会在起点凭空多一个箭头，因此只落终点（见 `applyStrokeCaps`） */
const ARROW_CAPS = new Set(['LINE_ARROW', 'ARROW_EQUILATERAL', 'ROUND_ARROW', 'TRIANGLE_ARROW', 'DIAMOND'])

/** DSL 线帽 → Penpot 关键词；`undefined` = 平头/不认识（调用方决定是否上报） */
export function penpotCapFor(dslCap: unknown): string | undefined {
  if (typeof dslCap !== 'string') return undefined
  return CAP_TO_PENPOT[dslCap.toUpperCase()]
}

/** Penpot 线帽（回读）→ DSL 口径；空值（平头）返回 `undefined` */
export function capFromPenpot(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const key = String(value).toLowerCase()
  return CAP_FROM_PENPOT[key] ?? key
}

/**
 * 把 DSL 的**元素级**线帽落到 Penpot 的「起点帽 / 终点帽」，并把落不了的东西如实上报。
 *
 * - 普通帽（`NONE` / `ROUND` / `SQUARE`）：CSS `stroke-linecap` 本就作用于**两端** → 两端同值；
 * - 箭头帽（`LINE_ARROW` / `ARROW_EQUILATERAL` / `ROUND_ARROW`）：DSL 不区分起止端，而引擎是按
 *   SVG `marker-end` 优先推出的（见 `ui/composables/svg-extractor.ts#applyMarkerCap`）—— 所以
 *   **只落终点**并把这条推断显式记进 `skipped`（两端都落会在起点凭空多一个箭头）；
 * - `join`：Penpot 的 `Stroke` 接口**没有** line-join 成员（官方只到 `strokeCapStart/End`）→
 *   非默认值（非 `MITER`）时如实上报。`MITER` 是 SVG 默认、两侧一致，**不报** ——
 *   否则每根 HTML 边框都会刷一条噪声（`extractStrokes` 对边框总会写 `strokeJoin`）。
 */
function applyStrokeCaps(stroke: HostStroke, entry: PenpotStroke, skipped: string[]): void {
  const start = typeof stroke.capStart === 'string' ? stroke.capStart.toUpperCase() : undefined
  const end = typeof stroke.capEnd === 'string' ? stroke.capEnd.toUpperCase() : undefined

  for (const [label, raw] of [['起点', start], ['终点', end]] as const) {
    if (raw === undefined || raw === 'NONE') continue
    if (!(raw in CAP_TO_PENPOT)) {
      skipped.push(
        `线帽值 Penpot 不认识（${label}）: ${raw}；可用 NONE / ROUND / SQUARE / LINE_ARROW / ARROW_EQUILATERAL / ROUND_ARROW`,
      )
    }
  }

  const arrow = [start, end].find((cap) => cap !== undefined && ARROW_CAPS.has(cap))
  if (arrow) {
    const cap = penpotCapFor(end ?? start)
    if (cap) entry.strokeCapEnd = cap
    skipped.push(
      `箭头线帽 ${arrow} 只落在**终点**：DSL 的 strokeCap 不区分起止端，引擎按 SVG marker-end 的语义取（起点保持默认平头）`,
    )
  } else {
    const capStart = penpotCapFor(start)
    const capEnd = penpotCapFor(end)
    if (capStart) entry.strokeCapStart = capStart
    if (capEnd) entry.strokeCapEnd = capEnd
  }

  const join = typeof stroke.join === 'string' ? stroke.join.toUpperCase() : ''
  if (join && join !== 'MITER') {
    skipped.push(
      `strokeJoin=${join} 未落地：Penpot 的 stroke 模型没有 line-join 成员（官方 Stroke 只到 strokeCapStart/End）；拐角会按 miter 表现`,
    )
  }
}

/**
 * 描边分流：**整圈**走原生 strokes；**单边**走叠加 Path 模拟；不支持的如实跳过。
 *
 * 返回三桶而不是两桶，是因为单边描边需要不同的落地方式（见 border-sides.ts 的说明）。
 */
export function toPenpotStrokes(strokes: HostStroke[]): {
  strokes: PenpotStroke[]
  sideBorders: SideBorderSpec[]
  skipped: string[]
} {
  const out: PenpotStroke[] = []
  const sideBorders: SideBorderSpec[] = []
  const skipped: string[] = []

  for (const stroke of strokes) {
    if (!isFillVisible(stroke)) continue

    const kind = normalizeFillType(stroke.type)
    const strokeOpacity = readFillOpacity(stroke)
    const width = stroke.width ?? 1
    const alignment = stroke.align === 'OUTSIDE' ? 'outer' : stroke.align === 'CENTER' ? 'center' : 'inner'
    const hasDash = Boolean(stroke.dashPattern?.length)
    const partialSides = stroke.sides && stroke.sides.length > 0 && stroke.sides.length < 4

    // 构造"颜色"部分：纯色或渐变（两者都能落在 Path 的 stroke 上）
    let paint: { color?: PenpotColorSpec; gradient?: PenpotGradient } = {}
    let paintKey = ''
    if (kind === 'GRADIENT_LINEAR' || kind === 'GRADIENT_RADIAL') {
      const result = buildPenpotGradient(stroke)
      if (!result.ok) {
        const fallback = result.fallback ?? normalizeColor(stroke.color, strokeOpacity)
        if (fallback) paint = { color: { hex: fallback.hex, opacity: fallback.opacity } }
        paintKey = `fallback:${fallback?.hex ?? 'none'}`
        skipped.push(`渐变描边降级: ${result.reason}`)
      } else {
        paint = { gradient: result.gradient }
        paintKey = `gradient:${JSON.stringify(result.gradient.stops)}:${result.gradient.type}`
      }
    } else if (kind === 'GRADIENT_ANGULAR' || kind === 'GRADIENT_DIAMOND') {
      const result = buildPenpotGradient(stroke)
      const fallback = result.ok ? normalizeColor(stroke.color, strokeOpacity) : result.fallback
      if (fallback) paint = { color: { hex: fallback.hex, opacity: fallback.opacity } }
      paintKey = `fallback:${fallback?.hex ?? 'none'}`
      skipped.push(`Penpot 不支持 ${kind} 描边，已降级为纯色`)
    } else {
      const color = normalizeColor(stroke.color, strokeOpacity)
      if (!color) {
        skipped.push(`描边色值无法识别: ${describeColor(stroke.color)}`)
        continue
      }
      paint = { color: { hex: color.hex, opacity: color.opacity } }
      paintKey = `solid:${color.hex}:${color.opacity}`
    }

    if (partialSides) {
      // 单边：交给叠加层（不再按整圈落地）
      sideBorders.push({
        sides: stroke.sides as BorderSide[],
        width,
        dashPattern: stroke.dashPattern,
        groupKey: sideGroupKey({
          colorKey: paintKey,
          width,
          dashKey: hasDash ? (stroke.dashPattern ?? []).join(',') : '',
          alignKey: alignment,
          gradientKey: paint.gradient ? 'g' : '',
        }),
        ...paint,
      })
      continue
    }

    const entry: PenpotStroke = {
      strokeWidth: width,
      // dashPattern（DSL 口径）优先；只有样式名（Penpot 口径）时也照它写 —— 保证往返不退化成实线
      strokeStyle: hasDash ? 'dashed' : (stroke.strokeStyle ?? 'solid'),
      strokeAlignment: alignment,
    }
    if (paint.gradient) entry.strokeColorGradient = paint.gradient
    else if (paint.color) {
      entry.strokeColor = paint.color.hex
      entry.strokeOpacity = paint.color.opacity
    }
    // 线帽 / 拐角（元素级字段 → 两端映射 + 不可映射项如实上报）
    applyStrokeCaps(stroke, entry, skipped)
    out.push(entry)
  }

  return { strokes: out, sideBorders, skipped }
}

export function toPenpotEffects(effects: HostEffect[]): {
  shadows?: PenpotShadow[]
  blur?: PenpotBlur
  backgroundBlur?: PenpotBlur
  skipped: string[]
} {
  const shadows: PenpotShadow[] = []
  const skipped: string[] = []
  let blur: PenpotBlur | undefined
  let backgroundBlur: PenpotBlur | undefined

  for (const effect of effects) {
    const hidden = effect.visible === false || effect.isVisible === false

    switch (effect.type) {
      case 'DROP_SHADOW':
      case 'INNER_SHADOW': {
        const color = normalizeColor(effect.color ?? '#000000') ?? { hex: '#000000', opacity: 0.25 }
        shadows.push({
          style: effect.type === 'DROP_SHADOW' ? 'drop-shadow' : 'inner-shadow',
          offsetX: effect.offset?.x ?? 0,
          offsetY: effect.offset?.y ?? 0,
          blur: effect.radius ?? 0,
          spread: effect.spread ?? 0,
          color: { color: color.hex, opacity: color.opacity },
          hidden,
        })
        break
      }
      case 'LAYER_BLUR': {
        if (blur) {
          skipped.push('Penpot 每个节点只支持一个图层模糊，多余项已忽略')
          break
        }
        blur = { value: effect.radius ?? 0, hidden }
        break
      }
      case 'BACKGROUND_BLUR': {
        if (backgroundBlur) {
          skipped.push('Penpot 每个节点只支持一个背景模糊，多余项已忽略')
          break
        }
        backgroundBlur = { value: effect.radius ?? 0, hidden }
        break
      }
      default:
        skipped.push(`不支持的效果类型: ${(effect as { type: string }).type}`)
        break
    }
  }

  return {
    shadows: shadows.length ? shadows : undefined,
    blur,
    backgroundBlur,
    skipped,
  }
}
