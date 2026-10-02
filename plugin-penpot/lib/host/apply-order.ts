/**
 * 属性应用顺序
 *
 * 顺序不是风格问题，而是**正确性**问题。两个真实约束：
 *
 * 1. `resize()` 会让 Penpot 文本的 `growType` 变成 `"fixed"`（官方 instruction 明示），
 *    因此**几何必须先于文本自适应**应用，否则刚设好的 auto-height 会被 resize 打回 fixed。
 * 2. 旋转（`rotation`）以几何为基准，必须在 `resize` 之后应用。
 *
 * 两个宿主实现共用本顺序，避免「MemoryHost 通过、真机失败」这类只在真实宿主上暴露的偏差。
 */
import type { NodeProperties } from './types'

/** 阶段顺序：name → 几何 → 外观 → 布局 → 文本 → 容器 */
export const PROPERTY_PHASES: readonly (readonly (keyof NodeProperties)[])[] = [
  ['name'],
  ['x', 'y', 'width', 'height', 'rotation'],
  [
    'opacity',
    'visible',
    'locked',
    'cornerRadius',
    'topLeftRadius',
    'topRightRadius',
    'bottomLeftRadius',
    'bottomRightRadius',
    'blendMode',
    // imageUrl 必须先于 fills：两者都会写 shape.fills，显式 fills 应当覆盖由 URL 推导的默认值
    'imageUrl',
    'imageScaleMode',
    'fills',
    'strokes',
    'strokeWidth',
    'strokeAlign',
    'effects',
  ],
  [
    'layoutMode',
    'itemSpacing',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'primaryAxisAlignItems',
    'counterAxisAlignItems',
    'primaryAxisSizingMode',
    'counterAxisSizingMode',
    'flexWrap',
    'layoutSizingHorizontal',
    'layoutSizingVertical',
    'layoutPositioning',
  ],
  [
    'characters',
    'fontName',
    'fontWeight',
    'fontSize',
    'lineHeight',
    'letterSpacing',
    'textAlignHorizontal',
    'textAlignVertical',
    'textAutoResize',
  ],
  ['clipsContent'],
]

/**
 * 按阶段顺序展开属性。
 * 未登记在 `PROPERTY_PHASES` 里的键会被追加在最后（保持前向兼容，不静默丢弃）。
 */
export function orderedPropertyEntries(props: NodeProperties): [keyof NodeProperties, unknown][] {
  const seen = new Set<string>()
  const out: [keyof NodeProperties, unknown][] = []

  for (const phase of PROPERTY_PHASES) {
    for (const key of phase) {
      const value = props[key]
      if (value === undefined) continue
      seen.add(key)
      out.push([key, value])
    }
  }

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || seen.has(key)) continue
    out.push([key as keyof NodeProperties, value])
  }

  return out
}
