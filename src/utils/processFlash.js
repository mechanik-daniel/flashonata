/* eslint-disable no-console */
/**
 * © Copyright Outburn Ltd. 2022-2024 All Rights Reserved
 *   Project name: Fumifier
 */

import createFhirFetchers from './createFhirFetchers.js';
import createMetaProfileRule from './createMetaProfileRule.js';
import createVirtualRule from './createVirtualRule.js';
import extractSystemFhirType from './extractSystemFhirType.js';

const initCap = (str) => str.charAt(0).toUpperCase() + str.slice(1);

/**
 * FLASH semantic processor. After parsing a Fumifier expression and running it through processAst,
 * if the expression has FLASH it will be flagged as such and passed here for FHIR semantic enrichment.
 * @param {Object} expr - Parsed Fumifier expression
 * @param {FhirStructureNavigator} navigator: FHIR structure navigator
 * @param {Object} fhirTypeMeta - If inside a FLASH block, this is the resolved FHIR type metadata according to `InstanceOf`
 * @param {string} parentPath - If inside a FLASH rule, this is the path of the parent FLASH rule
 * @returns {{evaluate: evaluate, assign: assign}} Semantically enriched AST
 */
const processFlash = async function (expr, navigator, fhirTypeMeta, parentPath) {
  var result = expr;
  var fetchError;
  var fhirChildren;
  var primitiveValueEd;
  const {
    getElement,
    getChildren,
    getTypeMeta,
    getBaseTypeMeta
  } = createFhirFetchers(navigator);
  switch (expr.type) {
    case 'flashblock':
      try {
        fhirTypeMeta = await getTypeMeta(expr.instanceof);
      } catch (e) {
        fetchError = e;
      }
      if (fhirTypeMeta) {
        result.fhirTypeMeta = fhirTypeMeta;
      } else {
        var typeError = {
          code: 'F1026',
          position: expr.position,
          start: expr.start,
          line: expr.line,
          token: 'InstanceOf:',
          value: expr.instanceof
        };
        typeError.stack = (fetchError ?? new Error()).stack;
        throw typeError;
      }
      try {
        fhirChildren = await getChildren(fhirTypeMeta);
      } catch (e) {
        fetchError = e;
      }
      if (fhirChildren) {
        result.fhirChildren = fhirChildren;
      } else {
        var childrenError = {
          code: 'F1030',
          position: expr.position,
          start: expr.start,
          line: expr.line,
          token: 'InstanceOf:',
          value: expr.instanceof
        };
        childrenError.stack = (fetchError ?? new Error()).stack;
        throw childrenError;
      }
      if (!expr.rules) {
        expr.rules = [];
      }
      // if this is a profile on a resource, add a meta.profile rule
      if (fhirTypeMeta.kind === 'resource' && fhirTypeMeta.derivation === 'constraint') {
        const metaProfileRule = createMetaProfileRule(expr, fhirTypeMeta.url);
        // add the meta.profile rule to the top of the rules
        expr.rules.unshift(metaProfileRule);
      }
      // Convert `instance` to a virtual flash rule on the `id` element
      if (expr.instance) {
        const idRule = createVirtualRule(expr, 'id');
        // add the id rule to the top of the rules
        expr.rules.unshift(idRule);
        delete result.instance; // remove the instance property
      }
      if (expr.rules && expr.rules.length > 0) {
        var rules = await Promise.all(expr.rules.map((rule) => processFlash(rule, navigator, fhirTypeMeta)));
        result.rules = rules;
      }
      break;
    case 'flashrule':
      // console.log('Processing FLASH rule', JSON.stringify(expr, null, 2));
      var path = expr.fullPath;
      var ed;
      var kind;
      var fhirTypeCode;
      try {
        ed = await getElement(fhirTypeMeta, path);
      } catch (e) {
        fetchError = e;
      }
      if (ed) {
        // ensure element is not forbidden
        if (ed.max === '0') {
          var forbiddenError = {
            code: 'F1032',
            position: expr.position,
            start: expr.start,
            line: expr.line,
            token: '(flashpath)',
            value: path,
            fhirType: fhirTypeMeta.name
          };
          forbiddenError.stack = (fetchError ?? new Error()).stack;
          throw forbiddenError;
        }
        // ensure element has a single type
        if (ed.type && ed.type.length > 1) {
          // take last part of path and remove the last 3 chars ("[x]") to get the base name
          const lastPart = ed.path.split('.').pop();
          const baseName = lastPart.endsWith('[x]') ? lastPart.slice(0, -3) : lastPart;
          const allowedNames = ed.type.map((t) => `${baseName}${initCap(t.code)}`).join(', ');
          typeError = {
            code: 'F1031',
            position: expr.position,
            start: expr.start,
            line: expr.line,
            token: '(flashpath)',
            value: baseName,
            allowedNames
          };
          typeError.stack = (fetchError ?? new Error()).stack;
          throw typeError;
        }
        result.elementDefinition = ed;
        kind = ed.type[0].__kind;
        result.kind = kind;
        // if system primitive, there should still be a fhir type code set in an extension
        fhirTypeCode = kind === 'system' ? extractSystemFhirType(ed.type[0]) : ed.type[0].code;
        // if element has fixed value, set it as `fixed`
        const fixedValueKey = `fixed${initCap(fhirTypeCode)}`;
        if (kind === 'primitive-type' && (ed[fixedValueKey] || ed['_' + fixedValueKey])) {
          // create an object combining the value and siblings
          const fixedValue = { value: ed[fixedValueKey], ...(ed['_' + fixedValueKey] ?? {}) };
          result.fixed = fixedValue;
        } else if (ed[fixedValueKey]) {
          result.fixed = ed[fixedValueKey];
        }
        // if element has pattern[x] value, set it as `pattern`
        const patternValueKey = `pattern${initCap(fhirTypeCode)}`;
        if (kind === 'primitive-type' && (ed[patternValueKey] || ed['_' + patternValueKey])) {
          // create an object combining the value and siblings
          const patternValue = { value: ed[patternValueKey], ...(ed['_' + patternValueKey] ?? {}) };
          result.pattern = patternValue;
        } else if (ed[patternValueKey]) {
          result.pattern = ed[patternValueKey];
        }
      } else {
        var elementError = {
          code: 'F1029',
          position: expr.position,
          start: expr.start,
          line: expr.line,
          token: '(flashpath)',
          value: path,
          fhirType: fhirTypeMeta.name
        };
        elementError.stack = (fetchError ?? new Error()).stack;
        throw elementError;
      }
      // if this is not a system kind, then it should have children
      if (kind !== 'system') {
        try {
          fhirChildren = await getChildren(fhirTypeMeta, path);
        } catch (e) {
          fetchError = e;
        }
        if (fhirChildren) {
          result.fhirChildren = fhirChildren;
        } else {
          childrenError = {
            code: 'F1030',
            position: expr.position,
            start: expr.start,
            line: expr.line,
            token: '(flashpath)',
            value: `${fhirTypeMeta.name}.${path}`
          };
          childrenError.stack = (fetchError ?? new Error()).stack;
          throw childrenError;
        }
      }
      // if this is a fhir or system primitive then we need to find the regex for the value
      if (kind === 'primitive-type') {
        // the regex of a fhir primitive is hiding in the "value" child element. Find it in fhirChildren:
        primitiveValueEd = fhirChildren.find((child) => child.path.endsWith('.value'));
      } else if (kind === 'system') {
        // for system primitives, we need to fetch the type's "value" element
        // fhirTypeCode holds the FHIR type code of the system primitive
        try {
          const baseTypeMeta = await getBaseTypeMeta(
            fhirTypeCode,
            { // filter scope using source package, so the correct core fhir version is used
              id: fhirTypeMeta.__packageId,
              version: fhirTypeMeta.version
            }
          );
          if (baseTypeMeta) {
            // use getElement to fetch the "value" element definition
            primitiveValueEd = await getElement(baseTypeMeta, 'value');
          }
        } catch {
        // ignore errors related to fetching the primitiveValueEd, it will be undefined if not found
        }
      }
      // if primitiveValueEd is found, then we can extract the regex from it
      if (primitiveValueEd) {
        // get the regex from the value child
        const regexStr = primitiveValueEd.type[0].extension?.find((ext) => ext.url === 'http://hl7.org/fhir/StructureDefinition/regex')?.valueString;
        if (regexStr) {
          result.regexStr = regexStr;
        }
      }
      if (expr.rules && expr.rules.length > 0) {
        var subrules = await Promise.all(expr.rules.map((rule) => processFlash(rule, navigator, fhirTypeMeta, path)));
        result.rules = subrules;
      }
      break;
    case 'block':
      /* c8 ignore else */
      if (expr.expressions && expr.expressions.length > 0) {
        result.expressions = await Promise.all(expr.expressions.map((expresion) => processFlash(expresion, navigator, fhirTypeMeta, parentPath)));
      }
      break;
    case 'path':
      /* c8 ignore else */
      if (expr.steps && expr.steps.length > 0) {
        result.steps = await Promise.all(expr.steps.map((step) => processFlash(step, navigator, fhirTypeMeta, parentPath)));
      }
      break;
  }
  return result;
};

export default processFlash;