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
