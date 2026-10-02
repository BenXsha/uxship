import { dslToCode, dslToFullHtml, validateDSL, generateSvgFiles } from './dsl-to-code.js'
import { fetchIcon, searchIcons, buildIconDSL } from './icon-utils.js'
import { computeDslHash, detectChangedComponents } from './design-cache.js'

export interface LocalToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export async function executeLocalTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'design_to_code': {
      const dsl = args.dsl as { version: string; elements: unknown[] }
      const options = args.options as Record<string, unknown> | undefined
      if (!dsl || typeof dsl !== 'object') {
        throw new Error('dsl parameter is required and must be an object')
      }
      const validation = validateDSL(dsl)
      if (!validation.valid) {
        return { valid: false, errors: validation.errors }
      }
      let files: Record<string, string> | undefined
      if (options?.exportSvgs) {
        const svgResult = await generateSvgFiles(dsl as any, { exportSvgs: true, svgOutputDir: (options.svgOutputDir as string) || 'icons' })
        files = svgResult.files
      }
      let tokens: any
      if (options?.exportTokens) {
        const { dslToTokens } = await import('./dsl-tokens.js')
        const tokenResult = dslToTokens(dsl as any, {
          darkMode: !!(options as any)?.darkMode,
          brand: ((options as any)?.theme?.brand) as string | undefined,
        })
        tokens = { css: tokenResult.css, tailwind: tokenResult.tailwind, dtcg: tokenResult.dtcg, collection: tokenResult.collection, ...(tokenResult.palette ? { palette: tokenResult.palette } : {}) }
      }
      // 宿主原生 CSS 只能在插件侧按真实节点生成；本地 DSL 路径如实说明不可用（不伪造 CSS）
      const hostCss = options?.exportCss
        ? { available: false, reason: 'exportCss 需要 nodeId 且插件在线（本地 DSL 路径没有真实节点）' }
        : undefined
      const syncedTokens = options?.syncTokens
        ? { ok: false, reason: 'syncTokens 需要插件在线（令牌只能建在画布上）' }
        : undefined
      return { dsl, files, tokens, hostCss, syncedTokens }
    }

    case 'dsl_to_full_html': {
      const dsl = args.dsl as { version: string; elements: unknown[] }
      const title = args.title as string | undefined
      const options = args.options as Record<string, unknown> | undefined
      if (!dsl || typeof dsl !== 'object') {
        throw new Error('dsl parameter is required and must be an object')
      }
      const validation = validateDSL(dsl)
      if (!validation.valid) {
        return {
          valid: false,
          errors: validation.errors,
          html: '',
        }
      }
      const html = await dslToFullHtml(dsl as any, { ...options, title })
      return {
        html,
        title: title || 'Generated from MasterGo',
      }
    }

    case 'icon_get': {
      const name = args.name as string
      if (!name || typeof name !== 'string') {
        throw new Error('name parameter is required and must be a string')
      }
      const icon = await fetchIcon(name)
      return {
        svgPathData: icon.svgPathData,
        viewBox: icon.viewBox,
        iconName: icon.iconName,
        paths: icon.paths.map(p => ({
          d: p.d,
          fill: p.fill,
          stroke: p.stroke,
          strokeWidth: p.strokeWidth,
        })),
      }
    }

    case 'icon_search': {
      const query = args.query as string
      const limit = (args.limit as number) || 20
      const prefix = args.prefix as string | undefined
      if (!query || typeof query !== 'string') {
        throw new Error('query parameter is required and must be a string')
      }
      const result = await searchIcons(query, limit, prefix)
      return {
        total: result.total,
        icons: result.icons,
        collections: result.collections,
        usage: 'Use icon_get or icon_render with "prefix:name" (e.g. "ri:tools-line")',
      }
    }

    case 'icon_render': {
      const name = args.name as string
      const x = (args.x as number) || 0
      const y = (args.y as number) || 0
      const size = (args.size as number) || 24
      const color = (args.color as string) || '#333333'
      const bgColor = args.bgColor as string | undefined
      const cornerRadius = (args.cornerRadius as number) || 0
      const strokeWidth = args.strokeWidth as number | undefined
      if (!name || typeof name !== 'string') {
        throw new Error('name parameter is required and must be a string')
      }
      const icon = await fetchIcon(name)
      const dsl = buildIconDSL(icon, {
        x, y, size, color, bgColor,
        cornerRadius: bgColor ? cornerRadius : undefined,
        strokeWidth,
      })
      return {
        iconName: icon.iconName,
        svgPathData: icon.svgPathData,
        paths: icon.paths.map(p => ({
          d: p.d,
          fill: p.fill,
          stroke: p.stroke,
          strokeWidth: p.strokeWidth,
        })),
        dsl: {
          version: '2.0',
          elements: [dsl],
        },
        hint: 'Use icon_render to directly render this icon onto the canvas, or pass the "dsl" to code_to_design',
      }
    }

    case 'design_to_code_update': {
      const sessionId = args.sessionId as string
      const dsl = args.dsl as { version: string; elements: any[] } | undefined
      const framework = (args.framework as string) || 'html'

      if (!sessionId || typeof sessionId !== 'string') {
        throw new Error('sessionId is required')
      }
      if (!dsl || typeof dsl !== 'object') {
        throw new Error('dsl parameter is required (re-export the changed nodes)')
      }

      const validation = validateDSL(dsl)
      if (!validation.valid) {
        return { valid: false, errors: validation.errors, warnings: ['DSL validation failed'] }
      }

      // Compute hash for change detection
      const newHashes: Record<string, { full: string; noPosition: string }> = {}
      for (const el of dsl.elements || []) {
        const name = el.name || 'anonymous'
        newHashes[name] = computeDslHash(el)
      }

      // Detect changes vs regenerate full code as baseline
      const codeResult = await dslToCode(dsl as any, { framework: framework as any } as any)

      return {
        sessionId,
        framework,
        html: codeResult.html,
        parts: newHashes,
        warnings: codeResult.warnings,
        stats: {
          ...codeResult.stats,
          elementsCount: (dsl.elements || []).length,
          changeHashes: Object.fromEntries(
            Object.entries(newHashes).map(([k, v]) => [k, v.full])
          ),
        },
      }
    }

    default: {
      throw new Error(`Unknown local tool: ${toolName}`)
    }
  }
}
