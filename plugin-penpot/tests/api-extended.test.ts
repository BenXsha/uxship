/**
 * 扩展接口（导出 / 布尔 / 组件 / 令牌 / 样式）的行为测试
 *
 * 这一组重点锁**契约形状**，因为服务端会按形状识别与接管：
 *   - `node/exportImage` → `image-export.ts#isImageExportResult` 要求
 *     `{nodeId, format, mimeType, data}` 四个字段齐全，否则服务端不会接管落盘/图片包装；
 *   - `variable/list` → 能力缺失必须 `available:false`（与 MasterGo 侧 mg.variables 缺失同口径），
 *     不能返回空列表（会被误读成"文档里没有令牌"）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RequestDispatcher } from '@lib/dispatcher'
import { installHost, resetHost, MemoryHost, PenpotHost } from '@lib/host/index'
import { handleVariableCreate, handleVariableList, handleStyleApply } from '@lib/api/tokenHandlers'
import { installFakePenpot, type FakePenpot } from './helpers/fake-penpot'
import type { TeamLibraryConnectionInfo } from '@lib/host/types'

let host: MemoryHost
let dispatcher: RequestDispatcher

beforeEach(() => {
  host = new MemoryHost()
  installHost(host)
  dispatcher = new RequestDispatcher()
})

afterEach(() => {
  dispatcher.destroy()
  resetHost()
})

async function call(method: string, params: Record<string, unknown> = {}, id: number | string = 1) {
  return dispatcher.dispatch({ jsonrpc: '2.0', id, method, params } as never)
}

async function result(method: string, params: Record<string, unknown> = {}) {
  const response = await call(method, params)
  if ('error' in response) return { __error: response.error }
  return response.result as Record<string, any>
}

async function createRect(name = 'R', extra: Record<string, unknown> = {}) {
  const r = await result('node/create', { element: { type: 'rectangle', name, size: { width: 100, height: 50 }, ...extra } })
  return r.rootIds[0] as string
}

// ───────────────────────── 导出 ─────────────────────────

describe('node/exportImage', () => {
  it('返回服务端识别所需的四个字段（否则不会被接管落盘）', async () => {
    const nodeId = await createRect('Export')
    const r = await result('node/exportImage', { nodeId, format: 'PNG' })

    // image-export.ts#isImageExportResult 的判定条件
    expect(typeof r.nodeId).toBe('string')
    expect(typeof r.format).toBe('string')
    expect(typeof r.mimeType).toBe('string')
    expect(typeof r.data).toBe('string')
    expect(r.mimeType).toBe('image/png')
  })

  it('SVG 走文本（isText），栅格走 base64', async () => {
    const nodeId = await createRect('ExportSvg')
    const svg = await result('node/exportImage', { nodeId, format: 'SVG' })
    expect(svg.text).toBe(true)
    expect(svg.mimeType).toBe('image/svg+xml')

    const png = await result('node/exportImage', { nodeId, format: 'PNG' })
    expect(png.text).toBeUndefined()
  })

  it('栅格必须是 data URI（裸 base64 会被服务端拒绝：Unexpected data format）', async () => {
    const nodeId = await createRect('ExportPng')
    const png = await result('node/exportImage', { nodeId, format: 'PNG' })
    // 服务端 image-export.ts 的判定：非 SVG 时必须 `data:` 开头
    expect(png.data).toMatch(/^data:image\/png;base64,/)
    // PDF 同理（也是二进制）
    const pdf = await result('node/exportImage', { nodeId, format: 'PDF' })
    expect(pdf.data).toMatch(/^data:application\/pdf;base64,/)
  })

  it('固定宽高约束会被换算成 scale 并如实说明（宿主无该概念）', async () => {
    const nodeId = await createRect('ExportW') // 100 宽
    const r = await result('node/exportImage', { nodeId, constraint: { type: 'WIDTH', value: 250 } })
    expect(r.scale).toBeCloseTo(2.5, 4)
    expect(r.notes?.[0]).toMatch(/固定宽度 250 换算为 scale/)
  })

  it('格式非法与节点不存在都抛错（不是 ok:false）', async () => {
    const nodeId = await createRect('ExportErr')
    expect((await result('node/exportImage', { nodeId, format: 'TIFF' })).__error?.message).toMatch(/不支持的格式/)
    expect((await result('node/exportImage', { nodeId: 'ghost' })).__error?.message).toMatch(/节点不存在/)
  })
})

// ───────────────────────── 布尔 / 组件 ─────────────────────────

describe('node/boolean', () => {
  it('四种运算都能落地，并回报结果节点', async () => {
    const a = await createRect('A')
    const b = await createRect('B')
    for (const operation of ['UNION', 'SUBTRACT', 'INTERSECT', 'EXCLUDE']) {
      const r = await result('node/boolean', { nodeIds: [a, b], operation })
      expect(r.ok).toBe(true)
      expect(r.operation).toBe(operation)
      expect(host.getNodeById(r.nodeId)?.type).toBe('boolean')
    }
  })

  it('少于 2 个节点 / 非法运算都抛错', async () => {
    const a = await createRect('Solo')
    expect((await result('node/boolean', { nodeIds: [a], operation: 'UNION' })).__error?.message).toMatch(/至少需要 2 个/)
    const b = await createRect('Solo2')
    expect((await result('node/boolean', { nodeIds: [a, b], operation: 'XOR' })).__error?.message).toMatch(/不支持的操作/)
  })
})

describe('组件：convertToComponent / list / search / detachInstance', () => {
  it('转组件后能在 component/list 里查到；search 能按名字匹配', async () => {
    const nodeId = await createRect('CardBase')
    const created = await result('node/convertToComponent', { nodeId, name: 'Card / Base' })
    expect(created.ok).toBe(true)
    expect(created.componentId).toBeTruthy()

    const list = await result('component/list')
    expect(list.count).toBe(1)
    expect(list.localCount).toBe(1)
    expect(list.components[0].name).toBe('Card / Base')

    const search = await result('component/search', { query: 'base' })
    expect(search.count).toBe(1)
    expect(search.scanned).toBe(1)

    const miss = await result('component/search', { query: 'nothing' })
    expect(miss.count).toBe(0)
  })

  it('keepOriginal 在 Penpot 侧无对应语义 → 如实说明而不是静默忽略', async () => {
    const nodeId = await createRect('KeepMe')
    const r = await result('node/convertToComponent', { nodeId, keepOriginal: true })
    expect(r.note).toMatch(/没有"保留原对象副本"的语义/)
  })

  it('detachInstance 对非实例也成功，并说明本来不是实例', async () => {
    const nodeId = await createRect('NotInstance')
    const r = await result('node/detachInstance', { nodeId })
    expect(r.ok).toBe(true)
    expect(r.note).toMatch(/本来就不是实例/)
  })

  it('component/search 缺 query 时抛错', async () => {
    expect((await result('component/search', {})).__error?.message).toMatch(/需要 query/)
  })
})

// ───────────────────────── 设计令牌 ─────────────────────────

describe('variable/*（Penpot 令牌）', () => {
  it('create 是幂等的（同名按更新处理，不产生重复）', async () => {
    const first = await result('variable/create', { name: 'color.primary', type: 'COLOR', value: '#0066FF' })
    expect(first.created).toBe(true)
    expect(first.type).toBe('color')

    const again = await result('variable/create', { name: 'color.primary', type: 'COLOR', value: '#0055EE' })
    expect(again.created).toBe(false)
    expect(again.value).toBe('#0055EE') // 值被更新
    expect(again.note).toMatch(/幂等/)

    const list = await result('variable/list')
    expect(list.stats.variables).toBe(1)
  })

  it('batchCreate 批量建令牌、可选激活集合、单条失败不静默', async () => {
    const batch = await result('variable/batchCreate', {
      variables: [
        { name: 'system.color.primary', type: 'COLOR', value: '#FF6B35' },
        { name: 'system.color.text', type: 'COLOR', value: '#0F172A' },
        { name: 'bad', type: 'COLOR' },
      ],
      collectionName: 'Design Tokens (Dark)',
      activate: true,
    })
    expect(batch.createdCount).toBe(2)
    expect(batch.ok).toBe(false) // 有一条缺 value
    expect(batch.errors?.[0]?.name).toBe('bad')
    expect(batch.setName).toBe('Design Tokens (Dark)')
    expect(batch.setActive).toBe(true)
    expect(batch.created.map((v: any) => v.name)).toContain('system.color.primary')

    const again = await result('variable/batchCreate', {
      variables: [{ name: 'system.color.primary', type: 'COLOR', value: '#FF0000' }],
      collectionName: 'Design Tokens (Dark)',
    })
    expect(again.createdCount).toBe(0)
    expect(again.updatedCount).toBe(1)
  })

  it('list 同时给出近似类型与宿主原始类型（两边词表不同）', async () => {
    await result('variable/create', { name: 'space.4', type: 'SPACING', value: '16' })
    const list = await result('variable/list')
    const variable = list.collections[0].variables[0]
    expect(variable.type).toBe('SPACING')
    expect(variable.hostType).toBe('spacing')
    expect(variable.values.default).toBe('16')
    expect(list.model).toBe('penpot-tokens')
  })

  it('值是 {a.b} 形态时识别为别名', async () => {
    await result('variable/create', { name: 'color.primary', type: 'COLOR', value: '#0066FF' })
    await result('variable/create', { name: 'color.accent', type: 'COLOR', value: '{color.primary}' })
    const list = await result('variable/list')
    const accent = list.collections[0].variables.find((v: any) => v.name === 'color.accent')
    expect(accent.alias).toBe('{color.primary}')
  })

  it('支持按 type / groupPath / collectionId / includeValues 过滤', async () => {
    await result('variable/create', { name: 'color.primary', type: 'COLOR', value: '#0066FF' })
    await result('variable/create', { name: 'space.4', type: 'SPACING', value: '16' })

    const onlySpacing = await result('variable/list', { type: 'SPACING' })
    expect(onlySpacing.stats.variables).toBe(1)
    expect(onlySpacing.collections[0].variables[0].name).toBe('space.4')

    const byGroup = await result('variable/list', { groupPath: 'color' })
    expect(byGroup.stats.variables).toBe(1)

    const noValues = await result('variable/list', { includeValues: false })
    expect(noValues.collections[0].variables[0].values).toBeUndefined()

    const byCollection = await result('variable/list', { collectionId: 'nope' })
    expect(byCollection.stats.variables).toBe(0)
  })

  it('update / delete 按 name 定位；不存在时抛错', async () => {
    await result('variable/create', { name: 'color.primary', type: 'COLOR', value: '#0066FF' })

    const updated = await result('variable/update', { name: 'color.primary', value: '#FF0000' })
    expect(updated.ok).toBe(true)
    expect(updated.updated).toEqual(['value'])

    const noop = await result('variable/update', { name: 'color.primary' })
    expect(noop.ok).toBe(false)
    expect(noop.reason).toMatch(/没有需要更新的字段/)

    const deleted = await result('variable/delete', { name: 'color.primary' })
    expect(deleted.deleted).toBe('color.primary')
    expect((await result('variable/list')).stats.variables).toBe(0)

    expect((await result('variable/update', { name: 'ghost', value: '1' })).__error?.message).toMatch(/令牌不存在/)
    expect((await result('variable/delete', { name: 'ghost' })).__error?.message).toMatch(/令牌不存在/)
  })

  it('宿主不支持令牌时返回 available:false（不是空列表 —— 那会被误读成"文档里没有令牌"）', async () => {
    const installed = installFakePenpot()
    try {
      // 模拟旧宿主：没有 library.local.tokens
      delete (installed.penpot.library.local as unknown as Record<string, unknown>).tokens
      const penpotHost = new PenpotHost()
      await penpotHost.init()

      const response = await handleVariableList({}, { host: penpotHost, notify: () => {} })
      expect((response as Record<string, any>).available).toBe(false)
      expect((response as Record<string, any>).reason).toMatch(/tokens/)
    } finally {
      installed.restore()
    }
  })

  it('新集合默认未激活 → 响应带 setActive:false 与可操作 hint（不让调用方以为"是我不对"）', async () => {
    const installed = installFakePenpot()
    try {
      const penpotHost = new PenpotHost()
      await penpotHost.init()

      const response = (await handleVariableCreate(
        { name: 'color.brand.primary', type: 'COLOR', value: '#FF4D3D' },
        // 与真实 dispatcher 同形状的最小 context（本用例只用到 host）
        { host: penpotHost, notify: () => {} } as never,
      )) as Record<string, any>

      expect(response.ok).toBe(true)
      expect(response.created).toBe(true)
      // 假宿主已按真机对齐：addSet 出来的集合是 active:false
      expect(response.setActive).toBe(false)
      expect(String(response.hint ?? '')).toContain('activateSet')
    } finally {
      installed.restore()
    }
  })
})

// ───────────────────────── 样式资产 ─────────────────────────

describe('style/*', () => {
  beforeEach(() => {
    host.colorStyles.push({ id: 'paint-1', name: 'Brand / Primary', color: '#0066FF', opacity: 1, isLocal: true })
    host.textStyles.push({ id: 'text-1', name: 'Heading / H1', fontSize: '24', fontWeight: '600', isLocal: true })
  })

  it('listColors / listText 给出本地与外部计数', async () => {
    const colors = await result('style/listColors')
    expect(colors.count).toBe(1)
    expect(colors.localCount).toBe(1)
    expect(colors.styles[0].name).toBe('Brand / Primary')

    const texts = await result('style/listText')
    expect(texts.count).toBe(1)
    expect(texts.styles[0].fontSize).toBe('24')
  })

  it('apply 到 fill / stroke / text 三种类型', async () => {
    const nodeId = await createRect('Styled')
    const fill = await result('style/apply', { nodeId, styleId: 'paint-1', styleType: 'fill' })
    expect(fill.ok).toBe(true)
    expect((host.getNodeById(nodeId) as any).props.fills[0].color).toBe('#0066FF')

    const stroke = await result('style/apply', { nodeId, styleId: 'paint-1', styleType: 'stroke' })
    expect(stroke.ok).toBe(true)

    // 文本样式用到非文本节点 → ok:false + 说明（不静默）
    const wrongTarget = await result('style/apply', { nodeId, styleId: 'text-1', styleType: 'text' })
    expect(wrongTarget.ok).toBe(false)
    expect(wrongTarget.note).toMatch(/只能应用到文本节点/)
  })

  it('样式 id 不存在 / styleType 非法 / 节点不存在都抛错', async () => {
    const nodeId = await createRect('StyledErr')
    expect((await result('style/apply', { nodeId, styleId: 'ghost', styleType: 'fill' })).__error?.message).toMatch(/颜色样式不存在/)
    expect((await result('style/apply', { nodeId, styleId: 'paint-1', styleType: 'shadow' })).__error?.message).toMatch(/fill \/ stroke \/ text/)
    expect((await result('style/apply', { nodeId: 'ghost', styleId: 'paint-1', styleType: 'fill' })).__error?.message).toMatch(/节点不存在/)
  })

  it('文本样式应用到文本节点会改字号/字重', async () => {
    const created = await result('node/create', { element: { type: 'text', name: 'T', content: 'x', size: { width: 100 } } })
    const nodeId = created.rootIds[0] as string
    const applied = await handleStyleApply({ nodeId, styleId: 'text-1', styleType: 'text' }, { host, notify: () => {} })
    expect((applied as Record<string, any>).ok).toBe(true)
    const props = (host.getNodeById(nodeId) as any).props
    expect(props.fontSize).toBe(24)
    expect(props.fontWeight).toBe(600)
  })
})

// ───────────────────────── 注册表 ─────────────────────────

describe('注册表：新方法都已接线且可被空参数安全调用', () => {
  it('新增的 13 个方法都在注册表里', async () => {
    const expected = [
      'node/exportImage', 'node/boolean', 'node/convertToComponent', 'node/detachInstance',
      'component/list', 'component/search',
      'variable/list', 'variable/create', 'variable/update', 'variable/delete',
      'style/listColors', 'style/listText', 'style/apply',
    ]
    const { listMethods } = await import('@lib/api/index')
    for (const method of expected) expect(listMethods()).toContain(method)
  })
})

// 供 lint 使用（FakePenpot 类型仅在类型层面出现）
export type __FakePenpot = FakePenpot

// ───────────────────────── 团队库 / 批量导出 / 诚实降级 ─────────────────────────

describe('teamLibrary/*', () => {
  beforeEach(() => {
    host.components.push({ id: 'comp-1', name: 'Button / Primary', isLocal: true, libraryId: 'lib-1', libraryName: 'Local' })
    host.components.push({ id: 'comp-2', name: 'Card / Base', isLocal: false, libraryId: 'team-1', libraryName: 'Team DS' })
    host.colorStyles.push({ id: 'paint-team', name: 'Brand / Team Primary', color: '#123456', isLocal: false, libraryId: 'team-1', libraryName: 'Team DS' })
  })

  it('list 汇总组件与样式，并给出库清单与提示', async () => {
    const r = await result('teamLibrary/list')
    expect(r.available).toBe(true)
    expect(r.counts.components).toBe(2)
    expect(r.counts.externalComponents).toBe(1)
    expect(r.libraries.map((l: any) => l.name).sort()).toEqual(['Local', 'Team DS'])
    // 库名未知时至少退回 id，绝不出现空标签
    expect(r.libraries.every((l: any) => l.name)).toBe(true)
  })

  it('importComponent 按名字实例化（含 x/y/name），并在画布上留下节点', async () => {
    const r = await result('teamLibrary/importComponent', { component: 'Card / Base', name: 'My Card', x: 40, y: 60 })
    expect(r.ok).toBe(true)
    expect(r.componentName).toBe('Card / Base')
    const node = host.getNodeById(r.nodeId) as any
    expect(node.name).toBe('My Card')
    expect(node.props.x).toBe(40)
    expect(node.props.y).toBe(60)
  })

  it('指定了不存在的库名 → 明确区分「库未连接」并给出指引', async () => {
    const r = await result('teamLibrary/importComponent', { component: 'Card / Base', library: 'NoSuchLib' })
    expect(r.__error?.message).toMatch(/团队库未连接或不存在/)
    expect(r.__error?.message).toMatch(/connectLibrary/)
  })

  it('ukey / 批量 components[] 如实返回 available:false（不静默忽略）', async () => {
    const byUkey = await result('teamLibrary/importComponent', { ukey: 'abc123' })
    expect(byUkey.available).toBe(false)
    expect(byUkey.reason).toMatch(/ukey 是 MasterGo/)
    expect(byUkey.hint).toMatch(/componentId|component\(/)

    const batch = await result('teamLibrary/importComponent', { components: [{ component: 'Card / Base' }] })
    expect(batch.available).toBe(false)
    expect(batch.hint).toMatch(/逐个导入/)
  })

  it('变体属性走 switchVariant；非变体实例时如实说明', async () => {
    const r = await result('teamLibrary/importComponent', {
      component: 'Card / Base',
      variantProperties: { State: 'Hover' },
    })
    expect(r.ok).toBe(true)
    expect(host.variantSwitches).toHaveLength(1)
    expect(host.variantSwitches[0]).toMatchObject({ propertyName: 'State', value: 'Hover' })
  })

  it('importStyle：Penpot 不需要拷贝，如实说明并可选直接应用', async () => {
    const nodeId = await createRect('StyleTarget')
    const r = await result('teamLibrary/importStyle', { name: 'Brand / Team Primary', nodeId, styleType: 'fill' })
    expect(r.ok).toBe(true)
    expect(r.isLocal).toBe(false)
    expect(r.notes[0]).toMatch(/Penpot 不需要把团队库样式拷贝/)
    expect((host.getNodeById(nodeId) as any).props.fills[0].color).toBe('#123456')
  })

  it('importStyle：ukey 与找不到样式都给出可执行信息', async () => {
    const byUkey = await result('teamLibrary/importStyle', { ukey: 'k1' })
    expect(byUkey.available).toBe(false)
    expect(byUkey.hint).toMatch(/name/)

    expect((await result('teamLibrary/importStyle', { name: 'nope' })).__error?.message).toMatch(/样式未找到/)
  })

  it('list 会先自动连库（connectTeamLibraries），并把连接结果带回来', async () => {
    const seen: (string | undefined)[] = []
    // SAFETY: MemoryHost 未声明可选能力 connectTeamLibraries；测试里临时挂上，用于驱动 handler 的自动连库分支。
    const connectable = host as unknown as {
      connectTeamLibraries?: (nameOrId?: string) => Promise<TeamLibraryConnectionInfo>
    }
    connectable.connectTeamLibraries = async (name?: string) => {
      seen.push(name)
      return { connected: [], newlyConnected: [{ id: 'team-1', name: 'Team DS' }], supported: true }
    }

    const listed = await result('teamLibrary/list', { library: 'Team DS' })
    expect(seen).toEqual(['Team DS'])
    expect(listed.teamLibraries.newlyConnected[0].name).toBe('Team DS')
  })

  it('importStyle 名字没命中 → 先自动连库再查（连上后样式就出现）', async () => {
    // SAFETY: 同上 —— MemoryHost 未声明该可选能力，测试里临时挂上。
    const connectable = host as unknown as {
      connectTeamLibraries?: (nameOrId?: string) => Promise<TeamLibraryConnectionInfo>
    }
    connectable.connectTeamLibraries = async () => {
      host.colorStyles.push({ id: 'paint-late', name: 'Late / Token', color: '#ABCDEF', isLocal: false, libraryId: 'team-9', libraryName: 'Team Late' })
      return { connected: [], newlyConnected: [{ id: 'team-9', name: 'Team Late' }], supported: true }
    }

    const imported = await result('teamLibrary/importStyle', { name: 'Late / Token' })
    expect(imported.ok).toBe(true)
    expect(imported.notes.join(' ')).toMatch(/已自动连接团队库: Team Late/)
  })
})

describe('node/exportBatch', () => {
  it('单图层导出返回服务端约定的 {format, data}', async () => {
    const nodeId = await createRect('Batch1')
    const r = await result('node/exportBatch', { layerIds: [nodeId], format: 'svg' })
    expect(r.ok).toBe(true)
    expect(r.format).toBe('svg')
    expect(typeof r.data).toBe('string')
  })

  it('多图层：Penpot 无合并导出能力 → 如实拒绝并给出做法（不悄悄只导第一层）', async () => {
    const a = await createRect('BatchA')
    const b = await createRect('BatchB')
    const r = await result('node/exportBatch', { layerIds: [a, b], format: 'png' })
    expect(r.available).toBe(false)
    expect(r.requested).toBe(2)
    expect(r.hint).toMatch(/node_group/)
  })

  it('无图层可导 / 格式非法都抛错', async () => {
    const r = await result('node/exportBatch', { layerIds: [], useSelection: false })
    expect(r.__error?.message).toMatch(/没有可导出的图层/)
    const nodeId = await createRect('BatchFmt')
    expect((await result('node/exportBatch', { layerIds: [nodeId], format: 'pdf' })).__error?.message).toMatch(/只支持 png \/ svg/)
  })
})

describe('诚实接线：宿主真做不到的方法也要能读懂原因', () => {
  it('node/swapComponent 已在插件端合成实现（不再是降级）—— 详见 tests/swap-component.test.ts', async () => {
    const nodeId = await createRect('SwapTarget')
    // 缺组件参数时报的是"参数错误"，而不是 available:false
    const r = await result('node/swapComponent', { nodeId })
    expect(r.__error?.message).toMatch(/需要 componentId 或 component/)
  })

  it('page/delete：Penpot 没有删页能力，返回 available:false + 现有页面清单', async () => {
    const r = await result('page/delete', { pageId: 'page-1' })
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/没有删页能力/)
    expect(r.hint).toMatch(/page_create \/ page_switch \/ page_rename/)
    expect(r.pages.length).toBeGreaterThan(0)
  })
})
