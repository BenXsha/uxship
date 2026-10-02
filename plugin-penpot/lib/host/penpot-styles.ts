/**
 * 样式资产：颜色样式 / 文本样式 / 字体
 *
 * 从 `penpot.ts` 拆出（内聚单元：Penpot 的**库级**样式资产 —— `library.local.colors` /
 * `typographies` / `fonts`）。字体清单（`listFonts`）与文本样式的字体族落地放在同一处：
 * 「字体」是一个概念，拆到两个文件会让 `createTextStyle` 的字体回退路径失去参照。
 *
 * 依赖方向单向：`PenpotHost` → 本模块。宿主**状态型**原语（`requireShape`）通过 `StyleDeps`
 * 传入；无状态原语（`penpot.fonts` / `libraryPools()`）直接调用 —— 本文件属于 Penpot 宿主适配层
 * （见 README「约定（续）」R1'）。
 */
import { describeColor, normalizeColor } from './color'
import { HostArgumentError, UnsupportedHostFeatureError } from './errors'
import { libraryPools } from './penpot-runtime'
import { styleNameMatches } from './style-name'
import type { HostColorStyle, HostFontInfo, HostNode, HostTextStyle } from './types'

/** 本模块需要的**宿主状态型原语**（只有 `applyStyle` 用到它） */
export interface StyleDeps {
  /** HostNode → 宿主形状（PenpotHost 层两者是同一对象，只是端口不额外包装） */
  requireShape(node: HostNode, feature: string): PenpotShape
}

/** 本文件库（Penpot: penpot.library.local） */
function localLibrary(): PenpotLibrary | null {
  const local = libraryPools().local
  return local ?? null
}

export async function listColorStyles(): Promise<HostColorStyle[]> {
  const out: HostColorStyle[] = []
  const library = libraryPools()
  const collect = (pool: PenpotLibrary | undefined, isLocal: boolean) => {
    for (const style of pool?.colors ?? []) {
      const normalized = normalizeColor(style.color, style.opacity)
      out.push({
        id: style.id,
        name: style.name,
        path: style.path,
        libraryId: pool?.id ?? style.libraryId,
        libraryName: pool?.name,
        isLocal,
        color: normalized?.hex ?? (typeof style.color === 'string' ? style.color : undefined),
        opacity: normalized?.opacity ?? (typeof style.opacity === 'number' ? style.opacity : undefined),
        gradient: style.gradient,
      })
    }
  }
  collect(library?.local, true)
  for (const connected of Array.isArray(library?.connected) ? library.connected : []) collect(connected, false)
  return out
}

export async function listTextStyles(): Promise<HostTextStyle[]> {
  const out: HostTextStyle[] = []
  const library = libraryPools()
  const collect = (pool: PenpotLibrary | undefined, isLocal: boolean) => {
    for (const style of pool?.typographies ?? []) {
      out.push({
        id: style.id,
        name: style.name,
        path: style.path,
        libraryId: pool?.id ?? style.libraryId,
        libraryName: pool?.name,
        isLocal,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
      })
    }
  }
  collect(library?.local, true)
  for (const connected of Array.isArray(library?.connected) ? library.connected : []) collect(connected, false)
  return out
}

export async function createColorStyle(input: {
  name: string
  color: string
  opacity?: number
  description?: string
}): Promise<HostColorStyle> {
  const library = localLibrary()
  if (!library || typeof library.createColor !== 'function') {
    throw new UnsupportedHostFeatureError('createColorStyle', '宿主未提供 library.local.createColor')
  }
  const normalized = normalizeColor(input.color, input.opacity)
  if (!normalized) {
    throw new HostArgumentError(`createColorStyle: 色值无法识别: ${describeColor(input.color)}`)
  }

  const style = library.createColor()
  style.name = input.name
  style.color = normalized.hex
  style.opacity = input.opacity ?? normalized.opacity
  return {
    id: style.id,
    name: style.name,
    path: style.path,
    libraryId: library.id,
    libraryName: library.name,
    isLocal: true,
    color: style.color ?? normalized.hex,
    opacity: style.opacity ?? normalized.opacity,
  }
}

export async function createTextStyle(input: {
  name: string
  fontFamily?: string
  fontSize?: string | number
  fontWeight?: string | number
  lineHeight?: string | number
  letterSpacing?: string | number
  description?: string
}): Promise<HostTextStyle> {
  const library = localLibrary()
  if (!library || typeof library.createTypography !== 'function') {
    throw new UnsupportedHostFeatureError('createTextStyle', '宿主未提供 library.local.createTypography')
  }

  const style = library.createTypography()
  style.name = input.name
  // 依本仓库 typings/penpot.d.ts 的 PenpotLibraryTypography：度量字段
  // （fontSize/fontWeight/lineHeight/letterSpacing/name）声明为可写字符串；
  // 字体族**不在**这些字段里，必须走 setFont(font, variant)。
  // Penpot 的排版成员都是字符串（如 fontSize: "14"、lineHeight: "1.5"）
  if (input.fontSize !== undefined) style.fontSize = String(input.fontSize)
  if (input.fontWeight !== undefined) style.fontWeight = String(input.fontWeight)
  if (input.lineHeight !== undefined) style.lineHeight = String(input.lineHeight)
  if (input.letterSpacing !== undefined) style.letterSpacing = String(input.letterSpacing)

  // 字体族必须通过 setFont 落地（直接写 fontFamily 无效）—— 拿不到就如实告知
  const notes: string[] = []
  if (input.fontFamily) {
    // FontsContext.findByName(name)：官方成员（api.yml → FontsContext）
    const font = penpot.fonts.findByName(input.fontFamily)
    if (font && typeof style.setFont === 'function') {
      try {
        style.setFont(font, font.variants?.[0])
      } catch (error) {
        notes.push(`字体设置失败，样式已创建但字体沿用默认：${(error as Error).message}`)
      }
    } else {
      notes.push(`字体不可用（${input.fontFamily}），文本样式的字体沿用默认`)
    }
  }

  return {
    id: style.id,
    name: style.name,
    path: style.path,
    libraryId: library.id,
    libraryName: library.name,
    isLocal: true,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    ...(notes.length ? { note: notes.join('；') } : {}),
  }
}

/** 名字比对统一走 `styleNameMatches`（全名或**trim 过的**叶子名）——
 * Penpot 把样式名里的 `/` 当文件夹分隔且每段 trim；不 trim 会导致 `Body / Default` 永远命中不到 `Default`。 */
function findLocalColorByName(name: string): PenpotLibraryColor | undefined {
  return (localLibrary()?.colors ?? []).find((candidate) => styleNameMatches(candidate.name, name))
}

function findLocalTypographyByName(name: string): PenpotLibraryTypography | undefined {
  return (localLibrary()?.typographies ?? []).find((candidate) => styleNameMatches(candidate.name, name))
}

/**
 * 按**名字**更新已存在的颜色样式（找不到返回 null）。
 *
 * 为何必须：官方 API（`api_types.yml`）里 `LibraryColor` 与 `Library` **都没有删除方法**
 * （无 `remove()` / `removeColor`），而 `createColor()` 每次新建 —— 因此重复注册会**永久翻倍**。
 * 要可重入，只能按名 upsert（`library/registerStyles` 走此路径）。
 * `color` / `opacity` 在官方声明里非 readonly，可直接写。
 */
export async function updateColorStyle(input: {
  name: string
  color: string
  opacity?: number
  description?: string
}): Promise<HostColorStyle | null> {
  const library = localLibrary()
  const existing = findLocalColorByName(input.name)
  if (!existing) return null
  const normalized = normalizeColor(input.color, input.opacity)
  if (!normalized) throw new HostArgumentError(`updateColorStyle: 色值无法识别: ${describeColor(input.color)}`)
  existing.color = normalized.hex
  existing.opacity = input.opacity ?? normalized.opacity
  return {
    id: existing.id,
    name: existing.name,
    path: existing.path,
    libraryId: existing.libraryId ?? library?.id,
    libraryName: library?.name,
    isLocal: true,
    color: existing.color ?? normalized.hex,
    opacity: existing.opacity ?? normalized.opacity,
  }
}

/**
 * 按**名字**更新已存在的文本样式（找不到返回 null）。理由同 `updateColorStyle`：
 * `LibraryTypography` 也没有删除方法。度量字段（fontSize/weight/lineHeight/letterSpacing/name）
 * 官方声明非 readonly；字体族仍需走 `setFont`（直接写 `fontFamily` 无效）。
 */
export async function updateTextStyle(input: {
  name: string
  fontFamily?: string
  fontSize?: string | number
  fontWeight?: string | number
  lineHeight?: string | number
  letterSpacing?: string | number
  description?: string
}): Promise<HostTextStyle | null> {
  const library = localLibrary()
  const style = findLocalTypographyByName(input.name)
  if (!style) return null
  if (input.fontSize !== undefined) style.fontSize = String(input.fontSize)
  if (input.fontWeight !== undefined) style.fontWeight = String(input.fontWeight)
  if (input.lineHeight !== undefined) style.lineHeight = String(input.lineHeight)
  if (input.letterSpacing !== undefined) style.letterSpacing = String(input.letterSpacing)

  const notes: string[] = []
  if (input.fontFamily) {
    const font = penpot.fonts.findByName(input.fontFamily)
    if (font && typeof style.setFont === 'function') {
      try {
        style.setFont(font, font.variants?.[0])
      } catch (error) {
        notes.push(`字体设置失败（样式已更新，字体沿用原值）：${(error as Error).message}`)
      }
    } else {
      notes.push(`字体不可用（${input.fontFamily}），文本样式的字体沿用原值`)
    }
  }

  return {
    id: style.id,
    name: style.name,
    path: style.path,
    libraryId: library?.id,
    libraryName: library?.name,
    isLocal: true,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    ...(notes.length ? { note: notes.join('；') } : {}),
  }
}

function findColorStyle(styleId: string): PenpotLibraryColor | null {
  const library = libraryPools()
  const pools: (PenpotLibrary | undefined)[] = [library?.local, ...(Array.isArray(library?.connected) ? library.connected : [])]
  for (const pool of pools) {
    const found = (pool?.colors ?? []).find((candidate) => candidate.id === styleId)
    if (found) return found
  }
  return null
}

function findTextStyle(styleId: string): PenpotLibraryTypography | null {
  const library = libraryPools()
  const pools: (PenpotLibrary | undefined)[] = [library?.local, ...(Array.isArray(library?.connected) ? library.connected : [])]
  for (const pool of pools) {
    const found = (pool?.typographies ?? []).find((candidate) => candidate.id === styleId)
    if (found) return found
  }
  return null
}

/**
 * 应用样式。
 *
 * 用 `LibraryColor.asFill()/asStroke()` 而不是自己拼一个同色值的 fill —— 前者保住
 * "样式引用"语义（改样式全稿联动），后者只是一次性赋值。
 */
export async function applyStyle(deps: StyleDeps,
  node: HostNode,
  styleId: string,
  styleType: 'fill' | 'stroke' | 'text',
): Promise<{ applied: boolean; note?: string }> {
  const shape = deps.requireShape(node, 'applyStyle')

  if (styleType === 'text') {
    const style = findTextStyle(styleId)
    if (!style) throw new HostArgumentError(`文本样式不存在: ${styleId}`)
    if (shape.type !== 'text') {
      return { applied: false, note: `目标节点是 ${shape.type}，文本样式只能应用到文本节点` }
    }
    style.applyToText(shape)
    return { applied: true }
  }

  const style = findColorStyle(styleId)
  if (!style) throw new HostArgumentError(`颜色样式不存在: ${styleId}`)
  if (styleType === 'fill') {
    shape.fills = [style.asFill()]
  } else {
    shape.strokes = [style.asStroke()]
  }

  // 回读校验：宿主可能因节点类型（如 group）静默忽略
  const current = styleType === 'fill' ? shape.fills : shape.strokes
  const applied = Array.isArray(current) && current.length > 0
  return applied ? { applied } : { applied, note: '宿主未接受该样式（节点类型可能不支持）' }
}

/** 列出宿主可用字体：`penpot.fonts.all` + 每个字体的变体 */
export async function listFonts(): Promise<HostFontInfo[]> {
  const fonts = penpot.fonts
  const list = fonts?.all
  if (!Array.isArray(list)) return []

  const out: HostFontInfo[] = []
  for (const font of list) {
    const variants = Array.isArray(font.variants) ? font.variants : []
    if (!variants.length) {
      out.push({ family: font.fontFamily || font.name, style: font.fontStyle ?? undefined, fontWeight: font.fontWeight })
      continue
    }
    for (const variant of variants) {
      out.push({
        family: font.fontFamily || font.name,
        style: variant.name,
        fontWeight: variant.fontWeight,
      })
    }
  }
  return out
}

/**
 * 生成节点子树的**宿主原生 CSS**（`penpot.generateStyle` + `penpot.generateFontFaces`）。
 *
 * 用途：`design_to_code` 的可选 `exportCss` —— 用宿主自己的样式生成器产出的规则，
 * 比我们从 DSL 手写字段映射更保真。
 *
 * 诚实边界：`generateFontFaces` 是较新的 API（官方 plugins-runtime 后续加入）；旧宿主没有它时
 * 只回 CSS，并在 `reason` 里说明缺了什么（**不静默吞掉**）。
 */
export async function generateCss(deps: StyleDeps, nodes: readonly HostNode[]): Promise<{
  available: boolean
  css: string
  fontFaces: string
  nodeCount: number
  reason?: string
}> {
  const shapes = nodes.map((node) => deps.requireShape(node, 'generateCss'))
  if (typeof penpot.generateStyle !== 'function') {
    return { available: false, css: '', fontFaces: '', nodeCount: shapes.length, reason: '宿主未提供 penpot.generateStyle' }
  }

  const notes: string[] = []
  let css = ''
  try {
    css = penpot.generateStyle(shapes, { type: 'css', withPrelude: true }) ?? ''
  } catch (error) {
    return {
      available: false,
      css: '',
      fontFaces: '',
      nodeCount: shapes.length,
      reason: `generateStyle 失败：${(error as Error).message}`,
    }
  }

  let fontFaces = ''
  if (typeof penpot.generateFontFaces === 'function') {
    try {
      fontFaces = (await penpot.generateFontFaces(shapes)) ?? ''
    } catch (error) {
      notes.push(`generateFontFaces 失败：${(error as Error).message}`)
    }
  } else {
    notes.push('宿主未提供 penpot.generateFontFaces（@font-face 省略）')
  }

  return {
    available: true,
    css,
    fontFaces,
    nodeCount: shapes.length,
    ...(notes.length ? { reason: notes.join('；') } : {}),
  }
}
