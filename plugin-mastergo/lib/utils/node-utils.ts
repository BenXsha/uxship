import { processColor } from './color-utils'
import { isItemVisible } from '../api/visual-utils'
import type { Fill, Stroke, Effect } from '../api/dsl-types'

/**
 * 插件侧填充/描边/效果：在 DSL 类型基础上扩展客户端渲染阶段产生的字段。
 * useClientRender 提取的图片填充带 imageRef/scaleMode/rotation，
 * 效果可能带 MasterGo 原生的 isVisible（DSL 侧对应 visible）。
 */
type PluginFill = Fill & { imageRef?: string; scaleMode?: string; rotation?: number }
type PluginStroke = Stroke & { imageRef?: string; scaleMode?: string; rotation?: number }
type PluginEffect = Omit<Effect, 'type'> & {
  /** 效果类型。私有版支持的效果可能超出 DSL 类型声明的联合类型（如 LIQUID_GLASS / MOTION_BLUR） */
  type: string
  isVisible?: boolean
  isEffectShow?: boolean
  showShadowBehindNode?: boolean
  /** 新效果参数：DSL 类型未声明，按宿主字段直传 */
  depth?: number
  dispersion?: number
  refraction?: number
  lightIntensity?: number
  lightAngle?: number
  angle?: number
}

export function createNodeByType(type: string): any {
  switch (type) {
    case 'rectangle': return mg.createRectangle()
    case 'ellipse': return mg.createEllipse()
    case 'line': return mg.createLine()
    case 'text': return mg.createText()
    case 'frame': return mg.createFrame()
    case 'component': return mg.createComponent()
    case 'polygon': return mg.createPolygon()
    case 'star': return mg.createStar()
    case 'pen': return mg.createPen()
    case 'section': return mg.createSection()
    case 'slice': return mg.createSlice()
    case 'connector': return mg.createConnector()
    default: throw new Error(`Unsupported node type: ${type}`)
  }
}

type PropertyHandler = (
  node: any,
  value: any,
  properties: Record<string, any>,
  warnings?: string[],
) => void

const DIRECT_SETTER = (key: string): PropertyHandler =>
  (node, value) => { if (key in node) (node as any)[key] = value }

const RANGE_SETTER = (method: string, transform?: (v: any) => any): PropertyHandler =>
  (node, value) => {
    if (typeof node[method] === 'function') {
      const len = node.characters ? node.characters.length : 0
      if (len > 0) node[method](0, len, transform ? transform(value) : value)
    }
  }

const PROPERTY_HANDLERS: Record<string, PropertyHandler> = {
  x: DIRECT_SETTER('x'), y: DIRECT_SETTER('y'),
  width: DIRECT_SETTER('width'), height: DIRECT_SETTER('height'),
  rotation: DIRECT_SETTER('rotation'),
  cornerRadius: DIRECT_SETTER('cornerRadius'),
  textAlignHorizontal: DIRECT_SETTER('textAlignHorizontal'),
  textAlignVertical: DIRECT_SETTER('textAlignVertical'),
  textAutoResize: (n, v) => { n.textAutoResize = v },
  opacity: (n, v) => { n.opacity = v },
  characters: (n, v) => { if ('characters' in n) n.characters = v },
  paragraphSpacing: (n, v) => { n.paragraphSpacing = v },
  textDecoration: (n, v) => { n.textDecoration = v },
  isVisible: (n, v) => { n.isVisible = v },
  isLocked: (n, v) => { n.isLocked = v },
  name: (n, v) => { n.name = v },
  description: DIRECT_SETTER('description'),
  clipsContent: DIRECT_SETTER('clipsContent'),
  strokeWeight: DIRECT_SETTER('strokeWeight'),
  strokeAlign: DIRECT_SETTER('strokeAlign'),
  strokeCap: DIRECT_SETTER('strokeCap'),
  strokeJoin: DIRECT_SETTER('strokeJoin'),
  fills: (_, v, __) => applyFills(_, v),
  strokes: (_, v, __) => applyStrokes(_, v),
  effects: (_, v, __, warnings) => applyEffects(_, v, warnings),
  fontSize: RANGE_SETTER('setRangeFontSize'),
  fontName: RANGE_SETTER('setRangeFontName'),
  letterSpacing: RANGE_SETTER('setRangeLetterSpacing', v => typeof v === 'number' ? { value: v, unit: 'PIXELS' } : v),
  lineHeight: RANGE_SETTER('setRangeLineHeight', v => typeof v === 'number' ? { value: v, unit: 'PIXELS' } : v),
  fontWeight: () => {},
  connectorStart: (node, value) => {
    if (value && typeof value === 'object') {
      if (value.endpointNodeId) node.connectorStart = { endpointNodeId: value.endpointNodeId, magnet: value.magnet || 'AUTO' }
      else if (value.x !== undefined) node.connectorStart = { x: value.x, y: value.y }
    }
  },
  connectorEnd: (node, value) => {
    if (value && typeof value === 'object') {
      if (value.endpointNodeId) node.connectorEnd = { endpointNodeId: value.endpointNodeId, magnet: value.magnet || 'AUTO' }
      else if (value.x !== undefined) node.connectorEnd = { x: value.x, y: value.y }
    }
  },
  connectorLineType: DIRECT_SETTER('connectorLineType'),
  connectorStartStrokeCap: DIRECT_SETTER('connectorStartStrokeCap'),
  connectorEndStrokeCap: DIRECT_SETTER('connectorEndStrokeCap'),
  svgPathData: (node, value) => {
    if (typeof value === 'string') {
      if (typeof node.setPenPaths === 'function') {
        node.setPenPaths([{ windingRule: 'Nonzero', data: value }])
      } else {
        node.penPaths = [{ windingRule: 'Nonzero', data: value }]
      }
    }
  },
  penPaths: (node, value) => { if (Array.isArray(value)) node.penPaths = value },
  pathData: (node, value, properties) => {
    let pathString: string
    if (typeof value === 'string') {
      pathString = value
    } else if (Array.isArray(value)) {
      const isClosed = properties['isClosed'] !== false
      pathString = value.map((pt: any) => {
        if (pt.type === 'CUBIC') return `C${pt.cx1} ${pt.cy1} ${pt.cx2} ${pt.cy2} ${pt.x} ${pt.y}`
        if (pt.type === 'QUADRATIC') return `Q${pt.cx} ${pt.cy} ${pt.x} ${pt.y}`
        return `L${pt.x} ${pt.y}`
      }).join(' ')
      if (isClosed) pathString += ' Z'
    } else { return }
    const data = [{ windingRule: properties['windingRule'] || 'Nonzero', data: pathString }]
    if (typeof node.setPenPaths === 'function') node.setPenPaths(data)
    else node.penPaths = data
  },
}

/**
 * 自动布局直通字段（不做值转换，直接 `node[key] = value`）。
 *
 * 注意：这里**不再包含 `layoutMode`** —— DSL/回读里的 `layoutMode` 是 `flexMode` 的别名，
 * 已由 `normalizeNodeProperties()` 改名，若仍留在本表就会走直通路径写进宿主的
 * `node.layoutMode`（宿主无此字段，静默忽略 = 坑）。
 * `flexMode` 以及 `padding*` / `itemSpacing` / `mainAxis*` / `crossAxis*` 均为宿主真实字段。
 * 表内条目按「宿主承认则写、不承认则无效」直通，不保证每个都生效（见 PROPERTY_HINTS）。
 */
const AUTO_LAYOUT_KEYS = ['flexMode', 'mainAxisAlignItems', 'crossAxisAlignItems',
  'counterAxisAlignItems', 'mainAxisSizingMode', 'crossAxisSizingMode', 'paddingLeft', 'paddingRight',
  'paddingTop', 'paddingBottom', 'itemSpacing', 'layoutSizingHorizontal', 'layoutSizingVertical',
  'flexWrap', 'primaryAxisSizingMode', 'counterAxisSizingMode']

/**
 * 同义、安全的改名表（DSL / 回读字段 → 宿主真实字段）。
 *
 * 只收录「值域一致、改名后语义完全等价」的字段；改名真的发生时会产生一条说明性 warning。
 * 值域不同的同义字段（如 primaryAxisAlignItems）**不做映射**，只进 PROPERTY_HINTS 提示。
 */
export const PROPERTY_ALIASES: Record<string, string> = {
  // 自动布局模式：DSL/回读写 layoutMode，宿主真实字段是 flexMode。
  // 取值同为 NONE / VERTICAL / HORIZONTAL —— 与 dsl-renderer.convertLayoutMode 的
  // 转换表一致（该表就是恒等映射），也与 layout-applier.applyFrameLayoutProps 的写法一致。
  layoutMode: 'flexMode',
  autoLayout: 'flexMode',
  // 图片填充：dsl_export_node 写 imageUrl / imageScaleMode，宿主写 imageRef / scaleMode
  imageUrl: 'imageRef',
  imageScaleMode: 'scaleMode',
  // 描边宽度：dsl_export_node 写 strokeWidth，宿主字段是 strokeWeight
  strokeWidth: 'strokeWeight',
}

/**
 * 语义不同、必须换写法的键 → 中文提示。
 *
 * 命中后**保留原键**（不改名、不改值），让原逻辑照旧尝试写入，仅额外上报一条可执行的提示；
 * 同时抑制该键的通用「未识别属性」warning，避免同一条问题报两遍。
 */
export const PROPERTY_HINTS: Record<string, string> = {
  gradientTransform: '写渐变请用 gradientHandlePositions: [{x,y},{x,y}]（gradientTransform 宿主不识别，写了会静默失败）',
  smooth: '宿主当前不支持连续圆角（squircle），smooth 不会生效',
  cornerSmoothing: '宿主当前不支持连续圆角（squircle），cornerSmoothing 不会生效',
  layoutAlign: "宿主对应字段是 alignSelf（取值 'STRETCH' | 'INHERIT'），layoutAlign 不会生效",
  primaryAxisAlignItems: "宿主字段是 mainAxisAlignItems，且取值不同（MIN/MAX/SPACE_BETWEEN → FLEX_START/FLEX_END/SPACING_BETWEEN），请直接按宿主取值书写",
  counterAxisAlignItems: '宿主字段是 crossAxisAlignItems，且取值不同（MIN/MAX → FLEX_START/FLEX_END），请直接按宿主取值书写',
  primaryAxisSizingMode: '宿主字段是 mainAxisSizingMode（取值 FIXED/AUTO）',
  counterAxisSizingMode: '宿主字段是 crossAxisSizingMode（取值 FIXED/AUTO）',
  position: '回读里的 position 只是 x/y 的汇总写法，写入请直接用 x / y',
  size: '回读里的 size 只是 width/height 的汇总写法，写入请直接用 width / height',
}

/**
 * 只读 / 结构字段：`node_get` / `dsl_export_node` 回读结果里会带，写回时静默跳过。
 *
 * 目的是「用户把回读结果改一改又写回去」时不再刷一堆无意义 warning；
 * 这些字段本来就不可写（宿主 getter / 结构信息）。
 */
export const IGNORED_READONLY_KEYS: Set<string> = new Set([
  // 标识与结构
  'id', 'type', 'removed', 'parentId', 'childIds',
  // 只读变换 / 包围盒（宿主 getter）
  'absoluteTransform', 'relativeTransform', 'absoluteBoundingBox', 'absoluteRenderBounds', 'bound',
  // 组件与发布信息（只读）
  'alias', 'componentPropertyDefinitions', 'masterComponent', 'mainComponent', 'componentId', 'variantProperties',
  // 回读附带的元数据
  'chartOption', 'textStyles',
])

/**
 * 注：`children` / `parent` **不列入**只读集合 —— 直接赋值 `children`/`parent` 本就不被宿主接受，
 * 但用户真的可能尝试用它建子节点，保留一条「复合字段写法不对」的提示比静默丢弃更有用。
 */

/** 归一化 warning 出口：有 warnings 就并入响应，没有就退化为 console.warn（不静默） */
function pushNormalizeWarning(warnings: string[] | undefined, message: string): void {
  if (warnings) warnings.push(message)
  else console.warn(`[node-utils] ${message}`)
}

/** 嵌套 paint 里需要改名的字段（与 PROPERTY_ALIASES 保持同源） */
const PAINT_ALIAS_KEYS = ['imageUrl', 'imageScaleMode'] as const

/** 归一化单个 paint：imageUrl → imageRef、imageScaleMode → scaleMode（不修改入参对象） */
function normalizePaintObject(paint: any, path: string, warnings?: string[]): any {
  if (!paint || typeof paint !== 'object' || Array.isArray(paint)) return paint
  const out: Record<string, any> = { ...paint }
  for (const key of PAINT_ALIAS_KEYS) {
    if (out[key] === undefined) continue
    const target = PROPERTY_ALIASES[key]
    const value = out[key]
    delete out[key]
    if (out[target] === undefined) {
      out[target] = value
      pushNormalizeWarning(warnings, `属性 ${path}.${key} 已归一化为宿主字段 ${target}`)
    } else {
      pushNormalizeWarning(warnings, `属性 ${path}.${key} 已忽略：宿主字段 ${target} 已显式给出，优先使用后者`)
    }
  }
  return out
}

/**
 * 归一化单个 effect：DSL 的 `visible` 补齐为运行时 `isVisible`（缺省时才补，不删除原键，
 * 未知效果类型透传时不丢字段）。applyEffects 本就同时接受两者，故不产生 warning。
 */
function normalizeEffectObject(effect: any): any {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)) return effect
  if (effect.isVisible !== undefined || effect.visible === undefined) return effect
  return { ...effect, isVisible: effect.visible }
}

/**
 * 属性归一化：
 *
 * 1. 文本别名：content / text → characters（chars 显式传入优先，其次 content，最后 text）——沿用历史静默行为；
 * 2. 通用别名改名（PROPERTY_ALIASES）：改名真的发生 / 被显式值覆盖时给出说明性 warning，**删除原键**，
 *    否则 `layoutMode` 会继续走 AUTO_LAYOUT_KEYS 直通路径（宿主静默忽略）。
 * 3. 嵌套归一化：`fills` / `strokes` 数组内每个 paint 做 imageUrl → imageRef、imageScaleMode → scaleMode
 *    （坑的真实形态：dsl_export_node 导出的字段名照抄回写）；`effects` 数组顺带补 `visible → isVisible`。
 * 4. PROPERTY_HINTS 命中的键：只提示、不改名，保留原键交给原逻辑尝试写入。
 * 5. IGNORED_READONLY_KEYS：静默丢弃（不产生 warning）。
 *
 * 未知键**不在这里**判罚 —— 只有 applyNodeProperties 能拿到 node 判断「宿主到底认不认」。
 * 返回新对象，不修改入参；`warnings` 可省略（省略时 warning 退化为 console.warn，不抛错）。
 */
export function normalizeNodeProperties(
  properties: Record<string, unknown>,
  warnings?: string[],
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}

  // 1) 文本别名（characters 显式传入优先级最高；非文本节点由 characters handler 内部兜底）
  if (properties['characters'] !== undefined) normalized['characters'] = properties['characters']
  else if (properties['content'] !== undefined) normalized['characters'] = properties['content']
  else if (properties['text'] !== undefined) normalized['characters'] = properties['text']
  const consumed = new Set(['characters', 'content', 'text'])

  for (const [key, value] of Object.entries(properties)) {
    if (consumed.has(key)) continue

    // 5) 只读 / 结构字段：静默跳过
    if (IGNORED_READONLY_KEYS.has(key)) continue

    // 3) 嵌套 paint / effect 数组归一化
    if ((key === 'fills' || key === 'strokes') && Array.isArray(value)) {
      normalized[key] = value.map((paint, index) => normalizePaintObject(paint, `${key}[${index}]`, warnings))
      continue
    }
    if (key === 'effects' && Array.isArray(value)) {
      normalized[key] = value.map((effect) => normalizeEffectObject(effect))
      continue
    }

    // 2) 通用别名改名（宿主字段显式给出优先，与键顺序无关）
    const alias = PROPERTY_ALIASES[key]
    if (alias && alias !== key) {
      if (properties[alias] === undefined && normalized[alias] === undefined) {
        normalized[alias] = value
        pushNormalizeWarning(warnings, `属性 ${key} 已归一化为宿主字段 ${alias}`)
      } else {
        pushNormalizeWarning(warnings, `属性 ${key} 已忽略：宿主字段 ${alias} 已由其它写法提供，优先保留`)
      }
      continue
    }

    // 4) 必须换写法的键：提示但仍按原样尝试（不改语义）
    if (PROPERTY_HINTS[key]) {
      pushNormalizeWarning(warnings, PROPERTY_HINTS[key])
      normalized[key] = value
      continue
    }

    normalized[key] = value
  }

  return normalized
}

export function applyNodeProperties(
  node: any,
  properties: Record<string, unknown>,
  warnings?: string[],
): void {
  // 先归一化（别名 / 嵌套 paint / hints / 只读键），再走原有写入逻辑
  const normalized = normalizeNodeProperties(properties, warnings)
  const hintedKeys = new Set(Object.keys(PROPERTY_HINTS))

  for (const [key, value] of Object.entries(normalized)) {
    const handler = PROPERTY_HANDLERS[key as keyof typeof PROPERTY_HANDLERS]
    if (handler) {
      handler(node, value, normalized, warnings)
      continue
    }
    if (AUTO_LAYOUT_KEYS.includes(key)) {
      try { (node as any)[key] = value } catch { /* ignore */ }
      continue
    }
    if (key in node && typeof value !== 'object') {
      try { (node as any)[key] = value } catch (e) { console.warn(`[node-utils] Failed to set ${key}:`, e) }
    } else if (!hintedKeys.has(key)) {
      // 未知键不再是含糊的 "Skipped unknown property"：报出键名 + 可执行的下一步
      const message = key in node
        ? `属性 ${key} 是宿主复合字段，当前写法未生效（需按宿主结构书写，可用 node_get 核对）`
        : `未识别属性 ${key}：宿主不支持该字段，已忽略（可用 node_get 核对真实字段名）`
      pushNormalizeWarning(warnings, message)
    }
  }
}

export function applyFills(node: any, fills: PluginFill[]): void {
  if (!Array.isArray(fills)) {
    console.warn('[node-utils] Invalid fills format, expected array')
    return
  }

  try {
    const nodeType = (node as any).type
    if (nodeType === 'GROUP' || nodeType === 'BOOLEAN_OPERATION') {
      if (fills && fills.length > 0) {
        const typeName = nodeType === 'GROUP' ? 'Group' : 'BooleanOperation'
        console.warn(`[node-utils] ${typeName} does not support fills`)
      }
      return
    }

    const processedFills = fills.map(fill => {
      if (!fill || typeof fill !== 'object') {
        console.warn('[node-utils] Invalid fill object')
        return null
      }

      const fillType = (fill.type || '').toUpperCase()

      switch (fillType) {
        case 'SOLID':
          return {
            type: 'SOLID',
            color: processColor(fill.color || '#000000'),
            isVisible: fill.isVisible !== false,
            alpha: fill.alpha !== undefined ? fill.alpha : 1,
            blendMode: fill.blendMode || 'NORMAL',
            name: fill.name,
          }

        case 'GRADIENT_LINEAR':
        case 'GRADIENT_RADIAL':
        case 'GRADIENT_ANGULAR':
        case 'GRADIENT_DIAMOND': {
          let transform = fill.transform || [[1, 0, 0], [0, 1, 0]]

          if (fillType === 'GRADIENT_RADIAL' && Array.isArray(transform)) {
            const sx = transform[0][0]
            const tx = transform[0][2]
            const sy = transform[1][1]
            const ty = transform[1][2]
            transform = [[sx * 2, 0, tx - sx / 2], [0, sy, ty]]
          }

          let gradientHandlePositions = undefined
          if (fill.gradientHandlePositions && Array.isArray(fill.gradientHandlePositions)) {
            gradientHandlePositions = fill.gradientHandlePositions.map((pos: any) => {
              if (Array.isArray(pos)) return { x: pos[0], y: pos[1] }
              return pos
            })
          }

          return {
            type: fillType,
            gradientStops: (fill.gradientStops || []).map((stop: any) => ({
              position: stop.position,
              color: processColor(stop.color),
            })),
            transform: Array.isArray(transform) ? transform : [[1, 0, 0], [0, 1, 0]],
            gradientHandlePositions,
            isVisible: fill.isVisible !== false,
            alpha: fill.alpha !== undefined ? fill.alpha : 1,
            blendMode: fill.blendMode || 'NORMAL',
            name: fill.name,
          }
        }

        case 'IMAGE':
          return {
            type: 'IMAGE',
            imageRef: fill.imageRef || '',
            scaleMode: fill.scaleMode || 'FILL',
            filters: fill.filters,
            isVisible: fill.isVisible !== false,
            alpha: fill.alpha !== undefined ? fill.alpha : 1,
            blendMode: fill.blendMode || 'NORMAL',
            name: fill.name,
            ratio: fill.ratio,
            rotation: fill.rotation,
          }

        default:
          console.warn(`[node-utils] Unknown fill type: ${fill.type}`)
          return null
      }
    }).filter(Boolean)

    if ('fills' in node) {
      ;(node as any).fills = processedFills
    }
  } catch (error) {
    console.warn('[node-utils] Failed to apply fills:', error)
  }
}

export function applyStrokes(node: any, strokes: PluginStroke[]): void {
  if (!Array.isArray(strokes)) {
    console.warn('[node-utils] Invalid strokes format, expected array')
    return
  }

  try {
    const processedStrokes = strokes.map(stroke => {
      if (!stroke || typeof stroke !== 'object') {
        console.warn('[node-utils] Invalid stroke object')
        return null
      }

      const strokeType = (stroke.type || '').toUpperCase()

      switch (strokeType) {
        case 'SOLID':
          return {
            type: 'SOLID',
            color: processColor(stroke.color || '#000000'),
            isVisible: stroke.isVisible !== false,
            alpha: stroke.alpha !== undefined ? stroke.alpha : 1,
            blendMode: stroke.blendMode || 'NORMAL',
            name: stroke.name,
          }

        case 'GRADIENT_LINEAR':
        case 'GRADIENT_RADIAL':
        case 'GRADIENT_ANGULAR':
        case 'GRADIENT_DIAMOND':
          return {
            type: strokeType,
            gradientStops: (stroke.gradientStops || []).map((stop: any) => ({
              position: stop.position,
              color: processColor(stop.color),
            })),
            transform: Array.isArray(stroke.transform) ? stroke.transform : [[1, 0, 0], [0, 1, 0]],
            gradientHandlePositions: stroke.gradientHandlePositions,
            isVisible: stroke.isVisible !== false,
            alpha: stroke.alpha !== undefined ? stroke.alpha : 1,
            blendMode: stroke.blendMode || 'NORMAL',
            name: stroke.name,
          }

        default:
          console.warn(`[node-utils] Unknown stroke type: ${stroke.type}`)
          return null
      }
    }).filter(Boolean)

    ;(node as any).strokes = processedStrokes
  } catch (error) {
    console.warn('[node-utils] Failed to apply strokes:', error)
  }
}

/**
 * 应用效果数组。
 *
 * - 已知效果（阴影 / 模糊 / LIQUID_GLASS / MOTION_BLUR）按各自字段归一化；
 * - 未知效果类型不再丢弃：原对象整体透传（不丢字段），并把「已透传未知效果类型 X」
 *   写入可选的 `warnings` 数组交给调用方（未传时退化为 console.warn，不静默）。
 *
 * `warnings` 为可选出参，旧的 `applyEffects(node, effects)` 调用方式保持兼容。
 */
export function applyEffects(node: any, effects: PluginEffect[], warnings?: string[]): void {
  if (!Array.isArray(effects)) {
    console.warn('[node-utils] Invalid effects format, expected array')
    return
  }

  const processedEffects = effects.map(effect => {
    if (!effect || typeof effect !== 'object') {
      console.warn('[node-utils] Invalid effect object')
      return null
    }

    switch (effect.type) {
      case 'DROP_SHADOW':
      case 'INNER_SHADOW':
        return {
          type: effect.type,
          color: processColor(effect.color || '#000000'),
          offset: effect.offset || { x: 0, y: 4 },
          spread: effect.spread !== undefined ? effect.spread : 0,
          radius: effect.radius !== undefined ? effect.radius : 8,
          // 运行时时字段叫 isVisible，DSL 里叫 visible —— 两者都接受，避免 AI 按 DSL 写法传 visible:false 时效果却仍显示
          isVisible: (effect.isVisible !== undefined ? effect.isVisible : (effect as any).visible) !== false,
          blendMode: effect.blendMode || 'NORMAL',
          showShadowBehindNode: effect.showShadowBehindNode || false,
          isEffectShow: effect.isEffectShow !== undefined ? effect.isEffectShow : true,
        }

      case 'LAYER_BLUR':
      case 'BACKGROUND_BLUR':
        return {
          type: effect.type,
          radius: effect.radius !== undefined ? effect.radius : 10,
          isVisible: (effect.isVisible !== undefined ? effect.isVisible : (effect as any).visible) !== false,
          blendMode: effect.blendMode || 'NORMAL',
        }

      case 'LIQUID_GLASS': {
        // 液态玻璃：字段直传，缺省值不猜测（宿主私版能力）
        const converted: any = { type: 'LIQUID_GLASS', isVisible: isItemVisible(effect) }
        const passthrough = ['depth', 'dispersion', 'refraction', 'lightIntensity', 'lightAngle', 'radius']
        for (const key of passthrough) {
          const value = (effect as any)[key]
          if (value !== undefined) converted[key] = value
        }
        converted.blendMode = effect.blendMode || 'NORMAL'
        return converted
      }

      case 'MOTION_BLUR': {
        // 运动模糊：字段直传
        const converted: any = { type: 'MOTION_BLUR', isVisible: isItemVisible(effect) }
        if (effect.radius !== undefined) converted.radius = effect.radius
        if (effect.angle !== undefined) converted.angle = effect.angle
        converted.blendMode = effect.blendMode || 'NORMAL'
        return converted
      }

      default: {
        // 未知类型：原对象整体透传（不丢字段），并上报 warning 供调用方随响应返回
        const warning = `已透传未知效果类型 ${effect.type}`
        if (warnings) warnings.push(warning)
        else console.warn(`[node-utils] ${warning}`)
        return { ...effect }
      }
    }
  }).filter(Boolean)

  ;(node as any).effects = processedEffects
}
