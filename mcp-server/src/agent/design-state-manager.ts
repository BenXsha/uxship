import { randomUUID } from 'crypto'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { DesignSession, Checkpoint, DesignPlan, AgentConfig } from './types.js'

const SESSIONS_DIR = join(process.cwd(), '.agent-sessions')
const MAX_SESSIONS = 20
const SESSION_TTL = 30 * 60 * 1000

const sessions = new Map<string, DesignSession>()

function ensureSessionsDir(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true })
  }
}

function sessionFilePath(sessionId: string): string {
  return join(SESSIONS_DIR, `${sessionId}.json`)
}

function persistSession(session: DesignSession): void {
  ensureSessionsDir()
  try {
    writeFileSync(sessionFilePath(session.sessionId), JSON.stringify(session, null, 2), 'utf-8')
  } catch {
    // non-critical
  }
}

function loadSession(sessionId: string): DesignSession | null {
  try {
    const filePath = sessionFilePath(sessionId)
    if (!existsSync(filePath)) return null
    const data = readFileSync(filePath, 'utf-8')
    return JSON.parse(data) as DesignSession
  } catch {
    return null
  }
}

export function createSession(plan: DesignPlan, config: AgentConfig): DesignSession {
  cleanup()

  const session: DesignSession = {
    sessionId: plan.sessionId,
    plan,
    currentStepIndex: 0,
    status: 'planning',
    checkpoints: [],
    config,
    context: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  sessions.set(session.sessionId, session)
  persistSession(session)
  return session
}

export function getSession(sessionId: string): DesignSession | null {
  const cached = sessions.get(sessionId)
  if (cached) {
    cached.updatedAt = Date.now()
    return cached
  }
  return loadSession(sessionId)
}

export function removeSession(sessionId: string): boolean {
  sessions.delete(sessionId)
  try {
    const filePath = sessionFilePath(sessionId)
    if (existsSync(filePath)) {
      const { unlinkSync } = require('fs')
      unlinkSync(filePath)
    }
  } catch {
    // non-critical
  }
  return true
}

export function pushCheckpoint(sessionId: string, stepId: string): Checkpoint | null {
  const session = getSession(sessionId)
  if (!session) return null

  const checkpoint: Checkpoint = {
    id: randomUUID().slice(0, 8),
    stepId,
    timestamp: Date.now(),
    snapshot: JSON.stringify(session),
  }

  session.checkpoints.push(checkpoint)
  session.updatedAt = Date.now()
  persistSession(session)
  return checkpoint
}

export function rollbackToCheckpoint(sessionId: string, checkpointId: string): boolean {
  const session = getSession(sessionId)
  if (!session) return false

  const idx = session.checkpoints.findIndex(c => c.id === checkpointId)
  if (idx === -1) return false

  const checkpoint = session.checkpoints[idx]
  try {
    const restored = JSON.parse(checkpoint.snapshot) as DesignSession
    sessions.set(sessionId, restored)
    persistSession(restored)
    return true
  } catch {
    return false
  }
}

export function rollbackToPrevious(sessionId: string): boolean {
  const session = getSession(sessionId)
  if (!session || session.checkpoints.length === 0) return false

  const targetIndex = session.checkpoints.length >= 2
    ? session.checkpoints.length - 2
    : 0
  const prevCheckpoint = session.checkpoints[targetIndex]
  return rollbackToCheckpoint(sessionId, prevCheckpoint.id)
}

export function updateSessionStatus(
  sessionId: string,
  status: DesignSession['status'],
  context?: Record<string, unknown>,
): boolean {
  const session = getSession(sessionId)
  if (!session) return false

  session.status = status
  session.updatedAt = Date.now()
  if (context) Object.assign(session.context, context)
  persistSession(session)
  return true
}

export function advanceStep(sessionId: string): boolean {
  const session = getSession(sessionId)
  if (!session) return false

  session.currentStepIndex++
  session.updatedAt = Date.now()

  if (session.currentStepIndex >= session.plan.steps.length) {
    session.status = 'completed'
  }

  persistSession(session)
  return true
}

export function updateStepResult(
  sessionId: string,
  stepId: string,
  status: DesignStep['status'],
  result?: unknown,
  error?: string,
): boolean {
  const session = getSession(sessionId)
  if (!session) return false

  const step = session.plan.steps.find(s => s.id === stepId)
  if (!step) return false

  step.status = status
  if (result !== undefined) step.result = result
  if (error !== undefined) step.error = error
  session.updatedAt = Date.now()
  persistSession(session)
  return true
}

export function listSessions(): DesignSession[] {
  cleanup()
  return Array.from(sessions.values()).map(s => ({
    ...s,
    plan: { ...s.plan, steps: [] },
  }))
}

function cleanup(): void {
  const now = Date.now()

  for (const [id, session] of sessions) {
    if (now - session.updatedAt > SESSION_TTL) {
      sessions.delete(id)
    }
  }

  if (sessions.size > MAX_SESSIONS) {
    const sorted = Array.from(sessions.entries()).sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    )
    const toRemove = sorted.slice(0, sorted.length - MAX_SESSIONS)
    for (const [id] of toRemove) {
      sessions.delete(id)
    }
  }
}

import type { DesignStep } from './types.js'
