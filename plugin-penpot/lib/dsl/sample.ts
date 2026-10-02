/**
 * 内置样例 DSL —— 面板「本地自测 / 完整样例」的素材（不经任何服务端）
 *
 * 这份样例的定位是**能力点检卡**：每一项都对应一个已知的跨宿主差异或最近修过的坑，
 * 跑一次就能看出「哪些能力真的落地了、哪些进了降级」。改动时请保持这个性质 ——
 * 别把它改成"好看但看不出能力"的稿子。
 *
 * 覆盖清单（与 `内部笔记` §7/§12 对应）：
 *   基础形状     frame / rectangle / ellipse / text
 *   逃生口形状   polygon（点生成）/ star（点+内半径）/ line / pen（手写 path data）
 *   填充         SOLID / GRADIENT_LINEAR / GRADIENT_RADIAL / GRADIENT_ANGULAR（预期降级）
 *   边框         四边原生整圈 / 单边（叠加 Path 模拟）/ 渐变描边（strokeColorGradient）
 *   特效         DROP_SHADOW / INNER_SHADOW / LAYER_BLUR / BACKGROUND_BLUR
 *   文本         字重 / 行高 / 对齐 / 自动高度
 *   布局         VERTICAL + HORIZONTAL flex、gap、padding、items-center、FILL
 */
import type { DSLDocument, DSLElement } from './types'

const BRAND = '#31EFB8'
const INDIGO = '#4340EA'
const AMBER = '#F59E0B'
const SURFACE = '#1F2937'
const BG = '#0B1220'
const TEXT = '#E5E7EB'
const MUTED = '#9CA3AF'

/** 一个 2×2 的圆角"格子"，用来并排展示形状/特效 */
function tile(name: string, extra: Partial<DSLElement> = {}, children: DSLElement[] = []): DSLElement {
  return {
    type: 'frame',
    name,
    size: { width: 84, height: 84 },
    cornerRadius: 12,
    layoutMode: 'VERTICAL',
    itemSpacing: 8,
    paddingTop: 12,
    paddingRight: 12,
    paddingBottom: 12,
    paddingLeft: 12,
    clipsContent: false,
    fills: [{ type: 'SOLID', color: '#FFFFFF0A' }],
    ...extra,
    children,
  } as DSLElement
}

function caption(text: string): DSLElement {
  return {
    type: 'text',
    name: 'Caption',
    content: text,
    size: { width: 60 },
    fontSize: 10,
    lineHeight: { unit: 'PIXELS', value: 14 },
    textAlignHorizontal: 'CENTER',
    fills: [{ type: 'SOLID', color: MUTED }],
  } as DSLElement
}

function sectionTitle(text: string): DSLElement {
  return {
    type: 'text',
    name: `Section / ${text}`,
    content: text,
    size: { width: 320 },
    fontSize: 11,
    fontWeight: 600,
    lineHeight: { unit: 'PIXELS', value: 16 },
    letterSpacing: { unit: 'PERCENT', value: 0.08 },
    fills: [{ type: 'SOLID', color: '#6B7280' }],
  } as DSLElement
}

function section(name: string, children: DSLElement[]): DSLElement {
  return {
    type: 'frame',
    name,
    layoutMode: 'VERTICAL',
    itemSpacing: 10,
    layoutSizingHorizontal: 'FILL',
    children: [sectionTitle(name), ...children],
  } as DSLElement
}

/** 横排一行（flex row） */
function row(name: string, children: DSLElement[], extra: Partial<DSLElement> = {}): DSLElement {
  return {
    type: 'frame',
    name,
    layoutMode: 'HORIZONTAL',
    itemSpacing: 10,
    counterAxisAlignItems: 'CENTER',
    layoutSizingHorizontal: 'FILL',
    ...extra,
    children,
  } as DSLElement
}

export const SAMPLE_DSL: DSLDocument = {
  version: '2.0',
  elements: [
    {
      type: 'frame',
      name: '能力点检 / DSL → Penpot',
      position: { x: 0, y: 0 },
      size: { width: 360, height: 0 },
      layoutMode: 'VERTICAL',
      itemSpacing: 18,
      paddingTop: 20,
      paddingRight: 20,
      paddingBottom: 20,
      paddingLeft: 20,
      cornerRadius: 18,
      clipsContent: false,
      fills: [{ type: 'GRADIENT_LINEAR', gradientStops: [{ position: 0, color: BG }, { position: 1, color: '#111827' }] }],
      effects: [
        { type: 'DROP_SHADOW', offset: { x: 0, y: 16 }, radius: 36, spread: -8, color: '#00000066' },
      ],
      children: [
        // ── 头部：基础形状 + 文本层级 ──
        row('Header', [
          {
            type: 'rectangle',
            name: 'Logo',
            size: { width: 12, height: 12 },
            cornerRadius: 4,
            fills: [{ type: 'SOLID', color: BRAND }],
          } as DSLElement,
          {
            type: 'text',
            name: 'Title',
            content: '宿主能力点检',
            size: { width: 300 },
            fontSize: 16,
            fontWeight: 600,
            lineHeight: { unit: 'PIXELS', value: 22 },
            fills: [{ type: 'SOLID', color: TEXT }],
            layoutSizingHorizontal: 'FILL',
          } as DSLElement,
        ]),
        {
          type: 'text',
          name: 'Intro',
          content: '每一项对应一个已知的跨宿主差异。跑完请看 report.skipped —— 非空即表示有降级。',
          size: { width: 320 },
          fontSize: 11,
          lineHeight: { unit: 'PIXELS', value: 17 },
          fills: [{ type: 'SOLID', color: MUTED }],
          layoutSizingHorizontal: 'FILL',
        } as DSLElement,

        // ── 1. 逃生口形状：Penpot 没有原生图元，用「生成 d + Path」落地 ──
        section('1 · 矢量形状（逃生口）', [
          row('Shape Row', [
            tile('Polygon', {}, [
              { type: 'polygon', name: 'Hexagon', pointCount: 6, size: { width: 40, height: 40 }, fills: [{ type: 'SOLID', color: INDIGO }] } as DSLElement,
              caption('polygon 6'),
            ]),
            tile('Star', {}, [
              { type: 'star', name: 'Star5', pointCount: 5, innerRadius: 0.42, size: { width: 40, height: 40 }, fills: [{ type: 'SOLID', color: BRAND }] } as DSLElement,
              caption('star 5'),
            ]),
            tile('Line', {}, [
              { type: 'line', name: 'Segment', size: { width: 48, height: 40 }, strokes: [{ color: '#F87171', width: 3 }] } as DSLElement,
              caption('line'),
            ]),
            tile('Pen', {}, [
              {
                type: 'pen',
                name: 'Curve',
                // 手写路径：一段 S 形曲线 + 闭合三角，用来验证 path data 直通
                svgPathData: 'M 4 32 C 14 4, 30 4, 40 32 Z',
                size: { width: 44, height: 40 },
                fills: [{ type: 'SOLID', color: AMBER }],
              } as DSLElement,
              caption('pen'),
            ]),
          ]),
        ]),

        // ── 2. 填充：三种渐变 + 降级示例 ──
        section('2 · 填充与渐变', [
          row('Fill Row A', [
            {
              type: 'rectangle',
              name: 'Linear',
              size: { width: 100, height: 36 },
              cornerRadius: 8,
              fills: [
                {
                  type: 'GRADIENT_LINEAR',
                  gradientStops: [{ position: 0, color: BRAND }, { position: 1, color: INDIGO }],
                  gradientHandlePositions: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
                },
              ],
            } as DSLElement,
            {
              type: 'ellipse',
              name: 'Radial',
              size: { width: 48, height: 48 },
              fills: [
                {
                  type: 'GRADIENT_RADIAL',
                  gradientStops: [{ position: 0, color: '#F9FAFB' }, { position: 1, color: '#00000000' }],
                  // 归一化 handles + 椭圆比例（引擎的真实形态）
                  gradientHandlePositions: [{ x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }],
                  transform: [[0.6, 0, 0], [0, 1, 0]],
                },
              ],
            } as DSLElement,
            {
              type: 'rectangle',
              name: 'Conic（预期降级）',
              size: { width: 100, height: 36 },
              cornerRadius: 8,
              fills: [
                {
                  type: 'GRADIENT_ANGULAR',
                  gradientStops: [{ position: 0, color: BRAND }, { position: 1, color: INDIGO }],
                },
              ],
            } as DSLElement,
          ]),
          {
            type: 'text',
            name: 'Fill Note',
            content: 'Conic 在 Penpot 无原生表达 → 会降级为第一个色标的纯色，并在 skipped 里说明。',
            size: { width: 320 },
            fontSize: 10,
            lineHeight: { unit: 'PIXELS', value: 15 },
            fills: [{ type: 'SOLID', color: '#6B7280' }],
            layoutSizingHorizontal: 'FILL',
          } as DSLElement,
        ]),

        // ── 3. 边框：原生整圈 / 单边模拟 / 渐变描边 ──
        section('3 · 边框', [
          row('Border Row A', [
            {
              type: 'rectangle',
              name: 'Native Ring',
              size: { width: 100, height: 56 },
              cornerRadius: 10,
              fills: [{ type: 'SOLID', color: SURFACE }],
              strokes: [{ color: '#374151', width: 2 }],
            } as DSLElement,
            {
              type: 'rectangle',
              name: 'Bottom Only',
              size: { width: 100, height: 56 },
              cornerRadius: 10,
              fills: [{ type: 'SOLID', color: SURFACE }],
              // 单边：Penpot 插件 API 无 per-side → 适配器用叠加 Path 模拟
              strokes: [{ color: BRAND, width: 2 }],
              strokeBottomWeight: 2,
            } as DSLElement,
            {
              type: 'rectangle',
              name: 'Gradient Border',
              size: { width: 100, height: 56 },
              cornerRadius: 10,
              fills: [{ type: 'SOLID', color: SURFACE }],
              strokes: [
                {
                  type: 'GRADIENT_LINEAR',
                  gradientStops: [{ position: 0, color: BRAND }, { position: 1, color: INDIGO }],
                  gradientHandlePositions: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
                  width: 2,
                },
              ],
            } as DSLElement,
          ]),
          {
            type: 'text',
            name: 'Border Note',
            content: '单边边框落地后会多出一个 Border Bottom 图层（可继续改色/改宽）。相邻异色时角部会重叠，属已知取舍。',
            size: { width: 320 },
            fontSize: 10,
            lineHeight: { unit: 'PIXELS', value: 15 },
            fills: [{ type: 'SOLID', color: '#6B7280' }],
            layoutSizingHorizontal: 'FILL',
          } as DSLElement,
        ]),

        // ── 4. 特效：四类各一个 ──
        section('4 · 特效', [
          row('Effect Row', [
            tile('DropShadow', {
              effects: [{ type: 'DROP_SHADOW', offset: { x: 0, y: 8 }, radius: 18, spread: -2, color: '#00000080' }],
            }, [caption('drop')]),
            tile('InnerShadow', {
              effects: [{ type: 'INNER_SHADOW', offset: { x: 0, y: 2 }, radius: 6, spread: 0, color: '#31EFB866' }],
            }, [caption('inner')]),
            tile('LayerBlur', {
              effects: [{ type: 'LAYER_BLUR', radius: 3 }],
            }, [caption('blur')]),
            tile('BackdropBlur', {
              effects: [{ type: 'BACKGROUND_BLUR', radius: 6 }],
            }, [caption('backdrop')]),
          ]),
        ]),

        // ── 5. 文本层级 + 半透明分隔线（最易踩的两个坑）──
        section('5 · 文本与透明度', [
          {
            type: 'rectangle',
            name: 'Divider',
            size: { width: 320, height: 1 },
            layoutSizingHorizontal: 'FILL',
            fills: [{ type: 'SOLID', color: '#FFFFFF14' }],
          } as DSLElement,
          row('Text Row', [
            {
              type: 'text',
              name: 'Weights',
              content: 'Regular 400 · Medium 500',
              size: { width: 180 },
              fontSize: 12,
              fontWeight: 400,
              lineHeight: { unit: 'PIXELS', value: 18 },
              fills: [{ type: 'SOLID', color: TEXT }],
            } as DSLElement,
            {
              type: 'text',
              name: 'Right Aligned',
              content: 'Right',
              size: { width: 130 },
              fontSize: 12,
              textAlignHorizontal: 'RIGHT',
              lineHeight: { unit: 'PIXELS', value: 18 },
              fills: [{ type: 'SOLID', color: BRAND }],
            } as DSLElement,
          ]),
          // group：验证「先建子节点再成组」这条两段式路径（Penpot 没有创建空组的 API）
          {
            type: 'group',
            name: 'Footnote Group',
            children: [
              {
                type: 'text',
                name: 'Footnote A',
                content: '① 整体偏黑/偏白 → 颜色量纲错',
                size: { width: 320 },
                fontSize: 10,
                lineHeight: { unit: 'PIXELS', value: 15 },
                fills: [{ type: 'SOLID', color: '#4B5563' }],
              } as DSLElement,
              {
                type: 'text',
                name: 'Footnote B',
                content: '② 子节点顺序反了 → naturalChildOrdering 未生效',
                size: { width: 320 },
                fontSize: 10,
                lineHeight: { unit: 'PIXELS', value: 15 },
                fills: [{ type: 'SOLID', color: '#4B5563' }],
              } as DSLElement,
            ],
          } as DSLElement,
          {
            type: 'text',
            name: 'Footer',
            content: '若此卡整体偏黑/偏白 → 颜色量纲出错；若子节点顺序反了 → naturalChildOrdering 未生效。',
            size: { width: 320 },
            fontSize: 10,
            lineHeight: { unit: 'PIXELS', value: 15 },
            fills: [{ type: 'SOLID', color: '#4B5563' }],
            layoutSizingHorizontal: 'FILL',
          } as DSLElement,
        ]),
      ],
    },
  ],
}

/** 极简 DSL：只画一个矩形。用于「宿主是否接通」的最快判断。 */
export const SMOKE_DSL: DSLDocument = {
  version: '2.0',
  elements: [
    {
      type: 'frame',
      name: 'uxship Smoke Test',
      position: { x: 0, y: 0 },
      size: { width: 240, height: 120 },
      cornerRadius: 12,
      layoutMode: 'VERTICAL',
      itemSpacing: 8,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      fills: [{ type: 'SOLID', color: '#4340EA' }],
      children: [
        {
          type: 'text',
          name: 'Smoke Title',
          content: 'uxship · Penpot 已连通',
          size: { width: 208 },
          fontSize: 14,
          fontWeight: 600,
          lineHeight: { unit: 'PIXELS', value: 20 },
          fills: [{ type: 'SOLID', color: '#FFFFFF' }],
        },
        {
          type: 'rectangle',
          name: 'Smoke Bar',
          size: { width: 208, height: 6 },
          cornerRadius: 3,
          layoutSizingHorizontal: 'FILL',
          fills: [{ type: 'SOLID', color: '#31EFB8' }],
        },
      ],
    },
  ],
}
