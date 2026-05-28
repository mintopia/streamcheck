const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
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
      '-v', 'verbose',
      '-nostats',
      '-i', 'pipe:0',
      '-filter:a', 'ebur128=peak=true:framelog=verbose',
      '-f', 'null', '-',
    ], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    this._streamlink.stdout.pipe(this._ffmpeg.stdin);

    let buf = '';
    this._ffmpeg.stderr.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n|\r/);
      buf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parsed = parseLine(trimmed);
        if (parsed) this.emit('metric', parsed);
      }
    });

    this._streamlink.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text.includes('error') || text.includes('No playable streams')) {
        this.emit('state', { type: 'offline', message: 'Stream is offline', lastSeen: Date.now() });
      }
    });

    const onProcessFailure = (proc, name) => {
      let handled = false;
      const handle = (message) => {
        if (handled || this._stopping) return;
        handled = true;
        this.emit('state', {
          type: 'error',
          message,
          retryIn: this._reconnectDelay,
        });
        this._scheduleReconnect();
      };
      proc.on('error', (err) => {
        handle(`${name}: ${err.code === 'ENOENT' ? 'not found on PATH' : err.message}`);
      });
      proc.on('exit', (code) => {
        handle(`${name} exited with code ${code}`);
      });
    };

    onProcessFailure(this._streamlink, 'streamlink');
    onProcessFailure(this._ffmpeg, 'ffmpeg');
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
