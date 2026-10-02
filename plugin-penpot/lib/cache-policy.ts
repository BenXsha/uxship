/**
 * 插件端响应缓存策略（单一来源）
 *
 * 采用**白名单**而非黑名单：画布内容是活的，任何「读文档」类结果都可能在下一次调用前
 * 就已过期（用户手动改图层、其它工具改了节点），而插件侧无法感知文档变更去失效缓存 ——
 * 因此只对**静态 / 诊断类**结果开缓存。
 *
 * 历史缺陷：旧实现用黑名单，漏了 `node/get` / `selection/get` / `document/getInfo`，
 * 导致改完画布后 5 秒内回读仍拿到旧值，表现为 AI「看不见」自己或用户的修改。
 */
const CACHEABLE_METHODS = new Set([
  // 与文档内容无关的静态信息
  'ping',
  'dsl/spec',
  'fonts/list',
  // 诊断：仅返回进程 / 连接状态
  'health/get',
  'health/check',
])

/** 该方法的结果是否允许进入 5s 响应缓存 */
export function isCacheableMethod(method: string): boolean {
  return CACHEABLE_METHODS.has(method)
}

/** 供测试与文档使用：可缓存方法清单 */
export function cacheableMethods(): string[] {
  return Array.from(CACHEABLE_METHODS)
}
