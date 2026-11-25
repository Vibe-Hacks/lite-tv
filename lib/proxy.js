// Streams media (video, images) from a backend through this server, so the TV only ever talks to one origin
// and never needs backend credentials. Range requests pass through, so direct streams stay seekable.
'use strict';
const http = require('http'), https = require('https');

/**
 * @param {URL} target  absolute upstream URL
 * @param {object} opts { headers: extra upstream headers, cacheSecs: browser cache lifetime (0 = no-store) }
 */
function proxyMedia(req, res, target, { headers = {}, cacheSecs = 0 } = {}) {
  const h = { ...headers };
  for (const name of ['range', 'if-none-match', 'if-modified-since']) if (req.headers[name]) h[name] = req.headers[name];
  const lib = target.protocol === 'https:' ? https : http;
  const up = lib.request(target, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers: h }, u => {
    const out = {};
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'])
      if (u.headers[name]) out[name] = u.headers[name];
    out['cache-control'] = cacheSecs ? `public, max-age=${cacheSecs}` : 'no-store';
    res.writeHead(u.statusCode, out);
    // If the backend drops the stream part-way, drop the TV's connection too, so its player
    // sees an error (and can fall back) instead of waiting forever for the rest.
    u.on('aborted', () => res.destroy());
    u.on('error', () => res.destroy());
    u.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  // A seek makes the TV abort the old request: stop pulling from the backend too.
  res.on('close', () => { if (!res.writableFinished) up.destroy(); });
  up.end();
}

module.exports = { proxyMedia };
