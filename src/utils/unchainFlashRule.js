/*
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: 2025 Outburn Ltd.

Project: Fumifier (part of the FUME open-source initiative)

*/

/* eslint-disable strict */
/* eslint-disable require-jsdoc */
/* eslint-disable no-console */
/**
 * © Copyright Outburn Ltd. 2022-2024 All Rights Reserved
 *   Project name: FUME-COMMUNITY
 */

/**
 * This function restructures a flashrule AST, converting a chained path (flashpath.steps length > 1) into a nested hierarchy of
 * flashrule branches.
 * 1. Handling flashpath.steps
 *
 * If flashpath.steps has only one step, replace path with that step.
 * Any existing rules remain at this level and are transformed recursively.
 * If flashpath.steps has multiple steps, restructure them into nested flashrule objects.
 * The first step becomes the top-level path.
 * Each subsequent step becomes a nested flashrule inside the previous step’s rules array.
 * The deepest flashrule (last step) receives the inline expression and any subsequest indented rules.
 *
 * 2. Handling sub-rules
 *
 * If sub-rules exist:
 * They are unchained recursively using the same function.
 *
 * 3. Path tracking
 *
 * Each flashrule.path will have a name (the actual element name, no other steps or slices),
 * a value (element name suffixed with slices in square brackets),
 * and a fullPath - The accumulating series of values that represents the current path in the hierarchy.
 *
 * @param {Object} ast A flashrule AST branch
 * @param {string} parentFullPath Accumulating path in currenct flash block
 * @returns {Object} The transformed AST branch
 */
var unchainFlashRule = function (ast, parentFullPath = "") {
  if (!ast.path || !ast.path.steps) {
    // No need to unchain this rule, it is already a single step or of a type that does not require path unchaining
    return ast;
  }

  const _conditionalTransform = (rule, currentFullPath) => {
    if (rule.type === 'bind') {
      // Bind rules are not transformed, they remain as is
      return rule;
    }
    if (rule.type === 'binary') {
      // Binary rules (assumining they are '.', used for a rule's context) have only their right-hand side transformed
      return {
        ...rule,
        rhs: unchainFlashRule(rule.rhs, currentFullPath)
      };
    }
    // For all other rules, apply the transformation directly (assuming they are flashrules)
    return unchainFlashRule(rule, currentFullPath);
  };

  // Helper function to construct `value` from `name` and `slices`
  function constructValue(step) {
    let sliceString = step.slices && step.slices.length > 0 ?
      step.slices.map(slice => `[${slice.value}]`).join("") :
      "";
    return step.value + sliceString;
  }

  // console.log("Transforming FLASH rule", JSON.stringify(ast, null, 2));

  let steps = ast.path.steps;

  // Compute fullPath **before** transforming rules
  let firstValue = constructValue(steps[0]);
  let accumulatedPath = parentFullPath ? `${parentFullPath}.${firstValue}` : firstValue;

  // Case 1: Single-step path
  if (steps.length === 1) {
    let firstStep = steps[0];

    let result = {
      ...ast,
      name: firstStep.value,
      value: firstValue,
      fullPath: accumulatedPath,
      position: firstStep.position,
      start: firstStep.start,
      line: firstStep.line,
      path: { type: "flashpath", steps: [firstStep] },
    };

    // Unchain sub-rules **AFTER** fullPath is computed
    let transformedRules = ast.rules ?
      ast.rules.map(r => _conditionalTransform(r, accumulatedPath)) :
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
    fullPath: `${accumulatedPath}.${constructValue(steps[1])}`,
    position: steps[1].position,
    start: steps[1].start,
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
      fullPath: `${current.fullPath}.${constructValue(steps[i])}`,
      position: steps[i].position,
      start: steps[i].start,
      line: steps[i].line,
      path: {
        type: "flashpath",
        steps: [{ ...steps[i], value: steps[i].value }]
      }
    };
    current.rules = [newRule];
    current = newRule;
  }

  let transformedRules = ast.rules ?
    ast.rules.map(r => _conditionalTransform(r, current.fullPath)) : [];

  if (transformedRules.length > 0) {
    current.rules = transformedRules;
  }

  // Assign `expression` to the deepest rule
  if (ast.expression) {
    current.expression = ast.expression;
    delete ast.expression;
  }

  let result = {
    ...ast,
    name: steps[0].value,
    value: firstValue,
    fullPath: accumulatedPath,
    position: steps[0].position,
    start: steps[0].start,
    line: steps[0].line,
    path: { type: "flashpath", steps: [{ ...steps[0], value: steps[0].value }] },
    rules: [nestedRule]
  };

  return result;
};

export default unchainFlashRule;