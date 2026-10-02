type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

const CURRENT_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'INFO'

interface LogEntry {
  ts: string
  level: LogLevel
  msg: string
  ctx?: Record<string, unknown>
}

function writeLog(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[CURRENT_LEVEL]) return
  const entry: LogEntry = { ts: new Date().toISOString(), level, msg }
  if (ctx && Object.keys(ctx).length > 0) entry.ctx = ctx
  const line = JSON.stringify(entry)
  process.stderr.write(line + '\n')
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => writeLog('DEBUG', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => writeLog('INFO', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => writeLog('WARN', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => writeLog('ERROR', msg, ctx),
}

export function createRequestLogger(requestId: string | number, method: string) {
  const baseCtx = { rid: String(requestId), method }
  return {
    debug: (msg: string, ctx?: Record<string, unknown>) => logger.debug(msg, { ...baseCtx, ...ctx }),
    info: (msg: string, ctx?: Record<string, unknown>) => logger.info(msg, { ...baseCtx, ...ctx }),
    warn: (msg: string, ctx?: Record<string, unknown>) => logger.warn(msg, { ...baseCtx, ...ctx }),
    error: (msg: string, ctx?: Record<string, unknown>) => logger.error(msg, { ...baseCtx, ...ctx }),
  }
}
