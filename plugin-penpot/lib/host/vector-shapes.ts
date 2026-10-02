/**
 * 多边形 / 星形 / 线段 的几何生成（纯函数）
 *
 * 为什么走「生成 `d` + 原生 Path」而不是绕过 API：
 * 这三类图形**本来就是路径**，Penpot 的 `Path` 完全能表达，而且落地后是**原生可编辑矢量**
 * （能改填充/描边/尺寸，也能进布尔运算）。用 `createShapeFromSvg` 反而是降级：
 * 拿到一个不透明的 `svg-raw`，失去原生语义（圆角、token 绑定、在布局里当矩形用）。
 *
 * 真正必须绕过的只有 **Penpot 渐变模型没有的 paint**（conic / diamond）—— 见文件末尾说明。
 */

const fmt = (value: number): string => String(Math.round(value * 1000) / 1000)

/** 顶点数下限：2 个点连线、3 个点才是多边形（与 Figma 的约束一致） */
const MIN_POINTS = 3
/** 顶点数上限：防呆（手写 DSL 传 1e6 会把画布打爆） */
const MAX_POINTS = 512

function clampPointCount(pointCount: number | undefined, min = MIN_POINTS): number {
  const value = Math.floor(Number(pointCount ?? min))
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(MAX_POINTS, value))
}

/**
 * 正多边形：外接圆内切于给定盒子，**第一个顶点在正上方**（与 Figma / 设计工具直觉一致）。
 */
export function polygonPath(pointCount: number | undefined, width: number, height: number): string {
  const n = clampPointCount(pointCount)
  const cx = width / 2
  const cy = height / 2
  const rx = width / 2
  const ry = height / 2

  const points: string[] = []
  for (let i = 0; i < n; i += 1) {
    // -90° 起（正上方），顺时针
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2
    points.push(`${fmt(cx + rx * Math.cos(angle))} ${fmt(cy + ry * Math.sin(angle))}`)
  }
  return `M ${points[0]} L ${points.slice(1).join(' L ')} Z`
}

/**
 * 星形：外顶点与内顶点交替，外接圆内切于盒子。
 * `innerRatio` 是内半径 / 外半径（Figma 的 star innerRadius，0–1，默认 0.5）。
 */
export function starPath(
  pointCount: number | undefined,
  innerRatio: number | undefined,
  width: number,
  height: number,
): string {
  const n = clampPointCount(pointCount, 3)
  const raw = Number(innerRatio ?? 0.5)
  const ratio = Number.isFinite(raw) ? Math.max(0.05, Math.min(1, raw)) : 0.5

  const cx = width / 2
  const cy = height / 2
  const rx = width / 2
  const ry = height / 2

  const points: string[] = []
  for (let i = 0; i < n * 2; i += 1) {
    const angle = (Math.PI * i) / n - Math.PI / 2
    const scale = i % 2 === 0 ? 1 : ratio
    points.push(`${fmt(cx + rx * scale * Math.cos(angle))} ${fmt(cy + ry * scale * Math.sin(angle))}`)
  }
  return `M ${points[0]} L ${points.slice(1).join(' L ')} Z`
}

/**
 * 线段：盒子的**水平中线**（设计工具里的 line 用包围盒表达长度与位置，线本身水平）。
 * 只描边不填充 —— 由上层给它 `strokes`。
 */
export function linePath(width: number, height: number): string {
  const y = height / 2
  return `M 0 ${fmt(y)} H ${fmt(width)}`
}

/** 多边形 / 星形 / 线段都能生成几何：由 DSL 的 `pointCount` 等参数推导 `d` */
export type VectorKind = 'polygon' | 'star' | 'line'

export function buildVectorPath(
  kind: VectorKind,
  options: { pointCount?: number; innerRadius?: number; width: number; height: number },
): string {
  switch (kind) {
    case 'polygon':
      return polygonPath(options.pointCount, options.width, options.height)
    case 'star':
      return starPath(options.pointCount, options.innerRadius, options.width, options.height)
    case 'line':
      return linePath(options.width, options.height)
  }
}
