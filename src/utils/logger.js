/* eslint-disable no-console */
/* eslint-disable require-jsdoc */
/**
 * @module Logger
 * @description Verbose logging system for tracing fumifier expression evaluation
 */

/**
 * Logger class for tracking evaluation flow
 */
class Logger {
  constructor(enabled = false) {
    this.enabled = enabled;
    this.depth = 0;
    this.logs = [];
    this.startTime = Date.now();
  }

  /**
   * Enable or disable logging
   * @param {boolean} enabled - Whether to enable logging
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Get current timestamp relative to start
   * @returns {string} Formatted timestamp
   */
  getTimestamp() {
    return `+${Date.now() - this.startTime}ms`;
  }

  /**
   * Get indentation string based on current depth
   * @returns {string} Indentation
   */
  getIndent() {
    return '  '.repeat(this.depth);
  }

  /**
   * Format expression info for logging
   * @param {Object} expr - Expression object
   * @returns {string} Formatted expression info
   */
  formatExpression(expr) {
    if (!expr) return 'null';

    const type = expr.type || 'unknown';
    let details = `type: ${type}`;

    if (expr.value !== undefined) {
      details += `, value: ${JSON.stringify(expr.value)}`;
    }

    if (expr.isFlashBlock) {
      details += `, FlashBlock: ${expr.instanceof}`;
    }

    if (expr.isFlashRule) {
      details += `, FlashRule: ${expr.flashPathRefKey}`;
    }

    if (expr.flashPathRefKey) {
      details += `, flashPath: ${expr.flashPathRefKey}`;
    }

    if (expr.position !== undefined) {
      details += `, pos: ${expr.position}`;
    }

    return `{${details}}`;
  }

  /**
   * Format input data for logging (truncate if too long)
   * @param {*} input - Input data
   * @returns {string} Formatted input
   */
  formatInput(input) {
    if (input === undefined) return 'undefined';
    if (input === null) return 'null';

    let str = JSON.stringify(input);
    if (str.length > 200) {
      str = str.substring(0, 197) + '...';
    }
    return str;
  }

  /**
   * Format result data for logging (truncate if too long)
   * @param {*} result - Result data
   * @returns {string} Formatted result
   */
  formatResult(result) {
    if (result === undefined) return 'undefined';
    if (result === null) return 'null';

    // Special handling for flash rule results
    if (result && result['@@__flashRuleResult']) {
      return `FlashRuleResult{key: ${result.key}, kind: ${result.kind}, value: ${this.formatInput(result.value)}}`;
    }

    let str = JSON.stringify(result);
    if (str.length > 200) {
      str = str.substring(0, 197) + '...';
    }
    return str;
  }

  /**
   * Log entry into evaluation function
   * @param {string} functionName - Name of evaluation function
   * @param {Object} expr - Expression being evaluated
   * @param {*} input - Input data
   * @param {Object} context - Additional context
   */
  enter(functionName, expr, input, context = {}) {
    if (!this.enabled) return;

    const logEntry = {
      type: 'enter',
      timestamp: this.getTimestamp(),
      depth: this.depth,
      function: functionName,
      expression: this.formatExpression(expr),
      input: this.formatInput(input),
      context
    };

    this.logs.push(logEntry);

    console.log(
      `${this.getTimestamp()} ${this.getIndent()}→ ${functionName}`,
      `\n${this.getIndent()}  expr: ${logEntry.expression}`,
      `\n${this.getIndent()}  input: ${logEntry.input}`,
      Object.keys(context).length > 0 ? `\n${this.getIndent()}  context: ${JSON.stringify(context)}` : ''
    );

    this.depth++;
  }

  /**
   * Log exit from evaluation function
   * @param {string} functionName - Name of evaluation function
   * @param {*} result - Result of evaluation
   * @param {Object} context - Additional context
   */
  exit(functionName, result, context = {}) {
    if (!this.enabled) return;

    this.depth--;

    const logEntry = {
      type: 'exit',
      timestamp: this.getTimestamp(),
      depth: this.depth,
      function: functionName,
      result: this.formatResult(result),
      context
    };

    this.logs.push(logEntry);

    console.log(
      `${this.getTimestamp()} ${this.getIndent()}← ${functionName}`,
      `\n${this.getIndent()}  result: ${logEntry.result}`,
      Object.keys(context).length > 0 ? `\n${this.getIndent()}  context: ${JSON.stringify(context)}` : ''
    );
  }

  /**
   * Log informational message
   * @param {string} functionName - Name of current function
   * @param {string} message - Log message
   * @param {Object} data - Additional data to log
   */
  info(functionName, message, data = {}) {
    if (!this.enabled) return;

    const logEntry = {
      type: 'info',
      timestamp: this.getTimestamp(),
      depth: this.depth,
      function: functionName,
      message,
      data
    };

    this.logs.push(logEntry);

    console.log(
      `${this.getTimestamp()} ${this.getIndent()}ℹ ${functionName}: ${message}`,
      Object.keys(data).length > 0 ? `\n${this.getIndent()}  data: ${JSON.stringify(data, null, 2)}` : ''
    );
  }

  /**
   * Log error message
   * @param {string} functionName - Name of current function
   * @param {string} message - Error message
   * @param {Error|Object} error - Error object
   */
  error(functionName, message, error = {}) {
    if (!this.enabled) return;

    const logEntry = {
      type: 'error',
      timestamp: this.getTimestamp(),
      depth: this.depth,
      function: functionName,
      message,
      error: error.message || error.code || String(error)
    };

    this.logs.push(logEntry);

    console.error(
      `${this.getTimestamp()} ${this.getIndent()}✗ ${functionName}: ${message}`,
      `\n${this.getIndent()}  error: ${logEntry.error}`
    );
  }

  /**
   * Log warning message
   * @param {string} functionName - Name of current function
   * @param {string} message - Warning message
   * @param {Object} data - Additional data
   */
  warn(functionName, message, data = {}) {
    if (!this.enabled) return;

    const logEntry = {
      type: 'warn',
      timestamp: this.getTimestamp(),
      depth: this.depth,
      function: functionName,
      message,
      data
    };

    this.logs.push(logEntry);

    console.warn(
      `${this.getTimestamp()} ${this.getIndent()}⚠ ${functionName}: ${message}`,
      Object.keys(data).length > 0 ? `\n${this.getIndent()}  data: ${JSON.stringify(data)}` : ''
    );
  }

  /**
   * Get all logs
   * @returns {Array} Array of log entries
   */
  getLogs() {
    return [...this.logs];
  }

  /**
   * Clear all logs
   */
  clear() {
    this.logs = [];
    this.depth = 0;
    this.startTime = Date.now();
  }

  /**
   * Export logs as formatted string
   * @returns {string} Formatted log output
   */
  export() {
    return this.logs.map(log => {
      const indent = '  '.repeat(log.depth);
      const symbol = log.type === 'enter' ? '→' : log.type === 'exit' ? '←' :
        log.type === 'error' ? '✗' : log.type === 'warn' ? '⚠' : 'ℹ';

      let line = `${log.timestamp} ${indent}${symbol} ${log.function}`;

      if (log.expression) line += `\n${indent}  expr: ${log.expression}`;
      if (log.input !== undefined) line += `\n${indent}  input: ${log.input}`;
      if (log.result !== undefined) line += `\n${indent}  result: ${log.result}`;
      if (log.message) line += `: ${log.message}`;
      if (log.error) line += `\n${indent}  error: ${log.error}`;

      return line;
    }).join('\n');
  }
}

// Create a global logger instance
const logger = new Logger();

export default logger;
