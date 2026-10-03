import type { HostLibraryRef, TeamLibraryConnectionInfo } from './types'

/**
 * Penpot 运行时的**窄化读取**工具（形状联合类型上的可缺失成员 / 库池 / 扫描预算）
 *
 * 从 `penpot.ts` 拆出（内聚单元：只按可缺失形状探测宿主成员，不持有任何状态）。
 * 存在的理由：`typings/penpot.d.ts` 是本项目自持的**手写子集**，声明与运行时并不总一致 ——
 * `children` 只在容器类型上、`.flex` 只在 board 上、`library.connected` 旧宿主没有。
 * 这类 `as unknown as` 探测收在一处，拆出去的各模块才能共用同一口径，
 * 不必各自复制一遍（复制出来的版本迟早会漂移）。
 */

/**
 * 按 Partial 视图读取形状的 children（PenpotShape 的联合基类未暴露该成员，只有 board/group/boolean/svg-raw 有）。
 * 非容器（叶子）运行时没有 children 属性，返回 undefined。
 */
export function containerChildren(shape: PenpotShape | null | undefined): PenpotShape[] | undefined {
  // SAFETY: PenpotShape 联合基类不暴露 children；按 Partial 探测，叶子成员运行时取到 undefined，由调用方判定。
  const children = (shape as unknown as Partial<PenpotContainerShape> | null | undefined)?.children
  return Array.isArray(children) ? children : undefined
}

export function getChildren(shape: PenpotShape): PenpotShape[] {
  return containerChildren(shape) ?? []
}

/**
 * penpot.library 的运行时视图。
 * typings 把 local/connected 声明为必填，但旧版宿主可能没有 connected；这里按可缺失承接。
 */
export function libraryPools(): { local?: PenpotLibrary; connected?: PenpotLibrary[] } {
  // SAFETY: typings 声明 library.local/connected 为必填，但旧版宿主可能缺 connected；按可缺失探测，
  // 调用方一律对结果做 Array.isArray/存在性判定。
  return penpot.library as unknown as { local?: PenpotLibrary; connected?: PenpotLibrary[] }
}

/**
 * 读取 board 的 flex 布局句柄。
 * 入参可能是任何 PenpotShape；只有 board 才有 `.flex`，非 board 运行时取到 undefined。
 */
export function flexOf(shape: PenpotShape | PenpotContainerShape | null | undefined): PenpotFlexLayout | undefined {
  // SAFETY: typings/penpot.d.ts 只把 `.flex` 声明在 PenpotBoard 上，调用点拿到的是运行时的 board
  // 引用（类型已窄化成 PenpotShape）；非 board 形状没有该成员，取到 undefined。
  return (shape as unknown as PenpotBoard | null | undefined)?.flex
}

/**
 * 全页扫描的节点预算（仅老宿主没有 `getShapeById` 时用；每次 children 读取都是跨 iframe 往返）。
 *
 * 共用同一个预算数字：节点查找（`PenpotHost.scanFor`）与全页形状收集
 * （`PenpotHost.allShapes`，令牌传播经它取形状）在**退回手写遍历**时靠它兜住
 * “大文档上不要挂死”；宿主 `page.findShapes()` 可用时走一次 API 调用，不受此预算约束。
 */
export const HOST_SCAN_BUDGET = 2000

// ── 团队库连接（自动 connectLibrary） ──

function libraryRef(lib: { id?: string; name?: string } | undefined | null): HostLibraryRef | null {
  if (!lib?.id) return null
  return { id: lib.id, name: lib.name || lib.id }
}

/** 本文件库 + 已连接库（按 id 去重；`connected` 里含本文件库是实测形态） */
function knownLibraries(): HostLibraryRef[] {
  const pools = libraryPools()
  const out: HostLibraryRef[] = []
  const seen = new Set<string>()
  for (const lib of [pools.local, ...(Array.isArray(pools.connected) ? pools.connected : [])]) {
    const ref = libraryRef(lib)
    if (ref && !seen.has(ref.id)) {
      seen.add(ref.id)
      out.push(ref)
    }
  }
  return out
}

function normalizeLibraryKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function libraryMatches(lib: { id?: string; name?: string }, wanted: string): boolean {
  return normalizeLibraryKey(lib.id) === wanted || normalizeLibraryKey(lib.name) === wanted
}

/**
 * 把团队库连上（`library.connectLibrary(id)`）。
 *
 * `nameOrId` 给了就连指定库；不给则连上 `availableLibraries()` 里所有还没连的。
 * 为什么要做：Penpot 插件能**读**已连接的库，却从不调 `connectLibrary` ——
 * 于是“复用团队组件”卡在“请先回 Penpot UI 手动连一次”。连接是必经步骤，
 * 不该让模型多记一个工具（见 docs/host-differences.md 与 CONTRIBUTING 的工具面治理）。
 *
 * 失败分三种，分别如实上报（见 `TeamLibraryConnectionInfo` 的说明）：能力缺失 / 名字没命中 / 连接抛错。
 */
export async function connectTeamLibraries(nameOrId?: string): Promise<TeamLibraryConnectionInfo> {
  const context = penpot.library
  const known = knownLibraries()

  if (typeof context?.availableLibraries !== 'function' || typeof context?.connectLibrary !== 'function') {
    return {
      connected: known,
      newlyConnected: [],
      supported: false,
      reason: '宿主未提供 library.availableLibraries()/connectLibrary()（旧版 Penpot）',
    }
  }

  let available: HostLibraryRef[]
  try {
    const listed = await context.availableLibraries()
    available = listed.map((lib) => libraryRef(lib)).filter((lib): lib is HostLibraryRef => lib !== null)
  } catch (error) {
    return {
      connected: known,
      newlyConnected: [],
      supported: true,
      reason: `availableLibraries() 抛错: ${(error as Error).message}`,
    }
  }

  const wanted = normalizeLibraryKey(nameOrId)
  const knownIds = new Set(known.map((lib) => lib.id))

  // 已经连着（或就是本文件库）→ 直接成功，不要报成“不在可列表里”
  if (wanted && known.some((lib) => libraryMatches(lib, wanted))) {
    return { connected: known, newlyConnected: [], supported: true, candidates: available }
  }

  const targets = wanted
    ? available.filter((lib) => libraryMatches(lib, wanted))
    : available.filter((lib) => !knownIds.has(lib.id))

  if (wanted && targets.length === 0) {
    return {
      connected: known,
      newlyConnected: [],
      supported: true,
      reason: `不在可连接的库列表里: ${nameOrId}`,
      candidates: available,
    }
  }

  const newlyConnected: HostLibraryRef[] = []
  const failed: (HostLibraryRef & { error: string })[] = []
  for (const target of targets) {
    try {
      await context.connectLibrary(target.id)
      newlyConnected.push(target)
    } catch (error) {
      failed.push({ ...target, error: (error as Error).message })
    }
  }

  // 回读 + 合上刚连上的：宿主未必同步更新 `library.connected`，而调用方马上要用这些库
  const merged = knownLibraries()
  const mergedIds = new Set(merged.map((lib) => lib.id))
  for (const lib of newlyConnected) {
    if (!mergedIds.has(lib.id)) {
      mergedIds.add(lib.id)
      merged.push(lib)
    }
  }

  return {
    connected: merged,
    newlyConnected,
    supported: true,
    candidates: available,
    ...(failed.length ? { failed } : {}),
    ...(wanted && !newlyConnected.length && failed.length ? { reason: `连接失败: ${failed.map((f) => f.name).join('、')}` } : {}),
  }
}
