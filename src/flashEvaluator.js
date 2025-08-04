/**
 * @module FlashEvaluator
 * @description FLASH (FHIR-specific) evaluation functions for Fumifier
 */

import fn from './utils/functions.js';

// Import utility functions directly since they are simple utilities
const { initCap, boolize } = fn;

/**
 * Flash evaluation module that contains all FLASH-specific evaluation logic
 * @param {Function} evaluate - Main evaluate function from fumifier (jsonata)
 * @returns {Object} Flash evaluation functions
 */
function createFlashEvaluator(evaluate) {

  /**
   * Parse and validate system primitive values according to FHIR specifications.
   * This function also handles the actual primitive `value` of a FHIR primitive type, which is itself a system primitive.
   * @param {Object} expr - Expression with FHIR context
   * @param {*} input - Input value to parse
   * @param {Object} elementDefinition - FHIR element definition
   * @param {Object} environment - Environment with FHIR definitions
   * @returns {*} Parsed primitive value
   */
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
        // TODO: FHIR spec requires preserving decimal precision for presentation purposes (e.g., 1.00 vs 1)
        // JavaScript natively supports only floating point numbers, causing loss of precision for trailing zeros.
        // FHIR JSON spec suggests using custom parsers and big number libraries (e.g. javascript-bignum) to meet this requirement.
        // Most JavaScript-based FHIR implementations face this same limitation due to JSON.parse() behavior.
        // Alternative approach: Define an extension to preserve original string representation alongside the numeric value.
        // This would be standards-compliant and solve the interoperability issue without breaking JSON compatibility.
        if (valueType === 'number') {
          return input; // already a number (precision already lost if input came from JSON.parse)
        } else if (valueType === 'string') {
          return Number(input); // convert string to number (precision lost here)
        } else if (valueType === 'boolean') {
          return input ? 1 : 0; // convert boolean to number
        }
      }

      // all other fhir primitive types are reperesented as strings in the JSON
      return fn.string(input); // converts to string if needed
    }
  }

  /**
   * Ensure a Resource input is an object with a valid resourceType
   * @param {*} input - Input value to validate
   * @param {Object} expr - Expression with position info for errors
   * @returns {*} Validated resource input
   */
  function assertResourceInput(input, expr) {

    // Handle arrays of resources
    if (Array.isArray(input)) {
      return input.map(item => assertResourceInput(item, expr));
    }

    // Input must be an object
    if (!input || typeof input !== 'object') {
      const error = {
        code: "F3010",
        stack: (new Error()).stack,
        position: expr.position,
        start: expr.start,
        line: expr.line,
        fhirParent: expr.instanceof,
        fhirElement: expr.flashPathRefKey.split('::')[1],
        valueType: typeof input
      };

      throw error;
    }

    // Object must have resourceType attribute
    if (!input.resourceType || typeof input.resourceType !== 'string' || input.resourceType.trim() === '') {
      const error = {
        code: "F3011",
        stack: (new Error()).stack,
        position: expr.position,
        start: expr.start,
        line: expr.line,
        fhirParent: expr.instanceof,
        fhirElement: expr.flashPathRefKey.split('::')[1]
      };

      throw error;
    }

    return input;
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

    const generateErrorObject = () => {
      const baseErr = {
        stack: (new Error()).stack,
        position: expr.position,
        start: expr.start,
        line: expr.line
      };
      if (expr.instanceof) {
        baseErr.instanceOf = expr.instanceof;
        if (expr.flashPathRefKey) {
          baseErr.fhirElement = expr.flashPathRefKey.slice(expr.instanceof.length + 2);
        }
      }
      return baseErr;
    };

    if (!expr.flashPathRefKey) {
      throw { code: "F3000", ...generateErrorObject() };
    }
    // lookup the definition of the element
    const elementDefinition = getFhirElementDefinition(environment, expr.flashPathRefKey);

    if (!elementDefinition) {
      throw {
        code: "F3003",
        ...generateErrorObject()
      };
    }

    if (
      !(elementDefinition?.__name) || // should have a name array set on the enriched definition
      !Array.isArray(elementDefinition.__name) || // should be an array
      elementDefinition.__name.length > 1 // no more than one option
    ) {
      throw {
        code: "F3005",
        ...generateErrorObject()
      };
    }

    // get the kind of the element
    const kind = elementDefinition.__kind;
    if (!kind) {
      throw {
        code: 'F3004',
        ...generateErrorObject()
      };
    }

    // get the json element name. there can only be one name at this stage, otherwise we would have thrown earlier
    const jsonElementName = elementDefinition.__name[0];
    // is it a base poly element (reduced to a single type by profile or flash path disambiguation)?
    const isBasePoly = elementDefinition.base?.path?.endsWith('[x]');
    // if there's a slice name in the element definition,
    // it is an "official" slice and must be used in the grouping key.
    // UNLESS this is a polymorphic element at the base...
    // in which case slices can only correspond to a type, and the type is already represented in the jsonElementName.
    const sliceName = isBasePoly ? undefined : elementDefinition.sliceName || undefined;
    // generate the grouping key for the element
    const groupingKey = sliceName ? `${jsonElementName}:${sliceName}` : jsonElementName;

    // create a container object for the evaluated flash rule
    const result = {
      '@@__flashRuleResult': true,
      key: groupingKey,
      value: undefined, // initiate with undefined value
      kind
    };

    // if element has a fixed value, use it and return (short circuit)
    if (elementDefinition.__fixedValue) {
      result.value = elementDefinition.__fixedValue;
      return result;
    }

    // handle system primitive's inline value
    // their value is just the primitive- no children are ever possible
    if (kind === 'system') {
      const resultValue = parseSystemPrimitive(expr, input, elementDefinition, environment);
      // if the result value is an array, take only last one
      // (system primitives are assumed to never be arrays in the definition)
      // TODO: confirm this hypothesis
      if (Array.isArray(resultValue)) {
        result.value = resultValue[resultValue.length - 1];
      } else {
        result.value = resultValue;
      }
      return result;
    }

    // handle FHIR primitives' inline value
    // this is treated as the primitive value of the 'value' child element
    // (we treat FHIR primitives as objects since they can have children)
    if (kind === 'primitive-type') {
      const evaluated = parseSystemPrimitive(
        expr,
        input.value, // input's `value` attribute is the primitive value we parse
        elementDefinition,
        environment
      );

      // For primitive types, result.value is always an object even if there's no value
      // This is necessary for elements that have children (extension or id) but no value
      result.value = {
        ...input, // copy all properties from the input value (includes extension, id)
        value: evaluated // assign the evaluated value to the 'value' key (can be undefined)
      };
      return result;
    }

    // Handle complex types and Resource datatype.
    // For arrays, we need to create multiple FlashRuleResults.
    if (Array.isArray(input)) {
      // Return an array where each object becomes a separate FlashRuleResult
      return input.map(obj => ({...result, value: obj}));
    } else {
      // Single object
      result.value = input;
    }

    return result;
  }

  /**
   * Recursively flattens FHIR primitive values in an object.
   * Converts {"value": "primitive"} to "primitive" while preserving sibling properties.
   * @param {Object} obj - Object to flatten
   * @param {Array} children - FHIR element children definitions
   * @param {Object} environment - Environment with FHIR definitions
   * @returns {Object} Flattened object
   */
  function flattenPrimitiveValues(obj, children, environment) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj;
    }

    if (!children || !Array.isArray(children)) {
      return flattenPrimitiveValuesHeuristic(obj, children, environment);
    }

    const result = { ...obj };

    for (const [key, value] of Object.entries(result)) {
      // Find the FHIR element definition for this key
      const elementDef = children.find(child =>
        child.__name && child.__name.includes(key)
      );

      if (elementDef && elementDef.__kind === 'primitive-type' &&
          value && typeof value === 'object' && !Array.isArray(value) &&
          value.value !== undefined) {
        // This is a FHIR primitive object, flatten it
        result[key] = value.value;

        // Handle sibling properties (those starting with _)
        const props = Object.keys(value).filter(k => k !== 'value');
        if (props.length > 0) {
          const siblingKey = '_' + key;
          result[siblingKey] = props.reduce((acc, k) => {
            acc[k] = value[k];
            return acc;
          }, {});
        }
      } else if (Array.isArray(value)) {
        // Recursively process array elements
        result[key] = value.map(item => {
          if (typeof item === 'object' && !Array.isArray(item) && elementDef) {
            const typeCode = elementDef.type?.[0]?.code;
            if (typeCode) {
              try {
                const typeChildren = getFhirTypeChildren(environment, typeCode);
                return flattenPrimitiveValues(item, typeChildren, environment);
              } catch (error) {
                return flattenPrimitiveValues(item, children, environment);
              }
            }
          }
          return item;
        });
      } else if (typeof value === 'object' && value !== null && elementDef) {
        // Recursively process nested objects
        const typeCode = elementDef.type?.[0]?.code;
        if (typeCode) {
          try {
            const typeChildren = getFhirTypeChildren(environment, typeCode);
            result[key] = flattenPrimitiveValues(value, typeChildren, environment);
          } catch (error) {
            result[key] = flattenPrimitiveValues(value, children, environment);
          }
        }
      }
    }

    return result;
  }

  /**
   * Heuristic approach to flatten primitive values when children definitions are not available
   * @param {Object} obj - Object to flatten
   * @param {Array} children - FHIR element children definitions
   * @param {Object} environment - Environment with FHIR definitions
   * @returns {Object} Flattened object
   */
  function flattenPrimitiveValuesHeuristic(obj, children, environment) {
    // If we don't have children, try a simple heuristic approach
    // Look for objects with a 'value' property that might be FHIR primitives
    const result = { ...obj };
    for (const [key, value] of Object.entries(result)) {
      if (value && typeof value === 'object' && !Array.isArray(value) &&
          value.value !== undefined && Object.keys(value).length >= 1) {
        // This looks like a FHIR primitive, flatten it
        result[key] = value.value;

        // Handle sibling properties
        const props = Object.keys(value).filter(k => k !== 'value');
        if (props.length > 0) {
          const siblingKey = '_' + key;
          result[siblingKey] = props.reduce((acc, k) => {
            acc[k] = value[k];
            return acc;
          }, {});
        }
      } else if (Array.isArray(value)) {
        // Recursively process array elements
        result[key] = value.map(item => flattenPrimitiveValues(item, children, environment));
      } else if (value && typeof value === 'object') {
        // Recursively process nested objects
        result[key] = flattenPrimitiveValues(value, children, environment);
      }
    }
    return result;
  }

  /**
   * Recursively fixes arrays within inline objects based on FHIR element definitions.
   * If a property in the object corresponds to a FHIR element with max != '1' and the value is an array,
   * the array items are spread rather than treated as a nested array.
   * @param {Object} obj - Object to process
   * @param {Array} children - FHIR element children definitions
   * @param {Object} environment - Environment with FHIR definitions
   * @param {string} parentPath - Path to parent element for debugging
   * @returns {Object} Processed object
   */
  function fixArraysInInlineObject(obj, children, environment, parentPath = '') {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj;
    }

    const result = { ...obj };

    for (const [key, value] of Object.entries(result)) {
      // Find the FHIR element definition for this key
      const elementDef = children.find(child =>
        child.__name && child.__name.includes(key)
      );

      // If this is an array field (max != '1') and we have an array value,
      // the array should be used as-is, not wrapped in another array
      if (elementDef && elementDef.max !== '1' && Array.isArray(value)) {
        // For array fields, keep the array as-is - don't double-wrap
        result[key] = value;
      } else if (Array.isArray(value)) {
        // For non-array fields, recursively process array elements
        result[key] = value.map(item =>
          (typeof item === 'object' && !Array.isArray(item)) ?
            fixArraysInInlineObject(item, children, environment, `${parentPath}.${key}`) :
            item
        );
      } else if (typeof value === 'object' && value !== null && elementDef) {
        // For complex types, get the children of that type and recursively process
        const typeCode = elementDef.type?.[0]?.code;
        if (typeCode) {
          try {
            const typeChildren = getFhirTypeChildren(environment, typeCode);
            result[key] = fixArraysInInlineObject(value, typeChildren, environment, `${parentPath}.${key}`);
          } catch (error) {
            // If we can't get type children, just process with current children
            result[key] = fixArraysInInlineObject(value, children, environment, `${parentPath}.${key}`);
          }
        } else {
          result[key] = fixArraysInInlineObject(value, children, environment, `${parentPath}.${key}`);
        }
      }
    }

    return result;
  }

  /**
   * Initialize FLASH context from expression metadata
   * @param {Object} expr - Flash expression
   * @param {Object} environment - Environment with FHIR definitions
   * @returns {Object} Flash context with kind, children, resourceType, profileUrl
   */
  function initializeFlashContext(expr, environment) {
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
          kind,
          children,
          resourceType,
          profileUrl,
          fixedValue: {
            '@@__flashRuleResult': true,
            key: def.__name[0],
            value: def.__fixedValue
          }
        };
      } else if (kind !== 'system') {
        children = getFhirElementChildren(environment, expr);
        if (def.__patternValue) {
          return {
            kind,
            children,
            resourceType,
            profileUrl,
            patternValue: {
              '@@__flashRuleResult': true,
              key: def.__name[0],
              value: def.__patternValue
            }
          };
        }
      }
    }

    return { kind, children, resourceType, profileUrl };
  }

  /**
   * Process all expressions within a flash block/rule and group results by key
   * @async
   * @param {Object} expr - Flash expression
   * @param {*} input - Input data
   * @param {Object} environment - Environment
   * @returns {Promise<Object>} Promise resolving to object with inlineResult and subExpressionResults
   */
  async function processFlashExpressions(expr, input, environment) {

    const subExpressionResults = {};
    let inlineResult;

    // Evaluate all expressions and group results by key
    for (const node of expr.expressions) {

      let res = await evaluate(node, input, environment);

      if (typeof res === 'undefined') {
        continue; // undefined results are ignored
      }

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

    return { inlineResult, subExpressionResults };
  }

  /**
   * Process values for a specific child element within flash evaluation
   * @async
   * @param {Object} child - Child element definition
   * @param {*} inlineResult - Inline expression result
   * @param {Object} subExpressionResults - Sub-expression results
   * @param {Object} expr - Original flash expression
   * @param {Object} environment - Environment
   * @param {Object} parentPatternValue - Parent pattern value if applicable
   * @returns {Promise<Array>} Promise resolving to array of processed values
   */
  async function processChildValues(child, inlineResult, subExpressionResults, expr, environment, parentPatternValue) {
    // we will first normalize the possible names of this element into an array of grouping keys
    const names = generateChildNames(child);

    // start by keeping all the matching values for this element in an array
    const values = [];
    for (const name of names) {
      const valuesForName = await processValuesForName(
        name, child, inlineResult, subExpressionResults, parentPatternValue
      );

      // if we have no values for this name, skip it
      if (valuesForName.length === 0) {
        continue;
      }

      const kindForName = child.type.length === 1 ?
        child.type[0].__kind :
        child.type.find(type => name.endsWith(initCap(type.code))).__kind;

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
      if (child.min === 0 || child.type.length > 1) return { values }; // skip if not mandatory, or if polymorphic

      // try to evaluate the child as a virtual rule
      try {
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
        if (typeof autoValue !== 'undefined') {
          values.push({ name: autoValue.key, kind: autoValue.kind, value: [autoValue.value] });
        }
      } catch (error) {
        // For virtual rule errors during explicit assignment processing, collect but don't throw yet
        // The parent will check if other flash rules provided values for this element

        // Return the error along with the values so parent can decide what to do
        return { values, virtualRuleError: error, childInfo: child };
      }
    }

    return { values };
  }

  /**
   * Generate possible names for a child element (handles polymorphic and slice cases)
   * @param {Object} child - Child element definition
   * @returns {Array} Array of possible names
   */
  function generateChildNames(child) {
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

    return names;
  }

  /**
   * Process values for a specific name within child processing
   * @async
   * @param {string} name - Element name
   * @param {Object} child - Child element definition
   * @param {*} inlineResult - Inline expression result
   * @param {Object} subExpressionResults - Sub-expression results
   * @param {Object} parentPatternValue - Parent pattern value if available
   * @returns {Promise<Array>} Promise resolving to array of values for this name
   */
  async function processValuesForName(name, child, inlineResult, subExpressionResults, parentPatternValue) {
    // Determine the kind of this specific element name, accounting for polymorphic elements
    const kindForName = child.type.length === 1 ?
      child.type[0].__kind :
      child.type.find(type => name.endsWith(initCap(type.code))).__kind;

    // if the parent pattern has a value for this name, we will use it
    if (parentPatternValue && parentPatternValue.value && parentPatternValue.value[name] && typeof parentPatternValue.value[name] !== undefined) {
      const patternValue = parentPatternValue.value[name];

      // For primitive types, if the pattern value is a raw string, wrap it in proper FHIR primitive structure
      if (kindForName === 'primitive-type') {
        // if there are sibling attributes, merge them into the value object
        const siblingName = '_' + name;
        if (typeof parentPatternValue.value[siblingName] === 'object' && Object.keys(parentPatternValue.value[siblingName]).length > 0) {
          const primitiveValue = { value: patternValue };
          Object.assign(primitiveValue, parentPatternValue.value[siblingName]);
          return [{ value: primitiveValue }]; // wrap in proper FHIR primitive structure
        }
        return [{ value: patternValue }]; // wrap in proper FHIR primitive structure
      }

      return [patternValue]; // return the value from the parent pattern as-is for other types
    }
    const valuesForName = []; // keep all values for this json element name    // check if the inline expression has a value for this name
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
      processInlineValues(name, kindForName, child, inlineResult, valuesForName);
    }

    // now check if the subExpressionResults has a value for this name
    if (Object.prototype.hasOwnProperty.call(subExpressionResults, name)) {
      valuesForName.push(...(subExpressionResults[name].map(item => item.value)));
    }

    return valuesForName;
  }

  /**
   * Process inline values for a specific name
   * @param {string} name - Element name
   * @param {string} kindForName - Element kind
   * @param {Object} child - Child element definition
   * @param {*} inlineResult - Inline expression result
   * @param {Array} valuesForName - Array to push values to
   */
  function processInlineValues(name, kindForName, child, inlineResult, valuesForName) {
    let value;
    // if it's not a fhir primitive, we just take the value
    if (kindForName !== 'primitive-type') {
      value = inlineResult[name];
      // If the value is an array and this element can have multiple values,
      // spread the array items instead of treating the whole array as one value
      if (Array.isArray(value) && child.max !== '1') {
        valuesForName.push(...value);
      } else {
        valuesForName.push(value);
      }
    } else {
      // if it's a fhir primitive, we convert it to an object
      const rawValue = inlineResult[name];

      // If the value is an array and this element can have multiple values,
      // treat each array item as a separate primitive value
      if (Array.isArray(rawValue) && child.max !== '1') {
        for (const item of rawValue) {
          const primitiveValue = { value: item };
          const siblingName = '_' + name;
          if (typeof inlineResult[siblingName] === 'object' && Object.keys(inlineResult[siblingName]).length > 0) {
            // if there's a sibling element with the same name prefixed with '_',
            // we will copy its properties to the value object
            Object.assign(primitiveValue, inlineResult[siblingName]);
          }
          valuesForName.push(primitiveValue);
        }
      } else {
        // Single value or array treated as single value
        const primitiveValue = { value: rawValue };
        const siblingName = '_' + name;
        if (typeof inlineResult[siblingName] === 'object' && Object.keys(inlineResult[siblingName]).length > 0) {
          // if there's a sibling element with the same name prefixed with '_',
          // we will copy its properties to the value object
          Object.assign(primitiveValue, inlineResult[siblingName]);
        }
        valuesForName.push(primitiveValue);
      }
    }
  }

  /**
   * Assign processed values to the result object
   * @param {Object} result - Result object to modify
   * @param {Object} child - Child element definition
   * @param {Array} values - Processed values
   * @param {Array} children - All children definitions
   * @param {Object} environment - Environment
   */
  function assignValuesToResult(result, child, values, children, environment) {
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
        assignNonPrimitiveValue(result, finalValue, child, children, environment);
      } else {
        assignPrimitiveValue(result, finalValue, child);
      }
    }
  }

  /**
   * Assign non-primitive values to result
   * @param {Object} result - Result object
   * @param {Object} finalValue - Final processed value
   * @param {Object} child - Child element definition
   * @param {Array} children - All children definitions
   * @param {Object} environment - Environment
   */
  function assignNonPrimitiveValue(result, finalValue, child, children, environment) {
    // if it's not a fhir primitive, we can assign the value directly to the key
    // if the element has max 1, take last value only
    if (child.max === '1' && !child.__isArray) {
      finalValue.value = finalValue.value[finalValue.value.length - 1];
    } else if (child.max === '1' && child.__isArray) {
      finalValue.value = [finalValue.value[finalValue.value.length - 1]];
    }

    if (typeof finalValue.value !== 'undefined' && (typeof finalValue.value === 'boolean' || boolize(finalValue.value))) {
      // Flatten any FHIR primitive values within complex type objects before assignment
      let valueToAssign = finalValue.value;
      if (finalValue.kind === 'complex-type' || finalValue.kind === 'resource') {
        valueToAssign = flattenComplexTypeValue(valueToAssign, finalValue.name, children, environment);
      }
      result[finalValue.name] = valueToAssign;
    }
  }

  /**
   * Assign primitive values to result (handles both value and sibling properties)
   * @param {Object} result - Result object
   * @param {Object} finalValue - Final processed value
   * @param {Object} child - Child element definition
   */
  function assignPrimitiveValue(result, finalValue, child) {
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
    // Check if we have actual primitive values (not just auto-generated nulls)
    const hasActualPrimitiveValues = primitiveValues && (
      !Array.isArray(primitiveValues) ||
      (primitiveValues.length > 0 && !primitiveValues.every(v => v === null))
    );

    if (hasActualPrimitiveValues) {
      result[finalValue.name] = primitiveValues;
    }

    // Remove trailing nulls from properties array to avoid unnecessary sibling array entries
    if (Array.isArray(properties)) {
      while (properties.length > 0 && properties[properties.length - 1] === null) {
        properties.pop();
      }
    }

    // if properties exist, assign the sibling array
    // NOTE: Only assign sibling array if there are actual properties (not all nulls)
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

      // When sibling array exists but no explicit primitive values exist,
      // only create primitive array if we have mixed values (some nulls, some actual values)
      if (!result[finalValue.name] && Array.isArray(properties) && hasActualPrimitiveValues) {
        // Create primitive array with nulls to match sibling array length
        result[finalValue.name] = new Array(properties.length).fill(null);
      }
    }
  }

  /**
   * Flatten complex type values
   * @param {*} valueToAssign - Value to flatten
   * @param {string} elementName - Element name
   * @param {Array} children - Children definitions
   * @param {Object} environment - Environment
   * @returns {*} Flattened value
   */
  function flattenComplexTypeValue(valueToAssign, elementName, children, environment) {
    if (Array.isArray(valueToAssign)) {
      return valueToAssign.map(item => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          // Get the children for this specific complex type
          const elementDef = children.find(c => c.__name && c.__name.includes(elementName));
          if (elementDef && elementDef.type && elementDef.type[0] && elementDef.type[0].code) {
            try {
              const typeChildren = getFhirTypeChildren(environment, elementDef.type[0].code);
              return flattenPrimitiveValues(item, typeChildren, environment);
            } catch (error) {
              // Fallback to current children if type children can't be retrieved
              return flattenPrimitiveValues(item, children, environment);
            }
          }
        }
        return item;
      });
    } else if (valueToAssign && typeof valueToAssign === 'object') {
      // Get the children for this specific complex type
      const elementDef = children.find(c => c.__name && c.__name.includes(elementName));
      if (elementDef && elementDef.type && elementDef.type[0] && elementDef.type[0].code) {
        try {
          const typeChildren = getFhirTypeChildren(environment, elementDef.type[0].code);
          return flattenPrimitiveValues(valueToAssign, typeChildren, environment);
        } catch (error) {
          // Fallback to current children if type children can't be retrieved
          return flattenPrimitiveValues(valueToAssign, children, environment);
        }
      }
    }
    return valueToAssign;
  }

  /**
   * Process slices by appending them to their parent elements
   * @param {Object} result - Result object to modify
   * @param {Array} children - Children definitions
   * @param {Object} environment - Environment
   */
  function processSlices(result, children, environment) {
    // append slices into their parent element
    // we will do this by looping through the keys of result, and if any of them has a ':' suffix,
    // we will append it to the parent element with the same name (without the sliceName)
    for (const key of Object.keys(result)) {
      const colonIndex = key.indexOf(':');
      if (colonIndex !== -1) {
        const parentKey = key.slice(0, colonIndex);
        let sliceValue = result[key];

        // Get the element definition for the parent to determine the type
        const parentElementDef = children.find(c => c.__name && c.__name.includes(parentKey));
        let typeChildren = children; // fallback

        if (parentElementDef && parentElementDef.type && parentElementDef.type[0] && parentElementDef.type[0].code) {
          try {
            typeChildren = getFhirTypeChildren(environment, parentElementDef.type[0].code);
          } catch (error) {
            // Use fallback children
          }
        }

        // Flatten primitive values in slice results before appending
        if (sliceValue && typeof sliceValue === 'object' && !Array.isArray(sliceValue)) {
          sliceValue = flattenPrimitiveValues(sliceValue, typeChildren, environment);
        } else if (Array.isArray(sliceValue)) {
          sliceValue = sliceValue.map(item => {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              return flattenPrimitiveValues(item, typeChildren, environment);
            }
            return item;
          });
        }

        result[parentKey] = fn.append(result[parentKey], sliceValue);
        // delete the slice key from the result
        delete result[key];
      }
    }
  }

  /**
   * Validate that all mandatory slices are present and auto-generate missing ones
   * @param {Object} result - Result object
   * @param {Array} children - Children definitions
   * @param {Object} expr - Original expression
   * @param {Object} environment - Environment
   * @param {Array} collectedVirtualRuleErrors - Array to collect virtual rule errors
   */
  async function validateAndGenerateMandatorySlices(result, children, expr, environment) {

    // If result is null/undefined, no slice validation needed
    if (!result || typeof result !== 'object') {
      return;
    }

    // Find all sliced elements that are present in result
    const presentSliceElements = {};
    for (const key of Object.keys(result)) {
      const colonIndex = key.indexOf(':');
      if (colonIndex !== -1) {
        const parentKey = key.slice(0, colonIndex);
        const sliceName = key.slice(colonIndex + 1);
        if (!presentSliceElements[parentKey]) {
          presentSliceElements[parentKey] = new Set();
        }
        presentSliceElements[parentKey].add(sliceName);
      }
    }

    // For each parent element that has slices, check for missing mandatory slices
    for (const [parentKey, presentSlices] of Object.entries(presentSliceElements)) {
      // Find all slice definitions for this parent element
      const allSliceElements = children.filter(child =>
        child.__name &&
        child.__name.includes(parentKey) &&
        child.sliceName
      );

      // Check for missing mandatory slices
      for (const sliceElement of allSliceElements) {
        if (sliceElement.min > 0 && !presentSlices.has(sliceElement.sliceName)) {

          // Try to auto-generate the missing mandatory slice using virtual rule
          try {
            const autoValue = await evaluate({
              type: 'unary',
              value: '[',
              isFlashRule: true,
              isVirtualRule: true,
              expressions: [],
              instanceof: expr.instanceof,
              flashPathRefKey: sliceElement.__flashPathRefKey,
              position: expr.position,
              start: expr.start,
              line: expr.line
            }, undefined, environment);

            if (typeof autoValue !== 'undefined') {
              // Add the auto-generated slice to the result
              result[autoValue.key] = autoValue.value;
            }
          } catch (error) {
            // Ignore the error
          }
          // if result is still missing the mandatory slice, throw an error
          if (!result[`${parentKey}:${sliceElement.sliceName}`]) {
            // throw F3012 with sliceName and fhir parent
            throw {
              code: "F3012",
              stack: (new Error()).stack,
              position: expr.position,
              start: expr.start,
              line: expr.line,
              fhirParent: (expr.flashPathRefKey || expr.instanceof).replace('::', '/'),
              fhirElement: parentKey,
              sliceName: sliceElement.sliceName
            };
          }
        }
      }
    }
  }

  /**
   * Inject meta.profile for profiled resources
   * @param {Object} result - Result object to modify
   * @param {string} resourceType - Resource type
   * @param {string} profileUrl - Profile URL
   * @returns {Object} Modified result object
   */
  function injectMetaProfile(result, resourceType, profileUrl) {
    // inject meta.profile if this is a profiled resource and it isn't already set
    if (profileUrl) {
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
    }
    return result;
  }

  /**
   * Validate mandatory children in flash result
   * @param {Object} result - Result object
   * @param {Array} children - Children definitions
   * @param {Object} expr - Original expression
   */
  function validateMandatoryChildren(result, children, expr) {
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
        // if this is an array element and has a single possible name, it may have slices that satisfy the requirement.
        // so before we throw on missing mandatory child, we will check if any of the keys in the result start with name[0]:
        const isArrayElement = child.__isArray && child.__name.length === 1;
        if (isArrayElement) {
          const arrayName = child.__name[0];
          const hasSlice = Object.keys(result).some(key => key.startsWith(`${arrayName}:`));
          if (hasSlice) {
            continue; // skip this child, slices satisfy the requirement
          }
        }
        throw {
          code: "F3002",
          stack: (new Error()).stack,
          position: expr.position,
          start: expr.start,
          line: expr.line,
          fhirParent: (expr.flashPathRefKey || expr.instanceof).replace('::', '/'),
          fhirElement: child.__flashPathRefKey.split('::')[1],
        };
      }
    }
  }

  /**
   * All FLASH blocks and rules evaluation is funneled through this function.
   * It evaluates the specialized unary operator AST node and returns the result.
   * The inline expression and any rules/sub-rules are evaluated and applied to the output.
   * Expressions in between sub-rules (variable assignments) are evaluated but their results are discarded.
   * If the element is a system primitive than result is just the inline expression.
   * All other element kinds return objects, where FHIR primitives have their inline value assigned to `value`.
   * @async
   * @param {Object} expr - Flash expression to evaluate
   * @param {*} input - Input data
   * @param {Object} environment - Environment with FHIR definitions
   * @returns {Promise<*>} Evaluated flash result
   */
  async function evaluateFlash(expr, input, environment) {

    // Initialize context and check for fixed values
    const context = initializeFlashContext(expr, environment);

    if (context.fixedValue) {
      // when evaluating a rule with a fixed value, we just return the fixed value
      // no processing of sub-expressions or inline expressions is relevant
      // NOTE: at this stage, fhir primitives are still objects with a `value` key and possibly other properties
      return context.fixedValue;
    }

    const { kind, children, resourceType, profileUrl, patternValue } = context;

    // Process all expressions (inline + sub-rules)
    const {
      inlineResult: rawInlineResult, // we use rawInlineResult so we can declare inlineResult as var (not const)
      subExpressionResults
    } = await processFlashExpressions(expr, input, environment);

    // declare inlineResult as a variable so we can override it if needed
    let inlineResult = rawInlineResult;

    // at this stage, result could be anything
    let result;
    if (kind === 'system') {
      // system primitive - the result is just the inline expression.
      // there could not be any child expressions (parsing would have failed if there were).
      result = inlineResult;
    } else {
      // result is going to be an object (including fhir primitives - they are still objects at this stage).
      result = {};

      // if it's a fhir primitive, wrap the inline result in an object with a 'value' key.
      // this is because unlike with complex-types (inline assignments are objects),
      // we expect the user to assing the primitive value itself in an inline expression,
      // not the intermediate object representation of a primitive (with the `value` as property).
      if (kind === 'primitive-type' && inlineResult !== undefined) {
        inlineResult = {
          value: inlineResult
        };
      }

      // Fix arrays within inline objects by checking FHIR definitions
      // TODO: this looks strange. arrays are ignored?
      if (inlineResult && typeof inlineResult === 'object' && !Array.isArray(inlineResult)) {
        inlineResult = fixArraysInInlineObject(inlineResult, children, environment);
      }

      // For Resource datatypes with inline results, use the inline result as the base
      if (kind === 'resource' && inlineResult !== undefined) {
        // Validate the Resource inline result first
        const validatedResource = assertResourceInput(inlineResult, expr, environment);
        result = validatedResource; // Use the validated resource directly (don't spread arrays)
      }

      // if it's a resource, set the resourceType as the first key
      if (resourceType) {
        result.resourceType = resourceType;
      }

      // now we will loop through the children in-order and assign the result attributes
      for (const child of children) {
        // we skip elements that have max = 0 or no __name
        if (child.max === '0' || !child.__name) {
          continue;
        }

        const childResult = await processChildValues(child, inlineResult, subExpressionResults, expr, environment, patternValue);

        if (childResult.values.length > 0) {
          assignValuesToResult(result, child, childResult.values, children, environment);
        }
      }
    }

    // Track keys before auto-injection for reordering optimization
    if (typeof result === 'object' && result !== null) {
      environment.bind('__keys_before_auto_injection', Object.keys(result));
    }

    // After processing all children, check for missing mandatory slices
    await validateAndGenerateMandatorySlices(result, children, expr, environment);

    // Post-process result
    if (typeof result === 'undefined') {
      result = {};
    } else {
      processSlices(result, children, environment);
      result = injectMetaProfile(result, resourceType, profileUrl);

      // Reorder result keys according to FHIR element definition order
      // This ensures that auto-injected values appear in the correct order
      // Only needed if new keys were added during auto-value injection (slices, meta.profile, etc.)
      // Performance note: this can be disabled by setting __disable_reordering in environment
      if (children && children.length > 0) {
        const disableReordering = environment.lookup('__disable_reordering');
        if (!disableReordering) {
          // Check if we actually need reordering by comparing key count before/after auto-injection
          const keysBeforeAutoInjection = environment.lookup('__keys_before_auto_injection');
          const currentKeys = Object.keys(result);

          // Only reorder if new keys were added or if we don't have the before-state tracked
          const needsReordering = !keysBeforeAutoInjection ||
                                  currentKeys.length !== keysBeforeAutoInjection.length ||
                                  !keysBeforeAutoInjection.every(key => currentKeys.includes(key));

          if (needsReordering) {
            result = reorderResultByFhirDefinition(result, children);
          }
        }
      }
    }

    validateMandatoryChildren(result, children, expr);

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

  // FHIR helper functions (these will be imported from the main module)
  /**
   * Get FHIR definitions dictionary from environment
   * @param {Object} environment - Environment with FHIR definitions
   * @returns {Object} FHIR definitions dictionary
   */
  function getFhirDefinitionsDictinary(environment) {
    return environment.lookup(Symbol.for('fumifier.__resolvedDefinitions'));
  }

  /**
   * Get compiled FHIR regex tester from environment
   * @param {Object} environment - Environment with compiled regexes
   * @param {string} regexStr - Regex string to compile
   * @returns {RegExp} Compiled regex
   */
  function getFhirRegexTester(environment, regexStr) {
    var compiled = environment.lookup(Symbol.for('fumifier.__compiledFhirRegex_GET'))(regexStr);
    if (compiled) {
      return compiled;
    }
    compiled = environment.lookup(Symbol.for('fumifier.__compiledFhirRegex_SET'))(regexStr);
    return compiled;
  }

  /**
   * Get FHIR element definition by reference key
   * @param {Object} environment - Environment with FHIR definitions
   * @param {string} referenceKey - Reference key for element
   * @returns {Object} Element definition
   */
  function getFhirElementDefinition(environment, referenceKey) {
    const definitions = getFhirDefinitionsDictinary(environment);
    if (definitions && definitions.elementDefinitions) {
      return definitions.elementDefinitions[referenceKey];
    }
    return undefined;
  }

  /**
   * Get FHIR type metadata
   * @param {Object} environment - Environment with FHIR definitions
   * @param {string} instanceOf - Type identifier
   * @returns {Object} Type metadata
   */
  function getFhirTypeMeta(environment, instanceOf) {
    const definitions = getFhirDefinitionsDictinary(environment);
    if (definitions && definitions.typeMeta) {
      return definitions.typeMeta[instanceOf];
    }
    return undefined;
  }

  /**
   * Get FHIR type children definitions
   * @param {Object} environment - Environment with FHIR definitions
   * @param {string} instanceOf - Type identifier
   * @returns {Array} Type children definitions
   */
  function getFhirTypeChildren(environment, instanceOf) {
    const definitions = getFhirDefinitionsDictinary(environment);
    if (definitions && definitions.typeChildren) {
      return definitions.typeChildren[instanceOf];
    }
    return undefined;
  }

  /**
   * Reorder object keys according to FHIR element definition order
   * @param {Object} result - Result object to reorder
   * @param {Array} children - FHIR children definitions in order
   * @param {Object} environment - Environment
   * @returns {Object} Reordered result object
   */
  function reorderResultByFhirDefinition(result, children) {
    if (!result || typeof result !== 'object' || Array.isArray(result) || !children || children.length === 0) {
      return result;
    }

    const existingKeys = Object.keys(result);

    // Create a key-to-index map for faster lookups
    const existingKeySet = new Set(existingKeys);
    const orderedKeys = [];
    const processedKeys = new Set();

    // First, add resourceType if it exists (should always be first)
    if (existingKeySet.has('resourceType')) {
      orderedKeys.push('resourceType');
      processedKeys.add('resourceType');
    }

    // Pre-compute slice keys for faster lookup
    const sliceKeyMap = new Map(); // parentName -> [sliceKey1, sliceKey2, ...]
    for (const key of existingKeys) {
      const colonIndex = key.indexOf(':');
      if (colonIndex !== -1) {
        const parentKey = key.slice(0, colonIndex);
        if (!sliceKeyMap.has(parentKey)) {
          sliceKeyMap.set(parentKey, []);
        }
        sliceKeyMap.get(parentKey).push(key);
      }
    }

    // Then, add keys in the order defined by FHIR children definitions
    for (const child of children) {
      if (!child.__name || child.max === '0') {
        continue;
      }

      // Check all possible names for this child (handles polymorphic elements)
      for (const possibleName of child.__name) {
        // Main element key
        if (existingKeySet.has(possibleName) && !processedKeys.has(possibleName)) {
          orderedKeys.push(possibleName);
          processedKeys.add(possibleName);
        }

        // Slice keys for this element (pre-computed for performance)
        const sliceKeys = sliceKeyMap.get(possibleName);
        if (sliceKeys) {
          for (const sliceKey of sliceKeys) {
            if (!processedKeys.has(sliceKey)) {
              orderedKeys.push(sliceKey);
              processedKeys.add(sliceKey);
            }
          }
        }

        // Primitive sibling keys (e.g., "_elementName")
        const siblingKey = '_' + possibleName;
        if (existingKeySet.has(siblingKey) && !processedKeys.has(siblingKey)) {
          orderedKeys.push(siblingKey);
          processedKeys.add(siblingKey);
        }
      }
    }

    // Finally, add any remaining keys that weren't in the FHIR definition (shouldn't happen normally)
    for (const key of existingKeys) {
      if (!processedKeys.has(key)) {
        orderedKeys.push(key);
      }
    }

    // Performance optimization: only recreate object if order actually changed
    let orderChanged = false;
    if (existingKeys.length === orderedKeys.length) {
      for (let i = 0; i < existingKeys.length; i++) {
        if (existingKeys[i] !== orderedKeys[i]) {
          orderChanged = true;
          break;
        }
      }
    } else {
      /* c8 ignore next 2 */
      orderChanged = true;
    }

    if (!orderChanged) {
      return result;
    }

    // Create new object with reordered keys
    const reorderedResult = {};
    for (const key of orderedKeys) {
      reorderedResult[key] = result[key];
    }

    return reorderedResult;
  }

  /**
   * Get FHIR element children definitions
   * @param {Object} environment - Environment with FHIR definitions
   * @param {string} expr - expression node, containing reference key for element
   * @returns {Array} Element children definitions
   */
  function getFhirElementChildren(environment, expr) {
    const flashPathRefKey = expr.flashPathRefKey;
    const definitions = getFhirDefinitionsDictinary(environment);
    let children;
    if (definitions && definitions.elementChildren) {
      children = definitions.elementChildren[flashPathRefKey];
      return children;
    }
    /* c8 ignore next 9 */
    throw {
      code: "F3013",
      stack: (new Error()).stack,
      position: expr.position,
      start: expr.start,
      line: expr.line,
      instanceOf: expr.instanceof,
      fhirElement: flashPathRefKey
    };
  }

  return {
    evaluateFlash,
    parseSystemPrimitive,
    finalizeFlashRuleResult,
    flattenPrimitiveValues,
    fixArraysInInlineObject,
    reorderResultByFhirDefinition
  };
}

export default createFlashEvaluator;
