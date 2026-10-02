/**
 * 宿主端口装配
 *
 * 一个进程里只会有一个宿主（插件运行在某个设计工具里），因此用「模块级单例 + 显式安装」
 * 而不是到处传参 —— 但**安装点唯一**（lib/main.ts 启动时），且测试可以随时替换。
 */
import { MemoryHost } from './memory'
import { PenpotHost } from './penpot'
import type { HostAdapter } from './types'

export * from './types'
export { MemoryHost, PenpotHost }
export * from './errors'
export { PROPERTY_PHASES, orderedPropertyEntries } from './apply-order'

let current: HostAdapter | null = null

/** 显式安装宿主实现（插件启动时调用一次） */
export function installHost(host: HostAdapter): void {
  current = host
}

/**
 * 取得当前宿主。
 *
 * 未安装时抛错而不是返回一个假的默认实现 —— 静默使用空宿主会让「设计没画出来」
 * 表现得像「渲染成功但没效果」，是最难排的一类问题。
 */
export function getHost(): HostAdapter {
  if (!current) {
    throw new Error('HostAdapter 未安装：请在插件启动时调用 installHost(...)')
  }
  return current
}

/** 仅测试使用：清除已安装宿主 */
export function resetHost(): void {
  current = null
}

/**
 * 按运行时环境自动选择宿主。
 *
 * 判定依据是全局对象是否存在，而不是构建变量 —— 同一个 bundle 既能在 Penpot 里跑，
 * 也能在 Node 单测里跑（后者会落到 MemoryHost，便于干跑排障）。
 */
export function detectHost(): HostAdapter {
  if (typeof penpot !== 'undefined' && penpot && typeof penpot.createBoard === 'function') {
    return new PenpotHost()
  }
  return new MemoryHost({ documentName: 'Dry Run (no host detected)', homePageName: 'Dry Run' })
}
