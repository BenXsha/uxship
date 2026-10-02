import { describe, it, expect } from 'vitest'
import { getTools } from '../src/utils/tools/design-context.js'
import { toolInputSchemaToZod } from '../src/utils/json-schema-to-zod.js'

/**
 * `search_nodes` schema 回归测试（形状可发现性）
 *
 * 背景（真实踩坑）：插件端旧实现只认一种形状，AI 传 `name: "绑定说明"` / `colors: "#fff"` /
 * `maxSize: 55` 时**静默失效**（返回全页 270 个节点 / 崩在 hexToRgb / 忽略尺寸）。
 * 现在插件端 `normalizeSearchParams` 做形状容忍 + 不识别就报错，服务端 schema 必须把
 * 「可接受的形状」写进描述，并且**不要**给这些联合参数声明单一 `type` ——
 * 声明 `type:'object'` 会让字符串调用在 zod 校验层被拒，永远走不到插件端的归一化。
 *
 * 预算：参数描述 ≤40 字符、工具描述 ≤260 字符、单工具 schema ≤1600 字符
 * （门禁见 tool-surface-budget.test.ts；这里把 search_nodes 的具体形状也锁住）。
 */
const tools = getTools()
const tool = tools.find((t) => t.name === 'search_nodes')
if (!tool) throw new Error('未找到 search_nodes 工具')

const properties = (tool.inputSchema as any).properties as Record<string, any>

/** 联合形状参数：不得声明单一 type（否则字符串/数字简写被 zod 拒之门外） */
const UNION_PARAMS = ['name', 'colors', 'minSize', 'maxSize']
/** 必须存在的参数（含新增的选区开关） */
const REQUIRED_PARAMS = ['name', 'types', 'colors', 'hasShadow', 'hasBlur', 'minSize', 'maxSize', 'opacity', 'limit', 'select']

describe('search_nodes — 参数形状可发现性', () => {
  it('10 个参数都在（含新增的 select）', () => {
    expect(Object.keys(properties).sort()).toEqual([...REQUIRED_PARAMS].sort())
  })

  it('name / colors / minSize / maxSize 是联合形状，不声明单一 type', () => {
    for (const key of UNION_PARAMS) {
      expect(properties[key], `${key} 不在 schema 里`).toBeDefined()
      expect(
        properties[key].type,
        `${key} 声明了 type=${properties[key].type}，会把另一种简写形状挡在 zod 校验层`
      ).toBeUndefined()
    }
  })

  it('参数描述 ≤40 字符且写明可接受形状', () => {
    for (const key of REQUIRED_PARAMS) {
      const desc: string = properties[key].description ?? ''
      expect(desc.length, `${key} 描述为空`).toBeGreaterThan(0)
      expect(desc.length, `${key} 描述 ${desc.length} 字符：${desc}`).toBeLessThanOrEqual(40)
    }
    // 形状提示必须在描述里（否则 AI 只能靠猜）
    expect(properties.name.description).toContain('字符串')
    expect(properties.colors.description).toContain('#fff')
    expect(properties.colors.description).toContain('color')
    expect(properties.minSize.description).toContain('数字')
    expect(properties.maxSize.description).toContain('数字')
    expect(properties.select.description).toContain('默认')
  })

  it('select 是布尔且说明默认行为与 false 的含义', () => {
    expect(properties.select.type).toBe('boolean')
    expect(properties.select.description).toContain('默认 true')
    expect(properties.select.description).toContain('不动选区')
  })

  it('types 保留枚举（12 种类型不会因省略而丢失）', () => {
    expect(properties.types.type).toBe('array')
    expect(properties.types.items.enum).toHaveLength(12)
  })
})

describe('search_nodes — 描述预算', () => {
  it('工具描述 ≤260 字符，且点明「字符串即可」与 select:false', () => {
    const desc: string = tool.description ?? ''
    expect(desc.length).toBeLessThanOrEqual(260)
    expect(desc).toContain('字符串')
    expect(desc).toContain('select:false')
  })

  it('inputSchema ≤1600 字符（预算门禁口径）', () => {
    expect(JSON.stringify(tool.inputSchema).length).toBeLessThanOrEqual(1600)
  })
})

describe('search_nodes — 简写形状能过服务端校验层', () => {
  it('name 传字符串 / colors 传字符串 / maxSize 传数字 / select:false 都能通过 zod 校验', () => {
    const schema = toolInputSchemaToZod(tool.inputSchema)
    const parsed = schema.safeParse({ name: '绑定说明', colors: '#4A6CF7', maxSize: 55, select: false })
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true)
  })

  it('对象形状（原有写法）也照旧通过', () => {
    const schema = toolInputSchemaToZod(tool.inputSchema)
    const parsed = schema.safeParse({
      name: { value: '绑定说明', matchType: 'exact' },
      colors: [{ color: '#4A6CF7', type: 'fill', tolerance: 20 }],
      minSize: { height: 18 },
      types: ['TEXT'],
    })
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true)
  })
})
