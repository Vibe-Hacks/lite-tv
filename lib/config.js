// All configuration comes from environment variables. A backend is enabled when its URL is set.
'use strict';

function url(name) {
  const v = (process.env[name] || '').trim();
  if (!v) return null;
  try { return new URL(v.endsWith('/') ? v : v + '/'); }
  catch { throw new Error(`${name} is not a valid URL: ${v}`); }
}

function int(name, dflt, min, max) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}: ${raw}`);
  return n;
}

const config = {
  port: int('PORT', 6972, 1, 65535),
  pageSize: int('PAGE_SIZE', 24, 1, 200),
  dataDir: process.env.DATA_DIR || require('path').join(__dirname, '..', 'data'),
  version: require('../package.json').version,
  jellyfin: {
    url: url('JELLYFIN_URL'),
    uiUrl: process.env.JELLYFIN_UI_URL || '',
  },
};

module.exports = config;
