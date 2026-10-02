/**
 * HTML → DSL「实例子节点覆写」翻译（纯函数，DOM-free，可单测）
 *
 * 对应 DSL `InstanceElement.overrides?: Record<string, Record<string, string>>`，
 * 由插件端渲染器消费（plugin-mastergo/lib/api/dsl-renderer.ts：按子节点名 `findOne` 命中后
 * 支持 `text` / `fill` / `visible` 三类属性）。
 *
 * HTML 写法：
 *   data-override-text-<childName>="内容"
 *   data-override-fill-<childName>="#FF0066"
 *   data-override-visible-<childName>="false"
 *
 * 语义约定：
 * - `<childName>` 允许含 `-`（如 `Label-1` / `Item-0` / `Cell-0-1`），属性名按**第一个** `-`
 *   切分（`/^data-override-(text|fill|visible)-(.+)$/`），剩余部分整体作为子节点名，不截断。
 * - `<childName>` 为空（`data-override-text-`）→ 该属性被忽略。
 * - 值一律**按字符串**写进 DSL（渲染器自己用 `value === 'true'` 判定可见性）：
 *   `text` / `fill` 原样透传；`visible` 归一化为 `'true'` / `'false'`
 *   （大小写不敏感地接受 `true` / `1` / `yes`，其余含空串一律 `'false'`）。
 * - 同一 childName 的多个属性合并进同一个对象。
 * - 无任何命中 → 返回 `undefined`（而不是 `{}`），让调用方可以「无覆写时完全不写字段」。
 *
 * 关于签名里为什么还有一个 `attrNames`：只凭 `getAttr` **无法枚举**属性名
 * （DOM `getAttribute` 不支持通配查询），而 `<childName>` 是任意字符串，
 * 不存在可枚举的固定名单。因此属性名列表必须由调用方一并传入
 * （客户端渲染引擎传 `element.getAttributeNames()`）。
 */

/** 属性名 → [属性类型, 子节点名]；子节点名取第一个 `-` 之后的全部内容 */
const OVERRIDE_ATTR_RE = /^data-override-(text|fill|visible)-(.+)$/

/** 可见性真值（大小写不敏感）；注意值会被 trim 后再比对，但写进 DSL 的仍是 'true' / 'false' */
const VISIBLE_TRUTHY = new Set(['true', '1', 'yes'])

/** 从元素属性解析「实例子节点覆写」→ DSL overrides。无命中时返回 undefined（不要返回空对象）。 */
export function parseInstanceOverrides(
  getAttr: (name: string) => string | null,
  attrNames: readonly string[],
): Record<string, Record<string, string>> | undefined {
  let overrides: Record<string, Record<string, string>> | undefined

  for (const attrName of attrNames) {
    const matched = OVERRIDE_ATTR_RE.exec(attrName)
    if (!matched) continue
    const prop = matched[1]
    const childName = matched[2]
    // 值为 null = 调用方给的属性名实际取不到（DOM 上不该发生）→ 视作未声明
    const raw = getAttr(attrName)
    if (raw === null) continue

    let props = overrides ? overrides[childName] : undefined
    if (!props) {
      props = {}
      if (!overrides) overrides = {}
      overrides[childName] = props
    }
    props[prop] = prop === 'visible'
      ? (VISIBLE_TRUTHY.has(raw.trim().toLowerCase()) ? 'true' : 'false')
      : raw
  }

  return overrides
}
