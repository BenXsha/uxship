import {
  BaseElement,
  RectangleElement,
  TextElement,
  EllipseElement,
  PolygonElement,
  StarElement,
  LineElement,
  PenElement,
  SvgElement,
  BooleanOperationElement,
  GroupElement,
  FrameElement,
  ComponentElement,
  InstanceElement,
  TemplateRefElement,
  TemplateElement,
  GeneratorElement,
  TreeElement,
  DSLDocument
} from './dsl-types'

import { processColor } from '../utils/color-utils'
import { handleComponentRender } from './componentHandlers'

/**
 * 尺寸提示：渲染器内部把元素本身传给 fills/strokes 转换器，用于计算渐变坐标。
 * 除 width/height 外允许携带任意元素属性（size 等）。
 */
type SizeHint = { width?: number; height?: number; [key: string]: any }
import { parseCSSGradient, parseRadialGradient } from './gradient-parser'
import { convertEffects as convertEffectsFn, convertBlendMode as convertBlendModeFn } from './effect-converter'
import { applyFrameLayoutProps as applyFrameLayoutPropsFn } from './layout-applier'
import { expandTemplatesAndGenerators as expandTemplatesAndGeneratorsFn, renderTemplateRef as renderTemplateRefFn, renderTemplate as renderTemplateFn, renderGenerator as renderGeneratorFn, renderTree as renderTreeFn } from './template-expander'
import { applyComponentSwap } from './swapComponentHandlers'
import { applyInstanceOverrides } from './instance-overrides'

/**
 * 远程图片体积上限：超过就放弃（不静默 —— 写 console.error）。
 */
const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024

/**
 * 只有公网 http(s) 地址才允许直接 fetch。
 *
 * 为什么需要：`fill.imageUrl` 来自 DSL（AI / 用户生成的内容），而这里的 `fetch` 跑在插件沙箱里。
 * 不加限制就等于「一份 DSL 能让插件向任意地址发请求」—— loopback、内网服务、
 * 云元数据 169.254.169.254 都会被请求到，响应还会被当成图片画到画布上。
 * 因此显式拒绍本机 / 私有网段 / 链路本地，且只认 http(s)。
 */
function isPublicHttpUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  // IPv4：0.0.0.0/8、127/8、10/8、172.16/12、192.168/16、169.254/16
  if (/^(0|127|10)\./.test(host)) return false
  if (/^192\.168\./.test(host)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
  if (/^169\.254\./.test(host)) return false
  // IPv6：环回 / 未指定 / 唯一本地(fc00::/7) / 链路本地(fe80::/10)
  if (host === '::1' || host === '::' || /^(fc|fd|fe80)/.test(host)) return false
  return true
}

export class DSLRenderer {
  // 记录已成功加载的字体样式
  private static loadedFontStyles: Set<string> = new Set(['Regular'])
  // 延迟布局更新队列：节点加入文档后需二次设置的布局属性
  private static pendingLayoutUpdates: Array<{ node: any; property: string; value: any }> = []
  // 延迟帧布局更新：存储节点和原始元素数据，用于二次应用布局属性
  private static pendingFrameLayouts: Array<{ node: any; element: any }> = []
  // 延迟渐变填充：节点加入文档后获得实际尺寸，重新计算径向渐变 transform/handles
  private static pendingGradientFills: Array<{ node: any; fills: any[] }> = []
  /**
   * 本轮渲染的属性级降级信息（实例子节点覆写未生效、换组件告警/失败）。
   *
   * 这些情形"看起来成功、其实没生效"，不能只打 console —— renderDSL 结束后由
   * `takeRenderIssues()` 取走，由 `handleRenderDSL` 一并回报给调用方并提示用户。
   */
  private static renderIssues: string[] = []

  /** 追加一条本轮渲染的属性级降级信息 */
  static noteRenderIssue(message: string): void {
    this.renderIssues.push(message)
  }

  /** 取走并清空本轮渲染的降级信息（取走语义：避免跨次渲染累积） */
  static takeRenderIssues(): string[] {
    const issues = this.renderIssues
    this.renderIssues = []
    return issues
  }
  /**
   * 渲染DSL文档到当前页面，返回创建的根节点 ID 列表
   */
  static async renderDSL(dsl: DSLDocument): Promise<string[]> {
    console.log(`[DSLRenderer] 开始渲染DSL，版本: ${dsl.version}, 元素数: ${dsl.elements.length}`)

    // 每次渲染重置降级收集（上一次未被取走的记录不该污染本轮报告）
    this.renderIssues = []
    
    // 先展开所有模板和生成器
    const expandedElements = this.expandTemplatesAndGenerators(dsl.elements)
    console.log(`[DSLRenderer] 模板展开后: ${expandedElements.length} 个元素`)
    
    // 再加载所有需要的字体
    await this.loadRequiredFonts(expandedElements)

    // 预解析所有 HTTP 图片 URL 为 MasterGo imageRef
    await this.resolveAllImageUrls(expandedElements)

    const currentPage = mg.document.currentPage
    const rootNodeIds: string[] = []
    let successCount = 0
    let errorCount = 0
    
    for (const element of expandedElements) {
      try {
        const node = await this.renderElement(element)
        if (node) {
          currentPage.appendChild(node)
          rootNodeIds.push(node.id)
          successCount++
        }
      } catch (error) {
        errorCount++
        console.error(`渲染元素 "${element.name}" 失败:`, error)
      }
    }
    
    // 二次设置布局属性：节点加入文档后重新应用，确保 flexGrow/layoutPositioning 等生效
    this.flushDeferredLayoutUpdates()
    
    // 提交撤销操作
    mg.commitUndo()
    
    console.log(`[DSLRenderer] 渲染完成: 成功 ${successCount} 个, 失败 ${errorCount} 个, 根节点 ID: ${rootNodeIds.join(', ')}`)
    return rootNodeIds
  }

  /**
   * 二次设置延迟的布局属性：确保在节点加入文档后生效
   */
  private static flushDeferredLayoutUpdates(): void {
    // 子级布局属性（flexGrow/layoutPositioning 等）
    for (const update of this.pendingLayoutUpdates) {
      try {
        if (update.property in update.node) {
          update.node[update.property] = update.value
        }
      } catch (error) {
        console.warn(`延迟更新属性 ${update.property} 失败:`, error)
      }
    }
    this.pendingLayoutUpdates = []
    // 帧级布局属性（flexMode/padding 等）
    for (const { node, element } of this.pendingFrameLayouts) {
      try {
        this.applyFrameLayoutProps(node, element)
      } catch (error) {
        console.warn(`延迟更新帧布局属性失败:`, error)
      }
    }
    this.pendingFrameLayouts = []
    // 延迟应用渐变填充：节点已有实际尺寸，可正确计算 transform/handles
    for (const { node, fills } of this.pendingGradientFills) {
      try {
        const converted = this.convertFills(fills, { width: node.width, height: node.height })
        if ('fills' in node) {
          node.fills = converted
        }
      } catch (error) {
        console.warn('延迟应用渐变填充失败:', error)
      }
    }
    this.pendingGradientFills = []
  }

  /**
   * 展开所有模板和生成器为基本元素
   */
  private static expandTemplatesAndGenerators(elements: BaseElement[]): BaseElement[] {
    return expandTemplatesAndGeneratorsFn(elements)
  }

  /**
   * 渲染单个元素
   */
  static async renderElement(
    element: BaseElement,
    _page?: unknown,
    maxDepth: number = 20,
    currentDepth: number = 0,
    parentIsInAutoLayout: boolean = false
  ): Promise<any> {
    // 检查渲染深度
    if (currentDepth >= maxDepth) {
      console.warn(`元素 "${element.name}" 超过最大渲染深度 ${maxDepth}，跳过渲染`)
      return null
    }

    switch (element.type) {
      case 'rectangle':
        return this.renderRectangle(element as RectangleElement, parentIsInAutoLayout)
      case 'text':
        return this.renderText(element as TextElement, parentIsInAutoLayout)
      case 'ellipse':
        return this.renderEllipse(element as EllipseElement, parentIsInAutoLayout)
      case 'polygon':
        return this.renderPolygon(element as PolygonElement, parentIsInAutoLayout)
      case 'star':
        return this.renderStar(element as StarElement, parentIsInAutoLayout)
      case 'line':
        return this.renderLine(element as LineElement, parentIsInAutoLayout)
      case 'pen':
      case 'path':
        return this.renderPen(element as PenElement, parentIsInAutoLayout)
      case 'svg':
        return this.renderSvg(element as SvgElement, parentIsInAutoLayout)
      case 'boolean_operation':
        return this.renderBooleanOperation(element as BooleanOperationElement, parentIsInAutoLayout)
      case 'group':
        return this.renderGroup(element as GroupElement, parentIsInAutoLayout, maxDepth, currentDepth)
      case 'frame':
        return this.renderFrame(element as FrameElement, maxDepth, currentDepth, parentIsInAutoLayout)
      case 'component':
        return this.renderComponent(element as ComponentElement, maxDepth, currentDepth, parentIsInAutoLayout)
      case 'instance':
        return this.renderInstance(element as InstanceElement, parentIsInAutoLayout)
      case 'template-ref':
        return this.renderTemplateRef(element as TemplateRefElement)
      case 'template':
        return this.renderTemplate(element as TemplateElement)
      case 'generator':
        return this.renderGenerator(element as GeneratorElement, parentIsInAutoLayout)
      case 'tree':
        return this.renderTree(element as TreeElement)
      case 'connector':
        return this.renderConnector(element)
      default:
        console.warn(`不支持的元素类型: ${element.type}`)
        return null
    }
  }

  /**
   * 递归收集所有文本元素
   */
  private static collectTextElements(elements: BaseElement[]): TextElement[] {
    const textElements: TextElement[] = []

    for (const element of elements) {
      if (element.type === 'text') {
        textElements.push(element as TextElement)
      } else if (element.type === 'group') {
        const groupElement = element as GroupElement
        if (groupElement.children) {
          textElements.push(...this.collectTextElements(groupElement.children))
        }
      } else if (element.type === 'frame') {
        const frameElement = element as FrameElement
        if (frameElement.children) {
          textElements.push(...this.collectTextElements(frameElement.children))
        }
      } else if (element.type === 'component') {
        const componentElement = element as ComponentElement
        if (componentElement.children) {
          textElements.push(...this.collectTextElements(componentElement.children))
        }
      } else if (element.type === 'instance') {
        const instanceElement = element as InstanceElement
        if (instanceElement.children) {
          textElements.push(...this.collectTextElements(instanceElement.children))
        }
      }
    }

    return textElements
  }

  /**
   * 加载所有需要的字体
   */
  private static async loadRequiredFonts(elements: BaseElement[]): Promise<void> {
    const fontsToLoad = new Set<string>()

    // 递归收集所有文本元素的字体
    const allTextElements = this.collectTextElements(elements)
    for (const textElement of allTextElements) {
      const fontStyle = textElement.fontWeight !== undefined
        ? this.getFontStyle(textElement.fontWeight)
        : 'Regular'
      const fontKey = `Inter:${fontStyle}`
      fontsToLoad.add(fontKey)
    }

    // 添加常用字体，确保基本显示
    const commonFonts = ['Inter:Regular', 'Inter:Medium', 'Inter:Semi Bold', 'Inter:Bold', 'Inter:Extra Bold']
    for (const font of commonFonts) {
      fontsToLoad.add(font)
    }

    // 并行加载所有字体，带重试机制
    const maxRetries = 3

    // 创建加载单个字体的函数
    const loadFontWithRetry = async (fontKey: string): Promise<void> => {
      const [family, style] = fontKey.split(':')

      for (let retry = 0; retry < maxRetries; retry++) {
        try {
          await mg.loadFontAsync({ family, style })
          console.log(`字体加载成功: ${fontKey}`)
          this.loadedFontStyles.add(style)
          return // 成功加载，直接返回
        } catch (error) {
          console.warn(`字体加载失败 (尝试 ${retry + 1}/${maxRetries}): ${fontKey}`, error)
          if (retry < maxRetries - 1) {
            // 等待一段时间后重试
            await new Promise(resolve => setTimeout(resolve, 100 * (retry + 1)))
          }
        }
      }

      console.error(`字体加载最终失败: ${fontKey}`)
    }

    // 并行加载所有字体
    const fontPromises = Array.from(fontsToLoad).map(fontKey => loadFontWithRetry(fontKey))
    await Promise.all(fontPromises)

    // 确保至少 Regular 可用
    this.loadedFontStyles.add('Regular')
    // 等待一段时间确保字体完全加载
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  /**
   * 将 base64 字符串转为 Uint8Array（纯 JS 实现，不依赖 atob/Buffer）
   */
  private static base64ToUint8Array(base64: string): Uint8Array {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const lookup: Record<string, number> = {}
    for (let i = 0; i < chars.length; i++) lookup[chars[i]] = i

    const str = base64.replace(/=+$/, '')
    const len = str.length
    const bytes: number[] = []
    for (let i = 0; i < len; i += 4) {
      const a = lookup[str[i]] || 0
      const b = lookup[str[i + 1]] || 0
      const c = lookup[str[i + 2]] ?? (i + 2 < len ? lookup[str[i + 2]] : 0)
      const d = lookup[str[i + 3]] ?? (i + 3 < len ? lookup[str[i + 3]] : 0)
      bytes.push((a << 2) | (b >> 4))
      if (i + 2 < len) bytes.push(((b & 15) << 4) | (c >> 2))
      if (i + 3 < len) bytes.push(((c & 3) << 6) | d)
    }
    return new Uint8Array(bytes)
  }

  /**
   * 通过 imageData(base64) 或 imageUrl(HTTP) 创建 MasterGo 图片，返回 imageRef(href)
   *
   * 优先级：imageData(base64) → imageUrl(HTTP URL) → 直接返回原值
   */
  private static async resolveImage(fill: any): Promise<void> {
    try {
      let uint8Array: Uint8Array | null = null

      // 优先使用 imageData (base64，由服务端预取)
      if (fill.imageData && typeof fill.imageData === 'string') {
        uint8Array = this.base64ToUint8Array(fill.imageData)
      }
      // 其次尝试从 HTTP URL 直接 fetch（部分沙箱环境可能支持）
      // 安全：imageUrl 来自 DSL，先过 isPublicHttpUrl 再发请求（防 SSRF），响应有体积上限。
      else if (fill.imageUrl && typeof fill.imageUrl === 'string' && isPublicHttpUrl(fill.imageUrl)) {
        if (typeof fetch !== 'undefined') {
          const response = await fetch(fill.imageUrl)
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer()
            if (arrayBuffer.byteLength <= MAX_REMOTE_IMAGE_BYTES) {
              uint8Array = new Uint8Array(arrayBuffer)
            } else {
              console.error(`[DSLRenderer] 远程图片超过上限（${arrayBuffer.byteLength} > ${MAX_REMOTE_IMAGE_BYTES} 字节），已跳过: ${fill.imageUrl}`)
            }
          }
        }
      }

      if (uint8Array) {
        const image = await mg.createImage(uint8Array)
        if (image && image.href) {
          fill.imageUrl = image.href
          console.log(`[DSLRenderer] 图片解析成功: href=${image.href}`)
        } else {
          console.warn(`[DSLRenderer] mg.createImage 返回的 image.href 为空`)
        }
      }
    } catch (error) {
      console.warn(`[DSLRenderer] 图片解析失败: ${fill.imageUrl || '(no url)'}`, error)
    }
  }

  /**
   * 递归扫描所有元素，解析 IMAGE fill/stroke 中的图片数据为 MasterGo imageRef
   */
  private static async resolveAllImageUrls(elements: BaseElement[]): Promise<void> {
    const tasks: Promise<void>[] = []

    const collect = (els: BaseElement[]) => {
      for (const el of els) {
        const anyEl = el as any
        // 扫描 fills 中的图片
        if (anyEl.fills) {
          for (const fill of anyEl.fills) {
            const fillType = (fill.type || '').toUpperCase()
            if (fillType === 'IMAGE' && (fill.imageData || fill.imageUrl)) {
              tasks.push(this.resolveImage(fill))
            }
          }
        }
        // 扫描 strokes 中的图片
        if (anyEl.strokes) {
          for (const stroke of anyEl.strokes) {
            const strokeType = (stroke.type || '').toUpperCase()
            if (strokeType === 'IMAGE' && (stroke.imageData || stroke.imageUrl)) {
              tasks.push(this.resolveImage(stroke))
            }
          }
        }
        // 递归子元素
        if (anyEl.children) {
          collect(anyEl.children)
        }
      }
    }

    collect(elements)
    await Promise.all(tasks)
  }

  /**
   * 应用公共属性到节点
   */
  private static applyCommonProperties(
    node: any,
    element: any,
    isInAutoLayout: boolean = false
  ): void {
    // 安全设置属性的辅助函数
    const setProperty = (propertyName: string, value: any, defer: boolean = false) => {
      try {
        if (propertyName in node) {
          node[propertyName] = value
          // 需要二次设置的布局属性，等节点加入文档后再执行一次
          if (defer) {
            this.pendingLayoutUpdates.push({ node, property: propertyName, value })
          }
        }
      } catch (error) {
        console.warn(`设置属性 ${propertyName} 失败:`, error)
      }
    }

    // 设置基本属性
    if (element.isVisible !== undefined) {
      setProperty('isVisible', element.isVisible)
    }
    if (element.isLocked !== undefined) {
      setProperty('isLocked', element.isLocked)
    }

    // 设置尺寸
    // 注意：当 layoutSizingHorizontal/layoutSizingVertical 为 FILL 或 AUTO 时，
    // 不应设置固定 width/height，否则与 Auto Layout 的自动拉伸/自适应行为冲突
    if (element.size) {
      const shouldSkipWidth = element.layoutSizingHorizontal === 'FILL' || element.layoutSizingHorizontal === 'AUTO'
      const shouldSkipHeight = element.layoutSizingVertical === 'FILL' || element.layoutSizingVertical === 'AUTO'
      if (element.size.width !== undefined && !shouldSkipWidth) {
        setProperty('width', element.size.width)
      }
      if (element.size.height !== undefined && !shouldSkipHeight) {
        setProperty('height', element.size.height)
      }
    }
    
    // 设置旋转
    if (element.rotation !== undefined) {
      setProperty('rotation', element.rotation)
    }

    // layoutPositioning 必须在 x/y 之前设置：
    // 在自动布局父节点中，先设 layoutPositioning 再设坐标，确保坐标不会被自动布局覆盖
    if (element.layoutPositioning) {
      setProperty('layoutPositioning', element.layoutPositioning, true)
    }

    // 设置变换（自动布局模式下不设置位置相关的变换，由布局系统自动计算）
    // 但若元素使用 ABSOLUTE 定位，即使在自动布局父级中也需设置位置
    const shouldSkipPosition = isInAutoLayout && element.layoutPositioning !== 'ABSOLUTE'
    if (!shouldSkipPosition) {
      // 优先使用 relativeTransform，因为它包含完整的变换信息（位置、缩放、旋转）
      // 当设置 relativeTransform 时，节点的 x 和 y 属性会自动更新
      if (element.relativeTransform) {
        setProperty('relativeTransform', element.relativeTransform)
      } else if (element.position) {
        // 如果没有 relativeTransform，则直接设置位置
        setProperty('x', element.position.x ?? 0, true)
        setProperty('y', element.position.y ?? 0, true)
      }
    }

    // 设置填充
    try {
      // GroupNode 和 BooleanOperationNode 不支持 fills 属性，跳过设置
      const nodeType = node.type
      if (nodeType === 'GROUP' || nodeType === 'BOOLEAN_OPERATION') {
        if (element.fills && element.fills.length > 0) {
          const typeName = nodeType === 'GROUP' ? 'Group' : 'BooleanOperation'
          console.warn(`节点 "${element.name}" 是 ${typeName} 类型，不支持 fills 属性，已跳过设置。如果需要背景填充，请改用 Frame 类型或单独给子元素设置 fills。`)
        }
      } else {
        if (element.fills && element.fills.length > 0) {
          const hasRadialGradient = element.fills.some((f: any) => {
            const t = (f.type || '').toUpperCase()
            return t === 'GRADIENT_RADIAL' || (t === 'GRADIENT' && typeof f.color === 'string' && f.color.trim().startsWith('radial-gradient'))
          })
          const convertedFills = this.convertFills(element.fills, element)
          if ('fills' in node) {
            node.fills = convertedFills
          }
          if (hasRadialGradient) {
            this.pendingGradientFills.push({ node, fills: element.fills })
          }
        } else {
          // 如果没有填充或填充为空数组，则清除默认背景
          if ('fills' in node) {
            node.fills = []
          }
        }
      }
    } catch (error) {
      console.warn('设置填充失败:', error)
    }

    // 设置描边
    try {
      if (element.strokes && element.strokes.length > 0) {
        if ('strokes' in node) {
          node.strokes = this.convertStrokes(element.strokes, element)
        }
        const strokeW = element.strokeWeight ?? element.strokeWidth
        if (strokeW !== undefined) {
          setProperty('strokeWeight', strokeW)
        }
        if (element.strokeAlign) {
          setProperty('strokeAlign', element.strokeAlign)
        }
        if (element.strokeJoin) {
          setProperty('strokeJoin', element.strokeJoin)
        }
        if (element.strokeCap) {
          setProperty('strokeCap', this.convertStrokeCap(element.strokeCap))
        }
        // 单独边描边（RectangleStrokeWeightMixin: RectangleNode/FrameNode/SectionNode/ComponentNode/InstanceNode）
        if (element.strokeTopWeight !== undefined && 'strokeTopWeight' in node) {
          node.strokeTopWeight = element.strokeTopWeight
        }
        if (element.strokeBottomWeight !== undefined && 'strokeBottomWeight' in node) {
          node.strokeBottomWeight = element.strokeBottomWeight
        }
        if (element.strokeLeftWeight !== undefined && 'strokeLeftWeight' in node) {
          node.strokeLeftWeight = element.strokeLeftWeight
        }
        if (element.strokeRightWeight !== undefined && 'strokeRightWeight' in node) {
          node.strokeRightWeight = element.strokeRightWeight
        }
      } else {
        // 如果没有描边或描边为空数组，则清除默认描边
        if ('strokes' in node) {
          node.strokes = []
        }
      }
    } catch (error) {
      console.warn('设置描边失败:', error)
    }

    // 设置效果（阴影、模糊）
    if (element.effects && element.effects.length > 0) {
      try {
        if ('effects' in node) {
          node.effects = this.convertEffects(element.effects)
        }
      } catch (error) {
        console.warn('设置效果失败:', error)
      }
    }

    // 设置透明度和混合模式
    if (element.opacity !== undefined) {
      setProperty('opacity', element.opacity)
    }
    if (element.blendMode !== undefined) {
      try {
        if ('blendMode' in node) {
          node.blendMode = this.convertBlendMode(element.blendMode)
        }
      } catch (error) {
        console.warn('设置混合模式失败:', error)
      }
    }

    // 设置布局约束
    if (element.constraints) {
      try {
        if ('constraints' in node) {
          node.constraints = this.convertConstraints(element.constraints)
        }
      } catch (error) {
        console.warn('设置约束失败:', error)
      }
    }
    
    // alignSelf/flexGrow/layoutSizingHorizontal 是子元素在父布局中的行为，
    // 必须无条件设置（不依赖元素自身的 layoutMode）
    // 同时加入延迟队列：这些属性在节点加入文档后需二次设置以确保生效
    if (element.layoutAlign) {
      setProperty('layoutAlign', element.layoutAlign, true)
    }
    if (element.alignSelf) {
      setProperty('alignSelf', element.alignSelf, true)
    }
    if (element.flexGrow !== undefined) {
      setProperty('flexGrow', element.flexGrow, true)
    }
    if (element.layoutSizingHorizontal) {
      setProperty('layoutSizingHorizontal', element.layoutSizingHorizontal, true)
    }
    if (element.layoutSizingVertical) {
      setProperty('layoutSizingVertical', element.layoutSizingVertical, true)
    }
  }

  /**
   * 重新应用帧/组件的布局属性（用于节点加入文档后的二次设置）
   */
  private static applyFrameLayoutProps(node: any, element: any): void {
    applyFrameLayoutPropsFn(node, element, {
      convertLayoutMode: (m) => this.convertLayoutMode(m),
      convertMainAxisAlignItems: (a) => this.convertMainAxisAlignItems(a),
      convertCrossAxisAlignItems: (a) => this.convertCrossAxisAlignItems(a),
      convertCrossAxisAlignContent: (a) => this.convertCrossAxisAlignContent(a),
      convertFlexWrap: (w) => this.convertFlexWrap(w),
    })
  }

  /**
   * 渲染矩形
   */
  private static renderRectangle(element: RectangleElement, isInAutoLayout: boolean = false): any {
    const rect = mg.createRectangle()
    
    // 设置基本属性
    rect.name = element.name

    // 应用公共属性
    this.applyCommonProperties(rect, element, isInAutoLayout)

    // 设置圆角（矩形专用属性）
    if (element.cornerRadius !== undefined) {
      rect.cornerRadius = element.cornerRadius
    }
    if (element.cornerSmooth !== undefined) {
      rect.cornerSmooth = element.cornerSmooth
    }
    if (element.topLeftRadius !== undefined) {
      rect.topLeftRadius = element.topLeftRadius
    }
    if (element.topRightRadius !== undefined) {
      rect.topRightRadius = element.topRightRadius
    }
    if (element.bottomLeftRadius !== undefined) {
      rect.bottomLeftRadius = element.bottomLeftRadius
    }
    if (element.bottomRightRadius !== undefined) {
      rect.bottomRightRadius = element.bottomRightRadius
    }

    return rect
  }

  /**
   * 渲染文本
   */
  private static renderText(element: TextElement, isInAutoLayout: boolean = false): any {
    const text = mg.createText()
    
    // 设置基本属性
    text.name = element.name

    // 设置内容 - 兼容 content 和 characters 两种字段名
    const textContent = element.content || (element as any).characters || ''
    text.characters = textContent

    const textLen = textContent.length

    // 设置字体大小 (use setRangeFontSize as TextNode has no direct fontSize property)
    if (element.fontSize !== undefined && textLen > 0 && typeof text.setRangeFontSize === 'function') {
      text.setRangeFontSize(0, textLen, element.fontSize)
    }

    // 设置字体名称 (use setRangeFontName as TextNode has no direct fontName property)
    if (element.fontName && textLen > 0 && typeof text.setRangeFontName === 'function') {
      // 确保使用的字体样式已加载，否则回退
      const fontName = { ...element.fontName }
      if (!this.loadedFontStyles.has(fontName.style)) {
        const fallback = this.getFallbackFontStyle(fontName.style)
        if (fallback) {
          console.warn(`字体 "${fontName.family} ${fontName.style}" 未加载，回退到 "${fallback}"`)
          fontName.style = fallback
        }
      }
      text.setRangeFontName(0, textLen, fontName)
    } else {
      const fontStyle = element.fontWeight !== undefined
        ? this.getFontStyle(element.fontWeight)
        : 'Regular'
      const defaultFontName = {
        family: 'Inter',
        style: fontStyle
      }
      if (textLen > 0 && typeof text.setRangeFontName === 'function') {
        text.setRangeFontName(0, textLen, defaultFontName)
      }
    }

    // 设置行高 (use setRangeLineHeight)
    if (element.lineHeight !== undefined && textLen > 0 && typeof text.setRangeLineHeight === 'function') {
      // DSL 允许 number | { value, unit }，MasterGo 只接受 { value, unit } | { unit: 'AUTO' }
      const lh: LineHeight = typeof element.lineHeight === 'number'
        ? { value: element.lineHeight, unit: 'PIXELS' }
        : element.lineHeight.unit === 'AUTO'
          ? { unit: 'AUTO' }
          : { value: element.lineHeight.value ?? 0, unit: element.lineHeight.unit === 'PERCENT' ? 'PERCENT' : 'PIXELS' }
      text.setRangeLineHeight(0, textLen, lh)
    }

    // 设置字间距 (use setRangeLetterSpacing)
    if (element.letterSpacing !== undefined && textLen > 0 && typeof text.setRangeLetterSpacing === 'function') {
      const ls: LetterSpacing = typeof element.letterSpacing === 'number'
        ? { value: element.letterSpacing, unit: 'PIXELS' }
        : {
            value: element.letterSpacing.value ?? 0,
            unit: String(element.letterSpacing.unit).toUpperCase() === 'PERCENT' ? 'PERCENT' : 'PIXELS',
          }
      text.setRangeLetterSpacing(0, textLen, ls)
    }

    // 设置对齐方式
    if (element.textAlignHorizontal !== undefined) {
      text.textAlignHorizontal = element.textAlignHorizontal
    }
    if (element.textAlignVertical !== undefined) {
      text.textAlignVertical = element.textAlignVertical
    }

    // 设置文本自动调整大小模式
    if (element.textAutoResize !== undefined) {
      text.textAutoResize = element.textAutoResize
    }

    // 设置段落间距
    if (element.paragraphSpacing !== undefined) {
      text.paragraphSpacing = element.paragraphSpacing
    }

    // 设置文本装饰
    if (element.textDecoration !== undefined && textLen > 0 && typeof text.setRangeTextDecoration === 'function') {
      text.setRangeTextDecoration(0, textLen, element.textDecoration as TextDecoration)
    }

    // 设置文本大小写
    if (element.textCase !== undefined && textLen > 0 && typeof text.setRangeTextCase === 'function') {
      text.setRangeTextCase(0, textLen, element.textCase as TextCase)
    }

    // 应用公共属性（位置、旋转、填充、效果、透明度、混合模式、约束等）
    this.applyCommonProperties(text, element, isInAutoLayout)

    // 应用文本分段着色（如 <p> 中包含 <span> 的不同颜色）
    if (element.textSegments && textLen > 0 && typeof text.setRangeFills === 'function') {
      for (const seg of element.textSegments) {
        const start = Math.max(0, seg.start)
        const end = Math.min(textLen, seg.end)
        if (start >= end) continue
        const converted = this.convertFills(seg.fills, element)
        text.setRangeFills(start, end, converted)
      }
    }

    return text
  }

  /**
   * 渲染椭圆
   */
  private static renderEllipse(element: EllipseElement, isInAutoLayout: boolean = false): any {
    const ellipse = mg.createEllipse()
    
    // 设置基本属性
    ellipse.name = element.name

    // 应用公共属性
    this.applyCommonProperties(ellipse, element, isInAutoLayout)

    return ellipse
  }

  /**
   * 渲染多边形
   */
  private static renderPolygon(element: PolygonElement, isInAutoLayout: boolean = false): any {
    const polygon = mg.createPolygon()
    
    // 设置基本属性
    polygon.name = element.name

    // 设置边数（多边形专用属性）
    if (element.pointCount !== undefined) {
      polygon.pointCount = element.pointCount
    }

    // 应用公共属性
    this.applyCommonProperties(polygon, element, isInAutoLayout)

    // 设置圆角（多边形专用属性）
    if (element.cornerRadius !== undefined) {
      polygon.cornerRadius = element.cornerRadius
    }

    return polygon
  }

  /**
   * 渲染星形
   */
  private static renderStar(element: StarElement, isInAutoLayout: boolean = false): any {
    const star = mg.createStar()
    
    // 设置基本属性
    star.name = element.name

    // 设置星角数量（星形专用属性）
    if (element.pointCount !== undefined) {
      star.pointCount = element.pointCount
    }

    // 设置内径比例（星形专用属性）
    if (element.innerRadius !== undefined) {
      star.innerRadius = element.innerRadius
    }

    // 应用公共属性
    this.applyCommonProperties(star, element, isInAutoLayout)

    return star
  }

  /**
   * 渲染线条
   */
  private static renderLine(element: LineElement, _isInAutoLayout: boolean = false): any {
    const line = mg.createLine()
    
    // 设置基本属性
    line.name = element.name

    // 设置位置和尺寸
    if (element.position) {
      line.x = element.position.x ?? 0
      line.y = element.position.y ?? 0
    }
    if (element.size) {
      if (element.size.width !== undefined) line.width = element.size.width
      // LineNode.height 在 MasterGo 类型上是只读的，但运行时可变
      if (element.size.height !== undefined) (line as any).height = element.size.height
    }

    // 设置描边（线条必须设置描边）
    if (element.strokes && element.strokes.length > 0) {
      line.strokes = this.convertStrokes(element.strokes, element)
    } else {
      // 默认黑色描边
      line.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]
    }

    // 设置线条宽度
    if (element.strokeWidth !== undefined) {
      line.strokeWeight = element.strokeWidth
    } else {
      line.strokeWeight = 1
    }

    // 设置描边端点样式（线条专用属性）
    if (element.strokeCap !== undefined) {
      line.strokeCap = this.convertStrokeCap(element.strokeCap)
    }

    // 设置描边连接样式（线条专用属性）
    if (element.strokeJoin !== undefined) {
      line.strokeJoin = element.strokeJoin
    }

    // 应用其他公共属性（透明度、可见性、旋转、效果、约束、混合模式）
    if (element.isVisible !== undefined) {
      line.isVisible = element.isVisible
    }
    if (element.isLocked !== undefined) {
      line.isLocked = element.isLocked
    }
    if (element.rotation !== undefined) {
      line.rotation = element.rotation
    }
    if (element.opacity !== undefined) {
      line.opacity = element.opacity
    }
    if (element.effects && element.effects.length > 0) {
      try {
        if ('effects' in line) {
          line.effects = this.convertEffects(element.effects)
        }
      } catch (error) {
        console.warn('设置效果失败:', error)
      }
    }
    if (element.constraints) {
      const constraints = this.convertConstraints(element.constraints)
      if (constraints) line.constraints = constraints
    }
    if (element.blendMode !== undefined) {
      line.blendMode = this.convertBlendMode(element.blendMode)
    }

    return line
  }

  /**
   * 渲染连接线
   * 支持节点绑定（endpointNodeId）和自由坐标两种模式
   */
  private static renderConnector(element: any): any {
    const connector = mg.createConnector()
    connector.name = element.name

    // 设置起点
    if (element.connectorStart) {
      const start = element.connectorStart
      if (start.endpointNodeId) {
        try {
          const node = mg.getNodeById(start.endpointNodeId)
          if (node) (connector as any).connectorStart = { endpointNodeId: node, magnet: start.magnet || 'AUTO' }
        } catch { /* 忽略无效的节点引用 */ }
      }
      if (start.x !== undefined && start.y !== undefined && !(connector as any).connectorStart) {
        (connector as any).connectorStart = { x: start.x, y: start.y }
      }
    }

    // 设置终点
    if (element.connectorEnd) {
      const end = element.connectorEnd
      if (end.endpointNodeId) {
        try {
          const node = mg.getNodeById(end.endpointNodeId)
          if (node) (connector as any).connectorEnd = { endpointNodeId: node, magnet: end.magnet || 'AUTO' }
        } catch { /* 忽略无效的节点引用 */ }
      }
      if (end.x !== undefined && end.y !== undefined && !(connector as any).connectorEnd) {
        (connector as any).connectorEnd = { x: end.x, y: end.y }
      }
    }

    // 设置连线类型/箭头/描边/宽度（统一包裹防止 MasterGo setter 抛异常）
    try {
      if (element.connectorLineType) (connector as any).connectorLineType = element.connectorLineType
      if (element.connectorStartStrokeCap) (connector as any).connectorStartStrokeCap = this.convertStrokeCap(element.connectorStartStrokeCap)
      if (element.connectorEndStrokeCap) (connector as any).connectorEndStrokeCap = this.convertStrokeCap(element.connectorEndStrokeCap)
      if (element.strokes && element.strokes.length > 0) {
        connector.strokes = this.convertStrokes(element.strokes, element)
      } else {
        connector.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]
      }
      connector.strokeWeight = element.strokeWeight ?? element.strokeWidth ?? 1
    } catch { /* ignore: connector 属性 setter 可能因节点状态不支持 */ }

    // 公共属性
    this.applyCommonProperties(connector, element, false)

    return connector
  }

  /**
   * 渲染Pen（路径）元素
   */
  private static renderPen(element: PenElement, isInAutoLayout: boolean = false): any {
    const pen = mg.createPen()
    
    // 设置基本属性
    pen.name = element.name

    // 路径绕排规则：优先使用元素指定的，默认 Nonzero（MasterGo 枚举为 Nonzero/Evenodd）
    const windingRule: WindingRule = String(element.windingRule || '').toLowerCase() === 'evenodd' ? 'Evenodd' : 'Nonzero'

    // 设置路径数据：支持三种格式
    if (element.svgPathData) {
      // 1. svgPathData（SVG path d 属性字符串）
      pen.penPaths = [{
        windingRule,
        data: element.svgPathData
      }]
    } else if (typeof element.pathData === 'string' && element.pathData.length > 0) {
      // 2. pathData 是 SVG 命令字符串（如 "M6,84 L6,36..."），直接使用
      pen.penPaths = [{
        windingRule,
        data: element.pathData
      }]
    } else if (Array.isArray(element.pathData) && element.pathData.length > 0) {
      // 3. pathData 是路径点对象数组，转换为 SVG 格式
      const pathDataString = this.convertPathDataToSVG(element.pathData, element.isClosed ?? false)
      pen.penPaths = [{
        windingRule,
        data: pathDataString
      }]
    }

    // 应用公共属性
    this.applyCommonProperties(pen, element, isInAutoLayout)

    // 设置描边端点样式
    if (element.strokeCap !== undefined) {
      pen.strokeCap = this.convertStrokeCap(element.strokeCap)
    }

    // 设置描边连接样式
    if (element.strokeJoin !== undefined) {
      pen.strokeJoin = element.strokeJoin
    }

    return pen
  }

  /**
   * 渲染 SVG 元素（通过 mg.createNodeFromSvgAsync 导入完整 SVG）
   * 相比 pen.penPaths 方式，直接导入 SVG 可以避免路径变形
   */
  private static async renderSvg(element: SvgElement, isInAutoLayout: boolean = false): Promise<any> {
    if (!element.svgContent) {
      console.warn(`SVG 元素 "${element.name}" 缺少 svgContent，跳过渲染`)
      return null
    }

    let node: any
    try {
      node = await mg.createNodeFromSvgAsync(element.svgContent)
    } catch (error) {
      console.error(`SVG 元素 "${element.name}" 导入失败:`, error)
      return null
    }

    if (!node) return null

    // 设置名称
    node.name = element.name

    // 存储图表配置元数据（供导出时还原 chart 标签）
    if (element.chartOption) {
      try { node.setPluginData('chartOption', element.chartOption) } catch (err) { console.error('[DSLRenderer] 写入 chartOption pluginData 失败（仅影响导出还原图表）:', err) }
    }

    // 应用公共属性（尺寸、位置、透明度、效果等）
    this.applyCommonProperties(node, element, isInAutoLayout)

    return node
  }

  /**
   * 渲染布尔运算元素
   */
  private static async renderBooleanOperation(element: BooleanOperationElement, isInAutoLayout: boolean = false): Promise<any> {
    // 先渲染所有子元素
    const childNodes: any[] = []
    if (element.children && element.children.length > 0) {
      for (const child of element.children) {
        const childNode = await this.renderElement(child, undefined, 20, 0, isInAutoLayout)
        if (childNode) {
          childNodes.push(childNode)
        }
      }
    }

    // 根据布尔运算类型创建节点
    let boolOp: any
    try {
      if (childNodes.length < 2) {
        // 兼容性处理：如果子元素不足，创建一个矩形作为占位
        const rect = mg.createRectangle()
        rect.width = element.size?.width || 100
        rect.height = element.size?.height || 100
        boolOp = rect
      } else {
        switch (element.booleanOperation) {
          case 'UNION':
            boolOp = mg.union(childNodes)
            break
          case 'SUBTRACT':
            boolOp = mg.subtract(childNodes)
            break
          case 'INTERSECT':
            boolOp = mg.intersect(childNodes)
            break
          case 'EXCLUDE':
            boolOp = mg.exclude(childNodes)
            break
          default:
            throw new Error(`不支持的布尔运算类型: ${element.booleanOperation}`)
        }
      }
    } catch (error) {
      console.warn('创建布尔运算节点失败:', error)
    }

    // 如果布尔运算节点创建失败，返回一个默认的矩形
    if (!boolOp) {
      console.warn('布尔运算节点创建失败，返回默认矩形')
      const rect = mg.createRectangle()
      rect.width = element.size?.width || 100
      rect.height = element.size?.height || 100
      boolOp = rect
    }

    // 设置名称
    boolOp.name = element.name

    // 应用公共属性
    this.applyCommonProperties(boolOp, element, isInAutoLayout)

    return boolOp
  }

  /**
   * 渲染组元素
   */
  private static async renderGroup(
    element: GroupElement,
    isInAutoLayout: boolean = false,
    maxDepth: number = 20,
    currentDepth: number = 0
  ): Promise<any> {
    // MasterGo 没有 createGroup，需先渲染出子节点再 mg.group(nodes) 成组
    const childNodes: SceneNode[] = []
    if (element.children && element.children.length > 0) {
      for (const child of element.children) {
        const childNode = await this.renderElement(child, undefined, maxDepth, currentDepth + 1)
        if (childNode) childNodes.push(childNode)
      }
    }

    if (childNodes.length === 0) return null

    const group = childNodes.length === 1 ? childNodes[0] : mg.group(childNodes)

    // 设置基本属性
    if ('name' in group) group.name = element.name

    // 应用公共属性
    this.applyCommonProperties(group, element, isInAutoLayout)

    return group
  }

  /**
   * 渲染框架元素
   */
  private static async renderFrame(
    element: FrameElement,
    maxDepth: number = 20,
    currentDepth: number = 0,
    isInAutoLayout: boolean = false
  ): Promise<any> {
    const frame = mg.createFrame()
    
    // 设置基本属性
    frame.name = element.name

    // 设置圆角
    if (element.cornerRadius !== undefined) {
      frame.cornerRadius = element.cornerRadius
    }
    if (element.topLeftRadius !== undefined) {
      frame.topLeftRadius = element.topLeftRadius
    }
    if (element.topRightRadius !== undefined) {
      frame.topRightRadius = element.topRightRadius
    }
    if (element.bottomLeftRadius !== undefined) {
      frame.bottomLeftRadius = element.bottomLeftRadius
    }
    if (element.bottomRightRadius !== undefined) {
      frame.bottomRightRadius = element.bottomRightRadius
    }

    // 先应用公共属性（fills/effects 等）
    this.applyCommonProperties(frame, element, isInAutoLayout)

    // 设置布局属性（必须在子元素渲染之前设置，确保子元素创建时父级已具备 flexMode）
    this.applyFrameLayoutProps(frame, element)

    // 记录帧级布局属性，等待节点加入文档后二次应用
    this.pendingFrameLayouts.push({ node: frame, element })

    // 若 frame 带有 svgContent，通过 mg.createNodeFromSvgAsync 创建 SVG 子节点，并缩放到内容区域
    if (element.svgContent) {
      try {
        const paddingL = element.paddingLeft ?? 0
        const paddingR = element.paddingRight ?? 0
        const paddingT = element.paddingTop ?? 0
        const paddingB = element.paddingBottom ?? 0
        const contentW = Math.max(1, (element.size?.width ?? 24) - paddingL - paddingR)
        const contentH = Math.max(1, (element.size?.height ?? 24) - paddingT - paddingB)

        const svgNode: any = await mg.createNodeFromSvgAsync(element.svgContent)
        if (svgNode) {
          svgNode.name = element.name || 'icon'
          svgNode.x = paddingL
          svgNode.y = paddingT
          frame.appendChild(svgNode)

          // 对 GROUP 类型使用 relativeTransform 缩放（直接设 width/height 对 GROUP 不生效）
          if (svgNode.type === 'GROUP' && svgNode.width > 0 && svgNode.height > 0) {
            const scaleX = contentW / svgNode.width
            const scaleY = contentH / svgNode.height
            if (Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01) {
              svgNode.relativeTransform = [[scaleX, 0, 0], [0, scaleY, 0]]
            }
          }
        }
      } catch (error) {
        console.warn(`Frame "${element.name}" SVG 导入失败:`, error)
      }
    }

    // 渲染子元素（此时父级已有完整布局属性，子节点的 flexGrow/layoutSizingHorizontal 等可正确生效）
    if (element.children && element.children.length > 0) {
      const parentIsAutoLayout = element.layoutMode && element.layoutMode !== 'NONE'
      for (const child of element.children) {
        const childNode = await this.renderElement(child, undefined, maxDepth, currentDepth + 1, parentIsAutoLayout)
        if (childNode) {
          frame.appendChild(childNode)
        }
      }
    }

    // 响应式断点信息（存为 pluginData 供代码导出使用；MasterGo 用 setPluginData(key, value)）
    if ((element as any).breakpoints) {
      try {
        frame.setPluginData('breakpoints', JSON.stringify({ breakpoints: (element as any).breakpoints }))
      } catch (err) {
        // 非致命：断点信息只影响代码导出，不阻塞画布渲染
        console.error('[DSLRenderer] 写入 breakpoints pluginData 失败:', err)
      }
    }

    return frame
  }

  /**
   * 导入团队组件库组件（按 ukey）。
   * 组件集自动落到指定 variant（componentVariant）或第一个 COMPONENT 子节点。
   * API 缺失或导入失败时返回 null，由调用方回退到 componentId / componentName / 占位 frame。
   */
  private static async importTeamComponent(element: InstanceElement): Promise<any> {
    const api = mg as any
    if (typeof api.importComponentByKeyAsync !== 'function') {
      console.warn('[DSLRenderer] 当前环境不支持团队库导入 API，跳过 componentUkey')
      return null
    }

    let node: any = null
    try {
      node = await api.importComponentByKeyAsync(element.componentUkey)
    } catch (err) {
      if (typeof api.importComponentSetByKeyAsync !== 'function') {
        console.warn(`[DSLRenderer] 团队组件导入失败 (ukey=${element.componentUkey}):`, err)
        return null
      }
      try {
        node = await api.importComponentSetByKeyAsync(element.componentUkey)
      } catch (err2) {
        console.warn(`[DSLRenderer] 团队组件导入失败 (ukey=${element.componentUkey}):`, err2)
        return null
      }
    }

    if (!node) return null

    if (node.type === 'COMPONENT_SET') {
      const children: any[] = node.children || []
      const wanted = element.componentVariant ? String(element.componentVariant).toLowerCase() : ''
      const variant =
        (wanted && children.find((c: any) => String(c.name || '').toLowerCase().includes(wanted))) ||
        children.find((c: any) => c.type === 'COMPONENT')
      if (!variant) {
        console.warn(`[DSLRenderer] 组件集 "${node.name}" 无可用 variant`)
        return null
      }
      node = variant
    }

    return typeof node.createInstance === 'function' ? node : null
  }

  /**
   * 换组件：把画布上已存在的实例主组件替换为 element 指定的组件（不新建节点）
   *
   * HTML 用法：
   * ```html
   * <div data-swap-node-id="1:2" data-library-ukey="ukey:xxx" data-swap-keep-size="true"></div>
   * <div data-swap-node-id="1:2,3:4" data-component-id="Component:abc"></div>
   * ```
   * 目标组件解析顺序与 MCP 工具 node_swap_component 一致（componentId → ukey → componentName），
   * 与换组件工具共享同一套实现（applyComponentSwap）。
   * 换组件不产生新节点，因此返回 void 且由调用方返回 null（不会被 appendChild 到页面根）。
   */
  private static async swapExistingInstances(element: InstanceElement): Promise<void> {
    try {
      const summary = await applyComponentSwap({
        nodeIds: element.swapNodeIds,
        componentId: element.componentId,
        ukey: element.componentUkey,
        component: element.componentName,
        library: element.componentLibrary,
        variant: element.componentVariant,
        variantProperties: element.variantProperties,
        resetOverrides: element.swapResetOverrides === true,
        // 显式覆写（data-override-*）在换组件后同样生效，且优先级高于按图层名继承来的覆写
        overrides: element.overrides,
        // 不传时保持 undefined，让 applyComponentSwap 按目标类型取默认（实例：不保持；非实例：保持原宽高）
        keepSize: element.swapKeepSize,
        keepOriginal: element.swapKeepOriginal === true,
      })
      console.log(`[DSLRenderer] 换组件 「${element.name || ''}」: ${summary.summary}`)

      // 换组件的告警与失败也是"看起来成功、其实没生效"的高发区：汇总进渲染报告，不只打 console
      const issues: string[] = []
      for (const warning of summary.warnings || []) {
        issues.push(warning)
      }
      for (const result of summary.results) {
        if (!result.success) {
          issues.push(`换组件失败 ${result.nodeId} ${result.name}: ${result.error}`)
        }
      }
      for (const issue of issues) {
        DSLRenderer.noteRenderIssue(`换组件 「${element.name || ''}」: ${issue}`)
      }
      if (issues.length > 0) {
        console.warn(`[DSLRenderer] 换组件出现 ${issues.length} 项问题：\n - ${issues.join('\n - ')}`)
      }
    } catch (err: any) {
      console.warn(
        `[DSLRenderer] 换组件失败 (${(element.swapNodeIds || []).join(',')}): ${err?.message || err}`,
      )
    }
  }

  /**
   * 渲染实例元素：从 Component Master 创建 Instance
   */
  private static async renderInstance(
    element: InstanceElement,
    isInAutoLayout: boolean = false
  ): Promise<any> {
    // Swap 模式：data-swap-node-id 指向已有实例 → 换主组件，不新建节点
    if (element.swapNodeIds && element.swapNodeIds.length > 0) {
      await DSLRenderer.swapExistingInstances(element)
      return null
    }

    let component: any = null

    // Priority 0: componentUkey → 团队组件库导入（mg.importComponentByKeyAsync）
    if (element.componentUkey) {
      component = await DSLRenderer.importTeamComponent(element)
      if (component) {
        console.log(`[DSLRenderer] 团队组件已导入: ${component.name} (ukey=${element.componentUkey})`)
      }
    }

    // Priority 1: componentId → direct node lookup
    if (!component && element.componentId) {
      component = mg.getNodeById(element.componentId)
      if (!component || typeof component.createInstance !== 'function') {
        console.warn(`[DSLRenderer] Component by id "${element.componentId}" not found for "${element.name}"`)
        component = null
      }
    }

    // Priority 2: componentName → search all pages for COMPONENT with matching name
    if (!component && element.componentName) {
      const pages = mg.document.children
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i]
        const found = page.findAll((n: any) =>
          n.type === 'COMPONENT' && n.name === element.componentName
        )
        if (found && found.length > 0) {
          component = found[0]
          break
        }
      }
      if (component) {
        console.log(`[DSLRenderer] Found component by name "${element.componentName}": ${component.id}`)
      } else {
        console.warn(`[DSLRenderer] Component by name "${element.componentName}" not found for "${element.name}"`)
      }
    }

    // Fallback: no component found → create frame as placeholder
    if (!component) {
      console.warn(`[DSLRenderer] No component found for instance "${element.name}", falling back to frame`)
      if (element.overrides && Object.keys(element.overrides).length > 0) {
        DSLRenderer.noteRenderIssue(
          `实例 「${element.name || ''}」未找到组件（已降级为占位 frame），${Object.keys(element.overrides).length} 组子图层覆写未生效`,
        )
      }
      const frame = mg.createFrame()
      frame.name = element.name || (element.componentUkey || element.componentId || element.componentName || 'Instance')
      if (element.size && (element.size.width !== undefined || element.size.height !== undefined)) {
        ;(frame as any).resize(element.size.width ?? frame.width, element.size.height ?? frame.height)
      }
      this.applyCommonProperties(frame, element, isInAutoLayout)
      return frame
    }

    const instance = component.createInstance()
    instance.name = element.name || component.name

    if (element.position) {
      instance.x = element.position.x ?? 0
      instance.y = element.position.y ?? 0
    }

    if (element.size) {
      instance.resize(element.size.width || instance.width, element.size.height || instance.height)
    }

    // 组件集 variant 属性覆写
    if (element.variantProperties && typeof instance.setVariantPropertyValues === 'function') {
      try {
        instance.setVariantPropertyValues(element.variantProperties)
      } catch (err) {
        console.warn(`[DSLRenderer] setVariantPropertyValues failed for "${instance.name}":`, err)
      }
    }

    this.applyCommonProperties(instance, element, isInAutoLayout)

    // 实例子节点覆写（`data-override-*` → DSL `overrides`）：按子图层名设置 text / fill / visible。
    // 与换组件路径共用 applyInstanceOverrides —— 同一套语义（含非法 fill 拒绝与降级上报）。
    if (element.overrides) {
      applyInstanceOverrides(instance, element.overrides, (skip) => {
        DSLRenderer.noteRenderIssue(
          `实例 「${instance.name || element.name || ''}」: ${skip.message}`,
        )
      })
    }

    return instance
  }

  /**
    * 渲染组件元素
    */
  private static async renderComponent(
    element: ComponentElement,
    maxDepth: number = 20,
    currentDepth: number = 0,
    isInAutoLayout: boolean = false
  ): Promise<any> {
    const component = mg.createComponent()
    
    // 设置基本属性
    component.name = element.name

    // 设置圆角
    if (element.cornerRadius !== undefined) {
      component.cornerRadius = element.cornerRadius
    }
    if (element.topLeftRadius !== undefined) {
      component.topLeftRadius = element.topLeftRadius
    }
    if (element.topRightRadius !== undefined) {
      component.topRightRadius = element.topRightRadius
    }
    if (element.bottomLeftRadius !== undefined) {
      component.bottomLeftRadius = element.bottomLeftRadius
    }
    if (element.bottomRightRadius !== undefined) {
      component.bottomRightRadius = element.bottomRightRadius
    }

    // 设置组件元数据
    if (element.alias) {
      try { component.alias = element.alias } catch (err) { console.error('[DSLRenderer] 写入 component.alias 失败:', err) }
    }
    if (element.description) {
      try { component.description = element.description } catch (err) { console.error('[DSLRenderer] 写入 component.description 失败:', err) }
    }

    // 先应用公共属性（fills/effects 等必须在 appendChild 之前设置）
    this.applyCommonProperties(component, element, isInAutoLayout)

    // 设置布局属性（必须在子元素渲染之前设置，确保子元素创建时父级已具备 flexMode）
    this.applyFrameLayoutProps(component, element)

    // 记录帧级布局属性，等待节点加入文档后二次应用
    this.pendingFrameLayouts.push({ node: component, element })

    // 渲染子元素（此时父级已有完整布局属性，子元素的 flexGrow/layoutSizingHorizontal 等可正确生效）
    if (element.children && element.children.length > 0) {
      const parentIsAutoLayout = element.layoutMode && element.layoutMode !== 'NONE'
      for (const child of element.children) {
        const childNode = await this.renderElement(child, undefined, maxDepth, currentDepth + 1, parentIsAutoLayout)
        if (childNode) {
          component.appendChild(childNode)
        }
      }
    }

    return component
  }

  /**
   * 渲染模板引用
   */
  private static renderTemplateRef(element: TemplateRefElement): any {
    return renderTemplateRefFn(element, (el) => this.renderElement(el))
  }

  /**
   * 渲染模板定义
   */
  private static renderTemplate(element: TemplateElement): any {
    return renderTemplateFn(element, (el) => this.renderElement(el))
  }

  /**
   * 渲染生成器
   */
  private static async renderGenerator(element: GeneratorElement, parentIsInAutoLayout?: boolean): Promise<any> {
    return renderGeneratorFn(element, parentIsInAutoLayout, (el, pl) => this.renderUIComponent(el, pl))
  }

  /**
   * 渲染 UI 组件（通过 componentHandlers 创建）
   * generatorType='component' 时调用，将 DSL 的 config 参数传递给 handleComponentRender
   *
   * 注意：handleComponentRender 是异步的，必须 await 才能拿到创建出的节点引用。
   */
  private static async renderUIComponent(element: GeneratorElement, parentIsInAutoLayout?: boolean): Promise<any> {
    const config = element.config || {}
    if (!config.componentType) {
      console.warn(`UI 组件 "${element.name}" 缺少 componentType`)
      return null
    }

    const params: any = {
      type: config.componentType,
      name: element.name,
      label: config.label,
      placeholder: config.placeholder,
      variant: config.variant,
      items: config.items,
      percent: config.percent,
      checked: config.checked,
      initial: config.initial,
      title: config.title,
      content: config.content,
      current: config.current,
      total: config.total,
      closable: config.closable,
      separator: config.separator,
      activeIndex: config.activeIndex,
      direction: config.direction,
      bordered: config.bordered,
      showTrack: config.showTrack,
      options: config.options,
      states: config.states,
      bgColor: config.bgColor,
      fillColor: config.fillColor,
      color: config.color,
      showLabel: config.showLabel,
      showCancel: config.showCancel,
      activeBg: config.activeBg,
      size: config.width || config.height ? { width: config.width, height: config.height } : undefined,
      position: element.position ? { x: element.position.x, y: element.position.y } : undefined,
    }

    try {
      const result = await handleComponentRender(params)
      if (result && result.success) {
        const rootKey = ['container', 'frame', 'divider', 'card', 'track'].find(k => result[k]?.id)
        if (rootKey) {
          const node = mg.getNodeById(result[rootKey].id)
          if (node) {
            if (parentIsInAutoLayout) {
              if ('x' in node) node.x = 0
              if ('y' in node) node.y = 0
            }
            return node
          }
        }
      }
    } catch (error) {
      console.error(`渲染 UI 组件 "${element.name}" (${config.componentType}) 失败:`, error)
    }
    return null
  }

  /**
   * 渲染树形结构组件
   */
  private static renderTree(element: TreeElement): any {
    return renderTreeFn(element, (el) => this.renderElement(el))
  }

  /**
   * 将 DSL 路径数据转换为 SVG path data 格式
   */
  private static convertPathDataToSVG(pathData: any[], isClosed: boolean): string {
    if (pathData.length === 0) {
      return ''
    }

    const commands: string[] = []

    for (let i = 0; i < pathData.length; i++) {
      const point = pathData[i]

      if (i === 0) {
        // 第一个点，使用 M (move to)
        commands.push(`M ${point.x} ${point.y}`)
      } else {
        // 后续点，根据类型决定使用 L (line to) 还是 C (cubic bezier)
        if (point.pointType === 'CURVE' && (point.handleIn || point.handleOut)) {
          const prevPoint = pathData[i - 1]

          // 三次贝塞尔曲线：C cp1x cp1y cp2x cp2y x y
          // handleOut 是上一个点的出向控制点（绝对坐标）
          // handleIn 是当前点的入向控制点（绝对坐标）
          const cp1x = prevPoint.handleOut?.x ?? prevPoint.x
          const cp1y = prevPoint.handleOut?.y ?? prevPoint.y
          const cp2x = point.handleIn?.x ?? point.x
          const cp2y = point.handleIn?.y ?? point.y

          commands.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${point.x} ${point.y}`)
        } else {
          // 直线：L x y
          commands.push(`L ${point.x} ${point.y}`)
        }
      }
    }

    // 如果需要闭合路径，添加 Z 命令
    if (isClosed) {
      commands.push('Z')
    }

    return commands.join(' ')
  }

  /**
   * 转换填充样式
   * 支持标准 MasterGo 类型 (SOLID, GRADIENT_LINEAR, 等)
   * 以及简化的 GRADIENT 格式（type:'GRADIENT' + CSS 渐变色字符串，来自历史导出/手写 DSL）
   */
  private static convertFills(fills: any[], element?: SizeHint): any[] {
    return fills.map(fill => {
      const fillType = fill.type?.toUpperCase() || 'SOLID'
      
      // 处理简化的 GRADIENT 类型（含 CSS gradient 字符串）
      if (fillType === 'GRADIENT' && fill.color && typeof fill.color === 'string') {
        const cssGradient = fill.color.trim()
        if (cssGradient.startsWith('radial-gradient')) {
          const parsed = parseRadialGradient(cssGradient)
          if (parsed) {
            const nodeW = element?.width
            const nodeH = element?.height
            const cx = (parsed._centerOffsetX ?? 0) + 0.5
            const cy = (parsed._centerOffsetY ?? 0) + 0.5
            const sizeW = parsed._sizeW ?? Math.min(nodeW || 200, 200)
            const sizeH = parsed._sizeH ?? Math.min(nodeH || 200, 200)

            let transform: number[][]
            if (nodeW && nodeH && nodeW > 0 && nodeH > 0) {
              // handles at (0.5,0.5) center and (1,1) radius
              // user-intended: sx=2*sizeW/nodeW, tx=cx-sizeW/nodeW (x-axis)
              //                sy=2*sizeH/nodeH, ty=cy-sizeH/nodeH (y-axis, no x-compensation)
              // after nodeHandlers radial compensation: sx*=2, tx'=tx-sx/2
              const sx = 4 * sizeW / nodeW
              const tx = cx - 2 * sizeW / nodeW
              const sy = 2 * sizeH / nodeH
              const ty = cy - sizeH / nodeH
              transform = [[sx, 0, tx], [0, sy, ty]]
            } else {
              transform = [[2, 0, -0.5], [0, 1, 0]]
            }

            const stops = parsed.gradientStops.map((stop: any) => ({
              position: stop.position,
              color: processColor(stop.color),
            }))
            for (let i = 0; i < stops.length; i++) {
              if (stops[i].color.a === 0 && stops[i].color.r === 0 && stops[i].color.g === 0 && stops[i].color.b === 0) {
                let nearest = -1
                let minDist = Infinity
                for (let j = 0; j < stops.length; j++) {
                  if (j !== i && stops[j].color.a > 0) {
                    const dist = Math.abs(stops[j].position - stops[i].position)
                    if (dist < minDist) { minDist = dist; nearest = j }
                  }
                }
                if (nearest >= 0) {
                  stops[i].color.r = stops[nearest].color.r
                  stops[i].color.g = stops[nearest].color.g
                  stops[i].color.b = stops[nearest].color.b
                }
              }
            }

            const converted: any = {
              type: 'GRADIENT_RADIAL',
              gradientStops: stops,
              gradientHandlePositions: [
                { x: 0.5, y: 0.5 },
                { x: 1, y: 1 },
              ],
              transform,
              isVisible: fill.isVisible !== false,
              alpha: fill.alpha !== undefined ? fill.alpha : 1,
              blendMode: fill.blendMode || 'NORMAL',
            }
            return converted
          }
        }
        const parsed = parseCSSGradient(cssGradient)
        if (parsed) {
          const converted: any = {
            type: parsed.type,
            gradientStops: parsed.gradientStops.map((stop: any) => ({
              position: stop.position,
              color: processColor(stop.color),
            })),
            isVisible: fill.isVisible !== false,
            alpha: fill.alpha !== undefined ? fill.alpha : 1,
            blendMode: fill.blendMode || 'NORMAL',
          }

          converted.gradientHandlePositions = parsed.gradientHandlePositions || [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]
          converted.transform = fill.transform || [[1, 0, 0], [0, 1, 0]]

          return converted
        }
      }

      const converted: any = {
        type: fillType
      }

      if (converted.type === 'SOLID' && fill.color) {
        converted.color = processColor(fill.color)
      }
      else if ((converted.type === 'GRADIENT_LINEAR' || converted.type === 'GRADIENT_RADIAL' || converted.type === 'GRADIENT_ANGULAR' || converted.type === 'GRADIENT_DIAMOND') && fill.gradientStops) {
        converted.gradientStops = fill.gradientStops.map((stop: any) => ({
          position: stop.position,
          color: processColor(stop.color)
        }))
        if (fill.gradientHandlePositions) {
          converted.gradientHandlePositions = fill.gradientHandlePositions.map((pos: any) => {
            if (Array.isArray(pos)) return { x: pos[0], y: pos[1] }
            return pos
          })
        }
        // 始终包含 transform，与 nodeHandlers 一致
        // 注意：nodeHandlers.ts 中已有 GRADIENT_RADIAL 的 x2 补偿（对应 MasterGo 内部 x/2）
        // 此处不再重复补偿，避免双重补偿导致尺寸翻倍
        converted.transform = fill.transform || [[1, 0, 0], [0, 1, 0]]
        if (converted.type === 'GRADIENT_RADIAL') {
          console.log('[DSLRenderer] GRADIENT_RADIAL transform:', JSON.stringify(converted.transform))
          console.log('[DSLRenderer] GRADIENT_RADIAL handles:', JSON.stringify(converted.gradientHandlePositions))
        }
        converted.isVisible = fill.isVisible !== false
        converted.alpha = fill.alpha !== undefined ? fill.alpha : 1
        converted.blendMode = fill.blendMode || 'NORMAL'
      }
      else if (converted.type === 'IMAGE' && fill.imageUrl) {
        converted.imageRef = fill.imageUrl
        converted.scaleMode = fill.imageScaleMode || 'FILL'
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

  /**
   * 转换描边样式
   * 支持标准 MasterGo 类型以及简化的 GRADIENT 格式（同样来自历史导出/手写 DSL）
   */
  private static convertStrokes(strokes: any[], element?: SizeHint): any[] {
    return strokes.map(stroke => {
      const strokeType = stroke.type?.toUpperCase() || 'SOLID'

      // 处理简化的 GRADIENT 类型
      if (strokeType === 'GRADIENT' && stroke.color && typeof stroke.color === 'string') {
        const cssGradient = stroke.color.trim()
        const parsed = parseCSSGradient(cssGradient)
        if (parsed) {
          const converted: any = {
            type: parsed.type,
            gradientStops: parsed.gradientStops.map((stop: any) => ({
              position: stop.position,
              color: processColor(stop.color),
            })),
          }
          if (parsed.gradientHandlePositions) {
            converted.gradientHandlePositions = parsed.gradientHandlePositions
          }
          if (stroke.isVisible !== undefined) converted.isVisible = stroke.isVisible
          if (stroke.alpha !== undefined) converted.alpha = stroke.alpha
          if (stroke.blendMode) converted.blendMode = stroke.blendMode

          // 径向渐变中心偏移：通过 transform 矩阵实现
          if (parsed.type === 'GRADIENT_RADIAL' && parsed._centerOffsetX !== undefined && parsed._centerOffsetY !== undefined) {
            const w = element?.size?.width || 100
            const h = element?.size?.height || 100
            const dx = parsed._centerOffsetX * w
            const dy = parsed._centerOffsetY * h
            const sx = 1
            const tx = dx
            converted.transform = [[sx * 2, 0, tx - sx / 2], [0, 1, dy]]
            converted.gradientHandlePositions = [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 1 }]
          }

          return converted
        }
      }

      const converted: any = {
        type: strokeType
      }

      if (converted.type === 'SOLID' && stroke.color) {
        converted.color = processColor(stroke.color)
      }
      else if ((converted.type === 'GRADIENT_LINEAR' || converted.type === 'GRADIENT_RADIAL' || converted.type === 'GRADIENT_ANGULAR' || converted.type === 'GRADIENT_DIAMOND') && stroke.gradientStops) {
        converted.gradientStops = stroke.gradientStops.map((stop: any) => ({
          position: stop.position,
          color: processColor(stop.color)
        }))
        if (stroke.gradientHandlePositions) {
          converted.gradientHandlePositions = stroke.gradientHandlePositions
        }
        converted.transform = stroke.transform || [[1, 0, 0], [0, 1, 0]]
        if (converted.type === 'GRADIENT_RADIAL') {
          const sx = converted.transform[0][0]
          const tx = converted.transform[0][2]
          const sy = converted.transform[1][1]
          const ty = converted.transform[1][2]
          converted.transform = [[sx * 2, 0, tx - sx / 2], [0, sy, ty]]
        }
      }
      else if (converted.type === 'IMAGE' && stroke.imageUrl) {
        converted.imageRef = stroke.imageUrl
        converted.scaleMode = stroke.imageScaleMode || 'FILL'
        if (converted.scaleMode === 'CROP') {
          converted.ratio = stroke.imageRatio ?? 1
        }
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
   * 转换效果样式
   */
  private static convertEffects(effects: any[]): any[] {
    return convertEffectsFn(effects)
  }

  /**
   * 转换约束类型
   */
  private static convertConstraints(constraints?: { horizontal?: string; vertical?: string }): Constraints | undefined {
    // 如果没有提供约束，返回 undefined
    if (!constraints) {
      return undefined
    }

    // MasterGo API 支持的约束值
    const supportedValues = ['START', 'END', 'STARTANDEND', 'CENTER', 'SCALE']

    // 创建映射表
    const mapping: Record<string, string> = {
      // 水平约束映射
      'LEFT': 'START',
      'RIGHT': 'END',
      'LEFT_RIGHT': 'STARTANDEND',
      // 垂直约束映射
      'TOP': 'START',
      'BOTTOM': 'END',
      'TOP_BOTTOM': 'STARTANDEND'
      // CENTER 和 SCALE 不需要映射
    }

    // 转换水平约束
    let horizontal = constraints.horizontal
    if (horizontal && !supportedValues.includes(horizontal)) {
      horizontal = mapping[horizontal] || horizontal
    }

    // 转换垂直约束
    let vertical = constraints.vertical
    if (vertical && !supportedValues.includes(vertical)) {
      vertical = mapping[vertical] || vertical
    }

    return {
      horizontal: (horizontal || 'START') as ConstraintType,
      vertical: (vertical || 'START') as ConstraintType,
    }
  }

  /**
   * 转换布局模式
   */
  private static convertLayoutMode(layoutMode: string): string {
    // API 仅支持 NONE / VERTICAL / HORIZONTAL
    if (layoutMode === 'GRID') {
      console.warn('GRID layout mode is not supported by MasterGo API, falling back to NONE')
      return 'NONE'
    }
    const mapping: Record<string, string> = {
      'NONE': 'NONE',
      'VERTICAL': 'VERTICAL',
      'HORIZONTAL': 'HORIZONTAL'
    }
    return mapping[layoutMode] || layoutMode
  }

  /**
   * 转换主轴对齐方式
   */
  private static convertMainAxisAlignItems(alignItems: string): string {
    const mapping: Record<string, string> = {
      'MIN': 'FLEX_START',
      'CENTER': 'CENTER',
      'MAX': 'FLEX_END',
      'SPACE_BETWEEN': 'SPACING_BETWEEN',
      'SPACE_AROUND': 'SPACING_AROUND'
    }
    return mapping[alignItems] || alignItems
  }

  /**
   * 转换交叉轴对齐方式
   */
  private static convertCrossAxisAlignItems(alignItems: string): string {
    const mapping: Record<string, string> = {
      'MIN': 'FLEX_START',
      'CENTER': 'CENTER',
      'MAX': 'FLEX_END'
    }
    return mapping[alignItems] || alignItems
  }

  /**
   * 转换交叉轴内容对齐方式
   * API 支持值: 'AUTO' | 'SPACE_BETWEEN'
   */
  private static convertCrossAxisAlignContent(alignContent: string): string {
    // 只有 SPACE_BETWEEN 有明确映射，其他值映射为 AUTO
    if (alignContent === 'SPACE_BETWEEN') {
      return 'SPACE_BETWEEN'
    }
    return 'AUTO'
  }

  /**
   * 转换换行模式
   */
  private static convertFlexWrap(flexWrap: string): string {
    const mapping: Record<string, string> = {
      'NO_WRAP': 'NO_WRAP',
      'WRAP': 'WRAP'
    }
    return mapping[flexWrap] || flexWrap
  }

  /**
   * 转换混合模式
   */
  private static convertBlendMode(blendMode: string): BlendMode {
    return convertBlendModeFn(blendMode) as BlendMode
  }

  /**
   * 转换描边端点样式
   */
  private static convertStrokeCap(strokeCap: string): StrokeCap {
    // MasterGo API 支持的描边端点样式
    const supportedCaps = [
      'NONE', 'ROUND', 'SQUARE', 'LINE_ARROW', 'TRIANGLE_ARROW',
      'ROUND_ARROW', 'RING', 'DIAMOND', 'LINE'
    ]

    // 如果已经是支持的值，直接返回
    if (supportedCaps.includes(strokeCap)) {
      return strokeCap as StrokeCap
    }

    // 映射不兼容的值
    const capMapping: Record<string, StrokeCap> = {
      'STROKE': 'LINE',
      'ROUND_OUTSIDE': 'ROUND',
      'ARROW_EQUILATERAL': 'TRIANGLE_ARROW'
    }

    // 如果有映射，返回映射后的值
    if (capMapping[strokeCap]) {
      return capMapping[strokeCap]
    }

    // 如果都不匹配，返回 NONE 作为默认值
    console.warn(`不支持的描边端点样式: ${strokeCap}，将使用 NONE`)
    return 'NONE'
  }

  /**
   * 根据字重获取字体样式名称
   */
  // 获取已加载字体的回退样式
  private static getFallbackFontStyle(_requestedStyle: string): string | null {
    const preference = ['Bold', 'Medium', 'Regular', 'Semi Bold', 'Extra Bold']
    for (const style of preference) {
      if (this.loadedFontStyles.has(style)) {
        return style
      }
    }
    return null
  }

  private static getFontStyle(fontWeight: number): string {
    // 按优先级从高到低排列备选样式
    const candidates: Array<{ max: number; style: string }> = [
      { max: 400, style: 'Regular' },
      { max: 500, style: 'Medium' },
      { max: 600, style: 'Semi Bold' },
      { max: 700, style: 'Bold' },
      { max: Infinity, style: 'Extra Bold' }
    ]

    // 找到匹配字重对应的首选样式
    const preferred = candidates.find(c => fontWeight <= c.max)
    const preferredStyle = preferred ? preferred.style : 'Bold'

    // 如果首选样式已加载，直接使用
    if (this.loadedFontStyles.has(preferredStyle)) {
      return preferredStyle
    }

    // 否则按优先级回退到已加载字体
    const loadedPreference = ['Bold', 'Medium', 'Regular', 'Semi Bold', 'Extra Bold']
    for (const style of loadedPreference) {
      if (this.loadedFontStyles.has(style)) {
        console.warn(`字体 "${preferredStyle}" 未加载，回退到 "${style}"`)
        return style
      }
    }

    // 兜底
    return 'Regular'
  }
}