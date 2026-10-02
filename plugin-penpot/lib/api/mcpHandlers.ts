/**
 * 诊断类 handler：ping / health / capabilities / dsl-spec
 *
 * `plugin/capabilities` 对应 MasterGo 侧已有的同名能力探测工具。它在 Penpot 侧更重要：
 * Penpot 的 Plugin API 随版本漂移，且 MCP/插件版本必须与 Penpot 版本匹配（分析报告 §8），
 * 因此「这个宿主到底支持什么」必须是一个可查询的一等公民。
 */
import type { HandlerContext } from './index'
import type { DSLDocument } from '../dsl/types'

export function handlePing(): unknown {
  return { ok: true }
}

export function handleHealthGet(_params: Record<string, unknown>, context: HandlerContext): unknown {
  const host = context.host
  let document: unknown = null
  let error: string | undefined

  try {
    document = host.getDocumentInfo()
  } catch (thrown) {
    error = (thrown as Error).message
  }

  return {
    ok: !error,
    host: host.id,
    path: 'plugin',
    document,
    error,
  }
}

/** `health/check`：与 `health/get` 同源，供老客户端调用（服务端两处都登记了） */
export function handleHealthCheck(params: Record<string, unknown>, context: HandlerContext): unknown {
  return handleHealthGet(params, context)
}

/** `fonts/list`：宿主可用字体（AI 选字体前先查，避免写出宿主机没有的字体） */
export async function handleFontsList(
  _params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  try {
    const fonts = await context.host.listFonts()
    const families = [...new Set(fonts.map((f) => f.family))]
    return { ok: true, count: fonts.length, familyCount: families.length, families, fonts }
  } catch (error) {
    // 取不到字体不该让调用失败：返回 available:false + 原因（与变量 API 缺失同一口径）
    return { ok: false, available: false, count: 0, families: [], reason: (error as Error).message }
  }
}

/** `notify`：向用户提示（Penpot 无原生 toast，走插件面板） */
export function handleNotify(params: Record<string, unknown>, context: HandlerContext): unknown {
  const message = typeof params.message === 'string' ? params.message : ''
  if (!message) throw new Error('notify 需要 message')
  const raw = params.options as { type?: string } | undefined
  const kindMap: Record<string, 'info' | 'warning' | 'error' | 'success'> = {
    normal: 'info',
    info: 'info',
    highlight: 'success',
    success: 'success',
    warning: 'warning',
    error: 'error',
  }
  context.notify(message, kindMap[String(raw?.type ?? 'normal')] ?? 'info')
  return { ok: true, notified: message }
}

export function handleCapabilities(_params: Record<string, unknown>, context: HandlerContext): unknown {
  const capabilities = context.host.getCapabilities()
  return {
    ...capabilities,
    pluginVersion: typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : 'dev',
    // 与 MasterGo 侧同一口径：能力缺失返回 available:false，而不是报错
    available: true,
    /**
     * 变体集能力（与 MasterGo 侧同名节点，AI 在两个宿主上读同一个字段）。
     *
     * 探测**不在本文件**：宿主 API 只允许出现在 `lib/host/penpot.ts`（宿主隔离门禁 R1），
     * 那里用 `has(penpot.createVariantFromComponents)` 实时探测；这里只把结果投影出来。
     *
     * 与 MasterGo 的范式差异（不要按 MasterGo 的 typings 写）：
     *   - Penpot 没有 `combineAsVariants`，等价入口是 `createVariantFromComponents(Board[])`；
     *   - 属性轴是**显式**的：`addProperty()` → `renameProperty(0, name)` → 逐变体
     *     `setVariantProperty(0, value)`，且必须按 `mainInstance().id` 配对
     *     （不能信 `variantComponents()` 的顺序，会配错轴值）；
     *   - 服务端 `node_convert_to_component(combineVariants)` 当前只生成**单轴**。
     */
    variants: {
      supported: capabilities.ops.componentVariants,
      createVariantFromComponents: capabilities.ops.componentVariants,
      /** 轴写入方式：Penpot 显式 addProperty/renameProperty/setVariantProperty；缺能力为 null */
      propertyAxes: capabilities.ops.componentVariants ? 'explicit' : null,
      /** 服务端合成路径当前生成的轴数（单轴 `State`） */
      toolAxes: 1,
      probe: 'lib/host/penpot.ts > probe() > has(penpot.createVariantFromComponents)',
    },
  }
}

/**
 * DSL 规范（Penpot 子集）。
 *
 * 只声明**已实现**的部分，避免 AI 按规范生成一堆会被 skipped 的属性。
 * 完整规范见 mcp-server/src/utils/dsl-spec.ts 与 skills/design/rules/08-dsl-specification.md。
 */
export function handleDSLSpec(): unknown {
  const example: DSLDocument = {
    version: '2.0',
    elements: [
      {
        type: 'frame',
        name: 'Card',
        size: { width: 320, height: 200 },
        layoutMode: 'VERTICAL',
        itemSpacing: 12,
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        fills: [{ type: 'SOLID', color: '#FFFFFF' }],
        cornerRadius: 12,
        effects: [{ type: 'DROP_SHADOW', offset: { x: 0, y: 4 }, radius: 12, color: '#0F172A1F' }],
        children: [
          { type: 'text', name: 'Title', content: '标题', fontSize: 16, fontWeight: 600, fills: [{ type: 'SOLID', color: '#111827' }] },
        ],
      },
    ],
  }

  return {
    version: '2.0-penpot-subset',
    host: 'penpot',
    supportedElementTypes: ['frame', 'group', 'rectangle', 'ellipse', 'text', 'svg', 'path', 'component(降级为 frame)'],
    unsupportedElementTypes: [
      'instance',
      'boolean_operation',
      'polygon',
      'star',
      'line',
      'connector',
      'template',
      'generator',
      'tree',
    ],
    fields: {
      common: ['type', 'name', 'position{x,y}', 'size{width,height}', 'rotation', 'opacity', 'isVisible', 'isLocked', 'cornerRadius', 'topLeftRadius/topRightRadius/bottomLeftRadius/bottomRightRadius', 'blendMode', 'fills', 'strokes', 'strokeWidth(别名 strokeWeight)', 'strokeAlign', 'imageUrl', 'imageScaleMode', 'effects', 'children'],
      layout: ['layoutMode', 'itemSpacing', 'padding*', 'primaryAxisAlignItems', 'counterAxisAlignItems', 'layoutSizingHorizontal', 'layoutSizingVertical', 'layoutPositioning', 'flexWrap', 'primaryAxisSizingMode', 'counterAxisSizingMode', 'clipsContent', 'flexGrow'],
      text: ['content', 'fontSize', 'fontWeight', 'fontName{family,style}', 'lineHeight', 'letterSpacing', 'textAlignHorizontal', 'textAlignVertical', 'textAutoResize'],
      paint: {
        note: '颜色同时接受 hex / rgb() / rgba() / {r,g,b,a} 四种形态（客户端渲染引擎产出的是最后一种）。',
        solid: 'fills: [{ type: "SOLID", color, opacity? }]',
        gradientFill: 'fills: [{ type: "GRADIENT_LINEAR"|"GRADIENT_RADIAL", gradientStops: [{position, color}], gradientHandlePositions: [{x,y},{x,y}] }]（handles 为 0–1 归一坐标，相对形状包围盒；radial 可用 transform: [[rx/r,0,0],[0,ry/r,0]] 表达椭圆）',
        gradientStroke: 'strokes: [{ type: "GRADIENT_LINEAR", gradientStops, gradientHandlePositions }] → Penpot 的 strokeColorGradient（边框渐变的正确做法）',
        image: 'imageUrl（远程，自动走 uploadMediaUrl）或 fills[].imageData（base64）',
      },
      perSideStrokes: {
        note: '单边描边（strokeTopWeight/BottomWeight/LeftWeight/RightWeight）**可以正常用** —— Penpot 插件 API 没有 per-side，但本插件用「叠加矢量路径」模拟（见 lib/host/border-sides.ts）：',
        how: '每条边画成一条 Path 的描边（同色同宽的多条边合并为一条多子路径 Path，只占一个图层），命名为 Border Top / Border Bottom+Left 等；颜色、宽度、虚线、渐变都与普通描边一致，落地后仍可在 Penpot 里改。',
        notes: [
          '四边权重相等时走原生整圈描边（少 4 个节点，圆角也更准）',
          '重渲染是幂等的：叠加层 id 记在源节点的 pluginData 上，先删旧再建新，不会越叠越多',
          '单边 + 圆角：CSS 在左右边框为 0 时圆角会坍缩，下边框本来就是直的 —— 当前实现与之一致，无差异',
          '已知代价：相邻两条边**颜色/宽度不同**时，角上是一个 w×w 的小方块（后画者覆盖），而 CSS 是对角切分。同色或单边时无差异。这是「用描边而不是填充梯形」的刻意取舍（保留 Strokes 面板可编辑性）',
        ],
      },
      icons: {
        note: '图标有两条写法，都支持：',
        asSvgElement: '{ type: "svg", svgContent, size }',
        asFrameWithSvg: '{ type: "frame", svgContent, size, padding* } —— 即 HTML 里 <i data-icon> 渲染后的形态，SVG 会落在扣掉 padding 的内容区',
        behavior: '单色且可安全转换的 SVG 会被导成**一条可编辑矢量路径**（Path），因此能正常 resize / 改色；多色或含 transform/image/text/渐变定义的 SVG 回退为 createShapeFromSvg（保色优先）',
      },
      svg: ['svgContent'],
      documentLevel: ['_unresolvedClasses（客户端渲染阶段未解析的 Tailwind class，会被回传并在报告中列出）'],
    },
    report: {
      note: 'dsl/render 返回的 report 用于判断“到底落地了多少”。',
      fields: ['ok', 'host', 'rootCount', 'rootIds', 'rootNodeIds', 'created[]', 'perElement[]', 'skipped[]', 'unresolvedClasses[]'],
      why: 'skipped 非空即表示设计与 DSL 不完全一致；unresolvedClasses 非空即表示样式已经在 Tailwind 解析阶段丢了。两者都必须看。',
    },
    nullVsBest: {
      note: '宿主不支持的属性不会让渲染失败，而是出现在 report.skipped 里。请务必检查返回值。',
      knownDegradations: [
        'conic / diamond 渐变 → Penpot 只有 linear / radial，会降级为第一个色标的纯色并在 skipped 里说明',
        'IMAGE 填充需要 imageData（Penpot 需先 uploadMedia*）；节点级 imageUrl 已会自动走 uploadMediaUrl',
        'instance / boolean_operation / polygon / star 尚未接线',
        'textSegments（局部文本样式）尚未接线',
      ],
    },
    example,
  }
}
