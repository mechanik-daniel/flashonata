/* eslint-disable no-console */
/* eslint-disable valid-jsdoc */

/**
 * Recursively preprocesses a raw AST node and transforms flash-specific constructs
 * into normalized JSONata-compatible structures with helpful markers.
 *
 * Supports:
 * - flashblock → block + injected instance rule
 * - flashrule → inline, block, or empty block structure
 */
const preProcessAst = (ast) => {
  if (!ast || typeof ast !== 'object') return ast;
  if (!ast.type || !ast.type.startsWith('flash')) {
    // If this is not a flash node, return it as is
    return ast;
  }

  // If this is a multi-step flashrule, unchain it into nested single-step rules
  if (ast.type === 'flashrule' && ast.path?.type === 'flashpath' && ast.path.steps.length > 1) {
    return preProcessAst(unchainMultiStepFlashRule(ast));
  }

  switch (ast.type) {
    case 'flashblock':
      return processFlashBlock(ast);
    case 'flashrule':
      return contextualize(processFlashRule(ast));
    default:
      return ast;
  }
};

// ======== TRANSFORMATION HELPERS ========

/**
 * Transforms a flashblock into a regular array constructor with:
 * - isFlashBlock flag
 * - optional instanceExpr injected as a rule with path: id
 * - all internal expressions recursively preprocessed
 */
function processFlashBlock(node) {
  const result = {
    ...node,
    type: 'unary',
    value: '[',
    isFlashBlock: true, // for later stages to distinguish these from normal blocks
    expressions: node.expressions ? node.expressions.map(preProcessAst) : []
  };

  // Remove properties no longer meaningful post-transformation
  delete result.indent;

  if (node.instanceExpr) {
    // Turn the instance line into a synthetic flashrule at the top of the block
    const instanceRule = convertInstanceExprToRule(node.instanceExpr);
    result.expressions.unshift(preProcessAst(instanceRule)); // recurse on injected rule
    delete result.instanceExpr;
  }

  return result;
}

/**
 * Transforms a flashrule into one of three normalized forms:
 *
 * CASE 1: inline-only
 *   * path = expr → flatten into a single inline expression with path metadata
 *
 * CASE 2: empty rule
 *   * path =       → transform into empty block for consistency
 *
 * CASE 3: complex rule
 *   * path = expr + sub-rules → become a block with inlineExpr + child expressions
 */
function processFlashRule(node) {
  const result = { ...node };
  result.isFlashRule = true;
  const context = node.context || undefined;

  // create a base object to hold context if it exists. any returned object will be merged with this base
  // to ensure context is preserved in the final structure at the root level
  const base = context ? { context } : {};

  // If the rule has nested rules inside, preprocess each recursively
  const hasSubExprs = Array.isArray(result.expressions) && result.expressions.length > 0;
  const subExpressions = hasSubExprs ? result.expressions.map(preProcessAst) : [];

  // Clean up unused properties
  delete result.expressions;
  delete result.indent;

  // Inline expressions are optional; if present, we lift them into the rule structure
  const inlineExpr = result.inlineExpression;
  if (inlineExpr) {
    inlineExpr.isInlineExpression = true; // helps distinguish inline vs. block
    inlineExpr.isFlashRule = true; // maintain flashrule lineage
    delete result.inlineExpression;
  }

  if (inlineExpr && !hasSubExprs) {
    // CASE 1: inline-only rule
    // Flatten the rule into a single inline expression node, preserving metadata
    return { ...result, ...inlineExpr, ...base };
  }

  if (!inlineExpr && !hasSubExprs) {
    // CASE 2: empty rule (no right-hand side and no sub-rules)
    // Convert to a block node with no children — ensures uniform block-based evaluation
    return {
      ...result,
      type: 'block',
      expressions: [],
      ...base
    };
  }

  // CASE 3: mixed rule (inline + sub-rules, or sub-rules only)
  // Convert to a block node where inline expression (if any) is prepended
  return {
    ...result,
    type: 'unary',
    value: '[',
    expressions: inlineExpr ? [inlineExpr, ...subExpressions] : subExpressions,
    ...base
  };
}

/**
 * A processed rule may have a context.
 * In that case, the rule is converted to a path with the context as lhs and the rule itself as rhs.
 * @param {ast} rule
 */
function contextualize(rule) {
  if (rule.context) {
    // If the rule has a context, convert it to a path with the context as lhs
    const context = rule.context;
    delete rule.context; // remove context from the rule to avoid duplication
    return {
      type: 'binary',
      value: '.',
      lhs: context,
      rhs: toBlock(rule), // make it a block so the path is processsed for parent references
      position: rule.position,
      start: rule.start,
      line: rule.line
    };
  }
  // If no context, return the rule as is
  return rule;
}

/**
 * Takes a flashrule with a multi-step path and rewrites it into
 * nested flashrules, each with a single step path, preserving positions.
 *
 * The original inlineExpression is placed on the innermost node
 * and becomes the node itself (not nested under another flashrule),
 * mimicking how a single-step flashrule would be processed.
 */
function unchainMultiStepFlashRule(rule) {
  const { path, inlineExpression, expressions, context } = rule;
  const steps = path.steps;

  // Start by creating the innermost node:
  // If there is an inlineExpression, use it directly and attach the last path step
  let current;
  if (inlineExpression) {
    current = {
      ...inlineExpression,
      path: {
        type: "flashpath",
        steps: [steps[steps.length - 1]]
      },
      isFlashRule: true,
      isInlineExpression: true
    };
  } else {
    current = {
      type: "flashrule",
      path: {
        type: "flashpath",
        steps: [steps[steps.length - 1]]
      },
      isFlashRule: true
    };

    if (expressions) {
      current.expressions = expressions;
    }
  }

  // Recursively wrap each preceding path step
  for (let i = steps.length - 2; i >= 0; i--) {
    const step = steps[i];
    current = {
      type: "flashrule",
      path: {
        type: "flashpath",
        steps: [step]
      },
      expressions: [current],
      isFlashRule: true,
      position: step.position,
      start: step.start,
      line: step.line
    };
  }

  // add context to the root node if it exists
  if (context) {
    current.context = context;
  }
  return current;
}

/**
 * Converts an `Instance:` expression (e.g. "abc" or 123) found in a flashblock header
 * into a synthetic flashrule node, with a fixed path of `id`, mimicking:
 *   * id = "abc"
 *
 * This allows the block to be interpreted by the normal rule evaluation logic.
 */
function convertInstanceExprToRule (expr) {
  return {
    ...expr,
    path: {
      type: "flashpath",
      steps: [
        {
          value: "id",
          type: "name",
          position: expr.position,
          start: expr.start,
          line: expr.line
        }
      ]
    },
    isFlashRule: true, // explicitly mark as flashrule to guide later phases
    isInlineExpression: true // mark this value as originating from the instance line
  };
}

/**
 * Wrap a FLASH rule as a block with a single expression.
 * If it is already a block, return it unchanged
 * @param {*} rule - The rule to wrap
 * @returns {object} - The wrapped rule as a block
 */
function toBlock (rule) {
  if (rule.type === 'block') {
    return rule; // already a block, return as is
  }
  // If the rule is not a block, wrap it in a block structure
  const wrappingBlock = {
    type: 'block',
    position: rule.position,
    line: rule.line,
    start: rule.start,
    expressions: [rule]
  };

  return wrappingBlock;
}

export default preProcessAst;
