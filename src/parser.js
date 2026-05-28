const VIDEO_STREAM_RE = /Stream #\d+:\d+.*Video:\s+(\w+).*?,\s+(\d{3,5}x\d{3,5})\b.*?(\d+(?:\.\d+)?)\s+(?:fps|tbr)/;
const AUDIO_STREAM_RE = /Stream #\d+:\d+.*Audio:\s+(\w+).*?(\d+)\s+kb\/s/;
const AUDIO_STREAM_RE_ALT = /Stream #\d+:\d+.*Audio:\s+(\w+)/;
const EBUR128_RE = /\[Parsed_ebur128.*?\]\s+t:\s*[\d.]+\s+.*?M:\s*([-\d.]+)\s+S:\s*([-\d.]+)\s+I:\s*([-\d.]+)/;
const EBUR128_TPK_RE = /\[Parsed_ebur128.*?\]\s+t:.*TPK:\s*([-\d.]+)\s+([-\d.]+)\s+dBFS/;
const PROGRESS_RE = /^frame=\s*\d+/;

function parseLine(line) {
  let match;

  match = line.match(VIDEO_STREAM_RE);
  if (match) {
    return {
      type: 'streamInfo',
      data: {
        resolution: match[2],
        videoCodec: match[1],
        framerate: parseFloat(match[3]),
      },
    };
  }

  match = line.match(AUDIO_STREAM_RE);
  if (match) {
    return {
      type: 'streamInfo',
      data: {
        audioCodec: match[1],
        audioBitrate: parseInt(match[2], 10),
      },
    };
  }

  if (!match && AUDIO_STREAM_RE_ALT.test(line) && line.includes('Audio:')) {
    const codecMatch = line.match(AUDIO_STREAM_RE_ALT);
    if (codecMatch) {
      return {
        type: 'streamInfo',
        data: {
          audioCodec: codecMatch[1],
          audioBitrate: null,
        },
      };
    }
  }

  match = line.match(EBUR128_RE);
  if (match) {
    const result = {
      type: 'ebur128',
      data: {
        momentary: parseFloat(match[1]),
        shortTerm: parseFloat(match[2]),
        integrated: parseFloat(match[3]),
      },
    };

    const tpkMatch = line.match(EBUR128_TPK_RE);
    if (tpkMatch) {
      result.data.truePeak = Math.max(parseFloat(tpkMatch[1]), parseFloat(tpkMatch[2]));
    }

    return result;
  }

  if (PROGRESS_RE.test(line)) {
    const bitrateMatch = line.match(/bitrate=\s*([\d.]+)kbits\/s/);
    const speedMatch = line.match(/speed=\s*([\d.]+)x/);
    const dropMatch = line.match(/drop=\s*(\d+)/);

    return {
      type: 'progress',
      data: {
        videoBitrate: bitrateMatch ? parseFloat(bitrateMatch[1]) : null,
        speed: speedMatch ? parseFloat(speedMatch[1]) : null,
        frameDrops: dropMatch ? parseInt(dropMatch[1], 10) : 0,
      },
    };
  }

  return null;
}

module.exports = { parseLine };
