import { hasShadowEffect } from './effect-converter'

export interface LayoutHelpers {
  convertLayoutMode: (layoutMode: string) => string
  convertMainAxisAlignItems: (alignItems: string) => string
  convertCrossAxisAlignItems: (alignItems: string) => string
  convertCrossAxisAlignContent: (alignContent: string) => string
  convertFlexWrap: (flexWrap: string) => string
}

/**
 * 重新应用帧/组件的布局属性（用于节点加入文档后的二次设置）
 */
export function applyFrameLayoutProps(node: any, element: any, helpers: LayoutHelpers): void {
  if (!node || !element) return
  if (element.layoutMode) {
    node.flexMode = helpers.convertLayoutMode(element.layoutMode)
  }
  if (element.itemSpacing !== undefined) {
    node.itemSpacing = element.itemSpacing
  }
  if (element.paddingTop !== undefined) {
    node.paddingTop = element.paddingTop
  }
  if (element.paddingBottom !== undefined) {
    node.paddingBottom = element.paddingBottom
  }
  if (element.paddingLeft !== undefined) {
    node.paddingLeft = element.paddingLeft
  }
  if (element.paddingRight !== undefined) {
    node.paddingRight = element.paddingRight
  }
  if (element.clipsContent !== undefined) {
    node.clipsContent = element.clipsContent && !hasShadowEffect(element)
  }
  if (element.primaryAxisAlignItems) {
    node.mainAxisAlignItems = helpers.convertMainAxisAlignItems(element.primaryAxisAlignItems)
  } else if (element.mainAxisAlignItems) {
    node.mainAxisAlignItems = helpers.convertMainAxisAlignItems(element.mainAxisAlignItems)
  }
  if (element.counterAxisAlignItems) {
    node.crossAxisAlignItems = helpers.convertCrossAxisAlignItems(element.counterAxisAlignItems)
  } else if (element.crossAxisAlignItems) {
    node.crossAxisAlignItems = helpers.convertCrossAxisAlignItems(element.crossAxisAlignItems)
  }
  if (element.counterAxisAlignContent) {
    node.crossAxisAlignContent = helpers.convertCrossAxisAlignContent(element.counterAxisAlignContent)
  }
  if (element.flexWrap !== undefined) {
    node.flexWrap = helpers.convertFlexWrap(element.flexWrap)
  } else if (element.layoutMode && element.layoutMode !== 'NONE') {
    node.flexWrap = 'NO_WRAP'
  }
  if (element.crossAxisSpacing !== undefined) {
    node.crossAxisSpacing = element.crossAxisSpacing
  }
  if (element.primaryAxisSizingMode !== undefined) {
    node.mainAxisSizingMode = element.primaryAxisSizingMode === 'AUTO' ? 'AUTO' : 'FIXED'
  }
  if (element.counterAxisSizingMode !== undefined) {
    node.crossAxisSizingMode = element.counterAxisSizingMode === 'AUTO' ? 'AUTO' : 'FIXED'
  }
  // 当某轴为 FIXED 模式时，重新声明该轴尺寸
  if (element.size) {
    if (element.size.width !== undefined && node.crossAxisSizingMode === 'FIXED') {
      node.width = element.size.width
    }
    if (element.size.height !== undefined && node.mainAxisSizingMode === 'FIXED') {
      node.height = element.size.height
    }
  }
}
