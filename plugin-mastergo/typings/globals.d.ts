/**
 * 构建期注入的全局常量声明
 *
 * 由 vite.config.ts 的 define 从 package.json 的 version 注入，
 * 保证插件版本号只有一个真实来源（plugin-mastergo/package.json）。
 */
declare const __PLUGIN_VERSION__: string
