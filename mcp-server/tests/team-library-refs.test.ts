import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { resolveTeamLibraryRefs } from '../src/utils/component-auto-map.js'
import { writeCache, type TeamLibraryEntry } from '../src/utils/team-library-cache.js'

/**
 * `resolveTeamLibraryRefs` 回归测试
 *
 * 锁住两件事：
 * 1. 常规实例引用 `data-library-component` 的既有行为不变
 * 2. 换组件指令 `data-swap-component` / `data-swap-library` 也会被解析为 `data-swap-ukey`
 *    （插件端 dsl-renderer 优先读 data-swap-* 作为目标组件）
 *
 * 索引来源：预先写入临时缓存，`ensureIndex` 命中缓存则不会访问插件，
 * 因此这里的 forwardRequest 一旦被调用就说明有回归。
 */

const LIBRARIES: TeamLibraryEntry[] = [
  {
    id: 'lib-1',
    name: '基础组件库',
    components: [
      { name: 'DS_Button', ukey: 'ukey-button', type: 'COMPONENT_SET', description: '按钮组件集', componentSetUkey: '' },
      { name: 'Button', ukey: 'ukey-button-single', type: 'COMPONENT' },
    ],
    styles: {
      paints: [],
      texts: [],
      spacings: [],
      effects: [],
      grids: [],
      strokeWidths: [],
      cornerRadiuses: [],
      paddings: [],
    },
  },
]

const forwardRequest = async () => {
  throw new Error('plugin should not be called: cache should be fresh')
}

let tmpDir: string
let cachePath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mg-teamrefs-'))
  cachePath = path.join(tmpDir, '.uxship', 'team-library.json')
  await writeCache(LIBRARIES, { cachePath })
  process.env.UXSHIP_TEAM_LIBRARY_CACHE = cachePath
})

afterEach(async () => {
  delete process.env.UXSHIP_TEAM_LIBRARY_CACHE
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('resolveTeamLibraryRefs — 常规实例引用', () => {
  it('rewrites data-library-component by name to data-library-ukey', async () => {
    const { html, resolved, warnings } = await resolveTeamLibraryRefs(
      '<div data-library-component="Button"></div>',
      forwardRequest,
    )
    expect(html).toContain('data-library-ukey="ukey-button-single"')
    expect(resolved).toHaveLength(1)
    expect(warnings).toEqual([])
  })

  it('removes the attribute and warns when the name is unknown', async () => {
    const { html, warnings } = await resolveTeamLibraryRefs(
      '<div data-library-component="不存在的组件"></div>',
      forwardRequest,
    )
    expect(html).not.toContain('data-library-component')
    expect(warnings[0]).toMatch(/未在团队库中找到组件/)
  })
})

describe('resolveTeamLibraryRefs — 换组件指令', () => {
  it('rewrites data-swap-component by name to data-swap-ukey', async () => {
    const { html, resolved } = await resolveTeamLibraryRefs(
      '<div data-swap-node-id="1:2" data-swap-component="Button"></div>',
      forwardRequest,
    )
    expect(html).toContain('data-swap-ukey="ukey-button-single"')
    expect(html).toContain('data-swap-node-id="1:2"')
    expect(html).not.toContain('data-swap-component=')
    expect(resolved[0]).toMatchObject({ library: '基础组件库', component: 'Button', ukey: 'ukey-button-single' })
  })

  it('supports 库名/组件名 form', async () => {
    const { html } = await resolveTeamLibraryRefs(
      '<div data-swap-node-id="1:2" data-swap-component="基础组件库/DS_Button"></div>',
      forwardRequest,
    )
    expect(html).toContain('data-swap-ukey="ukey-button"')
  })

  it('supports data-swap-library + data-swap-component combination', async () => {
    const { html } = await resolveTeamLibraryRefs(
      '<div data-swap-node-id="1:2" data-swap-library="基础组件库" data-swap-component="Button"></div>',
      forwardRequest,
    )
    expect(html).toContain('data-swap-ukey="ukey-button-single"')
  })

  it('passes through a value that is already a known ukey', async () => {
    const { html } = await resolveTeamLibraryRefs(
      '<div data-swap-node-id="1:2" data-swap-component="ukey-button"></div>',
      forwardRequest,
    )
    expect(html).toContain('data-swap-ukey="ukey-button"')
  })

  it('handles data-library-component and data-swap-component on the same element', async () => {
    const { html, resolved } = await resolveTeamLibraryRefs(
      '<div data-swap-node-id="1:2" data-library-component="DS_Button" data-swap-component="Button"></div>',
      forwardRequest,
    )
    expect(html).toContain('data-library-ukey="ukey-button"')
    expect(html).toContain('data-swap-ukey="ukey-button-single"')
    expect(resolved).toHaveLength(2)
  })

  it('does nothing when neither attribute family is present', async () => {
    const input = '<div data-swap-node-id="1:2" data-swap-ukey="ukey-direct"></div>'
    const { html, warnings } = await resolveTeamLibraryRefs(input, forwardRequest)
    expect(html).toBe(input)
    expect(warnings).toEqual([])
  })
})
