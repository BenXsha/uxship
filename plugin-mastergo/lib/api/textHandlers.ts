import { serializeNode } from './serializer'

/** 创建文本节点 */
export async function handleCreateText(params: {
  characters: string
  x?: number
  y?: number
  fontSize?: number
  fontName?: { family: string; style: string }
  fills?: any[]
  parentId?: string
}): Promise<any> {
  if (!params.characters && params.characters !== '') {
    throw new Error('Missing required parameter: characters')
  }

  const node = mg.createText()
  node.characters = params.characters

  if (params.x !== undefined) node.x = params.x
  if (params.y !== undefined) node.y = params.y

  if (params.parentId) {
    const parent = mg.getNodeById(params.parentId)
    if (parent && 'appendChild' in parent) {
      ;(parent as any).appendChild(node)
    }
  }

  const textLen = node.characters.length

  if (params.fontName && params.fontName.family) {
    await mg.loadFontAsync(params.fontName)
    if (textLen > 0 && typeof node.setRangeFontName === 'function') {
      node.setRangeFontName(0, textLen, params.fontName)
    }
  }

  if (params.fontSize) {
    if (textLen > 0 && typeof node.setRangeFontSize === 'function') {
      node.setRangeFontSize(0, textLen, params.fontSize)
    }
  }

  if (params.fills) {
    node.fills = params.fills as any
  }

  return serializeNode(node)
}
