/**
 * Paint / Effect 的公共可见性与序列化逻辑
 *
 * 背景：MasterGo 插件 API 与 DSL 对同一概念用了两种字段名，历史上各处理器各写一套，
 * 导致过真实缺陷：
 * - 运行时对象（`ShadowEffect` / `SolidPaint`）用 **`isVisible`**，DSL 用 **`visible`**
 *   —— `design_describe` 曾用 `f.visible !== false` 过滤，过滤恒为真（隐藏项被照常上报）
 * - `effects` 的字段提取在 `serializer` / `dsl-exporter` / `design_describe` 三处重复，
 *   而 `serializer` 干脆漏了 effects（`node_get` / `selection_get` 读不到阴影/模糊）
 *
 * 因此这里统一：可见性判定 + effects 提取。新增读取 effects 的地方一律复用本模块。
 */

export interface SerializedEffect {
  type: string
  radius?: number
  color?: { r: number; g: number; b: number; a?: number }
  offset?: { x: number; y: number }
  spread?: number
  blendMode?: string
  showShadowBehindNode?: boolean
  /** 运行时字段名（DSL 侧对应 `visible`） */
  isVisible: boolean
  isEffectShow?: boolean
  name?: string
  /** 新效果类型（LIQUID_GLASS / MOTION_BLUR）的专有数值字段 */
  angle?: number
  depth?: number
  dispersion?: number
  refraction?: number
  lightIntensity?: number
  lightAngle?: number
}

/** 阴影类效果（有 color/offset/spread 语义） */
export function isShadowEffect(effect: any): boolean {
  return effect?.type === 'DROP_SHADOW' || effect?.type === 'INNER_SHADOW'
}

/** 模糊类效果 */
export function isBlurEffect(effect: any): boolean {
  return effect?.type === 'LAYER_BLUR' || effect?.type === 'BACKGROUND_BLUR'
}

/**
 * 可见性判定：兼容运行时 `isVisible` 与 DSL `visible`。
 * 缺失时视为可见（与 MasterGo 默认行为一致）。
 */
export function isItemVisible(item: any): boolean {
  if (!item) return true
  const flag = item.isVisible !== undefined ? item.isVisible : item.visible
  return flag !== false
}

/** 单个 effect → 纯对象（运行时字段名，颜色/偏移做浅拷贝，避免把 mg 内部对象带进 JSON） */
export function serializeEffect(effect: any): SerializedEffect {
  const result: SerializedEffect = {
    type: String(effect?.type ?? 'UNKNOWN'),
    isVisible: isItemVisible(effect),
  }

  if (typeof effect?.radius === 'number') result.radius = effect.radius
  if (typeof effect?.spread === 'number') result.spread = effect.spread
  if (effect?.blendMode) result.blendMode = String(effect.blendMode)
  if (typeof effect?.showShadowBehindNode === 'boolean') {
    result.showShadowBehindNode = effect.showShadowBehindNode
  }
  if (typeof effect?.isEffectShow === 'boolean') result.isEffectShow = effect.isEffectShow
  if (effect?.name) result.name = String(effect.name)

  // 新效果类型的专有数值字段（MOTION_BLUR.angle；LIQUID_GLASS.depth/dispersion/refraction/
  // lightIntensity/lightAngle/radius）——宿主提供什么就回读什么，不再静默丢字段。
  // 实测（私有版 1.10.3）：MOTION_BLUR 能写入并回读 radius，但 angle 不回读；
  // LIQUID_GLASS 仅回读 type/isVisible/blendMode（数值字段宿主未暴露）。
  for (const key of ['angle', 'depth', 'dispersion', 'refraction', 'lightIntensity', 'lightAngle'] as const) {
    if (typeof effect?.[key] === 'number') result[key] = effect[key]
  }

  const color = effect?.color
  if (color && typeof color === 'object' && typeof color.r === 'number') {
    result.color = { r: color.r, g: color.g, b: color.b, a: color.a }
  }

  const offset = effect?.offset
  if (offset && typeof offset === 'object' && typeof offset.x === 'number') {
    result.offset = { x: offset.x, y: offset.y }
  }

  return result
}

/** effects 数组 → 纯对象数组；非数组返回 [] */
export function serializeEffects(effects: any): SerializedEffect[] {
  if (!Array.isArray(effects) || effects.length === 0) return []
  return effects.map((effect) => serializeEffect(effect))
}
