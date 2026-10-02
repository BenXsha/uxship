import type { DesignSession, GateResult, QualityReport } from './types.js'

export type QueryPlugin = (method: string, params: Record<string, unknown>) => Promise<any>

interface Gate {
  name: string
  weight: number
  evaluate(session: DesignSession, queryPlugin?: QueryPlugin): Promise<GateResult>
}

const MAX_ITERATIONS = 3
const PASS_THRESHOLD = 0.7

const gates: Gate[] = [
  {
    name: 'LayoutGate',
    weight: 0.25,
    async evaluate(session: DesignSession, queryPlugin?: QueryPlugin): Promise<GateResult> {
      const details: string[] = []
      const suggestions: string[] = []

      const steps = session.plan.steps
      const renderSteps = steps.filter(s => s.type === 'generate')
      if (renderSteps.length === 0) {
        details.push('没有渲染步骤')
        suggestions.push('确保设计任务包含渲染步骤')
        return { gate: 'LayoutGate', pass: false, score: 0, details, suggestions }
      }

      const completedRenders = renderSteps.filter(s => s.status === 'completed').length
      const ratio = renderSteps.length > 0 ? completedRenders / renderSteps.length : 0
      details.push(`生成步骤完成率 ${Math.round(ratio * 100)}%`)

      let layoutScore = ratio

      if (queryPlugin && session.context?.rootNodeId) {
        try {
          const describe = await queryPlugin('design/describe', {
            nodeId: session.context.rootNodeId,
            depth: 2,
            includeStyle: true,
          })
          const tree = typeof describe?.result?.content?.[0]?.text === 'string'
            ? JSON.parse(describe.result.content[0].text)
            : describe
          const node = tree?.tree || tree
          if (node?.layoutMode) {
            details.push(`布局模式: ${node.layoutMode}`)
            layoutScore = Math.min(1, layoutScore + 0.15)
          }
          if (node?.children?.length > 0) {
            details.push(`子元素数: ${node.children.length}`)
          }
        } catch {
          details.push('无法获取实际布局数据')
        }
      }

      return {
        gate: 'LayoutGate',
        pass: layoutScore >= PASS_THRESHOLD,
        score: Math.round(layoutScore * 100) / 100,
        details,
        suggestions: layoutScore < PASS_THRESHOLD ? ['检查未完成的生成步骤'] : [],
      }
    },
  },
  {
    name: 'ColorGate',
    weight: 0.20,
    async evaluate(session: DesignSession, queryPlugin?: QueryPlugin): Promise<GateResult> {
      const details: string[] = []
      const suggestions: string[] = []

      const theme = session.plan.intention.theme
      if (theme.primaryColor) {
        details.push(`主题色: ${theme.primaryColor}`)
      } else {
        details.push('未指定主题色')
        suggestions.push('建议指定主题色以保持品牌一致性')
      }
      details.push(`色彩模式: ${theme.mode}`)

      let score = theme.primaryColor ? 0.8 : 0.6

      if (queryPlugin && session.context?.rootNodeId) {
        try {
          const describe = await queryPlugin('design/describe', {
            nodeId: session.context.rootNodeId,
            depth: 3,
            includeStyle: true,
          })
          const text = typeof describe?.result?.content?.[0]?.text === 'string'
            ? describe.result.content[0].text
            : JSON.stringify(describe)
          const colorCount = (text.match(/#[0-9a-fA-F]{6}/g) || []).length
          if (theme.primaryColor && text.includes(theme.primaryColor.toLowerCase())) {
            details.push('主题色已应用到设计中')
            score = Math.min(1, score + 0.15)
          }
          if (colorCount > 1) {
            details.push(`检测到 ${colorCount} 种不同颜色`)
          }
          if (colorCount > 8) {
            suggestions.push(`颜色数量较多(${colorCount}种)，建议控制在 3-5 种`)
          }
        } catch {
          details.push('无法获取实际色彩数据')
        }
      }

      return {
        gate: 'ColorGate',
        pass: score >= PASS_THRESHOLD,
        score: Math.round(score * 100) / 100,
        details,
        suggestions,
      }
    },
  },
  {
    name: 'ConsistencyGate',
    weight: 0.20,
    async evaluate(session: DesignSession, queryPlugin?: QueryPlugin): Promise<GateResult> {
      const details: string[] = []
      const suggestions: string[] = []

      const components = session.plan.intention.components
      if (components.length > 0) {
        details.push(`规划了 ${components.length} 种组件`)
        details.push(`组件类型: ${components.map(c => c.type).join(', ')}`)
      } else {
        details.push('未规划具体组件')
        suggestions.push('建议在设计意图中明确所需组件')
      }

      let score = components.length > 0 ? 0.75 : 0.5

      if (queryPlugin && session.context?.rootNodeId) {
        try {
          const instances = await queryPlugin('design/describe', {
            nodeId: session.context.rootNodeId,
            depth: 4,
            includeStyle: false,
          })
          const text = typeof instances?.result?.content?.[0]?.text === 'string'
            ? instances.result.content[0].text
            : JSON.stringify(instances)
          const instanceCount = (text.match(/INSTANCE|COMPONENT/g) || []).length
          if (instanceCount > 0) {
            details.push(`组件实例数: ${instanceCount}`)
            score = Math.min(1, score + 0.15)
          }
        } catch {
          details.push('无法获取实际组件数据')
        }
      }

      return {
        gate: 'ConsistencyGate',
        pass: score >= PASS_THRESHOLD,
        score: Math.round(score * 100) / 100,
        details,
        suggestions,
      }
    },
  },
  {
    name: 'CompletenessGate',
    weight: 0.20,
    async evaluate(session: DesignSession): Promise<GateResult> {
      const details: string[] = []
      const suggestions: string[] = []

      const steps = session.plan.steps
      const total = steps.length
      const completed = steps.filter(s => s.status === 'completed').length
      const failed = steps.filter(s => s.status === 'failed').length

      details.push(`步骤进度: ${completed}/${total}`)
      if (failed > 0) {
        details.push(`${failed} 个步骤失败`)
        suggestions.push('检查失败步骤并修复')
      }

      const hasReview = steps.some(s => s.type === 'review')
      if (!hasReview) {
        suggestions.push('建议增加审查步骤')
      }

      const score = total > 0
        ? (completed / total) * (failed > 0 ? 0.5 : 1.0) * (hasReview ? 1.0 : 0.8)
        : 0

      return {
        gate: 'CompletenessGate',
        pass: score >= PASS_THRESHOLD,
        score: Math.round(score * 100) / 100,
        details,
        suggestions,
      }
    },
  },
  {
    name: 'ResponsiveGate',
    weight: 0.15,
    async evaluate(session: DesignSession, queryPlugin?: QueryPlugin): Promise<GateResult> {
      const details: string[] = []
      const suggestions: string[] = []

      const device = session.plan.intention.constraints.device
      const width = session.plan.intention.constraints.width
      const height = session.plan.intention.constraints.height

      if (device) details.push(`目标设备: ${device}`)
      if (width) details.push(`画布宽度: ${width}px`)
      if (height) details.push(`画布高度: ${height}px`)

      let score = device || width ? 0.8 : 0.4

      if (!device && !width) {
        details.push('未指定设备/宽度，使用默认尺寸')
        suggestions.push('建议指定目标设备或画布宽度')
      }

      if (queryPlugin && session.context?.rootNodeId) {
        try {
          const frame = await queryPlugin('design/describe', {
            nodeId: session.context.rootNodeId,
            depth: 1,
            includeStyle: true,
          })
          const text = typeof frame?.result?.content?.[0]?.text === 'string'
            ? frame.result.content[0].text
            : JSON.stringify(frame)
          if (text.includes('layoutMode') || text.includes('autolayout') || text.includes('auto-layout')) {
            details.push('检测到自动布局')
            score = Math.min(1, score + 0.15)
          }
        } catch {
          details.push('无法获取响应式布局数据')
        }
      }

      return {
        gate: 'ResponsiveGate',
        pass: score >= PASS_THRESHOLD,
        score: Math.round(score * 100) / 100,
        details,
        suggestions,
      }
    },
  },
]

export async function evaluateQuality(
  session: DesignSession,
  queryPlugin?: QueryPlugin,
): Promise<QualityReport> {
  const results = await Promise.all(gates.map(g => g.evaluate(session, queryPlugin)))
  const totalWeight = gates.reduce((sum, g) => sum + g.weight, 0)
  const weightedScore = results.reduce(
    (sum, r, i) => sum + r.score * gates[i].weight,
    0,
  ) / totalWeight

  return {
    sessionId: session.sessionId,
    gates: results,
    overallScore: Math.round(weightedScore * 100) / 100,
    iteration: 0,
    passed: weightedScore >= PASS_THRESHOLD,
    timestamp: Date.now(),
  }
}

export function shouldIterate(report: QualityReport, iteration: number): boolean {
  return !report.passed && iteration < MAX_ITERATIONS
}

export function getMaxIterations(): number {
  return MAX_ITERATIONS
}
