/**
 * 组件渲染处理器
 *
 * 高阶组件 API：将原子组件（checkbox/radio/button/input）的创建封装为一次调用。
 * 遵循 B1 方案（Token 参数注入），提供最佳实践默认值，支持 theme 覆盖。
 */

import { mergeTheme } from './design-theme'
import { solidFill, makeNode, serializeNode } from './component-utils'

// ─── 布局组件 — 页面骨架、特性网格、定价表 ───

export function renderPageShell(params: any): any {
  const t = mergeTheme(params.theme)
  const width = params.size?.width ?? 1440
  const headerH = params.headerHeight ?? 64
  const sidebarW = params.sidebarWidth ?? 240
  const hasSidebar = params.sidebar !== false
  const title = params.title || '页面标题'

  const frame = makeNode('frame', {
    name: params.name || 'PageShell',
    width, height: 900,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    fills: [solidFill(t.bgWhite)],
  })

  // Header
  const header = makeNode('frame', {
    name: 'Header',
    width, height: headerH,
    x: 0, y: 0,
    fills: [solidFill(t.brand)],
    clipsContent: true,
    flexMode: 'HORIZONTAL',
    mainAxisAlignItems: 'MIN',
    crossAxisAlignItems: 'CENTER',
    paddingLeft: 24, paddingRight: 24,
  }, frame.id)

  makeNode('text', {
    name: 'HeaderTitle',
    characters: title,
    fontSize: 18,
    fontName: { family: 'Inter', style: 'Bold' },
    fills: [solidFill('#FFFFFF')],
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: 0, y: 0,
  }, header.id)

  // Body: Sidebar + Content
  if (hasSidebar) {
    const sidebar = makeNode('frame', {
      name: 'Sidebar',
      width: sidebarW,
      height: 900 - headerH,
      x: 0, y: headerH,
      fills: [solidFill('#F9FAFB')],
      clipsContent: true,
      flexMode: 'VERTICAL',
      mainAxisAlignItems: 'MIN',
      crossAxisAlignItems: 'MIN',
      paddingTop: 16, paddingBottom: 16,
    }, frame.id)

    const menuItems = params.menuItems || ['仪表盘', '项目', '团队', '设置']
    menuItems.forEach((label: string, i: number) => {
      const itemH = 40
      makeNode('frame', {
        name: `Item-${i}`,
        width: sidebarW, height: itemH,
        x: 0, y: i * itemH,
        fills: i === 0 ? [solidFill(t.brandLight)] : [],
        clipsContent: true,
        flexMode: 'HORIZONTAL',
        mainAxisAlignItems: 'MIN',
        crossAxisAlignItems: 'CENTER',
        paddingLeft: 20,
      }, sidebar.id)
      makeNode('text', {
        name: 'Label',
        characters: label,
        fontSize: 14,
        fontName: { family: 'Inter', style: i === 0 ? 'Bold' : 'Regular' },
        fills: [solidFill(i === 0 ? t.brand : t.textPrimary)],
        textAutoResize: 'WIDTH_AND_HEIGHT',
        x: 0, y: 0,
      }, sidebar.id)
    })
  }

  // Content placeholder
  const contentX = hasSidebar ? sidebarW : 0
  makeNode('text', {
    name: 'ContentPlaceholder',
    characters: 'Content Area',
    fontSize: 24,
    fontName: { family: 'Inter', style: 'Bold' },
    fills: [solidFill(t.textTitle)],
    textAutoResize: 'WIDTH_AND_HEIGHT',
    x: contentX + 32,
    y: headerH + 32,
  }, frame.id)

  mg.commitUndo()
  return { success: true, container: serializeNode(frame) }
}

export function renderFeatureGrid(params: any): any {
  const t = mergeTheme(params.theme)
  const cols = params.columns ?? 3
  const items = params.items || [
    { icon: '⚡', title: '快速启动', desc: '秒级部署，即刻开始' },
    { icon: '🔒', title: '安全可靠', desc: '企业级安全防护' },
    { icon: '📊', title: '数据分析', desc: '实时数据可视化' },
  ]
  const cardW = 280
  const cardH = 180
  const gap = 24
  const totalW = cols * cardW + (cols - 1) * gap
  const rows = Math.ceil(items.length / cols)

  const frame = makeNode('frame', {
    name: params.name || 'FeatureGrid',
    width: totalW,
    height: rows * cardH + (rows - 1) * gap,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    fills: [solidFill(t.bgWhite)],
  })

  items.forEach((item: any, i: number) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const cx = col * (cardW + gap)
    const cy = row * (cardH + gap)

    const card = makeNode('frame', {
      name: `Feature-${i}`,
      width: cardW, height: cardH,
      x: cx, y: cy,
      cornerRadius: t.borderRadiusLg,
      fills: [solidFill('#F9FAFB')],
      clipsContent: true,
      flexMode: 'VERTICAL',
      mainAxisAlignItems: 'CENTER',
      crossAxisAlignItems: 'CENTER',
      paddingLeft: 24, paddingRight: 24,
    }, frame.id)

    makeNode('text', {
      name: 'Icon',
      characters: item.icon || '⚡',
      fontSize: 28,
      fills: [solidFill(t.brand)],
      textAlignHorizontal: 'CENTER',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      x: 0, y: 32,
    }, card.id)

    makeNode('text', {
      name: 'Title',
      characters: item.title,
      fontSize: 16,
      fontName: { family: 'Inter', style: 'Bold' },
      fills: [solidFill(t.textPrimary)],
      textAlignHorizontal: 'CENTER',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      x: 0, y: 68,
    }, card.id)

    makeNode('text', {
      // R2 保留名为 `Description`（`Desc` 属自创同义词）
      name: 'Description',
      characters: item.desc,
      fontSize: 13,
      fontName: { family: 'Inter', style: 'Regular' },
      fills: [solidFill(t.textDisabled)],
      textAlignHorizontal: 'CENTER',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      x: 0, y: 92,
    }, card.id)
  })

  mg.commitUndo()
  return { success: true, container: serializeNode(frame) }
}

export function renderPricingTable(params: any): any {
  const t = mergeTheme(params.theme)
  const tiers = params.tiers || [
    { name: '基础版', price: '¥29', features: ['基础功能', '5GB 存储', '邮件支持'], cta: '免费试用', popular: false },
    { name: '专业版', price: '¥99', features: ['高级功能', '50GB 存储', '优先支持', 'API 访问'], cta: '立即订阅', popular: true },
    { name: '企业版', price: '¥299', features: ['全部功能', '无限存储', '专属支持', 'API 访问', '定制开发'], cta: '联系销售', popular: false },
  ]
  const cardW = 280
  const cardH = 400
  const gap = 24

  const totalW = tiers.length * cardW + (tiers.length - 1) * gap

  const frame = makeNode('frame', {
    name: params.name || 'PricingTable',
    width: totalW, height: cardH + 60,
    x: params.position?.x ?? 100,
    y: params.position?.y ?? 100,
    fills: [solidFill(t.bgWhite)],
    flexMode: 'HORIZONTAL',
    mainAxisAlignItems: 'CENTER',
    crossAxisAlignItems: 'CENTER',
    paddingLeft: gap, paddingRight: gap,
    itemSpacing: gap,
  })

  tiers.forEach((tier: any, i: number) => {
    const isPopular = tier.popular
    const card = makeNode('frame', {
      name: `Tier-${i}`,
      width: cardW, height: cardH,
      x: 0, y: 0,
      cornerRadius: t.borderRadiusXl,
      fills: [solidFill(isPopular ? t.brandLight : '#F9FAFB')],
      strokes: isPopular ? [solidFill(t.brand, 1)] : [],
      strokeWeight: isPopular ? 2 : 0,
      clipsContent: true,
      flexMode: 'VERTICAL',
      mainAxisAlignItems: 'CENTER',
      crossAxisAlignItems: 'CENTER',
      paddingLeft: 24, paddingRight: 24,
      paddingTop: 32, paddingBottom: 24,
      itemSpacing: 12,
    }, frame.id)

    makeNode('text', {
      name: 'PlanName', characters: tier.name,
      fontSize: 20, fontName: { family: 'Inter', style: 'Bold' },
      fills: [solidFill(t.textTitle)],
      textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT',
      x: 0, y: 0,
    }, card.id)

    makeNode('text', {
      name: 'Price', characters: tier.price,
      fontSize: 32, fontName: { family: 'Inter', style: 'Bold' },
      fills: [solidFill(t.brand)],
      textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT',
      x: 0, y: 0,
    }, card.id)

    makeNode('text', {
      name: 'PerMonth', characters: '/月',
      fontSize: 13, fontName: { family: 'Inter', style: 'Regular' },
      fills: [solidFill(t.textDisabled)],
      textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT',
      x: 0, y: 0,
    }, card.id)

    // Features
    tier.features.forEach((feat: string, fi: number) => {
      makeNode('text', {
        name: `Feature-${fi}`, characters: `✓ ${feat}`,
        fontSize: 13, fontName: { family: 'Inter', style: 'Regular' },
        fills: [solidFill(t.textPrimary)],
        textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT',
        x: 0, y: 0,
      }, card.id)
    })

    // CTA Button
    const btnH = 40
    makeNode('frame', {
      name: 'CTA',
      width: cardW - 48, height: btnH,
      x: 24, y: cardH - btnH - 24,
      cornerRadius: t.borderRadiusMd,
      fills: [solidFill(isPopular ? t.brand : t.bgWhite)],
      strokes: isPopular ? [] : [solidFill(t.border, 1)],
      strokeWeight: 1,
      clipsContent: true,
      flexMode: 'HORIZONTAL',
      mainAxisAlignItems: 'CENTER',
      crossAxisAlignItems: 'CENTER',
    }, card.id)

    makeNode('text', {
      name: 'CTALabel', characters: tier.cta,
      fontSize: 14, fontName: { family: 'Inter', style: 'Bold' },
      fills: [solidFill(isPopular ? '#FFFFFF' : t.brand)],
      textAlignHorizontal: 'CENTER', textAutoResize: 'WIDTH_AND_HEIGHT',
      x: 0, y: 0,
    }, card.id)
  })

  mg.commitUndo()
  return { success: true, container: serializeNode(frame) }
}

