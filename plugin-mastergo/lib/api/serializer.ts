/**
 * 节点序列化器：将 mg API 的 SceneNode 转换为可 JSON 序列化的纯对象。
 *
 * 设计原则：
 * - 只提取对 AI 有用的属性，跳过循环引用和内部复杂对象
 * - 布局/样式属性通过类型判断按需提取（TextNode 取文本，FrameNode 取自动布局等）
 * - Paint / Effect 数组做浅拷贝保留必要字段（effects 走 visual-utils 统一提取）
 *
 * 注意：`node_get` / `selection_get` / 各写操作的返回值都经由本文件，
 * 新增可回读属性时请同步到这里，否则 AI 无法验证自己刚做的修改是否生效。
 */
import { serializeEffects, type SerializedEffect } from './visual-utils'

interface SerializedNode {
  id: string
  name: string
  type: string
  removed: boolean
  isVisible: boolean
  isLocked: boolean
  parentId?: string
  childIds?: string[]
  // 布局
  x?: number
  y?: number
  width?: number
  height?: number
  rotation?: number
  opacity?: number
  // 几何样式
  fills?: any[]
  strokes?: any[]
  effects?: SerializedEffect[]
  strokeWeight?: number
  strokeTopWeight?: number
  strokeBottomWeight?: number
  strokeLeftWeight?: number
  strokeRightWeight?: number
  cornerRadius?: number
  // 文本（TextNode）
  characters?: string
  textAlignHorizontal?: string
  fontSize?: number
  fontName?: { family: string; style: string }
  lineHeight?: any
  letterSpacing?: any
  textAutoResize?: string
  // 自动布局（Frame/Component/Section）
  flexMode?: string
  itemSpacing?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  mainAxisAlignItems?: string
  crossAxisAlignItems?: string
  mainAxisSizingMode?: string
  crossAxisSizingMode?: string
  clipsContent?: boolean
  // 描边
  strokeAlign?: string
  strokeCap?: string
  strokeJoin?: string
  // 组件
  description?: string
  alias?: string
  componentPropertyDefinitions?: any
  // 实例母版（仅 INSTANCE）：来自宿主 `InstanceNode.mainComponent`（ComponentNode）
  mainComponentId?: string
  mainComponentName?: string
  /** 母版是否为文档内组件（`ComponentNode.isExternal === false`）；标记拿不到时省略 */
  isLocalMaster?: boolean
}

/** 序列化 Paint 数组，保留关键字段 */
function serializePaints(paints: ReadonlyArray<any>): any[] {
  return paints.map(paint => {
    const base: any = { type: paint.type }
    if (paint.color) base.color = paint.color
    if (paint.opacity !== undefined) base.opacity = paint.opacity
    if (paint.gradientStops) base.gradientStops = paint.gradientStops
    if (paint.gradientHandlePositions) base.gradientHandlePositions = paint.gradientHandlePositions
    if (paint.imageRef) base.imageRef = paint.imageRef
    if (paint.scaleMode) base.scaleMode = paint.scaleMode
    if (paint.name) base.name = paint.name
    return base
  })
}

/** 判断节点是否有 ChildrenMixin（可包含子节点） */
function hasChildren(node: any): boolean {
  return 'children' in node && Array.isArray(node.children)
}

/** 判断节点是否有 GeometryMixin（fills/strokes） */
function hasGeometry(node: any): boolean {
  return 'fills' in node && 'strokes' in node
}

/** 判断节点是否有 LayoutMixin（x/y/width/height） */
function hasLayout(node: any): boolean {
  return 'x' in node && 'y' in node
}

/** 判断节点是否有 CornerMixin（cornerRadius） */
function hasCorners(node: any): boolean {
  return 'cornerRadius' in node
}

/** 判断节点是否有 AutoLayout（flexMode） */
function hasAutoLayout(node: any): boolean {
  return 'flexMode' in node
}

/** 判断节点是否有 BlendMixin（opacity） */
function hasBlend(node: any): boolean {
  return 'opacity' in node
}

/** 判断节点是否为 TextNode */
function isTextNode(node: any): boolean {
  return node.type === 'TEXT'
}

/** 判断节点是否有 GeometryMixin 的描边属性 */
function hasStrokeDetails(node: any): boolean {
  return 'strokeAlign' in node && 'strokeWeight' in node
}

/** 判断节点是否有 PublishableMixin（组件描述/别名） */
function hasPublishable(node: any): boolean {
  return 'description' in node && 'alias' in node
}

/**
 * 实例母版信息（可信解析，拿不到就省略）。
 *
 * 宿主 typings（`InstanceNode`）里 `mainComponent: ComponentNode | null` 是对象；
 * `ComponentNode` 实现 `PublishableMixin` 的 `readonly isExternal: boolean`
 * （“是否为团队库组件/样式”）。旧模型可能只给 id 字符串。
 */
function resolveMainComponent(node: any): { id: string; name?: string; isLocalMaster?: boolean } | null {
  const raw = node.mainComponent ?? node.masterComponent ?? node.componentId
  if (!raw) return null

  if (typeof raw === 'object') {
    if (typeof raw.id !== 'string' || !raw.id) return null
    return {
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name : undefined,
      isLocalMaster: typeof raw.isExternal === 'boolean' ? !raw.isExternal : undefined,
    }
  }

  if (typeof raw === 'string') {
    // 只有 id 字符串时只能给 id（序列化器保持纯函数，不做宿主回读，也就无法可靠判定本地/外部）
    const info: { id: string; name?: string; isLocalMaster?: boolean } = { id: raw }
    if (typeof node.mainComponentName === 'string') info.name = node.mainComponentName
    return info
  }

  return null
}

/**
 * 将 SceneNode 序列化为纯对象。
 * @param node 任意 mg API 节点
 * @param deep 是否递归序列化子节点（默认 false，仅返回 childIds）
 */
export function serializeNode(node: any, deep = false): SerializedNode | null {
  if (!node || node.removed) return null

  const result: SerializedNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    removed: node.removed,
    isVisible: node.isVisible,
    isLocked: node.isLocked,
  }

  // 父子关系
  if (node.parent) {
    result.parentId = node.parent.id
  }
  if (hasChildren(node)) {
    const childIds = node.children.map((c: any) => c.id)
    result.childIds = childIds
    if (deep) {
      ;(result as any).children = node.children
        .map((c: any) => serializeNode(c, false))
        .filter(Boolean)
    }
  }

  // 布局属性
  if (hasLayout(node)) {
    result.x = node.x
    result.y = node.y
    result.width = node.width
    result.height = node.height
    result.rotation = node.rotation
  }

  // 混合模式
  if (hasBlend(node)) {
    result.opacity = node.opacity
  }

  // 几何样式
  if (hasGeometry(node)) {
    result.fills = serializePaints(node.fills)
    result.strokes = serializePaints(node.strokes)
  }

  // 效果（阴影 / 模糊）——运行时字段为 isVisible，DSL 侧才叫 visible
  if ('effects' in node && Array.isArray(node.effects) && node.effects.length > 0) {
    result.effects = serializeEffects(node.effects)
  }

  // 描边属性
  if (hasStrokeDetails(node)) {
    result.strokeWeight = node.strokeWeight
    result.strokeAlign = node.strokeAlign
    result.strokeCap = node.strokeCap
    result.strokeJoin = node.strokeJoin
    if ('strokeTopWeight' in node && node.strokeTopWeight !== undefined) {
      result.strokeTopWeight = node.strokeTopWeight
    }
    if ('strokeBottomWeight' in node && node.strokeBottomWeight !== undefined) {
      result.strokeBottomWeight = node.strokeBottomWeight
    }
    if ('strokeLeftWeight' in node && node.strokeLeftWeight !== undefined) {
      result.strokeLeftWeight = node.strokeLeftWeight
    }
    if ('strokeRightWeight' in node && node.strokeRightWeight !== undefined) {
      result.strokeRightWeight = node.strokeRightWeight
    }
  }

  // 圆角
  if (hasCorners(node)) {
    result.cornerRadius = node.cornerRadius
  }

  // 文本属性
  if (isTextNode(node)) {
    result.characters = node.characters
    result.textAlignHorizontal = node.textAlignHorizontal
    result.textAutoResize = node.textAutoResize
    if (node.textStyles && node.textStyles.length > 0) {
      const firstStyle = node.textStyles[0]
      if (firstStyle.textStyle) {
        result.fontSize = firstStyle.textStyle.fontSize
        result.fontName = firstStyle.textStyle.fontName
        result.lineHeight = firstStyle.textStyle.lineHeight
        result.letterSpacing = firstStyle.textStyle.letterSpacing
      }
    }
    // fallback: if textStyle not available, read directly from node
    if (result.fontSize === undefined && node.fontSize !== undefined) {
      result.fontSize = node.fontSize
    }
    if (result.fontName === undefined && node.fontName !== undefined) {
      result.fontName = node.fontName
    }
    if (result.lineHeight === undefined && node.lineHeight !== undefined) {
      result.lineHeight = node.lineHeight
    }
    if (result.letterSpacing === undefined && node.letterSpacing !== undefined) {
      result.letterSpacing = node.letterSpacing
    }
  }

  // 自动布局
  if (hasAutoLayout(node)) {
    result.flexMode = node.flexMode
    result.itemSpacing = node.itemSpacing
    result.paddingTop = node.paddingTop
    result.paddingRight = node.paddingRight
    result.paddingBottom = node.paddingBottom
    result.paddingLeft = node.paddingLeft
    result.mainAxisAlignItems = node.mainAxisAlignItems
    result.crossAxisAlignItems = node.crossAxisAlignItems
    result.mainAxisSizingMode = node.mainAxisSizingMode
    result.crossAxisSizingMode = node.crossAxisSizingMode
  }

  // Frame 容器属性
  if ('clipsContent' in node) {
    result.clipsContent = node.clipsContent
  }

  // 组件发布信息
  if (hasPublishable(node)) {
    result.description = node.description
    result.alias = node.alias
  }

  // 实例母版：只在拿得到真实母版时写入，绝不写 'unknown' 之类占位
  if (node.type === 'INSTANCE') {
    const main = resolveMainComponent(node)
    if (main) {
      result.mainComponentId = main.id
      if (main.name) result.mainComponentName = main.name
      if (main.isLocalMaster !== undefined) result.isLocalMaster = main.isLocalMaster
    }
  }

  return result
}

/**
 * 批量序列化节点数组
 */
export function serializeNodes(nodes: any[], deep = false): SerializedNode[] {
  return nodes.map(n => serializeNode(n, deep)).filter((n): n is SerializedNode => n !== null)
}
