/**
 * @module FlashEvaluator
 * @description FLASH (FHIR-specific) evaluation functions for Fumifier
 */

import fn from './utils/functions.js';
import FlashErrorGenerator from './flashEvaluator/FlashErrorGenerator.js';
import SystemPrimitiveValidator from './flashEvaluator/SystemPrimitiveValidator.js';
import ChildValueProcessor from './flashEvaluator/ChildValueProcessor.js';
import VirtualRuleEvaluator from './flashEvaluator/VirtualRuleEvaluator.js';
import MetaProfileInjector from './flashEvaluator/MetaProfileInjector.js';
import ResultProcessor from './flashEvaluator/ResultProcessor.js';
import { createFhirPrimitive, isFhirPrimitive } from './flashEvaluator/FhirPrimitive.js';
import { createFlashRuleResult, createFlashRuleResultArray } from './flashEvaluator/FlashRuleResult.js';
import createPolicy from './utils/policy.js';

// Import utility functions directly since they are simple utilities
const { boolize } = fn;

/**
 * Flash evaluation module that contains all FLASH-specific evaluation logic
 * @param {Function} evaluate - Main evaluate function from fumifier (jsonata)
 * @returns {Object} Flash evaluation functions
 */
function createFlashEvaluator(evaluate) {

  /**
   * Parse and validate system primitive values according to the type's constraints.
   * A system primitive is a type that is referred with a "code" that is a URI starting with `http://hl7.org/fhirpath/System.`.
   * For example, `http://hl7.org/fhirpath/System.String` is the system primitive for strings, found in Resource.id, Extension.url, etc.
   * This function also handles the actual primitive `value` of a FHIR primitive type (e.g. `string.value`, `boolean.value`), which is itself a system primitive.
   * @param {Object} expr - Expression with FHIR context
   * @param {*} input - Input value to parse
   * @param {Object} elementDefinition - FHIR element definition
   * @param {Object} environment - Environment with FHIR definitions
   * @returns {*} Parsed primitive value
   */
  function parseSystemPrimitive(expr, input, elementDefinition, environment) {
    const policy = createPolicy(environment);
    if (Array.isArray(input)) {
      // input is an array, parse each entry and return an array
      return input.map(item => parseSystemPrimitive(expr, item, elementDefinition, environment));
    }

    // Validate input - skip processing if invalid
    const validation = SystemPrimitiveValidator.validateInput(input);
    if (!validation.isValid) {
      return undefined;
    }

    const rootFhirTypeId = expr.instanceof;
    const elementFlashPath = expr.flashPathRefKey.slice(rootFhirTypeId.length + 2); // for error reporting

    // get the fhir type code for the element
    const fhirTypeCode = elementDefinition.__fhirTypeCode;

    if (!fhirTypeCode) {
      /* c8 ignore next 5 */
      throw FlashErrorGenerator.createError("F3007", expr, {
        instanceOf: rootFhirTypeId,
        fhirElement: elementFlashPath
      });
    }

    // Validate that input is a primitive type
    let valueType;
    if (!policy.shouldValidate('F5101')) {
      // Policy says: skip F5101 checks; infer type without throwing
      valueType = fn.type(input);
    } else {
      valueType = SystemPrimitiveValidator.validateType(input, expr, elementFlashPath);
    }

    // Handle date truncation BEFORE regex validation to ensure we validate the correct format
    let processedInput = input;
    if (fhirTypeCode === 'date' && valueType === 'string' && input.length > 10) {
      processedInput = input.slice(0, 10);
    }

    // Validation inhibition for F5110 (regex): when inhibited, skip regex test and conversion
    if (!policy.shouldValidate('F5110')) {
      // Policy says: do not perform this level of tests -> return raw processed input
      return processedInput;
    }

    // Validate against regex constraints if present (using the processed input)
    if (elementDefinition.__regexStr) {
      const regexTester = SystemPrimitiveValidator.getRegexTester(environment, elementDefinition.__regexStr);
      if (regexTester && !regexTester.test(fn.string(processedInput))) {
        const err = FlashErrorGenerator.createError("F5110", expr, {
          value: processedInput,
          regex: elementDefinition.__regexStr,
          fhirElement: elementFlashPath
        });
        if (policy.enforce(err)) {
          throw err;
        }
        // Downgraded: continue with processedInput so the invalid value remains visible
      }
    }

    // Convert to appropriate JSON type (using the processed input)
    return SystemPrimitiveValidator.convertValue(processedInput, fhirTypeCode, valueType);
  }

  /**
   * Ensure a Resource input is an object with a valid resourceType
   * @param {*} input - Input value to validate
   * @param {Object} expr - Expression with position info for errors
   * @param {Object} environment - Environment with policy/diagnostics
   * @returns {*} Validated resource input
   */
  function assertResourceInput(input, expr, environment) {
    const policy = createPolicy(environment);

    // Handle arrays of resources
    if (Array.isArray(input)) {
      return input.map(item => assertResourceInput(item, expr, environment));
    }

    // Input must be an object
    if (!input || typeof input !== 'object') {
      // Inhibition: skip this validation entirely when F5102 is outside validation band
      if (!policy.shouldValidate('F5102')) {
        return input; // inhibited: do not enforce object requirement
      }
      const err = {
        code: "F5102",
        stack: (new Error()).stack,
        position: expr.position,
        start: expr.start,
        line: expr.line,
        fhirParent: expr.instanceof,
        fhirElement: expr.flashPathRefKey.split('::')[1],
        valueType: typeof input
      };
      if (policy.enforce(err)) throw err;
      return input; // downgraded: keep invalid value visible
    }

    // Object must have resourceType attribute
    if (!input.resourceType || typeof input.resourceType !== 'string' || input.resourceType.trim() === '') {
      // Inhibition: skip this validation entirely when F5103 is outside validation band
      if (!policy.shouldValidate('F5103')) {
        return input; // inhibited: do not enforce resourceType requirement
      }
      const err = {
        code: "F5103",
        stack: (new Error()).stack,
        position: expr.position,
        start: expr.start,
        line: expr.line,
        fhirParent: expr.instanceof,
        fhirElement: expr.flashPathRefKey.split('::')[1]
      };
      if (policy.enforce(err)) throw err;
      return input; // downgraded: keep invalid value visible
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

    if (!expr.flashPathRefKey) {
      /* c8 ignore next 2 */
      throw FlashErrorGenerator.createSimpleError("F3000", expr);
    }
    // lookup the definition of the element
    const elementDefinition = getElementDefinition(environment, expr);

    if (!elementDefinition) {
      /* c8 ignore next 2 */
      throw FlashErrorGenerator.createSimpleError("F3003", expr);
    }

    if (
      !(elementDefinition?.__name) || // should have a name array set on the enriched definition
      !Array.isArray(elementDefinition.__name) || // should be an array
      elementDefinition.__name.length > 1 // no more than one option
    ) {
      /* c8 ignore next 2 */
      throw FlashErrorGenerator.createSimpleError("F3005", expr);
    }

    // get the kind of the element
    const kind = elementDefinition.__kind;
    /* c8 ignore next 3 */
    if (!kind) {
      throw FlashErrorGenerator.createSimpleError("F3004", expr);
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
    const result = createFlashRuleResult(groupingKey, kind);

    // if element has a fixed value, use it and return (short circuit)
    // TODO: hypothesis: safe to delete. fixed values are short circuiting earlier in the eval chain
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
        /* c8 ignore next */
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
      result.value = createFhirPrimitive({
        ...input,
        value: evaluated // Assign the evaluated value to the 'value' key (can be undefined)
      });
      validatePrimitiveBinding(result, elementDefinition, expr, environment);
      return result;
    }

    // Handle complex types and Resource datatype.
    // For arrays, we need to create multiple FlashRuleResults.
    if (Array.isArray(input)) {
      // Return an array where each object becomes a separate FlashRuleResult
      return createFlashRuleResultArray(groupingKey, kind, input);
    } else {
      // Single object
      result.value = input;
    }

    return result;
  }

  /**
   * Retrieve resolved ValueSet expansions dictionary from environment
   * @param {Object} environment Execution environment
   * @returns {Object} Map of vsRefKey -> expansion dictionary
   */
  function getResolvedValueSetDict(environment) {
    const defs = getFhirDefinitionsDictinary(environment);
    return defs?.resolvedValueSetExpansions || {};
  }

  /**
   * Test if primitive value exists in any system bucket of expansion dict
   * @param {string} codeVal Primitive code string
   * @param {Object} expansionDict Expansion dictionary { system: { code: concept } }
   * @returns {boolean} True if found
   */
  function valueInExpansionPrimitive(codeVal, expansionDict) {
    if (codeVal === undefined || codeVal === null || codeVal === '') return false;
    for (const sys of Object.keys(expansionDict)) {
      if (expansionDict[sys] && expansionDict[sys][codeVal]) return true;
    }
    return false;
  }

  /**
   * Test if (system, code) pair exists in expansion dict
   * @param {string} system System URI
   * @param {string} code Code string
   * @param {Object} expansionDict Expansion dictionary
   * @returns {boolean} True if pair found
   */
  function valueInExpansionSystemCode(system, code, expansionDict) {
    if (!system || !code) return false;
    const sysDict = expansionDict[system];
    return !!(sysDict && sysDict[code]);
  }

  /**
   * Create structured binding validation error object
   * @param {string} code Error code
   * @param {Object} expr Expression node
   * @param {Object} elementDefinition ElementDefinition providing context
   * @param {Object} inserts Additional message inserts
   * @returns {Object} Error object
   */
  function createBindingError(code, expr, elementDefinition, inserts = {}) {
    return {
      code,
      stack: (new Error()).stack,
      position: expr.position,
      start: expr.start,
      line: expr.line,
      instanceOf: expr.instanceof,
      fhirElement: (expr.flashPathRefKey || '').slice(expr.instanceof.length + 2),
      bindingStrength: elementDefinition.__bindingStrength,
      expansionMode: elementDefinition.__vsExpansionMode,
      ...inserts
    };
  }

  /**
   * Validate a bound FHIR primitive (string|uri|code) against its ValueSet
   * @param {Object} resultObj FlashRuleResult for primitive
   * @param {Object} elementDefinition ElementDefinition
   * @param {Object} expr AST node
   * @param {Object} environment Execution environment
   */
  function validatePrimitiveBinding(resultObj, elementDefinition, expr, environment) {
    if (!elementDefinition.__bindingStrength) return; // no binding
    const strength = elementDefinition.__bindingStrength; // required | extensible
    const policy = createPolicy(environment);
    // Inhibit entire binding validation if outside validation band (performance optimization)
    const representativeCode = strength === 'required' ? 'F5120' : 'F5340';
    if (!policy.shouldValidate(representativeCode)) return;
    const typeCode = elementDefinition.__fhirTypeCode;
    if (!['string','uri','code'].includes(typeCode)) return; // only these primitives
    const valObj = resultObj.value; // FHIR primitive intermediate (object with value key)
    const val = valObj ? valObj.value : undefined;
    const mode = elementDefinition.__vsExpansionMode; // full | error | lazy
    const expansions = getResolvedValueSetDict(environment);
    const expansionDict = elementDefinition.__vsRefKey ? expansions[elementDefinition.__vsRefKey] : undefined;

    const hasValue = !(val === undefined || val === null || val === '');

    const codeMap = {
      required: { full: 'F5120', expansionError: 'F5310', expansionLazy: 'F5311' },
      extensible: { full: 'F5340', expansionError: 'F5330', expansionLazy: 'F5331' }
    };

    if (mode === 'error' || mode === 'lazy') {
      const errCode = mode === 'error' ? codeMap[strength].expansionError : codeMap[strength].expansionLazy;
      // Additional inhibition: if expansion error code itself is outside validation band, skip entirely
      if (!policy.shouldValidate(errCode)) return; // no diagnostic at all
      const err = createBindingError(errCode, expr, elementDefinition, { value: val, elementType: 'primitive' });
      if (policy.enforce(err)) throw err; // ensure throw honored
      return;
    }

    if (strength === 'required') {
      if (!hasValue || !valueInExpansionPrimitive(val, expansionDict || {})) {
        const err = createBindingError(codeMap.required.full, expr, elementDefinition, { value: val });
        if (policy.enforce(err)) throw err;
      }
    } else if (strength === 'extensible') {
      if (hasValue && !valueInExpansionPrimitive(val, expansionDict || {})) {
        const err = createBindingError(codeMap.extensible.full, expr, elementDefinition, { value: val });
        if (policy.enforce(err)) throw err;
      }
    }
  }

  /**
   * Validate complex Coding/Quantity/CodeableConcept binding
   * @param {string} kindCode Element type code (Coding|Quantity|CodeableConcept)
   * @param {Object} valueObj Evaluated value object (intermediate with primitives inside)
   * @param {Object} elementDefinition ElementDefinition
   * @param {Object} expr AST node
   * @param {Object} environment Execution environment
   */
  function validateComplexCodingLike(kindCode, valueObj, elementDefinition, expr, environment) {
    if (!elementDefinition.__bindingStrength) return;
    const strength = elementDefinition.__bindingStrength;
    const policy = createPolicy(environment);
    // Representative codes for inhibition decision use same bands: required -> F5120, extensible -> F5340
    const representativeCode = strength === 'required' ? 'F5120' : 'F5340';
    if (!policy.shouldValidate(representativeCode)) return; // skip entirely
    const mode = elementDefinition.__vsExpansionMode;
    const expansions = getResolvedValueSetDict(environment);
    const expansionDict = elementDefinition.__vsRefKey ? expansions[elementDefinition.__vsRefKey] : undefined;

    const codeMap = {
      Coding: { required: { full: 'F5121' }, extensible: { full: 'F5341' }, elementType: 'Coding' },
      Quantity: { required: { full: 'F5122' }, extensible: { full: 'F5342' }, elementType: 'Quantity' },
      CodeableConcept: { required: { full: 'F5123' }, extensible: { full: 'F5343' }, elementType: 'CodeableConcept' }
    };

    /**
     * Enforce a binding validation issue via policy.
     * @param {string} code Error code
     * @param {Object} inserts Additional inserts for message
     * @returns {void}
     */
    function enforce(code, inserts) {
      const err = createBindingError(code, expr, elementDefinition, inserts);
      if (policy.enforce(err)) throw err; // honor throwLevel
    }

    if (mode === 'error' || mode === 'lazy') {
      let errCode;
      if (mode === 'error') {
        errCode = strength === 'required' ? 'F5310' : 'F5330';
      } else { // lazy
        errCode = strength === 'required' ? 'F5311' : 'F5331';
      }
      if (!policy.shouldValidate(errCode)) return; // skip entirely if inhibited for this specific code
      enforce(errCode, { elementType: codeMap[kindCode].elementType });
      return;
    }

    if (kindCode === 'Coding' || kindCode === 'Quantity') {
      const rawSystem = valueObj?.system;
      const rawCode = valueObj?.code;
      const system = (rawSystem && typeof rawSystem === 'object' && Object.prototype.hasOwnProperty.call(rawSystem, 'value')) ? rawSystem.value : rawSystem;
      const code = (rawCode && typeof rawCode === 'object' && Object.prototype.hasOwnProperty.call(rawCode, 'value')) ? rawCode.value : rawCode;
      const pairValid = system && code && valueInExpansionSystemCode(system, code, expansionDict || {});
      if (strength === 'required') {
        if (!pairValid) enforce(codeMap[kindCode].required.full, { system, code });
      } else if (strength === 'extensible') {
        if (system && code && !pairValid) enforce(codeMap[kindCode].extensible.full, { system, code });
      }
    } else if (kindCode === 'CodeableConcept') {
      const codings = Array.isArray(valueObj?.coding) ? valueObj.coding : [];
      let anyValid = false;
      for (const c of codings) {
        const rawSystem = c?.system;
        const rawCode = c?.code;
        const system = (rawSystem && typeof rawSystem === 'object' && Object.prototype.hasOwnProperty.call(rawSystem, 'value')) ? rawSystem.value : rawSystem;
        const code = (rawCode && typeof rawCode === 'object' && Object.prototype.hasOwnProperty.call(rawCode, 'value')) ? rawCode.value : rawCode;
        if (system && code && valueInExpansionSystemCode(system, code, expansionDict || {})) { anyValid = true; break; }
      }
      if (strength === 'required') {
        if (!anyValid) enforce(codeMap.CodeableConcept.required.full, { codingCount: codings.length });
      } else if (strength === 'extensible') {
        if (codings.length > 0 && !anyValid) enforce(codeMap.CodeableConcept.extensible.full, { codingCount: codings.length });
      }
    }
  }

  /**
   * Initialize FLASH context from expression metadata
   * @param {Object} expr - Flash expression
   * @param {Object} environment - Environment with FHIR definitions
   * @returns {Object} Flash context with kind, children, resourceType, profileUrl
   */
  function initializeFlashContext(expr, environment) {
    const policy = createPolicy(environment);
    let kind;
    let children = [];
    let resourceType;
    let profileUrl;

    if (expr.isFlashBlock) {
      // flash block - use the instanceof to get the structure definition's meta data
      const typeMeta = getTypeMetadata(environment, expr);
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
      children = getTypeChildren(environment, expr);
    } else {
      // flash rule - use the flashPathRefKey to get the element definition
      const def = getElementDefinition(environment, expr);
      // kind will almost laways be a system primitive, primitive-type, or complex-type.
      // kind = "resource" is rare but should be supported (Bundle.entry.resource, DomainResource.contained)
      // TODO: handle inline resources (will probably not have an element definition but a structure definition)
      kind = def.__kind;

      // Forbidden element check (F5131) – apply only if not inhibited by policy
      if (policy.shouldValidate('F5131') && def.max === '0') {
        // forbidden element
        const err = FlashErrorGenerator.createError("F5131", expr, {
          value: expr.flashPathRefKey?.slice(expr.instanceof.length + 2),
          fhirType: def.__fromDefinition
        });
        if (policy.enforce(err)) {
          throw err;
        }
        // downgraded: allow processing to continue; do not suppress the element
      }

      if (def.__fixedValue) {
        // short circuit if the element has a fixed value
        let fixed = def.__fixedValue;
        if (kind === 'primitive-type') {
          if (!isFhirPrimitive(fixed)) {
            fixed = createFhirPrimitive(fixed);
          }
        }
        return {
          kind,
          children,
          resourceType,
          profileUrl,
          fixedValue: createFlashRuleResult(def.__name[0], kind, fixed)
        };
      } else if (kind !== 'system') {
        children = getElementChildren(environment, expr);
        if (def.__patternValue) {
          let pattern = def.__patternValue;
          if (!isFhirPrimitive(pattern)) {
            pattern = createFhirPrimitive(pattern);
          }
          return {
            kind,
            children,
            resourceType,
            profileUrl,
            patternValue: createFlashRuleResult(def.__name[0], kind, pattern)
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
   * Ensure that all mandatory slices are present and auto-generate missing ones
   * @param {Object} result - Result object
   * @param {Array} children - Children definitions
   * @param {Object} expr - Original expression
   * @param {Object} environment - Environment
   * @param {Array} collectedVirtualRuleErrors - Array to collect virtual rule errors
   */
  async function ensureMandatorySlices(result, children, expr, environment) {
    const policy = createPolicy(environment);

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

          // Try to auto-generate the missing mandatory slice using virtual rule, unless inhibited
          let autoValue;
          if (policy.shouldValidate('F5140')) {
            autoValue = await VirtualRuleEvaluator.evaluateVirtualRule(
              evaluate,
              expr,
              sliceElement.__flashPathRefKey,
              environment
            );
          }

          if (typeof autoValue !== 'undefined') {
            // Add the auto-generated slice to the result
            result[autoValue.key] = autoValue.value;
          }

          // If result is still missing the mandatory slice, emit F5140 (policy will handle downgrade/inhibition)
          if (!result[`${parentKey}:${sliceElement.sliceName}`]) {
            const err = FlashErrorGenerator.createFhirContextError("F5140", expr, {
              fhirParent: (expr.flashPathRefKey || expr.instanceof).replace('::', '/'),
              fhirElement: parentKey,
              sliceName: sliceElement.sliceName
            });
            if (policy.enforce(err)) {
              throw err;
            }
            // downgraded/inhibited: continue without auto-creating slice
          }
        }
      }
    }
  }

  /**
   * Validate mandatory children in flash result
   * @param {Object} result - Result object
   * @param {Array} children - Children definitions
   * @param {Object} expr - Original expression
   * @param {Object} environment - Environment with policy/diagnostics
   */
  function validateMandatoryChildren(result, children, expr, environment) {
    const policy = createPolicy(environment);
    // Inhibition: skip this validation entirely when F5130 is outside validation band
    if (!policy.shouldValidate('F5130')) {
      return; // do not perform mandatory-children checks
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

      // TODO: this next part is shown to not be coverred by tests,
      // but we do test slices comprehensively... make sure we are not missing something here...
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
        const err = FlashErrorGenerator.createFhirContextError("F5130", expr, {
          fhirParent: (expr.flashPathRefKey || expr.instanceof).replace('::', '/'),
          fhirElement: child.__flashPathRefKey.split('::')[1]
        });
        if (policy.enforce(err)) {
          throw err;
        }
        // downgraded: continue without throwing
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

    // Process all expressions (inline + sub-rules) - MUST remain sequential for variable binding
    const {
      inlineResult: rawInlineResult,
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
        inlineResult = createFhirPrimitive({value: inlineResult});
      }

      // Handle resourceType attribute for flash rules and blocks
      if (expr.isFlashRule && kind === 'resource' && inlineResult !== undefined) {
        // For inline Resources with inline values, use the inline object as the base and ensure there is a resourceType
        result = assertResourceInput(inlineResult, expr, environment);
      } else if (expr.isFlashBlock && resourceType) {
        // if it's a standalone resource instance, set the resourceType as the first key
        result.resourceType = resourceType;
      }

      // OPTIMIZATION: Process all children in parallel since they are independent
      // Each child processes its own values without dependencies on other children
      const childProcessor = new ChildValueProcessor(environment, evaluate);
      const validChildren = children.filter(child => child.__name);

      const childProcessingPromises = validChildren.map(child =>
        childProcessor.processChild(child, inlineResult, subExpressionResults, expr, patternValue)
      );

      const allChildResults = await Promise.all(childProcessingPromises);

      // Apply results in the original order to maintain FHIR definition ordering
      for (let i = 0; i < validChildren.length; i++) {
        const child = validChildren[i];
        const childResult = allChildResults[i];

        if (childResult.values.length > 0) {
          ResultProcessor.assignValuesToResult(result, child, childResult.values);
        }
      }
    }

    // After processing all children, ensure mandatory slices exist or auto-generate them
    await ensureMandatorySlices(result, children, expr, environment);

    // Post-process result
    if (typeof result === 'undefined') {
      result = {};
    } else {
      ResultProcessor.appendSlices(result);
      if (resourceType && profileUrl) {
        // If this is a profiled resource, inject meta.profile
        result = MetaProfileInjector.injectMetaProfile(result, resourceType, profileUrl);
      }

      // Reorder result keys according to FHIR element definition order
      // This ensures that auto-injected values appear in the correct place and not at the end
      if (children && children.length > 0) {
        result = ResultProcessor.reorderResultByFhirDefinition(result, children);
      }
    }

    validateMandatoryChildren(result, children, expr, environment);

    // Flatten FHIR primitive values in the final result JUST BEFORE returning
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      result = ResultProcessor.flattenPrimitiveValues(result);
    }

    if (expr.isFlashRule) {
      // if it's a flash rule, process and return the result as a flash rule
      result = finalizeFlashRuleResult(expr, result, environment);
      // Perform complex-type binding validation if applicable
      if (result && result.kind === 'complex-type') {
        const elDef = getElementDefinition(environment, expr);
        if (elDef) {
          const typeCode = elDef.__fhirTypeCode;
          if (['Coding','Quantity','CodeableConcept'].includes(typeCode)) {
            validateComplexCodingLike(typeCode, result.value, elDef, expr, environment);
          }
        }
      }
    }

    // flashblock result finalization
    if (expr.isFlashBlock) {
      if (Object.keys(result).length === 0 || (Object.keys(result).length === 1 && result.resourceType)) {
        // if the result is empty or has only resourceType, return undefined
        result = undefined;
      } else if (result && typeof result === 'object' && result.resourceType === 'Bundle' && result.type === 'transaction') {
        // if the result is a Bundle resource with type === 'transaction', inject fullUrl to each entry
        result = ResultProcessor.injectBundleFullUrls(result);
      }
    }

    return result;
  }

  /**
   * Get FHIR definitions dictionary from environment
   * @param {Object} environment - Environment with FHIR definitions
   * @returns {Object} FHIR definitions dictionary
   */
  function getFhirDefinitionsDictinary(environment) {
    return environment.lookup(Symbol.for('fumifier.__resolvedDefinitions'));
  }

  /**
   * Get FHIR element definition by reference key
   * @param {Object} environment - Environment with FHIR definitions
   * @param {Object} expr - Expression node, containing reference key for element
   * @returns {Object} Element definition
   */
  function getElementDefinition(environment, expr) {
    const definitions = getFhirDefinitionsDictinary(environment);
    if (definitions && definitions.elementDefinitions && expr && expr.flashPathRefKey) {
      return definitions.elementDefinitions[expr.flashPathRefKey];
    }
    /* c8 ignore next */
    return undefined;
  }

  /**
   * Get FHIR type metadata
   * @param {Object} environment - Environment with FHIR definitions
   * @param {Object} expr - Expression node, containing type information in `instanceof`
   * @returns {Object} Type metadata
   */
  function getTypeMetadata(environment, expr) {
    const definitions = getFhirDefinitionsDictinary(environment);
    if (definitions && definitions.typeMeta && expr && expr.instanceof) {
      return definitions.typeMeta[expr.instanceof];
    }
    /* c8 ignore next */
    return undefined;
  }

  /**
   * Get FHIR type children definitions
   * @param {Object} environment - Environment with FHIR definitions
   * @param {Object} expr - Expression node, containing type information in `instanceof`
   * @returns {Array} Type children definitions
   */
  function getTypeChildren(environment, expr) {
    const definitions = getFhirDefinitionsDictinary(environment);
    if (definitions && definitions.typeChildren && expr && expr.instanceof) {
      return definitions.typeChildren[expr.instanceof];
    }
    /* c8 ignore next */
    return undefined;
  }

  /**
   * Get FHIR element children definitions
   * @param {Object} environment - Environment with FHIR definitions
   * @param {string} expr - expression node, containing reference key for element
   * @returns {Array} Element children definitions
   */
  function getElementChildren(environment, expr) {
    const flashPathRefKey = expr.flashPathRefKey;
    const definitions = getFhirDefinitionsDictinary(environment);
    let children;
    if (definitions && definitions.elementChildren) {
      children = definitions.elementChildren[flashPathRefKey];
      return children;
    }
    /* c8 ignore next 4 */
    throw FlashErrorGenerator.createError("F3013", expr, {
      instanceOf: expr.instanceof,
      fhirElement: flashPathRefKey
    });
  }

  return evaluateFlash;
}

export default createFlashEvaluator;
