import { describe, it, expect } from 'vitest'
import { mergeComponentParams } from '../lib/api/componentHandlers'

/**
 * `component_render` 参数折叠回归测试
 *
 * 背景：`component_render` 的 schema 从 39 个扁平参数折叠成 `type` / `props` / `position` / `theme`，
 * 但插件端渲染器始终按 `params.xxx` 读参。`mergeComponentParams` 负责把 `props` 展开进平铺
 * 命名空间，保证**两种写法等效、且平铺优先**——这是「压缩字符不破坏既有调用」的契约。
 *
 * 本文件是纯函数测试，不需要 `mg` 桩。
 */
describe('mergeComponentParams', () => {
  it('props 里的参数被展开到平铺命名空间（新写法可用）', () => {
    const merged = mergeComponentParams({
      type: 'button',
      props: { label: '提交', variant: 'outline', size: { tier: 'lg' } },
    })
    expect(merged.label).toBe('提交')
    expect(merged.variant).toBe('outline')
    expect(merged.size).toEqual({ tier: 'lg' })
  })

  it('平铺参数覆盖 props 的同名键（历史写法语义不变）', () => {
    const merged = mergeComponentParams({
      type: 'button',
      label: '平铺胜出',
      props: { label: 'props 落败', variant: 'text' },
    })
    expect(merged.label).toBe('平铺胜出')
    // 未被平铺覆盖的 props 键仍然生效
    expect(merged.variant).toBe('text')
  })

  it('平铺与 props 混用：各类型专属参数都能取到', () => {
    const merged = mergeComponentParams({
      type: 'card',
      title: '平铺标题',
      props: { content: 'props 正文', footerButtons: ['取消', '确定'] },
      position: { x: 10, y: 20 },
      theme: { mode: 'dark' },
    })
    expect(merged.title).toBe('平铺标题')
    expect(merged.content).toBe('props 正文')
    expect(merged.footerButtons).toEqual(['取消', '确定'])
    expect(merged.position).toEqual({ x: 10, y: 20 })
    expect(merged.theme).toEqual({ mode: 'dark' })
  })

  it('type 不会丢（判定渲染器前就要用到）', () => {
    expect(mergeComponentParams({ type: 'modal', props: { title: '提示' } }).type).toBe('modal')
    // props 里也带 type 时，平铺的 type 优先
    expect(mergeComponentParams({ type: 'modal', props: { type: 'alert' } }).type).toBe('modal')
  })

  it('props 不是普通对象时忽略它（数组 / 字符串 / 数字 / null）', () => {
    for (const props of [['label'], 'label', 42, null, undefined]) {
      const merged = mergeComponentParams({ type: 'badge', props })
      expect(merged.type).toBe('badge')
      expect(merged.label).toBeUndefined()
    }
  })

  it('入参不是对象时安全返回 {}（交由调用方报「缺少 type」而不是 TypeError）', () => {
    for (const params of [undefined, null, 'button', 42, true, ['type']]) {
      expect(mergeComponentParams(params)).toEqual({})
    }
  })

  it('不修改入参（返回新对象，props 原样保留）', () => {
    const props = { label: '提交' }
    const params = { type: 'button', props }
    const snapshot = JSON.stringify(params)

    const merged = mergeComponentParams(params)

    expect(merged).not.toBe(params)
    expect(JSON.stringify(params)).toBe(snapshot)
    expect(props).toEqual({ label: '提交' })
    // 合并结果里仍保留 props 键，渲染器只按需读取自己认识的键，不会被它干扰
    expect(merged.props).toBe(props)
  })

  it('缺少 props 时等价于原样透传平铺参数', () => {
    const merged = mergeComponentParams({ type: 'spinner', showTrack: false, showLabel: '加载中' })
    expect(merged).toEqual({ type: 'spinner', showTrack: false, showLabel: '加载中' })
  })
})
