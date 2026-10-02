import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installMgStub, resetMgStub } from './helpers/mg-stub'
import { DSLExporter } from '../lib/api/dsl-exporter'
import { serializeNode } from '../lib/api/serializer'

/**
 * 实例母版信息（`mainComponentId` / `isLocalMaster`）导出契约
 *
 * 背景（外部 51 条实测日志里的真实问题 F11）：`dsl_export_node` 导出的实例节点里
 * `componentId: 'unknown'` —— **本地母版也报 unknown**（例：`远程操作栏-网络状态` 的母版是
 * 本地组件 `192:45814`、`iPad mini 横屏模板` 的母版是本地组件 `154:13494`），
 * 用户据此误判「母版在外部库」，只好发明「比对实例子层 id 前缀」的土办法。
 *
 * 根因：导出侧读的是 `node.masterComponent`（运行时并不存在），而宿主 typings 里真实字段是
 * `InstanceNode.mainComponent: ComponentNode | null`（对象，不是 id）—— 于是全部落到
 * 「读不到母版」分支，写 `'unknown'` 兜底。
 *
 * 本文件的契约：
 * 1. 本地母版实例 → `mainComponentId` 有真实值、`isLocalMaster === true`
 * 2. 外部（团队库）母版 → `isLocalMaster === false`，且母版不在文档里也能报出 id
 * 3. 拿不到母版信息 → 相关字段**整个缺失**，JSON 里绝不出现 `'unknown'`
 * 4. 向后兼容：旧字段 `componentId` 仍在，有真实值就给真实值
 */

/** 本地母版组件：`ComponentNode.isExternal === false`（文档内组件） */
const localMaster = (id: string, name: string) => ({
  id,
  name,
  type: 'COMPONENT',
  isExternal: false,
  children: [
    { id: `${id}:label`, name: 'label', type: 'TEXT', characters: 'Ctrl', x: 0, y: 0, width: 20, height: 12 },
  ],
})

const externalMaster = (id: string, name: string) => ({
  id,
  name,
  type: 'COMPONENT',
  isExternal: true,
  children: [
    { id: `${id}:label`, name: 'label', type: 'TEXT', characters: 'Ctrl', x: 0, y: 0, width: 20, height: 12 },
  ],
})

const instanceChild = (id: string) => ({
  id,
  name: 'label',
  type: 'TEXT',
  characters: '百度',
  x: 0,
  y: 0,
  width: 40,
  height: 16,
})

/** 造一个 INSTANCE 运行时节点（字段名与 MasterGo 运行时一致） */
const instanceNode = (id: string, mainComponent: any, extra: Record<string, any> = {}) => ({
  id,
  name: '远程操作栏-网络状态',
  type: 'INSTANCE',
  isVisible: true,
  isLocked: false,
  removed: false,
  x: 10,
  y: 20,
  width: 100,
  height: 40,
  mainComponent,
  children: [instanceChild(`${id}:c`)],
  ...extra,
})

afterEach(() => resetMgStub())

describe('DSLExporter — 本地母版实例', () => {
  const LOCAL_ID = '192:45814'

  beforeEach(() => {
    const inst = instanceNode('100:1', localMaster(LOCAL_ID, '网络状态/母版'))
    installMgStub({
      nodes: {
        '100:1': inst,
        [LOCAL_ID]: localMaster(LOCAL_ID, '网络状态/母版'),
      },
      selection: [inst],
    })
  })

  it('mainComponentId 为真实母版 id，isLocalMaster 为 true', () => {
    const el: any = DSLExporter.exportNode('100:1').elements[0]
    expect(el.mainComponentId).toBe(LOCAL_ID)
    expect(el.mainComponentName).toBe('网络状态/母版')
    expect(el.isLocalMaster).toBe(true)
  })

  it('向后兼容：旧字段 componentId 保留真实值，且不再是 unknown', () => {
    const el: any = DSLExporter.exportNode('100:1').elements[0]
    expect(el.componentId).toBe(LOCAL_ID)
    expect(JSON.stringify(el)).not.toContain('unknown')
  })

  it('exportSelection 走同一条路径', () => {
    const el: any = DSLExporter.exportSelection().elements[0]
    expect(el.mainComponentId).toBe(LOCAL_ID)
    expect(el.isLocalMaster).toBe(true)
  })
})

describe('DSLExporter — 外部（团队库）母版实例', () => {
  const EXTERNAL_ID = '900:1'

  it('母版不在当前文档里也能报出 id，且 isLocalMaster 为 false', () => {
    // 外部库组件不在文档内：getNodeById 拿不到，但 mainComponent 对象仍然带着 id/isExternal
    installMgStub({
      nodes: {
        '100:2': instanceNode('100:2', externalMaster(EXTERNAL_ID, '团队库/按钮')),
      },
    })
    const el: any = DSLExporter.exportNode('100:2').elements[0]
    expect(el.mainComponentId).toBe(EXTERNAL_ID)
    expect(el.isLocalMaster).toBe(false)
    expect(el.componentId).toBe(EXTERNAL_ID)
  })

  it('宿主没给 isExternal 标记时不猜：省略 isLocalMaster', () => {
    installMgStub({
      nodes: {
        '100:3': instanceNode('100:3', { id: '777:1', name: '未知来源/组件' }),
      },
    })
    const el: any = DSLExporter.exportNode('100:3').elements[0]
    expect(el.mainComponentId).toBe('777:1')
    expect('isLocalMaster' in el).toBe(false)
  })
})

describe('DSLExporter — 旧模型：母版只给 id 字符串', () => {
  it('masterComponent 为字符串 id 时回读组件补齐本地标记', () => {
    installMgStub({
      nodes: {
        '100:4': instanceNode('100:4', undefined, { masterComponent: '154:13494' }),
        '154:13494': localMaster('154:13494', 'iPad mini 横屏模板/母版'),
      },
    })
    const el: any = DSLExporter.exportNode('100:4').elements[0]
    expect(el.mainComponentId).toBe('154:13494')
    expect(el.mainComponentName).toBe('iPad mini 横屏模板/母版')
    expect(el.isLocalMaster).toBe(true)
  })
})

describe('DSLExporter — 拿不到母版信息', () => {
  beforeEach(() => {
    // 游离实例：没有 mainComponent / masterComponent / componentId / instanceId
    installMgStub({ nodes: { '100:5': instanceNode('100:5', undefined) } })
  })

  it('字段缺失，且不出现 unknown 占位', () => {
    const el: any = DSLExporter.exportNode('100:5').elements[0]
    expect('mainComponentId' in el).toBe(false)
    expect('componentId' in el).toBe(false)
    expect('isLocalMaster' in el).toBe(false)
    expect(JSON.stringify(el)).not.toContain('unknown')
  })

  it('实例子节点仍然照常导出', () => {
    const el: any = DSLExporter.exportNode('100:5').elements[0]
    expect(el.children).toHaveLength(1)
    expect(el.children[0].content).toBe('百度')
  })
})

describe('serializeNode — 实例母版字段', () => {
  it('本地母版：mainComponentId / mainComponentName / isLocalMaster', () => {
    const out: any = serializeNode(instanceNode('100:6', localMaster('192:45814', '网络状态/母版')))
    expect(out.mainComponentId).toBe('192:45814')
    expect(out.mainComponentName).toBe('网络状态/母版')
    expect(out.isLocalMaster).toBe(true)
  })

  it('外部母版：isLocalMaster 为 false', () => {
    const out: any = serializeNode(instanceNode('100:7', externalMaster('900:2', '团队库/按钮')))
    expect(out.mainComponentId).toBe('900:2')
    expect(out.isLocalMaster).toBe(false)
  })

  it('拿不到母版：字段缺失，不出现 unknown', () => {
    const out: any = serializeNode(instanceNode('100:8', undefined))
    expect(out).not.toHaveProperty('mainComponentId')
    expect(out).not.toHaveProperty('isLocalMaster')
    expect(JSON.stringify(out)).not.toContain('unknown')
  })

  it('非 INSTANCE 节点不受影响', () => {
    const out: any = serializeNode({ id: '1:1', name: 'frame', type: 'FRAME', removed: false, isVisible: true, isLocked: false })
    expect(out).not.toHaveProperty('mainComponentId')
  })
})
