#!/usr/bin/env node
/**
 * 选区对比工具 —— 把「预期效果 vs 实际渲染」两个画板逐节点 diff
 *
 * 为什么需要它：视觉问题靠肉眼只能看出"不对"，看不出**哪一层、哪个属性**不对。
 * 典型场景就是这次的单边边框/图标偏移 —— 肉眼是"看着偏了"，跑一次本脚本立刻得到
 * `Border Top 的 d = M499,2.5`（父层在 (519,318)），一眼定位到「读到了未结算的位置」。
 *
 * 用法：
 *   1. 在 Penpot 里**同时选中两个画板**（Ctrl/⌘ 点选），第一个视为「预期」，第二个视为「实际」
 *   2. node scripts/diff-selection.mjs            # 默认 http://127.0.0.1:15490
 *      node scripts/diff-selection.mjs --port 15499 --session sess_penpot_xxx
 *
 * 输出：结构差异（谁多了谁少了）+ 逐节点字段差异（忽略 ≤1px 的几何抖动，
 * 以及两个画板之间整体的位置平移 —— 后者通常是"把 B 摆在 A 右边"造成的，不是差异）。
 */

const args = process.argv.slice(2)
const readArg = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : fallback
}
const PORT = Number(readArg('--port', 15490))
const ENDPOINT = `http://127.0.0.1:${PORT}/mcp`
const EXPLICIT_SESSION = readArg('--session', null)

/** 每层读取的字段（node_get 的 fields 是服务端的白名单过滤，只过滤顶层键） */
const FIELDS = [
  'id', 'type', 'name', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible',
  'fills', 'strokes', 'shadows', 'layoutMode', 'characters', 'growType', 'children',
]

async function rpc(name, toolArgs) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: toolArgs } }),
  })
  const body = await res.json()
  if (body.error) throw new Error(`${name}: ${JSON.stringify(body.error)}`)
  const text = body?.result?.content?.[0]?.text
  try {
    return JSON.parse(text)
  } catch {
    return { __raw: text }
  }
}

async function resolveSession() {
  if (EXPLICIT_SESSION) return EXPLICIT_SESSION
  const list = await rpc('session_list', {})
  const session = list.sessions?.find((s) => s.backend === 'penpot') ?? list.sessions?.[0]
  if (!session) throw new Error('没有已连接的插件会话 —— 先在 Penpot 里点「连接 MCP 服务端」')
  return session.sessionId
}

/** 递归抓取一棵树：key = 子节点下标路径（结构对齐比 id/名字对齐更可靠） */
async function capture(session, nodeId, path, acc) {
  const props = await rpc('node_get', { _sessionId: session, nodeId, fields: FIELDS })
  const childIds = props.children ?? []
  const { children, ...rest } = props
  void children
  acc[path] = rest
  for (let i = 0; i < childIds.length; i += 1) {
    await capture(session, childIds[i], `${path}/${i}`, acc)
  }
  return acc
}

const color = (input) => {
  if (!input || typeof input !== 'object') return String(input)
  if (input.fillColorGradient) {
    const g = input.fillColorGradient
    const stops = g.stops.map((s) => `${s.color}@${round(s.opacity)}:${s.offset}`).join(',')
    return `GRAD(${g.type} ${g.startX},${g.startY}→${g.endX},${g.endY} w=${g.width} [${stops}])`
  }
  if (input.fillColor) return `${input.fillColor}@${round(input.fillOpacity ?? 1)}`
  if (input.fillImage) return 'IMAGE'
  return JSON.stringify(input).slice(0, 50)
}

const stroke = (input) => {
  if (!input || typeof input !== 'object') return String(input)
  if (input.strokeColorGradient) {
    const g = input.strokeColorGradient
    return `GRAD(${g.type} [${g.stops.map((s) => s.color).join(',')}]) w=${input.strokeWidth}`
  }
  return `${input.strokeColor}@${round(input.strokeOpacity ?? 1)} w=${input.strokeWidth} ${input.strokeAlignment}`
}

const round = (value) => Math.round(Number(value ?? 0) * 100) / 100

/** 取每个节点用于比较的归一化摘要 */
function summarize(record) {
  const out = { type: record.type, name: record.name }
  for (const key of ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible']) {
    if (record[key] !== undefined && record[key] !== null) out[key] = round(record[key])
  }
  if (record.layoutMode) out.layoutMode = record.layoutMode
  if (record.characters !== undefined && record.characters !== null) out.text = record.characters
  if (record.growType) out.growType = record.growType
  if (record.fills?.length) out.fills = record.fills.map(color)
  if (record.strokes?.length) out.strokes = record.strokes.map(stroke)
  if (record.shadows?.length) {
    out.shadows = record.shadows.map((s) => `${s.style} ${s.offsetX},${s.offsetY} blur=${s.blur} ${s.color?.color}@${round(s.color?.opacity ?? 1)}`)
  }
  return out
}

async function main() {
  const session = await resolveSession()
  const sel = await rpc('selection_get', { _sessionId: session })
  const nodes = sel.nodes ?? []
  if (nodes.length < 2) {
    console.error(`需要**同时选中两个画板**（当前选中 ${nodes.length} 个）。第一个 = 预期，第二个 = 实际。`)
    process.exit(1)
  }

  const [a, b] = nodes
  const [treeA, treeB] = [await capture(session, a.id, '0', {}), await capture(session, b.id, '0', {})]

  console.log(`\nA(预期) = ${a.name}  ${nodes.length ? '' : ''}共 ${Object.keys(treeA).length} 个节点`)
  console.log(`B(实际) = ${b.name}  共 ${Object.keys(treeB).length} 个节点`)

  // 两个画板之间的整体平移（通常是"把 B 摆在 A 右边"），差值里扣掉它才对得齐
  const offset = { x: round(b.x - a.x), y: round(b.y - a.y) }

  const onlyA = Object.keys(treeA).filter((p) => !(p in treeB))
  const onlyB = Object.keys(treeB).filter((p) => !(p in treeA))
  if (onlyA.length) console.log(`\n仅 A 有（${onlyA.length}）：${onlyA.map((p) => treeA[p].name).join(', ')}`)
  if (onlyB.length) console.log(`仅 B 有（${onlyB.length}）：${onlyB.map((p) => treeB[p].name).join(', ')}`)

  let diffCount = 0
  for (const path of Object.keys(treeA).filter((p) => p in treeB).sort()) {
    const sa = summarize(treeA[path])
    const sb = summarize(treeB[path])
    const fieldDiffs = []
    for (const key of [...new Set([...Object.keys(sa), ...Object.keys(sb)])].sort()) {
      const va = sa[key]
      const vb = sb[key]
      // 数组/对象必须按值比较 —— 用 `===` 比引用会让**每一个** fills/strokes 都被误报成差异
      const same = Array.isArray(va) || Array.isArray(vb) || (va && typeof va === 'object')
        ? JSON.stringify(va) === JSON.stringify(vb)
        : va === vb
      if (same) continue
      // 几何差异：扣掉整体平移；≤1px 视为抖动忽略
      if (['x', 'y'].includes(key) && typeof va === 'number' && typeof vb === 'number') {
        if (Math.abs(va + offset[key] - vb) <= 1) continue
      }
      if (['width', 'height'].includes(key) && typeof va === 'number' && typeof vb === 'number') {
        if (Math.abs(va - vb) <= 1) continue
      }
      fieldDiffs.push([key, va, vb])
    }
    if (!fieldDiffs.length) continue
    diffCount += 1
    console.log(`\n── [${path}] ${sa.name ?? sb.name}  (${sa.type ?? sb.type})`)
    for (const [key, va, vb] of fieldDiffs) {
      console.log(`     ${key.padEnd(10)} A=${JSON.stringify(va)}`)
      console.log(`     ${''.padEnd(10)} B=${JSON.stringify(vb)}`)
    }
  }

  console.log(`\n共 ${diffCount} 个节点存在差异（已忽略整体平移 ${offset.x},${offset.y} 与 ≤1px 抖动）`)
  if (diffCount === 0 && !onlyA.length && !onlyB.length) console.log('两个画板完全一致 🎉')
}

main().catch((error) => {
  console.error(`❌ ${error.message}`)
  process.exit(1)
})
