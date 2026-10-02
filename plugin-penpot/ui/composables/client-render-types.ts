export interface ClientRenderState {
  isRendering: boolean
  progress: string
  error: string | null
}

export interface ClientRenderNode {
  type: 'frame' | 'text' | 'rectangle' | 'svg' | 'ellipse' | 'polygon' | 'line' | 'pen' | 'group' | 'instance'
  componentId?: string
  componentName?: string
  /** 团队组件库 ukey（data-library-ukey / data-library-component），由插件端 importComponentByKeyAsync 导入 */
  componentUkey?: string
  /** 组件集 variant 名称片段 */
  componentVariant?: string
  /** 组件集变体属性覆写，如 { State: 'Hover' } */
  variantProperties?: Record<string, string>
  /**
   * 实例子节点覆写：`{ 子节点名: { text?: string; fill?: string; visible?: 'true'|'false' } }`。
   * 由 `parseInstanceOverrides()` 从 `data-override-text-<childName>` / `-fill-` / `-visible-`
   * 解析，对齐 DSL `InstanceElement.overrides`（仅实例 / 换组件节点有意义）。
   */
  overrides?: Record<string, Record<string, string>>
  /**
   * 换组件目标：已存在实例的节点 ID 列表（data-swap-node-id="1:2,3:4"）。
   * 非空时该元素不创建新实例，而是把目标实例的主组件换成 componentId/componentName/componentUkey 指定的组件
   */
  swapNodeIds?: string[]
  /** 换组件后保持实例原有宽高（data-swap-keep-size） */
  swapKeepSize?: boolean
  /** 换组件后重置实例覆写（data-swap-reset-overrides） */
  swapResetOverrides?: boolean
  /** 目标不是实例时是否保留原对象（data-swap-keep-original，默认 false） */
  swapKeepOriginal?: boolean
  name: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  fills?: any[]
  strokes?: any[]
  strokeWidth?: number
  strokeWeight?: number
  strokeTopWeight?: number
  strokeBottomWeight?: number
  strokeLeftWeight?: number
  strokeRightWeight?: number
  strokeAlign?: string
  strokeJoin?: string
  strokeCap?: string
  cornerRadius?: number
  topLeftRadius?: number
  topRightRadius?: number
  bottomLeftRadius?: number
  bottomRightRadius?: number
  effects?: any[]
  opacity?: number
  rotation?: number
  blendMode?: string
  layoutPositioning?: 'AUTO' | 'ABSOLUTE'
  content?: string
  fontSize?: number
  fontWeight?: number
  fontName?: { family: string; style: string }
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT'
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM'
  lineHeight?: { unit: string; value?: number }
  letterSpacing?: number
  textAutoResize?: string
  layoutMode?: 'NONE' | 'VERTICAL' | 'HORIZONTAL'
  itemSpacing?: number
  paddingTop?: number
  paddingBottom?: number
  paddingLeft?: number
  paddingRight?: number
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX'
  flexWrap?: 'NO_WRAP' | 'WRAP'
  primaryAxisSizingMode?: 'FIXED' | 'AUTO'
  counterAxisSizingMode?: 'FIXED' | 'AUTO'
  layoutSizingHorizontal?: 'FILL' | 'AUTO' | 'FIXED'
  layoutSizingVertical?: 'FILL' | 'AUTO' | 'FIXED'
  clipsContent?: boolean
  svgContent?: string
  svgPathData?: string
  imageUrl?: string
  imageScaleMode?: string
  flexGrow?: number
  /** 声明式令牌绑定（`data-token-<property>` → 属性名 → 令牌名） */
  tokenBindings?: Record<string, string>
  textSegments?: Array<{
    start: number
    end: number
    fills: any[]
  }>
  /** 富文本 run（P2-3）：由内联子元素算出，渲染末端逐段上样式 */
  runs?: Array<{ text: string; fontSize?: number; fontWeight?: number; color?: string; letterSpacing?: number }>
  children: ClientRenderNode[]
}
