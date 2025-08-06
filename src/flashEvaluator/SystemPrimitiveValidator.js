/**
 * @module SystemPrimitiveValidator
 * @description Validation logic for system primitives in FLASH evaluation
 */

import fn from '../utils/functions.js';
import FlashErrorGenerator from './FlashErrorGenerator.js';

// Import utility functions directly since they are simple utilities
const { boolize } = fn;

/**
 * Validation logic for system primitives
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
      throw FlashErrorGenerator.createValidationError("F3006", expr, fn.string(input), {
        valueType,
        fhirElement: elementFlashPath
      });
    }
    return valueType;
  }

  /**
   * Validate input against regex constraint
   * @param {*} input - Input value to validate
   * @param {Object} elementDefinition - FHIR element definition
   * @param {Object} expr - Expression for error reporting
   * @param {string} elementFlashPath - FHIR element path for error reporting
   * @param {Object} environment - Environment with regex testers
   */
  static validateRegex(input, elementDefinition, expr, elementFlashPath, environment) {
    if (elementDefinition.__regexStr) {
      const regexTester = this.getRegexTester(environment, elementDefinition.__regexStr);
      if (regexTester && !regexTester.test(fn.string(input))) {
        throw FlashErrorGenerator.createError("F3001", expr, {
          value: input,
          regex: elementDefinition.__regexStr,
          fhirElement: elementFlashPath
        });
      }
    }
  }

  /**
   * Get compiled FHIR regex tester from environment
   * @param {Object} environment - Environment with compiled regexes
   * @param {string} regexStr - Regex string to compile
   * @returns {RegExp} Compiled regex
   */
  static getRegexTester(environment, regexStr) {
    var compiled = environment.lookup(Symbol.for('fumifier.__compiledFhirRegex_GET'))(regexStr);
    if (compiled) {
      return compiled;
    }
    compiled = environment.lookup(Symbol.for('fumifier.__compiledFhirRegex_SET'))(regexStr);
    return compiled;
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
      return boolize(input);
    }

    // Handle numeric types
    if (['decimal', 'integer', 'positiveInt', 'integer64', 'unsignedInt'].includes(fhirTypeCode)) {
      return this.convertToNumber(input, valueType);
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
