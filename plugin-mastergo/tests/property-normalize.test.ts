import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  normalizeNodeProperties,
  applyNodeProperties,
  PROPERTY_ALIASES,
  PROPERTY_HINTS,
  IGNORED_READONLY_KEYS,
} from '../lib/utils/node-utils'

/**
 * 属性归一化门禁
 *
 * 2026-09 真实踩坑：AI 把 `dsl_export_node` / `node_get` 的字段名照抄回写，
 * 结果静默失败（fills 里的 imageUrl/imageScaleMode、容器的 layoutMode）。
 * 本文件锁死三件事：
 * 1. 同义别名（含嵌套 paint）必须改名到宿主真实字段，且改名真的发生时给出说明性 warning
 * 2. 语义不同的键（gradientTransform / cornerSmoothing / layoutAlign…）只提示、不乱改名
 * 3. 只读 / 结构字段静默跳过（把回读结果原样写回去不该刷 warning），未知键报出键名
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PROPERTY_ALIASES：同义别名（含嵌套 paint）', () => {
  it('layoutMode → flexMode，并给出一条说明性 warning', () => {
    const warnings: string[] = []
    const out = normalizeNodeProperties({ layoutMode: 'HORIZONTAL' }, warnings)

    expect(out).toEqual({ flexMode: 'HORIZONTAL' })
    // 原键必须被删除，否则会继续走 AUTO_LAYOUT_KEYS 直通路径（宿主静默忽略 layoutMode）
    expect('layoutMode' in out).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('layoutMode')
    expect(warnings[0]).toContain('flexMode')
  })

  it('autoLayout → flexMode', () => {
    const warnings: string[] = []
    expect(normalizeNodeProperties({ autoLayout: 'VERTICAL' }, warnings)).toEqual({ flexMode: 'VERTICAL' })
    expect(warnings[0]).toContain('flexMode')
  })

  it('imageScaleMode → scaleMode、strokeWidth → strokeWeight', () => {
    const out = normalizeNodeProperties({ imageScaleMode: 'FIT', strokeWidth: 2 }, [])
    expect(out).toEqual({ scaleMode: 'FIT', strokeWeight: 2 })
  })

  it('宿主字段已显式给出时，别名值被忽略且给出提示（宿主字段优先）', () => {
    const warnings: string[] = []
    const out = normalizeNodeProperties({ layoutMode: 'VERTICAL', flexMode: 'HORIZONTAL' }, warnings)
    expect(out.flexMode).toBe('HORIZONTAL')
    expect('layoutMode' in out).toBe(false)
    expect(warnings.some(w => w.includes('layoutMode') && w.includes('已忽略'))).toBe(true)
  })

  it('嵌套 fills 里的 imageUrl / imageScaleMode 改名（坑的真实形态）', () => {
    const warnings: string[] = []
    const out: any = normalizeNodeProperties(
      { fills: [{ type: 'IMAGE', imageUrl: 'https://x/y.png', imageScaleMode: 'FILL' }] },
      warnings,
    )

    expect(out.fills).toEqual([{ type: 'IMAGE', imageRef: 'https://x/y.png', scaleMode: 'FILL' }])
    expect(warnings.some(w => w.includes('fills[0].imageUrl') && w.includes('imageRef'))).toBe(true)
    expect(warnings.some(w => w.includes('fills[0].imageScaleMode') && w.includes('scaleMode'))).toBe(true)
  })

  it('嵌套 strokes 同样改名，且 SOLID paint 原样保留', () => {
    const out: any = normalizeNodeProperties(
      {
        strokes: [
          { type: 'IMAGE', imageUrl: 'u', imageScaleMode: 'TILE' },
          { type: 'SOLID', color: '#fff' },
        ],
      },
      [],
    )

    expect(out.strokes![0]).toEqual({ type: 'IMAGE', imageRef: 'u', scaleMode: 'TILE' })
    expect(out.strokes![1]).toEqual({ type: 'SOLID', color: '#fff' })
  })

  it('effects 里的 DSL visible 补齐为运行时 isVisible（保留原键，未知类型透传不丢字段）', () => {
    const out: any = normalizeNodeProperties(
      { effects: [{ type: 'DROP_SHADOW', visible: false }] },
      [],
    )

    expect(out.effects![0].isVisible).toBe(false)
    expect(out.effects![0].visible).toBe(false)
  })

  it('别名字典是导出契约的一部分', () => {
    expect(PROPERTY_ALIASES['layoutMode']).toBe('flexMode')
    expect(PROPERTY_ALIASES['imageUrl']).toBe('imageRef')
    expect(PROPERTY_ALIASES['imageScaleMode']).toBe('scaleMode')
  })
})

describe('PROPERTY_HINTS：语义不同，只提示不改名', () => {
  it('gradientTransform 提示改用 gradientHandlePositions', () => {
    const warnings: string[] = []
    const out = normalizeNodeProperties({ gradientTransform: [[1, 0, 0], [0, 1, 0]] }, warnings)

    expect(warnings.some(w => w.includes('gradientTransform') && w.includes('gradientHandlePositions'))).toBe(true)
    // 不改名、不丢字段：仍交给原逻辑尝试（不改语义）
    expect(out.gradientTransform).toEqual([[1, 0, 0], [0, 1, 0]])
  })

  it('smooth / cornerSmoothing 提示宿主不支持连续圆角', () => {
    const warnings: string[] = []
    normalizeNodeProperties({ smooth: true, cornerSmoothing: 0.6 }, warnings)

    const joined = warnings.join('\n')
    expect(joined).toContain('smooth')
    expect(joined).toContain('cornerSmoothing')
    expect(joined).toContain('squircle')
  })

  it('layoutAlign / primaryAxisAlignItems 提示宿主真实字段', () => {
    const warnings: string[] = []
    normalizeNodeProperties({ layoutAlign: 'STRETCH', primaryAxisAlignItems: 'MIN' }, warnings)

    const joined = warnings.join('\n')
    expect(joined).toContain('alignSelf')
    expect(joined).toContain('mainAxisAlignItems')
  })

  it('hints 表内容可核对（导出契约）', () => {
    expect(PROPERTY_HINTS['gradientTransform']).toContain('gradientHandlePositions')
    expect(PROPERTY_HINTS['cornerSmoothing']).toContain('squircle')
  })
})

describe('IGNORED_READONLY_KEYS：只读 / 结构字段静默跳过', () => {
  it('回读结果整包写回时不产生 warning、也不进入归一化结果', () => {
    const warnings: string[] = []
    const out = normalizeNodeProperties(
      {
        id: '1:2',
        type: 'FRAME',
        removed: false,
        parentId: '1:1',
        childIds: ['1:3'],
        absoluteTransform: [[1, 0, 0], [0, 1, 0]],
        relativeTransform: [[1, 0, 0], [0, 1, 0]],
        absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
        absoluteRenderBounds: { x: 0, y: 0, width: 10, height: 10 },
        bound: { x: 0, y: 0, width: 10, height: 10 },
        componentPropertyDefinitions: {},
        opacity: 0.8,
      },
      warnings,
    )

    expect(warnings).toEqual([])
    expect(out).toEqual({ opacity: 0.8 })
  })

  it('applyNodeProperties 对只读键既不写也不告警', () => {
    const node: any = { id: '1:2', name: 'R', type: 'RECTANGLE' }
    const warnings: string[] = []
    applyNodeProperties(node, { id: '我瞎改的', type: 'FRAME', parentId: 'x' }, warnings)

    expect(node.id).toBe('1:2')
    expect(node.type).toBe('RECTANGLE')
    expect(warnings).toEqual([])
  })

  it('只读键集合包含常见回读结构字段', () => {
    for (const key of ['id', 'type', 'parentId', 'childIds', 'removed', 'absoluteTransform', 'bound']) {
      expect(IGNORED_READONLY_KEYS.has(key)).toBe(true)
    }
  })
})

describe('未知键：不再是含糊的 Skipped unknown property', () => {
  it('报出键名 + 可执行的下一步', () => {
    const node: any = { type: 'RECTANGLE' }
    const warnings: string[] = []
    applyNodeProperties(node, { widthRatio: 0.5 }, warnings)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('widthRatio')
    expect(warnings[0]).toContain('node_get')
  })

  it('宿主复合字段写法不对时给出对应提示，不谎称「不支持该字段」', () => {
    const node: any = { type: 'RECTANGLE', constraints: {} }
    const warnings: string[] = []
    applyNodeProperties(node, { constraints: { horizontal: 'LEFT' } }, warnings)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('constraints')
    expect(warnings[0]).toContain('复合字段')
  })

  it('省略 warnings 时不抛错（退化为 console.warn）', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const node: any = { type: 'RECTANGLE' }

    expect(() => applyNodeProperties(node, { widthRatio: 0.5 })).not.toThrow()
    expect(spy).toHaveBeenCalled()
    expect(() => normalizeNodeProperties({ layoutMode: 'HORIZONTAL' })).not.toThrow()
  })
})

describe('不修改入参', () => {
  it('顶层与嵌套 paint 都返回新对象', () => {
    const fill = { type: 'IMAGE', imageUrl: 'u', imageScaleMode: 'FIT' }
    const props: Record<string, any> = { layoutMode: 'HORIZONTAL', fills: [fill] }
    const out: any = normalizeNodeProperties(props, [])

    expect(props.layoutMode).toBe('HORIZONTAL')
    expect(props.fills[0]).toBe(fill)
    expect(fill).toEqual({ type: 'IMAGE', imageUrl: 'u', imageScaleMode: 'FIT' })
    expect(out.fills![0]).not.toBe(fill)
    expect(out.fills![0]).toEqual({ type: 'IMAGE', imageRef: 'u', scaleMode: 'FIT' })
  })
})

describe('applyNodeProperties：归一化后写入真的生效', () => {
  it('layoutMode 归一化后写进宿主 flexMode（不是被静默忽略）', () => {
    const node: any = { type: 'FRAME', flexMode: 'NONE' }
    const warnings: string[] = []
    applyNodeProperties(node, { layoutMode: 'HORIZONTAL' }, warnings)

    expect(node.flexMode).toBe('HORIZONTAL')
    expect('layoutMode' in node).toBe(false)
    expect(warnings).toHaveLength(1)
  })

  it('fills 里的 imageUrl 归一化后能落进宿主 imageRef', () => {
    const node: any = { type: 'RECTANGLE', fills: [] }
    applyNodeProperties(node, { fills: [{ type: 'IMAGE', imageUrl: 'u', imageScaleMode: 'FILL' }] }, [])

    expect(node.fills[0].imageRef).toBe('u')
    expect(node.fills[0].scaleMode).toBe('FILL')
  })
})
