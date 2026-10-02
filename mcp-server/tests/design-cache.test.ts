import { describe, it, expect } from 'vitest'
import { computeDslHash, computePropsSignature } from '../src/utils/design-cache.js'
import type { DSLElement } from '../src/dsl-types.js'

describe('computeDslHash', () => {
  it('returns same hash for identical elements', () => {
    const el: DSLElement = { type: 'rectangle', name: 'box', x: 0, y: 0, width: 100, height: 50 }
    const a = computeDslHash(el)
    const b = computeDslHash(el)
    expect(a.full).toBe(b.full)
    expect(a.noPosition).toBe(b.noPosition)
  })

  it('returns different hashes for different elements', () => {
    const a = computeDslHash({ type: 'rectangle', name: 'box', x: 0, y: 0, width: 100, height: 50 })
    const b = computeDslHash({ type: 'text', name: 'label', x: 0, y: 0, width: 100, height: 50 })
    expect(a.full).not.toBe(b.full)
  })

  it('full hash includes position', () => {
    const a = computeDslHash({ type: 'rectangle', name: 'box', x: 0, y: 0, width: 100, height: 50 })
    const b = computeDslHash({ type: 'rectangle', name: 'box', x: 10, y: 20, width: 100, height: 50 })
    expect(a.full).not.toBe(b.full)
  })

  it('noPosition hash ignores position', () => {
    const a = computeDslHash({ type: 'rectangle', name: 'box', x: 0, y: 0, width: 100, height: 50 })
    const b = computeDslHash({ type: 'rectangle', name: 'box', x: 10, y: 20, width: 100, height: 50 })
    expect(a.noPosition).toBe(b.noPosition)
  })

  it('handles nested children', () => {
    const el: DSLElement = {
      type: 'frame',
      name: 'container',
      x: 0, y: 0, width: 200, height: 200,
      children: [
        { type: 'rectangle', name: 'child', x: 0, y: 0, width: 50, height: 50 },
      ],
    }
    const hash = computeDslHash(el)
    expect(hash.full).toBeTruthy()
  })

  it('returns consistent 8-char hex string', () => {
    const hash = computeDslHash({ type: 'ellipse', name: 'circle', x: 0, y: 0, width: 50, height: 50 })
    expect(hash.full).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('computePropsSignature', () => {
  it('returns same hash for same props', () => {
    const a = computePropsSignature({ type: 'text', name: 't', x: 0, y: 0, width: 100, height: 50, content: 'hello', fontSize: 16 } as any)
    const b = computePropsSignature({ type: 'text', name: 't', x: 0, y: 0, width: 100, height: 50, content: 'hello', fontSize: 16 } as any)
    expect(a).toBe(b)
  })

  it('returns different hash for different content', () => {
    const a = computePropsSignature({ type: 'text', name: 't', x: 0, y: 0, width: 100, height: 50, content: 'hello' } as any)
    const b = computePropsSignature({ type: 'text', name: 't', x: 0, y: 0, width: 100, height: 50, content: 'world' } as any)
    expect(a).not.toBe(b)
  })

  it('handles fill colors', () => {
    const el = {
      type: 'rectangle',
      name: 'box',
      fills: [{ type: 'SOLID', color: '#FF0000' }],
    }
    const hash = computePropsSignature(el as any)
    expect(hash).toBeTruthy()
  })
})
