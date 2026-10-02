import { hexToRgb, colorDistance } from '../utils/color-utils'
import { serializeEffects } from './visual-utils'

/** 发送通知 */
export function handleNotify(params: {
  message: string
  options?: {
    position?: 'top' | 'bottom'
    type?: 'normal' | 'highlight' | 'error' | 'warning' | 'success'
    timeout?: number
  }
}): any {
  if (!params.message) {
    throw new Error('Missing required parameter: message')
  }

  mg.notify(params.message, params.options)
  return { success: true }
}

/** 获取可用字体列表 */
export async function handleListFonts(_params: any): Promise<any> {
  const fonts = await mg.listAvailableFontsAsync()
  return {
    count: fonts.length,
    fonts: fonts.map(f => ({
      family: f.fontName.family,
      style: f.fontName.style,
      referrer: f.referrer,
    })),
  }
}

/** 名称匹配方式 */
const MATCH_TYPES = ['exact', 'contains', 'startsWith', 'endsWith', 'regex'] as const
type MatchType = (typeof MATCH_TYPES)[number]

/** 归一化后的搜索参数（所有字段已通过形状校验，`select` 恒有值） */
export interface NormalizedSearchParams {
  name?: {
    value: string
    matchType?: MatchType
  }
  types?: string[]
  colors?: Array<{
    type: 'fill' | 'stroke'
    color: string
    tolerance?: number
  }>
  hasShadow?: boolean
  hasBlur?: boolean
  minSize?: {
    width?: number
    height?: number
  }
  maxSize?: {
    width?: number
    height?: number
  }
  opacity?: {
    min?: number
    max?: number
  }
  limit?: number
  /** 是否把命中节点设为选区（默认 true；false 时完全不碰 page.selection） */
  select: boolean
}

/** 纯对象判定（排除 null 与数组） */
function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 归一化 `name`：接受字符串简写与 `{ value, matchType }` 对象
 *
 * 为什么必须校验：旧实现只看 `params.name.value`，传 `name: "绑定说明"` 时 `.value` 是
 * `undefined` → 过滤条件整段被跳过 → **不报错、返回全页节点**（AI 会把「过滤没生效」
 * 当成「这类节点有 270 个」）。同理 `matchType` 拼错时 switch 无分支命中，`match` 保持
 * true，也会静默返回全页。
 */
function normalizeName(raw: any): NonNullable<NormalizedSearchParams['name']> {
  if (typeof raw === 'string') {
    if (!raw.trim()) {
      throw new Error('name 不能是空字符串（空字符串会匹配全部节点）；要取消名称过滤请直接不传 name')
    }
    return { value: raw, matchType: 'contains' }
  }

  if (isPlainObject(raw)) {
    if (typeof raw.value !== 'string' || !raw.value.trim()) {
      throw new Error(
        'name 需要字符串或 { value, matchType } 对象；name.value 必须是非空字符串，' +
          '例如 name: "绑定说明" 或 name: { value: "绑定说明", matchType: "exact" }'
      )
    }
    const out: NonNullable<NormalizedSearchParams['name']> = { value: raw.value }
    if (raw.matchType !== undefined) {
      if (!MATCH_TYPES.includes(raw.matchType)) {
        throw new Error(
          `name.matchType 只能是 ${MATCH_TYPES.join(' / ')}，收到 ${JSON.stringify(raw.matchType)}` +
            '（拼错会导致过滤被静默跳过，所以这里直接报错）'
        )
      }
      // 对象形态保留原键；matchType 缺省时由过滤逻辑按 contains 处理
      out.matchType = raw.matchType as MatchType
    }
    return out
  }

  throw new Error(
    'name 需要字符串或 { value, matchType } 对象，例如 name: "绑定说明" 或 ' +
      'name: { value: "绑定说明", matchType: "exact" }'
  )
}

/**
 * 归一化 `colors`：接受字符串 / 字符串数组 / 对象数组 / 混合数组
 *
 * 旧实现只认 `[{ color, type, tolerance }]`，传 `colors: "#4A6CF7"` 时 `color` 是
 * `undefined` → `hexToRgb(undefined)` 里 `.match` 崩（`cannot read property 'match' of undefined`）。
 * 对象缺 `type` 时旧实现既不是 fill 也不是 stroke → 静默零命中，所以这里补默认值。
 */
function normalizeColors(raw: any): NonNullable<NormalizedSearchParams['colors']> {
  const list = typeof raw === 'string' ? [raw] : raw
  if (!Array.isArray(list)) {
    throw new Error(
      'colors 需要字符串或数组，例如 colors: "#4A6CF7"、colors: ["#4A6CF7", "#FFFFFF"]、' +
        'colors: [{ color: "#4A6CF7", type: "fill", tolerance: 20 }]'
    )
  }

  return list.map((item: any, index: number) => {
    if (typeof item === 'string') {
      if (!item.trim()) {
        throw new Error(`colors[${index}] 不能是空字符串，例如 colors: "#4A6CF7"`)
      }
      return { color: item, type: 'fill' as const, tolerance: 20 }
    }

    if (!isPlainObject(item)) {
      throw new Error(
        `colors[${index}] 需要字符串或 { color, type, tolerance } 对象，收到 ${JSON.stringify(item)}；` +
          '例如 colors: [{ color: "#4A6CF7", type: "fill", tolerance: 20 }]'
      )
    }

    if (typeof item.color !== 'string' || !item.color.trim()) {
      throw new Error(
        `colors[${index}].color 需要颜色字符串（十六进制或 rgb()），例如 ` +
          'colors: [{ color: "#4A6CF7", type: "fill", tolerance: 20 }]'
      )
    }

    const type = item.type === undefined ? 'fill' : item.type
    if (type !== 'fill' && type !== 'stroke') {
      throw new Error(
        `colors[${index}].type 只能是 "fill" 或 "stroke"，收到 ${JSON.stringify(item.type)}`
      )
    }

    if (
      item.tolerance !== undefined &&
      (typeof item.tolerance !== 'number' || !Number.isFinite(item.tolerance))
    ) {
      throw new Error(
        `colors[${index}].tolerance 需要数字（0-100），收到 ${JSON.stringify(item.tolerance)}`
      )
    }

    // 缺 type/tolerance 时补默认值：否则过滤逻辑两边都不命中，静默返回零结果
    return { color: item.color, type, tolerance: item.tolerance ?? 20 }
  })
}

/**
 * 归一化 `minSize` / `maxSize`：接受数字简写与 `{ width, height }` 对象
 *
 * 旧实现只认 `{ width, height }`，传 `maxSize: 55` 时对象属性访问全落空 → **数字被静默忽略**
 * （用户以为按尺寸筛过，其实是全量）。
 */
function normalizeSize(
  raw: any,
  label: 'minSize' | 'maxSize'
): NonNullable<NormalizedSearchParams['minSize']> {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      throw new Error(`${label} 需要有限数字或 { width, height } 对象，收到 ${JSON.stringify(raw)}`)
    }
    return { width: raw, height: raw }
  }

  if (isPlainObject(raw)) {
    const out: NonNullable<NormalizedSearchParams['minSize']> = {}
    for (const key of ['width', 'height'] as const) {
      const value = raw[key]
      if (value === undefined) continue
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${label}.${key} 需要数字，收到 ${JSON.stringify(value)}`)
      }
      out[key] = value
    }
    if (out.width === undefined && out.height === undefined) {
      throw new Error(
        `${label} 对象至少要给 width 或 height，例如 ${label}: { height: 18 }（数字简写 ${label}: 18 表示宽高都不小于/不大于 18）`
      )
    }
    return out
  }

  throw new Error(
    `${label} 需要数字或 { width, height } 对象，例如 ${label}: 18、${label}: { width: 640, height: 480 }`
  )
}

/** 归一化 `types`：接受字符串简写与字符串数组 */
function normalizeTypes(raw: any): string[] {
  if (typeof raw === 'string') {
    if (!raw.trim()) {
      throw new Error('types 不能是空字符串；要取消类型过滤请直接不传 types')
    }
    return [raw]
  }
  if (Array.isArray(raw)) {
    raw.forEach((item: any, index: number) => {
      if (typeof item !== 'string' || !item.trim()) {
        throw new Error(`types[${index}] 需要非空字符串（如 "TEXT"），收到 ${JSON.stringify(item)}`)
      }
    })
    return [...raw]
  }
  throw new Error('types 需要字符串或字符串数组，例如 types: "TEXT" 或 types: ["TEXT", "FRAME"]')
}

/**
 * 归一化 `search_nodes` 入参（纯函数，便于单测）
 *
 * 原则：**形状容忍 + 不认识就报错** —— 静默返回全量是最危险的失败模式，
 * 所以字符串/数字简写一律接受，其它形状一律抛中文错误而不是忽略。
 */
export function normalizeSearchParams(raw: any): NormalizedSearchParams {
  if (raw !== undefined && raw !== null && !isPlainObject(raw)) {
    throw new Error('search_nodes 参数需要对象，例如 { name: "绑定说明", select: false }')
  }
  const input: Record<string, any> = raw ?? {}

  // 缺省视为「未提供」：JSON 里 null 常被用来表达「没有这个条件」
  const provided = (value: any) => value !== undefined && value !== null

  const out: NormalizedSearchParams = { select: true }

  if (provided(input.name)) out.name = normalizeName(input.name)
  if (provided(input.types)) out.types = normalizeTypes(input.types)
  // 空数组 = 没有颜色条件（与旧语义一致），不报错
  if (provided(input.colors)) out.colors = normalizeColors(input.colors)
  if (provided(input.minSize)) out.minSize = normalizeSize(input.minSize, 'minSize')
  if (provided(input.maxSize)) out.maxSize = normalizeSize(input.maxSize, 'maxSize')

  if (provided(input.hasShadow)) {
    if (typeof input.hasShadow !== 'boolean') {
      throw new Error(`hasShadow 需要布尔值（true / false），收到 ${JSON.stringify(input.hasShadow)}`)
    }
    out.hasShadow = input.hasShadow
  }

  if (provided(input.hasBlur)) {
    if (typeof input.hasBlur !== 'boolean') {
      throw new Error(`hasBlur 需要布尔值（true / false），收到 ${JSON.stringify(input.hasBlur)}`)
    }
    out.hasBlur = input.hasBlur
  }

  if (provided(input.opacity)) {
    if (!isPlainObject(input.opacity)) {
      throw new Error('opacity 需要 { min, max } 对象，例如 opacity: { min: 0.4, max: 1 }')
    }
    const opacity: { min?: number; max?: number } = {}
    for (const key of ['min', 'max'] as const) {
      const value = input.opacity[key]
      if (value === undefined) continue
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`opacity.${key} 需要数字（0-1），收到 ${JSON.stringify(value)}`)
      }
      opacity[key] = value
    }
    if (opacity.min === undefined && opacity.max === undefined) {
      throw new Error('opacity 对象至少要给 min 或 max，例如 opacity: { min: 0.4 }')
    }
    out.opacity = opacity
  }

  if (provided(input.limit)) {
    if (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit <= 0) {
      throw new Error(`limit 需要正整数，收到 ${JSON.stringify(input.limit)}`)
    }
    out.limit = input.limit
  }

  if (provided(input.select)) {
    if (typeof input.select !== 'boolean') {
      throw new Error(`select 需要布尔值（true / false），收到 ${JSON.stringify(input.select)}`)
    }
    out.select = input.select
  }

  return out
}

/** 搜索节点 */
export function handleSearchFind(rawParams: any): any {
  const params = normalizeSearchParams(rawParams)
  const page = mg.document.currentPage

  let results: any[] = []

  // 获取所有节点
  const allNodes = page.findAll(() => true)

  // 遍历所有节点，应用过滤条件
  for (const node of allNodes) {
    let match = true

    // 名称匹配
    if (params.name) {
      const nodeName = node.name || ''
      const matchType = params.name.matchType || 'contains'
      
      switch (matchType) {
        case 'exact':
          match = nodeName === params.name.value
          break
        case 'contains':
          match = nodeName.includes(params.name.value)
          break
        case 'startsWith':
          match = nodeName.startsWith(params.name.value)
          break
        case 'endsWith':
          match = nodeName.endsWith(params.name.value)
          break
        case 'regex':
          try {
            const regex = new RegExp(params.name.value, 'i')
            match = regex.test(nodeName)
          } catch (e) {
            console.warn('Invalid regex pattern:', params.name.value)
            match = false
          }
          break
      }
      
      if (!match) continue
    }

    // 类型匹配
    if (params.types && params.types.length > 0) {
      match = params.types.includes(node.type)
      if (!match) continue
    }

    // 颜色匹配
    if (params.colors && params.colors.length > 0) {
      match = false
      for (const colorCondition of params.colors) {
        const tolerance = colorCondition.tolerance ?? 20
        const targetColor = hexToRgb(colorCondition.color)
        
        if (colorCondition.type === 'fill' && 'fills' in node && node.fills) {
          for (const fill of node.fills) {
            if (fill.type === 'SOLID' && fill.color) {
              const nodeColor = fill.color
              const distance = colorDistance(nodeColor, targetColor)
              if (distance <= tolerance) {
                match = true
                break
              }
            }
          }
        } else if (colorCondition.type === 'stroke' && 'strokes' in node && node.strokes) {
          for (const stroke of node.strokes) {
            if (stroke.type === 'SOLID' && stroke.color) {
              const nodeColor = stroke.color
              const distance = colorDistance(nodeColor, targetColor)
              if (distance <= tolerance) {
                match = true
                break
              }
            }
          }
        }
        
        if (match) break
      }
      
      if (!match) continue
    }

    // 阴影匹配
    if (params.hasShadow !== undefined) {
      const hasShadowEffect = 'effects' in node && node.effects && node.effects.some((e: any) => 
        e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'
      )
      match = params.hasShadow === hasShadowEffect
      if (!match) continue
    }

    // 模糊匹配
    if (params.hasBlur !== undefined) {
      const hasBlurEffect = 'effects' in node && node.effects && node.effects.some((e: any) => 
        e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR'
      )
      match = params.hasBlur === hasBlurEffect
      if (!match) continue
    }

    // 尺寸匹配
    if (params.minSize) {
      if (params.minSize.width && 'width' in node && node.width < params.minSize.width) {
        match = false
        continue
      }
      if (params.minSize.height && 'height' in node && node.height < params.minSize.height) {
        match = false
        continue
      }
    }

    if (params.maxSize) {
      if (params.maxSize.width && 'width' in node && node.width > params.maxSize.width) {
        match = false
        continue
      }
      if (params.maxSize.height && 'height' in node && node.height > params.maxSize.height) {
        match = false
        continue
      }
    }

    // 透明度匹配
    if (params.opacity) {
      const nodeOpacity = 'opacity' in node ? (node.opacity ?? 1) : 1
      if (params.opacity.min !== undefined && nodeOpacity < params.opacity.min) {
        match = false
        continue
      }
      if (params.opacity.max !== undefined && nodeOpacity > params.opacity.max) {
        match = false
        continue
      }
    }

    // 所有条件都匹配，添加到结果
    if (match) {
      results.push(node)
    }
  }

  // 限制结果数量（先过滤完再截断，保证 count 是「命中数被截断后的条数」）
  if (params.limit && results.length > params.limit) {
    results = results.slice(0, params.limit)
  }

  // 选中搜索到的节点
  // 副作用要有开关：无条件改写选区会把用户的选区带偏、视口跟着跳，
  // 所以 `select: false` 时**完全不碰** page.selection（便于 AI 只查不改）。
  const willSelect = params.select && results.length > 0
  if (willSelect) {
    page.selection = results
  }

  return {
    count: results.length,
    // 选区行为回显：selected = 本次写入选区的节点数（未改选区时为 0），
    // selectionUntouched = 是否没动过用户原选区（AI 可据此判断是否需要复原）
    selected: willSelect ? results.length : 0,
    selectionUntouched: !willSelect,
    nodeIds: results.map((n: any) => n.id),
    // 结果里回显 effects：否则 hasShadow/hasBlur 能筛出节点，却无法从结果确认阴影/模糊参数
    nodes: results.map((n: any) => {
      const effects = serializeEffects((n as any).effects)
      return {
        id: n.id,
        name: n.name,
        type: n.type,
        ...(effects.length > 0 ? { effects } : {}),
      }
    }),
  }
}

