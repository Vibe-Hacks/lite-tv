// Shared HTML building blocks. Output must work in old TV browsers (see public/app.css for the CSS rules).
'use strict';

let assetVersion = 'dev';
let sections = []; // [{ id, label, href }] — one per enabled backend

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDur = sec => {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};

const qs = o => Object.entries(o)
  .filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

/**
 * Full page. `nav` is the active backend's menu: [{ href, label, on, right }].
 * `section` is the active backend id (highlighted in the section switcher when there is more than one).
 */
function layout({ title, body, nav = null, section = null, bodyClass = '' }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)} · lite-tv</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/app.css?v=${assetVersion}">
</head><body class="${bodyClass}">${nav ? header(nav, section) : ''}<main>${body}</main>
<script src="/static/app.js?v=${assetVersion}"></script></body></html>`;
}

function header(nav, section) {
  const switcher = sections.length > 1
    ? sections.map(s => `<a class="nav sec${s.id === section ? ' on' : ''}" href="${s.href}">${esc(s.label)}</a>`).join('') + '<span class="div"></span>'
    : '';
  const items = nav.filter(i => !i.right).map(i => `<a class="nav${i.on ? ' on' : ''}" href="${esc(i.href)}">${esc(i.label)}</a>`).join('');
  const right = nav.filter(i => i.right).map(i => `<a class="nav dim" href="${esc(i.href)}">${esc(i.label)}</a>`).join('');
  return `<header>${switcher}${items}<span class="sp"></span>${right}</header>`;
}

/** A focusable card. `img` is lazy-loaded; `poster` switches to a narrower poster (2:3) tile. */
function tile({ href, img, title, meta = '', badge = '', progress = 0, poster = false, watched = false }) {
  return `<a class="tile${poster ? ' poster' : ''}" href="${esc(href)}"><span class="thumb">${img ? `<img data-src="${esc(img)}" alt="">` : ''}
${badge ? `<span class="badge">${esc(badge)}</span>` : ''}${watched ? '<span class="seen">✓</span>' : ''}${progress ? `<span class="prog"><span style="width:${Math.min(100, Math.round(progress))}%"></span></span>` : ''}</span>
<span class="t">${esc(title)}</span>${meta ? `<span class="m">${esc(meta)}</span>` : ''}</a>`;
}

const grid = tiles => `<div class="grid">${tiles.join('')}</div>`;
const moreTile = href => `<a class="tile more" href="${esc(href)}"><span>More ›</span></a>`;
const row = (title, tiles, more) => tiles.length ? `<h2>${esc(title)}</h2>${grid(more ? tiles.concat(moreTile(more)) : tiles)}` : '';

/** Sort buttons. `sorts` = { key: { label } }. */
function sortBar(base, sorts, cur, extra = {}) {
  return `<div class="bar">${Object.entries(sorts).map(([k, v]) =>
    `<a class="btn${k === cur ? ' on' : ''}" href="${esc(base)}?${qs({ ...extra, sort: k })}">${esc(v.label)}</a>`).join('')}</div>`;
}

function pager(base, params, pageNo, count, pageSize, noun = 'items') {
  const last = Math.max(1, Math.ceil(count / pageSize));
  const link = (p, label) => `<a class="btn" href="${esc(base)}?${qs({ ...params, page: p })}">${label}</a>`;
  return `<div class="bar pager">${pageNo > 1 ? link(pageNo - 1, '‹ Previous') : ''}<span class="info">Page ${pageNo} of ${last} · ${count} ${esc(noun)}</span>${pageNo < last ? link(pageNo + 1, 'Next ›') : ''}</div>`;
}

/**
 * Full-screen player page. The client (public/app.js) reads everything from data attributes. One of:
 *  - direct:    URL the TV plays as-is (seekable via HTTP Range)
 *  - hls:       HLS playlist URL, played by the TV's native HLS player (seekable)
 *  - transcode: progressive transcode URL template; "{start}" is replaced with the start second
 * plus optional:
 *  - fallback:  URL template ({start}) to load if the direct stream fails on the TV
 *  - report:    URL the client POSTs {event: start|progress|stopped, pos, paused} to
 *  - subtitles: [{ src, lang, label }] WebVTT tracks shown by default
 *  - next / nextTitle: what to play after this one ends (10 s "Up next" countdown)
 */
function playerPage({ title, meta, direct = '', hls = '', transcode = '', fallback = '', subtitles = [], duration, start = 0, report = '', next = '', nextTitle = '' }) {
  const mode = direct ? 'direct' : hls ? 'hls' : 'transcode';
  const tracks = subtitles.map((t, i) => `<track kind="subtitles" src="${esc(t.src)}" srclang="${esc(t.lang)}" label="${esc(t.label)}"${i === 0 ? ' default' : ''}>`).join('');
  return layout({
    title, bodyClass: 'play',
    body: `<div id="player" data-mode="${mode}" data-direct="${esc(direct)}" data-hls="${esc(hls)}" data-transcode="${esc(transcode)}" data-fallback="${esc(fallback)}" data-duration="${duration || 0}" data-start="${start}" data-report="${esc(report)}" data-next="${esc(next)}" data-next-title="${esc(nextTitle)}">
<video id="v" preload="auto" autoplay>${tracks}</video>
<div id="osd"><div class="t">${esc(title)}</div>
<div class="m">${esc(meta)}</div>
<div class="bar"><span id="cur">0:00</span><span class="track"><span id="fill"></span></span><span id="dur">${fmtDur(duration)}</span></div>
<div class="keys">OK play/pause · ◀ ▶ 10 s · ▲ ▼ 1 min · Back to exit</div></div>
<div id="msg"></div></div>`,
  });
}

function errorPage(title, message, retryHref) {
  return layout({ title, nav: [], body: `<h1>${esc(title)}</h1><p>${esc(message)}</p>${retryHref ? `<p><a class="btn" href="${esc(retryHref)}">Try again</a></p>` : ''}` });
}

module.exports = {
  esc, fmtDur, qs, layout, tile, grid, row, sortBar, pager, playerPage, errorPage,
  setAssetVersion: v => { assetVersion = v; },
  setSections: s => { sections = s; },
};
