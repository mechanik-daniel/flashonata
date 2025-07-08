/* eslint-disable no-console */
/**
 * © Copyright Outburn Ltd. 2022-2024 All Rights Reserved
 *   Project name: Fumifier
 */

import createFhirFetchers from './createFhirFetchers.js';
import extractSystemFhirType from './extractSystemFhirType.js';
import { populateMessage } from './errorCodes.js';

// TODO: move this to a utils file, possibly bind as native function
const initCap = (str) => str.charAt(0).toUpperCase() + str.slice(1);

/**
 * Centralized recoverable error handling helper.
 * @param {Object} base - base error object without position information
 * @param {Object[]} positions - Array of position objects where the error occurred
 * @param {boolean} recover - If true, will continue processing and collect errors instead of throwing them.
 * @param {Object[]} errors - Array to collect errors if recover is true
 * @param {Object} errObj - Error object caught from a failed operation
 * @returns {Object} - Returns an error object with populated message and position information, or throws an error if recover is false.
 */
function handleRecoverableError(base, positions, recover, errors, errObj) {
  if (!recover) {
    var first = {};
    if (Array.isArray(positions) && positions.length > 0) {
      first = positions[0].type === 'flashpath' ? {
        position: positions[0].steps[positions[0].steps.length - 1].position,
        start: positions[0].steps[positions[0].steps.length - 1].start,
        line: positions[0].steps[positions[0].steps.length - 1].line
      } : {
        position: positions[0].position,
        start: positions[0].start,
        line: positions[0].line
      };
    }
    const e = {
      ...base,
      ...first,
      stack: errObj.stack,
      error: errObj.message || String(errObj)
    };
    populateMessage(e);
    throw e;
  }

  if (Array.isArray(positions) && positions.length > 0) {
    positions.forEach(pos => {
      const posMarkers = {
        position: pos.position || pos.steps[pos.steps.length - 1].position,
        start: pos.start || pos.steps[pos.steps.length - 1].start,
        line: pos.line || pos.steps[pos.steps.length - 1].line
      };
      const e = { ...base, ...posMarkers, error: errObj.message || String(errObj) };
      populateMessage(e);
      errors.push(e);
    });
  } else {
    // if no positions are provided, just push the base error with the error message
    const e = { ...base, error: errObj.message || String(errObj) };
    populateMessage(e);
    errors.push(e);
  }
  return { __isError: true, ...base };
}

/**
 * A crucial step for FHIR semantic processing is fetching FHIR type definitions.
 * After parsing a Fumifier expression and running it through processAst,
 * if the expression has FLASH it will be flagged as such and passed here for FHIR definition resolution and processing.
 * @param {Object} expr - Parsed Fumifier expression
 * @param {FhirStructureNavigator} navigator - FHIR structure navigator
 * @param {boolean} recover - If true, will continue processing and collect errors instead of throwing them.
 * @param {Array} errors - Array to collect errors if recover is true
 * @returns {Promise<Object>} Semantically enriched AST
 */
const resolveDefinitions = async function (expr, navigator, recover, errors) {
  if (!expr || !expr.containsFlash) return expr;
  // create utilities for fetching FHIR definitions
  const {
    getTypeMeta,
    getBaseTypeMeta,
    getElement,
    getChildren
  } = createFhirFetchers(navigator);

  // Initialize containers for resolved definitions
  // ============================================================
  // key is the value of InstanceOf:, value is the resolved type metadata
  const resolvedTypeMeta = {};
  // key is the packageId@version + type code, value is the resolved type metadata
  const resolvedBaseTypeMeta = {};
  // key is the value of InstanceOf:, value is the resolved children of the type
  const resolvedTypeChildren = {};
  // key is the InstanceOf: + full FLASH path, value is the resolved ElementDefinition
  const resolvedElementDefinitions = {};
  // key is the InstanceOf: + full FLASH path, value is the resolved children of the element
  const resolvedElementChildren = {};
  // ============================================================

  const sdRefs = expr.structureDefinitionRefs || {};
  const edRefs = expr.elementDefinitionRefs || {};

  // Resolve structureDefinitionRefs concurrently
  await Promise.all(Object.entries(sdRefs).map(async ([instanceofId, positions]) => {
    try {
      resolvedTypeMeta[instanceofId] = await getTypeMeta(instanceofId);
    } catch (e) {
      const baseError = { code: 'F2001', token: 'InstanceOf:', value: instanceofId };
      resolvedTypeMeta[instanceofId] = handleRecoverableError(baseError, positions, recover, errors, e);
    }
  }));

  // Resolve children of structure definitions
  await Promise.all(Object.entries(resolvedTypeMeta).map(async ([instanceofId, meta]) => {
    if (meta.__isError) return; // skip failed ones
    try {
      const children = await getChildren(meta);
      // for each child, assign __isArray and if it has a single type, also the __kind, __fhirTypeCode and __fixedValue properties
      const enriched = children.map(child => {
        assignIsArray(child);
        if (child.type && child.type.length === 1) {
          child.__kind = child.type[0].__kind;
          assignFhirTypeCode(child);
          assignFixedOrPatternValue(child);
        }
        return child;
      });
      resolvedTypeChildren[instanceofId] = enriched;
    } catch (e) {
      const baseError = {
        code: 'F2006',
        token: 'InstanceOf:',
        value: instanceofId,
        fhirType: meta.name || instanceofId
      };
      resolvedTypeChildren[instanceofId] = handleRecoverableError(baseError, sdRefs[instanceofId], recover, errors, e);
    }
  }));

  // Resolve all referenced elementDefinitions
  await Promise.all(Object.entries(edRefs).map(async ([key, flashpathNodes]) => {
    const flash = flashpathNodes[0];
    const baseError = {
      token: '(flashpath)',
      value: flash.fullPath,
      fhirType: flash.instanceOf
    };

    try {
      const meta = resolvedTypeMeta[flash.instanceOf];
      if (!meta || meta.__isError) return;

      baseError.fhirType = meta.name || flash.instanceOf;
      const ed = await getElement(meta, flash.fullPath);

      if (!ed) {
        baseError.code = 'F2002';
        return handleRecoverableError(baseError, flashpathNodes, recover, errors, new Error('Element not found'));
      }

      if (ed.max === '0') {
        // forbidden element
        baseError.code = 'F2005';
        return handleRecoverableError(baseError, flashpathNodes, recover, errors, new Error('Element is forbidden'));
      }

      if (!ed.type || ed.type.length === 0) {
        // no type defined
        baseError.code = 'F2007';
        return handleRecoverableError(baseError, flashpathNodes, recover, errors, new Error('Element has no type defined'));
      }

      if (ed.type?.length > 1) {
        // polymorphic element
        const baseName = ed.path.split('.').pop().replace(/\[x]$/, '');
        const allowed = ed.type.map(t => baseName + initCap(t.code)).join(', ');
        baseError.code = 'F2004';
        baseError.allowedNames = allowed;
        return handleRecoverableError(baseError, flashpathNodes, recover, errors, new Error('Must select one of multiple types'));
      } else {
        // Single type element (confirmed)

        // Set the kind of the element (system, primitive-type, complex-type, resource)
        const kind = ed.type?.[0]?.__kind;
        ed.__kind = kind;
        // Assign __isArray property based on the base.max cardinality
        assignIsArray(ed);
        // Assign the FHIR type code to the element definition
        assignFhirTypeCode(ed);
        // Assign fixed or pattern values to the element definition
        assignFixedOrPatternValue(ed);

        let elementChildren = [];
        if (kind !== 'system') {
          try {
            elementChildren = await getChildren(meta, flash.fullPath);
            if (!elementChildren.length)
              throw new Error('No children found');
            resolvedElementChildren[key] = elementChildren;
          } catch (e) {
            baseError.code = 'F2003';
            return handleRecoverableError(baseError, flashpathNodes, recover, errors, e);
          }
        }

        // TODO: Move this regex extraction into a helper like `extractRegex(ed, kind, elementChildren, meta)`
        let primitiveValueEd;
        if (kind === 'primitive-type') {
          primitiveValueEd = elementChildren.find((c) => c.path.endsWith('.value'));
        } else if (kind === 'system') {
          try {
            // first check if we already fetched this base type in the context of this package
            const key = `${meta.__packageId}@${meta.__packageVersion}::${ed.__fhirTypeCode}`;
            let baseTypeMeta = resolvedBaseTypeMeta[key];
            if (!baseTypeMeta) {
              // if not, fetch the base type meta from the navigator
              baseTypeMeta = await getBaseTypeMeta(ed.__fhirTypeCode, {
                id: meta.__packageId,
                version: meta.__packageVersion
              });
              resolvedBaseTypeMeta[key] = baseTypeMeta;
            }
            // then try to get the primitive value element from the base type
            primitiveValueEd = baseTypeMeta ? await getElement(baseTypeMeta, 'value') : undefined;
          } catch {
          // ignore errors if no primitive value element is found
          }
        }

        if (primitiveValueEd) {
          ed.__regexStr = primitiveValueEd.type?.[0]?.extension?.find(
            (e) => e.url === 'http://hl7.org/fhir/StructureDefinition/regex'
          )?.valueString;
        }

        resolvedElementDefinitions[key] = ed;
      }
    } catch (e) {
      const err = {
        ...e,
        ...baseError
      };
      if (!e.code) err.code = 'F2002';
      handleRecoverableError(err, flashpathNodes, recover, errors, e);
    }
  }));

  // - Recursively fetch, resolve and save mandatory elements' children, to enable fixed[x] and pattern[x] injection at all levels.
  // - This is needed for elements that are not directly referenced in the FLASH block, but expected to be populated automatically.
  const pending = new Set();

  // function to test if an element should be expanded even if not explicitly referenced in the FLASH block
  const shouldExpand = (key, ed) => {
    return (
      ed?.min >= 1 && // mandatory
      ed.__kind && // by the existence of __kind, we know it has a single type so it can be expanded
      !ed.__kind === 'system' && // system primitives can never have children
      !ed.__fixedValue && // if it has a fixed value, we naively use it and don't care about the children definitions
      !Object.prototype.hasOwnProperty.call(resolvedElementChildren, key) // skip if already resolved
    );
  };

  // Step 1: Seed with all unexpanded mandatory elements
  // - 1.a: directly referenced in the FLASH block
  for (const [key, ed] of Object.entries(resolvedElementDefinitions)) {
    if (shouldExpand(key, ed)) {
      pending.add(key);
    }
  }
  // - 1.b: not directly referenced, but mandatory in the root type definition
  for (const [key, childrenEds] of Object.entries(resolvedTypeChildren)) {
    // loop through all children of the root elements
    for (const ed of childrenEds) {
      const childKey = `${key}.${toFlashSegment(ed.id)}`;
      if (shouldExpand(childKey, ed)) {
        pending.add(childKey);
      }
    }
  }
  // - 1.c: mandatory children of any visited element
  for (const [key, childrenEds] of Object.entries(resolvedElementChildren)) {
    // loop through all children of the previously expanded elements
    for (const ed of childrenEds) {
      const childKey = `${key}.${toFlashSegment(ed.id)}`;
      if (shouldExpand(childKey, ed)) {
        pending.add(childKey);
      }
    }
  }

  // Step 2: Expand recursively
  while (pending.size > 0) {
    const keys = Array.from(pending);
    pending.clear();

    await Promise.all(keys.map(async (key) => {

      const [instanceOf, parentFlashpath] = key.split('::');
      const fhirTypeMeta = resolvedTypeMeta[instanceOf];
      if (!fhirTypeMeta || fhirTypeMeta.__isError) return;
      // if children are already resolved (including empty arrays), skip
      if (Object.prototype.hasOwnProperty.call(resolvedElementChildren, key)) return;
      let ed;
      try {
        ed = resolvedElementDefinitions[key];
        if (!ed) {
          ed = await getElement(fhirTypeMeta, key);
          resolvedElementDefinitions[key] = ed;
        }
        const children = await getChildren(fhirTypeMeta, parentFlashpath);

        const enriched = children.map(child => {
          assignIsArray(child);
          if (child.type && child.type.length === 1) {
            child.__kind = child.type[0].__kind;
            assignFhirTypeCode(child);
            assignFixedOrPatternValue(child);
          }
          return child;
        });

        resolvedElementChildren[key] = enriched;

        // Recurse into mandatory children that are not fixed and not yet expanded
        enriched.forEach(child => {
          const childPathSegment = toFlashSegment(child.id);
          const childKey = `${instanceOf}::${parentFlashpath}.${childPathSegment}`;
          if (shouldExpand(childKey, child)) {
          // Cache the definition if not already present
            if (!resolvedElementDefinitions[childKey]) {
              resolvedElementDefinitions[childKey] = child;
            }
            pending.add(childKey);
          }
        });
      } catch (e) {
        const baseError = {
          code: 'F2008',
          value: parentFlashpath,
          fhirType: fhirTypeMeta.name || instanceOf
        };
        resolvedElementChildren[key] = handleRecoverableError(baseError, [], recover, errors, e);
      }
    }));
  }

  expr.resolvedTypeMeta = resolvedTypeMeta;
  expr.resolvedBaseTypeMeta = resolvedBaseTypeMeta;
  expr.resolvedTypeChildren = resolvedTypeChildren;
  expr.resolvedElementDefinitions = resolvedElementDefinitions;
  expr.resolvedElementChildren = resolvedElementChildren;
  return expr;
};

/**
 * Encapsulates the logic to assign fixed or pattern values to an ElementDefinition.
 * The function modifies the ElementDefinition in place by adding
 * `__fixedValue` and `__patternValue` properties based on the element's type and fixed[x]/pattern[x] properties.
 * @param {ElementDefinition} ed - The ElementDefinition to process
 * @param {'system' | 'complex-type' | 'primitive-type'} kind - The kind of the element
 */
function assignFixedOrPatternValue(ed) {
  const kind = ed.__kind;
  // Determine the FHIR type code
  const fhirTypeCode = (ed.base?.path === 'Resource.id') ?
    'id' :
    (kind === 'system' ? extractSystemFhirType(ed.type[0]) : ed.type[0].code);

  const fixedKey = `fixed${initCap(fhirTypeCode)}`;
  const patternKey = `pattern${initCap(fhirTypeCode)}`;

  if (kind === 'primitive-type') {
    // Primitive types may have sibling properties like _fixedCode, _patternCode
    if (ed[fixedKey] || ed[`_${fixedKey}`]) {
      ed.__fixedValue = { value: ed[fixedKey], ...(ed[`_${fixedKey}`] || {}) };
    } else if (ed[patternKey] || ed[`_${patternKey}`]) {
      ed.__patternValue = { value: ed[patternKey], ...(ed[`_${patternKey}`] || {}) };
    }
  } else {
    // For complex and system types: direct values, no sibling _ properties
    ed.__fixedValue = ed[fixedKey];
    ed.__patternValue = ed[patternKey];
  }

  // Special case: Resource.id fallback
  if (!ed.__fixedValue && !ed.__patternValue && ed.base?.path === 'Resource.id') {
    ed.__fixedValue = ed.fixedString ?? undefined;
    ed.__patternValue = ed.patternString ?? undefined;
  }
}

/**
 * Assigns a FHIR type code to an ElementDefinition even if it is a system type.
 * This function modifies the ElementDefinition in place by adding a `__fhirTypeCode`
 * @param {ElementDefinition} ed - The element definition to process
 * @param {'system' | 'complex-type' | 'primitive-type'} kind - The kind of the element
 */
function assignFhirTypeCode(ed) {
  const kind = ed.__kind;
  // Determine the FHIR type code
  const fhirTypeCode = (ed.base?.path === 'Resource.id') ?
    'id' : // Special case for Resource.id, where the spec defines 'string' but expects it to conform to 'id'
    (kind === 'system' ? extractSystemFhirType(ed.type[0]) : ed.type[0].code);

  // Assign the FHIR type code to the element definition
  ed.__fhirTypeCode = fhirTypeCode;
}

/**
 * Assign isArray property to the element definition based on its *base* cardinality.
 * This function modifies the ElementDefinition in place by adding an `__isArray` property.
 * @param {ElementDefinition} ed - The element definition to process
 */
function assignIsArray(ed) {
  // If the element has a base.max different than '1', it is an array
  ed.__isArray = !(ed.max === '1');
}

/**
 * return last segment of element id, converted to a flash segment (name:slice -> name[slice])
 * @param {string} elementId - an ElementDefinition.id (e.g. "Patient.name:slice")
 * @return {string} - the last segment of the element id, converted to a flash segment (name[slice])
 */
function toFlashSegment(elementId) {
  const childLastPartOfId = elementId.split('.').pop();
  // convert:
  // - name:slice -> name[slice]
  // - name -> name
  // - name[x] -> name
  // - name[x]:slice -> name[slice]
  if (childLastPartOfId.includes(':')) {
    let [name, slice] = childLastPartOfId.split(':');
    name = name.replace(/\[x\]$/, ''); // strip polymorphic marker if present
    return `${name}[${slice}]`;
  }

  // No colon: remove trailing [x] if present, else return as-is
  return childLastPartOfId.replace(/\[x\]$/, '');
}
export default resolveDefinitions;
