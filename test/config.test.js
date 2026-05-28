const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('loadConfig', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('reads STREAM_URL from env', () => {
    process.env.STREAM_URL = 'https://twitch.tv/testchannel';
    const { loadConfig } = require('../src/config.js');
    const config = loadConfig();
    assert.equal(config.streamUrl, 'https://twitch.tv/testchannel');
  });

  it('throws when STREAM_URL is missing', () => {
    delete process.env.STREAM_URL;
    delete require.cache[require.resolve('../src/config.js')];
    const { loadConfig } = require('../src/config.js');
    assert.throws(() => loadConfig(), /STREAM_URL/);
  });

  it('uses default values for optional vars', () => {
    process.env.STREAM_URL = 'https://twitch.tv/test';
    delete require.cache[require.resolve('../src/config.js')];
    const { loadConfig } = require('../src/config.js');
    const config = loadConfig();
    assert.equal(config.port, 3000);
    assert.equal(config.lufsTarget, -14);
    assert.equal(config.lufsTolerance, 2);
    assert.equal(config.bitrateMin, 2500);
    assert.equal(config.bitrateMax, 8000);
    assert.equal(config.updateInterval, 1000);
  });

  it('reads custom values from env', () => {
    process.env.STREAM_URL = 'https://twitch.tv/test';
    process.env.PORT = '8080';
    process.env.LUFS_TARGET = '-16';
    process.env.LUFS_TOLERANCE = '3';
    process.env.BITRATE_MIN = '3000';
    process.env.BITRATE_MAX = '10000';
    process.env.UPDATE_INTERVAL = '500';
    delete require.cache[require.resolve('../src/config.js')];
    const { loadConfig } = require('../src/config.js');
    const config = loadConfig();
    assert.equal(config.port, 8080);
    assert.equal(config.lufsTarget, -16);
    assert.equal(config.lufsTolerance, 3);
    assert.equal(config.bitrateMin, 3000);
    assert.equal(config.bitrateMax, 10000);
    assert.equal(config.updateInterval, 500);
  });
});
