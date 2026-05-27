const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseLine } = require('../src/analyzer.js');

describe('parseLine', () => {
  it('parses a complete ebur128 line with all fields', () => {
    const line =
      '[Parsed_ebur128_0 @ 0x7f8] t: 1.201    TARGET:-23 LUFS    M: -18.2 S: -19.1    I: -20.3 LUFS     LRA:   8.2 LU  FTPK: -6.3 dBFS  -5.8 dBFS  TPK: -4.1 dBFS  -3.9 dBFS';
    const result = parseLine(line);
    assert.deepStrictEqual(result, {
      momentary: -18.2,
      shortTerm: -19.1,
      integrated: -20.3,
      lra: 8.2,
      truePeakL: -4.1,
      truePeakR: -3.9,
    });
  });

  it('returns null for non-ebur128 lines', () => {
    assert.strictEqual(parseLine('frame=  100 fps=25 q=-1.0 size=N/A'), null);
    assert.strictEqual(parseLine(''), null);
    assert.strictEqual(parseLine('[info] Stream mapping:'), null);
  });

  it('parses a line with different spacing', () => {
    const line =
      '[Parsed_ebur128_0 @ 0xabc]    t: 0.100    TARGET:-23 LUFS    M:-22.0 S:-23.5    I: -23.0 LUFS     LRA:   0.0 LU  FTPK:-20.1 dBFS -19.8 dBFS  TPK:-20.1 dBFS -19.8 dBFS';
    const result = parseLine(line);
    assert.ok(result);
    assert.strictEqual(result.momentary, -22.0);
    assert.strictEqual(result.shortTerm, -23.5);
    assert.strictEqual(result.integrated, -23.0);
    assert.strictEqual(result.lra, 0.0);
    assert.strictEqual(result.truePeakL, -20.1);
    assert.strictEqual(result.truePeakR, -19.8);
  });

  it('handles infinity values (silent input)', () => {
    const line =
      '[Parsed_ebur128_0 @ 0x1] t: 0.100    TARGET:-23 LUFS    M:-inf S:-inf    I: -inf LUFS     LRA:   0.0 LU  FTPK:-inf dBFS -inf dBFS  TPK:-inf dBFS -inf dBFS';
    const result = parseLine(line);
    assert.ok(result);
    assert.strictEqual(result.momentary, -Infinity);
    assert.strictEqual(result.shortTerm, -Infinity);
    assert.strictEqual(result.integrated, -Infinity);
  });
});

const { Analyzer } = require('../src/analyzer.js');
const { Readable } = require('node:stream');

describe('Analyzer', () => {
  it('emits metrics when fed ebur128 lines', (_, done) => {
    const analyzer = new Analyzer();
    const fakeStderr = new Readable({ read() {} });

    analyzer.on('metrics', (data) => {
      assert.strictEqual(data.momentary, -18.2);
      assert.strictEqual(data.shortTerm, -19.1);
      assert.ok(data.timestamp > 0);
      done();
    });

    analyzer._handleStderr(fakeStderr);
    fakeStderr.push(
      '[Parsed_ebur128_0 @ 0x7f8] t: 1.201    TARGET:-23 LUFS    M: -18.2 S: -19.1    I: -20.3 LUFS     LRA:   8.2 LU  FTPK: -6.3 dBFS  -5.8 dBFS  TPK: -4.1 dBFS  -3.9 dBFS\n'
    );
  });

  it('tracks truePeakMax across updates', () => {
    const analyzer = new Analyzer();
    const fakeStderr = new Readable({ read() {} });
    const results = [];

    analyzer.on('metrics', (data) => results.push(data));
    analyzer._handleStderr(fakeStderr);

    fakeStderr.push(
      '[Parsed_ebur128_0 @ 0x1] t: 0.1    TARGET:-23 LUFS    M: -18.0 S: -19.0    I: -20.0 LUFS     LRA:   8.0 LU  FTPK: -6.0 dBFS  -5.0 dBFS  TPK: -4.0 dBFS  -5.0 dBFS\n'
    );
    fakeStderr.push(
      '[Parsed_ebur128_0 @ 0x1] t: 0.2    TARGET:-23 LUFS    M: -18.0 S: -19.0    I: -20.0 LUFS     LRA:   8.0 LU  FTPK: -6.0 dBFS  -5.0 dBFS  TPK: -2.0 dBFS  -3.0 dBFS\n'
    );

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].truePeakMax, -4.0);
    assert.strictEqual(results[1].truePeakMax, -2.0);
  });
});
