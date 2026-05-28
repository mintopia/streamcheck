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
