/* eslint-disable no-console */
/* eslint-disable valid-jsdoc */
/**
 * © Copyright IBM Corp. 2016, 2018 All Rights Reserved
 *   Project name: JSONata
 *   This project is licensed under the MIT License, see LICENSE
 */

import parseSignature from './utils/signature.js';
import operators from './utils/operators.js';
import tokenizer from './utils/tokenizer.js';
import processAST from './utils/processAst.js';
import contextualizeRule from './utils/contextualizeRule.js';
import normalizeFlashPath from './utils/normalizeFlashPath.js';
import unchainFlashRule from './utils/unchainFlashRule.js';

const parser = (() => {

  /**
     * Runs the scanner/tokenizer/lexer on the whole input and return an array of simple tokens
     * @param {string} source The source as raw string
     * @returns {Array} Array of all simple tokens identified by the scanner
     */

  // This parser implements the 'Top down operator precedence' algorithm developed by Vaughan R Pratt; http://dl.acm.org/citation.cfm?id=512931.
  // and builds on the Javascript framework described by Douglas Crockford at http://javascript.crockford.com/tdop/tdop.html
  // and in 'Beautiful Code', edited by Andy Oram and Greg Wilson, Copyright 2007 O'Reilly Media, Inc. 798-0-596-51004-6

  var parser = function (source, recover) {
    /**
         * The node variable (token in Crockford's implementation) always contains the current token.
         */
    var node;
    var lexer;

    /**
         * Every token, such as an operator or identifier, will inherit from a symbol.
         * We will keep all of our symbols (which determine the types of tokens in our language) in a symbol_table object.
         */
    var symbol_table = {};
    var errors = [];

    var remainingTokens = function () {
      var remaining = [];
      if (node.id !== '(end)') {
        remaining.push({type: node.type, value: node.value, position: node.position, line: node.line, start: node.start});
      }
      var nxt = lexer();
      while (nxt !== null) {
        remaining.push(nxt);
        nxt = lexer();
      }
      return remaining;
    };

    /** The base_symbol (original_symbol in Crockford's implementation) object is the prototype for all other symbols.
         * Its methods will usually be overridden.
         * The Null Denotation (or nud) of a token is the procedure and arguments applying for that token when Left, an unclaimed parsed expression is not extant.
         * The Left Denotation (or led) of a token is the procedure, arguments, and lbp applying for that token when there is a Left, an unclaimed parsed expression.
         * A nud does not care about the tokens to the left. A led does.
         * A nud method is used by values (such as variables and literals) and by prefix operators.
         * A led method is used by infix operators and suffix operators.
         * A token may have both a nud method and a led method.
         * For example, - might be both a prefix operator (negation) and an infix operator (subtraction), so it would have both nud and led methods.
         */
    var base_symbol = {
      nud: function () {
        // error - symbol has been invoked as a unary operator
        var err = {
          code: 'S0211',
          token: this.value,
          position: this.position,
          start: this.start,
          line: this.line
        };

        if (recover) {
          err.remaining = remainingTokens();
          err.type = 'error';
          errors.push(err);
          return err;
        } else {
          err.stack = (new Error()).stack;
          throw err;
        }
      }
    };

    /**
         * Let's define a function that makes symbols.
         * It takes a symbol id and an optional binding power that defaults to 0 and returns a symbol object for that id.
         * If the symbol already exists in the symbol_table, the function returns that symbol object.
         * Otherwise, it makes a new symbol object that inherits from the base_symbol, stores it in the symbol table, and returns it.
         * A symbol object initially contains an id, a value, a left binding power, and the nud and led it inherits from base_symbol.
         * @param {string} id symbol id
         * @param {number} bp binding power
         * @returns a symbol object
         */
    var symbol = function (id, bp) {
      var s = symbol_table[id];
      bp = bp || 0;
      if (s) {
        if (bp >= s.lbp) {
          s.lbp = bp;
        }
      } else {
        s = Object.create(base_symbol);
        s.id = s.value = id;
        s.lbp = bp;
        symbol_table[id] = s;
      }
      return s;
    };

    var handleError = function (err) {
      if (recover) {
        // tokenize the rest of the buffer and add it to an error token
        err.remaining = remainingTokens();
        errors.push(err);
        var symbol = symbol_table["(error)"];
        node = Object.create(symbol);
        node.error = err;
        node.type = "(error)";
        return node;
      } else {
        err.stack = (new Error()).stack;
        throw err;
      }
    };

    /**
         * The advance function makes a new token object from the next simple token in the array and assigns it
         * to the token variable.
         * It can take an optional id parameter which it can check against the id of the previous token.
         * @param {string} id checked against the id of the previous token
         * @param {boolean} infix
         * @returns token (node)
         */
    var advance = function (id, infix, lookForFlash) {
      // In Crockford's implementation, we assume that the source text has been transformed into an array of simple token
      // objects (tokens), each containing a type (string) and a value (string or number).
      // In this implementation, the token array is built as we go, and the next token is returned by the lexer (next() function)
      // the node variable is currently set to the previous token
      lookForFlash = lookForFlash || false;
      if (id && // id argument provided
                node.id !== id // AND it's not the same as the previous node.id
      ) {
        var code;
        if (node.id === '(end)') {
          // Previous node is the end of the source, so we can't advance further to look for {id}
          // Expected {{id}} before end of expression
          code = "S0203";
        } else {
          // Previous node has as id and it's different from the one we are looking for
          //"Expected {{id}}, got {{token}}"
          code = "S0202";
        }
        var err = {
          code: code,
          position: node.position,
          start: node.start,
          line: node.line,
          token: node.value,
          value: id
        };
        return handleError(err);
      }
      /** Track line number */
      var line;
      var indent;
      if (node && node.indent >= 0) {
        indent = node.indent;
      }
      /** Need this to initialize at 1 */
      if (node && Object.prototype.hasOwnProperty.call(node, 'line')) {
        line = node.line; // Set to previous node's line
      } else {
        line = 1; // Initialize
      }
      // Track indent number
      if (node && node.id === '(indent)') {
        indent = node.value; // Set to previous node's line
      }
      /** Fetch next simple token from the scanner */
      var next_token = lexer(infix, lookForFlash);
      if (next_token === null) {
        // When the scanner has no more tokens to consume from the source it returns null
        // So we create an (end) token and return it, but not before we override the node variable
        node = symbol_table["(end)"];
        node.position = source.length;
        node.start = source.length - 1;
        node.line = line;
        return node;
      }
      if (next_token.type === 'indent' && lookForFlash === false) {
        next_token = lexer(infix, false);
      }
      /** Start preparing the processed token to return and override the `node` var with */
      var value = next_token.value;
      var type = next_token.type;
      var symbol;
      switch (type) {
        case 'name':
        case 'variable':
          symbol = symbol_table["(name)"];
          break;
        case 'operator':
          symbol = symbol_table[value];
          if (!symbol) {
            return handleError({
              code: "S0204",
              stack: (new Error()).stack,
              position: next_token.position,
              start: next_token.start,
              line: next_token.line,
              token: value
            });
          }
          if (value === '*' || value === '$') {
            symbol.indent = indent;
          }
          break;
        case 'string':
        case 'number':
        case 'value':
        case 'url':
          symbol = symbol_table["(literal)"];
          break;
        case 'regex':
          type = "regex";
          symbol = symbol_table["(regex)"];
          break;
        case 'indent':
          // Regular indents are not skipped, they will be used as seperators inside flash blocks.
          symbol = symbol_table[`(indent)`];
          break;
        case 'blockindent':
          // we can skip indents if they are before declarations (blockindent).
          // We just need to pass the indent value to the next token
          // symbol = symbol_table["(indent)"];
          // Handle flash indentation tokens.
          // var indentSymbol = symbol_table["(indent)"];
          var indentValue = next_token.value; // this is the indent number
          // go to next token
          next_token = lexer(infix, true);
          /* c8 ignore else */
          if (next_token.type === 'operator' && next_token.value === 'Instance:') {
            // It's a FLASH Instance: delaration
            type = 'instance';
            symbol = symbol_table['Instance:'];
            symbol.indent = indentValue;
          } else if (next_token.type === 'instanceof') {
            // It's an InstanceOf: declaration
            type = 'instanceof';
            symbol = symbol_table['(instanceof)'];
            symbol.indent = indentValue;
          }
          value = next_token.value;
          break;
          /* c8 ignore next */
        default:
          return handleError({
            code: "S0205",
            stack: (new Error()).stack,
            position: next_token.position,
            start: next_token.start,
            line: next_token.line,
            token: value
          });
      }
      /** This is where we override the node variable with a new processed token */
      node = Object.create(symbol);
      node.value = value;
      node.type = type;
      node.position = next_token.position;
      node.start = next_token.start;
      node.line = next_token.line;
      if (Object.prototype.hasOwnProperty.call(symbol, 'indent')) {
        // we explicitly add the indent member to the node so it would show in the resulting tree when stringified.
        // Otherwise it may look like the indent number wasn't registered because attributes inherited from
        // the prototype object are hidden (like the id, lbp, nud and led)
        node.indent = symbol.indent;
      }
      return node;
    };

    // Pratt's algorithm
    /**
         * The heart of Pratt's technique is the expression function.
         * It takes a right binding power that controls how aggressively it binds to tokens on its right.
         * expression() takes the current token's nud (aka head handler), and uses it to process the next token.
         * Then as long as the right binding power is less than the left binding power of the next token,
         * the led method (aka tail handler) of the current token is invoked on the following token.
         * The led is used to process infix and suffix operators.
         * This process can be recursive because the nud and led methods can call expression().
         * @param {number} rbp Right binding power
         * @returns expression object
         */
    var expression = function (rbp, lookForFlash) {
      var left;
      var token = node; // save current node as token
      advance(null, true, lookForFlash); // advance node to the next token
      left = token.nud(lookForFlash); // save result of calling the previous head handler on current node
      while (rbp < node.lbp) { // if and while current node's lbp is higher than the provided rbp
        token = node; // save current node as token
        advance(null, null, lookForFlash);// advance node to next token
        left = token.led(left, lookForFlash); // accumulate results of recursive calls to the tail handler
      }
      return left;
      // if we simulate parsing the expression `1 + 2 * 3` using expression(0) (rbp-0):
      // - current node is literal 1 (terminal)
      // - save token = literal 1
      // - advancing node to the next token
      // - node is now `+`, it's left binding power is 50.
      // - calling the literal 1 token's nud.
      // - it returns itself since it's a terminal (literal 1)
      // - left is now literal 1
      // - loop starts since rbp(0) < node(+).lbp(50)
      // - save token: + operator
      // - advance node
      // - node is now literal 2
      // - call the `+' operator's led on left (literal 1)
      // - it returns a '+' node with:
      //  - lhs: left (literal 1)
      //  - rhs: the result of calling expression(50)
      //      - we start at literal 2
      //      - advancing, node now at *. binding power is 60.
      //      - calling literal 2 token's nud and it returns itself
      //      - left is now literal 2
      //      - loop starts since rbp(50) < node(*).lbp(60)
      //      - token is now * operator
      //      - advancing node, it is now at literal 3
      //      - call the `*` operator's led on left (literal 2)
      //      - returns a '*' node with lhs = literal 2 (left)
      //      - rhs: the result of calling expression(60)
      //          - starting at node = literal 3
      //          - advancing, we get node = (end)
      //          - calling literal 3 nud - returns itself
      //          - left is now literal 3 (left of end)
      //          - loop is skipped since literal's lbp is 0 and rbp(60) is greater than that
      //          - returning literal 3
      // So we get a root '+' node with lhs = literal 1, and rhs which is a * node, that has
      // lhs = literal 2 and rhs = literal 3
    };

    /**
         * A terminal does not care about what's on the right or the left, it is a subexpression on itself and
         * doesn't bind anywhere (bp=0). It may be preceded or followed by operators that do something with it,
         * but that's their job and not the terminal's. Hence, it only has a nud (head handler), and it just returns
         * itself
         * @param {string} id symbol id
         */
    var terminal = function (id) {
      var s = symbol(id, 0);
      s.nud = function () {
        return this;
      };
    };


    /**
         * Create a left associative infix operator: <expression> <operator> <expression>
         * It takes an operator (symbol) id, a binding power and an led function.
         * If bp is not supplied, it will default to the bp defined in `operators`, otherwise 0.
         * If led is not supplied it will use a default led function that registers the left,
         * parses the right, and wrappes it in a binary node.
         * @param {string} id - the token identifier (symbol id)
         * @param {number} bp - the binding power to override with
         * @param {Function} led - The left-denotation function to override the default one with
         * @returns {Object} - a symbol object
         */
    var infix = function (id, bp, led) {
      var bindingPower = bp || operators[id];
      var s = symbol(id, bindingPower);
      s.led = led || function (left, lookForFlash) {
        this.lhs = left;
        this.rhs = expression(bindingPower, lookForFlash);
        this.type = "binary";
        return this;
      };
      return s;
    };

    /**
         * Create a right associative infix operator: <expression> <operator> <expression>
         * It takes an operator (symbol) id, a binding power and a led function.
         * If bp is not supplied, it will default to the bp defined in `operators`, otherwise 0.
         * When a right associative operator scans the rhs expression, it uses an expression binding power of bp-1.
         * This means that when encountering the same operator again, the first pair will not combine into the
         * lhs of the next operator - but the two later operands will be combined into the rhs of the first.
         * The only infixr tokens defined at the moment are ':=' and '(error)'
         * @param {string} id - the token identifier (symbol id)
         * @param {number} bp - the binding power to override with
         * @param {Function} led - The left-denotation function to override the default one with
         * @returns {Object} - a symbol object
         */
    var infixr = function (id, bp, led) {
      var s = symbol(id, bp);
      s.led = led;
      return s;
    };

    // match prefix operators
    // <operator> <expression>
    var prefix = function (id, nud) {
      var s = symbol(id);
      s.nud = nud || function () {
        this.expression = expression(70);
        this.type = "unary";
        return this;
      };
      return s;
    };

    terminal("(end)");
    terminal("(name)");
    terminal("(literal)");
    terminal("(regex)");
    terminal("(indent)");
    symbol(":");
    symbol(";");
    symbol(",");
    symbol(")");
    symbol("]");
    symbol("}");
    symbol(".."); // range operator
    infix("."); // map operator
    infix("+"); // numeric addition
    infix("-"); // numeric subtraction
    infix("*"); // numeric multiplication
    infix("/"); // numeric division
    infix("%"); // numeric modulus
    infix("="); // equality
    infix("<"); // less than
    infix(">"); // greater than
    infix("!="); // not equal to
    infix("<="); // less than or equal
    infix(">="); // greater than or equal
    infix("&"); // string concatenation
    infix("and"); // Boolean AND
    infix("or"); // Boolean OR
    infix("in"); // is member of array
    terminal("and"); // the 'keywords' can also be used as terminals (field names)
    terminal("or"); //
    terminal("in"); //
    prefix("-"); // unary numeric negation
    infix("~>"); // function application

    infixr("(error)", 10, function (left) {
      this.lhs = left;

      this.error = node.error;
      this.remaining = remainingTokens();
      this.type = 'error';
      return this;
    });

    // since a flash block expression can be initialized both by Instance: and InstanceOf: keywords,
    // both prefix handlers should collect rules using the same function.
    // In both cases, this function is only called after the InstanceOf: keyword, so it should not encounter an
    // 'Instance:' token after it. If it does, that's an error.
    // The only valid expression types are flashrule and ':=' (bind)
    var collectRules = function (level, root) {
      root = root || 0;
      if (node.type === 'instance') {
        // Instance:` declaration must come BEFORE `InstanceOf:`
        return handleError({
          code: "F1010",
          stack: (new Error()).stack,
          position: node.position,
          start: node.start,
          line: node.line,
          token: node.id
        });
      }
      var rules = [];
      if (node.id === '(indent)' && node.value > level) {
        return handleError({
          code: "F1017",
          stack: (new Error()).stack,
          position: node.position,
          start: node.start,
          line: node.line,
          token: `${String(level)} spaces`,
          value: `${String(node.value)} spaces`
        });
      }
      if (node.id === '(indent)' && node.value < root) {
        return handleError({
          code: "F1016",
          stack: (new Error()).stack,
          position: node.position,
          start: node.start,
          line: node.line,
          token: `${String(root)} spaces`,
          value: `${String(node.value)} spaces`
        });
      }
      while (node.id !== ")" && node.id !== "(end)") {
        var indent = node.indent;
        if (node.id === "(indent)") {
          if (node.value === level) {
            indent = node.value;
            advance("(indent)", null, true);
          } else {
            if ((level - node.value) % 2 !== 0) {
              return handleError({
                code: "F1021",
                stack: (new Error()).stack,
                position: node.position,
                start: node.start,
                line: node.line,
                token: '(indent)',
                value: `${String(node.value)} spaces`
              });
            }
            break;
          }
        }
        var rule = expression(0, true);
        if ((rule.type !== 'block' || !rule.isFlashRule) && rule.id !== ':=') {
          if (rule.id === '=') {
            return handleError({
              code: "F1025",
              stack: (new Error()).stack,
              position: rule.position,
              start: rule.start,
              line: rule.line,
              token: rule.id
            });
          } else {
            return handleError({
              code: "F1011",
              stack: (new Error()).stack,
              position: rule.position,
              start: rule.start,
              line: rule.line,
              token: rule.id
            });
          }
        }
        rule.indent = rule.indent || indent;
        if (rule.isFlashRule && rule.path) {
          // try to normalize the path, catch any errors and bubble them up
          try {
            rule.path = normalizeFlashPath(rule.path);
          } catch (e) {
            return handleError(
              e.value ? e : {
                code: "F1027",
                stack: e.stack,
                position: rule.path.position,
                start: rule.path.start,
                line: rule.path.line,
                value: rule.path.value
              });
          }
          rule = unchainFlashRule(rule);
          // console.log(`Unchained flash rule: ${JSON.stringify(rule, null, 2)}`);
        }
        if (rule.context) {
          rule = contextualizeRule(rule);
        }
        rules.push(rule);
        if (node.id === ';') advance(null, null, true);
        if (node.id !== "(indent)" || node.value < level) {
          break;
        }
        advance("(indent)", null, true);
      }
      return rules;
    };


    // field wildcard (single level) OR flash rule
    prefix('*', function (isFlash) {
      if (isFlash) {
        var indent = this.indent;
        // set type to block and isFlashRule to true
        this.isFlashRule = true;
        this.type = 'block';
        this.expressions = [];
        if (node.id === '(') {
          this.context = expression(75, true);
          advance(".", true, true);
        }
        this.path = expression(40, true);
        var position = node.position;
        var line = node.line;
        if (node.id === '=') {
          advance('=', null, true);
          if (node.id !== '(end)' && node.id !== '(indent)') {
            // inline value assignment is treated as the first rule in the block
            this.expressions.push(expression(0, true));
            this.expressions[0].isFlashValue = true;
          } else {
            return handleError({
              code: "F1012",
              stack: (new Error()).stack,
              position: position,
              start: node.start,
              line: line,
              token: "="
            });
          }
        }
        if (node.id === ':=') { // user tried to assign into a path and not variable
          return handleError({
            code: "F1020",
            stack: (new Error()).stack,
            position,
            line,
            token: ':='
          });
        }
        if (this.path && this.path.isFlashRule) { // double * *
          return handleError({
            code: "F1022",
            stack: (new Error()).stack,
            position,
            line,
            token: '*'
          });
        }
        if (this.path && (this.path.type === 'variable' || this.path.id === ':=')) { // $ after *
          return handleError({
            code: "F1023",
            stack: (new Error()).stack,
            position,
            line,
            token: '$'
          });
        }
        if (this.path && this.path.id === '(end)') { // empty rule
          return handleError({
            code: "F1024",
            stack: (new Error()).stack,
            position: this.position,
            start: this.start,
            line: this.line,
            token: '*'
          });
        }
        this.indent = indent;
        var subrules;
        subrules = collectRules(indent + 2, null);
        // append subrules to the expressions array
        if (subrules.length > 0) this.expressions.push(...subrules);
        return this;
      } else {
        this.type = "wildcard";
        return this;
      }
    });

    // The Instance: keyword is a prefix for the instance id expression that comes after it.
    // It also initiates a flash block scanning, where the next token MUST be (instanceof),
    // optionally followed by rules. Rules are collected and returned as children of the flashblock token.
    prefix('Instance:', function () {
      var instanceExpr = expression(0, true); // this is the expression after Instance:
      if (instanceExpr.id === '(instanceof)') {
        // if it's a flashblock it means there is no expression between `Instance:` and `InstanceOf:` - throw error
        return handleError({
          code: "F1018",
          stack: (new Error()).stack,
          position: instanceExpr.position,
          start: instanceExpr.start,
          line: instanceExpr.line,
          token: instanceExpr.id,
          value: 'InstanceOf:'
        });
      }
      // flag it as an instance expression
      instanceExpr.isInstanceId = true;
      // set node type to block and isFlashBlock to true
      this.type = "block";
      this.isFlashBlock = true;
      // initialize the expressions array
      this.expressions = [];
      // push the instance expression to the expressions array
      this.expressions.push(instanceExpr);
      delete this.value;
      if (node.id !== '(instanceof)') {
        // Instance: <expr> without InstanceOf: immediately after it
        return handleError({
          code: "F1009",
          stack: (new Error()).stack,
          position: node.position,
          start: node.start,
          line: node.line,
          token: node.id
        });
      }
      if (node.line === this.expressions[0].line) {
        // InstanceOf: at the same line as Instance:
        return handleError({
          code: "F1013",
          stack: (new Error()).stack,
          position: node.position,
          start: node.start,
          line: node.line,
          token: node.id
        });
      }
      if (node.indent !== this.indent) {
        // indentation of InstanceOf: must be same as Instance:
        return handleError({
          code: "F1014",
          stack: (new Error()).stack,
          position: node.position,
          start: node.start,
          line: node.line,
          token: `${String(this.indent)} spaces`,
          value: `${String(node.indent)} spaces`
        });
      }
      this.instanceof = node.value;
      if (!this.instanceof || this.instanceof === '') {
        return handleError({
          code: "F1019",
          stack: (new Error()).stack,
          position: this.position,
          start: this.start,
          line: this.line,
          token: "InstanceOf:"
        });
      }

      advance(null, null, true); // proceeed to the next token after InstanceOf:
      var rules = collectRules(this.indent, this.indent);
      if (rules.length > 0) this.expressions.push(...rules);
      return this;
    });

    // The InstanceOf: keyword is a prefix for the rules in a block initiated by it, not for the actual profile/resource identifier
    // The identifier is "swallowed" by the 'InstanceOf:' token and used as it's value. This happens in the lexer.
    // For this reason, it is treated as a terminal and has an id of (instanceof) and not the original keyword
    // "InstanceOf:". Terminal symbols represent a token whose possible values cannot be predicted since
    // they are user-defined and not fixed into the language's grammer.
    // This token is optionally followed by rules.
    // Rules are collected and returned as children of the flashblock token.
    prefix('(instanceof)', function () {
      if (!this.value || this.value === '') {
        // if the value is empty, it means that the InstanceOf: token was not followed by a FHIR structure identifier
        return handleError({
          code: "F1019",
          stack: (new Error()).stack,
          position: this.position,
          start: this.start,
          line: this.line,
          token: "InstanceOf:"
        });
      }
      // set node type to block and isFlashBlock to true
      this.type = "block";
      this.isFlashBlock = true;
      // initialize the expressions array
      this.expressions = [];
      // set the InstanceOf value
      this.instanceof = this.value;
      // delete the value so it won't be included in the resulting tree
      delete this.value;
      var rules = collectRules(this.indent, this.indent);
      if (rules.length > 0) this.expressions.push(...rules);
      return this;
    });

    // descendant wildcard (multi-level)
    prefix('**', function () {
      this.type = "descendant";
      return this;
    });

    // parent operator
    prefix('%', function () {
      this.type = "parent";
      return this;
    });

    // function invocation
    infix("(", operators['('], function (left) {
      // left is is what we are trying to invoke
      this.procedure = left;
      this.type = 'function';
      this.arguments = [];
      if (node.id !== ')') {
        for (; ;) {
          if (node.type === 'operator' && node.id === '?') {
            // partial function application
            this.type = 'partial';
            this.arguments.push(node);
            advance('?');
          } else {
            this.arguments.push(expression(0));
          }
          if (node.id !== ',') break;
          advance(',');
        }
      }
      advance(")", true);
      // if the name of the function is 'function' or λ, then this is function definition (lambda function)
      if (left.type === 'name' && (left.value === 'function' || left.value === '\u03BB')) {
        // all of the args must be VARIABLE tokens
        this.arguments.forEach(function (arg, index) {
          if (arg.type !== 'variable') {
            return handleError({
              code: "S0208",
              stack: (new Error()).stack,
              position: arg.position,
              start: arg.start,
              line: arg.line,
              token: arg.value,
              value: index + 1
            });
          }
        });
        this.type = 'lambda';
        // is the next token a '<' - if so, parse the function signature
        if (node.id === '<') {
          var sigPos = node.position;
          var depth = 1;
          var sig = '<';
          while (depth > 0 && node.id !== '{' && node.id !== '(end)') {
            var tok = advance();
            if (tok.id === '>') {
              depth--;
            } else if (tok.id === '<') {
              depth++;
            }
            sig += tok.value;
          }
          advance('>');
          try {
            this.signature = parseSignature(sig);
          } catch (err) {
            // insert the position into this error
            err.position = sigPos + err.offset;
            err.start = sigPos;
            err.line = node.line;
            return handleError(err);
          }
        }
        // parse the function body
        advance('{');
        this.body = expression(0);
        advance('}');
      }
      return this;
    });

    // parenthesis - block expression
    prefix("(", function () {
      var expressions = [];
      while (node.id !== ")") {
        expressions.push(expression(0));
        if (node.id !== ";") {
          break;
        }
        advance(";");
      }
      advance(")", true);
      this.type = 'block';
      this.expressions = expressions;
      return this;
    });

    // array constructor
    prefix("[", function () {
      var a = [];
      if (node.id !== "]") {
        for (; ;) {
          var item = expression(0);
          if (node.id === "..") {
            // range operator
            var range = {type: "binary", value: "..", position: node.position, line: node.line, lhs: item};
            advance("..");
            range.rhs = expression(0);
            item = range;
          }
          a.push(item);
          if (node.id !== ",") {
            break;
          }
          advance(",");
        }
      }
      advance("]", true);
      this.expressions = a;
      this.type = "unary";
      return this;
    });

    // filter - predicate or array index
    infix("[", operators['['], function (left, isFlash) {
      if (node.id === "]") {
        // empty predicate means maintain singleton arrays in the output
        var step = left;
        while (step && step.type === 'binary' && step.value === '[') {
          step = step.lhs;
        }
        step.keepArray = true;
        advance("]", null, isFlash);
        return left;
      } else {
        this.lhs = left;
        this.rhs = expression(operators[']'], isFlash);
        this.type = 'binary';
        advance("]", true, isFlash);
        return this;
      }
    });

    // order-by
    infix("^", operators['^'], function (left) {
      advance("(");
      var terms = [];
      for (; ;) {
        var term = {
          descending: false
        };
        if (node.id === "<") {
          // ascending sort
          advance("<");
        } else if (node.id === ">") {
          // descending sort
          term.descending = true;
          advance(">");
        } else {
          //unspecified - default to ascending
        }
        term.expression = expression(0);
        terms.push(term);
        if (node.id !== ",") {
          break;
        }
        advance(",");
      }
      advance(")");
      this.lhs = left;
      this.rhs = terms;
      this.type = 'binary';
      return this;
    });

    var objectParser = function (left) {
      var a = [];
      if (node.id !== "}") {
        for (; ;) {
          var n = expression(0);
          advance(":");
          var v = expression(0);
          a.push([n, v]); // holds an array of name/value expression pairs
          if (node.id !== ",") {
            break;
          }
          advance(",");
        }
      }
      advance("}", true);
      if (typeof left === 'undefined') {
        // NUD - unary prefix form
        this.lhs = a;
        this.type = "unary";
      } else {
        // LED - binary infix form
        this.lhs = left;
        this.rhs = a;
        this.type = 'binary';
      }
      return this;
    };

    // object constructor
    prefix("{", objectParser);

    // object grouping
    infix("{", operators['{'], objectParser);

    // bind variable
    infixr(":=", operators[':='], function (left, lookForFlash) {
      if (left.type !== 'variable') {
        return handleError({
          code: "S0212",
          stack: (new Error()).stack,
          position: left.position,
          line: left.line,
          token: left.value
        });
      }
      this.lhs = left;
      this.rhs = expression(operators[':='] - 1, lookForFlash); // subtract 1 from bindingPower for right associative operators
      this.type = "binary";
      return this;
    });

    // focus variable bind
    infix("@", operators['@'], function (left) {
      this.lhs = left;
      this.rhs = expression(operators['@']);
      if(this.rhs.type !== 'variable') {
        return handleError({
          code: "S0214",
          stack: (new Error()).stack,
          position: this.rhs.position,
          line: this.rhs.line,
          token: "@"
        });
      }
      this.type = "binary";
      return this;
    });

    // index (position) variable bind
    infix("#", operators['#'], function (left) {
      this.lhs = left;
      this.rhs = expression(operators['#']);
      if(this.rhs.type !== 'variable') {
        return handleError({
          code: "S0214",
          stack: (new Error()).stack,
          position: this.rhs.position,
          line: this.rhs.line,
          token: "#"
        });
      }
      this.type = "binary";
      return this;
    });

    // if/then/else ternary operator ?:
    infix("?", operators['?'], function (left) {
      this.type = 'condition';
      this.condition = left;
      this.then = expression(0);
      if (node.id === ':') {
        // else condition
        advance(":");
        this.else = expression(0);
      }
      return this;
    });

    // FUME: coalesce operator ??
    infix("??", operators['??'], function (left) {
      this.type = 'coalesce';
      this.condition = left;
      this.else = expression(0);
      return this;
    });

    // object transformer
    prefix("|", function () {
      this.type = 'transform';
      this.pattern = expression(0);
      advance('|');
      this.update = expression(0);
      if (node.id === ',') {
        advance(',');
        this.delete = expression(0);
      }
      advance('|');
      return this;
    });

    var ancestorLabel = 0;
    var ancestorIndex = 0;
    var ancestry = [];

    const ancestorWrapper = {
      bumpLabel: () => {
        ancestorLabel++;
        return ancestorLabel;
      },
      bumpIndex: () => {
        ancestorIndex++;
        return ancestorIndex;
      },
      pushAncestor: (ancestor) => {
        ancestry.push(ancestor);
      },
      setSlotLabel: (slotIndex, label) => {
        ancestry[slotIndex].slot.label = label;
      }
    };

    /**
         * a flag indicating that the AST contains some FLASH, so a FHIR type analysis step must be performed
         * on it before it can be evaluated against input.
         */
    var astContainsFlash = false;
    const switchOnFlashFlag = function () {
      astContainsFlash = true;
    };

    // now invoke the tokenizer and the parser and return the syntax tree
    lexer = tokenizer(source);
    advance();
    // parse the tokens
    var expr = expression(0);
    if (node.id !== '(end)') {
      var err = {
        code: "S0201",
        position: node.position,
        start: node.start,
        line: node.line,
        token: node.value
      };
      handleError(err);
    }

    // console.log("Initital parsing BEFORE processing AST", JSON.stringify(expr, null, 2));

    expr = processAST(expr, ancestorWrapper, switchOnFlashFlag, recover, errors);
    if (astContainsFlash === true) {
      expr.containsFlash = true;
    }

    // console.log("Final parsing AFTER processing AST", JSON.stringify(expr, null, 2));

    if(expr.type === 'parent' || typeof expr.seekingParent !== 'undefined') {
      // error - trying to derive ancestor at top level
      throw {
        code: "S0217",
        token: expr.type,
        position: expr.position,
        start: expr.start,
        line: expr.line
      };
    }

    if (errors.length > 0) {
      expr.errors = errors;
    }
    // console.log('reached final line of the parser!');
    return expr;
  };

  return parser;
})();

export default parser;
