/**
 * 实例子节点覆写（`data-override-*` → DSL `overrides`）—— **唯一实现**
 *
 * 为什么单独一个模块（而不是留在 `swapComponentHandlers.ts` 里）：
 * 三个地方都要用它 —— `dsl-renderer`（实例渲染）、`swapComponentHandlers`（换组件）、
 * `teamLibraryHandlers`（团队库导入实例）。而 `swapComponentHandlers` 与
 * `teamLibraryHandlers` 之间本来就有反向依赖，把它放其中任一侧都会形成**模块环**。
 *
 * 环在 ESM 下因为函数声明提升通常"能跑"，但本仓库吃过一次**只在打包产物里复现**的亏
 * （见 `plugin-penpot/README.md` 的 `test:bundle` 一节），所以不让它存在。
 *
 * 语义要点（都是踩出来的）：
 * - 按**子图层名** `findOne` 命中目标；找不到不静默，记 `target-not-found`
 * - `fill` 只接受 `#RGB` / `#RRGGBB`（归一化）—— 旧实现会把 `rgba(...)` 算成 NaN 颜色
 * - `visible` 按字符串判定（渲染器口径 `value === 'true'`）
 * - 任何"看起来成功、其实没生效"的情形都进 `OverrideSkip[]`，由调用方接进渲染报告
 */

/** 覆写降级原因：每一种"看起来成功、其实没生效"的情形都要能被上报 */
export type OverrideSkipReason =
  /** 实例子树里没有该名字的图层 */
  | 'target-not-found'
  /** text 覆写落到非 TEXT 节点上 */
  | 'not-text'
  /** fill 值不是 #RGB / #RRGGBB */
  | 'invalid-fill'
  /** 目标节点没有填充层，无处写入颜色 */
  | 'no-fill'
  /** 未知覆写属性（只支持 text / fill / visible） */
  | 'unknown-prop'
  /** 写入本身抛错（宿主拒绝赋值等） */
  | 'write-failed'

/** 一条"属性级降级"记录（供渲染报告 / 换组件报告上报，不要静默吞掉） */
export interface OverrideSkip {
  childName: string
  reason: OverrideSkipReason
  /** 触发降级的属性名；`target-not-found` 时缺省（整个 childName 都没命中） */
  prop?: string
  /** 原始值（非法 fill / 未知属性时用于说明） */
  value?: string
  message: string
}

/**
 * `#RGB` / `#RRGGBB`（大小写不敏感）→ 归一化成小写 `#RRGGBB`（`#abc` → `#aabbcc`）。
 *
 * 其它一切形式（`rgba(...)` / `red` / 空串 / `#abcd` / 非字符串）返回 `null` —— **不做颜色猜测**：
 * 旧实现直接 `parseInt(value.slice(1,3),16)`，`rgba(…)` 会算出 `parseInt('gb') → NaN` 的"合法但错误"的颜色。
 */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(raw)) return null
  const hex = raw.slice(1).toLowerCase()
  return hex.length === 3
    ? `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    : `#${hex}`
}

/**
 * 应用实例子节点覆写（按子图层名 `findOne` 命中后设置 text / fill / visible）。
 *
 * **唯一实现**：DSL 实例渲染路径（`dsl-renderer.renderInstance`）与换组件路径
 * （`applyComponentSwap` 的 swap / replace 两种模式）都调用这里，避免两份语义漂移。
 *
 * 不生效的属性不会静默：全部收集进返回值，并逐个回调 `onSkip`（便于就地接到渲染报告）。
 *
 * @returns 全部降级明细（调用方无法写回时至少能一次汇总上报）
 */
export function applyInstanceOverrides(
  instance: any,
  overrides?: Record<string, Record<string, string>> | null,
  onSkip?: (skip: OverrideSkip) => void,
): OverrideSkip[] {
  const skips: OverrideSkip[] = []
  if (!instance || !overrides || typeof overrides !== 'object') return skips

  const report = (skip: OverrideSkip): void => {
    skips.push(skip)
    onSkip?.(skip)
  }

  const canLookup = typeof instance.findOne === 'function'

  for (const [childName, props] of Object.entries(overrides)) {
    const target = canLookup ? instance.findOne((n: any) => n && n.name === childName) : null
    if (!target) {
      report({
        childName,
        reason: 'target-not-found',
        message: `覆写目标图层 "${childName}" 未找到`,
      })
      continue
    }

    for (const [prop, rawValue] of Object.entries(props || {})) {
      const value = rawValue === null || rawValue === undefined ? '' : String(rawValue)
      try {
        switch (prop) {
          case 'text':
            if (target.type === 'TEXT') {
              target.characters = value
            } else {
              report({
                childName,
                prop,
                value,
                reason: 'not-text',
                message: `"${childName}" 是 ${target.type} 而非 TEXT，text 覆写未生效`,
              })
            }
            break
          case 'fill': {
            const hex = normalizeHexColor(value)
            if (!hex) {
              report({
                childName,
                prop,
                value,
                reason: 'invalid-fill',
                message: `"${childName}" 的 fill "${value}" 不是 #RGB / #RRGGBB，已跳过（不做颜色猜测）`,
              })
              break
            }
            const fills = Array.isArray(target.fills) ? [...target.fills] : []
            if (fills.length === 0) {
              report({
                childName,
                prop,
                value,
                reason: 'no-fill',
                message: `"${childName}" 没有填充，fill "${value}" 已跳过`,
              })
              break
            }
            fills[0] = {
              ...fills[0],
              type: 'SOLID',
              color: {
                r: parseInt(hex.slice(1, 3), 16) / 255,
                g: parseInt(hex.slice(3, 5), 16) / 255,
                b: parseInt(hex.slice(5, 7), 16) / 255,
                a: 1,
              },
            }
            target.fills = fills
            break
          }
          case 'visible':
            target.visible = value.trim().toLowerCase() === 'true'
            break
          default:
            report({
              childName,
              prop,
              value,
              reason: 'unknown-prop',
              message: `"${childName}" 的覆写属性 "${prop}" 未知（支持 text / fill / visible），已跳过`,
            })
        }
      } catch (err: any) {
        report({
          childName,
          prop,
          value,
          reason: 'write-failed',
          message: `"${childName}.${prop}" 写入失败：${err?.message || err}`,
        })
      }
    }
  }

  return skips
}
