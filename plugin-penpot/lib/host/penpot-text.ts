/**
 * 富文本区间（P2-3）—— Penpot 的 `Text.getRange()` / `TextRange` 读写。
 *
 * 为什么单独成模块：`TextRange` 是**跨 iframe 代理对象**，每次读写都是一次往返；
 * 且它只在 text 形状上存在。把「切区间 → 逐段写样式」与「逐字读回 → 按样式分组」收在一处，
 * 调用方（renderer / exporter）就不必各自处理类型收窄与预算。
 *
 * 依赖方向单向：`PenpotHost` → 本模块；状态型原语（`requireText`）通过 `TextDeps` 传入。
 */
import { toPenpotFills } from './penpot-paint'
import type { HostNode, HostTextRun } from './types'

/**
 * 逐字扫描上限：超过则不导出 runs。
 * 理由：读回 run **只能逐字 `getRange`**（Penpot 没有「枚举区间」），每次都是一次跨 iframe 往返 ——
 * 长段落会把导出拖爆。宁可退回单 run 并如实说明，也不挂死。
 */
export const MAX_RUN_SCAN = 120

export interface TextDeps {
  /** HostNode → Penpot 文本形状（非文本节点应抛错，而不是静默当空） */
  requireText(node: HostNode, feature: string): PenpotText
}

function numOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** 从区间填充里取纯色 hex（`fills` 为 `'mixed'` 或非纯色时返回 undefined） */
function colorOf(range: PenpotTextRange): string | undefined {
  const fills = range.fills
  if (!Array.isArray(fills)) return undefined
  for (const fill of fills) {
    const value = (fill as PenpotFill | undefined)?.fillColor
    if (typeof value === 'string' && value) return value.toUpperCase()
  }
  return undefined
}

/**
 * 把多 run 文本落到文本节点：先整体写 `characters`，再按 run 顺序切 `[start,end)` 逐段上样式。
 * 单条 run 的颜色失败不中断其它 run，原因进 `note`（不静默）。
 */
export async function applyTextRuns(
  deps: TextDeps,
  node: HostNode,
  runs: readonly HostTextRun[],
): Promise<{ applied: boolean; runCount: number; characters: number; note?: string }> {
  const text = deps.requireText(node, 'applyTextRuns')
  if (!runs.length) return { applied: false, runCount: 0, characters: 0, note: 'runs 为空' }

  const content = runs.map((run) => run.text).join('')
  text.characters = content

  const notes: string[] = []
  let cursor = 0
  for (const run of runs) {
    const start = cursor
    const end = cursor + run.text.length
    cursor = end
    if (end <= start) continue
    const range = text.getRange(start, end)
    if (run.fontSize !== undefined) range.fontSize = String(run.fontSize)
    if (run.fontWeight !== undefined) range.fontWeight = String(run.fontWeight)
    if (run.letterSpacing !== undefined) range.letterSpacing = String(run.letterSpacing)
    if (run.color) {
      const { fills, skipped } = toPenpotFills([{ type: 'SOLID', color: run.color }])
      if (fills.length) range.fills = fills
      else notes.push(`run 颜色 ${run.color} 未落地${skipped.length ? `：${skipped[0]}` : ''}`)
    }
  }

  return {
    applied: true,
    runCount: runs.length,
    characters: content.length,
    ...(notes.length ? { note: notes.join('；') } : {}),
  }
}

/**
 * 读回文本节点的 run 列表：逐字取区间，按 `fontSize|fontWeight|color|letterSpacing` 分组。
 * 文本超过 `MAX_RUN_SCAN` 字时返回 `[]`（调用方据此退回单 run）。
 */
export function readTextRuns(deps: TextDeps, node: HostNode): HostTextRun[] {
  const text = deps.requireText(node, 'readTextRuns')
  const characters = typeof text.characters === 'string' ? text.characters : ''
  if (!characters || characters.length > MAX_RUN_SCAN) return []

  const runs: HostTextRun[] = []
  let current: HostTextRun | null = null
  let currentKey = ''
  for (let i = 0; i < characters.length; i += 1) {
    const range = text.getRange(i, i + 1)
    const fontSize = numOf(range.fontSize)
    const fontWeight = numOf(range.fontWeight)
    const letterSpacing = numOf(range.letterSpacing)
    const color = colorOf(range)
    const key = `${fontSize ?? ''}|${fontWeight ?? ''}|${color ?? ''}|${letterSpacing ?? ''}`
    if (current && key === currentKey) {
      current.text += characters[i]
      continue
    }
    current = {
      text: characters[i],
      ...(fontSize !== undefined ? { fontSize } : {}),
      ...(fontWeight !== undefined ? { fontWeight } : {}),
      ...(letterSpacing !== undefined ? { letterSpacing } : {}),
      ...(color ? { color } : {}),
    }
    runs.push(current)
    currentKey = key
  }
  return runs
}
