import { serializeNodes } from './serializer'

/** 获取当前文档信息 */
export function handleGetDocumentInfo(_params: any): any {
  try {
    const doc = mg.document
    const currentPage = doc.currentPage

    const result = {
      id: doc.id,
      name: doc.name,
      currentPage: {
        id: currentPage.id,
        name: currentPage.name,
      },
      pageCount: doc.children.length,
      nodeCount: doc.findAll().length,
    }

    return result
  } catch (error) {
    console.error('[DocumentHandler] Failed to get document info:', error)
    throw new Error(`获取文档信息失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 获取当前选中的节点 */
export function handleGetSelection(_params: any): any {
  try {
    const currentPage = mg.document.currentPage
    const selection = currentPage.selection
    const serializedNodes = serializeNodes([...selection])

    return {
      count: selection.length,
      nodes: serializedNodes,
    }
  } catch (error) {
    console.error('[DocumentHandler] 获取选中节点失败:', error)
    throw new Error(`获取选中节点失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
