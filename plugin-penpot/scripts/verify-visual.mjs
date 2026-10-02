#!/usr/bin/env node
/**
 * 渲染结果的空间核对（导出 PNG → 逐框量墨迹）
 *
 * ## 为什么需要它
 *
 * 「节点尺寸读出来是对的」**不等于**「画布上看起来是对的」。真机踩过：
 * `Email Icon` 板在 (914,321,18×18)、子 path 自报 15×14 —— 读属性一切正常，
 * 但像素一量：**框内墨迹 0px**，而框外 13px 处有墨迹。根因是 `path.d` 用的是
 * viewBox 坐标、而 `resize()` 不缩放 Path 几何 → 画布上看到的是「24×24 画面里的
 * 一个 18×18 窗口」（图标跑位 + 被裁 + 压成条）。
 *
 * 所以核对必须落到像素：把每个小容器（图标之类）的框裁出来，量
 * **框内墨迹**、**紧邻外圈**、以及**框内为空时最近的墨迹距离**。
 *
 * 判定口径（都是"疑似"，最终看数字）：
 *   - 框内为空 / 极少，且附近有墨迹 → 跑位（`最近墨迹 Npx`：N 可能是图形本体，
 *     也可能是旁边的边框或文字 —— 它证明的是"框内是空的"，不是"图形一定在那儿"）；
 *   - 墨迹两轴都没填到框的 60% → 疑似被裁 / 落错尺寸（图标一般会填到 70%+）；
 *   - 框跨出画布 → 坐标不可信（`node_get` 对 flex 子层返回父层相对坐标），只报不判。
 *
 * ⚠️ 第一版写错过一次：PNG 解码漏了 zlib inflate，拿压缩数据当扫描线 → 量出来全是噪声，
 * 判定跟着全错。现在解码器与 PIL 对同坐标采样一致（4/4 命中）才算数 —— **量具本身也要校准**。
 *
 * 用法：
 *   node scripts/verify-visual.mjs --node <rootId> [--png out.png] [--max 48]
 *   node scripts/verify-visual.mjs --png existing.png --boxes boxes.json   # 离线复用已有 PNG
 *
 * 退出码：0 全部正常；1 发现跑位/空框（可直接当门禁用）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MCP = process.env.UXSHIP_MCP_HTTP ?? 'http://127.0.0.1:15490/mcp'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

async function tool(name, args) {
  const response = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  const payload = await response.json()
  if (payload.error) throw new Error(`${name}: ${payload.error.message}`)
  const text = payload.result?.content?.[0]?.text
  return text ? JSON.parse(text) : payload.result
}

/** 走一遍节点树，收集所有「小容器」（默认 ≤48px，图标/徽标这一档） */
async function collectBoxes(rootId, maxSize) {
  const boxes = []
  const walk = async (id, depth) => {
    if (depth > 8) return
    const node = await tool('node_get', { nodeId: id, fields: ['name', 'type', 'x', 'y', 'width', 'height', 'children'] })
    const width = Number(node.width ?? 0)
    const height = Number(node.height ?? 0)
    if (width > 0 && height > 0 && width <= maxSize && height <= maxSize) {
      boxes.push({ id, name: node.name, x: Number(node.x ?? 0), y: Number(node.y ?? 0), width, height })
    }
    for (const childId of node.children ?? []) await walk(childId, depth + 1)
  }
  await walk(rootId, 0)
  return boxes
}

/**
 * 导出 PNG 取回字节。
 *
 * 三条路都要认（客户端/服务端版本不同）：
 *   1. `saveToPath` → 服务端直接落盘（最省事，需要插件端已修好 data URI）；
 *   2. 返回 text/JSON → `{data: 'data:image/png;base64,…'}`；
 *   3. 返回 MCP image content block → `content[0].data`（裸 base64）。
 */
async function fetchPng(nodeId, outPath) {
  const result = await tool('node_export_image', { nodeId, format: 'PNG', constraint: { type: 'SCALE', value: 1 }, saveToPath: outPath })
  if (existsSync(outPath)) return readFileSync(outPath)

  const nested = Array.isArray(result?.content) ? result.content[0] : undefined
  const raw0 = result?.data ?? nested?.data ?? nested?.text
  if (typeof raw0 !== 'string' || !raw0) {
    throw new Error(`导出未拿到图像数据：${JSON.stringify(result).slice(0, 200)}`)
  }
  const raw = raw0.startsWith('data:') ? raw0.split(',', 1)[1] : raw0
  return Buffer.from(raw, 'base64')
}

/** 极简 PNG 解码：只处理本项目导出会遇到的 8bit RGB/RGBA、非隔行 */
function decodePng(buffer) {
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const bitDepth = buffer[24]
  const colorType = buffer[25]
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (bitDepth !== 8 || !channels || buffer[28] !== 0) {
    throw new Error(`不支持的 PNG 规格（bitDepth=${bitDepth} colorType=${colorType} interlace=${buffer[28]}）`)
  }
  const chunks = []
  let offset = 8
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (type === 'IDAT') chunks.push(buffer.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
  }
  // ⚠️ IDAT 里是 **zlib 压缩**过的扫描线 —— 漏掉这一步会把压缩数据当像素，
  // 于是量出来全是噪声（第一版就是这么错的，判定随之全错）
  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  let source = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source]
    source += 1
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source + x]
      const left = x >= channels ? pixels[y * stride + x - channels] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0
      let out = value
      if (filter === 1) out = value + left
      else if (filter === 2) out = value + up
      else if (filter === 3) out = value + ((left + up) >> 1)
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft)
        out = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)
      }
      pixels[y * stride + x] = out & 0xff
    }
    source += stride
  }
  return { width, height, channels, pixels }
}

const luma = (image, x, y) => {
  const i = (y * image.width + x) * image.channels
  const [r, g, b] = [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]]
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * 量一个框的墨迹：**框内** 与 **紧邻外圈**（同一背景基准）。
 *
 * 基准取框内的众数亮度 —— 两者用同一个基准，才能比较「框内 vs 框外」；
 * 第一版对外圈单独取基准，导致做差出来的"外圈墨迹"恒为 0（工具失真）。
 */
function measure(image, box, margin = 8) {
  const clamp = (value, max) => Math.max(0, Math.min(max, value))
  const inner = {
    x0: clamp(Math.round(box.x), image.width), y0: clamp(Math.round(box.y), image.height),
    x1: clamp(Math.round(box.x + box.width), image.width), y1: clamp(Math.round(box.y + box.height), image.height),
  }
  const outer = {
    x0: clamp(inner.x0 - margin, image.width), y0: clamp(inner.y0 - margin, image.height),
    x1: clamp(inner.x1 + margin, image.width), y1: clamp(inner.y1 + margin, image.height),
  }

  const histogram = new Array(256).fill(0)
  for (let y = inner.y0; y < inner.y1; y += 1) {
    for (let x = inner.x0; x < inner.x1; x += 1) histogram[Math.round(luma(image, x, y))] += 1
  }
  const background = histogram.indexOf(Math.max(...histogram))

  const xs = []; const ys = []
  let inside = 0; let ring = 0
  for (let y = outer.y0; y < outer.y1; y += 1) {
    for (let x = outer.x0; x < outer.x1; x += 1) {
      if (Math.abs(luma(image, x, y) - background) <= 24) continue
      const isInside = x >= inner.x0 && x < inner.x1 && y >= inner.y0 && y < inner.y1
      if (isInside) { inside += 1; xs.push(x); ys.push(y) } else ring += 1
    }
  }
  const area = Math.max(1, (inner.x1 - inner.x0) * (inner.y1 - inner.y0))
  return {
    ink: inside,
    ring,
    ratio: inside / area,
    background,
    ...(xs.length ? { bbox: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 } } : {}),
  }
}

/**
 * 从框向外逐圈找第一处墨迹，返回距离（用于判定「图形跑位到框外多远」）。
 *
 * 比单看固定外圈更有信息量：那次的 bug 是「框内 0px、13px 外才是图形」，
 * 8px 的固定外圈正好错过它。
 */
function nearestInkDistance(image, box, background, maxRadius = 28) {
  for (let radius = 4; radius <= maxRadius; radius += 4) {
    let ink = 0
    const x0 = Math.max(0, Math.round(box.x - radius)); const y0 = Math.max(0, Math.round(box.y - radius))
    const x1 = Math.min(image.width, Math.round(box.x + box.width + radius)); const y1 = Math.min(image.height, Math.round(box.y + box.height + radius))
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const inside = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height
        if (inside) continue
        if (Math.abs(luma(image, x, y) - background) > 24) ink += 1
      }
    }
    if (ink > 20) return radius
  }
  return null
}

const nodeId = arg('node')
const pngPath = arg('png', join(tmpdir(), 'render-check.png'))
const boxesPath = arg('boxes')
const maxSize = Number(arg('max', '48'))

let image
if (boxesPath) {
  image = decodePng(readFileSync(pngPath))
} else {
  if (!nodeId) throw new Error('需要 --node <rootId>（或 --boxes + --png 离线复用）')
  writeFileSync(pngPath, await fetchPng(nodeId, pngPath))
  image = decodePng(readFileSync(pngPath))
}
console.log(`图像 ${image.width}×${image.height}  ← ${pngPath}`)

const boxes = boxesPath
  ? JSON.parse(readFileSync(boxesPath, 'utf-8'))
  : await collectBoxes(nodeId, maxSize)

console.log(`\n小容器（≤${maxSize}px）共 ${boxes.length} 个，逐框量墨迹：\n`)
let failures = 0
for (const box of boxes) {
  // 坐标可信度：`node_get` 对 **flex 子层**返回的是父层相对坐标（Penpot 内部就是
  // parent-x/parent-y），所以落在外面的框不能当判据 —— 报出来但不下结论。
  const outsideImage = box.x < 0 || box.y < 0 || box.x + box.width > image.width || box.y + box.height > image.height
  if (outsideImage) {
    console.log(`  ${String(box.name).slice(0, 26).padEnd(26)} ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}  —— 框不在画布内，坐标不可信（flex 子层相对坐标），跳过判定`)
    continue
  }

  const stats = measure(image, box)
  // 判定 1：框内几乎没墨、紧邻外圈却有墨 → 图形画到框外了（那个图标 bug 的指纹）
  const misplaced = stats.ink <= 2 && stats.ring > 20
  // 判定 2：墨迹在两个轴上都没填到框的 60%（图标一般会填到 70%+）→ 疑似被裁/压扁/落错尺寸
  const fill = stats.bbox
    ? Math.min(stats.bbox.w / box.width, stats.bbox.h / box.height)
    : 0
  // 「填得不满」对**字形**是正常的（勾号 8×6、单个汉字 11×11 都远小于框），所以只作信息；
  // 只有「几乎为空」（<25%）才算可疑。第一版拿 60% 当红线，把勾号和「或」字都误报成"被裁"
  // —— 量具的判据同样需要校准，否则会产生假警报。
  const underfilled = stats.ink > 2 && fill < 0.6
  const suspiciouslyEmpty = stats.ink > 2 && fill < 0.25
  const emptyButNeighbourHasInk = stats.ink <= 2 && nearestInkDistance(image, box, stats.background) !== null
  if (misplaced || emptyButNeighbourHasInk || suspiciouslyEmpty) failures += 1
  const flag = misplaced
    ? '❌ 跑位（框内空、框外有墨）'
    : stats.ink <= 2
      ? (() => {
          const distance = nearestInkDistance(image, box, stats.background)
          return distance ? `❌ 框内空，最近墨迹在 ${distance}px 外（图形跑位）` : '⚠️ 空框（周边也无可疑墨迹）'
        })()
      : suspiciouslyEmpty
        ? `❌ 墨迹几乎为空（只填 ${(fill * 100).toFixed(0)}%）`
        : underfilled
          ? `⚠️ 墨迹偏小（${(fill * 100).toFixed(0)}%）——字形通常如此`
          : '✅'
  console.log(
    `  ${String(box.name).slice(0, 26).padEnd(26)} ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}` +
    `  框内 ${String(stats.ink).padStart(5)}px (${(stats.ratio * 100).toFixed(1)}%)  外圈 ${String(stats.ring).padStart(4)}px` +
    (stats.bbox ? `  bbox ${stats.bbox.w}×${stats.bbox.h}` : '') + `  ${flag}`,
  )
}

console.log(failures ? `\n❌ ${failures} 个容器图形跑位` : '\n✅ 没有发现图形跑位')
process.exit(failures ? 1 : 0)
