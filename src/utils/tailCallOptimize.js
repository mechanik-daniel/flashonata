/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata).
JSONata portions: © IBM Corp. 2016–2018, licensed under the MIT License.
See NOTICE and LICENSES/MIT-JSONata.txt for details.

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

// tail call optimization
// this is invoked by the post parser to analyse lambda functions to see
// if they make a tail call.  If so, it is replaced by a thunk which will
// be invoked by the trampoline loop during function application.
// This enables tail-recursive functions to be written without growing the stack
const tailCallOptimize = function (expr) {
  var result;
  if (expr.type === 'function' && !expr.predicate) {
    var thunk = {type: 'lambda', thunk: true, arguments: [], position: expr.position, start: expr.start, line: expr.line};
    thunk.body = expr;
    result = thunk;
  } else if (expr.type === 'condition') {
    // analyse both branches
    expr.then = tailCallOptimize(expr.then);
    if (typeof expr.else !== 'undefined') {
      expr.else = tailCallOptimize(expr.else);
    }
    result = expr;
  } else if (expr.type === 'block') {
    // only the last expression in the block
    var length = expr.expressions.length;
    if (length > 0) {
      expr.expressions[length - 1] = tailCallOptimize(expr.expressions[length - 1]);
    }
    result = expr;
  } else {
    result = expr;
  }
  return result;
};

export default tailCallOptimize;