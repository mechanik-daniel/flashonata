/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/**
 * @module VirtualRuleEvaluator
 * @description Handles evaluation of virtual FLASH rules for auto-generation scenarios
 */

/**
 * Virtual rule evaluator for auto-generating missing mandatory elements
 */
class VirtualRuleEvaluator {
  /**
   * Create and evaluate a virtual FLASH rule
   * @param {Function} evaluate - The main evaluate function
   * @param {Object} sourceExpr - Source expression to copy context from
   * @param {string} targetFlashPathRefKey - Target FLASH path reference key for the virtual rule
   * @param {Object} environment - Evaluation environment
   * @returns {Promise<*>} Evaluated virtual rule result or undefined
   */
  static async evaluateVirtualRule(evaluate, sourceExpr, targetFlashPathRefKey, environment) {
    try {
      // Create a virtual rule AST node with technical structure abstracted away
      const virtualRuleNode = this.createVirtualRuleNode(sourceExpr, targetFlashPathRefKey);

      // Evaluate the virtual rule
      const autoValue = await evaluate(virtualRuleNode, undefined, environment);

      return autoValue;
    } catch (error) {
      // Virtual rule evaluation failures are expected and should be ignored
      return undefined;
    }
  }

  /**
   * Create a virtual rule AST node for evaluation
   * @param {Object} sourceExpr - Source expression to copy context from
   * @param {string} targetFlashPathRefKey - Target FLASH path reference key
   * @returns {Object} Virtual rule AST node
   * @private
   */
  static createVirtualRuleNode(sourceExpr, targetFlashPathRefKey) {
    return {
      type: 'unary',
      value: '[',
      isFlashRule: true,
      isVirtualRule: true,
      expressions: [],
      instanceof: sourceExpr.instanceof,
      flashPathRefKey: targetFlashPathRefKey,
      position: sourceExpr.position,
      start: sourceExpr.start,
      line: sourceExpr.line
    };
  }
}

export default VirtualRuleEvaluator;
