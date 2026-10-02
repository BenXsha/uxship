/**
 * 跨平台复制 src/assets → dist/assets
 *
 * 替代 Windows-only 的 xcopy，兼容 macOS / Linux / Windows。
 * 使用 Node.js 16.7+ 内置的 fs.cpSync（无需第三方依赖）。
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

const src = join(projectRoot, 'src', 'assets')
const dest = join(projectRoot, 'dist', 'assets')

if (!existsSync(src)) {
  console.error(`错误: 源目录不存在: ${src}`)
  process.exit(1)
}

// 先清空 dest 再拷贝。
// `cpSync` 只**合并**、不删除 —— 源里已移除的集合（如 brand-logos）会作为陈旧文件**残留**在
// dist/ 里，最终随 npm 包发出去。（曾因此把已移出仓库的 1863 个第三方 Logo 又装进了包。）
if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true })
}
mkdirSync(dest, { recursive: true })

cpSync(src, dest, { recursive: true, force: true })

console.log(`Assets copied: ${src} → ${dest}`)

// 第三方许可声明必须**随分发**（Remix Icon License v1.0 §5）。
// dist/assets/remixicon/ 会随 npm 包发出，声明也得跟着走 —— 放在包根之外不会被 npm 收录。
const noticesSrc = join(projectRoot, '..', 'THIRD-PARTY-NOTICES.md')
const noticesDest = join(projectRoot, 'dist', 'THIRD-PARTY-NOTICES.md')
if (existsSync(noticesSrc)) {
  cpSync(noticesSrc, noticesDest)
  console.log('Notices copied: THIRD-PARTY-NOTICES.md → dist/')
} else {
  console.warn(`警告: 未找到 ${noticesSrc} —— 图标随包分发却缺少许可声明`)
}
