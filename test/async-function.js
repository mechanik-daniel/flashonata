import fumifier from '../src/fumifier.js';
import fetch from 'node-fetch';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

var expect = chai.expect;

chai.use(chaiAsPromised);

const fumifierWithCallback = async function(expr, data, bindings) {
  return expr.evaluate(data, bindings);
};

const httpget = async (url) => {
  return Promise.resolve().then(async () => {
    const res = await fetch(url);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`Failed to parse JSON from ${url}:\n${text}`);
    }
  });
};

describe('Invoke JSONata with callback', function() {
  describe('Make HTTP request', function() {
    it('should return promise to results', async function() {
      var expr = await fumifier('$httpget("https://api.npmjs.org/downloads/range/2016-09-01:2017-03-31/jsonata").downloads{ $substring(day, 0, 7): $sum(downloads) }');
      expr.assign('httpget', httpget);
      return await expect(fumifierWithCallback(expr)).to.eventually.deep.equal({
        '2016-09': 205,
        '2016-10': 1266,
        '2016-11': 2783,
        '2016-12': 2158,
        '2017-01': 22977,
        '2017-02': 37728,
        '2017-03': 46460 });
    });
  });
});

describe('Invoke JSONata with callback - errors', function() {
  describe('type error', function() {
    it('should throw', async function() {
      var expr = await fumifier('5 + $httpget("htttttps://api.npmjs.org/downloads/range/2016-09-01:2017-03-31/fumifier")');
      expr.assign('httpget', httpget);
      return expect(fumifierWithCallback(expr)).to.be.rejected;
    });

  });

  describe('Make HTTP request with dodgy url', function() {
    it('should throw', async function() {
      var expr = await fumifier('$httpget("htttttps://api.npmjs.org/downloads/range/2016-09-01:2017-03-31/fumifier").downloads{ $substring(day, 0, 7): $sum(downloads) }');
      expr.assign('httpget', httpget);
      return expect(fumifierWithCallback(expr)).to.be.rejected;
    });
  });
});

describe('Invoke JSONata with callback - return values', function() {
  it('should handle an undefined value', async function() {
    var data = { value: undefined };
    var expr = await fumifier('value');
    return expect(fumifierWithCallback(expr, data)).to.eventually.equal(undefined);
  });
  it('should handle a null value', async function() {
    var data = { value: null };
    var expr = await fumifier('value');
    return expect(fumifierWithCallback(expr, data)).to.eventually.equal(null);
  });
  it('should handle a value', async function() {
    var data = { value: 'hello' };
    var expr = await fumifier('value');
    return expect(fumifierWithCallback(expr, data)).to.eventually.equal('hello');
  });
  it('should handle a promise', async function() {
    var data = { value: Promise.resolve('hello') };
    var expr = await fumifier('value');
    return expect(fumifierWithCallback(expr, data)).to.eventually.equal('hello');
  });
});

describe('Evaluate concurrent expressions with callbacks', function() {
  it('should process two expressions concurrently', async function() {
    const expr = await fumifier("{'1':'goat','2': 'cheese'} ~> $lookup($string(payload))");

    const [result1, result2] = await Promise.all([
      expr.evaluate({ payload: 1 }, {}),
      expr.evaluate({ payload: 2 }, {})
    ]);

    expect(result1).to.equal('goat');
    expect(result2).to.equal('cheese');
  });
});

describe('Handle chained functions that end in promises', function() {
  const counter = async (count) => ({
    value: count,
    inc: async () => await counter(count + 1)
  });

  var bindings = {
    counter: counter
  };

  it('basic async function', async function() {
    var data = {};
    var expr = await fumifier('$counter(5).value');
    return expect(expr.evaluate(data, bindings)).to.eventually.equal(5);
  });

  it('basic async function, but invokes another function', async function() {
    var data = {};
    var expr = await fumifier('$counter(0).inc().value');
    return expect(expr.evaluate(data, bindings)).to.eventually.equal(1);
  });

  it('basic async function, but invokes another function several times', async function() {
    var data = {};
    var expr = await fumifier('$counter(0).inc().inc().inc().inc().value');
    return expect(expr.evaluate(data, bindings)).to.eventually.equal(4);
  });

  it('basic async function and part of a numeric expression', async function() {
    var data = {};
    var expr = await fumifier('$counter(3).value + 5');
    return expect(expr.evaluate(data, bindings)).to.eventually.equal(8);
  });

  it('basic async function, but invokes another function several times and part of a numeric expression', async function() {
    var data = {};
    var expr = await fumifier('$counter(0).inc().inc().inc().inc().value + 3');
    return expect(expr.evaluate(data, bindings)).to.eventually.equal(7);
  });

  it('basic async function, but invokes another function - nested', async function() {
    var data = {};
    var expr = await fumifier('$counter($counter(3).inc().inc().value).inc().value');
    return expect(expr.evaluate(data, bindings)).to.eventually.equal(6);
  });

  it('basic async function, then invokes a built-in function', async function() {
    var data = {};
    var expr = await fumifier('$counter(3).inc().value.$string()');
    return expect(expr.evaluate(data, bindings)).to.eventually.equal('4');
  });

  it('basic async function, but invokes a non-existent function', async function() {
    var data = {};
    var expr = await fumifier('$counter(2).inc().foo().value');
    return expect(expr.evaluate(data, bindings)).to.be.rejected;
  });

});
