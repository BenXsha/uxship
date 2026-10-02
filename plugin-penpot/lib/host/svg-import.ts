/**
 * 简单 SVG → 单条可编辑矢量路径
 *
 * 为什么需要它（Penpot 侧的硬事实）：
 *   - `penpot.createShapeFromSvg()` 返回的是 **Group**。而 Penpot 的 Group 尺寸由子元素
 *     推导，`resize()` 基本无效 —— 于是「把 24×24 的图标放进 20×20 的位置」做不到，
 *     MasterGo 侧同样踩过这个坑（那边用 `relativeTransform` 缩放绕开）。
 *   - 图标的颜色也丢了：引擎已把 `currentColor` 替换成计算色**写进 SVG 字符串**，
 *     但当 Group 落地后我们对它设 `fills` 不会影响到子路径。
 *
 * 而 Penpot 的 `Path.d` 是**可写的**（官方 api_types.yml：`d: string`，
 * 注明「The content of the path shape, defined as the path string」）。
 * 所以对「简单图标」，正确做法是：把 SVG 里的图元合并成一条 path data，建**一个 Path**，
 * 然后就能正常 resize / 改色 —— 这才是矢量图标该有的样子。
 *
 * 只在「能安全转换」时才走这条路；任何拿不准的情况返回 null，由调用方回退到
 * `createShapeFromSvg`（那条路会把颜色/变换原样交给宿主处理）。
 *
 * 纯字符串解析，不用 DOMParser —— 插件沙箱里 DOM 可用性不是我们能假设的。
 */

export interface SimpleSvgAnalysis {
  /** 合并后的 path data（多子路径拼接），坐标系与 viewBox 一致 */
  d: string
  /** 视觉由填充还是描边构成（Lucide/Feather 是 stroke，Remix 是 fill） */
  paint: 'fill' | 'stroke'
  /** 统一色；null 表示 SVG 未指定颜色（视为继承 currentColor） */
  color: string | null
  strokeWidth: number
  viewBox: { minX: number; minY: number; width: number; height: number }
  /** 合并了多少个图元（日志/报告用） */
  elementCount: number
  /** 缩放后的墨迹尺寸（目标尺寸缩放后；未给目标时是 viewBox 下的墨迹尺寸） */
  ink: { width: number; height: number }
  /** 本次使用的缩放系数 */
  scale: number
  /**
   * 线帽（**DSL 口径**：`ROUND` / `SQUARE`；缺省 = 平头）。
   *
   * 为什么要提取：Lucide / Remix 这类线条图标的默认就是 `stroke-linecap="round"`，
   * 而 Penpot 的 Path 默认是**平头** —— 不提取的话每个圆头图标都会变成方头（肉眼可见）。
   * Penpot 有 `strokeCapStart/strokeCapEnd` 两个成员，所以这一项**能保真**。
   *
   * 对应的 `stroke-linejoin` **不在本处处理**：Penpot 的 stroke 模型没有 line-join 成员，
   * 拐角只能按 miter 表现 —— 属**已知限制**，记在 `rules/17-host-differences.md §3`。
   */
  cap?: string
}

/** 这些标记一旦出现就放弃自行转换（交给宿主按原样导入更安全） */
const BAIL_OUT_PATTERNS: RegExp[] = [
  /<image[\s>]/i,
  /<text[\s>]/i,
  /<use[\s>]/i,
  /<foreignObject[\s>]/i,
  /<linearGradient[\s>]/i,
  /<radialGradient[\s>]/i,
  /<pattern[\s>]/i,
  /<filter[\s>]/i,
  /clip-path|clipPath[\s>]/i,
  /mask[\s="=]/i,
  /<style[\s>]/i,
  // transform 无法安全烘焙进平面路径（旋转/缩放/斜切都会变形）
  /transform\s*=/i,
]

/** 读一个属性值（支持单/双引号与无引号） */
function readAttr(source: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s/>]+))`, 'i').exec(source)
  if (!match) return null
  return match[2] ?? match[3] ?? match[4] ?? null
}

function readNumber(source: string, name: string, fallback = 0): number {
  const raw = readAttr(source, name)
  if (raw === null) return fallback
  const numeric = parseFloat(raw)
  return Number.isFinite(numeric) ? numeric : fallback
}

/** 从 `style="fill:#fff;stroke:none"` 里取属性（行内样式优先级高于属性） */
function readStyleValue(elementHtml: string, property: string): string | null {
  const style = readAttr(elementHtml, 'style')
  if (!style) return null
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(style)
  return match ? match[1].trim() : null
}

function readPaint(elementHtml: string, property: 'fill' | 'stroke'): string | null {
  return readStyleValue(elementHtml, property) ?? readAttr(elementHtml, property)
}

const isNoneOrEmpty = (value: string | null): boolean =>
  !value || value.trim().toLowerCase() === 'none' || value.trim() === ''

/** 数字序列 → 点对 */
function toPoints(raw: string): { x: number; y: number }[] {
  const numbers = (raw.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number).filter(Number.isFinite)
  const points: { x: number; y: number }[] = []
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push({ x: numbers[i], y: numbers[i + 1] })
  return points
}

const fmt = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000
  return String(rounded)
}

/** 图元 → path data 片段（绝对坐标） */
/**
 * 各命令的参数个数（SVG 路径语法）
 */
const PATH_ARG_COUNT: Record<string, number> = {
  m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0,
}

/** 参数里哪些是坐标对（其余是旋转角/flags，不能缩放语义） */
const ARC_ARGS = { rx: 0, ry: 1, angle: 2, largeArc: 3, sweep: 4, x: 5, y: 6 }

interface PathCommandToken {
  cmd: string
  args: number[]
}

/** 把 path data 拆成命令序列（不做几何校验，够用即可；非法输入原样返回 null） */
function parsePathCommands(d: string): PathCommandToken[] | null {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g)
  if (!tokens) return null

  const out: PathCommandToken[] = []
  let index = 0
  let current: PathCommandToken | null = null

  while (index < tokens.length) {
    const token = tokens[index]
    if (/^[A-Za-z]$/.test(token)) {
      const count = PATH_ARG_COUNT[token.toLowerCase()]
      if (count === undefined) return null
      current = { cmd: token, args: [] }
      out.push(current)
      index += 1
      if (count === 0) continue
      // 命令可后跟多组参数（SVG 允许隐式重复）
      while (index < tokens.length && !/^[A-Za-z]$/.test(tokens[index]) && current.args.length < count) {
        current.args.push(Number(tokens[index]))
        index += 1
      }
      continue
    }
    // 隐式重复：'M/m' 后续组按 'L/l' 处理，其余沿用当前命令
    if (!current) return null
    const repeatCmd = current.cmd === 'M' ? 'L' : current.cmd === 'm' ? 'l' : current.cmd
    const count = PATH_ARG_COUNT[repeatCmd.toLowerCase()]
    const group: number[] = []
    while (index < tokens.length && !/^[A-Za-z]$/.test(tokens[index]) && group.length < count) {
      group.push(Number(tokens[index]))
      index += 1
    }
    if (group.length !== count) return null
    out.push({ cmd: repeatCmd, args: group })
  }
  return out
}

export interface FittedPath {
  /** 变换后的 path data（墨迹左上角已平移到 (0,0)） */
  d: string
  /** 变换后的墨迹尺寸 —— 调用方据此在目标框内居中 */
  ink: { width: number; height: number }
}

/**
 * 按比例缩放 path data，并把墨迹左上角平移到 (0,0)。
 *
 * ## 为什么必须这么做（真机踩出来的）
 *
 * `penpot.createPath()` + `path.d = <viewBox 坐标>` 之后，对形状调 `resize(w, h)`
 * **不会缩放路径几何** —— 实测结果是：24×24 viewBox 的图标放进 18×18 的位置后，
 * 画布上看到的是「24×24 画面里的一个 18×18 窗口」：图标跑位、被裁、压扁成条状
 * （真机现象：邮箱图标在框内墨迹为 0、logo 墨迹被压成 27×18、特性图标只剩 17×7 的碎片）。
 *
 * 正确做法是**在写 `d` 之前就把坐标缩放到目标尺寸**，让形状的自然尺寸就等于目标尺寸。
 *
 * 缩放规则（均匀缩放 s + 平移 t）：
 *   - 绝对命令：`s*x + t`；相对命令：只缩放增量（不加平移）；`h/v` 只动一个轴；
 *   - `A/a` 的 `rx/ry` 缩放，`rotation/flags` 不动；
 *   - `Z` 无参数。
 */
export function scalePathData(d: string, scale: number, translate: { x: number; y: number } = { x: 0, y: 0 }): FittedPath | null {
  const commands = parsePathCommands(d)
  if (!commands) return null

  const sx = (value: number) => value * scale + translate.x
  const sy = (value: number) => value * scale + translate.y

  // 先算墨迹包围盒（用绝对终点/控制点近似 —— 只为居中，不需要精确的贝塞尔极值）
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  let cursor = { x: 0, y: 0 }
  const note = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  for (const { cmd, args } of commands) {
    const lower = cmd.toLowerCase()
    const abs = cmd === cmd.toUpperCase()
    const px = (v: number) => (abs ? v : cursor.x + v)
    const py = (v: number) => (abs ? v : cursor.y + v)
    switch (lower) {
      case 'm': case 'l': case 't':
        cursor = { x: px(args[0]), y: py(args[1]) }; note(cursor.x, cursor.y); break
      case 'h': cursor = { x: px(args[0]), y: cursor.y }; note(cursor.x, cursor.y); break
      case 'v': cursor = { x: cursor.x, y: py(args[0]) }; note(cursor.x, cursor.y); break
      case 'c':
        note(px(args[0]), py(args[1])); note(px(args[2]), py(args[3]))
        cursor = { x: px(args[4]), y: py(args[5]) }; note(cursor.x, cursor.y); break
      case 's': case 'q':
        note(px(args[0]), py(args[1]))
        cursor = { x: px(args[2]), y: py(args[3]) }; note(cursor.x, cursor.y); break
      case 'a':
        cursor = { x: px(args[ARC_ARGS.x]), y: py(args[ARC_ARGS.y]) }; note(cursor.x, cursor.y); break
      default: break
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null

  // ⚠️ 相对命令/圆弧半径**也要乘 scale**：曾经这里只做四舍五入，
  // 于是 `h20 v20` 这类相对命令完全没被缩放（测试抓到的真实 bug）
  /** 只做四舍五入（**不缩放**）—— 用于格式化已变换的值 */
  const round3 = (value: number) => Math.round(value * 1000) / 1000
  const scaleNum = (value: number) => Math.round(value * scale * 1000) / 1000
  const emit: string[] = []
  for (const { cmd, args } of commands) {
    const lower = cmd.toLowerCase()
    const abs = cmd === cmd.toUpperCase()
    if (lower === 'z') { emit.push(cmd); continue }
    const out: number[] = []
    const pushPair = (x: number, y: number) => { out.push(sx(x), sy(y)) }
    switch (lower) {
      case 'm': case 'l': case 't':
        if (abs) pushPair(args[0] - minX, args[1] - minY); else out.push(...args.map(scaleNum))
        break
      case 'h':
        out.push(abs ? sx(args[0] - minX) : scaleNum(args[0])); break
      case 'v':
        out.push(abs ? sy(args[0] - minY) : scaleNum(args[0])); break
      case 'c':
        if (abs) { pushPair(args[0] - minX, args[1] - minY); pushPair(args[2] - minX, args[3] - minY); pushPair(args[4] - minX, args[5] - minY) }
        else out.push(...args.map(scaleNum))
        break
      case 's': case 'q':
        if (abs) { pushPair(args[0] - minX, args[1] - minY); pushPair(args[2] - minX, args[3] - minY) }
        else out.push(...args.map(scaleNum))
        break
      case 'a': {
        out.push(scaleNum(args[ARC_ARGS.rx]), scaleNum(args[ARC_ARGS.ry]), args[ARC_ARGS.angle], args[ARC_ARGS.largeArc], args[ARC_ARGS.sweep])
        if (abs) pushPair(args[ARC_ARGS.x] - minX, args[ARC_ARGS.y] - minY)
        else out.push(scaleNum(args[ARC_ARGS.x]), scaleNum(args[ARC_ARGS.y]))
        break
      }
      default:
        out.push(...args)
    }
    // ⚠️ 这里只做「四舍五入后转字符串」，**不能**再用 scaleNum（它会乘 scale =>
    // 已变换过的值会被二次缩放：7.5 变 5.625，而整数 15 看起来正常 —— 极其隐蔽）
    emit.push(`${cmd}${out.map((n) => String(round3(n))).join(' ')}`)
  }

  return {
    d: emit.join(' '),
    // ink 已经是目标尺寸单位，不能再过一次 scaleNum（那会重复缩放）
    ink: { width: round3((maxX - minX) * scale), height: round3((maxY - minY) * scale) },
  }
}

function elementToPath(tag: string, html: string): string | null {
  switch (tag) {
    case 'path': {
      const d = readAttr(html, 'd')
      return d && d.trim() ? d.trim() : null
    }
    case 'circle': {
      const cx = readNumber(html, 'cx')
      const cy = readNumber(html, 'cy')
      const r = readNumber(html, 'r')
      if (r <= 0) return null
      return `M ${fmt(cx - r)} ${fmt(cy)} a ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(r * 2)} 0 a ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-r * 2)} 0 Z`
    }
    case 'ellipse': {
      const cx = readNumber(html, 'cx')
      const cy = readNumber(html, 'cy')
      const rx = readNumber(html, 'rx')
      const ry = readNumber(html, 'ry', rx)
      if (rx <= 0 || ry <= 0) return null
      return `M ${fmt(cx - rx)} ${fmt(cy)} a ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(rx * 2)} 0 a ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(-rx * 2)} 0 Z`
    }
    case 'rect': {
      const x = readNumber(html, 'x')
      const y = readNumber(html, 'y')
      const w = readNumber(html, 'width')
      const h = readNumber(html, 'height')
      if (w <= 0 || h <= 0) return null
      const rxRaw = readNumber(html, 'rx', readNumber(html, 'ry', 0))
      const rx = Math.max(0, Math.min(rxRaw, w / 2))
      const ry = Math.max(0, Math.min(readNumber(html, 'ry', rx), h / 2))
      if (rx === 0 || ry === 0) {
        return `M ${fmt(x)} ${fmt(y)} H ${fmt(x + w)} V ${fmt(y + h)} H ${fmt(x)} Z`
      }
      return [
        `M ${fmt(x + rx)} ${fmt(y)}`,
        `H ${fmt(x + w - rx)}`,
        `A ${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + w)} ${fmt(y + ry)}`,
        `V ${fmt(y + h - ry)}`,
        `A ${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + w - rx)} ${fmt(y + h)}`,
        `H ${fmt(x + rx)}`,
        `A ${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x)} ${fmt(y + h - ry)}`,
        `V ${fmt(y + ry)}`,
        `A ${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + rx)} ${fmt(y)}`,
        'Z',
      ].join(' ')
    }
    case 'line': {
      const x1 = readNumber(html, 'x1')
      const y1 = readNumber(html, 'y1')
      const x2 = readNumber(html, 'x2')
      const y2 = readNumber(html, 'y2')
      return `M ${fmt(x1)} ${fmt(y1)} L ${fmt(x2)} ${fmt(y2)}`
    }
    case 'polyline':
    case 'polygon': {
      const points = toPoints(readAttr(html, 'points') ?? '')
      if (points.length < 2) return null
      const head = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`
      const rest = points.slice(1).map((p) => `L ${fmt(p.x)} ${fmt(p.y)}`).join(' ')
      return tag === 'polygon' ? `${head} ${rest} Z` : `${head} ${rest}`
    }
    default:
      return null
  }
}

const CONVERTIBLE = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'])

/**
 * 判断能否安全地把 SVG 转成单条路径；不能则返回 null。
 *
 * 判定「单色单风格」是核心：只要出现两种不同颜色，或者混合了填充与描边图元，
 * 就说明这是多色/复合图标，必须交给 `createShapeFromSvg` 保留原貌。
 */
/**
 * 把 SVG 根标签的 `width`/`height` 改写成目标尺寸。
 *
 * 回退路径（`createShapeFromSvg`）的尺寸由 SVG 自己的 width/height 决定，而 Iconify
 * 返回的是 `width="1em" height="1em"` —— 直接交给宿主会得到一个 1px 左右的图形
 * （真机现象：输入框里的图标塌缩成一个点、或者只剩碎片）。
 * 保留 viewBox 不动，只改尺寸，形状会按 viewBox 等比放大。
 */
export function normalizeSvgSize(svg: string, target: { width?: number; height?: number }): string {
  if (!target.width && !target.height) return svg
  const rootMatch = /<svg\b[^>]*>/i.exec(svg)
  if (!rootMatch) return svg
  let root = rootMatch[0]
  const viewBox = readAttr(svg, 'viewBox')
  const parts = viewBox ? viewBox.split(/[\s,]+/).map(Number).filter(Number.isFinite) : []
  const vbW = parts.length === 4 ? parts[2] : 0
  const vbH = parts.length === 4 ? parts[3] : 0

  const width = target.width ?? (vbW ? (vbH ? (target.height ?? vbH) * (vbW / vbH) : vbW) : undefined)
  const height = target.height ?? (vbH ? (vbW ? (target.width ?? vbW) * (vbH / vbW) : vbH) : undefined)

  const setAttr = (tag: string, name: string, value: number | undefined) => {
    if (value === undefined || !Number.isFinite(value)) return tag
    const numeric = Math.round(value * 100) / 100
    const pattern = new RegExp(`\\s${name}="[^"]*"`, 'i')
    return pattern.test(tag) ? tag.replace(pattern, ` ${name}="${numeric}"`) : tag.replace(/<svg/i, `<svg ${name}="${numeric}"`)
  }
  root = setAttr(root, 'width', width)
  root = setAttr(root, 'height', height)
  return svg.replace(rootMatch[0], root)
}

export function analyzeSimpleSvg(svg: string, target?: { width?: number; height?: number }): SimpleSvgAnalysis | null {
  if (typeof svg !== 'string') return null
  const source = svg.trim()
  if (!source || !/<svg[\s>]/i.test(source)) return null

  for (const pattern of BAIL_OUT_PATTERNS) {
    if (pattern.test(source)) return null
  }

  // ── 根标签上的 paint 会被子元素**继承** ──
  // 这是 Lucide / Feather 这类图标的写法：`<svg fill="none" stroke="#fff">`，
  // 子元素自己什么颜色都不写。只看子元素会把这类图标当成「默认黑填充」。
  const rootTag = /<svg\b[^>]*>/i.exec(source)?.[0] ?? ''
  const rootFill = readPaint(rootTag, 'fill')
  const rootStroke = readPaint(rootTag, 'stroke')
  const rootStrokeWidthRaw = readAttr(rootTag, 'stroke-width')
  const rootStrokeWidth = rootStrokeWidthRaw === null ? null : parseFloat(rootStrokeWidthRaw)
  // 线帽也会被根标签继承（Lucide/Lucide 风格：`<svg fill="none" stroke-linecap="round">`）
  const rootLinecap = readAttr(rootTag, 'stroke-linecap')

  // viewBox / 尺寸
  const viewBoxRaw = readAttr(source, 'viewBox')
  let viewBox = { minX: 0, minY: 0, width: 0, height: 0 }
  if (viewBoxRaw) {
    const parts = viewBoxRaw.split(/[\s,]+/).map(Number).filter(Number.isFinite)
    if (parts.length === 4) {
      viewBox = { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] }
    }
  }
  if (viewBox.width <= 0 || viewBox.height <= 0) {
    const w = readNumber(source, 'width', 0)
    const h = readNumber(source, 'height', 0)
    if (w > 0 && h > 0) viewBox = { minX: 0, minY: 0, width: w, height: h }
  }
  if (viewBox.width <= 0 || viewBox.height <= 0) return null

  // 逐元素提取（不需要嵌套解析：只关心叶子图元，且已排除 transform）
  const elementPattern = /<(path|circle|ellipse|rect|line|polyline|polygon)\b([^>]*)\/?>/gi
  const segments: string[] = []
  const colors = new Set<string>()
  const strokeWidths = new Set<number>()
  const linecaps = new Set<string>()
  let sawFill = false
  let sawStroke = false
  let elementCount = 0

  for (const match of source.matchAll(elementPattern)) {
    const tag = match[1].toLowerCase()
    const html = match[0]
    if (!CONVERTIBLE.has(tag)) return null

    const d = elementToPath(tag, html)
    if (!d) return null
    segments.push(d)
    elementCount += 1

    const fillRaw = readPaint(html, 'fill') ?? rootFill
    const strokeRaw = readPaint(html, 'stroke') ?? rootStroke
    const strokeWidth = readNumber(html, 'stroke-width', rootStrokeWidth ?? 1)
    const linecap = (readAttr(html, 'stroke-linecap') ?? rootLinecap)?.trim().toLowerCase()
    if (linecap) linecaps.add(linecap)

    const fillVisible = !isNoneOrEmpty(fillRaw)
    const strokeVisible = !isNoneOrEmpty(strokeRaw)

    if (fillVisible) {
      sawFill = true
      const normalized = fillRaw!.trim().toLowerCase()
      if (normalized !== 'currentcolor') colors.add(normalized)
    }
    if (strokeVisible) {
      sawStroke = true
      strokeWidths.add(Math.round(strokeWidth * 100) / 100)
      const normalized = strokeRaw!.trim().toLowerCase()
      if (normalized !== 'currentcolor') colors.add(normalized)
    }

    if (!fillVisible && !strokeVisible) {
      // 两者都没写：SVG 默认 fill=black（视为填充）
      sawFill = true
    }
  }

  if (!segments.length) return null
  if (colors.size > 1) return null // 多色图标：交给 createShapeFromSvg
  if (sawFill && sawStroke) return null // 混合风格：无法用一个 Path 表达
  if (strokeWidths.size > 1) return null // 多种描边宽度
  // 多种线帽：一条 Path 只有一个 stroke，两个成员只能表达一种值
  if (linecaps.size > 1) return null

  // 多子路径直接拼接：SVG 路径语法本来就允许一条 d 里带多个 M/Z 子路径
  const rawD = segments.join(' ')
  const rawStrokeWidth = strokeWidths.size === 1 ? [...strokeWidths][0] : (rootStrokeWidth ?? 1)

  // 给了目标尺寸就**把坐标缩放过去**（详见 scalePathData 的注释：resize 不缩放 Path 几何）；
  // 没给目标尺寸则保持原样 —— 此时形状的自然尺寸就是它的墨迹尺寸，调用方不需要缩放。
  const hasTarget = Boolean(target?.width || target?.height)
  const scale = hasTarget
    ? Math.min(
        (target!.width ?? viewBox.width) / viewBox.width,
        (target!.height ?? viewBox.height) / viewBox.height,
      )
    : 1

  const fitted = scalePathData(rawD, scale, { x: 0, y: 0 })
  if (!fitted) return null

  return {
    d: hasTarget ? fitted.d : rawD,
    paint: sawStroke && !sawFill ? 'stroke' : 'fill',
    color: colors.size === 1 ? [...colors][0] : null,
    // 描边宽度也要跟着缩放，否则小图标会显得线条过粗
    strokeWidth: hasTarget ? rawStrokeWidth * scale : rawStrokeWidth,
    viewBox,
    elementCount,
    /** 墨迹尺寸（调用方用来在目标框里居中） */
    ink: fitted.ink,
    /** 本次使用的缩放系数（1 = 未缩放） */
    scale,
    /** 线帽（DSL 口径）—— 只认 round/square；butt 与未声明都不写（Penpot 默认就是平头） */
    ...(linecaps.size === 1
      ? { cap: [...linecaps][0] === 'round' ? 'ROUND' : [...linecaps][0] === 'square' ? 'SQUARE' : undefined }
      : {}),
  }
}
