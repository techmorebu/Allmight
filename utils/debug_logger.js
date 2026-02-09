// utils/debug_logger.js
// Comprehensive Debug Logging System
// Provides detailed logging with file output, console formatting, and error tracking

const fs = require('fs');
const path = require('path');

/**
 * Debug Logger
 * 
 * Features:
 * - Multiple log levels (debug, info, warn, error, critical)
 * - Console output with colors
 * - File output with rotation
 * - Performance timing
 * - Error stack traces
 * - Component tagging
 * - JSON structured logging for analysis
 */
class DebugLogger {
  constructor(options = {}) {
    this.logLevel = process.env.LOG_LEVEL || options.logLevel || 'info';
    this.component = options.component || 'Allmight';
    this.logToFile = options.logToFile !== false;
    this.logToConsole = options.logToConsole !== false;
    
    // Log levels with priorities
    this.levels = {
      debug: { priority: 0, color: '\x1b[36m', label: 'DEBUG' },    // Cyan
      info: { priority: 1, color: '\x1b[32m', label: 'INFO' },      // Green
      warn: { priority: 2, color: '\x1b[33m', label: 'WARN' },      // Yellow
      error: { priority: 3, color: '\x1b[31m', label: 'ERROR' },    // Red
      critical: { priority: 4, color: '\x1b[35m', label: 'CRIT' }   // Magenta
    };
    
    this.currentLevelPriority = this.levels[this.logLevel]?.priority || 1;
    
    // Log directory
    this.logDir = path.resolve(process.cwd(), 'logs');
    this.debugLogDir = path.join(this.logDir, 'debug');
    
    // Create directories if they don't exist
    if (this.logToFile) {
      this._ensureLogDirectories();
    }
    
    // Current log file
    this.currentLogFile = null;
    this._rotateLogFile();
    
    // Performance timers
    this.timers = new Map();
    
    // Error tracking
    this.errorCount = 0;
    this.lastErrors = [];
    this.maxStoredErrors = 100;
    
    // Session info
    this.sessionStart = Date.now();
    this.logCount = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      critical: 0
    };
  }
  
  /**
   * Log at debug level
   */
  debug(message, data = {}) {
    this._log('debug', message, data);
  }
  
  /**
   * Log at info level
   */
  info(message, data = {}) {
    this._log('info', message, data);
  }
  
  /**
   * Log at warn level
   */
  warn(message, data = {}) {
    this._log('warn', message, data);
  }
  
  /**
   * Log at error level
   */
  error(message, error = null, data = {}) {
    const errorData = { ...data };
    
    if (error instanceof Error) {
      errorData.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...error
      };
      
      // Track error
      this.errorCount++;
      this.lastErrors.push({
        timestamp: new Date().toISOString(),
        message,
        error: errorData.error
      });
      
      // Keep only last N errors
      if (this.lastErrors.length > this.maxStoredErrors) {
        this.lastErrors.shift();
      }
    }
    
    this._log('error', message, errorData);
  }
  
  /**
   * Log at critical level
   */
  critical(message, error = null, data = {}) {
    const errorData = { ...data };
    
    if (error instanceof Error) {
      errorData.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...error
      };
      
      this.errorCount++;
    }
    
    this._log('critical', message, errorData);
  }
  
  /**
   * Start performance timer
   */
  startTimer(label) {
    this.timers.set(label, {
      start: Date.now(),
      label
    });
    
    this.debug(`Timer started: ${label}`);
  }
  
  /**
   * End performance timer and log duration
   */
  endTimer(label, logLevel = 'debug') {
    const timer = this.timers.get(label);
    
    if (!timer) {
      this.warn(`Timer not found: ${label}`);
      return null;
    }
    
    const duration = Date.now() - timer.start;
    this.timers.delete(label);
    
    this._log(logLevel, `Timer completed: ${label}`, {
      duration_ms: duration,
      timer: label
    });
    
    return duration;
  }
  
  /**
   * Log function entry (for debugging call flows)
   */
  entering(functionName, params = {}) {
    this.debug(`→ Entering: ${functionName}`, {
      function: functionName,
      params: this._sanitizeParams(params)
    });
  }
  
  /**
   * Log function exit
   */
  exiting(functionName, result = null) {
    const data = { function: functionName };
    
    if (result !== null) {
      data.result = this._sanitizeParams(result);
    }
    
    this.debug(`← Exiting: ${functionName}`, data);
  }
  
  /**
   * Log API call details
   */
  apiCall(method, url, options = {}) {
    this.debug(`API ${method}: ${url}`, {
      api_method: method,
      api_url: url,
      api_options: this._sanitizeParams(options)
    });
  }
  
  /**
   * Log API response
   */
  apiResponse(url, status, data = {}) {
    const logLevel = status >= 400 ? 'error' : status >= 300 ? 'warn' : 'debug';
    
    this._log(logLevel, `API Response: ${url}`, {
      api_url: url,
      api_status: status,
      api_response: this._sanitizeParams(data)
    });
  }
  
  /**
   * Log data validation result
   */
  validation(component, isValid, errors = []) {
    const level = isValid ? 'debug' : 'warn';
    
    this._log(level, `Validation ${isValid ? 'passed' : 'failed'}: ${component}`, {
      component,
      valid: isValid,
      errors: errors
    });
  }
  
  /**
   * Log opportunity detection
   */
  opportunity(type, viable, profit, details = {}) {
    const level = viable ? 'info' : 'debug';
    
    this._log(level, `Opportunity ${viable ? 'VIABLE' : 'detected'}: ${type}`, {
      opportunity_type: type,
      viable,
      profit_usd: profit,
      ...details
    });
  }
  
  /**
   * Get session statistics
   */
  getStats() {
    const uptime = Date.now() - this.sessionStart;
    
    return {
      session_start: new Date(this.sessionStart).toISOString(),
      uptime_seconds: Math.floor(uptime / 1000),
      uptime_formatted: this._formatDuration(uptime),
      log_level: this.logLevel,
      log_counts: { ...this.logCount },
      total_logs: Object.values(this.logCount).reduce((a, b) => a + b, 0),
      error_count: this.errorCount,
      active_timers: this.timers.size,
      log_file: this.currentLogFile
    };
  }
  
  /**
   * Get recent errors
   */
  getRecentErrors(count = 10) {
    return this.lastErrors.slice(-count);
  }
  
  /**
   * Write summary to log file
   */
  writeSummary() {
    const stats = this.getStats();
    const summary = {
      timestamp: new Date().toISOString(),
      component: this.component,
      summary: 'Session Summary',
      ...stats,
      recent_errors: this.getRecentErrors(5)
    };
    
    this.info('Session Summary', summary);
  }
  
  // Private methods
  
  _log(level, message, data = {}) {
    const levelConfig = this.levels[level];
    
    if (!levelConfig) {
      console.error(`Invalid log level: ${level}`);
      return;
    }
    
    // Check if we should log this level
    if (levelConfig.priority < this.currentLevelPriority) {
      return;
    }
    
    // Increment counter
    this.logCount[level]++;
    
    // Build log entry
    const entry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      component: this.component,
      message,
      ...data
    };
    
    // Console output
    if (this.logToConsole) {
      this._writeConsole(levelConfig, entry);
    }
    
    // File output
    if (this.logToFile) {
      this._writeFile(entry);
    }
  }
  
  _writeConsole(levelConfig, entry) {
    const color = levelConfig.color;
    const reset = '\x1b[0m';
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    
    // Format: [HH:MM:SS] [LEVEL] [Component] Message
    let output = `${color}[${timestamp}] [${levelConfig.label}] [${entry.component}]${reset} ${entry.message}`;
    
    console.log(output);
    
    // Print additional data if present
    const additionalData = { ...entry };
    delete additionalData.timestamp;
    delete additionalData.level;
    delete additionalData.component;
    delete additionalData.message;
    
    if (Object.keys(additionalData).length > 0) {
      // Pretty print data
      const dataStr = JSON.stringify(additionalData, null, 2);
      console.log(`${color}${dataStr}${reset}`);
    }
  }
  
  _writeFile(entry) {
    try {
      // Rotate log file if needed (daily rotation)
      this._checkLogRotation();
      
      const logLine = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.currentLogFile, logLine);
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }
  
  _ensureLogDirectories() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      
      if (!fs.existsSync(this.debugLogDir)) {
        fs.mkdirSync(this.debugLogDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create log directories:', error.message);
    }
  }
  
  _rotateLogFile() {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `allmight_${this.component.toLowerCase()}_${date}.log`;
    this.currentLogFile = path.join(this.debugLogDir, filename);
  }
  
  _checkLogRotation() {
    const currentDate = new Date().toISOString().split('T')[0];
    
    if (!this.currentLogFile.includes(currentDate)) {
      this._rotateLogFile();
    }
  }
  
  _sanitizeParams(params) {
    // Remove sensitive data from logs
    if (typeof params !== 'object' || params === null) {
      return params;
    }
    
    const sanitized = { ...params };
    const sensitiveKeys = ['private_key', 'secret', 'password', 'api_key', 'token'];
    
    for (const key of Object.keys(sanitized)) {
      const lowerKey = key.toLowerCase();
      
      if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }
  
  _formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }
}

// Factory function
function createLogger(component, options = {}) {
  return new DebugLogger({ ...options, component });
}

// Export singleton for global use
const globalLogger = new DebugLogger({ component: 'Global' });

module.exports = {
  DebugLogger,
  createLogger,
  logger: globalLogger
};

// Testing
if (require.main === module) {
  console.log('Testing Debug Logger...\n');
  
  const logger = createLogger('TestComponent');
  
  logger.info('Logger initialized');
  logger.debug('This is a debug message', { test: 'data' });
  logger.warn('This is a warning', { warning_level: 'medium' });
  
  logger.startTimer('test_operation');
  setTimeout(() => {
    logger.endTimer('test_operation', 'info');
    
    logger.entering('testFunction', { param1: 'value1', api_key: 'secret123' });
    logger.exiting('testFunction', { result: 'success' });
    
    try {
      throw new Error('Test error for logging');
    } catch (error) {
      logger.error('Caught an error', error, { additional: 'context' });
    }
    
    logger.opportunity('cross_dex', true, 127.50, {
      exchange1: 'uniswap',
      exchange2: 'sushiswap'
    });
    
    console.log('\n--- Session Stats ---');
    console.log(JSON.stringify(logger.getStats(), null, 2));
    
    console.log('\n--- Recent Errors ---');
    console.log(JSON.stringify(logger.getRecentErrors(), null, 2));
    
    logger.writeSummary();
    
    console.log('\n✅ Test complete! Check logs/ directory for output files.');
  }, 1000);
}
