import {
  BaseElement,
  RectangleElement,
  TextElement,
  FrameElement,
  GroupElement,
  PolygonElement
} from './dsl-types'

export class TemplateRenderer {

  static expandTemplate(template: string, config: any, data?: any[]): BaseElement[] {
    switch (template) {
      case 'grid':
        return this.renderGridTemplate(config, data)
      case 'table':
        return this.renderTableTemplate(config, data)
      case 'list':
        return this.renderListTemplate(config, data)
      case 'form':
        return this.renderFormTemplate(config, data)
      case 'pagination':
        return this.renderPaginationTemplate(config, data)
      case 'carousel':
        return this.renderCarouselTemplate(config, data)
      default:
        console.warn(`不支持的模板类型: ${template}`)
        return []
    }
  }

  static expandTree(data: any[], config: any): BaseElement[] {
    return this.renderTreeTemplate(config, data)
  }

  // ==================== 表格 ====================

  private static renderTableTemplate(config: any, data?: any[]): BaseElement[] {
    const {
      columns = [],
      headerStyle = {},
      rowStyle = {},
      cornerRadius = 8
    } = config

    const elements: BaseElement[] = []
    const tableRows = data || []
    const colCount = columns.length

    const tableWidth = columns.reduce((sum: number, col: any) => sum + (col.width || 100), 0)
    const headerHeight = headerStyle.height || 40
    const rowHeight = rowStyle.height || 48

    const tableContainer: FrameElement = {
      type: 'frame',
      name: '表格容器',
      position: { x: 0, y: 0 },
      layoutMode: 'VERTICAL',
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'AUTO',
      itemSpacing: 0,
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      clipsContent: true,
      fills: [{ type: 'solid', color: '#ffffff' }],
      cornerRadius: cornerRadius,
      children: []
    }

    const headerFrame: FrameElement = {
      type: 'frame',
      name: '列头',
      size: { width: tableWidth, height: headerHeight },
      layoutMode: 'HORIZONTAL',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      itemSpacing: 0,
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'CENTER',
      flexWrap: 'NO_WRAP',
      fills: headerStyle.fills || [{ type: 'solid', color: '#f9fafb' }],
      children: []
    }

    for (let col = 0; col < colCount; col++) {
      const column = columns[col]
      const columnWidth = column.width || 100

      const headerColumn: FrameElement = {
        type: 'frame',
        name: `列头-${col + 1}`,
        size: { width: columnWidth },
        layoutMode: 'VERTICAL',
        primaryAxisSizingMode: 'AUTO',
        counterAxisSizingMode: 'FIXED',
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'CENTER',
        paddingLeft: 8,
        paddingRight: 8,
        clipsContent: true,
        fills: [],
        children: [
          {
            type: 'text',
            name: `列头文字-${col + 1}`,
            content: column.label || `列 ${col + 1}`,
            fontSize: headerStyle.fontSize || 13,
            fontWeight: headerStyle.fontWeight || 600,
            fills: headerStyle.textColor
              ? [{ type: 'solid', color: headerStyle.textColor }]
              : [{ type: 'solid', color: '#374151' }],
            textAlignHorizontal: column.align || 'LEFT',
            textAlignVertical: 'CENTER',
            textAutoResize: 'HEIGHT'
          } as TextElement
        ]
      }

      headerFrame.children!.push(headerColumn)
    }

    tableContainer.children!.push(headerFrame)

    const tableBody: FrameElement = {
      type: 'frame',
      name: '表格体',
      size: { width: tableWidth },
      layoutMode: 'VERTICAL',
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'FIXED',
      itemSpacing: 0,
      paddingTop: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      paddingRight: 0,
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      clipsContent: false,
      fills: [],
      children: []
    }

    for (let row = 0; row < tableRows.length; row++) {
      const rowData = tableRows[row]
      const isEven = row % 2 === 0

      const rowFrame: FrameElement = {
        type: 'frame',
        name: `行-${row + 1}`,
        size: { width: tableWidth, height: rowHeight },
        layoutMode: 'HORIZONTAL',
        primaryAxisSizingMode: 'FIXED',
        counterAxisSizingMode: 'FIXED',
        itemSpacing: 0,
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'CENTER',
        flexWrap: 'NO_WRAP',
        fills: isEven
          ? (rowStyle.fills || [{ type: 'solid', color: '#ffffff' }])
          : (rowStyle.alternatingFills || [{ type: 'solid', color: '#f9fafb' }]),
        children: []
      }

      for (let col = 0; col < colCount; col++) {
        const column = columns[col]
        const columnWidth = column.width || 100
        const cellValue = rowData ? rowData[column.key] : ''

        const cellFrame: FrameElement = {
          type: 'frame',
          name: `单元格-${row + 1}-${col + 1}`,
          size: { width: columnWidth },
          layoutMode: 'VERTICAL',
          primaryAxisSizingMode: 'AUTO',
          counterAxisSizingMode: 'FIXED',
          primaryAxisAlignItems: 'MIN',
          counterAxisAlignItems: 'CENTER',
          paddingLeft: 8,
          paddingRight: 8,
          clipsContent: true,
          fills: [],
          children: [
            {
              type: 'text',
              name: `单元格文字-${row + 1}-${col + 1}`,
              content: String(cellValue || ''),
              fontSize: column.style?.fontSize || 13,
              fontWeight: column.style?.fontWeight || 400,
              fills: column.style?.fills || [{ type: 'solid', color: '#374151' }],
              textAlignHorizontal: column.align || 'LEFT',
              textAlignVertical: 'CENTER',
              textAutoResize: 'HEIGHT'
            } as TextElement
          ]
        }

        rowFrame.children!.push(cellFrame)
      }

      tableBody.children!.push(rowFrame)
    }

    tableContainer.children!.push(tableBody)
    elements.push(tableContainer)
    return elements
  }

  // ==================== 树形 ====================

  private static renderTreeTemplate(config: any, data?: any[]): BaseElement[] {
    const {
      itemHeight = 32,
      indentSize = 24,
      showIcon = false,
      showExpandIcon = true,
      expandIconPosition = 'left',
      nodeStyle = {},
      labelStyle = {},
      iconStyle = {},
      expandIconStyle = {},
      lineStyle = {},
      hoverStyle = {},
      selectedStyle = {},
      disabledStyle = {}
    } = config

    const elements: BaseElement[] = []
    const containerChildren: BaseElement[] = []

    this.renderTreeNodes(
      data || [],
      containerChildren,
      0,
      0,
      itemHeight,
      indentSize,
      showIcon,
      showExpandIcon,
      expandIconPosition,
      nodeStyle,
      labelStyle,
      iconStyle,
      expandIconStyle,
      lineStyle,
      hoverStyle,
      selectedStyle,
      disabledStyle
    )

    const treeInfo = this.calculateTreeSize(data || [], itemHeight, indentSize)
    const treeWidth = Math.max(treeInfo.maxWidth, 300)
    const treeHeight = treeInfo.totalHeight

    const container: FrameElement = {
      type: 'frame',
      name: '树形容器',
      position: { x: 0, y: 0 },
      size: { width: treeWidth, height: treeHeight },
      layoutMode: 'NONE',
      clipsContent: true,
      fills: [{ type: 'solid', color: '#ffffff' }],
      children: containerChildren
    }

    elements.push(container)
    return elements
  }

  private static calculateTreeSize(nodes: any[], itemHeight: number, indentSize: number): { totalHeight: number; maxWidth: number; maxDepth: number } {
    let totalHeight = 0
    let maxWidth = 0
    let maxDepth = 0

    const traverse = (nodes: any[], depth: number, expanded: boolean): number => {
      let height = 0
      for (const node of nodes) {
        if (expanded) {
          height += itemHeight
          const labelWidth = (node.label?.length || 0) * 8 + depth * indentSize + 100
          maxWidth = Math.max(maxWidth, labelWidth)
          maxDepth = Math.max(maxDepth, depth)
        }
        if (node.children && node.children.length > 0) {
          height += traverse(node.children, depth + 1, node.expanded !== false)
        }
      }
      return height
    }

    totalHeight = traverse(nodes, 0, true)
    return { totalHeight, maxWidth, maxDepth }
  }

  private static renderTreeNodes(
    nodes: any[],
    children: BaseElement[],
    startY: number,
    depth: number,
    itemHeight: number,
    indentSize: number,
    showIcon: boolean,
    showExpandIcon: boolean,
    expandIconPosition: 'left' | 'right',
    nodeStyle: any,
    labelStyle: any,
    iconStyle: any,
    expandIconStyle: any,
    lineStyle: any,
    hoverStyle: any,
    selectedStyle: any,
    disabledStyle: any
  ): number {
    let currentY = startY
    let lastNodeY = startY

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const hasChildren = node.children && node.children.length > 0
      const nodeGroupChildren: BaseElement[] = []
      const indent = depth * indentSize

      let finalNodeStyle = { ...nodeStyle }
      if (node.disabled) {
        finalNodeStyle = { ...finalNodeStyle, ...disabledStyle }
      } else if (node.selected) {
        finalNodeStyle = { ...finalNodeStyle, ...selectedStyle }
      }

      const nodeBg: RectangleElement = {
        type: 'rectangle',
        name: `__tree-node-bg__${node.id}`,
        position: { x: 0, y: 0 },
        size: { width: 300, height: itemHeight },
        fills: finalNodeStyle.fills || [],
        cornerRadius: finalNodeStyle.cornerRadius
      }
      nodeGroupChildren.push(nodeBg)

      let currentX = indent + 8

      if (hasChildren && showExpandIcon && expandIconPosition === 'left') {
        const iconSize = expandIconStyle.size || 12
        const expandIconElements = this.createExpandIcon(node.expanded !== false, expandIconStyle)
        const expandIcon: GroupElement = {
          type: 'group',
          name: `__tree-expand-icon__${node.id}`,
          position: { x: currentX, y: itemHeight / 2 - iconSize / 2 },
          children: expandIconElements
        }
        nodeGroupChildren.push(expandIcon)
        currentX += iconSize + 8
      }

      if (showIcon && node.icon) {
        const iconSize = iconStyle.size || 16
        const icon: RectangleElement = {
          type: 'rectangle',
          name: `__tree-node-icon__${node.id}`,
          position: { x: currentX, y: itemHeight / 2 - iconSize / 2 },
          size: { width: iconSize, height: iconSize },
          cornerRadius: 2,
          fills: [{ type: 'solid', color: iconStyle.color || '#6b7280' }]
        }
        nodeGroupChildren.push(icon)
        currentX += iconSize + 8
      }

      const labelFontSize = labelStyle.fontSize || 13
      const label: TextElement = {
        type: 'text',
        name: `__tree-node-label__${node.id}`,
        position: { x: currentX, y: itemHeight / 2 - labelFontSize / 2 - 1 },
        content: node.label,
        fontSize: labelFontSize,
        fills: node.disabled
          ? [{ type: 'solid', color: '#9ca3af' }]
          : (labelStyle.fills || [{ type: 'solid', color: '#1f2937' }]),
        textAutoResize: 'WIDTH_AND_HEIGHT'
      }
      nodeGroupChildren.push(label)

      if (hasChildren && showExpandIcon && expandIconPosition === 'right') {
        const iconSize = expandIconStyle.size || 12
        const expandIconElements = this.createExpandIcon(node.expanded !== false, expandIconStyle)
        const expandIcon: GroupElement = {
          type: 'group',
          name: `__tree-expand-icon__${node.id}`,
          position: { x: 280, y: itemHeight / 2 - iconSize / 2 },
          children: expandIconElements
        }
        nodeGroupChildren.push(expandIcon)
      }

      const nodeGroup: GroupElement = {
        type: 'group',
        name: `__tree-node__${node.id}`,
        position: { x: 0, y: currentY },
        children: nodeGroupChildren
      }
      children.push(nodeGroup)

      if (lineStyle.show && depth > 0) {
        const parentIndent = (depth - 1) * indentSize
        const lineX = parentIndent + indentSize / 2
        const horizontalLine: RectangleElement = {
          type: 'rectangle',
          name: `__tree-line-h__${node.id}`,
          position: { x: lineX, y: currentY + itemHeight / 2 - (lineStyle.width || 1) / 2 },
          size: { width: indent - lineX, height: lineStyle.width || 1 },
          fills: [{ type: 'solid', color: lineStyle.color || '#e5e7eb' }]
        }
        children.push(horizontalLine)
      }

      currentY += itemHeight
      lastNodeY = currentY

      if (hasChildren && node.expanded !== false) {
        currentY = this.renderTreeNodes(
          node.children, children, currentY, depth + 1,
          itemHeight, indentSize, showIcon, showExpandIcon, expandIconPosition,
          nodeStyle, labelStyle, iconStyle, expandIconStyle, lineStyle,
          hoverStyle, selectedStyle, disabledStyle
        )
        lastNodeY = currentY
      }
    }

    if (lineStyle.show && depth > 0) {
      const parentIndent = (depth - 1) * indentSize
      const lineX = parentIndent + indentSize / 2
      const lineStartY = startY
      const lineEndY = lastNodeY - itemHeight / 2
      const lineHeight = lineEndY - lineStartY

      if (lineHeight > 0) {
        const verticalLine: RectangleElement = {
          type: 'rectangle',
          name: `__tree-line-v__level-${depth}`,
          position: { x: lineX - (lineStyle.width || 1) / 2, y: lineStartY },
          size: { width: lineStyle.width || 1, height: lineHeight },
          fills: [{ type: 'solid', color: lineStyle.color || '#e5e7eb' }]
        }
        children.push(verticalLine)
      }
    }

    return currentY
  }

  private static createExpandIcon(expanded: boolean, style: any): BaseElement[] {
    const size = style.size || 12
    const color = style.color || '#9ca3af'

    const triangle: PolygonElement = {
      type: 'polygon',
      name: '__tree-expand-icon-triangle__',
      position: { x: 0, y: 0 },
      size: { width: size, height: size },
      pointCount: 3,
      cornerRadius: 1,
      fills: [{ type: 'solid', color: color }],
      rotation: expanded ? 180 : 90
    }

    return [triangle]
  }

  // ==================== 列表 ====================

  private static renderListTemplate(config: any, data?: any[]): BaseElement[] {
    const {
      items = 10,
      itemSpacing = 1,
      showDivider = true,
      dividerColor = '#e5e7eb',
      rowStyle = {}
    } = config

    const elements: BaseElement[] = []
    const listData = data || Array.from({ length: items }, (_, i) => ({ label: `项目 ${i + 1}`, description: `描述 ${i + 1}` }))

    const container: FrameElement = {
      type: 'frame',
      name: '列表容器',
      position: { x: 0, y: 0 },
      layoutMode: 'VERTICAL',
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'AUTO',
      itemSpacing: itemSpacing,
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      clipsContent: true,
      fills: [{ type: 'solid', color: '#ffffff' }],
      children: []
    }

    for (let i = 0; i < listData.length; i++) {
      const item = listData[i]
      const isEven = i % 2 === 0

      const rowFrame: FrameElement = {
        type: 'frame',
        name: `列表项-${i + 1}`,
        size: { width: 400 },
        layoutMode: 'HORIZONTAL',
        primaryAxisSizingMode: 'AUTO',
        counterAxisSizingMode: 'FIXED',
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'CENTER',
        paddingLeft: 16,
        paddingRight: 16,
        fills: isEven
          ? (rowStyle.fills || [{ type: 'solid', color: '#ffffff' }])
          : (rowStyle.alternatingFills || [{ type: 'solid', color: '#f9fafb' }]),
        children: [
          {
            type: 'text',
            name: `列表标签-${i + 1}`,
            content: item.label || `项目 ${i + 1}`,
            fontSize: 14,
            fontWeight: 500,
            fills: [{ type: 'solid', color: '#1f2937' }],
            textAlignHorizontal: 'LEFT',
            textAutoResize: 'WIDTH_AND_HEIGHT'
          } as TextElement,
          {
            type: 'text',
            name: `列表描述-${i + 1}`,
            content: item.description || '',
            fontSize: 12,
            fontWeight: 400,
            fills: [{ type: 'solid', color: '#9ca3af' }],
            textAlignHorizontal: 'RIGHT',
            flexGrow: 1,
            textAutoResize: 'WIDTH_AND_HEIGHT'
          } as TextElement
        ]
      }

      container.children!.push(rowFrame)

      if (showDivider && i < listData.length - 1) {
        const divider: RectangleElement = {
          type: 'rectangle',
          name: `分割线-${i + 1}`,
          position: { x: 0, y: 0 },
          size: { width: 400, height: 1 },
          fills: [{ type: 'solid', color: dividerColor }]
        }
        container.children!.push(divider as any)
      }
    }

    elements.push(container)
    return elements
  }

  // ==================== 网格 ====================

  private static renderGridTemplate(config: any, data?: any[]): BaseElement[] {
    const {
      columns = 3,
      itemWidth = 200,
      itemHeight = 200,
      gap = 16,
      itemStyle = {},
      showShadow = true
    } = config

    const elements: BaseElement[] = []
    const gridData = data || Array.from({ length: 6 }, (_, i) => ({ title: `卡片 ${i + 1}`, content: `卡片内容 ${i + 1}` }))
    const rows = Math.ceil(gridData.length / columns)

    const container: FrameElement = {
      type: 'frame',
      name: '网格容器',
      position: { x: 0, y: 0 },
      layoutMode: 'VERTICAL',
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'AUTO',
      itemSpacing: gap,
      clipsContent: true,
      fills: [],
      children: []
    }

    for (let row = 0; row < rows; row++) {
      const rowFrame: FrameElement = {
        type: 'frame',
        name: `网格行-${row + 1}`,
        layoutMode: 'HORIZONTAL',
        primaryAxisSizingMode: 'AUTO',
        counterAxisSizingMode: 'AUTO',
        itemSpacing: gap,
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'MIN',
        fills: [],
        children: []
      }

      for (let col = 0; col < columns; col++) {
        const idx = row * columns + col
        if (idx >= gridData.length) break
        const item = gridData[idx]

        const card: FrameElement = {
          type: 'frame',
          name: `卡片-${idx + 1}`,
          size: { width: itemWidth, height: itemHeight },
          layoutMode: 'VERTICAL',
          primaryAxisSizingMode: 'FIXED',
          counterAxisSizingMode: 'FIXED',
          primaryAxisAlignItems: 'CENTER',
          counterAxisAlignItems: 'CENTER',
          itemSpacing: 8,
          paddingTop: 16,
          paddingBottom: 16,
          paddingLeft: 16,
          paddingRight: 16,
          cornerRadius: itemStyle.cornerRadius || 8,
          fills: itemStyle.fills || [{ type: 'solid', color: '#ffffff' }],
          effects: showShadow
            ? [{ type: 'DROP_SHADOW', color: '#0000000d', offset: { x: 0, y: 2 }, radius: 8, visible: true }]
            : undefined,
          children: [
            {
              type: 'text',
              name: `卡片标题-${idx + 1}`,
              content: item.title || `卡片 ${idx + 1}`,
              fontSize: 16,
              fontWeight: 600,
              fills: [{ type: 'solid', color: '#1f2937' }],
              textAlignHorizontal: 'CENTER',
              textAutoResize: 'WIDTH_AND_HEIGHT'
            } as TextElement,
            {
              type: 'text',
              name: `卡片内容-${idx + 1}`,
              content: item.content || '',
              fontSize: 13,
              fontWeight: 400,
              fills: [{ type: 'solid', color: '#6b7280' }],
              textAlignHorizontal: 'CENTER',
              textAutoResize: 'WIDTH_AND_HEIGHT'
            } as TextElement
          ]
        }

        rowFrame.children!.push(card)
      }

      container.children!.push(rowFrame)
    }

    elements.push(container)
    return elements
  }

  // ==================== 表单 ====================

  private static renderFormTemplate(config: any, data?: any[]): BaseElement[] {
    const {
      fields = [],
      labelWidth = 80,
      fieldHeight = 32,
      itemSpacing = 16
    } = config

    const elements: BaseElement[] = []

    const container: FrameElement = {
      type: 'frame',
      name: '表单容器',
      position: { x: 0, y: 0 },
      layoutMode: 'VERTICAL',
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'AUTO',
      itemSpacing: itemSpacing,
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      clipsContent: true,
      fills: [{ type: 'solid', color: '#ffffff' }],
      children: []
    }

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]
      const fieldWidth = field.width || 400

      const rowFrame: FrameElement = {
        type: 'frame',
        name: `表单行-${i + 1}`,
        size: { width: fieldWidth },
        layoutMode: 'HORIZONTAL',
        primaryAxisSizingMode: 'FIXED',
        counterAxisSizingMode: 'AUTO',
        itemSpacing: 8,
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'CENTER',
        fills: [],
        children: [
          {
            type: 'text',
            name: `标签-${i + 1}`,
            content: field.label || `字段 ${i + 1}`,
            fontSize: 14,
            fontWeight: 500,
            fills: [{ type: 'solid', color: '#374151' }],
            textAlignHorizontal: 'RIGHT',
            textAutoResize: 'WIDTH_AND_HEIGHT'
          } as TextElement,
          {
            type: 'frame',
            name: `输入框-${i + 1}`,
            size: { width: fieldWidth - labelWidth - 8, height: fieldHeight },
            cornerRadius: 4,
            fills: [{ type: 'solid', color: '#ffffff' }],
            strokes: [{ type: 'solid', color: '#d1d5db' }],
            strokeWidth: 1,
            children: [
              {
                type: 'text',
                name: `占位文字-${i + 1}`,
                content: field.placeholder || '',
                fontSize: 14,
                fontWeight: 400,
                fills: [{ type: 'solid', color: '#9ca3af' }],
                position: { x: 8, y: fieldHeight / 2 - 10 },
                textAutoResize: 'WIDTH_AND_HEIGHT'
              } as TextElement
            ]
          } as FrameElement
        ]
      }

      container.children!.push(rowFrame)
    }

    elements.push(container)
    return elements
  }

  // ==================== 分页 ====================

  private static renderPaginationTemplate(config: any, data?: any[]): BaseElement[] {
    const {
      currentPage = 1,
      totalPages = 10,
      itemWidth = 32,
      itemHeight = 32,
      spacing = 4,
      activeColor = '#4340EA',
      normalColor = '#ffffff',
      textColor = '#374151',
      activeTextColor = '#ffffff'
    } = config

    const elements: BaseElement[] = []

    const container: FrameElement = {
      type: 'frame',
      name: '分页容器',
      position: { x: 0, y: 0 },
      layoutMode: 'HORIZONTAL',
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'AUTO',
      itemSpacing: spacing,
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
      fills: [],
      children: []
    }

    const renderPageItem = (pageNum: number, isCurrent: boolean): FrameElement => {
      return {
        type: 'frame',
        name: `页码-${pageNum}`,
        size: { width: itemWidth, height: itemHeight },
        cornerRadius: 4,
        layoutMode: 'HORIZONTAL',
        primaryAxisSizingMode: 'FIXED',
        counterAxisSizingMode: 'FIXED',
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'CENTER',
        fills: isCurrent
          ? [{ type: 'solid', color: activeColor }]
          : [{ type: 'solid', color: normalColor }],
        children: [
          {
            type: 'text',
            name: `页码文字-${pageNum}`,
            content: String(pageNum),
            fontSize: 13,
            fontWeight: isCurrent ? 600 : 400,
            fills: isCurrent
              ? [{ type: 'solid', color: activeTextColor }]
              : [{ type: 'solid', color: textColor }],
            textAlignHorizontal: 'CENTER',
            textAlignVertical: 'CENTER',
            textAutoResize: 'WIDTH_AND_HEIGHT'
          } as TextElement
        ]
      }
    }

    const prevBtn: FrameElement = {
      type: 'frame',
      name: '上一页',
      size: { width: itemWidth, height: itemHeight },
      cornerRadius: 4,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
      fills: [{ type: 'solid', color: '#ffffff' }],
      strokes: [{ type: 'solid', color: '#d1d5db' }],
      strokeWidth: 1,
      children: [
        {
          type: 'text',
          name: '上一页文字',
          content: '‹',
          fontSize: 16,
          fills: [{ type: 'solid', color: '#374151' }],
          textAlignHorizontal: 'CENTER',
          textAutoResize: 'WIDTH_AND_HEIGHT'
        } as TextElement
      ]
    }
    container.children!.push(prevBtn)

    const startPage = Math.max(1, currentPage - 2)
    const endPage = Math.min(totalPages, startPage + 4)

    for (let p = startPage; p <= endPage; p++) {
      container.children!.push(renderPageItem(p, p === currentPage))
    }

    const nextBtn: FrameElement = {
      type: 'frame',
      name: '下一页',
      size: { width: itemWidth, height: itemHeight },
      cornerRadius: 4,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
      fills: [{ type: 'solid', color: '#ffffff' }],
      strokes: [{ type: 'solid', color: '#d1d5db' }],
      strokeWidth: 1,
      children: [
        {
          type: 'text',
          name: '下一页文字',
          content: '›',
          fontSize: 16,
          fills: [{ type: 'solid', color: '#374151' }],
          textAlignHorizontal: 'CENTER',
          textAutoResize: 'WIDTH_AND_HEIGHT'
        } as TextElement
      ]
    }
    container.children!.push(nextBtn)

    elements.push(container)
    return elements
  }

  // ==================== 轮播 ====================

  private static renderCarouselTemplate(config: any, data?: any[]): BaseElement[] {
    const {
      itemCount = 3,
      itemWidth = 300,
      itemHeight = 200,
      gap = 16,
      showDots = true,
      dotColor = '#d1d5db',
      dotActiveColor = '#4340EA'
    } = config

    const elements: BaseElement[] = []
    const carouselData = data || Array.from({ length: itemCount }, (_, i) => ({ title: `幻灯 ${i + 1}`, color: i % 2 === 0 ? '#4340EA' : '#f3f4f6' }))

    const container: FrameElement = {
      type: 'frame',
      name: '轮播容器',
      position: { x: 0, y: 0 },
      layoutMode: 'VERTICAL',
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'AUTO',
      itemSpacing: 16,
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
      clipsContent: true,
      fills: [],
      children: []
    }

    const slidesFrame: FrameElement = {
      type: 'frame',
      name: '幻灯片容器',
      layoutMode: 'HORIZONTAL',
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'AUTO',
      itemSpacing: gap,
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      fills: [],
      children: []
    }

    for (let i = 0; i < carouselData.length; i++) {
      const item = carouselData[i]
      const isDark = item.color === '#4340EA'

      const slide: FrameElement = {
        type: 'frame',
        name: `幻灯-${i + 1}`,
        size: { width: itemWidth, height: itemHeight },
        cornerRadius: 8,
        layoutMode: 'VERTICAL',
        primaryAxisSizingMode: 'FIXED',
        counterAxisSizingMode: 'FIXED',
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'CENTER',
        fills: [{ type: 'solid', color: item.color }],
        children: [
          {
            type: 'text',
            name: `幻灯标题-${i + 1}`,
            content: item.title || `幻灯 ${i + 1}`,
            fontSize: 24,
            fontWeight: 600,
            fills: isDark
              ? [{ type: 'solid', color: '#ffffff' }]
              : [{ type: 'solid', color: '#1f2937' }],
            textAlignHorizontal: 'CENTER',
            textAutoResize: 'WIDTH_AND_HEIGHT'
          } as TextElement
        ]
      }

      slidesFrame.children!.push(slide)
    }

    container.children!.push(slidesFrame)

    if (showDots) {
      const dotsFrame: FrameElement = {
        type: 'frame',
        name: '指示点容器',
        layoutMode: 'HORIZONTAL',
        primaryAxisSizingMode: 'AUTO',
        counterAxisSizingMode: 'AUTO',
        itemSpacing: 8,
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'CENTER',
        fills: [],
        children: []
      }

      for (let i = 0; i < carouselData.length; i++) {
        const dot: RectangleElement = {
          type: 'rectangle',
          name: `指示点-${i + 1}`,
          size: { width: i === 0 ? 24 : 8, height: 8 },
          cornerRadius: 4,
          fills: i === 0
            ? [{ type: 'solid', color: dotActiveColor }]
            : [{ type: 'solid', color: dotColor }]
        }
        dotsFrame.children!.push(dot as any)
      }

      container.children!.push(dotsFrame)
    }

    elements.push(container)
    return elements
  }
}
