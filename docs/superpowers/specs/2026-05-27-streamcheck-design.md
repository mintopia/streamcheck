# StreamCheck Design Spec

Real-time audio loudness monitoring for Twitch streamers. Accepts an RTMP stream, analyses audio via FFmpeg, and displays LUFS metrics and peak meters on a web dashboard.

## Goals

- Single-purpose tool: tell a Twitch streamer whether their audio levels are correct for the platform
- Answer "am I OK?" in under one second at a glance
- Target audience: all Twitch streamers, not just audio engineers
- Deployed as a Docker container with Node.js + FFmpeg

## Architecture

```
OBS / Stream Source
       │ RTMP :1935
       ▼
node-media-server (RTMP ingest)
       │ publish event
       ▼
FFmpeg process (ebur128 filter)
       │ stderr → line parser
       ▼
Express + WebSocket server (:3000)
       │ WebSocket ~10Hz
       ▼
Browser UI (meters + LUFS readouts)
```

### Components

**node-media-server** — Listens on port 1935 for RTMP connections. Accepts any stream key in single-stream mode (first publisher wins). Fires `prePublish` and `donePublish` events for lifecycle management.

**FFmpeg process** — Spawned on stream connect, killed on disconnect. Pulls from `rtmp://localhost:1935/live/<key>` and runs the `ebur128` filter with `peak=true` and `framelog=verbose`. Outputs loudness data to stderr every 100ms.

**Line parser** — Reads FFmpeg stderr line by line. Regex-matches the ebur128 output format:
```
[Parsed_ebur128_0 @ 0x...] t: 1.234  TARGET:-23 LUFS  M: -18.2  S: -19.1  I: -20.3  LRA: 8.2  FTPK: -6.3 -5.8  TPK: -4.1 -3.9
```
Extracts: Momentary LUFS (M), Short-term LUFS (S), Integrated LUFS (I), Loudness Range (LRA), True Peak per channel (TPK).

**Express server** — Serves the static web UI on port 3000. Hosts a WebSocket endpoint that pushes parsed metrics to all connected browsers at approximately 10Hz (matching FFmpeg's 100ms output interval).

**Browser UI** — Receives metrics via WebSocket, renders audiometers and LUFS readouts with real-time updates.

### FFmpeg Command

```bash
ffmpeg -i rtmp://localhost:1935/live/<key> \
  -filter:a ebur128=peak=true:framelog=verbose \
  -f null -
```

### Lifecycle

1. App starts: node-media-server listens on 1935, Express serves UI on 3000
2. UI shows "Waiting for stream" state
3. Streamer connects OBS to `rtmp://host:1935/live/<key>`
4. `prePublish` event fires → spawn FFmpeg → begin parsing → UI transitions to live state
5. Metrics flow to browser in real-time via WebSocket
6. Stream ends → `donePublish` event → kill FFmpeg process → UI shows "Signal lost" state
7. New stream connects → cycle repeats from step 4

## Twitch Audio Targets

Twitch normalizes all streams to -14 LUFS. Streaming louder gets turned down; streaming quieter means your stream is quieter than others.

| Metric | Target | Warning Zone | Danger Zone |
|--------|--------|-------------|-------------|
| Integrated LUFS | -14 LUFS | < -18 or > -10 | < -24 or > -6 |
| True Peak | -1 dBTP max | > -2 dBTP | > -1 dBTP (clipping) |
| Short-term LUFS | ~-14 LUFS | Sustained > -8 | Sustained > -6 |

The UI colour-codes all metrics against these thresholds: green (on target), yellow (warning), red (danger). Every colour-coded element also carries a text label or icon so status is communicated without relying on colour alone.

## Web UI Design

### Visual Direction

Dark theme with monospace typography. Designed to sit alongside OBS and other streaming tools. Professional broadcast monitor aesthetic with accessible colour choices.

- Background: tinted near-black (`#0e0e11`), not pure black
- Surfaces: `#18181d` with `#2e2e36` borders
- Text: primary `#e8e8ec`, secondary `#9a9aa6`, tertiary `#6e6e7a`
- Status colours: green `#5cb97a`, yellow `#d4a843`, red `#d45a5a` (all meeting WCAG AA on dark surfaces)
- All colours defined as CSS custom properties for maintainability
- Font stack: SF Mono, Fira Code, Cascadia Code, JetBrains Mono, monospace

### Layout

Two-column grid layout:

**Left column:** True Peak meters (vertical bars, L/R channels) with dBFS scale (0 to -48), peak-hold indicators, -1 dBTP threshold line, peak-hold numeric readout, and clip latch indicator.

**Right column, top:** LUFS readouts with clear hierarchy:
- **Integrated LUFS (hero):** Large 42px readout. Explicit pass/fail status with text label and icon ("On target for Twitch" / "Too loud for Twitch" / "Too quiet for Twitch"). Target and threshold values displayed alongside.
- **Secondary row (3-column grid):** Momentary LUFS (400ms window), Short-term LUFS (3s window), Loudness Range (dynamic spread). Smaller 22px readouts with contextual measurement-window hints.

**Right column, bottom:** Rolling 60-second Short-term LUFS history chart with -14 LUFS target reference line overlay.

**Header:** Compact single row with app name, live/waiting status badge, stream duration, and audio codec info. No stream key displayed (screen-share safety).

### Meter Specifications

**True Peak bars:**
- Vertical orientation, 24px wide, 220px tall per channel
- Colour zones: green (bottom 62%), yellow (62%-83%), red (83%-100%)
- Peak-hold line: white 2px indicator, holds for 2 seconds then decays
- Threshold line: red at -1 dBTP position
- dBFS scale alongside: 0, -6, -12, -18, -24, -36, -48
- Animation: `transform: scaleY()` with `transform-origin: bottom` for GPU compositing

**Clip indicator:**
- Below meters. Default state: "No clips" on muted surface
- Clip detected: red background tint, "CLIP" label, flashes 3 times then holds steady
- Latches until user resets (click or WebSocket command)
- Counter shows total clips since stream start

### Connection States

Three designed states, each replacing the full dashboard:

**Waiting for stream:** Muted icon, "Waiting for stream" title, hint text showing the RTMP URL to connect to (`rtmp://host:1935/live/your-key`).

**Live:** The full dashboard with metrics. Green status badge with pulsing dot in header.

**Signal lost:** Warning icon in red, "Signal lost" title, shows the time the stream disconnected. Auto-transitions back to "Waiting for stream" after 10 seconds.

### LUFS Status Logic

The Integrated LUFS card displays explicit text status:

| Integrated Value | Colour | Status Text |
|-----------------|--------|-------------|
| -18 to -10 LUFS | Green | On target for Twitch |
| -10 to -6 LUFS | Yellow | Too loud for Twitch |
| -24 to -18 LUFS | Yellow | Too quiet for Twitch |
| > -6 LUFS | Red | Way too loud for Twitch |
| < -24 LUFS | Red | Way too quiet for Twitch |

Momentary and Short-term cards use the same colour thresholds but without text status labels (their values change too rapidly for text to be useful).

### History Chart

- Canvas-based rolling chart (better than SVG for continuous 10Hz redraws)
- 60-second window of Short-term LUFS data
- Green area fill with stroke line
- Horizontal reference line at -14 LUFS with label
- Updates at 10Hz, scrolls left as new data arrives

### Accessibility

- All status communicated via text + icon + colour, never colour alone
- WCAG AA contrast ratios on all text elements
- `role="meter"` with `aria-label`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax` on meter elements
- `aria-live="polite"` on LUFS readouts for screen reader updates
- No pure `#000` or `#fff` — all neutrals tinted

## Data Flow

### WebSocket Message Format

Server pushes JSON messages to connected clients:

```json
{
  "type": "metrics",
  "timestamp": 1716825600123,
  "momentary": -13.2,
  "shortTerm": -14.1,
  "integrated": -13.8,
  "lra": 8.2,
  "truePeakL": -6.3,
  "truePeakR": -5.8,
  "truePeakMax": -3.9
}
```

State change messages:

```json
{ "type": "streamStart", "key": "stream_key", "timestamp": 1716825600000 }
{ "type": "streamEnd", "timestamp": 1716825960000 }
```

### Update Rate

FFmpeg's ebur128 filter outputs data every 100ms. The parser forwards each update to the WebSocket server, which broadcasts to all connected clients. The browser renders at 10Hz, matching the data rate.

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js (LTS) |
| RTMP server | node-media-server |
| Audio analysis | FFmpeg (ebur128 filter) |
| Web server | Express |
| WebSocket | ws |
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Deployment | Docker (node + ffmpeg base image) |

Vanilla frontend is deliberate: this is a single-page monitoring display with no routing, no forms, no complex state. A framework would add build complexity for no benefit.

## Docker

Single Dockerfile based on a Node.js LTS image with FFmpeg installed. Exposes ports 1935 (RTMP) and 3000 (web UI).

```dockerfile
FROM node:lts-slim
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 1935 3000
CMD ["node", "src/index.js"]
```

## Project Structure

```
streamcheck/
├── src/
│   ├── index.js          # Entry point: starts RTMP + Express + WS servers
│   ├── rtmp.js           # node-media-server configuration and lifecycle
│   ├── analyzer.js       # FFmpeg process management and stderr parsing
│   ├── websocket.js      # WebSocket server and client broadcast
│   └── public/
│       ├── index.html    # Dashboard UI
│       ├── style.css     # Styles (CSS custom properties)
│       └── app.js        # WebSocket client, meter rendering, state management
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

## Out of Scope

- Multiple concurrent streams
- Authentication or stream key validation
- Recording or forwarding the stream
- Persistent storage or history beyond 60 seconds
- Configuration UI (targets are hardcoded for Twitch)
- Mobile-responsive layout (designed for desktop monitoring alongside OBS)
