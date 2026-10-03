/**
 * 团队库（teamLibrary/*）、批量导出（node/exportBatch）与两个「宿主真做不到」的方法
 *
 * 关于最后那两个（`node/swapComponent` / `page/delete`）的取舍：
 *   与其让它们落到 `Method not found`（-32601，调用方只知道"没有这个方法"），
 *   不如**如实接线**成 `{available:false, reason, hint}` ——
 *   调用方能读到「为什么不行」与「改用什么」，这比一个含糊的方法名错误有用得多。
 *   这与本项目「能力缺失返回 available:false」的既有口径一致（见 mg.variables 的处理）。
 */
import type { HandlerContext } from './index'
import type { HostNode } from '../host/types'

// ───────────────────────── 团队库 ─────────────────────────

/** `teamLibrary/list`：组件 + 样式一起给（MasterGo 侧对应 team_library_* 三件套的合集） */
export async function handleTeamLibraryList(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  // 先把可连接的团队库连上（Penpot: `library.connectLibrary`）。
  // 不连就只能读到本文件库 —— “AI 能读团队库、但必须人回 UI 手连一次”曾是 Demo 2 的真实阻塞点。
  const connection = context.host.connectTeamLibraries
    ? await context.host.connectTeamLibraries(typeof params.library === 'string' ? params.library : undefined)
    : undefined

  const [components, colors, texts] = await Promise.all([
    context.host.listComponents(),
    context.host.listColorStyles(),
    context.host.listTextStyles(),
  ])

  const libraries = [...new Map(
    [...components, ...colors, ...texts]
      .filter((item) => item.libraryId)
      .map((item) => [item.libraryId as string, {
        id: item.libraryId as string,
        // 库名未知时退回 id —— 空标签会让调用方无法辨认是哪个库
        name: (item as { libraryName?: string }).libraryName || (item.libraryId as string),
        isLocal: item.isLocal === true,
      }]),
  ).values()]

  // 只有本文件库时，把“为什么没有外部库”讲到可操作：能力缺失 / 可连但没连 / 真的没有
  let hint: string | undefined
  if (libraries.every((library) => library.isLocal)) {
    if (!connection) hint = '当前只有本文件库；团队库需先在 Penpot UI 里手动连接'
    else if (!connection.supported) hint = `当前只有本文件库；无法自动连库（${connection.reason ?? '宿主缺 connectLibrary'}），请在 Penpot UI 里手动连接`
    else if (connection.candidates?.length) hint = '当前只有本文件库；可连接的团队库见 teamLibraries.candidates（调用时传 library 即可自动连接）'
    else hint = '当前只有本文件库；没有可连接的团队库（availableLibraries 为空）'
  }

  return {
    available: true,
    model: 'penpot-libraries',
    libraries,
    counts: {
      components: components.length,
      colorStyles: colors.length,
      textStyles: texts.length,
      externalComponents: components.filter((c) => !c.isLocal).length,
    },
    components,
    colorStyles: colors,
    textStyles: texts,
    ...(connection ? { teamLibraries: connection } : {}),
    hint,
  }
}

const ZERO = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined)

/**
 * `teamLibrary/importComponent`：把团队库组件实例化到画布。
 *
 * 支持：`component`（+ 可选 `library`）按名字解析 / `componentId` 直取；
 * `x`/`y`/`parentId`/`name`/`width`/`height`；`variantProperties`（走 switchVariant）。
 * 明确不支持并如实报告：`ukey`（MasterGo 专有）、批量 `components[]` 自动排布、
 * `overrides`（按子节点名覆写子层属性，Penpot 侧需逐个取子节点，尚未接线）。
 */
export async function handleTeamComponentImport(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  if (typeof params.ukey === 'string' && params.ukey && !params.component && !params.componentId) {
    return {
      available: false,
      reason: 'ukey 是 MasterGo 团队库的标识，Penpot 侧没有对应概念（Penpot 用 library + component 名/组件 id）',
      hint: '改用 component(+library) 按名字解析，或先 component/search 拿到组件 id 后传 componentId',
    }
  }
  if (Array.isArray(params.components) && params.components.length) {
    return {
      available: false,
      reason: '批量导入 + 自动排布（components[] + layout/columns/gap）尚未接线',
      hint: '改成多次调用 team_component_import 逐个导入，或用 parentId 指到一个容器后自行排布',
    }
  }

  const parentId = typeof params.parentId === 'string' ? params.parentId : undefined
  const parent = parentId ? context.host.getNodeById(parentId) : null
  if (parentId && !parent) throw new Error(`父节点不存在: ${parentId}（Penpot 只能查当前页）`)

  const result = await context.host.instantiateComponent({
    componentId: typeof params.componentId === 'string' ? params.componentId : undefined,
    componentName: typeof params.component === 'string' ? params.component : undefined,
    libraryName: typeof params.library === 'string' ? params.library : undefined,
    parent,
    x: ZERO(params.x),
    y: ZERO(params.y),
    width: ZERO(params.width),
    height: ZERO(params.height),
    name: typeof params.name === 'string' ? params.name : undefined,
  })

  const notes: string[] = []
  const variantProperties = params.variantProperties as Record<string, string> | undefined
  if (variantProperties && typeof variantProperties === 'object') {
    const node = context.host.getNodeById(result.nodeId)
    if (node) {
      for (const [property, value] of Object.entries(variantProperties)) {
        const switched = await context.host.switchVariant(node, property, String(value))
        if (!switched.switched) notes.push(switched.note ?? `变体属性 ${property}=${value} 未生效`)
      }
    }
  }
  if (params.overrides && typeof params.overrides === 'object') {
    notes.push('overrides（按子节点名覆写）尚未接线；可导入后用 node_update 逐节点改')
  }
  if (params.type === 'COMPONENT_SET') {
    notes.push('Penpot 的组件集是 createVariantFromComponents 的产物；这里按普通组件实例化')
  }

  return {
    ok: true,
    ...result,
    ...(notes.length ? { notes } : {}),
  }
}

/**
 * `teamLibrary/importStyle`：把团队样式"导入"到当前文档。
 *
 * ⚠️ 模型差异：Penpot **不需要拷贝** —— 只要库已连接，`LibraryColor/LibraryTypography`
 * 就能直接 `asFill()/asStroke()/applyToText()`，改样式全稿联动。
 * 因此"导入"在 Penpot 语义下等于"确认可用（可选直接应用到节点）"，如实说明而不是假装拷贝了一份。
 */
export async function handleTeamStyleImport(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const ukey = typeof params.ukey === 'string' ? params.ukey : undefined
  const name = typeof params.name === 'string' ? params.name : typeof params.style === 'string' ? params.style : undefined
  const nodeId = typeof params.nodeId === 'string' ? params.nodeId : undefined
  const styleType = typeof params.styleType === 'string' ? params.styleType.toLowerCase() : ''

  if (ukey && !name) {
    return {
      available: false,
      reason: 'ukey 是 MasterGo 团队样式的标识，Penpot 侧没有对应概念',
      hint: '改用 name 按样式名解析（先用 team_library_list / style_listColors 查询可用样式）',
    }
  }
  if (!name) throw new Error('team_style_import 需要 name（样式名）')

  const requestedLibrary = typeof params.library === 'string' ? params.library : undefined
  const connector = context.host.connectTeamLibraries
  let autoConnected: string[] = []
  if (connector && requestedLibrary) {
    const info = await connector(requestedLibrary)
    autoConnected = info.newlyConnected.map((lib) => lib.name)
  }

  let [colors, texts] = await Promise.all([
    context.host.listColorStyles(),
    context.host.listTextStyles(),
  ])
  const findColor = () => colors.find((candidate) => candidate.name === name || candidate.path === name)
  const findText = () => texts.find((candidate) => candidate.name === name || candidate.path === name)
  let color = findColor()
  let text = findText()

  // 名字没命中、且没指定库 → 可能只是“库还没连”，把所有可连的库连上再查一次
  // （首次导入的常见情形；指定了库时上面已经连过）
  if (!color && !text && !requestedLibrary && connector) {
    const info = await connector()
    autoConnected = info.newlyConnected.map((lib) => lib.name)
    if (info.newlyConnected.length) {
      ;[colors, texts] = await Promise.all([context.host.listColorStyles(), context.host.listTextStyles()])
      color = findColor()
      text = findText()
    }
  }

  const style = color ?? text
  if (!style) {
    throw new Error(`样式未找到: ${name} —— 可先用 team_library_list 或 style_listColors 查询`)
  }

  const notes = [
    ...(autoConnected.length ? [`已自动连接团队库: ${autoConnected.join('、')}`] : []),
    'Penpot 不需要把团队库样式拷贝进本文件：库一旦连接即可直接使用（改样式全稿联动），' +
      '因此这里的"导入"= 确认可用',
  ]

  if (nodeId) {
    const node = context.host.getNodeById(nodeId)
    if (!node) throw new Error(`节点不存在: ${nodeId}（Penpot 只能查当前页）`)
    const effectiveType = styleType || (color ? 'fill' : 'text')
    if (effectiveType !== 'fill' && effectiveType !== 'stroke' && effectiveType !== 'text') {
      throw new Error(`team_style_import 的 styleType 只能是 fill / stroke / text（收到 ${styleType}）`)
    }
    const applied = await context.host.applyStyle(node, style.id, effectiveType)
    return {
      ok: applied.applied,
      styleId: style.id,
      styleName: style.name,
      isLocal: style.isLocal,
      appliedTo: nodeId,
      styleType: effectiveType,
      notes: [...notes, ...(applied.note ? [applied.note] : [])],
    }
  }

  return { ok: true, styleId: style.id, styleName: style.name, isLocal: style.isLocal, notes }
}

// ───────────────────────── 批量导出 ─────────────────────────

/**
 * `node/exportBatch`：导出图层。
 *
 * 单层：返回服务端 `ExportBatchResult` 约定的 `{format, data}`；
 * 多层：Penpot 的 `shape.export()` 是**逐形状**的，没有"多图层合并成一张图"的能力 ——
 * 与其悄悄只导第一层，不如如实拒绝并给出可执行的做法（先打组再导出）。
 */
export async function handleNodeExportBatch(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const format = String(params.format ?? 'png').toLowerCase()
  if (format !== 'png' && format !== 'svg') {
    throw new Error(`node_export_batch 只支持 png / svg（收到 ${params.format}）`)
  }

  const layerIds = Array.isArray(params.layerIds) ? (params.layerIds as string[]) : []
  const useSelection = params.useSelection !== false

  let targets: HostNode[] = []
  if (layerIds.length) {
    targets = layerIds.map((id) => {
      const node = context.host.getNodeById(String(id))
      if (!node) throw new Error(`节点不存在: ${id}（Penpot 只能查当前页）`)
      return node
    })
  } else if (useSelection) {
    targets = [...context.host.getSelection()]
  }

  if (!targets.length) {
    throw new Error('node_export_batch 没有可导出的图层（传 layerIds 或先选中节点）')
  }
  if (targets.length > 1) {
    return {
      available: false,
      reason: `Penpot 的导出是逐形状的，没有「${targets.length} 个图层合并成一张图」的能力`,
      hint: '先用 node_group 把要合并的图层打成组，再导出该组（layerIds 只传组的 id）',
      requested: targets.length,
    }
  }

  const scale = typeof params.scale === 'number' ? params.scale : 1
  const exported = await context.host.exportNode(targets[0], {
    format: format === 'svg' ? 'SVG' : 'PNG',
    scale,
  })

  return {
    ok: true,
    nodeId: targets[0].id,
    format: exported.format,
    mimeType: exported.mimeType,
    data: exported.data,
    scale: exported.scale,
    ...(exported.notes.length ? { notes: exported.notes } : {}),
  }
}

// ───────────────────────── 宿主真做不到的两个 ─────────────────────────

/** `page/delete` 的回执（宿主无删页能力，`available` 恒为 false） */
interface PageDeleteResult {
  available: false
  pageId?: string
  pageName?: string
  reason: string
  hint: string
  pages: readonly unknown[]
}

/**
 * `page/delete`：删页。
 *
 * Penpot 的 `Page` 接口只暴露 `id/name/root/getShapeById/createFlow` —— **没有 remove**，
 * 也没有 `penpot.deletePage`。因此如实返回 available:false。
 */
export function handlePageDelete(
  params: Record<string, unknown>,
  context: HandlerContext,
): PageDeleteResult {
  const pageId = typeof params.pageId === 'string' ? params.pageId : ''
  const pages = context.host.listPages()
  const known = pageId ? pages.find((page) => page.id === pageId) : undefined

  return {
    available: false,
    ...(pageId ? { pageId, pageName: known?.name } : {}),
    reason: 'Penpot 插件 API 没有删页能力（Page 只暴露 id/name/root/getShapeById/createFlow，也没有 penpot.deletePage）',
    hint: '页面的增删请在 Penpot UI 里操作（页面列表右键删除）；插件侧可用的只有 page_create / page_switch / page_rename',
    pages,
  }
}
