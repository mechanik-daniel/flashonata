/* eslint-disable require-jsdoc */
/* eslint-disable valid-jsdoc */
/* eslint-disable no-console */
/**
 * © Copyright IBM Corp. 2016, 2018 All Rights Reserved
 *   Project name: JSONata
 *   This project is licensed under the MIT License, see LICENSE
 */

var parseSignature = require('./signature');

const numregex = /^-?(0|([1-9][0-9]*))(\.[0-9]+)?([Ee][-+]?[0-9]+)?/;

const parser = (() => {
    'use strict';

    /**
     * Token binding powers (or precedence levels)
     */
    var operators = {
        '.': 75,
        '[': 80,
        ']': 0,
        '{': 70,
        '}': 0,
        '(': 80,
        ')': 0,
        ',': 0,
        '@': 80,
        '#': 80,
        ';': 80,
        ':': 80,
        '?': 20,
        '+': 50,
        '-': 50,
        '*': 60,
        '/': 60,
        '%': 60,
        '|': 20,
        '=': 40,
        '<': 40,
        '>': 40,
        '^': 40,
        '**': 60,
        '..': 20,
        ':=': 10,
        '!=': 40,
        '<=': 40,
        '>=': 40,
        '~>': 40,
        'and': 30,
        'or': 25,
        'in': 40,
        '&': 50,
        '!': 0,   // not an operator, but needed as a stop character for name tokens
        '~': 0,   // not an operator, but needed as a stop character for name tokens
        '??': 65
    };

    var escapes = {  // JSON string escape sequences - see json.org
        '"': '"',
        '\\': '\\',
        '/': '/',
        'b': '\b',
        'f': '\f',
        'n': '\n',
        'r': '\r',
        't': '\t'
    };

    /**
     * Tokenizer (lexer, or scanner) - invoked by the parser to return one token at a time.
     * The tokens are simple and generally context-independent at this stage.
     * Very little validation is done here, most of the work will be done later by the parser.
     * Possible token types: name, value, operator, variable, number, string, regex
     * Special FUME token types: instanceof, url, indent, blockindent
     * - The `indent` token will only be created if it is followed by a flash declaration or rule. Its value is the indentation number
     * - The `instanceof` token will have the profile identifier as its value
     * @param {string} path The source string
     * @returns {Function} the function that returns the next token
     */
    var tokenizer = function (path) {
        var position = 0; // The char position in the source string
        var length = path.length; // Overall length of the source string
        var lineStart = 0; // Keep track of the current line's start position
        var line = 1; // The current line number in the source, starting from 1
        var lineIndent = ''; // accumulating indentation characters of the current line
        var previousToken; // Keep track of previous token
        // var lookForFlash = false; // Switched on once we encounter Instance: or InstanceOf:

        /**
         * Creates a token object with type, value, and position.
         * @param {string} type - The type of the token (e.g., 'operator', 'string', 'number', 'name').
         * @param {string|number|RegExp} value - The value of the token.
         * @returns {object} A token object containing type, value, and the current position.
         */
        var create = function (type, value) {
            var obj = {type, value, position, line};
            previousToken = obj;
            return obj;
        };

        var scanRegex = function () {
            // the prefix '/' will have been previously scanned. Find the end of the regex.
            // search for closing '/' ignoring any that are escaped, or within brackets
            var start = position;
            var depth = 0;
            var pattern;
            var flags;

            var isClosingSlash = function (position) {
                if (path.charAt(position) === '/' && depth === 0) {
                    var backslashCount = 0;
                    while (path.charAt(position - (backslashCount + 1)) === '\\') {
                        backslashCount++;
                    }
                    if (backslashCount % 2 === 0) {
                        return true;
                    }
                }
                return false;
            };

            while (position < length) {
                var currentChar = path.charAt(position);
                if (isClosingSlash(position)) {
                    // end of regex found
                    pattern = path.substring(start, position);
                    // if (pattern === '') {
                    //     throw {
                    //         code: "S0301",
                    //         stack: (new Error()).stack,
                    //         position,
                    //         line
                    //     };
                    // }
                    position++;
                    currentChar = path.charAt(position);
                    // flags
                    start = position;
                    while (currentChar === 'i' || currentChar === 'm') {
                        position++;
                        currentChar = path.charAt(position);
                    }
                    flags = path.substring(start, position) + 'g';
                    return new RegExp(pattern, flags);
                }
                if ((currentChar === '(' || currentChar === '[' || currentChar === '{') && path.charAt(position - 1) !== '\\') {
                    depth++;
                }
                if ((currentChar === ')' || currentChar === ']' || currentChar === '}') && path.charAt(position - 1) !== '\\') {
                    depth--;
                }

                position++;
            }
            throw {
                code: "S0302",
                stack: (new Error()).stack,
                position,
                line
            };
        };

        /**
         * Check if the current non-whitespace character is the first one in the current line
         * @returns {boolean}
         */
        var firstInLine = function () {
            return lineIndent === path.substring(lineStart, position);
        };

        /**
         * Returns the indentation of the current line as a number.
         * The number is the sum of whitespace characters, where a space is counted once and tab twice
         */
        var indentNumber = function () {
            var i = 0;
            var sum = 0;
            while (i < lineIndent.length) {
                if (lineIndent.charAt(i) === ' ') sum += 1;
                if (lineIndent.charAt(i) === '\t') sum += 2;
                i++;
            }
            return sum;
        };

        /**
         * Advances to the next simple token and returns it.
         * This is entirely sequential - no nesting and operator precedence logic is done here
         * @param {boolean} prefix - This essentially tells the scanner that the next token is going to be
         *      used as a prefix - the beginning of a subexpression.
         *      This is explicitly set to true only in the first call to advance() from expression().
         *      The only use for this flag currently is to tell the scanner how to treat the '/' operator.
         *      When / is used as prefix, everything up to the next '/' should not be tokenized but rather
         *      "swallowed" as the value of a regex token.
         *      When '/' is used an infix, it is just the regular division operator.
         * @returns {object|null} The next token object or null if end of input.
         */
        var next = function (prefix) {
            // console.log('next', { position });
            if (position >= length) return null;
            var currentChar = path.charAt(position);
            // skip whitespace - but keep track of new lines and indentation
            while (position < length && ' \t\n\r\v'.indexOf(currentChar) > -1) {
                if (path.substring(position, position + 2) === '\r\n') {
                    // Windows style newline (\r\n)
                    position += 2;
                    line ++;
                    currentChar = path.charAt(position);
                    lineStart = position;
                    lineIndent = '';
                } else if ('\r\n'.indexOf(currentChar) > -1) {
                    // POSIX (\n) or old pre-OS X Macs Style (\r)
                    position ++;
                    line ++;
                    currentChar = path.charAt(position);
                    lineStart = position;
                    lineIndent = '';
                } else if (' \t'.indexOf(currentChar) > -1 && firstInLine()) {
                    // indentation
                    position ++;
                    lineIndent += currentChar;
                    currentChar = path.charAt(position);
                } else {
                    // regular mid-line whitespace
                    position ++;
                    currentChar = path.charAt(position);
                }
            }
            // Handle indent tokenization
            // We create one for every newline that starts with one of the following:
            // - Instance:
            // - InstanceOf:
            // - * (flash rules)
            // - $ (assignment rules)
            // The last two are created only if we previously encountered one of the first two declarations,
            // since they are only significant inside flash blocks.
            // NOTE: This approach ignores block closing since we don't track these kind of stuff in the scanner.
            //      This means that even if we are after a flash block that has been closed,
            //      or inside a regular epression block, we still get these indent
            //      tokens on every line starting with * or $.
            //      TODO: Find a proper way to handle this
            if (
                position < length &&
                // lookForFlash &&
                '*$'.indexOf(currentChar) > -1 && // flash rule or assignment
                firstInLine()
            ) {
                // If we got here, it means we need to create an indent token
                // But it may have already been created, so we need to check previous token
                // console.log('indent tokenization', { previousToken, lineStart });
                if (typeof previousToken === 'undefined' || previousToken.type !== 'indent' || previousToken.position < lineStart) {
                    // console.log('creating indent token', { indentNumber: indentNumber(), position, line });
                    return create('indent', indentNumber());
                }
            }
            if (
                (position + 9) <= length &&
                path.substring(position, position + 9) === 'Instance:' ||
                path.substring(position, position + 11) === 'InstanceOf:'
            ) {
                // lookForFlash = true;
                // If we got here, it means we need to create a block indent token
                // But it may have already been created, so we need to check previous token
                if (typeof previousToken === 'undefined' || previousToken.type !== 'blockindent' || previousToken.position < lineStart) {
                    return create('blockindent', indentNumber());
                }
            }
            // skip comments (regular jsonata comments /* */)
            if (currentChar === '/' && path.charAt(position + 1) === '*') {
                var commentStart = position;
                position += 2;
                currentChar = path.charAt(position);
                while (!(currentChar === '*' && path.charAt(position + 1) === '/')) {
                    currentChar = path.charAt(++position);
                    if (position >= length) {
                        // no closing tag
                        throw {
                            code: "S0106",
                            stack: (new Error()).stack,
                            position: commentStart,
                            line
                        };
                    }
                    if (path.substring(position, position + 2) === '\r\n') {
                        // Windows style newline (\r\n)
                        position += 2;
                        line ++;
                        currentChar = path.charAt(position);
                        lineStart = position;
                        lineIndent = '';
                    } else if ('\r\n'.indexOf(currentChar) > -1) {
                        // POSIX (\n) or old pre-OS X Macs Style (\r)
                        position ++;
                        line ++;
                        currentChar = path.charAt(position);
                        lineStart = position;
                        lineIndent = '';
                    }
                }
                position += 2;
                currentChar = path.charAt(position);
                return next(prefix); // need this to swallow any following whitespace
            }

            // console.log('after skipping comment', { currentChar });

            // FUME: capture URL's (including URN's)
            if (
                /*lookForFlash &&*/ ( // only relevant if a flash block was encountered previously
                    path.substring(position, position + 7) === 'http://' ||
                    path.substring(position, position + 8) === 'https://' ||
                    path.substring(position, position + 4) === 'urn:'
                    // TODO: Check if other schemas are relevant (e.g. ftp://, mailto:, file: etc.)
                )
            ) {
                let url = path.substring(position, position += 4); // at least the 4 first chars have been confirmed to be part of the string
                while (position < length && path.charAt(position) !== ')' && !/[\s]/.test(path.charAt(position))) {
                    // swallow any thing until encountering a ')' or any whitespace
                    url += path.charAt(position);
                    position++;
                }
                return create('url', url);
            }

            // FUME: skip single line comments
            if (path.substring(position, position + 2) === '//') {
                position += 2;
                currentChar = path.charAt(position);
                while (!(currentChar === '\r' || currentChar === '\n' || position === length)) {
                    currentChar = path.charAt(++position);
                }
                // currentChar = path.charAt(position);
                return next(prefix); // need this to swallow any following whitespace
            }

            // handle flash block declarations ("Instance:", "InstanceOf:" and "* " rules)
            var token;
            if (path.substring(position, position + 9) === 'Instance:') {
                // console.log(' handle flash block declarations', 'Instance:');
                position += 9;
                token = create('operator', 'Instance:');
                token.indent = indentNumber();
                return token;
            }
            if (path.substring(position, position + 11) === 'InstanceOf:') {
                // console.log(' handle flash block declarations', 'InstanceOf:');
                position += 11;
                var profileId = '';
                while (position < length && ' \t\r\n'.indexOf(path.charAt(position)) > -1) {
                    // skip any whitespace after the keyword
                    position ++;
                }
                while (') \t\r\n'.indexOf(path.charAt(position)) === -1) {
                    // swallow everything until the first whitespace or ')'
                    profileId += path.charAt(position);
                    position ++;
                }
                token = create('instanceof', profileId);
                token.indent = indentNumber();
                return token;
            }
            // if (lookForFlash && currentChar === '*' && firstInLine()) {
            //     position ++;
            //     return create('operator', 'flashrule');
            // }
            // test for regex
            if (prefix !== true && currentChar === '/') {
                position++;
                return create('regex', scanRegex());
            }
            // handle double-char operators
            if (currentChar === '.' && path.charAt(position + 1) === '.') {
                // double-dot .. range operator
                position += 2;
                return create('operator', '..');
            }
            if (currentChar === ':' && path.charAt(position + 1) === '=') {
                // := assignment
                position += 2;
                return create('operator', ':=');
            }
            if (currentChar === '!' && path.charAt(position + 1) === '=') {
                // !=
                position += 2;
                return create('operator', '!=');
            }
            if (currentChar === '>' && path.charAt(position + 1) === '=') {
                // >=
                position += 2;
                return create('operator', '>=');
            }
            if (currentChar === '<' && path.charAt(position + 1) === '=') {
                // <=
                position += 2;
                return create('operator', '<=');
            }
            if (currentChar === '*' && path.charAt(position + 1) === '*') {
                // **  descendant wildcard
                position += 2;
                return create('operator', '**');
            }
            if (currentChar === '~' && path.charAt(position + 1) === '>') {
                // ~>  chain function
                position += 2;
                return create('operator', '~>');
            }
            if (currentChar === '?' && path.charAt(position + 1) === '?') {
                // FUME: ?? coalesce operator
                position += 2;
                return create('operator', '??');
            }
            // potential flash rules
            if (currentChar === '*' && firstInLine()) {
                position++;
                token = create('operator', currentChar);
                token.indent = indentNumber();
                return token;
            }
            // test for single char operators
            if (Object.prototype.hasOwnProperty.call(operators, currentChar)) {
                position++;
                return create('operator', currentChar);
            }
            // test for string literals
            if (currentChar === '"' || currentChar === "'") {
                var quoteType = currentChar;
                // double quoted string literal - find end of string
                position++;
                var qstr = "";
                while (position < length) {
                    currentChar = path.charAt(position);
                    if (currentChar === '\\') { // escape sequence
                        position++;
                        currentChar = path.charAt(position);
                        if (Object.prototype.hasOwnProperty.call(escapes, currentChar)) {
                            qstr += escapes[currentChar];
                        } else if (currentChar === 'u') {
                            // \u should be followed by 4 hex digits
                            var octets = path.substr(position + 1, 4);
                            if (/^[0-9a-fA-F]+$/.test(octets)) {
                                var codepoint = parseInt(octets, 16);
                                qstr += String.fromCharCode(codepoint);
                                position += 4;
                            } else {
                                throw {
                                    code: "S0104",
                                    stack: (new Error()).stack,
                                    position,
                                    line
                                };
                            }
                        } else {
                            // illegal escape sequence
                            throw {
                                code: "S0103",
                                stack: (new Error()).stack,
                                position,
                                line,
                                token: currentChar
                            };

                        }
                    } else if (currentChar === quoteType) {
                        position++;
                        return create('string', qstr);
                    } else {
                        qstr += currentChar;
                    }
                    position++;
                }
                throw {
                    code: "S0101",
                    stack: (new Error()).stack,
                    position,
                    line
                };
            }
            // test for numbers
            var match = numregex.exec(path.substring(position));
            if (match !== null) {
                var num = parseFloat(match[0]);
                if (!isNaN(num) && isFinite(num)) {
                    position += match[0].length;
                    return create('number', num);
                } else {
                    throw {
                        code: "S0102",
                        stack: (new Error()).stack,
                        position,
                        line,
                        token: match[0]
                    };
                }
            }
            // test for quoted names (backticks)
            var name;
            if (currentChar === '`') {
                // scan for closing quote
                position++;
                var end = path.indexOf('`', position);
                if (end !== -1) {
                    name = path.substring(position, end);
                    position = end + 1;
                    return create('name', name);
                }
                position = length;
                throw {
                    code: "S0105",
                    stack: (new Error()).stack,
                    position,
                    line
                };
            }
            // test for names
            var i = position;
            var ch;
            for (; ;) {
                ch = path.charAt(i);
                if (i === length || ' \t\n\r\v'.indexOf(ch) > -1 || Object.prototype.hasOwnProperty.call(operators, ch)) {
                    if (path.charAt(position) === '$') {
                        // variable reference
                        var indent;
                        if (firstInLine()) indent = indentNumber();
                        name = path.substring(position + 1, i);
                        position = i;
                        token = create('variable', name);
                        if (indent && indent >= 0) token.indent = indent;
                        return token;
                    } else {
                        name = path.substring(position, i);
                        position = i;
                        switch (name) {
                            case 'or':
                            case 'in':
                            case 'and':
                                return create('operator', name);
                            case 'true':
                                return create('value', true);
                            case 'false':
                                return create('value', false);
                            case 'null':
                                return create('value', null);
                            default:
                                if (position === length && name === '') {
                                    // whitespace at end of input
                                    return null;
                                }
                                return create('name', name);
                        }
                    }
                } else {
                    i++;
                }
            }
        };

        return next;
    };

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
                remaining.push({type: node.type, value: node.value, position: node.position, line: node.line});
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
            // console.log('advance()', { id, infix, node: { ...node, indent: node && node.indent ? node.indent:  undefined} });
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
            // lookForFlash = (lookForFlash && lookForFlash === true) || (node && (node.type === 'instanceof' || node.id === '(indent)' || node.value === 'flashrule'));
            /** Fetch next simple token from the scanner */
            var next_token = lexer(infix, lookForFlash);
            // console.log('advance()', { next_token });
            if (next_token === null) {
                // When the scanner has no more tokens to consume from the source it returns null
                // So we create an (end) token and return it, but not before we override the node variable
                node = symbol_table["(end)"];
                node.position = source.length;
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
            // console.log('advance() switch case', { type });
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
                    // console.log('advance() found blockindent token', { token: next_token });
                    // go to next token
                    next_token = lexer(infix, true);
                    /* istanbul ignore else  */
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
                    // console.log('type after blockindent is: ', type);
                    // console.log('symbol is: ', symbol);
                    break;
                /* istanbul ignore next */
                default:
                    return handleError({
                        code: "S0205",
                        stack: (new Error()).stack,
                        position: next_token.position,
                        line: next_token.line,
                        token: value
                    });
            }
            /** This is where we override the node variable with a new processed token */
            node = Object.create(symbol);
            // console.log('advance(): processing symbol', { ...symbol, id: symbol.id, indent: symbol.indent});
            // console.log('advance(): new node created');
            node.value = value;
            node.type = type;
            node.position = next_token.position;
            node.line = next_token.line;
            if (Object.prototype.hasOwnProperty.call(symbol, 'indent')) {
                // we explicitly add the indent member to the node so it would show in the resulting tree when stringified.
                // Otherwise it may look like the indent number wasn't registered because attributes inherited from
                // the prototype object are hidden (like the id, lbp, nud and led)
                node.indent = symbol.indent;
            }
            // console.log('advance() returning', { ...node, id: node.id, lbp: node.lbp, nud: node.nud, led: node.led, indent: node.indent});
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
            // console.log(`expression(${rbp})`, { node });
            var left;
            var token = node; // save current node as token
            advance(null, true, lookForFlash); // advance node to the next token
            left = token.nud(lookForFlash); // save result of calling the previous head handler on current node
            while (rbp < node.lbp) { // if and while current node's lbp is higher than the provided rbp
                token = node; // save current node as token
                advance(null, null, lookForFlash);// advance node to next token
                left = token.led(left, lookForFlash); // accumulate results of recursive calls to the tail handler
            }
            // console.log(`expression(${rbp})`, { left });
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

        // Since indent tokens are only separators for flash rules, they should not be called as prefixes
        // If an indent token IS called as prefix, this means it comes immediaty after '*' and got scanned as a path.
        // prefix("(indent)", function () {
        //     return handleError({
        //         code: "F1024",
        //         stack: (new Error()).stack,
        //         position: this.position,
        //         line: this.line,
        //         token: '*',
        //         value: `${String(this.value)} spaces`
        //     });
        // });

        // since a flash block expression can be initialized both by Instance: and InstanceOf: keywords,
        // both prefix handlers should collect rules using the same function.
        // In both cases, this function is only called after the InstanceOf: keyword, so it should not encounter an
        // 'Instance:' token after it. If it does, that's an error.
        // The only valid expression types are flashrule and ':=' (bind)
        var collectRules = function (level, root) {
            root = root || 0;
            console.log('collectRules()', {level, root}, node);
            if (node.type === 'instance') {
                // Instance:` declaration must come BEFORE `InstanceOf:`
                return handleError({
                    code: "F1010",
                    stack: (new Error()).stack,
                    position: node.position,
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
                    line: node.line,
                    token: `${String(root)} spaces`,
                    value: `${String(node.value)} spaces`
                });
            }
            while (node.id !== ")" && node.id !== "(end)") {
                var indent;
                // var subrules = [];
                if (node.id === "(indent)") {
                    if (node.value === level) {
                        indent = node.value;
                        advance("(indent)", null, true);
                    // } else if (node.value > level) {
                    //     if ((node.value - level) !== 2) {
                    //         return handleError({
                    //             code: "F1015",
                    //             stack: (new Error()).stack,
                    //             position: node.position,
                    //             line: node.line,
                    //             token: `${String(level)} spaces or ${String(level + 2)}`,
                    //             value: `${String(node.value)} spaces`
                    //         });
                    //     } else {
                    //         subrules = collectRules(level + 2, root);
                    //         advance(null, null, true);
                    //     }
                    } else {
                        if ((level - node.value) % 2 !== 0) {
                            return handleError({
                                code: "F1021",
                                stack: (new Error()).stack,
                                position: node.position,
                                line: node.line,
                                token: '(indent)',
                                value: `${String(node.value)} spaces`
                            });
                        }
                        // if (node.value < root) {
                        //     return handleError({
                        //         code: "F1016",
                        //         stack: (new Error()).stack,
                        //         position: node.position,
                        //         line: node.line,
                        //         token: '(indent)',
                        //         value: `${String(node.value)} spaces`
                        //     });
                        // }
                        // advance();
                        break;
                    }
                }
                var rule = expression(0, true);
                if (rule.type !== 'flashrule' && rule.id !== ':=') {
                    if (rule.id === '=') {
                        return handleError({
                            code: "F1025",
                            stack: (new Error()).stack,
                            position: rule.position,
                            line: rule.line,
                            token: rule.id
                        });
                    } else {
                        return handleError({
                            code: "F1011",
                            stack: (new Error()).stack,
                            position: rule.position,
                            line: rule.line,
                            token: rule.id
                        });
                    }
                }
                rule.indent = rule.indent || indent;
                // if (subrules.length > 0) rule.rules = subrules;
                rules.push(rule);
                // if (node.id === "(indent)" && node.value < root) {
                //     return handleError({
                //         code: "F1016",
                //         stack: (new Error()).stack,
                //         position: node.position,
                //         line: node.line,
                //         token: `${String(root)} spaces`,
                //         value: `${String(node.value)} spaces`
                //     });
                // }
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
                this.type = 'flashrule';
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
                        this.expression = expression(0, true);
                    } else {
                        return handleError({
                            code: "F1012",
                            stack: (new Error()).stack,
                            position: position,
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
                // console.log('path detected', this.path);
                if (this.path && this.path.type === 'flashrule') { // double * *
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
                        line: this.line,
                        token: '*'
                    });
                }
                this.indent = indent;
                var subrules;
                subrules = collectRules(indent + 2);
                if (subrules.length > 0) this.rules = subrules;
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
            // if it's a flashblock it means there is no expression between Instance: and InstanceOf:
            if (instanceExpr.id === '(instanceof)') {
                return handleError({
                    code: "F1018",
                    stack: (new Error()).stack,
                    position: instanceExpr.position,
                    line: instanceExpr.line,
                    token: instanceExpr.id,
                    value: 'InstanceOf:'
                });
            }
            this.instance = instanceExpr;
            this.type = "flashblock";
            delete this.value;
            if (node.id !== '(instanceof)') {
                // Instance: without InstanceOf:
                return handleError({
                    code: "F1009",
                    stack: (new Error()).stack,
                    position: node.position,
                    line: node.line,
                    token: node.id
                });
            }
            if (node.line === this.instance.line) {
                // InstanceOf: at the same line as Instance:
                return handleError({
                    code: "F1013",
                    stack: (new Error()).stack,
                    position: node.position,
                    line: node.line,
                    token: node.id
                });
            }
            if (node.indent !== this.indent) { // indentation of InstanceOf: must be same as Instance:
                return handleError({
                    code: "F1014",
                    stack: (new Error()).stack,
                    position: node.position,
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
                    line: this.line,
                    token: "InstanceOf:"
                });
            }
            advance(null, null, true); // proceeed to the next token after InstanceOf:
            var rules = collectRules(this.indent, this.indent);
            if (rules.length > 0) this.rules = rules;
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
            this.type = "flashblock";
            if (!this.value || this.value === '') {
                return handleError({
                    code: "F1019",
                    stack: (new Error()).stack,
                    position: this.position,
                    line: this.line,
                    token: "InstanceOf:"
                });
            }
            this.instanceof = this.value;
            var rules = collectRules(this.indent, this.indent);
            if (rules.length > 0) this.rules = rules;
            delete this.value;
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
        infix("[", operators['['], function (left) {
            if (node.id === "]") {
                // empty predicate means maintain singleton arrays in the output
                var step = left;
                while (step && step.type === 'binary' && step.value === '[') {
                    step = step.lhs;
                }
                step.keepArray = true;
                advance("]");
                return left;
            } else {
                this.lhs = left;
                this.rhs = expression(operators[']']);
                this.type = 'binary';
                advance("]", true);
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

        // tail call optimization
        // this is invoked by the post parser to analyse lambda functions to see
        // if they make a tail call.  If so, it is replaced by a thunk which will
        // be invoked by the trampoline loop during function application.
        // This enables tail-recursive functions to be written without growing the stack
        var tailCallOptimize = function (expr) {
            var result;
            if (expr.type === 'function' && !expr.predicate) {
                var thunk = {type: 'lambda', thunk: true, arguments: [], position: expr.position, line: expr.line};
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

        var ancestorLabel = 0;
        var ancestorIndex = 0;
        var ancestry = [];

        var seekParent = function (node, slot) {
            switch (node.type) {
                case 'name':
                case 'wildcard':
                    slot.level--;
                    if(slot.level === 0) {
                        if (typeof node.ancestor === 'undefined') {
                            node.ancestor = slot;
                        } else {
                            // reuse the existing label
                            ancestry[slot.index].slot.label = node.ancestor.label;
                            node.ancestor = slot;
                        }
                        node.tuple = true;
                    }
                    break;
                case 'parent':
                    slot.level++;
                    break;
                case 'block':
                    // look in last expression in the block
                    if(node.expressions.length > 0) {
                        node.tuple = true;
                        slot = seekParent(node.expressions[node.expressions.length - 1], slot);
                    }
                    break;
                case 'path':
                    // last step in path
                    node.tuple = true;
                    var index = node.steps.length - 1;
                    slot = seekParent(node.steps[index--], slot);
                    while (slot.level > 0 && index >= 0) {
                        // check previous steps
                        slot = seekParent(node.steps[index--], slot);
                    }
                    break;
                default:
                    // error - can't derive ancestor
                    throw {
                        code: "S0217",
                        token: node.type,
                        position: node.position,
                        line: node.line
                    };
            }
            return slot;
        };

        var pushAncestry = function(result, value) {
            if(typeof value.seekingParent !== 'undefined' || value.type === 'parent') {
                var slots = (typeof value.seekingParent !== 'undefined') ? value.seekingParent : [];
                if (value.type === 'parent') {
                    slots.push(value.slot);
                }
                if(typeof result.seekingParent === 'undefined') {
                    result.seekingParent = slots;
                } else {
                    Array.prototype.push.apply(result.seekingParent, slots);
                }
            }
        };

        var resolveAncestry = function(path) {
            var index = path.steps.length - 1;
            var laststep = path.steps[index];
            var slots = (typeof laststep.seekingParent !== 'undefined') ? laststep.seekingParent : [];
            if (laststep.type === 'parent') {
                slots.push(laststep.slot);
            }
            for(var is = 0; is < slots.length; is++) {
                var slot = slots[is];
                index = path.steps.length - 2;
                while (slot.level > 0) {
                    if (index < 0) {
                        if(typeof path.seekingParent === 'undefined') {
                            path.seekingParent = [slot];
                        } else {
                            path.seekingParent.push(slot);
                        }
                        break;
                    }
                    // try previous step
                    var step = path.steps[index--];
                    // multiple contiguous steps that bind the focus should be skipped
                    while(index >= 0 && step.focus && path.steps[index].focus) {
                        step = path.steps[index--];
                    }
                    slot = seekParent(step, slot);
                }
            }
        };

        // post-parse stage
        // the purpose of this is to add as much semantic value to the parse tree as possible
        // in order to simplify the work of the evaluator.
        // This includes flattening the parts of the AST representing location paths,
        // converting them to arrays of steps which in turn may contain arrays of predicates.
        // following this, nodes containing '.' and '[' should be eliminated from the AST.
        var processAST = function (expr) {
            // console.log('processAST switch case', { type: expr.type });
            var result;
            switch (expr.type) {
                case 'binary':
                    switch (expr.value) {
                        case '.':
                            var lstep = processAST(expr.lhs);

                            if (lstep.type === 'path') {
                                result = lstep;
                            } else {
                                result = {type: 'path', steps: [lstep]};
                            }
                            if(lstep.type === 'parent') {
                                result.seekingParent = [lstep.slot];
                            }
                            var rest = processAST(expr.rhs);
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
                            resolveAncestry(result);
                            break;
                        case '[':
                            // predicated step
                            // LHS is a step or a predicated step
                            // RHS is the predicate expr
                            // console.log('processAST [', { result, expr });
                            result = processAST(expr.lhs);
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
                                    line: expr.line
                                };
                            }
                            if (typeof step[type] === 'undefined') {
                                step[type] = [];
                            }
                            var predicate = processAST(expr.rhs);
                            if(typeof predicate.seekingParent !== 'undefined') {
                                predicate.seekingParent.forEach(slot => {
                                    if(slot.level === 1) {
                                        seekParent(step, slot);
                                    } else {
                                        slot.level--;
                                    }
                                });
                                pushAncestry(step, predicate);
                            }
                            step[type].push({type: 'filter', expr: predicate, position: expr.position, line: expr.line});
                            break;
                        case '{':
                            // group-by
                            // LHS is a step or a predicated step
                            // RHS is the object constructor expr
                            result = processAST(expr.lhs);
                            if (typeof result.group !== 'undefined') {
                                throw {
                                    code: "S0210",
                                    stack: (new Error()).stack,
                                    position: expr.position,
                                    line: expr.line
                                };
                            }
                            // object constructor - process each pair
                            result.group = {
                                lhs: expr.rhs.map(function (pair) {
                                    return [processAST(pair[0]), processAST(pair[1])];
                                }),
                                position: expr.position,
                                line: expr.line
                            };
                            break;
                        case '^':
                            // order-by
                            // LHS is the array to be ordered
                            // RHS defines the terms
                            result = processAST(expr.lhs);
                            if (result.type !== 'path') {
                                result = {type: 'path', steps: [result]};
                            }
                            var sortStep = {type: 'sort', position: expr.position, line: expr.line};
                            sortStep.terms = expr.rhs.map(function (terms) {
                                var expression = processAST(terms.expression);
                                pushAncestry(sortStep, expression);
                                return {
                                    descending: terms.descending,
                                    expression: expression
                                };
                            });
                            result.steps.push(sortStep);
                            resolveAncestry(result);
                            break;
                        case ':=':
                            result = {type: 'bind', value: expr.value, position: expr.position ,line: expr.line};
                            result.lhs = processAST(expr.lhs);
                            result.rhs = processAST(expr.rhs);
                            pushAncestry(result, result.rhs);
                            break;
                        case '@':
                            result = processAST(expr.lhs);
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
                                    line: expr.line
                                };
                            }
                            // also throw if this is applied after an 'order-by' clause
                            if(step.type === 'sort') {
                                throw {
                                    code: "S0216",
                                    stack: (new Error()).stack,
                                    position: expr.position,
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
                            result = processAST(expr.lhs);
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
                                step.stages.push({type: 'index', value: expr.rhs.value, position: expr.position, line: expr.line});
                            }
                            step.tuple = true;
                            break;
                        case '~>':
                            result = {type: 'apply', value: expr.value, position: expr.position, line: expr.line};
                            result.lhs = processAST(expr.lhs);
                            result.rhs = processAST(expr.rhs);
                            result.keepArray = result.lhs.keepArray || result.rhs.keepArray;
                            break;
                        default:
                            result = {type: expr.type, value: expr.value, position: expr.position, line: expr.line};
                            result.lhs = processAST(expr.lhs);
                            result.rhs = processAST(expr.rhs);
                            pushAncestry(result, result.lhs);
                            pushAncestry(result, result.rhs);
                    }
                    break;
                case 'unary':
                    result = {type: expr.type, value: expr.value, position: expr.position, line: expr.line};
                    if (expr.value === '[') {
                        // array constructor - process each item
                        result.expressions = expr.expressions.map(function (item) {
                            var value = processAST(item);
                            pushAncestry(result, value);
                            return value;
                        });
                    } else if (expr.value === '{') {
                        // object constructor - process each pair
                        result.lhs = expr.lhs.map(function (pair) {
                            var key = processAST(pair[0]);
                            pushAncestry(result, key);
                            var value = processAST(pair[1]);
                            pushAncestry(result, value);
                            return [key, value];
                        });
                    } else {
                        // all other unary expressions - just process the expression
                        result.expression = processAST(expr.expression);
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
                    result = {type: expr.type, name: expr.name, value: expr.value, position: expr.position, line: expr.line};
                    result.arguments = expr.arguments.map(function (arg) {
                        var argAST = processAST(arg);
                        pushAncestry(result, argAST);
                        return argAST;
                    });
                    result.procedure = processAST(expr.procedure);
                    break;
                case 'lambda':
                    result = {
                        type: expr.type,
                        arguments: expr.arguments,
                        signature: expr.signature,
                        position: expr.position,
                        line: expr.line
                    };
                    var body = processAST(expr.body);
                    result.body = tailCallOptimize(body);
                    break;
                case 'condition':
                    result = {type: expr.type, position: expr.position, line: expr.line};
                    result.condition = processAST(expr.condition);
                    pushAncestry(result, result.condition);
                    result.then = processAST(expr.then);
                    pushAncestry(result, result.then);
                    if (typeof expr.else !== 'undefined') {
                        result.else = processAST(expr.else);
                        pushAncestry(result, result.else);
                    }
                    break;
                case 'coalesce':
                    result = {type: expr.type, position: expr.position, line: expr.line};
                    result.condition = processAST(expr.condition);
                    pushAncestry(result, result.condition);
                    // result.then = processAST(expr.then);
                    // pushAncestry(result, result.then);
                    result.else = processAST(expr.else);
                    pushAncestry(result, result.else);
                    break;
                case 'transform':
                    result = {type: expr.type, position: expr.position, line: expr.line};
                    result.pattern = processAST(expr.pattern);
                    result.update = processAST(expr.update);
                    if (typeof expr.delete !== 'undefined') {
                        result.delete = processAST(expr.delete);
                    }
                    break;
                case 'block':
                    result = {type: expr.type, position: expr.position, line: expr.line};
                    // array of expressions - process each one
                    result.expressions = expr.expressions.map(function (item) {
                        var part = processAST(item);
                        pushAncestry(result, part);
                        if (part.consarray || (part.type === 'path' && part.steps[0].consarray)) {
                            result.consarray = true;
                        }
                        return part;
                    });
                    // TODO scan the array of expressions to see if any of them assign variables
                    // if so, need to mark the block as one that needs to create a new frame
                    break;
                case 'name':
                    // console.log(`processAST ${expr.type}`);
                    result = {type: 'path', steps: [expr]};
                    if (expr.keepArray) {
                        result.keepSingletonArray = true;
                    }
                    break;
                case 'parent':
                    result = {type: 'parent', slot: { label: '!' + ancestorLabel++, level: 1, index: ancestorIndex++ } };
                    ancestry.push(result);
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
                case 'flashblock':
                    result = {
                        type: expr.type,
                        position: expr.position,
                        line: expr.line,
                        instanceof: expr.instanceof
                    };
                    if (expr.instance) {
                        result.instance = processAST(expr.instance);
                    }
                    if (expr.rules && expr.rules.length > 0) {
                        result.rules = expr.rules.map((rule) => processAST(rule));
                    }
                    break;
                case 'flashrule':
                    result = {
                        type: expr.type,
                        position: expr.position,
                        line: expr.line,
                        path: processAST(expr.path)
                    };
                    if (expr.context) {
                        result.context = processAST(expr.context);
                    }
                    if (expr.expression) {
                        result.expression = processAST(expr.expression);
                    }
                    if (expr.rules && expr.rules.length > 0) {
                        result.rules = expr.rules.map((rule) => processAST(rule));
                    }
                    break;
                case 'operator':
                    // console.log(`processAST ${expr.type}`);
                    // the tokens 'and' and 'or' might have been used as a name rather than an operator
                    if (expr.value === 'and' || expr.value === 'or' || expr.value === 'in') {
                        expr.type = 'name';
                        result = processAST(expr);
                    } else /* istanbul ignore else */ if (expr.value === '?') {
                        // partial application
                        result = expr;
                    } else {
                        throw {
                            code: "S0201",
                            stack: (new Error()).stack,
                            position: expr.position,
                            line: expr.line,
                            token: expr.value
                        };
                    }
                    break;
                case 'error':
                    result = expr;
                    if (expr.lhs) {
                        result = processAST(expr.lhs);
                    }
                    break;
                default:
                    var code = "S0206";
                    /* istanbul ignore else */
                    if (expr.id === '(end)') {
                        code = "S0207";
                    }
                    var err = {
                        code: code,
                        position: expr.position,
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

        // now invoke the tokenizer and the parser and return the syntax tree
        lexer = tokenizer(source);
        // console.log('main call to advance()');
        advance();
        // console.log('after main call to advance()');
        // parse the tokens
        // console.log('main call to expression(0)');
        var expr = expression(0);
        // console.log('after main call to expression(0)');
        // console.log('expr', JSON.stringify(expr,null,2));
        // console.log('parser() expr', JSON.stringify(expr, null, 2));
        if (node.id !== '(end)') {
            var err = {
                code: "S0201",
                position: node.position,
                line: node.line,
                token: node.value
            };
            handleError(err);
        }
        expr = processAST(expr);

        if(expr.type === 'parent' || typeof expr.seekingParent !== 'undefined') {
            // error - trying to derive ancestor at top level
            throw {
                code: "S0217",
                token: expr.type,
                position: expr.position,
                line: expr.line
            };
        }

        if (errors.length > 0) {
            expr.errors = errors;
        }

        return expr;
    };

    return parser;
})();

module.exports = parser;
