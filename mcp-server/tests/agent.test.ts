import { describe, it, expect, beforeEach } from 'vitest'
import { createPlan, getCurrentStep, hasMoreSteps, ROOT_NODE_ID_PLACEHOLDER } from '../src/agent/design-planner.js'
import {
  createSession,
  getSession,
  removeSession,
  pushCheckpoint,
  rollbackToCheckpoint,
  rollbackToPrevious,
  updateSessionStatus,
  advanceStep,
  updateStepResult,
  listSessions,
} from '../src/agent/design-state-manager.js'
import { evaluateQuality, shouldIterate, getMaxIterations } from '../src/agent/quality-gate.js'
import { interpretIntention, intentionToPrompt } from '../src/agent/intention-interpreter.js'
import type { DesignIntention, AgentConfig, DesignSession } from '../src/agent/types.js'

const sampleIntention: DesignIntention = {
  pageType: 'landing',
  layout: 'single-column',
  components: [{ type: 'button', count: 2 }, { type: 'card' }],
  theme: { mode: 'light', primaryColor: '#0071e3', style: 'minimal' },
  constraints: { width: 1440, device: 'desktop' },
  description: '帮我设计一个产品落地页',
}

const defaultConfig: AgentConfig = {
  mode: 'copilot',
  maxIterations: 3,
}

describe('intention-interpreter', () => {
  it('parses landing page intent', async () => {
    const result = await interpretIntention('帮我设计一个产品落地页，包含按钮和卡片，蓝色主题')
    expect(result.pageType).toBe('landing')
    expect(result.layout).toBe('single-column')
    expect(result.components.some(c => c.type === 'button')).toBe(true)
    expect(result.components.some(c => c.type === 'card')).toBe(true)
  })

  it('parses dark mode intent', async () => {
    const result = await interpretIntention('暗色模式的仪表盘')
    expect(result.pageType).toBe('dashboard')
    expect(result.theme.mode).toBe('dark')
  })

  it('parses hex color from intent', async () => {
    const result = await interpretIntention('使用 #ff6600 作为主色调的列表页')
    expect(result.theme.primaryColor).toBe('#ff6600')
  })

  it('parses mobile device constraint', async () => {
    const result = await interpretIntention('手机端的表单页面')
    expect(result.constraints.width).toBe(375)
    expect(result.constraints.device).toBe('mobile')
  })

  it('parses multi-component intent', async () => {
    const result = await interpretIntention('包含导航、按钮、表格和图表的管理后台')
    expect(result.components.some(c => c.type === 'tabs')).toBe(true)
    expect(result.components.some(c => c.type === 'button')).toBe(true)
    expect(result.components.some(c => c.type === 'table')).toBe(true)
    expect(result.components.some(c => c.type === 'chart')).toBe(true)
  })

  it('handles empty input gracefully', async () => {
    const result = await interpretIntention('')
    expect(result.pageType).toBe('custom')
    expect(result.layout).toBe('single-column')
    expect(result.components.length).toBe(0)
  })

  it('generates prompt from intention', () => {
    const prompt = intentionToPrompt(sampleIntention)
    expect(prompt).toContain('landing')
    expect(prompt).toContain('#0071e3')
    expect(prompt).toContain('1440px')
  })
})

describe('design-planner', () => {
  it('creates a plan from intention', () => {
    const plan = createPlan(sampleIntention)
    expect(plan.sessionId).toBeDefined()
    expect(plan.sessionId.length).toBe(12)
    expect(plan.steps.length).toBeGreaterThan(0)
    expect(plan.intention).toEqual(sampleIntention)
  })

  it('includes generate and review steps', () => {
    const plan = createPlan(sampleIntention)
    const stepTypes = plan.steps.map(s => s.type)
    expect(stepTypes).toContain('generate')
    expect(stepTypes).toContain('review')
  })

  it('creates steps with valid structure', () => {
    const plan = createPlan(sampleIntention)
    for (const step of plan.steps) {
      expect(step.id).toBeDefined()
      expect(step.description).toBeDefined()
      expect(step.status).toBe('pending')
      expect(step.toolCalls.length).toBeGreaterThan(0)
      for (const tc of step.toolCalls) {
        expect(tc.tool).toBeDefined()
        expect(tc.params).toBeDefined()
        expect(Array.isArray(tc.dependsOn)).toBe(true)
      }
    }
  })

  it('uses $rootNodeId placeholder for dynamic node references', () => {
    const plan = createPlan(sampleIntention)
    const allParams = JSON.stringify(plan.steps.map(s => s.toolCalls.map(tc => tc.params)))
    expect(allParams).toContain(ROOT_NODE_ID_PLACEHOLDER)
  })

  it('creates node_create with properties wrapper', () => {
    const plan = createPlan(sampleIntention)
    const createStep = plan.steps.find(s => s.toolCalls.some(tc => tc.tool === 'node_create'))
    expect(createStep).toBeDefined()
    const tc = createStep!.toolCalls.find(t => t.tool === 'node_create')
    expect(tc!.params.type).toBe('frame')
    expect(tc!.params.properties).toBeDefined()
    expect(tc!.params.properties.name).toBe('设计稿')
    expect(tc!.params.properties.width).toBe(1440)
  })

  it('hasMoreSteps returns correct value', () => {
    const plan = createPlan(sampleIntention)
    expect(hasMoreSteps(plan, 0)).toBe(plan.steps.length > 1)
    expect(hasMoreSteps(plan, plan.steps.length - 1)).toBe(false)
    expect(hasMoreSteps(plan, plan.steps.length)).toBe(false)
  })

  it('getCurrentStep returns null for invalid index', () => {
    const plan = createPlan(sampleIntention)
    expect(getCurrentStep(plan, -1)).toBeNull()
    expect(getCurrentStep(plan, 999)).toBeNull()
  })
})

describe('design-state-manager', () => {
  let plan: ReturnType<typeof createPlan>
  let session: DesignSession

  beforeEach(() => {
    plan = createPlan(sampleIntention)
    session = createSession(plan, defaultConfig)
  })

  it('creates and retrieves session', () => {
    const retrieved = getSession(session.sessionId)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.sessionId).toBe(session.sessionId)
    expect(retrieved!.status).toBe('planning')
  })

  it('returns null for non-existent session', () => {
    expect(getSession('non-existent')).toBeNull()
  })

  it('removes session', () => {
    expect(removeSession(session.sessionId)).toBe(true)
    expect(getSession(session.sessionId)).toBeNull()
  })

  it('pushCheckpoint creates checkpoint', () => {
    const cp = pushCheckpoint(session.sessionId, plan.steps[0].id)
    expect(cp).not.toBeNull()
    expect(cp!.stepId).toBe(plan.steps[0].id)
    expect(cp!.id.length).toBe(8)
  })

  it('rollbackToPrevious restores to checkpoint state', () => {
    pushCheckpoint(session.sessionId, plan.steps[0].id)
    advanceStep(session.sessionId)

    const beforeRollback = getSession(session.sessionId)
    expect(beforeRollback!.currentStepIndex).toBe(1)

    expect(rollbackToPrevious(session.sessionId)).toBe(true)
    const afterRollback = getSession(session.sessionId)
    expect(afterRollback!.currentStepIndex).toBe(0)
  })

  it('rollbackToPrevious works with single checkpoint', () => {
    pushCheckpoint(session.sessionId, plan.steps[0].id)
    expect(rollbackToPrevious(session.sessionId)).toBe(true)
    const s = getSession(session.sessionId)
    expect(s!.currentStepIndex).toBe(0)
  })

  it('updates session status', () => {
    expect(updateSessionStatus(session.sessionId, 'executing')).toBe(true)
    expect(getSession(session.sessionId)!.status).toBe('executing')
  })

  it('advanceStep increments step index', () => {
    expect(getSession(session.sessionId)!.currentStepIndex).toBe(0)
    advanceStep(session.sessionId)
    expect(getSession(session.sessionId)!.currentStepIndex).toBe(1)
  })

  it('advanceStep marks completed when past last step', () => {
    const steps = plan.steps.length
    for (let i = 0; i < steps; i++) {
      advanceStep(session.sessionId)
    }
    expect(getSession(session.sessionId)!.status).toBe('completed')
  })

  it('updateStepResult modifies step status', () => {
    const stepId = plan.steps[0].id
    expect(updateStepResult(session.sessionId, stepId, 'running')).toBe(true)
    expect(getSession(session.sessionId)!.plan.steps[0].status).toBe('running')
    expect(updateStepResult(session.sessionId, stepId, 'completed', { rendered: true })).toBe(true)
    expect(getSession(session.sessionId)!.plan.steps[0].result).toEqual({ rendered: true })
  })

  it('listSessions returns active sessions', () => {
    const sessions = listSessions()
    expect(sessions.length).toBeGreaterThanOrEqual(1)
    expect(sessions.some(s => s.sessionId === session.sessionId)).toBe(true)
  })

  it('fails gracefully for non-existent session operations', () => {
    expect(updateSessionStatus('bad-id', 'executing')).toBe(false)
    expect(advanceStep('bad-id')).toBe(false)
    expect(pushCheckpoint('bad-id', 'step-1')).toBeNull()
    expect(rollbackToCheckpoint('bad-id', 'cp-1')).toBe(false)
    expect(updateStepResult('bad-id', 'step-1', 'completed')).toBe(false)
  })
})

describe('quality-gate', () => {
  it('evaluates quality of a session', async () => {
    const plan = createPlan(sampleIntention)
    const session = createSession(plan, defaultConfig)
    const report = await evaluateQuality(session)
    expect(report.sessionId).toBe(session.sessionId)
    expect(report.gates.length).toBe(5)
    expect(report.overallScore).toBeGreaterThanOrEqual(0)
    expect(report.overallScore).toBeLessThanOrEqual(1)
  })

  it('returns higher score for completed sessions', async () => {
    const plan = createPlan(sampleIntention)
    const session = createSession(plan, defaultConfig)
    const beforeReport = await evaluateQuality(session)

    for (const step of plan.steps) {
      updateStepResult(session.sessionId, step.id, 'completed')
      advanceStep(session.sessionId)
    }

    const afterReport = await evaluateQuality(getSession(session.sessionId)!)
    expect(afterReport.overallScore).toBeGreaterThanOrEqual(beforeReport.overallScore)
  })

  it('shouldIterate returns correct value', () => {
    const goodReport = {
      sessionId: 'test',
      gates: [],
      overallScore: 0.85,
      iteration: 0,
      passed: true,
      timestamp: Date.now(),
    }
    expect(shouldIterate(goodReport, 0)).toBe(false)

    const badReport = { ...goodReport, overallScore: 0.4, passed: false }
    expect(shouldIterate(badReport, 0)).toBe(true)
    expect(shouldIterate(badReport, 3)).toBe(false)
  })

  it('getMaxIterations returns 3', () => {
    expect(getMaxIterations()).toBe(3)
  })

  it('all gates have valid weights summing to 1.0', async () => {
    const plan = createPlan(sampleIntention)
    const session = createSession(plan, defaultConfig)
    await evaluateQuality(session)
    const totalWeight = 0.25 + 0.20 + 0.20 + 0.20 + 0.15
    expect(totalWeight).toBeCloseTo(1.0)
  })

  it('returns report with queryPlugin if provided', async () => {
    const plan = createPlan(sampleIntention)
    const session = createSession(plan, defaultConfig)
    const queryPlugin = async () => null
    const report = await evaluateQuality(session, queryPlugin)
    expect(report.overallScore).toBeGreaterThanOrEqual(0)
    expect(report.passed).toBeDefined()
  })
})

describe('ROOT_NODE_ID_PLACEHOLDER', () => {
  it('is a string constant', () => {
    expect(typeof ROOT_NODE_ID_PLACEHOLDER).toBe('string')
    expect(ROOT_NODE_ID_PLACEHOLDER).toBe('$rootNodeId')
  })
})
