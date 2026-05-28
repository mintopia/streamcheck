const express = require('express');
const { createServer } = require('node:http');
const { WebSocketServer } = require('ws');
const path = require('node:path');
const { loadConfig } = require('./config.js');
const { Analyzer } = require('./analyzer.js');
const { MetricStore } = require('./store.js');
const { evaluateHealth, overallStatus } = require('./health.js');

let config;
try {
  config = loadConfig();
} catch {
  config = null;
}

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

if (!config) {
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'no-stream' }));
  });

  const port = parseInt(process.env.PORT, 10) || 3000;
  server.listen(port, () => {
    console.log(`StreamCheck listening on http://localhost:${port} (no STREAM_URL configured)`);
  });

  const shutdownNoConfig = () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.close();
  };
  process.on('SIGTERM', shutdownNoConfig);
  process.on('SIGINT', shutdownNoConfig);
  return;
}

const store = new MetricStore();
const analyzer = new Analyzer(config.streamUrl);

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
        const info = parsed.data;
        console.log(`[stream] ${info.resolution || '?'} ${info.videoCodec || ''} ${info.audioCodec || ''} ${info.framerate ? info.framerate + 'fps' : ''}`.trim());
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
  console.log(`[${state.type}] ${state.message}`);
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
  for (const client of wss.clients) client.terminate();
  wss.close();
  server.close();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
