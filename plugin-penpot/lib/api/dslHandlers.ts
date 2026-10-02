/**
 * 设计管线 handler：dsl/render
 */
import type { HandlerContext } from './index'
import type { DSLElement } from '../dsl/types'
import { renderDsl } from '../dsl/renderer'

/**
 * `dsl/render` —— 把一棵 DSL 树渲染到当前页（或指定父节点下）。
 *
 * 对应 MasterGo 侧的 `dsl/render` 插件方法，是「HTML → DSL → 画布」这条主链路的最后一跳。
 * Penpot 侧目前投入使用的入口（UI 自测按钮）走的就是本方法。
 */
export async function handleRenderDsl(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const dsl = params.dsl ?? params.document
  if (!dsl || typeof dsl !== 'object') {
    return { ok: false, reason: 'dsl/render 需要 dsl（{elements:[...]} 或元素数组）' }
  }

  const parentId = typeof params.parentId === 'string' ? params.parentId : undefined
  const parent = parentId ? context.host.getNodeById(parentId) : null
  if (parentId && !parent) {
    return { ok: false, reason: `父节点不存在: ${parentId}（Penpot 只能查当前页）` }
  }

  const report = await renderDsl(
    context.host,
    dsl as { elements?: DSLElement[] },
    {
      parent,
      strict: params.strict === true,
      zoom: params.focus !== false && params.zoom !== false,
      select: params.select !== false,
      loadFonts: params.loadFonts !== false,
    },
  )

  // ok 的口径：至少创建出东西，且没有「结构级」降级（属性级降级不影响 ok）
  const structuralSkips = report.skipped.filter((s) => s.target !== 'fills' && s.target !== 'strokes' && s.target !== 'effects')

  return {
    ok: report.rootCount > 0,
    ...report,
    hasDegradation: report.skipped.length > 0,
    hasStructuralSkips: structuralSkips.length > 0,
  }
}
