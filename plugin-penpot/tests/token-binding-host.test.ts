/**
 * 令牌绑定 / 集合激活 —— **真机适配器层**回归
 *
 * 这一组钉的是两个「离线全绿、真机才炸」的问题（2026-09-30 真机验收时暴露）：
 *
 *   1. `applyToken()` 是**异步落地**的：调用返回后立刻回读 `shape.tokens` 仍是空，
 *      于是「绑定成功」被误报成「宿主未接受」。假宿主原本把 `applyToken` 写成同步 noop，
 *      这条路径在离线测试里永远跑不到 —— 现在替身刻意延迟 5ms 落地（对齐真机）。
 *   2. 令牌集合默认 `active: false`：此时 `shape.tokens` 有引用，但**渲染不跟着令牌走**
 *      （改令牌值后 fills 仍是旧色）。所以「渲染后统一改 tokens、全稿联动」的前提是
 *      集合处于激活态，而这条激活路径过去不存在。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PenpotHost } from '@lib/host/penpot'
import type { HostNode } from '@lib/host/types'
import { installFakePenpot } from './helpers/fake-penpot'

let restore: () => void
let host: PenpotHost

beforeEach(async () => {
  const installed = installFakePenpot({ withWaitForLayoutUpdate: false })
  restore = installed.restore
  host = new PenpotHost()
  await host.init()
})

afterEach(() => restore())

async function makeRect(name = 'Probe'): Promise<HostNode> {
  return host.createNode({ kind: 'rectangle', name })
}

describe('applyToken 的回读时机', () => {
  it('等宿主异步落地后再回读（抢跑会把成功误报成失败）', async () => {
    await host.createToken({ name: 'color.brand.primary', type: 'color', value: '#FF4D3D' })
    const rect = await makeRect()

    const result = await host.applyToken(rect, 'color.brand.primary', ['fill'])

    expect(result.applied).toBe(true)
    expect(result.bound).toEqual({ fill: 'color.brand.primary' })
    expect(result.note).toBeUndefined()
  })

  it('令牌不存在时抛错，而不是静默当成成功', async () => {
    const rect = await makeRect()
    await expect(host.applyToken(rect, 'color.nope', ['fill'])).rejects.toThrow(/令牌不存在/)
  })

  it('已绑定同一令牌时**不重复下发**（真机：重复 applyToken 会解绑，留下烤死的旧值）', async () => {
    await host.createToken({ name: 'color.brand.primary', type: 'color', value: '#FF4D3D' })
    const rect = await makeRect()
    await host.applyToken(rect, 'color.brand.primary', ['fill'])

    const spy = vi.spyOn(rect as unknown as { applyToken: () => void }, 'applyToken')
    const second = await host.applyToken(rect, 'color.brand.primary', ['fill'])

    expect(spy).not.toHaveBeenCalled()
    expect(second.applied).toBe(true)
    expect(second.bound).toEqual({ fill: 'color.brand.primary' })
    expect(String(second.note ?? '')).toContain('已绑定')
  })
})

describe('令牌值传播（改值 → 回写已绑定形状）', () => {
  it('把新值下发到所有绑定该令牌的形状，并用回读确认真的改了', async () => {
    await host.createToken({ name: 'color.brand.primary', type: 'color', value: '#FF4D3D' })
    const a = await makeRect('A')
    const b = await makeRect('B')
    await host.applyToken(a, 'color.brand.primary', ['fill'])
    await host.applyToken(b, 'color.brand.primary', ['fill'])

    // 等价于 variable_update({ value })
    await host.updateToken({ name: 'color.brand.primary', value: '#0066FF' })

    const result = await host.propagateToken({ tokenName: 'color.brand.primary' })

    // 机制名字带原因：宿主这两个 API 是**切换**语义，所以是「解绑→重绑」而不是“再下发一次”
    expect(result).toMatchObject({ matched: 2, rewritten: 2, rebound: 2 })
    expect(result.mechanism).toContain('unbind+rebind')
    expect(host.readProperties(a, ['fills']).fills).toMatchObject([{ color: '#0066FF' }])
    expect(host.readProperties(b, ['fills']).fills).toMatchObject([{ color: '#0066FF' }])
    // 绑定不能被传播弄丢（重绑后才会有）
    expect(host.readNodeTokens(a)).toEqual({ fill: 'color.brand.primary' })
    expect(host.readNodeTokens(b)).toEqual({ fill: 'color.brand.primary' })
  })

  it('本页没有绑定该令牌时如实返回 0，不假装成功', async () => {
    await host.createToken({ name: 'color.brand.primary', type: 'color', value: '#FF4D3D' })
    await makeRect('Unbound')

    const result = await host.propagateToken({ tokenName: 'color.brand.primary' })

    expect(result).toMatchObject({ matched: 0, rewritten: 0, mechanism: 'none' })
    expect(String(result.note ?? '')).toContain('没有形状绑定')
  })

  it('令牌不存在时报错，不静默当作没目标', async () => {
    await expect(host.propagateToken({ tokenName: 'color.nope' })).rejects.toThrow(/令牌不存在/)
  })
})

describe('令牌集合激活', () => {
  it('默认未激活（对齐真机），激活后回读为 true，且幂等时不谎报 changed', async () => {
    await host.createToken({ name: 'color.brand.primary', type: 'color', value: '#FF4D3D' })
    expect((await host.listTokenSets())[0].active).toBe(false)

    const on = await host.setTokenSetActive({ tokenName: 'color.brand.primary', active: true })
    expect(on.changed).toBe(true)
    expect(on.active).toBe(true)
    expect((await host.listTokenSets())[0].active).toBe(true)

    // 已是目标状态：不能谎报"改了"
    const again = await host.setTokenSetActive({ tokenName: 'color.brand.primary', active: true })
    expect(again.changed).toBe(false)
    expect(again.active).toBe(true)

    // 按集合名也能停用
    const off = await host.setTokenSetActive({ setName: 'Design Tokens', active: false })
    expect(off.changed).toBe(true)
    expect(off.active).toBe(false)
    expect((await host.listTokenSets())[0].active).toBe(false)
  })

  it('集合/令牌都不存在时报可操作的原因', async () => {
    await expect(host.setTokenSetActive({ setName: 'No Such Set', active: true })).rejects.toThrow(
      /令牌集合不存在/,
    )
    await expect(host.setTokenSetActive({ tokenName: 'color.nope', active: true })).rejects.toThrow(
      /令牌不存在/,
    )
  })
})
