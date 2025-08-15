/*
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: 2025 Outburn Ltd.

Project: Fumifier (part of the FUME open-source initiative)

*/

/**
 * @module SystemPrimitiveValidator
 * @description Internal helpers for system primitive validation/coercion.
 * NOTE: Used by PrimitiveValidator as an implementation detail.
 */

import fn from '../utils/functions.js';
import FlashErrorGenerator from './FlashErrorGenerator.js';

// Import utility functions directly since they are simple utilities
const { boolize } = fn;

/**
 * Validation/coercion helpers for system primitives
 */
class SystemPrimitiveValidator {
  /**
   * Validate input value for processing
   * @param {*} input - Input value to validate
   * @returns {Object} Validation result with isValid flag and processed value
   */
  static validateInput(input) {
    const boolized = boolize(input);
    if (input === undefined || (boolized === false && input !== false && input !== 0)) {
      return { isValid: false, shouldSkip: true };
    }
    return { isValid: true, value: input };
  }

  /**
   * Validate that input is a primitive type
   * @param {*} input - Input value to validate
   * @param {Object} expr - Expression for error reporting
   * @param {string} elementFlashPath - FHIR element path for error reporting
   * @returns {string} Value type if valid
   */
  static validateType(input, expr, elementFlashPath) {
    const valueType = fn.type(input);
    if (valueType !== 'string' && valueType !== 'number' && valueType !== 'boolean') {
      throw FlashErrorGenerator.createValidationError('F5101', expr, fn.string(input), {
        valueType,
        fhirElement: elementFlashPath
      });
    }
    return valueType;
  }

  /**
   * Convert value to appropriate JSON type based on FHIR type code
   * @param {*} input - Input value to convert
   * @param {string} fhirTypeCode - FHIR type code
   * @param {string} valueType - JavaScript type of input
   * @returns {*} Converted value
   */
  static convertValue(input, fhirTypeCode, valueType) {
    // Handle boolean elements
    if (fhirTypeCode === 'boolean') {
      // Special handling for explicit string 'false' and 'FALSE'
      if (typeof input === 'string' && (input === 'false' || input === 'FALSE')) {
        return false;
      }
      return boolize(input);
    }

    // Handle numeric types
    if (['decimal', 'integer', 'positiveInt', 'integer64', 'unsignedInt'].includes(fhirTypeCode)) {
      // since policy may have caused regex validation inhibition, the conversion to a number may fail.
      // if it does, we return the invalid input as is
      try {
        return this.convertToNumber(input, valueType);
      } catch {
        return input;
      }
    }

    // All other types as strings
    return fn.string(input);
  }

  /**
   * Convert input to number type
   * @param {*} input - Input value to convert
   * @param {string} valueType - JavaScript type of input
   * @returns {number} Converted number
   */
  static convertToNumber(input, valueType) {
    if (valueType === 'number') return input;
    if (valueType === 'string') return Number(input);
    if (valueType === 'boolean') return input ? 1 : 0;
    return input;
  }
}

export default SystemPrimitiveValidator;
