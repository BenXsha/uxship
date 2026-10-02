import { describe, it, expect } from 'vitest'
import { safeJsonParse, safeParseObject } from '../src/utils/safe-json.js'

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 })
  })

  it('returns fallback for null/undefined input', () => {
    expect(safeJsonParse(null, 'fb')).toBe('fb')
    expect(safeJsonParse(undefined, 'fb')).toBe('fb')
  })

  it('returns fallback for empty string', () => {
    expect(safeJsonParse('', [])).toEqual([])
  })

  it('returns fallback for malformed JSON', () => {
    expect(safeJsonParse('{bad json}', 42)).toBe(42)
  })

  it('handles arrays', () => {
    expect(safeJsonParse('[1,2,3]', [])).toEqual([1, 2, 3])
  })

  it('handles primitive values', () => {
    expect(safeJsonParse('"hello"', '')).toBe('hello')
    expect(safeJsonParse('42', 0)).toBe(42)
    expect(safeJsonParse('true', false)).toBe(true)
  })

  it('infers fallback type', () => {
    const result = safeJsonParse<{ x: number }>('{"x":1}', { x: 0 })
    expect(result.x).toBe(1)
  })
})

/**
 * WS 消息处理器用 safeParseObject 拦非对象 JSON：
 * `JSON.parse('null')` 是合法的，但拿它读 `msg.method` 会抛 TypeError，
 * 而这个异常发生在 socket 回调里会直接杀死服务进程。
 */
describe('safeParseObject', () => {
  it('returns the object for object JSON', () => {
    expect(safeParseObject('{"method":"node/get","id":1}')).toEqual({ method: 'node/get', id: 1 })
  })

  it('rejects null (the crash class this guards against)', () => {
    expect(safeParseObject('null')).toBeNull()
  })

  it('rejects arrays and primitives', () => {
    expect(safeParseObject('[]')).toBeNull()
    expect(safeParseObject('[{"a":1}]')).toBeNull()
    expect(safeParseObject('1')).toBeNull()
    expect(safeParseObject('"text"')).toBeNull()
    expect(safeParseObject('true')).toBeNull()
  })

  it('rejects malformed JSON and empty input', () => {
    expect(safeParseObject('{bad}')).toBeNull()
    expect(safeParseObject('')).toBeNull()
    expect(safeParseObject(undefined)).toBeNull()
  })

  it('keeps nested structures intact', () => {
    expect(safeParseObject('{"result":{"content":[{"type":"text"}]}}')).toEqual({
      result: { content: [{ type: 'text' }] },
    })
  })
})
