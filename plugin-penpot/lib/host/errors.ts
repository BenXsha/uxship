/**
 * 宿主端口错误类型
 *
 * 约定：
 * - **能力缺失**用 `UnsupportedHostFeatureError` —— 上层应据此返回 `available:false`，
 *   而不是把它当成崩溃（对应 MasterGo 侧 `mg.variables` 缺失时的处理口径）。
 * - **参数/状态错误**用 `HostArgumentError`，属于调用方 bug，应当暴露。
 */

export class UnsupportedHostFeatureError extends Error {
  readonly feature: string

  constructor(feature: string, detail?: string) {
    super(`宿主不支持该能力: ${feature}${detail ? ` —— ${detail}` : ''}`)
    this.name = 'UnsupportedHostFeatureError'
    this.feature = feature
  }
}

export class HostArgumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HostArgumentError'
  }
}

export class HostNodeNotFoundError extends Error {
  readonly nodeId: string

  constructor(nodeId: string) {
    super(`节点不存在: ${nodeId}`)
    this.name = 'HostNodeNotFoundError'
    this.nodeId = nodeId
  }
}

export function isUnsupportedHostFeature(error: unknown): error is UnsupportedHostFeatureError {
  return error instanceof UnsupportedHostFeatureError
}
