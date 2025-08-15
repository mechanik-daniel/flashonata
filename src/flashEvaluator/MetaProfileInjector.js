/*
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: 2025 Outburn Ltd.

Project: Fumifier (part of the FUME open-source initiative)

*/

/**
 * @module MetaProfileInjector
 * @description Handles injection of meta.profile for profiled FHIR resources
 */

/**
 * Utility for injecting meta.profile into FHIR resources
 */
class MetaProfileInjector {
  /**
   * Inject meta.profile for profiled resources
   * @param {Object} result - Result object to modify
   * @param {string} resourceType - Resource type
   * @param {string} profileUrl - Profile URL
   * @returns {Object} Modified result object
   */
  static injectMetaProfile(result, resourceType, profileUrl) {
    // inject meta.profile if this is a profiled resource and it isn't already set
    if (typeof profileUrl !== 'string') {
      // if profileUrl is not a string, do nothing
      return result;
    }

    // if meta is missing entirely, create it
    if (!result.meta) {
      // if it was missing, we need to put it right after the id, before all other properties
      const hasId = Object.prototype.hasOwnProperty.call(result, 'id');
      if (hasId) {
        result = { resourceType, id: result.id, meta: { profile: [profileUrl] }, ...result };
      } else {
        result = { resourceType, meta: { profile: [profileUrl] }, ...result };
      }
    } else if (!result.meta.profile || !Array.isArray(result.meta.profile)) {
      result.meta.profile = [profileUrl];
    } else if (!result.meta.profile.includes(profileUrl)) {
      result.meta.profile.push(profileUrl);
    }

    return result;
  }
}

export default MetaProfileInjector;
