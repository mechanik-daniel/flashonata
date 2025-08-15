/*
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: 2025 Outburn Ltd.

Project: Fumifier (part of the FUME open-source initiative)

*/

/**
 * @module FlashRuleResult
 * @description Flash rule result creation and detection utilities
 */

/**
 * Base Flash rule result prototype
 */
const base_flash_rule_result = {};

// Define the non-enumerable flag on prototype
Object.defineProperty(base_flash_rule_result, '@@__flashRuleResult', {
  value: true,
  writable: false,
  enumerable: false,
  configurable: false
});

/**
 * Create a Flash rule result object
 * @param {string} key - The grouping key for the element
 * @param {string} kind - The element kind (system, primitive-type, complex-type, resource)
 * @param {*} [value] - The evaluated value (defaults to undefined)
 * @returns {Object} Flash rule result object
 */
export function createFlashRuleResult(key, kind, value) {
  const result = Object.create(base_flash_rule_result);
  result.key = key;
  result.kind = kind;
  result.value = value; // defaults to undefined if not provided
  return result;
}

/**
 * Check if an object is a Flash rule result
 * @param {*} obj - Object to check
 * @returns {boolean} True if object is a Flash rule result
 */
export function isFlashRuleResult(obj) {
  return obj && typeof obj === 'object' && obj['@@__flashRuleResult'] === true;
}

/**
 * Create multiple Flash rule results from an array of values
 * @param {string} key - The grouping key for the element
 * @param {string} kind - The element kind (system, primitive-type, complex-type, resource)
 * @param {Array} values - Array of values to create results for
 * @returns {Array} Array of Flash rule result objects
 */
export function createFlashRuleResultArray(key, kind, values) {
  if (!Array.isArray(values)) {
    return createFlashRuleResult(key, kind, values);
  }
  return values.map(value => createFlashRuleResult(key, kind, value));
}
