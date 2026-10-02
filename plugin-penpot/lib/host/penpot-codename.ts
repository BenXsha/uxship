/**
 * 会话代号（Penpot 侧）—— **多 session 的身份**。
 *
 * 为什么需要：服务端 `session_list` 靠 `codename` 区分多个插件实例，`session_switch` 也支持按它定位。
 * Penpot 的会话 id 是**按文档**生成的（`sess_penpot_<documentId>`），所以代号也必须**按文档**取 ——
 * 同一文档多次打开 = 同一会话（同一代号）；不同文档才是不同 session。
 *
 * 持久化用 `penpot.localStorage`（manifest 里已声明 `allow:localstorage`）。首次使用自动生成一个
 * 易记代号（与 MasterGo 侧同一套词表），用户可在面板里改。
 *
 * ⚠️ 本文件属于**宿主适配层**：它用到文档类宿主 API（`penpot.localStorage` / `currentFile`），
 * 因此必须登记进 `tests/host-isolation.test.ts` 的 `ADAPTER_LAYER_FILES`（显式列名，不用 glob）。
 */

/** 与 MasterGo 侧同一套词表（两个宿主的代号风格保持一致） */
const CODENAMES = [
  'Nova', 'Pixel', 'Flux', 'Nexus', 'Apex',
  'Orbit', 'Echo', 'Luna', 'Spark', 'Shift',
  'Trace', 'Vapor', 'Drift', 'Gleam', 'Haven',
  'Joule', 'Quest', 'Ridge', 'Swift', 'Zenith',
]

const KEY_PREFIX = 'mgmcp:codename:'

function generateCodename(): string {
  return CODENAMES[Math.floor(Math.random() * CODENAMES.length)]
}

/** 当前文档的存储键：代号按文档隔离（拿不到文档 id 时不持久化，避免污染 'unknown' 键） */
function storageKey(): string | null {
  const documentId = penpot.currentFile?.id
  return documentId ? `${KEY_PREFIX}${documentId}` : null
}

function storage(): { getItem(key: string): string | null; setItem(key: string, value: string): void } | null {
  try {
    return penpot.localStorage ?? null
  } catch {
    return null
  }
}

/** 内存缓存：`getDocumentInfo()` 会被频繁调用，避免每次都读存储 */
let cached: { key: string; name: string } | null = null

/** 取当前文档的会话代号（没有就读/生成并写回；存储或文档 id 不可用时退回内存生成） */
export function getCodename(): string {
  const key = storageKey()
  const cacheKey = key ?? 'transient'
  if (cached && cached.key === cacheKey) return cached.name

  let name = ''
  if (key) {
    try {
      name = storage()?.getItem(key) ?? ''
    } catch {
      name = ''
    }
  }
  if (!name) {
    name = generateCodename()
    if (key) {
      try {
        storage()?.setItem(key, name)
      } catch {
        /* 写不进去也不影响本次会话 */
      }
    }
  }
  cached = { key: cacheKey, name }
  return name
}

/** 设置当前文档的会话代号并持久化（空串忽略；返回实际生效的值） */
export function setCodename(name: string): string {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return getCodename()
  const key = storageKey() ?? 'transient'
  if (key !== 'transient') {
    try {
      storage()?.setItem(key, trimmed)
    } catch {
      /* ignore */
    }
  }
  cached = { key, name: trimmed }
  return trimmed
}
