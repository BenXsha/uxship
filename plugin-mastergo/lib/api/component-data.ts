/**
 * 组件渲染处理器
 *
 * 高阶组件 API：将原子组件（checkbox/radio/button/input）的创建封装为一次调用。
 * 遵循 B1 方案（Token 参数注入），提供最佳实践默认值，支持 theme 覆盖。
 */

import { mergeTheme } from './design-theme'
import { solidFill, dropShadow, makeNode, serializeNode, ICON_CHECK, ICON_CLOSE, ICON_EXCLAMATION, ICON_INFO, renderSvgIcon } from './component-utils'

// ─── 数据组件 — 列表、手风琴、卡片、表格、表单、提示、模态框、警告条 ───

export function renderList(params: any): any {
  const t = mergeTheme(params.theme)
  const items = params.items || [
    { label: '列表项 1', icon: '', badge: '' },
    { label: '列表项 2', icon: '', badge: 'New' },
    { label: '列表项 3', icon: '', badge: '' },
  ]
  const itemHeight = params.size?.height ?? t.listItemHeight
  const width = params.size?.width ?? 320
  const paddingX = params.size?.paddingX ?? t.listItemPaddingX
  const totalH = items.length * (itemHeight + t.listItemGap)

  const frame = makeNode('frame', {
    name: params.name || 'List',
    width,
    height: totalH,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius: params.size?.cornerRadius ?? 8,
    fills: [solidFill(t.bgWhite)],
    effects: [dropShadow(t.shadowColor, t.shadowOffset, t.shadowRadius)],
    clipsContent: true,
  })

  const listItems: any[] = []
  let y = 0

  items.forEach((item: any, i: number) => {
    const row = makeNode('frame', {
      name: `Item-${i}`,
      width,
      height: itemHeight,
      x: 0, y,
      fills: [],
      clipsContent: false,
    }, frame.id)

    if (item.avatar || item.icon) {
      const iconText = item.avatar || item.icon || ''
      // 侧向头像/图标：makeNode 会直接落到 row 容器上，无需保留引用
      makeNode('text', {
        name: 'Icon',
        characters: iconText,
        fontSize: 16,
        fontName: t.labelFont,
        fills: [solidFill(t.textPrimary)],
        x: paddingX,
        y: Math.round((itemHeight - 20) / 2),
      }, row.id)
    }

    const labelX = (item.avatar || item.icon) ? paddingX + 28 : paddingX
    const label = makeNode('text', {
      name: 'Label',
      characters: item.label,
      fontSize: 14,
      fontName: t.labelFont,
      fills: [solidFill(t.textPrimary)],
      textAlignHorizontal: 'LEFT',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      x: labelX,
      y: 0,
    }, row.id)
    label.y = Math.round((itemHeight - label.height) / 2)

    if (item.badge) {
      const badgeText = makeNode('text', {
        name: 'Badge',
        characters: item.badge,
        fontSize: 11,
        fontName: { family: 'Inter', style: 'Medium' },
        fills: [solidFill(t.brand)],
        textAutoResize: 'WIDTH_AND_HEIGHT',
        x: width - paddingX - 60,
        y: 0,
      }, row.id)
      badgeText.y = Math.round((itemHeight - badgeText.height) / 2)
    }

    if (i < items.length - 1) {
      makeNode('rectangle', {
        name: `Divider-${i}`,
        width: width - paddingX * 2,
        height: 1,
        x: paddingX,
        y: itemHeight - 1,
        fills: [solidFill(t.listDividerColor)],
      }, row.id)
    }

    y += itemHeight + t.listItemGap
    listItems.push({ id: row.id, label: label.id, labelText: item.label })
  })

  mg.commitUndo()
  return { success: true, container: serializeNode(frame), items: listItems }
}

export function renderAccordion(params: any): any {
  const t = mergeTheme(params.theme)
  const items = params.items || [
    { label: '面板一', content: '这是面板一的内容', expanded: true },
    { label: '面板二', content: '这是面板二的内容' },
    { label: '面板三', content: '这是面板三的内容' },
  ]
  const bordered = params.bordered !== false
  const headerH = params.size?.height ?? t.accordionHeaderHeight
  const contentPadding = params.size?.paddingX ?? t.accordionContentPadding
  const cornerRadius = params.size?.cornerRadius ?? t.accordionCornerRadius

  let totalH = 0
  items.forEach((item: any) => {
    totalH += headerH
    if (item.expanded && item.content) {
      const contentLines = item.content.length / 30 + 1
      totalH += contentLines * 18 + contentPadding * 2
    }
  })

  const maxLabelW = items.reduce((max: number, it: any) => Math.max(max, it.label.length * 15), 0)
  const totalW = Math.max(maxLabelW + 80, 300)

  const frame = makeNode('frame', {
    name: params.name || 'Accordion',
    width: totalW,
    height: totalH,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius: bordered ? cornerRadius : 0,
    fills: [],
    ...(bordered ? { strokes: [solidFill(t.accordionBorderColor, 1)], strokeWeight: 1 } : {}),
    clipsContent: true,
  })

  let y = 0
  const panels: any[] = []

  items.forEach((item: any, i: number) => {
    const isLast = i === items.length - 1
    const expanded = item.expanded === true

    // Header
    const header = makeNode('frame', {
      name: `Header-${i}`,
      width: totalW,
      height: headerH,
      x: 0,
      y,
      fills: [solidFill(t.bgWhite)],
      clipsContent: true,
    }, frame.id)

    const label = makeNode('text', {
      name: 'Label',
      characters: item.label,
      fontSize: 14,
      fontName: { family: 'Inter', style: 'Medium' },
      fills: [solidFill(t.textTitle)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
      x: contentPadding,
      y: 0,
    }, header.id)
    label.y = Math.round((headerH - label.height) / 2)

    // Chevron icon
    const chevSize = 10
    const chevX = totalW - contentPadding - chevSize
    const chevY = y + Math.round((headerH - chevSize) / 2)
    const chevronPath = expanded
      ? `M0 ${chevSize}L${chevSize / 2} 0L${chevSize} ${chevSize}`
      : `M0 0L${chevSize / 2} ${chevSize}L${chevSize} 0`
    makeNode('pen', {
      name: 'Chevron',
      svgPathData: chevronPath,
      strokes: [solidFill('#999999', 1)],
      strokeWeight: 1.6,
      strokeCap: 'ROUND',
      strokeJoin: 'ROUND',
      width: chevSize,
      height: chevSize,
      x: chevX,
      y: chevY,
    }, header.id)

    // Divider below header
    if (!isLast || expanded) {
      makeNode('rectangle', {
        name: `Divider-${i}`,
        width: totalW - (bordered ? 1 : 0),
        height: 1,
        x: 0,
        y: y + headerH,
        fills: [solidFill(t.accordionBorderColor)],
      }, frame.id)
    }

    y += headerH

    // Content panel (if expanded)
    if (expanded && item.content) {
      const contentText = makeNode('text', {
        name: 'Content',
        characters: item.content,
        fontSize: 13,
        fontName: t.labelFont,
        fills: [solidFill(t.textPrimary)],
        textAutoResize: 'WIDTH_AND_HEIGHT',
        x: contentPadding,
        y: y + contentPadding,
      }, frame.id)

      y += contentText.height + contentPadding * 2
    }

    panels.push({ header: header.id, label: label.id })
  })

  mg.commitUndo()
  return { success: true, container: serializeNode(frame), panels }
}

export function renderCard(params: any): any {
  const t = mergeTheme(params.theme)
  const title = params.title || 'Card Title'
  const content = params.content || 'Card content goes here.'
  const width = params.size?.width ?? 320
  const padding = params.size?.paddingX ?? 24
  const cornerRadius = params.size?.cornerRadius ?? 12
  const showFooter = params.footer !== false
  const footerButtons = params.footerButtons || ['Cancel', 'Confirm']

  const titleH = 22
  const contentH = content.length * 0.5 * 14 + 8
  const footerH = showFooter ? 48 : 0
  const totalH = padding * 2 + titleH + 16 + contentH + (showFooter ? footerH : 0)

  const frame = makeNode('frame', {
    name: params.name || 'Card',
    width,
    height: totalH,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius,
    fills: [solidFill(t.bgWhite)],
    effects: [dropShadow(t.shadowColor, t.shadowOffset, t.shadowRadius)],
    clipsContent: true,
  })

  makeNode('text', {
    name: 'Title',
    characters: title,
    fontSize: t.titleSize,
    fontName: t.titleFont,
    fills: [solidFill(t.textTitle)],
    x: padding,
    y: padding,
  }, frame.id)

  makeNode('text', {
    name: 'Content',
    characters: content,
    fontSize: t.labelSize,
    fontName: t.labelFont,
    fills: [solidFill(t.textPrimary)],
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: padding,
    y: padding + titleH + 16,
  }, frame.id)

  if (showFooter) {
    const btnW = 80
    const btnH = t.buttonHeightMd
    const btnGap = 12
    const btnStartX = width - padding - (footerButtons.length * btnW + (footerButtons.length - 1) * btnGap)
    const btnY = totalH - footerH + (footerH - btnH) / 2

    // Footer divider line
    makeNode('rectangle', {
      name: 'FooterDivider',
      width,
      height: 1,
      x: 0,
      y: totalH - footerH,
      fills: [solidFill(t.modalFooterBorder)],
    }, frame.id)

    footerButtons.forEach((label: string, i: number) => {
      const isPrimary = i === footerButtons.length - 1
      const bg = isPrimary ? t.brand : t.bgWhite
      const textColor = isPrimary ? '#FFFFFF' : t.textPrimary

      const btn = makeNode('frame', {
        name: `Btn-${i}`,
        width: btnW,
        height: btnH,
        x: btnStartX + i * (btnW + btnGap),
        y: btnY,
        cornerRadius: t.buttonRadius,
        fills: [solidFill(bg)],
        clipsContent: true,
      }, frame.id)

      const btnLabel = makeNode('text', {
        name: `Label-${i}`,
        characters: label,
        fontSize: 13,
        fontName: { family: 'Inter', style: 'Medium' },
        fills: [solidFill(textColor)],
        textAlignHorizontal: 'CENTER',
        textAutoResize: 'WIDTH_AND_HEIGHT',
        x: 0, y: 0,
      }, btn.id)
      btnLabel.x = Math.round((btnW - btnLabel.width) / 2)
      btnLabel.y = Math.round((btnH - btnLabel.height) / 2)
    })
  }

  mg.commitUndo()
  return { success: true, container: serializeNode(frame) }
}

export function renderTable(params: any): any {
  const t = mergeTheme(params.theme)
  const columns = params.columns || ['Column 1', 'Column 2', 'Column 3']
  const rows = params.rows || [
    ['Row 1 Col 1', 'Row 1 Col 2', 'Row 1 Col 3'],
    ['Row 2 Col 1', 'Row 2 Col 2', 'Row 2 Col 3'],
    ['Row 3 Col 1', 'Row 3 Col 2', 'Row 3 Col 3'],
  ]
  const width = params.size?.width ?? 400
  const headerHeight = params.size?.headerHeight ?? 40
  const rowHeight = params.size?.rowHeight ?? 36
  const cellPadding = params.size?.cellPadding ?? 12
  const cornerRadius = params.size?.cornerRadius ?? 8

  const totalH = headerHeight + rows.length * rowHeight
  const colW = width / columns.length

  const frame = makeNode('frame', {
    name: params.name || 'Table',
    width,
    height: totalH,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius,
    fills: [solidFill(t.bgWhite)],
    effects: [dropShadow(t.shadowColor, t.shadowOffset, t.shadowRadius)],
    clipsContent: true,
  })

  // Header row
  columns.forEach((col: string, i: number) => {
    makeNode('frame', {
      name: `HeaderCell-${i}`,
      width: colW,
      height: headerHeight,
      x: i * colW,
      y: 0,
      fills: [solidFill('#F5F5F5')],
      clipsContent: false,
    }, frame.id)

    makeNode('text', {
      name: `Header-${i}`,
      characters: col,
      fontSize: 14,
      fontName: { family: 'Inter', style: 'Bold' },
      fills: [solidFill(t.textTitle)],
      x: i * colW + cellPadding,
      y: (headerHeight - 14) / 2,
    }, frame.id)

    if (i < columns.length - 1) {
      makeNode('rectangle', {
        name: `HeaderDivider-${i}`,
        width: 1,
        height: headerHeight,
        x: (i + 1) * colW - 0.5,
        y: 0,
        fills: [solidFill('#E0E0E0')],
      }, frame.id)
    }
  })

  // Data rows
  rows.forEach((row: string[], rowIdx: number) => {
    const rowY = headerHeight + rowIdx * rowHeight

    makeNode('rectangle', {
      name: `RowDivider-${rowIdx}`,
      width,
      height: 1,
      x: 0,
      y: rowY,
      fills: [solidFill('#E8E8E8')],
    }, frame.id)

    row.forEach((cell: string, colIdx: number) => {
      makeNode('text', {
        name: `Cell-${rowIdx}-${colIdx}`,
        characters: cell,
        fontSize: 13,
        fontName: t.labelFont,
        fills: [solidFill(t.textPrimary)],
        x: colIdx * colW + cellPadding,
        y: rowY + (rowHeight - 13) / 2,
      }, frame.id)
    })
  })

  mg.commitUndo()
  return { success: true, container: serializeNode(frame) }
}

export function renderForm(params: any): any {
  const t = mergeTheme(params.theme)
  const fields = params.fields || [
    { label: 'Username', type: 'text', placeholder: 'Enter username' },
    { label: 'Email', type: 'email', placeholder: 'Enter email' },
    { label: 'Password', type: 'password', placeholder: 'Enter password' },
  ]
  const width = params.size?.width ?? 320
  const labelWidth = params.size?.labelWidth ?? 80
  const inputHeight = params.size?.inputHeight ?? 36
  const fieldGap = params.size?.fieldGap ?? 16
  const padding = params.size?.paddingX ?? 24
  const cornerRadius = params.size?.cornerRadius ?? 8

  const totalH = padding * 2 + fields.length * (inputHeight + fieldGap) + 48

  const frame = makeNode('frame', {
    name: params.name || 'Form',
    width,
    height: totalH,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius,
    fills: [solidFill(t.bgWhite)],
    effects: [dropShadow(t.shadowColor, t.shadowOffset, t.shadowRadius)],
    clipsContent: true,
  })

  let y = padding
  fields.forEach((field: any, i: number) => {
    makeNode('text', {
      name: `Label-${i}`,
      characters: field.label,
      fontSize: 14,
      fontName: { family: 'Inter', style: 'Medium' },
      fills: [solidFill(t.textPrimary)],
      x: padding,
      y: y + (inputHeight - 14) / 2,
    }, frame.id)

    makeNode('frame', {
      name: `Input-${i}`,
      width: width - padding * 2 - labelWidth,
      height: inputHeight,
      x: padding + labelWidth,
      y,
      cornerRadius: 6,
      fills: [solidFill(t.bgWhite)],
      strokes: [solidFill(t.border, 1)],
      strokeWeight: 1,
      strokeAlign: 'INSIDE',
      clipsContent: true,
    }, frame.id)

    makeNode('text', {
      name: `Placeholder-${i}`,
      characters: field.placeholder || '',
      fontSize: 14,
      fontName: t.labelFont,
      fills: [solidFill('#64748B')],
      x: padding + labelWidth + 12,
      y: y + (inputHeight - 14) / 2,
    }, frame.id)

    y += inputHeight + fieldGap
  })

  // Submit button
  const btnW = 120
  const btnH = t.buttonHeightMd
  makeNode('frame', {
    name: 'SubmitBtn',
    width: btnW,
    height: btnH,
    x: width - padding - btnW,
    y: totalH - padding - btnH,
    cornerRadius: t.buttonRadius,
    fills: [solidFill(t.brand)],
    clipsContent: true,
  }, frame.id)

  makeNode('text', {
    name: 'SubmitLabel',
    characters: params.submitLabel || 'Submit',
    fontSize: 14,
    fontName: { family: 'Inter', style: 'Medium' },
    fills: [solidFill('#FFFFFF')],
    textAlignHorizontal: 'CENTER',
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: width - padding - btnW + (btnW - 56) / 2,
    y: totalH - padding - btnH + (btnH - 14) / 2,
  }, frame.id)

  mg.commitUndo()
  return { success: true, container: serializeNode(frame) }
}

export function renderToast(params: any): any {
  const t = mergeTheme(params.theme)
  const message = params.message || 'Toast message'
  const type = params.type || 'info'
  const width = params.size?.width ?? 280
  const height = params.size?.height ?? 48
  const cornerRadius = params.size?.cornerRadius ?? 8

  const toastVariants: Record<string, { bg: string; text: string; iconColor: string }> = {
    success: { bg: '#E6F7E6', text: '#1A7D1A', iconColor: '#1A7D1A' },
    warning: { bg: '#FFF8E1', text: '#92400E', iconColor: '#92400E' },
    error: { bg: '#FFEBEE', text: '#C62828', iconColor: '#C62828' },
    info: { bg: '#E3F2FD', text: '#1565C0', iconColor: '#1565C0' },
  }

  const v = toastVariants[type] || toastVariants.info

  const frame = makeNode('frame', {
    name: params.name || 'Toast',
    width,
    height,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius,
    fills: [solidFill(v.bg)],
    clipsContent: true,
  })

  // Icon
  const iconSize = 20
  const iconX = 16
  const iconY = (height - iconSize) / 2

  if (type === 'success') {
    makeNode('pen', {
      name: 'Icon',
      svgPathData: 'M2 10L8 16L18 4',
      strokes: [solidFill(v.iconColor, 1)],
      strokeWeight: 2,
      strokeCap: 'ROUND',
      strokeJoin: 'ROUND',
      width: iconSize,
      height: iconSize,
      x: iconX,
      y: iconY,
    }, frame.id)
  } else if (type === 'error') {
    makeNode('pen', {
      name: 'Icon',
      svgPathData: 'M4 4L16 16M16 4L4 16',
      strokes: [solidFill(v.iconColor, 1)],
      strokeWeight: 2,
      strokeCap: 'ROUND',
      width: iconSize,
      height: iconSize,
      x: iconX,
      y: iconY,
    }, frame.id)
  } else if (type === 'warning') {
    makeNode('pen', {
      name: 'Icon',
      svgPathData: 'M10 4V12M10 16H10.01',
      strokes: [solidFill(v.iconColor, 1)],
      strokeWeight: 2,
      strokeCap: 'ROUND',
      width: iconSize,
      height: iconSize,
      x: iconX,
      y: iconY,
    }, frame.id)
  } else {
    makeNode('ellipse', {
      name: 'IconCircle',
      width: iconSize,
      height: iconSize,
      x: iconX,
      y: iconY,
      fills: [],
      strokes: [solidFill(v.iconColor, 1)],
      strokeWeight: 2,
    }, frame.id)
  }

  makeNode('text', {
    // R2 保留名为 `Description`（`Message` 属自创同义词）
    name: 'Description',
    characters: message,
    fontSize: 14,
    fontName: t.labelFont,
    fills: [solidFill(v.text)],
    x: iconX + iconSize + 12,
    y: (height - 14) / 2,
  }, frame.id)

  mg.commitUndo()
  return { success: true, container: serializeNode(frame) }
}

export function renderModal(params: any): any {
  const t = mergeTheme(params.theme)
  const title = params.title || '提示'
  const content = params.content || ''
  const confirmLabel = params.confirmLabel || '确认'
  const cancelLabel = params.cancelLabel || '取消'
  const showCancel = params.showCancel !== false
  const closable = params.closable !== false
  const width = params.size?.width ?? t.modalWidth

  const titleFontSize = params.size?.fontSize ?? t.titleSize
  const bodyFontSize = t.labelSize
  const padding = params.size?.paddingX ?? t.modalPadding
  const cornerRadius = params.size?.cornerRadius ?? t.modalCornerRadius

  const btnH = t.buttonHeightMd
  const btnW = 80

  const overlay = makeNode('frame', {
    name: params.name || 'Modal',
    width: width + 60,
    height: 460,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    fills: [solidFill(t.modalOverlay)],
    clipsContent: true,
  })

  // Card container
  const cardW = width
  const titleText = makeNode('text', {
    name: 'Title',
    characters: title,
    fontSize: titleFontSize,
    fontName: t.titleFont,
    fills: [solidFill(t.textTitle)],
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: 0, y: 0,
  })
  const titleH = titleText.height

  const contentText = content ? makeNode('text', {
    name: 'Content',
    characters: content,
    fontSize: bodyFontSize,
    fontName: t.labelFont,
    fills: [solidFill(t.textPrimary)],
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: 0, y: 0,
  }) : null
  const contentH = contentText ? contentText.height : 0

  const footerH = showCancel ? 50 : 44
  const cardH = padding * 2 + titleH + 12 + (contentH > 0 ? contentH + 12 : 0) + footerH

  const card = makeNode('frame', {
    name: 'Card',
    width: cardW,
    height: cardH,
    x: 0, y: 0,
    cornerRadius,
    fills: [solidFill(t.bgWhite)],
    effects: [dropShadow('#00000026', { x: 0, y: 8 }, 24)],
    clipsContent: true,
  }, overlay.id)
  card.x = Math.round((overlay.width - cardW) / 2)
  card.y = Math.round((overlay.height - cardH) / 2)

  // Title in card
  card.appendChild(titleText)
  titleText.x = padding
  titleText.y = padding

  // Close button (X)
  if (closable) {
    const closeX = cardW - padding - 12
    const closeY = padding + 2
    makeNode('pen', {
      name: 'Close',
      svgPathData: 'M0 0L8 8M8 0L0 8',
      strokes: [solidFill('#999999', 1)],
      strokeWeight: 1.8,
      strokeCap: 'ROUND',
      width: 8, height: 8,
      x: closeX, y: closeY,
    }, card.id)
  }

  // Content
  if (contentText) {
    card.appendChild(contentText)
    contentText.x = padding
    contentText.y = padding + titleH + 12
  }

  // Footer divider
  const footerY = padding * 2 + titleH + 12 + (contentH > 0 ? contentH + 12 : 0)
  makeNode('rectangle', {
    name: 'FooterDivider',
    width: cardW,
    height: 1,
    x: 0,
    y: footerY,
    fills: [solidFill(t.modalFooterBorder)],
  }, card.id)

  // Buttons
  const btnY = footerY + Math.round((footerH - btnH) / 2)
  const totalBtnW = showCancel ? btnW * 2 + 12 : btnW
  let btnStartX = cardW - padding - totalBtnW

  const confirm = makeNode('frame', {
    name: 'Btn-Confirm',
    width: btnW,
    height: btnH,
    x: btnStartX + (showCancel ? btnW + 12 : 0),
    y: btnY,
    cornerRadius: t.buttonRadius,
    fills: [solidFill(t.brand)],
    clipsContent: true,
  }, card.id)

  const confirmText = makeNode('text', {
    name: 'Label',
    characters: confirmLabel,
    fontSize: 13,
    fontName: { family: 'Inter', style: 'Medium' },
    fills: [solidFill('#FFFFFF')],
    textAlignHorizontal: 'CENTER',
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: 0, y: 0,
  }, confirm.id)
  confirmText.x = Math.round((btnW - confirmText.width) / 2)
  confirmText.y = Math.round((btnH - confirmText.height) / 2)

  if (showCancel) {
    const cancel = makeNode('frame', {
      name: 'Btn-Cancel',
      width: btnW,
      height: btnH,
      x: btnStartX,
      y: btnY,
      cornerRadius: t.buttonRadius,
      fills: [solidFill(t.bgWhite)],
      strokes: [solidFill(t.border, 1)],
      strokeWeight: 1,
      clipsContent: true,
    }, card.id)

    const cancelText = makeNode('text', {
      name: 'Label',
      characters: cancelLabel,
      fontSize: 13,
      fontName: { family: 'Inter', style: 'Regular' },
      fills: [solidFill(t.textPrimary)],
      textAlignHorizontal: 'CENTER',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      x: 0, y: 0,
    }, cancel.id)
    cancelText.x = Math.round((btnW - cancelText.width) / 2)
    cancelText.y = Math.round((btnH - cancelText.height) / 2)
  }

  mg.commitUndo()
  return { success: true, container: serializeNode(overlay), card: serializeNode(card) }
}

export async function renderAlert(params: any): Promise<any> {
  const t = mergeTheme(params.theme)
  const title = params.title || '提示'
  const content = params.content || ''
  const variant = params.variant || 'info'
  const closable = params.closable !== false
  const width = params.size?.width ?? t.alertWidth

  const alertVariants: Record<string, { bg: string; border: string; iconColor: string; iconPath: string }> = {
    success: { bg: t.alertSuccessBg, border: t.alertSuccessBorder, iconColor: t.alertSuccessIcon, iconPath: ICON_CHECK },
    warning: { bg: t.alertWarningBg, border: t.alertWarningBorder, iconColor: t.alertWarningIcon, iconPath: ICON_EXCLAMATION },
    error: { bg: t.alertErrorBg, border: t.alertErrorBorder, iconColor: t.alertErrorIcon, iconPath: ICON_CLOSE },
    info: { bg: t.alertInfoBg, border: t.alertInfoBorder, iconColor: t.alertInfoIcon, iconPath: ICON_INFO },
  }
  const v = alertVariants[variant] || alertVariants.info

  const fontSize = params.size?.fontSize ?? 14
  const padding = params.size?.paddingX ?? 16
  const iconSize = 20
  const textX = padding + iconSize + 8

  const titleText = makeNode('text', {
    name: 'Title',
    characters: title,
    fontSize: fontSize + 2,
    fontName: { family: 'Inter', style: 'Bold' },
    fills: [solidFill(t.textTitle)],
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: 0, y: 0,
  })

  const contentText = content ? makeNode('text', {
    name: 'Content',
    characters: content,
    fontSize: fontSize - 1,
    fontName: t.labelFont,
    fills: [solidFill(t.textPrimary)],
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: 0, y: 0,
  }) : null

  const titleH = titleText.height
  const contentH = contentText ? contentText.height : 0
  const bodyH = titleH + 4 + (contentH > 0 ? contentH + 4 : 0)
  const alertH = Math.max(padding * 2 + bodyH, padding * 2 + titleH + 4)

  const frame = makeNode('frame', {
    name: params.name || `Alert-${variant}`,
    width,
    height: alertH,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    cornerRadius: params.size?.cornerRadius ?? t.alertCornerRadius,
    fills: [solidFill(v.bg)],
    strokes: [solidFill(v.border, 1)],
    strokeWeight: 1,
    clipsContent: true,
  })

  // Icon
  await renderSvgIcon(v.iconPath, iconSize, v.iconColor, frame.id, padding, Math.round((alertH - iconSize) / 2))

  // Title
  frame.appendChild(titleText)
  titleText.x = textX
  titleText.y = padding

  // Content
  if (contentText) {
    frame.appendChild(contentText)
    contentText.x = textX
    contentText.y = padding + titleH + 4
  }

  // Close
  if (closable) {
    const closeX = width - padding - 12
    const closeY = Math.round((alertH - 8) / 2)
    makeNode('pen', {
      name: 'Close',
      svgPathData: 'M0 0L8 8M8 0L0 8',
      strokes: [solidFill(v.iconColor, 0.6)],
      strokeWeight: 1.6,
      strokeCap: 'ROUND',
      width: 8, height: 8,
      x: closeX, y: closeY,
    }, frame.id)
  }

  mg.commitUndo()
  return { success: true, container: serializeNode(frame) }
}

