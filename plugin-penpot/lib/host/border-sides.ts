/**
 * 单边描边的几何生成（纯函数，可单测）
 *
 * 背景：**Penpot 的插件 API 不支持 per-side 描边**。
 * 已核实的证据：
 *   - 内部模型有 `:stroke-width-top/right/bottom/left`（`common/src/app/common/types/stroke.cljc`
 *     的 `materialize-stroke-side-widths`，UI 描边面板就在用，`:stroke-width` 只镜像 top）；
 *   - 但插件 API 的解析器 `app.plugins.parser/parse-stroke` 只读固定的 11 个键
 *     （strokeColor / strokeStyle / strokeWidth / strokeAlignment / strokeCap* / strokeColorGradient /
 *      strokeImage …），**不认四边**，传了也会被固定 map 丢掉。
 *   → 上游只要给 `parse-stroke` 补 4 个字段即可开放，是个很小的 patch；在那之前只能自己模拟。
 *
 * 方案：用 **Path + `d` + 原生 stroke** 把需要的边画出来。
 * 相比 `createShapeFromSvg`（颜色烘焙进 SVG、无法再改色）或叠加矩形（圆角难处理），
 * Path 方案是**真正的矢量描边**：能在 Penpot 里直接改颜色/宽度/虚线，且用到的全是文档化 API。
 *
 * 尺寸语义：HTML 的 `border` 在 `box-sizing: border-box` 下**画在盒子内侧**，
 * 而 Penpot 的描边以路径为轴居中。因此每条边向**内缩 strokeWidth/2**，让描色带正好落在盒内。
 *
 * ── 方案取舍：为什么是「描边」而不是「填充梯形」（A 方案，已定）─────────────────
 *
 * 更"逐像素等价 CSS"的做法是每条边画一个**填充多边形**，相邻两边在角上按 **45° 对角切分**
 * （CSS 的边框本来就是面积，不是描边）。评估后不采用，两个理由：
 *
 *   1. **可编辑性优先**：描边路径落地后在 Penpot 的 **Strokes 面板**里就是一条正常描边，
 *      设计师能直接改色/改宽/改虚线；填充梯形则会变成一个形状的 fill，
 *      在面板里看到的是"某个奇怪多边形的填充"，反而难改。
 *   2. **渐变语义不被压扁**：Penpot 的渐变相对**形状包围盒**。细长条带（340×1）上的填充渐变
 *      会被压成近乎纯色；描边路径至少还能按线的包围盒铺开。
 *
 * **已知代价（刻意不修，不是 bug）**：当**相邻两条边颜色/宽度不同**时，
 * 两条边各画整长，角上会重叠成一个 `w×w` 的小方块（后画者覆盖先画者），
 * 而 CSS 是对角切分。同色或只有一条边时完全无差异（这是绝大多数情况）。
 * 若哪天要彻底对齐 CSS，改法就是切到填充梯形 —— 那时需同步更新本节说明与相关用例。
 */

export type BorderSide = 'top' | 'right' | 'bottom' | 'left'

/** 固定顺序：top → right → bottom → left（保证同样输入产出同样的 `d`，便于测试与 diff） */
export const SIDE_ORDER: readonly BorderSide[] = ['top', 'right', 'bottom', 'left']

const fmt = (value: number): string => String(Math.round(value * 1000) / 1000)

/**
 * 生成若干条边的 path data。
 *
 * 坐标以盒子左上角为原点（调用方负责整体平移），尺寸为 `width × height`：
 *   - top    → `M 0,w/2 H width`
 *   - bottom → `M 0,height-w/2 H width`
 *   - left   → `M w/2,0 V height`
 *   - right  → `M width-w/2,0 V height`
 *
 * 多条边会拼成**一条含多个子路径的 d**（Penpot 的 Path 原生支持），
 * 因此「上下两条同宽同色的边」只占**一个节点**。
 */
export function buildSidesPath(
  sides: readonly BorderSide[],
  width: number,
  height: number,
  strokeWidth: number,
  offsetX = 0,
  offsetY = 0,
): string {
  const w = Math.max(0, strokeWidth)
  const inset = w / 2
  const left = offsetX
  const right = offsetX + Math.max(0, width)
  const top = offsetY
  const bottom = offsetY + Math.max(0, height)

  const segments: string[] = []
  for (const side of SIDE_ORDER) {
    if (!sides.includes(side)) continue
    switch (side) {
      case 'top':
        segments.push(`M ${fmt(left)} ${fmt(top + inset)} H ${fmt(right)}`)
        break
      case 'bottom':
        segments.push(`M ${fmt(left)} ${fmt(bottom - inset)} H ${fmt(right)}`)
        break
      case 'left':
        segments.push(`M ${fmt(left + inset)} ${fmt(top)} V ${fmt(bottom)}`)
        break
      case 'right':
        segments.push(`M ${fmt(right - inset)} ${fmt(top)} V ${fmt(bottom)}`)
        break
    }
  }
  return segments.join(' ')
}

/**
 * 把描边按「能否共用一条路径」分组。
 *
 * 分组键 = 颜色 + 宽度 + 虚线 + 对齐 + 渐变：
 * 只有键完全相同的一条或多条边才能合进同一条 Path（一条 Path 只有一个 stroke）。
 */
export interface SideGroupKeyInput {
  colorKey: string
  width: number
  dashKey: string
  alignKey: string
  gradientKey: string
}

export function sideGroupKey(input: SideGroupKeyInput): string {
  return [input.colorKey, input.width, input.dashKey, input.alignKey, input.gradientKey].join('|')
}

/**
 * 边名 → 可读标签（用于图层命名，让用户在 Penpot 里一眼看懂这是什么）。
 * 四边齐时不该走这套模拟（用原生整圈描边），因此这里只处理 1–3 条。
 */
export function describeSides(sides: readonly BorderSide[]): string {
  const ordered = SIDE_ORDER.filter((side) => sides.includes(side))
  if (ordered.length === 4) return 'Border'
  const label: Record<BorderSide, string> = {
    top: 'Top',
    right: 'Right',
    bottom: 'Bottom',
    left: 'Left',
  }
  return `Border ${ordered.map((s) => label[s]).join('+')}`
}

/**
 * 叠加层的落点由 `PenpotHost` 直接算：
 *   `d` 是**页面绝对坐标**，所以用「父层结算后的绝对位置 + 本层相对偏移」，
 *   并且**先 `waitForLayoutUpdate()`** 再读位置。
 *
 * （早先这里有个 `resolveBorderPlacement` 的两分支规则：非 flex 用绝对坐标、
 *   flex 用父级相对坐标。实测它会让边框整体偏移 —— 因为 Path 的 x/y 读出来是绝对值，
 *   而写的时候又不是；两种语义混在一个函数里迟早出错，故删掉，只保留一条规则。）
 */
