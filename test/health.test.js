const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHealth } = require('../src/health.js');

const defaultThresholds = {
  lufsTarget: -14,
  lufsTolerance: 2,
  bitrateMin: 2500,
  bitrateMax: 8000,
};

describe('evaluateHealth — bitrate', () => {
  it('returns healthy when bitrate is within range', () => {
    const result = evaluateHealth('videoBitrate', 6000, defaultThresholds);
    assert.equal(result, 'healthy');
  });

  it('returns degraded when bitrate is within 10% of minimum', () => {
    const result = evaluateHealth('videoBitrate', 2600, defaultThresholds);
    assert.equal(result, 'degraded');
  });

  it('returns degraded when bitrate is within 10% of maximum', () => {
    const result = evaluateHealth('videoBitrate', 7500, defaultThresholds);
    assert.equal(result, 'degraded');
  });

  it('returns critical when bitrate is below minimum', () => {
    const result = evaluateHealth('videoBitrate', 2000, defaultThresholds);
    assert.equal(result, 'critical');
  });

  it('returns critical when bitrate is above maximum', () => {
    const result = evaluateHealth('videoBitrate', 9000, defaultThresholds);
    assert.equal(result, 'critical');
  });

  it('returns healthy when bitrate is null', () => {
    const result = evaluateHealth('videoBitrate', null, defaultThresholds);
    assert.equal(result, 'healthy');
  });
});

describe('evaluateHealth — LUFS momentary', () => {
  it('returns healthy when within target ± tolerance', () => {
    const result = evaluateHealth('lufsMomentary', -13.5, defaultThresholds);
    assert.equal(result, 'healthy');
  });

  it('returns degraded when within 1.5x tolerance', () => {
    const result = evaluateHealth('lufsMomentary', -11.5, defaultThresholds);
    assert.equal(result, 'degraded');
  });

  it('returns critical when beyond 1.5x tolerance', () => {
    const result = evaluateHealth('lufsMomentary', -10, defaultThresholds);
    assert.equal(result, 'critical');
  });
});

describe('evaluateHealth — true peak', () => {
  it('returns healthy when below -1.0 dBTP', () => {
    const result = evaluateHealth('truePeak', -2.0, defaultThresholds);
    assert.equal(result, 'healthy');
  });

  it('returns degraded when between -1.0 and 0.0', () => {
    const result = evaluateHealth('truePeak', -0.5, defaultThresholds);
    assert.equal(result, 'degraded');
  });

  it('returns critical when above 0.0 (clipping)', () => {
    const result = evaluateHealth('truePeak', 0.5, defaultThresholds);
    assert.equal(result, 'critical');
  });
});

describe('evaluateHealth — buffer health', () => {
  it('returns healthy when speed >= 0.95', () => {
    const result = evaluateHealth('bufferHealth', 1.0, defaultThresholds);
    assert.equal(result, 'healthy');
  });

  it('returns degraded when speed 0.8-0.95', () => {
    const result = evaluateHealth('bufferHealth', 0.9, defaultThresholds);
    assert.equal(result, 'degraded');
  });

  it('returns critical when speed < 0.8', () => {
    const result = evaluateHealth('bufferHealth', 0.7, defaultThresholds);
    assert.equal(result, 'critical');
  });
});

describe('overallStatus', () => {
  const { overallStatus } = require('../src/health.js');

  it('returns healthy when all statuses are healthy', () => {
    const result = overallStatus(['healthy', 'healthy', 'healthy']);
    assert.equal(result, 'healthy');
  });

  it('returns degraded when any status is degraded', () => {
    const result = overallStatus(['healthy', 'degraded', 'healthy']);
    assert.equal(result, 'degraded');
  });

  it('returns critical when any status is critical', () => {
    const result = overallStatus(['healthy', 'degraded', 'critical']);
    assert.equal(result, 'critical');
  });
});
