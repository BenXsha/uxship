import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SERVER_VERSION } from '../src/version.js'

/**
 * 版本号一致性门禁
 *
 * 历史缺陷：版本硬编码在 4 处（sdk-server / ws-bridge / register-tools / tool-handlers），
 * 实测 `initialize` 报 2.0.0 而 `health_get` 报 2.3.0 —— 客户端与服务端互相矛盾。
 * 现在唯一来源是 package.json，本文件同时守住"将来别再硬编码"。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = resolve(HERE, '..')
const SRC_DIR = join(SERVER_ROOT, 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

describe('版本号唯一来源', () => {
  it('SERVER_VERSION 等于 package.json 的 version', () => {
    const pkg = JSON.parse(readFileSync(join(SERVER_ROOT, 'package.json'), 'utf-8'))
    expect(SERVER_VERSION).toBe(pkg.version)
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('src/ 下不再出现硬编码的版本字面量（version.ts 除外）', () => {
    const offenders = walk(SRC_DIR)
      .filter((file) => !file.endsWith(`${'version'}.ts`))
      .filter((file) => /['"]\d+\.\d+\.\d+['"]/.test(readFileSync(file, 'utf-8')))
      .map((file) => file.replace(`${SERVER_ROOT}/`, ''))
    expect(offenders).toEqual([])
  })
})

describe('插件版本跟随服务端（单一事实来源）', () => {
  const REPO_ROOT = resolve(SERVER_ROOT, '..')

  it('plugin-penpot / plugin-mastergo 的 package.json 版本都等于服务端版本', () => {
    for (const dir of ['plugin-penpot', 'plugin-mastergo']) {
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, dir, 'package.json'), 'utf-8'))
      expect(pkg.version, `${dir} 版本应与服务端一致（插件是宿主适配器，须同版本）`).toBe(SERVER_VERSION)
    }
  })

  it('plugin-penpot 构建时从服务端 package.json 取版本（不再钉死自身 version）', () => {
    const vite = readFileSync(join(REPO_ROOT, 'plugin-penpot', 'vite.config.ts'), 'utf-8')
    expect(vite).toContain('../mcp-server/package.json')
  })
})
