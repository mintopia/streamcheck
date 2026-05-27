const EventEmitter = require('node:events');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

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
    let buf = '';
    const origPush = stream.push.bind(stream);
    stream.push = (chunk, encoding) => {
      if (chunk !== null) {
        buf += chunk.toString();
        const parts = buf.split('\n');
        buf = parts.pop();
        for (const line of parts) {
          const metrics = parseLine(line);
          if (!metrics) continue;

          const peak = Math.max(metrics.truePeakL, metrics.truePeakR);
          if (peak > this._truePeakMax) {
            this._truePeakMax = peak;
          }

          this.emit('metrics', {
            ...metrics,
            truePeakMax: this._truePeakMax,
            timestamp: Date.now(),
          });
        }
      }
      return origPush(chunk, encoding);
    };
  }
}

module.exports = { parseLine, Analyzer };
