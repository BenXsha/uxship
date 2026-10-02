export type ErrorSeverity = 'WARN' | 'ERROR' | 'FATAL'

export interface ToolError {
  severity: ErrorSeverity
  code: string
  message: string
  context?: Record<string, unknown>
  cause?: unknown
}

export function toolError(
  severity: ErrorSeverity,
  code: string,
  message: string,
  context?: Record<string, unknown>,
  cause?: unknown,
): ToolError {
  return { severity, code, message, context, cause }
}

export function warn(message: string, context?: Record<string, unknown>, cause?: unknown): ToolError {
  return toolError('WARN', 'WARN', message, context, cause)
}

export function err(message: string, context?: Record<string, unknown>, cause?: unknown): ToolError {
  return toolError('ERROR', 'ERROR', message, context, cause)
}

export function safeCatch<T>(contextLabel: string, fn: () => T, fallback: T, logFn?: (e: unknown) => void): T {
  try {
    return fn()
  } catch (e) {
    if (logFn) logFn(e)
    else console.error(`[${contextLabel}]`, e)
    return fallback
  }
}

export async function safeCatchAsync<T>(
  contextLabel: string,
  fn: () => Promise<T>,
  fallback: T,
  logFn?: (e: unknown) => void,
): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (logFn) logFn(e)
    else console.error(`[${contextLabel}]`, e)
    return fallback
  }
}

export function isToolError(v: unknown): v is ToolError {
  return typeof v === 'object' && v !== null && 'severity' in v && 'code' in v && 'message' in v
}
