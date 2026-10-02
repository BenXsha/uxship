import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const configDir = import.meta.dirname

/**
 * 插件端单测配置
 *
 * 与 plugin-mastergo 一致：独立于 vite.config.ts（后者按 TARGET=ui|main 走两套构建）。
 *
 * 关键差异：本项目的生产代码**不依赖全局 `penpot`**，而是通过 `HostAdapter` 接口访问宿主
 * （见 lib/host/types.ts）。因此单测不需要为宿主打全局桩，直接注入 `MemoryHost` 或一个
 * 断言用的假宿主即可 —— 这正是抽宿主端口带来的可测试性收益。
 */
export default defineConfig({
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
