/**
 * 团队组件库本地索引缓存与检索
 *
 * 团队库索引（库 / 组件 ukey / 样式 ukey）来自插件端 `teamLibrary/list`，
 * 这里负责：
 * 1. 落盘缓存到 `.uxship/team-library.json`（可用 UXSHIP_TEAM_LIBRARY_CACHE 覆盖路径）
 * 2. 过期判断与按需刷新（ensureIndex）
 * 3. 组件模糊检索、样式分组检索、名称 → ukey 解析
 *
 * 缓存的意义：避免每次检索都往返插件（getTeamLibraryAsync 可能较慢），
 * 同时让 AI 能在一次调用里拿到精简的库清单。
 */

import { promises as fs } from 'fs'
import path from 'path'
import type { JSONRPCRequest, JSONRPCResponse } from '../types/index.js'

// ─── 类型 ────────────────────────────────────────────

export interface TeamLibraryComponent {
  name: string
  ukey: string
  type: 'COMPONENT' | 'COMPONENT_SET'
  description?: string
  width?: number
  height?: number
  componentSetUkey?: string
  cover?: string
}

export interface TeamLibraryStyle {
  name: string
  ukey: string
  type?: string
  description?: string
}

export interface TeamLibraryEntry {
  id: string
  name: string
  components: TeamLibraryComponent[]
  styles: Record<string, TeamLibraryStyle[]>
}

export interface TeamLibraryCacheFile {
  version: 1
  fetchedAt: string
  path?: string
  libraries: TeamLibraryEntry[]
}

/** 与插件端 STYLE_GROUPS 保持一致 */
export const STYLE_GROUPS = [
  'paints', 'effects', 'texts', 'grids',
  'strokeWidths', 'cornerRadiuses', 'paddings', 'spacings',
] as const

export type StyleGroup = typeof STYLE_GROUPS[number]

const GROUP_STYLE_TYPE: Record<string, string> = {
  paints: 'PAINT',
  effects: 'EFFECT',
  texts: 'TEXT',
  grids: 'GRID',
  strokeWidths: 'STROKE_WIDTH',
  cornerRadiuses: 'CORNER_RADIUS',
  paddings: 'PADDING',
  spacings: 'SPACING',
}

/** 默认缓存有效期：6 小时 */
export const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000

export type ForwardRequest = (req: JSONRPCRequest) => Promise<JSONRPCResponse>

// ─── 插件响应解析 ─────────────────────────────────────

/**
 * 统一解包插件响应，兼容三种形态：
 * - result 为裸数组 / 裸对象（当前插件端 dispatcher 行为）
 * - result.content[0].text 为 JSON 字符串（MCP 风格包装）
 * - 顶层 error
 */
export function extractResultPayload<T = any>(response: JSONRPCResponse): T | undefined {
  const anyRes = response as any
  if (!anyRes) return undefined
  if (anyRes.error) return undefined

  const result = anyRes.result
  if (result === undefined || result === null) return undefined

  if (Array.isArray(result)) return result as unknown as T

  if (typeof result === 'object') {
    const content = (result as Record<string, unknown>).content
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0] as Record<string, unknown>
      const text = typeof first?.text === 'string' ? first.text : undefined
      if (text) {
        try {
          return JSON.parse(text) as T
        } catch {
          return undefined
        }
      }
    }
    return result as unknown as T
  }

  return result as unknown as T
}

export function responseErrorMessage(response: JSONRPCResponse): string | undefined {
  return (response as any)?.error?.message
}

// ─── 缓存路径与读写 ───────────────────────────────────

export function getCachePath(): string {
  const override = process.env.UXSHIP_TEAM_LIBRARY_CACHE
  if (override && override.trim()) return path.resolve(override.trim())
  return path.join(process.cwd(), '.uxship', 'team-library.json')
}

export async function readCache(cachePath = getCachePath()): Promise<TeamLibraryCacheFile | null> {
  try {
    const raw = await fs.readFile(cachePath, 'utf-8')
    const parsed = JSON.parse(raw) as TeamLibraryCacheFile
    if (!parsed || !Array.isArray(parsed.libraries)) return null
    return parsed
  } catch {
    return null
  }
}

export interface WriteCacheResult {
  ok: boolean
  path: string
  error?: string
}

/** 写入缓存（best-effort：失败不影响调用方继续使用内存数据） */
export async function writeCache(
  libraries: TeamLibraryEntry[],
  opts: { fetchedAt?: string; cachePath?: string } = {},
): Promise<WriteCacheResult> {
  const cachePath = opts.cachePath || getCachePath()
  const payload: TeamLibraryCacheFile = {
    version: 1,
    fetchedAt: opts.fetchedAt || new Date().toISOString(),
    libraries,
  }
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true })
    await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf-8')
    return { ok: true, path: cachePath }
  } catch (err: any) {
    return { ok: false, path: cachePath, error: err?.message || String(err) }
  }
}

export function cacheAgeMs(cache: TeamLibraryCacheFile): number {
  const at = Date.parse(cache.fetchedAt || '')
  if (!Number.isFinite(at)) return Number.POSITIVE_INFINITY
  return Date.now() - at
}

export function isStale(cache: TeamLibraryCacheFile, maxAgeMs = DEFAULT_MAX_AGE_MS): boolean {
  return cacheAgeMs(cache) > maxAgeMs
}

// ─── 归一化 ───────────────────────────────────────────

function normalizeComponent(raw: any): TeamLibraryComponent | null {
  if (!raw) return null
  const ukey = raw.ukey || raw.key || ''
  if (!ukey) return null
  return {
    name: String(raw.name || ''),
    ukey: String(ukey),
    type: raw.type === 'COMPONENT_SET' ? 'COMPONENT_SET' : 'COMPONENT',
    ...(raw.description ? { description: String(raw.description) } : {}),
    ...(typeof raw.width === 'number' ? { width: raw.width } : {}),
    ...(typeof raw.height === 'number' ? { height: raw.height } : {}),
    ...(raw.componentSetUkey ? { componentSetUkey: String(raw.componentSetUkey) } : {}),
    ...(typeof raw.cover === 'string' && raw.cover ? { cover: raw.cover } : {}),
  }
}

function normalizeStyles(rawStyle: any): Record<string, TeamLibraryStyle[]> {
  const out: Record<string, TeamLibraryStyle[]> = {}
  for (const group of STYLE_GROUPS) {
    const list = rawStyle?.[group]
    if (!Array.isArray(list)) {
      out[group] = []
      continue
    }
    out[group] = list
      .map((s: any): TeamLibraryStyle | null => {
        const ukey = s?.ukey || s?.key || ''
        if (!ukey) return null
        return {
          name: String(s.name || ''),
          ukey: String(ukey),
          ...(s.type ? { type: String(s.type) } : { type: GROUP_STYLE_TYPE[group] }),
          ...(s.description ? { description: String(s.description) } : {}),
        }
      })
      .filter((s: TeamLibraryStyle | null): s is TeamLibraryStyle => !!s)
  }
  return out
}

function normalizeLibrary(raw: any): TeamLibraryEntry {
  const rawComponents = raw?.componentList || raw?.components || []
  return {
    id: String(raw?.id || ''),
    name: String(raw?.name || ''),
    components: (Array.isArray(rawComponents) ? rawComponents : [])
      .map(normalizeComponent)
      .filter((c: TeamLibraryComponent | null): c is TeamLibraryComponent => !!c),
    styles: normalizeStyles(raw?.style || raw?.styles),
  }
}

// ─── 从插件拉取索引 ───────────────────────────────────

export class TeamLibraryUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TeamLibraryUnavailableError'
  }
}

/**
 * 请求插件端 `teamLibrary/list` 并归一化
 */
export async function fetchLibraryIndex(
  forwardRequest: ForwardRequest,
  opts: { includeCover?: boolean } = {},
): Promise<TeamLibraryEntry[]> {
  const req: JSONRPCRequest = {
    jsonrpc: '2.0',
    id: `teamlib_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    method: 'teamLibrary/list',
    params: {
      includeComponents: true,
      includeStyles: true,
      includeCover: opts.includeCover === true,
      force: true,
    },
  }

  const res = await forwardRequest(req)

  const errMsg = responseErrorMessage(res)
  if (errMsg) {
    throw new TeamLibraryUnavailableError(
      `团队组件库不可用：${errMsg.replace(/[.。]\s*$/, '')}。请确认 MasterGo 插件已连接、且团队库 API 可用。`,
    )
  }

  const payload: any = extractResultPayload(res)
  if (!payload) {
    throw new TeamLibraryUnavailableError('团队组件库返回空数据：请在 MasterGo 中启用/关联团队库后重试。')
  }

  const rawLibraries: any[] = Array.isArray(payload) ? payload : (payload.libraries || [])
  return rawLibraries.map(normalizeLibrary)
}

// ─── 索引保障（缓存优先） ─────────────────────────────

export interface IndexResult {
  libraries: TeamLibraryEntry[]
  source: 'cache' | 'plugin' | 'stale-cache'
  cachePath: string
  fetchedAt: string
  ageMs: number | null
  stale: boolean
  cacheError?: string
}

export interface EnsureIndexOptions {
  /** 强制跳过缓存，直接问插件 */
  force?: boolean
  /** 缓存有效期（毫秒），默认 6h */
  maxAgeMs?: number
  /** 插件不可用时是否退回过期缓存（默认 true） */
  allowStale?: boolean
  includeCover?: boolean
  cachePath?: string
}

/**
 * 确保拿到团队库索引：缓存新鲜则用缓存，否则向插件拉取并回写缓存。
 */
export async function ensureIndex(
  forwardRequest: ForwardRequest,
  opts: EnsureIndexOptions = {},
): Promise<IndexResult> {
  const cachePath = opts.cachePath || getCachePath()
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const cached = await readCache(cachePath)

  if (!opts.force && cached && !isStale(cached, maxAgeMs)) {
    return {
      libraries: cached.libraries,
      source: 'cache',
      cachePath,
      fetchedAt: cached.fetchedAt,
      ageMs: cacheAgeMs(cached),
      stale: false,
    }
  }

  try {
    const libraries = await fetchLibraryIndex(forwardRequest, { includeCover: opts.includeCover })
    const fetchedAt = new Date().toISOString()
    const written = await writeCache(libraries, { fetchedAt, cachePath })
    return {
      libraries,
      source: 'plugin',
      cachePath,
      fetchedAt,
      ageMs: 0,
      stale: false,
      ...(written.ok ? {} : { cacheError: `缓存写入失败：${written.error}` }),
    }
  } catch (err: any) {
    if (cached && opts.allowStale !== false) {
      return {
        libraries: cached.libraries,
        source: 'stale-cache',
        cachePath,
        fetchedAt: cached.fetchedAt,
        ageMs: cacheAgeMs(cached),
        stale: true,
        cacheError: err?.message || String(err),
      }
    }
    throw err
  }
}

// ─── 检索 ─────────────────────────────────────────────

/** 归一化名称：小写、去掉 DS_ 前缀、非字母数字/中文折叠为 - */
export function normName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/^ds-/, '')
}

export interface ComponentHit {
  library: string
  libraryId: string
  name: string
  ukey: string
  type: 'COMPONENT' | 'COMPONENT_SET'
  description: string
  width?: number
  height?: number
  componentSetUkey?: string
  matchType: 'exact' | 'prefix' | 'fuzzy' | 'description'
  score: number
}

export interface ComponentSearchOptions {
  library?: string
  type?: 'COMPONENT' | 'COMPONENT_SET'
  limit?: number
}

/**
 * 组件检索：精确 > 归一化精确 > 前缀 > 包含 > 描述
 */
export function searchComponents(
  libraries: TeamLibraryEntry[],
  query: string,
  opts: ComponentSearchOptions = {},
): ComponentHit[] {
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 20
  const rawQuery = String(query || '').trim()
  const q = normName(rawQuery)
  const wantedLib = opts.library ? normName(opts.library) : ''

  const hits: ComponentHit[] = []

  for (const lib of libraries) {
    if (wantedLib && normName(lib.name) !== wantedLib && normName(lib.id) !== wantedLib) continue
    for (const c of lib.components) {
      if (opts.type && c.type !== opts.type) continue

      if (!q) {
        hits.push({ ...toHit(lib, c), matchType: 'fuzzy', score: 1 })
        continue
      }

      const name = String(c.name || '')
      const nName = normName(name)
      const desc = `${c.description || ''}`
      const nDesc = normName(desc)

      let matchType: ComponentHit['matchType'] | null = null
      let score = 0

      if (name === rawQuery) {
        matchType = 'exact'
        score = 1000
      } else if (nName === q) {
        matchType = 'exact'
        score = 900
      } else if (nName.startsWith(q)) {
        matchType = 'prefix'
        score = 700 - nName.length
      } else if (nName.includes(q)) {
        matchType = 'fuzzy'
        score = 500 - nName.length
      } else if (q.includes(nName) && nName.length > 1) {
        // 查询词包含组件名（如 "primary button" 命中 "Button"）
        matchType = 'fuzzy'
        score = 400 - nName.length
      } else if (nDesc.includes(q) || (desc && desc.toLowerCase().includes(rawQuery.toLowerCase()))) {
        matchType = 'description'
        score = 300
      }

      if (!matchType) continue
      if (normName(lib.name).includes(q)) score += 20
      if (c.type === 'COMPONENT_SET') score += 5

      hits.push({ ...toHit(lib, c), matchType, score })
    }
  }

  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return hits.slice(0, limit)
}

function toHit(lib: TeamLibraryEntry, c: TeamLibraryComponent): Omit<ComponentHit, 'matchType' | 'score'> {
  return {
    library: lib.name,
    libraryId: lib.id,
    name: c.name,
    ukey: c.ukey,
    type: c.type,
    description: c.description || '',
    ...(c.width !== undefined ? { width: c.width } : {}),
    ...(c.height !== undefined ? { height: c.height } : {}),
    ...(c.componentSetUkey ? { componentSetUkey: c.componentSetUkey } : {}),
  }
}

export interface StyleHit {
  library: string
  libraryId: string
  group: string
  name: string
  ukey: string
  type: string
  description: string
}

export function searchStyles(
  libraries: TeamLibraryEntry[],
  opts: { library?: string; group?: string; query?: string; limit?: number } = {},
): StyleHit[] {
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 50
  const wantedLib = opts.library ? normName(opts.library) : ''
  const wantedGroup = opts.group ? String(opts.group) : ''
  const groups: string[] = wantedGroup ? [wantedGroup] : (STYLE_GROUPS as unknown as string[])
  const q = opts.query ? normName(opts.query) : ''

  const hits: StyleHit[] = []
  for (const lib of libraries) {
    if (wantedLib && normName(lib.name) !== wantedLib && normName(lib.id) !== wantedLib) continue
    for (const group of groups) {
      for (const s of lib.styles[group] || []) {
        if (q) {
          const nName = normName(s.name)
          const nDesc = normName(s.description || '')
          if (!nName.includes(q) && !nDesc.includes(q)) continue
        }
        hits.push({
          library: lib.name,
          libraryId: lib.id,
          group,
          name: s.name,
          ukey: s.ukey,
          type: s.type || GROUP_STYLE_TYPE[group] || '',
          description: s.description || '',
        })
        if (hits.length >= limit) return hits
      }
    }
  }
  return hits
}

/** 库统计摘要（token 友好） */
export function summarizeLibraries(libraries: TeamLibraryEntry[]): Array<{
  id: string
  name: string
  componentCount: number
  componentSetCount: number
  styleCount: number
  styleBreakdown: Record<string, number>
}> {
  return libraries.map((lib) => {
    const styleBreakdown: Record<string, number> = {}
    let styleCount = 0
    for (const group of STYLE_GROUPS) {
      const n = lib.styles[group]?.length || 0
      if (n > 0) styleBreakdown[group] = n
      styleCount += n
    }
    return {
      id: lib.id,
      name: lib.name,
      componentCount: lib.components.length,
      componentSetCount: lib.components.filter((c) => c.type === 'COMPONENT_SET').length,
      styleCount,
      styleBreakdown,
    }
  })
}
