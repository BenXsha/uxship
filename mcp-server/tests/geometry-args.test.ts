/**
 * 几何参数归一化
 *
 * 这一组钉的是「工具说明的口径 ≠ 宿主插件的口径」造成的真机事故（2026-09-30 连踩两次）：
 *
 *   - 按说明传 `type`+`properties` → 插件报 `node/create 需要 element …`（**单体创建必失败**）
 *   - 批量里带 `properties` → 被当作「DSL 元素的不认识字段」**静默丢弃**（节点只剩默认样式）
 *   - `node_update` 传 DSL 风格的 `position`/`size` → 宿主回「尚未映射该属性」（宿主端口只认扁平键）
 *
 * 归一化放在服务端（一处同时修两个宿主），所以这里对**纯函数**做断言即可覆盖两宿主。
 */
import { describe, expect, it } from 'vitest'
import { normalizeCreateArgs, normalizeGeometryArgs, normalizeUpdateArgs } from '../src/utils/geometry-args.js'

describe('node_create 归一化', () => {
  it('type + properties → DSL 元素（position/size 嵌套，且不留扁平键）', () => {
    const out = normalizeCreateArgs({
      type: 'rectangle',
      properties: { name: 'Probe', x: 10, y: 20, width: 160, height: 80, fills: [{ type: 'SOLID' }] },
    })

    expect(out.element).toEqual({
      name: 'Probe',
      fills: [{ type: 'SOLID' }],
      type: 'rectangle',
      position: { x: 10, y: 20 },
      size: { width: 160, height: 80 },
    })
    expect(out.type).toBeUndefined()
    expect(out.properties).toBeUndefined()
  })

  it('nodes[] 里带 properties 的条目也会被折叠（否则插件静默忽略 properties）', () => {
    const out = normalizeCreateArgs({
      nodes: [
        { type: 'rectangle', properties: { name: 'A', x: 0, width: 100 } },
        { type: 'text', properties: { name: 'B', characters: 'hi' } },
      ],
    })

    expect(out.nodes).toEqual([
      { name: 'A', type: 'rectangle', position: { x: 0 }, size: { width: 100 } },
      { name: 'B', characters: 'hi', type: 'text' },
    ])
  })

  it('已是 DSL 元素形状时原样返回（幂等，不重复折叠）', () => {
    const element = { type: 'rectangle', name: 'A', position: { x: 1, y: 2 }, size: { width: 3, height: 4 } }
    const out = normalizeCreateArgs({ element })

    expect(out.element).toEqual(element)
  })

  it('显式 position/size 优先于扁平键（不覆盖调用方明确给的值）', () => {
    const out = normalizeCreateArgs({
      type: 'rectangle',
      properties: { x: 999, y: 999, position: { x: 1, y: 2 } },
    })

    expect((out.element as Record<string, unknown>).position).toEqual({ x: 1, y: 2 })
  })

  it('裸 nodes[] DSL 元素（无 properties）不被改动', () => {
    const nodes = [{ type: 'rectangle', name: 'A', position: { x: 5, y: 6 } }]
    const out = normalizeCreateArgs({ nodes })

    expect(out.nodes).toEqual(nodes)
  })
})

describe('node_update 归一化', () => {
  it('position/size → 扁平 x/y/width/height（并删掉嵌套键，否则宿主回一堆「尚未映射」）', () => {
    const out = normalizeUpdateArgs({ properties: { name: 'A', position: { x: 10, y: 20 }, size: { width: 30, height: 40 } } })

    expect(out.properties).toEqual({ name: 'A', x: 10, y: 20, width: 30, height: 40 })
  })

  it('批量 updates[] 里的 properties 同样展开', () => {
    const out = normalizeUpdateArgs({
      updates: [{ nodeId: 'n1', properties: { position: { x: 1 } } }],
    })

    expect(out.updates).toEqual([{ nodeId: 'n1', properties: { x: 1 } }])
  })

  it('已有扁平键时不被 position 覆盖（显式优先）', () => {
    const out = normalizeUpdateArgs({ properties: { x: 7, position: { x: 1, y: 2 } } })

    expect(out.properties).toEqual({ x: 7, y: 2 })
  })
})

describe('分派', () => {
  it('只对 node_create / node_update 生效，其它工具原样透传', () => {
    const args = { nodeId: 'n1', properties: { position: { x: 1 } } }

    expect(normalizeGeometryArgs('node_get', args)).toBe(args)
    expect(normalizeGeometryArgs('node_update', args)).not.toBe(args)
  })
})
