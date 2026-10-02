import { randomUUID } from 'crypto'
import type {
  DesignIntention,
  DesignPlan,
  DesignStep,
  DesignToolCall,
} from './types.js'

export const ROOT_NODE_ID_PLACEHOLDER = '$rootNodeId'

function createStep(
  id: string,
  type: DesignStep['type'],
  description: string,
  toolCalls: DesignToolCall[],
  fallback?: string,
): DesignStep {
  return { id, type, description, toolCalls, fallback, status: 'pending' }
}

function buildLayoutSteps(intention: DesignIntention): DesignStep[] {
  const steps: DesignStep[] = []
  const width = intention.constraints.width || 1440
  const height = intention.constraints.height || 900

  steps.push(createStep(
    'create-frame',
    'generate',
    '创建顶层容器',
    [{
      tool: 'node_create',
      params: {
        type: 'frame',
        properties: {
          name: '设计稿',
          width,
          height,
          layoutMode: 'VERTICAL',
          paddingTop: 24,
          paddingRight: 24,
          paddingBottom: 24,
          paddingLeft: 24,
          itemSpacing: 16,
          primaryAxisSizingMode: 'AUTO',
          counterAxisSizingMode: 'FIXED',
        },
      },
      dependsOn: [],
    }],
  ))

  steps.push(createStep(
    'set-layout',
    'generate',
    `配置 ${intention.layout} 布局`,
    [{
      tool: 'node_update',
      params: {
        nodeId: ROOT_NODE_ID_PLACEHOLDER,
        properties: {
          layoutMode: intention.layout === 'single-column' ? 'VERTICAL'
            : intention.layout === 'grid' ? 'WRAP'
            : 'VERTICAL',
        },
      },
      dependsOn: ['create-frame'],
    }],
  ))

  return steps
}

function buildComponentSteps(intention: DesignIntention): DesignStep[] {
  const steps: DesignStep[] = []

  for (let i = 0; i < intention.components.length; i++) {
    const comp = intention.components[i]
    const stepId = `add-component-${i}`

    const toolCalls: DesignToolCall[] = [{
      tool: 'component_render',
      params: {
        type: comp.type,
        count: comp.count || 1,
        parentId: ROOT_NODE_ID_PLACEHOLDER,
      },
      dependsOn: i > 0 ? [`add-component-${i - 1}`] : ['set-layout'],
    }]

    steps.push(createStep(
      stepId,
      'generate',
      `添加 ${comp.type} 组件${comp.count && comp.count > 1 ? ` x${comp.count}` : ''}`,
      toolCalls,
      'component_render 失败时降级为 rectangle',
    ))
  }

  return steps
}

function buildThemeSteps(intention: DesignIntention): DesignStep[] {
  const steps: DesignStep[] = []
  const theme = intention.theme

  if (theme.primaryColor) {
    steps.push(createStep(
      'apply-theme',
      'generate',
      `应用主题色 ${theme.primaryColor}`,
      [{
        tool: 'node_update',
        params: {
          nodeId: ROOT_NODE_ID_PLACEHOLDER,
          properties: { fills: [{ type: 'SOLID', color: theme.primaryColor }] },
        },
        dependsOn: ['set-layout'],
      }],
    ))
  }

  if (theme.mode === 'dark') {
    steps.push(createStep(
      'set-dark-mode',
      'generate',
      '应用暗色主题',
      [{
        tool: 'node_update',
        params: {
          nodeId: ROOT_NODE_ID_PLACEHOLDER,
          properties: { backgrounds: [{ type: 'SOLID', color: '#1a1a2e' }] },
        },
        dependsOn: ['set-layout'],
      }],
    ))
  }

  return steps
}

function buildReviewSteps(): DesignStep[] {
  return [
    createStep(
      'review-design',
      'review',
      '检查设计质量',
      [{
        tool: 'design_review',
        params: { nodeId: ROOT_NODE_ID_PLACEHOLDER },
        dependsOn: [],
      }],
    ),
  ]
}

export function createPlan(intention: DesignIntention): DesignPlan {
  const sessionId = randomUUID().slice(0, 12)
  const steps: DesignStep[] = [
    ...buildLayoutSteps(intention),
    ...buildComponentSteps(intention),
    ...buildThemeSteps(intention),
    ...buildReviewSteps(),
  ]

  return {
    sessionId,
    steps,
    createdAt: Date.now(),
    intention,
  }
}

export function getCurrentStep(plan: DesignPlan, stepIndex: number): DesignStep | null {
  if (stepIndex < 0 || stepIndex >= plan.steps.length) return null
  return plan.steps[stepIndex]
}

export function hasMoreSteps(plan: DesignPlan, stepIndex: number): boolean {
  return stepIndex < plan.steps.length - 1
}
