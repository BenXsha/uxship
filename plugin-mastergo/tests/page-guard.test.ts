import { describe, it, expect, afterEach } from 'vitest'
import { installMgStub, resetMgStub, type MgStub } from './helpers/mg-stub'
import { handleSwitchPage, handleCreatePage, handleGetPages } from '../lib/api/pageHandlers'

/**
 * 页面切换护栏门禁
 *
 * 2026-09 真实踩坑：
 * - `page_switch` 赋值后**不回读**就返回 success，用户报「返回 success 但实际没切过去」，
 *   跨页批量任务落错页（宿主切页可能是异步 / 排队的，真实日志里连续切页会延迟生效）。
 * - `page_create` 不切换新页也不提示，只返回 `{id, name}`，紧接着的 node_create 建到**旧页**。
 */

/** 造第二个页面并注入 createPage 工厂（桩默认只有一个页面） */
function installExtraPage(mg: MgStub, id = 'page:2', name = 'Page 2'): any {
  const extra: any = {
    id,
    name,
    type: 'PAGE',
    removed: false,
    isVisible: true,
    isLocked: false,
    children: [],
    remove() { extra.removed = true },
  }
  mg.document.children.push(extra)
  ;(mg as any).createPage = () => {
    const created: any = {
      id: `${id}-new`,
      name: 'New Page',
      type: 'PAGE',
      removed: false,
      isVisible: true,
      isLocked: false,
      children: [],
      remove() { created.removed = true },
    }
    mg.document.children.push(created)
    return created
  }
  return extra
}

afterEach(() => {
  resetMgStub()
})

describe('page_switch：赋值后回读校验', () => {
  it('正常切换：applied=true、currentPage 是目标页、无 warning', () => {
    const mg = installMgStub({})
    installExtraPage(mg)

    const res = handleSwitchPage({ pageId: 'page:2' })

    expect(res.success).toBe(true)
    expect(res.applied).toBe(true)
    expect(res.currentPage).toEqual({ id: 'page:2', name: 'Page 2' })
    expect(res.warnings).toBeUndefined()
    expect(mg.document.currentPage.id).toBe('page:2')
  })

  it('宿主延迟生效（回读仍是旧页）：applied=false + warning，但 success 仍为 true', () => {
    const mg = installMgStub({ deferPageSwitch: true })
    installExtraPage(mg)

    const res = handleSwitchPage({ pageId: 'page:2' })

    // applied=false 不是错误：宿主切页可能异步 / 排队
    expect(res.success).toBe(true)
    expect(res.applied).toBe(false)
    // 如实回报回读到的当前页（旧页），不谎报成目标页
    expect(res.currentPage).toEqual({ id: 'page:1', name: 'Test Page' })
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toContain('宿主未立即切到目标页')
    expect(res.warnings[0]).toContain('page:1')
    expect(res.warnings[0]).toContain('page_list')
  })

  it('已是当前页：保持 alreadyCurrent 早返回，并回显 applied=true', () => {
    const mg = installMgStub({})
    installExtraPage(mg)

    const res = handleSwitchPage({ pageId: 'page:1' })

    expect(res).toMatchObject({
      success: true,
      applied: true,
      alreadyCurrent: true,
      currentPage: { id: 'page:1', name: 'Test Page' },
    })
  })

  it('缺 pageId / 页面不存在：仍抛参数类错误', () => {
    const mg = installMgStub({})
    installExtraPage(mg)

    expect(() => handleSwitchPage({} as any)).toThrow(/pageId/)
    expect(() => handleSwitchPage({ pageId: 'nope' })).toThrow(/Page not found/)
  })
})

describe('page_create：返回当前页 id + 提示，支持 switchToNew', () => {
  it('默认（不切换）：返回 currentPageId 与 hint，applied=false', () => {
    const mg = installMgStub({})
    installExtraPage(mg)

    const res = handleCreatePage({ name: '目标页' })

    expect(res.success).toBe(true)
    expect(res.page).toEqual({ id: 'page:2-new', name: '目标页' })
    // 新页确实进了文档
    expect(handleGetPages({}).pages.map((p: any) => p.id)).toContain('page:2-new')
    // 但当前页仍是旧页 —— AI 必须先看到这个再决定建到哪
    expect(res.currentPageId).toBe('page:1')
    expect(res.applied).toBe(false)
    expect(res.hint).toContain('switchToNew')
    expect(res.warnings).toBeUndefined()
  })

  it('switchToNew=true：真的切过去并回读确认', () => {
    const mg = installMgStub({})
    installExtraPage(mg)

    const res = handleCreatePage({ name: '目标页', switchToNew: true })

    expect(res.success).toBe(true)
    expect(res.applied).toBe(true)
    expect(res.currentPageId).toBe('page:2-new')
    expect(mg.document.currentPage.id).toBe('page:2-new')
    expect(res.hint).toContain('已切换到新页')
    expect(res.warnings).toBeUndefined()
  })

  it('switchToNew=true 但宿主延迟生效：applied=false + warning，hint 提示复核', () => {
    const mg = installMgStub({ deferPageSwitch: true })
    installExtraPage(mg)

    const res = handleCreatePage({ switchToNew: true })

    expect(res.success).toBe(true)
    expect(res.applied).toBe(false)
    expect(res.currentPageId).toBe('page:1')
    expect(res.warnings[0]).toContain('宿主未立即切到目标页')
    expect(res.hint).toContain('复核')
  })
})
