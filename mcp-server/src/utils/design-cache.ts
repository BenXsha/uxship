import { createHash } from 'crypto'
import type { DSLElement } from '../dsl-types.js'

interface CacheEntry {
  dslHash: string
  dslHashNoPos: string
  propsSignature: string
  generatedCode: string
  lastExported: number
}

interface DependencyGraph {
  [componentName: string]: {
    children: Set<string>
    parents: Set<string>
    propsSignature: string
  }
}

interface SessionEntry {
  sessionId: string
  createdAt: number
  lastAccess: number
  rootNodeId: string
  rootNodeIds?: string[]
  elements: Map<string, CacheEntry>
  dependencyGraph: DependencyGraph
  framework: string
}

interface CacheConfig {
  maxSessions: number
  sessionTTL: number
}

const DEFAULT_CONFIG: CacheConfig = {
  maxSessions: 20,
  sessionTTL: 30 * 60 * 1000,
}

const CODE_RELEVANT_FIELDS = new Set([
  'type', 'name', 'x', 'y', 'width', 'height', 'rotation',
  'fills', 'strokes', 'strokeWeight', 'strokeAlign', 'strokeCap', 'strokeJoin',
  'cornerRadius', 'topLeftRadius', 'topRightRadius',
  'bottomLeftRadius', 'bottomRightRadius',
  'effects', 'opacity', 'blendMode',
  'layoutMode', 'itemSpacing',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'primaryAxisAlignItems', 'counterAxisAlignItems', 'flexWrap',
  'primaryAxisSizingMode', 'counterAxisSizingMode',
  'clipsContent', 'flexGrow', 'layoutPositioning',
  'content', 'fontSize', 'fontName', 'fontWeight',
  'textAlignHorizontal', 'textAlignVertical', 'textAutoResize',
  'lineHeight', 'letterSpacing', 'paragraphSpacing',
  'textDecoration', 'textCase',
  'componentId', 'componentName', 'generatorType', 'config',
  'svgPathData', 'svgContent', 'chartOption',
])

const CODE_IRRELEVANT_FIELDS = new Set([
  'id', 'pluginData', 'constraints',
])

function simpleHash(input: string): string {
  return createHash('md5').update(input, 'utf-8').digest('hex').slice(0, 8)
}

type HashableElement = Record<string, unknown>

function normalizeForHash(el: DSLElement): HashableElement {
  const result: HashableElement = {}
  for (const key of Object.keys(el)) {
    if (CODE_IRRELEVANT_FIELDS.has(key as keyof DSLElement)) continue
    if (CODE_RELEVANT_FIELDS.has(key as keyof DSLElement)) {
      result[key] = (el as unknown as HashableElement)[key]
    }
  }
  return result
}

function stripPosition(el: HashableElement): HashableElement {
  const result: HashableElement = {}
  for (const key of Object.keys(el)) {
    if (key === 'x' || key === 'y') continue
    result[key] = el[key]
  }
  return result
}

export function computeDslHash(el: DSLElement): { full: string; noPosition: string } {
  const normalized = normalizeForHash(el)
  const childrenHash = (el.children || [])
    .map(c => computeDslHash(c).full)
    .join('|')

  const fullHash = simpleHash(JSON.stringify(normalized) + '|' + childrenHash)

  const noPos = stripPosition(normalized)
  const noPosChildrenHash = (el.children || [])
    .map(c => computeDslHash(c).noPosition)
    .join('|')
  const noPosHash = simpleHash(JSON.stringify(noPos) + '|' + noPosChildrenHash)

  return { full: fullHash, noPosition: noPosHash }
}

export function computePropsSignature(el: DSLElement): string {
  const parts: string[] = []
  if (el.content !== undefined) parts.push(`content:${el.content}`)
  if (el.fontSize !== undefined) parts.push(`fs:${el.fontSize}`)
  if (el.fontName !== undefined) parts.push(`fn:${JSON.stringify(el.fontName)}`)
  if (el.fills) {
    for (const f of el.fills) {
      if (f.type === 'SOLID' && f.color) {
        const c = f.color
        if (typeof c === 'object' && c !== null && 'r' in c) {
          const colorObj = c as { r: number; g: number; b: number }
          parts.push(`fill:${colorObj.r},${colorObj.g},${colorObj.b}`)
        } else {
          parts.push(`fill:${String(c)}`)
        }
      }
    }
  }
  if (el.config?.variant) parts.push(`variant:${el.config.variant}`)
  return simpleHash(parts.join('|'))
}

function buildDependencyGraph(elements: DSLElement[]): DependencyGraph {
  const graph: DependencyGraph = {}

  function walk(el: DSLElement) {
    const name = el.name || 'anonymous'
    if (!graph[name]) {
      graph[name] = { children: new Set(), parents: new Set(), propsSignature: '' }
    }
    if (el.children) {
      for (const child of el.children) {
        const childName = child.name || 'anonymous'
        graph[name].children.add(childName)
        if (!graph[childName]) {
          graph[childName] = { children: new Set(), parents: new Set(), propsSignature: '' }
        }
        graph[childName].parents.add(name)
        walk(child)
      }
    }
    graph[name].propsSignature = computePropsSignature(el)
  }

  for (const el of elements) {
    walk(el)
  }

  return graph
}

export function detectChangedComponents(
  oldGraph: DependencyGraph,
  newGraph: DependencyGraph
): Set<string> {
  const changed = new Set<string>()

  for (const name of Object.keys(newGraph)) {
    if (oldGraph[name]?.propsSignature !== newGraph[name]?.propsSignature) {
      changed.add(name)
    }
  }

  function propagateToParents(name: string) {
    const node = newGraph[name]
    if (!node) return
    for (const parent of node.parents) {
      if (!changed.has(parent)) {
        changed.add(parent)
        propagateToParents(parent)
      }
    }
  }

  for (const name of changed) {
    propagateToParents(name)
  }

  return changed
}

export function createSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

export class DesignCache {
  private sessions: Map<string, SessionEntry> = new Map()
  private accessOrder: string[] = []
  private config: CacheConfig

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  createSession(rootNodeId: string, framework: string = 'html'): SessionEntry {
    this.evictStale()

    const sessionId = createSessionId()
    const entry: SessionEntry = {
      sessionId,
      createdAt: Date.now(),
      lastAccess: Date.now(),
      rootNodeId,
      elements: new Map(),
      dependencyGraph: {},
      framework,
    }

    if (this.sessions.size >= this.config.maxSessions) {
      this.evictLRU()
    }

    this.sessions.set(sessionId, entry)
    this.touch(sessionId)
    return entry
  }

  getSession(sessionId: string): SessionEntry | null {
    const entry = this.sessions.get(sessionId)
    if (!entry) return null

    if (Date.now() - entry.lastAccess > this.config.sessionTTL) {
      this.sessions.delete(sessionId)
      this.removeFromOrder(sessionId)
      return null
    }

    this.touch(sessionId)
    return entry
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.removeFromOrder(sessionId)
  }

  getAllSessions(): Array<{ sessionId: string; rootNodeId: string; createdAt: number; framework: string }> {
    return Array.from(this.sessions.values()).map(s => ({
      sessionId: s.sessionId,
      rootNodeId: s.rootNodeId,
      createdAt: s.createdAt,
      framework: s.framework,
    }))
  }

  cacheElement(sessionId: string, nodeId: string, el: DSLElement, generatedCode: string): void {
    const session = this.getSession(sessionId)
    if (!session) return

    const hashes = computeDslHash(el)
    session.elements.set(nodeId, {
      dslHash: hashes.full,
      dslHashNoPos: hashes.noPosition,
      propsSignature: computePropsSignature(el),
      generatedCode,
      lastExported: Date.now(),
    })
  }

  getCachedElement(sessionId: string, nodeId: string): CacheEntry | undefined {
    const session = this.getSession(sessionId)
    return session?.elements.get(nodeId)
  }

  updateDependencyGraph(sessionId: string, elements: DSLElement[]): void {
    const session = this.getSession(sessionId)
    if (!session) return
    session.dependencyGraph = buildDependencyGraph(elements)
  }

  classifyChange(nodeId: string, sessionId: string, newEl: DSLElement): 'NONE' | 'POSITION_ONLY' | 'VISUAL' | 'STRUCTURAL' | 'PROPS_INTERFACE' {
    const cached = this.getCachedElement(sessionId, nodeId)
    if (!cached) return 'STRUCTURAL'

    const newHashes = computeDslHash(newEl)

    if (newHashes.full === cached.dslHash) return 'NONE'

    const oldProps = cached.propsSignature
    const newProps = computePropsSignature(newEl)
    if (oldProps !== newProps) return 'PROPS_INTERFACE'

    if (newHashes.noPosition === cached.dslHashNoPos) return 'POSITION_ONLY'

    const oldChildCount = 0
    const newChildCount = (newEl.children || []).length
    return 'STRUCTURAL'
  }

  private touch(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (entry) {
      entry.lastAccess = Date.now()
    }
    this.removeFromOrder(sessionId)
    this.accessOrder.unshift(sessionId)
  }

  private removeFromOrder(sessionId: string): void {
    const idx = this.accessOrder.indexOf(sessionId)
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1)
    }
  }

  private evictStale(): void {
    const now = Date.now()
    for (const [id, entry] of this.sessions) {
      if (now - entry.lastAccess > this.config.sessionTTL) {
        this.sessions.delete(id)
        this.removeFromOrder(id)
      }
    }
  }

  private evictLRU(): void {
    if (this.accessOrder.length > 0) {
      const oldest = this.accessOrder[this.accessOrder.length - 1]
      this.sessions.delete(oldest)
      this.removeFromOrder(oldest)
    }
  }
}

export const globalDesignCache = new DesignCache()
