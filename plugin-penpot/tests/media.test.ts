/**
 * `host/media.ts`：Penpot 媒体（图片）规则
 *
 * 这组用例锁的是**插件沙箱的真实约束**，不是算法本身：
 *   - 沙箱里**没有 `TextDecoder`/`TextEncoder`**（真机报 `TextDecoder is not a constructor`），
 *     所以 SVG 嗅探与 UTF-8 编码都不能依赖它们；
 *   - Penpot 只收 5 种 MIME、默认 30 MiB —— 提前判是为了给可读原因，而不是把宿主错误穿透。
 */
import { describe, expect, it } from 'vitest'
import {
  PENPOT_MEDIA_MAX_BYTES,
  decodeBase64,
  penpotMediaRejection,
  sniffImageMime,
  utf8Bytes,
} from '@lib/host/media'

const bytesOf = (text: string): Uint8Array => Uint8Array.from([...text].map((ch) => ch.charCodeAt(0)))

describe('host/media：Penpot 媒体规则', () => {
  it('从 magic bytes 识别允许的格式', () => {
    expect(sniffImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(sniffImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImageMime(bytesOf('GIF89a'))).toBe('image/gif')
    expect(sniffImageMime(bytesOf('RIFF????WEBP'))).toBe('image/webp')
    expect(sniffImageMime(bytesOf('  <svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml')
    expect(sniffImageMime(bytesOf('<?xml version="1.0"?><svg/>'))).toBe('image/svg+xml')
    // 认不出就返回 undefined（由调用方决定用 declaredMime 还是报错）
    expect(sniffImageMime(bytesOf('not an image'))).toBeUndefined()
  })

  it('SVG 嗅探不依赖 TextDecoder（插件沙箱里没有它）', () => {
    const saved = globalThis.TextDecoder
    // SAFETY: 只为测试把 TextDecoder 换成“一用就抛”的桩，类型仍是 typeof TextDecoder；用完在 finally 恢复。
    globalThis.TextDecoder = (function TextDecoder() {
      throw new Error('TextDecoder is not a constructor')
    }) as unknown as typeof TextDecoder
    try {
      expect(sniffImageMime(bytesOf('<?xml version="1.0"?><svg/>'))).toBe('image/svg+xml')
    } finally {
      globalThis.TextDecoder = saved
    }
  })

  it('utf8Bytes 与 Node Buffer 的 UTF-8 结果一致（含非 ASCII）', () => {
    const sample = 'a<svg/>图🙂'
    expect(Array.from(utf8Bytes(sample))).toEqual(Array.from(Buffer.from(sample, 'utf8')))
  })

  it('预检：不在 5 种之内 / 超过 30 MiB 都给可读原因；合规返回 null', () => {
    expect(penpotMediaRejection('image/avif', 100)).toMatch(/5 种/)
    expect(penpotMediaRejection(undefined, 100)).toMatch(/无法识别/)
    expect(penpotMediaRejection('image/png', PENPOT_MEDIA_MAX_BYTES + 1)).toMatch(/30MB/)
    expect(penpotMediaRejection('image/png', 100)).toBeNull()
  })

  it('decodeBase64 对非法输入给可读错误，对合法输入与 Buffer 一致', () => {
    expect(() => decodeBase64('!!!not base64!!!')).toThrow(/base64/)
    const sample = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]).toString('base64')
    expect(Array.from(decodeBase64(sample))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff])
  })
})
