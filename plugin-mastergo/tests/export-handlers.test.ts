import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installMgStub, resetMgStub, type MgStub } from './helpers/mg-stub'
import { exportHandlers, handleExportBatch, normalizeExportPayload, DEFAULT_MAX_BYTES } from '../lib/api/exportHandlers'

/**
 * 批量导出处理器测试（`mg` 全局桩）
 *
 * 私有化客户端（MasterGoPrivate 1.10.3）的 exportPng / exportSvgByLayerIds 返回值在 typings 里
 * 只声明为 `string`，实际形态不明（SVG 源码 / data URI / 纯 base64），所以这里分两层锁死：
 * - `normalizeExportPayload` 纯函数：把三种形态的判定规则钉死（判错了上层会拿到垃圾数据）
 * - `node/exportBatch` 处理器：入参透传（spy 断言）、选区回退、unsupported / 抛错不冒泡、超限截断
 */
const node = (id: string, name = id) => ({ id, name, type: 'FRAME', removed: false, parent: { id: 'page:1' } })

const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUg=='

let mg: MgStub
let exportSvgSpy: ReturnType<typeof vi.fn>
let exportPngSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  mg = installMgStub({
    nodes: { '1:1': node('1:1', 'A'), '1:2': node('1:2', 'B'), '1:3': node('1:3', 'C') },
    selection: [node('1:2', 'B')],
  })
  exportSvgSpy = vi.fn(() => SVG_TEXT)
  exportPngSpy = vi.fn(() => PNG_BASE64)
  ;(mg as any).exportSvgByLayerIds = exportSvgSpy
  ;(mg as any).exportPng = exportPngSpy
})

afterEach(() => {
  resetMgStub()
})

describe('normalizeExportPayload — 三种返回形态', () => {
  it('原始 SVG 源码 → text', () => {
    expect(normalizeExportPayload(SVG_TEXT, 'svg')).toEqual({ encoding: 'text', data: SVG_TEXT })
  })

  it('SVG 源码带 BOM / 前导空白 → 仍判为 text，并去掉首尾空白', () => {
    expect(normalizeExportPayload(`\uFEFF\n  ${SVG_TEXT}  `, 'svg')).toEqual({ encoding: 'text', data: SVG_TEXT })
  })

  it('data:image/svg+xml;base64 → 剥离前缀后的纯 base64', () => {
    expect(normalizeExportPayload('data:image/svg+xml;base64,PHN2Zy8+', 'svg')).toEqual({
      encoding: 'base64',
      data: 'PHN2Zy8+',
    })
  })

  it('data:image/png;base64 → 剥离前缀后的纯 base64', () => {
    expect(normalizeExportPayload(`data:image/png;base64,${PNG_BASE64}`, 'png')).toEqual({
      encoding: 'base64',
      data: PNG_BASE64,
    })
  })

  it('非 base64 的 data URI（URL 编码文本）→ 解码回文本', () => {
    expect(normalizeExportPayload('data:image/svg+xml,%3Csvg%2F%3E', 'svg')).toEqual({
      encoding: 'text',
      data: '<svg/>',
    })
  })

  it('无 data: 前缀的纯 base64 → base64（含换行时折叠空白）', () => {
    expect(normalizeExportPayload(` ${PNG_BASE64.slice(0, 12)}\n${PNG_BASE64.slice(12)} `, 'png')).toEqual({
      encoding: 'base64',
      data: PNG_BASE64,
    })
  })

  it('空串 → 空内容（统一按 base64，空串由调用方判失败）', () => {
    expect(normalizeExportPayload('', 'svg')).toEqual({ encoding: 'base64', data: '' })
    expect(normalizeExportPayload('   \n ', 'png')).toEqual({ encoding: 'base64', data: '' })
  })

  it('非法输入（null/undefined/数字/对象）→ 空内容，不抛异常', () => {
    expect(normalizeExportPayload(null, 'svg')).toEqual({ encoding: 'base64', data: '' })
    expect(normalizeExportPayload(undefined, 'png')).toEqual({ encoding: 'base64', data: '' })
    expect(normalizeExportPayload(123, 'png')).toEqual({ encoding: 'base64', data: '' })
    expect(normalizeExportPayload({ data: 'x' }, 'svg')).toEqual({ encoding: 'base64', data: '' })
  })

  it('Uint8Array → base64（宿主若改返回二进制也能接住）', () => {
    const bytes = new Uint8Array([137, 80, 78, 71])
    const out = normalizeExportPayload(bytes, 'png')
    expect(out.encoding).toBe('base64')
    expect(out.data.length % 4).toBe(0)
    expect(out.data).not.toBe('')
  })

  it('既非 XML 也非 base64 的说明性文案 → 按文本回传，不伪装成 base64', () => {
    expect(normalizeExportPayload('export error: layer not found', 'png')).toEqual({
      encoding: 'text',
      data: 'export error: layer not found',
    })
  })
})

describe('node/exportBatch — 注册表与 SVG 正常路径', () => {
  it('注册在 node/exportBatch（服务端 node_export_batch 的映射目标）', () => {
    expect(Object.keys(exportHandlers)).toEqual(['node/exportBatch'])
    expect(exportHandlers['node/exportBatch']).toBe(handleExportBatch)
  })

  it('svg：透传 layerIds，返回文本与 image/svg+xml', () => {
    const out = handleExportBatch({ layerIds: ['1:1', '1:2'], format: 'svg' }, {} as any)
    expect(exportSvgSpy).toHaveBeenCalledWith(['1:1', '1:2'])
    expect(out).toEqual({
      success: true,
      format: 'svg',
      count: 2,
      layerIds: ['1:1', '1:2'],
      encoding: 'text',
      mimeType: 'image/svg+xml',
      data: SVG_TEXT,
      bytes: SVG_TEXT.length,
      truncated: false,
      warnings: [],
    })
  })

  it('layerIds 去重且过滤空值', () => {
    const out = handleExportBatch({ layerIds: ['1:1', '1:1', '', '  '], format: 'svg' }, {} as any)
    expect(out.layerIds).toEqual(['1:1'])
    expect(exportSvgSpy).toHaveBeenCalledWith(['1:1'])
  })
})

describe('node/exportBatch — PNG 入参', () => {
  it('png + scale/filterIds：宿主收到 { ids, filterIds, scale }', () => {
    const out = handleExportBatch(
      { layerIds: ['1:1', '1:2'], format: 'png', scale: 2, filterIds: ['1:3'] },
      {} as any,
    )
    expect(exportPngSpy).toHaveBeenCalledTimes(1)
    expect(exportPngSpy).toHaveBeenCalledWith({ ids: ['1:1', '1:2'], filterIds: ['1:3'], scale: 2 })
    expect(exportSvgSpy).not.toHaveBeenCalled()
    expect(out).toMatchObject({
      success: true,
      format: 'png',
      encoding: 'base64',
      mimeType: 'image/png',
      data: PNG_BASE64,
      count: 2,
    })
  })

  it('png 未传 scale/filterIds：不把 undefined 塞给宿主', () => {
    handleExportBatch({ layerIds: ['1:1'], format: 'png' }, {} as any)
    expect(exportPngSpy).toHaveBeenCalledWith({ ids: ['1:1'] })
  })
})

describe('node/exportBatch — 图层来源与失败分支', () => {
  it('未传 layerIds 时回退当前选区', () => {
    const out = handleExportBatch({ format: 'svg' }, {} as any)
    expect(out.layerIds).toEqual(['1:2'])
    expect(exportSvgSpy).toHaveBeenCalledWith(['1:2'])
  })

  it('useSelection:false 时不回退选区', () => {
    const out = handleExportBatch({ format: 'svg', useSelection: false }, {} as any)
    expect(out).toMatchObject({ success: false, reason: 'no-layers' })
    expect(out.message).toContain('请选择图层或传 layerIds')
    expect(exportSvgSpy).not.toHaveBeenCalled()
  })

  it('layerIds 与选区都为空：友好错误，不调宿主 API', () => {
    mg = installMgStub({ nodes: {}, selection: [] })
    ;(mg as any).exportSvgByLayerIds = exportSvgSpy
    const out = handleExportBatch({ format: 'svg' }, {} as any)
    expect(out).toMatchObject({ success: false, reason: 'no-layers' })
    expect(out.message).toContain('请选择图层或传 layerIds')
    expect(exportSvgSpy).not.toHaveBeenCalled()
  })

  it('format 缺失或非法：结构化报错（format 在 schema 里是必填）', () => {
    expect(handleExportBatch({ layerIds: ['1:1'] }, {} as any)).toMatchObject({
      success: false,
      reason: 'invalid-params',
    })
    expect(handleExportBatch({ layerIds: ['1:1'], format: 'jpg' }, {} as any)).toMatchObject({
      success: false,
      reason: 'invalid-params',
    })
    expect(exportSvgSpy).not.toHaveBeenCalled()
    expect(exportPngSpy).not.toHaveBeenCalled()
  })

  it('宿主没有该 API：unsupported（提示用 plugin_capabilities 复核）', () => {
    mg = installMgStub({ nodes: { '1:1': node('1:1', 'A') }, selection: [] })
    const out = handleExportBatch({ layerIds: ['1:1'], format: 'png' }, {} as any)
    expect(out).toMatchObject({ success: false, reason: 'unsupported' })
    expect(out.message).toContain('plugin_capabilities')
  })

  it('宿主抛错：被捕获成 export-failed，不冒泡', () => {
    exportSvgSpy.mockImplementation(() => {
      throw new Error('boom')
    })
    let out: any
    expect(() => {
      out = handleExportBatch({ layerIds: ['1:1'], format: 'svg' }, {} as any)
    }).not.toThrow()
    expect(out).toMatchObject({ success: false, reason: 'export-failed' })
    expect(out.message).toContain('boom')
  })

  it('宿主返回空内容：export-failed，而不是假成功', () => {
    exportSvgSpy.mockImplementation(() => '')
    const out = handleExportBatch({ layerIds: ['1:1'], format: 'svg' }, {} as any)
    expect(out).toMatchObject({ success: false, reason: 'export-failed' })
  })
})

describe('node/exportBatch — 体积保护', () => {
  it('超过 maxBytes：按 maxBytes 截断并给出中文 warning', () => {
    const longSvg = `<svg>${'x'.repeat(200)}</svg>`
    exportSvgSpy.mockImplementation(() => longSvg)
    const out = handleExportBatch({ layerIds: ['1:1'], format: 'svg', maxBytes: 16 }, {} as any)
    expect(out.success).toBe(true)
    expect(out.truncated).toBe(true)
    expect(out.data).toHaveLength(16)
    expect(out.bytes).toBe(16)
    expect(out.data).toBe(longSvg.slice(0, 16))
    expect(out.warnings).toEqual(['导出内容超过上限，已截断；建议改用 savePath 落盘或缩小范围'])
  })

  it('未超限：truncated=false 且 warnings 为空；默认上限为 4MB', () => {
    const out = handleExportBatch({ layerIds: ['1:1'], format: 'svg' }, {} as any)
    expect(out.truncated).toBe(false)
    expect(out.warnings).toEqual([])
    expect(DEFAULT_MAX_BYTES).toBe(4 * 1024 * 1024)
  })
})
