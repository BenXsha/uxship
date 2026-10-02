/**
 * 本地文件读写的路径白名单守卫 —— `code_to_design.filePath` 与 `node_export*.savePath` 共用的**单一来源**。
 *
 * ## 两个历史缺陷（都踩过）
 *
 * 1. **前缀判断绕过**：早期用 `resolved.startsWith(dir)`，于是与白名单目录**同前缀的兄弟目录**被放行
 *    （`/work/proj-evil/x.png` 能通过 `/work/proj` 的检查）。必须用「目录 + 路径分隔符」做边界。
 *
 * 2. **白名单只有 `process.cwd()`** —— 于是「能用哪些文件」取决于**服务端是怎么启动的**：
 *    - systemd / 常驻脚本以**仓库根**为 cwd → 能渲染 `examples/*.html`；
 *    - `npm run dev`（`cd mcp-server && tsx watch src/index.ts`）以 `mcp-server/` 为 cwd → 同一个路径被拒；
 *    - 由 MCP 客户端直接拉起（stdio）时 cwd 常是包目录 → **用户自己项目的文件全在范围外**。
 *    表现统一是 `Access denied: … must be within the project directory`，看起来像工具坏了，其实是启动位置问题。
 *
 * ## 现在的口径（按优先级，去重后合并）
 *
 * 1. `UXSHIP_ALLOWED_BASE_DIRS` —— 用**路径分隔符**分隔的显式信任根（`path.delimiter`，Linux/macOS 是 `:`）。
 *    这是给「项目在别处」这类场景的出口，也是唯一需要文档化的开关。
 * 2. `process.cwd()` —— 调用方的工作目录，最常见的意图；保持向后兼容。
 * 3. 本包所在位置及其父目录 —— 也就是「你正在运行的服务端代码所在处」。
 *    信任它不会扩大攻击面（那本来就是你自己装/自己 clone 的代码），但让**从仓库里渲染文件**
 *    在任何启动方式下都成立 —— 这正是上面第 2 条那个坑的修复。
 *
 * 仍会拒绝：不在任何根之下的绝对路径、`..` 逃逸、同前缀兄弟目录（都先 `resolve(normalize())` 再判定）。
 */
import { delimiter, dirname, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `UXSHIP_ALLOWED_BASE_DIRS` 里显式声明的根（按 `path.delimiter` 分隔） */
function envBaseDirs(): string[] {
  const raw = process.env.UXSHIP_ALLOWED_BASE_DIRS
  if (!raw) return []
  const dirs: string[] = []
  for (const entry of raw.split(delimiter)) {
    const trimmed = entry.trim()
    if (trimmed) dirs.push(resolve(trimmed))
  }
  return dirs
}

/**
 * 本包所在目录及其父目录。
 *
 * 本文件在源码与产物里的深度一致（`src/utils/` 与 `dist/utils/`），所以 `../..` 永远是包根
 * （`mcp-server/`），再往上一级是仓库根（本地 clone）或 npm 作用域目录（全局安装）。
 */
function packageBaseDirs(): string[] {
  const here = dirname(fileURLToPath(import.meta.url))
  const packageRoot = resolve(here, '..', '..')
  const workspaceRoot = resolve(packageRoot, '..')
  return [packageRoot, workspaceRoot]
}

/**
 * 当前生效的全部信任根（每次调用重新计算，便于测试与运行期改环境变量）。
 * 导出给单测与诊断工具（`plugin_capabilities` 这类想如实上报「你能读写哪里」的地方）。
 */
export function allowedBaseDirs(): string[] {
  return [...new Set([...envBaseDirs(), resolve(process.cwd()), ...packageBaseDirs()])]
}

/**
 * 路径是否落在任一信任根之内（读写共用）。
 *
 * 边界判断必须带分隔符：`resolved === dir` 单独判是为了允许根目录自身。
 */
export function isWithinAllowedDirs(input: string): boolean {
  const resolved = resolve(normalize(input))
  return allowedBaseDirs().some((dir) => resolved === dir || resolved.startsWith(dir + sep))
}

/**
 * 路径被拒时的统一报错文案。
 *
 * 关键是把**当前生效的根**打出来 —— 否则用户看到「must be within the project directory」
 * 却不知道那个「project directory」到底指哪里，只能猜（这正是第 2 个缺陷难排查的原因）。
 */
export function pathDeniedMessage(kind: 'filePath' | 'savePath' | 'saveToPath'): string {
  const roots = allowedBaseDirs()
  return [
    `Access denied: ${kind} must be within an allowed directory`,
    `允许的根（${roots.length}）：`,
    ...roots.map((dir) => `  - ${dir}`),
    '若目标在别处：从该目录（或其父目录）启动服务端，或设置 UXSHIP_ALLOWED_BASE_DIRS（路径分隔符分隔）',
  ].join('\n')
}
