/**
 * `component/render` —— 预设组件的 DSL 模板实现
 *
 * 断言的重点不是"长得像"，而是：
 *   1. 预设真的落到画布上（`dsl/render` 的渲染报告 ok），且**尺寸/颜色/圆角**是设想的那些 ——
 *      历史坑：把 `width/height` 写在元素顶层会被静默丢弃（DSL 用的是 `size:{}`），
 *      于是"渲染成功"但节点是 0×0。这里用尺寸断言钉住它。
 *   2. 未移植的类型**不静默兜底**：返回 available:false + 已支持/未支持清单 + 指引。
 *   3. 主题（含 mode: dark）与历史平铺写法都生效。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RequestDispatcher } from '@lib/dispatcher'
import { installHost, resetHost, MemoryHost } from '@lib/host/index'
import { SUPPORTED_COMPONENT_TYPES } from '@lib/api/componentHandlers'

let host: MemoryHost
let dispatcher: RequestDispatcher

beforeEach(() => {
  host = new MemoryHost()
  installHost(host)
  dispatcher = new RequestDispatcher()
})

afterEach(() => {
  dispatcher.destroy()
  resetHost()
})

async function call(method: string, params: Record<string, unknown> = {}) {
  const response = await dispatcher.dispatch({ jsonrpc: '2.0', id: 1, method, params } as never)
  if ('error' in response) return { __error: response.error } as Record<string, any>
  return response.result as Record<string, any>
}

const find = (name: string) => host.flatten().find((node) => node.name === name)
const dims = (name: string) => {
  const node = find(name)
  if (!node) throw new Error(`节点不存在: ${name}`)
  const props = host.readProperties(node, ['width', 'height'])
  return { width: props.width as number, height: props.height as number }
}

describe('component/render：预设落地', () => {
  it('button：默认 primary/md，尺寸与圆角来自主题', async () => {
    const r = await call('component/render', { type: 'button', props: { label: '保存' } })
    expect(r.ok).toBe(true)
    expect(r.componentName).toBe('Button-primary')
    expect(find('Label')!.props.characters).toBe('保存')

    // 高度 40 + 上下不设 padding → 由内容与尺寸决定；圆角 6（主题默认）
    const button = find('Button-primary')!
    const props = host.readProperties(button, ['cornerRadius', 'fills', 'layoutMode'])
    expect(props.cornerRadius).toBe(6)
    expect(props.layoutMode).toBe('HORIZONTAL')
    expect((props.fills as any[])[0].color).toBe('#3366FF')
  })

  it('button：variant=outline 带描边；shape=pill 圆角=height/2', async () => {
    await call('component/render', { type: 'button', props: { variant: 'outline', shape: 'pill' } })
    const props = host.readProperties(find('Button-outline')!, ['cornerRadius', 'strokes', 'strokeWidth'])
    expect(props.strokes).toHaveLength(1)
    expect(props.strokeWidth).toBe(1)
    expect(props.cornerRadius).toBe(20) // 40/2
  })

  it('size=lg 让高度/字号/圆角一起变（不是只改尺寸）', async () => {
    await call('component/render', { type: 'button', props: { size: 'lg' } })
    const label = host.readProperties(find('Label')!, ['fontSize'])
    expect(label.fontSize).toBe(16) // 14 + 2
  })

  it('每个已支持类型都能落地，且尺寸不为 0（防 size:{} 被漏写）', async () => {
    for (const type of SUPPORTED_COMPONENT_TYPES) {
      const r = await call('component/render', { type, props: {} })
      expect(r.ok, `${type} 渲染失败: ${r.reason ?? ''}`).toBe(true)
      const root = host.getNodeById(r.nodeId)!
      const props = host.readProperties(root, ['width', 'height'])
      const width = Number(props.width ?? 0)
      const height = Number(props.height ?? 0)
      expect(width > 0 || height > 0, `${type} 的根节点尺寸为 0`).toBe(true)
    }
  })

  it('spinner / divider / progress 的几何按参数走', async () => {
    await call('component/render', { type: 'spinner', props: { size: 32 } })
    const spinner = dims('Spinner')
    expect(spinner.width).toBe(32)
    expect(spinner.height).toBe(32)

    await call('component/render', { type: 'divider', props: { orientation: 'vertical' } })
    expect(dims('Divider')).toEqual({ width: 1, height: 24 })

    await call('component/render', { type: 'progress', props: { value: 25, width: 200, height: 8 } })
    expect(dims('Fill').width).toBe(50)
  })

  it('skeleton 的行数与末行短一截', async () => {
    const r = await call('component/render', { type: 'skeleton', props: { lines: 3, width: 240 } })
    expect(r.ok).toBe(true)
    expect(dims('Row-0').width).toBe(240)
    expect(dims('Row-2').width).toBe(144)
  })

  it('theme.mode=dark 生效；单个 token 可覆盖', async () => {
    await call('component/render', { type: 'card', theme: { mode: 'dark' } })
    const dark = host.readProperties(find('Card')!, ['fills'])
    expect((dark.fills as any[])[0].color).toBe('#111827')

    await call('component/render', { type: 'card', theme: { brand: '#FF0066' } })
    await call('component/render', { type: 'button', theme: { brand: '#FF0066' } })
    const buttons = host.flatten().filter((node) => node.name === 'Button-primary')
    const last = buttons[buttons.length - 1]
    expect((host.readProperties(last, ['fills']).fills as any[])[0].color).toBe('#FF0066')
  })

  it('历史平铺写法（参数直接在顶层）与 props 等价，且 props 优先', async () => {
    await call('component/render', { type: 'badge', label: '平铺' })
    expect(find('Label')!.props.characters).toBe('平铺')

    await call('component/render', { type: 'badge', label: '平铺', props: { label: '嵌套优先' } })
    const labels = host.flatten().filter((node) => node.name === 'Label')
    expect(labels[labels.length - 1].props.characters).toBe('嵌套优先')
  })

  it('position 生效（不传则由渲染器决定位置）', async () => {
    const r = await call('component/render', { type: 'badge', props: { label: 'x' }, position: { x: 300, y: 120 } })
    const node = host.getNodeById(r.nodeId)!
    expect(host.readProperties(node, ['x', 'y'])).toMatchObject({ x: 300, y: 120 })
  })
})

describe('component/render：未移植类型不静默兜底', () => {
  it('未移植的类型 → available:false + 清单 + 指引', async () => {
    const r = await call('component/render', { type: 'pricing-table' })
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/pricing-table 预设尚未移植/)
    expect(r.supportedTypes).toContain('button')
    expect(r.unsupportedTypes).toContain('pricing-table')
    expect(r.unsupportedTypes).not.toContain('button')
    expect(r.hint).toMatch(/dsl\/render/)
    // 关键：没有偷偷渲染成别的东西
    expect(find('Pricing Table')).toBeUndefined()
  })

  it('已支持 + 未支持 = 服务端登记的 33 种（清单不会漂移）', async () => {
    const r = await call('component/render', { type: 'table' })
    expect(SUPPORTED_COMPONENT_TYPES.length + r.unsupportedTypes.length).toBe(33)
  })

  it('未知类型（不在服务端 enum 里）同样报 available:false，不猜', async () => {
    const r = await call('component/render', { type: 'nonsense-widget' })
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/nonsense-widget/)
  })
})
