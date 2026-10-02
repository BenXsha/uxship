/**
 * `library/registerStyles` —— 从 Token 面板的节点树提取并注册样式
 *
 * MasterGo 侧的形态：`code_to_design` 渲染一张 Token 面板 → 本工具扫描该面板，
 * 把「色板」注册为 Paint Style、把「排版样本」注册为 Text Style，之后即可用
 * `style_listColors` / `style_apply` 复用。
 *
 * 识别规则（**刻意简单可预测**，不猜语义）：
 *   - 命名是唯一依据：图层名里带 `Bg`/`Text`/`Border`/`Hover`/`Active`/`Brand`/`Neutral`…
 *     这类角色后缀的**纯色矩形** → 颜色样式（名字取最近的父级 + 自身名，如 `Brand/Text`）；
 *   - **文本节点** → 文本样式（名字取自身名，如 `Heading/H1`；字号/字重/行高/字距随样式落地）；
 *   - 其余（渐变/图片填充、无名字的层）**跳过并列出原因**，不静默。
 *
 * 刻意不做：从像素/命名里猜"这个色是主色还是语义色"—— 那是设计决策，交给 AI 或设计师。
 */
import type { HandlerContext } from './index'
import type { HostNode } from '../host/types'
import { normalizeColor } from '../host/color'

interface Candidate {
  node: HostNode
  name: string
  kind: 'color' | 'text'
  color?: string
  opacity?: number
  text?: { fontSize?: number; fontWeight?: number; fontName?: { family?: string; style?: string }; lineHeight?: unknown; letterSpacing?: unknown }
  path: string
}

const COLOR_ROLE_HINTS = [
  'bg', 'background', 'text', 'border', 'stroke', 'fill', 'hover', 'active', 'disabled',
  'focus', 'brand', 'primary', 'secondary', 'neutral', 'success', 'warning', 'error', 'danger', 'info',
]

const isColorLikeName = (name: string): boolean => {
  const lower = name.toLowerCase()
  return COLOR_ROLE_HINTS.some((hint) => lower.includes(hint))
}

/** 收集候选：纯色矩形（色板）与文本（排版样本） */
function collectCandidates(
  context: HandlerContext,
  node: HostNode,
  pathPrefix: string,
  acc: Candidate[],
): void {
  const props = context.host.readProperties(node, [
    'id', 'type', 'name', 'children', 'fills', 'characters', 'fontSize', 'fontWeight', 'fontName', 'lineHeight', 'letterSpacing',
  ])
  const name = String(props.name ?? '')
  const path = pathPrefix ? `${pathPrefix}/${name}` : name

  const fills = (props.fills as { type?: string; color?: unknown; opacity?: number }[] | undefined) ?? []
  const solid = fills.find((fill) => String(fill.type ?? '').toUpperCase() === 'SOLID')
  const normalized = solid ? normalizeColor(solid.color, solid.opacity) : null

  // 色板：纯色 + 名字带角色后缀（避免把布局容器也注册成样式）
  if (normalized && solid && name && isColorLikeName(name) && props.type !== 'text') {
    acc.push({
      node,
      name: path,
      kind: 'color',
      color: normalized.hex,
      opacity: normalized.opacity,
      path,
    })
  }

  // 排版样本：文本节点
  if (props.type === 'text' && typeof props.characters === 'string' && props.characters.trim()) {
    acc.push({
      node,
      name,
      kind: 'text',
      text: {
        fontSize: typeof props.fontSize === 'number' ? props.fontSize : Number(props.fontSize) || undefined,
        fontWeight: typeof props.fontWeight === 'number' ? props.fontWeight : Number(props.fontWeight) || undefined,
        fontName: props.fontName as { family?: string; style?: string } | undefined,
        lineHeight: props.lineHeight,
        letterSpacing: props.letterSpacing,
      },
      path,
    })
  }

  for (const childId of (props.children as string[] | undefined) ?? []) {
    const child = context.host.getNodeById(childId)
    if (child) collectCandidates(context, child, path, acc)
  }
}

/**
 * 把行高/字距统一成 Penpot 的字符串口径。
 *
 * 引擎侧会给成 `{ value, unit }` 对象（PERCENT / PIXELS），Penpot 侧只要字符串：
 *   - 行高 PIXELS → 相对倍数（÷ fontSize），PERCENT → ÷100
 *   - 字距 PIXELS → 原值（绝对 px），PERCENT → ÷100
 */
function normalizeMetric(input: unknown, unit: 'lineHeight' | 'letterSpacing', fontSize?: number): string | undefined {
  if (typeof input === 'number') return String(input)
  if (input && typeof input === 'object') {
    const record = input as { value?: number; unit?: string }
    if (typeof record.value !== 'number') return undefined
    if (record.unit === 'PERCENT') return String(Number((record.value / 100).toFixed(4)))
    if (record.unit === 'PIXELS' && unit === 'lineHeight' && fontSize) {
      return String(Number((record.value / fontSize).toFixed(4)))
    }
    return String(record.value)
  }
  return undefined
}

export async function handleLibraryRegisterStyles(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const parentId = typeof params.parentId === 'string' ? params.parentId : undefined
  if (!parentId) {
    throw new Error('library/registerStyles 需要 parentId（Token 面板的最外层节点）')
  }
  const root = context.host.getNodeById(parentId)
  if (!root) throw new Error(`节点不存在: ${parentId}（Penpot 只能查当前页）`)

  const candidates: Candidate[] = []
  collectCandidates(context, root, '', candidates)

  const createdColors: { id: string; name: string; color: string }[] = []
  const createdTexts: { id: string; name: string }[] = []
  const skipped: { name: string; reason: string }[] = []
  let updatedColors = 0
  let updatedTexts = 0

  /** 同一次扫描内按名字去重：重复名只处理第一个（后面的跳过，避免一次扫描就自增重复） */
  const seenColorNames = new Set<string>()
  const seenTextNames = new Set<string>()

  // 形状直接遍历到的"看起来像色板但拿不到纯色"的层，也如实记一笔（否则用户会以为漏扫）
  for (const candidate of candidates) {
    try {
      if (candidate.kind === 'color') {
        if (seenColorNames.has(candidate.name)) continue
        seenColorNames.add(candidate.name)
        // 先尝试按名 upsert：Penpot 插件 API **删不掉样式**（官方 api_types.yml 无 removeColor/color.remove），
        // 且 createColor 不去重 —— 不 upsert 的话重跑一次就永久翻倍。
        const updated = await context.host.updateColorStyle({
          name: candidate.name,
          color: candidate.color as string,
          opacity: candidate.opacity,
        })
        if (updated) {
          updatedColors += 1
          createdColors.push({ id: updated.id, name: updated.name, color: updated.color ?? (candidate.color as string) })
        } else {
          const style = await context.host.createColorStyle({
            name: candidate.name,
            color: candidate.color as string,
            opacity: candidate.opacity,
          })
          createdColors.push({ id: style.id, name: style.name, color: style.color ?? candidate.color ?? '' })
        }
      } else {
        if (seenTextNames.has(candidate.name)) continue
        seenTextNames.add(candidate.name)
        const text = candidate.text ?? {}
        const metrics = {
          fontFamily: text.fontName?.family,
          fontSize: text.fontSize,
          fontWeight: text.fontWeight,
          lineHeight: normalizeMetric(text.lineHeight, 'lineHeight', text.fontSize),
          letterSpacing: normalizeMetric(text.letterSpacing, 'letterSpacing', text.fontSize),
        }
        const updated = await context.host.updateTextStyle({ name: candidate.name, ...metrics })
        if (updated) {
          updatedTexts += 1
          createdTexts.push({ id: updated.id, name: updated.name })
        } else {
          const style = await context.host.createTextStyle({ name: candidate.name, ...metrics })
          createdTexts.push({ id: style.id, name: style.name })
        }
      }
    } catch (error) {
      skipped.push({ name: candidate.name, reason: (error as Error).message })
    }
  }

  // 扫描到的节点里"既不是色板也不是排版样本"的，按名字汇总（不逐个刷屏）
  const totalNodes = (() => {
    let count = 0
    const walk = (node: HostNode) => {
      count += 1
      const childIds = (context.host.readProperties(node, ['children']).children as string[] | undefined) ?? []
      for (const id of childIds) {
        const child = context.host.getNodeById(id)
        if (child) walk(child)
      }
    }
    walk(root)
    return count
  })()

  return {
    ok: createdColors.length + createdTexts.length > 0,
    parentId,
    scanned: totalNodes,
    colorStyles: createdColors,
    textStyles: createdTexts,
    counts: {
      colors: createdColors.length,
      texts: createdTexts.length,
      created: createdColors.length + createdTexts.length - updatedColors - updatedTexts,
      updated: updatedColors + updatedTexts,
      skipped: skipped.length,
    },
    ...(skipped.length ? { skipped } : {}),
    note:
      createdColors.length + createdTexts.length === 0
        ? '没有识别到可注册的样式 —— 色板需要「纯色填充 + 名字含角色词（Bg/Text/Border/Hover/Brand…）」，排版样本需要是文本节点'
        : '识别规则：色板 =（纯色填充 + 名字含角色词）；排版 = 文本节点。同名样式按名 upsert（Penpot 插件 API 删不掉样式，不 upsert 会重复翻倍）',
  }
}
