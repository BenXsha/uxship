import { describe, it, expect } from 'vitest'
import { isCacheableMethod, cacheableMethods } from '../lib/cache-policy'

/**
 * 响应缓存策略回归测试
 *
 * 锁住历史缺陷：黑名单式的缓存让 `node/get` / `selection/get` / `document/getInfo`
 * 被缓存 5s —— 用户或其它工具改完画布后，agent 回读拿到的还是旧值，看起来像"没生效"。
 * 现在只有静态/诊断方法可缓存。
 */
describe('isCacheableMethod', () => {
  it('允许静态与诊断方法', () => {
    for (const m of ['ping', 'dsl/spec', 'fonts/list', 'health/get', 'health/check']) {
      expect(isCacheableMethod(m), m).toBe(true)
    }
  })

  it('文档读取类一律不缓存（本次修复的核心）', () => {
    for (const m of ['node/get', 'selection/get', 'document/getInfo', 'search/find', 'component/list', 'design/describe']) {
      expect(isCacheableMethod(m), m).toBe(false)
    }
  })

  it('写操作 / 渲染 / 副作用类不缓存', () => {
    for (const m of [
      'node/create', 'node/update', 'node/delete', 'node/batchUpdate', 'node/clone', 'node/move',
      'node/convertToComponent', 'node/swapComponent', 'dsl/render', 'dsl/exportNode',
      'page/switch', 'node/exportImage', 'teamLibrary/importComponent',
    ]) {
      expect(isCacheableMethod(m), m).toBe(false)
    }
  })

  it('未来新增的方法默认不缓存（白名单的默认安全）', () => {
    expect(isCacheableMethod('some/future/method')).toBe(false)
    expect(isCacheableMethod('canvas/zoomToNode')).toBe(false)
  })

  it('清单可控且短（避免误加）', () => {
    expect(cacheableMethods().sort()).toEqual(['dsl/spec', 'fonts/list', 'health/check', 'health/get', 'ping'])
  })
})
