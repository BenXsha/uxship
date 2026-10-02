import { HandlerFunction, HandlerContext } from './index'
import { DSLExporter } from './dsl-exporter'
import { DSLRenderer } from './dsl-renderer'
import { DSLDocument } from './dsl-types'
import { focusNodes, getViewportSnapshot, settleViewport } from './canvasHandlers'

export const handleExportSelection: HandlerFunction = (params: any, context: HandlerContext) => {
  try {
    const dsl = DSLExporter.exportSelection()
    return dsl
  } catch (error) {
    console.error('[DSLHandler] exportSelection failed:', error)
    throw new Error(`导出选中节点失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const handleExportNode: HandlerFunction = (params: any, context: HandlerContext) => {
  const { nodeId } = params
  if (!nodeId || typeof nodeId !== 'string') {
    console.error('[DSLHandler] Invalid nodeId parameter:', nodeId)
    throw new Error('nodeId 参数必须是字符串')
  }

  try {
    const dsl = DSLExporter.exportNode(nodeId)
    return dsl
  } catch (error) {
    console.error('[DSLHandler] exportNode failed for node:', nodeId, 'Error:', error)
    throw new Error(`导出节点失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const handleRenderDSL: HandlerFunction = async (params: any, context: HandlerContext) => {
  const { dsl, focus, select, focusNodeId, zoom } = params
  if (!dsl || typeof dsl !== 'object') {
    console.error('[DSLHandler] Invalid DSL parameter:', dsl)
    throw new Error('dsl 参数必须是对象')
  }

  // 客户端渲染阶段会带上未能解析的 Tailwind class（样式会被丢弃）——回传给调用方与用户
  const unresolvedClasses: string[] = Array.isArray(params?.dsl?._unresolvedClasses)
    ? params.dsl._unresolvedClasses.filter((c: any) => typeof c === 'string')
    : []

  try {
    const rootNodeIds = await DSLRenderer.renderDSL(dsl as DSLDocument)

    // 属性级降级（实例子节点覆写未生效 / 换组件告警与失败）：取走后随响应回报，不只打 console
    const renderIssues = DSLRenderer.takeRenderIssues()

    // 渲染完成后自动聚焦到刚创建的根节点（focus: false 可关闭，select: false 可只聚焦不选中）
    let focusedNodeIds: string[] = []
    let viewport: ReturnType<typeof getViewportSnapshot> | undefined
    if (focus !== false) {
      const targets = focusNodeId
        ? [mg.getNodeById(focusNodeId)].filter(Boolean)
        : rootNodeIds.map((id) => mg.getNodeById(id)).filter(Boolean)
      const focused = focusNodes(targets as any[], { select: select !== false, zoom })
      focusedNodeIds = focused.map((node: any) => node.id)
      if (focused.length > 0) {
        await settleViewport()
        viewport = getViewportSnapshot()
      }
    }

    if (unresolvedClasses.length > 0) {
      const sample = unresolvedClasses.slice(0, 3).join('、')
      mg.notify(
        `⚠️ ${unresolvedClasses.length} 个 Tailwind class 未生效（样式丢失）：${sample}${unresolvedClasses.length > 3 ? ' 等' : ''}`,
        { type: 'warning' },
      )
    }

    if (renderIssues.length > 0) {
      const sample = renderIssues.slice(0, 3).join('；')
      mg.notify(
        `⚠️ ${renderIssues.length} 项覆写/换组件未生效：${sample}${renderIssues.length > 3 ? ' 等' : ''}`,
        { type: 'warning' },
      )
    }

    return {
      success: true,
      message: 'DSL渲染成功',
      rootNodeIds,
      focusedNodeIds,
      ...(unresolvedClasses.length > 0 ? { unresolvedClasses } : {}),
      ...(renderIssues.length > 0 ? { renderIssues } : {}),
      ...(viewport ? { viewport } : {}),
    }
  } catch (error) {
    console.error('[DSLHandler] DSL rendering failed:', error)
    throw new Error(`DSL渲染失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}
