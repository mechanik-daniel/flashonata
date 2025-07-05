/* eslint-disable no-console */
import validateFhirTypeId from './validateFhirTypeId.js';
import resolveAncestry from './resolveAncestry.js';
import pushAncestry from './pushAncestry.js';
import seekParent from './seekParent.js';
import tailCallOptimize from './tailCallOptimize.js';

// post-parse stage
// the purpose of this is to add as much semantic value to the parse tree as possible
// in order to simplify the work of the evaluator.
// This includes flattening the parts of the AST representing location paths,
// converting them to arrays of steps which in turn may contain arrays of predicates.
// following this, nodes containing '.' and '[' should be eliminated from the AST.

const processAST = function (expr, ancestorWrapper, switchOnFlashFlag, recover, errors) {
  var result;
  var slot;
  switch (expr.type) {
    case 'binary':
      switch (expr.value) {
        case '.':
          var lstep = processAST(expr.lhs, ancestorWrapper, switchOnFlashFlag, recover, errors);

          if (lstep.type === 'path') {
            result = lstep;
          } else {
            result = {type: 'path', steps: [lstep]};
          }
          if(lstep.type === 'parent') {
            result.seekingParent = [lstep.slot];
          }
          var rest = processAST(expr.rhs, ancestorWrapper, switchOnFlashFlag, recover, errors);
          if (rest.type === 'function' &&
                                rest.procedure.type === 'path' &&
                                rest.procedure.steps.length === 1 &&
                                rest.procedure.steps[0].type === 'name' &&
                                result.steps[result.steps.length - 1].type === 'function') {
            // next function in chain of functions - will override a thenable
            result.steps[result.steps.length - 1].nextFunction = rest.procedure.steps[0].value;
          }
          if (rest.type === 'path') {
            Array.prototype.push.apply(result.steps, rest.steps);
          } else {
            if(typeof rest.predicate !== 'undefined') {
              rest.stages = rest.predicate;
              delete rest.predicate;
            }
            result.steps.push(rest);
          }
          // any steps within a path that are string literals, should be changed to 'name'
          result.steps.filter(function (step) {
            if (step.type === 'number' || step.type === 'value') {
              // don't allow steps to be numbers or the values true/false/null
              throw {
                code: "S0213",
                stack: (new Error()).stack,
                position: step.position,
                start: step.start,
                line: step.line,
                value: step.value
              };
            }
            return step.type === 'string';
          }).forEach(function (lit) {
            lit.type = 'name';
          });
          // any step that signals keeping a singleton array, should be flagged on the path
          if (result.steps.filter(function (step) {
            return step.keepArray === true;
          }).length > 0) {
            result.keepSingletonArray = true;
          }
          // if first step is a path constructor, flag it for special handling
          var firststep = result.steps[0];
          if (firststep.type === 'unary' && firststep.value === '[') {
            firststep.consarray = true;
          }
          // if the last step is an array constructor, flag it so it doesn't flatten
          var laststep = result.steps[result.steps.length - 1];
          if (laststep.type === 'unary' && laststep.value === '[') {
            laststep.consarray = true;
          }
          resolveAncestry(result, ancestorWrapper);
          break;
        case '[':
          // predicated step
          // LHS is a step or a predicated step
          // RHS is the predicate expr
          result = processAST(expr.lhs, ancestorWrapper, switchOnFlashFlag, recover, errors);
          var step = result;
          var type = 'predicate';
          if (result.type === 'path') {
            step = result.steps[result.steps.length - 1];
            type = 'stages';
          }
          if (typeof step.group !== 'undefined') {
            throw {
              code: "S0209",
              stack: (new Error()).stack,
              position: expr.position,
              start: expr.start,
              line: expr.line
            };
          }
          if (typeof step[type] === 'undefined') {
            step[type] = [];
          }
          var predicate = processAST(expr.rhs, ancestorWrapper, switchOnFlashFlag, recover, errors);
          if(typeof predicate.seekingParent !== 'undefined') {
            predicate.seekingParent.forEach(slot => {
              if(slot.level === 1) {
                seekParent(step, slot, ancestorWrapper);
              } else {
                slot.level--;
              }
            });
            pushAncestry(step, predicate);
          }
          step[type].push({type: 'filter', expr: predicate, position: expr.position, start: expr.start, line: expr.line});
          break;
        case '{':
          // group-by
          // LHS is a step or a predicated step
          // RHS is the object constructor expr
          result = processAST(expr.lhs, ancestorWrapper, switchOnFlashFlag, recover, errors);
          if (typeof result.group !== 'undefined') {
            throw {
              code: "S0210",
              stack: (new Error()).stack,
              position: expr.position,
              start: expr.start,
              line: expr.line
            };
          }
          // object constructor - process each pair
          result.group = {
            lhs: expr.rhs.map(function (pair) {
              return [processAST(pair[0], ancestorWrapper, switchOnFlashFlag, recover, errors), processAST(pair[1], ancestorWrapper, switchOnFlashFlag, recover, errors)];
            }),
            position: expr.position,
            start: expr.start,
            line: expr.line
          };
          break;
        case '^':
          // order-by
          // LHS is the array to be ordered
          // RHS defines the terms
          result = processAST(expr.lhs, ancestorWrapper, switchOnFlashFlag, recover, errors);
          if (result.type !== 'path') {
            result = {type: 'path', steps: [result]};
          }
          var sortStep = {type: 'sort', position: expr.position, start: expr.start, line: expr.line};
          sortStep.terms = expr.rhs.map(function (terms) {
            var expression = processAST(terms.expression, ancestorWrapper, switchOnFlashFlag, recover, errors);
            pushAncestry(sortStep, expression);
            return {
              descending: terms.descending,
              expression: expression
            };
          });
          result.steps.push(sortStep);
          resolveAncestry(result, ancestorWrapper);
          break;
        case ':=':
          result = {type: 'bind', value: expr.value, position: expr.position, start: expr.start, line: expr.line};
          result.lhs = processAST(expr.lhs, ancestorWrapper, switchOnFlashFlag, recover, errors);
          result.rhs = processAST(expr.rhs, ancestorWrapper, switchOnFlashFlag, recover, errors);
          pushAncestry(result, result.rhs);
          break;
        case '@':
          result = processAST(expr.lhs, ancestorWrapper, switchOnFlashFlag, recover, errors);
          step = result;
          if (result.type === 'path') {
            step = result.steps[result.steps.length - 1];
          }
          // throw error if there are any predicates defined at this point
          // at this point the only type of stages can be predicates
          if(typeof step.stages !== 'undefined' || typeof step.predicate !== 'undefined') {
            throw {
              code: "S0215",
              stack: (new Error()).stack,
              position: expr.position,
              start: expr.start,
              line: expr.line
            };
          }
          // also throw if this is applied after an 'order-by' clause
          if(step.type === 'sort') {
            throw {
              code: "S0216",
              stack: (new Error()).stack,
              position: expr.position,
              start: expr.start,
              line: expr.line
            };
          }
          if(expr.keepArray) {
            step.keepArray = true;
          }
          step.focus = expr.rhs.value;
          step.tuple = true;
          break;
        case '#':
          result = processAST(expr.lhs, ancestorWrapper, switchOnFlashFlag, recover, errors);
          step = result;
          if (result.type === 'path') {
            step = result.steps[result.steps.length - 1];
          } else {
            result = {type: 'path', steps: [result]};
            if (typeof step.predicate !== 'undefined') {
              step.stages = step.predicate;
              delete step.predicate;
            }
          }
          if (typeof step.stages === 'undefined') {
            step.index = expr.rhs.value;
          } else {
            step.stages.push({type: 'index', value: expr.rhs.value, position: expr.position, start: expr.start, line: expr.line});
          }
          step.tuple = true;
          break;
        case '~>':
          result = {type: 'apply', value: expr.value, position: expr.position, start: expr.start, line: expr.line};
          result.lhs = processAST(expr.lhs, ancestorWrapper, switchOnFlashFlag, recover, errors);
          result.rhs = processAST(expr.rhs, ancestorWrapper, switchOnFlashFlag, recover, errors);
          result.keepArray = result.lhs.keepArray || result.rhs.keepArray;
          break;
        default:
          result = {type: expr.type, value: expr.value, position: expr.position, start: expr.start, line: expr.line};
          result.lhs = processAST(expr.lhs, ancestorWrapper, switchOnFlashFlag, recover, errors);
          result.rhs = processAST(expr.rhs, ancestorWrapper, switchOnFlashFlag, recover, errors);
          pushAncestry(result, result.lhs);
          pushAncestry(result, result.rhs);
      }
      break;
    case 'unary':
      result = {type: expr.type, value: expr.value, position: expr.position, start: expr.start, line: expr.line};
      if (expr.value === '[') {
        // array constructor - process each item
        result.expressions = expr.expressions.map(function (item) {
          var value = processAST(item, ancestorWrapper, switchOnFlashFlag, recover, errors);
          pushAncestry(result, value);
          return value;
        });
      } else if (expr.value === '{') {
        // object constructor - process each pair
        result.lhs = expr.lhs.map(function (pair) {
          var key = processAST(pair[0], ancestorWrapper, switchOnFlashFlag, recover, errors);
          pushAncestry(result, key);
          var value = processAST(pair[1], ancestorWrapper, switchOnFlashFlag, recover, errors);
          pushAncestry(result, value);
          return [key, value];
        });
      } else {
        // all other unary expressions - just process the expression
        result.expression = processAST(expr.expression, ancestorWrapper, switchOnFlashFlag, recover, errors);
        // if unary minus on a number, then pre-process
        if (expr.value === '-' && result.expression.type === 'number') {
          result = result.expression;
          result.value = -result.value;
        } else {
          pushAncestry(result, result.expression);
        }
      }
      break;
    case 'function':
    case 'partial':
      result = {type: expr.type, name: expr.name, value: expr.value, position: expr.position, start: expr.start, line: expr.line};
      result.arguments = expr.arguments.map(function (arg) {
        var argAST = processAST(arg, ancestorWrapper, switchOnFlashFlag, recover, errors);
        pushAncestry(result, argAST);
        return argAST;
      });
      result.procedure = processAST(expr.procedure, ancestorWrapper, switchOnFlashFlag, recover, errors);
      break;
    case 'lambda':
      result = {
        type: expr.type,
        arguments: expr.arguments,
        signature: expr.signature,
        position: expr.position,
        start: expr.start,
        line: expr.line
      };
      var body = processAST(expr.body, ancestorWrapper, switchOnFlashFlag, recover, errors);
      result.body = tailCallOptimize(body);
      break;
    case 'condition':
      result = {type: expr.type, position: expr.position, start: expr.start, line: expr.line};
      result.condition = processAST(expr.condition, ancestorWrapper, switchOnFlashFlag, recover, errors);
      pushAncestry(result, result.condition);
      result.then = processAST(expr.then, ancestorWrapper, switchOnFlashFlag, recover, errors);
      pushAncestry(result, result.then);
      if (typeof expr.else !== 'undefined') {
        result.else = processAST(expr.else, ancestorWrapper, switchOnFlashFlag, recover, errors);
        pushAncestry(result, result.else);
      }
      break;
    case 'coalesce':
      result = {type: expr.type, position: expr.position, start: expr.start, line: expr.line};
      result.condition = processAST(expr.condition, ancestorWrapper, switchOnFlashFlag, recover, errors);
      pushAncestry(result, result.condition);
      result.else = processAST(expr.else, ancestorWrapper, switchOnFlashFlag, recover, errors);
      pushAncestry(result, result.else);
      break;
    case 'transform':
      result = {type: expr.type, position: expr.position, start: expr.start, line: expr.line};
      result.pattern = processAST(expr.pattern, ancestorWrapper, switchOnFlashFlag, recover, errors);
      result.update = processAST(expr.update, ancestorWrapper, switchOnFlashFlag, recover, errors);
      if (typeof expr.delete !== 'undefined') {
        result.delete = processAST(expr.delete, ancestorWrapper, switchOnFlashFlag, recover, errors);
      }
      break;
    case 'block':
      result = {type: expr.type, position: expr.position, start: expr.start, line: expr.line};
      if (expr.isFlashBlock) {
        // console.debug('Processing FLASH block', JSON.stringify(expr, null, 2));
        if (expr.instanceof && !validateFhirTypeId(expr.instanceof)) {
          var typeIdError = {
            code: 'F1026',
            position: expr.position,
            start: expr.start,
            line: expr.line,
            token: 'InstanceOf:',
            value: expr.instanceof
          };
          if (recover) {
            errors.push(typeIdError);
            return {type: 'error', error: typeIdError};
          } else {
            typeIdError.stack = (new Error()).stack;
            throw typeIdError;
          }
        }
        switchOnFlashFlag();
        result.isFlashBlock = true;
        result.instanceof = expr.instanceof;
      }
      if (expr.isFlashRule) {
        // console.debug('Processing FLASH rule', JSON.stringify(expr, null, 2));
        result.isFlashRule = true;
        result.fullPath = expr.fullPath;
        result.name = expr.name;
        result.value = expr.value;
        result.path = expr.path;
      }
      // array of expressions - process each one
      result.expressions = expr.expressions.map(function (item) {
        var part = processAST(item, ancestorWrapper, switchOnFlashFlag, recover, errors);
        pushAncestry(result, part);
        if (part.consarray || (part.type === 'path' && part.steps[0].consarray)) {
          result.consarray = true;
        }
        return part;
      });
      // TODO scan the array of expressions to see if any of them assign variables
      // if so, need to mark the block as one that needs to create a new frame
      if (expr.rootFhirType) result.rootFhirType = expr.rootFhirType;
      break;
    case 'name':
      result = {type: 'path', steps: [expr]};
      if (expr.keepArray) {
        result.keepSingletonArray = true;
      }
      break;
    case 'parent':
      slot = {
        label: '!' + ancestorWrapper.bumpLabel(),
        level: 1,
        index: ancestorWrapper.bumpIndex()
      };
      result = {
        type: 'parent',
        slot
        // seekingParent: [slot]
      };
      ancestorWrapper.pushAncestor(result);
      break;
    case 'string':
    case 'number':
    case 'value':
    case 'wildcard':
    case 'descendant':
    case 'variable':
    case 'regex':
      result = expr;
      break;
    // case 'flashblock':
    //   switchOnFlashFlag();
    //   result = {
    //     type: expr.type,
    //     position: expr.position,
    //     start: expr.start,
    //     line: expr.line,
    //     instanceof: expr.instanceof
    //   };
    //   if (expr.instance) {
    //     result.instance = processAST(expr.instance, ancestorWrapper, switchOnFlashFlag, recover, errors);
    //   }
    //   if (expr.rules && expr.rules.length > 0) {
    //     result.rules = expr.rules.map((rule) => processAST(rule, ancestorWrapper, switchOnFlashFlag, recover, errors));
    //   }
    //   break;
    // case 'flashrule':
    //   // console.log('Processing flashrule', JSON.stringify(expr, null, 2));
    //   result = {
    //     type: expr.type,
    //     position: expr.position,
    //     start: expr.start,
    //     line: expr.line,
    //     name: expr.name,
    //     value: expr.value,
    //     fullPath: expr.fullPath,
    //     path: expr.path
    //   };
    //   if (expr.expression) {
    //     result.expression = processAST(expr.expression, ancestorWrapper, switchOnFlashFlag, recover, errors);
    //   }
    //   if (expr.rules && expr.rules.length > 0) {
    //     result.rules = expr.rules.map((rule) => processAST(rule, ancestorWrapper, switchOnFlashFlag, recover, errors));
    //   }
    //   result.rootFhirType = expr.rootFhirType;
    //   break;
    case 'operator':
      // the tokens 'and' and 'or' might have been used as a name rather than an operator
      if (expr.value === 'and' || expr.value === 'or' || expr.value === 'in') {
        expr.type = 'name';
        result = processAST(expr, ancestorWrapper, switchOnFlashFlag, recover, errors);
      } else /* c8 ignore else */ if (expr.value === '?') {
        // partial application
        result = expr;
      } else {
        throw {
          code: "S0201",
          stack: (new Error()).stack,
          position: expr.position,
          start: expr.start,
          line: expr.line,
          token: expr.value
        };
      }
      break;
    case 'error':
      result = expr;
      if (expr.lhs) {
        result = processAST(expr.lhs, ancestorWrapper, switchOnFlashFlag, recover, errors);
      }
      break;
    default:
      var code = "S0206";
      /* c8 ignore else */
      if (expr.id === '(end)') {
        code = "S0207";
      }
      var err = {
        code: code,
        position: expr.position,
        start: expr.start,
        line: expr.line,
        token: expr.value
      };
      if (recover) {
        errors.push(err);
        return {type: 'error', error: err};
      } else {
        err.stack = (new Error()).stack;
        throw err;
      }
  }
  if (expr.keepArray) {
    result.keepArray = true;
  }
  return result;
};

export default processAST;