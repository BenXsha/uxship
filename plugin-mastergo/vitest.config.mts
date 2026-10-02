import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const configDir = import.meta.dirname

/**
 * 插件端单测配置
 *
 * 说明：
 * - 独立于 vite.config.ts（后者按 TARGET=ui|main 走两套构建，不作为测试配置）
 * - 只跑 tests/ 下的用例；生产代码通过 `globalThis.mg` 桩（tests/helpers/mg-stub.ts）解耦宿主
 * - 本包同时依赖 vite@2（插件构建）与 vitest@4（需要 vite≥6）：`yarn install` 会出现
 *   peer dependency 告警，这是预期的 —— yarn 会把 vitest 自带的 vite 嵌套装到
 *   `node_modules/vitest/node_modules/`，两条链路互不干扰。
 */
export default defineConfig({
  // 与 vite.config.ts 保持一致的路径别名，便于测试直接引用 lib/ui 模块
  resolve: {
    alias: {
      '@lib': resolve(configDir, './lib'),
      '@ui': resolve(configDir, './ui'),
      '@messages': resolve(configDir, './messages'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
})
