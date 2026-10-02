/**
 * 设计令牌 + 绑定 + 传播（Penpot：`library.local.tokens`）
 *
 * 从 `penpot.ts` 拆出（内聚单元：令牌 CRUD 与「绑定 / 重绑定 / 重下发」本是同一条链 ——
 * 改令牌值**不会**自动回写已绑定的形状，`propagateToken` 才是让全稿联动闭环的那一半；
 * 两半分居不同文件会让这条因果关系断掉）。
 *
 * ⚠️ 行为契约（真机逐条验收钉下来的，**不要"顺手"改成看起来更干净的样子**）：
 *   - `readNodeTokens` 只读 `shape.tokens`，缺失即 `{}`，**不抛错**；
 *   - `applyToken` 有**幂等保护**（已绑定同一令牌 → 直接返回并给出 note，不重复下发 ——
 *     重复 `applyToken` 的语义是**解绑**）；下发后**有界轮询 5×20ms** 回读；
 *   - `resolvedValue` 保持 `resolvedValueString ?? resolvedValue` 双读；
 *   - `setTokenSetActive` 先比对目标态再 `toggleActive()`，**回读确认**，不改状态就不谎报 `changed`；
 *   - `propagateToken` 是**先解绑 → 等绑定真的消失（5×20ms）→ 再重绑**，并用 `fillsSnapshot`
 *     回读比对；`mechanism` 固定为 `unbind+rebind (Token.applyToShapes 是切换语义)`。
 *
 * 依赖方向单向：`PenpotHost` → 本模块。宿主**状态型**原语（`requireShape` / `allShapes`）
 * 通过 `TokenDeps` 传入，模块内**不反向摸 `PenpotHost`**；无状态原语
 * （`penpot.library.local.tokens`）直接调用 —— 本文件属于 Penpot 宿主适配层（README「约定（续）」R1'）。
 */
import { HostArgumentError, UnsupportedHostFeatureError } from './errors'
import type { HostNode, HostToken, HostTokenSet } from './types'

/** 本模块需要的**宿主状态型原语** */
export interface TokenDeps {
  /** HostNode → 宿主形状（PenpotHost 层两者是同一对象，只是端口不额外包装） */
  requireShape(node: HostNode, feature: string): PenpotShape
  /**
   * 本页所有形状（扁平）—— `propagateToken` 只能扫本页（Penpot 查不了别的页）。
   * 由宿主适配层负责：优先宿主 `page.findShapes()`，不可用时退回手写递归（见 `PenpotHost.allShapes`）。
   */
  allShapes(): PenpotShape[]
}

// ── 设计令牌（Penpot：library.local.tokens） ──

/**
 * 本文件库的令牌目录。
 * 不可用时抛 `UnsupportedHostFeatureError` —— **不返回假数据**：空列表会被误读成"文档里没有令牌"。
 */
function tokenCatalog(): PenpotTokenCatalog & { sets: PenpotTokenSet[]; addSet(input: { name: string; active?: boolean }): PenpotTokenSet } {
  // SAFETY: library.local.tokens 在 typings 的 PenpotLibrary 上声明为必填，但旧版宿主可能没有；按可缺失探测，缺则抛 UnsupportedHostFeatureError（不返回假数据）。
  const tokens = (penpot.library as unknown as { local?: { tokens?: unknown } })?.local?.tokens
  if (!tokens || typeof (tokens as { addSet?: unknown }).addSet !== 'function') {
    throw new UnsupportedHostFeatureError('tokens', '宿主未提供 library.local.tokens')
  }
  return tokens as PenpotTokenCatalog & { sets: PenpotTokenSet[]; addSet(input: { name: string }): PenpotTokenSet }
}

function toHostToken(token: PenpotToken): HostToken {
  return {
    id: token.id,
    name: token.name,
    hostType: String(token.type ?? ''),
    value: typeof token.value === 'string' ? token.value : undefined,
    description: typeof token.description === 'string' ? token.description : undefined,
    // 官方名是 `resolvedValueString`；旧宿主/旧 typings 用 `resolvedValue` —— 两者都读，读不到就不编
    resolvedValue: (() => {
      const raw = token.resolvedValueString ?? token.resolvedValue
      return typeof raw === 'string' ? raw : undefined
    })(),
  }
}

export async function listTokenSets(): Promise<HostTokenSet[]> {
  const catalog = tokenCatalog()
  const sets = Array.isArray(catalog.sets) ? catalog.sets : []
  return sets.map((set) => ({
    id: set.id,
    name: set.name,
    active: set.active !== false,
    tokens: (Array.isArray(set.tokens) ? set.tokens : []).map((token) => toHostToken(token)),
  }))
}

/** 找集合：按名字；`create` 为真时按需新建（缺省名 "Design Tokens"） */
function resolveTokenSet(name: string | undefined, create: boolean): PenpotTokenSet | null {
  const catalog = tokenCatalog()
  const sets = Array.isArray(catalog.sets) ? catalog.sets : []
  if (name) {
    const found = sets.find((set) => set.name === name)
    if (found) return found
    return create ? catalog.addSet({ name }) : null
  }
  if (sets.length) return sets[0]
  return create ? catalog.addSet({ name: 'Design Tokens' }) : null
}

function findTokenByName(name: string, setName?: string): { token: PenpotToken; set: PenpotTokenSet } | null {
  const sets = tokenCatalog().sets ?? []
  const candidates = setName ? sets.filter((set) => set.name === setName) : sets
  for (const set of candidates) {
    const found = (Array.isArray(set.tokens) ? set.tokens : []).find((token) => token.name === name)
    if (found) return { token: found, set }
  }
  return null
}

export async function createToken(input: {
  name: string
  type: string
  value: string
  setName?: string
  description?: string
}): Promise<{ token: HostToken; setId: string; setName: string; created: boolean }> {
  const set = resolveTokenSet(input.setName, true)
  if (!set) throw new HostArgumentError('createToken: 无法解析/创建令牌集合')

  // 已存在同名令牌 → 视为更新（幂等），而不是报错或产生重复
  const existing = (Array.isArray(set.tokens) ? set.tokens : []).find((token) => token.name === input.name)
  if (existing) {
    existing.value = input.value
    if (input.description !== undefined) existing.description = input.description
    return { token: toHostToken(existing), setId: set.id, setName: set.name, created: false }
  }

  const token = set.addToken({ type: input.type, name: input.name, value: input.value })
  if (input.description !== undefined) {
    try {
      token.description = input.description
    } catch {
      /* 描述不可写不影响创建 */
    }
  }
  return { token: toHostToken(token), setId: set.id, setName: set.name, created: true }
}

export async function updateToken(input: {
  name: string
  value?: string
  description?: string
  setName?: string
}): Promise<{ token: HostToken; updated: string[] }> {
  const found = findTokenByName(input.name, input.setName)
  if (!found) throw new HostArgumentError(`令牌不存在: ${input.name}`)

  const updated: string[] = []
  if (input.value !== undefined) {
    found.token.value = input.value
    updated.push('value')
  }
  if (input.description !== undefined) {
    try {
      found.token.description = input.description
      updated.push('description')
    } catch {
      /* 不可写时不谎报 updated */
    }
  }
  return { token: toHostToken(found.token), updated }
}

export async function deleteToken(input: { name: string; setName?: string }): Promise<{ deleted: string }> {
  const found = findTokenByName(input.name, input.setName)
  if (!found) throw new HostArgumentError(`令牌不存在: ${input.name}`)
  found.token.remove()
  return { deleted: input.name }
}

// ── 令牌绑定（Penpot 的真绑定能力；MasterGo 侧没有这条通道） ──
//
// 这几个方法原本挂在 `penpot.ts` 的类尾，理由是"文件中部插方法会把后面几十处历史
// `as unknown as` 的行号整体推移，在 delta 模式下会被当成本次新增的 SAFETY 缺口"。
// 拆簇后这条约束自然消解：令牌与绑定现在是同一文件的同一节，不再有"中部 / 尾部"之分。

/**
 * 读回节点已绑定的令牌。
 *
 * 官方 typing：`PenpotShapeBase.tokens?: Record<string, string>`（只读）。
 * 这是绑定校验的**唯一诚实依据** —— `applyToken()` 返回 void，调用不抛错 ≠ 绑上了。
 */
export function readNodeTokens(node: HostNode): Record<string, string> {
  // SAFETY: HostNode 在这一层就是宿主 shape 对象本身的窄化视图（requireShape 用的是同一条断言）；
  // 这里只读 shape.tokens，节点无效或不支持绑定时返回空对象，不抛错。
  // SAFETY: 与 requireShape 同口径——HostNode 在 PenpotHost 层就是宿主 shape 对象；readNodeTokens 只读 shape.tokens，无效节点返回空对象而不抛。
  const shape = node as unknown as PenpotShape | null | undefined
  const tokens = shape?.tokens
  if (!tokens || typeof tokens !== 'object') return {}
  return { ...(tokens as Record<string, string>) }
}

/**
 * 把令牌绑定到节点属性（Penpot 的**真绑定**能力，MasterGo 侧当前没有）。
 *
 * 用法：`shape.applyToken(token, ['fill'])`；绑完 `shape.tokens` 可反查；**直接改属性即解绑**
 * （声明见 `typings/penpot.d.ts` 的 `PenpotShapeBase.applyToken` / `PenpotShapeBase.tokens`）。
 *
 * 注意 `applyToken` 返回 void：是否真绑上只能靠 `readNodeTokens` 回读判断，
 * 因此这里把回读结果一并带出去，而不是乐观地回 `applied: true`。
 */
export async function applyToken(deps: TokenDeps,
  node: HostNode,
  tokenName: string,
  properties: readonly string[] = ['fill'],
): Promise<{ applied: boolean; tokenId?: string; properties: string[]; bound: Record<string, string>; note?: string }> {
  const shape = deps.requireShape(node, 'applyToken')
  const found = findTokenByName(tokenName)
  if (!found) {
    throw new HostArgumentError(`令牌不存在: ${tokenName}（先用 variable/list 确认名字；Penpot 令牌名区分大小写）`)
  }
  if (typeof shape.applyToken !== 'function') {
    throw new UnsupportedHostFeatureError('applyToken', '宿主未提供 shape.applyToken')
  }

  const props = properties.length > 0 ? [...properties] : ['fill']

  // 幂等保护（**真机实测的陷阱**）：对**已绑定同一令牌**的节点再调 `applyToken()` 会把它**解绑**
  // —— `shape.tokens` 变回 `{}`，而 fills 留下烤好的死值。所以必须先查再发，
  // 否则「重复跑一次统一绑定」会静默毁掉已有绑定（而响应还以为只是"宿主未接受"）。
  const existing = readNodeTokens(node)
  const boundValueFor = (prop: string): string | undefined => {
    const hit = Object.entries(existing).find(
      ([key]) => key === prop || key.toLowerCase().includes(prop.toLowerCase()),
    )
    return hit?.[1]
  }
  if (props.every((prop) => boundValueFor(prop) === found.token.name)) {
    return {
      applied: true,
      tokenId: found.token.id,
      properties: props,
      bound: existing,
      note: '已绑定同一令牌，跳过重复下发（重复 applyToken 会解绑）',
    }
  }

  shape.applyToken(found.token, props)

  // 回读校验（**要等一拍**）：官方把 `applyToken` 归在异步生效那一类 —— 调用返回 void，
  // 绑定落到 `shape.tokens` 上有一小段延迟。立即回读会读到空映射，把"绑定成功"
  // 误报成"宿主未接受"（v2.18.0 真机：立即回读 = {}，稍后 `node_get(fields:['tokens'])`
  // 可见 `{fill:'color.brand.primary'}`）。所以做**有界轮询**：判据仍是回读，
  // 但不因为抢跑而误报。
  let bound = readNodeTokens(node)
  for (let attempt = 0; attempt < 5 && Object.keys(bound).length === 0; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    bound = readNodeTokens(node)
  }

  const keys = Object.keys(bound)
  const accepted = props.filter(
    (prop) => keys.includes(prop) || keys.some((key) => key.toLowerCase().includes(prop.toLowerCase())),
  )

  return {
    applied: accepted.length > 0,
    tokenId: found.token.id,
    properties: props,
    bound,
    ...(accepted.length > 0
      ? {}
      : {
          note:
            `绑定已下发，但回读 shape.tokens 仍为空（属性名 ${props.join('/')}）：` +
            '可能该属性名不被此节点类型接受，也可能宿主尚未异步落地 —— 用 node_get（字段含 tokens）复查',
        }),
  }
}

/**
 * 令牌改名（Penpot：`token.name` 可写）。
 *
 * 与 `updateToken` 分开的理由见 `host/types.ts` 的声明注释：
 * `updateToken` 的第一个参数是**选择器**，而工具层的 `name` 是**新名字**，两者不共用一个字段名。
 */
export async function renameToken(input: {
  name: string
  newName: string
  setName?: string
}): Promise<{ token: HostToken; renamed: boolean }> {
  const found = findTokenByName(input.name, input.setName)
  if (!found) throw new HostArgumentError(`令牌不存在: ${input.name}`)
  const renamed = found.token.name !== input.newName
  if (renamed) {
    try {
      found.token.name = input.newName
    } catch (error) {
      // 不可写就抛，不静默假装改成功（改名失败会让后续按新名字的查找全断）
      throw new HostArgumentError(`令牌改名被宿主拒绝：${(error as Error).message}`)
    }
  }
  return { token: toHostToken(found.token), renamed }
}

/**
 * 激活/停用令牌集合：**没有这一步，绑定就不会驱动渲染**。
 *
 * 真机实测（Penpot 2.18.0）：令牌集合默认 `active: false`，此时
 * `shape.tokens` 已经有绑定引用，但改令牌值后 `fills` 仍是旧颜色。
 * 宿主的官方成员是 `TokenSet.toggleActive()`（翻转语义），所以这里先比对
 * 目标状态、再**回读**确认，不谎报成功。
 */
export async function setTokenSetActive(input: {
  setName?: string
  tokenName?: string
  active: boolean
}): Promise<{ changed: boolean; active: boolean; setName: string; note?: string }> {
  let set: PenpotTokenSet | null = null
  if (input.setName) {
    set = resolveTokenSet(input.setName, false)
    if (!set) throw new HostArgumentError(`令牌集合不存在: ${input.setName}`)
  } else if (input.tokenName) {
    const found = findTokenByName(input.tokenName)
    if (!found) throw new HostArgumentError(`令牌不存在: ${input.tokenName}`)
    set = found.set
  } else {
    throw new HostArgumentError('setTokenSetActive 需要 setName 或 tokenName')
  }

  const before = set.active === true
  if (before === input.active) return { changed: false, active: before, setName: set.name }

  if (typeof set.toggleActive !== 'function') {
    throw new UnsupportedHostFeatureError(
      'setTokenSetActive',
      '宿主未提供 TokenSet.toggleActive（本仓库 typings 是手写子集，需按 §7 纪律先探测）',
    )
  }

  set.toggleActive()
  const after = set.active === true
  return after === input.active
    ? { changed: true, active: after, setName: set.name }
    : {
        changed: false,
        active: after,
        setName: set.name,
        note: 'toggleActive() 已调用但回读未变成目标状态（宿主可能由主题驱动，需在 Penpot 令牌面板确认）',
      }
}

/**
 * 把令牌当前值重新下发到已绑定它的形状（官方 `Token.applyToShapes()`）。
 *
 * 为什么它是“改值联动”的必要一步，而不只是锦上添花：
 *   真机实测（Penpot 2.18.0）—— 集合已 active、`shape.tokens` 有引用，
 *   但 `variable_update({value})` 后 fills 不变、导出 PNG 像素仍是旧色；
 *   而在 Penpot 面板里手改同一个令牌会刷新画布。差别就是：**面板会重下发**。
 */
export async function propagateToken(deps: TokenDeps, input: {
  tokenName: string
  setName?: string
  properties?: readonly string[]
}): Promise<{ matched: number; rewritten: number; rebound: number; mechanism: string; note?: string }> {
  const found = findTokenByName(input.tokenName, input.setName)
  if (!found) throw new HostArgumentError(`令牌不存在: ${input.tokenName}`)
  const token = found.token
  if (typeof token.applyToShapes !== 'function') {
    throw new UnsupportedHostFeatureError('propagateToken', '宿主未提供 Token.applyToShapes')
  }

  // 收集本页「绑着这个令牌」的形状，并记下它们各自绑在哪些属性上（只对实际绑定过的属性下发）
  const wanted = input.properties && input.properties.length ? new Set(input.properties) : null
  const targets: { shape: PenpotShape; props: string[]; before: string }[] = []
  // 全页形状列表由宿主层给出：优先 `page.findShapes()`（一次 API 调用），否则退回手写递归。
  for (const current of deps.allShapes()) {
    // SAFETY: 全页扫描拿到的 PenpotShape 就是 HostNode 本身（与 scanFor/getPageRootNodes 同一口径），
    // 断言只用于端口类型转换，readNodeTokens 只读 shape.tokens。
    const bound = readNodeTokens(current as unknown as HostNode)
    const props = Object.entries(bound)
      .filter(([, name]) => name === input.tokenName)
      .map(([prop]) => prop)
      .filter((prop) => (wanted ? wanted.has(prop) : true))
    if (props.length > 0) {
      targets.push({ shape: current, props, before: fillsSnapshot(current) })
    }
  }

  if (targets.length === 0) {
    return {
      matched: 0,
      rewritten: 0,
      rebound: 0,
      mechanism: 'none',
      note: '本页没有形状绑定该令牌（绑定可能落在别的页面，而 Penpot 只能看当前页）',
    }
  }

  // 官方 `Token.applyToShapes()` / `shape.applyToken()` 的语义是**切换**：对**已绑定**的形状再下发
  // = **解绑**，而且**不会写入新值**（真机实测：`shape.tokens` 变回 `{}`、fills 仍是旧色）。
  // 所以要“把新值推下去”，必须**先解绑、再重绑** —— 重绑那一步才会把当前令牌值烤进 fills
  // （新建绑定就是这么写入的，与面板改值后刷新画布的效果一致）。
  const boundTo = (shape: PenpotShape): boolean => {
    // SAFETY: 页面树里的 PenpotShape 即 HostNode（与 scanFor 同一口径），readNodeTokens 只读 shape.tokens。
    const bound = readNodeTokens(shape as unknown as HostNode)
    return Object.values(bound).includes(input.tokenName)
  }

  for (const target of targets) target.shape.applyToken(token, target.props)

  // 等解绑落地：否则紧接着的重绑可能被合并成“对已绑定者再下发”= 又解一次
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (targets.every((target) => !boundTo(target.shape))) break
    await sleep(20)
  }

  for (const target of targets) target.shape.applyToken(token, target.props)

  // 有界轮询等回读变化（宿主异步落地）
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const changed = targets.some((target) => fillsSnapshot(target.shape) !== target.before)
    if (changed) break
    await sleep(20)
  }

  // 回读校验：两个事实分开报，不合并成一个乐观值
  const rewritten = targets.filter((target) => fillsSnapshot(target.shape) !== target.before).length
  const rebound = targets.filter((target) => boundTo(target.shape)).length
  return {
    matched: targets.length,
    rewritten,
    rebound,
    mechanism: 'unbind+rebind (Token.applyToShapes 是切换语义)',
    ...(rewritten === targets.length && rebound === targets.length
      ? {}
      : {
          note:
            `回读未完全生效（rewritten ${rewritten}/${targets.length}、rebound ${rebound}/${targets.length}）：` +
            '可能该属性在此形状类型上不生效，或宿主异步未落地 —— 用 node_get（字段含 tokens/fills）复查',
        }),
  }
}

/** 小睡：等宿主异步落地（令牌绑定/解绑都是异步生效的） */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * fills 快照，仅用于「传播是否真的改了东西」的回读比对。
 *
 * 特意不在这里解析颜色：比对的是前后差异，任何填充变化都算“重写了”。
 */
function fillsSnapshot(shape: PenpotShape): string {
  // SAFETY: typings 把 fills 声明在具体形状上，而这里的入参是 PenpotShape 联合；
  // 运行时所有可见形状都有 fills（无填充时为 []），取不到时按 null 处理（不编造）。
  const fills = (shape as unknown as { fills?: unknown }).fills
  try {
    return JSON.stringify(fills ?? null)
  } catch {
    return 'unserializable'
  }
}
