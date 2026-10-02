import type { DesignIntention, PageType, LayoutMode, DesignStyle } from './types.js'

const PAGE_TYPE_KEYWORDS: Record<PageType, string[]> = {
  landing: ['落地页', 'landing', '首页', '推广', '营销'],
  dashboard: ['仪表盘', 'dashboard', '数据', '监控', '管理后台'],
  form: ['表单', 'form', '注册', '登录', '填写', '提交'],
  list: ['列表', 'list', '表格', 'table', '数据列表'],
  detail: ['详情', 'detail', '展示', '查看'],
  custom: ['自定义', 'custom', '自由'],
}

const LAYOUT_KEYWORDS: Record<LayoutMode, string[]> = {
  'single-column': ['单栏', '单列', 'single', '一栏'],
  'two-column': ['双栏', '双列', '两栏', 'two'],
  grid: ['网格', 'grid', '宫格', '卡片网格'],
  free: ['自由', 'free', '自定义布局', '自由布局'],
}

const STYLE_KEYWORDS: Record<DesignStyle, string[]> = {
  minimal: ['极简', 'minimal', '简洁', '干净', '留白'],
  rich: ['丰富', 'rich', '多彩', '复杂'],
  playful: ['活泼', 'playful', '有趣', '创意', '年轻'],
  corporate: ['商务', 'corporate', '专业', '正式', '企业'],
}

const COMPONENT_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /按钮|button|btn|点击/i, type: 'button' },
  { pattern: /输入|input|文本框|text/i, type: 'text-input' },
  { pattern: /选择|select|下拉/i, type: 'select' },
  { pattern: /开关|toggle|switch/i, type: 'toggle' },
  { pattern: /头像|avatar/i, type: 'avatar' },
  { pattern: /徽标|badge|标签|tag/i, type: 'badge' },
  { pattern: /进度|progress|loading/i, type: 'progress' },
  { pattern: /表格|table|数据表/i, type: 'table' },
  { pattern: /表单|form/i, type: 'form' },
  { pattern: /卡片|card/i, type: 'card' },
  { pattern: /导航|nav|menu|菜单|tabs|标签页/i, type: 'tabs' },
  { pattern: /弹窗|modal|dialog|提示/i, type: 'modal' },
  { pattern: /图表|chart/i, type: 'chart' },
  { pattern: /列表|list|清单/i, type: 'list' },
  { pattern: /分页|pagination|页码/i, type: 'pagination' },
  { pattern: /面包屑|breadcrumb/i, type: 'breadcrumb' },
  { pattern: /滑块|slider|范围/i, type: 'slider' },
  { pattern: /分割线|divider|分隔/i, type: 'divider' },
  { pattern: /提示|alert|通知|toast/i, type: 'alert' },
  { pattern: /骨架|skeleton|占位/i, type: 'skeleton' },
]

function matchKeyword(
  text: string,
  keywords: Record<string, string[]>,
  defaultValue: string,
): string {
  for (const [key, values] of Object.entries(keywords)) {
    if (values.some(v => text.includes(v))) return key
  }
  return defaultValue
}

function extractComponents(text: string): Array<{ type: string; count?: number }> {
  const found = new Set<string>()
  const components: Array<{ type: string; count?: number }> = []

  for (const { pattern, type } of COMPONENT_PATTERNS) {
    if (pattern.test(text)) {
      if (!found.has(type)) {
        found.add(type)
        const countMatch = text.match(new RegExp(`(\\d+)\\s*个\\s*${type === 'chart' ? '图表' : type}`))
        components.push({
          type,
          count: countMatch ? parseInt(countMatch[1], 10) : undefined,
        })
      }
    }
  }

  return components
}

function extractHexColor(text: string): string | undefined {
  const match = text.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/g)
  return match ? match[0] : undefined
}

function extractDimensions(text: string): { width?: number; height?: number; device?: string } {
  const result: { width?: number; height?: number; device?: string } = {}

  if (/手机|移动|mobile|phone/i.test(text)) result.device = 'mobile'
  else if (/平板|tablet|pad/i.test(text)) result.device = 'tablet'
  else if (/桌面|desktop|电脑/i.test(text)) result.device = 'desktop'

  return result
}

export async function interpretIntention(input: string): Promise<DesignIntention> {
  const { interpretWithLLM } = await import('./llm-service.js')
  const llmResult = await interpretWithLLM(input)
  if (llmResult) return llmResult

  const pageType = matchKeyword(input, PAGE_TYPE_KEYWORDS, 'custom') as PageType
  const layout = matchKeyword(input, LAYOUT_KEYWORDS, 'single-column') as LayoutMode
  const style = matchKeyword(input, STYLE_KEYWORDS, 'minimal') as DesignStyle
  const components = extractComponents(input)
  const primaryColor = extractHexColor(input)
  const dimensions = extractDimensions(input)
  const isDark = /暗色|黑暗|dark|深色/i.test(input)

  return {
    pageType,
    layout,
    components,
    theme: {
      mode: isDark ? 'dark' : 'light',
      primaryColor,
      style,
    },
    constraints: {
      width: dimensions.device === 'mobile' ? 375
        : dimensions.device === 'tablet' ? 768
        : dimensions.width || 1440,
      device: dimensions.device as 'mobile' | 'tablet' | 'desktop' | undefined,
    },
    description: input,
  }
}

export function intentionToPrompt(intention: DesignIntention): string {
  const themeDesc = intention.theme.style
    ? `${intention.theme.style}风格`
    : '默认风格'
  const layoutDesc: Record<string, string> = {
    'single-column': '单栏布局',
    'two-column': '双栏布局',
    'grid': '网格布局',
    'free': '自由布局',
  }

  return `设计一个${intention.pageType === 'custom' ? '' : intention.pageType + '类'}
${themeDesc}的${layoutDesc[intention.layout] || '页面'}。
${intention.theme.primaryColor ? `主色调: ${intention.theme.primaryColor}。` : ''}
${intention.theme.mode === 'dark' ? '暗色模式。' : ''}
${intention.constraints.width ? `画布宽度: ${intention.constraints.width}px。` : ''}
${intention.components.length > 0 ? `包含组件: ${intention.components.map(c => c.type + (c.count && c.count > 1 ? ` x${c.count}` : '')).join('、')}。` : ''}`
}
