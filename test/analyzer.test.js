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
