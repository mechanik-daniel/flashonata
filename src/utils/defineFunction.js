/**
 * © Copyright IBM Corp. 2016, 2018 All Rights Reserved
 *   Project name: JSONata
 *   This project is licensed under the MIT License, see LICENSE
 */

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