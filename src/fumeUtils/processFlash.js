/* eslint-disable no-console */
/**
 * © Copyright Outburn Ltd. 2022-2024 All Rights Reserved
 *   Project name: FUME-COMMUNITY
 */

// var primitiveParsers = {}; // cache for FHIR primitive value RegExp parsers

// var getPrimitiveParser = async function (typeName) {
// // returns a regex that will be used to validate a primitive value
// // expressions are cached in memory so they are only fetched once
// if (primitiveParsers[typeName]) {
//     // exists in cache, return from there
//     return primitiveParsers[typeName];
// } else {
//     // find the regex for the primitive type
//     var resEx;
//     var sDef = await getSnapshot(typeName);
//     if (sDef === undefined) {
//         var typeError = {
//             code: 'F1026',
//             position: expr.position,
//             line: expr.line,
//             token: typeName,
//             value: expr.instanceof,
//             message: `Could not find a FHIR type/profile definition with identifier '${typeName}'`
//         };
//         typeError.stack = (new Error()).stack;
//         throw typeError;
//         return thrower.throwRuntimeError(`error fetching structure definition for type ${typeName}`)
//     };
//     const valueElementDef = sDef?.snapshot?.element[3]; // 4th element in a primitive's structdef is always the actual primitive value
//     // get regular expression string from the standard extension
//     const regexStr: string = valueElementDef?.type[0]?.extension?.filter((ext: any) => ext?.url === 'http://hl7.org/fhir/StructureDefinition/regex')[0]?.valueString;
//     if (regexStr) {
//     // found regex, compile it
//     const fn = new RegExp(`^${regexStr}$`);
//     resFn = (value: string): boolean => fn.test(value);
//     } else {
//     // no regex - function will just test for empty strings
//     resFn = (value: string): boolean => value.trim() !== '';
//     }
//     primitiveParsers[typeName] = resFn; // cache the function
//     return resFn;
// }
// };

import createFhirFetchers from './createFhirFetchers.js';

/**
 * FLASH semantic processor
 * @param {Object} expr - Parsed Fumifier expression
 * @param {FhirStructureNavigator} navigator: FHIR structure navigator
 * @param {Object} fhirTypeMeta - If inside a FLASH block, this is the resolved FHIR type metadata according to `InstanceOf`
 * @param {string} parentPath - If inside a FLASH rule, this is the path of the parent FLASH rule
 * @returns {{evaluate: evaluate, assign: assign}} Semantically enriched AST
 */
var processFlash = async function (expr, navigator, fhirTypeMeta, parentPath) {
    var result = expr;
    const {
        getElement,
        // getChildren,
        getTypeMeta
    } = createFhirFetchers(navigator);
    switch (expr.type) {
        case 'flashblock':
            fhirTypeMeta = await getTypeMeta(expr.instanceof);

            if (fhirTypeMeta) {
                result.fhirTypeMeta = fhirTypeMeta;
            } else {
                var typeError = {
                    code: 'F1026',
                    position: expr.position,
                    line: expr.line,
                    token: 'InstanceOf:',
                    value: expr.instanceof,
                    message: `Could not find a FHIR type/profile definition with identifier '${expr.instanceof}'`
                };
                typeError.stack = (new Error()).stack;
                throw typeError;
            }
            if (expr.rules && expr.rules.length > 0) {
                var rules = await Promise.all(expr.rules.map((rule) => processFlash(rule, navigator, fhirTypeMeta)));
                result.rules = rules;
            }
            break;
        case 'flashrule':
            var path = expr.fullPath;
            var ed = await getElement(fhirTypeMeta, path);
            if (ed) {
                [
                    'mapping',
                    'mustSupport',
                    'isSummary',
                    'isModifier',
                    'requirements',
                    'comment',
                    'definition',
                    'isModifierReason',
                    'meaningWhenMissing',
                    'example',
                    'short'
                ].map((element) => delete ed[element]);
                result.elementDefinition = ed;
            } else {
                var elementError = {
                    code: 'F1029',
                    position: expr.position,
                    line: expr.line,
                    token: '(flashpath)',
                    value: path,
                    fhirType: fhirTypeMeta.name
                };
                elementError.stack = (new Error()).stack;
                throw elementError;
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
                result.steps = await Promise.all(expr.steps.map(async (step) => await processFlash(step, navigator, fhirTypeMeta, parentPath)));
            }
            break;
    }
    return result;
};

export default processFlash;