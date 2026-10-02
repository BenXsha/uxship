import {
  BaseElement,
  Fill,
  Stroke,
  Effect,
  Constraints,
  DSLDocument
} from './dsl-types'
import { rgbToHex } from '../utils/color-utils'
import { serializeEffects } from './visual-utils'

export class DSLExporter {
  static exportSelection(): DSLDocument {
    const selection = mg.document.currentPage.selection

    if (!selection || selection.length === 0) {
      throw new Error('没有选中任何节点')
    }

    const elements: BaseElement[] = []

    for (let i = 0; i < selection.length; i++) {
      const node = selection[i]
      const element = this.convertNodeToElement(node)
      if (element) {
        elements.push(element)
      }
    }

    return {
      version: '2.0',
      elements: elements
    }
  }

  static exportNode(nodeId: string): DSLDocument {
    const node = mg.getNodeById(nodeId)
    if (!node) {
      throw new Error(`节点 ${nodeId} 不存在`)
    }

    const element = this.convertNodeToElement(node)
    if (!element) {
      throw new Error(`节点 ${nodeId} 转换失败`)
    }

    return {
      version: '2.0',
      elements: [element]
    }
  }

  private static convertNodeToElement(node: any): BaseElement | null {
    if (!node) {
      return null
    }

    const nodeType = node.type
    if (nodeType === 'INSTANCE') {
      return this.convertInstanceNode(node)
    }

    const nodeTypeFallback = node.constructor?.name || ''
    if (nodeTypeFallback === 'INSTANCE' || nodeTypeFallback === 'Instance' || 
        node.mainComponent || node.masterComponent || node.componentId ||
        node.isInstance || node.isComponentInstance) {
      return this.convertInstanceNode(node)
    }

    if (!nodeType) {
      return null
    }

    const baseElement: any = {
      type: node.type.toLowerCase(),
      name: node.name || '未命名',
      id: node.id
    }

    // 通用属性 - 全部导出
    if (node.isVisible !== undefined) {
      baseElement.isVisible = node.isVisible
    }
    if (node.isLocked !== undefined) {
      baseElement.isLocked = node.isLocked
    }
    if (node.removed !== undefined) {
      baseElement.removed = node.removed
    }
    if (node.expanded !== undefined) {
      baseElement.expanded = node.expanded
    }

    if (node.x !== undefined && node.y !== undefined) {
      baseElement.position = { x: node.x, y: node.y }
    }
    if (node.width !== undefined && node.height !== undefined) {
      baseElement.size = { width: node.width, height: node.height }
    }

    if (node.rotation !== undefined) {
      baseElement.rotation = node.rotation
    }

    if (node.fills && node.fills.length > 0) {
      baseElement.fills = this.convertFills(node.fills)
    }

    if (node.strokes && node.strokes.length > 0) {
      baseElement.strokes = this.convertStrokes(node.strokes)
      if (node.strokeWeight !== undefined) {
        baseElement.strokeWidth = node.strokeWeight
      }
      if ('strokeTopWeight' in node) {
        baseElement.strokeTopWeight = node.strokeTopWeight
      }
      if ('strokeBottomWeight' in node) {
        baseElement.strokeBottomWeight = node.strokeBottomWeight
      }
      if ('strokeLeftWeight' in node) {
        baseElement.strokeLeftWeight = node.strokeLeftWeight
      }
      if ('strokeRightWeight' in node) {
        baseElement.strokeRightWeight = node.strokeRightWeight
      }
      if (node.strokeAlign !== undefined) {
        baseElement.strokeAlign = node.strokeAlign
      }
    }

    if (node.effects && node.effects.length > 0) {
      baseElement.effects = this.convertEffects(node.effects)
    }

    if (node.opacity !== undefined) {
      baseElement.opacity = node.opacity
    }
    if (node.blendMode) {
      baseElement.blendMode = node.blendMode
    }

    if (node.constraints) {
      baseElement.constraints = this.convertConstraints(node.constraints)
    }

    // 导出组件描述信息
    if (node.description !== undefined) {
      baseElement.description = node.description
    }
    if (node.alias !== undefined) {
      baseElement.alias = node.alias
    }

    // 导出图表配置元数据（由 dsl-renderer 通过 setPluginData 存储）
    const chartOption = node.getPluginData?.('chartOption')
    if (chartOption) {
      baseElement.chartOption = chartOption
    }

    switch (node.type) {
      case 'RECTANGLE':
        const rectElement = baseElement as any
        if (node.cornerRadius !== undefined) {
          rectElement.cornerRadius = node.cornerRadius
        }
        return rectElement

      case 'TEXT':
        const textElement = baseElement as any
        textElement.content = node.characters || ''
        
        this.extractFontProperties(node, textElement)

        // 额外导出 fontWeight
        if (node.fontWeight !== undefined) {
          textElement.fontWeight = node.fontWeight
        }
        
        if (node.textAlignHorizontal) {
          textElement.textAlignHorizontal = node.textAlignHorizontal
        }
        if (node.textAlignVertical) {
          textElement.textAlignVertical = node.textAlignVertical
        }
        if (node.textAutoResize) {
          textElement.textAutoResize = node.textAutoResize
        }
        if (node.paragraphSpacing !== undefined) {
          textElement.paragraphSpacing = node.paragraphSpacing
        }
        return textElement

      case 'ELLIPSE':
        return baseElement

      case 'POLYGON':
        const polygonElement = baseElement as any
        if (node.pointCount !== undefined) {
          polygonElement.pointCount = node.pointCount
        }
        if (node.cornerRadius !== undefined) {
          polygonElement.cornerRadius = node.cornerRadius
        }
        return polygonElement

      case 'STAR':
        const starElement = baseElement as any
        if (node.pointCount !== undefined) {
          starElement.pointCount = node.pointCount
        }
        if (node.innerRadius !== undefined) {
          starElement.innerRadius = node.innerRadius
        }
        return starElement

      case 'LINE':
        const lineElement = baseElement as any
        if (node.strokeCap) {
          lineElement.strokeCap = this.convertStrokeCap(node.strokeCap)
        }
        if (node.strokeJoin) {
          lineElement.strokeJoin = node.strokeJoin
        }
        return lineElement

      case 'CONNECTOR':
        const connectorElement = baseElement as any
        if (node.connectorStart) {
          const s = node.connectorStart
          connectorElement.connectorStart = {
            endpointNodeId: s.endpointNodeId ? s.endpointNodeId.id : undefined,
            magnet: s.magnet || 'AUTO',
            x: s.x,
            y: s.y,
          }
        }
        if (node.connectorEnd) {
          const e = node.connectorEnd
          connectorElement.connectorEnd = {
            endpointNodeId: e.endpointNodeId ? e.endpointNodeId.id : undefined,
            magnet: e.magnet || 'AUTO',
            x: e.x,
            y: e.y,
          }
        }
        if (node.connectorLineType) connectorElement.connectorLineType = node.connectorLineType
        if (node.connectorStartStrokeCap) connectorElement.connectorStartStrokeCap = node.connectorStartStrokeCap
        if (node.connectorEndStrokeCap) connectorElement.connectorEndStrokeCap = node.connectorEndStrokeCap
        if (node.strokeCap) {
          connectorElement.strokeCap = this.convertStrokeCap(node.strokeCap)
        }
        if (node.strokeJoin) {
          connectorElement.strokeJoin = node.strokeJoin
        }
        return connectorElement

      case 'PEN':
      case 'VECTOR':
        const penElement = baseElement as any
        if (node.penPaths) {
          // PenPaths getter 返回 { windingRule: string, data: string }
          penElement.svgPathData = node.penPaths.data
        }
        if (node.strokeCap) {
          penElement.strokeCap = this.convertStrokeCap(node.strokeCap)
        }
        if (node.strokeJoin) {
          penElement.strokeJoin = node.strokeJoin
        }
        if (node.isClosed !== undefined) {
          penElement.isClosed = node.isClosed
        }
        return penElement

      case 'BOOLEAN_OPERATION':
        const booleanElement = baseElement as any
        if (node.booleanOperation) {
          booleanElement.booleanOperation = node.booleanOperation
        }
        if (node.children && node.children.length > 0) {
          const parentX = baseElement.position?.x ?? 0
          const parentY = baseElement.position?.y ?? 0
          booleanElement.children = this.convertChildren(node.children, 'BOOLEAN_OPERATION', parentX, parentY)
        }
        return booleanElement

      case 'GROUP':
        const groupElement = baseElement as any
        if (node.children && node.children.length > 0) {
          const parentX = baseElement.position?.x ?? 0
          const parentY = baseElement.position?.y ?? 0
          groupElement.children = this.convertChildren(node.children, 'GROUP', parentX, parentY)
        }
        return groupElement

      case 'FRAME':
      case 'COMPONENT':
      case 'SECTION':
        const containerElement = baseElement as any
        if (node.cornerRadius !== undefined) {
          containerElement.cornerRadius = node.cornerRadius
        }
        if (node.children && node.children.length > 0) {
          containerElement.children = this.convertChildren(node.children, node.type)
        }
        
        // 自动布局属性
        containerElement.layoutMode = this.convertLayoutMode(node.flexMode)
        containerElement.itemSpacing = node.itemSpacing
        containerElement.paddingTop = node.paddingTop
        containerElement.paddingBottom = node.paddingBottom
        containerElement.paddingLeft = node.paddingLeft
        containerElement.paddingRight = node.paddingRight
        containerElement.clipsContent = node.clipsContent
        containerElement.primaryAxisAlignItems = this.convertMainAxisAlignItems(node.mainAxisAlignItems)
        containerElement.counterAxisAlignItems = this.convertCrossAxisAlignItems(node.crossAxisAlignItems)
        
        // 新增：更多自动布局属性
        containerElement.flexWrap = node.flexWrap
        containerElement.crossAxisSpacing = node.crossAxisSpacing
        containerElement.primaryAxisAlignContent = node.primaryAxisAlignContent
        containerElement.counterAxisAlignContent = node.counterAxisAlignContent
        containerElement.primaryAxisSizingMode = node.primaryAxisSizingMode
        containerElement.counterAxisSizingMode = node.counterAxisSizingMode
        
        return containerElement

      case 'SLICE':
        const sliceElement = baseElement as any
        if (node.associatedChildren && node.associatedChildren.length > 0) {
          sliceElement.associatedChildren = node.associatedChildren.map((c: any) => c.id)
        }
        return sliceElement

      case 'SYMBOL':
        const symbolElement = baseElement as any
        if (node.variantProperties !== undefined) {
          symbolElement.variantProperties = node.variantProperties
        }
        if (node.children && node.children.length > 0) {
          symbolElement.children = this.convertChildren(node.children, 'SYMBOL')
        }
        return symbolElement

      case 'CANVAS':
        const canvasElement = baseElement as any
        if (node.backgroundColor !== undefined) {
          canvasElement.backgroundColor = rgbToHex(node.backgroundColor)
        }
        if (node.children && node.children.length > 0) {
          canvasElement.children = this.convertChildren(node.children, 'CANVAS')
        }
        return canvasElement

      default:
        // 尝试导出 children 以防遗漏
        if (node.children && node.children.length > 0) {
          baseElement.children = this.convertChildren(node.children, node.type)
        }
        return baseElement
    }
  }

  private static convertChildren(children: any[], parentType: string, parentX: number = 0, parentY: number = 0): BaseElement[] {
    return children
      .map(child => {
        const element = this.convertNodeToElement(child)
        if (element) {
          if (parentType === 'GROUP' || parentType === 'BOOLEAN_OPERATION') {
            if (element.position) {
              element.position.x -= parentX
              element.position.y -= parentY
            }
          }
        }
        return element
      })
      .filter((element): element is BaseElement => element !== null)
  }

  private static convertFills(fills: any[]): Fill[] {
    return fills.map(fill => {
      const converted: any = {
        type: fill.type?.toLowerCase() || 'solid'
      }

      if (fill.type === 'SOLID' && fill.color) {
        converted.color = rgbToHex(fill.color)
      }
      else if ((fill.type === 'GRADIENT_LINEAR' || fill.type === 'GRADIENT_RADIAL' || fill.type === 'GRADIENT_ANGULAR' || fill.type === 'GRADIENT_DIAMOND') && fill.gradientStops) {
        converted.gradientStops = fill.gradientStops.map((stop: any) => ({
          position: stop.position,
          color: rgbToHex(stop.color)
        }))
        if (fill.gradientHandlePositions) {
          converted.gradientHandlePositions = fill.gradientHandlePositions
        }
        if (fill.transform) {
          converted.transform = fill.transform
        }
      }
      else if (fill.type === 'IMAGE' && (fill.imageHash || fill.imageRef)) {
        converted.imageUrl = fill.imageHash || fill.imageRef
        converted.imageScaleMode = fill.scaleMode || 'FILL'
      }

      if (fill.isVisible !== undefined) {
        converted.isVisible = fill.isVisible
      }
      if (fill.alpha !== undefined) {
        converted.alpha = fill.alpha
      }
      if (fill.blendMode) {
        converted.blendMode = fill.blendMode
      }

      return converted
    })
  }

  private static convertStrokes(strokes: any[]): Stroke[] {
    return strokes.map(stroke => {
      const converted: any = {
        type: stroke.type?.toLowerCase() || 'solid'
      }

      if (stroke.type === 'SOLID' && stroke.color) {
        converted.color = rgbToHex(stroke.color)
      }
      else if ((stroke.type === 'GRADIENT_LINEAR' || stroke.type === 'GRADIENT_RADIAL' || stroke.type === 'GRADIENT_ANGULAR' || stroke.type === 'GRADIENT_DIAMOND') && stroke.gradientStops) {
        converted.gradientStops = stroke.gradientStops.map((stop: any) => ({
          position: stop.position,
          color: rgbToHex(stop.color)
        }))
        if (stroke.gradientHandlePositions) {
          converted.gradientHandlePositions = stroke.gradientHandlePositions
        }
        if (stroke.transform) {
          converted.transform = stroke.transform
        }
      }
      else if (stroke.type === 'IMAGE' && (stroke.imageHash || stroke.imageRef)) {
        converted.imageUrl = stroke.imageHash || stroke.imageRef
        converted.imageScaleMode = stroke.scaleMode || 'FILL'
      }

      if (stroke.isVisible !== undefined) {
        converted.isVisible = stroke.isVisible
      }
      if (stroke.alpha !== undefined) {
        converted.alpha = stroke.alpha
      }
      if (stroke.blendMode) {
        converted.blendMode = stroke.blendMode
      }

      return converted
    })
  }

  /**
   * 运行时 Effect[] → DSL Effect[]
   *
   * 字段提取统一走 `visual-utils.serializeEffects()`，避免与 serializer / design_describe
   * 各自维护一套（历史上三处不一致，导致 effects 在某些回读路径丢失）。
   * 注意 DSL 里 effects 的可见性字段叫 `visible`（paints 用 `isVisible`，历史约定）。
   */
  private static convertEffects(effects: any[]): Effect[] {
    return serializeEffects(effects).map((effect) => {
      const converted: any = {
        type: effect.type,
        visible: effect.isVisible,
      }

      if (effect.radius !== undefined) converted.radius = effect.radius
      if (effect.color) converted.color = rgbToHex(effect.color)
      if (effect.offset) converted.offset = effect.offset
      if (effect.spread !== undefined) converted.spread = effect.spread
      if (effect.blendMode) converted.blendMode = effect.blendMode
      if (effect.showShadowBehindNode !== undefined) {
        converted.showShadowBehindNode = effect.showShadowBehindNode
      }
      if (effect.isEffectShow !== undefined) converted.isEffectShow = effect.isEffectShow
      if (effect.name !== undefined) converted.name = effect.name

      return converted
    })
  }

  private static convertConstraints(constraints: any): Constraints {
    const horizontal = this.convertConstraintType(constraints.horizontal, 'horizontal')
    const vertical = this.convertConstraintType(constraints.vertical, 'vertical')
    return { horizontal, vertical }
  }

  private static convertConstraintType(type: string, direction: 'horizontal' | 'vertical'): any {
    if (direction === 'horizontal') {
      const mapping: Record<string, string> = {
        'START': 'LEFT',
        'END': 'RIGHT',
        'STARTANDEND': 'LEFT_RIGHT',
        'SCALE': 'SCALE',
        'CENTER': 'CENTER'
      }
      return mapping[type] || type
    } else {
      const mapping: Record<string, string> = {
        'START': 'TOP',
        'END': 'BOTTOM',
        'STARTANDEND': 'TOP_BOTTOM',
        'SCALE': 'SCALE',
        'CENTER': 'CENTER'
      }
      return mapping[type] || type
    }
  }

  private static convertStrokeCap(strokeCap: string): any {
    const mapping: Record<string, string> = {
      'NONE': 'NONE',
      'ROUND': 'ROUND',
      'SQUARE': 'SQUARE',
      'LINE_ARROW': 'STROKE',
      'TRIANGLE_ARROW': 'STROKE',
      'ROUND_ARROW': 'STROKE',
      'RING': 'STROKE',
      'DIAMOND': 'STROKE',
      'LINE': 'STROKE'
    }
    return mapping[strokeCap] || strokeCap
  }

  private static convertLayoutMode(flexMode: string): any {
    const mapping: Record<string, string> = {
      'NONE': 'NONE',
      'VERTICAL': 'VERTICAL',
      'HORIZONTAL': 'HORIZONTAL'
    }
    return mapping[flexMode] || flexMode
  }

  private static convertMainAxisAlignItems(alignItems: string): any {
    const mapping: Record<string, string> = {
      'FLEX_START': 'MIN',
      'CENTER': 'CENTER',
      'FLEX_END': 'MAX',
      'SPACING_BETWEEN': 'SPACE_BETWEEN'
    }
    return mapping[alignItems] || alignItems
  }

  private static convertCrossAxisAlignItems(alignItems: string): any {
    const mapping: Record<string, string> = {
      'FLEX_START': 'MIN',
      'CENTER': 'CENTER',
      'FLEX_END': 'MAX'
    }
    return mapping[alignItems] || alignItems
  }

  private static extractFontProperties(node: any, textElement: any): void {
    try {
      if (node.textStyles && node.textStyles.length > 0) {
        const firstStyle = node.textStyles[0]
        if (firstStyle && firstStyle.textStyle) {
          if (firstStyle.textStyle.fontSize !== undefined) {
            textElement.fontSize = firstStyle.textStyle.fontSize
          }
          if (firstStyle.textStyle.fontName) {
            textElement.fontName = firstStyle.textStyle.fontName
          }
          if (firstStyle.textStyle.lineHeight) {
            textElement.lineHeight = firstStyle.textStyle.lineHeight
          }
          if (firstStyle.textStyle.letterSpacing !== undefined) {
            textElement.letterSpacing = firstStyle.textStyle.letterSpacing
          }
          return
        }
      }
      
      if (node.getRangeStyle) {
        const style = node.getRangeStyle(0, node.characters?.length || 0)
        if (style) {
          if (style.fontSize !== undefined) {
            textElement.fontSize = style.fontSize
          }
          if (style.fontName) {
            textElement.fontName = style.fontName
          }
          if (style.lineHeight) {
            textElement.lineHeight = style.lineHeight
          }
          if (style.letterSpacing !== undefined) {
            textElement.letterSpacing = style.letterSpacing
          }
          return
        }
      }
      
      if (node.fontSize !== undefined) {
        textElement.fontSize = node.fontSize
      }
      if (node.fontName) {
        textElement.fontName = node.fontName
      }
      if (node.lineHeight) {
        textElement.lineHeight = node.lineHeight
      }
      if (node.letterSpacing !== undefined) {
        textElement.letterSpacing = node.letterSpacing
      }
    } catch (error) {
      console.warn('获取字体信息失败:', error)
    }
  }

  /**
   * 实例母版信息（可信）：`id` 为母版组件 id，`isLocalMaster` 仅在宿主给出可靠
   * 远程标记时才有值（拿不到就 `undefined`，由调用方省略字段，不做猜测）。
   */
  private static resolveInstanceMaster(node: any): { id: string; name?: string; isLocalMaster?: boolean } | null {
    // 宿主 typings（@mastergo/plugin-typings 2.19.2 `InstanceNode`）里母版是：
    //   `mainComponent: ComponentNode | null`
    // 即**对象**而非 id；`ComponentNode` 实现 `PublishableMixin`，其中
    //   `readonly isExternal: boolean` —— “是否为团队库组件/样式”（true=外部库）。
    // 旧版本 / 旧模型（`MGInstanceNode.mainComponent?: LayerId`）可能只给 id 字符串，
    // 另有历史字段 `masterComponent` / `componentId`，这里一并兼容。
    const candidates: any[] = [node.mainComponent, node.masterComponent, node.componentId]

    for (const raw of candidates) {
      if (!raw) continue

      // 形态 1：宿主对象（ComponentNode）—— 最可信，优先取用
      if (typeof raw === 'object') {
        const id = typeof raw.id === 'string' && raw.id ? raw.id : null
        if (!id) continue
        return {
          id,
          name: typeof raw.name === 'string' ? raw.name : undefined,
          isLocalMaster: typeof raw.isExternal === 'boolean' ? !raw.isExternal : undefined,
        }
      }

      // 形态 2：id 字符串（LayerId）—— 尽量回读组件补齐名称与本地/外部标记
      if (typeof raw === 'string') {
        return this.describeMasterById(raw)
      }
    }

    return null
  }

  /** 仅拿到母版 id 时，尽力通过宿主回读组件以补齐名称与 `isLocalMaster` */
  private static describeMasterById(id: string): { id: string; name?: string; isLocalMaster?: boolean } {
    const master: { id: string; name?: string; isLocalMaster?: boolean } = { id }
    try {
      const comp =
        typeof mg !== 'undefined' && typeof (mg as any).getNodeById === 'function'
          ? ((mg as any).getNodeById(id) as any)
          : null
      if (comp) {
        if (typeof comp.name === 'string') master.name = comp.name
        if (typeof comp.isExternal === 'boolean') master.isLocalMaster = !comp.isExternal
      }
    } catch (e) {
      console.warn('回读母版组件失败:', e)
    }
    return master
  }

  private static convertInstanceNode(node: any): BaseElement | null {
    const master = this.resolveInstanceMaster(node)

    if (master) {
      try {
        const componentDef = mg.getNodeById(master.id) as any
        if (componentDef && componentDef.children && componentDef.children.length > 0) {
          return this.buildInstanceElement(node, componentDef, master)
        }
      } catch (e) {
        console.warn('通过 mainComponent 获取组件定义失败:', e)
      }
    }

    // 旧字段兜底：instanceId 指向的组件（与母版同源或等价）
    if (node.instanceId && node.instanceId !== master?.id) {
      try {
        const componentDef = mg.getNodeById(node.instanceId) as any
        if (componentDef && componentDef.children && componentDef.children.length > 0) {
          return this.buildInstanceElement(node, componentDef, this.describeMasterById(node.instanceId))
        }
      } catch (e) {
        console.warn('通过 instanceId 获取组件定义失败:', e)
      }
    }

    if (node.children && node.children.length > 0) {
      // 母版已脱离文档 / 定义读不到：仍导出实例子节点，但**不伪造** componentId
      return this.buildInstanceElement(node, { children: node.children }, master)
    }

    return this.buildFallbackFrameElement(node)
  }

  private static buildInstanceElement(
    node: any,
    componentDef: any,
    master: { id: string; name?: string; isLocalMaster?: boolean } | null
  ): BaseElement {
    const instanceElement: any = {
      type: 'frame',
      name: node.name || 'Instance',
      id: node.id
    }
    
    // 通用属性
    if (node.isVisible !== undefined) {
      instanceElement.isVisible = node.isVisible
    }
    if (node.isLocked !== undefined) {
      instanceElement.isLocked = node.isLocked
    }
    if (node.removed !== undefined) {
      instanceElement.removed = node.removed
    }
    
    if (node.x !== undefined && node.y !== undefined) {
      instanceElement.position = { x: node.x, y: node.y }
    }
    if (node.width !== undefined && node.height !== undefined) {
      instanceElement.size = { width: node.width, height: node.height }
    }
    
    if (node.rotation !== undefined) {
      instanceElement.rotation = node.rotation
    }
    
    // 实例覆盖的填充（实例级别的覆盖优先于组件定义）
    if (node.fills && node.fills.length > 0) {
      instanceElement.fills = this.convertFills(node.fills)
    }
    
    if (node.strokes && node.strokes.length > 0) {
      instanceElement.strokes = this.convertStrokes(node.strokes)
      if (node.strokeWeight !== undefined) {
        instanceElement.strokeWidth = node.strokeWeight
      }
      if ('strokeTopWeight' in node) {
        instanceElement.strokeTopWeight = node.strokeTopWeight
      }
      if ('strokeBottomWeight' in node) {
        instanceElement.strokeBottomWeight = node.strokeBottomWeight
      }
      if ('strokeLeftWeight' in node) {
        instanceElement.strokeLeftWeight = node.strokeLeftWeight
      }
      if ('strokeRightWeight' in node) {
        instanceElement.strokeRightWeight = node.strokeRightWeight
      }
      if (node.strokeAlign !== undefined) {
        instanceElement.strokeAlign = node.strokeAlign
      }
    }
    
    if (node.effects && node.effects.length > 0) {
      instanceElement.effects = this.convertEffects(node.effects)
    }
    
    if (node.opacity !== undefined) {
      instanceElement.opacity = node.opacity
    }
    if (node.blendMode) {
      instanceElement.blendMode = node.blendMode
    }
    
    if (node.constraints) {
      instanceElement.constraints = this.convertConstraints(node.constraints)
    }
    
    // 组件布局属性
    instanceElement.layoutMode = this.convertLayoutMode(node.flexMode)
    instanceElement.itemSpacing = node.itemSpacing
    instanceElement.paddingTop = node.paddingTop
    instanceElement.paddingBottom = node.paddingBottom
    instanceElement.paddingLeft = node.paddingLeft
    instanceElement.paddingRight = node.paddingRight
    instanceElement.clipsContent = node.clipsContent
    instanceElement.primaryAxisAlignItems = this.convertMainAxisAlignItems(node.mainAxisAlignItems)
    instanceElement.counterAxisAlignItems = this.convertCrossAxisAlignItems(node.crossAxisAlignItems)
    
    // 新增：更多自动布局属性
    instanceElement.flexWrap = node.flexWrap
    instanceElement.crossAxisSpacing = node.crossAxisSpacing
    instanceElement.primaryAxisAlignContent = node.primaryAxisAlignContent
    instanceElement.counterAxisAlignContent = node.counterAxisAlignContent
    instanceElement.primaryAxisSizingMode = node.primaryAxisSizingMode
    instanceElement.counterAxisSizingMode = node.primaryAxisSizingMode
    
    // 获取组件定义的 children 并递归转换（包括处理嵌套的 INSTANCE）
    const componentChildren = componentDef.children as any[]
    if (componentChildren && componentChildren.length > 0) {
      instanceElement.children = this.convertInstanceChildren(componentChildren, node)
    }
    
    // —— 母版信息：有真实值才写，拿不到就整个省略。
    // 历史实现用 `'unknown'` 兜底，导致使用者误判“母版在外部库”（本地母版同样报 unknown）。
    if (master) {
      instanceElement.mainComponentId = master.id
      if (master.name) instanceElement.mainComponentName = master.name
      // 仅在宿主给出可靠远程标记（ComponentNode.isExternal）时才写 isLocalMaster
      if (master.isLocalMaster !== undefined) instanceElement.isLocalMaster = master.isLocalMaster
      // 向后兼容：旧字段 componentId 保留（外部脚本/文档在读），但不再出现 'unknown'；
      // 有了 mainComponentId 这个语义明确的新字段后，新代码应优先读它。
      instanceElement.componentId = master.id
    }
    instanceElement.isExpandedInstance = true
    
    return instanceElement
  }

  // 递归转换组件子节点，并应用实例覆盖
  private static convertInstanceChildren(componentChildren: any[], _instanceNode: any): BaseElement[] {
    // 实例的 children 已经包含了所有可见的子节点（原始组件子节点 + 覆盖的子节点）
    // 直接使用 convertNodeToElement 转换即可，会自动处理嵌套的 INSTANCE
    return componentChildren
      .map((child: any) => this.convertNodeToElement(child))
      .filter((element): element is BaseElement => element !== null)
  }
  
  private static buildFallbackFrameElement(node: any): BaseElement {
    const frameElement: any = {
      type: 'frame',
      name: node.name || 'Instance',
      id: node.id
    }
    
    // 通用属性
    if (node.isVisible !== undefined) {
      frameElement.isVisible = node.isVisible
    }
    if (node.isLocked !== undefined) {
      frameElement.isLocked = node.isLocked
    }
    if (node.removed !== undefined) {
      frameElement.removed = node.removed
    }
    
    if (node.x !== undefined && node.y !== undefined) {
      frameElement.position = { x: node.x, y: node.y }
    }
    if (node.width !== undefined && node.height !== undefined) {
      frameElement.size = { width: node.width, height: node.height }
    }
    
    if (node.rotation !== undefined) {
      frameElement.rotation = node.rotation
    }
    
    if (node.fills && node.fills.length > 0) {
      frameElement.fills = this.convertFills(node.fills)
    }
    
    if (node.strokes && node.strokes.length > 0) {
      frameElement.strokes = this.convertStrokes(node.strokes)
      if (node.strokeWeight !== undefined) {
        frameElement.strokeWidth = node.strokeWeight
      }
      if ('strokeTopWeight' in node) {
        frameElement.strokeTopWeight = node.strokeTopWeight
      }
      if ('strokeBottomWeight' in node) {
        frameElement.strokeBottomWeight = node.strokeBottomWeight
      }
      if ('strokeLeftWeight' in node) {
        frameElement.strokeLeftWeight = node.strokeLeftWeight
      }
      if ('strokeRightWeight' in node) {
        frameElement.strokeRightWeight = node.strokeRightWeight
      }
      if (node.strokeAlign !== undefined) {
        frameElement.strokeAlign = node.strokeAlign
      }
    }
    
    if (node.effects && node.effects.length > 0) {
      frameElement.effects = this.convertEffects(node.effects)
    }
    
    if (node.opacity !== undefined) {
      frameElement.opacity = node.opacity
    }
    if (node.blendMode) {
      frameElement.blendMode = node.blendMode
    }
    
    if (node.constraints) {
      frameElement.constraints = this.convertConstraints(node.constraints)
    }
    
    // 布局属性
    frameElement.layoutMode = this.convertLayoutMode(node.flexMode)
    frameElement.itemSpacing = node.itemSpacing
    frameElement.paddingTop = node.paddingTop
    frameElement.paddingBottom = node.paddingBottom
    frameElement.paddingLeft = node.paddingLeft
    frameElement.paddingRight = node.paddingRight
    frameElement.clipsContent = node.clipsContent
    frameElement.primaryAxisAlignItems = this.convertMainAxisAlignItems(node.mainAxisAlignItems)
    frameElement.counterAxisAlignItems = this.convertCrossAxisAlignItems(node.crossAxisAlignItems)
    frameElement.flexWrap = node.flexWrap
    frameElement.crossAxisSpacing = node.crossAxisSpacing
    frameElement.primaryAxisSizingMode = node.primaryAxisSizingMode
    frameElement.counterAxisSizingMode = node.primaryAxisSizingMode
    
    return frameElement
  }
}
