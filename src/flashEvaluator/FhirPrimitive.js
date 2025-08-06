/**
 * @module FhirPrimitive
 * @description FHIR primitive creation and detection utilities
 */

/**
 * Base FHIR primitive prototype
 */
const base_fhir_primitive = {};

// Define the non-enumerable flag on prototype
Object.defineProperty(base_fhir_primitive, '@@__fhirPrimitive', {
  value: true,
  writable: false,
  enumerable: false,
  configurable: false
});

/**
 * Create a FHIR primitive object
 * @param {Object|*} obj - Object with value and properties, or primitive value directly
 * @returns {Object} FHIR primitive object
 */
export function createFhirPrimitive(obj) {
  var primitive = Object.create(base_fhir_primitive);

  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    // Object with value and properties
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        primitive[key] = obj[key];
      }
    }
  } else {
    // Primitive value directly
    primitive.value = obj;
  }

  return primitive;
}

/**
 * Check if an object is a FHIR primitive
 * @param {*} obj - Object to check
 * @returns {boolean} True if object is a FHIR primitive
 */
export function isFhirPrimitive(obj) {
  return obj && typeof obj === 'object' && obj['@@__fhirPrimitive'] === true;
}
