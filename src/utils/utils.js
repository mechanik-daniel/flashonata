/**
 * © Copyright IBM Corp. 2016, 2018 All Rights Reserved
 *   Project name: JSONata
 *   This project is licensed under the MIT License, see LICENSE
 */

const utils = (() => {

  /**
     * Check if value is a finite number
     * @param {float} n - number to evaluate
     * @returns {boolean} True if n is a finite number
     */
  function isNumeric(n) {
    var isNum = false;
    if(typeof n === 'number') {
      isNum = !isNaN(n);
      if (isNum && !isFinite(n)) {
        throw {
          code: "D1001",
          value: n,
          stack: (new Error()).stack
        };
      }
    }
    return isNum;
  }

  /**
     * Returns true if the arg is an array of strings
     * @param {*} arg - the item to test
     * @returns {boolean} True if arg is an array of strings
     */
  function isArrayOfStrings(arg) {
    var result = false;
    /* c8 ignore else */
    if(Array.isArray(arg)) {
      result = (arg.filter(function(item){return typeof item !== 'string';}).length === 0);
    }
    return result;
  }

  /**
     * Returns true if the arg is an array of numbers
     * @param {*} arg - the item to test
     * @returns {boolean} True if arg is an array of numbers
     */
  function isArrayOfNumbers(arg) {
    var result = false;
    if(Array.isArray(arg)) {
      result = (arg.filter(function(item){return !isNumeric(item);}).length === 0);
    }
    return result;
  }

  /**
     * Create an empty sequence to contain query results
     * @returns {Array} - empty sequence
     */
  function createSequence() {
    var sequence = [];
    sequence.sequence = true;
    if (arguments.length === 1) {
      sequence.push(arguments[0]);
    }
    return sequence;
  }

  /**
     * Tests if a value is a sequence
     * @param {*} value the value to test
     * @returns {boolean} true if it's a sequence
     */
  function isSequence(value) {
    return value.sequence === true && Array.isArray(value);
  }

  /**
     *
     * @param {Object} arg - expression to test
     * @returns {boolean} - true if it is a function (lambda or built-in)
     */
  function isFunction(arg) {
    return ((arg && (arg._fumifier_function === true || arg._fumifier_lambda === true)) || typeof arg === 'function');
  }

  /**
     * Returns the arity (number of arguments) of the function
     * @param {*} func - the function
     * @returns {*} - the arity
     */
  function getFunctionArity(func) {
    var arity = typeof func.arity === 'number' ? func.arity :
      typeof func.implementation === 'function' ? func.implementation.length :
        typeof func.length === 'number' ? func.length : func.arguments.length;
    return arity;
  }

  /**
     * Tests whether arg is a lambda function
     * @param {*} arg - the value to test
     * @returns {boolean} - true if it is a lambda function
     */
  function isLambda(arg) {
    return arg && arg._fumifier_lambda === true;
  }

  /* c8 ignore next */
  var iteratorSymbol = (typeof Symbol === "function" ? Symbol : {}).iterator || "@@iterator";

  /**
     * @param {Object} arg - expression to test
     * @returns {boolean} - true if it is iterable
     */
  function isIterable(arg) {
    return (
      typeof arg === 'object' &&
            arg !== null &&
            iteratorSymbol in arg &&
            'next' in arg &&
            typeof arg.next === 'function'
    );
  }

  /**
     * Compares two values for equality
     * @param {*} lhs first value
     * @param {*} rhs second value
     * @returns {boolean} true if they are deep equal
     */
  function isDeepEqual(lhs, rhs) {
    if (lhs === rhs) {
      return true;
    }
    if(typeof lhs === 'object' && typeof rhs === 'object' && lhs !== null && rhs !== null) {
      if(Array.isArray(lhs) && Array.isArray(rhs)) {
        // both arrays (or sequences)
        // must be the same length
        if(lhs.length !== rhs.length) {
          return false;
        }
        // must contain same values in same order
        for(var ii = 0; ii < lhs.length; ii++) {
          if(!isDeepEqual(lhs[ii], rhs[ii])) {
            return false;
          }
        }
        return true;
      }
      // both objects
      // must have the same set of keys (in any order)
      var lkeys = Object.getOwnPropertyNames(lhs);
      var rkeys = Object.getOwnPropertyNames(rhs);
      if(lkeys.length !== rkeys.length) {
        return false;
      }
      lkeys = lkeys.sort();
      rkeys = rkeys.sort();
      for(ii=0; ii < lkeys.length; ii++) {
        if(lkeys[ii] !== rkeys[ii]) {
          return false;
        }
      }
      // must have the same values
      for(ii=0; ii < lkeys.length; ii++) {
        var key = lkeys[ii];
        if(!isDeepEqual(lhs[key], rhs[key])) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  /**
     * @param {Object} arg - expression to test
     * @returns {boolean} - true if it is a promise
     */
  function isPromise(arg) {
    return (
      typeof arg === 'object' &&
                arg !== null &&
                'then' in arg &&
                typeof arg.then === 'function'
    );
  }

  /**
     * converts a string to an array of characters
     * @param {string} str - the input string
     * @returns {Array} - the array of characters
     */
  function stringToArray(str) {
    var arr = [];
    for (let char of str) {
      arr.push(char);
    }
    return arr;
  }

  var chainAST = {"type":"lambda","arguments":[{"value":"f","type":"variable","position":11,"line":1},{"value":"g","type":"variable","position":15,"line":1}],"position":9,"line":1,"body":{"type":"lambda","arguments":[{"value":"x","type":"variable","position":30,"line":1}],"position":28,"line":1,"body":{"type":"lambda","thunk":true,"arguments":[],"position":36,"line":1,"body":{"type":"function","value":"(","position":36,"line":1,"arguments":[{"type":"function","value":"(","position":39,"line":1,"arguments":[{"value":"x","type":"variable","position":41,"line":1}],"procedure":{"value":"f","type":"variable","position":38,"line":1}}],"procedure":{"value":"g","type":"variable","position":35,"line":1}}}}};

  return {
    isNumeric,
    isArrayOfStrings,
    isArrayOfNumbers,
    createSequence,
    isSequence,
    isFunction,
    isLambda,
    isIterable,
    getFunctionArity,
    isDeepEqual,
    stringToArray,
    isPromise,
    chainAST
  };
})();

export default utils;
