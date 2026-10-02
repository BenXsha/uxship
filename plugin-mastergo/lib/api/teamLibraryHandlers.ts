/**
 * 团队组件库处理器
 *
 * 通过 MasterGo 插件 API 访问「团队库 / 团队组件库」能力：
 * - `mg.getTeamLibraryAsync()` — 列出团队库、库内组件（含 ukey）与库样式（颜色/文本/效果/间距…）
 * - `mg.importComponentByKeyAsync(ukey)` / `mg.importComponentSetByKeyAsync(ukey)` — 把团队组件导入当前文档
 * - `mg.importStyleByKeyAsync(ukey)` — 把团队样式导入当前文档
 *
 * 设计约定：
 * - 处理器返回「裸对象」，由 dispatcher 包成 JSON-RPC result（与 component/list 等保持一致）
 * - 组件/样式的名称解析（模糊匹配）也在这里兜底完成，服务端只负责检索与缓存
 * - 团队库 API 不存在时（老版本 MasterGo）抛出明确错误，不静默降级
 */

// ─── 类型 ────────────────────────────────────────────

// 实例子节点覆写只有**一份**实现（swapComponentHandlers）：DSL 实例渲染、换组件、
// 团队库导入三条链路共用同一套语义（含非法 fill 拒绝与降级上报），避免语义漂移。
import { applyInstanceOverrides } from './instance-overrides'

export interface TeamLibraryComponent {
  id: string
  name: string
  ukey: string
  description: string
  type: 'COMPONENT' | 'COMPONENT_SET'
  width?: number
  height?: number
  /** 属于某个 ComponentSet 时指向该 Set 的 ukey，否则为空字符串 */
  componentSetUkey?: string
  cover?: string
}

export interface TeamLibraryStyle {
  id: string
  name: string
  ukey: string
  description: string
  type: string
}

export interface TeamLibraryEntry {
  id: string
  name: string
  components: TeamLibraryComponent[]
  styles: Record<string, TeamLibraryStyle[]>
}

/** 样式分组（与 mg TeamLibrary.style 的键名一致） */
export const STYLE_GROUPS = [
  'paints', 'effects', 'texts', 'grids',
  'strokeWidths', 'cornerRadiuses', 'paddings', 'spacings',
] as const

export type StyleGroup = typeof STYLE_GROUPS[number]

/** 分组名 → MasterGo StyleType */
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

/** 内存缓存：getTeamLibraryAsync 可能较慢，10s 内复用 */
const INDEX_TTL_MS = 10_000
let indexCache: { at: number; libraries: TeamLibraryEntry[] } | null = null

// ─── API 可用性 ───────────────────────────────────────

function teamApi(): any {
  return mg as any
}

export function isTeamLibrarySupported(): boolean {
  return typeof teamApi()?.getTeamLibraryAsync === 'function'
}

function assertTeamLibrarySupported(): void {
  if (!isTeamLibrarySupported()) {
    throw new Error(
      '团队组件库 API 不可用：当前环境未提供 mg.getTeamLibraryAsync()。' +
      '请升级 MasterGo 桌面端 / 插件 API 版本后重试（团队库能力依赖该 API）。'
    )
  }
}

// ─── 归一化 ───────────────────────────────────────────

function normalizeComponent(raw: any): TeamLibraryComponent | null {
  if (!raw) return null
  const ukey = raw.ukey || raw.key || ''
  if (!ukey) return null
  return {
    id: String(raw.id || ''),
    name: String(raw.name || ''),
    ukey: String(ukey),
    description: String(raw.description || ''),
    type: raw.type === 'COMPONENT_SET' ? 'COMPONENT_SET' : 'COMPONENT',
    width: typeof raw.width === 'number' ? raw.width : undefined,
    height: typeof raw.height === 'number' ? raw.height : undefined,
    componentSetUkey: raw.componentSetUkey ? String(raw.componentSetUkey) : undefined,
    cover: typeof raw.cover === 'string' ? raw.cover : undefined,
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
          id: String(s.id || ''),
          name: String(s.name || ''),
          ukey: String(ukey),
          description: String(s.description || ''),
          type: String(s.type || GROUP_STYLE_TYPE[group] || ''),
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

/**
 * 读取团队库索引（带 10s 内存缓存）
 */
export async function loadTeamLibraries(force = false): Promise<TeamLibraryEntry[]> {
  assertTeamLibrarySupported()
  if (!force && indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) {
    return indexCache.libraries
  }
  const raw = await teamApi().getTeamLibraryAsync()
  const list = Array.isArray(raw) ? raw : []
  const libraries = list.map(normalizeLibrary)
  indexCache = { at: Date.now(), libraries }
  return libraries
}

/** 清除内存索引缓存（导入/同步后可调用） */
export function invalidateTeamLibraryIndex(): void {
  indexCache = null
}

// ─── 名称解析 ─────────────────────────────────────────

/** 归一化名称用于匹配：小写 + 去掉 DS_ 前缀 + 非字母数字折叠为单个 - */
function normName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/^ds-/, '')
}

export interface ResolvedComponent {
  libraryId: string
  libraryName: string
  component: TeamLibraryComponent
}

/**
 * 按 ukey 或「库名 + 组件名」定位团队组件
 */
export async function resolveComponent(params: {
  ukey?: string
  library?: string
  component?: string
  type?: string
}): Promise<ResolvedComponent> {
  // 1) 显式 ukey：不需要索引
  if (params.ukey) {
    let fromIndex: ResolvedComponent | undefined
    try {
      fromIndex = (await loadTeamLibraries())
        .flatMap((lib) => lib.components.map((c) => ({ libraryId: lib.id, libraryName: lib.name, component: c })))
        .find((entry) => entry.component.ukey === params.ukey)
    } catch {
      /* 索引不可用时仅凭 ukey 导入 */
    }
    return fromIndex || {
      libraryId: '',
      libraryName: '',
      component: {
        id: '',
        name: params.component || params.ukey,
        ukey: params.ukey,
        description: '',
        type: params.type === 'COMPONENT_SET' ? 'COMPONENT_SET' : 'COMPONENT',
      },
    }
  }

  const libraries = await loadTeamLibraries()
  const wantedLib = params.library ? normName(params.library) : ''
  const wantedName = params.component ? normName(params.component) : ''

  const candidates: ResolvedComponent[] = []
  for (const lib of libraries) {
    if (wantedLib && normName(lib.name) !== wantedLib && normName(lib.id) !== wantedLib) continue
    for (const c of lib.components) {
      candidates.push({ libraryId: lib.id, libraryName: lib.name, component: c })
    }
  }

  if (!params.component) {
    throw new Error('需要提供 ukey，或提供 component（可选 library）以按名称定位团队组件')
  }
  if (candidates.length === 0) {
    throw new Error(
      `未找到团队库${params.library ? ` "${params.library}"` : ''}中的组件，可用库：` +
      libraries.map((l) => l.name).join(', ') || '（无可用团队库）'
    )
  }

  // 精确名称 → 归一化名称 → 包含匹配
  const exact = candidates.find((c) => c.component.name === params.component)
  const normalized = candidates.find((c) => normName(c.component.name) === wantedName)
  const partial = candidates.find((c) => normName(c.component.name).includes(wantedName))
  const hit = exact || normalized || partial

  if (!hit) {
    throw new Error(
      `团队库中未找到组件 "${params.component}"。相近候选：` +
      candidates.slice(0, 10).map((c) => `${c.libraryName}/${c.component.name}`).join(', ')
    )
  }
  return hit
}

/** 按 ukey / 名称定位团队样式 */
async function resolveStyle(params: {
  ukey?: string
  library?: string
  name?: string
  group?: string
}): Promise<{ libraryName: string; style: TeamLibraryStyle }> {
  if (params.ukey && !params.name) {
    try {
      for (const lib of await loadTeamLibraries()) {
        for (const group of STYLE_GROUPS) {
          const hit = lib.styles[group]?.find((s) => s.ukey === params.ukey)
          if (hit) return { libraryName: lib.name, style: hit }
        }
      }
    } catch {
      /* ignore */
    }
    return {
      libraryName: '',
      style: {
        id: '',
        name: params.ukey,
        ukey: params.ukey,
        description: '',
        type: params.group ? (GROUP_STYLE_TYPE[params.group] || '') : '',
      },
    }
  }

  const libraries = await loadTeamLibraries()
  const groups = params.group ? [params.group] : (STYLE_GROUPS as unknown as string[])
  const wantedName = normName(params.name || '')
  const wantedLib = params.library ? normName(params.library) : ''

  for (const lib of libraries) {
    if (wantedLib && normName(lib.name) !== wantedLib && normName(lib.id) !== wantedLib) continue
    for (const group of groups) {
      const list = lib.styles[group] || []
      const hit =
        list.find((s) => s.name === params.name) ||
        list.find((s) => normName(s.name) === wantedName) ||
        list.find((s) => normName(s.name).includes(wantedName))
      if (hit) return { libraryName: lib.name, style: hit }
    }
  }

  throw new Error(
    `未找到团队库样式 "${params.name || params.ukey}"` +
    (params.group ? `（分组 ${params.group}）` : '') +
    '。请先用 team_style_list 查询可用样式。'
  )
}

// ─── 团队库列表 ───────────────────────────────────────

export async function handleTeamLibraryList(params: {
  libraryId?: string
  libraryName?: string
  includeComponents?: boolean
  includeStyles?: boolean
  includeCover?: boolean
  force?: boolean
} = {}): Promise<any> {
  const libraries = await loadTeamLibraries(params.force === true)
  const includeComponents = params.includeComponents !== false
  const includeStyles = params.includeStyles !== false

  let filtered = libraries
  if (params.libraryId) filtered = filtered.filter((l) => l.id === params.libraryId)
  if (params.libraryName) {
    const wanted = normName(params.libraryName)
    filtered = filtered.filter((l) => normName(l.name) === wanted || normName(l.id) === wanted)
  }

  return {
    apiAvailable: true,
    fetchedAt: new Date().toISOString(),
    total: filtered.length,
    libraries: filtered.map((lib) => {
      const entry: any = {
        id: lib.id,
        name: lib.name,
        componentCount: lib.components.length,
        styleCount: STYLE_GROUPS.reduce((sum, g) => sum + (lib.styles[g]?.length || 0), 0),
      }
      if (includeComponents) {
        entry.components = lib.components.map((c) => {
          const item: any = {
            name: c.name,
            ukey: c.ukey,
            type: c.type,
            description: c.description,
          }
          if (c.width !== undefined) item.width = c.width
          if (c.height !== undefined) item.height = c.height
          if (c.componentSetUkey) item.componentSetUkey = c.componentSetUkey
          if (params.includeCover && c.cover) item.cover = c.cover
          return item
        })
      }
      if (includeStyles) entry.styles = lib.styles
      return entry
    }),
  }
}

// ─── 组件导入 ─────────────────────────────────────────

/** 导入组件节点；COMPONENT_SET 自动落到某个 variant 上 */
export async function importComponentNode(
  ukey: string,
  opts: { variant?: string; expectedType?: string } = {},
): Promise<{ node: any; importedAs: 'COMPONENT' | 'COMPONENT_SET' }> {
  const api = teamApi()
  let node: any = null
  let importedAs: 'COMPONENT' | 'COMPONENT_SET' = opts.expectedType === 'COMPONENT_SET' ? 'COMPONENT_SET' : 'COMPONENT'

  const importComponent = async () => {
    importedAs = 'COMPONENT'
    return await api.importComponentByKeyAsync(ukey)
  }
  const importSet = async () => {
    if (typeof api.importComponentSetByKeyAsync !== 'function') {
      throw new Error('当前环境不支持 mg.importComponentSetByKeyAsync()，无法导入组件集')
    }
    importedAs = 'COMPONENT_SET'
    return await api.importComponentSetByKeyAsync(ukey)
  }

  try {
    node = opts.expectedType === 'COMPONENT_SET' ? await importSet() : await importComponent()
  } catch (firstErr: any) {
    // 组件 / 组件集互相兜底重试
    try {
      node = opts.expectedType === 'COMPONENT_SET' ? await importComponent() : await importSet()
    } catch {
      throw new Error(
        `团队组件导入失败 (ukey=${ukey})：${firstErr?.message || firstErr}。` +
        '请确认该组件所在团队库已启用、且当前账号有访问权限。'
      )
    }
  }

  if (!node) throw new Error(`团队组件导入返回空节点 (ukey=${ukey})`)

  // 组件集：落到指定 / 第一个 variant 上
  if (node.type === 'COMPONENT_SET') {
    const children: any[] = node.children || []
    const wanted = opts.variant ? String(opts.variant).toLowerCase() : ''
    const variantNode =
      (wanted && children.find((c: any) => String(c.name || '').toLowerCase().includes(wanted))) ||
      children.find((c: any) => c.type === 'COMPONENT')
    if (!variantNode) {
      throw new Error(`组件集 "${node.name}" 内没有可用的 variant 组件`)
    }
    node = variantNode
  }

  return { node, importedAs }
}

/**
 * 导入团队组件并实例化
 */
export async function handleTeamComponentImport(params: {
  ukey?: string
  library?: string
  component?: string
  type?: string
  variant?: string
  x?: number
  y?: number
  width?: number
  height?: number
  parentId?: string
  name?: string
  overrides?: Record<string, Record<string, string>>
  variantProperties?: Record<string, string>
  components?: Array<{
    ukey?: string
    library?: string
    component?: string
    type?: string
    variant?: string
    x?: number
    y?: number
    width?: number
    height?: number
    name?: string
    overrides?: Record<string, Record<string, string>>
    variantProperties?: Record<string, string>
  }>
  layout?: 'row' | 'column' | 'none'
  gap?: number
  startX?: number
  startY?: number
  columns?: number
}): Promise<any> {
  assertTeamLibrarySupported()

  const requests = params.components && params.components.length > 0 ? params.components : [params]
  const layout = params.layout || 'row'
  const gap = params.gap ?? 24
  let cursorX = params.startX ?? params.x ?? 100
  let cursorY = params.startY ?? params.y ?? 100
  const rowStartX = cursorX

  const parent = params.parentId ? mg.getNodeById(params.parentId) : null
  if (params.parentId && !parent) {
    throw new Error(`父节点不存在: ${params.parentId}`)
  }

  const imported: any[] = []
  const missedOverrides: string[] = []
  let maxRowHeight = 0

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i]
    const resolved = await resolveComponent({
      ukey: req.ukey,
      library: req.library,
      component: req.component,
      type: req.type,
    })

    const { node: component, importedAs } = await importComponentNode(resolved.component.ukey, {
      variant: req.variant,
      expectedType: req.type || resolved.component.type,
    })

    if (typeof component.createInstance !== 'function') {
      throw new Error(`组件 "${component.name}" 不支持 createInstance()，无法实例化`)
    }

    const instance = component.createInstance()
    instance.name = req.name || resolved.component.name || component.name || 'TeamInstance'

    // 落位：显式坐标 > 布局游标
    const explicitX = req.x ?? (i === 0 ? params.x : undefined)
    const explicitY = req.y ?? (i === 0 ? params.y : undefined)

    if (parent) {
      if (!('appendChild' in parent)) {
        throw new Error(`父节点不支持 appendChild: ${params.parentId}`)
      }
      ;(parent as any).appendChild(instance)
      // 指定父容器时默认贴容器左上角，交由容器/自动布局接管
      instance.x = explicitX ?? 0
      instance.y = explicitY ?? 0
    } else {
      mg.document.currentPage.appendChild(instance)
      instance.x = explicitX ?? cursorX
      instance.y = explicitY ?? cursorY
    }

    if (req.width || req.height) {
      instance.resize(req.width ?? instance.width, req.height ?? instance.height)
    }

    if (req.variantProperties && typeof instance.setVariantPropertyValues === 'function') {
      instance.setVariantPropertyValues(req.variantProperties)
    }

    const missed = applyInstanceOverrides(instance, req.overrides)
    // 共享实现返回 OverrideSkip[]；对外字段保持 string[]（`实例名/子层名[.属性]`）不变
    missedOverrides.push(...missed.map((s) => `${instance.name}/${s.childName}${s.prop ? `.${s.prop}` : ''}`))

    imported.push({
      instanceId: instance.id,
      name: instance.name,
      componentId: component.id,
      componentName: component.name,
      ukey: resolved.component.ukey,
      library: resolved.libraryName || resolved.libraryId || undefined,
      importedAs,
      x: instance.x,
      y: instance.y,
      width: instance.width,
      height: instance.height,
    })

    // 游标推进（仅在没有显式父容器时按布局排布）
    if (!parent) {
      const h = (instance.height || 0) + gap
      maxRowHeight = Math.max(maxRowHeight, h)
      if (layout === 'column') {
        cursorY += h
      } else if (layout === 'none') {
        // 不改游标
      } else if (params.columns && params.columns > 0 && (i + 1) % params.columns === 0) {
        cursorX = rowStartX
        cursorY += maxRowHeight
        maxRowHeight = 0
      } else {
        cursorX += (instance.width || 0) + gap
      }
    }
  }

  mg.commitUndo()

  return {
    success: true,
    count: imported.length,
    imported,
    ...(missedOverrides.length > 0 ? { missedOverrides } : {}),
    hint: '实例已落到画布；可用 node_update 调整尺寸/位置，或 data-component-id 引用本地组件。团队组件 ukey 可复用，无需重复导入。',
  }
}

// ─── 样式导入 ─────────────────────────────────────────

const GROUP_TO_NODE_PROP: Record<string, string> = {
  paints: 'fillStyleId',
  effects: 'effectStyleId',
  texts: 'textStyleId',
  grids: 'gridStyleId',
  strokeWidths: 'strokeStyleId',
  cornerRadiuses: 'cornerRadiusStyleId',
  paddings: 'paddingStyleId',
  spacings: 'spacingStyleId',
}

/**
 * 导入团队样式（颜色 / 文本 / 效果 / 网格 / 描边宽 / 圆角 / 内边距 / 间距），可同时应用到节点
 */
export async function handleTeamStyleImport(params: {
  ukey?: string
  ukeys?: string[]
  library?: string
  name?: string
  group?: string
  applyTo?: string
  applyAs?: 'fill' | 'stroke'
}): Promise<any> {
  assertTeamLibrarySupported()

  const requests: Array<{ ukey?: string; name?: string; group?: string }> =
    params.ukeys && params.ukeys.length > 0
      ? params.ukeys.map((ukey) => ({ ukey }))
      : [{ ukey: params.ukey, name: params.name, group: params.group }]

  if (!params.ukey && !params.name && requests.length === 0) {
    throw new Error('需要提供 ukey / ukeys / name 之一来指定团队样式')
  }

  const target = params.applyTo ? mg.getNodeById(params.applyTo) : null
  if (params.applyTo && !target) {
    throw new Error(`目标节点不存在: ${params.applyTo}`)
  }

  const imported: any[] = []
  const warnings: string[] = []

  for (const req of requests) {
    const { libraryName, style } = await resolveStyle({
      ukey: req.ukey,
      name: req.name,
      group: req.group,
      library: params.library,
    })

    let localStyle: any = null
    try {
      localStyle = await teamApi().importStyleByKeyAsync(style.ukey)
    } catch (err: any) {
      warnings.push(`样式导入失败 ${libraryName ? `${libraryName}/` : ''}${style.name} (${style.ukey}): ${err?.message || err}`)
      continue
    }
    if (!localStyle) {
      warnings.push(`样式导入返回空：${style.name} (${style.ukey})`)
      continue
    }

    const group = req.group || groupOfStyleType(localStyle.type || style.type)
    const entry: any = {
      styleId: localStyle.id,
      name: localStyle.name || style.name,
      type: localStyle.type || style.type,
      group,
      ukey: style.ukey,
      library: libraryName || undefined,
    }

    if (target) {
      const prop = params.applyAs === 'stroke' && group === 'paints'
        ? 'strokeStyleId'
        : GROUP_TO_NODE_PROP[group]
      if (!prop) {
        warnings.push(`样式类型 ${localStyle.type} 暂不支持应用到节点（已导入样式库）：${style.name}`)
      } else {
        try {
          ;(target as any)[prop] = localStyle.id
          entry.appliedTo = params.applyTo
          entry.appliedAs = prop
        } catch (err: any) {
          warnings.push(`应用样式失败 ${style.name} → ${prop}: ${err?.message || err}`)
        }
      }
    }

    imported.push(entry)
  }

  if (imported.length > 0) mg.commitUndo()

  return {
    success: imported.length > 0,
    count: imported.length,
    imported,
    ...(warnings.length > 0 ? { warnings } : {}),
    hint: '已导入的样式进入当前文档样式库，可用 style_apply 或 node_update 应用到其它节点。',
  }
}

function groupOfStyleType(type: string): string {
  const found = Object.entries(GROUP_STYLE_TYPE).find(([, t]) => t === type)
  return found ? found[0] : 'paints'
}
