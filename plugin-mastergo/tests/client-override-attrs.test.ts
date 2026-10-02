import { describe, it, expect } from 'vitest'
import { parseInstanceOverrides } from '@ui/composables/client-override-attrs'

/**
 * data-override-* → DSL overrides 翻译回归测试
 *
 * 背景：`skills/design/SKILL.md` 与 `prompts.ts` 都承诺
 * `data-override-text-{childName}` 覆写实例子节点文本，但客户端渲染引擎此前**没有任何解析**，
 * 属性被静默丢弃（DSL 侧 `InstanceElement.overrides` 机制本身是通的）。
 *
 * 本文件锁住三件事：
 * 1. 三类属性（text / fill / visible）都被解析，同 childName 合并；
 * 2. `<childName>` 允许含 `-`，按**第一个** `-` 切分，不得被截断；
 * 3. 不命中的属性名（空 childName / 不支持的类型 / data-swap-* 等）**不能**产出 overrides，
 *    且无命中时返回 `undefined`（不是 `{}`）。
 */

/** 假存取器：从 Record 读属性名（模拟 DOM getAttributeNames + getAttribute） */
function accessor(attrs: Record<string, string>) {
  return {
    getAttr: (name: string) => (name in attrs ? attrs[name] : null),
    names: Object.keys(attrs),
  }
}

function parse(attrs: Record<string, string>) {
  const { getAttr, names } = accessor(attrs)
  return parseInstanceOverrides(getAttr, names)
}

describe('parseInstanceOverrides — 三类属性解析', () => {
  it('text / fill / visible 各自解析为字符串', () => {
    expect(parse({ 'data-override-text-Label': '确定' })).toEqual({ Label: { text: '确定' } })
    expect(parse({ 'data-override-fill-Label': '#FF0066' })).toEqual({ Label: { fill: '#FF0066' } })
    expect(parse({ 'data-override-visible-Label': 'false' })).toEqual({ Label: { visible: 'false' } })
  })

  it('同一 childName 的多个属性合并进同一个对象', () => {
    expect(parse({
      'data-override-text-Label': '确定',
      'data-override-fill-Label': '#FF0066',
      'data-override-visible-Label': 'true',
    })).toEqual({ Label: { text: '确定', fill: '#FF0066', visible: 'true' } })
  })

  it('多个 childName 各自成键', () => {
    expect(parse({
      'data-override-text-Title': '标题',
      'data-override-text-Body': '正文',
    })).toEqual({ Title: { text: '标题' }, Body: { text: '正文' } })
  })

  it('值一律按字符串写入 DSL（visible 也是字符串，不是布尔）', () => {
    const result = parse({ 'data-override-visible-Label': 'false', 'data-override-text-Label': '0' })
    expect(result).toEqual({ Label: { visible: 'false', text: '0' } })
    expect(typeof result!.Label.visible).toBe('string')
    expect(typeof result!.Label.text).toBe('string')
  })

  it('text / fill 值原样透传（含空串）', () => {
    expect(parse({ 'data-override-text-Label': '' })).toEqual({ Label: { text: '' } })
    expect(parse({ 'data-override-fill-Label': 'rgba(1,2,3,.5)' })).toEqual({ Label: { fill: 'rgba(1,2,3,.5)' } })
  })
})

describe('parseInstanceOverrides — childName 含 - 不被截断', () => {
  it('Label-1 / Item-0 / Cell-0-1 整体作为子节点名', () => {
    expect(parse({ 'data-override-text-Label-1': '确定' })).toEqual({ 'Label-1': { text: '确定' } })
    expect(parse({ 'data-override-fill-Item-0': '#112233' })).toEqual({ 'Item-0': { fill: '#112233' } })
    expect(parse({ 'data-override-visible-Cell-0-1': 'yes' })).toEqual({ 'Cell-0-1': { visible: 'true' } })
  })

  it('childName 以 - 开头 / 结尾也不被裁剪', () => {
    expect(parse({ 'data-override-text--Weird-': 'x' })).toEqual({ '-Weird-': { text: 'x' } })
  })
})

describe('parseInstanceOverrides — 不命中的属性', () => {
  it('无任何 data-override-* → undefined（不是 {}）', () => {
    expect(parse({})).toBeUndefined()
    expect(parse({ 'data-name': 'btn', class: 'p-4' })).toBeUndefined()
  })

  it('空 childName 被忽略', () => {
    expect(parse({ 'data-override-text-': '内容' })).toBeUndefined()
    expect(parse({ 'data-override-fill-': '#fff' })).toBeUndefined()
    expect(parse({ 'data-override-visible-': 'true' })).toBeUndefined()
    // 有合法属性时，空 childName 也不产生空键
    expect(parse({ 'data-override-text-': '内容', 'data-override-text-Label': '确定' })).toEqual({
      Label: { text: '确定' },
    })
  })

  it('相似但不该命中的属性名不产生 overrides', () => {
    expect(parse({
      'data-override-text': '内容',            // 无 childName
      'data-override-color-Label': '#FF0066',  // 不支持的类型
      'data-override-textLabel': '内容',        // 缺少分隔 -
      'data-swap-reset-overrides': 'true',     // 换组件的其它开关
      'data-swap-node-id': '1:2',
      'data-component-id': 'DS_Button',
    })).toBeUndefined()
  })

  it('属性名在列但取值取不到（null）→ 视作未声明', () => {
    expect(parseInstanceOverrides(() => null, ['data-override-text-Label'])).toBeUndefined()
    // 与「显式空串」区分：空串是有效覆写
    expect(parseInstanceOverrides(() => '', ['data-override-text-Label'])).toEqual({ Label: { text: '' } })
  })
})

describe('parseInstanceOverrides — visible 真值归一化', () => {
  it('true / TRUE / 1 / yes（含大小写与空白）→ true', () => {
    for (const raw of ['true', 'TRUE', 'True', '1', 'yes', 'YES', ' yes ']) {
      expect(parse({ 'data-override-visible-Label': raw })).toEqual({ Label: { visible: 'true' } })
    }
  })

  it('false / 空串 / 其它值 → false', () => {
    for (const raw of ['false', 'FALSE', '0', 'no', '', 'whatever', 'truely']) {
      expect(parse({ 'data-override-visible-Label': raw })).toEqual({ Label: { visible: 'false' } })
    }
  })
})
