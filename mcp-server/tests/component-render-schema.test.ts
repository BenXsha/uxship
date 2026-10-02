import { describe, it, expect } from 'vitest'
import { getTools } from '../src/utils/tools/components.js'

/**
 * `component_render` schema 折叠回归测试（39 个扁平参数 → 4 个）
 *
 * 背景：`tools/list` 整份注入 AI 上下文，而 `component_render` 的 39 个参数是 33 种组件类型
 * 参数的并集，一个工具就占约 4.7k 字符。折叠方案：
 * - schema 只声明 `type` / `props` / `position` / `theme`；
 * - 类型专属参数收进自由对象 `props`（目录写进 `skills/design/rules/16-component-catalog.md`）；
 * - 平铺写法仍然可用（插件端 `mergeComponentParams` 合并，平铺优先）。
 *
 * 这里锁住的是「schema 形状」，防止后续新增类型时又把参数平铺回 schema。
 */
const tools = getTools()
const componentRender = tools.find((t) => t.name === 'component_render')
if (!componentRender) throw new Error('未找到 component_render 工具')
const schema: any = componentRender.inputSchema
const properties: Record<string, any> = schema.properties

/** 折叠前 39 个扁平参数的抽样（回归哨兵：这些键不得再出现在 schema 里） */
const LEGACY_FLAT_PARAMS = ['label', 'items', 'variant', 'percent', 'size', 'states', 'content', 'confirmLabel', 'activeBg']
// 参数描述有 ≤40 字符预算（见 tool-surface-budget.test.ts），所以描述里用**文件名**而不是完整相对路径
const CATALOG_DOC = '16-component-catalog.md'

describe('component_render — 折叠后的 inputSchema', () => {
  it('只声明 4 个参数', () => {
    expect(Object.keys(properties).sort()).toEqual(['position', 'props', 'theme', 'type'])
  })

  it('type / props / position / theme 都保留了类型说明', () => {
    expect(properties.type.type).toBe('string')
    expect(properties.props.type).toBe('object')
    expect(properties.position.type).toBe('object')
    expect(properties.theme.type).toBe('object')
    expect(properties.props.description).toContain(CATALOG_DOC)
    expect(properties.type.description).toContain(CATALOG_DOC)
  })

  it('type enum 完整无损：33 项且无重复', () => {
    const enumValues: string[] = properties.type.enum
    expect(enumValues).toHaveLength(33)
    expect(new Set(enumValues).size).toBe(33)
    // 抽样关键类型仍在（含两处连字符类型）
    for (const t of ['button', 'checkbox-group', 'text-input', 'page-shell', 'pricing-table']) {
      expect(enumValues).toContain(t)
    }
  })

  it('props 是自由对象（不声明 properties，允许任意类型专属参数）', () => {
    expect(properties.props.properties).toBeUndefined()
    expect(properties.props.additionalProperties).toBeUndefined()
  })

  it('required 仍然只要求 type（历史调用无需补 props）', () => {
    expect(schema.required).toEqual(['type'])
  })

  it('旧扁平参数已从 schema 移除（它们只存在于文档里）', () => {
    for (const key of LEGACY_FLAT_PARAMS) {
      expect(properties[key], `${key} 不应再出现在 component_render schema 里`).toBeUndefined()
    }
    // theme 是保留的 4 个之一，但不再逐键声明令牌
    expect(properties.theme.properties).toBeUndefined()
  })

  it('inputSchema JSON 长度 ≤ 1500 字符（折叠前约 4725）', () => {
    const chars = JSON.stringify(schema).length
    expect(chars, `component_render schema 又涨到 ${chars} 字符`).toBeLessThanOrEqual(1500)
  })

  it('工具描述 ≤ 260 字符且指向参数目录文档', () => {
    expect(componentRender.description.length).toBeLessThanOrEqual(260)
    expect(componentRender.description).toContain(CATALOG_DOC)
  })
})
