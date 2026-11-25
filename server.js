// lite-tv: fast, server-rendered media UIs for old smart-TV browsers (built for an LG webOS 3.5 / Chrome 38 TV).
// The server talks to your media server's API and sends the TV finished HTML; the TV runs ~11 KB of ES5.
// No npm dependencies. Node >= 18.  See README.md for configuration.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
let config;
try { config = require('./lib/config'); }
catch (e) { console.error(`lite-tv: ${e.message}`); process.exit(1); }

// ---------- Docker: PUID / PGID ----------
// The image starts as root so it can take ownership of the data folder (Docker and Unraid create a missing
// host folder as root), then runs as PUID:PGID for everything else. Started any other way, this is skipped.
if (process.getuid && process.getuid() === 0 && config.puid != null) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  for (const f of [config.dataDir, ...fs.readdirSync(config.dataDir).map(n => path.join(config.dataDir, n))]) {
    try { fs.chownSync(f, config.puid, config.pgid); } catch { /* read-only mount: the store warns later */ }
  }
  process.setgroups([config.pgid]);
  process.setgid(config.pgid);
  process.setuid(config.puid);
}

const h = require('./lib/html');
const { setCookie } = require('./lib/http');
const { flushAll } = require('./lib/store');

// ---------- backends (enabled by their URL env var) ----------
const backends = [];
if (config.jellyfin.url) backends.push(require('./backends/jellyfin')(config.jellyfin, config));
if (!backends.length) {
  console.error('lite-tv: no backend configured. Set JELLYFIN_URL (e.g. http://192.168.1.10:8096).');
  process.exit(1);
}
h.setSections(backends.map(b => ({ id: b.id, label: b.label, href: b.home })));
const routes = backends.flatMap(b => b.routes);

// ---------- static assets (cached forever, versioned by content hash) ----------
const STATIC = {};
for (const f of ['app.js', 'app.css', 'setup.js', 'jf-profile.js']) STATIC[f] = fs.readFileSync(path.join(__dirname, 'public', f));
h.setAssetVersion(crypto.createHash('sha1').update(Buffer.concat([STATIC['app.js'], STATIC['app.css']])).digest('hex').slice(0, 8));

const PING_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'); // 1x1 transparent

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  // No framing by other sites, no MIME sniffing, and keep the Referer (used by "Mark watched") on this site only.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  const u = new URL(req.url, 'http://x');
  const p = u.pathname, q = Object.fromEntries(u.searchParams), t0 = Date.now();
  const send = (code, html) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(html); };
  try {
    if (p.startsWith('/static/')) {
      const f = STATIC[path.basename(p)];
      if (!f) return send(404, 'Not found');
      res.writeHead(200, { 'Content-Type': p.endsWith('.css') ? 'text/css' : 'application/javascript', 'Cache-Control': 'public, max-age=31536000, immutable' });
      return res.end(f);
    }
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (p === '/ping.gif') { // reachability probe for the webOS launcher app (a real image, so <img> onload fires)
      res.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
      return res.end(PING_GIF);
    }
    if (p === '/') {
      // The webOS launcher app passes the TV's device info (?di=) on start: keep it for the device profile.
      if (q.di) {
        try {
          const d = JSON.parse(q.di), keep = {};
          for (const k of ['dolbyAtmos', 'dolbyVision', 'hdr10']) if (typeof d[k] === 'boolean') keep[k] = d[k];
          setCookie(res, 'ltv_di', JSON.stringify(keep), 365 * 86400);
        } catch { /* ignore malformed */ }
      }
      // One backend: go straight to it. Several: a simple chooser.
      if (backends.length === 1) { res.writeHead(302, { Location: backends[0].home }); return res.end(); }
      return send(200, h.layout({ title: 'Home', nav: [], body: h.grid(backends.map(b => h.tile({ href: b.home, title: b.label }))) }));
    }
    for (const [re, handler] of routes) {
      const m = p.match(re);
      if (!m) continue;
      const html = await handler({ req, res, q, path: p }, m);
      if (html === undefined) return;            // handler wrote the response itself (media, redirects)
      if (html === null) break;                  // not found
      send(200, html);
      // Query strings can hold login secrets: only log them for list pages.
      return console.log(`${req.socket.remoteAddress} ${p}${/login/.test(p) ? '' : u.search} ${Date.now() - t0}ms`);
    }
    send(404, h.errorPage('Not found', 'That page doesn’t exist.', '/'));
  } catch (e) {
    console.error(p, e);
    if (!res.headersSent) send(500, h.errorPage('Something went wrong', e.message, req.url));
  }
}).listen(config.port, '0.0.0.0', () =>
  console.log(`lite-tv on :${config.port} (${backends.map(b => `${b.label} -> ${config[b.id].url.href}`).join(', ')})`));

// docker stop / Ctrl+C: save pending sign-ins, then exit (as PID 1 in a container, Node won't exit on its own).
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { flushAll(); server.close(); process.exit(0); });
