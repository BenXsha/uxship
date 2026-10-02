/**
 * 组件渲染处理器 — 入口文件
 *
 * 聚合所有领域组件的 render 函数，暴露统一入口：handleComponentRender,
 * handleCreateStateMatrix, handleComponentList, handleComponentSearch
 */

import { applyNodeProperties } from '../utils/node-utils'
import { mergeTheme } from './design-theme'
import { solidFill, dropShadow, makeNode } from './component-utils'

import {
  renderButton, renderBadge, renderAvatar, renderToggle,
  renderProgress, renderDivider, renderTag, renderTooltip,
  renderSpinner, renderSkeleton,
} from './component-basic'
import {
  renderCheckboxGroup, renderRadioGroup, renderCheckbox, renderRadio,
  renderTextInput, renderSelect, renderSlider,
} from './component-form'
import {
  renderMenu, renderTabs, renderBreadcrumb, renderPagination, renderSteps,
} from './component-navigation'
import {
  renderList, renderAccordion, renderCard, renderTable, renderForm,
  renderToast, renderModal, renderAlert,
} from './component-data'
import {
  renderPageShell, renderFeatureGrid, renderPricingTable,
} from './component-layout'

const COMPONENT_RENDERERS: Record<string, (params: any) => any | Promise<any>> = {
  'checkbox-group': renderCheckboxGroup,
  'radio-group': renderRadioGroup,
  checkbox: renderCheckbox,
  radio: renderRadio,
  button: renderButton,
  'text-input': renderTextInput,
  badge: renderBadge,
  avatar: renderAvatar,
  toggle: renderToggle,
  select: renderSelect,
  menu: renderMenu,
  tabs: renderTabs,
  progress: renderProgress,
  list: renderList,
  slider: renderSlider,
  breadcrumb: renderBreadcrumb,
  tooltip: renderTooltip,
  divider: renderDivider,
  tag: renderTag,
  spinner: renderSpinner,
  modal: renderModal,
  alert: renderAlert,
  pagination: renderPagination,
  steps: renderSteps,
  accordion: renderAccordion,
  card: renderCard,
  table: renderTable,
  form: renderForm,
  toast: renderToast,
   skeleton: renderSkeleton,
  'page-shell': renderPageShell,
  'feature-grid': renderFeatureGrid,
  'pricing-table': renderPricingTable,
}

const SUPPORTED_COMPONENTS = Object.keys(COMPONENT_RENDERERS).join(', ')

// 尺寸层级预设（按 tier 索引，未匹配时回退到 md 值）
const BUTTON_HEIGHTS: Record<string, number> = { sm: 32, md: 40, lg: 48 }
const BADGE_HEIGHTS: Record<string, number> = { sm: 22, md: 26, lg: 32 }
const TOGGLE_WIDTHS: Record<string, number> = { sm: 32, md: 44, lg: 56 }
const LABEL_FONT_SIZES: Record<string, number> = { sm: 12, md: 14, lg: 16 }

/**
 * 折叠参数合并：把 `props` 自由对象并入平铺参数命名空间。
 *
 * 为什么需要它：MCP 的 `tools/list` 会整份注入 AI 上下文，而 `component_render` 的
 * 39 个扁平参数（33 种组件类型参数的并集）一个工具就占约 4.7k 字符。schema 现在只声明
 * `type` / `props` / `position` / `theme` 四个参数，类型专属参数折叠进 `props`，目录写进
 * 技能文档（`skills/design/rules/16-component-catalog.md`）按需读取。
 *
 * 但插件端的渲染器（component-basic / form / navigation / data / layout）始终按
 * `params.xxx` 读取参数，所以这里只要把 `props` 展开进同一个命名空间，**历史平铺写法与
 * 新的 props 写法就完全等效** —— schema 折叠不会破坏任何既有调用。
 *
 * 优先级：**平铺参数优先**（同时传 `label` 和 `props.label` 时前者胜出）。平铺写法是
 * 既有行为与既有文档的写法，新增 `props` 不能悄悄改变它的语义。
 *
 * 边界：
 * - `params` 不是对象（null / undefined / 字符串等）时返回 `{}` —— 让调用方随后抛出
 *   「Missing required parameter: type」这类明确错误，而不是在对象展开时崩成 TypeError；
 * - `props` 不是普通对象（数组 / 原始值 / 缺失）时忽略它；
 * - 不修改入参（返回新对象）。
 */
export function mergeComponentParams(params: any): Record<string, any> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return {}
  const props = params.props
  const spreadProps = props && typeof props === 'object' && !Array.isArray(props) ? props : {}
  return { ...spreadProps, ...params }
}

export async function handleComponentRender(params: any): Promise<any> {
  // schema 已折叠为 type/props/position/theme；这里先归一化，再交给渲染器
  const merged = mergeComponentParams(params)
  if (!merged.type) throw new Error('Missing required parameter: type')

  const renderer = COMPONENT_RENDERERS[merged.type]
  if (!renderer) throw new Error(`Unsupported component type: ${merged.type}. Supported: ${SUPPORTED_COMPONENTS}`)

  const result = renderer(merged)

  // If parentId specified, move root node to parent for auto-layout integration
  if (merged.parentId) {
    const parent = mg.getNodeById(merged.parentId)
    if (parent && 'appendChild' in parent) {
      const rootKey = ['container', 'frame', 'divider', 'card', 'track'].find(k => result[k]?.id)
      if (rootKey) {
        const node = mg.getNodeById(result[rootKey].id)
        if (node) {
          parent.appendChild(node)
          // Reset position so auto-layout handles it
          if ('x' in node) node.x = 0
          if ('y' in node) node.y = 0
        }
      }
    }
  }

  return result
}

// ─── State Matrix ─────────────────────────────────────────

/**
 * 组件交互状态矩阵生成
 * 方案 A（视觉矩阵）：渲染所有状态并排展示
 * 方案 B（命名约定）：为每个状态创建 COMPONENT master，命名 DS_{Type}_{variant}_state={state}
 */
export function handleCreateStateMatrix(params: any): any {
  const type = params.type || 'button'
  const config = params.config || {}
  const states = params.states || ['default', 'hover', 'active', 'disabled', 'focused']
  const t = mergeTheme(config.theme)
  const variant = config.variant || 'primary'
  const startX = params.position?.x ?? 100
  const startY = params.position?.y ?? 100

  // State color overrides by component type
  const getStateStyle = (state: string): Record<string, any> => {
    const s = state.toLowerCase()
    const base: Record<string, Record<string, any>> = {
      default:  { bg: '#FFFFFF', textColor: '#333333', stroke: '#D0D5DD' },
      hover:    { bg: '#F4F3FF', textColor: '#333333', stroke: '#4340EA' },
      active:   { bg: '#EEEDFE', textColor: '#333333', stroke: '#4340EA' },
      disabled: { bg: '#F5F5F5', textColor: '#999999', stroke: '#E0E0E0' },
      focused:  { bg: '#FFFFFF', textColor: '#333333', stroke: '#4340EA', strokeWeight: 2 },
    }
    const typeOverrides: Record<string, Record<string, Record<string, any>>> = {
      button: {
        default:  { bg: t.brand, textColor: '#FFFFFF', stroke: '' },
        hover:    { bg: t.brandHover, textColor: '#FFFFFF', stroke: '' },
        active:   { bg: '#2A2899', textColor: '#FFFFFF', stroke: '' },
        disabled: { bg: t.bgDisabled, textColor: t.textDisabled, stroke: t.borderDisabled },
        focused:  { bg: t.brand, textColor: '#FFFFFF', stroke: '#FFD700', strokeWeight: 2 },
      },
      'text-input': {
        default:  { bg: '#FFFFFF', stroke: '#D0D5DD' },
        hover:    { bg: '#FFFFFF', stroke: '#4340EA' },
        focused:  { bg: '#FFFFFF', stroke: '#4340EA', strokeWeight: 2 },
        disabled: { bg: '#F5F5F5', stroke: '#E0E0E0', textColor: '#999999' },
        error:    { bg: '#FFF5F5', stroke: '#EF4444', textColor: '#EF4444' },
      },
      badge: {
        default:  { bg: t.brand, textColor: '#FFFFFF' },
        hover:    { bg: t.brandHover, textColor: '#FFFFFF' },
        disabled: { bg: t.bgDisabled, textColor: t.textDisabled },
      },
      toggle: {
        default:  { bg: '#E0E0E0', textColor: '#FFFFFF' },
        checked:  { bg: t.brand, textColor: '#FFFFFF' },
        hover:    { bg: '#D0D5DD', textColor: '#FFFFFF' },
        disabled: { bg: t.bgDisabled, textColor: t.textDisabled },
      },
      checkbox: {
        unchecked:    { bg: '#FFFFFF', stroke: '#D0D5DD' },
        checked:      { bg: t.brand, stroke: t.brand, textColor: '#FFFFFF' },
        'hover-unchecked': { bg: '#F4F3FF', stroke: t.brand },
        'hover-checked':   { bg: t.brandHover, stroke: t.brandHover, textColor: '#FFFFFF' },
        'disabled-unchecked': { bg: t.bgDisabled, stroke: t.borderDisabled },
        'disabled-checked':   { bg: t.bgDisabledChecked, stroke: t.borderDisabled, textColor: t.textDisabled },
      },
      radio: {
        unchecked:    { bg: '#FFFFFF', stroke: '#D0D5DD' },
        checked:      { bg: t.brand, stroke: t.brand, textColor: '#FFFFFF' },
        'hover-unchecked': { bg: '#F4F3FF', stroke: t.brand },
        'hover-checked':   { bg: t.brandHover, stroke: t.brandHover, textColor: '#FFFFFF' },
        'disabled-unchecked': { bg: t.bgDisabled, stroke: t.borderDisabled },
        'disabled-checked':   { bg: t.bgDisabledChecked, stroke: t.borderDisabled, textColor: t.textDisabled },
      },
      select: {
        default:  { bg: '#FFFFFF', stroke: '#D0D5DD', textColor: '#333333' },
        hover:    { bg: '#FFFFFF', stroke: t.brand, textColor: '#333333' },
        focused:  { bg: '#FFFFFF', stroke: t.brand, textColor: '#333333', strokeWeight: 2 },
        disabled: { bg: t.bgDisabled, stroke: t.borderDisabled, textColor: t.textDisabled },
        error:    { bg: '#FFF5F5', stroke: '#EF4444', textColor: '#EF4444' },
        open:     { bg: '#FFFFFF', stroke: t.brand, textColor: '#333333' },
      },
      tabs: {
        active:   { bg: t.brand, textColor: '#FFFFFF' },
        inactive: { bg: t.tabInactiveBg, textColor: t.tabInactiveText },
        hover:    { bg: t.brandLight, textColor: t.brand },
        disabled: { bg: t.bgDisabled, textColor: t.textDisabled },
      },
      tag: {
        default:  { bg: t.tagDefaultBg, textColor: t.tagDefaultText },
        hover:    { bg: t.bgDisabled, textColor: '#333333' },
        active:   { bg: t.brandLight, textColor: t.brand },
        disabled: { bg: t.bgDisabled, textColor: t.textDisabled },
        closable: { bg: t.tagDefaultBg, textColor: t.tagDefaultText, stroke: '#D0D5DD' },
      },
      card: {
        default:  { bg: '#FFFFFF', stroke: '#E5E7EB' },
        hover:    { bg: '#FFFFFF', stroke: t.brand },
        selected: { bg: t.brandLight, stroke: t.brand, strokeWeight: 2 },
        disabled: { bg: t.bgDisabled, stroke: t.borderDisabled, textColor: t.textDisabled },
      },
      'menu-item': {
        default:  { bg: '#FFFFFF', textColor: '#333333' },
        hover:    { bg: t.brandLight, textColor: t.brand },
        active:   { bg: t.brandLight, textColor: t.brand },
        disabled: { bg: '#FFFFFF', textColor: t.textDisabled },
      },
      slider: {
        default:  { bg: t.sliderTrackColor, textColor: t.brand },
        hover:    { bg: t.sliderTrackColor, textColor: t.brandHover },
        active:   { bg: t.brandLight, textColor: t.brand },
        disabled: { bg: t.bgDisabled, textColor: t.textDisabled },
      },
      accordion: {
        collapsed: { bg: '#FFFFFF', stroke: t.accordionBorderColor },
        expanded:  { bg: '#FFFFFF', stroke: t.brand },
        hover:     { bg: t.brandLight, stroke: t.accordionBorderColor },
      },
      'list-item': {
        default:  { bg: '#FFFFFF', textColor: '#333333' },
        hover:    { bg: '#F5F5F5', textColor: '#333333' },
        selected: { bg: t.brandLight, textColor: t.brand },
        active:   { bg: t.brandLight, textColor: t.brand },
      },
    }
    const styles = typeOverrides[type]
    return { ...base[s], ...(styles?.[s] || {}) }
  }

  const gap = 20
  const stateLabels: Record<string, string> = {
    default: 'Default', hover: 'Hover', active: 'Active',
    disabled: 'Disabled', focused: 'Focused',
    checked: 'Checked', unchecked: 'Unchecked', error: 'Error', open: 'Open',
    'hover-unchecked': 'Hover Unchecked', 'hover-checked': 'Hover Checked',
    'disabled-unchecked': 'Disabled Unchecked', 'disabled-checked': 'Disabled Checked',
    inactive: 'Inactive', closable: 'Closable',
    collapsed: 'Collapsed', expanded: 'Expanded', selected: 'Selected',
  }

  // Determine dimensions per component type
  let itemW = 120, itemH = 40, labelText = ''
  switch (type) {
    case 'button':
      labelText = config.label || 'Button'
      itemW = Math.max(labelText.length * 7 + 48, 90)
      itemH = BUTTON_HEIGHTS[config.size?.tier || 'md'] || 40
      break
    case 'badge':
      labelText = config.label || 'Badge'
      itemW = Math.max(labelText.length * 7 + 32, 70)
      itemH = BADGE_HEIGHTS[config.size?.tier || 'md'] || 26
      break
    case 'text-input':
      labelText = config.placeholder || 'Placeholder'
      itemW = config.size?.width || 240
      itemH = config.size?.height || 40
      break
    case 'toggle':
      itemW = TOGGLE_WIDTHS[config.size?.tier || 'md'] || 44
      itemH = Math.round(itemW * 0.5)
      break
    case 'checkbox':
    case 'radio':
      itemW = 20
      itemH = 20
      labelText = ''
      break
    case 'select':
      labelText = config.placeholder || 'Select...'
      itemW = config.size?.width || 200
      itemH = config.size?.height || 40
      break
    case 'tabs':
      labelText = config.label || 'Tab'
      itemW = Math.max(labelText.length * 7 + 32, 70)
      itemH = config.size?.height || 36
      break
    case 'tag':
      labelText = config.label || 'Tag'
      itemW = Math.max(labelText.length * 7 + 40, 60)
      itemH = config.size?.height || 26
      break
    case 'card':
      labelText = config.title || 'Card Title'
      itemW = config.size?.width || 200
      itemH = config.size?.height || 120
      break
    case 'menu-item':
      labelText = config.label || 'Menu Item'
      itemW = config.size?.width || 160
      itemH = config.size?.height || 36
      break
    case 'slider':
      itemW = config.size?.width || 200
      itemH = 20
      labelText = ''
      break
    case 'accordion':
      labelText = config.label || 'Accordion'
      itemW = config.size?.width || 300
      itemH = config.size?.height || 48
      break
    case 'list-item':
      labelText = config.label || 'List Item'
      itemW = config.size?.width || 260
      itemH = config.size?.height || 48
      break
    default:
      labelText = config.label || type
      itemW = config.size?.width || 140
      itemH = config.size?.height || 36
  }

  // Main group container (visual frame, not a real COMPONENT_SET — MasterGo API lacks createComponentSet)
  const propName = params.variantPropertyName || 'State'
  const page = mg.document.currentPage

  const components: Array<{ id: string; name: string; state: string }> = []

  for (let i = 0; i < states.length; i++) {
    const state = states[i]
    const style = getStateStyle(state)
    const label = stateLabels[state] || stateLabels[state.toLowerCase()] || state
    const x = i * (itemW + gap)
    // Use MasterGo variant naming convention for manual "Combine as Variants" support
    const typeName = type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, '')
    const compName = params.naming === 'variant'
      ? `${propName}=${state}`
      : `DS_${typeName}_${variant.charAt(0).toUpperCase() + variant.slice(1)}_state=${state}`

    // Create COMPONENT master
    const comp = mg.createComponent()
    comp.name = compName

    if (type === 'checkbox' || type === 'radio') {
      const isChecked = state === 'checked' || state === 'hover-checked' || state === 'disabled-checked'
      try { comp.width = itemW; comp.height = itemH; comp.fills = [solidFill(style.bg)]; if (style.stroke) { comp.strokes = [solidFill(style.stroke, style.strokeWeight || 1)]; if (style.strokeWeight) comp.strokeWeight = style.strokeWeight } } catch {}
      if (type === 'radio') try { comp.cornerRadius = itemH / 2 } catch {}
      else try { comp.cornerRadius = 4 } catch {}
      if (isChecked) {
        const m = mg.createText()
        if (m) {
          applyNodeProperties(m, {
            name: 'Mark', characters: type === 'radio' ? '●' : '✓',
            fontSize: 14, fontName: { family: 'Inter', style: 'Bold' },
            fills: [solidFill(style.textColor || '#FFFFFF')],
            textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT',
          })
          if (typeof comp.appendChild === 'function' && m.characters) {
            try { m.x = Math.round((itemW - m.width) / 2) } catch {}
            comp.appendChild(m)
          }
        }
      }
    } else if (type === 'toggle') {
      const trackH = Math.round(itemW * 0.5)
      const handleSize = trackH - 4
      const handleX = (state === 'checked') ? itemW - handleSize - 2 : 2
      const trackColor = (state === 'checked') ? style.bg : '#E0E0E0'
      try { comp.width = itemW } catch {}
      try { comp.height = trackH } catch {}
      try { comp.fills = [solidFill(trackColor)] } catch {}
      try { comp.cornerRadius = trackH / 2 } catch {}
      const handle = mg.createEllipse()
      handle.name = 'Handle'; handle.width = handleSize; handle.height = handleSize; handle.x = handleX; handle.y = 2
      handle.fills = [solidFill('#FFFFFF')]; handle.effects = [dropShadow('rgba(0,0,0,0.15)', { x: 0, y: 1 }, 2)]
      if (typeof comp.appendChild === 'function') comp.appendChild(handle)
    } else {
      let cornerRadius = 6
      if (type === 'badge') cornerRadius = itemH / 2
      else if (type === 'button') cornerRadius = Math.min(6, itemH / 2)
      else if (type === 'select') cornerRadius = 6
      else if (type === 'tag') cornerRadius = Math.min(itemH / 2, 4)
      else if (type === 'card') cornerRadius = 8
      else if (type === 'menu-item') cornerRadius = 6
      else if (type === 'slider') cornerRadius = itemH / 2
      else if (type === 'accordion') cornerRadius = 8
      else if (type === 'list-item') cornerRadius = 6
      const textColor = (state === 'disabled' && style.textColor) ? style.textColor :
        (type === 'button' || type === 'tabs' ? '#FFFFFF' : style.textColor || '#333333')

      // Set all properties BEFORE adding children (COMPONENT becomes immutable after)
      try { comp.width = itemW; comp.height = itemH; comp.cornerRadius = cornerRadius; comp.clipsContent = true; comp.flexMode = 'HORIZONTAL'; comp.mainAxisAlignItems = 'CENTER'; comp.crossAxisAlignItems = 'CENTER'; comp.paddingLeft = 12; comp.paddingRight = 12; comp.mainAxisSizingMode = 'FIXED'; comp.crossAxisSizingMode = 'FIXED'; comp.fills = [solidFill(style.bg)]; if (style.stroke) { comp.strokes = [solidFill(style.stroke, style.strokeWeight || 1)]; if (style.strokeWeight) comp.strokeWeight = style.strokeWeight } } catch {}

      // Create text label (skip for visual-only types like slider)
      if (type !== 'slider' && type !== 'checkbox' && type !== 'radio') {
        const text = mg.createText()
        if (text) {
          applyNodeProperties(text, {
            name: 'Label', characters: labelText || compName,
            fills: [solidFill(textColor)],
            fontSize: LABEL_FONT_SIZES[config.size?.tier || 'md'] || 14,
            fontName: { family: 'Inter', style: state === 'disabled' ? 'Regular' : 'Medium' },
            textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT',
          })
          if (typeof comp.appendChild === 'function' && text.characters) comp.appendChild(text)
        }
      }
      // Slider handle
      if (type === 'slider') {
        const handleSize = itemH + 4
        const handle = mg.createEllipse()
        handle.name = 'Handle'; handle.width = handleSize; handle.height = handleSize
        handle.x = itemW - handleSize - 2; handle.y = -2
        handle.fills = [solidFill('#FFFFFF')]
        handle.effects = [dropShadow('rgba(0,0,0,0.15)', { x: 0, y: 1 }, 2)]
        if (typeof comp.appendChild === 'function') comp.appendChild(handle)
      }
    }

    // Set position and add to page
    comp.x = startX + x
    comp.y = startY
    if (!comp.parent) page.appendChild(comp)

    // State label below
    makeNode('text', {
      name: `StateLabel-${state}`,
      characters: label,
      fontSize: 10,
      fontName: { family: 'Inter', style: 'Regular' },
      fills: [solidFill('#999999')],
      textAlignHorizontal: 'CENTER',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      x: startX + x + Math.round((itemW - label.length * 6) / 2),
      y: startY + itemH + 4,
    })

    components.push({ id: comp.id, name: compName, state })
  }

  // Auto-combine into ComponentSet if variant naming mode
  let componentSet: any = null
  if (params.naming === 'variant') {
    const compNodes = components
      .map(c => mg.getNodeById(c.id))
      .filter(Boolean) as any[]
    if (compNodes.length >= 2 && typeof mg.combineAsVariants === 'function') {
      try {
        componentSet = mg.combineAsVariants(compNodes)
        const typeName = type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, '')
        componentSet.name = `DS_${typeName}_${variant.charAt(0).toUpperCase() + variant.slice(1)}`
      } catch (e) {
        mg.notify(`合成多态组失败: ${e}，可手动选中后右键 Combine as Variants`, { type: 'warning' })
      }
    }
  }

  mg.commitUndo()
  if (componentSet) {
    mg.notify(`已创建 ${components.length} 个状态组件并合成为多态组`, { type: 'normal' })
  } else {
    const hint = params.naming === 'variant'
      ? '选中所有组件后右键 "Combine as Variants" 合成多态组'
      : `组件命名: DS_${type}_${variant}_state={state}`
    mg.notify(`已创建 ${components.length} 个状态组件。${hint}`, { type: 'normal' })
  }

  const typeName = type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, '')
  const variantName = variant.charAt(0).toUpperCase() + variant.slice(1)
  return {
    success: true,
    type,
    variant,
    count: components.length,
    components,
    componentSet: componentSet ? { id: componentSet.id, name: componentSet.name } : null,
    componentSetName: `DS_${typeName}_${variantName}`,
    namingPattern: params.naming === 'variant'
      ? `${propName}={state}`
      : `DS_${typeName}_${variantName}_state={state}`,
  }
}

// ─── Component Discovery ──────────────────────────────────

/**
 * 列出当前文档中的所有 Component Master
 */
export function handleComponentList(): Array<{
  id: string
  name: string
  description: string
  alias: string
}> {
  const results: Array<{
    id: string
    name: string
    description: string
    alias: string
  }> = []

  const pages = mg.document.children
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    const components = page.findAll((node: any) => node.type === 'COMPONENT') as unknown as ComponentNode[]
    for (let j = 0; j < components.length; j++) {
      const comp = components[j]
      results.push({
        id: comp.id,
        name: comp.name || '',
        description: comp.description || '',
        alias: comp.alias || '',
      })
    }
  }

  return results
}

export function handleComponentSearch(params: { query: string; limit?: number }): Array<{
  id: string
  name: string
  description: string
  alias: string
  matchType: string
}> {
  const query = (params.query || '').toLowerCase()
  const limit = params.limit || 20
  const results: Array<{
    id: string
    name: string
    description: string
    alias: string
    matchType: string
  }> = []

  if (!query) return results

  const pages = mg.document.children
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    const components = page.findAll((node: any) => node.type === 'COMPONENT') as unknown as ComponentNode[]
    for (let j = 0; j < components.length; j++) {
      if (results.length >= limit) break
      const comp = components[j]
      const name = (comp.name || '').toLowerCase()
      const desc = (comp.description || '').toLowerCase()
      const alias = (comp.alias || '').toLowerCase()
      let matchType = ''
      if (name === query) matchType = 'exact'
      else if (name.startsWith(query)) matchType = 'prefix'
      else if (name.includes(query)) matchType = 'fuzzy'
      else if (desc.includes(query) || alias.includes(query)) matchType = 'description'
      if (matchType) {
        results.push({
          id: comp.id,
          name: comp.name || '',
          description: comp.description || '',
          alias: comp.alias || '',
          matchType,
        })
      }
    }
    if (results.length >= limit) break
  }

  return results
}
