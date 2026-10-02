import { describe, it, expect } from 'vitest'
import { resolve, join, sep } from 'node:path'
import { isSafeSavePath } from '../src/utils/image-export.js'
import { isSafePath } from '../src/utils/code-to-design-service.js'

/**
 * 路径白名单边界回归测试
 *
 * 历史缺陷：守卫用 `resolved.startsWith(dir)` 判断，导致与白名单目录**同前缀的兄弟目录**
 * 被放行（例如 `/work/proj-evil/x.png` 能通过 `/work/proj` 的检查）。
 * 必须用「目录 + 路径分隔符」做边界判断。
 */
const CWD = resolve(process.cwd())
const SIBLING = `${CWD}-evil`

describe.each([
  ['isSafeSavePath (node_export_image.saveToPath)', isSafeSavePath],
  ['isSafePath (code_to_design.filePath)', isSafePath],
])('%s', (_label, guard) => {
  it('允许工作目录内的路径', () => {
    expect(guard(join(CWD, 'tmp', 'design.png'))).toBe(true)
    expect(guard(CWD)).toBe(true)
  })

  it('拒绝同前缀兄弟目录（前缀绕过）', () => {
    expect(guard(join(SIBLING, 'design.png'))).toBe(false)
    expect(guard(`${SIBLING}${sep}design.png`)).toBe(false)
  })

  it('拒绝相对路径逃逸', () => {
    expect(guard(join(CWD, '..', '..', 'etc', 'passwd'))).toBe(false)
    expect(guard('../outside.png')).toBe(false)
  })

  it('拒绝绝对路径之外的位置', () => {
    expect(guard('/etc/hosts')).toBe(false)
  })

  it('规范化后仍按边界判定（.. 与多余分隔符）', () => {
    expect(guard(join(CWD, 'a', '..', 'b.png'))).toBe(true)
    expect(guard(`${CWD}//a//b.png`)).toBe(true)
  })
})
