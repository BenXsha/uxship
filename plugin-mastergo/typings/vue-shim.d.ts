/**
 * Vue 单文件组件类型声明
 *
 * 让 `import App from './App.vue'` 通过类型检查（实际编译由 vite 处理）。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
