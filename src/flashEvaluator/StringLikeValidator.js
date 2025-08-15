/*
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: 2025 Outburn Ltd.

Project: Fumifier (part of the FUME open-source initiative)

*/

/**
 * @module StringLikeValidator
 * @description Validation for FHIR string-like primitives (string | markdown | code)
 */

import fn from '../utils/functions.js';
import FlashErrorGenerator from './FlashErrorGenerator.js';

// Precompiled regexes and helpers
const RE_LEADING_OR_TRAILING_WS = /^\s|\s$/u;
const RE_DOUBLE_SPACE_OR_NBSP = /( |\u00A0){2,}/u;
const RE_ANY_WS = /\s/u; // JS Unicode whitespace

/**
 * Check if character is Unicode whitespace.
 * @param {string} ch Single character
 * @returns {boolean} True if whitespace
 */
function isWhitespaceChar(ch) {
  return RE_ANY_WS.test(ch);
}

/**
 * Class housing validation for string-like FHIR primitives
 */
export default class StringLikeValidator {
  /**
   * Validate a FHIR string-like primitive. Returns either the original input (when inhibited)
   * or a string (valid or downgraded) according to policy.
   *
   * Error codes:
   * - F5112: string/markdown invalid content
   * - F5113: code invalid content
   *
   * Inhibition gate: F5110 — when outside band, returns raw input unmodified
   *
   * @param {Object} expr Expression with FHIR context
   * @param {*} input Raw input value
   * @param {('string'|'markdown'|'code')} fhirTypeCode FHIR type code
   * @param {string} elementFlashPath For diagnostics
   * @param {Object} policy Active validation policy (with shouldValidate/enforce)
   * @returns {*} string (validated) or original input when inhibited
   */
  static validate(expr, input, fhirTypeCode, elementFlashPath, policy) {
    // Inhibit entire validation if regex band is skipped (align with date-like behavior)
    if (!policy.shouldValidate('F5110')) {
      return input; // inhibited: return raw input
    }

    const s = fn.string(input);

    if (fhirTypeCode === 'code') {
      // code rules:
      // - at least one character
      // - no leading/trailing whitespace (Unicode)
      // - only single spaces or NBSPs between non-space characters
      // - no other whitespace characters allowed anywhere
      const hasAnyChar = s.length > 0;
      const leadingOrTrailingWS = RE_LEADING_OR_TRAILING_WS.test(s);

      // disallow any whitespace that is not ASCII space or NBSP
      let hasDisallowedWS = false;
      for (const ch of s) {
        if (isWhitespaceChar(ch) && ch !== ' ' && ch !== '\u00A0') { hasDisallowedWS = true; break; }
      }

      // disallow consecutive allowed space separators (space or NBSP)
      const hasDoubleSpace = RE_DOUBLE_SPACE_OR_NBSP.test(s);

      if (!hasAnyChar || leadingOrTrailingWS || hasDisallowedWS || hasDoubleSpace) {
        const err = FlashErrorGenerator.createError('F5113', expr, {
          value: s,
          fhirElement: elementFlashPath,
          fhirType: fhirTypeCode
        });
        if (policy.enforce(err)) throw err;
        return s; // downgraded
      }
      return s;
    }

    // string/markdown rules:
    // - allow TAB (U+0009), LF (U+000A), CR (U+000D)
    // - allow all characters from U+0020 upwards, excluding C1 controls U+0080..U+009F
    // - must contain at least one non-whitespace character
    let validChars = true;
    let hasNonWhitespace = false;
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (cp < 0x20) {
        if (cp !== 0x09 && cp !== 0x0A && cp !== 0x0D) { validChars = false; break; }
      } else if (cp >= 0x80 && cp <= 0x9F) {
        validChars = false; break; // exclude C1 controls
      }
      if (!isWhitespaceChar(ch)) hasNonWhitespace = true;
    }

    if (!validChars || !hasNonWhitespace) {
      const err = FlashErrorGenerator.createError('F5112', expr, {
        value: s,
        fhirElement: elementFlashPath,
        fhirType: fhirTypeCode
      });
      if (policy.enforce(err)) throw err;
      return s; // downgraded
    }

    return s;
  }
}
