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
