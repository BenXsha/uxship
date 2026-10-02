/**
 * Penpot 原生结构 → DSL 口径（**读方向**的归一化）
 *
 * ## 为什么必须有这一层
 *
 * `applyProperties` 吃的是 DSL 形状（`{type:'SOLID', color}`），而 Penpot 的 `shape.fills`
 * 吐的是它自己的结构（`{fillColor, fillOpacity, fillColorGradient, …}`）。之前回读是**原样透传**，
 * 于是：
 *   - `design/describe` 的填充摘要变成 `[""]`（读不到 `type`/`color`）；
 *   - `dsl/export*` 在真机上会导出**没有颜色**的填充 → 颜色全丢。
 *
 * 而 MemoryHost 存的就是 DSL 形状，所以这套 bug 在单测里**全绿** —— 典型的「替身没照抄真宿主」。
 * 本文件的测试夹具直接抄自真机（`node_get` 返回的原始 JSON），就是为了堵住这个口子。
 *
 * 归一化是**纯函数**：不碰宿主，只为可测。
 */
import type { HostEffect, HostFill, HostStroke } from './types'
import { capFromPenpot } from './penpot-paint'

/** Penpot 渐变 → DSL 渐变类型词 */
const GRADIENT_TYPE: Record<string, string> = {
  linear: 'GRADIENT_LINEAR',
  radial: 'GRADIENT_RADIAL',
}

const STROKE_ALIGN: Record<string, 'INSIDE' | 'OUTSIDE' | 'CENTER'> = {
  inner: 'INSIDE',
  outer: 'OUTSIDE',
  center: 'CENTER',
}

type Raw = Record<string, unknown>

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)
const asArray = (value: unknown): Raw[] => (Array.isArray(value) ? (value as Raw[]) : [])

/** Penpot 渐变对象 → DSL 的 stops + handle + width(transform) */
function readGradient(raw: Raw): Pick<HostFill, 'type' | 'gradientStops' | 'gradientHandlePositions' | 'transform'> {
  const gradient = (raw.fillColorGradient ?? raw.strokeColorGradient) as Raw | null | undefined
  if (!gradient || typeof gradient !== 'object') return { type: 'SOLID' }

  const type = GRADIENT_TYPE[String(gradient.type ?? 'linear')] ?? 'GRADIENT_LINEAR'
  const stops = asArray(gradient.stops).map((stop) => ({
    position: num(stop.offset) ?? 0,
    color: str(stop.color) ?? '#000000',
    ...(num(stop.opacity) !== undefined ? { opacity: num(stop.opacity) } : {}),
  }))

  const startX = num(gradient.startX)
  const startY = num(gradient.startY)
  const endX = num(gradient.endX)
  const endY = num(gradient.endY)
  const handles =
    startX !== undefined && startY !== undefined && endX !== undefined && endY !== undefined
      ? [{ x: startX, y: startY }, { x: endX, y: endY }]
      : undefined

  // `width` 是径向的垂直缩放；写入侧从 `transform[0][0]` 读它，这里做严格逆变换
  const width = num(gradient.width)
  const transform = width !== undefined && width !== 1
    ? [[width, 0, 0], [0, width, 0]]
    : undefined

  return { type, gradientStops: stops, ...(handles ? { gradientHandlePositions: handles } : {}), ...(transform ? { transform } : {}) }
}

/** Penpot 填充数组 → DSL 填充数组（未知结构不丢，标成 UNKNOWN 带原始值） */
export function fromPenpotFills(raw: unknown): HostFill[] {
  const out: HostFill[] = []
  for (const paint of asArray(raw)) {
    const opacity = num(paint.fillOpacity)
    const gradient = paint.fillColorGradient

    if (gradient) {
      out.push({ ...readGradient(paint), opacity } as HostFill)
      continue
    }
    const color = str(paint.fillColor)
    if (color) {
      const refFile = str(paint.fillColorRefFile)
      const refId = str(paint.fillColorRefId)
      out.push({
        type: 'SOLID',
        color,
        opacity,
        // 库颜色引用（= 样式/令牌绑定）：读回来要保留，否则「绑着样式」这件事在导出后消失
        ...(refFile || refId ? { colorRef: { file: refFile, id: refId } } : {}),
      } as HostFill)
      continue
    }
    if (paint.fillImage) {
      // SAFETY: 图片填充读回时保留原始结构（imageRef + imageRaw）；HostFill 是判别联合，IMAGE 分支的细节放在 imageRaw，故按 HostFill 断言。
      out.push({ type: 'IMAGE', imageRef: str((paint.fillImage as Raw).id), imageRaw: paint.fillImage } as unknown as HostFill)
      continue
    }
    if (Object.keys(paint).length) {
      // SAFETY: 未知结构的填充不丢弃，包成 UNKNOWN 并存 hostRaw；断言只是把它装进 HostFill 判别联合。
      out.push({ type: 'UNKNOWN', hostRaw: paint } as unknown as HostFill)
    }
  }
  return out
}

/** Penpot 描边数组 → DSL 描边数组 */
export function fromPenpotStrokes(raw: unknown): HostStroke[] {
  const out: HostStroke[] = []
  for (const stroke of asArray(raw)) {
    const opacity = num(stroke.strokeOpacity)
    const width = num(stroke.strokeWidth)
    const alignment = str(stroke.strokeAlignment)
    // 线帽：Penpot 是「起点/终点」两个成员，DSL 是元素级单值 —— 回读时两端都给，导出端才能还原。
    // 平头在 Penpot 是空值 → `capFromPenpot` 返回 undefined，届时整个字段不写（不伪造 NONE）。
    const capStart = capFromPenpot(stroke.strokeCapStart)
    const capEnd = capFromPenpot(stroke.strokeCapEnd)
    const common = {
      ...(width !== undefined ? { width } : {}),
      ...(alignment && STROKE_ALIGN[alignment] ? { align: STROKE_ALIGN[alignment] } : {}),
      ...(capStart ? { capStart } : {}),
      ...(capEnd ? { capEnd } : {}),
      ...(str(stroke.strokeStyle) && stroke.strokeStyle !== 'solid'
        ? { strokeStyle: str(stroke.strokeStyle) as 'solid' | 'dashed' | 'dotted' | 'mixed' | 'none' | 'svg' }
        : {}),
    }

    if (stroke.strokeColorGradient) {
      out.push({ ...readGradient(stroke), opacity, ...common } as HostStroke)
      continue
    }
    const color = str(stroke.strokeColor)
    if (color) {
      out.push({ type: 'SOLID', color, opacity, ...common } as HostStroke)
      continue
    }
    if (Object.keys(stroke).length) {
      // SAFETY: 同上——未知结构的描边包成 UNKNOWN 并存 hostRaw，断言只是装进 HostStroke 判别联合。
      out.push({ type: 'UNKNOWN', hostRaw: stroke, ...common } as unknown as HostStroke)
    }
  }
  return out
}

/**
 * Penpot 的「三件套」（shadows + blur + backgroundBlur）→ DSL 效果数组。
 *
 * 写入侧把它们拆成三个字段，所以读的时候要合起来 —— 否则「背景模糊」这类效果
 * 在导出后会凭空消失。
 */
export function fromPenpotEffects(input: {
  shadows?: unknown
  blur?: unknown
  backgroundBlur?: unknown
}): HostEffect[] {
  const out: HostEffect[] = []

  for (const shadow of asArray(input.shadows)) {
    const style = str(shadow.style)
    const color = shadow.color as Raw | undefined
    // SAFETY: 阴影映射到 DSL 的 DROP_SHADOW/INNER_SHADOW；HostEffect 是判别联合，这里按已构造的成员形状断言。
    out.push({
      type: style === 'inner-shadow' ? 'INNER_SHADOW' : 'DROP_SHADOW',
      offset: { x: num(shadow.offsetX) ?? 0, y: num(shadow.offsetY) ?? 0 },
      radius: num(shadow.blur) ?? 0,
      spread: num(shadow.spread) ?? 0,
      color: str(color?.color) ?? '#000000',
      ...(num(color?.opacity) !== undefined ? { opacity: num(color?.opacity) } : {}),
      ...(shadow.hidden === true ? { visible: false } : {}),
    } as unknown as HostEffect)
  }

  for (const [key, type] of [['blur', 'LAYER_BLUR'], ['backgroundBlur', 'BACKGROUND_BLUR']] as const) {
    const blur = input[key] as Raw | null | undefined
    if (blur && typeof blur === 'object') {
      // SAFETY: 模糊映射到 LAYER_BLUR/BACKGROUND_BLUR；按 HostEffect 的对应成员形状断言。
      out.push({
        type,
        radius: num(blur.value) ?? 0,
        ...(blur.hidden === true ? { visible: false } : {}),
      } as unknown as HostEffect)
    }
  }

  return out
}
