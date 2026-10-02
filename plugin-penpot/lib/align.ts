/**
 * 对象之间对齐 / 等距分布（纯几何，宿主无关）
 *
 * ## 与"容器内对齐"是两件事（别混）
 *
 * - **容器内对齐**：flex 容器的 `primaryAxisAlignItems` / `counterAxisAlignItems`
 *   —— 改的是**容器**的属性，让子元素在容器里怎么排。本插件已支持（DSL 字段），
 *   服务端的指令引擎也有对应的中文关键词（`居中对齐` / `左对齐` / `两端对齐` …）。
 * - **对象之间对齐**（本文件）：把**若干个被选中的对象**互相摆齐，改的是每个对象的 x/y。
 *   Penpot 原语：`penpot.alignHorizontal(shapes, 'left'|'center'|'right')`、
 *   `alignVertical(shapes, 'top'|'center'|'bottom')`、`distributeHorizontal/Vertical(shapes)`。
 *   这一层此前**两边都没有** —— 所以 AI 说"把这三个对象左对齐"时，只能拿到容器语义（错的）。
 *
 * ## 语义（明确写下来，否则"对齐到谁"会变成猜）
 *
 * - **对齐**：参考系取**选区自身的包围盒**（Figma / MasterGo 的口径）——
 *   `MIN` 把各对象的 min 边对齐到包围盒的 min，`CENTER` 对中心，`MAX` 对 max 边。
 * - **等距分布**：**两端固定**，中间的按"相邻间隙相等"重排（Penpot 文档：*"position them
 *   horizontally with equal distances between them"* ✓ 是等间隙，不是等中心距）。
 *
 * ⚠️ Penpot 的原生 `align*` 文档只说 *"relative to one of them"*（相对其中之一），没写是哪一个。
 * 所以真机上"原生结果"与"本文件的包围盒口径"可能不同 —— 这一点记在
 * `内部笔记` 同类的待验清单里（需要真机核对），
 * 而 handler 的策略是：**优先用宿主原生**（与该宿主 UI 行为一致），失败/不支持才用本文件兜底。
 *
 * 纯函数、不碰宿主 → 可逐条单测。
 */

export type AlignAxis = 'HORIZONTAL' | 'VERTICAL'
export type AlignDirection = 'MIN' | 'CENTER' | 'MAX'

export interface AlignBox {
  x: number
  y: number
  width: number
  height: number
}

export interface AlignDelta {
  dx: number
  dy: number
}

/** 对齐至少需要两个对象（一个对象对齐到自己没有意义） */
export const MIN_ALIGN_NODES = 2
/** 等距分布至少需要三个对象（两个对象之间没有"中间项"可分布） */
export const MIN_DISTRIBUTE_NODES = 3

/** 选区包围盒 */
export function boundsOf(boxes: readonly AlignBox[]): AlignBox {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 }
  const left = Math.min(...boxes.map((b) => b.x))
  const top = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.width))
  const bottom = Math.max(...boxes.map((b) => b.y + b.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * 计算"把每个对象摆到对齐位置"所需的位移（Δx/Δy，单位与输入一致）。
 *
 * 只沿指定轴产生位移，另一轴恒为 0 —— 对齐不该顺手改动另一个方向的位置。
 */
export function computeAlignment(
  boxes: readonly AlignBox[],
  axis: AlignAxis,
  direction: AlignDirection,
): AlignDelta[] {
  if (boxes.length < MIN_ALIGN_NODES) return boxes.map(() => ({ dx: 0, dy: 0 }))
  const bounds = boundsOf(boxes)

  return boxes.map((box) => {
    if (axis === 'HORIZONTAL') {
      const target = direction === 'MIN'
        ? bounds.x
        : direction === 'CENTER'
          ? bounds.x + bounds.width / 2
          : bounds.x + bounds.width
      const current = direction === 'MIN'
        ? box.x
        : direction === 'CENTER'
          ? box.x + box.width / 2
          : box.x + box.width
      return { dx: target - current, dy: 0 }
    }

    const target = direction === 'MIN'
      ? bounds.y
      : direction === 'CENTER'
        ? bounds.y + bounds.height / 2
        : bounds.y + bounds.height
    const current = direction === 'MIN'
      ? box.y
      : direction === 'CENTER'
        ? box.y + box.height / 2
        : box.y + box.height
    return { dx: 0, dy: target - current }
  })
}

/**
 * 等距分布：**两端固定**，中间的按"相邻间隙相等"重排。
 *
 * 间隙口径：沿轴的总长度减去所有对象在该轴的尺寸之和，再均分给 (n-1) 个间隙。
 * 结果可能是负数（对象总宽超过两端之间距离时）—— 那正是"挤在一起"的真实结果，
 * 不夹到 0（夹了反而会骗人：看起来分布了，其实重叠）。
 */
export function computeDistribution(boxes: readonly AlignBox[], axis: AlignAxis): AlignDelta[] {
  if (boxes.length < MIN_DISTRIBUTE_NODES) return boxes.map(() => ({ dx: 0, dy: 0 }))

  const size = (b: AlignBox) => (axis === 'HORIZONTAL' ? b.width : b.height)
  const start = (b: AlignBox) => (axis === 'HORIZONTAL' ? b.x : b.y)

  // 按起点排序：分布的口径是"沿轴顺序"，与传入顺序无关
  const order = boxes
    .map((box, index) => ({ index, box }))
    .sort((a, b) => start(a.box) - start(b.box))

  const first = order[0].box
  const last = order[order.length - 1].box
  const span = (start(last) + size(last)) - start(first)
  const occupied = boxes.reduce((sum, box) => sum + size(box), 0)
  const gap = (span - occupied) / (boxes.length - 1)

  const deltas: AlignDelta[] = boxes.map(() => ({ dx: 0, dy: 0 }))
  let cursor = start(first)
  for (const { index, box } of order) {
    const shift = cursor - start(box)
    deltas[index] = axis === 'HORIZONTAL' ? { dx: shift, dy: 0 } : { dx: 0, dy: shift }
    cursor += size(box) + gap
  }
  return deltas
}
