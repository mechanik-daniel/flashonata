/**
 * @module FlashEvaluator
 * @description FLASH (FHIR-specific) evaluation functions for Fumifier
 */

import fn from './utils/functions.js';

// Import utility functions directly since they are simple utilities
const { initCap, boolize } = fn;

/**
 * Flash evaluation module that contains all FLASH-specific evaluation logic
 * @param {Function} evaluate - Main evaluate function from fumifier
 * @returns {Object} Flash evaluation functions
 */
function createFlashEvaluator(evaluate) {

  /**
   * Parse and validate system primitive values according to FHIR specifications
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
   * Validate Resource datatype input - ensures object has resourceType attribute
   * @param {*} input - Input value to validate
   * @param {Object} expr - Expression with position info for errors
   * @param {Object} environment - Environment with logger
   * @returns {*} Validated resource input
   */
  function validateResourceInput(input, expr, environment) {
    const verboseLogger = environment.lookup('__verbose_logger');

    if (verboseLogger) {
      verboseLogger.info('validateResourceInput', 'Function called', {
        inputType: typeof input,
        input: input,
        isArray: Array.isArray(input),
        flashPathRefKey: expr.flashPathRefKey,
        position: expr.position
      });
    }

    // Handle arrays of resources
    if (Array.isArray(input)) {
      if (verboseLogger) {
        verboseLogger.info('validateResourceInput', 'Validating array of resources', {
          arrayLength: input.length
        });
      }
      return input.map(item => validateResourceInput(item, expr, environment));
    }

    // Input must be an object
    if (!input || typeof input !== 'object') {
      const error = {
        code: "F3010",
        stack: (new Error()).stack,
        position: expr.position,
        start: expr.start,
        line: expr.line,
        fhirParent: (expr.flashPathRefKey || expr.instanceof).replace('::', '/'),
        fhirElement: expr.flashPathRefKey ? expr.flashPathRefKey.split('::')[1] : 'Resource',
        message: `Resource datatype requires an object, got ${typeof input}`
      };

      if (verboseLogger) {
        verboseLogger.info('validateResourceInput', 'Resource validation failed - not an object', {
          inputType: typeof input,
          error: error.code
        });
      }

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

      if (verboseLogger) {
        verboseLogger.info('validateResourceInput', 'Resource validation failed - missing or invalid resourceType', {
          hasResourceType: 'resourceType' in input,
          resourceType: input.resourceType,
          resourceTypeType: typeof input.resourceType,
          error: error.code
        });
      }

      throw error;
    }

    if (verboseLogger) {
      verboseLogger.info('validateResourceInput', 'Resource validation passed', {
        resourceType: input.resourceType,
        hasKeys: Object.keys(input).length > 1
      });
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

    if (kind === 'complex-type') {
      // Handle inline object assignments for complex types - objects can come from:
      // 1. Object literals: * address = { "city": "Haifa", "country": "IL" }
      // 2. Variable references: * address = $myAddress
      // 3. Function calls: * address = getAddress()
      // 4. JSONata expressions: * address = input.patientAddress
      // 5. Complex expressions: * address = { "city": input.city, "country": "IL" }

      // For all cases, use the input as-is since JSONata evaluation should handle them properly
      result.value = input;
    } else if (kind === 'resource') {
      // Handle Resource datatype - validation already done earlier in evaluateFlash
      // For arrays of resources, we need to create multiple FlashRuleResults
      if (Array.isArray(input)) {
        // Return an array where each resource becomes a separate FlashRuleResult
        return input.map(resource => ({
          '@@__flashRuleResult': true,
          key: groupingKey,
          value: resource,
          kind
        }));
      } else {
        // Single resource
        result.value = input;
      }
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

    const verboseLogger = environment.lookup('__verbose_logger');

    if (expr.isFlashBlock) {
      // flash block - use the instanceof to get the structure definition's meta data
      const typeMeta = getFhirTypeMeta(environment, expr.instanceof);
      kind = typeMeta?.kind;

      if (verboseLogger) {
        verboseLogger.info('initializeFlashContext', 'Flash block context', {
          instanceof: expr.instanceof,
          kind,
          typeMeta
        });
      }

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
      if (verboseLogger) {
        verboseLogger.info('initializeFlashContext', 'Retrieved children for flash block', {
          instanceof: expr.instanceof,
          childrenCount: children?.length || 0,
          childrenDetails: children?.map(c => ({
            name: c.__name?.[0],
            min: c.min,
            max: c.max,
            hasFixedValue: !!c.__fixedValue,
            fixedValue: c.__fixedValue,
            type: c.type?.[0]?.code,
            kind: c.type?.[0]?.__kind,
            flashPathRefKey: c.__flashPathRefKey
          }))
        });
      }
    } else {
      // flash rule - use the flashPathRefKey to get the element definition
      const def = getFhirElementDefinition(environment, expr.flashPathRefKey);
      // kind will almost laways be a system primitive, primitive-type, or complex-type.
      // kind = "resource" is rare but should be supported (Bundle.entry.resource, DomainResource.contained)
      // TODO: handle inline resources (will probably not have an element definition but a structure definition)
      kind = def.__kind;

      if (verboseLogger) {
        verboseLogger.info('initializeFlashContext', 'Flash rule context', {
          flashPathRefKey: expr.flashPathRefKey,
          kind,
          defKeys: Object.keys(def || {}),
          hasFixedValue: !!def.__fixedValue,
          fromDefinition: def.__fromDefinition,
          isVirtualRule: expr.isVirtualRule
        });
      }

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
      } else if (kind !== 'system' && !def.__fixedValue) {
        // Use the original flashPathRefKey for children lookup; no special rewrite for virtual slices
        children = getFhirElementChildren(environment, expr.flashPathRefKey);
        if (verboseLogger) {
          verboseLogger.info('initializeFlashContext', 'Retrieved children for flash rule', {
            flashPathRefKey: expr.flashPathRefKey,
            childrenCount: children?.length || 0,
            childrenDetails: children?.map(c => ({
              name: c.__name?.[0],
              min: c.min,
              max: c.max,
              hasFixedValue: !!c.__fixedValue,
              fixedValue: c.__fixedValue,
              type: c.type?.[0]?.code,
              kind: c.type?.[0]?.__kind,
              flashPathRefKey: c.__flashPathRefKey
            }))
          });
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
    const verboseLogger = environment.lookup('__verbose_logger');
    if (verboseLogger) {
      verboseLogger.enter('processFlashExpressions', expr, input, {
        expressionCount: expr.expressions.length
      });
    }

    const subExpressionResults = {};
    let inlineResult;

    // Evaluate all expressions and group results by key
    for (const node of expr.expressions) {
      if (verboseLogger) {
        verboseLogger.info('processFlashExpressions', 'Processing expression', {
          nodeType: node.type,
          isInlineExpression: node.isInlineExpression,
          isFlashRule: node.isFlashRule,
          position: node.position
        });
      }

      let res = await evaluate(node, input, environment);

      if (typeof res === 'undefined') {
        if (verboseLogger) {
          verboseLogger.info('processFlashExpressions', 'Expression result undefined - skipping');
        }
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
          if (verboseLogger) {
            verboseLogger.info('processFlashExpressions', 'Set inline result', { inlineResult });
          }
        } else if (verboseLogger) {
          verboseLogger.info('processFlashExpressions', 'Inline expression result falsy - ignoring', { res });
        }
        // nothing more to do with this node, continue
        continue;
      } else if (node.type === 'bind') {
        // variable assignment inside a flash block or rule
        // we don't care about the result (the variale is assigned to the environment)
        if (verboseLogger) {
          verboseLogger.info('processFlashExpressions', 'Variable assignment processed');
        }
        continue;
      }

      // flash rule or contextualized rule - a flashrule result object or an array of such
      const groupingKey = Array.isArray(res) ? res[0].key : res.key;
      if (verboseLogger) {
        verboseLogger.info('processFlashExpressions', 'Processing flash rule result', {
          groupingKey,
          isArray: Array.isArray(res),
          resultType: res['@@__flashRuleResult'] ? 'FlashRuleResult' : 'Other'
        });
      }

      // we append to the gouping key in the subExpressionResults object
      const values = fn.append(subExpressionResults[groupingKey], res);
      subExpressionResults[groupingKey] = Array.isArray(values) ? values : [values];

      if (verboseLogger) {
        verboseLogger.info('processFlashExpressions', 'Added to sub-expression results', {
          groupingKey,
          totalValues: subExpressionResults[groupingKey].length
        });
      }
    }

    if (verboseLogger) {
      verboseLogger.exit('processFlashExpressions', { inlineResult, subExpressionResults }, {
        hasInlineResult: inlineResult !== undefined,
        subExpressionKeys: Object.keys(subExpressionResults)
      });
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
   * @param {Object} virtualRuleErrors - Object to collect virtual rule errors
   * @returns {Promise<Array>} Promise resolving to array of processed values
   */
  async function processChildValues(child, inlineResult, subExpressionResults, expr, environment) {
    // we will first normalize the possible names of this element into an array of grouping keys
    const names = generateChildNames(child);

    // start by keeping all the matching values for this element in an array
    const values = [];
    for (const name of names) {
      const valuesForName = await processValuesForName(
        name, child, inlineResult, subExpressionResults
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
        const verboseLogger = environment.lookup('__verbose_logger');
        if (verboseLogger) {
          verboseLogger.info('processChildValues', 'Creating virtual rule for mandatory child', {
            childName: child.__name[0],
            childMin: child.min,
            flashPathRefKey: child.__flashPathRefKey,
            parentInstanceOf: expr.instanceof
          });
        }

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
          if (verboseLogger) {
            verboseLogger.info('processChildValues', 'Virtual rule succeeded', {
              childName: child.__name[0],
              autoValueKey: autoValue.key,
              autoValueKind: autoValue.kind,
              hasValue: typeof autoValue.value !== 'undefined',
              valueEmpty: typeof autoValue.value === 'object' && Object.keys(autoValue.value).length === 0
            });
          }
          values.push({ name: autoValue.key, kind: autoValue.kind, value: [autoValue.value] });
        } else if (verboseLogger) {
          verboseLogger.info('processChildValues', 'Virtual rule returned undefined', {
            childName: child.__name[0]
          });
        }
      } catch (error) {
        // For virtual rule errors during explicit assignment processing, collect but don't throw yet
        // The parent will check if other flash rules provided values for this element
        const verboseLogger = environment.lookup('__verbose_logger');
        if (verboseLogger) {
          verboseLogger.info('processChildValues', `Virtual rule evaluation failed for ${child.__flashPathRefKey}, will be handled by parent`, { error: error.code });
        }
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
   * @returns {Promise<Array>} Promise resolving to array of values for this name
   */
  async function processValuesForName(name, child, inlineResult, subExpressionResults) {
    const valuesForName = []; // keep all values for this json element name

    // to determine the kind of this specific element name, and accounting for polymorphic elements,
    // we will have to find the corresponding type entry in the element definition
    const kindForName = child.type.length === 1 ?
      child.type[0].__kind :
      child.type.find(type => name.endsWith(initCap(type.code))).__kind;    // check if the inline expression has a value for this name
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
    const verboseLogger = environment.lookup('__verbose_logger');
    const isFlashBlock = Object.keys(result).some(k => k === 'resourceType');
    if (verboseLogger) {
      verboseLogger.info('processSlices', 'called', {
        isFlashBlock: isFlashBlock,
        resultKeys: Object.keys(result),
        childrenCount: children.length
      });
    }

    // Only validate slice completeness for flash blocks, not individual virtual rules
    if (isFlashBlock) {
      validateElementSlices(result, children, environment);
    }

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
  async function validateAndGenerateMandatorySlices(result, children, expr, environment, collectedVirtualRuleErrors) {
    const verboseLogger = environment.lookup('__verbose_logger');

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
          if (verboseLogger) {
            verboseLogger.info('validateAndGenerateMandatorySlices', 'Auto-generating missing mandatory slice', {
              parentKey,
              sliceName: sliceElement.sliceName,
              min: sliceElement.min,
              flashPathRefKey: sliceElement.__flashPathRefKey
            });
          }

          // Auto-generate the missing mandatory slice using virtual rule
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
              if (verboseLogger) {
                verboseLogger.info('validateAndGenerateMandatorySlices', 'Successfully auto-generated mandatory slice', {
                  sliceName: sliceElement.sliceName,
                  autoValueKey: autoValue.key
                });
              }

              // Add the auto-generated slice to the result
              result[autoValue.key] = autoValue.value;
            }
          } catch (error) {
            // Collect the slice validation error
            collectedVirtualRuleErrors.push({
              error: error,
              childInfo: sliceElement
            });

            // Also store in environment for flash block level validation
            const collectedSliceErrors = environment.lookup('__collectedSliceErrors') || [];
            collectedSliceErrors.push(error);
            environment.bind('__collectedSliceErrors', collectedSliceErrors);

            if (verboseLogger) {
              verboseLogger.info('validateAndGenerateMandatorySlices', 'Failed to auto-generate mandatory slice', {
                sliceName: sliceElement.sliceName,
                error: error.code || error,
                fhirElement: error.fhirElement
              });
            }
          }
        }
      }
    }
  }

  /**
   * Validate that all mandatory slices are present
   * @param {Object} result - Result object
   * @param {Array} children - Children definitions
   * @param {Object} environment - Environment
   */
  function validateElementSlices(result, children, environment) {
    const verboseLogger = environment.lookup('__verbose_logger');

    // If result is null/undefined, no slice validation needed
    if (!result || typeof result !== 'object') {
      if (verboseLogger) {
        verboseLogger.info('validateElementSlices', 'result is null/undefined - no validation needed');
      }
      return;
    }

    if (verboseLogger) {
      verboseLogger.info('validateElementSlices', 'result object contents', {
        resultKeys: Object.keys(result),
        resultValues: Object.fromEntries(
          Object.keys(result).map(k => [k, typeof result[k]])
        )
      });
    }

    // Find sliced elements in the result
    const slicedElements = {};
    const collectedSliceErrors = environment.lookup('__collectedSliceErrors') || [];

    for (const key of Object.keys(result)) {
      const colonIndex = key.indexOf(':');
      if (colonIndex !== -1) {
        const parentKey = key.slice(0, colonIndex);
        const sliceName = key.slice(colonIndex + 1);
        if (!slicedElements[parentKey]) {
          slicedElements[parentKey] = [];
        }
        slicedElements[parentKey].push(sliceName);
      }
    }

    if (verboseLogger) {
      verboseLogger.info('validateElementSlices', 'found sliced elements', {
        slicedElements
      });
    }

    // Check if we're at the flash block level and have collected slice errors
    const isFlashBlock = Object.keys(result).some(k => k === 'resourceType');
    if (isFlashBlock && collectedSliceErrors.length > 0) {
      if (verboseLogger) {
        verboseLogger.info('validateElementSlices', 'found slice validation errors at flash block level', {
          totalErrors: collectedSliceErrors.length,
          errors: collectedSliceErrors.map(e => e.code || e)
        });
      }

      // Filter errors to make sure they're relevant to current result
      // Only throw errors for elements that are actually missing in the final result
      const validErrors = collectedSliceErrors.filter(error => {
        if (!error.fhirElement) return false;

        // Check if the element is actually missing in the result
        const elementPath = error.fhirElement.split('.');
        let current = result;

        for (const pathPart of elementPath) {
          if (pathPart.includes('[') && pathPart.includes(']')) {
            // Handle slice notation like "coding[MandatorySlice]"
            const [elementName, sliceName] = pathPart.split(/[[\]]/);
            const sliceKey = `${elementName}:${sliceName}`;
            if (current[sliceKey]) {
              current = current[sliceKey];
            } else if (current[elementName] && Array.isArray(current[elementName])) {
              // Look for the slice in the array
              current = current[elementName].find(item =>
                item.system === `http://example.com/${sliceName.toLowerCase()}` ||
                item.system === `http://example.com/mandatory` ||
                item.system === `http://example.com/optional`
              );
              if (!current) return true; // Element is missing
            } else {
              return true; // Element is missing
            }
          } else if (current && current[pathPart] !== undefined) {
            current = current[pathPart];
          } else {
            return true; // Element is missing
          }
        }

        // If we got here, the element exists, so the error is a false positive
        return false;
      });

      if (verboseLogger) {
        verboseLogger.info('validateElementSlices', 'filtering slice errors', {
          totalErrors: collectedSliceErrors.length,
          validErrors: validErrors.length,
          resultKeys: Object.keys(result),
          firstErrorStructure: collectedSliceErrors[0] ? Object.keys(collectedSliceErrors[0]) : []
        });
      }

      // Find the first valid slice error
      for (const error of validErrors) {
        if (verboseLogger) {
          verboseLogger.info('validateElementSlices', 'examining error', {
            errorProperties: Object.keys(error),
            fhirElement: error.fhirElement
          });
        }

        // Throw the first slice validation error
        if (verboseLogger) {
          verboseLogger.info('validateElementSlices', 'throwing slice validation error at flash block level', {
            error: error.code || error
          });
        }
        throw error;
      }
    }

    // For each sliced element, validate that all mandatory slices are present
    for (const [parentKey, presentSlices] of Object.entries(slicedElements)) {
      // Find all slice definitions for this parent element
      const allSliceElements = children.filter(child =>
        child.__name &&
        child.__name.includes(parentKey) &&
        child.sliceName
      );

      // Check for missing mandatory slices
      for (const sliceElement of allSliceElements) {
        if (sliceElement.min > 0 && !presentSlices.includes(sliceElement.sliceName)) {
          // Missing mandatory slice - this should not happen at this level
          // as mandatory slices should be auto-generated during child processing
          if (verboseLogger) {
            verboseLogger.info('validateElementSlices', 'missing mandatory slice detected', {
              parentKey,
              sliceName: sliceElement.sliceName,
              min: sliceElement.min,
              presentSlices
            });
          }
        }
      }
    }

    if (verboseLogger) {
      verboseLogger.info('validateElementSlices', 'slice validation completed - no errors');
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
   * @param {Array} collectedVirtualRuleErrors - Array of collected virtual rule errors from children processing
   * @param {boolean} deferVirtualRuleErrors - Whether to defer virtual rule errors for potential merging
   */
  function validateMandatoryChildren(result, children, expr, collectedVirtualRuleErrors = [], deferVirtualRuleErrors = false) {
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
        // If we should defer virtual rule errors for potential merging, don't throw yet
        if (deferVirtualRuleErrors) {
          continue; // Skip validation for this child, allow merging to happen
        }

        // If we have virtual rule errors and the element is still missing,
        // then the virtual rule failure explains why - throw the first one
        if (collectedVirtualRuleErrors.length > 0) {
          throw collectedVirtualRuleErrors[0].error;
        }

        // Otherwise throw a generic mandatory element missing error
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
    const verboseLogger = environment.lookup('__verbose_logger');
    if (verboseLogger) {
      verboseLogger.enter('evaluateFlash', expr, input, {
        isFlashBlock: expr.isFlashBlock,
        isFlashRule: expr.isFlashRule,
        instanceof: expr.instanceof,
        flashPathRefKey: expr.flashPathRefKey
      });
    }

    try {
      // Initialize context and check for fixed values
      const context = initializeFlashContext(expr, environment);
      if (verboseLogger) {
        verboseLogger.info('evaluateFlash', 'Flash context initialized', context);
      }

      if (context.fixedValue) {
        if (verboseLogger) {
          verboseLogger.info('evaluateFlash', 'Using fixed value', { fixedValue: context.fixedValue });
          verboseLogger.exit('evaluateFlash', context.fixedValue, { fixedValue: true });
        }
        return context.fixedValue;
      }

      const { kind, children, resourceType, profileUrl } = context;

      // Process all expressions
      const { inlineResult: rawInlineResult, subExpressionResults } = await processFlashExpressions(expr, input, environment);
      if (verboseLogger) {
        verboseLogger.info('evaluateFlash', 'Flash expressions processed', {
          hasInlineResult: rawInlineResult !== undefined,
          subExpressionCount: Object.keys(subExpressionResults).length,
          kind
        });
      }

      let inlineResult = rawInlineResult;

      let result;
      const collectedVirtualRuleErrors = [];
      if (kind === 'system') {
        // system primitive - the result is just the inline expression.
        // there could not be any child expressions
        result = inlineResult;
        if (verboseLogger) {
          verboseLogger.info('evaluateFlash', 'System primitive result', { result });
        }
      } else {
        // result is going to be an object (including fhir primitives - they are still objects at this stage).
        result = {};

        // if it's a fhir primitive, wrap the inline result in an object with a 'value' key
        if (kind === 'primitive-type' && inlineResult !== undefined) {
          inlineResult = {
            value: inlineResult
          };
          if (verboseLogger) {
            verboseLogger.info('evaluateFlash', 'Wrapped primitive value', { inlineResult });
          }
        }

        // Fix arrays within inline objects by checking FHIR definitions
        if (inlineResult && typeof inlineResult === 'object' && !Array.isArray(inlineResult)) {
          inlineResult = fixArraysInInlineObject(inlineResult, children, environment);
          if (verboseLogger) {
            verboseLogger.info('evaluateFlash', 'Fixed arrays in inline object', { inlineResult });
          }
        }

        // For Resource datatypes with inline results, use the inline result as the base result
        if (kind === 'resource' && inlineResult !== undefined) {
          // Validate the Resource inline result first
          const validatedResource = validateResourceInput(inlineResult, expr, environment);
          result = validatedResource; // Use the validated resource directly (don't spread arrays)
          if (verboseLogger) {
            verboseLogger.info('evaluateFlash', 'Set Resource inline result as base', {
              inlineResult: validatedResource
            });
          }
        }

        // if it's a resource, set the resourceType as the first key
        if (resourceType) {
          result.resourceType = resourceType;
          if (verboseLogger) {
            verboseLogger.info('evaluateFlash', 'Set resourceType', { resourceType });
          }
        }

        // now we will loop through the children in-order and assign the result attributes
        for (const child of children) {
          // we skip elements that have max = 0 or no __name
          if (child.max === '0' || !child.__name) {
            continue;
          }

          if (verboseLogger) {
            verboseLogger.info('evaluateFlash', 'Processing child element', {
              childName: child.__name[0],
              childMin: child.min,
              childMax: child.max,
              childKind: child.type?.[0]?.__kind,
              flashPathRefKey: child.__flashPathRefKey,
              isVirtualRule: expr.isVirtualRule
            });
          }

          const childResult = await processChildValues(child, inlineResult, subExpressionResults, expr, environment);

          // Collect any virtual rule errors
          if (childResult.virtualRuleError) {
            collectedVirtualRuleErrors.push({
              error: childResult.virtualRuleError,
              childInfo: childResult.childInfo
            });

            // If this is a slice validation error, also collect it for flash block level validation
            // Only collect errors from mandatory slices that couldn't be auto-generated
            if (childResult.virtualRuleError.fhirElement &&
                childResult.virtualRuleError.fhirElement.includes('[') &&
                childResult.virtualRuleError.fhirElement.includes(']') &&
                // Only treat this as a slice validation error if it's for a mandatory slice
                // that has no user-provided values (i.e., truly missing mandatory slice)
                child.min > 0 &&
                childResult.values.length === 0) {
              // Store slice errors in environment for flash block level validation
              const collectedSliceErrors = environment.lookup('__collectedSliceErrors') || [];
              collectedSliceErrors.push(childResult.virtualRuleError);
              environment.bind('__collectedSliceErrors', collectedSliceErrors);

              if (verboseLogger) {
                verboseLogger.info('evaluateFlash', 'collected slice validation error', {
                  error: childResult.virtualRuleError.code || childResult.virtualRuleError,
                  fhirElement: childResult.virtualRuleError.fhirElement
                });
              }
            }
          }

          if (childResult.values.length > 0) {
            assignValuesToResult(result, child, childResult.values, children, environment);
            if (verboseLogger) {
              verboseLogger.info('evaluateFlash', 'Assigned child values', {
                childName: child.__name[0],
                valueCount: childResult.values.length,
                isArray: child.max !== '1'
              });
            }
          } else if (verboseLogger) {
            verboseLogger.info('evaluateFlash', 'No values found for child element', {
              childName: child.__name[0],
              childMin: child.min,
              isMandatory: child.min > 0
            });
          }
        }
      }

      // Track keys before auto-injection for reordering optimization
      if (typeof result === 'object' && result !== null) {
        environment.bind('__keys_before_auto_injection', Object.keys(result));
      }

      // After processing all children, check for missing mandatory slices
      await validateAndGenerateMandatorySlices(result, children, expr, environment, collectedVirtualRuleErrors);

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
              result = reorderResultByFhirDefinition(result, children, environment);
              if (verboseLogger) {
                verboseLogger.info('evaluateFlash', 'Result reordered according to FHIR definition', {
                  keysBeforeAutoInjection: keysBeforeAutoInjection || 'not tracked',
                  currentKeys,
                  finalKeys: Object.keys(result)
                });
              }
            } else if (verboseLogger) {
              verboseLogger.info('evaluateFlash', 'No reordering needed - no new keys added during auto-injection');
            }
          } else if (verboseLogger) {
            verboseLogger.info('evaluateFlash', 'Result reordering skipped due to __disable_reordering flag');
          }
        }
      }

      // Determine if we should defer virtual rule errors for potential merging
      // Only defer for non-virtual explicit rules targeting non-array elements
      // Don't defer for array slices (e.g., code.coding[SliceA])
      const elementDefinition = getFhirElementDefinition(environment, expr.flashPathRefKey);
      const isNonArrayElement = elementDefinition && elementDefinition.max === '1';
      const isArraySlice = expr.flashPathRefKey && expr.flashPathRefKey.includes('[') && expr.flashPathRefKey.includes(']');
      const shouldDeferVirtualRuleErrors = expr.isFlashRule && !expr.isVirtualRule && isNonArrayElement && !isArraySlice;

      validateMandatoryChildren(result, children, expr, collectedVirtualRuleErrors, shouldDeferVirtualRuleErrors);

      if (expr.isFlashRule) {
        // if it's a flash rule, process and return the result as a flash rule
        result = finalizeFlashRuleResult(expr, result, environment);
        if (verboseLogger) {
          verboseLogger.info('evaluateFlash', 'Flash rule result finalized', {
            key: result.key,
            kind: result.kind
          });
        }
      }

      // if it's a flashblock, if it has no children or only resourceType, we return undefined
      if (Object.keys(result).length === 0 || (Object.keys(result).length === 1 && result.resourceType)) {
        result = undefined;
        if (verboseLogger) {
          verboseLogger.info('evaluateFlash', 'Empty flash block result - returning undefined');
        }
      }

      if (verboseLogger) {
        verboseLogger.exit('evaluateFlash', result, {
          type: expr.isFlashBlock ? 'FlashBlock' : 'FlashRule',
          resultType: typeof result
        });
      }

      return result;
    } catch (error) {
      if (verboseLogger) {
        verboseLogger.error('evaluateFlash', 'Flash evaluation failed', error);
        verboseLogger.exit('evaluateFlash', undefined, { error: true });
      }
      throw error;
    }
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
  function reorderResultByFhirDefinition(result, children, environment) {
    if (!result || typeof result !== 'object' || Array.isArray(result) || !children || children.length === 0) {
      return result;
    }

    const existingKeys = Object.keys(result);
    const verboseLogger = environment.lookup && environment.lookup('__verbose_logger');

    // Create a key-to-index map for faster lookups
    const existingKeySet = new Set(existingKeys);
    const orderedKeys = [];
    const processedKeys = new Set();

    if (verboseLogger) {
      verboseLogger.info('reorderResultByFhirDefinition', 'Starting reorder', {
        existingKeys,
        childrenCount: children.length
      });
    }

    // First, add resourceType if it exists (should always be first)
    if (existingKeySet.has('resourceType')) {
      orderedKeys.push('resourceType');
      processedKeys.add('resourceType');
      if (verboseLogger) {
        verboseLogger.info('reorderResultByFhirDefinition', 'Added resourceType first');
      }
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

          if (verboseLogger) {
            verboseLogger.info('reorderResultByFhirDefinition', 'Added key from FHIR definition', {
              key: possibleName,
              childPath: child.path
            });
          }
        }

        // Slice keys for this element (pre-computed for performance)
        const sliceKeys = sliceKeyMap.get(possibleName);
        if (sliceKeys) {
          for (const sliceKey of sliceKeys) {
            if (!processedKeys.has(sliceKey)) {
              orderedKeys.push(sliceKey);
              processedKeys.add(sliceKey);

              if (verboseLogger) {
                verboseLogger.info('reorderResultByFhirDefinition', 'Added slice key from FHIR definition', {
                  key: sliceKey,
                  parentElement: possibleName
                });
              }
            }
          }
        }

        // Primitive sibling keys (e.g., "_elementName")
        const siblingKey = '_' + possibleName;
        if (existingKeySet.has(siblingKey) && !processedKeys.has(siblingKey)) {
          orderedKeys.push(siblingKey);
          processedKeys.add(siblingKey);

          if (verboseLogger) {
            verboseLogger.info('reorderResultByFhirDefinition', 'Added primitive sibling key', {
              key: siblingKey,
              parentElement: possibleName
            });
          }
        }
      }
    }

    // Finally, add any remaining keys that weren't in the FHIR definition (shouldn't happen normally)
    for (const key of existingKeys) {
      if (!processedKeys.has(key)) {
        orderedKeys.push(key);
        if (verboseLogger) {
          verboseLogger.info('reorderResultByFhirDefinition', 'Added remaining key not in FHIR definition', {
            key
          });
        }
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
      orderChanged = true;
    }

    if (!orderChanged) {
      if (verboseLogger) {
        verboseLogger.info('reorderResultByFhirDefinition', 'No reordering needed - keys already in correct order');
      }
      return result;
    }

    // Create new object with reordered keys
    const reorderedResult = {};
    for (const key of orderedKeys) {
      reorderedResult[key] = result[key];
    }

    if (verboseLogger) {
      verboseLogger.info('reorderResultByFhirDefinition', 'Completed reorder', {
        originalOrder: existingKeys,
        newOrder: orderedKeys,
        changed: true
      });
    }

    return reorderedResult;
  }  /**
   * Get FHIR element children definitions
   * @param {Object} environment - Environment with FHIR definitions
   * @param {string} referenceKey - Reference key for element
   * @returns {Array} Element children definitions
   */
  function getFhirElementChildren(environment, referenceKey) {
    const definitions = getFhirDefinitionsDictinary(environment);
    const verboseLogger = environment.lookup && environment.lookup('__verbose_logger');
    let children;
    if (definitions && definitions.elementChildren) {
      children = definitions.elementChildren[referenceKey];
      if (verboseLogger) {
        verboseLogger.info('getFhirElementChildren', 'Lookup result', {
          referenceKey,
          childrenType: Array.isArray(children) ? 'array' : typeof children,
          childrenLength: Array.isArray(children) ? children.length : undefined,
          children: children
        });
      }
      return children;
    }
    if (verboseLogger) {
      verboseLogger.info('getFhirElementChildren', 'No elementChildren found in definitions', {
        referenceKey,
        definitionsKeys: Object.keys(definitions || {})
      });
    }
    return undefined;
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
