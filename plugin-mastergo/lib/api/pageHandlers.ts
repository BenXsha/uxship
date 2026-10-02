export function handleGetPages(_params: any): any {
  const pages = mg.document.children
  return {
    count: pages.length,
    currentPageId: mg.document.currentPage.id,
    pages: pages.map((p: any) => ({
      id: p.id,
      name: p.name,
      type: p.type,
    })),
  }
}

/**
 * 赋值切换当前页，并**回读校验**。
 *
 * 为什么要回读：真实日志里 `page_switch` 返回 success 但实际没切过去（跨页批量任务因此落错页）。
 * 宿主切页可能是**异步 / 排队**的（实测连续切页会延迟生效），所以 `applied === false`
 * **不算错误**（响应 success 仍为 true），只如实告知 + 给复核建议。
 *
 * @returns 是否已确认当前页就是目标页
 */
function applyCurrentPage(page: any, warnings: string[]): boolean {
  mg.document.currentPage = page
  const current: any = mg.document.currentPage
  if (current?.id === page.id) return true
  warnings.push(
    `宿主未立即切到目标页（currentPage 仍是 ${current?.id}），跨页操作前请再 page_list 复核`,
  )
  return false
}

/**
 * `page/create`：新建页面。
 *
 * 关键点（真实踩坑）：新页**不会自动成为当前页**，旧版只返回 `{id, name}`，紧接着的
 * `node_create` 会建到**旧页**（用户只能删掉重建）。现在：
 * - 始终回传回读到的 `currentPageId` 与 `hint`，让 AI 自己能判断该不该先切页；
 * - 可选 `switchToNew: true`（默认 false，保持向后兼容）：建完真的切过去并回读校验。
 */
export function handleCreatePage(params: { name?: string; switchToNew?: boolean }): any {
  const page = mg.createPage()
  if (params.name) page.name = params.name
  // mg.createPage() 已经把页面挂到文档上；部分运行时版本仍暴露 appendPage，存在时兼容调用
  const doc = mg.document as any
  if (typeof doc.appendPage === 'function') doc.appendPage(page)

  const warnings: string[] = []
  const shouldSwitch = params.switchToNew === true
  const applied = shouldSwitch ? applyCurrentPage(page, warnings) : false

  mg.commitUndo()

  const current: any = mg.document.currentPage
  const result: any = {
    success: true,
    page: { id: page.id, name: page.name },
    // 回读到的当前页：未切换时就是旧页 —— AI 必须先看到它再决定建到哪
    currentPageId: current?.id ?? null,
    applied,
    hint: shouldSwitch
      ? applied
        ? `已切换到新页「${page.name}」，可直接建节点`
        : '已请求切换但宿主未立即生效，建节点前请再 page_switch 复核'
      : '新页不是当前页，建节点前请 page_switch 或传 switchToNew:true',
  }
  if (warnings.length > 0) result.warnings = warnings
  return result
}

function findPage(pageId: string): any {
  const page = mg.document.children.find((p: any) => p.id === pageId)
  if (!page) throw new Error(`Page not found: ${pageId}`)
  return page
}

export function handleDeletePage(params: { pageId: string }): any {
  if (!params.pageId) throw new Error('Missing required parameter: pageId')
  const page = findPage(params.pageId)
  if (mg.document.children.length <= 1) {
    throw new Error('Cannot delete the only page')
  }
  page.remove()
  mg.commitUndo()
  return { success: true, deletedId: params.pageId }
}

export function handleSwitchPage(params: { pageId: string }): any {
  if (!params.pageId) throw new Error('Missing required parameter: pageId')
  const page = findPage(params.pageId)
  if (mg.document.currentPage.id === page.id) {
    return { success: true, currentPage: { id: page.id, name: page.name }, applied: true, alreadyCurrent: true }
  }

  const warnings: string[] = []
  const applied = applyCurrentPage(page, warnings)
  // 回读后如实回报：applied=false 时 currentPage 仍是旧页（不谎报成目标页）
  const current: any = mg.document.currentPage ?? page

  const result: any = {
    // applied=false 不是错误：宿主切页可能异步/排队，success 仍为 true，只是如实告知
    success: true,
    currentPage: { id: current.id, name: current.name },
    applied,
  }
  if (!applied) result.warnings = warnings
  return result
}

export function handleRenamePage(params: { pageId: string; name: string }): any {
  if (!params.pageId) throw new Error('Missing required parameter: pageId')
  if (!params.name) throw new Error('Missing required parameter: name')
  const page = findPage(params.pageId)
  page.name = params.name
  mg.commitUndo()
  return { success: true, page: { id: page.id, name: page.name } }
}
