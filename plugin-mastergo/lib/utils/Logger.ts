/**
 * 日志级别枚举
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

/**
 * 日志配置接口
 */
export interface LoggerConfig {
  level: LogLevel
  enableConsole: boolean
  prefix: string
  maxHistory: number
}

/**
 * 日志条目接口
 */
interface LogEntry {
  timestamp: number
  level: LogLevel
  message: string
  data?: any
}

/**
 * 统一日志管理器
 * 
 * 功能：
 * - 支持多级别日志
 * - 日志历史记录
 * - 性能优化（避免频繁字符串拼接）
 * - 内存管理（限制历史记录数量）
 */
export class Logger {
  private config: LoggerConfig
  private history: LogEntry[] = []
  private static instance: Logger | null = null

  private constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: config.level ?? LogLevel.INFO,
      enableConsole: config.enableConsole ?? true,
      prefix: config.prefix ?? '[App]',
      maxHistory: config.maxHistory ?? 100
    }
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: Partial<LoggerConfig>): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(config)
    }
    return Logger.instance
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 记录调试日志
   */
  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data)
  }

  /**
   * 记录信息日志
   */
  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data)
  }

  /**
   * 记录警告日志
   */
  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data)
  }

  /**
   * 记录错误日志
   */
  error(message: string, error?: Error | any): void {
    this.log(LogLevel.ERROR, message, error)
  }

  /**
   * 核心日志方法
   */
  private log(level: LogLevel, message: string, data?: any): void {
    if (level < this.config.level) {
      return
    }

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      data
    }

    this.addToHistory(entry)

    if (this.config.enableConsole) {
      this.outputToConsole(entry)
    }
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(entry: LogEntry): void {
    this.history.push(entry)
    
    if (this.history.length > this.config.maxHistory) {
      this.history.shift()
    }
  }

  /**
   * 输出到控制台
   */
  private outputToConsole(entry: LogEntry): void {
    const { level, message, data } = entry
    const timestamp = new Date(entry.timestamp).toISOString()
    const prefix = `${this.config.prefix} [${LogLevel[level]}]`

    const logMessage = `${timestamp} ${prefix} ${message}`

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(logMessage, data)
        break
      case LogLevel.INFO:
        console.info(logMessage, data)
        break
      case LogLevel.WARN:
        console.warn(logMessage, data)
        break
      case LogLevel.ERROR:
        console.error(logMessage, data)
        break
    }
  }

  /**
   * 获取历史记录
   */
  getHistory(): LogEntry[] {
    return [...this.history]
  }

  /**
   * 清空历史记录
   */
  clearHistory(): void {
    this.history = []
  }

  /**
   * 销毁日志器
   */
  destroy(): void {
    this.clearHistory()
    Logger.instance = null
  }
}

/**
 * 导出便捷函数
 */
export const logger = Logger.getInstance()
