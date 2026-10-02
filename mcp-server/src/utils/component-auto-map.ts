/**
 * 组件自动映射：在 code_to_design 预处理阶段为 HTML 注入组件引用。
 *
 * 两级来源（本地优先）：
 * 1. 当前文档的 Component Master → `data-component-id`
 * 2. 团队组件库索引（缓存/插件）→ `data-library-ukey`
 *
 * 同时把作者手写的团队库引用解析为 ukey：
 * - `data-library-component="<ukey>"`                    直接引用
 * - `data-library-component="<组件名>"`                  按名称在全部团队库中解析
 * - `data-library-component="<库名>/<组件名>"`            限定库解析
 * - `data-library-library="<库名>" data-library-component="<组件名>"` 等价写法
 */

import type { JSONRPCRequest, JSONRPCResponse } from '../types/index.js'
import { extractResultPayload, ensureIndex, normName } from './team-library-cache.js'

interface ComponentInfo {
  id: string
  name: string
}

/** 语义标签 → 设计系统组件名（本地 Component Master / 团队组件同名匹配） */
const TAG_TO_DS_NAME: Record<string, string> = {
  button: 'DS_Button',
  input: 'DS_TextInput',
  select: 'DS_Select',
  badge: 'DS_Badge',
  toggle: 'DS_Toggle',
  modal: 'DS_Modal',
  'data-table': 'DS_Table',
}

/** 该标签是否已经被显式/自动指定了组件引用（含换组件指令的 data-swap-*） */
function hasComponentRef(attrs: string): boolean {
  return (
    attrs.includes('data-component-id') ||
    attrs.includes('data-component-name') ||
    attrs.includes('data-library-ukey') ||
    attrs.includes('data-library-component') ||
    attrs.includes('data-swap-ukey') ||
    attrs.includes('data-swap-component') ||
    attrs.includes('data-swap-component-id')
  )
}

/**
 * 从插件端获取当前文档的所有 Component Master
 */
async function fetchComponents(
  forwardRequest: (req: JSONRPCRequest) => Promise<JSONRPCResponse>,
): Promise<ComponentInfo[]> {
  try {
    const req: JSONRPCRequest = { jsonrpc: '2.0', id: 'cmp_scan', method: 'component/list', params: {} }
    const res = await forwardRequest(req)
    const payload: any = extractResultPayload(res)
    if (!payload) return []
    if (Array.isArray(payload)) return payload as ComponentInfo[]
    return (payload.components || []) as ComponentInfo[]
  } catch {
    return []
  }
}

export interface TeamComponentIndexEntry {
  library: string
  name: string
  ukey: string
  type: 'COMPONENT' | 'COMPONENT_SET'
}

/**
 * 获取团队组件索引（走 team-library-cache，自动使用/刷新本地缓存）。
 * 返回 available=false 表示团队库索引不可用（插件未连接 / 未启用团队库）。
 */
export async function loadTeamComponentIndex(
  forwardRequest: (req: JSONRPCRequest) => Promise<JSONRPCResponse>,
): Promise<{ available: boolean; index: TeamComponentIndexEntry[] }> {
  try {
    const { libraries } = await ensureIndex(forwardRequest)
    return {
      available: true,
      index: libraries.flatMap((lib) =>
        lib.components.map((c) => ({
          library: lib.name,
          name: c.name,
          ukey: c.ukey,
          type: c.type,
        })),
      ),
    }
  } catch {
    return { available: false, index: [] }
  }
}

/** 只取索引数组的便捷封装（失败返回空数组） */
export async function fetchTeamComponents(
  forwardRequest: (req: JSONRPCRequest) => Promise<JSONRPCResponse>,
): Promise<TeamComponentIndexEntry[]> {
  const { index } = await loadTeamComponentIndex(forwardRequest)
  return index
}

/** 在团队组件索引中按名称定位（raw 精确 → 归一化精确 → 归一化包含） */
function findTeamComponent(
  index: TeamComponentIndexEntry[],
  wanted: string,
  library?: string,
): TeamComponentIndexEntry | undefined {
  const wantedNorm = normName(wanted)
  const libraryNorm = library ? normName(library) : ''
  const pool = libraryNorm
    ? index.filter((c) => normName(c.library) === libraryNorm || normName(c.library).includes(libraryNorm))
    : index
  if (pool.length === 0) return undefined

  const raw = wanted.toLowerCase()
  return (
    // 1) 原始名完全一致（含 DS_ 前缀）
    pool.find((c) => c.name.toLowerCase() === raw) ||
    // 2) 归一化一致（DS_Button ≈ Button）
    pool.find((c) => normName(c.name) === wantedNorm) ||
    // 3) 归一化包含
    pool.find((c) => normName(c.name).includes(wantedNorm)) ||
    // 4) 反向包含（组件名比期望更长：DS_Button_Primary）
    pool.find((c) => wantedNorm.includes(normName(c.name)))
  )
}

/** 组件集优先（多态组件更适合被实例化引用） */
function preferComponentSet(hits: TeamComponentIndexEntry[]): TeamComponentIndexEntry | undefined {
  return hits.find((c) => c.type === 'COMPONENT_SET') || hits[0]
}

/**
 * 在 HTML 中为已知语义标签自动注入组件引用（本地 Component Master 优先，其次团队库）。
 * 例如 <button> → <button data-component-id="Component:xxx">
 *           或 <button data-library-ukey="ukey:xxx">
 * 仅当元素未显式指定任何组件引用时注入。
 */
export async function autoMapComponents(
  html: string,
  forwardRequest: (req: JSONRPCRequest) => Promise<JSONRPCResponse>,
): Promise<string> {
  const components = await fetchComponents(forwardRequest)
  const nameToId: Record<string, string> = {}
  for (const c of components) {
    nameToId[c.name] = c.id
  }

  let result = html
  const localMatches: string[] = []
  for (const [tag, dsName] of Object.entries(TAG_TO_DS_NAME)) {
    const componentId = nameToId[dsName]
    if (!componentId) continue
    localMatches.push(tag)
    result = injectAttrForTag(result, tag, `data-component-id="${componentId}"`)
  }

  // 团队库兜底：本地没有对应 Component Master 时，尝试团队组件
  const teamTags = Object.keys(TAG_TO_DS_NAME).filter((tag) => !localMatches.includes(tag))
  if (teamTags.length > 0) {
    const teamIndex = await fetchTeamComponents(forwardRequest)
    if (teamIndex.length > 0) {
      for (const tag of teamTags) {
        const dsName = TAG_TO_DS_NAME[tag]
        const hit = preferComponentSet(
          teamIndex.filter(
            (c) => normName(c.name) === normName(dsName) || c.name.toLowerCase() === dsName.toLowerCase(),
          ),
        )
        if (!hit) continue
        result = injectAttrForTag(result, tag, `data-library-ukey="${hit.ukey}"`)
      }
    }
  }

  return result
}

function injectAttrForTag(html: string, tag: string, attr: string): string {
  const pattern = new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi')
  return html.replace(pattern, (match, attrs) => {
    if (hasComponentRef(attrs || '')) return match
    if (attrs) return `<${tag} ${attr}${attrs}>`
    return `<${tag} ${attr}>`
  })
}

export interface TeamRefResolution {
  html: string
  warnings: string[]
  resolved: Array<{ library: string; component: string; ukey: string }>
}

/**
 * 组件引用属性族：源属性 → 解析后的 ukey 属性
 * - 常规实例：`data-library-component` → `data-library-ukey`
 * - 换组件指令：`data-swap-component` → `data-swap-ukey`
 */
const COMPONENT_REF_ATTRS = [
  { source: 'data-library-component', target: 'data-library-ukey', library: 'data-library-library' },
  { source: 'data-swap-component', target: 'data-swap-ukey', library: 'data-swap-library' },
]

/**
 * 把 HTML 中的团队库引用解析为 ukey：
 * - `data-library-component="<ukey|组件名|库名/组件名>"`
 * - `data-library-library="<库名>"` 与 `data-library-component="<组件名>"` 组合
 * - 换组件指令：`data-swap-component` / `data-swap-library`（同上，解析为 `data-swap-ukey`）
 *
 * 解析成功 → 写成对应的 ukey 属性；索引不可用 → 保留原属性（客户端按 ukey 处理）；
 * 索引可用但匹配不到 → 移除该属性并给出警告（避免渲染成错的组件）。
 */
export async function resolveTeamLibraryRefs(
  html: string,
  forwardRequest: (req: JSONRPCRequest) => Promise<JSONRPCResponse>,
  opts: { enabled?: boolean } = {},
): Promise<TeamRefResolution> {
  const warnings: string[] = []
  const resolved: Array<{ library: string; component: string; ukey: string }> = []

  if (opts.enabled === false || !/data-(?:library|swap)-(?:component|library)=/i.test(html)) {
    return { html, warnings, resolved }
  }

  let index: TeamComponentIndexEntry[] = []
  let indexAvailable = true
  try {
    const loaded = await loadTeamComponentIndex(forwardRequest)
    index = loaded.index
    indexAvailable = loaded.available
  } catch {
    indexAvailable = false
  }
  const ukeySet = new Set(index.map((c) => c.ukey))

  let warnedUnavailable = false
  const out = html.replace(/<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*?)?)\/?>/g, (match, _tag: string, attrs: string) => {
    const attrStr = attrs || ''
    let result = match

    for (const family of COMPONENT_REF_ATTRS) {
      const componentMatch = new RegExp(`${family.source}="([^"]*)"`, 'i').exec(attrStr)
      if (!componentMatch) continue

      const sourceAttr = componentMatch[0]
      const rawValue = componentMatch[1].trim()
      if (!rawValue) continue

      // 索引不可用：信任调用方，保留属性（客户端按 ukey 直接导入）
      if (!indexAvailable || index.length === 0) {
        if (!warnedUnavailable) {
          warnings.push(`团队库索引不可用或为空，${family.source} 将按 ukey 原样交给插件导入`)
          warnedUnavailable = true
        }
        continue
      }

      // 已经是有效 ukey：显式改写为对应 ukey 属性
      if (ukeySet.has(rawValue)) {
        result = result.replace(sourceAttr, `${family.target}="${rawValue}"`)
        continue
      }

      // 库名/组件名 或 data-*-library + 组件名
      let library: string | undefined
      let componentName = rawValue
      const libraryAttr = new RegExp(`${family.library}="([^"]*)"`, 'i').exec(attrStr)
      if (rawValue.includes('/')) {
        const parts = rawValue.split('/')
        library = parts[0].trim()
        componentName = parts.slice(1).join('/').trim()
      } else if (libraryAttr) {
        library = libraryAttr[1].trim()
      }

      const hit = findTeamComponent(index, componentName, library)
      if (!hit) {
        warnings.push(
          `未在团队库中找到组件 "${rawValue}"${library ? `（库 ${library}）` : ''}，已忽略该引用（该元素按普通容器渲染）`,
        )
        result = result.replace(sourceAttr, '')
        continue
      }

      resolved.push({ library: hit.library, component: hit.name, ukey: hit.ukey })
      result = result.replace(sourceAttr, `${family.target}="${hit.ukey}"`)
    }

    return result
  })

  return { html: out, warnings, resolved }
}
