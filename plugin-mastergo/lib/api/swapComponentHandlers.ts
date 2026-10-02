/**
 * 换组件（替换实例主组件）处理器
 *
 * 对应插件方法 `node/swapComponent`、MCP 工具 `node_swap_component`，
 * 同时被 DSL 渲染链路复用（HTML `data-swap-node-id` → `DSLRenderer.swapExistingInstances` → `applyComponentSwap`）。
 *
 * 底层依赖官方插件 API：`InstanceNode.swapComponent(component: ComponentNode)`，
 * 官方 typings 注释为异步函数（返回 void，内部异步执行），因此这里调用后
 * 会主动校验 `instance.mainComponent` 是否已切换。
 *
 * 目标组件来源（按优先级）：
 * 1. `componentId` — 当前文档内已存在的 Component Master / ComponentSet
 * 2. `ukey`        — 团队组件库组件（importComponentByKeyAsync / importComponentSetByKeyAsync）
 * 3. `component`   — 组件名称：先在本文档内查找，找不到再按名称解析团队库（可配 library）
 *
 * 两种工作模式：
 * - **换主组件**：目标是 INSTANCE → `InstanceNode.swapComponent()`（保留可对应的覆写）
 * - **原位替换**：目标是 FRAME / RECTANGLE / TEXT 等非实例对象 → 在其父容器的原图层位置
 *   创建一个组件实例，继承位置/宽高/旋转，按图层名带过文字与可见性，然后删除原对象
 *   （`keepOriginal: true` 可保留原对象；COMPONENT / COMPONENT_SET 拒绝替换）
 *
 * 组件集（COMPONENT_SET）会自动落到 `variant` 指定的变体或第一个变体。
 */
import {
  resolveComponent,
  importComponentNode,
  isTeamLibrarySupported,
} from './teamLibraryHandlers'
import { rgbToHex } from '../utils/color-utils'
import { applyInstanceOverrides, type OverrideSkip } from './instance-overrides'

export interface SwapComponentParams {
  /** 单个实例节点 ID */
  nodeId?: string
  /** 批量实例节点 ID 列表 */
  nodeIds?: string[]
  /** 未传 nodeId/nodeIds 时是否回退到当前选区（默认 true） */
  useSelection?: boolean
  /** 目标：文档内组件 ID */
  componentId?: string
  /** 目标：团队库组件 ukey */
  ukey?: string
  /** 目标：组件名称（本地优先，其次团队库） */
  component?: string
  /** 目标：限定团队库（名称或 id），配合 component 使用 */
  library?: string
  /** 目标类型提示：COMPONENT / COMPONENT_SET */
  type?: 'COMPONENT' | 'COMPONENT_SET' | string
  /** 组件集变体名称片段（如 "Hover"、"Selected"） */
  variant?: string
  /** 替换后写入的变体属性，如 { "State": "Hover" } */
  variantProperties?: Record<string, string>
  /** 替换后写入的组件属性（键为组件属性 id），如 { "7242:674": "<组件ID>" } */
  properties?: Record<string, string | boolean>
  /** 替换后重置实例上的直接覆写（默认 false） */
  resetOverrides?: boolean
  /**
   * 是否在换主组件后由我们显式回写替换前的宽高。
   *
   * 实测（私有化企业版 MasterGoPrivate 1.10.3）：实例换主组件时客户端**本身就会保留实例尺寸**
   * —— 把实例调到 100×40 后再以 `keepSize:false` 换主组件，结果仍是 100×40，不会回落到新组件默认尺寸。
   * - `true`：由我们显式 resize 回替换前的宽高，用于跨尺寸替换时强制锁定；
   * - `false`（实例默认）：不额外干预，尺寸由客户端保留；
   * - 非实例对象原位替换为组件时默认 `true`（保持原布局占位）。
   */
  keepSize?: boolean
  /** 目标不是实例（如 frame/矩形/文本）时：true 则原位替换为组件实例并删除原对象，默认 false（即删除） */
  keepOriginal?: boolean
  /** 非实例对象替换时，是否按图层名继承原内容的文字/可见性（默认 true） */
  carryOverOverrides?: boolean
  /** 替换后的实例名称（默认沿用原对象名） */
  name?: string
  /**
   * 换组件后写入实例子节点的显式覆写（`{ 子图层名: { text|fill|visible: 值 } }`），
   * 语义与 DSL `InstanceElement.overrides` / `data-override-*` 完全一致。
   *
   * 优先级最高：与原位替换时按图层名**继承**来的覆写冲突时，显式值胜出
   * （调用方明确写了意图；`resetOverrides` 控制的是"是否重置实例已有的直接覆写"，是另一件事）。
   */
  overrides?: Record<string, Record<string, string>>
}

interface SwapTarget {
  component: any
  componentId: string
  componentName: string
  source: 'componentId' | 'local-name' | 'team-ukey' | 'team-name'
  ukey?: string
  library?: string
}

export interface SwapSummary {
  success: boolean
  summary: string
  target: {
    componentId: string
    componentName: string
    source: SwapTarget['source']
    ukey?: string
    library?: string
  }
  total: number
  swapped: number
  /** 非实例对象被原位替换为组件实例的数量 */
  replaced: number
  skipped: number
  failed: number
  results: SwapResult[]
  warnings?: string[]
  hint: string
}

export interface SwapResult {
  nodeId: string
  name: string
  success: boolean
  /** swap=实例换主组件；replace=非实例对象原位替换为组件实例 */
  mode?: 'swap' | 'replace'
  skipped?: boolean
  reason?: string
  error?: string
  verified?: boolean
  warning?: string
  mainComponentId?: string
  mainComponentName?: string
  width?: number
  height?: number
  /** replace 模式：原对象是否已删除 */
  removedOriginal?: boolean
  /** replace 模式：按图层名成功带过去的覆写属性 */
  carriedOverrides?: string[]
  /** 覆写未生效的属性级降级明细（找不到图层 / fill 非法 / 目标无填充 / 非 TEXT / 未知属性） */
  overrideSkips?: OverrideSkip[]
}

/** swapComponent 官方签名为 void，内部异步；校验主组件时的重试参数 */
const SWAP_VERIFY_ATTEMPTS = 5
const SWAP_VERIFY_DELAY_MS = 20

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 归一化名称用于模糊匹配 */
function normalizeKey(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** 收集待替换节点：显式 ID > 当前选区 */
function collectTargetNodes(params: SwapComponentParams): { nodes: any[]; missing: string[] } {
  const ids: string[] = []
  if (Array.isArray(params.nodeIds)) {
    for (const id of params.nodeIds) {
      if (id) ids.push(String(id))
    }
  }
  if (params.nodeId) ids.push(String(params.nodeId))

  const nodes: any[] = []
  const missing: string[] = []
  const seen = new Set<string>()

  for (const id of ids) {
    const node = mg.getNodeById(id)
    if (!node) {
      missing.push(id)
      continue
    }
    if (seen.has(node.id)) continue
    seen.add(node.id)
    nodes.push(node)
  }

  if (ids.length === 0 && params.useSelection !== false) {
    const selection = mg.document.currentPage.selection
    for (const node of selection) {
      if (seen.has(node.id)) continue
      seen.add(node.id)
      nodes.push(node)
    }
  }

  return { nodes, missing }
}

/** 从组件集里按 variant 名称挑一个变体组件 */
function pickVariantFromSet(set: any, variant?: string): any | null {
  const children: any[] = Array.isArray(set.children) ? Array.from(set.children) : []
  const components = children.filter((c: any) => c && c.type === 'COMPONENT')
  if (components.length === 0) return null

  const wanted = variant ? String(variant).toLowerCase() : ''
  if (!wanted) return components[0]

  return (
    components.find((c: any) => String(c.name || '').toLowerCase() === wanted) ||
    components.find((c: any) => String(c.name || '').toLowerCase().includes(wanted)) ||
    components.find((c: any) =>
      (c.variantProperties || []).some(
        (p: any) => String(p?.value || '').toLowerCase() === wanted,
      ),
    ) ||
    null
  )
}

/** 把任意节点收敛为可用的 ComponentNode（组件集自动降级到变体） */
function asComponentNode(node: any, variant: string | undefined, label: string): any {
  if (!node) throw new Error(`${label} 不存在`)
  if (node.type === 'COMPONENT') return node
  if (node.type === 'COMPONENT_SET') {
    const picked = pickVariantFromSet(node, variant)
    if (!picked) {
      const names = (Array.isArray(node.children) ? Array.from(node.children) : [])
        .filter((c: any) => c && c.type === 'COMPONENT')
        .map((c: any) => c.name)
        .join(', ')
      throw new Error(
        `组件集 "${node.name}" 中没有匹配 variant${variant ? ` "${variant}"` : ''} 的组件。` +
          (names ? `可用变体：${names}` : ''),
      )
    }
    return picked
  }
  throw new Error(
    `${label} 不是组件（type=${node.type}），无法作为换组件目标。` +
      '请先用 component_search 找到组件，或用 node_convert_to_component 转换为组件。',
  )
}

/** 在当前文档中按名称查找组件 / 组件集 */
function findLocalComponent(name: string): any | null {
  const wanted = normalizeKey(name)
  const candidates: any[] = []
  const pages = mg.document.children

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    const found = page.findAll(
      (node: any) => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET',
    ) as unknown as any[]
    for (let j = 0; j < found.length; j++) candidates.push(found[j])
  }

  if (candidates.length === 0) return null

  return (
    candidates.find((c) => String(c.name) === name) ||
    candidates.find((c) => !c.isExternal && normalizeKey(c.name) === wanted) ||
    candidates.find((c) => normalizeKey(c.name) === wanted) ||
    candidates.find((c) => !c.isExternal && normalizeKey(c.name).includes(wanted)) ||
    candidates.find((c) => normalizeKey(c.name).includes(wanted)) ||
    null
  )
}

/**
 * 可被“原位替换为组件实例”的节点类型。
 * 排除 COMPONENT / COMPONENT_SET（被引用中，替换会破坏实例）、PAGE、CONNECTOR / SLICE。
 */
const REPLACEABLE_TYPES = new Set([
  'FRAME',
  'GROUP',
  'RECTANGLE',
  'ELLIPSE',
  'TEXT',
  'POLYGON',
  'STAR',
  'LINE',
  'PEN',
  'VECTOR',
  'BOOLEAN_OPERATION',
])


/**
 * 从被替换对象的子树收集可继承的覆写（按图层名匹配）：
 * - TEXT 的文字内容与文字颜色
 * - 不可见图层
 */
function collectOverridesFromSubtree(node: any): Record<string, Record<string, string>> {
  const overrides: Record<string, Record<string, string>> = {}

  const walk = (current: any): void => {
    if (!current || !current.name) return
    const props: Record<string, string> = {}

    if (current.type === 'TEXT' && typeof current.characters === 'string' && current.characters) {
      props.text = current.characters
      const fills = current.fills
      if (Array.isArray(fills) && fills.length > 0 && fills[0]?.type === 'SOLID' && fills[0].color) {
        props.fill = rgbToHex(fills[0].color)
      }
    }
    if (current.isVisible === false) props.visible = 'false'

    if (Object.keys(props).length > 0 && !overrides[current.name]) {
      overrides[current.name] = props
    }

    const children: any[] = Array.isArray(current.children) ? Array.from(current.children) : []
    for (const child of children) walk(child)
  }

  walk(node)
  return overrides
}

interface ReplaceOutcome {
  instance: any
  removedOriginal: boolean
  carriedOverrides: string[]
  /** 按图层名从被替换子树继承覆写时的降级明细 */
  inheritedSkips: OverrideSkip[]
  /** 显式 `overrides` 参数应用时的降级明细 */
  explicitSkips: OverrideSkip[]
}

/**
 * 把非实例对象原位替换为组件实例：
 * 新建实例 → 插入到原对象在父容器中的同一位置 → 继承位置/宽高/旋转 → 按名称带过文字与可见性 → 删除原对象
 */
function replaceNodeWithInstance(
  node: any,
  component: any,
  opts: {
    keepOriginal?: boolean
    keepSize?: boolean
    carryOverrides?: boolean
    name?: string
    overrides?: Record<string, Record<string, string>> | null
  },
): ReplaceOutcome {
  const parent: any = node.parent
  const siblings: any[] = parent && Array.isArray(parent.children) ? Array.from(parent.children) : []
  const index = siblings.indexOf(node)

  const saved = {
    x: typeof node.x === 'number' ? node.x : 0,
    y: typeof node.y === 'number' ? node.y : 0,
    width: typeof node.width === 'number' ? node.width : 0,
    height: typeof node.height === 'number' ? node.height : 0,
    rotation: typeof node.rotation === 'number' ? node.rotation : 0,
  }

  const overrides = opts.carryOverrides !== false ? collectOverridesFromSubtree(node) : {}

  const instance = component.createInstance()
  instance.name = opts.name || node.name || component.name

  // 非实例对象默认保持原宽高（换掉后不该改变布局占位）
  if (opts.keepSize !== false && saved.width > 0 && saved.height > 0) {
    try {
      instance.resize(saved.width, saved.height)
    } catch (err) {
      console.warn('[Swap] resize 失败:', err)
    }
  }

  // 插入到原对象所属父容器的原位置（保持图层顺序与父容器不变）
  if (parent && typeof parent.insertChild === 'function' && index >= 0) {
    parent.insertChild(index, instance)
  } else if (parent && typeof parent.appendChild === 'function') {
    parent.appendChild(instance)
  } else {
    mg.document.currentPage.appendChild(instance)
  }

  // 定位在插入之后设置，避免被父容器布局重置
  try {
    instance.x = saved.x
    instance.y = saved.y
  } catch (err) {
    console.warn('[Swap] 设置位置失败（父容器可能为自动布局）:', err)
  }
  if (saved.rotation) {
    try {
      instance.rotation = saved.rotation
    } catch (err) {
      console.warn('[Swap] 设置旋转失败:', err)
    }
  }

  // 继承来的覆写先落，显式 overrides 后落 —— 同一 childName+prop 时显式值胜出（优先级最高）
  const inheritedSkips = applyInstanceOverrides(instance, overrides)
  const explicitSkips = applyInstanceOverrides(instance, opts.overrides)

  // 只有「至少有一个属性真正写成功」的图层才算带过去了（不再把 text 落到非 TEXT 当成带过）
  const failedProps = new Set(
    inheritedSkips.filter((s) => s.prop).map((s) => `${s.childName}.${s.prop}`),
  )
  const missedChildren = new Set(
    inheritedSkips.filter((s) => s.reason === 'target-not-found').map((s) => s.childName),
  )
  const carried = Object.keys(overrides)
    .filter((key) => {
      if (missedChildren.has(key)) return false
      return Object.keys(overrides[key] || {}).some((p) => !failedProps.has(`${key}.${p}`))
    })
    .map((key) => `${key}:${Object.keys(overrides[key] || {}).join('+')}`)

  let removedOriginal = false
  if (opts.keepOriginal !== true) {
    try {
      node.remove()
      removedOriginal = true
    } catch (err: any) {
      console.warn('[Swap] 删除原对象失败:', err?.message || err)
    }
  }

  return { instance, removedOriginal, carriedOverrides: carried, inheritedSkips, explicitSkips }
}

/** 解析目标组件：componentId → ukey → component 名称（本地 → 团队库） */
async function resolveSwapTarget(params: SwapComponentParams): Promise<SwapTarget> {
  if (params.componentId) {
    const node = mg.getNodeById(String(params.componentId))
    if (!node) throw new Error(`目标组件不存在: ${params.componentId}`)
    const component = asComponentNode(node, params.variant, `节点 "${(node as any).name}"`)
    return {
      component,
      componentId: component.id,
      componentName: component.name,
      source: 'componentId',
    }
  }

  if (params.ukey) {
    const { node: component } = await importComponentNode(String(params.ukey), {
      variant: params.variant,
      expectedType: params.type,
    })
    return {
      component,
      componentId: component.id,
      componentName: component.name,
      source: 'team-ukey',
      ukey: String(params.ukey),
    }
  }

  if (params.component) {
    const local = findLocalComponent(String(params.component))
    if (local) {
      const component = asComponentNode(local, params.variant, `本地组件 "${local.name}"`)
      return {
        component,
        componentId: component.id,
        componentName: component.name,
        source: 'local-name',
      }
    }

    if (!isTeamLibrarySupported()) {
      throw new Error(
        `当前文档中没有组件 "${params.component}"，且当前环境不支持团队组件库` +
          '（mg.getTeamLibraryAsync 不可用）。请改用 componentId，或升级 MasterGo 客户端。',
      )
    }

    const resolved = await resolveComponent({
      library: params.library,
      component: String(params.component),
      type: params.type,
    })
    const { node: component } = await importComponentNode(resolved.component.ukey, {
      variant: params.variant,
      expectedType: params.type || resolved.component.type,
    })
    return {
      component,
      componentId: component.id,
      componentName: component.name,
      source: 'team-name',
      ukey: resolved.component.ukey,
      library: resolved.libraryName || resolved.libraryId || undefined,
    }
  }

  throw new Error(
    '需要提供目标组件：componentId（文档内组件 ID）/ ukey（团队库组件）/ ' +
      'component（组件名称，本地优先、其次团队库，可配 library）',
  )
}

/** 调用 swapComponent（兼容同步返回 / 返回 Promise 两种实现） */
async function callSwapComponent(instance: any, component: any): Promise<void> {
  if (typeof instance.swapComponent !== 'function') {
    throw new Error(
      '当前环境不支持 InstanceNode.swapComponent()（换组件需较新的 MasterGo 客户端），' +
        '请升级 MasterGo 客户端 / 插件 API 版本后重试',
    )
  }
  const ret = instance.swapComponent(component)
  if (ret && typeof ret.then === 'function') {
    await ret
    return
  }
  // 官方签名为 void 但内部异步：让出事件循环，再由 while 循环校验 mainComponent
  await sleep(0)
}

/** 换组件并校验 mainComponent 是否已切到目标组件 */
async function swapAndVerify(
  instance: any,
  component: any,
): Promise<{ verified: boolean; mainComponentId: string; mainComponentName: string }> {
  await callSwapComponent(instance, component)

  for (let attempt = 0; attempt < SWAP_VERIFY_ATTEMPTS; attempt++) {
    const main = instance.mainComponent
    if (main && main.id === component.id) {
      return { verified: true, mainComponentId: main.id, mainComponentName: main.name }
    }
    await sleep(SWAP_VERIFY_DELAY_MS)
  }

  const main = instance.mainComponent
  return {
    verified: false,
    mainComponentId: main?.id || '',
    mainComponentName: main?.name || '',
  }
}

/**
 * 执行换组件（不做 commitUndo / notify，供渲染链路与 MCP 处理器共用）
 */
export async function applyComponentSwap(params: SwapComponentParams): Promise<SwapSummary> {
  const { nodes, missing } = collectTargetNodes(params)
  if (nodes.length === 0 && missing.length === 0) {
    throw new Error(
      '没有可替换的节点：请传 nodeId（单个）/ nodeIds（批量），或先在画布上选中对象（实例换主组件，其它对象原位替换为组件实例）。',
    )
  }

  const target = await resolveSwapTarget(params)

  const results: SwapResult[] = []
  const warnings: string[] = []
  let swapped = 0
  let replaced = 0
  let failed = 0
  let skipped = 0

  for (const id of missing) {
    failed++
    results.push({ nodeId: id, name: '', success: false, error: `节点不存在: ${id}` })
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]

    // 非实例对象：原位替换为组件实例（frame/矩形/文本…→ 组件）
    if (node && node.type !== 'INSTANCE') {
      if (!REPLACEABLE_TYPES.has(node.type)) {
        failed++
        results.push({
          nodeId: node.id,
          name: node.name,
          success: false,
          error:
            `节点类型 ${node.type} 不支持替换为组件实例。` +
            '可替换：FRAME / GROUP / RECTANGLE / ELLIPSE / TEXT / POLYGON / STAR / LINE / PEN / VECTOR / BOOLEAN_OPERATION；' +
            'COMPONENT / COMPONENT_SET 请直接修改其内容。',
        })
        continue
      }

      // 先固化原对象信息：替换成功后原节点会被 remove，之后任何属性访问都会报
      // “The node with id ... does not exist”
      const originalId = node.id
      const originalName = node.name
      const originalType = node.type
      const originalChildCount = Array.isArray(node.children) ? node.children.length : 0

      try {
        const outcome = replaceNodeWithInstance(node, target.component, {
          keepOriginal: params.keepOriginal,
          keepSize: params.keepSize,
          carryOverrides: params.carryOverOverrides,
          name: params.name,
          overrides: params.overrides,
        })
        replaced++

        // 覆写降级（继承 / 显式）逐条进 warnings —— MCP 工具与 DSL 渲染报告都读这里
        for (const skip of outcome.inheritedSkips) {
          warnings.push(`${originalName}: 继承覆写未完全生效 —— ${skip.message}`)
        }
        for (const skip of outcome.explicitSkips) {
          warnings.push(`${outcome.instance.name}: 显式覆写未生效 —— ${skip.message}`)
        }

        if (params.keepOriginal !== true && originalChildCount > 0) {
          warnings.push(
            `${originalName}: 原 ${originalType} 的 ${originalChildCount} 个子图层已随原对象删除` +
              (outcome.carriedOverrides.length > 0
                ? `（已按名称带过：${outcome.carriedOverrides.join(', ')}）`
                : '（没有同名子图层可继承内容）'),
          )
        }

        results.push({
          nodeId: outcome.instance.id,
          name: outcome.instance.name,
          success: true,
          mode: 'replace',
          removedOriginal: outcome.removedOriginal,
          carriedOverrides: outcome.carriedOverrides,
          ...(outcome.inheritedSkips.length + outcome.explicitSkips.length > 0
            ? { overrideSkips: [...outcome.inheritedSkips, ...outcome.explicitSkips] }
            : {}),
          mainComponentId: target.component.id,
          mainComponentName: target.component.name,
          width: outcome.instance.width,
          height: outcome.instance.height,
        })
      } catch (err: any) {
        failed++
        results.push({
          nodeId: originalId,
          name: originalName,
          success: false,
          mode: 'replace',
          error: err?.message || String(err),
        })
      }
      continue
    }

    if (!node) {
      failed++
      results.push({ nodeId: '', name: '', success: false, error: '节点不存在' })
      continue
    }

    const hasExplicitOverrides = !!(params.overrides && Object.keys(params.overrides).length > 0)
    const alreadySame =
      node.mainComponent &&
      node.mainComponent.id === target.component.id &&
      !params.resetOverrides &&
      !params.variantProperties &&
      !params.properties &&
      // 显式覆写必须落地：即便主组件已相同也不能当"无事发生"跳过，否则覆写被静默丢弃
      !hasExplicitOverrides

    if (alreadySame) {
      skipped++
      results.push({
        nodeId: node.id,
        name: node.name,
        success: true,
        skipped: true,
        reason: 'already-same-component',
        mainComponentId: node.mainComponent?.id,
        mainComponentName: node.mainComponent?.name,
      })
      continue
    }

    const savedWidth = node.width
    const savedHeight = node.height

    try {
      const { verified, mainComponentId, mainComponentName } = await swapAndVerify(
        node,
        target.component,
      )

      if (params.variantProperties && typeof node.setVariantPropertyValues === 'function') {
        node.setVariantPropertyValues(params.variantProperties)
      }
      if (params.resetOverrides && typeof node.resetOverrides === 'function') {
        node.resetOverrides()
      }
      if (params.properties && typeof node.setProperties === 'function') {
        node.setProperties(params.properties)
      }
      if (params.keepSize && typeof node.resize === 'function') {
        node.resize(savedWidth, savedHeight)
      }

      // 显式覆写最后落：优先级最高。放在 resetOverrides 之后，
      // 因此「重置直接覆写」不会把调用方刚写下的显式值一起抹掉（两件事）。
      const overrideSkips = applyInstanceOverrides(node, params.overrides)
      for (const skip of overrideSkips) {
        warnings.push(`${node.name}: 显式覆写未生效 —— ${skip.message}`)
      }

      // 上面写入变体属性/组件属性后主组件可能随之变化，以最终态为准回报
      const mainAfter = node.mainComponent
      const finalMainId = mainAfter?.id || mainComponentId || ''
      const finalMainName = mainAfter?.name || mainComponentName || ''

      swapped++
      const warning = verified
        ? undefined
        : `已调用 swapComponent，但 mainComponent 仍为 "${finalMainName || finalMainId || '未知'}"，请人工确认画布结果`
      if (warning) warnings.push(`${node.name}: ${warning}`)

      results.push({
        nodeId: node.id,
        name: node.name,
        success: true,
        mode: 'swap',
        verified,
        warning,
        mainComponentId: finalMainId,
        mainComponentName: finalMainName,
        width: node.width,
        height: node.height,
        ...(overrideSkips.length > 0 ? { overrideSkips } : {}),
      })
    } catch (err: any) {
      failed++
      results.push({
        nodeId: node.id,
        name: node.name,
        success: false,
        mode: 'swap',
        error: err?.message || String(err),
      })
    }
  }

  const parts = [
    swapped ? `${swapped} 个换主组件` : '',
    replaced ? `${replaced} 个原位替换为组件实例` : '',
    skipped ? `${skipped} 个已相同跳过` : '',
    failed ? `${failed} 个失败` : '',
  ].filter(Boolean)
  const summary = `换组件 → ${target.componentName}：${parts.join('，')}`

  return {
    success: failed === 0,
    summary,
    target: {
      componentId: target.componentId,
      componentName: target.componentName,
      source: target.source,
      ...(target.ukey ? { ukey: target.ukey } : {}),
      ...(target.library ? { library: target.library } : {}),
    },
    total: nodes.length + missing.length,
    swapped,
    replaced,
    skipped,
    failed,
    results,
    ...(warnings.length ? { warnings } : {}),
    hint:
      replaced > 0
        ? '非实例对象已原位替换为组件实例（保持父容器与图层顺序）；用 keepOriginal:true 可保留原对象，carryOverOverrides:false 可关闭按名称继承文字。'
        : target.source === 'local-name' || target.source === 'componentId'
          ? '目标组件为文档内组件；如需团队库组件，请传 ukey 或用 team_component_search 拿 ukey。'
          : '团队组件已导入当前文档（保留 Component Master），实例已切换到该组件。',
  }
}

/**
 * 换组件主处理器（MCP 工具 `node_swap_component` / 插件方法 `node/swapComponent`）
 *
 * 与 `applyComponentSwap` 的区别：全部失败时抛错（MCP 侧需要硬错误），
 * 并且在结束后统一 commitUndo + 通知用户。
 */
export async function handleSwapComponent(params: SwapComponentParams): Promise<SwapSummary> {
  const summary = await applyComponentSwap(params)

  if (summary.swapped === 0 && summary.replaced === 0 && summary.skipped === 0 && summary.failed > 0) {
    throw new Error(
      `换组件失败，没有对象被替换：${summary.results
        .slice(0, 5)
        .map((r) => r.error)
        .filter(Boolean)
        .join('; ')}`,
    )
  }

  mg.commitUndo()
  mg.notify(summary.summary, { type: summary.failed > 0 ? 'warning' : 'normal' })

  return summary
}
