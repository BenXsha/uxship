/**
 * `design/describe` / `component/stateMatrix` / `library/registerStyles`
 *
 * 这三个都刻意做成宿主无关（只依赖 HostAdapter 原语），所以用内存替身就能测语义。
 * 重点锁三件事：
 *   1. describe 是「轻量摘要」——扁平、可截断、样式按需；
 *   2. stateMatrix 走**原生变体**，并且状态预设**不猜**（拿到不到的如实列入 presetsSkipped）；
 *   3. registerStyles 只按可预测的规则识别，别的**跳过后要报出来**。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RequestDispatcher } from '@lib/dispatcher'
import { installHost, resetHost, MemoryHost } from '@lib/host/index'

let host: MemoryHost
let dispatcher: RequestDispatcher

function boot(options?: ConstructorParameters<typeof MemoryHost>[0]) {
  host = new MemoryHost(options)
  installHost(host)
  dispatcher = new RequestDispatcher()
}

beforeEach(() => boot())

afterEach(() => {
  dispatcher.destroy()
  resetHost()
})

async function call(method: string, params: Record<string, unknown> = {}) {
  const response = await dispatcher.dispatch({ jsonrpc: '2.0', id: 1, method, params } as never)
  if ('error' in response) return { __error: response.error } as Record<string, any>
  return response.result as Record<string, any>
}

/** 一个三层结构：Card > (Header > Title) + Body */
async function makeCard() {
  const created = await call('node/create', {
    element: {
      type: 'frame',
      name: 'Card',
      size: { width: 320, height: 200 },
      fills: [{ type: 'SOLID', color: '#FFFFFF' }],
      children: [
        {
          type: 'frame',
          name: 'Header',
          size: { width: 320, height: 40 },
          layoutMode: 'HORIZONTAL',
          children: [{ type: 'text', name: 'Title', content: '卡片标题', fontSize: 18 }],
        },
        { type: 'text', name: 'Body', content: '正文内容' },
      ],
    },
  })
  return created.rootIds[0] as string
}

describe('design/describe', () => {
  it('返回扁平摘要：小结 + 嵌套节点树', async () => {
    const cardId = await makeCard()
    const r = await call('design/describe', { nodeId: cardId })

    expect(r.ok).toBe(true)
    expect(r.summary).toMatchObject({ roots: 1, source: 'nodeId' })
    expect(r.depth).toBe(3)

    const card = r.nodes[0]
    expect(card).toMatchObject({ name: 'Card', type: 'frame', x: 0, y: 0, w: 320, h: 200 })
    // 宿主原生词留在 hostType 里（Penpot 是 board，MasterGo 会是 FRAME）
    expect(card.hostType).toBe('board')
    const header = card.children.find((c: any) => c.name === 'Header')
    expect(header.layout).toBe('HORIZONTAL')
    expect(header.children[0]).toMatchObject({ name: 'Title', text: '卡片标题' })

    // 摘要里不该出现像素级细节
    expect(JSON.stringify(r)).not.toMatch(/gradientStops/)
  })

  it('depth 截断 → 明确标注被截断的分支数（不静默丢子树）', async () => {
    const cardId = await makeCard()
    const shallow = await call('design/describe', { nodeId: cardId, depth: 1 })
    expect(shallow.nodes[0].children[0].children).toMatch(/已截断/)
    expect(shallow.summary.truncatedBranches).toBe(1)
  })

  it('depth:0 → 只要当前节点', async () => {
    const cardId = await makeCard()
    const r = await call('design/describe', { nodeId: cardId, depth: 0 })
    expect(r.nodes[0].children).toMatch(/^2（已截断/) // Card 有 Header + Body 两个子节点
  })

  it('includeStyle 才带样式，且颜色量纲正确（不出现 #010101 这类误读）', async () => {
    const cardId = await makeCard()
    const plain = await call('design/describe', { nodeId: cardId })
    expect(plain.nodes[0].style).toBeUndefined()

    const styled = await call('design/describe', { nodeId: cardId, includeStyle: true })
    expect(styled.nodes[0].style.fills).toEqual(['#FFFFFF @100%'])
    const title = styled.nodes[0].children[0].children[0]
    expect(title.style.fontSize).toBe(18)
  })

  it('无 nodeId → 用选区；选区为空用页面根', async () => {
    // node/create 会把新建的根选上（便于"接着操作刚做的东西"），所以这里先在选区里
    await makeCard()
    expect((await call('design/describe', {})).summary.source).toBe('selection')
    expect((await call('design/describe', {})).nodes[0].name).toBe('Card')

    // 清空选区 → 回落到页面根
    await call('selection/set', { nodeIds: [] })
    expect((await call('design/describe', {})).summary.source).toBe('page')
  })

  it('节点不存在 → 抛错并说明「Penpot 只能查当前页」', async () => {
    const r = await call('design/describe', { nodeId: 'ghost' })
    expect(r.__error?.message).toMatch(/节点不存在: ghost（Penpot 只能查当前页）/)
  })
})

describe('component/stateMatrix', () => {
  it('缺 nodeId → available:false 并说明原因（不假装能按组件类型生成）', async () => {
    const r = await call('component/stateMatrix', { type: 'button', states: ['default', 'hover'] })
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/component_render/)
    expect(r.hint).toMatch(/nodeId/)
  })

  it('宿主支持变体 → 走原生变体集，属性轴带名字与值', async () => {
    boot({ capabilities: { ops: { componentVariants: true } } })
    const cardId = await makeCard()
    const r = await call('component/stateMatrix', { nodeId: cardId, states: ['default', 'hover', 'disabled'] })

    expect(r.ok).toBe(true)
    expect(r.naming).toBe('variant')
    expect(r.variantContainerId).toBeTruthy()
    expect(host.variantSets).toHaveLength(1)
    expect(host.variantSets[0]).toMatchObject({ propertyName: 'State', values: ['default', 'hover', 'disabled'] })
    // 三个状态节点都参与了变体集
    expect(host.variantSets[0].nodeIds).toHaveLength(3)
  })

  it('每个状态是一个独立 frame，横向排开（便于人眼对比）', async () => {
    boot({ capabilities: { ops: { componentVariants: true } } })
    const cardId = await makeCard()
    const r = await call('component/stateMatrix', { nodeId: cardId, states: ['default', 'hover'] })
    const frame = host.getNodeById(r.nodeIds[0])!
    const next = host.getNodeById(r.nodeIds[1])!
    expect((frame as any).props.x).toBe(100)
    expect((next as any).props.x).toBe(100 + 320 + 24) // 源宽 320 + 间距 24
  })

  it('保守预设：disabled 降不透明度、hover 加深填充；focused 不猜并列入 presetsSkipped', async () => {
    boot({ capabilities: { ops: { componentVariants: true } } })
    const created = await call('node/create', {
      element: {
        type: 'rectangle',
        name: 'Btn',
        size: { width: 120, height: 40 },
        fills: [{ type: 'SOLID', color: '#3366FF' }],
      },
    })
    const r = await call('component/stateMatrix', {
      nodeId: created.rootIds[0],
      states: ['default', 'hover', 'disabled', 'focused'],
    })

    expect(r.presetsApplied.hover).toEqual(['fill→#2F5EEB'])
    expect(r.presetsApplied.disabled).toEqual(['opacity=0.4'])
    // focused 需要品牌色画焦点环 → 不猜
    expect(r.presetsSkipped.focused).toMatch(/品牌色/)
    expect(r.notes.join(' ')).toMatch(/不做猜测/)
  })

  it('宿主不支持变体 → 降级为 DS_<State> 命名，并如实说明（不静默）', async () => {
    const cardId = await makeCard()
    const r = await call('component/stateMatrix', { nodeId: cardId, states: ['default', 'hover'] })
    expect(r.ok).toBe(true)
    expect(r.variantContainerId).toBeUndefined()
    expect(r.nodes ?? r.nodeIds).toBeTruthy()
    expect(r.notes.join(' ')).toMatch(/未合成原生变体集.*降级为 DS_<State>/)
    const names = (r.nodeIds as string[]).map((id) => host.getNodeById(id)!.name)
    expect(names).toEqual(['DS_default', 'DS_hover'])
  })

  it('naming:default 明确不做变体（也不改名）', async () => {
    boot({ capabilities: { ops: { componentVariants: true } } })
    const cardId = await makeCard()
    const r = await call('component/stateMatrix', { nodeId: cardId, states: ['default', 'hover'], naming: 'default' })
    expect(r.variantContainerId).toBeUndefined()
    expect(host.variantSets).toHaveLength(0)
    expect(r.notes ?? []).toHaveLength(0)
  })

  it('默认 5 态；variantPropertyName 可换', async () => {
    boot({ capabilities: { ops: { componentVariants: true } } })
    const cardId = await makeCard()
    const r = await call('component/stateMatrix', { nodeId: cardId, variantPropertyName: 'Interaction' })
    expect(r.states).toEqual(['default', 'hover', 'active', 'disabled', 'focused'])
    expect(host.variantSets[0].propertyName).toBe('Interaction')
  })

  it('position 可指定起始坐标', async () => {
    boot({ capabilities: { ops: { componentVariants: true } } })
    const cardId = await makeCard()
    const r = await call('component/stateMatrix', { nodeId: cardId, states: ['default'], position: { x: 40, y: 60 } })
    const frame = host.getNodeById(r.nodeIds[0])!
    expect((frame as any).props).toMatchObject({ x: 40, y: 60 })
  })
})

describe('library/registerStyles', () => {
  async function makeTokenPanel() {
    const created = await call('node/create', {
      element: {
        type: 'frame',
        name: 'Token Panel',
        size: { width: 600, height: 400 },
        children: [
          {
            type: 'frame',
            name: 'Brand',
            children: [
              { type: 'rectangle', name: 'Brand Primary', size: { width: 40, height: 40 }, fills: [{ type: 'SOLID', color: '#3366FF' }] },
              { type: 'rectangle', name: 'Brand Hover', size: { width: 40, height: 40 }, fills: [{ type: 'SOLID', color: '#2F5EEB' }] },
            ],
          },
          {
            type: 'frame',
            name: 'Typography',
            children: [
              { type: 'text', name: 'Heading/H1', content: '标题', fontSize: 32, fontWeight: 700 },
              { type: 'text', name: 'Body/Regular', content: '正文', fontSize: 14, fontWeight: 400 },
            ],
          },
          // 噪声：无名色块 + 渐变 → 应被跳过（且不要静默）
          { type: 'rectangle', name: 'rect-1', size: { width: 40, height: 40 }, fills: [{ type: 'SOLID', color: '#111111' }] },
        ],
      },
    })
    return created.rootIds[0] as string
  }

  it('按命名识别色板与排版样本并注册成样式（名字带层级路径）', async () => {
    const panelId = await makeTokenPanel()
    const r = await call('library/registerStyles', { parentId: panelId })

    expect(r.ok).toBe(true)
    expect(r.counts).toEqual({ colors: 2, texts: 2, created: 4, updated: 0, skipped: 0 })
    expect(r.colorStyles.map((s: any) => s.name)).toEqual(['Token Panel/Brand/Brand Primary', 'Token Panel/Brand/Brand Hover'])
    expect(r.colorStyles[0].color).toBe('#3366FF')
    expect(r.textStyles.map((s: any) => s.name)).toEqual(['Heading/H1', 'Body/Regular'])

    // 真落到宿主样式库
    expect(host.colorStyles).toHaveLength(2)
    expect(host.textStyles).toHaveLength(2)
    expect(host.textStyles[0]).toMatchObject({ name: 'Heading/H1', fontSize: '32', fontWeight: '700' })
  })

  it('字号/字重/行高/字距随文本样式落地', async () => {
    const created = await call('node/create', {
      element: {
        type: 'frame',
        name: 'Panel',
        children: [{ type: 'text', name: 'Code', content: 'x', fontSize: 12, fontWeight: 400, lineHeight: { value: 150, unit: 'PERCENT' }, letterSpacing: 0.5 }],
      },
    })
    const r = await call('library/registerStyles', { parentId: created.rootIds[0] })
    expect(r.textStyles).toHaveLength(1)
    // PERCENT 150% → Penpot 的相对倍数 1.5
    expect(host.textStyles[0]).toMatchObject({ fontSize: '12', fontWeight: '400', lineHeight: '1.5', letterSpacing: '0.5' })
  })

  it('纯 PIXELS 行高 → 换算成相对倍数（Penpot 口径）', async () => {
    const created = await call('node/create', {
      element: {
        type: 'frame',
        name: 'Panel',
        children: [{ type: 'text', name: 'T', content: 'x', fontSize: 20, lineHeight: { value: 30, unit: 'PIXELS' } }],
      },
    })
    await call('library/registerStyles', { parentId: created.rootIds[0] })
    expect(host.textStyles[0].lineHeight).toBe('1.5')
  })

  it('识别不到任何样式 → 说明识别规则（不报成功）', async () => {
    const created = await call('node/create', {
      element: { type: 'frame', name: 'Just Layout', children: [{ type: 'rectangle', name: 'rect-a', fills: [{ type: 'SOLID', color: '#000000' }] }] },
    })
    const r = await call('library/registerStyles', { parentId: created.rootIds[0] })
    expect(r.ok).toBe(false)
    expect(r.note).toMatch(/没有识别到可注册的样式/)
    expect(r.note).toMatch(/角色词/)
  })

  it('重复注册按名 upsert（不翻倍）—— Penpot 插件 API 删不掉样式', async () => {
    const panelId = await makeTokenPanel()
    await call('library/registerStyles', { parentId: panelId })
    const second = await call('library/registerStyles', { parentId: panelId })

    // 第二次全部命中已存在 → 只更新、不新建
    expect(second.counts).toEqual({ colors: 2, texts: 2, created: 0, updated: 4, skipped: 0 })
    // 宿主样式库仍是 2 色 + 2 文（没有翻倍）
    expect(host.colorStyles).toHaveLength(2)
    expect(host.textStyles).toHaveLength(2)
    // 同名色值被更新（而非新增）
    expect(host.colorStyles[0]).toMatchObject({ name: 'Token Panel/Brand/Brand Primary', color: '#3366FF' })
  })

  it('节点名斜杠两侧带空格也能 upsert 命中（真机：`Body / Default` 曾无限翻倍）', async () => {
    // 真机 Penpot 把样式名按 `/` 分文件夹且**每段 trim**：`Body / Default` → name `Default` / path `Body`。
    // 若 upsert 的叶子名不 trim（`' Default'`），永远命中不到 `Default`，每次注册都新建。
    const created = await call('node/create', {
      element: {
        type: 'frame',
        name: 'Panel',
        children: [
          { type: 'rectangle', name: 'Brand / Brand Primary', size: { width: 40, height: 40 }, fills: [{ type: 'SOLID', color: '#3366FF' }] },
          { type: 'text', name: 'Body / Default', content: '正文', fontSize: 14, fontWeight: 400 },
        ],
      },
    })
    const panelId = created.rootIds[0] as string
    const first = await call('library/registerStyles', { parentId: panelId })
    const second = await call('library/registerStyles', { parentId: panelId })

    expect(first.counts).toEqual({ colors: 1, texts: 1, created: 2, updated: 0, skipped: 0 })
    expect(second.counts).toEqual({ colors: 1, texts: 1, created: 0, updated: 2, skipped: 0 })
    expect(host.colorStyles).toHaveLength(1)
    expect(host.textStyles).toHaveLength(1)
  })

  it('报告扫描总数（让调用方知道覆盖范围）', async () => {
    const panelId = await makeTokenPanel()
    const r = await call('library/registerStyles', { parentId: panelId })
    // Token Panel + Brand + 2 色块 + Typography + 2 文本 + 噪声 = 8
    expect(r.scanned).toBe(8)
  })

  it('缺 parentId / 节点不存在 → 抛错', async () => {
    expect((await call('library/registerStyles', {})).__error?.message).toMatch(/需要 parentId/)
    expect((await call('library/registerStyles', { parentId: 'ghost' })).__error?.message).toMatch(/节点不存在/)
  })
})
