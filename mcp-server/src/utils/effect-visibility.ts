/**
 * Effect 可见性判定（单一实现）
 *
 * 背景：同一个"效果是否生效"的概念在三处用了两种字段名，历史上造成真实缺陷：
 * - MasterGo 运行时对象（`ShadowEffect` / `BlurEffect`）用 **`isVisible`**
 * - DSL（dsl_export / dsl-spec）用 **`visible`**
 * - 设计器里的"效果开关"另用 **`isEffectShow`**
 *
 * `design_describe` 曾用 `f.visible !== false` 过滤运行时对象 → 过滤恒为真；
 * `dsl-to-code` 的逐元素路径与 `dsl-to-semantic` 曾各自判断，口径不一。
 *
 * 因此：所有"效果是否应输出"的判断一律走本函数，同时接受两种字段名，
 * 并且 `isEffectShow === false`（开关关闭）一律视为不生效。
 *
 * 注意：`stripIrrelevantFields()` 压缩 DSL 时会删掉 effect 的 `visible`
 * （`EFFECT_IRRELEVANT_FIELDS`），压缩后只能靠 `isEffectShow` 判定 —— 这是
 * 有意的取舍（省 token），如需精确保留 `visible:false` 的隐藏语义，
 * 应从压缩白名单中移除 `visible`。
 */

/** 该效果是否应参与渲染 / 代码生成 */
export function isEffectVisible(effect: unknown): boolean {
  if (!effect || typeof effect !== 'object') return false
  const e = effect as Record<string, unknown>
  const visibility = e.isVisible !== undefined ? e.isVisible : e.visible
  return visibility !== false && e.isEffectShow !== false
}

/** 过滤出生效的效果（非数组返回空数组） */
export function filterVisibleEffects(effects: unknown): any[] {
  if (!Array.isArray(effects)) return []
  return effects.filter((effect) => isEffectVisible(effect))
}
