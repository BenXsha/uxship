/**
 * 调整插件窗口大小（沙箱侧的**纯逻辑**，便于单测）
 *
 * ## 为什么这件事必须在沙箱里做
 *
 * `penpot.ui.resize` 只存在于**插件沙箱**（`code` 上下文），**UI iframe 里没有 `penpot` 全局**
 * —— 这正是本项目自己的分层（`lib/main.ts` 头注释：「沙箱：有全局 penpot；UI：有 DOM/WebSocket」）。
 *
 * 而我第一次实现紧凑模式时把 `resize` 写在了 UI 侧（去读 `globalThis.penpot?.ui`）✗，
 * 真机点下去得到的是那句兜底提示「当前环境没有 penpot.ui.resize」——
 * **提示本身没错，错的是我把调用放在了没有 `penpot` 的一侧**。
 * 现在按分层来：UI 发消息 → 沙箱调用 → 读回结果 → 回消息。
 *
 * ## 为什么要把这段单独放一个文件
 *
 * 在 main.ts 里内联几行也能跑，但「调用 resize + **读回实际尺寸**（官方说有 min/max 限制）
 * + 各类失败的如实说明」是有分支的逻辑；放这里就能直接单测，而 main.ts 保持"只做装宿主/开 UI/
 * 转发消息"三件事。文件刻意不出现 `penpot.ui.` 字面量（宿主通道只允许在 main.ts 与 sender.ts），
 * 这里只接收传进来的 ui 对象。
 */

/** 与 `UiContext` 的最小结构约定（只用到这两个成员） */
export interface HostUiContext {
  resize?: (width: number, height: number) => void
  size?: { width: number; height: number } | null
}

export interface ApplyUiSizeResult {
  /** 读回的实际尺寸（拿不到时为 null —— 调用方据此判断"没生效"而不是假设成功） */
  size: { width: number; height: number } | null
  /** 失败/被夹的说明；成功且尺寸一致时为 undefined */
  error?: string
}

/**
 * 请求窗口尺寸，并**读回**宿主实际给到的尺寸。
 *
 * 官方在 `open()` 的说明里提到窗口尺寸有 min/max 限制但未给数值，所以：
 *   - 拿不到 `resize`（旧版宿主 / 非插件环境）→ 如实返回 error；
 *   - 调用抛错 → 原样带出；
 *   - 读回尺寸与请求不一致 → 由调用方决定怎么提示（这里只把实际值带回去）。
 */
export function applyUiSize(ui: HostUiContext | null | undefined, width: number, height: number): ApplyUiSizeResult {
  if (!ui || typeof ui.resize !== 'function') {
    return { size: ui?.size ?? null, error: '宿主未提供窗口尺寸调整能力（旧版 Penpot 或非插件环境）' }
  }

  try {
    ui.resize(width, height)
  } catch (error) {
    return { size: ui.size ?? null, error: `调整窗口尺寸失败：${(error as Error)?.message ?? error}` }
  }

  return { size: ui.size ?? null }
}
