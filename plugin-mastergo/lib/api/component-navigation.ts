/**
 * 组件渲染处理器
 *
 * 高阶组件 API：将原子组件（checkbox/radio/button/input）的创建封装为一次调用。
 * 遵循 B1 方案（Token 参数注入），提供最佳实践默认值，支持 theme 覆盖。
 */

import { mergeTheme } from './design-theme'
import { solidFill, dropShadow, makeNode, serializeNode, ICON_CHECK, ICON_CHEVRON_LEFT, ICON_CHEVRON_RIGHT, renderSvgIcon } from './component-utils'

// ─── 导航组件 — 菜单、标签页、面包屑、分页、步骤 ───

export function renderMenu(params: any): any {
  const t = mergeTheme(params.theme)
  const items = params.items || [
    { label: '编辑', icon: '' },
    { label: '复制', icon: '' },
    { type: 'divider' },
    { label: '删除', icon: '', danger: true },
  ]
  const itemHeight = params.size?.height ?? t.menuItemHeight
  const paddingX = params.size?.paddingX ?? t.menuItemPaddingX
  let menuHeight = items.reduce((h: number, it: any) => h + (it.type === 'divider' ? 9 : itemHeight), 0) + 8

  const frame = makeNode('frame', {
    name: params.name || 'Menu',
    width: params.size?.width ?? 180,
    height: menuHeight,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius: params.size?.cornerRadius ?? t.menuCornerRadius,
    fills: [solidFill(t.bgWhite)],
    ...(t.menuShadow ? { effects: [dropShadow('#00000026', { x: 0, y: 4 }, 12)] } : {}),
    clipsContent: true,
  })

  let y = 4
  const itemIds: any[] = []
  items.forEach((item: any, i: number) => {
    if (item.type === 'divider') {
      const line = makeNode('rectangle', {
        name: `Divider-${i}`,
        width: frame.width - t.menuDividerMargin * 2,
        height: 1,
        x: t.menuDividerMargin,
        y: y + 4,
        fills: [solidFill(t.menuDividerColor)],
      }, frame.id)
      y += 9
      itemIds.push({ type: 'divider', id: line.id })
      return
    }

    const isDanger = item.danger
    const textColor = isDanger ? '#E53935' : t.textPrimary

    const bg = makeNode('frame', {
      name: `Item-${i}`,
      width: frame.width - 4,
      height: itemHeight,
      x: 2,
      y,
      cornerRadius: 4,
      fills: [],
      clipsContent: false,
    }, frame.id)

    if (item.icon) {
      makeNode('text', {
        name: `Icon-${i}`,
        characters: item.icon,
        fontSize: 16,
        fontName: t.labelFont,
        fills: [solidFill(textColor)],
        x: paddingX,
        y: Math.round((itemHeight - 20) / 2),
      }, bg.id)
    }

    const labelX = item.icon ? paddingX + 28 : paddingX
    const label = makeNode('text', {
      name: `Label-${i}`,
      characters: item.label,
      fontSize: 14,
      fontName: t.labelFont,
      fills: [solidFill(textColor)],
      textAlignHorizontal: 'LEFT',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      x: labelX,
      y: 0,
    }, bg.id)
    label.y = Math.round((itemHeight - label.height) / 2)

    y += itemHeight
    itemIds.push({ type: 'item', id: bg.id, label: label.id, labelText: item.label, danger: !!isDanger })
  })

  mg.commitUndo()
  return { success: true, container: serializeNode(frame), items: itemIds }
}

export function renderTabs(params: any): any {
  const t = mergeTheme(params.theme)
  const items = params.items || ['Tab 1', 'Tab 2', 'Tab 3']
  const activeIndex = params.activeIndex ?? 0
  const tabHeight = params.size?.height ?? t.tabHeight
  const fontSize = params.size?.fontSize ?? 14
  const width = params.size?.width ?? 400

  const frame = makeNode('frame', {
    name: params.name || 'Tabs',
    width,
    height: tabHeight + (params.showIndicator !== false ? t.tabIndicatorHeight : 0),
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    fills: [],
    clipsContent: true,
  })

  const tabW = Math.round(width / items.length)
  const tabs: any[] = []

  items.forEach((label: string, i: number) => {
    const isActive = i === activeIndex
    const bg = isActive ? t.tabActiveBg : (t.bgWhite || '#FFFFFF')
    const textCol = isActive ? t.tabActiveText : t.tabInactiveText

    if (params.variant === 'underline') {
      const tabText = makeNode('text', {
        name: `Tab-${i}`,
        characters: label,
        fontSize,
        fontName: { family: 'Inter', style: isActive ? 'Bold' : 'Regular' },
        fills: [solidFill(textCol)],
        textAlignHorizontal: 'CENTER',
        textAutoResize: 'WIDTH_AND_HEIGHT',
        x: tabW * i,
        y: Math.round((tabHeight - fontSize * 1.2) / 2),
      }, frame.id)
      tabText.x = tabW * i + Math.round((tabW - tabText.width) / 2)

      if (isActive && params.showIndicator !== false) {
        const indicator = makeNode('rectangle', {
          name: 'Indicator',
          width: tabW - 32,
          height: t.tabIndicatorHeight,
          x: tabW * i + 16,
          y: tabHeight - 2,
          cornerRadius: 1.5,
          fills: [solidFill(t.brand)],
        }, frame.id)
        tabs.push({ id: tabText.id, label, active: isActive, indicator: indicator.id })
      } else {
        tabs.push({ id: tabText.id, label, active: isActive, indicator: null })
      }
    } else {
      const tab = makeNode('frame', {
        name: `Tab-${i}`,
        width: tabW - 3,
        height: tabHeight - 4,
        x: tabW * i + 1,
        y: 2,
        cornerRadius: 6,
        fills: [solidFill(bg)],
        clipsContent: true,
      }, frame.id)

      const tabText = makeNode('text', {
        name: `Label-${i}`,
        characters: label,
        fontSize,
        fontName: { family: 'Inter', style: isActive ? 'Bold' : 'Regular' },
        fills: [solidFill(textCol)],
        textAlignHorizontal: 'CENTER',
        textAutoResize: 'WIDTH_AND_HEIGHT',
        x: 0, y: 0,
      }, tab.id)
      tabText.x = Math.round((tabW - 3 - tabText.width) / 2)
      tabText.y = Math.round((tabHeight - 4 - tabText.height) / 2)

      tabs.push({ id: tab.id, label: tabText.id, labelText: label, active: isActive })
    }
  })

  mg.commitUndo()
  return { success: true, container: serializeNode(frame), tabs }
}

export function renderBreadcrumb(params: any): any {
  const t = mergeTheme(params.theme)
  const items = params.items || ['首页', '分类', '详情']
  const separator = params.separator ?? t.breadcrumbSeparator
  const fontSize = params.size?.fontSize ?? t.breadcrumbFontSize

  let totalW = 0
  const segments: any[] = []
  items.forEach((label: string, i: number) => {
    const isLast = i === items.length - 1
    segments.push({ label, isLast, w: label.length * fontSize * 0.6 + 4 })
    totalW += label.length * fontSize * 0.6 + 4
    if (!isLast) totalW += fontSize * 0.8 + 4
  })

  const frame = makeNode('frame', {
    name: params.name || 'Breadcrumb',
    width: totalW,
    height: fontSize * 1.6,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    fills: [],
    clipsContent: true,
  })

  let x = 0
  const crumbs: any[] = []
  items.forEach((label: string, i: number) => {
    const isLast = i === items.length - 1
    const textColor = isLast ? t.textPrimary : t.breadcrumbSeparatorColor

    const text = makeNode('text', {
      name: `Crumb-${i}`,
      characters: label,
      fontSize,
      fontName: { family: 'Inter', style: isLast ? 'Bold' : 'Regular' },
      fills: [solidFill(textColor)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
      x,
      y: 0,
    }, frame.id)
    text.y = Math.round((frame.height - text.height) / 2)
    x += text.width + 4
    crumbs.push({ id: text.id, label, isLast })

    if (!isLast) {
      const sep = makeNode('text', {
        // R3 重复集合的角色只有 `Divider`（`Sep` 属自创同义词）
        name: `Divider-${i}`,
        characters: separator,
        fontSize,
        fontName: { family: 'Inter', style: 'Regular' },
        fills: [solidFill(t.breadcrumbSeparatorColor)],
        textAutoResize: 'WIDTH_AND_HEIGHT',
        x,
        y: 0,
      }, frame.id)
      sep.y = Math.round((frame.height - sep.height) / 2)
      x += sep.width + 4
      crumbs.push({ separator: sep.id, character: separator })
    }
  })

  mg.commitUndo()
  return { success: true, container: serializeNode(frame), crumbs }
}

export async function renderPagination(params: any): Promise<any> {
  const t = mergeTheme(params.theme)
  const current = params.current ?? 1
  const total = params.total ?? 50
  const pageSize = params.pageSize ?? 10
  const totalPages = Math.ceil(total / pageSize)
  const btnSize = params.size?.width ?? t.paginationBtnSize
  const gap = params.gap ?? t.paginationBtnGap

  const colors = {
    activeBg: params.activeBg || t.paginationActiveBg,
    activeText: t.paginationActiveText,
    btnBg: t.paginationBtnBg,
    btnText: t.paginationBtnText,
  }

  // Calculate which pages to show
  const pages: (number | string)[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (current > 3) pages.push('...')
    const start = Math.max(2, current - 1)
    const end = Math.min(totalPages - 1, current + 1)
    for (let i = start; i <= end; i++) pages.push(i)
    if (current < totalPages - 2) pages.push('...')
    pages.push(totalPages)
  }

  const navCount = 2
  const totalW = btnSize * (pages.length + navCount) + gap * (pages.length + navCount - 1)

  const frame = makeNode('frame', {
    name: params.name || 'Pagination',
    width: totalW,
    height: btnSize,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    fills: [],
  })

  let x = 0
  let btnIndex = 0

  async function renderBtn(label: string, isActive: boolean, iconSvg?: string): Promise<void> {
    const btn = makeNode('frame', {
      // R3 重复集合角色：分页项统一用 `Item-<i>`（i 按渲染顺序从 0 起，
      // 旧的 `Btn-<label>` 会把页码/箭头混进同名集合，跨宿主找不到）
      name: `Item-${btnIndex++}`,
      width: btnSize,
      height: btnSize,
      x,
      y: 0,
      cornerRadius: t.paginationBtnCornerRadius,
      fills: isActive ? [solidFill(colors.activeBg)] : [],
    }, frame.id)

    if (iconSvg) {
      const iconS = Math.round(btnSize * 0.55)
      await renderSvgIcon(iconSvg, iconS, isActive ? colors.activeText : colors.btnText, btn.id, Math.round((btnSize - iconS) / 2), Math.round((btnSize - iconS) / 2))
    } else {
      const text = makeNode('text', {
        name: 'Label',
        characters: label,
        fontSize: 13,
        fontName: { family: 'Inter', style: 'Regular' },
        fills: [solidFill(isActive ? colors.activeText : colors.btnText)],
        textAlignHorizontal: 'CENTER',
        textAutoResize: 'WIDTH_AND_HEIGHT',
        x: 0, y: 0,
      }, btn.id)
      text.x = Math.round((btnSize - text.width) / 2)
      text.y = Math.round((btnSize - text.height) / 2)
    }

    x += btnSize + gap
  }

  // Previous
  await renderBtn('‹', false, ICON_CHEVRON_LEFT)

  // Page numbers
  for (const p of pages) {
    if (p === '...') {
      const dotText = makeNode('text', {
        name: 'Ellipsis',
        characters: '...',
        fontSize: 14,
        fontName: { family: 'Inter', style: 'Regular' },
        fills: [solidFill(t.textPrimary)],
        textAutoResize: 'WIDTH_AND_HEIGHT',
        x: x + Math.round((btnSize - 14) / 2),
        y: 0,
      }, frame.id)
      dotText.y = Math.round((btnSize - dotText.height) / 2)
      x += btnSize + gap
    } else {
      await renderBtn(String(p), p === current)
    }
  }

  // Next
  await renderBtn('›', false, ICON_CHEVRON_RIGHT)

  mg.commitUndo()
  return { success: true, container: serializeNode(frame), totalPages }
}

export async function renderSteps(params: any): Promise<any> {
  const t = mergeTheme(params.theme)
  const items = params.items || ['步骤一', '步骤二', '步骤三']
  const current = params.current ?? 1
  const direction = params.direction || 'horizontal'
  const stepSize = params.size?.width ?? t.stepSize
  const fontSize = params.size?.fontSize ?? t.stepFontSize

  const isHorizontal = direction === 'horizontal'
  const connectorLen = 48
  const labelGap = 6

  const totalW = isHorizontal
    ? items.length * (stepSize + connectorLen) - connectorLen
    : stepSize + connectorLen + 120

  const itemH = isHorizontal ? stepSize + labelGap + fontSize * 1.6 : items.length * (stepSize + 60) - 60
  const totalH = isHorizontal ? itemH + 10 : itemH

  const frame = makeNode('frame', {
    name: params.name || 'Steps',
    width: isHorizontal ? totalW : totalW + 60,
    height: totalH,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    fills: [],
  })

  for (let i = 0; i < items.length; i++) {
    const label = items[i]
    const stepNum = i + 1
    const isCompleted = stepNum < current
    const isActive = stepNum === current
    const isInactive = stepNum > current

    const borderColor = isActive ? t.stepActiveColor : isCompleted ? t.stepCompletedColor : t.stepInactiveColor
    const bgColor = isActive ? t.stepActiveColor : isCompleted ? t.stepCompletedColor : t.bgWhite
    const textColor = isActive ? '#FFFFFF' : isCompleted ? '#FFFFFF' : t.stepInactiveText
    const labelColor = isActive ? t.textPrimary : isInactive ? t.stepInactiveText : t.textPrimary

    const sx = isHorizontal ? i * (stepSize + connectorLen) : 0
    const sy = isHorizontal ? 0 : i * (stepSize + 60)

    // Step circle
    const circle = makeNode('frame', {
      name: `Step-${stepNum}`,
      width: stepSize,
      height: stepSize,
      x: sx,
      y: sy,
      cornerRadius: stepSize / 2,
      fills: [solidFill(bgColor)],
      strokes: [solidFill(borderColor, isActive ? 0 : 1)],
      strokeWeight: isActive ? 0 : 2,
      clipsContent: true,
    }, frame.id)

    // Number or checkmark
    if (isCompleted) {
      const checkSize = Math.round(stepSize * 0.55)
      await renderSvgIcon(ICON_CHECK, checkSize, textColor, circle.id, Math.round((stepSize - checkSize) / 2), Math.round((stepSize - checkSize) / 2))
    } else {
      const labelText = makeNode('text', {
        name: 'StepLabel',
        characters: String(stepNum),
        fontSize: stepSize * 0.45,
        fontName: { family: 'Inter', style: isActive ? 'Bold' : 'Medium' },
        fills: [solidFill(textColor)],
        textAlignHorizontal: 'CENTER',
        textAutoResize: 'WIDTH_AND_HEIGHT',
        x: 0, y: 0,
      }, circle.id)
      labelText.x = Math.round((stepSize - labelText.width) / 2)
      labelText.y = Math.round((stepSize - labelText.height) / 2)
    }

    // Connector line
    if (i < items.length - 1) {
      const lineColor = isCompleted ? t.stepCompletedColor : t.stepConnectorColor
      if (isHorizontal) {
        makeNode('rectangle', {
          name: `Connector-${i}`,
          width: connectorLen,
          height: 2,
          x: sx + stepSize,
          y: sy + Math.round(stepSize / 2) - 1,
          fills: [solidFill(lineColor)],
          strokeCap: 'ROUND',
        }, frame.id)
      } else {
        makeNode('rectangle', {
          name: `Connector-${i}`,
          width: 2,
          height: 60 - stepSize,
          x: sx + Math.round(stepSize / 2) - 1,
          y: sy + stepSize,
          fills: [solidFill(lineColor)],
          strokeCap: 'ROUND',
        }, frame.id)
      }
    }

    // Label below / to the right
    const lText = makeNode('text', {
      name: `Label-${stepNum}`,
      characters: label,
      fontSize,
      fontName: { family: 'Inter', style: isActive ? 'Bold' : 'Regular' },
      fills: [solidFill(labelColor)],
      textAlignHorizontal: 'CENTER',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      x: 0, y: 0,
    }, frame.id)

    if (isHorizontal) {
      lText.x = sx + Math.round((stepSize - lText.width) / 2)
      lText.y = sy + stepSize + labelGap
    } else {
      lText.x = sx + stepSize + 12
      lText.y = sy + Math.round((stepSize - lText.height) / 2)
    }
  }

  mg.commitUndo()
  return { success: true, container: serializeNode(frame), current }
}

