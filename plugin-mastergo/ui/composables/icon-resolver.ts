export async function waitForImages(container: HTMLElement): Promise<void> {
  const imgs = Array.from(container.querySelectorAll('img'))
  if (imgs.length === 0) return
  console.log('[waitForImages] 发现图片数量:', imgs.length)
  await Promise.allSettled(imgs.map(img => {
    console.log('[waitForImages] 图片:', img.src?.substring(0, 50), 'complete=', img.complete, 'naturalW=', img.naturalWidth)
    if (img.complete && img.naturalWidth > 0) {
      console.log('[waitForImages] 图片已加载完成')
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[waitForImages] 图片加载超时:', img.src?.substring(0, 50))
        resolve()
      }, 5000)
      img.onload = () => {
        clearTimeout(timeout)
        console.log('[waitForImages] 图片 onload')
        resolve()
      }
      img.onerror = () => {
        clearTimeout(timeout)
        console.warn('[waitForImages] 图片 onerror')
        resolve()
      }
    })
  }))
}

async function resolveIcon(el: HTMLElement): Promise<void> {
  const icon = el.getAttribute('data-icon') || ''
  const parts = icon.split(':')
  const prefix = parts.length > 1 ? parts[0] : 'ri'
  const name = parts.length > 1 ? parts[1] : parts[0]
  try {
    const resp = await fetch(`https://api.iconify.design/${prefix}/${name}.svg`, { signal: AbortSignal.timeout(5000) })
    if (!resp.ok) return
    let svg = await resp.text()
    const color = window.getComputedStyle(el).color
    if (color && color !== 'rgba(0, 0, 0, 0)') {
      svg = svg.replace(/currentColor/gi, color)
    }
    ;(el as any).__resolvedSvg = svg
  } catch (error) {
    // 取不到图标只是“这个图标没有矢量内容”，不该中断整页渲染 —— 但必须留一条可见日志，
    // 否则「图标没渲染」会被当成引擎/宿主的问题去查（网络失败与解析失败也会被混在一起）。
    console.warn(`[resolveIcon] 获取图标失败: ${prefix}:${name}`, error)
  }
}

export async function resolveDataIcons(root: Element): Promise<void> {
  const els = Array.from(root.querySelectorAll('[data-icon]')).filter(el => {
    const tag = el.tagName.toLowerCase()
    return tag !== 'img'
  }) as HTMLElement[]
  const fetches: Promise<void>[] = []
  for (const el of els) {
    fetches.push(resolveIcon(el))
  }
  await Promise.allSettled(fetches)
}

export async function resolveBgImageData(root: Element, imageDataCache: Map<string, string>): Promise<void> {
  const els = Array.from(root.querySelectorAll('[style*="background"]')) as HTMLElement[]
  console.log('[resolveBgImageData] 找到', els.length, '个带内联 style*=background 的元素')
  for (const el of els) {
    const bg = window.getComputedStyle(el).backgroundImage
    console.log('[resolveBgImageData] 元素:', el.className?.substring(0, 30), 'computed bgImage:', bg?.substring(0, 50))
    const urlMatch = bg.match(/url\(['"]?([^'"\)]+)['"]?\)/)
    if (urlMatch) {
      console.log('[resolveBgImageData] urlMatch:', urlMatch[1]?.substring(0, 50))
      if (urlMatch[1].startsWith('data:')) {
        const url = urlMatch[1]
        console.log('[resolveBgImageData] 发现 data URL')
        if (!imageDataCache.has(url)) {
          // 只有 `;base64` 的才是 base64。percent-encoded 的 data URI（SVG 常见）以前被当成
          // base64 原样写进 `imageData` → DSL 里是 `%3Csvg…`，宿主解码直接失败。
          // （Penpot 侧同一处修在 `plugin-penpot/ui/composables/icon-resolver.ts`）
          const base64 = dataUriToBase64Payload(url)
          if (base64 !== undefined) {
            imageDataCache.set(url, base64)
            console.log('[resolveBgImageData] 缓存图片数据, 长度=', base64.length)
          }
        }
        ;(el as any).__bgImageData = imageDataCache.get(url)
        console.log('[resolveBgImageData] 设置 __bgImageData:', (el as any).__bgImageData ? 'PRESENT' : 'MISSING')
      }
    }
  }
}

/**
 * data URI → base64 载荷（DSL `imageData` 口径）。非 data URI 返回 undefined。
 *
 * 引擎跑在**插件 UI iframe**（真实浏览器上下文），`TextEncoder`/`btoa` 可用；
 * 与 ``plugin-penpot`` 的 `lib/host/media.ts` 同逻辑（两份引擎各自打包，无法共享模块）。
 */
function dataUriToBase64Payload(url: string): string | undefined {
  if (!url.startsWith('data:')) return undefined
  const comma = url.indexOf(',')
  if (comma < 0) return undefined
  const meta = url.slice(0, comma)
  const payload = url.slice(comma + 1)
  if (/;base64/i.test(meta)) return payload

  const bytes = new TextEncoder().encode(decodeURIComponent(payload))
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}
