import { describe, it, expect, afterEach } from 'vitest'
import { resolve, join, sep } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSafeSavePath } from '../src/utils/image-export.js'
import { isSafePath } from '../src/utils/code-to-design-service.js'
import { allowedBaseDirs } from '../src/utils/path-guard.js'

/**
 * 路径白名单边界回归测试
 *
 * ## 历史缺陷一：前缀绕过
 * 守卫曾用 `resolved.startsWith(dir)` 判断，导致与白名单目录**同前缀的兄弟目录**被放行
 * （`/work/proj-evil/x.png` 能通过 `/work/proj` 的检查）。必须用「目录 + 路径分隔符」做边界。
 *
 * ## 历史缺陷二：白名单只有 cwd（本文件的主体因此改过）
 * 白名单原先只有 `process.cwd()`，于是「能用哪些文件」取决于服务端**怎么启动**：
 * `npm run dev` 以 `mcp-server/` 为 cwd → 连本仓库的 `examples/*.html` 都被拒，
 * 报 `Access denied: … must be within the project directory`，看起来像工具坏了。
 * 现在信任根是 cwd + 本包所在仓库/包的根（+ `UXSHIP_ALLOWED_BASE_DIRS` 显式声明的），
 * 见 `src/utils/path-guard.ts`。
 *
 * ⚠️ 需要留意的两处**预期变化**（都是上面第二条的直接结果）：
 *   - 旧断言 `guard('../outside.png') === false` 现在应为 **true** —— 从 `mcp-server/` 出发
 *     解析到的是仓库根，它现在是合法信任根；
 *   - 因此「相对路径逃逸」改用 `../../` 来验证（从 `mcp-server/` 出发已越过仓库根）。
 */
const HERE = dirname(fileURLToPath(import.meta.url)) // <repo>/mcp-server/tests
const PACKAGE_ROOT = resolve(HERE, '..') // <repo>/mcp-server
const REPO_ROOT = resolve(HERE, '..', '..') // <repo>
const CWD = resolve(process.cwd()) // 由 `npm test` 决定，通常是 <repo>/mcp-server
const OUTSIDE_REPO = resolve(REPO_ROOT, '..') // 仓库根的上级，必须始终被拒

describe('allowedBaseDirs（信任根口径）', () => {
  it('至少包含 cwd 与本包所在位置，且去重', () => {
    const roots = allowedBaseDirs()
    expect(roots).toContain(CWD)
    expect(roots).toContain(PACKAGE_ROOT)
    expect(roots).toContain(REPO_ROOT)
    expect(new Set(roots).size).toBe(roots.length)
  })

  it('UXSHIP_ALLOWED_BASE_DIRS 可显式追加信任根', () => {
    const extra = resolve('/', 'tmp', 'uxship-allow-test')
    const before = process.env.UXSHIP_ALLOWED_BASE_DIRS
    process.env.UXSHIP_ALLOWED_BASE_DIRS = extra
    try {
      expect(allowedBaseDirs()).toContain(extra)
      // 追加后，该根之下的路径可读写
      expect(isSafeSavePath(join(extra, 'shot.png'))).toBe(true)
      expect(isSafePath(join(extra, 'page.html'))).toBe(true)
    } finally {
      if (before === undefined) delete process.env.UXSHIP_ALLOWED_BASE_DIRS
      else process.env.UXSHIP_ALLOWED_BASE_DIRS = before
    }
  })
})

describe.each([
  ['isSafeSavePath (node_export_image.saveToPath)', isSafeSavePath],
  ['isSafePath (code_to_design.filePath)', isSafePath],
])('%s', (_label, guard) => {
  it('允许工作目录内的路径', () => {
    expect(guard(join(CWD, 'tmp', 'design.png'))).toBe(true)
    expect(guard(CWD)).toBe(true)
  })

  it('允许本仓库内的路径（无论服务端从哪启动 —— 这条以前是失败的）', () => {
    // `npm run dev` 的 cwd 是 mcp-server/，而示例在仓库根的 examples/ 下
    expect(guard(join(REPO_ROOT, 'examples', '01-html-to-canvas.html'))).toBe(true)
    expect(guard(join(REPO_ROOT, 'mcp-server', 'tmp', 'x.png'))).toBe(true)
    expect(guard(REPO_ROOT)).toBe(true)
  })

  it('拒绝同前缀兄弟目录（前缀绕过）—— 必须以信任根为基准构造用例', () => {
    // 关键：拿**信任根**的兄弟目录。若拿 cwd 的兄弟目录（<repo>/mcp-server-evil），
    // 它其实在仓库根**之内**，现在本来就是合法的 —— 拿它测会把“允许”误当成漏判。
    // 真正的漏洞形态是 `startsWith(dir)` 漏掉分隔符：<Projects>/uxship-evil 通过 <Projects>/uxship 的检查。
    const repoEvil = `${REPO_ROOT}-evil`
    expect(guard(join(repoEvil, 'design.png'))).toBe(false)
    expect(guard(`${repoEvil}${sep}design.png`)).toBe(false)
  })

  it('拒绝越过仓库根的相对路径逃逸', () => {
    // `../../` 从 mcp-server/ 出发已越过仓库根（旧用例用的是 `../`，那条现在是合法的）
    expect(guard('../../outside.png')).toBe(false)
    expect(guard(join(OUTSIDE_REPO, 'outside.png'))).toBe(false)
  })

  it('拒绝绝对路径之外的位置', () => {
    expect(guard('/etc/hosts')).toBe(false)
    expect(guard(join(OUTSIDE_REPO, 'etc', 'passwd'))).toBe(false)
  })

  it('规范化后仍按边界判定（.. 与多余分隔符）', () => {
    expect(guard(join(CWD, 'a', '..', 'b.png'))).toBe(true)
    expect(guard(`${CWD}//a//b.png`)).toBe(true)
  })
})

afterEach(() => {
  delete process.env.UXSHIP_ALLOWED_BASE_DIRS
})
