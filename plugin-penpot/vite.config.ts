import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, type BuildOptions } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * plugin-penpot 构建配置
 *
 * 与 plugin-mastergo 保持同一套「双 target」约定：
 *   TARGET=ui   → dist/index.html（插件 UI iframe，Vue 应用）
 *   TARGET=main → dist/plugin.js （插件 code 上下文，无 DOM 的逻辑层）
 *
 * 与 MasterGo 侧的差异：
 *   - Penpot 的插件 UI 由 Penpot 从插件站点按 URL 加载（同源），因此 `base: './'`，
 *     不需要 viteSingleFile 把 UI 压成 data URL。
 *   - public/ 下的 manifest.json + icon.svg 会被原样拷进 dist/，
 *     dist/ 即插件站点根目录（manifest URL = http://<host>:<port>/manifest.json）。
 */

const target = process.env.TARGET

/** 本包 package.json（作为读不到服务端版本时的兜底）；读不到也不让构建挂死 */
function readOwnVersion(): string {
  try {
    const own = JSON.parse(readFileSync(resolve(__dirname, './package.json'), 'utf-8'))
    return typeof own.version === 'string' && own.version ? own.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * 插件版本号的**唯一来源 = MCP 服务端**的 package.json。
 *
 * 为何不再用本包的 version：插件是服务端的**宿主适配器**，两者必须同版本 ——
 * 之前本包写死 `0.1.0`、而服务端已 2.x，面板显示的版本永远对不上，
 * 也没法用版本号判断“插件与服务端是否配套”。读不到兄弟包时（如单独拷贝出去构建）
 * 退回本包版本并**告警**，不静默。
 */
function resolvePluginVersion(): string {
  try {
    const serverPkg = JSON.parse(readFileSync(resolve(__dirname, '../mcp-server/package.json'), 'utf-8'))
    if (typeof serverPkg.version === 'string' && serverPkg.version) return serverPkg.version
  } catch {
    console.error('[vite] 读不到 ../mcp-server/package.json 的版本 —— 退回本包版本，可能与服务端不一致')
  }
  return readOwnVersion()
}

const PLUGIN_VERSION: string = resolvePluginVersion()

/**
 * 自建 WS hub 默认地址。
 *
 * 见 内部笔记 §12.4：走协议 B（自建 hub，
 * 插件继续讲本项目的 JSON-RPC），而不是连官方 @penpot/mcp 的 executeCode 通道。
 *
 * 默认 **15489 = 服务端的共联单 hub**：同一个端口同时接 MasterGo 与 Penpot 两种插件，
 * 按 initialize 自述的后端分区（会话前缀 sess_ / sess_penpot_）。用户只需记一个端口。
 * 若服务端开了分端口模式（UXSHIP_MCP_SEPARATE_PORTS=1），Penpot 在 4404，
 * 用 PENPOT_HUB_URL=ws://localhost:4404 覆盖即可。
 */
const DEFAULT_HUB_URL = process.env.PENPOT_HUB_URL || 'ws://localhost:15489'

export default defineConfig(() => {
  const buildConfig = target === 'ui'
    ? {
        target: 'esnext',
        // 全部内联：Penpot 从插件站点加载 iframe，减少请求数
        assetsInlineLimit: 100000000,
        chunkSizeWarningLimit: 100000000,
        cssCodeSplit: false,
        rollupOptions: {
          input: resolve(__dirname, './index.html'),
          // inlineDynamicImports 已经保证「所有内容进一个 chunk」，
          // 因此不能再同时指定 manualChunks（rollup 会直接报错）
          output: {
            inlineDynamicImports: true,
          },
        },
      }
    : target === 'harness'
      ? {
          // 客户端渲染 harness（真实浏览器里跑 HTML → DSL → 宿主）
          target: 'esnext',
          rollupOptions: { input: resolve(__dirname, './dev/harness.html') },
        }
      : {
          lib: {
            entry: resolve(__dirname, './lib/main.ts'),
            name: 'mgMcpPenpotPlugin',
            // IIFE：Penpot 以 <script> 方式加载 code 字段，不需要模块系统
            formats: ['iife'],
            fileName: () => 'plugin.js',
          },
        }

  return {
    base: './',
    plugins: [vue()],
    define: {
      __PLUGIN_VERSION__: JSON.stringify(PLUGIN_VERSION),
      __DEFAULT_HUB_URL__: JSON.stringify(DEFAULT_HUB_URL),
    },
    build: {
      ...(buildConfig as BuildOptions),
      // harness 单独输出目录：它是开发/验证工具，不进插件发布物
      outDir: target === 'harness' ? 'harness-dist' : 'dist',
      // 两个 target 依次写入同一个 dist/，第二次构建不能清空第一次的产物
      emptyOutDir: target === 'harness',
    },
    resolve: {
      alias: {
        '@lib': resolve(__dirname, './lib'),
        '@ui': resolve(__dirname, './ui'),
        '@messages': resolve(__dirname, './messages'),
      },
    },
  }
})
