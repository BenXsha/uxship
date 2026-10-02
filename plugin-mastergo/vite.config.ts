import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, BuildOptions } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from "vite-plugin-singlefile"

const target = process.env.TARGET

/** 本包 package.json（读不到服务端版本时的回退值） */
function readOwnVersion(): string {
  try {
    const own = JSON.parse(readFileSync(resolve(__dirname, './package.json'), 'utf-8'))
    return typeof own.version === 'string' && own.version ? own.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * 插件版本号的**唯一来源 = MCP 服务端**的 package.json（与 plugin-penpot 同口径）。
 *
 * 插件是服务端的宿主适配器，两者必须同版本 —— 否则面板显示的版本永远与服务端对不上，
 * 也没法用版本号判断「插件与服务端是否配套」。读不到兄弟包时退回本包版本并**告警**，不静默。
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

export default defineConfig(() => {
  const buildConfig = target === 'ui'
    ? {
        target: "esnext",
        assetsInlineLimit: 100000000,
        chunkSizeWarningLimit: 100000000,
        cssCodeSplit: false,
        brotliSize: false,
        rollupOptions: {
          inlineDynamicImports: true,
          output: {
            manualChunks: () => "ui.js",
          },
        },
      }
    : {
      lib: {
        entry: resolve(__dirname, './lib/main.ts'),
        name: 'myLib',
        formats: ['umd'],
        fileName: () => `main.js`
      },
    }

  return {
    plugins: [
      vue(),
      viteSingleFile()
    ],
    define: {
      // 构建期常量：插件版本号（UI 与插件主线程共用）
      __PLUGIN_VERSION__: JSON.stringify(PLUGIN_VERSION),
    },
    build: {
      ...buildConfig as BuildOptions,
      emptyOutDir: false
    },
    resolve: {
      alias: {
        "@lib": resolve(__dirname, './lib'),
        "@ui": resolve(__dirname, './ui'),
        "@messages": resolve(__dirname, './messages'),
      }
    },
  }
})