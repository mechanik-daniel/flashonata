/* eslint-disable require-jsdoc */
/** Takes a FHIR Structure Navigator and returns helper functions used to fetch FHIR semantic data
 * @param {FhirStructureNavigator} navigator - FHIR structure navigator
 * @returns {Object} An object containing functions to fetch FHIR data
 * @property {Function} getElement - Function to fetch element definitions
 * @property {Function} getChildren - Function to fetch the direct children of a FHIR element
 * @property {Function} getTypeMeta - Function to fetch metadata of type or profile definitions
 */

function createFhirFetchers(navigator) {
  return {
    getElement: async function (snapshotId, path) {
      return await navigator.getElement(snapshotId, path);
    },
    getChildren: async function (snapshotId, path) {
      return await navigator.getChildren(snapshotId, path ?? '.');
    },
    getTypeMeta: async function (snapshotId) {
      return await navigator.getFsg().getMetadata(snapshotId);
    },
    getBaseTypeMeta: async function (typeCode, sourcePackage) {
      return await navigator.getFsg().getMetadata(typeCode, sourcePackage);
    }
  };
}

export default createFhirFetchers;
