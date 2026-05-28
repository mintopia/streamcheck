const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseLine } = require('../src/parser.js');

describe('parseLine — stream detection', () => {
  it('parses video stream info', () => {
    const line = 'Stream #0:0: Video: h264 (High), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 60 fps, 60 tbr';
    const result = parseLine(line);
    assert.deepEqual(result, {
      type: 'streamInfo',
      data: {
        resolution: '1920x1080',
        videoCodec: 'h264',
        framerate: 60,
      },
    });
  });

  it('parses audio stream info', () => {
    const line = 'Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp, 160 kb/s';
    const result = parseLine(line);
    assert.deepEqual(result, {
      type: 'streamInfo',
      data: {
        audioCodec: 'aac',
        audioBitrate: 160,
      },
    });
  });

  it('handles video stream without explicit fps', () => {
    const line = 'Stream #0:0: Video: h264 (Main), yuv420p, 1280x720, 30 tbr';
    const result = parseLine(line);
    assert.equal(result.data.resolution, '1280x720');
    assert.equal(result.data.framerate, 30);
  });
});

describe('parseLine — ebur128', () => {
  it('parses momentary and short-term LUFS', () => {
    const line = '[Parsed_ebur128_0 @ 0x1234] t: 1.00039    M: -13.2 S: -14.1     I: -14.0 LUFS     LRA:   0.0 LU';
    const result = parseLine(line);
    assert.equal(result.type, 'ebur128');
    assert.equal(result.data.momentary, -13.2);
    assert.equal(result.data.shortTerm, -14.1);
    assert.equal(result.data.integrated, -14.0);
  });

  it('parses true peak values', () => {
    const line = '[Parsed_ebur128_0 @ 0x1234]     Peak:    -1.2 dBFS  | Peak:    -1.3 dBFS';
    const result = parseLine(line);
    assert.equal(result.type, 'ebur128Peak');
    assert.equal(result.data.truePeak, -1.2);
  });

  it('returns null for unrecognized lines', () => {
    const line = 'Press [q] to stop, [?] for help';
    const result = parseLine(line);
    assert.equal(result, null);
  });
});

describe('parseLine — progress', () => {
  it('parses progress line with bitrate and speed', () => {
    const line = 'frame=  120 fps= 60 q=-1.0 size=N/A time=00:00:02.00 bitrate=6240.5kbits/s speed=1.00x';
    const result = parseLine(line);
    assert.equal(result.type, 'progress');
    assert.equal(result.data.videoBitrate, 6240.5);
    assert.equal(result.data.speed, 1.0);
    assert.equal(result.data.frameDrops, 0);
  });

  it('parses progress line with frame drops', () => {
    const line = 'frame=  240 fps= 60 q=-1.0 size=N/A time=00:00:04.00 bitrate=5800.0kbits/s drop=3 speed=0.98x';
    const result = parseLine(line);
    assert.equal(result.data.frameDrops, 3);
    assert.equal(result.data.speed, 0.98);
  });

  it('handles bitrate in different units', () => {
    const line = 'frame=   60 fps= 30 q=-1.0 size=N/A time=00:00:02.00 bitrate=N/A speed=N/A';
    const result = parseLine(line);
    assert.equal(result.type, 'progress');
    assert.equal(result.data.videoBitrate, null);
    assert.equal(result.data.speed, null);
  });
});
