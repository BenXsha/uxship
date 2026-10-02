/**
 * 插件端单测用的 `mg` 全局桩
 *
 * 插件生产代码通过全局 `mg` 访问 MasterGo API（`getNodeById` / `document.currentPage` /
 * `viewport` …）。单测里用本桩替代真实宿主，便可在无 MasterGo 环境下测处理器逻辑。
 *
 * 用法：
 * ```ts
 * import { installMgStub, resetMgStub } from './helpers/mg-stub'
 *
 * beforeEach(() => installMgStub({ nodes: { '1:2': frameNode } }))
 * afterEach(() => resetMgStub())
 * ```
 */
export interface MgStubOptions {
  /** id → 节点的映射（getNodeById 用） */
  nodes?: Record<string, any>
  /** 当前选区（document.currentPage.selection 的初值） */
  selection?: any[]
  /** 当前页名 */
  pageName?: string
  /**
   * 模拟 MasterGo 的静默行为：赋值选区时丢掉「不属于当前页」的节点
   * （真实宿主不会报错，只会把它们从 selection 里去掉 —— 用来验证回读校验）
   */
  filterSelectionToPage?: boolean
  /**
   * 是否注入根结构查询 API（`getRootNodeById` / `getRootParentLayerId`）
   *
   * 默认 false —— 保持旧桩「不提供这两个 API」的行为不变（向后兼容）。
   * 需要测根结构工作流时显式传 true。
   */
  withRootApis?: boolean
  /** 节点 id → 根节点 id 的映射（`getRootNodeById` 用）；值为 null 表示查询无根 */
  rootNodeIdById?: Record<string, string | null>
  /** 节点 id → 根父层 id 的映射（`getRootParentLayerId` 用）；值为 null 表示无根父层 */
  rootParentLayerIdById?: Record<string, string | null>
  /**
   * 模拟宿主切页「异步 / 排队」的行为：给 `document.currentPage` 赋值时不立即生效
   * （回读到的仍是旧页）。
   *
   * 默认 false —— 保持旧桩「赋值立即生效」的语义不变（向后兼容）。用来验证
   * `page_switch` / `page_create` 的回读校验（applied=false 分支）。
   */
  deferPageSwitch?: boolean
  /**
   * 追加子节点时把子节点的 x/y 重置为 0（模拟宿主：`appendChild` 到父层会按父层
   * 自动布局重算子节点几何）。
   *
   * 默认 false —— 保持旧桩行为不变（向后兼容）。需要验证「插入后二次应用几何」的
   * 用例显式传 true。包装只发生在 installMgStub 当时传入的节点与当前页上。
   */
  resetGeometryOnAppend?: boolean
}

export interface MgStub {
  getNodeById: (id: string) => any
  /** 仅当 opts.withRootApis === true 时注入（私有版 1.10.3 实测可用） */
  getRootNodeById?: (id: string) => any
  /** 仅当 opts.withRootApis === true 时注入（私有版 1.10.3 实测可用） */
  getRootParentLayerId?: (id: string) => string | null
  document: { currentPage: any; children: any[] }
  viewport: any
  notify: (message: string, options?: any) => void
  commitUndo: () => void
  /** 记录 notify 调用，便于断言提示文案 */
  notifications: string[]
}

export function installMgStub(opts: MgStubOptions = {}): MgStub {
  const nodes = opts.nodes ?? {}
  const notifications: string[] = []

  /** 包装容器的 appendChild：先调原实现，再模拟宿主重置子节点几何（x/y 归零） */
  const instrumentAppendChild = (container: any): void => {
    if (!container || typeof container.appendChild !== 'function' || container.__mgStubAppendPatched) return
    const original = container.appendChild.bind(container)
    container.appendChild = (child: any) => {
      const result = original(child)
      if (child && typeof child === 'object') {
        try { child.x = 0 } catch (_) { /* 无 x 的节点忽略 */ }
        try { child.y = 0 } catch (_) { /* 无 y 的节点忽略 */ }
      }
      return result
    }
    container.__mgStubAppendPatched = true
  }

  const page: any = {
    id: 'page:1',
    name: opts.pageName ?? 'Test Page',
    type: 'PAGE',
    children: [],
    selectAll() {
      page.selection = Object.values(nodes).filter((n: any) => n && !n.removed)
    },
    appendChild() {},
  }

  // selection 用访问器实现：便于模拟宿主"静默丢弃不可选节点"的行为
  let storedSelection: any[] = opts.selection ? [...opts.selection] : []
  Object.defineProperty(page, 'selection', {
    configurable: true,
    get: () => storedSelection,
    set: (next: any) => {
      const list = Array.isArray(next) ? next.slice() : []
      storedSelection = opts.filterSelectionToPage
        ? list.filter((n: any) => !n?.parent?.id || String(n.parent.id) === String(page.id))
        : list
    },
  })

  // document.currentPage 用访问器实现：`deferPageSwitch` 可模拟宿主「赋值后延迟生效」
  // （默认关闭，读写语义与旧桩完全一致，保持向后兼容）
  const documentStub: any = { children: [page] }
  let currentPageRef: any = page
  Object.defineProperty(documentStub, 'currentPage', {
    configurable: true,
    enumerable: true,
    get: () => currentPageRef,
    set: (next: any) => {
      // 模拟宿主异步排队：赋值丢进队列，这里不立即生效
      if (opts.deferPageSwitch) return
      currentPageRef = next
    },
  })

  const mg: MgStub = {
    getNodeById: (id: string) => nodes[id] ?? null,
    document: documentStub,
    viewport: {
      zoom: 1,
      center: { x: 0, y: 0 },
      bound: { x: 0, y: 0, width: 1000, height: 800 },
      positionOnDom: { x: 0, y: 0, width: 1000, height: 800 },
      scrollAndZoomIntoView: () => {},
    },
    notify: (message: string) => {
      notifications.push(message)
    },
    commitUndo: () => {},
    notifications,
  }

  // 根结构查询 API（默认不注入，避免影响既有用例）
  if (opts.withRootApis) {
    const rootNodeIdById = opts.rootNodeIdById ?? {}
    const rootParentLayerIdById = opts.rootParentLayerIdById ?? {}
    mg.getRootNodeById = (id: string) => {
      if (Object.prototype.hasOwnProperty.call(rootNodeIdById, id)) {
        const rootId = rootNodeIdById[id]
        return rootId == null ? null : (nodes[rootId] ?? null)
      }
      // 缺省回退：节点自身（最贴近「根」的保守近似）
      return nodes[id] ?? null
    }
    mg.getRootParentLayerId = (id: string) => {
      if (Object.prototype.hasOwnProperty.call(rootParentLayerIdById, id)) {
        return rootParentLayerIdById[id] ?? null
      }
      // 缺省回退：当前页 id（根节点直接挂在页面上时的父层）
      return page.id
    }
  }

  // 模拟宿主插入父层时重算子节点几何（默认关闭，保持旧行为）
  if (opts.resetGeometryOnAppend) {
    instrumentAppendChild(page)
    for (const node of Object.values(nodes)) instrumentAppendChild(node)
  }

  ;(globalThis as any).mg = mg
  return mg
}

export function resetMgStub(): void {
  delete (globalThis as any).mg
}
