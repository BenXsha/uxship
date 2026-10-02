/**
 * 团队组件库工具的服务端处理器
 *
 * 这四个工具在服务端（Node 进程）执行，不转发给插件：
 * - team_library_list / team_component_search / team_style_list：读团队库索引缓存并检索
 * - team_library_sync：向插件拉取索引并落盘缓存
 *
 * 组件导入（team_component_import）与样式导入（team_style_import）有画布副作用，
 * 仍按常规路由转发给插件执行。
 */

import type { JSONRPCResponse } from '../types/index.js'
import {
  DEFAULT_MAX_AGE_MS,
  ensureIndex,
  getCachePath,
  readCache,
  searchComponents,
  searchStyles,
  STYLE_GROUPS,
  summarizeLibraries,
  writeCache,
  type EnsureIndexOptions,
  type ForwardRequest,
  type TeamLibraryEntry,
} from './team-library-cache.js'

function ok(id: string | number, payload: unknown): JSONRPCResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    },
  }
}

function fail(id: string | number, message: string): JSONRPCResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: message }],
      isError: true,
    },
  }
}

/** 把底层异常翻译成对 AI 有用的说明 */
function explainError(err: any): string {
  const message = err?.message || String(err)
  const looksLikeHttpModeFailure =
    /No HTTP mapping|is not a function|forwardFallback/i.test(message)
  if (looksLikeHttpModeFailure) {
    return (
      `团队组件库能力仅支持插件模式（MasterGo 插件 WebSocket 连接）。当前请求失败：${message}。` +
      '请确认 UXSHIP_MODE=plugin（或 auto）且 MasterGo 插件已打开并连接。'
    )
  }
  return message
}

interface LoadedIndex {
  libraries: TeamLibraryEntry[]
  meta: {
    source: string
    cachePath: string
    fetchedAt: string
    ageHours: number | null
    stale: boolean
    cacheError?: string
  }
}

async function loadIndex(
  forwardRequest: ForwardRequest,
  opts: EnsureIndexOptions,
): Promise<LoadedIndex> {
  const result = await ensureIndex(forwardRequest, opts)
  return {
    libraries: result.libraries,
    meta: {
      source: result.source,
      cachePath: result.cachePath,
      fetchedAt: result.fetchedAt,
      ageHours: result.ageMs === null ? null : Number((result.ageMs / 3_600_000).toFixed(2)),
      stale: result.stale,
      ...(result.cacheError ? { cacheError: result.cacheError } : {}),
    },
  }
}

/**
 * team_library_list
 */
export async function handleTeamLibraryListTool(
  args: Record<string, any>,
  id: string | number,
  forwardRequest: ForwardRequest,
): Promise<JSONRPCResponse> {
  try {
    const { libraries, meta } = await loadIndex(forwardRequest, {
      force: args.refresh === true,
      maxAgeMs: typeof args.maxAgeMs === 'number' ? args.maxAgeMs : DEFAULT_MAX_AGE_MS,
    })

    const wanted = args.library ? String(args.library).toLowerCase() : ''
    const filtered = wanted
      ? libraries.filter(
          (l) => l.name.toLowerCase().includes(wanted) || l.id.toLowerCase() === wanted,
        )
      : libraries

    const includeComponents = args.includeComponents !== false
    const includeStyles = args.includeStyles === true

    const detail = filtered.map((lib) => ({
      id: lib.id,
      name: lib.name,
      componentCount: lib.components.length,
      ...(includeComponents
        ? {
            components: lib.components.slice(0, 200).map((c) => ({
              name: c.name,
              ukey: c.ukey,
              type: c.type,
              ...(c.description ? { description: c.description } : {}),
              ...(c.width !== undefined ? { width: c.width } : {}),
              ...(c.height !== undefined ? { height: c.height } : {}),
            })),
            ...(lib.components.length > 200
              ? { componentsTruncated: lib.components.length - 200 }
              : {}),
          }
        : {}),
      ...(includeStyles
        ? {
            styles: Object.fromEntries(
              STYLE_GROUPS.map((g) => [g, lib.styles[g] || []]).filter(([, v]) => (v as unknown[]).length > 0),
            ),
          }
        : {}),
    }))

    return ok(id, {
      total: filtered.length,
      summary: summarizeLibraries(filtered),
      libraries: detail,
      index: meta,
      hint:
        filtered.length === 0
          ? '未发现团队库：请在 MasterGo 中「团队库/资源库」面板启用或关联团队组件库后，用 team_library_sync 重新同步。'
          : '用 team_component_search 检索具体组件，拿到 ukey 后交给 team_component_import 实例化。',
      env: {
        cachePath: getCachePath(),
        cacheEnvOverride: Boolean(process.env.UXSHIP_TEAM_LIBRARY_CACHE),
      },
    })
  } catch (err: any) {
    return fail(id, explainError(err))
  }
}

/**
 * team_component_search
 */
export async function handleTeamComponentSearchTool(
  args: Record<string, any>,
  id: string | number,
  forwardRequest: ForwardRequest,
): Promise<JSONRPCResponse> {
  try {
    const query = String(args.query ?? '')
    const { libraries, meta } = await loadIndex(forwardRequest, {
      force: args.refresh === true,
      maxAgeMs: typeof args.maxAgeMs === 'number' ? args.maxAgeMs : DEFAULT_MAX_AGE_MS,
    })

    const hits = searchComponents(libraries, query, {
      library: args.library ? String(args.library) : undefined,
      type: args.type === 'COMPONENT' || args.type === 'COMPONENT_SET' ? args.type : undefined,
      limit: typeof args.limit === 'number' ? args.limit : 20,
    })

    return ok(id, {
      query,
      total: hits.length,
      components: hits,
      index: meta,
      hint:
        hits.length === 0
          ? '没有匹配的团队组件：换关键词，或用 team_library_list 查看全部库内组件名。'
          : '把选中的 ukey 传给 team_component_import（可配 x/y/parentId/overrides），或在 HTML 中用 data-library-component="<ukey>"。',
    })
  } catch (err: any) {
    return fail(id, explainError(err))
  }
}

/**
 * team_style_list
 */
export async function handleTeamStyleListTool(
  args: Record<string, any>,
  id: string | number,
  forwardRequest: ForwardRequest,
): Promise<JSONRPCResponse> {
  try {
    const group = args.group ? String(args.group) : undefined
    if (group && !(STYLE_GROUPS as readonly string[]).includes(group)) {
      return fail(
        id,
        `未知样式分组 "${group}"，可选：${STYLE_GROUPS.join(', ')}`,
      )
    }

    const { libraries, meta } = await loadIndex(forwardRequest, {
      force: args.refresh === true,
      maxAgeMs: typeof args.maxAgeMs === 'number' ? args.maxAgeMs : DEFAULT_MAX_AGE_MS,
    })

    const styles = searchStyles(libraries, {
      library: args.library ? String(args.library) : undefined,
      group,
      query: args.query ? String(args.query) : undefined,
      limit: typeof args.limit === 'number' ? args.limit : 50,
    })

    return ok(id, {
      total: styles.length,
      group: group || 'all',
      styles,
      index: meta,
      hint:
        styles.length === 0
          ? '没有匹配的团队样式：确认团队库已启用且包含样式令牌，或用 team_library_sync 重新同步。'
          : '把 ukey 传给 team_style_import 导入当前文档；带 applyTo 可同时应用到指定节点。',
    })
  } catch (err: any) {
    return fail(id, explainError(err))
  }
}

/**
 * team_library_sync — 拉取索引并写入缓存文件
 */
export async function handleTeamLibrarySyncTool(
  args: Record<string, any>,
  id: string | number,
  forwardRequest: ForwardRequest,
): Promise<JSONRPCResponse> {
  try {
    const cachePath = args.path ? String(args.path) : getCachePath()
    const before = await readCache(cachePath)

    const result = await ensureIndex(forwardRequest, {
      force: true,
      allowStale: false,
      includeCover: args.includeCover === true,
      cachePath,
    })

    // ensureIndex 已写入；这里再确认一次并给出体积信息
    const written = await writeCache(result.libraries, {
      fetchedAt: result.fetchedAt,
      cachePath,
    })

    const componentCount = result.libraries.reduce((n, l) => n + l.components.length, 0)
    const styleCount = result.libraries.reduce(
      (n, l) => n + STYLE_GROUPS.reduce((m, g) => m + (l.styles[g]?.length || 0), 0),
      0,
    )

    return ok(id, {
      success: result.libraries.length > 0,
      cachePath,
      written: written.ok,
      ...(written.ok ? {} : { writeError: written.error }),
      fetchedAt: result.fetchedAt,
      libraries: summarizeLibraries(result.libraries),
      totals: {
        libraries: result.libraries.length,
        components: componentCount,
        styles: styleCount,
      },
      previousFetchedAt: before?.fetchedAt ?? null,
      hint:
        result.libraries.length === 0
          ? '插件返回 0 个团队库：请在 MasterGo「团队库」中启用/关联团队组件库后重试。'
          : '索引已就绪：team_library_list / team_component_search / team_style_list 将优先读缓存。',
    })
  } catch (err: any) {
    return fail(id, explainError(err))
  }
}
