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
