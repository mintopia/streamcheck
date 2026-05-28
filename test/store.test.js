const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MetricStore } = require('../src/store.js');

describe('MetricStore — latest values', () => {
  it('starts with null values', () => {
    const store = new MetricStore();
    const latest = store.getLatest();
    assert.equal(latest.videoBitrate, null);
    assert.equal(latest.lufsMomentary, null);
    assert.equal(latest.truePeak, null);
  });

  it('updates individual metrics', () => {
    const store = new MetricStore();
    store.update({ videoBitrate: 6240 });
    assert.equal(store.getLatest().videoBitrate, 6240);
  });

  it('merges partial updates without overwriting other fields', () => {
    const store = new MetricStore();
    store.update({ videoBitrate: 6240 });
    store.update({ lufsMomentary: -13.2 });
    const latest = store.getLatest();
    assert.equal(latest.videoBitrate, 6240);
    assert.equal(latest.lufsMomentary, -13.2);
  });

  it('stores stream metadata separately', () => {
    const store = new MetricStore();
    store.setStreamInfo({ resolution: '1920x1080', videoCodec: 'h264', framerate: 60 });
    assert.equal(store.getStreamInfo().resolution, '1920x1080');
  });
});

describe('MetricStore — rolling buffer', () => {
  it('records history entries', () => {
    const store = new MetricStore({ maxHistory: 5 });
    store.update({ videoBitrate: 6000 });
    store.recordSnapshot();
    store.update({ videoBitrate: 6100 });
    store.recordSnapshot();
    const history = store.getHistory();
    assert.equal(history.videoBitrate.length, 2);
    assert.deepEqual(history.videoBitrate, [6000, 6100]);
  });

  it('trims history at maxHistory', () => {
    const store = new MetricStore({ maxHistory: 3 });
    for (let i = 0; i < 5; i++) {
      store.update({ videoBitrate: 1000 + i });
      store.recordSnapshot();
    }
    const history = store.getHistory();
    assert.equal(history.videoBitrate.length, 3);
    assert.deepEqual(history.videoBitrate, [1002, 1003, 1004]);
  });

  it('records timestamps with each snapshot', () => {
    const store = new MetricStore({ maxHistory: 10 });
    store.update({ videoBitrate: 5000 });
    store.recordSnapshot();
    const history = store.getHistory();
    assert.equal(history.timestamps.length, 1);
    assert.equal(typeof history.timestamps[0], 'number');
  });

  it('records all metric fields in history', () => {
    const store = new MetricStore({ maxHistory: 10 });
    store.update({
      videoBitrate: 6000,
      audioBitrate: 160,
      lufsMomentary: -13.2,
      lufsShortTerm: -13.8,
      lufsIntegrated: -14.0,
      truePeak: -1.2,
      bufferHealth: 1.0,
      frameDrops: 0,
    });
    store.recordSnapshot();
    const history = store.getHistory();
    assert.equal(history.videoBitrate[0], 6000);
    assert.equal(history.audioBitrate[0], 160);
    assert.equal(history.lufsMomentary[0], -13.2);
    assert.equal(history.lufsShortTerm[0], -13.8);
    assert.equal(history.lufsIntegrated[0], -14.0);
    assert.equal(history.truePeak[0], -1.2);
    assert.equal(history.bufferHealth[0], 1.0);
    assert.equal(history.frameDrops[0], 0);
  });
});

describe('MetricStore — uptime', () => {
  it('tracks start time', () => {
    const store = new MetricStore();
    store.markStarted();
    const uptime = store.getUptime();
    assert.equal(typeof uptime, 'number');
    assert.ok(uptime >= 0);
  });

  it('returns 0 when not started', () => {
    const store = new MetricStore();
    assert.equal(store.getUptime(), 0);
  });
});
