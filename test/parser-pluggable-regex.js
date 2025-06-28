/* eslint-disable no-useless-escape */
/* eslint-disable require-jsdoc */

import fumifier from '../src/fumifier.js';
import assert from 'assert';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

describe('Invoke parser with custom RegexEngine param', function() {

    var regexContentSpy = null;
    var regexEvalSpy = null;

    function RegexEngineSpy(content) {
        regexContentSpy = content;

        this.exec = function(input) {
            regexEvalSpy = input;
            return null;
        };
    }

    it('should call RegexEngine param constructure during evaluation', async function() {
        var expr = fumifier('$replace(\"foo\", /bar/, \"baaz\")', { RegexEngine: RegexEngineSpy });
        await expr.evaluate();
        assert.deepEqual(regexContentSpy.toString(), "/bar/g");
        assert.deepEqual(regexEvalSpy, "foo");
    });
});
