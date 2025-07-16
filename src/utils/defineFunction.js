import parseSignature from './signature.js';

/**
     * Creates a function definition
     * @param {Function} func - function implementation in Javascript
     * @param {string} signature - JSONata function signature definition
     * @returns {{implementation: *, signature: *}} function definition
     */
function defineFunction(func, signature) {
  var definition = {
    _fumifier_function: true,
    implementation: func
  };
  if(typeof signature !== 'undefined') {
    definition.signature = parseSignature(signature);
  }
  return definition;
}

export default defineFunction;