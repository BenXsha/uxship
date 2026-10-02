/**
 * DSL 字段名 / 枚举 → Penpot 字段名 / 枚举 的映射表
 *
 * 从 `penpot.ts` 拆出（内聚单元：纯查表/switch，无宿主状态）。两侧命名体系不同
 * （见 `typings/penpot.d.ts` 与 DSL 的 NodeProperties），归一全部收在这里，宿主实现只负责调用。
 */
import type { NodeProperties } from './types'

/** DSL 的 padding 字段名 → Penpot FlexLayout 的字段名（两侧命名不同，见 api_types.yml） */
export const PENPOT_PADDING_KEYS: Record<string, string> = {
  paddingTop: 'topPadding',
  paddingRight: 'rightPadding',
  paddingBottom: 'bottomPadding',
  paddingLeft: 'leftPadding',
}

/** DSL 的分角圆角字段名 → Penpot 的 ShapeBase 成员名 */
export const PENPOT_CORNER_KEYS: Record<string, string> = {
  topLeftRadius: 'borderRadiusTopLeft',
  topRightRadius: 'borderRadiusTopRight',
  bottomLeftRadius: 'borderRadiusBottomLeft',
  bottomRightRadius: 'borderRadiusBottomRight',
}

/** DSL 的 SCREAMING_SNAKE 混合模式 → Penpot 的 kebab-case */
export function mapBlendMode(value: string): string | null {
  const kebab = value.trim().toLowerCase().replace(/_/g, '-')
  const supported = new Set([
    'normal', 'darken', 'multiply', 'color-burn', 'lighten', 'screen', 'color-dodge',
    'overlay', 'soft-light', 'hard-light', 'difference', 'exclusion',
    'hue', 'saturation', 'color', 'luminosity',
  ])
  return supported.has(kebab) ? kebab : null
}

/** DSL 的描边对齐 → Penpot 的小写枚举 */
export function mapStrokeAlignment(value: NodeProperties['strokeAlign']): 'center' | 'inner' | 'outer' {
  if (value === 'OUTSIDE') return 'outer'
  if (value === 'CENTER') return 'center'
  return 'inner'
}

export function mapPrimaryAxis(value: NodeProperties['primaryAxisAlignItems']): PenpotFlexLayout['justifyContent'] {
  switch (value) {
    case 'CENTER':
      return 'center'
    case 'MAX':
      return 'end'
    case 'SPACE_BETWEEN':
      return 'space-between'
    default:
      return 'start'
  }
}

export function mapCounterAxis(value: NodeProperties['counterAxisAlignItems']): PenpotFlexLayout['alignItems'] {
  switch (value) {
    case 'CENTER':
      return 'center'
    case 'MAX':
      return 'end'
    default:
      return 'start'
  }
}

export function mapSizing(value: NodeProperties['layoutSizingHorizontal']): 'fill' | 'auto' | 'fix' {
  switch (value) {
    case 'FILL':
      return 'fill'
    // 客户端渲染引擎用 AUTO，MasterGo 侧用 HUG —— 两者同义
    case 'HUG':
    case 'AUTO':
      return 'auto'
    default:
      return 'fix'
  }
}

export function mapTextAlign(value: NodeProperties['textAlignHorizontal']): PenpotText['align'] {
  switch (value) {
    case 'CENTER':
      return 'center'
    case 'RIGHT':
      return 'right'
    case 'JUSTIFIED':
      return 'justify'
    case 'LEFT':
      return 'left'
    default:
      return null
  }
}

export function mapTextVerticalAlign(value: NodeProperties['textAlignVertical']): PenpotText['verticalAlign'] {
  switch (value) {
    case 'CENTER':
      return 'center'
    case 'BOTTOM':
      return 'bottom'
    case 'TOP':
      return 'top'
    default:
      return null
  }
}

export function mapGrowType(value: NodeProperties['textAutoResize']): PenpotText['growType'] {
  switch (value) {
    /**
     * DSL `WIDTH_AND_HEIGHT` = 「不换行，容器随文本扩展」（短标题/按钮文字/标签）。
     *
     * 对应 Penpot 的 `auto-width`（宽随内容），**不是** `auto-height`。
     * 原先这里把两者都折成 `auto-height`（固定宽 + 自动高），于是宿主字体比浏览器测得宽几 px 时，
     * 短标签就被**硬折成两行** —— 真机实测：`Hero Tag Text` 引擎 DSL 是 106×18 单行，
     * 落画布变成 113×36 两行。renderer 头部第 2 条策略写的就是「都没给 → 自动宽（单行贴合）」，
     * 这里对齐它（也对齐 MasterGo 侧原生 `WIDTH_AND_HEIGHT` 的行为）。
     */
    case 'WIDTH_AND_HEIGHT':
      return 'auto-width'
    /** 固定宽 + 自动高（保留折行）—— 与 `auto-width` 互斥，不可合并 */
    case 'HEIGHT':
      return 'auto-height'
    case 'TRUNCATE':
    case 'NONE':
      return 'fixed'
    default:
      return 'fixed'
  }
}
