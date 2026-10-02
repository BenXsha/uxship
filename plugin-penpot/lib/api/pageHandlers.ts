/**
 * 页面 handler
 *
 * ⚠️ Penpot 的已知约束（分析报告 §8 / §11.4）：
 *   - MCP/插件只作用于**当前聚焦页**；`getNodeById` 只能查当前页
 *   - 切换页是异步的（`penpot.openPage` 返回 Promise），且创建页不一定会切过去
 * 因此这里与 MasterGo 侧 `page_switch` 同一口径：**必须回读校验**，返回 `applied` 布尔值，
 * 而不是假设切换成功（假成功是最难排的一类问题）。
 */
import type { HandlerContext } from './index'

export function handlePageList(_params: Record<string, unknown>, context: HandlerContext): unknown {
  const pages = context.host.listPages()
  const current = context.host.getCurrentPage()
  return {
    pages,
    count: pages.length,
    currentPageId: current?.id ?? null,
    currentPageName: current?.name ?? null,
    // 老版本 Penpot 没有页面清单 API，只能报当前页
    complete: pages.length > 1,
  }
}

export async function handlePageCreate(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const name = typeof params.name === 'string' && params.name ? params.name : 'New Page'
  const page = await context.host.createPage(name)

  const shouldSwitch = params.switchTo !== false
  let applied = false
  let reason: string | undefined

  if (shouldSwitch) {
    try {
      await context.host.switchPage(page.id)
      // 回读校验：宿主可能异步排队，赋值后不立即生效
      applied = context.host.getCurrentPage()?.id === page.id
      if (!applied) reason = 'createPage 后切换未生效（Penpot 可能异步排队）'
    } catch (error) {
      reason = (error as Error).message
    }
  }

  return { ok: true, page, switched: applied, reason }
}

export async function handlePageSwitch(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const pageId = String(params.pageId ?? '')
  if (!pageId) return { ok: false, reason: 'page/switch 需要 pageId' }

  const known = context.host.listPages().some((page) => page.id === pageId)
  if (!known) return { ok: false, reason: `页面不存在: ${pageId}` }

  await context.host.switchPage(pageId)
  const current = context.host.getCurrentPage()
  const applied = current?.id === pageId

  return {
    ok: applied,
    applied,
    currentPageId: current?.id ?? null,
    currentPageName: current?.name ?? null,
    reason: applied ? undefined : '切换未生效（Penpot 可能异步排队），请重试或检查页面是否可见',
  }
}

/** `page/rename`：走 HostAdapter（宿主细节不外泄），回读校验 */
export async function handlePageRename(
  params: Record<string, unknown>,
  context: HandlerContext,
): Promise<unknown> {
  const pageId = String(params.pageId ?? '')
  const name = typeof params.name === 'string' ? params.name : ''
  if (!pageId) throw new Error('page/rename 需要 pageId')
  if (!name) throw new Error('page/rename 需要 name')

  const result = await context.host.renamePage(pageId, name)
  return { ok: result.applied, applied: result.applied, pageId, name: result.name, reason: result.reason }
}
