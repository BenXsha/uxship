import { describe, it, expect } from 'vitest'
import {
  planVariantGroups,
  DEFAULT_VARIANT_PROPERTY_NAME,
} from '../src/utils/variant-groups.js'

const node = (nodeId: string, name: string) => ({ nodeId, name })

describe('planVariantGroups — 分组与轴值', () => {
  it('同 setId 的 ≥2 个成员合成一组，首段为类型、第 2 段起为轴值', () => {
    const plan = planVariantGroups([
      node('1:1', 'Button_Primary'),
      node('1:2', 'Button_Secondary'),
    ])

    expect(plan.notes).toEqual([])
    expect(plan.singles).toEqual([])
    expect(plan.groups).toEqual([
      {
        setId: 'Button',
        propertyName: 'State',
        members: [
          { nodeId: '1:1', value: 'Primary' },
          { nodeId: '1:2', value: 'Secondary' },
        ],
      },
    ])
  })

  it('第 2 段起的多段原样拼接（Primary_Disabled）', () => {
    const plan = planVariantGroups([
      node('1:1', 'Button_Primary_Disabled'),
      node('1:2', 'Button_Primary'),
    ])

    expect(plan.groups[0].members).toEqual([
      { nodeId: '1:1', value: 'Primary_Disabled' },
      { nodeId: '1:2', value: 'Primary' },
    ])
  })

  it('只有一段（类型无轴值）→ 跳过并进 notes，不进 groups/singles', () => {
    const plan = planVariantGroups([
      node('1:1', 'Button'),
      node('1:2', 'Button_'),
      node('1:3', 'Button_A'),
      node('1:4', 'Button_B'),
    ])

    expect(plan.groups[0].setId).toBe('Button')
    expect(plan.groups[0].members.map((m) => m.nodeId)).toEqual(['1:3', '1:4'])
    expect(plan.singles).toEqual([])
    expect(plan.notes).toEqual([
      '跳过 "Button"：只有组件类型、没有轴值（应为 <类型>_<轴值>，如 Button_Default）',
      '跳过 "Button_"：只有组件类型、没有轴值（应为 <类型>_<轴值>，如 Button_Default）',
    ])
  })

  it('组名 setId = 首段（不同组件互不合并）', () => {
    const plan = planVariantGroups([
      node('1:1', 'Badge_Info'),
      node('1:2', 'Button_Primary'),
      node('1:3', 'Badge_Warn'),
      node('1:4', 'Button_Secondary'),
    ])

    expect(plan.groups.map((g) => g.setId)).toEqual(['Badge', 'Button'])
    expect(plan.groups[0].members.map((m) => m.value)).toEqual(['Info', 'Warn'])
    expect(plan.groups[1].members.map((m) => m.value)).toEqual(['Primary', 'Secondary'])
  })
})

describe('planVariantGroups — 不再校验 DS_ 前缀', () => {
  it('不含 DS_ 前缀的合法名照常分组（范围由 containerId 界定）', () => {
    const plan = planVariantGroups([
      node('1:1', 'Button_Primary'),
      node('1:2', 'Button_Secondary'),
    ])

    expect(plan.groups.map((g) => g.setId)).toEqual(['Button'])
    expect(plan.notes).toEqual([])
  })

  it('旧 `DS_Button` 写法被当作「类型=DS」处理 —— 因为 DS 已不是特殊前缀', () => {
    // 这是「逐字实现」的直接后果：DS_ 不再有特殊语义，首段就是类型。
    // 固定住行为：迁移到新契约后不会再产生 setId='DS'。
    const plan = planVariantGroups([node('1:1', 'DS_Button_A'), node('1:2', 'DS_Button_B')])

    expect(plan.groups.map((g) => g.setId)).toEqual(['DS'])
    expect(plan.groups[0].members.map((m) => m.value)).toEqual(['Button_A', 'Button_B'])
  })

  it('空段名 / 空首段 → 只进 notes', () => {
    const plan = planVariantGroups([node('1:1', ''), node('1:2', '_Primary')])

    expect(plan.groups).toEqual([])
    expect(plan.singles).toEqual([])
    expect(plan.notes).toEqual([
      '跳过 ""：缺少组件类型（应为 <类型>_<轴值>，如 Button_Primary）',
      '跳过 "_Primary"：缺少组件类型（应为 <类型>_<轴值>，如 Button_Primary）',
    ])
  })
})

describe('planVariantGroups — 单成员与重复轴值', () => {
  it('组内 < 2 个成员 → 进 singles + notes，不进 groups', () => {
    const plan = planVariantGroups([node('1:1', 'Badge_Default')])

    expect(plan.groups).toEqual([])
    expect(plan.singles).toEqual([node('1:1', 'Badge_Default')])
    expect(plan.notes).toHaveLength(1)
    expect(plan.notes[0]).toMatch(/只有 1 个成员，不合成变体集/)
  })

  it('重复轴值：保留全部成员，但在 notes 明确告警（不静默去重）', () => {
    const plan = planVariantGroups([
      node('1:1', 'Button_Default'),
      node('1:2', 'Button_Default'),
    ])

    expect(plan.groups[0].members).toEqual([
      { nodeId: '1:1', value: 'Default' },
      { nodeId: '1:2', value: 'Default' },
    ])
    expect(plan.notes).toEqual(['"Button" 内出现重复轴值 "Default"，宿主侧可能出现歧义'])
  })

  it('重复告警按 (setId, value) 只报一次', () => {
    const plan = planVariantGroups([
      node('1:1', 'Button_Hover'),
      node('1:2', 'Button_Hover'),
      node('1:3', 'Button_Hover'),
    ])

    expect(plan.groups[0].members).toHaveLength(3)
    expect(plan.notes).toHaveLength(1)
  })
})

describe('planVariantGroups — 顺序稳定与不可变性', () => {
  it('groups 按 setId 首次出现顺序；组内成员按输入顺序', () => {
    const plan = planVariantGroups([
      node('1:1', 'Zeta_A'),
      node('1:2', 'Alpha_A'),
      node('1:3', 'Zeta_B'),
      node('1:4', 'Alpha_B'),
    ])

    expect(plan.groups.map((g) => g.setId)).toEqual(['Zeta', 'Alpha'])
    expect(plan.groups[0].members.map((m) => m.nodeId)).toEqual(['1:1', '1:3'])
    expect(plan.groups[1].members.map((m) => m.nodeId)).toEqual(['1:2', '1:4'])
  })

  it('不修改入参', () => {
    const nodes = [node('1:1', 'Button_A'), node('1:2', 'Button_B')]
    Object.freeze(nodes)
    Object.freeze(nodes[0])
    Object.freeze(nodes[1])

    expect(() => planVariantGroups(nodes)).not.toThrow()
    expect(nodes).toEqual([node('1:1', 'Button_A'), node('1:2', 'Button_B')])
  })
})

describe('planVariantGroups — propertyName 与空输入', () => {
  it('默认轴名 State，可被覆盖', () => {
    expect(DEFAULT_VARIANT_PROPERTY_NAME).toBe('State')

    const fallback = planVariantGroups([node('1:1', 'Button_A'), node('1:2', 'Button_B')])
    expect(fallback.groups[0].propertyName).toBe('State')

    const overridden = planVariantGroups(
      [node('1:1', 'Button_A'), node('1:2', 'Button_B')],
      { propertyName: 'Variant' },
    )
    expect(overridden.groups[0].propertyName).toBe('Variant')

    // 空白覆盖回退到默认（不生成空轴名）
    const blank = planVariantGroups(
      [node('1:1', 'Button_A'), node('1:2', 'Button_B')],
      { propertyName: '   ' },
    )
    expect(blank.groups[0].propertyName).toBe('State')
  })

  it('空数组 / 非数组 / 缺 name 都退化成空计划，不抛错', () => {
    expect(planVariantGroups([])).toEqual({ groups: [], singles: [], notes: [] })
    expect(planVariantGroups(undefined as any)).toEqual({ groups: [], singles: [], notes: [] })
    const missingName = planVariantGroups([{ nodeId: '1:1' } as any])
    expect(missingName.groups).toEqual([])
    expect(missingName.singles).toEqual([])
    expect(missingName.notes).toHaveLength(1)
  })

  it('混合输入：容器名 + 单成员 + 合法组各归其位', () => {
    const plan = planVariantGroups([
      node('1:1', 'Components'),
      node('1:2', 'Button_Primary'),
      node('1:3', 'Badge_Only'),
      node('1:4', 'Button_Secondary'),
    ])

    expect(plan.groups.map((g) => g.setId)).toEqual(['Button'])
    expect(plan.singles.map((s) => s.nodeId)).toEqual(['1:3'])
    expect(plan.notes).toEqual([
      '跳过 "Components"：只有组件类型、没有轴值（应为 <类型>_<轴值>，如 Button_Default）',
      '"Badge" 只有 1 个成员，不合成变体集（已记入 singles，未参与转换）',
    ])
  })
})

describe('planVariantGroups — 多轴（axes）', () => {
  it('axes 逐段映射：Button_Primary_Default → Variant=Primary, State=Default', () => {
    const plan = planVariantGroups(
      [
        node('1:1', 'Button_Primary_Default'),
        node('1:2', 'Button_Primary_Hover'),
        node('1:3', 'Button_Secondary_Default'),
      ],
      { axes: ['Variant', 'State'] },
    )

    expect(plan.notes).toEqual([])
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]).toEqual({
      setId: 'Button',
      propertyName: 'Variant',
      properties: ['Variant', 'State'],
      members: [
        { nodeId: '1:1', value: 'Primary', values: ['Primary', 'Default'] },
        { nodeId: '1:2', value: 'Primary', values: ['Primary', 'Hover'] },
        { nodeId: '1:3', value: 'Secondary', values: ['Secondary', 'Default'] },
      ],
    })
  })

  it('单轴不输出 properties/values（保持旧线形状）', () => {
    const plan = planVariantGroups([node('1:1', 'Button_Primary'), node('1:2', 'Button_Hover')], {
      axes: ['State'],
    })

    expect(plan.groups[0]).toEqual({
      setId: 'Button',
      propertyName: 'State',
      members: [
        { nodeId: '1:1', value: 'Primary' },
        { nodeId: '1:2', value: 'Hover' },
      ],
    })
  })

  it('轴值段数与轴数不匹配 → 跳过并进 notes（不静默按最少轴截断）', () => {
    const plan = planVariantGroups(
      [
        node('1:1', 'Button_Primary'),
        node('1:2', 'Button_Secondary_Default'),
        node('1:3', 'Button_Tertiary_Hover'),
      ],
      { axes: ['Variant', 'State'] },
    )

    expect(plan.groups.map((g) => g.members.map((m) => m.nodeId))).toEqual([['1:2', '1:3']])
    expect(plan.notes).toContain('跳过 "Button_Primary"：轴值段数 1 与轴数 2（Variant, State）不匹配')
  })

  it('多轴重复轴值按元组判定（Primary/Default 与 Primary/Hover 不同）', () => {
    const plan = planVariantGroups(
      [
        node('1:1', 'Button_Primary_Default'),
        node('1:2', 'Button_Primary_Hover'),
      ],
      { axes: ['Variant', 'State'] },
    )
    expect(plan.notes).toEqual([])
    expect(plan.groups).toHaveLength(1)
  })

  it('显式 axes 优先于 propertyName', () => {
    const plan = planVariantGroups(
      [node('1:1', 'Button_A_B'), node('1:2', 'Button_C_D')],
      { propertyName: 'Ignored', axes: ['Variant', 'State'] },
    )
    expect(plan.groups[0].properties).toEqual(['Variant', 'State'])
    expect(plan.groups[0].propertyName).toBe('Variant')
  })
})
