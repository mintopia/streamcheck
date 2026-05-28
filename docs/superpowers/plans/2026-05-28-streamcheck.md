# StreamCheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-based Twitch stream monitoring dashboard that displays real-time quality metrics (bitrate, LUFS, true peak, framerate, resolution, buffer health) via WebSocket push.

**Architecture:** Single Node.js process. Streamlink resolves Twitch URL to HLS, pipes to FFmpeg with ebur128 filter. A stderr line parser extracts metrics into an in-memory rolling buffer. Express serves a static dashboard that receives updates over WebSocket. No framework on the frontend — vanilla JS with canvas charts.

**Tech Stack:** Node.js, Express, ws (WebSocket), streamlink + FFmpeg (external binaries), vanilla HTML/CSS/JS, hand-rolled canvas charts

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies and scripts |
| `.env.example` | Documented env var template |
| `src/config.js` | Read and validate env vars, export config object |
| `src/parser.js` | Parse FFmpeg stderr lines into structured metric objects |
| `src/health.js` | Evaluate metric values against thresholds, derive status |
| `src/store.js` | In-memory metric store with rolling time-series buffer |
| `src/analyzer.js` | Spawn streamlink + FFmpeg, pipe stderr to parser, feed store |
| `src/server.js` | Express + WebSocket server, broadcast loop, entry point |
| `public/index.html` | Dashboard markup |
| `public/style.css` | Dark + light themes, layout, status colors |
| `public/app.js` | WebSocket client, DOM updates, chart rendering |
| `test/config.test.js` | Config validation tests |
| `test/parser.test.js` | FFmpeg stderr parsing tests |
| `test/health.test.js` | Threshold evaluation tests |
| `test/store.test.js` | Metric store + rolling buffer tests |
| `Dockerfile` | Container with streamlink + FFmpeg |

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `src/`, `public/`, `test/` directories

- [ ] **Step 1: Initialize package.json**

```bash
npm init -y
```

Then edit `package.json` to set the project metadata and scripts:

```json
{
  "name": "streamcheck",
  "version": "1.0.0",
  "description": "Twitch stream quality monitor",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test test/**/*.test.js"
  },
  "keywords": [],
  "license": "MIT"
}
```

Note: We use Node's built-in test runner (`node --test`) — no test framework dependency needed.

- [ ] **Step 2: Install dependencies**

```bash
npm install express ws
```

- [ ] **Step 3: Create directory structure and .env.example**

```bash
mkdir -p src public test
```

Create `.env.example`:

```env
# Required: Twitch stream URL
STREAM_URL=https://twitch.tv/channelname

# Optional: Web server port (default: 3000)
PORT=3000

# Optional: LUFS target and tolerance (default: -14 ±2)
LUFS_TARGET=-14
LUFS_TOLERANCE=2

# Optional: Video bitrate range in kbps (default: 2500-8000)
BITRATE_MIN=2500
BITRATE_MAX=8000

# Optional: WebSocket push interval in ms (default: 1000)
UPDATE_INTERVAL=1000
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example src/ public/ test/
git commit -m "feat: scaffold project with dependencies"
```

---

### Task 2: Config Module

**Files:**
- Create: `src/config.js`
- Create: `test/config.test.js`

- [ ] **Step 1: Write failing tests for config**

Create `test/config.test.js`:

```js
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
    // Clear module cache so loadConfig re-reads env
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/config.test.js
```

Expected: FAIL — `Cannot find module '../src/config.js'`

- [ ] **Step 3: Implement config module**

Create `src/config.js`:

```js
function loadConfig() {
  const streamUrl = process.env.STREAM_URL;
  if (!streamUrl) {
    throw new Error('STREAM_URL environment variable is required');
  }

  return {
    streamUrl,
    port: parseInt(process.env.PORT, 10) || 3000,
    lufsTarget: parseFloat(process.env.LUFS_TARGET) || -14,
    lufsTolerance: parseFloat(process.env.LUFS_TOLERANCE) || 2,
    bitrateMin: parseInt(process.env.BITRATE_MIN, 10) || 2500,
    bitrateMax: parseInt(process.env.BITRATE_MAX, 10) || 8000,
    updateInterval: parseInt(process.env.UPDATE_INTERVAL, 10) || 1000,
  };
}

module.exports = { loadConfig };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/config.test.js
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat: config module reads and validates env vars"
```

---

### Task 3: FFmpeg Stderr Parser

**Files:**
- Create: `src/parser.js`
- Create: `test/parser.test.js`

The parser handles three types of FFmpeg stderr output:
1. **Stream detection lines** — resolution, codec, framerate (appear once at start)
2. **ebur128 filter lines** — LUFS momentary/short-term/integrated, true peak (appear frequently)
3. **Progress lines** — bitrate, speed, frame drops (appear every ~1s)

- [ ] **Step 1: Write failing tests for stream detection parsing**

Create `test/parser.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/parser.test.js
```

Expected: FAIL — `Cannot find module '../src/parser.js'`

- [ ] **Step 3: Implement the parser**

Create `src/parser.js`:

```js
const VIDEO_STREAM_RE = /Stream #\d+:\d+.*Video:\s+(\w+).*?,\s+\w+,\s+(\d+x\d+).*?(\d+(?:\.\d+)?)\s+(?:fps|tbr)/;
const AUDIO_STREAM_RE = /Stream #\d+:\d+.*Audio:\s+(\w+).*?,\s+(\d+)\s+kb\/s/;
const AUDIO_STREAM_RE_ALT = /Stream #\d+:\d+.*Audio:\s+(\w+)/;
const EBUR128_RE = /\[Parsed_ebur128.*?\]\s+t:\s*[\d.]+\s+M:\s*([-\d.]+)\s+S:\s*([-\d.]+)\s+I:\s*([-\d.]+)/;
const EBUR128_PEAK_RE = /\[Parsed_ebur128.*?\]\s+Peak:\s*([-\d.]+)\s+dBFS/;
const PROGRESS_RE = /frame=\s*\d+/;

function parseLine(line) {
  let match;

  match = line.match(VIDEO_STREAM_RE);
  if (match) {
    return {
      type: 'streamInfo',
      data: {
        resolution: match[2],
        videoCodec: match[1],
        framerate: parseFloat(match[3]),
      },
    };
  }

  match = line.match(AUDIO_STREAM_RE);
  if (match) {
    return {
      type: 'streamInfo',
      data: {
        audioCodec: match[1],
        audioBitrate: parseInt(match[2], 10),
      },
    };
  }

  if (!match && AUDIO_STREAM_RE_ALT.test(line) && line.includes('Audio:')) {
    const codecMatch = line.match(AUDIO_STREAM_RE_ALT);
    if (codecMatch) {
      return {
        type: 'streamInfo',
        data: {
          audioCodec: codecMatch[1],
          audioBitrate: null,
        },
      };
    }
  }

  match = line.match(EBUR128_RE);
  if (match) {
    return {
      type: 'ebur128',
      data: {
        momentary: parseFloat(match[1]),
        shortTerm: parseFloat(match[2]),
        integrated: parseFloat(match[3]),
      },
    };
  }

  match = line.match(EBUR128_PEAK_RE);
  if (match) {
    return {
      type: 'ebur128Peak',
      data: {
        truePeak: parseFloat(match[1]),
      },
    };
  }

  if (PROGRESS_RE.test(line)) {
    const bitrateMatch = line.match(/bitrate=\s*([\d.]+)kbits\/s/);
    const speedMatch = line.match(/speed=\s*([\d.]+)x/);
    const dropMatch = line.match(/drop=\s*(\d+)/);

    return {
      type: 'progress',
      data: {
        videoBitrate: bitrateMatch ? parseFloat(bitrateMatch[1]) : null,
        speed: speedMatch ? parseFloat(speedMatch[1]) : null,
        frameDrops: dropMatch ? parseInt(dropMatch[1], 10) : 0,
      },
    };
  }

  return null;
}

module.exports = { parseLine };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/parser.test.js
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parser.js test/parser.test.js
git commit -m "feat: FFmpeg stderr line parser with tests"
```

---

### Task 4: Health Evaluation

**Files:**
- Create: `src/health.js`
- Create: `test/health.test.js`

- [ ] **Step 1: Write failing tests for health evaluation**

Create `test/health.test.js`:

```js
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
    // 10% above bitrateMin (2500) = 2750. Value 2600 is in degraded zone.
    const result = evaluateHealth('videoBitrate', 2600, defaultThresholds);
    assert.equal(result, 'degraded');
  });

  it('returns degraded when bitrate is within 10% of maximum', () => {
    // 10% below bitrateMax (8000) = 7200. Value 7500 is in degraded zone.
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
    // Target -14, tolerance 2. Healthy range: -16 to -12.
    // 1.5x tolerance = 3. Degraded range: -17 to -16, -12 to -11.
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/health.test.js
```

Expected: FAIL — `Cannot find module '../src/health.js'`

- [ ] **Step 3: Implement health evaluation**

Create `src/health.js`:

```js
function evaluateHealth(metric, value, thresholds) {
  if (value === null || value === undefined) return 'healthy';

  switch (metric) {
    case 'videoBitrate':
      return evaluateBitrate(value, thresholds);
    case 'lufsMomentary':
      return evaluateLufs(value, thresholds);
    case 'truePeak':
      return evaluateTruePeak(value);
    case 'bufferHealth':
      return evaluateBuffer(value);
    default:
      return 'healthy';
  }
}

function evaluateBitrate(value, { bitrateMin, bitrateMax }) {
  if (value < bitrateMin || value > bitrateMax) return 'critical';
  const lowerDegraded = bitrateMin + (bitrateMax - bitrateMin) * 0.1;
  const upperDegraded = bitrateMax - (bitrateMax - bitrateMin) * 0.1;
  if (value < lowerDegraded || value > upperDegraded) return 'degraded';
  return 'healthy';
}

function evaluateLufs(value, { lufsTarget, lufsTolerance }) {
  const deviation = Math.abs(value - lufsTarget);
  if (deviation <= lufsTolerance) return 'healthy';
  if (deviation <= lufsTolerance * 1.5) return 'degraded';
  return 'critical';
}

function evaluateTruePeak(value) {
  if (value > 0) return 'critical';
  if (value >= -1.0) return 'degraded';
  return 'healthy';
}

function evaluateBuffer(value) {
  if (value >= 0.95) return 'healthy';
  if (value >= 0.8) return 'degraded';
  return 'critical';
}

function overallStatus(statuses) {
  if (statuses.includes('critical')) return 'critical';
  if (statuses.includes('degraded')) return 'degraded';
  return 'healthy';
}

module.exports = { evaluateHealth, overallStatus };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/health.test.js
```

Expected: All 14 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/health.js test/health.test.js
git commit -m "feat: health evaluation with threshold logic"
```

---

### Task 5: Metric Store

**Files:**
- Create: `src/store.js`
- Create: `test/store.test.js`

- [ ] **Step 1: Write failing tests for metric store**

Create `test/store.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/store.test.js
```

Expected: FAIL — `Cannot find module '../src/store.js'`

- [ ] **Step 3: Implement the metric store**

Create `src/store.js`:

```js
const HISTORY_FIELDS = [
  'videoBitrate', 'audioBitrate', 'lufsMomentary', 'lufsShortTerm',
  'lufsIntegrated', 'truePeak', 'bufferHealth', 'frameDrops',
];

class MetricStore {
  constructor({ maxHistory = 1800 } = {}) {
    this._maxHistory = maxHistory;
    this._latest = {
      videoBitrate: null,
      audioBitrate: null,
      lufsMomentary: null,
      lufsShortTerm: null,
      lufsIntegrated: null,
      truePeak: null,
      bufferHealth: null,
      frameDrops: null,
    };
    this._streamInfo = {};
    this._history = { timestamps: [] };
    for (const field of HISTORY_FIELDS) {
      this._history[field] = [];
    }
    this._startedAt = null;
  }

  update(metrics) {
    for (const [key, value] of Object.entries(metrics)) {
      if (key in this._latest) {
        this._latest[key] = value;
      }
    }
  }

  getLatest() {
    return { ...this._latest };
  }

  setStreamInfo(info) {
    Object.assign(this._streamInfo, info);
  }

  getStreamInfo() {
    return { ...this._streamInfo };
  }

  recordSnapshot() {
    this._history.timestamps.push(Date.now());
    for (const field of HISTORY_FIELDS) {
      this._history[field].push(this._latest[field]);
    }
    if (this._history.timestamps.length > this._maxHistory) {
      const excess = this._history.timestamps.length - this._maxHistory;
      this._history.timestamps.splice(0, excess);
      for (const field of HISTORY_FIELDS) {
        this._history[field].splice(0, excess);
      }
    }
  }

  getHistory() {
    return {
      timestamps: [...this._history.timestamps],
      ...Object.fromEntries(
        HISTORY_FIELDS.map(f => [f, [...this._history[f]]])
      ),
    };
  }

  markStarted() {
    this._startedAt = Date.now();
  }

  getUptime() {
    if (!this._startedAt) return 0;
    return Math.floor((Date.now() - this._startedAt) / 1000);
  }
}

module.exports = { MetricStore };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/store.test.js
```

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store.js test/store.test.js
git commit -m "feat: in-memory metric store with rolling buffer"
```

---

### Task 6: Analyzer (Stream Acquisition)

**Files:**
- Create: `src/analyzer.js`

No unit tests for this module — it spawns external processes (streamlink, ffmpeg). Tested via manual verification against a live stream.

- [ ] **Step 1: Implement the analyzer**

Create `src/analyzer.js`:

```js
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const readline = require('node:readline');
const { parseLine } = require('./parser.js');

class Analyzer extends EventEmitter {
  constructor(streamUrl) {
    super();
    this._streamUrl = streamUrl;
    this._streamlink = null;
    this._ffmpeg = null;
    this._stopping = false;
    this._reconnectDelay = 1000;
    this._maxReconnectDelay = 30000;
  }

  start() {
    this._stopping = false;
    this._spawn();
  }

  stop() {
    this._stopping = true;
    if (this._ffmpeg) this._ffmpeg.kill('SIGTERM');
    if (this._streamlink) this._streamlink.kill('SIGTERM');
  }

  _spawn() {
    this.emit('state', { type: 'connecting', message: 'Connecting to stream...' });

    this._streamlink = spawn('streamlink', [this._streamUrl, 'best', '--stdout'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this._ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-filter:a', 'ebur128=peak=true:framelog=verbose',
      '-f', 'null', '-',
    ], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    this._streamlink.stdout.pipe(this._ffmpeg.stdin);

    const rl = readline.createInterface({ input: this._ffmpeg.stderr });
    rl.on('line', (line) => {
      const parsed = parseLine(line);
      if (parsed) this.emit('metric', parsed);
    });

    this._streamlink.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text.includes('error') || text.includes('No playable streams')) {
        this.emit('state', { type: 'offline', message: 'Stream is offline', lastSeen: Date.now() });
      }
    });

    const onExit = (process, name) => {
      process.on('exit', (code) => {
        if (this._stopping) return;
        this.emit('state', {
          type: 'error',
          message: `${name} exited with code ${code}`,
          retryIn: this._reconnectDelay,
        });
        this._scheduleReconnect();
      });
    };

    onExit(this._streamlink, 'streamlink');
    onExit(this._ffmpeg, 'ffmpeg');
  }

  _scheduleReconnect() {
    if (this._stopping) return;
    setTimeout(() => {
      if (this._stopping) return;
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxReconnectDelay);
      this._spawn();
    }, this._reconnectDelay);
  }

  resetReconnectDelay() {
    this._reconnectDelay = 1000;
  }
}

module.exports = { Analyzer };
```

- [ ] **Step 2: Commit**

```bash
git add src/analyzer.js
git commit -m "feat: analyzer spawns streamlink + FFmpeg with reconnect"
```

---

### Task 7: Express + WebSocket Server

**Files:**
- Create: `src/server.js`

- [ ] **Step 1: Implement the server**

Create `src/server.js`:

```js
const express = require('express');
const { createServer } = require('node:http');
const { WebSocketServer } = require('ws');
const path = require('node:path');
const { loadConfig } = require('./config.js');
const { Analyzer } = require('./analyzer.js');
const { MetricStore } = require('./store.js');
const { evaluateHealth, overallStatus } = require('./health.js');

const config = loadConfig();
const store = new MetricStore();
const analyzer = new Analyzer(config.streamUrl);

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let currentState = { type: 'connecting', message: 'Starting...' };

analyzer.on('metric', (parsed) => {
  switch (parsed.type) {
    case 'streamInfo':
      store.setStreamInfo(parsed.data);
      if (parsed.data.audioBitrate != null) {
        store.update({ audioBitrate: parsed.data.audioBitrate });
      }
      if (!store.getUptime()) {
        store.markStarted();
        analyzer.resetReconnectDelay();
      }
      break;
    case 'ebur128':
      store.update({
        lufsMomentary: parsed.data.momentary,
        lufsShortTerm: parsed.data.shortTerm,
        lufsIntegrated: parsed.data.integrated,
      });
      break;
    case 'ebur128Peak':
      store.update({ truePeak: parsed.data.truePeak });
      break;
    case 'progress':
      store.update({
        videoBitrate: parsed.data.videoBitrate,
        bufferHealth: parsed.data.speed,
        frameDrops: parsed.data.frameDrops,
      });
      break;
  }
});

analyzer.on('state', (state) => {
  currentState = state;
  broadcast(JSON.stringify(state));
});

function buildMetricsMessage() {
  const latest = store.getLatest();
  const streamInfo = store.getStreamInfo();
  const thresholds = {
    lufsTarget: config.lufsTarget,
    lufsTolerance: config.lufsTolerance,
    bitrateMin: config.bitrateMin,
    bitrateMax: config.bitrateMax,
  };

  const statuses = [
    evaluateHealth('videoBitrate', latest.videoBitrate, thresholds),
    evaluateHealth('lufsMomentary', latest.lufsMomentary, thresholds),
    evaluateHealth('truePeak', latest.truePeak, thresholds),
    evaluateHealth('bufferHealth', latest.bufferHealth, thresholds),
  ];

  return {
    type: 'metrics',
    timestamp: Date.now(),
    status: overallStatus(statuses),
    stream: {
      url: config.streamUrl,
      uptime: store.getUptime(),
      resolution: streamInfo.resolution || null,
      videoCodec: streamInfo.videoCodec || null,
      audioCodec: streamInfo.audioCodec || null,
      framerate: streamInfo.framerate || null,
    },
    metrics: {
      videoBitrate: { value: latest.videoBitrate, unit: 'kbps', status: evaluateHealth('videoBitrate', latest.videoBitrate, thresholds) },
      audioBitrate: { value: latest.audioBitrate, unit: 'kbps', status: 'healthy' },
      lufs: {
        momentary: { value: latest.lufsMomentary, unit: 'LUFS', status: evaluateHealth('lufsMomentary', latest.lufsMomentary, thresholds) },
        shortTerm: { value: latest.lufsShortTerm, unit: 'LUFS', status: 'healthy' },
        integrated: { value: latest.lufsIntegrated, unit: 'LUFS', status: 'healthy' },
      },
      truePeak: { value: latest.truePeak, unit: 'dBTP', status: evaluateHealth('truePeak', latest.truePeak, thresholds) },
      frameDrops: { value: latest.frameDrops, unit: 'frames', status: 'healthy' },
      bufferHealth: { value: latest.bufferHealth, unit: 'x', status: evaluateHealth('bufferHealth', latest.bufferHealth, thresholds) },
    },
    history: store.getHistory(),
    thresholds: {
      lufsTarget: config.lufsTarget,
      lufsTolerance: config.lufsTolerance,
      bitrateMin: config.bitrateMin,
      bitrateMax: config.bitrateMax,
    },
  };
}

function broadcast(data) {
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

wss.on('connection', (ws) => {
  if (store.getUptime() > 0) {
    ws.send(JSON.stringify(buildMetricsMessage()));
  } else {
    ws.send(JSON.stringify(currentState));
  }
});

const broadcastInterval = setInterval(() => {
  if (store.getUptime() > 0) {
    store.recordSnapshot();
    broadcast(JSON.stringify(buildMetricsMessage()));
  }
}, config.updateInterval);

server.listen(config.port, () => {
  console.log(`StreamCheck listening on http://localhost:${config.port}`);
  analyzer.start();
});

function shutdown() {
  console.log('Shutting down...');
  clearInterval(broadcastInterval);
  analyzer.stop();
  wss.close();
  server.close();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

- [ ] **Step 2: Commit**

```bash
git add src/server.js
git commit -m "feat: Express + WebSocket server with broadcast loop"
```

---

### Task 8: Dashboard HTML

**Files:**
- Create: `public/index.html`

- [ ] **Step 1: Create the dashboard markup**

Create `public/index.html`:

```html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StreamCheck</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="no-stream" class="no-stream" hidden>
    <p>No stream URL configured. Set <code>STREAM_URL</code> and restart.</p>
  </div>

  <div id="app">
    <!-- Tier 1: Status Banner -->
    <header id="status-banner" class="status-banner status-connecting">
      <div class="banner-left">
        <span id="status-icon" class="status-icon">&#9679;</span>
        <span id="status-label">CONNECTING</span>
      </div>
      <div class="banner-center">
        <span id="stream-url"></span>
      </div>
      <div class="banner-right">
        <span id="uptime">--:--:--</span>
        <button id="theme-toggle" class="theme-toggle" title="Toggle theme">
          <span class="theme-icon-dark">&#9790;</span>
          <span class="theme-icon-light">&#9788;</span>
        </button>
      </div>
    </header>

    <!-- Tier 2: Metric Panels -->
    <section class="metrics">
      <div class="metrics-primary">
        <div class="metric" id="m-bitrate">
          <span class="metric-status" id="ms-bitrate">&#9679;</span>
          <span class="metric-label">VIDEO BITRATE</span>
          <span class="metric-value" id="mv-bitrate">--</span>
          <span class="metric-unit">kbps</span>
          <span class="metric-threshold" id="mt-bitrate"></span>
        </div>
        <div class="metric" id="m-lufs">
          <span class="metric-status" id="ms-lufs">&#9679;</span>
          <span class="metric-label">LUFS MOMENTARY</span>
          <span class="metric-value" id="mv-lufs">--</span>
          <span class="metric-unit">LUFS</span>
          <span class="metric-threshold" id="mt-lufs"></span>
        </div>
        <div class="metric" id="m-peak">
          <span class="metric-status" id="ms-peak">&#9679;</span>
          <span class="metric-label">TRUE PEAK</span>
          <span class="metric-value" id="mv-peak">--</span>
          <span class="metric-unit">dBTP</span>
          <span class="metric-threshold">&#60; -1.0</span>
        </div>
        <div class="metric" id="m-buffer">
          <span class="metric-status" id="ms-buffer">&#9679;</span>
          <span class="metric-label">BUFFER HEALTH</span>
          <span class="metric-value" id="mv-buffer">--</span>
          <span class="metric-unit">x</span>
          <span class="metric-threshold">&ge; 0.95</span>
        </div>
      </div>
      <div class="metrics-secondary">
        <div class="metric-sm">
          <span class="metric-label">AUDIO</span>
          <span class="metric-value" id="mv-audio">--</span>
          <span class="metric-unit">kbps</span>
          <span class="metric-detail" id="md-audio-codec">--</span>
        </div>
        <div class="metric-sm">
          <span class="metric-label">LUFS SHORT</span>
          <span class="metric-value" id="mv-lufs-short">--</span>
          <span class="metric-unit">LUFS</span>
        </div>
        <div class="metric-sm">
          <span class="metric-label">LUFS INT</span>
          <span class="metric-value" id="mv-lufs-int">--</span>
          <span class="metric-unit">LUFS</span>
        </div>
        <div class="metric-sm">
          <span class="metric-label">RESOLUTION</span>
          <span class="metric-value" id="mv-resolution">--</span>
          <span class="metric-detail" id="md-video-codec">--</span>
        </div>
        <div class="metric-sm">
          <span class="metric-label">FPS</span>
          <span class="metric-value" id="mv-fps">--</span>
        </div>
        <div class="metric-sm">
          <span class="metric-label">DROPS</span>
          <span class="metric-value" id="mv-drops">0</span>
          <span class="metric-status" id="ms-drops">&#9679;</span>
        </div>
      </div>
    </section>

    <!-- Tier 3: Charts -->
    <section class="charts">
      <div class="chart-controls">
        <button class="chart-window active" data-window="300">5 min</button>
        <button class="chart-window" data-window="900">15 min</button>
        <button class="chart-window" data-window="1800">30 min</button>
      </div>
      <div class="chart-row">
        <div class="chart-container">
          <div class="chart-header">VIDEO BITRATE</div>
          <canvas id="chart-bitrate" width="600" height="200"></canvas>
        </div>
        <div class="chart-container">
          <div class="chart-header">LUFS MOMENTARY</div>
          <canvas id="chart-lufs" width="600" height="200"></canvas>
        </div>
      </div>
    </section>
  </div>

  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: dashboard HTML structure"
```

---

### Task 9: Dashboard CSS (Dark + Light Themes)

**Files:**
- Create: `public/style.css`

- [ ] **Step 1: Create the stylesheet**

Create `public/style.css`. This implements the restrained color strategy with warm-grey neutrals, status colors only, system fonts, and monospace for values.

```css
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-mono: "SF Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace;

  --status-healthy: oklch(0.65 0.15 145);
  --status-degraded: oklch(0.70 0.15 75);
  --status-critical: oklch(0.60 0.18 25);
  --status-neutral: oklch(0.55 0.01 250);

  --banner-healthy: oklch(0.25 0.04 145);
  --banner-degraded: oklch(0.28 0.05 75);
  --banner-critical: oklch(0.25 0.06 25);
  --banner-neutral: oklch(0.22 0.005 250);
}

[data-theme="dark"] {
  --bg-base: oklch(0.15 0.005 70);
  --bg-surface: oklch(0.19 0.005 70);
  --bg-elevated: oklch(0.23 0.005 70);
  --border: oklch(0.30 0.005 70);
  --text-primary: oklch(0.90 0.005 70);
  --text-secondary: oklch(0.60 0.005 70);
  --text-muted: oklch(0.45 0.005 70);
  --chart-line: oklch(0.70 0.005 70);
  --chart-band: oklch(0.30 0.02 145 / 0.3);
}

[data-theme="light"] {
  --bg-base: oklch(0.96 0.005 70);
  --bg-surface: oklch(0.98 0.005 70);
  --bg-elevated: oklch(1.0 0.003 70);
  --border: oklch(0.85 0.005 70);
  --text-primary: oklch(0.15 0.005 70);
  --text-secondary: oklch(0.45 0.005 70);
  --text-muted: oklch(0.60 0.005 70);
  --chart-line: oklch(0.35 0.005 70);
  --chart-band: oklch(0.70 0.02 145 / 0.25);

  --banner-healthy: oklch(0.90 0.04 145);
  --banner-degraded: oklch(0.88 0.05 75);
  --banner-critical: oklch(0.88 0.06 25);
  --banner-neutral: oklch(0.92 0.005 250);
}

html {
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.4;
  color: var(--text-primary);
  background: var(--bg-base);
}

body {
  min-width: 1280px;
}

.no-stream {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: var(--text-secondary);
  font-size: 1.125rem;
}

.no-stream code {
  font-family: var(--font-mono);
  background: var(--bg-elevated);
  padding: 0.15em 0.4em;
  border-radius: 3px;
}

/* Status Banner */
.status-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.25rem;
  background: var(--banner-neutral);
  transition: background-color 0.4s ease-out;
}

.status-banner.status-healthy { background: var(--banner-healthy); }
.status-banner.status-degraded { background: var(--banner-degraded); }
.status-banner.status-critical { background: var(--banner-critical); }
.status-banner.status-connecting { background: var(--banner-neutral); }
.status-banner.status-offline { background: var(--banner-neutral); }
.status-banner.status-error { background: var(--banner-critical); }

.banner-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 1rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.status-icon {
  font-size: 0.75rem;
}

.status-healthy .status-icon { color: var(--status-healthy); }
.status-degraded .status-icon { color: var(--status-degraded); }
.status-critical .status-icon { color: var(--status-critical); }
.status-connecting .status-icon { color: var(--status-neutral); animation: pulse 1.5s ease-in-out infinite; }
.status-offline .status-icon { color: var(--status-neutral); }
.status-error .status-icon { color: var(--status-critical); }

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.banner-center {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.banner-right {
  display: flex;
  align-items: center;
  gap: 1rem;
  font-family: var(--font-mono);
  font-size: 0.9rem;
}

.theme-toggle {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 1rem;
  line-height: 1;
}

.theme-toggle:hover { color: var(--text-primary); }

[data-theme="dark"] .theme-icon-light { display: none; }
[data-theme="light"] .theme-icon-dark { display: none; }

/* Metric Panels */
.metrics {
  padding: 1rem 1.25rem;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
}

.metrics-primary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.metric {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 4px;
  flex-wrap: wrap;
}

.metric-status {
  font-size: 0.6rem;
  color: var(--status-healthy);
  flex-shrink: 0;
}

.metric-status.degraded { color: var(--status-degraded); }
.metric-status.critical { color: var(--status-critical); }

.metric-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  text-transform: uppercase;
}

.metric-value {
  font-family: var(--font-mono);
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-left: auto;
}

.metric-unit {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.metric-threshold {
  font-size: 0.7rem;
  font-family: var(--font-mono);
  color: var(--text-muted);
  width: 100%;
  text-align: right;
}

.metrics-secondary {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.5rem;
}

.metric-sm {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  padding: 0.35rem 0.5rem;
  flex-wrap: wrap;
}

.metric-sm .metric-label {
  font-size: 0.6rem;
}

.metric-sm .metric-value {
  font-family: var(--font-mono);
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-left: auto;
}

.metric-sm .metric-unit {
  font-size: 0.65rem;
}

.metric-detail {
  font-size: 0.65rem;
  color: var(--text-muted);
  width: 100%;
  text-align: right;
}

/* Charts */
.charts {
  padding: 1rem 1.25rem;
}

.chart-controls {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
}

.chart-window {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  padding: 0.25rem 0.75rem;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-secondary);
  cursor: pointer;
}

.chart-window:hover { color: var(--text-primary); }
.chart-window.active {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.chart-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.chart-container {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.75rem;
}

.chart-header {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-bottom: 0.5rem;
}

canvas {
  width: 100%;
  height: 200px;
  display: block;
}

/* Skeleton state */
.skeleton .metric-value {
  background: var(--bg-elevated);
  color: transparent;
  border-radius: 3px;
  animation: pulse 1.5s ease-in-out infinite;
}

/* Stale data indicator */
.stale .metric-value {
  opacity: 0.4;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat: dashboard CSS with dark/light themes and status colors"
```

---

### Task 10: Dashboard JavaScript (WebSocket + DOM + Charts)

**Files:**
- Create: `public/app.js`

- [ ] **Step 1: Create the dashboard client**

Create `public/app.js`:

```js
(function () {
  'use strict';

  const RECONNECT_DELAY = 2000;
  let ws;
  let chartWindow = 300;
  let lastData = null;

  // Theme
  const theme = localStorage.getItem('streamcheck-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', theme);

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('streamcheck-theme', next);
    if (lastData) renderCharts(lastData);
  });

  // Chart window selector
  document.querySelectorAll('.chart-window').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelector('.chart-window.active').classList.remove('active');
      btn.classList.add('active');
      chartWindow = parseInt(btn.dataset.window, 10);
      if (lastData) renderCharts(lastData);
    });
  });

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      handleMessage(data);
    });

    ws.addEventListener('close', () => {
      setTimeout(connect, RECONNECT_DELAY);
    });
  }

  function handleMessage(data) {
    switch (data.type) {
      case 'metrics':
        lastData = data;
        renderBanner(data);
        renderMetrics(data);
        renderCharts(data);
        break;
      case 'connecting':
        setBannerState('connecting', data.message);
        break;
      case 'offline':
        setBannerState('offline', 'STREAM OFFLINE');
        break;
      case 'error':
        setBannerState('error', data.message + (data.retryIn ? ` (retry in ${Math.round(data.retryIn / 1000)}s)` : ''));
        break;
    }
  }

  function setBannerState(state, text) {
    const banner = document.getElementById('status-banner');
    banner.className = `status-banner status-${state}`;
    document.getElementById('status-label').textContent = text;
  }

  function renderBanner(data) {
    const banner = document.getElementById('status-banner');
    banner.className = `status-banner status-${data.status}`;
    document.getElementById('status-label').textContent = data.status.toUpperCase();
    document.getElementById('stream-url').textContent = data.stream.url;
    document.getElementById('uptime').textContent = formatUptime(data.stream.uptime);
  }

  function renderMetrics(data) {
    const m = data.metrics;
    const t = data.thresholds;

    setValue('mv-bitrate', formatNumber(m.videoBitrate.value));
    setStatus('ms-bitrate', m.videoBitrate.status);
    document.getElementById('mt-bitrate').textContent = `${t.bitrateMin}–${t.bitrateMax}`;

    setValue('mv-lufs', formatDecimal(m.lufs.momentary.value, 1));
    setStatus('ms-lufs', m.lufs.momentary.status);
    document.getElementById('mt-lufs').textContent = `${t.lufsTarget} ±${t.lufsTolerance}`;

    setValue('mv-peak', formatDecimal(m.truePeak.value, 1));
    setStatus('ms-peak', m.truePeak.status);

    setValue('mv-buffer', formatDecimal(m.bufferHealth.value, 2));
    setStatus('ms-buffer', m.bufferHealth.status);

    setValue('mv-audio', formatNumber(m.audioBitrate.value));
    setValue('mv-lufs-short', formatDecimal(m.lufs.shortTerm.value, 1));
    setValue('mv-lufs-int', formatDecimal(m.lufs.integrated.value, 1));
    setValue('mv-resolution', data.stream.resolution || '--');
    setValue('mv-fps', data.stream.framerate != null ? data.stream.framerate : '--');
    setValue('mv-drops', formatNumber(m.frameDrops.value));

    document.getElementById('md-audio-codec').textContent = data.stream.audioCodec ? data.stream.audioCodec.toUpperCase() : '--';
    document.getElementById('md-video-codec').textContent = data.stream.videoCodec ? data.stream.videoCodec.toUpperCase() : '--';

    if (m.frameDrops.value > 0) {
      setStatus('ms-drops', 'degraded');
    }
  }

  function setValue(id, val) {
    document.getElementById(id).textContent = val != null ? val : '--';
  }

  function setStatus(id, status) {
    const el = document.getElementById(id);
    el.className = `metric-status ${status}`;
  }

  function formatUptime(seconds) {
    if (seconds == null) return '--:--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatNumber(val) {
    if (val == null) return '--';
    return Math.round(val).toLocaleString();
  }

  function formatDecimal(val, places) {
    if (val == null) return '--';
    return val.toFixed(places);
  }

  // Canvas Charts
  function renderCharts(data) {
    if (!data.history) return;
    const h = data.history;
    const maxPoints = chartWindow;
    const t = data.thresholds;

    renderChart(
      document.getElementById('chart-bitrate'),
      sliceHistory(h.timestamps, maxPoints),
      sliceHistory(h.videoBitrate, maxPoints),
      { min: 0, max: Math.max(t.bitrateMax * 1.2, 10000), bandMin: t.bitrateMin, bandMax: t.bitrateMax, unit: 'kbps' }
    );

    renderChart(
      document.getElementById('chart-lufs'),
      sliceHistory(h.timestamps, maxPoints),
      sliceHistory(h.lufsMomentary, maxPoints),
      { min: -40, max: 0, bandMin: t.lufsTarget - t.lufsTolerance, bandMax: t.lufsTarget + t.lufsTolerance, unit: 'LUFS' }
    );
  }

  function sliceHistory(arr, maxPoints) {
    if (!arr) return [];
    return arr.length > maxPoints ? arr.slice(-maxPoints) : arr;
  }

  function renderChart(canvas, timestamps, values, opts) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;
    const pad = { top: 10, right: 50, bottom: 20, left: 10 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    ctx.clearRect(0, 0, w, h);

    const style = getComputedStyle(document.documentElement);
    const lineColor = style.getPropertyValue('--chart-line').trim();
    const bandColor = style.getPropertyValue('--chart-band').trim();
    const textColor = style.getPropertyValue('--text-muted').trim();
    const statusHealthy = style.getPropertyValue('--status-healthy').trim();

    // Threshold band
    if (opts.bandMin != null && opts.bandMax != null) {
      const y1 = pad.top + plotH * (1 - (opts.bandMax - opts.min) / (opts.max - opts.min));
      const y2 = pad.top + plotH * (1 - (opts.bandMin - opts.min) / (opts.max - opts.min));
      ctx.fillStyle = bandColor;
      ctx.fillRect(pad.left, y1, plotW, y2 - y1);
    }

    // Y-axis labels
    ctx.fillStyle = textColor;
    ctx.font = `10px ${style.getPropertyValue('--font-mono').trim() || 'monospace'}`;
    ctx.textAlign = 'left';
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const val = opts.min + (opts.max - opts.min) * (1 - i / ySteps);
      const y = pad.top + plotH * (i / ySteps);
      ctx.fillText(Math.round(val), w - pad.right + 5, y + 3);
    }

    if (values.length < 2) return;

    // Data line
    ctx.beginPath();
    ctx.strokeStyle = statusHealthy;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';

    for (let i = 0; i < values.length; i++) {
      if (values[i] == null) continue;
      const x = pad.left + (i / (values.length - 1)) * plotW;
      const y = pad.top + plotH * (1 - (values[i] - opts.min) / (opts.max - opts.min));
      if (i === 0 || values[i - 1] == null) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  // Tooltip (hover)
  function setupTooltip(canvas, getValues, getTimestamps, opts) {
    const tooltip = document.createElement('div');
    tooltip.style.cssText = 'position:fixed;pointer-events:none;font-family:var(--font-mono);font-size:11px;background:var(--bg-elevated);border:1px solid var(--border);padding:3px 6px;border-radius:3px;color:var(--text-primary);display:none;z-index:10;';
    document.body.appendChild(tooltip);

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pad = { left: 10, right: 50 };
      const plotW = rect.width - pad.left - pad.right;
      const ratio = (x - pad.left) / plotW;
      const values = getValues();
      const timestamps = getTimestamps();
      if (ratio < 0 || ratio > 1 || values.length === 0) {
        tooltip.style.display = 'none';
        return;
      }
      const idx = Math.round(ratio * (values.length - 1));
      if (values[idx] == null) {
        tooltip.style.display = 'none';
        return;
      }
      const time = timestamps[idx] ? new Date(timestamps[idx]).toLocaleTimeString() : '';
      tooltip.textContent = `${values[idx].toFixed(1)} ${opts.unit}  ${time}`;
      tooltip.style.display = 'block';
      tooltip.style.left = `${e.clientX + 12}px`;
      tooltip.style.top = `${e.clientY - 20}px`;
    });

    canvas.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  }

  const bitrateCanvas = document.getElementById('chart-bitrate');
  const lufsCanvas = document.getElementById('chart-lufs');

  setupTooltip(bitrateCanvas,
    () => lastData ? sliceHistory(lastData.history.videoBitrate, chartWindow) : [],
    () => lastData ? sliceHistory(lastData.history.timestamps, chartWindow) : [],
    { unit: 'kbps' }
  );

  setupTooltip(lufsCanvas,
    () => lastData ? sliceHistory(lastData.history.lufsMomentary, chartWindow) : [],
    () => lastData ? sliceHistory(lastData.history.timestamps, chartWindow) : [],
    { unit: 'LUFS' }
  );

  connect();
})();
```

- [ ] **Step 2: Commit**

```bash
git add public/app.js
git commit -m "feat: dashboard WebSocket client with DOM updates and canvas charts"
```

---

### Task 11: Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Create the Dockerfile**

Create `Dockerfile`:

```dockerfile
FROM node:lts-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      pipx && \
    pipx install streamlink && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.local/bin:$PATH"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ src/
COPY public/ public/

EXPOSE 3000
CMD ["node", "src/server.js"]
```

- [ ] **Step 2: Commit**

```bash
git add Dockerfile
git commit -m "feat: Dockerfile with streamlink and FFmpeg"
```

---

### Task 12: Run All Tests and Manual Verification

- [ ] **Step 1: Run the full test suite**

```bash
node --test test/**/*.test.js
```

Expected: All tests pass (config: 4, parser: 8, health: 14, store: 9 = 35 total).

- [ ] **Step 2: Manual smoke test**

Set `STREAM_URL` to a live Twitch channel and start the server:

```bash
STREAM_URL=https://twitch.tv/somechannel node src/server.js
```

Open `http://localhost:3000` in a browser. Verify:
- Status banner shows "CONNECTING" initially, then switches to "HEALTHY" with green tint
- Metric values populate with real data
- Charts begin drawing after a few seconds
- Theme toggle switches between dark and light
- Chart window buttons (5/15/30 min) change the visible range
- Hovering over charts shows value tooltips

- [ ] **Step 3: Commit any fixes from manual testing**

If manual testing reveals issues, fix them and commit:

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```
