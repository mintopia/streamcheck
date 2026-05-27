# StreamCheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time RTMP audio loudness monitor that tells Twitch streamers whether their levels are correct, deployed as a Docker container.

**Architecture:** node-media-server accepts RTMP on :1935, spawns FFmpeg with ebur128 filter on connect, parses stderr for LUFS/peak data, and pushes metrics over WebSocket to a vanilla JS browser dashboard on :3000.

**Tech Stack:** Node.js (LTS), node-media-server, FFmpeg (ebur128), Express, ws, vanilla HTML/CSS/JS, Docker

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies and scripts |
| `src/index.js` | Entry point: wires RTMP, Express, and WebSocket servers together |
| `src/rtmp.js` | node-media-server config, publish/unpublish event hooks |
| `src/analyzer.js` | Spawns FFmpeg, parses ebur128 stderr output into metric objects |
| `src/websocket.js` | WebSocket server, broadcasts metrics to connected browsers |
| `src/public/index.html` | Dashboard HTML structure and all three connection states |
| `src/public/style.css` | CSS custom properties, layout, meter styling, state styling |
| `src/public/app.js` | WebSocket client, meter rendering, history chart, state transitions |
| `test/analyzer.test.js` | Unit tests for ebur128 line parser |
| `test/websocket.test.js` | Unit tests for WebSocket broadcast and client tracking |
| `test/integration.test.js` | Integration test: fake FFmpeg output → WebSocket → received metrics |
| `Dockerfile` | Node.js + FFmpeg container image |
| `docker-compose.yml` | Single-service compose for easy `docker compose up` |
| `.gitignore` | node_modules, .superpowers, etc. |
| `.dockerignore` | node_modules, test, docs, .git |

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.dockerignore`

- [ ] **Step 1: Initialize package.json**

```bash
cd /Users/mintopia/Projects/streamcheck
npm init -y
```

- [ ] **Step 2: Edit package.json to set project metadata and scripts**

Replace the generated `package.json` with:

```json
{
  "name": "streamcheck",
  "version": "1.0.0",
  "description": "Real-time RTMP audio loudness monitor for Twitch streamers",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test test/**/*.test.js"
  },
  "keywords": ["rtmp", "lufs", "twitch", "audio", "monitoring"],
  "license": "MIT",
  "engines": {
    "node": ">=20.0.0"
  }
}
```

Note: We use Node's built-in test runner (`node --test`) — no test framework dependency needed.

- [ ] **Step 3: Install production dependencies**

```bash
npm install node-media-server express ws
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
.superpowers/
*.log
```

- [ ] **Step 5: Create .dockerignore**

```
node_modules/
test/
docs/
.git/
.gitignore
.superpowers/
*.md
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore .dockerignore
git commit -m "feat: scaffold project with dependencies"
```

---

### Task 2: FFmpeg Stderr Parser

This is the core logic and the most testable unit. Build it first with TDD.

**Files:**
- Create: `src/analyzer.js`
- Create: `test/analyzer.test.js`

- [ ] **Step 1: Write failing tests for the parser**

Create `test/analyzer.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test test/analyzer.test.js
```

Expected: Failure — `Cannot find module '../src/analyzer.js'`

- [ ] **Step 3: Implement parseLine**

Create `src/analyzer.js`:

```js
const EventEmitter = require('node:events');

const EBUR128_REGEX =
  /\[Parsed_ebur128_0\s*@\s*0x[0-9a-f]+\].*M:\s*(-?\d+\.?\d*|-inf)\s+S:\s*(-?\d+\.?\d*|-inf)\s+I:\s*(-?\d+\.?\d*|-inf)\s+LUFS\s+LRA:\s*(-?\d+\.?\d*|-inf)\s+LU\s+FTPK:\s*(-?\d+\.?\d*|-inf)\s+dBFS\s+(-?\d+\.?\d*|-inf)\s+dBFS\s+TPK:\s*(-?\d+\.?\d*|-inf)\s+dBFS\s+(-?\d+\.?\d*|-inf)\s+dBFS/;

function parseNumber(str) {
  if (str === '-inf') return -Infinity;
  return parseFloat(str);
}

function parseLine(line) {
  const match = line.match(EBUR128_REGEX);
  if (!match) return null;
  return {
    momentary: parseNumber(match[1]),
    shortTerm: parseNumber(match[2]),
    integrated: parseNumber(match[3]),
    lra: parseNumber(match[4]),
    truePeakL: parseNumber(match[7]),
    truePeakR: parseNumber(match[8]),
  };
}

module.exports = { parseLine };
```

Note: We export only `parseLine` for now. The FFmpeg process spawning will be added after the parser is solid.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test test/analyzer.test.js
```

Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/analyzer.js test/analyzer.test.js
git commit -m "feat: ebur128 stderr line parser with tests"
```

---

### Task 3: FFmpeg Process Manager

**Files:**
- Modify: `src/analyzer.js`
- Modify: `test/analyzer.test.js`

- [ ] **Step 1: Write failing test for the Analyzer class**

Append to `test/analyzer.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify the new tests fail**

```bash
node --test test/analyzer.test.js
```

Expected: New tests fail — `Analyzer` is not exported.

- [ ] **Step 3: Implement the Analyzer class**

Add to `src/analyzer.js` (above `module.exports`):

```js
const { spawn } = require('node:child_process');
const readline = require('node:readline');

class Analyzer extends EventEmitter {
  constructor() {
    super();
    this._process = null;
    this._truePeakMax = -Infinity;
  }

  start(streamPath) {
    this.stop();
    this._truePeakMax = -Infinity;

    this._process = spawn('ffmpeg', [
      '-i', streamPath,
      '-filter:a', 'ebur128=peak=true:framelog=verbose',
      '-f', 'null',
      '-',
    ]);

    this._handleStderr(this._process.stderr);

    this._process.on('close', (code) => {
      this._process = null;
      this.emit('close', code);
    });

    this._process.on('error', (err) => {
      this.emit('error', err);
    });
  }

  stop() {
    if (this._process) {
      this._process.kill('SIGTERM');
      this._process = null;
    }
    this._truePeakMax = -Infinity;
  }

  _handleStderr(stream) {
    const rl = readline.createInterface({ input: stream });
    rl.on('line', (line) => {
      const metrics = parseLine(line);
      if (!metrics) return;

      const peak = Math.max(metrics.truePeakL, metrics.truePeakR);
      if (peak > this._truePeakMax) {
        this._truePeakMax = peak;
      }

      this.emit('metrics', {
        ...metrics,
        truePeakMax: this._truePeakMax,
        timestamp: Date.now(),
      });
    });
  }
}
```

Update `module.exports`:

```js
module.exports = { parseLine, Analyzer };
```

- [ ] **Step 4: Run all tests**

```bash
node --test test/analyzer.test.js
```

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/analyzer.js test/analyzer.test.js
git commit -m "feat: Analyzer class manages FFmpeg process and emits metrics"
```

---

### Task 4: WebSocket Server

**Files:**
- Create: `src/websocket.js`
- Create: `test/websocket.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/websocket.test.js`:

```js
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const { createBroadcaster } = require('../src/websocket.js');

describe('createBroadcaster', () => {
  let httpServer;
  let broadcaster;

  afterEach((_, done) => {
    if (httpServer) {
      httpServer.close(done);
      httpServer = null;
    } else {
      done();
    }
  });

  it('sends messages to connected clients', async () => {
    httpServer = http.createServer();
    broadcaster = createBroadcaster(httpServer);
    await new Promise((r) => httpServer.listen(0, r));
    const port = httpServer.address().port;

    const client = new WebSocket(`ws://localhost:${port}`);
    await new Promise((r) => client.on('open', r));

    const received = new Promise((resolve) => {
      client.on('message', (data) => resolve(JSON.parse(data)));
    });

    broadcaster.send({ type: 'metrics', momentary: -14.0 });
    const msg = await received;

    assert.strictEqual(msg.type, 'metrics');
    assert.strictEqual(msg.momentary, -14.0);

    client.close();
  });

  it('tracks client count', async () => {
    httpServer = http.createServer();
    broadcaster = createBroadcaster(httpServer);
    await new Promise((r) => httpServer.listen(0, r));
    const port = httpServer.address().port;

    assert.strictEqual(broadcaster.clientCount(), 0);

    const c1 = new WebSocket(`ws://localhost:${port}`);
    await new Promise((r) => c1.on('open', r));
    assert.strictEqual(broadcaster.clientCount(), 1);

    const c2 = new WebSocket(`ws://localhost:${port}`);
    await new Promise((r) => c2.on('open', r));
    assert.strictEqual(broadcaster.clientCount(), 2);

    c1.close();
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(broadcaster.clientCount(), 1);

    c2.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/websocket.test.js
```

Expected: Failure — module not found.

- [ ] **Step 3: Implement createBroadcaster**

Create `src/websocket.js`:

```js
const WebSocket = require('ws');

function createBroadcaster(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer });

  return {
    send(data) {
      const json = JSON.stringify(data);
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(json);
        }
      }
    },

    clientCount() {
      return wss.clients.size;
    },

    close() {
      wss.close();
    },
  };
}

module.exports = { createBroadcaster };
```

- [ ] **Step 4: Run tests**

```bash
node --test test/websocket.test.js
```

Expected: All 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/websocket.js test/websocket.test.js
git commit -m "feat: WebSocket broadcaster sends metrics to connected clients"
```

---

### Task 5: RTMP Server Module

**Files:**
- Create: `src/rtmp.js`

No unit test for this module — it's a thin config wrapper around node-media-server, which we'll test via integration.

- [ ] **Step 1: Implement RTMP server**

Create `src/rtmp.js`:

```js
const NodeMediaServer = require('node-media-server');

function createRtmpServer({ onPublish, onUnpublish }) {
  const config = {
    logType: 0,
    rtmp: {
      port: 1935,
      chunk_size: 60000,
      gop_cache: false,
      ping: 30,
      ping_timeout: 60,
    },
  };

  const nms = new NodeMediaServer(config);

  nms.on('prePublish', (id, streamPath) => {
    onPublish(id, streamPath);
  });

  nms.on('donePublish', (id, streamPath) => {
    onUnpublish(id, streamPath);
  });

  return {
    start() {
      nms.run();
    },
  };
}

module.exports = { createRtmpServer };
```

- [ ] **Step 2: Commit**

```bash
git add src/rtmp.js
git commit -m "feat: RTMP server module wrapping node-media-server"
```

---

### Task 6: Entry Point — Wire Everything Together

**Files:**
- Create: `src/index.js`

- [ ] **Step 1: Implement entry point**

Create `src/index.js`:

```js
const path = require('node:path');
const express = require('express');
const http = require('node:http');
const { Analyzer } = require('./analyzer.js');
const { createBroadcaster } = require('./websocket.js');
const { createRtmpServer } = require('./rtmp.js');

const WEB_PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const httpServer = http.createServer(app);
const broadcaster = createBroadcaster(httpServer);
const analyzer = new Analyzer();

analyzer.on('metrics', (data) => {
  broadcaster.send(data);
});

analyzer.on('error', (err) => {
  console.error('Analyzer error:', err.message);
});

analyzer.on('close', (code) => {
  console.log('FFmpeg exited with code', code);
});

const rtmp = createRtmpServer({
  onPublish(id, streamPath) {
    console.log('Stream started:', streamPath);
    const rtmpUrl = `rtmp://localhost:1935${streamPath}`;
    analyzer.start(rtmpUrl);
    broadcaster.send({
      type: 'streamStart',
      key: streamPath.split('/').pop(),
      timestamp: Date.now(),
    });
  },
  onUnpublish(id, streamPath) {
    console.log('Stream ended:', streamPath);
    analyzer.stop();
    broadcaster.send({
      type: 'streamEnd',
      timestamp: Date.now(),
    });
  },
});

rtmp.start();
httpServer.listen(WEB_PORT, () => {
  console.log(`StreamCheck web UI: http://localhost:${WEB_PORT}`);
  console.log('RTMP endpoint: rtmp://localhost:1935/live/<your-key>');
});
```

- [ ] **Step 2: Commit**

```bash
git add src/index.js
git commit -m "feat: entry point wiring RTMP, analyzer, and WebSocket"
```

---

### Task 7: Dashboard HTML

**Files:**
- Create: `src/public/index.html`

- [ ] **Step 1: Create the HTML structure with all three connection states**

Create `src/public/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StreamCheck</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>

  <!-- STATE: Waiting for stream -->
  <div id="state-waiting" class="state-screen">
    <div class="state-icon">&#9211;</div>
    <div class="state-title">Waiting for stream</div>
    <div class="state-hint">
      Send an RTMP stream to<br>
      <code>rtmp://<span id="rtmp-host">localhost</span>:1935/live/your-key</code>
    </div>
  </div>

  <!-- STATE: Signal lost -->
  <div id="state-lost" class="state-screen" hidden>
    <div class="state-icon state-icon-warn">&#9888;</div>
    <div class="state-title state-title-warn">Signal lost</div>
    <div class="state-hint">Stream disconnected at <span id="lost-time">--:--:--</span></div>
  </div>

  <!-- STATE: Live dashboard -->
  <div id="state-live" hidden>

    <!-- Header -->
    <header class="header">
      <div class="header-left">
        <span class="app-name">StreamCheck</span>
        <div class="status-badge">
          <span class="status-dot"></span>
          Live
        </div>
      </div>
      <div class="header-meta">
        <span id="duration">00:00:00</span>
        <span id="codec-info">--</span>
      </div>
    </header>

    <!-- Dashboard grid -->
    <div class="dashboard">

      <!-- Left: Peak meters -->
      <div class="meters-col">
        <div class="meter-group-label">True Peak</div>
        <div class="meter-with-scale">
          <div class="meter-pair">
            <div class="meter-col-inner">
              <div class="meter-bar-wrap" role="meter" aria-label="Left channel true peak" aria-valuemin="-48" aria-valuemax="0" aria-valuenow="-48">
                <div class="meter-fill" id="meter-l"></div>
                <div class="peak-hold" id="peak-hold-l"></div>
                <div class="threshold-line"></div>
              </div>
              <div class="meter-channel-label">L</div>
            </div>
            <div class="meter-col-inner">
              <div class="meter-bar-wrap" role="meter" aria-label="Right channel true peak" aria-valuemin="-48" aria-valuemax="0" aria-valuenow="-48">
                <div class="meter-fill" id="meter-r"></div>
                <div class="peak-hold" id="peak-hold-r"></div>
                <div class="threshold-line"></div>
              </div>
              <div class="meter-channel-label">R</div>
            </div>
          </div>
          <div class="meter-scale">
            <span>0</span><span>-6</span><span>-12</span><span>-18</span><span>-24</span><span>-36</span><span>-48</span>
          </div>
        </div>
        <div class="tp-readout">
          <div class="tp-value" id="tp-value">-- dBTP</div>
          <div class="tp-label">Peak hold</div>
        </div>
        <div class="clip-indicator" id="clip-indicator">No clips</div>
      </div>

      <!-- Right top: LUFS readouts -->
      <div class="lufs-section">
        <div class="integrated-card">
          <div class="integrated-left">
            <div class="integrated-label">Integrated Loudness</div>
            <div class="integrated-value" id="integrated-value" aria-live="polite">
              --<span class="integrated-unit">LUFS</span>
            </div>
            <div class="integrated-status" id="integrated-status">
              Waiting for data
            </div>
          </div>
          <div class="integrated-right">
            Target: -14 LUFS<br>
            Warn: &lt; -18 or &gt; -10<br>
            Danger: &lt; -24 or &gt; -6
          </div>
        </div>

        <div class="secondary-metrics">
          <div class="metric-card">
            <div class="metric-label">Momentary</div>
            <div class="metric-value" id="momentary-value" aria-live="polite">--<span class="metric-unit">LUFS</span></div>
            <div class="metric-hint">400ms window</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Short-term</div>
            <div class="metric-value" id="short-term-value" aria-live="polite">--<span class="metric-unit">LUFS</span></div>
            <div class="metric-hint">3s window</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Loudness Range</div>
            <div class="metric-value" id="lra-value">--<span class="metric-unit">LU</span></div>
            <div class="metric-hint">Dynamic spread</div>
          </div>
        </div>
      </div>

      <!-- Right bottom: History -->
      <div class="history">
        <div class="history-header">
          <span class="history-label">Short-term LUFS: last 60s</span>
        </div>
        <canvas id="history-canvas" width="700" height="72"></canvas>
      </div>

    </div>
  </div>

  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/public/index.html
git commit -m "feat: dashboard HTML with three connection states"
```

---

### Task 8: Dashboard CSS

**Files:**
- Create: `src/public/style.css`

- [ ] **Step 1: Create the complete stylesheet**

Create `src/public/style.css`:

```css
:root {
  --bg-base: #0e0e11;
  --bg-surface: #18181d;
  --bg-elevated: #222228;
  --border: #2e2e36;
  --text-primary: #e8e8ec;
  --text-secondary: #9a9aa6;
  --text-tertiary: #6e6e7a;
  --green: #5cb97a;
  --green-dim: rgba(92, 185, 122, 0.12);
  --yellow: #d4a843;
  --yellow-dim: rgba(212, 168, 67, 0.12);
  --red: #d45a5a;
  --red-dim: rgba(212, 90, 90, 0.12);
  --font-mono: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
}

*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-mono);
  min-height: 100vh;
  padding: 20px 24px;
}

/* ---- State screens ---- */

.state-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 80vh;
  gap: 16px;
}

.state-icon {
  font-size: 48px;
  opacity: 0.2;
}

.state-icon-warn {
  color: var(--red);
  opacity: 0.5;
}

.state-title {
  font-size: 16px;
  font-weight: 600;
}

.state-title-warn {
  color: var(--red);
}

.state-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: center;
  line-height: 1.7;
}

.state-hint code {
  display: inline-block;
  margin-top: 8px;
  padding: 6px 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

/* ---- Header ---- */

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.app-name {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--green);
  background: var(--green-dim);
  padding: 4px 10px;
  border-radius: 4px;
}

.status-dot {
  width: 6px;
  height: 6px;
  background: var(--green);
  border-radius: 50%;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.header-meta {
  display: flex;
  gap: 16px;
  font-size: 11px;
  color: var(--text-tertiary);
}

/* ---- Dashboard grid ---- */

.dashboard {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  gap: 24px;
}

/* ---- Peak meters ---- */

.meters-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  grid-row: 1 / 3;
}

.meter-group-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--text-tertiary);
}

.meter-with-scale {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.meter-pair {
  display: flex;
  gap: 3px;
}

.meter-col-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.meter-bar-wrap {
  position: relative;
  width: 24px;
  height: 220px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 2px;
  overflow: hidden;
}

.meter-fill {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    to top,
    var(--green) 0%,
    var(--green) 62%,
    var(--yellow) 62%,
    var(--yellow) 83%,
    var(--red) 83%,
    var(--red) 100%
  );
  transform-origin: bottom;
  transform: scaleY(0);
  will-change: transform;
}

.peak-hold {
  position: absolute;
  width: 100%;
  height: 2px;
  background: var(--text-primary);
  left: 0;
  bottom: 0;
  transition: bottom 0.05s linear;
}

.threshold-line {
  position: absolute;
  width: 100%;
  height: 1px;
  background: var(--red);
  left: 0;
  bottom: 97.9%;
  opacity: 0.6;
}

.meter-channel-label {
  font-size: 9px;
  color: var(--text-tertiary);
  margin-top: 6px;
}

.meter-scale {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 220px;
  padding: 1px 0;
}

.meter-scale span {
  font-size: 8px;
  color: var(--text-tertiary);
  line-height: 1;
}

.tp-readout {
  text-align: center;
}

.tp-value {
  font-size: 13px;
  font-weight: 600;
}

.tp-label {
  font-size: 9px;
  color: var(--text-tertiary);
}

/* ---- Clip indicator ---- */

.clip-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 12px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--text-tertiary);
  cursor: pointer;
}

.clip-indicator.clip-active {
  background: var(--red-dim);
  border-color: var(--red);
  color: var(--red);
  animation: clip-flash 0.5s ease-out 3;
}

@keyframes clip-flash {
  0% { background: rgba(212, 90, 90, 0.35); }
  100% { background: var(--red-dim); }
}

/* ---- Integrated card (hero) ---- */

.lufs-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.integrated-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 20px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.integrated-left {
  display: flex;
  flex-direction: column;
}

.integrated-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.integrated-value {
  font-size: 42px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.integrated-unit {
  font-size: 14px;
  color: var(--text-tertiary);
  margin-left: 6px;
  font-weight: 400;
}

.integrated-status {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.integrated-right {
  text-align: right;
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.7;
}

/* ---- Secondary metrics ---- */

.secondary-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}

.metric-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px 16px;
}

.metric-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-tertiary);
  margin-bottom: 6px;
}

.metric-value {
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.metric-unit {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-left: 4px;
  font-weight: 400;
}

.metric-hint {
  margin-top: 6px;
  font-size: 9px;
  color: var(--text-tertiary);
}

/* ---- History chart ---- */

.history {
  grid-column: 2;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.history-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--text-tertiary);
}

#history-canvas {
  width: 100%;
  height: 72px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
}

/* ---- Utility color classes ---- */

.val-good { color: var(--green); }
.val-warn { color: var(--yellow); }
.val-danger { color: var(--red); }
.val-neutral { color: var(--text-primary); }
```

- [ ] **Step 2: Commit**

```bash
git add src/public/style.css
git commit -m "feat: dashboard CSS with custom properties and all states"
```

---

### Task 9: Dashboard JavaScript — State Management & WebSocket Client

**Files:**
- Create: `src/public/app.js`

This is the largest frontend file. We'll build it in two parts: state management + WebSocket client first, then meter rendering.

- [ ] **Step 1: Create app.js with state management and WebSocket connection**

Create `src/public/app.js`:

```js
(function () {
  'use strict';

  // ---- DOM refs ----
  const stateWaiting = document.getElementById('state-waiting');
  const stateLost = document.getElementById('state-lost');
  const stateLive = document.getElementById('state-live');
  const lostTime = document.getElementById('lost-time');
  const durationEl = document.getElementById('duration');
  const codecInfoEl = document.getElementById('codec-info');
  const integratedValueEl = document.getElementById('integrated-value');
  const integratedStatusEl = document.getElementById('integrated-status');
  const momentaryValueEl = document.getElementById('momentary-value');
  const shortTermValueEl = document.getElementById('short-term-value');
  const lraValueEl = document.getElementById('lra-value');
  const tpValueEl = document.getElementById('tp-value');
  const meterL = document.getElementById('meter-l');
  const meterR = document.getElementById('meter-r');
  const peakHoldL = document.getElementById('peak-hold-l');
  const peakHoldR = document.getElementById('peak-hold-r');
  const clipIndicator = document.getElementById('clip-indicator');
  const historyCanvas = document.getElementById('history-canvas');

  // ---- State ----
  let streamStartTime = null;
  let durationInterval = null;
  let clipCount = 0;
  let peakHoldLValue = -Infinity;
  let peakHoldRValue = -Infinity;
  let peakHoldLTimer = null;
  let peakHoldRTimer = null;
  const PEAK_HOLD_MS = 2000;
  const HISTORY_SECONDS = 60;
  const HISTORY_HZ = 10;
  const historyData = [];

  // ---- Thresholds ----
  function getLufsStatus(value) {
    if (value === -Infinity || value === null) return { cls: '', text: 'Waiting for data' };
    if (value >= -18 && value <= -10) return { cls: 'val-good', text: '✓ On target for Twitch' };
    if (value > -10 && value <= -6) return { cls: 'val-warn', text: '⚠ Too loud for Twitch' };
    if (value < -18 && value >= -24) return { cls: 'val-warn', text: '⚠ Too quiet for Twitch' };
    if (value > -6) return { cls: 'val-danger', text: '✖ Way too loud for Twitch' };
    return { cls: 'val-danger', text: '✖ Way too quiet for Twitch' };
  }

  function getLufsColorClass(value) {
    if (value === -Infinity || value === null) return 'val-neutral';
    if (value >= -18 && value <= -10) return 'val-good';
    if ((value > -10 && value <= -6) || (value < -18 && value >= -24)) return 'val-warn';
    return 'val-danger';
  }

  function getTpColorClass(value) {
    if (value === -Infinity || value === null) return 'val-neutral';
    if (value <= -2) return 'val-good';
    if (value <= -1) return 'val-warn';
    return 'val-danger';
  }

  // ---- dB to meter scale (0 = top, -48 = bottom) ----
  function dbToScale(db) {
    if (db === -Infinity) return 0;
    const clamped = Math.max(-48, Math.min(0, db));
    return (clamped + 48) / 48;
  }

  // ---- State transitions ----
  function showState(state) {
    stateWaiting.hidden = state !== 'waiting';
    stateLost.hidden = state !== 'lost';
    stateLive.hidden = state !== 'live';
  }

  function startDurationTimer() {
    streamStartTime = Date.now();
    clearInterval(durationInterval);
    durationInterval = setInterval(updateDuration, 1000);
    updateDuration();
  }

  function stopDurationTimer() {
    clearInterval(durationInterval);
    durationInterval = null;
  }

  function updateDuration() {
    if (!streamStartTime) return;
    const elapsed = Math.floor((Date.now() - streamStartTime) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    durationEl.textContent = `${h}:${m}:${s}`;
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString();
  }

  // ---- Metric updates ----
  function formatLufs(value) {
    if (value === -Infinity || value === null || value === undefined) return '--';
    return value.toFixed(1);
  }

  function setMetricValue(el, value, unit, colorClass) {
    const numSpan = el.querySelector('.integrated-unit, .metric-unit');
    el.className = el.className.replace(/val-\w+/g, '').trim();
    el.classList.add(colorClass);
    if (numSpan) {
      el.innerHTML = `${formatLufs(value)}<span class="${numSpan.className}">${unit}</span>`;
    } else {
      el.textContent = formatLufs(value);
    }
  }

  function updateMetrics(data) {
    // Integrated (hero)
    const intStatus = getLufsStatus(data.integrated);
    integratedValueEl.className = 'integrated-value ' + getLufsColorClass(data.integrated);
    integratedValueEl.innerHTML = `${formatLufs(data.integrated)}<span class="integrated-unit">LUFS</span>`;
    integratedStatusEl.className = 'integrated-status ' + intStatus.cls;
    integratedStatusEl.textContent = intStatus.text;

    // Momentary
    momentaryValueEl.className = 'metric-value ' + getLufsColorClass(data.momentary);
    momentaryValueEl.innerHTML = `${formatLufs(data.momentary)}<span class="metric-unit">LUFS</span>`;

    // Short-term
    shortTermValueEl.className = 'metric-value ' + getLufsColorClass(data.shortTerm);
    shortTermValueEl.innerHTML = `${formatLufs(data.shortTerm)}<span class="metric-unit">LUFS</span>`;

    // LRA
    const lraStr = data.lra !== undefined && data.lra !== null ? data.lra.toFixed(1) : '--';
    lraValueEl.className = 'metric-value val-neutral';
    lraValueEl.innerHTML = `${lraStr}<span class="metric-unit">LU</span>`;

    // True Peak
    const tpMax = data.truePeakMax;
    const tpCls = getTpColorClass(tpMax);
    tpValueEl.className = 'tp-value ' + tpCls;
    tpValueEl.textContent = tpMax === -Infinity ? '-- dBTP' : `${tpMax.toFixed(1)} dBTP`;

    // Peak meters
    updateMeter(meterL, peakHoldL, data.truePeakL, 'L');
    updateMeter(meterR, peakHoldR, data.truePeakR, 'R');

    // Clip detection
    if (data.truePeakL > -1 || data.truePeakR > -1) {
      triggerClip();
    }

    // ARIA
    meterL.parentElement.setAttribute('aria-valuenow', data.truePeakL === -Infinity ? -48 : data.truePeakL.toFixed(1));
    meterR.parentElement.setAttribute('aria-valuenow', data.truePeakR === -Infinity ? -48 : data.truePeakR.toFixed(1));

    // History
    if (data.shortTerm !== -Infinity) {
      historyData.push(data.shortTerm);
      if (historyData.length > HISTORY_SECONDS * HISTORY_HZ) {
        historyData.shift();
      }
    }
    drawHistory();
  }

  // ---- Meter rendering ----
  function updateMeter(fillEl, holdEl, db, channel) {
    const scale = dbToScale(db);
    fillEl.style.transform = `scaleY(${scale})`;

    // Peak hold
    if (channel === 'L') {
      if (db > peakHoldLValue) {
        peakHoldLValue = db;
        clearTimeout(peakHoldLTimer);
        peakHoldLTimer = setTimeout(() => { peakHoldLValue = -Infinity; }, PEAK_HOLD_MS);
      }
      holdEl.style.bottom = `${dbToScale(peakHoldLValue) * 100}%`;
    } else {
      if (db > peakHoldRValue) {
        peakHoldRValue = db;
        clearTimeout(peakHoldRTimer);
        peakHoldRTimer = setTimeout(() => { peakHoldRValue = -Infinity; }, PEAK_HOLD_MS);
      }
      holdEl.style.bottom = `${dbToScale(peakHoldRValue) * 100}%`;
    }
  }

  // ---- Clip indicator ----
  function triggerClip() {
    clipCount++;
    clipIndicator.textContent = `CLIP (${clipCount})`;
    clipIndicator.classList.add('clip-active');
    clipIndicator.classList.remove('clip-clear');
  }

  clipIndicator.addEventListener('click', () => {
    clipCount = 0;
    clipIndicator.textContent = 'No clips';
    clipIndicator.classList.remove('clip-active');
  });

  // ---- History chart ----
  function drawHistory() {
    const ctx = historyCanvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = historyCanvas.getBoundingClientRect();
    historyCanvas.width = rect.width * dpr;
    historyCanvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    // dB range: -36 to 0 LUFS mapped to canvas
    const dbMin = -36;
    const dbMax = 0;
    function lufsToY(lufs) {
      const clamped = Math.max(dbMin, Math.min(dbMax, lufs));
      return h - ((clamped - dbMin) / (dbMax - dbMin)) * h;
    }

    // Target line at -14
    const targetY = lufsToY(-14);
    ctx.strokeStyle = 'rgba(92, 185, 122, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, targetY);
    ctx.lineTo(w, targetY);
    ctx.stroke();

    // Label
    ctx.fillStyle = 'rgba(92, 185, 122, 0.5)';
    ctx.font = '8px monospace';
    ctx.fillText('-14', w - 22, targetY - 4);

    if (historyData.length < 2) return;

    // Draw area + line
    const step = w / (HISTORY_SECONDS * HISTORY_HZ);
    const offset = Math.max(0, HISTORY_SECONDS * HISTORY_HZ - historyData.length);

    ctx.beginPath();
    ctx.moveTo((offset) * step, lufsToY(historyData[0]));
    for (let i = 1; i < historyData.length; i++) {
      ctx.lineTo((offset + i) * step, lufsToY(historyData[i]));
    }

    // Area fill
    const lastX = (offset + historyData.length - 1) * step;
    ctx.lineTo(lastX, h);
    ctx.lineTo(offset * step, h);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(92, 185, 122, 0.3)');
    grad.addColorStop(1, 'rgba(92, 185, 122, 0.03)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Stroke line
    ctx.beginPath();
    ctx.moveTo(offset * step, lufsToY(historyData[0]));
    for (let i = 1; i < historyData.length; i++) {
      ctx.lineTo((offset + i) * step, lufsToY(historyData[i]));
    }
    ctx.strokeStyle = 'rgba(92, 185, 122, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ---- WebSocket ----
  let signalLostTimeout = null;

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}`);

    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'streamStart') {
        clearTimeout(signalLostTimeout);
        showState('live');
        startDurationTimer();
        clipCount = 0;
        clipIndicator.textContent = 'No clips';
        clipIndicator.classList.remove('clip-active');
        historyData.length = 0;
        peakHoldLValue = -Infinity;
        peakHoldRValue = -Infinity;
        codecInfoEl.textContent = 'Detecting...';
        return;
      }

      if (data.type === 'streamEnd') {
        stopDurationTimer();
        lostTime.textContent = formatTime(data.timestamp);
        showState('lost');
        signalLostTimeout = setTimeout(() => showState('waiting'), 10000);
        return;
      }

      if (data.type === 'metrics') {
        updateMetrics(data);
      }
    });

    ws.addEventListener('close', () => {
      setTimeout(connect, 2000);
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }

  // ---- Populate RTMP host hint ----
  document.getElementById('rtmp-host').textContent = location.hostname;

  // ---- Start ----
  showState('waiting');
  connect();
})();
```

- [ ] **Step 2: Commit**

```bash
git add src/public/app.js
git commit -m "feat: dashboard JS with WebSocket client, meters, history chart, and state management"
```

---

### Task 10: Integration Test

**Files:**
- Create: `test/integration.test.js`

- [ ] **Step 1: Write integration test**

This test verifies the end-to-end flow from fake FFmpeg output to WebSocket delivery, without needing an actual RTMP stream.

Create `test/integration.test.js`:

```js
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const WebSocket = require('ws');
const { Analyzer } = require('../src/analyzer.js');
const { createBroadcaster } = require('../src/websocket.js');
const { Readable } = require('node:stream');

describe('Integration: Analyzer → Broadcaster → WebSocket client', () => {
  let httpServer;

  afterEach((_, done) => {
    if (httpServer) {
      httpServer.close(done);
      httpServer = null;
    } else {
      done();
    }
  });

  it('delivers parsed metrics to a WebSocket client', async () => {
    const app = express();
    httpServer = http.createServer(app);
    const broadcaster = createBroadcaster(httpServer);
    const analyzer = new Analyzer();

    analyzer.on('metrics', (data) => {
      broadcaster.send({ type: 'metrics', ...data });
    });

    await new Promise((r) => httpServer.listen(0, r));
    const port = httpServer.address().port;

    const client = new WebSocket(`ws://localhost:${port}`);
    await new Promise((r) => client.on('open', r));

    const received = new Promise((resolve) => {
      client.on('message', (raw) => resolve(JSON.parse(raw)));
    });

    // Feed a fake ebur128 line directly into the analyzer's stderr handler
    const fakeStderr = new Readable({ read() {} });
    analyzer._handleStderr(fakeStderr);
    fakeStderr.push(
      '[Parsed_ebur128_0 @ 0x7f8] t: 1.201    TARGET:-23 LUFS    M: -14.0 S: -14.2    I: -13.8 LUFS     LRA:   8.2 LU  FTPK: -6.3 dBFS  -5.8 dBFS  TPK: -4.1 dBFS  -3.9 dBFS\n'
    );

    const msg = await received;
    assert.strictEqual(msg.type, 'metrics');
    assert.strictEqual(msg.momentary, -14.0);
    assert.strictEqual(msg.shortTerm, -14.2);
    assert.strictEqual(msg.integrated, -13.8);
    assert.strictEqual(msg.lra, 8.2);
    assert.strictEqual(msg.truePeakL, -4.1);
    assert.strictEqual(msg.truePeakR, -3.9);
    assert.strictEqual(msg.truePeakMax, -3.9);
    assert.ok(msg.timestamp > 0);

    client.close();
    analyzer.stop();
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
node --test test/**/*.test.js
```

Expected: All tests pass (analyzer: 6, websocket: 2, integration: 1).

- [ ] **Step 3: Commit**

```bash
git add test/integration.test.js
git commit -m "test: integration test for analyzer-to-websocket pipeline"
```

---

### Task 11: Docker

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`

- [ ] **Step 1: Create Dockerfile**

Create `Dockerfile`:

```dockerfile
FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

EXPOSE 1935 3000

CMD ["node", "src/index.js"]
```

- [ ] **Step 2: Create docker-compose.yml**

Create `docker-compose.yml`:

```yaml
services:
  streamcheck:
    build: .
    ports:
      - "1935:1935"
      - "3000:3000"
    restart: unless-stopped
```

- [ ] **Step 3: Build the image to verify it works**

```bash
docker compose build
```

Expected: Build completes successfully.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat: Docker and docker-compose for deployment"
```

---

### Task 12: Smoke Test — Full Stack

This is a manual verification step using Docker.

- [ ] **Step 1: Start the container**

```bash
docker compose up -d
```

- [ ] **Step 2: Verify the web UI loads**

Open `http://localhost:3000` in a browser. Verify:
- "Waiting for stream" state is displayed
- The RTMP URL hint shows `rtmp://localhost:1935/live/your-key`

- [ ] **Step 3: Test with FFmpeg as a stream source**

If you have a test audio file or video, send it as an RTMP stream:

```bash
ffmpeg -re -f lavfi -i "sine=frequency=440:duration=30" -c:a aac -f flv rtmp://localhost:1935/live/test
```

Verify in the browser:
- State transitions to "Live"
- Integrated LUFS shows a value (sine wave at default level will be loud, likely red/danger)
- Meters animate
- Duration counter ticks
- History chart draws

- [ ] **Step 4: Stop the test stream (Ctrl+C on ffmpeg)**

Verify:
- "Signal lost" state appears with disconnect time
- After 10 seconds, transitions to "Waiting for stream"

- [ ] **Step 5: Stop the container**

```bash
docker compose down
```

- [ ] **Step 6: Commit any fixes found during smoke test**

If everything works, no commit needed. If fixes were required, commit them with a descriptive message.

---

### Task 13: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README**

Create `README.md`:

```markdown
# StreamCheck

Real-time audio loudness monitor for Twitch streamers. Accepts an RTMP stream, analyses audio levels, and displays LUFS metrics and peak meters on a web dashboard.

Twitch normalizes all streams to -14 LUFS. StreamCheck tells you at a glance whether your audio levels are correct for the platform.

## Quick Start

```bash
docker compose up -d
```

Open http://localhost:3000 in your browser, then point OBS (or any RTMP source) at:

```
rtmp://localhost:1935/live/your-key
```

The stream key can be anything — StreamCheck accepts the first stream it receives.

## What It Shows

- **Integrated LUFS** — the metric Twitch normalizes against, with pass/fail status
- **Momentary LUFS** — 400ms sliding window
- **Short-term LUFS** — 3s sliding window
- **Loudness Range (LRA)** — dynamic spread of your audio
- **True Peak meters** — per-channel L/R bars with peak hold and clip detection
- **60-second history chart** — rolling view of short-term loudness

All metrics are colour-coded against Twitch's -14 LUFS target: green (on target), yellow (warning), red (danger).

## Running Without Docker

Requires Node.js 20+ and FFmpeg installed on your system.

```bash
npm install
npm start
```

## Development

```bash
npm install
npm test
```

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 1935 | RTMP | Stream ingest |
| 3000 | HTTP/WS | Web dashboard |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with quick start and usage"
```
