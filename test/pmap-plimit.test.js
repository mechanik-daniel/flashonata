import fumifier from '../dist/index.js';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

const expect = chai.expect;
chai.use(chaiAsPromised);

describe('$pMap and $pLimit', function() {
  it('$pMap maps over single value as array', async function() {
    const expr = await fumifier('$pMap(5, function($v){$v * 2})');
    const res = await expr.evaluate({});
    expect(res).to.deep.equal(10);
  });

  it('$pMap with lambda and async I/O', async function() {
    const expr = await fumifier('$pMap([1,2,3], function($v){($wait(5); $v * 3)})');
    const res = await expr.evaluate({});
    expect(res).to.deep.equal([3,6,9]);
  });

  it('$pMap filters out undefined results', async function() {
    const expr = await fumifier('$pMap([1,2,3], function($v){$v > 1 ? $v : undefined})');
    const res = await expr.evaluate({});
    expect(res).to.deep.equal([2,3]);
  });

  it('$pMap works with native async function', async function() {
    const expr = await fumifier('$pMap([1,2,3], $doubleAsync)');
    expr.assign('doubleAsync', async (v) => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return v * 2;
    });
    const res = await expr.evaluate({});
    expect(res).to.deep.equal([2,4,6]);
  });

  it('$pLimit enforces concurrency with single value', async function() {
    const expr = await fumifier('$pLimit(7, 2, function($v){$v + 1})');
    const res = await expr.evaluate({});
    expect(res).to.deep.equal(8);
  });

  it('$pLimit maps with limit over array with lambdas', async function() {
    const expr = await fumifier('$pLimit([1,2,3,4], 2, function($v){($wait(2); $v + 10)})');
    const res = await expr.evaluate({});
    expect(res).to.deep.equal([11,12,13,14]);
  });

  it('$pLimit works with native async', async function() {
    const expr = await fumifier('$pLimit([1,2,3,4], 3, $tripleAsync)');
    expr.assign('tripleAsync', async (v) => {
      await new Promise(resolve => setTimeout(resolve, 3));
      return v * 3;
    });
    const res = await expr.evaluate({});
    expect(res).to.deep.equal([3,6,9,12]);
  });

  it('$pLimit supports optional key function (lambda)', async function() {
    // Even values to lane 0, odd to lane 1; verify mapping still correct
    const expr = await fumifier('$pLimit([1,2,3,4,5], 2, function($v){($wait(1); $v * 10)}, function($v){$v % 2})');
    const res = await expr.evaluate({});
    expect(res).to.deep.equal([10,20,30,40,50]);
  });

  it('$pLimit supports optional key function (native async)', async function() {
    const expr = await fumifier('$pLimit([1,2,3], 2, $incAsync, $keyAsync)');
    expr.assign('incAsync', async (v) => { await new Promise(resolve => setTimeout(resolve, 2)); return v + 1; });
    expr.assign('keyAsync', async (v) => { await new Promise(resolve => setTimeout(resolve, 1)); return v % 2; });
    const res = await expr.evaluate({});
    expect(res).to.deep.equal([2,3,4]);
  });

  it('$pLimit key function can return strings (internal hashing)', async function() {
    const expr = await fumifier('$pLimit(["a","bb","ccc","dddd"], 3, function($v){($wait(1); $length($v))}, function($v){$v})');
    const res = await expr.evaluate({});
    expect(res).to.deep.equal([1,2,3,4]);
  });

  it('$pLimit key function can return booleans (internal mapping)', async function() {
    const expr = await fumifier('$pLimit([1,2,3,4], 2, function($v){($wait(1); $v*2)}, function($v){$v % 2 = 1})');
    const res = await expr.evaluate({});
    expect(res).to.deep.equal([2,4,6,8]);
  });

  it('$hash returns deterministic 32-bit numbers for various types', async function() {
    const expr = await fumifier('[$hash("abc"), $hash("abc"), $hash("abd"), $hash(42), $hash(true), $hash(null)]');
    const res = await expr.evaluate({});
    expect(res[0]).to.equal(res[1]);
    expect(res[0]).to.not.equal(res[2]);
    expect(res[3]).to.be.a('number');
    expect(res[4]).to.be.a('number');
    expect(res[5]).to.be.a('number');
  });

  it('$hash is stable for objects regardless of key order', async function() {
    const expr = await fumifier('$hash({"a":1,"b":2}) = $hash({"b":2,"a":1})');
    const res = await expr.evaluate({});
    expect(res).to.equal(true);
  });
});
