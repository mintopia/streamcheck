# StreamCheck Design Spec

A browser-based live monitoring dashboard for Twitch stream quality, built for stream engineers and operations staff.

## Overview

StreamCheck monitors a preconfigured Twitch stream and presents real-time quality metrics in a browser dashboard. A single Node.js process handles stream acquisition (streamlink + FFmpeg), metric extraction (ebur128 filter + progress parsing), and web serving (Express + WebSocket).

Target user: stream engineer monitoring a live broadcast on a secondary screen, needing to confirm stream health at a glance before returning attention to the production workflow.

## Architecture

### Single-process monolith

One Node.js (Express) process with three internal layers:

1. **Stream Acquisition** — spawns `streamlink` as a child process to resolve the Twitch URL to an HLS stream, pipes stdout to `ffmpeg` for analysis.
2. **Metric Extraction** — parses FFmpeg's stderr output line-by-line to extract all metrics. Uses the `ebur128` audio filter for LUFS/peak data and FFmpeg's progress output for bitrate/framerate/drops.
3. **Web Layer** — Express serves static frontend files. A WebSocket server (`ws` library) broadcasts parsed metrics to all connected browsers.

### Data flow

```
Twitch URL → streamlink (child process) → FFmpeg (with ebur128 filter) → stderr line parser → in-memory metric store → WebSocket broadcast → browser dashboard
```

### Process management

- Streamlink and FFmpeg are spawned as child processes with stdout piped between them.
- If either process exits unexpectedly, the system attempts reconnection with exponential backoff.
- Graceful shutdown on SIGTERM/SIGINT kills child processes before exiting.

## Configuration

All configuration via environment variables. No in-browser configuration UI.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STREAM_URL` | Yes | — | Twitch stream URL (e.g. `https://twitch.tv/channelname`) |
| `PORT` | No | `3000` | Web server port |
| `LUFS_TARGET` | No | `-14` | Target integrated LUFS level |
| `LUFS_TOLERANCE` | No | `2` | Acceptable LUFS deviation from target |
| `BITRATE_MIN` | No | `2500` | Minimum acceptable video bitrate (kbps) |
| `BITRATE_MAX` | No | `8000` | Maximum expected video bitrate (kbps) |
| `UPDATE_INTERVAL` | No | `1000` | WebSocket push interval (ms) |

## Metric Extraction

### FFmpeg command

```
streamlink $STREAM_URL best --stdout | ffmpeg -i pipe:0 \
  -filter:a ebur128=peak=true:framelog=verbose \
  -f null -
```

### Metrics collected

| Metric | Source | Update frequency |
|--------|--------|-----------------|
| Video bitrate | FFmpeg progress output (`bitrate=`) | ~1s |
| Audio bitrate | FFmpeg stream info at start + progress | Once + ~1s |
| LUFS momentary | ebur128 filter `M:` field | Every 100ms |
| LUFS short-term | ebur128 filter `S:` field | Every 3s |
| LUFS integrated | ebur128 filter `I:` field | ~1s rolling, final at end-of-stream |
| True peak | ebur128 filter `Peak:` field | Every 100ms |
| Framerate | FFmpeg stream detection at start | Once |
| Resolution | FFmpeg stream detection at start | Once |
| Codec (video + audio) | FFmpeg stream detection at start | Once |
| Frame drops | FFmpeg progress `drop=` field | ~1s |
| Speed | FFmpeg progress `speed=` field | ~1s |

### Health derivation

Each metric is evaluated against thresholds to produce a status: `healthy`, `degraded`, or `critical`.

- **Bitrate status**: `healthy` if within `BITRATE_MIN`–`BITRATE_MAX`; `degraded` if within 10% of bounds; `critical` if outside bounds.
- **LUFS status**: `healthy` if momentary LUFS is within `LUFS_TARGET ± LUFS_TOLERANCE`; `degraded` if within 1.5x tolerance; `critical` if beyond.
- **True peak status**: `healthy` if below -1.0 dBTP; `degraded` if -1.0 to 0.0 dBTP; `critical` if above 0.0 dBTP (clipping).
- **Buffer health**: derived from FFmpeg `speed=` value. `healthy` if speed >= 0.95x; `degraded` if 0.8x–0.95x; `critical` if below 0.8x.
- **Overall status**: worst status across all metrics. If any metric is `critical`, overall is `critical`. If any is `degraded` (and none critical), overall is `degraded`.

### In-memory metric store

A plain object holding:
- Latest values for all metrics.
- Rolling time-series buffer: configurable window (default 30 minutes at 1-second resolution = 1800 data points per metric).
- Stream metadata (resolution, codecs, framerate) set once at stream detection.

No persistence to disk. Data is lost on restart.

## WebSocket Protocol

### Connection

Browser connects to `ws://host:port/ws`. Server sends the full current state on connection (so late-joining clients get the complete picture immediately).

### Message format

Server pushes JSON messages at the configured `UPDATE_INTERVAL`:

```json
{
  "type": "metrics",
  "timestamp": 1706000000000,
  "status": "healthy",
  "stream": {
    "url": "https://twitch.tv/channelname",
    "uptime": 8040,
    "resolution": "1920x1080",
    "videoCodec": "H.264",
    "audioCodec": "AAC",
    "framerate": 60
  },
  "metrics": {
    "videoBitrate": { "value": 6240, "unit": "kbps", "status": "healthy" },
    "audioBitrate": { "value": 160, "unit": "kbps", "status": "healthy" },
    "lufs": {
      "momentary": { "value": -13.2, "unit": "LUFS", "status": "healthy" },
      "shortTerm": { "value": -13.8, "unit": "LUFS", "status": "healthy" },
      "integrated": { "value": -14.1, "unit": "LUFS", "status": "healthy" }
    },
    "truePeak": { "value": -1.2, "unit": "dBTP", "status": "healthy" },
    "frameDrops": { "value": 0, "unit": "frames", "status": "healthy" },
    "bufferHealth": { "value": 1.0, "unit": "x", "status": "healthy" }
  },
  "history": {
    "timestamps": [1706000000000, 1706000001000, ...],
    "videoBitrate": [6200, 6240, 6180, ...],
    "audioBitrate": [160, 160, 160, ...],
    "lufsMomentary": [-13.4, -13.2, -13.5, ...],
    "lufsShortTerm": [-13.8, -13.7, -13.9, ...],
    "lufsIntegrated": [-14.1, -14.1, -14.1, ...],
    "truePeak": [-1.2, -1.3, -1.1, ...],
    "bufferHealth": [1.0, 1.0, 0.99, ...],
    "frameDrops": [0, 0, 0, ...]
  }
}
```

### State messages

```json
{ "type": "connecting", "message": "Connecting to stream..." }
{ "type": "offline", "message": "Stream is offline", "lastSeen": 1706000000000 }
{ "type": "error", "message": "streamlink exited unexpectedly", "retryIn": 5000 }
```

## Dashboard UI

### Design principles

1. **Glanceability** — health readable in under 2 seconds from across a desk.
2. **Quiet until it matters** — calm when healthy, escalates visually on problems.
3. **Data density without clutter** — all metrics visible, clear hierarchy.
4. **Trust through precision** — exact values, units, ranges, thresholds shown.
5. **Sustained use** — comfortable for hours of passive monitoring.

### Register

Product register. This is a tool UI serving a task, not a brand surface.

### Color strategy

Restrained. Neutral tinted backgrounds (warm or cool-grey, not blue-grey to avoid the monitoring-dashboard category reflex). Status colors (green/amber/red) are the only chromatic elements. No accent color. Status colors reinforced with icons for color-blind accessibility.

### Theme

Dark and light modes with toggle, persisted in localStorage. Dark mode is the expected default (dim broadcast control room environment). Light mode available for daytime office use.

### Typography

System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`). Single family for all elements. Fixed rem scale with 1.125–1.2 ratio between steps. Monospace for numeric values (`"SF Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace`) so digits don't shift width as values change.

### Layout

Three-tier vertical hierarchy, desktop-only (1280px minimum):

**Tier 1: Status banner** (top, full width)
- Stream name/URL, overall health status, uptime duration.
- Background tint encodes health: muted green when healthy, amber when degraded, red when critical, neutral grey when offline.
- This is the "2-second read" — largest text, highest contrast.

**Tier 2: Metric panels** (middle, full width)
- Dense inline format (not hero-metric cards). Each metric is a row or compact group: label, value with unit, status indicator (icon + color), threshold context.
- Primary metrics (video bitrate, LUFS momentary, true peak, buffer health) have more visual weight — larger value text, positioned first.
- Secondary metrics (audio bitrate, LUFS short-term, LUFS integrated, resolution, framerate, codec, frame drops) are present but recessed — smaller text, muted labels, grouped together.
- No identical card grid. Primary and secondary metrics are visually distinct in size and treatment.

**Tier 3: Time-series charts** (bottom, full width)
- Two charts side by side: video bitrate (left), LUFS momentary (right).
- Selectable time window: 5 min / 15 min / 30 min toggle.
- Threshold bands rendered as shaded regions on the chart background.
- Hover tooltip shows exact value and timestamp.
- Charts are 150px+ height to be functionally readable.
- Lightweight charting — Canvas-based or SVG, no heavy charting library. Consider a minimal library or hand-rolled canvas rendering.

### Key states

| State | Banner | Metric panels | Charts |
|-------|--------|---------------|--------|
| **Connecting** | "Connecting to stream..." with subtle pulse | Skeleton placeholders | Empty with "Waiting for data" |
| **Healthy** | Green tint, stream name + uptime | All values shown, green status indicators | Active, data flowing |
| **Degraded** | Amber tint | Affected metrics show amber indicators | Threshold breach visible in chart |
| **Critical** | Red tint | Affected metrics show red indicators | Threshold breach visible in chart |
| **Stream offline** | Grey tint, "Stream Offline" | Last known values dimmed, "Last seen: [time]" | Frozen with vertical disconnect marker |
| **Connection error** | Red tint, error message + retry countdown | Stale data with staleness indicator | Frozen |
| **No stream configured** | Centered message: "No stream URL configured. Set STREAM_URL and restart." | Hidden | Hidden |

### Interaction model

Passive monitoring interface. Minimal interactions:

- **Theme toggle** — dark/light switch. Persisted in localStorage.
- **Chart time window** — 5/15/30 min selector. Changes which slice of the rolling buffer is displayed.
- **Chart hover** — tooltip with exact value and timestamp at cursor position.
- **No configuration in UI** — all settings are environment variables.

## Technology Stack

- **Runtime**: Node.js (LTS)
- **Server**: Express
- **WebSocket**: `ws` library
- **Stream acquisition**: streamlink (external binary)
- **Stream analysis**: FFmpeg (external binary, with ebur128 filter support)
- **Frontend**: Static HTML/CSS/JS (no framework). Vanilla JS with WebSocket client.
- **Charts**: Minimal — hand-rolled canvas or lightweight library (e.g. uPlot for performance)
- **Containerization**: Dockerfile with streamlink + FFmpeg installed

## External Dependencies

Requires these binaries available on PATH:
- `streamlink` (for Twitch URL resolution to HLS)
- `ffmpeg` (compiled with libebur128 / ebur128 filter support)

## Project Structure

```
streamcheck/
├── src/
│   ├── server.js          # Express + WebSocket server, entry point
│   ├── analyzer.js         # Spawns streamlink + FFmpeg, manages child processes
│   ├── parser.js           # Parses FFmpeg stderr into structured metrics
│   ├── store.js            # In-memory metric store with rolling buffer
│   └── health.js           # Threshold evaluation, status derivation
├── public/
│   ├── index.html          # Dashboard page
│   ├── style.css           # Styles (dark + light themes)
│   └── app.js              # WebSocket client, DOM updates, chart rendering
├── test/
│   ├── parser.test.js      # FFmpeg output parsing tests
│   ├── store.test.js       # Metric store tests
│   └── health.test.js      # Threshold evaluation tests
├── Dockerfile
├── package.json
└── .env.example
```

## Testing Strategy

- **Unit tests** for parser (FFmpeg stderr line → structured data), store (rolling buffer behavior, edge cases), and health (threshold evaluation across all metrics).
- **No integration tests requiring live streams** — parser tests use captured FFmpeg output samples.
- **Manual verification** via running the app against a live Twitch stream and checking the dashboard in a browser.
