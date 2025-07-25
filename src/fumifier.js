/* eslint-disable no-console */
/* eslint-disable no-prototype-builtins */
/* eslint-disable require-jsdoc */
/* eslint-disable valid-jsdoc */
/**
 * © Copyright IBM Corp. 2016, 2017 All Rights Reserved
 *   Project name: JSONata
 *   This project is licensed under the MIT License, see LICENSE
 */

/**
 * @module Fumifier
 * @description FUME transformation evaluator
 */

import datetime from './utils/datetime.js';
import fn from './utils/functions.js';
import utils from './utils/utils.js';
import parser from './parser.js';
import resolveDefinitions from './utils/resolveDefinitions.js';
import { populateMessage } from './utils/errorCodes.js';
import defineFunction from './utils/defineFunction.js';
import registerNativeFn from './utils/registerNativeFn.js';

var fumifier = (function() {

  const {
    isNumeric,
    isArrayOfStrings,
    isArrayOfNumbers,
    createSequence,
    isSequence,
    isFunction,
    isLambda,
    isIterable,
    isPromise,
    getFunctionArity,
    isDeepEqual
  } = utils;

  const initCap = fn.initCapOnce;

  // Start of Evaluator code

  var staticFrame = createFrame(null);

  /**
     * Evaluate expression against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluate(expr, input, environment) {
    var result;

    var entryCallback = environment.lookup(Symbol.for('fumifier.__evaluate_entry'));
    if(entryCallback) {
      await entryCallback(expr, input, environment);
    }

    switch (expr.type) {
      case 'path':
        result = await evaluatePath(expr, input, environment);
        break;
      case 'binary':
        result = await evaluateBinary(expr, input, environment);
        break;
      case 'unary': // <--- might be a flash block or rule since they are prefix operators (unary)
        result = await evaluateUnary(expr, input, environment);
        break;
      case 'name':
        result = evaluateName(expr, input, environment);
        break;
      case 'string':
      case 'number':
      case 'value':
        result = evaluateLiteral(expr, input, environment);
        break;
      case 'wildcard':
        result = evaluateWildcard(expr, input);
        break;
      case 'descendant':
        result = evaluateDescendants(expr, input, environment);
        break;
      case 'parent':
        result = environment.lookup(expr.slot.label);
        break;
      case 'condition':
        result = await evaluateCondition(expr, input, environment);
        break;
      case 'coalesce':
        result = await evaluateCoalesce(expr, input, environment);
        break;
      case 'elvis':
        result = await evaluateElvis(expr, input, environment);
        break;
      case 'block':
        result = await evaluateBlock(expr, input, environment);
        break;
      case 'bind':
        result = await evaluateBindExpression(expr, input, environment);
        break;
      case 'regex':
        result = evaluateRegex(expr, input, environment);
        break;
      case 'function':
        result = await evaluateFunction(expr, input, environment);
        break;
      case 'variable':
        result = evaluateVariable(expr, input, environment);
        break;
      case 'lambda':
        result = evaluateLambda(expr, input, environment);
        break;
      case 'partial':
        result = await evaluatePartialApplication(expr, input, environment);
        break;
      case 'apply':
        result = await evaluateApplyExpression(expr, input, environment);
        break;
      case 'transform':
        result = evaluateTransformExpression(expr, input, environment);
        break;
    }

    if (Object.prototype.hasOwnProperty.call(expr, 'predicate')) {
      for(var ii = 0; ii < expr.predicate.length; ii++) {
        result = await evaluateFilter(expr.predicate[ii].expr, result, environment);
      }
    }

    if (expr.type !== 'path' && Object.prototype.hasOwnProperty.call(expr, 'group')) {
      result = await evaluateGroupExpression(expr.group, result, environment);
    }

    var exitCallback = environment.lookup(Symbol.for('fumifier.__evaluate_exit'));
    if(exitCallback) {
      await exitCallback(expr, input, environment, result);
    }

    if(result && isSequence(result) && !result.tupleStream) {
      if(expr.keepArray) {
        result.keepSingleton = true;
      }
      if(result.length === 0) {
        result = undefined;
      } else if(result.length === 1) {
        result =  result.keepSingleton ? result : result[0];
      }
    }

    return result;
  }

  function parseSystemPrimitive(expr, input, elementDefinition, environment) {

    if (Array.isArray(input)) {
      // input is an array, parse each entry and return an array
      return input.map(item => parseSystemPrimitive(expr, item, elementDefinition, environment));
    } else {
      // input is a single value

      // if it's undefined or a falsy value (but not an explicit boolean false), return undefined
      const boolized = boolize(input);
      if (input === undefined || (boolized === false && input !== false && input !== 0)) {
        return undefined;
      }

      const rootFhirTypeId = expr.instanceof;
      const elementFlashPath = expr.flashPathRefKey.slice(rootFhirTypeId.length + 2); // for error reporting

      // get the fhir type code for the element
      const fhirTypeCode = elementDefinition.__fhirTypeCode;

      if (!fhirTypeCode) {
        throw {
          code: "F3007",
          stack: (new Error()).stack,
          position: expr.position,
          start: expr.start,
          line: expr.line,
          instanceOf: rootFhirTypeId,
          fhirElement: elementFlashPath
        };
      }

      // handle boolean elements. the value should be boolized and returned
      if (fhirTypeCode === 'boolean') {
        return boolized;
      }

      // check that input is a primitive value
      const valueType = fn.type(input);
      if (valueType !== 'string' && valueType !== 'number' && valueType !== 'boolean') {
        throw {
          code: "F3006",
          stack: (new Error()).stack,
          position: expr.position,
          start: expr.start,
          line: expr.line,
          value: fn.string(input),
          valueType,
          instanceOf: rootFhirTypeId,
          fhirElement: elementFlashPath
        };
      }

      // if type is date and input is a string, truncate it to 10 characters (YYYY-MM-DD)
      if (fhirTypeCode === 'date' && valueType === 'string') {
        if (input.length > 10) {
          input = input.slice(0, 10);
        }
      }

      // check if regex is defined for the element, and test it
      if (elementDefinition.__regexStr) {
        // need to fetch regex tester from the environment
        var regexTester = getFhirRegexTester(environment, elementDefinition.__regexStr);

        if (regexTester && !regexTester.test(fn.string(input))) {
          throw {
            code: "F3001",
            stack: (new Error()).stack,
            position: expr.position,
            start: expr.start,
            line: expr.line,
            value: input,
            regex: elementDefinition.__regexStr,
            instanceOf: rootFhirTypeId,
            fhirElement: elementFlashPath
          };
        }
      }

      // passed validation of the input.
      // we now need to convert to the appropriate JSON type

      // handle numeric fhir types
      if (['decimal', 'integer', 'positiveInt', 'integer64', 'unsignedInt'].includes(fhirTypeCode)) {
        // numeric primitive - cast as number.
        // TODO: how to retain decimal percision in js?? not sure it's possible...
        if (valueType === 'number') {
          return input; // already a number
        } else if (valueType === 'string') {
          return Number(input); // convert string to number
        } else if (valueType === 'boolean') {
          return input ? 1 : 0; // convert boolean to number
        }
      }

      // all other fhir primitive types are reperesented as strings in the JSON
      return fn.string(input); // converts to string if needed
    }
  }

  /**
   * Once an expression flagged as a FLASH rule is evaluated, this function is called on the result
   * to validate it according to its element definition and return it as a flashrule result object.
   * @param {*} expr The AST node of the FLASH rule - includes references to FHIR definitions
   * @param {*} input The unsanitized results of evaluating just the expression. Could be anything, including arrays.
   * @param {*} environment The environment envelope that contains the FHIR definitions and variable scope
   * @returns {Promise<{Object}>} Evaluated, validated and wrapped flash rule
   */
  function finalizeFlashRuleResult(expr, input, environment) {

    // Ensure the expression refers to a valid FHIR element
    const rootFhirTypeId = expr.instanceof;
    const elementFlashPath = expr.flashPathRefKey?.slice(rootFhirTypeId.length + 2); // For error reporting

    const baseError = {
      stack: (new Error()).stack,
      position: expr.position,
      start: expr.start,
      line: expr.line
    };

    if (!expr.flashPathRefKey) {
      throw { code: "F3000", ...baseError };
    }
    // lookup the definition of the element
    const elementDefinition = getFhirElementDefinition(environment, expr.flashPathRefKey);

    if (!elementDefinition) {
      throw {
        code: "F3003",
        instanceOf: rootFhirTypeId,
        fhirElement: elementFlashPath,
        ...baseError
      };
    }

    if (
      !(elementDefinition?.__name) || // should have been set on the enriched definition
      !Array.isArray(elementDefinition.__name) || // should be an array
      elementDefinition.__name.length > 1 // no more than one option
    ) {
      throw {
        code: "F3005",
        instanceOf: rootFhirTypeId,
        fhirElement: elementFlashPath,
        ...baseError
      };
    }

    // get the kind of the element
    const kind = elementDefinition.__kind;
    if (!kind) {
      throw {
        code: 'F3004',
        instanceOf: rootFhirTypeId,
        fhirElement: elementFlashPath,
        ...baseError
      };
    }

    // get the json element name
    const jsonElementName = elementDefinition.__name[0];
    const isBasePoly = elementDefinition.base?.path?.endsWith('[x]'); // is it a base poly element?
    // if there's a slice name in the element definition,
    // it is an "official" slice and must be used in the grouping key.
    // UNLESS this is polymorphic element...
    // in which case slices can only correspond to a type, and the type is already represented in the jsonElementName.
    const sliceName = isBasePoly ? undefined : elementDefinition.sliceName || undefined;
    // generate the grouping key for the element
    const groupingKey = sliceName ? `${jsonElementName}:${sliceName}` : jsonElementName;

    // create a container object for the evaluated flash rule
    const result = {
      '@@__flashRuleResult': true,
      key: groupingKey,
      value: undefined,
      kind
    };

    // if element has a fixed value, use it
    if (elementDefinition.__fixedValue) {
      result.value = elementDefinition.__fixedValue;
      return result;
    }

    // handle system primitive's inline value
    // their value is just the primitive- no children are ever possible
    if (kind === 'system') {
      result.value = parseSystemPrimitive(expr, input, elementDefinition, environment);
      // if the result.value is an array, take only last one
      if (Array.isArray(result.value)) {
        result.value = result.value[result.value.length - 1];
      }
    }

    // handle FHIR primitives' inline value
    // this is treated as the primitive value of the 'value' child element
    // (we treat FHIR primitives as objects since they can have children)
    if (kind === 'primitive-type') {
      // input is always an array (could be singleton or empty)
      // need to return an array of evaluated values
      const evaluated = parseSystemPrimitive(expr, input.value, elementDefinition, environment);
      result.value = evaluated ? {
        ...input, // copy all properties from the input value
        value: evaluated // assign the evaluated value to the 'value' key
      } : undefined;
    }

    // TODO: handle complex types
    // these may have an object assined to them as the inline input expression
    // and/or child rules. child rules are handled by the block eval logic
    // here we only handle inline value assignments by converting any key: value pair of
    // the input object into a @@__flashRuleResult structure
    // TEMP: we currently just return the value as is without validating its structure
    if (kind === 'complex-type' || kind === 'resource') {
      result.value = input;
    }

    return result;
  }

  /**
   * All FLASH blocks and rules evaluation is funneled through this function.
   * It evaluates the specialized unary operator AST node and returns the result.
   * The inline expression and any rules/sub-rules are evaluated and applied to the output.
   * Expressions in between sub-rules (variable assignments) are evaluated but their results are discarded.
   * If the element is a system primitive than result is just the inline expression.
   * All other element kinds return objects, where FHIR primitives have their inline value assigned to `value`.
   */
  async function evaluateFlash(expr, input, environment) {
    const subExpressionResults = {};
    let inlineResult;

    // Determine kind and possible children, resourceType, and profileUrl
    // if this element has a fixed value, it will be returned immediately (no expression will be evaluated)
    let kind;
    let children = [];
    let resourceType;
    let profileUrl;

    if (expr.isFlashBlock) {
      // flash block - use the instanceof to get the structure definition's meta data
      const typeMeta = getFhirTypeMeta(environment, expr.instanceof);
      kind = typeMeta?.kind;

      // kind can be a resource, complex-type, or primitive-type.
      // It cannot be a system primitive since those cannot be instantiated with InstanceOf
      if (kind === 'resource') {
        // resources must have a resourceType set
        resourceType = typeMeta.type;
        if (typeMeta.derivation === 'constraint') {
          // profiles on resources should have a mets.profile set to the profile URL
          profileUrl = typeMeta.url;
        }
      }
      children = getFhirTypeChildren(environment, expr.instanceof);
    } else {
      // flash rule - use the flashPathRefKey to get the element definition
      const def = getFhirElementDefinition(environment, expr.flashPathRefKey);
      // kind will almost laways be a system primitive, primitive-type, or complex-type.
      // kind = "resource" is rare but should be supported (Bundle.entry.resource, DomainResource.contained)
      // TODO: handle inline resources (will probably not have an element definition but a structure definition)
      kind = def.__kind;
      if (def.max === '0') {
        // forbidden element
        throw {
          code: "F3008",
          stack: (new Error()).stack,
          position: expr.position,
          start: expr.start,
          line: expr.line,
          value: expr.flashPathRefKey?.slice(expr.instanceof.length + 2),
          fhirType: def.__fromDefinition
        };
      } else if (def.__fixedValue) {
        // short circuit if the element has a fixed value
        return {
          '@@__flashRuleResult': true,
          key: def.__name[0],
          value: def.__fixedValue
        };
      } else if (kind !== 'system' && !def.__fixedValue) {
        children = getFhirElementChildren(environment, expr.flashPathRefKey);
      }
    }

    // Evaluate all expressions and group results by key
    for (const node of expr.expressions) {
      let res = await evaluate(node, input, environment);

      if (typeof res === 'undefined') continue; // undefined results are ignored

      // expressions can only be:
      // 1. a flash rule - returns a flashrule result object
      // 2. an inline expression - any value
      // 3. a variable assignment - evaluated but does not affect the result directly
      // 4. a path expression (contextualized rule) - a flashrule result object or an array of such

      if (node.isInlineExpression) {
        // inline expression - there can be only one :)
        // result is kept if it's truthy or explicitly false / 0
        if (boolize(res) !== false || res === false || res === 0) {
          inlineResult = res;
        }
        // nothing more to do with this node, continue
        continue;
      } else if (node.type === 'bind') {
        // variable assignment inside a flash block or rule
        // we don't care about the result (the variale is assigned to the environment)
        continue;
      }

      // flash rule or contextualized rule - a flashrule result object or an array of such
      const groupingKey = Array.isArray(res) ? res[0].key : res.key;

      // we append to the gouping key in the subExpressionResults object
      const values = fn.append(subExpressionResults[groupingKey], res);
      subExpressionResults[groupingKey] = Array.isArray(values) ? values : [values];
    }

    let result;
    if (kind === 'system') {
      // system primitive - the result is just the inline expression.
      // there could not be any child expressions
      result = inlineResult;
    } else {
      // result is going to be an object (including fhir primitives - they are still objects at this stage).
      result = {};

      // if it's a fhir primitive, wrap the inline result in an object with a 'value' key
      if (kind === 'primitive-type' && inlineResult !== undefined) {
        inlineResult = {
          value: inlineResult
        };
      }

      // if it's a resource, set the resourceType as the first key
      if (resourceType) {
        result.resourceType = resourceType;
      }
      // now we will loop through the children in-order and assign the result attributes
      for (const child of children) {
        // each child can be one of:
        // 1. a regular element with a single type and __name
        // 2. a polymorphic (choice) element with multiple types and __name as an array
        // 3. a slice (with sliceName) - always a single type and __name, grouping key is <__name[0]>:<sliceName>

        // we skip elements that have max = 0
        if (child.max === '0') {
          continue;
        }

        // we will first normalize the possible names of this element into an array of grouping keys
        const names = [];
        if (child.__name.length === 1) {
          // single name - check if poly
          const isPoly = child.base?.path?.endsWith('[x]'); // is it a base poly element?
          if (!isPoly) {
            // single type element from the base.
            // if there's a sliceName, we will use it to create the grouping key
            if (child.sliceName) {
              names.push(`${child.__name[0]}:${child.sliceName}`);
            } else {
              // no sliceName, just use the __name as the grouping key
              names.push(child.__name[0]);
            }
          } else {
            // it's a polymorphic element, narrowed to a single type.
            // we will use the single __name and ignore sliceName if it exists
            names.push(child.__name[0]);
          }
        } else {
          // it's a polymorphic element with multiple types (and hence, names).
          // we will use the entire __name array as possible grouping keys, ignoring sliceName
          names.push(...child.__name);
        }

        // now that we have an array of names for this child, we will assign the attribute to the result object.
        // the values can come from the inline expression having an attribute with the same name,
        // from the subExpressionResults object that contains the evaluated flash rules, or from attempting
        // to evaluate the child as a virtual rule and getting automatic values as the result.
        // inline attributes will only be taken if their key matches the base json element name (no slices)

        // start by keeping all the matching values for this element in an array
        const values = [];
        for (const name of names) {
          const valuesForName = []; // keep all values for this json element name
          // to determine the kind of this specific element name, and accounting for polymorphic elements,
          // we will have to find the corresponding type entry in the element definition
          const kindForName = child.type.length === 1 ? child.type[0].__kind : child.type.find(type => name.endsWith(initCap(type.code))).__kind;
          // check if the inline expression has a value for this name
          if (
            inlineResult &&
            !child.sliceName && // we skip this child if it's a slice since slices are not directly represented in the json
            (
              Object.prototype.hasOwnProperty.call(inlineResult, name) || // check if inlineResult has this name
              (
                kindForName === 'primitive-type' && // or if it's a primitive type check for sibling element
                Object.prototype.hasOwnProperty.call(inlineResult, '_' + name)
              )
            )
          ) {
            let value;
            // if it's not a fhir primitive, we just take the value
            if (kindForName !== 'primitive-type') {
              value = inlineResult[name];
            } else {
              // if it's a fhir primitive, we convert it to an object
              value = {
                value: inlineResult[name]
              };
              const siblingName = '_' + name;
              if (typeof inlineResult[siblingName] === 'object' && Object.keys(inlineResult[siblingName]).length > 0) {
                // if there's a sibling element with the same name prefixed with '_',
                // we will copy its properties to the value object
                Object.assign(value, inlineResult[siblingName]);
              }
            }
            valuesForName.push(value);
          }

          // now check if the subExpressionResults has a value for this name
          if (Object.prototype.hasOwnProperty.call(subExpressionResults, name)) {
            valuesForName.push(...(subExpressionResults[name].map(item => item.value)));
          }

          // if we have no values for this name, skip it
          if (valuesForName.length === 0) {
            continue;
          }

          if (child.max !== '1') {
            // if it's an array, we take all of the values and push them to the values array
            values.push({ name, kind: kindForName, value: valuesForName });
          } else if (kindForName === 'system') {
            // system primitive - just take the last value
            if (valuesForName.length > 0) {
              values.push({ name, kind: kindForName, value: [valuesForName[valuesForName.length - 1]] });
            }
          } else {
            // complex type or primitive type - merge all objects into one
            const mergedValue = fn.merge(valuesForName);
            if (Object.keys(mergedValue).length > 0) {
              values.push({ name, kind: kindForName, value: [mergedValue] });
            }
          }
        }

        // at this point, if we have no collected values for this element but it is mandatory,
        // we will try to evaluate it as a virtual rule.
        if (values.length === 0) {
          if (child.min === 0) continue; // skip if not mandatory
          // try to evaluate the child as a virtual rule
          const autoValue = await evaluate({
            type: 'unary',
            value: '[',
            isFlashRule: true,
            isVirtualRule: true,
            expressions: [],
            instanceof: expr.instanceof, // use the same instanceof as the parent flash block or rule
            flashPathRefKey: child.__flashPathRefKey,
            position: expr.position,
            start: expr.start,
            line: expr.line
          }, undefined, environment);
          // if the autoValue is undefined, we skip this child element
          if (typeof autoValue === 'undefined') {
            continue;
          } else {
            values.push({ name: autoValue.key, kind: autoValue.kind, value: [autoValue.value] });
          }
        }

        // values now contain all collected values for this child element, each wrapped in an object containing the json element name.
        // since arrays and polymorphics are mutually exclusive, we can safely take the last value if it's polymorphic,
        // and all values if it's an array.

        let finalValue;
        if (child.__name.length > 1) {
          // polymorphic element - take the last value (only one type is allowed)
          finalValue = values[values.length - 1];
        } else {
          // this element has only one possible name, so we can safely take the first value - it should be the only one
          finalValue = values[0];
        }
        // assign the value to the result object
        if (finalValue.value) {
          if (finalValue.kind !== 'primitive-type') {
            // if it's not a fhir primitive, we can assign the value directly to the key
            // if the element has max 1, take last value only
            if (child.max === '1' && !child.__isArray) {
              finalValue.value = finalValue.value[finalValue.value.length - 1];
            } else if (child.max === '1' && child.__isArray) {
              finalValue.value = [finalValue.value[finalValue.value.length - 1]];
            }
            if (typeof finalValue.value !== 'undefined' && (typeof finalValue.value === 'boolean' || boolize(finalValue.value))) {
              result[finalValue.name] = finalValue.value;
            }
          } else {
            // if it's a fhir primitive, we need to convert the array to two arrays -
            // one with the primitive values themselves, and one with the properties.
            // to keep these arrays in sync, we will use the same index for both and fill-in missing values with null
            let primitiveValues = [];
            let properties = [];
            for (let i = 0; i < finalValue.value.length; i++) {
              const value = finalValue.value[i];
              if (value === undefined) continue; // skip undefined values
              if (value.value !== undefined) {
                primitiveValues.push(value.value);
              } else {
                primitiveValues.push(null);
              }
              // copy all properties to the properties array
              const props = Object.keys(value).filter(key => key !== 'value');
              if (props.length > 0) {
                properties.push(props.reduce((acc, key) => {
                  acc[key] = value[key];
                  return acc;
                }, {}));
              } else {
                properties.push(null);
              }
            }
            // if the element has max 1, take last value only
            if (child.max === '1' && !child.__isArray) {
              primitiveValues = primitiveValues[primitiveValues.length - 1];
              properties = properties[properties.length - 1];
            } else if (child.max === '1' && child.__isArray) {
              primitiveValues = [primitiveValues[primitiveValues.length - 1]];
              properties = [properties[properties.length - 1]];
            }

            // assign the primitive values and sibling properties to the result object
            // if any of them is just an array of nulls, we will not assign it
            if (
              primitiveValues && (
                !Array.isArray(primitiveValues) ||
                (
                  primitiveValues.length > 0 &&
                  !primitiveValues.every(v => v === null)
                )
              )
            ) {
              result[finalValue.name] = primitiveValues;
            }
            // if properties is not empty, assign it as well
            if (
              properties &&
              (
                !Array.isArray(properties) ||
                (
                  properties.length > 0 &&
                  !properties.every(p => p === null)
                )
              )
            ) {
              result['_' + finalValue.name] = properties;
            }
          }
        }
      }
    }

    // append slices into their parent element
    // we will do this by looping through the keys of result, and if any of them has a ':' suffix,
    // we will append it to the parent element with the same name (without the sliceName)
    for (const key of Object.keys(result)) {
      const colonIndex = key.indexOf(':');
      if (colonIndex !== -1) {
        const parentKey = key.slice(0, colonIndex);
        result[parentKey] = fn.append(result[parentKey], result[key]);
        // delete the slice key from the result
        delete result[key];
      }
    }

    // inject meta.profile if this is a profiled resource and it isn't already set
    if (profileUrl) {
      // if meta is missing entirely, create it
      if (!result.meta) {
        // if it was missing, we need to put it right after the id, before all other properties
        result = { resourceType, id: result.id, meta: { profile: [profileUrl] }, ...result };
      } else if (!result.meta.profile || !Array.isArray(result.meta.profile)){
        result.meta.profile = [profileUrl];
      } else if (!result.meta.profile.includes(profileUrl)) {
        result.meta.profile.push(profileUrl);
      }
    }

    // Ensure mandatory children exist
    for (const child of children) {
      // skip non-mandatory children
      if (child.min === 0) continue;

      const names = child.__name;
      const satisfied = names.some(name =>
        Object.prototype.hasOwnProperty.call(result, name) && // element key exists
        result[name] !== undefined && // element value is not undefined
        (
          child.min === 1 || // if min is 1, we just require the value to be present
          ( // if min is above 1, we require the value to be an array with at least min items
            Array.isArray(result[name]) &&
            result[name].length >= child.min
          )
        )
      );

      if (!satisfied) {
        throw {
          code: "F3002",
          stack: (new Error()).stack,
          position: expr.position,
          start: expr.start,
          line: expr.line,
          fhirParent: (expr.flashPathRefKey || expr.instanceof).replace('::', '/'),
          fhirElement: names.join(', ')
        };
      }
    }

    if (expr.isFlashRule) {
      // if it's a flash rule, process and return the result as a flash rule
      result = finalizeFlashRuleResult(expr, result, environment);
    }
    // if it's a flashblock, if it has no children or only resourceType, we return undefined
    if (Object.keys(result).length === 0 || (Object.keys(result).length === 1 && result.resourceType)) {
      result = undefined;
    }
    return result;
  }

  /**
     * Evaluate unary expression against input data
     * This includes specialized '[' unary operator for flash blocks and rules that were converted
     * to native JSONata AST nodes.
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateUnary(expr, input, environment) {

    // if it's a flash block or rule, evaluate it and return the result
    if (expr.isFlashBlock || expr.isFlashRule) {
      return await evaluateFlash(expr, input, environment);
    }

    // otherwise, it's a native JSONata unary operator, process normally
    var result;

    switch (expr.value) {
      case '-':
        result = await evaluate(expr.expression, input, environment);
        if(typeof result === 'undefined') {
          result = undefined;
        } else if (isNumeric(result)) {
          result = -result;
        } else {
          throw {
            code: "D1002",
            stack: (new Error()).stack,
            position: expr.position,
            start: expr.start,
            token: expr.value,
            value: result
          };
        }
        break;
      case '[':
        // array constructor - evaluate each item
        result = [];
        // eslint-disable-next-line no-case-declarations
        let generators = await Promise.all(expr.expressions
          .map(async (item, idx) => {
            environment.isParallelCall = idx > 0;
            return [item, await evaluate(item, input, environment)];
          }));
        for (let generator of generators) {
          var [item, value] = generator;
          if (typeof value !== 'undefined') {
            if(item.value === '[') {
              result.push(value);
            } else {
              result = fn.append(result, value);
            }
          }
        }
        if(expr.consarray) {
          Object.defineProperty(result, 'cons', {
            enumerable: false,
            configurable: false,
            value: true
          });
        }
        break;
      case '{':
        // object constructor - apply grouping
        result = await evaluateGroupExpression(expr, input, environment);
        break;
    }
    return result;
  }

  /**
     * Evaluate path expression against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluatePath(expr, input, environment) {
    var inputSequence;
    // expr is an array of steps
    // if the first step is a variable reference ($...), including root reference ($$),
    //   then the path is absolute rather than relative
    if (Array.isArray(input) && expr.steps[0].type !== 'variable') {
      inputSequence = input;
    } else {
      // if input is not an array, make it so
      inputSequence = createSequence(input);
    }

    var resultSequence;
    var isTupleStream = false;
    var tupleBindings = undefined;

    // evaluate each step in turn
    for(var ii = 0; ii < expr.steps.length; ii++) {
      var step = expr.steps[ii];

      if(step.tuple) {
        isTupleStream = true;
      }

      // if the first step is an explicit array constructor, then just evaluate that (i.e. don't iterate over a context array)
      if (ii === 0 && step.consarray) {
        resultSequence = await evaluate(step, inputSequence, environment);
      } else if (isTupleStream) {
        tupleBindings = await evaluateTupleStep(step, inputSequence, tupleBindings, environment);
      } else {
        resultSequence = await evaluateStep(step, inputSequence, environment, ii === expr.steps.length - 1);
      }

      if (!isTupleStream && (typeof resultSequence === 'undefined' || resultSequence.length === 0)) {
        break;
      }

      if(typeof step.focus === 'undefined') {
        inputSequence = resultSequence;
      }

    }

    if(isTupleStream) {
      if(expr.tuple) {
        // tuple stream is carrying ancestry information - keep this
        resultSequence = tupleBindings;
      } else {
        resultSequence = createSequence();
        for (ii = 0; ii < tupleBindings.length; ii++) {
          resultSequence.push(tupleBindings[ii]['@']);
        }
      }
    }

    if(expr.keepSingletonArray) {
      // if the array is explicitly constructed in the expression and marked to promote singleton sequences to array
      if(Array.isArray(resultSequence) && resultSequence.cons && !resultSequence.sequence) {
        resultSequence = createSequence(resultSequence);
      }
      resultSequence.keepSingleton = true;
    }

    if (expr.hasOwnProperty('group')) {
      resultSequence = await evaluateGroupExpression(expr.group, isTupleStream ? tupleBindings : resultSequence, environment);
    }

    return resultSequence;
  }

  function createFrameFromTuple(environment, tuple) {
    var frame = createFrame(environment);
    for(const prop in tuple) {
      frame.bind(prop, tuple[prop]);
    }
    return frame;
  }

  /**
     * Evaluate a step within a path
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @param {boolean} lastStep - flag the last step in a path
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateStep(expr, input, environment, lastStep) {
    // console.log('🔸 evaluateStep', expr.type, '→ input:', JSON.stringify(input, null, 2));
    let result;

    // Handle sorting first
    if (expr.type === 'sort') {
      result = await evaluateSortExpression(expr, input, environment);
      if (expr.stages) {
        result = await evaluateStages(expr.stages, result, environment);
      }
      return result;
    }

    result = createSequence();

    for(var ii = 0; ii < input.length; ii++) {
      var res = await evaluate(expr, input[ii], environment);
      if(expr.stages) {
        for(var ss = 0; ss < expr.stages.length; ss++) {
          res = await evaluateFilter(expr.stages[ss].expr, res, environment);
        }
      }
      if(typeof res !== 'undefined') {
        result.push(res);
      }
    }

    var resultSequence = createSequence();
    if(lastStep && result.length === 1 && Array.isArray(result[0]) && !isSequence(result[0])) {
      resultSequence = result[0];
    } else {
      // flatten the sequence
      result.forEach(function(res) {
        if (!Array.isArray(res) || res.cons) {
          // it's not an array - just push into the result sequence
          resultSequence.push(res);
        } else {
          // res is a sequence - flatten it into the parent sequence
          res.forEach(val => resultSequence.push(val));
        }
      });
    }

    return resultSequence;
  }

  async function evaluateStages(stages, input, environment) {
    var result = input;
    for(var ss = 0; ss < stages.length; ss++) {
      var stage = stages[ss];
      switch(stage.type) {
        case 'filter':
          result = await evaluateFilter(stage.expr, result, environment);
          break;
        case 'index':
          for(var ee = 0; ee < result.length; ee++) {
            var tuple = result[ee];
            tuple[stage.value] = ee;
          }
          break;
      }
    }
    return result;
  }

  /**
     * Evaluate a step within a path
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} tupleBindings - The tuple stream
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateTupleStep(expr, input, tupleBindings, environment) {
    var result;
    if(expr.type === 'sort') {
      if(tupleBindings) {
        result = await evaluateSortExpression(expr, tupleBindings, environment);
      } else {
        var sorted = await evaluateSortExpression(expr, input, environment);
        result = createSequence();
        result.tupleStream = true;
        for(var ss = 0; ss < sorted.length; ss++) {
          var tuple = {'@': sorted[ss]};
          tuple[expr.index] = ss;
          result.push(tuple);
        }
      }
      if(expr.stages) {
        result = await evaluateStages(expr.stages, result, environment);
      }
      return result;
    }

    result = createSequence();
    result.tupleStream = true;
    var stepEnv = environment;
    if(tupleBindings === undefined) {
      tupleBindings = input.map(item => { return {'@': item}; });
    }

    for(var ee = 0; ee < tupleBindings.length; ee++) {
      stepEnv = createFrameFromTuple(environment, tupleBindings[ee]);
      var res = await evaluate(expr, tupleBindings[ee]['@'], stepEnv);
      // res is the binding sequence for the output tuple stream
      if(typeof res !== 'undefined') {
        if (!Array.isArray(res)) {
          res = [res];
        }
        for (var bb = 0; bb < res.length; bb++) {
          tuple = {};
          Object.assign(tuple, tupleBindings[ee]);
          if(res.tupleStream) {
            Object.assign(tuple, res[bb]);
          } else {
            if (expr.focus) {
              tuple[expr.focus] = res[bb];
              tuple['@'] = tupleBindings[ee]['@'];
            } else {
              tuple['@'] = res[bb];
            }
            if (expr.index) {
              tuple[expr.index] = bb;
            }
            if (expr.ancestor) {
              tuple[expr.ancestor.label] = tupleBindings[ee]['@'];
            }
          }
          result.push(tuple);
        }
      }
    }

    if(expr.stages) {
      result = await evaluateStages(expr.stages, result, environment);
    }

    return result;
  }

  /**
     * Apply filter predicate to input data
     * @param {Object} predicate - filter expression
     * @param {Object} input - Input data to apply predicates against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Result after applying predicates
     */
  async function evaluateFilter(predicate, input, environment) {
    var results = createSequence();
    if( input && input.tupleStream) {
      results.tupleStream = true;
    }
    if (!Array.isArray(input)) {
      input = createSequence(input);
    }
    if (predicate.type === 'number') {
      var index = Math.floor(predicate.value);  // round it down
      if (index < 0) {
        // count in from end of array
        index = input.length + index;
      }
      var item = input[index];
      if(typeof item !== 'undefined') {
        if(Array.isArray(item)) {
          results = item;
        } else {
          results.push(item);
        }
      }
    } else {
      for (index = 0; index < input.length; index++) {
        // eslint-disable-next-line no-redeclare
        var item = input[index];
        var context = item;
        var env = environment;
        if(input.tupleStream) {
          context = item['@'];
          env = createFrameFromTuple(environment, item);
        }
        var res = await evaluate(predicate, context, env);
        if (isNumeric(res)) {
          res = [res];
        }
        if (isArrayOfNumbers(res)) {
          res.forEach(function (ires) {
            // round it down
            var ii = Math.floor(ires);
            if (ii < 0) {
              // count in from end of array
              ii = input.length + ii;
            }
            if (ii === index) {
              results.push(item);
            }
          });
        } else if (fn.boolean(res)) { // truthy
          results.push(item);
        }
      }
    }
    return results;
  }

  /**
     * Evaluate binary expression against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateBinary(expr, input, environment) {
    var result;
    var lhs = await evaluate(expr.lhs, input, environment);
    var op = expr.value;

    //defer evaluation of RHS to allow short-circuiting
    var evalrhs = async () => await evaluate(expr.rhs, input, environment);
    if (op === "and" || op === "or") {
      try {
        return await evaluateBooleanExpression(lhs, evalrhs, op);
      } catch(err) {
        err.position = expr.position;
        err.start = expr.start;
        err.token = op;
        throw err;
      }
    }

    var rhs = await evalrhs();
    try {
      switch (op) {
        case '+':
        case '-':
        case '*':
        case '/':
        case '%':
          result = evaluateNumericExpression(lhs, rhs, op);
          break;
        case '=':
        case '!=':
          result = evaluateEqualityExpression(lhs, rhs, op);
          break;
        case '<':
        case '<=':
        case '>':
        case '>=':
          result = evaluateComparisonExpression(lhs, rhs, op);
          break;
        case '&':
          result = evaluateStringConcat(lhs, rhs);
          break;
        case '..':
          result = evaluateRangeExpression(lhs, rhs);
          break;
        case 'in':
          result = evaluateIncludesExpression(lhs, rhs);
          break;
      }
    } catch(err) {
      err.position = expr.position;
      err.start = expr.start;
      err.token = op;
      throw err;
    }
    return result;
  }

  /**
     * Evaluate name object against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {*} Evaluated input data
     */
  function evaluateName(expr, input) {
    // lookup the 'name' item in the input
    return fn.lookup(input, expr.value);
  }

  /**
     * Evaluate literal against input data
     * @param {Object} expr - Fumifier expression
     * @returns {*} Evaluated input data
     */
  function evaluateLiteral(expr) {
    return expr.value;
  }

  /**
     * Evaluate wildcard against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @returns {*} Evaluated input data
     */
  function evaluateWildcard(expr, input) {
    var results = createSequence();
    if (Array.isArray(input) && input.outerWrapper && input.length > 0) {
      input = input[0];
    }
    if (input !== null && typeof input === 'object') {
      Object.keys(input).forEach(function (key) {
        var value = input[key];
        if(Array.isArray(value)) {
          value = flatten(value);
          results = fn.append(results, value);
        } else {
          results.push(value);
        }
      });
    }

    return results;
  }

  /**
     * Returns a flattened array
     * @param {Array} arg - the array to be flatten
     * @param {Array} flattened - carries the flattened array - if not defined, will initialize to []
     * @returns {Array} - the flattened array
     */
  function flatten(arg, flattened) {
    if(typeof flattened === 'undefined') {
      flattened = [];
    }
    if(Array.isArray(arg)) {
      arg.forEach(function (item) {
        flatten(item, flattened);
      });
    } else {
      flattened.push(arg);
    }
    return flattened;
  }

  /**
     * Evaluate descendants against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @returns {*} Evaluated input data
     */
  function evaluateDescendants(expr, input) {
    var result;
    var resultSequence = createSequence();
    if (typeof input !== 'undefined') {
      // traverse all descendants of this object/array
      recurseDescendants(input, resultSequence);
      if (resultSequence.length === 1) {
        result = resultSequence[0];
      } else {
        result = resultSequence;
      }
    }
    return result;
  }

  /**
     * Recurse through descendants
     * @param {Object} input - Input data
     * @param {Object} results - Results
     */
  function recurseDescendants(input, results) {
    // this is the equivalent of //* in XPath
    if (!Array.isArray(input)) {
      results.push(input);
    }
    if (Array.isArray(input)) {
      input.forEach(function (member) {
        recurseDescendants(member, results);
      });
    } else if (input !== null && typeof input === 'object') {
      Object.keys(input).forEach(function (key) {
        recurseDescendants(input[key], results);
      });
    }
  }

  /**
     * Evaluate numeric expression against input data
     * @param {Object} lhs - LHS value
     * @param {Object} rhs - RHS value
     * @param {Object} op - opcode
     * @returns {*} Result
     */
  function evaluateNumericExpression(lhs, rhs, op) {
    var result;

    if (typeof lhs !== 'undefined' && !isNumeric(lhs)) {
      throw {
        code: "T2001",
        stack: (new Error()).stack,
        value: lhs
      };
    }
    if (typeof rhs !== 'undefined' && !isNumeric(rhs)) {
      throw {
        code: "T2002",
        stack: (new Error()).stack,
        value: rhs
      };
    }

    if (typeof lhs === 'undefined' || typeof rhs === 'undefined') {
      // if either side is undefined, the result is undefined
      return result;
    }

    switch (op) {
      case '+':
        result = lhs + rhs;
        break;
      case '-':
        result = lhs - rhs;
        break;
      case '*':
        result = lhs * rhs;
        break;
      case '/':
        result = lhs / rhs;
        break;
      case '%':
        result = lhs % rhs;
        break;
    }
    return result;
  }

  /**
     * Evaluate equality expression against input data
     * @param {Object} lhs - LHS value
     * @param {Object} rhs - RHS value
     * @param {Object} op - opcode
     * @returns {*} Result
     */
  function evaluateEqualityExpression(lhs, rhs, op) {
    var result;

    // type checks
    var ltype = typeof lhs;
    var rtype = typeof rhs;

    if (ltype === 'undefined' || rtype === 'undefined') {
      // if either side is undefined, the result is false
      return false;
    }

    switch (op) {
      case '=':
        result = isDeepEqual(lhs, rhs);
        break;
      case '!=':
        result = !isDeepEqual(lhs, rhs);
        break;
    }
    return result;
  }

  /**
     * Evaluate comparison expression against input data
     * @param {Object} lhs - LHS value
     * @param {Object} rhs - RHS value
     * @param {Object} op - opcode
     * @returns {*} Result
     */
  function evaluateComparisonExpression(lhs, rhs, op) {
    var result;

    // type checks
    var ltype = typeof lhs;
    var rtype = typeof rhs;

    var lcomparable = (ltype === 'undefined' || ltype === 'string' || ltype === 'number');
    var rcomparable = (rtype === 'undefined' || rtype === 'string' || rtype === 'number');

    // if either aa or bb are not comparable (string or numeric) values, then throw an error
    if (!lcomparable || !rcomparable) {
      throw {
        code: "T2010",
        stack: (new Error()).stack,
        value: !(ltype === 'string' || ltype === 'number') ? lhs : rhs
      };
    }

    // if either side is undefined, the result is undefined
    if (ltype === 'undefined' || rtype === 'undefined') {
      return undefined;
    }

    //if aa and bb are not of the same type
    if (ltype !== rtype) {
      throw {
        code: "T2009",
        stack: (new Error()).stack,
        value: lhs,
        value2: rhs
      };
    }

    switch (op) {
      case '<':
        result = lhs < rhs;
        break;
      case '<=':
        result = lhs <= rhs;
        break;
      case '>':
        result = lhs > rhs;
        break;
      case '>=':
        result = lhs >= rhs;
        break;
    }
    return result;
  }

  /**
     * Inclusion operator - in
     *
     * @param {Object} lhs - LHS value
     * @param {Object} rhs - RHS value
     * @returns {boolean} - true if lhs is a member of rhs
     */
  function evaluateIncludesExpression(lhs, rhs) {
    var result = false;

    if (typeof lhs === 'undefined' || typeof rhs === 'undefined') {
      // if either side is undefined, the result is false
      return false;
    }

    if(!Array.isArray(rhs)) {
      rhs = [rhs];
    }

    for(var i = 0; i < rhs.length; i++) {
      if(rhs[i] === lhs) {
        result = true;
        break;
      }
    }

    return result;
  }

  /**
     * Evaluate boolean expression against input data
     * @param {Object} lhs - LHS value
     * @param {Function} evalrhs - function to evaluate RHS value
     * @param {Object} op - opcode
     * @returns {Promise<any>} Result
     */
  async function evaluateBooleanExpression(lhs, evalrhs, op) {
    var result;

    var lBool = boolize(lhs);

    switch (op) {
      case 'and':
        result = lBool && boolize(await evalrhs());
        break;
      case 'or':
        result = lBool || boolize(await evalrhs());
        break;
    }
    return result;
  }

  function boolize(value) {
    var booledValue = fn.boolean(value);
    return typeof booledValue === 'undefined' ? false : booledValue;
  }

  /**
     * Evaluate string concatenation against input data
     * @param {Object} lhs - LHS value
     * @param {Object} rhs - RHS value
     * @returns {string|*} Concatenated string
     */
  function evaluateStringConcat(lhs, rhs) {
    var result;

    var lstr = '';
    var rstr = '';
    if (typeof lhs !== 'undefined') {
      lstr = fn.string(lhs);
    }
    if (typeof rhs !== 'undefined') {
      rstr = fn.string(rhs);
    }

    result = lstr.concat(rstr);
    return result;
  }

  /**
     * Evaluate group expression against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateGroupExpression(expr, input, environment) {
    var result = {};
    var groups = {};
    var reduce = input && input.tupleStream ? true : false;
    // group the input sequence by 'key' expression
    if (!Array.isArray(input)) {
      input = createSequence(input);
    }
    // if the array is empty, add an undefined entry to enable literal JSON object to be generated
    if (input.length === 0) {
      input.push(undefined);
    }

    for(var itemIndex = 0; itemIndex < input.length; itemIndex++) {
      var item = input[itemIndex];
      var env = reduce ? createFrameFromTuple(environment, item) : environment;
      for(var pairIndex = 0; pairIndex < expr.lhs.length; pairIndex++) {
        var pair = expr.lhs[pairIndex];
        var key = await evaluate(pair[0], reduce ? item['@'] : item, env);
        // key has to be a string
        if (typeof  key !== 'string' && key !== undefined) {
          throw {
            code: "T1003",
            stack: (new Error()).stack,
            position: expr.position,
            start: expr.start,
            value: key
          };
        }

        if (key !== undefined) {
          var entry = {data: item, exprIndex: pairIndex};
          if (groups.hasOwnProperty(key)) {
            // a value already exists in this slot
            if(groups[key].exprIndex !== pairIndex) {
              // this key has been generated by another expression in this group
              // when multiple key expressions evaluate to the same key, then error D1009 must be thrown
              throw {
                code: "D1009",
                stack: (new Error()).stack,
                position: expr.position,
                start: expr.start,
                value: key
              };
            }

            // append it as an array
            groups[key].data = fn.append(groups[key].data, item);
          } else {
            groups[key] = entry;
          }
        }
      }
    }

    // iterate over the groups to evaluate the 'value' expression
    let generators = await Promise.all(Object.keys(groups).map(async (key, idx) => {
      let entry = groups[key];
      var context = entry.data;
      var env = environment;
      if (reduce) {
        var tuple = reduceTupleStream(entry.data);
        context = tuple['@'];
        delete tuple['@'];
        env = createFrameFromTuple(environment, tuple);
      }
      environment.isParallelCall = idx > 0;
      return [key, await evaluate(expr.lhs[entry.exprIndex][1], context, env)];
    }));

    for (let generator of generators) {
      // eslint-disable-next-line no-redeclare
      var [key, value] = await generator;
      if(typeof value !== 'undefined') {
        result[key] = value;
      }
    }

    return result;
  }

  function reduceTupleStream(tupleStream) {
    if(!Array.isArray(tupleStream)) {
      return tupleStream;
    }
    var result = {};
    Object.assign(result, tupleStream[0]);
    for(var ii = 1; ii < tupleStream.length; ii++) {
      for(const prop in tupleStream[ii]) {
        result[prop] = fn.append(result[prop], tupleStream[ii][prop]);
      }
    }
    return result;
  }

  /**
     * Evaluate range expression against input data
     * @param {Object} lhs - LHS value
     * @param {Object} rhs - RHS value
     * @returns {Array} Resultant array
     */
  function evaluateRangeExpression(lhs, rhs) {
    var result;

    if (typeof lhs !== 'undefined' && !Number.isInteger(lhs)) {
      throw {
        code: "T2003",
        stack: (new Error()).stack,
        value: lhs
      };
    }
    if (typeof rhs !== 'undefined' && !Number.isInteger(rhs)) {
      throw {
        code: "T2004",
        stack: (new Error()).stack,
        value: rhs
      };
    }

    if (typeof lhs === 'undefined' || typeof rhs === 'undefined') {
      // if either side is undefined, the result is undefined
      return result;
    }

    if (lhs > rhs) {
      // if the lhs is greater than the rhs, return undefined
      return result;
    }

    // limit the size of the array to ten million entries (1e7)
    // this is an implementation defined limit to protect against
    // memory and performance issues.  This value may increase in the future.
    var size = rhs - lhs + 1;
    if(size > 1e7) {
      throw {
        code: "D2014",
        stack: (new Error()).stack,
        value: size
      };
    }

    result = new Array(size);
    for (var item = lhs, index = 0; item <= rhs; item++, index++) {
      result[index] = item;
    }
    result.sequence = true;
    return result;
  }

  /**
     * Evaluate bind expression against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateBindExpression(expr, input, environment) {
    // The RHS is the expression to evaluate
    // The LHS is the name of the variable to bind to - should be a VARIABLE token (enforced by parser)
    var value = await evaluate(expr.rhs, input, environment);
    environment.bind(expr.lhs.value, value);
    return value;
  }

  /**
     * Evaluate condition against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateCondition(expr, input, environment) {
    var result;
    var condition = await evaluate(expr.condition, input, environment);
    if (fn.boolean(condition)) {
      result = await evaluate(expr.then, input, environment);
    } else if (typeof expr.else !== 'undefined') {
      result = await evaluate(expr.else, input, environment);
    }
    return result;
  }

  /**
   * Evaluate coalescing operator
   * @param {Object} expr - Fumifier expression
   * @param {Object} input - Input data to evaluate against
   * @param {Object} environment - Environment
   * @returns {Promise<any>} Evaluated input data
   */
  async function evaluateCoalesce(expr, input, environment) {
    var result;
    var condition = await evaluate(expr.condition, input, environment);
    if (typeof condition === 'undefined') {
      result = await evaluate(expr.else, input, environment);
    } else {
      result = condition;
    }
    return result;
  }

  /**
   * Evaluate default/elvis operator
   * @param {Object} expr - Fumifier expression
   * @param {Object} input - Input data to evaluate against
   * @param {Object} environment - Environment
   * @returns {Promise<any>} Evaluated input data
   */
  async function evaluateElvis(expr, input, environment) {
    var result;
    var condition = await evaluate(expr.condition, input, environment);
    if (fn.boolean(condition)) {
      result = condition;
    } else {
      result = await evaluate(expr.else, input, environment);
    }
    return result;
  }

  /**
     * Evaluate block against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateBlock(expr, input, environment) {
    var result;
    // create a new frame to limit the scope of variable assignments
    // TODO, only do this if the post-parse stage has flagged this as required
    var frame = createFrame(environment);
    var ii = 0;
    // if regular block (not flash block or rule), invoke each expression in turn
    // and only return the result of the last one

    for(ii = 0; ii < expr.expressions.length; ii++) {
      result = await evaluate(expr.expressions[ii], input, frame);
    }
    return result;
  }

  /**
     * Prepare a regex
     * @param {Object} expr - expression containing regex
     * @returns {Function} Higher order function representing prepared regex
     */
  function evaluateRegex(expr) {
    var re = new RegExp(expr.value);
    var closure = function(str, fromIndex) {
      var result;
      re.lastIndex = fromIndex || 0;
      var match = re.exec(str);
      if(match !== null) {
        result = {
          match: match[0],
          start: match.index,
          end: match.index + match[0].length,
          groups: []
        };
        if(match.length > 1) {
          for(var i = 1; i < match.length; i++) {
            result.groups.push(match[i]);
          }
        }
        result.next = function() {
          if(re.lastIndex >= str.length) {
            return undefined;
          } else {
            var next = closure(str, re.lastIndex);
            if(next && next.match === '') {
              // matches zero length string; this will never progress
              throw {
                code: "D1004",
                stack: (new Error()).stack,
                position: expr.position,
                start: expr.start,
                value: expr.value.source
              };
            }
            return next;
          }
        };
      }

      return result;
    };
    return closure;
  }

  /**
     * Evaluate variable against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {*} Evaluated input data
     */
  function evaluateVariable(expr, input, environment) {
    // lookup the variable value in the environment
    var result;
    // if the variable name is empty string, then it refers to context value
    if (expr.value === '') {
      result = input && input.outerWrapper ? input[0] : input;
    } else {
      result = environment.lookup(expr.value);
    }
    return result;
  }

  /**
     * sort / order-by operator
     * @param {Object} expr - AST for operator
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Ordered sequence
     */
  async function evaluateSortExpression(expr, input, environment) {
    var result;

    // evaluate the lhs, then sort the results in order according to rhs expression
    var lhs = input;
    var isTupleSort = input.tupleStream ? true : false;

    // sort the lhs array
    // use comparator function
    var comparator = async function(a, b) {
      // expr.terms is an array of order-by in priority order
      var comp = 0;
      for(var index = 0; comp === 0 && index < expr.terms.length; index++) {
        var term = expr.terms[index];
        //evaluate the sort term in the context of a
        var context = a;
        var env = environment;
        if(isTupleSort) {
          context = a['@'];
          env = createFrameFromTuple(environment, a);
        }
        var aa = await evaluate(term.expression, context, env);
        //evaluate the sort term in the context of b
        context = b;
        env = environment;
        if(isTupleSort) {
          context = b['@'];
          env = createFrameFromTuple(environment, b);
        }
        var bb = await evaluate(term.expression, context, env);

        // type checks
        var atype = typeof aa;
        var btype = typeof bb;
        // undefined should be last in sort order
        if(atype === 'undefined') {
          // swap them, unless btype is also undefined
          comp = (btype === 'undefined') ? 0 : 1;
          continue;
        }
        if(btype === 'undefined') {
          comp = -1;
          continue;
        }

        // if aa or bb are not string or numeric values, then throw an error
        if(!(atype === 'string' || atype === 'number') || !(btype === 'string' || btype === 'number')) {
          throw {
            code: "T2008",
            stack: (new Error()).stack,
            position: expr.position,
            start: expr.start,
            value: !(atype === 'string' || atype === 'number') ? aa : bb
          };
        }

        //if aa and bb are not of the same type
        if(atype !== btype) {
          throw {
            code: "T2007",
            stack: (new Error()).stack,
            position: expr.position,
            start: expr.start,
            value: aa,
            value2: bb
          };
        }
        if(aa === bb) {
          // both the same - move on to next term
          continue;
        } else if (aa < bb) {
          comp = -1;
        } else {
          comp = 1;
        }
        if(term.descending === true) {
          comp = -comp;
        }
      }
      // only swap a & b if comp equals 1
      return comp === 1;
    };

    var focus = {
      environment: environment,
      input: input
    };
    // the `focus` is passed in as the `this` for the invoked function
    result = await fn.sort.apply(focus, [lhs, comparator]);

    return result;
  }

  /**
     * create a transformer function
     * @param {Object} expr - AST for operator
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {*} tranformer function
     */
  function evaluateTransformExpression(expr, input, environment) {
    // create a function to implement the transform definition
    var transformer = async function (obj) { // signature <(oa):o>
      // undefined inputs always return undefined
      if(typeof obj === 'undefined') {
        return undefined;
      }

      // this function returns a copy of obj with changes specified by the pattern/operation
      var cloneFunction = environment.lookup('clone');
      if(!isFunction(cloneFunction)) {
        // throw type error
        throw {
          code: "T2013",
          stack: (new Error()).stack,
          position: expr.position
        };
      }
      var result = await apply(cloneFunction, [obj], null, environment);
      var matches = await evaluate(expr.pattern, result, environment);
      if(typeof matches !== 'undefined') {
        if(!Array.isArray(matches)) {
          matches = [matches];
        }
        for(var ii = 0; ii < matches.length; ii++) {
          var match = matches[ii];
          if (match && (match.isPrototypeOf(result) || match instanceof Object.constructor)) {
            throw {
              code: "D1010",
              stack: (new Error()).stack,
              position: expr.position
            };
          }
          // evaluate the update value for each match
          var update = await evaluate(expr.update, match, environment);
          // update must be an object
          var updateType = typeof update;
          if(updateType !== 'undefined') {
            if(updateType !== 'object' || update === null || Array.isArray(update)) {
              // throw type error
              throw {
                code: "T2011",
                stack: (new Error()).stack,
                position: expr.update.position,
                start: expr.update.start,
                value: update
              };
            }
            // merge the update
            for(var prop in update) {
              match[prop] = update[prop];
            }
          }

          // delete, if specified, must be an array of strings (or single string)
          if(typeof expr.delete !== 'undefined') {
            var deletions = await evaluate(expr.delete, match, environment);
            if(typeof deletions !== 'undefined') {
              var val = deletions;
              if (!Array.isArray(deletions)) {
                deletions = [deletions];
              }
              if (!isArrayOfStrings(deletions)) {
                // throw type error
                throw {
                  code: "T2012",
                  stack: (new Error()).stack,
                  position: expr.delete.position,
                  start: expr.delete.start,
                  value: val
                };
              }
              for (var jj = 0; jj < deletions.length; jj++) {
                if(typeof match === 'object' && match !== null) {
                  delete match[deletions[jj]];
                }
              }
            }
          }
        }
      }

      return result;
    };

    return defineFunction(transformer, '<(oa):o>');
  }

  var chainAST = utils.chainAST;

  /**
     * Apply the function on the RHS using the sequence on the LHS as the first argument
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateApplyExpression(expr, input, environment) {
    var result;


    var lhs = await evaluate(expr.lhs, input, environment);
    if(expr.rhs.type === 'function') {
      // this is a function _invocation_; invoke it with lhs expression as the first argument
      result = await evaluateFunction(expr.rhs, input, environment, { context: lhs });
    } else {
      var func = await evaluate(expr.rhs, input, environment);

      if(!isFunction(func)) {
        throw {
          code: "T2006",
          stack: (new Error()).stack,
          position: expr.position,
          start: expr.start,
          value: func
        };
      }

      if(isFunction(lhs)) {
        // this is function chaining (func1 ~> func2)
        // λ($f, $g) { λ($x){ $g($f($x)) } }
        var chain = await evaluate(chainAST, null, environment);
        result = await apply(chain, [lhs, func], null, environment);
      } else {
        result = await apply(func, [lhs], null, environment);
      }

    }

    return result;
  }

  /**
     * Evaluate function against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluateFunction(expr, input, environment, applyto) {
    var result;

    // create the procedure
    // can't assume that expr.procedure is a lambda type directly
    // could be an expression that evaluates to a function (e.g. variable reference, parens expr etc.
    // evaluate it generically first, then check that it is a function.  Throw error if not.
    var proc = await evaluate(expr.procedure, input, environment);

    if (typeof proc === 'undefined' && expr.procedure.type === 'path' && environment.lookup(expr.procedure.steps[0].value)) {
      // help the user out here if they simply forgot the leading $
      throw {
        code: "T1005",
        stack: (new Error()).stack,
        position: expr.position,
        start: expr.start,
        token: expr.procedure.steps[0].value
      };
    }

    var evaluatedArgs = [];
    if(typeof applyto !== 'undefined') {
      evaluatedArgs.push(applyto.context);
    }
    // eager evaluation - evaluate the arguments
    for (var jj = 0; jj < expr.arguments.length; jj++) {
      const arg = await evaluate(expr.arguments[jj], input, environment);
      if(isFunction(arg)) {
        // wrap this in a closure
        const closure = async function (...params) {
          // invoke func
          return await apply(arg, params, null, environment);
        };
        closure.arity = getFunctionArity(arg);
        evaluatedArgs.push(closure);
      } else {
        evaluatedArgs.push(arg);
      }
    }
    // apply the procedure
    var procName = expr.procedure.type === 'path' ? expr.procedure.steps[0].value : expr.procedure.value;
    try {
      if(typeof proc === 'object') {
        proc.token = procName;
        proc.position = expr.position;
        proc.start = expr.start;
      }
      result = await apply(proc, evaluatedArgs, input, environment);
    } catch (err) {
      if(!err.position) {
        // add the position field to the error
        err.position = expr.position;
        err.start = expr.start;
      }
      if (!err.token) {
        // and the function identifier
        err.token = procName;
      }
      throw err;
    }
    return result;
  }

  /**
     * Apply procedure or function
     * @param {Object} proc - Procedure
     * @param {Array} args - Arguments
     * @param {Object} input - input
     * @param {Object} environment - environment
     * @returns {Promise<any>} Result of procedure
     */
  async function apply(proc, args, input, environment) {
    var result;
    result = await applyInner(proc, args, input, environment);
    while(isLambda(result) && result.thunk === true) {
      // trampoline loop - this gets invoked as a result of tail-call optimization
      // the function returned a tail-call thunk
      // unpack it, evaluate its arguments, and apply the tail call
      var next = await evaluate(result.body.procedure, result.input, result.environment);
      if(result.body.procedure.type === 'variable') {
        next.token = result.body.procedure.value;
      }
      next.position = result.body.procedure.position;
      next.start = result.body.procedure.start;
      var evaluatedArgs = [];
      for(var ii = 0; ii < result.body.arguments.length; ii++) {
        evaluatedArgs.push(await evaluate(result.body.arguments[ii], result.input, result.environment));
      }

      result = await applyInner(next, evaluatedArgs, input, environment);
    }
    return result;
  }

  /**
     * Apply procedure or function
     * @param {Object} proc - Procedure
     * @param {Array} args - Arguments
     * @param {Object} input - input
     * @param {Object} environment - environment
     * @returns {Promise<any>} Result of procedure
     */
  async function applyInner(proc, args, input, environment) {
    var result;
    try {
      var validatedArgs = args;
      if (proc) {
        validatedArgs = validateArguments(proc.signature, args, input);
      }

      if (isLambda(proc)) {
        result = await applyProcedure(proc, validatedArgs);
      } else if (proc && proc._fumifier_function === true) {
        var focus = {
          environment: environment,
          input: input
        };
        // the `focus` is passed in as the `this` for the invoked function
        result = proc.implementation.apply(focus, validatedArgs);
        // `proc.implementation` might be a generator function
        // and `result` might be a generator - if so, yield
        if (isIterable(result)) {
          result = result.next().value;
        }
        if (isPromise(result)) {
          result = await result;
        }
      } else if (typeof proc === 'function') {
        // typically these are functions that are returned by the invocation of plugin functions
        // the `input` is being passed in as the `this` for the invoked function
        // this is so that functions that return objects containing functions can chain
        // e.g. await (await $func())
        result = proc.apply(input, validatedArgs);
        if (isPromise(result)) {
          result = await result;
        }
      } else {
        throw {
          code: "T1006",
          stack: (new Error()).stack
        };
      }
    } catch(err) {
      if(proc) {
        if (typeof err.token === 'undefined' && typeof proc.token !== 'undefined') {
          err.token = proc.token;
        }
        err.position = proc.position || err.position;
        err.start = proc.start || err.start;
      }
      throw err;
    }
    return result;
  }

  /**
     * Evaluate lambda against input data
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {{lambda: boolean, input: *, environment: *, arguments: *, body: *}} Evaluated input data
     */
  function evaluateLambda(expr, input, environment) {
    // make a function (closure)
    var procedure = {
      _fumifier_lambda: true,
      input: input,
      environment: environment,
      arguments: expr.arguments,
      signature: expr.signature,
      body: expr.body
    };
    if(expr.thunk === true) {
      procedure.thunk = true;
    }
    procedure.apply = async function(self, args) {
      return await apply(procedure, args, input, self ? self.environment : environment);
    };
    return procedure;
  }

  /**
     * Evaluate partial application
     * @param {Object} expr - Fumifier expression
     * @param {Object} input - Input data to evaluate against
     * @param {Object} environment - Environment
     * @returns {Promise<any>} Evaluated input data
     */
  async function evaluatePartialApplication(expr, input, environment) {
    // partially apply a function
    var result;
    // evaluate the arguments
    var evaluatedArgs = [];
    for(var ii = 0; ii < expr.arguments.length; ii++) {
      var arg = expr.arguments[ii];
      if (arg.type === 'operator' && arg.value === '?') {
        evaluatedArgs.push(arg);
      } else {
        evaluatedArgs.push(await evaluate(arg, input, environment));
      }
    }
    // lookup the procedure
    var proc = await evaluate(expr.procedure, input, environment);
    if (typeof proc === 'undefined' && expr.procedure.type === 'path' && environment.lookup(expr.procedure.steps[0].value)) {
      // help the user out here if they simply forgot the leading $
      throw {
        code: "T1007",
        stack: (new Error()).stack,
        position: expr.position,
        start: expr.start,
        token: expr.procedure.steps[0].value
      };
    }
    if (isLambda(proc)) {
      result = partialApplyProcedure(proc, evaluatedArgs);
    } else if (proc && proc._fumifier_function === true) {
      result = partialApplyNativeFunction(proc.implementation, evaluatedArgs);
    } else if (typeof proc === 'function') {
      result = partialApplyNativeFunction(proc, evaluatedArgs);
    } else {
      throw {
        code: "T1008",
        stack: (new Error()).stack,
        position: expr.position,
        start: expr.start,
        token: expr.procedure.type === 'path' ? expr.procedure.steps[0].value : expr.procedure.value
      };
    }
    return result;
  }

  /**
     * Validate the arguments against the signature validator (if it exists)
     * @param {Function} signature - validator function
     * @param {Array} args - function arguments
     * @param {*} context - context value
     * @returns {Array} - validated arguments
     */
  function validateArguments(signature, args, context) {
    if(typeof signature === 'undefined') {
      // nothing to validate
      return args;
    }
    var validatedArgs = signature.validate(args, context);
    return validatedArgs;
  }

  /**
     * Apply procedure
     * @param {Object} proc - Procedure
     * @param {Array} args - Arguments
     * @returns {Promise<any>} Result of procedure
     */
  async function applyProcedure(proc, args) {
    var result;
    var env = createFrame(proc.environment);
    proc.arguments.forEach(function (param, index) {
      env.bind(param.value, args[index]);
    });
    if (typeof proc.body === 'function') {
      // this is a lambda that wraps a native function - generated by partially evaluating a native
      result = await applyNativeFunction(proc.body, env);
    } else {
      result = await evaluate(proc.body, proc.input, env);
    }
    return result;
  }

  /**
     * Partially apply procedure
     * @param {Object} proc - Procedure
     * @param {Array} args - Arguments
     * @returns {{lambda: boolean, input: *, environment: {bind, lookup}, arguments: Array, body: *}} Result of partially applied procedure
     */
  function partialApplyProcedure(proc, args) {
    // create a closure, bind the supplied parameters and return a function that takes the remaining (?) parameters
    var env = createFrame(proc.environment);
    var unboundArgs = [];
    proc.arguments.forEach(function (param, index) {
      var arg = args[index];
      if (arg && arg.type === 'operator' && arg.value === '?') {
        unboundArgs.push(param);
      } else {
        env.bind(param.value, arg);
      }
    });
    var procedure = {
      _fumifier_lambda: true,
      input: proc.input,
      environment: env,
      arguments: unboundArgs,
      body: proc.body
    };
    return procedure;
  }

  /**
     * Partially apply native function
     * @param {Function} native - Native function
     * @param {Array} args - Arguments
     * @returns {{lambda: boolean, input: *, environment: {bind, lookup}, arguments: Array, body: *}} Result of partially applying native function
     */
  function partialApplyNativeFunction(native, args) {
    // create a lambda function that wraps and invokes the native function
    // get the list of declared arguments from the native function
    // this has to be picked out from the toString() value
    var sigArgs = getNativeFunctionArguments(native);
    sigArgs = sigArgs.map(function (sigArg) {
      return '$' + sigArg.trim();
    });
    var body = 'function(' + sigArgs.join(', ') + '){ _ }';

    var bodyAST = parser(body);
    bodyAST.body = native;

    var partial = partialApplyProcedure(bodyAST, args);
    return partial;
  }

  /**
     * Apply native function
     * @param {Object} proc - Procedure
     * @param {Object} env - Environment
     * @returns {Promise<any>} Result of applying native function
     */
  async function applyNativeFunction(proc, env) {
    var sigArgs = getNativeFunctionArguments(proc);
    // generate the array of arguments for invoking the function - look them up in the environment
    var args = sigArgs.map(function (sigArg) {
      return env.lookup(sigArg.trim());
    });

    var focus = {
      environment: env
    };
    var result = proc.apply(focus, args);
    if (isPromise(result)) {
      result = await result;
    }
    return result;
  }

  /**
     * Get native function arguments
     * @param {Function} func - Function
     * @returns {*|Array} Native function arguments
     */
  function getNativeFunctionArguments(func) {
    var signature = func.toString();
    var sigParens = /\(([^)]*)\)/.exec(signature)[1]; // the contents of the parens
    var sigArgs = sigParens.split(',');
    return sigArgs;
  }

  /**
     * parses and evaluates the supplied expression
     * @param {string} expr - expression to evaluate
     * @returns {Promise<any>} - result of evaluating the expression
     */
  async function functionEval(expr, focus) {
    // undefined inputs always return undefined
    if(typeof expr === 'undefined') {
      return undefined;
    }
    var input = this.input;
    if(typeof focus !== 'undefined') {
      input = focus;
      // if the input is a JSON array, then wrap it in a singleton sequence so it gets treated as a single input
      if(Array.isArray(input) && !isSequence(input)) {
        input = createSequence(input);
        input.outerWrapper = true;
      }
    }

    try {
      var ast = parser(expr, false);
    } catch(err) {
      // error parsing the expression passed to $eval
      populateMessage(err);
      throw {
        stack: (new Error()).stack,
        code: "D3120",
        value: err.message,
        error: err
      };
    }
    try {
      var result = await evaluate(ast, input, this.environment);
    } catch(err) {
      // error evaluating the expression passed to $eval
      populateMessage(err);
      throw {
        stack: (new Error()).stack,
        code: "D3121",
        value:err.message,
        error: err
      };
    }

    return result;
  }

  /**
     * Create frame
     * @param {Object} enclosingEnvironment - Enclosing environment
     * @returns {{bind: bind, lookup: lookup}} Created frame
     */
  function createFrame(enclosingEnvironment) {
    var bindings = {};
    const newFrame = {
      bind: function (name, value) {
        bindings[name] = value;
      },
      lookup: function (name) {
        var value;
        if(bindings.hasOwnProperty(name)) {
          value = bindings[name];
        } else if (enclosingEnvironment) {
          value = enclosingEnvironment.lookup(name);
        }
        return value;
      },
      timestamp: enclosingEnvironment ? enclosingEnvironment.timestamp : null,
      async: enclosingEnvironment ? enclosingEnvironment.async : false,
      isParallelCall: enclosingEnvironment ? enclosingEnvironment.isParallelCall : false,
      global: enclosingEnvironment ? enclosingEnvironment.global : {
        ancestry: [null]
      }
    };

    if (enclosingEnvironment) {
      var framePushCallback = enclosingEnvironment.lookup(Symbol.for('fumifier.__createFrame_push'));
      if(framePushCallback) {
        framePushCallback(enclosingEnvironment, newFrame);
      }
    }
    return newFrame;
  }

  /**
   * All FHIR definitions resolved during parsing were stored as dictionaries on the root of the AST.
   * They have been bound to the environment so that they can be looked up during evaluation.
   * This function returns these dictionaries as a single object.
   * @param {*} environment The environment to lookup
   * @returns {Object} A collection of dictionaries containing all FHIR definitions resolved during parsing.
   */
  function getFhirDefinitionsDictinary(environment) {
    return environment.lookup(Symbol.for('fumifier.__resolvedDefinitions'));
  }

  /**
   * RegEx expressions used by the FHIR definitions should be compiled during parsing and stored in the environment.
   * To enable the AST to be portable, we do need to fallback to eval-time compilation if we encounter a regex that
   * was not compiled during parsing. To prevent repeated compilation of the same regex, we use the environment to
   * store the compiled expressions for re-use.
   * This function recieves the expression as string (as it is stored in the FHIR definition) and returns a RegExp
   * instance ready for testing.
   * @param {*} environment The environment to lookup and store compiled regexes
   * @param {string} regexStr - The regex string to compile, e.g. '([A-Za-z0-9\\-\\.]+)\\/[A-Za-z0-9\\-\\.]+'
   * @returns RegExp instance that can be used to test strings against the regex using the test() method.
   */
  function getFhirRegexTester(environment, regexStr) {
    var compiled = environment.lookup(Symbol.for('fumifier.__compiledFhirRegex_GET'))(regexStr);
    if (compiled) {
      // return the compiled regex
      return compiled;
    }
    // if the regex is not compiled, then compile it and store it in the environment
    compiled = environment.lookup(Symbol.for('fumifier.__compiledFhirRegex_SET'))(regexStr);
    return compiled;
  }

  /**
   * Get an ElementDefinition from the resolved FHIR definitions dictionary.
   * @param {*} environment The environment to lookup the definitions
   * @param {*} referenceKey This is stored on a FLASH rule node and used to attach it to the ElementDefinition.
   * @returns {Object|undefined} The ElementDefinition object if found, otherwise undefined.
   */
  function getFhirElementDefinition(environment, referenceKey) {
    const definitions = getFhirDefinitionsDictinary(environment);
    // make sure that the element definitions are available
    if (definitions && definitions.elementDefinitions) {
      // the referenceKey is a string like 'PatientProfile::name[english].given'
      return definitions.elementDefinitions[referenceKey];
    }
    // if the definitions are not available, return undefined
    return undefined;
  }

  function getFhirTypeMeta(environment, instanceOf) {
    const definitions = getFhirDefinitionsDictinary(environment);
    // make sure that the type meta dictionary is available
    if (definitions && definitions.typeMeta) {
      // the key is the block's `InstanceOf:` value
      return definitions.typeMeta[instanceOf];
    }
    // if the definitions are not available, return undefined
    return undefined;
  }

  function getFhirTypeChildren(environment, instanceOf) {
    const definitions = getFhirDefinitionsDictinary(environment);
    // make sure that the type children definitions are available
    if (definitions && definitions.typeChildren) {
      return definitions.typeChildren[instanceOf];
    }
    // if the definitions are not available, return undefined
    return undefined;
  }

  function getFhirElementChildren(environment, referenceKey) {
    const definitions = getFhirDefinitionsDictinary(environment);
    // make sure that the children definitions are available
    if (definitions && definitions.elementChildren) {
      // the referenceKey is a string like 'PatientProfile::name[english].given'
      return definitions.elementChildren[referenceKey];
    }
    // if the definitions are not available, return undefined
    return undefined;
  }

  // Function registration
  registerNativeFn(staticFrame, functionEval);

  /**
     * Fumifier
     * @param {string} expr - FUME mapping expression as text
     * @param {FumifierOptions} options
     * @param {boolean} options.recover: attempt to recover on parse error
     * @param {FhirStructureNavigator} options.navigator: FHIR structure navigator
     * @returns {Promise<fumifier.Expression> | fumifier.Expression} Compiled expression object
     */
  async function fumifier(expr, options) {
    var ast;
    var errors;
    var navigator = options && options.navigator;
    var recover = options && options.recover;
    var compiledFhirRegex = {};

    try {
      // syntactic parsing only (sync) - may throw on syntax errors
      ast = parser(expr, options && options.recover);

      // initial parsing done
      errors = ast.errors;
      delete ast.errors;
      // post-parse FLASH processing (async)
      // - only if a navigator was provided
      // - only if the AST contains flash blocks
      // - throws if has flash and no navigator
      if (ast && ast.containsFlash === true) {
        if (!navigator) {
          var err = {
            code: 'F1000',
            position: 0,
          };

          if (recover) {
            err.type = 'error';
            errors.push(err);
          } else {
            err.stack = (new Error()).stack;
            throw err;
          }
        } else {
          // resolve all FHIR definition required for evaluation
          ast = await resolveDefinitions(ast, navigator, recover, errors, compiledFhirRegex);
        }
      }
    } catch(err) {
      // insert error message into structure
      populateMessage(err); // possible side-effects on `err`
      throw err;
    }

    var environment = createFrame(staticFrame);

    var timestamp = new Date(); // will be overridden on each call to evalute()
    environment.bind('now', defineFunction(function(picture, timezone) {
      return datetime.fromMillis(timestamp.getTime(), picture, timezone);
    }, '<s?s?:s>'));
    environment.bind('millis', defineFunction(function() {
      return timestamp.getTime();
    }, '<:n>'));

    // bind a GETTER for compiled FHIR regexes
    environment.bind(Symbol.for('fumifier.__compiledFhirRegex_GET'), function(regexStr) {
      if (compiledFhirRegex.hasOwnProperty(regexStr)) {
        return compiledFhirRegex[regexStr];
      }
      return undefined;
    });

    // bind a SETTER for compiled FHIR regexes
    environment.bind(Symbol.for('fumifier.__compiledFhirRegex_SET'), function(regexStr) {
      const compiled = new RegExp(`^${regexStr}$`);
      compiledFhirRegex[regexStr] = compiled;
      return compiled;
    });

    // bind the resolved definition collections
    environment.bind(Symbol.for('fumifier.__resolvedDefinitions'), {
      typeMeta: ast.resolvedTypeMeta,
      baseTypeMeta: ast.resolvedBaseTypeMeta,
      typeChildren: ast.resolvedTypeChildren,
      elementDefinitions: ast.resolvedElementDefinitions,
      elementChildren: ast.resolvedElementChildren
    });

    var fumifierObject = {
      evaluate: async function (input, bindings, callback) {
        // throw if the expression compiled with syntax errors
        if(typeof errors !== 'undefined') {
          var err = {
            code: 'S0500',
            position: 0
          };
          populateMessage(err); // possible side-effects on `err`
          throw err;
        }

        if (typeof bindings !== 'undefined') {
          var exec_env;
          // the variable bindings have been passed in - create a frame to hold these
          exec_env = createFrame(environment);
          for (var v in bindings) {
            exec_env.bind(v, bindings[v]);
          }
        } else {
          exec_env = environment;
        }
        // put the input document into the environment as the root object
        exec_env.bind('$', input);

        // capture the timestamp and put it in the execution environment
        // the $now() and $millis() functions will return this value - whenever it is called
        timestamp = new Date();
        exec_env.timestamp = timestamp;

        // if the input is a JSON array, then wrap it in a singleton sequence so it gets treated as a single input
        if(Array.isArray(input) && !isSequence(input)) {
          input = createSequence(input);
          input.outerWrapper = true;
        }

        var it;
        try {
          it = await evaluate(ast, input, exec_env);
          if (typeof callback === "function") {
            callback(null, it);
          }
          return it;
        } catch (err) {
          // insert error message into structure
          populateMessage(err); // possible side-effects on `err`
          throw err;
        }
      },
      assign: function (name, value) {
        environment.bind(name, value);
      },
      registerFunction: function(name, implementation, signature) {
        var func = defineFunction(implementation, signature);
        environment.bind(name, func);
      },
      ast: function() {
        return ast;
      },
      errors: function() {
        return errors;
      }
    };

    return fumifierObject;

  }

  fumifier.parser = parser; // TODO remove this in a future release - use ast() instead

  return fumifier;

})();

export default fumifier;
