// Small HTTP helpers: request bodies, cookies, redirects.
'use strict';

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readForm(req) { return Object.fromEntries(new URLSearchParams(await readBody(req))); }
async function readJson(req, limit) { try { return JSON.parse(await readBody(req, limit) || '{}'); } catch { return {}; } }

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    // Cookies are shared by every app on the same host (whatever the port): skip ones we can't decode
    // instead of failing the request.
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* not ours */ }
  }
  return out;
}

function setCookie(res, name, value, maxAgeSecs) {
  const c = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSecs}; HttpOnly; SameSite=Lax`;
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}

function redirect(res, location, code = 302) { res.writeHead(code, { Location: location }); res.end(); }

/** Friendly device name for the media server's device list, from the TV browser's user agent. */
function deviceName(req) {
  const ua = req.headers['user-agent'] || '';
  if (/Web0S|webOS|NetCast/i.test(ua)) return 'LG TV';
  if (/Tizen/i.test(ua)) return 'Samsung TV';
  if (/SMART-TV|SmartTV|HbbTV/i.test(ua)) return 'Smart TV';
  return 'Browser';
}

module.exports = { readBody, readForm, readJson, cookies, setCookie, redirect, deviceName };
