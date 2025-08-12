/* eslint-disable no-console */
/**
 * © Copyright Outburn Ltd. 2022-2024 All Rights Reserved
 *   Project name: Fumifier
 */

import createFhirFetchers from './createFhirFetchers.js';
import extractSystemFhirType from './extractSystemFhirType.js';
import { populateMessage } from './errorCodes.js';
import fn from './functions.js';

/**
 * Centralized recoverable error handling helper.
 * @param {Object} base - base error object without position information
 * @param {Object[]} positions - Array of position containing objects pointing to the source of the error
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
 * @param {Object} compiledRegexCache - Cache for compiled FHIR regexes
 * @returns {Promise<Object>} Semantically enriched AST
 */
const resolveDefinitions = async function (expr, navigator, recover, errors, compiledRegexCache) {
  if (!expr || !expr.containsFlash) return expr;
  // create utilities for fetching FHIR definitions
  const {
    getTypeMeta,
    getBaseTypeMeta,
    getElement,
    getChildren,
    expandValueSet
  } = createFhirFetchers(navigator);

  // Initialize containers for resolved definitions
  // ============================================================
  const resolvedTypeMeta = {}; // key: InstanceOf: value: type metadata
  const resolvedBaseTypeMeta = {}; // key: packageId@version::typeCode value: base type metadata
  const resolvedTypeChildren = {}; // key: InstanceOf: value: children array
  const resolvedElementDefinitions = {}; // key: InstanceOf: + flash path value: ElementDefinition
  const resolvedElementChildren = {}; // key: InstanceOf: + flash path value: children array
  // ValueSet expansion cache (full expansions only, transformed for fast lookup)
  const resolvedValueSetExpansions = {}; // key: pkgId@pkgVersion::filename -> { [system]: { [code]: concept } }
  // Tracker to avoid repeated expansions per (url + sourcePackage)
  const valueSetExpansionTracker = {}; // key: pkgId@pkgVersion::valueSetUrl -> { mode, vsRefKey }
  // ============================================================

  // Helper: flatten/collect contains (handles nested contains) & build system->code dictionary
  /**
   * Transform a ValueSet.expansion into a fast lookup dictionary.
   * Structure: { [system]: { [code]: concept } }
   * Nested contains are flattened.
   * @param {Object} expansion - The ValueSet.expansion object
   * @returns {Object} Dictionary for quick system/code lookup
   */
  function transformExpansion(expansion) {
    const dict = {};
    if (!expansion || !Array.isArray(expansion.contains)) return dict;
    const stack = [...expansion.contains];
    while (stack.length) {
      const c = stack.pop();
      if (!c || !c.system || !c.code) continue;
      if (!dict[c.system]) dict[c.system] = {};
      if (!dict[c.system][c.code]) dict[c.system][c.code] = c;
      if (Array.isArray(c.contains)) stack.push(...c.contains);
    }
    return dict;
  }

  /**
   * Detect and process a binding on an ElementDefinition. Applies precedence (a,b,c) to determine
   * the binding, attempts ValueSet expansion, and annotates the element with:
   *  - __bindingStrength ('required' | 'extensible')
   *  - __vsRefKey (only if expansion succeeded)
   *  - __vsExpansionMode ('full' | 'lazy' | 'error')
   * Uses internal caches to avoid repeated expansions per (url + package).
   * @param {ElementDefinition} ed - ElementDefinition to enrich
   * @param {Object} meta - Owning StructureDefinition metadata (for package scoping)
   */
  async function processBinding(ed, meta) {
    try {
      const binding = ed && ed.binding;
      if (!binding) return;

      let strength;
      let vsUrl;

      // (a) required + valueSet (any non-empty string incl. URNs treated as valid identifier)
      if (typeof binding.strength === 'string' && binding.strength === 'required' && typeof binding.valueSet === 'string' && binding.valueSet.trim() !== '') {
        strength = 'required';
        vsUrl = binding.valueSet.trim();
      } else if (!vsUrl) {
        // (b) extension elementdefinition-maxValueSet
        const ext = Array.isArray(binding.extension) ? binding.extension.find(e => e && e.url === 'http://hl7.org/fhir/StructureDefinition/elementdefinition-maxValueSet' && typeof e.valueCanonical === 'string' && e.valueCanonical.trim() !== '') : undefined;
        if (ext) {
          strength = 'required';
          vsUrl = ext.valueCanonical.trim();
        }
      }
      if (!vsUrl) {
        // (c) extensible + valueSet
        if (typeof binding.strength === 'string' && binding.strength === 'extensible' && typeof binding.valueSet === 'string' && binding.valueSet.trim() !== '') {
          strength = 'extensible';
          vsUrl = binding.valueSet.trim();
        }
      }

      if (!vsUrl || !strength) return; // nothing applicable

      ed.__bindingStrength = strength;

      const sourcePackage = { id: meta?.__packageId, version: meta?.__packageVersion };
      if (!sourcePackage.id || !sourcePackage.version) return; // cannot scope expansion properly

      const trackerKey = `${sourcePackage.id}@${sourcePackage.version}::${vsUrl}`;
      if (valueSetExpansionTracker[trackerKey]) {
        // Reuse previous outcome
        const prev = valueSetExpansionTracker[trackerKey];
        if (prev.vsRefKey) ed.__vsRefKey = prev.vsRefKey;
        ed.__vsExpansionMode = prev.mode;
        return;
      }

      // First encounter of this ValueSet (by url + package)
      let mode = 'error';
      let vsRefKey;
      try {
        const vs = await expandValueSet(vsUrl, sourcePackage); // may throw
        if (vs && vs.expansion) {
          // Determine size
          let count = vs.expansion.count;
          if (typeof count !== 'number') {
            const containsCount = Array.isArray(vs.expansion.contains) ? vs.expansion.contains.length : 0;
            count = containsCount;
          }
          const pkgId = vs.__packageId || sourcePackage.id;
          const pkgVersion = vs.__packageVersion || sourcePackage.version;
          const filename = vs.__filename || vs.id || vs.url || vsUrl;
          vsRefKey = `${pkgId}@${pkgVersion}::${filename}`;
          if (count <= 100) {
            const transformed = transformExpansion(vs.expansion);
            resolvedValueSetExpansions[vsRefKey] = transformed;
            mode = 'full';
          } else {
            mode = 'lazy'; // too big to embed fully
          }
        } else {
          mode = 'error';
        }
      } catch {
        mode = 'error';
      }

      if (vsRefKey) ed.__vsRefKey = vsRefKey;
      ed.__vsExpansionMode = mode;
      valueSetExpansionTracker[trackerKey] = { mode, vsRefKey };
    } catch { /* ignore binding processing errors entirely */ }
  }

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
      const enriched = await Promise.all(children.map(async child => {
        assignIsArray(child);
        handleContentReference(child);
        if (child.type && child.type.length === 1) {
          child.__kind = child.type[0].__kind;
          assignFhirTypeCode(child);
          assignFixedOrPatternValue(child);
          await processBinding(child, meta);
        }
        const flashSegment = toFlashSegment(child.id);
        child.__flashPathRefKey = `${instanceofId}::${flashSegment}`;
        if (!resolvedElementDefinitions[child.__flashPathRefKey]) {
          resolvedElementDefinitions[child.__flashPathRefKey] = child;
        }
        return child;
      }));
      resolvedTypeChildren[instanceofId] = enriched;
    } catch (e) {
      const baseError = { code: 'F2006', token: 'InstanceOf:', value: instanceofId, fhirType: meta.name || instanceofId };
      resolvedTypeChildren[instanceofId] = handleRecoverableError(baseError, sdRefs[instanceofId], recover, errors, e);
    }
  }));

  // Resolve all referenced elementDefinitions
  await Promise.all(Object.entries(edRefs).map(async ([key, flashpathNodes]) => {
    const flash = flashpathNodes[0];
    const baseError = { token: '(flashpath)', value: flash.fullPath, fhirType: flash.instanceOf };
    try {
      const meta = resolvedTypeMeta[flash.instanceOf];
      if (!meta || meta.__isError) return;
      baseError.fhirType = meta.name || flash.instanceOf;
      const ed = await getElement(meta, flash.fullPath);
      if (!ed) {
        baseError.code = 'F2002';
        return handleRecoverableError(baseError, flashpathNodes, recover, errors, new Error('Element not found'));
      }
      if (!ed.type || ed.type.length === 0) {
        if (ed.contentReference) {
          ed.type = [{ __kind: 'complex-type', code: 'BackboneElement' }];
        } else {
          baseError.code = 'F2007';
          return handleRecoverableError(baseError, flashpathNodes, recover, errors, new Error('Element has no type defined'));
        }
      }
      if (ed.type?.length > 1) {
        const baseName = ed.path.split('.').pop().replace(/\[x]$/, '');
        const allowed = ed.type.map(t => baseName + fn.initCapOnce(t.code)).join(', ');
        baseError.code = 'F2004';
        baseError.allowedNames = allowed;
        return handleRecoverableError(baseError, flashpathNodes, recover, errors, new Error('Must select one of multiple types'));
      } else {
        const kind = ed.type?.[0]?.__kind;
        ed.__kind = kind;
        assignIsArray(ed);
        assignFhirTypeCode(ed);
        assignFixedOrPatternValue(ed);
        await processBinding(ed, meta);
        let elementChildren = [];
        if (kind !== 'system') {
          try {
            elementChildren = await getChildren(meta, flash.fullPath);
            if (!elementChildren.length) throw new Error('No children found');
            elementChildren = await Promise.all(elementChildren.map(async child => {
              assignIsArray(child);
              handleContentReference(child);
              if (child.type && child.type.length === 1) {
                child.__kind = child.type[0].__kind;
                assignFhirTypeCode(child);
                assignFixedOrPatternValue(child);
                await processBinding(child, meta);
              }
              const flashSegment = toFlashSegment(child.id);
              child.__flashPathRefKey = `${key}.${flashSegment}`;
              if (!resolvedElementDefinitions[child.__flashPathRefKey]) {
                resolvedElementDefinitions[child.__flashPathRefKey] = child;
              }
              return child;
            }));
            resolvedElementChildren[key] = elementChildren;
          } catch (e) {
            baseError.code = 'F2003';
            return handleRecoverableError(baseError, flashpathNodes, recover, errors, e);
          }
        }
        let primitiveValueEd;
        if (kind === 'primitive-type') {
          primitiveValueEd = elementChildren.find((c) => c.path.endsWith('.value'));
        } else if (kind === 'system') {
          try {
            const baseKey = `${meta.__packageId}@${meta.__packageVersion}::${ed.__fhirTypeCode}`;
            let baseTypeMeta = resolvedBaseTypeMeta[baseKey];
            if (!baseTypeMeta) {
              baseTypeMeta = await getBaseTypeMeta(ed.__fhirTypeCode, { id: meta.__packageId, version: meta.__packageVersion });
              resolvedBaseTypeMeta[baseKey] = baseTypeMeta;
            }
            primitiveValueEd = baseTypeMeta ? await getElement(baseTypeMeta, 'value') : undefined;
          } catch { /* ignore */ }
        }
        if (primitiveValueEd) {
          ed.__regexStr = primitiveValueEd.type?.[0]?.extension?.find((e) => e.url === 'http://hl7.org/fhir/StructureDefinition/regex')?.valueString;
        }
        if (ed.__regexStr) {
          const label = `__fhir_regex_${ed.__regexStr}`;
          if (!compiledRegexCache[label]) compiledRegexCache[label] = new RegExp(`^${ed.__regexStr}$`);
        }
        resolvedElementDefinitions[key] = ed;
      }
    } catch (e) {
      const err = { ...e, ...baseError };
      if (!e.code) err.code = 'F2002';
      handleRecoverableError(err, flashpathNodes, recover, errors, e);
    }
  }));

  // - Recursively fetch, resolve and save mandatory elements' children, to enable fixed[x] and pattern[x] injection at all levels.
  // - This is needed for elements that are not directly referenced in the FLASH block, but expected to be populated automatically.
  const pending = new Set();
  const shouldExpand = (key, ed) => (ed?.min >= 1 && ed.__kind && ed.__kind !== 'system' && !ed.__fixedValue && !Object.prototype.hasOwnProperty.call(resolvedElementChildren, key));
  for (const [k, ed] of Object.entries(resolvedElementDefinitions)) if (shouldExpand(k, ed)) pending.add(k);
  for (const [k, childrenEds] of Object.entries(resolvedTypeChildren)) for (const ed of childrenEds) { const childKey = `${k}::${toFlashSegment(ed.id)}`; if (shouldExpand(childKey, ed)) pending.add(childKey); }
  for (const [k, childrenEds] of Object.entries(resolvedElementChildren)) for (const ed of childrenEds) { const childKey = `${k}.${toFlashSegment(ed.id)}`; if (shouldExpand(childKey, ed)) pending.add(childKey); }

  while (pending.size > 0) {
    const keys = Array.from(pending);
    pending.clear();
    await Promise.all(keys.map(async (key) => {
      const [instanceOf, parentFlashpath] = key.split('::');
      const fhirTypeMeta = resolvedTypeMeta[instanceOf];
      if (!fhirTypeMeta || fhirTypeMeta.__isError) return;
      if (Object.prototype.hasOwnProperty.call(resolvedElementChildren, key)) return;
      let ed;
      try {
        ed = resolvedElementDefinitions[key];
        if (!ed) {
          ed = await getElement(fhirTypeMeta, parentFlashpath);
          resolvedElementDefinitions[key] = ed;
        }
        const children = await getChildren(fhirTypeMeta, parentFlashpath);
        const enriched = await Promise.all(children.map(async child => {
          assignIsArray(child);
          handleContentReference(child);
          if (child.type && child.type.length === 1) {
            child.__kind = child.type[0].__kind;
            assignFhirTypeCode(child);
            assignFixedOrPatternValue(child);
            await processBinding(child, fhirTypeMeta);
          }
          const flashSegment = toFlashSegment(child.id);
          child.__flashPathRefKey = `${key}.${flashSegment}`;
          if (!resolvedElementDefinitions[child.__flashPathRefKey]) {
            resolvedElementDefinitions[child.__flashPathRefKey] = child;
          }
          return child;
        }));
        resolvedElementChildren[key] = enriched;
        enriched.forEach(child => {
          const childPathSegment = toFlashSegment(child.id);
          const childKey = `${instanceOf}::${parentFlashpath}.${childPathSegment}`;
          if (shouldExpand(childKey, child)) {
            if (!resolvedElementDefinitions[childKey]) {
              resolvedElementDefinitions[childKey] = child;
            }
            pending.add(childKey);
          }
        });
      } catch (e) {
        const baseError = { code: 'F2008', value: parentFlashpath, fhirType: fhirTypeMeta.name || instanceOf };
        resolvedElementChildren[key] = handleRecoverableError(baseError, [], recover, errors, e);
      }
    }));
  }

  expr.resolvedTypeMeta = resolvedTypeMeta;
  expr.resolvedBaseTypeMeta = resolvedBaseTypeMeta;
  expr.resolvedTypeChildren = resolvedTypeChildren;
  expr.resolvedElementDefinitions = resolvedElementDefinitions;
  expr.resolvedElementChildren = resolvedElementChildren;
  expr.resolvedValueSetExpansions = resolvedValueSetExpansions; // new cache for small ValueSets
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

  const fixedKey = `fixed${fn.initCapOnce(fhirTypeCode)}`;
  const patternKey = `pattern${fn.initCapOnce(fhirTypeCode)}`;

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
 * Handle contentReference elements by injecting BackboneElement type if missing
 * @param {Object} child - Child element definition
 */
function handleContentReference(child) {
  if (!child.type || child.type.length === 0) {
    // no type defined
    // if also no contentRef, then it's an error (but we can't handle it here)
    if (child.contentReference) {
      // there's a content reference, so we can just assume the type is BackboneElement
      child.type = [{ __kind: 'complex-type', code: 'BackboneElement' }];
    }
  }
}

/**
 * Assign isArray property to the element definition based on its *base* cardinality.
 * This function modifies the ElementDefinition in place by adding an `__isArray` property.
 * @param {ElementDefinition} ed - The element definition to process
 */
function assignIsArray(ed) {
  // If the element has a base.max different than '1', it is an array
  ed.__isArray = !(ed.base.max === '1');
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
