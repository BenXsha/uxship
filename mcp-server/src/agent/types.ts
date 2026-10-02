export type PageType = 'landing' | 'dashboard' | 'form' | 'list' | 'detail' | 'custom'
export type LayoutMode = 'single-column' | 'two-column' | 'grid' | 'free'
export type ThemeMode = 'light' | 'dark' | 'auto'
export type DesignStyle = 'minimal' | 'rich' | 'playful' | 'corporate'
export type DeviceType = 'desktop' | 'tablet' | 'mobile'

export type StepType = 'analyze' | 'generate' | 'render' | 'review' | 'iterate'
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
export type AutonomyMode = 'copilot' | 'adviser' | 'autonomous'

export interface DesignToolCall {
  tool: string
  params: Record<string, unknown>
  dependsOn: string[]
}

export interface DesignStep {
  id: string
  type: StepType
  description: string
  toolCalls: DesignToolCall[]
  fallback?: string
  status?: StepStatus
  result?: unknown
  error?: string
}

export interface DesignPlan {
  sessionId: string
  steps: DesignStep[]
  createdAt: number
  intention: DesignIntention
}

export interface DesignIntention {
  pageType: PageType
  layout: LayoutMode
  components: DesignComponentIntent[]
  theme: DesignThemeIntent
  constraints: DesignConstraintIntent
  description?: string
}

export interface DesignComponentIntent {
  type: string
  position?: 'header' | 'sidebar' | 'main' | 'footer'
  count?: number
}

export interface DesignThemeIntent {
  mode: ThemeMode
  primaryColor?: string
  style?: DesignStyle
}

export interface DesignConstraintIntent {
  width?: number
  height?: number
  device?: DeviceType
}

export interface GateResult {
  gate: string
  pass: boolean
  score: number
  details: string[]
  suggestions: string[]
}

export interface QualityReport {
  sessionId: string
  gates: GateResult[]
  overallScore: number
  iteration: number
  passed: boolean
  timestamp: number
}

export interface AgentConfig {
  mode: AutonomyMode
  maxIterations: number
  stylePreferences?: Partial<DesignThemeIntent>
}

export interface Checkpoint {
  id: string
  stepId: string
  timestamp: number
  snapshot: string
}

export interface DesignSession {
  sessionId: string
  plan: DesignPlan
  currentStepIndex: number
  status: 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed'
  checkpoints: Checkpoint[]
  config: AgentConfig
  context: Record<string, unknown>
  createdAt: number
  updatedAt: number
}
