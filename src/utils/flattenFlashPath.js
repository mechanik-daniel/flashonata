/* eslint-disable strict */
/* eslint-disable require-jsdoc */
/* eslint-disable no-console */
/**
 * © Copyright Outburn Ltd. 2022-2024 All Rights Reserved
 *   Project name: FUME-COMMUNITY
 */

/**
 * This function takes in a path AST from a flashrule.path and reconstructs it so that a path is only made of
 * names with optional slices. Binary '-' expressions inside filters are treated as regular '-' seperators that
 * are part of the slice name (hence - flattening)
 * @param {Object} ast A branch of the AST
 * @returns {Object} The trasformed AST branch
 */
var flattenFlashPath = function (ast) {
  if (ast.type !== "path") {
    throw new Error("Invalid AST: Expected a path type");
  }

  function flattenBinaryDash(expr) {
    if (expr.type === "binary" && expr.value === "-") {
      return `${flattenBinaryDash(expr.lhs)}-${flattenBinaryDash(expr.rhs)}`;
    }
    if (expr.type === "path" && expr.steps.length === 1 && expr.steps[0].type === "name") {
      return expr.steps[0].value;
    }
    throw new Error("Invalid binary '-' operation structure");
  }

  function transformStep(step) {
    if (step.type !== "name") {
      throw new Error(`Invalid step type: ${step.type}`);
    }

    if (step.index) {
      throw new Error("Can't bind index in a FLASH path");
    }

    let transformedStep = {
      value: step.value,
      type: "name",
      position: step.position,
      start: step.start,
      line: step.line,
      slices: []
    };

    if (step.stages) {
      for (let stage of step.stages) {
        if (stage.type !== "filter") {
          throw new Error(`Invalid stage type: ${stage.type}`);
        }

        let expr = stage.expr;

        if (expr.type === "binary") {
          if (expr.value !== "-") {
            throw new Error(`Forbidden binary operation: ${expr.value}`);
          }
          transformedStep.slices.push({
            value: flattenBinaryDash(expr),
            type: "name",
            position: expr.rhs.steps[0].position,
            start: expr.rhs.steps[0].start,
            line: expr.rhs.steps[0].line
          });
        } else if (expr.type === "path" && expr.steps.length === 1 && expr.steps[0].type === "name") {
          transformedStep.slices.push({
            value: expr.steps[0].value,
            type: "name",
            position: expr.steps[0].position,
            start: expr.steps[0].start,
            line: expr.steps[0].line
          });
        } else if (expr.type === "number") {
          transformedStep.slices.push({
            value: expr.value.toString(),
            type: "name",
            position: expr.position,
            start: expr.start,
            line: expr.line
          });
        } else {
          throw new Error("Invalid slice value");
        }
      }
    }
    if (transformedStep.slices.length === 0) delete transformedStep.slices;
    return transformedStep;
  }

  return {
    type: "flashpath",
    steps: ast.steps.map(transformStep)
  };
};

export default flattenFlashPath;