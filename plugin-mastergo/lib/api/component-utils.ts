import { processColor } from '../utils/color-utils'
import { createNodeByType, applyNodeProperties } from '../utils/node-utils'
import { serializeNode as serializeFullNode } from './serializer'

// ─── 辅助函数 ──────────────────────────────────────────

export function solidFill(color: string, alpha = 1): SolidPaint {
  return { type: 'SOLID', color: processColor(color), isVisible: true, alpha, blendMode: 'NORMAL' }
}

/**
 * 阴影效果。
 * 按 MasterGo ShadowEffect 规范补齐 spread / blendMode / showShadowBehindNode（applyEffects 也会做同样归一化）。
 */
export function dropShadow(color: string, offset: { x: number; y: number }, radius: number): ShadowEffect {
  return {
    type: 'DROP_SHADOW',
    color: processColor(color),
    offset,
    spread: 0,
    radius,
    isVisible: true,
    blendMode: 'NORMAL',
    showShadowBehindNode: false,
    isEffectShow: true,
  }
}

export function makeNode(type: string, props: Record<string, any>, parentId?: string): any {
  let node: any
  if (type === 'instance') {
    const comp = mg.getNodeById(props.componentId) as ComponentNode | null
    if (!comp || typeof comp.createInstance !== 'function') throw new Error(`Component not found: ${props.componentId}`)
    node = comp.createInstance()
  } else {
    node = createNodeByType(type)
  }

  const { x, y, ...restProps } = props
  applyNodeProperties(node, restProps)

  if (parentId) {
    const parent = mg.getNodeById(parentId)
    if (parent && 'appendChild' in parent) (parent as any).appendChild(node)
  } else {
    mg.document.currentPage.appendChild(node)
  }

  if (x !== undefined && 'x' in node) node.x = x
  if (y !== undefined && 'y' in node) node.y = y

  return node
}

/**
 * 组件渲染结果的节点摘要。
 *
 * 这里曾只返回 `{id,name,type,parentId}`，导致 33 个 `component_render` 的结果无法回读
 * fills / strokes / effects / 尺寸 / 自动布局（AI 无法验证刚渲染的组件到底长什么样）。
 * 现统一委托给 serializer.serializeNode，并对已删除/异常节点做安全兜底。
 */
export function serializeNode(node: any): Record<string, any> {
  const serialized = serializeFullNode(node)
  if (serialized) return serialized as unknown as Record<string, any>
  try {
    return {
      id: node?.id ?? null,
      name: node?.name ?? null,
      type: node?.type ?? null,
      parentId: node?.parent?.id ?? null,
    }
  } catch {
    // 已删除节点上访问任何属性都可能抛 “node does not exist”
    return { removed: true }
  }
}

// ─── 尺寸层级 ──────────────────────────────────────────

export type SizeTier = 'sm' | 'md' | 'lg'

export function getSize(tier: SizeTier | undefined, sizes: Record<string, Record<string, any>>, overrides?: Record<string, any>): Record<string, any> {
  const base = sizes[tier || 'md']
  return { ...base, ...overrides }
}

// ─── 图标常量 ────────────────────────────────────────────

export const ICON_CHECK = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z"/></svg>'
export const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M11.9997 10.5865L16.9495 5.63672L18.3637 7.05093L13.4139 12.0007L18.3637 16.9504L16.9495 18.3646L11.9997 13.4149L7.04996 18.3646L5.63574 16.9504L10.5855 12.0007L5.63574 7.05093L7.04996 5.63672L11.9997 10.5865Z"/></svg>'
export const ICON_EXCLAMATION = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12.8659 3.00017L22.3922 19.5002C22.6684 19.9785 22.5045 20.5901 22.0262 20.8662C21.8742 20.954 21.7017 21.0002 21.5262 21.0002H2.47363C1.92135 21.0002 1.47363 20.5525 1.47363 20.0002C1.47363 19.8246 1.51984 19.6522 1.60761 19.5002L11.1339 3.00017C11.41 2.52187 12.0216 2.358 12.4999 2.63414C12.6519 2.72191 12.7782 2.84815 12.8659 3.00017ZM4.20568 19.0002H19.7941L11.9999 5.50017L4.20568 19.0002ZM10.9999 16.0002H12.9999V18.0002H10.9999V16.0002ZM10.9999 9.00017H12.9999V14.0002H10.9999V9.00017Z"/></svg>'
export const ICON_INFO = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM11 7H13V9H11V7ZM11 11H13V17H11V11Z"/></svg>'
export const ICON_CHEVRON_LEFT = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M10.8284 12.0007L15.7782 16.9504L14.364 18.3646L8 12.0007L14.364 5.63672L15.7782 7.05093L10.8284 12.0007Z"/></svg>'
export const ICON_CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M13.1717 12.0007L8.22192 7.05093L9.63614 5.63672L16.0001 12.0007L9.63614 18.3646L8.22192 16.9504L13.1717 12.0007Z"/></svg>'

export const SPINNER_TRACK = '<svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="3"/></svg>'
export const SPINNER_ARC = '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M18 10A8 8 0 1 1 10 2" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>'

// ─── SVG 工具 ─────────────────────────────────────────────

export function customizeSvg(svg: string, size: number, color: string): string {
  return svg
    .replace(/width="[^"]*"/, `width="${size}"`)
    .replace(/height="[^"]*"/, `height="${size}"`)
    .replace(/currentColor/g, color)
}

export async function renderSvgIcon(svg: string, size: number, color: string, parentId: string, x: number, y: number, name?: string): Promise<any> {
  const customizedSvg = customizeSvg(svg, size, color)
  let node: any
  try {
    node = await mg.createNodeFromSvgAsync(customizedSvg)
  } catch {
    node = makeNode('frame', { name: name || 'Icon', width: size, height: size, x, y, fills: [] }, parentId)
    return node
  }
  if (!node) return null
  node.name = name || 'Icon'
  const parent = mg.getNodeById(parentId)
  if (parent && 'appendChild' in parent) parent.appendChild(node)
  if (node.width > 0 && node.height > 0) {
    const sx = size / node.width
    const sy = size / node.height
    if (Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01) {
      try { node.relativeTransform = [[sx, 0, 0], [0, sy, 0]] } catch {}
    }
  }
  node.x = x
  node.y = y
  return node
}

// ─── Component State System ──────────────────────────────────

export type StateName = 'default' | 'hover' | 'active' | 'focused' | 'disabled' | 'loading' | 'error' | 'filled'

export interface StateGroupConfig {
  label: string
  overrides: Record<string, any>
}

export type StateMap = Record<StateName, StateGroupConfig>

/**
 * 状态子集：调用方可能只渲染部分状态（如 button 只传 default/hover/active/disabled），
 * renderStateGroup 仅遍历实际传入的状态。
 */
export type StateSubset = Partial<Record<string, StateGroupConfig>>

export function renderStateGroup(
  container: any,
  renderFn: (overrides: Record<string, any>, parentId: string, offsetX: number) => { width: number; height: number },
  states: StateSubset,
  startX: number,
  startY: number,
): void {
  let x = startX
  const gap = 16
  for (const [name, config] of Object.entries(states)) {
    if (!config) continue
    const result = renderFn(config.overrides, container.id, x)
    const label = makeNode('text', {
      name: `StateLabel-${name}`,
      characters: config.label,
      fontSize: 10,
      fontName: { family: 'Inter', style: 'Regular' },
      fills: [solidFill('#999999')],
      textAlignHorizontal: 'CENTER',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      x: x,
      y: result.height + 4,
    }, container.id)
    label.x = x + Math.round((result.width - label.width) / 2)
    x += result.width + gap
  }
}

export interface StateConfig {
  key: string
  label: string
  bg: string
  stroke: string
  checked: boolean
  disabled: boolean
  textColor: string
}

export function buildCheckboxRadioStates(t: any): StateConfig[] {
  return [
    { key: 'Unchecked', label: 'Unchecked', bg: t.bgWhite, stroke: t.border, checked: false, disabled: false, textColor: t.textPrimary },
    { key: 'Checked', label: 'Checked', bg: t.brand, stroke: t.brand, checked: true, disabled: false, textColor: t.textPrimary },
    { key: 'Hover', label: 'Hover', bg: t.brandLight, stroke: t.brand, checked: false, disabled: false, textColor: t.textPrimary },
    { key: 'DisabledUnchecked', label: 'Disabled Unchecked', bg: t.bgDisabled, stroke: t.borderDisabled, checked: false, disabled: true, textColor: t.textDisabled },
    { key: 'DisabledChecked', label: 'Disabled Checked', bg: t.bgDisabledChecked, stroke: t.borderDisabled, checked: true, disabled: true, textColor: t.textDisabled },
  ]
}
