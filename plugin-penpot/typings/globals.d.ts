/**
 * 构建期注入的全局常量声明
 *
 * 由 vite.config.ts 的 define 注入，保证版本号与 hub 地址只有一个真实来源。
 */
declare const __PLUGIN_VERSION__: string
declare const __DEFAULT_HUB_URL__: string
