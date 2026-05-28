const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseLine } = require('../src/parser.js');

describe('parseLine — stream detection', () => {
  it('parses video stream info (mpegts format)', () => {
    const line = 'Stream #0:1[0x101]: Video: h264 (High) ([27][0][0][0] / 0x001B), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 60 fps, 60 tbr, 90k tbn';
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

  it('parses video stream info (simple format)', () => {
    const line = 'Stream #0:0: Video: h264 (High), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 60 fps, 60 tbr';
    const result = parseLine(line);
    assert.equal(result.data.resolution, '1920x1080');
    assert.equal(result.data.videoCodec, 'h264');
    assert.equal(result.data.framerate, 60);
  });

  it('parses audio stream info with bitrate', () => {
    const line = 'Stream #0:0[0x100]: Audio: aac (LC) ([15][0][0][0] / 0x000F), 48000 Hz, stereo, fltp, 162 kb/s';
    const result = parseLine(line);
    assert.deepEqual(result, {
      type: 'streamInfo',
      data: {
        audioCodec: 'aac',
        audioBitrate: 162,
      },
    });
  });

  it('parses audio stream info without bitrate', () => {
    const line = 'Stream #0:0: Audio: aac (LC), 48000 Hz, stereo, fltp';
    const result = parseLine(line);
    assert.deepEqual(result, {
      type: 'streamInfo',
      data: {
        audioCodec: 'aac',
        audioBitrate: null,
      },
    });
  });

  it('handles video stream with tbr only (no fps)', () => {
    const line = 'Stream #0:0: Video: h264 (Main), yuv420p, 1280x720, 30 tbr';
    const result = parseLine(line);
    assert.equal(result.data.resolution, '1280x720');
    assert.equal(result.data.framerate, 30);
  });
});

describe('parseLine — ebur128', () => {
  it('parses LUFS values from ebur128 line', () => {
    const line = '[Parsed_ebur128_0 @ 0xc61c09c80] t: 1.009979   TARGET:-23 LUFS    M: -38.7 S:-120.7     I: -37.3 LUFS       LRA:   0.0 LU  FTPK: -42.4 -47.1 dBFS  TPK: -22.9 -22.8 dBFS';
    const result = parseLine(line);
    assert.equal(result.type, 'ebur128');
    assert.equal(result.data.momentary, -38.7);
    assert.equal(result.data.shortTerm, -120.7);
    assert.equal(result.data.integrated, -37.3);
  });

  it('parses true peak from the same ebur128 line', () => {
    const line = '[Parsed_ebur128_0 @ 0xc61c09c80] t: 0.109979   TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU  FTPK: -25.8 -25.8 dBFS  TPK: -25.8 -25.8 dBFS';
    const result = parseLine(line);
    assert.equal(result.data.truePeak, -25.8);
  });

  it('takes the louder channel for true peak', () => {
    const line = '[Parsed_ebur128_0 @ 0x1234] t: 0.5   TARGET:-23 LUFS    M: -14.0 S: -14.1     I: -14.0 LUFS       LRA:   0.0 LU  FTPK: -3.0 -5.0 dBFS  TPK: -1.2 -2.5 dBFS';
    const result = parseLine(line);
    assert.equal(result.data.truePeak, -1.2);
  });

  it('parses ebur128 line without TPK field', () => {
    const line = '[Parsed_ebur128_0 @ 0x1234] t: 1.00039    M: -13.2 S: -14.1     I: -14.0 LUFS     LRA:   0.0 LU';
    const result = parseLine(line);
    assert.equal(result.type, 'ebur128');
    assert.equal(result.data.momentary, -13.2);
    assert.equal(result.data.shortTerm, -14.1);
    assert.equal(result.data.integrated, -14.0);
    assert.equal(result.data.truePeak, undefined);
  });

  it('returns null for unrecognized lines', () => {
    const line = 'Press [q] to stop, [?] for help';
    assert.equal(parseLine(line), null);
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

  it('handles N/A bitrate and speed (pipe input)', () => {
    const line = 'frame= 1063 fps= 78 q=-0.0 size=N/A time=00:00:17.71 bitrate=N/A speed= 1.3x elapsed=0:00:13.60';
    const result = parseLine(line);
    assert.equal(result.type, 'progress');
    assert.equal(result.data.videoBitrate, null);
    assert.equal(result.data.speed, 1.3);
  });

  it('handles Lsize variant', () => {
    const line = 'frame= 1429 fps= 62 q=-0.0 Lsize=N/A time=00:00:23.82 bitrate=N/A speed=1.04x elapsed=0:00:22.96';
    const result = parseLine(line);
    assert.equal(result.type, 'progress');
    assert.equal(result.data.speed, 1.04);
  });
});
