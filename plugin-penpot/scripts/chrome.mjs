/**
 * 定位一个可用于 CDP 的 Chromium —— 三个脚本（harness-render / ui-shot / …）共用。
 *
 * 为什么需要它：这两个脚本原先各自硬编码了一条 **macOS** 路径
 * （`~/Library/Caches/ms-playwright/chromium-1234/chrome-mac-x64/…`），
 * 于是换台机器（Linux、或 playwright 换了版本号）就直接跑不起来，而且失败信息是
 * 「CDP 未就绪（Chrome 没启动成功？）」—— 看不出是路径问题还是浏览器问题。
 *
 * 两个刻意的取舍：
 *
 * 1. **只用完整 Chromium，不用 headless-shell。**
 *    playwright 会把两者都装到 `~/.cache/ms-playwright/`：`chromium-<rev>`（完整）与
 *    `chromium_headless_shell-<rev>`。headless-shell **不触发 requestAnimationFrame**，
 *    而渲染引擎靠 rAF 判断「浏览器已排版完成」，用它会直接卡住。所以这里按目录名前缀过滤。
 *
 * 2. **不自动加 `--no-sandbox`。**
 *    Ubuntu 23.10+ / 26.04 默认用 AppArmor 关掉了**非特权 user namespace**，Chromium 的
 *    沙箱因此起不来，报：
 *
 *        FATAL: ... No usable sandbox! If you are running on Ubuntu 23.10+ ... you can try
 *        using --no-sandbox.
 *
 *    这是**环境限制**，不是脚本缺陷，而且关沙箱是有代价的决定（渲染的是本仓库自己的 HTML
 *    时可接受，渲染不可信内容时不是）。所以把决定权交给调用方：`CHROME_FLAGS=--no-sandbox`。
 *
 * 用法：
 *   const chrome = resolveChrome()                 // 找不到时返回 null，调用方自己报错
 *   spawn(chrome, [...CDP_BASE_FLAGS, ...extraChromeFlags()])
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** playwright 缓存根（Linux 与 macOS 各一个） */
const CACHE_ROOTS = [
  join(homedir(), '.cache', 'ms-playwright'),
  join(homedir(), 'Library', 'Caches', 'ms-playwright'),
]

/** 一个完整 Chromium 目录下，可执行文件可能所在的位置 */
const EXECUTABLE_PATHS = [
  'chrome-linux64/chrome',
  'chrome-linux/chrome',
  'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
]

/** 能找到的所有完整 Chromium（跳过 headless-shell），新的排前面 */
export function findChromeCandidates() {
  const found = []
  for (const root of CACHE_ROOTS) {
    if (!existsSync(root)) continue
    let entries = []
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const dir of entries) {
      // 只要完整 Chromium；`chromium_headless_shell-*` 不触发 rAF，用了会卡住引擎
      if (!dir.startsWith('chromium-')) continue
      for (const rel of EXECUTABLE_PATHS) {
        const candidate = join(root, dir, rel)
        if (existsSync(candidate)) found.push(candidate)
      }
    }
  }
  return found.sort().reverse()
}

/**
 * 解析要用的 Chromium：`CHROME_PATH` 优先，否则在 playwright 缓存里找。
 * @returns 可执行文件绝对路径；找不到返回 null（**由调用方给出可操作的报错**，不要静默退化）
 */
export function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  return findChromeCandidates()[0] ?? null
}

/** 找不到浏览器时统一的可操作报错文案 */
export function chromeNotFoundMessage() {
  return [
    '未找到可用的 Chromium。',
    '  1) 安装浏览器：npx playwright install chromium',
    '  2) 或显式指定：CHROME_PATH=/path/to/chrome',
    '注意必须用**完整 Chromium**（chromium-<rev>），不能用 chrome-headless-shell —— 它不触发',
    'requestAnimationFrame，引擎会卡住。',
  ].join('\n')
}

/**
 * `CHROME_FLAGS` 里的额外参数（空格分隔）。
 *
 * Ubuntu 23.10+ 上跑 CDP 需要它：
 *   CHROME_FLAGS=--no-sandbox npm run harness:render -- <file>
 * 关沙箱意味着渲染不可信内容时没有隔离 —— 本仓库的用例是渲染仓库内自己的 HTML，可接受。
 */
export function extraChromeFlags() {
  return (process.env.CHROME_FLAGS ?? '').split(/\s+/).filter(Boolean)
}
