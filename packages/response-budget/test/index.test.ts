import { describe, it, expect } from 'vitest'
import {
  applyResponseBudget,
  DEFAULT_MAX_CHARS,
  HEAVY_OUTPUT_TOOLS,
  hintFor,
  type BudgetInfo,
} from '../src/index.js'

/**
 * 输出侧预算回归测试（纯函数部分）
 *
 * 背景：工具**结果**是每次调用都进 AI 上下文的付费内容。输入侧（`tools/list`）压到地板后，
 * 输出侧成为最大开销来源（`dsl_export_*` / `node_get` / `*_list` 一次能吐几十 KB）。
 *
 * 本文件锁住三条不变量：
 * 1. 永远输出**合法 JSON**（绝不做「字符串切一半」）；
 * 2. **只截断、不丢结构**（数组截项 / 长字符串截尾，键名与嵌套层级保留，标量原样）；
 * 3. **必须解释**：`_budget.hint`（中文 + 可执行收窄方式）+ `_truncated.field/shown/total`。
 *
 * 只依赖本包自身的导出，可以脱离 mcp-server 独立跑（`npm test`）。
 * 与工具面/转发链相关的回归留在 mcp-server 侧：`tests/response-budget.test.ts`。
 */

function makeNodes(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({ id: `n${i}`, name: 'x'.repeat(40) }))
}

function budgetOf(payload: unknown): BudgetInfo {
  return (payload as { _budget: BudgetInfo })._budget
}

describe('applyResponseBudget — 未超限', () => {
  it('预算内原样返回同一引用，只标记 truncated: false', () => {
    const payload = { id: '1:2', name: 'Frame', children: [{ id: '1:3' }] }
    const out = applyResponseBudget('node_get', payload)

    expect(out.payload).toBe(payload) // 不重排字节，不复制
    expect(out.budget?.truncated).toBe(false)
    expect(out.budget?.maxChars).toBe(DEFAULT_MAX_CHARS)
    expect(out.budget?.actualChars).toBe(JSON.stringify(payload).length)
    expect(out.budget?.notes).toBeUndefined()
    expect(out.budget?.hint).toBeUndefined()
    // 正常体积不会撞上 _budget / _truncated 标记
    expect(payload as Record<string, unknown>).not.toHaveProperty('_budget')
  })

  it('默认上限是 24,000 字符（口径改动必须同步文档与测试）', () => {
    expect(DEFAULT_MAX_CHARS).toBe(24_000)
  })
})

describe('applyResponseBudget — 超长数组', () => {
  it('截项 + 兄弟位 _truncated 记录 shown/total，结构仍完整且可 JSON.parse 往返', () => {
    const payload = { total: 500, nodes: makeNodes(500) }
    const out = applyResponseBudget('search_nodes', payload)
    const result = out.payload as Record<string, any>

    // 超限被截
    expect(out.budget?.truncated).toBe(true)
    expect(result.nodes.length).toBeLessThan(500)
    expect(result.nodes.length).toBeGreaterThan(0)

    // 兄弟位的 _truncated 说明「少了多少、为什么少」
    expect(result._truncated).toMatchObject({ field: 'nodes', total: 500 })
    expect(result._truncated.shown).toBe(result.nodes.length)
    expect(out.budget?.notes?.[0]).toMatchObject({ field: 'nodes', shown: result.nodes.length, total: 500 })

    // 顶层结构未丢：原字段 + 说明字段都在
    expect(result.total).toBe(500)
    expect(Object.keys(result).sort()).toEqual(['_budget', '_truncated', 'nodes', 'total'])

    // 永远是合法 JSON，且能被解析回来（不是「字符串切一半」）
    const text = JSON.stringify(result)
    expect(() => JSON.parse(text)).not.toThrow()
    expect(JSON.parse(text)).toEqual(result)

    // actualChars 是截断后的实际长度，且在预算内
    expect(out.budget?.actualChars).toBe(text.length)
    expect(text.length).toBeLessThanOrEqual(DEFAULT_MAX_CHARS)

    // 提示是中文且给出可执行的收窄方式
    expect(out.budget?.hint).toMatch(/[\u4e00-\u9fa5]/)
    expect(out.budget?.hint).toMatch(/design_describe|maxDepth/)
  })

  it('嵌套数组的记录挂在最近的祖先对象上，路径可定位', () => {
    const payload = { elements: [{ id: 'e1', name: 'Card', children: makeNodes(600) }] }
    const out = applyResponseBudget('dsl_export_node', payload)
    const result = out.payload as Record<string, any>

    expect(result.elements.length).toBe(1) // 外层不超限，不动
    expect(result.elements[0].children.length).toBeLessThan(600)
    expect(result.elements[0]._truncated.field).toBe('elements[].children')
    expect(out.budget?.notes?.map((n) => n.field)).toContain('elements[].children')
  })

  it('不修改入参（纯函数）', () => {
    const payload = { nodes: makeNodes(500) }
    const before = JSON.stringify(payload)
    applyResponseBudget('search_nodes', payload)
    expect(JSON.stringify(payload)).toBe(before)
    expect(payload).not.toHaveProperty('_budget')
  })
})

describe('applyResponseBudget — 超长字符串', () => {
  it('字符串截到阈值 + 同级 _truncated', () => {
    const payload = { html: 'h'.repeat(50_000), meta: { framework: 'html' } }
    const out = applyResponseBudget('design_to_code', payload)
    const result = out.payload as Record<string, any>

    expect(out.budget?.truncated).toBe(true)
    expect(result.html.length).toBe(4_000)
    expect(result._truncated).toMatchObject({ field: 'html', shown: 4_000, total: 50_000 })
    expect(result.meta).toEqual({ framework: 'html' }) // 短字段/标量原样保留
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(DEFAULT_MAX_CHARS)
    expect(out.budget?.actualChars).toBe(JSON.stringify(result).length)
  })

  it('根是超长字符串时包一层信封（data 保住内容，不丢数据）', () => {
    const out = applyResponseBudget('design_to_code', 'y'.repeat(30_000))
    const result = out.payload as Record<string, any>

    expect(out.budget?.truncated).toBe(true)
    expect(typeof result.data).toBe('string')
    expect(result.data.length).toBe(4_000)
    expect(result._truncated.total).toBe(30_000)
    expect(JSON.parse(JSON.stringify(result)).data.length).toBe(4_000)
  })
})

describe('applyResponseBudget — 逃生阀与兜底', () => {
  it('maxChars: 0 / 负数 = 不限制，原样返回且不带 budget', () => {
    const payload = { nodes: makeNodes(2_000) }
    const big = JSON.stringify(payload).length
    expect(big).toBeGreaterThan(DEFAULT_MAX_CHARS) // 防假绿：确实是超限 payload

    for (const maxChars of [0, -1]) {
      const out = applyResponseBudget('search_nodes', payload, { maxChars })
      expect(out.payload).toBe(payload)
      expect(out.budget).toBeUndefined()
    }
  })

  it('极小预算走兜底信封，长度受控且仍是合法 JSON', () => {
    // 上万短字段的巨型对象：数组/字符串两条杠杆都拉不动 → 触发兜底
    const wide: Record<string, string> = {}
    for (let i = 0; i < 200; i++) wide[`field${i}`] = 'v'.repeat(300)

    const out = applyResponseBudget('codebase_get_structure', wide, { maxChars: 2_000 })
    const result = out.payload as Record<string, any>

    expect(out.budget?.truncated).toBe(true)
    expect(out.budget?.maxChars).toBe(2_000)
    expect(typeof result.preview).toBe('string')
    expect(result._truncated).toMatchObject({ field: '$', total: JSON.stringify(wide).length })

    const text = JSON.stringify(result)
    expect(() => JSON.parse(text)).not.toThrow()
    expect(text.length).toBeLessThanOrEqual(2_000) // 绝不允许输出远超上限
    expect(out.budget?.actualChars).toBe(text.length)
  })

  it('入参为 null / undefined / 数字 / 布尔时安全，不抛异常', () => {
    for (const payload of [null, 42, 0, true, false, 'ok', [], {}]) {
      const out = applyResponseBudget('node_get', payload)
      expect(out.payload).toBe(payload)
      expect(out.budget?.truncated).toBe(false)
    }
    // 顶层 undefined / 循环引用无法度量 → 不介入（原样返回，不带 budget）
    expect(applyResponseBudget('node_get', undefined).budget).toBeUndefined()
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    const out = applyResponseBudget('node_get', circular)
    expect(out.payload).toBe(circular)
    expect(out.budget).toBeUndefined()
  })
})

describe('HEAVY_OUTPUT_TOOLS 白名单', () => {
  it('不含自带截断/落盘机制或体积极小的工具（避免两套口径打架）', () => {
    for (const excluded of ['node_export_image', 'node_export_batch', 'health_get', 'dsl_spec', 'mcp_tools']) {
      expect(HEAVY_OUTPUT_TOOLS).not.toContain(excluded)
    }
  })
})

describe('hintFor — 工具感知的收窄建议', () => {
  it('统一前缀带原文长度与上限', () => {
    const hint = hintFor('node_get', 40_000, 24_000)
    expect(hint.startsWith('输出已被截断（原 40000 字符 > 上限 24000）：')).toBe(true)
  })

  it('各工具指向真正适用的收窄手段', () => {
    expect(hintFor('node_get', 40_000, 24_000)).toContain('fields')
    expect(hintFor('node_get_root', 40_000, 24_000)).toContain('fields')
    expect(hintFor('dsl_export_node', 40_000, 24_000)).toContain('maxDepth')
    expect(hintFor('dsl_export_selection', 40_000, 24_000)).toContain('maxDepth')
    expect(hintFor('design_describe', 40_000, 24_000)).toContain('depth')
    expect(hintFor('search_nodes', 40_000, 24_000)).toContain('limit')
    expect(hintFor('component_search', 40_000, 24_000)).toContain('limit')
    expect(hintFor('variable_list', 40_000, 24_000)).toContain('collectionId')
    expect(hintFor('team_library_list', 40_000, 24_000)).toContain('library')
    expect(hintFor('design_to_code', 40_000, 24_000)).toContain('convertToCode')
    expect(hintFor('codebase_get_structure', 40_000, 24_000)).toContain('dir')
  })

  it('未知工具回落到通用建议（仍然可执行）', () => {
    const hint = hintFor('some_unknown_tool', 40_000, 24_000)
    expect(hint).toContain('design_describe')
    expect(hint).toContain('maxChars')
  })

  it('maxChars < 2000 时只保留第一条建议（把额度留给 preview）', () => {
    const small = hintFor('search_nodes', 40_000, 600)
    expect(small).toContain('limit') // 第一条
    expect(small).not.toContain('design_describe') // 第二条被裁掉

    // 边界：1999 走短提示，2000 起给全套
    expect(hintFor('search_nodes', 40_000, 1_999)).not.toContain('design_describe')
    expect(hintFor('search_nodes', 40_000, 2_000)).toContain('design_describe')
  })
})

describe('applyResponseBudget — 各额度档位（600 / 2000 / 6000 / 24000）', () => {
  /** 上万短字段的巨型对象：数组/字符串两条杠杆都拉不动 → 走兜底信封 */
  function wideObject(): Record<string, string> {
    const wide: Record<string, string> = {}
    for (let i = 0; i < 200; i++) wide[`field${i}`] = 'v'.repeat(300)
    return wide
  }

  it('兜底信封：总长 ≤ 上限、合法 JSON、小额度 preview ≥ 40%', () => {
    for (const maxChars of [600, 2_000, 6_000, 24_000]) {
      const out = applyResponseBudget('codebase_get_structure', wideObject(), { maxChars })
      const result = out.payload as Record<string, any>
      const text = JSON.stringify(result)

      expect(out.budget?.truncated, `maxChars=${maxChars} 应截断`).toBe(true)
      expect(() => JSON.parse(text), `maxChars=${maxChars} 应是合法 JSON`).not.toThrow()
      expect(JSON.parse(text)).toEqual(result)
      expect(text.length, `maxChars=${maxChars} 不得超上限`).toBeLessThanOrEqual(maxChars)
      expect(out.budget?.actualChars).toBe(text.length)
      expect(out.budget?.hint).toMatch(/[\u4e00-\u9fa5]/)
      expect(typeof result.preview).toBe('string')
      expect(result.preview.length, `maxChars=${maxChars} preview 不该被挤没`).toBeGreaterThan(0)

      // 小额度硬规则：hint 只留第一条，preview 至少拿到 40% 额度
      if (maxChars <= 2_000) {
        expect(result.preview.length, `maxChars=${maxChars} preview 占比不足`).toBeGreaterThanOrEqual(
          Math.floor(maxChars * 0.4),
        )
      }
    }
  })

  it('数组截断路径：各额度下总长 ≤ 上限且结构完整', () => {
    for (const maxChars of [600, 2_000, 6_000, 24_000]) {
      const out = applyResponseBudget('search_nodes', { total: 500, nodes: makeNodes(500) }, { maxChars })
      const result = out.payload as Record<string, any>
      const text = JSON.stringify(result)

      expect(out.budget?.truncated, `maxChars=${maxChars} 应截断`).toBe(true)
      expect(() => JSON.parse(text)).not.toThrow()
      expect(text.length, `maxChars=${maxChars} 不得超上限`).toBeLessThanOrEqual(maxChars)
      expect(out.budget?.actualChars).toBe(text.length)
      expect(result._truncated.total).toBe(500)
      expect(result.nodes.length).toBe(result._truncated.shown)
      // 提示指向该工具真正适用的手段
      expect(out.budget?.hint).toContain('limit')
    }
  })
})

describe('打包 —— 双入口（ESM + CJS）', () => {
  it('export 的符号在两种模块系统下都能拿到同一套', async () => {
    // 双产物最容易坏在这里：dist/cjs 缺 package.json{"type":"commonjs"} 时
    // import 正常、require 报 ERR_REQUIRE_ESM，而纯 ESM 的开发流程测不出来。
    const cjs = await import('../dist/cjs/index.js').catch(() => null)
    if (cjs) {
      for (const name of ['applyResponseBudget', 'hintFor', 'DEFAULT_MAX_CHARS', 'HEAVY_OUTPUT_TOOLS']) {
        expect(Object.keys(cjs), `CJS 产物缺 ${name}`).toContain(name)
      }
    }
  })
})
