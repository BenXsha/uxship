/**
 * 服务端版本号的唯一来源
 *
 * 历史上版本号硬编码在 4 处（`sdk-server` / `ws-bridge` / `register-tools` / `tool-handlers`），
 * 实测出现"`initialize` 报 2.0.0、`health_get` 报 2.3.0"的不一致。
 * 现在统一从 `package.json` 读，双端（src 与 dist）路径一致：两者都在包根下一级。
 *
 * 用 fs 读取而不是 `import pkg from '../package.json' with {...}`：
 * 后者需要 `resolveJsonModule` 且会把包元数据打进产物，fs 读取对 dev/dist 都成立。
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const candidate of ['../package.json', '../../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(join(here, candidate), 'utf-8'))
      if (pkg && typeof pkg.version === 'string' && pkg.version) return pkg.version
    } catch {
      // 尝试下一个候选路径
    }
  }
  return '0.0.0'
}

export const SERVER_VERSION: string = readVersion()
