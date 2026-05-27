const EventEmitter = require('node:events');

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

module.exports = { parseLine };
