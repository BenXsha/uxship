/**
 * 沙箱侧的窗口尺寸调整（`lib/ui-size.ts`）
 *
 * 这个模块存在的原因是一次**真机翻车**：我把紧凑模式的 `resize` 写在了 UI 侧，
 * 去读 `globalThis.penpot?.ui.resize` —— 而 UI iframe 里**根本没有 `penpot` 全局**
 * （`penpot.ui.*` 只在插件沙箱的 code 上下文），于是真机点下去只会得到兜底提示
 * 「当前环境没有 penpot.ui.resize」。这条提示本身是对的，错的是调用位置。
 *
 * 现在这条链是：UI 发 `UIMessage.RESIZE` → 沙箱 `applyUiSize(...)` → 回 `UI_RESIZED`。
 * 这里钉住 applyUiSize 的四种结果（成功 / 被夹 / 无能力 / 抛错），因为官方明确提到
 * 窗口尺寸有 **min/max 限制但没给数值** —— "读回实际值"是唯一可靠的做法。
 */
import { describe, expect, it, vi } from 'vitest'
import { applyUiSize, type HostUiContext } from '@lib/ui-size'

describe('applyUiSize', () => {
  it('成功：下发尺寸并**读回**宿主实际给到的尺寸', () => {
    const resize = vi.fn()
    const ui: HostUiContext = { resize, size: { width: 132, height: 132 } }

    const result = applyUiSize(ui, 132, 132)
    expect(resize).toHaveBeenCalledWith(132, 132)
    expect(result.size).toEqual({ width: 132, height: 132 })
    expect(result.error).toBeUndefined()
  })

  it('被宿主 min/max 夹住：如实带回实际值（不假设自己拿到了想要的尺寸）', () => {
    const ui: HostUiContext = { resize: () => {}, size: { width: 240, height: 240 } }

    const result = applyUiSize(ui, 132, 132)
    expect(result.size).toEqual({ width: 240, height: 240 }) // 调用方据此提示"被夹了"
    expect(result.error).toBeUndefined()
  })

  it('宿主没有 resize（旧版 Penpot）→ 有明确的 error，而不是静默当成功', () => {
    const result = applyUiSize({ size: { width: 400, height: 560 } }, 132, 132)
    expect(result.error).toMatch(/未提供窗口尺寸调整能力/)
    expect(result.size).toEqual({ width: 400, height: 560 })
  })

  it('传 null / undefined 也不炸（插件未打开的场景）', () => {
    expect(applyUiSize(null, 132, 132).error).toBeTruthy()
    expect(applyUiSize(undefined, 132, 132).error).toBeTruthy()
  })

  it('resize 抛错 → 原样带出原因', () => {
    const ui: HostUiContext = { resize: () => { throw new Error('宿主拒绝') } }
    const result = applyUiSize(ui, 132, 132)
    expect(result.error).toMatch(/宿主拒绝/)
  })

  it('拿不到 size（宿主未回报）→ size 为 null，调用方据此判断"没生效"', () => {
    const ui: HostUiContext = { resize: () => {} }
    const result = applyUiSize(ui, 132, 132)
    expect(result.size).toBeNull()
    expect(result.error).toBeUndefined()
  })
})
