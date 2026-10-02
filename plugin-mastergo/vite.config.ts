import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, BuildOptions } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from "vite-plugin-singlefile"

const target = process.env.TARGET

/** 插件版本号唯一来源：package.json */
const pkg = JSON.parse(readFileSync(resolve(__dirname, './package.json'), 'utf-8'))
const PLUGIN_VERSION: string = pkg.version

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