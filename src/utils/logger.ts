/**
 * Logger utility for the application
 * Provides consistent logging interface across the application
 * 
 * TODO: Integrate with external logging service (Logflare, Datadog, etc.)
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogMessage {
  level: LogLevel;
  message: string;
  timestamp: string;
  data?: any;
  error?: any;
}

class Logger {
  private logLevel: LogLevel;

  constructor() {
    // Default to 'info' if LOG_LEVEL env var is not set
    this.logLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private formatLog(level: LogLevel, message: string, data?: any): LogMessage {
    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      data
    };
  }

  private output(logMessage: LogMessage) {
    const { level, message, timestamp, data, error } = logMessage;
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    // TODO: Send to external logging service
    // For now, use console methods
    switch (level) {
      case 'debug':
        console.debug(prefix, message, data || '');
        break;
      case 'info':
        console.info(prefix, message, data || '');
        break;
      case 'warn':
        console.warn(prefix, message, data || '');
        break;
      case 'error':
        console.error(prefix, message, data || '', error || '');
        break;
    }
  }

  debug(message: string, data?: any) {
    if (this.shouldLog('debug')) {
      this.output(this.formatLog('debug', message, data));
    }
  }

  info(message: string, data?: any) {
    if (this.shouldLog('info')) {
      this.output(this.formatLog('info', message, data));
    }
  }

  warn(message: string, data?: any) {
    if (this.shouldLog('warn')) {
      this.output(this.formatLog('warn', message, data));
    }
  }

  error(message: string, error?: any, data?: any) {
    if (this.shouldLog('error')) {
      const logMessage = this.formatLog('error', message, data);
      logMessage.error = error;
      this.output(logMessage);
    }
  }
}

// Export singleton instance
export const logger = new Logger();

// Export the old log function for backward compatibility
export function log(...args: unknown[]) {
  logger.info(args.map(arg => String(arg)).join(' '));
} 