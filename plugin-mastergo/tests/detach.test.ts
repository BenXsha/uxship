import { describe, it, expect, afterEach } from 'vitest'
import { installMgStub, resetMgStub } from './helpers/mg-stub'
import { handleDetachInstance } from '../lib/api/nodeHandlers'
import { handlers } from '../lib/api/index'

/**
 * 实例分离（detach）门禁
 *
 * 用途：**改实例子层几何前，先 detach 是官方推荐路径**（用户在 MasterGo UI 里的习惯做法）。
 * 此前插件端没有这个 handler，AI 只能靠人工去 UI 点「分离实例」。
 *
 * 宿主 API：typings `InstanceNode.detachInstance(): FrameNode`（同步，返回普通节点）。
 * 运行时能力缺失时返回 `{success:false, reason:'unsupported'}`，不抛错。
 */

function makeNode(type: string, id: string): any {
  return {
    id,
    name: `${type}-${id}`,
    type,
    removed: false,
    isVisible: true,
    isLocked: false,
    x: 0,
    y: 0,
    width: 16,
    height: 16,
    rotation: 0,
    opacity: 1,
    fills: [],
    strokes: [],
    effects: [],
  }
}

afterEach(() => {
  resetMgStub()
})

describe('node/detachInstance：注册与正常路径', () => {
  it('注册在 handlers 的 node/detachInstance 下', () => {
    expect(typeof handlers['node/detachInstance']).toBe('function')
  })

  it('正常 detach：返回 success + 回读到的 newType（同 id 时 newId=nodeId，无 warning）', () => {
    const instance = makeNode('INSTANCE', '1:1')
    const detached = makeNode('FRAME', '1:1')
    instance.detachInstance = () => detached
    installMgStub({ nodes: { '1:1': instance } })

    const res = handleDetachInstance({ nodeId: '1:1' })

    expect(res).toMatchObject({ success: true, nodeId: '1:1', newId: '1:1', newType: 'FRAME' })
    expect(res.warnings).toBeUndefined()
  })

  it('宿主返回新 id：newId 用新 id，并 warning 提示改用 newId', () => {
    const instance = makeNode('INSTANCE', '1:1')
    const detached = makeNode('FRAME', '9:9')
    instance.detachInstance = () => detached
    installMgStub({ nodes: { '1:1': instance, '9:9': detached } })

    const res = handleDetachInstance({ nodeId: '1:1' })

    expect(res.success).toBe(true)
    expect(res.newId).toBe('9:9')
    expect(res.newType).toBe('FRAME')
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toContain('9:9')
  })

  it('宿主返回空对象：按同 id 处理、类型回读失败时给 UNKNOWN，不抛错', () => {
    const instance = makeNode('INSTANCE', '1:1')
    instance.detachInstance = () => ({})
    installMgStub({ nodes: { '1:1': instance } })

    const res = handleDetachInstance({ nodeId: '1:1' })

    expect(res).toMatchObject({ success: true, nodeId: '1:1', newId: '1:1', newType: 'INSTANCE' })
  })

  it('兼容部分运行时的 node.detach()：同样可用', () => {
    const instance = makeNode('INSTANCE', '1:1')
    const detached = makeNode('GROUP', '1:1')
    instance.detach = () => detached
    installMgStub({ nodes: { '1:1': instance } })

    const res = handleDetachInstance({ nodeId: '1:1' })

    expect(res).toMatchObject({ success: true, newId: '1:1', newType: 'GROUP' })
  })

  it('宿主 detach 抛错：抛带节点 id 的中文错误', () => {
    const instance = makeNode('INSTANCE', '1:1')
    instance.detachInstance = () => {
      throw new Error('cannot detach master instance')
    }
    installMgStub({ nodes: { '1:1': instance } })

    expect(() => handleDetachInstance({ nodeId: '1:1' })).toThrow(/实例分离失败/)
    expect(() => handleDetachInstance({ nodeId: '1:1' })).toThrow(/cannot detach master instance/)
  })
})

describe('node/detachInstance：错误与降级分支', () => {
  it('节点不是 INSTANCE：抛中文错误说明', () => {
    const frame = makeNode('FRAME', '1:1')
    installMgStub({ nodes: { '1:1': frame } })

    expect(() => handleDetachInstance({ nodeId: '1:1' })).toThrow(/不是组件实例/)
    expect(() => handleDetachInstance({ nodeId: '1:1' })).toThrow(/FRAME/)
  })

  it('节点不存在：抛中文错误', () => {
    installMgStub({})
    expect(() => handleDetachInstance({ nodeId: 'nope' })).toThrow(/未找到节点/)
  })

  it('缺 nodeId：抛中文错误', () => {
    installMgStub({})
    expect(() => handleDetachInstance({} as any)).toThrow(/nodeId/)
  })

  it('宿主无 detach 能力：返回 unsupported（不抛错）', () => {
    const instance = makeNode('INSTANCE', '1:1')
    installMgStub({ nodes: { '1:1': instance } })

    const res = handleDetachInstance({ nodeId: '1:1' })

    expect(res).toMatchObject({ success: false, reason: 'unsupported', nodeId: '1:1' })
    expect(res.message).toContain('detachInstance')
  })
})
