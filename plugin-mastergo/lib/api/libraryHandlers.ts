import type { HandlerContext } from './index'

interface CreatedStyle {
  name: string
  type: string
  styleId: string
}

export function handleRegisterStyles(
  params: { parentId: string },
  context: HandlerContext
): { created: CreatedStyle[]; warnings: string[] } {
  const { parentId } = params
  const created: CreatedStyle[] = []
  const warnings: string[] = []

  const parent = mg.getNodeById(parentId)
  if (!parent) {
    throw new Error(`Node not found: ${parentId}`)
  }

  walkAndCreateStyles(parent, created, warnings)

  return { created, warnings }
}

function walkAndCreateStyles(
  node: any,
  created: CreatedStyle[],
  warnings: string[],
  parentName?: string
) {
  const name = node.name || ''

  if (!node.children || node.children.length === 0) {
    tryCreateStyle(node, name, created, warnings)
    return
  }

  for (const child of node.children) {
    walkAndCreateStyles(child, created, warnings, name)
  }
}

// ─── 匹配规则 ────────────────────────────────────────

const COLOR_TOKENS = new Set([
  'Brand Text', 'Brand Hover', 'Brand Bg',
  'Neutral Bg', 'Neutral Bg Hover', 'Neutral Bg Active',
  'Neutral Border', 'Neutral Border Hover',
  'Neutral Text Secondary', 'Neutral Text',
  'Success', 'Warning', 'Error', 'Info',
])

const TYPO_TOKENS = new Set([
  'H1', 'H2', 'H3', 'H4',
  'Label 16', 'Label 14', 'Label 14 Mono',
  'Label 13', 'Label 13 Mono', 'Label 12',
  'Copy 16', 'Copy 14', 'Copy 13', 'Copy 13 Mono',
  'Button 16', 'Button 14', 'Button 12',
])

function tokenCategory(name: string): 'color' | 'typography' | 'spacing' | 'shadow' | null {
  if (COLOR_TOKENS.has(name)) return 'color'
  if (TYPO_TOKENS.has(name)) return 'typography'
  if (name.startsWith('Space ')) return 'spacing'
  if (name.startsWith('Shadow ')) return 'shadow'
  return null
}

function styleName(name: string, cat: string): string {
  if (cat === 'spacing') return name.replace('Space ', 'Space/')
  if (cat === 'shadow') return name.replace('Shadow ', 'Shadow/')
  return name
}

// ─── 样式创建 ────────────────────────────────────────

function tryCreateStyle(
  node: any,
  nodeName: string,
  created: CreatedStyle[],
  warnings: string[]
) {
  const cat = tokenCategory(nodeName)
  if (!cat) return

  const sname = styleName(nodeName, cat)
  const id = node.id

  try {
    switch (cat) {
      case 'color':
        createFillStyle(id, sname, created)
        break
      case 'typography':
        createTextStyle(id, sname, created)
        break
      case 'spacing':
        createSpacingStyle(id, sname, created)
        break
      case 'shadow':
        createEffectStyle(id, sname, created)
        break
    }
  } catch (e: any) {
    warnings.push(`Failed to create style "${sname}": ${e.message}`)
  }
}

function createFillStyle(nodeId: string, name: string, created: CreatedStyle[]) {
  const style = mg.createFillStyle({ id: nodeId, name })
  created.push({ name, type: 'PAINT', styleId: style.id })
}

function createTextStyle(nodeId: string, name: string, created: CreatedStyle[]) {
  const style = mg.createTextStyle({ id: nodeId, name })
  created.push({ name, type: 'TEXT', styleId: style.id })
}

function createSpacingStyle(nodeId: string, name: string, created: CreatedStyle[]) {
  const style = mg.createSpacingStyle({ id: nodeId, name })
  created.push({ name, type: 'SPACING', styleId: style.id })
}

function createEffectStyle(nodeId: string, name: string, created: CreatedStyle[]) {
  const style = mg.createEffectStyle({ id: nodeId, name })
  created.push({ name, type: 'EFFECT', styleId: style.id })
}
