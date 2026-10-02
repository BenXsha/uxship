import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import type { JSONRPCRequest, JSONRPCResponse } from '../src/types/index.js'
import {
  DEFAULT_MAX_AGE_MS,
  ensureIndex,
  extractResultPayload,
  getCachePath,
  isStale,
  normName,
  readCache,
  searchComponents,
  searchStyles,
  summarizeLibraries,
  writeCache,
  type TeamLibraryEntry,
} from '../src/utils/team-library-cache.js'

// ─── 测试夹具 ─────────────────────────────────────────

const LIBRARIES: TeamLibraryEntry[] = [
  {
    id: 'lib-1',
    name: '基础组件库',
    components: [
      { name: 'DS_Button', ukey: 'ukey-button', type: 'COMPONENT_SET', description: '按钮组件集', componentSetUkey: '' },
      { name: 'Button', ukey: 'ukey-button-single', type: 'COMPONENT' },
      { name: 'DS_TextInput', ukey: 'ukey-input', type: 'COMPONENT' },
      { name: 'Pricing Card', ukey: 'ukey-pricing', type: 'COMPONENT', description: '定价卡片，含价格与 CTA' },
    ],
    styles: {
      paints: [{ name: 'Brand Primary', ukey: 'ukey-paint-brand', type: 'PAINT' }],
      texts: [{ name: 'Heading/H1', ukey: 'ukey-text-h1', type: 'TEXT' }],
      spacings: [],
      effects: [],
      grids: [],
      strokeWidths: [],
      cornerRadiuses: [],
      paddings: [],
    },
  },
  {
    id: 'lib-2',
    name: 'Marketing Kit',
    components: [{ name: 'Hero Banner', ukey: 'ukey-hero', type: 'COMPONENT' }],
    styles: {
      paints: [{ name: 'Brand Accent', ukey: 'ukey-paint-accent', type: 'PAINT' }],
      texts: [],
      spacings: [],
      effects: [],
      grids: [],
      strokeWidths: [],
      cornerRadiuses: [],
      paddings: [],
    },
  },
]

/** 模拟插件 teamLibrary/list 响应（裸对象形态） */
function pluginResponse(libraries: TeamLibraryEntry[]): JSONRPCResponse {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: {
      apiAvailable: true,
      total: libraries.length,
      libraries,
    },
  } as unknown as JSONRPCResponse
}

let tmpDir: string
let cachePath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mg-teamlib-'))
  cachePath = path.join(tmpDir, '.uxship', 'team-library.json')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ─── 响应解包 ─────────────────────────────────────────

describe('extractResultPayload', () => {
  it('unwraps a bare object result', () => {
    const payload: any = extractResultPayload(pluginResponse(LIBRARIES))
    expect(payload.libraries).toHaveLength(2)
  })

  it('unwraps a bare array result', () => {
    const res = { jsonrpc: '2.0', id: 1, result: [{ id: 'a' }] } as unknown as JSONRPCResponse
    expect(extractResultPayload(res)).toEqual([{ id: 'a' }])
  })

  it('unwraps MCP-style content[0].text JSON', () => {
    const res = {
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: JSON.stringify({ libraries: LIBRARIES }) }] },
    } as unknown as JSONRPCResponse
    const payload: any = extractResultPayload(res)
    expect(payload.libraries).toHaveLength(2)
  })

  it('returns undefined on error responses', () => {
    const res = { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'no plugin' } } as JSONRPCResponse
    expect(extractResultPayload(res)).toBeUndefined()
  })
})

// ─── 缓存读写 ─────────────────────────────────────────

describe('cache file', () => {
  it('writes and reads back a cache file', async () => {
    const written = await writeCache(LIBRARIES, { cachePath })
    expect(written.ok).toBe(true)

    const cache = await readCache(cachePath)
    expect(cache?.version).toBe(1)
    expect(cache?.libraries).toHaveLength(2)
    expect(cache?.libraries[0].components[0].ukey).toBe('ukey-button')
  })

  it('returns null for a missing cache file', async () => {
    expect(await readCache(path.join(tmpDir, 'nope.json'))).toBeNull()
  })

  it('detects stale caches', () => {
    const fresh = { version: 1 as const, fetchedAt: new Date().toISOString(), libraries: [] }
    expect(isStale(fresh, DEFAULT_MAX_AGE_MS)).toBe(false)

    const old = { version: 1 as const, fetchedAt: new Date(Date.now() - 8 * 3600_000).toISOString(), libraries: [] }
    expect(isStale(old, DEFAULT_MAX_AGE_MS)).toBe(true)
  })

  it('honours UXSHIP_TEAM_LIBRARY_CACHE env override', () => {
    const prev = process.env.UXSHIP_TEAM_LIBRARY_CACHE
    process.env.UXSHIP_TEAM_LIBRARY_CACHE = '/tmp/custom-team-library.json'
    try {
      expect(getCachePath()).toBe('/tmp/custom-team-library.json')
    } finally {
      if (prev === undefined) delete process.env.UXSHIP_TEAM_LIBRARY_CACHE
      else process.env.UXSHIP_TEAM_LIBRARY_CACHE = prev
    }
  })
})

// ─── ensureIndex ──────────────────────────────────────

describe('ensureIndex', () => {
  it('fetches from the plugin when no cache exists, then writes the cache', async () => {
    let calls = 0
    const forward = async (_req: JSONRPCRequest): Promise<JSONRPCResponse> => {
      calls++
      return pluginResponse(LIBRARIES)
    }

    const result = await ensureIndex(forward, { cachePath })
    expect(calls).toBe(1)
    expect(result.source).toBe('plugin')
    expect(result.libraries).toHaveLength(2)

    const cache = await readCache(cachePath)
    expect(cache?.libraries).toHaveLength(2)
  })

  it('serves from cache without calling the plugin when fresh', async () => {
    await writeCache(LIBRARIES, { cachePath })
    let calls = 0
    const forward = async (_req: JSONRPCRequest): Promise<JSONRPCResponse> => {
      calls++
      return pluginResponse(LIBRARIES)
    }

    const result = await ensureIndex(forward, { cachePath })
    expect(calls).toBe(0)
    expect(result.source).toBe('cache')
  })

  it('refreshes when the cache is stale', async () => {
    await writeCache(LIBRARIES, {
      cachePath,
      fetchedAt: new Date(Date.now() - 365 * 24 * 3600_000).toISOString(),
    })
    let calls = 0
    const forward = async (_req: JSONRPCRequest): Promise<JSONRPCResponse> => {
      calls++
      return pluginResponse(LIBRARIES)
    }

    const result = await ensureIndex(forward, { cachePath })
    expect(calls).toBe(1)
    expect(result.source).toBe('plugin')
    expect(result.stale).toBe(false)
  })

  it('force always re-fetches', async () => {
    await writeCache(LIBRARIES, { cachePath })
    let calls = 0
    const forward = async (_req: JSONRPCRequest): Promise<JSONRPCResponse> => {
      calls++
      return pluginResponse(LIBRARIES)
    }

    await ensureIndex(forward, { cachePath, force: true })
    expect(calls).toBe(1)
  })

  it('falls back to stale cache when the plugin fails', async () => {
    await writeCache(LIBRARIES, {
      cachePath,
      fetchedAt: new Date(Date.now() - 365 * 24 * 3600_000).toISOString(),
    })
    const forward = async (_req: JSONRPCRequest): Promise<JSONRPCResponse> => {
      return { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'No MasterGo plugin connected' } } as JSONRPCResponse
    }

    const result = await ensureIndex(forward, { cachePath })
    expect(result.source).toBe('stale-cache')
    expect(result.stale).toBe(true)
    expect(result.libraries).toHaveLength(2)
  })

  it('throws when the plugin fails and no cache exists', async () => {
    const forward = async (_req: JSONRPCRequest): Promise<JSONRPCResponse> => {
      return { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'No MasterGo plugin connected' } } as JSONRPCResponse
    }
    await expect(ensureIndex(forward, { cachePath })).rejects.toThrow(/团队组件库不可用/)
  })

  it('tolerates the MCP-style content wrapper', async () => {
    const forward = async (_req: JSONRPCRequest): Promise<JSONRPCResponse> => {
      return {
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: JSON.stringify({ libraries: LIBRARIES }) }] },
      } as unknown as JSONRPCResponse
    }
    const result = await ensureIndex(forward, { cachePath })
    expect(result.libraries).toHaveLength(2)
  })
})

// ─── 检索 ─────────────────────────────────────────────

describe('normName', () => {
  it('strips DS_ prefix and normalizes separators', () => {
    expect(normName('DS_Button')).toBe('button')
    expect(normName('ds-button/primary')).toBe('button-primary')
    expect(normName('  Pricing  Card ')).toBe('pricing-card')
  })

  it('keeps CJK characters', () => {
    expect(normName('基础组件库')).toBe('基础组件库')
  })
})

describe('searchComponents', () => {
  it('ranks an exact DS_ name match first', () => {
    const hits = searchComponents(LIBRARIES, 'DS_Button')
    expect(hits[0].ukey).toBe('ukey-button')
    expect(hits[0].matchType).toBe('exact')
  })

  it('matches by normalized name (button → DS_Button)', () => {
    const hits = searchComponents(LIBRARIES, 'button')
    expect(hits.map((h) => h.ukey)).toContain('ukey-button')
    expect(hits.map((h) => h.ukey)).toContain('ukey-button-single')
  })

  it('matches descriptions', () => {
    const hits = searchComponents(LIBRARIES, '定价')
    expect(hits).toHaveLength(1)
    expect(hits[0].ukey).toBe('ukey-pricing')
    expect(hits[0].matchType).toBe('description')
  })

  it('filters by library', () => {
    const hits = searchComponents(LIBRARIES, 'card', { library: 'Marketing Kit' })
    expect(hits).toHaveLength(0)

    const all = searchComponents(LIBRARIES, 'banner')
    expect(all[0].library).toBe('Marketing Kit')
  })

  it('filters by component type', () => {
    const sets = searchComponents(LIBRARIES, 'button', { type: 'COMPONENT_SET' })
    expect(sets).toHaveLength(1)
    expect(sets[0].ukey).toBe('ukey-button')
  })

  it('respects limit and returns [] for no match', () => {
    expect(searchComponents(LIBRARIES, 'button', { limit: 1 })).toHaveLength(1)
    expect(searchComponents(LIBRARIES, 'zzzz')).toHaveLength(0)
  })

  it('returns all components for an empty query', () => {
    expect(searchComponents(LIBRARIES, '')).toHaveLength(5)
  })
})

describe('searchStyles', () => {
  it('lists all styles across groups', () => {
    const styles = searchStyles(LIBRARIES)
    expect(styles.map((s) => s.ukey)).toEqual(
      expect.arrayContaining(['ukey-paint-brand', 'ukey-text-h1', 'ukey-paint-accent']),
    )
  })

  it('filters by group and query', () => {
    const paints = searchStyles(LIBRARIES, { group: 'paints' })
    expect(paints.every((s) => s.group === 'paints')).toBe(true)
    expect(paints).toHaveLength(2)

    const brand = searchStyles(LIBRARIES, { group: 'paints', query: 'accent' })
    expect(brand).toHaveLength(1)
    expect(brand[0].library).toBe('Marketing Kit')
  })
})

describe('summarizeLibraries', () => {
  it('summarizes counts per library', () => {
    const summary = summarizeLibraries(LIBRARIES)
    expect(summary[0]).toMatchObject({
      name: '基础组件库',
      componentCount: 4,
      componentSetCount: 1,
      styleCount: 2,
    })
    expect(summary[0].styleBreakdown).toEqual({ paints: 1, texts: 1 })
  })
})
