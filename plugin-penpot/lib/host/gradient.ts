/**
 * 填充/描边类型归一 + 渐变几何转换（宿主无关）
 *
 * 两个真实存在的命名体系必须同时接受：
 *   - **客户端渲染引擎**：`solid` / `image` / `gradient_linear` / `gradient_radial` / `gradient_angular`（全小写）
 *   - **本项目 DSL / dsl_export**：`SOLID` / `IMAGE` / `GRADIENT_LINEAR` / ...（Figma 风格大写）
 * 只认一种就会「静默丢掉另一条路径的所有渐变」—— 这正是修之前的状况。
 *
 * 渐变几何到 Penpot 的换算依据（`frontend/src/app/main/ui/shapes/gradients.cljs`）：
 *   - linear：`x1/y1 = start-x/start-y`，`x2/y2 = end-x/end-y`，均在 objectBoundingBox（0..1）空间
 *   - radial：`cx/cy = start-x/start-y`，`r = |end - start|`，并且 `gradientTransform` 里
 *     有一个 `scale(width, 1)` —— 因此 `width` 是「垂直于半径方向的缩放比」，
 *     对应引擎 `transform[0][0]`（rx/r），用于表达椭圆径向渐变。
 */
import { normalizeColor, type NormalizedColor } from './color'

export type FillKind =
  | 'SOLID'
  | 'IMAGE'
  | 'GRADIENT_LINEAR'
  | 'GRADIENT_RADIAL'
  | 'GRADIENT_ANGULAR'
  | 'GRADIENT_DIAMOND'
  | 'UNKNOWN'

/** 把任意大小写/连接方式的填充类型归一为规范名 */
export function normalizeFillType(type: unknown): FillKind {
  if (typeof type !== 'string') return 'UNKNOWN'
  const key = type.trim().toUpperCase().replace(/[-\s]/g, '_')
  switch (key) {
    case 'SOLID':
    case 'COLOR':
      return 'SOLID'
    case 'IMAGE':
      return 'IMAGE'
    case 'GRADIENT_LINEAR':
    case 'LINEAR':
      return 'GRADIENT_LINEAR'
    case 'GRADIENT_RADIAL':
    case 'RADIAL':
      return 'GRADIENT_RADIAL'
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_CONIC':
    case 'CONIC':
    case 'ANGULAR':
      return 'GRADIENT_ANGULAR'
    case 'GRADIENT_DIAMOND':
    case 'DIAMOND':
      return 'GRADIENT_DIAMOND'
    default:
      return 'UNKNOWN'
  }
}

/** Penpot 的 Gradient 形态（见 typings/penpot.d.ts） */
export interface PenpotGradient {
  type: 'linear' | 'radial'
  startX: number
  startY: number
  endX: number
  endY: number
  width: number
  stops: { color: string; opacity: number; offset: number }[]
}

export interface GradientStopInput {
  position?: unknown
  offset?: unknown
  color?: unknown
  opacity?: unknown
}

export interface GradientInput {
  type?: unknown
  gradientStops?: unknown
  stops?: unknown
  gradientHandlePositions?: unknown
  transform?: unknown
  opacity?: unknown
  alpha?: unknown
}

export type GradientResult =
  | { ok: true; gradient: PenpotGradient }
  | { ok: false; reason: string; /** 可用的降级色（第一个色标），用于「至少别留空」 */ fallback?: NormalizedColor }


function readStops(input: GradientInput): GradientStopInput[] {
  const raw = Array.isArray(input.gradientStops)
    ? input.gradientStops
    : Array.isArray(input.stops)
      ? input.stops
      : []
  return raw.filter((item): item is GradientStopInput => Boolean(item) && typeof item === 'object')
}

/**
 * 构建 Penpot 渐变。
 *
 * 失败（conic / diamond / 色标不足 / 色值无法识别）时返回 `ok:false` + `fallback`，
 * 由调用方决定降级成纯色**并如实报告** —— 不在这里偷偷替换。
 */
export function buildPenpotGradient(input: GradientInput): GradientResult {
  const kind = normalizeFillType(input.type)

  if (kind === 'GRADIENT_ANGULAR' || kind === 'GRADIENT_DIAMOND') {
    return {
      ok: false,
      reason: `Penpot 只有 linear / radial 两种渐变，不支持 ${kind}（已降级为纯色）`,
      fallback: firstStopColor(input) ?? undefined,
    }
  }
  if (kind !== 'GRADIENT_LINEAR' && kind !== 'GRADIENT_RADIAL') {
    return { ok: false, reason: `无法识别的渐变类型: ${String(input.type)}` }
  }

  const rawStops = readStops(input)
  if (rawStops.length < 2) {
    return {
      ok: false,
      reason: `渐变至少需要 2 个色标，实际 ${rawStops.length} 个（已降级为纯色）`,
      fallback: firstStopColor(input) ?? undefined,
    }
  }

  const stops: PenpotGradient['stops'] = []
  const unrecognized: string[] = []

  for (let index = 0; index < rawStops.length; index += 1) {
    const stop = rawStops[index]
    const color = normalizeColor(stop.color, stop.opacity === undefined ? undefined : Number(stop.opacity))
    if (!color) {
      unrecognized.push(String(stop.color))
      continue
    }
    const explicit = stop.position ?? stop.offset
    const offset = explicit === undefined || explicit === null
      ? index / (rawStops.length - 1)
      : Number(explicit)
    stops.push({ color: color.hex, opacity: color.opacity, offset: clampOffset(offset) })
  }

  if (stops.length < 2) {
    return {
      ok: false,
      reason: `渐变的色值无法识别（${unrecognized.slice(0, 3).join(', ')}），已降级为纯色`,
      fallback: stops[0] ? { hex: stops[0].color, opacity: stops[0].opacity } : undefined,
    }
  }

  // 按位置排序：CSS 的色标语义与顺序无关，而 Penpot 的 linear 渲染也按 offset 排序
  stops.sort((a, b) => a.offset - b.offset)

  return { ok: true, gradient: { ...buildGeometry(kind, input, stops), stops } }
}

function buildGeometry(
  kind: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL',
  input: GradientInput,
  _stops: PenpotGradient['stops'],
): Omit<PenpotGradient, 'stops'> {
  const handles = readHandles(input)

  if (kind === 'GRADIENT_LINEAR') {
    const start = handles[0] ?? { x: 0, y: 0.5 }
    const end = handles[1] ?? { x: 1, y: 0.5 }
    return {
      type: 'linear',
      startX: clampUnit(start.x),
      startY: clampUnit(start.y),
      endX: clampUnit(end.x),
      endY: clampUnit(end.y),
      width: 1,
    }
  }

  // radial：Penpot 用 cx/cy + 半径端点 + width（垂直方向的缩放比）
  const center = handles[0] ?? { x: 0.5, y: 0.5 }
  const edge = handles[1] ?? { x: 1, y: 0.5 }
  const perpendicularScale = readPerpendicularScale(input)
  return {
    type: 'radial',
    startX: clampUnit(center.x),
    startY: clampUnit(center.y),
    endX: clampUnit(edge.x),
    endY: clampUnit(edge.y),
    width: perpendicularScale,
  }
}

function readHandles(input: GradientInput): { x: number; y: number }[] {
  const raw = Array.isArray(input.gradientHandlePositions) ? input.gradientHandlePositions : []
  return raw
    .filter((item): item is { x: unknown; y: unknown } => Boolean(item) && typeof item === 'object')
    .map((item) => ({ x: Number(item.x), y: Number(item.y) }))
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y))
}

/**
 * 读径向渐变的垂直缩放比。
 *
 * 引擎把椭圆比例放在 `transform[0][0]`（= rx / r，见 useClientRender 的
 * `fill.transform = [[rx / r, 0, 0], [0, ry / r, 0]]`）。Penpot 的
 * `(gmt/scale (point gwidth factor))` 只有 X 方向缩放，语义正好对应。
 */
function readPerpendicularScale(input: GradientInput): number {
  const transform = input.transform
  if (Array.isArray(transform) && Array.isArray(transform[0])) {
    const scale = Number((transform[0] as unknown[])[0])
    if (Number.isFinite(scale) && scale > 0) return scale
  }
  // 引擎另有一条「无 transform」的路径：rx == ry == r → 等比缩放为 1
  return 1
}

function firstStopColor(input: GradientInput): NormalizedColor | null {
  for (const stop of readStops(input)) {
    const color = normalizeColor(stop.color, stop.opacity === undefined ? undefined : Number(stop.opacity))
    if (color) return color
  }
  return null
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(-4, Math.min(4, value))
}

function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0
  // CSS 允许 0..1 之外的色标（表示截断），Penpot 不强校验，但收在合理范围更安全
  return Math.max(-1, Math.min(2, value))
}

/** 填充是否可见：同时接受引擎的 `isVisible` 与 DSL 的 `visible` */
export function isFillVisible(fill: { visible?: unknown; isVisible?: unknown }): boolean {
  if (fill.visible === false) return false
  if (fill.isVisible === false) return false
  return true
}

/** 填充透明度：同时接受引擎的 `alpha` 与 DSL 的 `opacity`（后者优先） */
export function readFillOpacity(fill: { opacity?: unknown; alpha?: unknown }): number | undefined {
  const value = fill.opacity ?? fill.alpha
  if (value === undefined || value === null) return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : undefined
}
