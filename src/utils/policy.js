/* eslint-disable no-console */
// Centralized policy utilities for validation inhibition, logging, collection, and throw decision
// This wraps diagnostics.js and errorCodes.js into a tiny API consumable by call sites.

import { decide, getLogger, push, LEVELS, severityFromCode, thresholds } from './diagnostics.js';
import { populateMessage } from './errorCodes.js';

/**
 * Log a populated error by its severity using the environment logger.
 * @param {*} env Execution environment
 * @param {*} err Error object with at least a code
 */
function logBySeverity(env, err) {
  const sev = severityFromCode(err.code);
  const logger = getLogger(env);
  const ctx = err.fhirParent || err.fhirElement ? ` [${err.fhirParent || ''}${err.fhirParent && err.fhirElement ? ' -> ' : ''}${err.fhirElement || ''}]` : '';
  const msg = `${err.code}: ${err.message || 'FLASH issue'}${ctx}`;

  // Map severity ranges to logger methods
  if (sev < LEVELS.invalid) logger.error(msg);      // fatal
  else if (sev < LEVELS.error) logger.error(msg);   // invalid
  else if (sev < LEVELS.warning) logger.error(msg); // error
  else if (sev < LEVELS.notice) logger.warn(msg);   // warning
  else if (sev < LEVELS.info) logger.info(msg);     // notice
  else if (sev < LEVELS.debug) logger.info(msg);    // info
  else logger.debug(msg);                           // debug
}

/**
 * Create a policy instance bound to an environment frame.
 * @param {*} env Execution environment
 * @returns {*} Policy API with shouldValidate(code) and enforce(err)
 */
export function createPolicy(env) {
  return {
    shouldValidate(code) {
      const sev = severityFromCode(code);
      const { validationLevel } = thresholds(env);
      return sev < validationLevel;
    },
    enforce(err) {
      try { populateMessage(err); } catch (_) { /* no-op */ }
      const sev = severityFromCode(err.code);
      const { validationLevel } = thresholds(env);
      // If inhibited, collect only, do not log/throw
      if (!(sev < validationLevel)) {
        try { Object.defineProperty(err, '__inhibited', { value: true, enumerable: false }); } catch (_) { /* ignore */ }
        push(env, err);
        return false;
      }
      const { shouldThrow, shouldLog } = decide(err.code, env);
      if (shouldLog) {
        logBySeverity(env, err);
        try { Object.defineProperty(err, '__logged', { value: true, enumerable: false }); } catch (_) { /* ignore */ }
      }
      push(env, err);
      return shouldThrow;
    }
  };
}

export default createPolicy;
