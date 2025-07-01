/* eslint-disable strict */
/* eslint-disable require-jsdoc */
/* eslint-disable no-console */
/**
 * © Copyright Outburn Ltd. 2022-2024 All Rights Reserved
 *   Project name: Fumifier
 */

/**
 * This function takes in a pre-processed AST node (before calling processAst) from a flashrule's `path`
 * and reconstructs it so that a path is only made of a list of names (parts, or segments) with optional slices.
 * Each node type can only be one of:
 * * "name" - if no steps or slices are present in the entire path, e.g. `identifier`
 * * binary "." - chained path like `name.given`
 * * binary "[" - sliced step like `extension[hmo]`
 *
 * Inside filters (binary '['), node types can be names, numbers or binary "-".
 * All are flattened to a single slice name, e.g: `extension[ext-il-hmo]` becomes `extension` with a slice `ext-il-hmo`.
 *
 * @param {Object} ast A branch of the AST
 * @returns {Object} The trasformed AST branch
 */
function normalizeFlashPath(ast) {
  console.log('normalizeFlashPath', JSON.stringify(ast, null, 2));
  function flattenBinaryDash(expr) {
    if (expr.type === 'binary' && expr.value === '-') {
      const lhs = flattenBinaryDash(expr.lhs);
      const rhs = flattenBinaryDash(expr.rhs);
      return {
        value: lhs.value + '-' + rhs.value,
        type: 'name',
        position: rhs.position,
        start: lhs.start,
        line: lhs.line
      };
    } else if (expr.type === 'name' || expr.type === 'number') {
      return expr;
    } else {
      throw {
        code: 'F1028',
        position: expr.position,
        start: expr.start,
        line: expr.line,
        value: expr.value,
        stack: new Error().stack
      };
    }
  }

  const result = {
    type: 'flashpath',
    steps: []
  };

  function process(node) {
    if (node.type === 'binary' && node.value === '.') {
      process(node.lhs);
      process(node.rhs);
    } else if (node.type === 'binary' && node.value === '[') {
      let step = node.lhs;
      let slice = node.rhs;

      // Recurse if the step itself is another bracketed expression
      let stepObj = result.steps.length ? result.steps[result.steps.length - 1] : null;

      if (!stepObj || stepObj !== step) {
        if (step.type !== 'name' && step.type !== 'number') {
          throw {
            code: 'F1028',
            position: step.position,
            start: step.start,
            line: step.line,
            value: step.value,
            stack: new Error().stack
          };
        }
        stepObj = { ...step };
        result.steps.push(stepObj);
      }

      if (!stepObj.slices) stepObj.slices = [];
      if (slice.type === 'binary' && slice.value === '-') {
        stepObj.slices.push(flattenBinaryDash(slice));
      } else if (slice.type === 'name' || slice.type === 'number') {
        stepObj.slices.push(slice);
      } else {
        throw {
          code: 'F1028',
          position: slice.position,
          start: slice.start,
          line: slice.line,
          value: slice.value,
          stack: new Error().stack
        };
      }
      // remove slices array if empty
      if (stepObj.slices.length === 0) {
        delete stepObj.slices;
      }
    } else if (node.type === 'name') {
      result.steps.push(node);
    } else {
      throw {
        code: 'F1028',
        position: node.position,
        start: node.start,
        line: node.line,
        value: node.value,
        stack: new Error().stack
      };
    }
  }

  process(ast);
  return result;
}

export default normalizeFlashPath;