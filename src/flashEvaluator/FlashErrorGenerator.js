/**
 * @module FlashErrorGenerator
 * @description Standardized error generation for FLASH evaluation
 */

import fn from '../utils/functions.js';

/**
 * Generate standardized error objects with consistent structure
 */
class FlashErrorGenerator {
  /**
   * Create a standardized error object
   * @param {string} code - Error code
   * @param {Object} expr - Expression with position info
   * @param {Object} additionalData - Additional error data
   * @returns {Object} Standardized error object
   */
  static createError(code, expr, additionalData = {}) {
    const baseError = {
      code,
      stack: (new Error()).stack,
      position: expr.position,
      start: expr.start,
      line: expr.line,
      ...additionalData
    };

    if (expr.instanceof) {
      baseError.instanceOf = expr.instanceof;
      if (expr.flashPathRefKey) {
        baseError.fhirElement = expr.flashPathRefKey.slice(expr.instanceof.length + 2);
      }
    }

    return baseError;
  }

  /**
   * Create a validation error with value type information
   * @param {string} code - Error code
   * @param {Object} expr - Expression with position info
   * @param {*} value - Value that failed validation
   * @param {Object} additionalData - Additional error data
   * @returns {Object} Validation error object
   */
  static createValidationError(code, expr, value, additionalData = {}) {
    return this.createError(code, expr, {
      value,
      valueType: fn.type(value),
      ...additionalData
    });
  }
}

export default FlashErrorGenerator;
