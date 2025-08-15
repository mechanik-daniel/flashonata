/*
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: 2025 Outburn Ltd.

Project: Fumifier (part of the FUME open-source initiative)

*/

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
   * Create a simple error with just basic error object structure
   * Used for errors that only need code + standard position/stack info
   * @param {string} code - Error code (e.g., "F3000", "F3003", "F3004", "F3005")
   * @param {Object} expr - Expression with position info for errors
   * @returns {Object} Formatted simple error
   */
  static createSimpleError(code, expr) {
    const generateErrorObject = (error) => {
      const baseErr = {
        stack: (error || new Error()).stack,
        position: expr.position,
        start: expr.start,
        line: expr.line
      };
      if (expr.instanceof) {
        baseErr.instanceOf = expr.instanceof;
        if (expr.flashPathRefKey) {
          baseErr.fhirElement = expr.flashPathRefKey.slice(expr.instanceof.length + 2);
        }
      }
      return baseErr;
    };

    return { code, ...generateErrorObject(new Error()) };
  }

  /**
   * Create a FHIR context error with parent and element information
   * @param {string} code - Error code (e.g., "F5130", "F5140")
   * @param {Object} expr - Expression with position info for errors
   * @param {Object} context - Additional context fields
   * @returns {Object} Formatted FHIR context error
   */
  static createFhirContextError(code, expr, context = {}) {
    return {
      code,
      stack: (new Error()).stack,
      position: expr.position,
      start: expr.start,
      line: expr.line,
      ...context
    };
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
