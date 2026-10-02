import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installMgStub, resetMgStub } from './helpers/mg-stub'
import { variableHandlers, isVariableApiSupported } from '../lib/api/variableHandlers'

/**
 * 变量系统（Design Token）处理器测试
 *
 * 用 `mg` 全局桩 + 内存版 `mg.variables` 假宿主，覆盖：
 * - `variable/list`：集合/模式/变量归一化（单值 mode 取标量、多值 mode 原样数组）、
 *   includeValues:false 省略 values、type 客户端兜底过滤、mg.variables 缺失时 available:false 不抛错
 * - `variable/create`：无集合时自动建 "Design Tokens"、写初始值到第一个 mode
 * - `variable/update`：只调与传入字段对应的宿主方法（spy 断言未传字段的方法没被调用）
 * - `variable/delete`：批量部分失败逐个回报
 */

// ─── 内存版 mg.variables ─────────────────────────────

interface FakeVariable {
  id: string
  name: string
  type: string
  description: string
  alias: string
  collectionId: string
  isExternal: boolean
  supportScope: boolean
  codeSyntax?: any
  scopes?: string[]
  /** modeId → 值数组（与宿主 Variable.modes 一致） */
  modes: Record<string, any[]>
}

interface FakeVariables {
  api: any
  calls: Record<string, number>
  collections: any[]
  variables: FakeVariable[]
  opts: { ignoreTypeFilter: boolean }
}

function createFakeVariables(): FakeVariables {
  const collections: any[] = []
  const variables: FakeVariable[] = []
  const calls: Record<string, number> = {}
  const opts = { ignoreTypeFilter: false }
  let seq = 0

  const log = (name: string) => {
    calls[name] = (calls[name] || 0) + 1
  }
  /** 返回快照，避免测试直接改到「宿主内部数据」 */
  const snapshot = (v: FakeVariable) => ({
    ...v,
    modes: Object.fromEntries(Object.entries(v.modes).map(([k, arr]) => [k, [...arr]])),
  })
  const mustFind = (id: string): FakeVariable => {
    const v = variables.find((x) => x.id === id)
    if (!v) throw new Error(`变量不存在: ${id}`)
    return v
  }

  const api: any = {
    async createCollection(name = 'Collection') {
      log('createCollection')
      seq += 1
      const col: any = { id: `col:${seq}`, name, isExternal: false, modes: [] }
      col.modes.push({ id: `mode:${seq}-1`, name: 'Mode 1', collectionId: col.id })
      collections.push(col)
      return col
    },
    getCollections(includeExternal = false) {
      log('getCollections')
      return collections.filter((c) => includeExternal || !c.isExternal)
    },
    getCollectionById(id: string) {
      log('getCollectionById')
      return collections.find((c) => c.id === id) ?? null
    },
    getModes(collectionId?: string) {
      log('getModes')
      const col = collections.find((c) => c.id === collectionId)
      return col ? col.modes : collections.flatMap((c) => c.modes)
    },
    getVariables(options: any = {}) {
      log('getVariables')
      return variables
        .filter((v) => !options.collectionId || v.collectionId === options.collectionId)
        .filter((v) => opts.ignoreTypeFilter || !options.type || v.type === options.type)
        .filter((v) => !options.groupPath || v.name.startsWith(`${options.groupPath}/`))
        .map(snapshot)
    },
    getVariableById(id: string) {
      log('getVariableById')
      const v = variables.find((x) => x.id === id)
      return v ? snapshot(v) : null
    },
    async createVariable(o: any) {
      log('createVariable')
      seq += 1
      const v: FakeVariable = {
        id: `var:${seq}`,
        name: o.name,
        type: o.type,
        description: o.description ?? '',
        alias: '',
        collectionId: o.collectionId ?? '',
        isExternal: false,
        supportScope: false,
        modes: {},
      }
      variables.push(v)
      return snapshot(v)
    },
    async setVariableValue({ id, value, modeId }: any) {
      log('setVariableValue')
      const v = mustFind(id)
      v.modes[modeId] = [value]
      return snapshot(v)
    },
    renameVariable(id: string, name: string) {
      log('renameVariable')
      mustFind(id).name = name
    },
    async setVariableDescription(id: string, value: string) {
      log('setVariableDescription')
      const v = mustFind(id)
      v.description = value
      return snapshot(v)
    },
    async setCodeSyntax(id: string, codeSyntax: any) {
      log('setCodeSyntax')
      const v = mustFind(id)
      v.codeSyntax = codeSyntax
      return snapshot(v)
    },
    async setVariableScopes(id: string, scopes: string[]) {
      log('setVariableScopes')
      const v = mustFind(id)
      v.scopes = scopes
      return snapshot(v)
    },
    async setVariableAlias(id: string, value: string) {
      log('setVariableAlias')
      const v = mustFind(id)
      v.alias = value
      return snapshot(v)
    },
    deleteVariable(id: string) {
      log('deleteVariable')
      const index = variables.findIndex((x) => x.id === id)
      if (index < 0) throw new Error(`变量不存在: ${id}`)
      variables.splice(index, 1)
    },
    deleteCollection(collectionId: string) {
      log('deleteCollection')
      const index = collections.findIndex((c: any) => c.id === collectionId)
      if (index < 0) throw new Error(`集合不存在: ${collectionId}`)
      collections.splice(index, 1)
      // MasterGo 语义：集合内的变量一并删除
      for (let i = variables.length - 1; i >= 0; i--) {
        if (variables[i].collectionId === collectionId) variables.splice(i, 1)
      }
    },
    /** 测试种子：直接注入集合 */
    __seedCollection(col: any) {
      collections.push(col)
      return col
    },
    /** 测试种子：直接注入变量 */
    __seedVariable(v: FakeVariable) {
      variables.push(v)
      return v
    },
  }

  return { api, calls, collections, variables, opts }
}

// ─── 夹具 ────────────────────────────────────────────

let mg: any
let fake: FakeVariables

/** 调用处理器（与 dispatcher 的签名一致） */
const call = (method: string, params: any = {}) => {
  const handler = variableHandlers[method]
  if (!handler) throw new Error(`未注册的方法: ${method}`)
  return handler(params, { document: mg.document, notify: mg.notify })
}

const RGBA = (r: number, g: number, b: number, a = 1) => ({ r, g, b, a })

/** 种一个带两个模式的集合 + 一个变量 */
function seedPalette() {
  fake.api.__seedCollection({
    id: 'col-seed-1',
    name: 'Palette',
    isExternal: false,
    modes: [
      { id: 'mode-seed-1-light', name: 'Light', collectionId: 'col-seed-1' },
      { id: 'mode-seed-1-dark', name: 'Dark', collectionId: 'col-seed-1' },
    ],
  })
  fake.api.__seedVariable({
    id: 'var-seed-1',
    name: 'color/brand/primary',
    type: 'COLOR',
    description: '品牌主色',
    alias: '',
    collectionId: 'col-seed-1',
    isExternal: false,
    supportScope: true,
    scopes: ['fill', 'stroke'],
    modes: {
      'mode-seed-1-light': [RGBA(0, 0.5, 1)],
      'mode-seed-1-dark': [RGBA(0, 0.5, 1), RGBA(0, 0, 0, 0.5)],
    },
  })
}

beforeEach(() => {
  mg = installMgStub()
  fake = createFakeVariables()
  mg.variables = fake.api
})

afterEach(() => resetMgStub())

// ─── variable/list ───────────────────────────────────

describe('variable/list', () => {
  it('规范化集合 / 模式 / 变量：单值 mode 取标量、多值 mode 原样数组', async () => {
    seedPalette()
    fake.api.__seedVariable({
      id: 'var-seed-2',
      name: 'space/md',
      type: 'NUMBER',
      description: '',
      alias: 'Space/MD',
      collectionId: 'col-seed-1',
      isExternal: false,
      supportScope: false,
      modes: { 'mode-seed-1-light': [8] },
    })
    // 空集合（零变量）也必须优雅返回
    fake.api.__seedCollection({
      id: 'col-seed-2',
      name: 'Empty',
      isExternal: false,
      modes: [{ id: 'mode-seed-2-1', name: 'Mode 1', collectionId: 'col-seed-2' }],
    })

    const out = await call('variable/list')

    expect(out.available).toBe(true)
    expect(out.stats).toEqual({ collections: 2, variables: 2 })
    expect(out.warnings).toBeUndefined()

    const [palette, empty] = out.collections
    expect(palette).toMatchObject({ id: 'col-seed-1', name: 'Palette', isExternal: false, variableCount: 2 })
    expect(palette.modes).toEqual([
      { id: 'mode-seed-1-light', name: 'Light' },
      { id: 'mode-seed-1-dark', name: 'Dark' },
    ])
    expect(empty).toMatchObject({ id: 'col-seed-2', variableCount: 0, variables: [] })

    const color = palette.variables[0]
    expect(color).toMatchObject({
      id: 'var-seed-1',
      name: 'color/brand/primary',
      type: 'COLOR',
      description: '品牌主色',
      alias: '',
      isExternal: false,
      supportScope: true,
      scopes: ['fill', 'stroke'],
    })
    // 单值 mode → 标量
    expect(color.values['mode-seed-1-light']).toEqual(RGBA(0, 0.5, 1))
    // 多值 mode → 原样数组
    expect(color.values['mode-seed-1-dark']).toHaveLength(2)
    expect(color.values['mode-seed-1-dark'][1]).toEqual(RGBA(0, 0, 0, 0.5))

    const space = palette.variables[1]
    expect(space).toMatchObject({ type: 'NUMBER', alias: 'Space/MD' })
    expect(space.values['mode-seed-1-light']).toBe(8)
  })

  it('includeValues:false 时省略 values 字段', async () => {
    seedPalette()
    const out = await call('variable/list', { includeValues: false })
    const variable = out.collections[0].variables[0]
    expect(variable).not.toHaveProperty('values')
    expect(variable.name).toBe('color/brand/primary')
  })

  it('collectionId / groupPath 过滤', async () => {
    seedPalette()
    fake.api.__seedVariable({
      id: 'var-seed-3',
      name: 'radius/sm',
      type: 'NUMBER',
      description: '',
      alias: '',
      collectionId: 'col-seed-1',
      isExternal: false,
      supportScope: false,
      modes: { 'mode-seed-1-light': [4] },
    })

    const byCollection = await call('variable/list', { collectionId: 'col-seed-1' })
    expect(byCollection.collections.map((c: any) => c.id)).toEqual(['col-seed-1'])

    const byGroup = await call('variable/list', { groupPath: 'color' })
    expect(byGroup.collections[0].variables.map((v: any) => v.name)).toEqual(['color/brand/primary'])

    const missing = await call('variable/list', { collectionId: 'nope' })
    expect(missing.collections).toEqual([])
    expect(missing.warnings?.join()).toContain('未找到变量集合')
  })

  it('type 过滤在客户端兜底（宿主不过滤时仍然只返回目标类型）', async () => {
    seedPalette()
    fake.opts.ignoreTypeFilter = true

    const out = await call('variable/list', { type: 'NUMBER' })
    expect(out.stats.variables).toBe(0)
    expect(out.collections[0].variables).toEqual([])

    const colors = await call('variable/list', { type: 'COLOR' })
    expect(colors.collections[0].variables.map((v: any) => v.id)).toEqual(['var-seed-1'])
  })

  it('includeExternal:false（默认）时不返回外部集合', async () => {
    seedPalette()
    fake.api.__seedCollection({
      id: 'col-ext',
      name: 'External',
      isExternal: true,
      modes: [{ id: 'mode-ext-1', name: 'Mode 1', collectionId: 'col-ext' }],
    })

    expect((await call('variable/list')).collections.map((c: any) => c.id)).toEqual(['col-seed-1'])
    expect((await call('variable/list', { includeExternal: true })).collections.map((c: any) => c.id)).toEqual([
      'col-seed-1',
      'col-ext',
    ])
  })

  it('mg.variables 缺失时返回 available:false 且不抛错', async () => {
    delete mg.variables
    expect(isVariableApiSupported()).toBe(false)

    const out = await call('variable/list')
    expect(out).toEqual({
      available: false,
      collections: [],
      stats: { collections: 0, variables: 0 },
      reason: '当前客户端不支持变量 API (mg.variables)',
    })
  })

  it('宿主 getVariables 抛错时收集 warning 而不是崩', async () => {
    seedPalette()
    fake.api.getVariables = () => {
      throw new Error('boom')
    }
    const out = await call('variable/list')
    expect(out.available).toBe(true)
    expect(out.collections[0].variableCount).toBe(0)
    expect(out.warnings?.join()).toContain('boom')
  })
})

// ─── variable/create ─────────────────────────────────

describe('variable/create', () => {
  it('无集合时自动创建 "Design Tokens" 并把初始值写入第一个 mode', async () => {
    const out = await call('variable/create', {
      name: 'color/brand',
      type: 'COLOR',
      value: RGBA(0, 0.5, 1),
    })

    expect(out.success).toBe(true)
    expect(fake.calls.createCollection).toBe(1)
    expect(fake.collections[0].name).toBe('Design Tokens')
    expect(out.createdCollectionId).toBe(fake.collections[0].id)
    expect(out.warnings).toBeUndefined()

    const modeId = fake.collections[0].modes[0].id
    expect(out.variable).toMatchObject({ name: 'color/brand', type: 'COLOR' })
    expect(out.variable.values[modeId]).toEqual(RGBA(0, 0.5, 1))
    expect(fake.calls.setVariableValue).toBe(1)
  })

  it('已有集合时复用第一个集合，不新建集合、不传 createdCollectionId', async () => {
    seedPalette()
    const out = await call('variable/create', { name: 'space/md', type: 'NUMBER', value: 8 })

    expect(fake.calls.createCollection).toBeUndefined()
    expect(fake.variables[1]).toMatchObject({ name: 'space/md', collectionId: 'col-seed-1' })
    expect(out.createdCollectionId).toBeUndefined()
    expect(out.variable.values['mode-seed-1-light']).toBe(8)
  })

  it('不传 value 时只创建变量，不调用 setVariableValue', async () => {
    seedPalette()
    const out = await call('variable/create', {
      name: 'flag/on',
      type: 'BOOLEAN',
      collectionId: 'col-seed-1',
      description: '开关',
    })

    expect(out.success).toBe(true)
    expect(fake.calls.setVariableValue).toBeUndefined()
    expect(out.variable).toMatchObject({ type: 'BOOLEAN', description: '开关' })
  })

  it('缺 name / type 抛参数错误', async () => {
    await expect(call('variable/create', { type: 'COLOR' })).rejects.toThrow(/name/)
    await expect(call('variable/create', { name: 'x' })).rejects.toThrow(/type/)
  })

  it('mg.variables 缺失时写操作明确报错', async () => {
    delete mg.variables
    await expect(call('variable/create', { name: 'x', type: 'COLOR' })).rejects.toThrow(/mg\.variables/)
  })
})

// ─── variable/update ─────────────────────────────────

describe('variable/update', () => {
  it('只调用与传入字段对应的宿主方法（未传字段的方法不被调用）', async () => {
    seedPalette()
    const out = await call('variable/update', {
      id: 'var-seed-1',
      name: 'color/brand/core',
      description: '主色（改名）',
    })

    expect(out.applied).toEqual(['name', 'description'])
    expect(out.variable).toMatchObject({ name: 'color/brand/core', description: '主色（改名）' })
    expect(fake.calls.renameVariable).toBe(1)
    expect(fake.calls.setVariableDescription).toBe(1)
    expect(fake.calls.setVariableValue).toBeUndefined()
    expect(fake.calls.setCodeSyntax).toBeUndefined()
    expect(fake.calls.setVariableScopes).toBeUndefined()
    expect(fake.calls.setVariableAlias).toBeUndefined()
  })

  it('改 value 且不传 modeId 时用所属集合的第一个 mode', async () => {
    seedPalette()
    const out = await call('variable/update', { id: 'var-seed-1', value: RGBA(1, 0, 0) })

    expect(out.applied).toEqual(['value'])
    expect(fake.variables[0].modes['mode-seed-1-light']).toEqual([RGBA(1, 0, 0)])
    // 其它模式不受影响
    expect(fake.variables[0].modes['mode-seed-1-dark']).toHaveLength(2)
  })

  it('传 modeId 时写入指定模式', async () => {
    seedPalette()
    const out = await call('variable/update', {
      id: 'var-seed-1',
      value: RGBA(0, 0, 0),
      modeId: 'mode-seed-1-dark',
    })
    expect(out.applied).toEqual(['value'])
    expect(fake.variables[0].modes['mode-seed-1-dark']).toEqual([RGBA(0, 0, 0)])
  })

  it('codeSyntax / scopes / alias 各自只调对应方法', async () => {
    seedPalette()
    const out = await call('variable/update', {
      id: 'var-seed-1',
      codeSyntax: { web: 'var(--brand-primary)' },
      scopes: ['fill'],
      alias: 'Brand/Primary',
    })

    expect(out.applied).toEqual(['codeSyntax', 'scopes', 'alias'])
    expect(fake.calls.setCodeSyntax).toBe(1)
    expect(fake.calls.setVariableScopes).toBe(1)
    expect(fake.calls.setVariableAlias).toBe(1)
    expect(fake.calls.renameVariable).toBeUndefined()
    expect(fake.calls.setVariableDescription).toBeUndefined()
    expect(fake.calls.setVariableValue).toBeUndefined()
    expect(out.variable).toMatchObject({ alias: 'Brand/Primary', scopes: ['fill'] })
    expect(out.variable.codeSyntax).toEqual({ web: 'var(--brand-primary)' })
  })

  it('宿主缺少某方法时进 warnings，不中断其它字段', async () => {
    seedPalette()
    delete fake.api.setCodeSyntax

    const out = await call('variable/update', {
      id: 'var-seed-1',
      name: 'color/brand/core',
      codeSyntax: { web: 'var(--x)' },
    })

    expect(out.applied).toEqual(['name'])
    expect(out.variable.name).toBe('color/brand/core')
    expect(out.warnings?.join()).toContain('setCodeSyntax')
  })

  it('未传任何可写字段 / 缺 id 时抛参数错误', async () => {
    seedPalette()
    await expect(call('variable/update', { id: 'var-seed-1' })).rejects.toThrow(/可更新字段/)
    await expect(call('variable/update', { name: 'x' })).rejects.toThrow(/id/)
  })

  it('变量不存在时单步失败进 warnings，不抛错', async () => {
    seedPalette()
    const out = await call('variable/update', { id: 'var-nope', name: 'x' })
    expect(out.applied).toEqual([])
    expect(out.variable).toEqual({ id: 'var-nope' })
    expect(out.warnings?.join()).toContain('变量不存在')
  })
})

// ─── variable/delete ─────────────────────────────────

describe('variable/delete', () => {
  it('批量中部分失败：success=false，逐个回报 deleted / failed', async () => {
    seedPalette()
    fake.api.__seedVariable({
      id: 'var-seed-2',
      name: 'space/md',
      type: 'NUMBER',
      description: '',
      alias: '',
      collectionId: 'col-seed-1',
      isExternal: false,
      supportScope: false,
      modes: {},
    })

    const out = await call('variable/delete', { ids: ['var-seed-1', 'nope', 'var-seed-2'] })

    expect(out.success).toBe(false)
    expect(out.deleted).toEqual(['var-seed-1', 'var-seed-2'])
    expect(out.failed).toHaveLength(1)
    expect(out.failed[0].id).toBe('nope')
    expect(out.failed[0].error).toContain('变量不存在')
    expect(fake.variables).toHaveLength(0)
  })

  it('全部成功时 success=true；单个 id 也可用', async () => {
    seedPalette()
    const out = await call('variable/delete', { id: 'var-seed-1' })
    expect(out).toEqual({ success: true, deleted: ['var-seed-1'], failed: [] })
  })

  it('id 与 ids 合并去重', async () => {
    seedPalette()
    const out = await call('variable/delete', { id: 'var-seed-1', ids: ['var-seed-1', 'var-seed-1'] })
    expect(out.deleted).toEqual(['var-seed-1'])
    expect(fake.calls.deleteVariable).toBe(1)
  })

  it('宿主缺少 deleteVariable 时逐个回报失败，不抛错', async () => {
    seedPalette()
    delete fake.api.deleteVariable
    const out = await call('variable/delete', { ids: ['var-seed-1'] })
    expect(out.success).toBe(false)
    expect(out.failed[0].error).toContain('deleteVariable')
  })

  it('未提供 id / ids 时抛参数错误', async () => {
    await expect(call('variable/delete', {})).rejects.toThrow(/id/)
  })

  it('按 collectionId 删集合，并连集合内变量一起删除', async () => {
    seedPalette()
    const out = await call('variable/delete', { collectionId: 'col-seed-1' })
    expect(out.success).toBe(true)
    expect(out.deletedCollections).toEqual(['col-seed-1'])
    expect(fake.collections.find((c: any) => c.id === 'col-seed-1')).toBeUndefined()
    expect(fake.variables.filter((v) => v.collectionId === 'col-seed-1')).toHaveLength(0)
    expect(fake.calls.deleteCollection).toBe(1)
  })

  it('集合与变量可同批删除，失败的逐个回报', async () => {
    seedPalette()
    const out = await call('variable/delete', {
      collectionIds: ['col-nope'],
      ids: ['var-seed-1'],
    })
    expect(out.success).toBe(false)
    expect(out.deleted).toEqual(['var-seed-1'])
    expect(out.failed.some((f: any) => f.id === 'col-nope')).toBe(true)
  })

  it('宿主缺少 deleteCollection 时回报失败，不抛错', async () => {
    seedPalette()
    delete fake.api.deleteCollection
    const out = await call('variable/delete', { collectionId: 'col-seed-1' })
    expect(out.success).toBe(false)
    expect(out.failed[0].error).toContain('deleteCollection')
  })
})

// ─── 写值回读滞后（宿主异步生效）────────────────────

describe('写值后的回读复核', () => {
  /** 模拟「写已生效但第一次回读给旧值」（实测私有版行为） */
  function makeReadLagOnce() {
    const api = fake.api as any
    const realGet = api.getVariableById.bind(api)
    const realSet = api.setVariableValue.bind(api)
    let staleSnapshot: any = null
    let servedStale = false

    api.setVariableValue = async (args: any) => {
      staleSnapshot = JSON.parse(JSON.stringify(realGet(args.id)))
      return realSet(args)
    }
    api.getVariableById = (id: string) => {
      if (staleSnapshot && !servedStale) {
        servedStale = true
        const snap = staleSnapshot
        staleSnapshot = null
        return snap
      }
      return realGet(id)
    }
  }

  it('滞后一拍时等到新值再返回，不留告警', async () => {
    seedPalette()
    makeReadLagOnce()

    const out = await call('variable/update', {
      id: 'var-seed-1',
      value: RGBA(1, 0, 0),
      modeId: 'mode-seed-1-light',
    })

    expect(out.applied).toContain('value')
    // 返回的是复核后的新值，而不是写入前的旧值 RGBA(0, 0.5, 1)
    expect(out.variable.values['mode-seed-1-light']).toEqual(RGBA(1, 0, 0))
    expect(out.warnings ?? []).toEqual([])
  })

  it('创建时同样复核（回读滞后也不谎报）', async () => {
    seedPalette()
    makeReadLagOnce()

    const out = await call('variable/create', {
      name: 'color/verify',
      type: 'COLOR',
      collectionId: 'col-seed-1',
      value: RGBA(0, 1, 0),
    })

    expect(out.success).toBe(true)
    expect(out.variable.values['mode-seed-1-light']).toEqual(RGBA(0, 1, 0))
    expect(out.warnings ?? []).toEqual([])
  })

  it('写值始终不生效时如实告警，不谎报成功', async () => {
    seedPalette()
    fake.api.setVariableValue = async () => null as any

    const out = await call('variable/update', {
      id: 'var-seed-1',
      value: RGBA(1, 0, 0),
      modeId: 'mode-seed-1-light',
    })

    expect(out.applied).toContain('value')
    expect((out.warnings ?? []).some((w: string) => w.includes('回读尚未刷新'))).toBe(true)
  })
})
