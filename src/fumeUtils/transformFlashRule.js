/* eslint-disable strict */
/* eslint-disable require-jsdoc */
/* eslint-disable no-console */
/**
 * © Copyright Outburn Ltd. 2022-2024 All Rights Reserved
 *   Project name: FUME-COMMUNITY
 */

/**
 * This function restructures a flashrule AST, converting a flat path (flashpath.steps) into a nested hierarchy of
 * flashrule branches.
 * 1. Handling flashpath.steps
 *
 * If flashpath.steps has only one step, replace path with that step.
 * Any existing rules remain at this level and are transformed recursively.
 * If flashpath.steps has multiple steps, restructure them into nested flashrule objects.
 * The first step becomes the top-level path.
 * Each subsequent step becomes a nested flashrule inside the previous step’s rules array.
 * The deepest flashrule (last step) receives the expression and rules.
 *
 * 2. Handling context
 *
 * If context exists, it remains at the top level and is not moved down.
 *
 * 3. Handling rules
 *
 * If rules exist in the original AST:
 * They are transformed recursively using the same function.
 * If flashpath.steps has only one step, rules remain at the same level.
 * If flashpath.steps has multiple steps, rules are moved to the deepest flashrule.
 *
 * 4. Path tracking
 *
 * Each flashrule.path will have a name (the actual element name, no other steps or slices),
 * a value (element name suffixed with slices in square brackets),
 * and a fullPath - The accumulating series of values that represents the current path in the hierarchy
 * @param {Object} ast A flashrule AST branch
 * @param {string} parentFullPath Accumulating path in currenct flash block
 * @returns {Object} The transformed AST branch
 */
var transformFlashRule = function (ast, parentFullPath = "") {

  let steps = ast.path.steps;
  let rootFhirType = ast.rootFhirType;

  // Helper function to construct `value` from `name` and `slices`
  function constructValue(step) {
    let sliceString = step.slices && step.slices.length > 0 ?
      step.slices.map(slice => `[${slice.value}]`).join("") :
      "";
    return step.value + sliceString;
  }

  // Compute fullPath **before** transforming rules
  let firstValue = constructValue(steps[0]);
  let accumulatedPath = parentFullPath ? `${parentFullPath}.${firstValue}` : firstValue;

  // Case 1: Single-step path → Keep `path` structured consistently
  if (steps.length === 1) {
    let firstStep = steps[0];

    let result = {
      ...ast,
      name: firstStep.value,
      value: firstValue,
      fullPath: accumulatedPath,
      position: firstStep.position,
      line: firstStep.line,
      path: { type: "flashpath", steps: [firstStep] },
    };

    // Transform rules **AFTER** fullPath is computed
    let transformedRules = ast.rules ?
      ast.rules.map(r => r.type === 'bind' ? r : transformFlashRule({ ...r, rootFhirType }, accumulatedPath)) :
      [];

    if (transformedRules.length > 0) {
      result.rules = transformedRules;
    }

    return result;
  }

  // Case 2: Multi-step path → Convert into nested structure
  let nestedRule = {
    type: "flashrule",
    name: steps[1].value,
    value: constructValue(steps[1]),
    rootFhirType,
    fullPath: `${accumulatedPath}.${constructValue(steps[1])}`,
    position: steps[1].position,
    line: steps[1].line,
    path: {
      type: "flashpath",
      steps: [{ ...steps[1], value: steps[1].value }]
    }
  };

  let current = nestedRule;

  // Build the nested structure for remaining steps
  for (let i = 2; i < steps.length; i++) {
    let newRule = {
      type: "flashrule",
      name: steps[i].value,
      value: constructValue(steps[i]),
      rootFhirType,
      fullPath: `${current.fullPath}.${constructValue(steps[i])}`,
      position: steps[i].position,
      line: steps[i].line,
      path: {
        type: "flashpath",
        steps: [{ ...steps[i], value: steps[i].value }]
      }
    };
    current.rules = [newRule];
    current = newRule;
  }

  // **Fix:** Ensure transformed `rules` are nested at the correct depth
  let transformedRules = ast.rules ?
    ast.rules.map(r => r.type === 'bind' ? r : transformFlashRule({ ...r, rootFhirType }, current.fullPath)) :
    [];

  if (transformedRules.length > 0) {
    current.rules = transformedRules;
  }

  // Assign `expression` to the deepest rule
  if (ast.expression) {
    current.expression = ast.expression;
    delete ast.expression;
  }

  // Preserve `context` at the top level if it exists
  let result = {
    ...ast,
    name: steps[0].value,
    value: firstValue,
    rootFhirType,
    fullPath: accumulatedPath,
    position: steps[0].position,
    line: steps[0].line,
    path: { type: "flashpath", steps: [{ ...steps[0], value: steps[0].value }] },
    rules: [nestedRule]
  };

  return result;
};

export default transformFlashRule;