// Jellyfin backend: movies (and episodes reached from Continue watching / Next up), playback that mirrors
// the official Jellyfin web client (same device profile, same PlaybackInfo request, HLS for transcodes),
// and playback reporting so watched state stays in sync.
'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const h = require('../lib/html');
const { proxyMedia } = require('../lib/proxy');
const { readForm, readJson, cookies, setCookie, redirect, deviceName } = require('../lib/http');
const { createStore } = require('../lib/store');

const TICKS = 10000000; // Jellyfin time unit: 100 ns
const COOKIE = 'ltv_jf';

module.exports = function createJellyfin(cfg, { pageSize, dataDir, version }) {
  const P = '/jellyfin';
  const base = cfg.url;
  const sessions = createStore(dataDir, 'jellyfin-sessions'); // sid -> { userId, userName, token, device, created }
  const pendingLogins = new Map();                            // quick connect secret -> { sid, t }
  const plays = new Map();                                    // our play id -> playback state (see play())

  // ---------- Jellyfin API ----------
  const authHeader = (sid, device, token) =>
    `MediaBrowser Client="lite-tv", Device="${device || 'Browser'}", DeviceId="lite-tv-${sid}", Version="${version}"${token ? `, Token="${token}"` : ''}`;

  class AuthError extends Error {}
  const API_TIMEOUT = 15000; // a hung server (e.g. array stopped) shows an error page instead of a blank TV

  async function api(s, method, path, { query, body } = {}) {
    const u = new URL(path.replace(/^\//, ''), base);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
    let r;
    try {
      r = await fetch(u, {
        method,
        headers: { Authorization: authHeader(s.sid, s.device, s.token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(API_TIMEOUT),
      });
    } catch (e) {
      throw new Error(e.name === 'TimeoutError' ? `Jellyfin didn't answer within ${API_TIMEOUT / 1000} s.` : `Couldn't reach Jellyfin at ${base.origin}.`);
    }
    if (r.status === 401) throw new AuthError('Jellyfin session expired');
    if (!r.ok) throw new Error(`Jellyfin ${method} ${u.pathname}: HTTP ${r.status}`);
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  }

  // ---------- device profile ----------
  // lite-tv never decides what the TV can play. The TV runs jellyfin-web's own profile builder
  // (public/jf-profile.js, see /jellyfin/setup) and its bitrate test, exactly like the official Jellyfin
  // web client / webOS app, and we send that profile with every PlaybackInfo request. So Jellyfin makes
  // the same direct play / remux / transcode decisions it would for the official app.
  const fileVersion = f => crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, '..', 'public', f))).digest('hex').slice(0, 12);
  const PROFILE_JS_VERSION = fileVersion('jf-profile.js'), SETUP_JS_VERSION = fileVersion('setup.js');
  const BITRATE_MAX_AGE = 3600e3; // jellyfin-web re-runs its bitrate test after an hour
  // The profile depends on the browser (user agent), the builder version and the webOS device info.
  const profileKey = req => crypto.createHash('sha1')
    .update(`${req.headers['user-agent'] || ''}|${PROFILE_JS_VERSION}|${cookies(req).ltv_di || ''}`).digest('hex').slice(0, 16);
  // jellyfin-web treats the client as "in network" for its LAN bitrate floor; mirror that for the TV's address.
  const inNetwork = req => /^(::ffff:)?(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)|^::1$|^f[cd]/i.test(req.socket.remoteAddress || '');

  // ---------- sessions ----------
  function session(req) {
    const sid = cookies(req)[COOKIE];
    const s = sid && sessions.get(sid);
    return s ? { sid, ...s } : null;
  }
  function startSession(res, sid, device, auth) {
    sessions.set(sid, { userId: auth.User.Id, userName: auth.User.Name, token: auth.AccessToken, device, created: Date.now() });
    setCookie(res, COOKIE, sid, 10 * 365 * 86400);
  }

  // ---------- helpers ----------
  const FIELDS = 'Overview,ProductionYear,CommunityRating,OfficialRating,RunTimeTicks,ImageTags,BackdropImageTags,ParentBackdropImageTags,ParentBackdropItemId,SeriesId,SeriesName,SeriesPrimaryImageTag,ParentIndexNumber,IndexNumber,UserData,MediaSources';
  const img = (id, type, w, tag) => `${P}/img/${id}/${type}?w=${w}${tag ? `&tag=${tag}` : ''}`;
  const posterImg = it => it.ImageTags && it.ImageTags.Primary ? img(it.Id, 'Primary', 300, it.ImageTags.Primary)
    : it.SeriesPrimaryImageTag ? img(it.SeriesId, 'Primary', 300, it.SeriesPrimaryImageTag) : '';
  const landscapeImg = it => {
    if (it.Type === 'Episode' && it.ImageTags && it.ImageTags.Primary) return img(it.Id, 'Primary', 480, it.ImageTags.Primary);
    if (it.ImageTags && it.ImageTags.Thumb) return img(it.Id, 'Thumb', 480, it.ImageTags.Thumb);
    if (it.BackdropImageTags && it.BackdropImageTags.length) return img(it.Id, 'Backdrop', 480, it.BackdropImageTags[0]);
    if (it.ParentBackdropItemId && it.ParentBackdropImageTags && it.ParentBackdropImageTags.length) return img(it.ParentBackdropItemId, 'Backdrop', 480, it.ParentBackdropImageTags[0]);
    return posterImg(it);
  };
  const secs = ticks => (ticks || 0) / TICKS;
  const epLabel = it => it.Type === 'Episode' ? `S${it.ParentIndexNumber || 0} E${it.IndexNumber || 0}` : '';
  const itemTitle = it => it.Type === 'Episode' ? `${it.SeriesName} · ${epLabel(it)}` : it.Name;
  const progressPct = it => it.UserData && it.UserData.PlayedPercentage ? it.UserData.PlayedPercentage : 0;

  const itemHref = it => it.Type === 'Series' ? `${P}/series/${it.Id}` : it.Type === 'Season' ? `${P}/season/${it.Id}` : `${P}/item/${it.Id}`;
  const unplayed = it => it.UserData && it.UserData.UnplayedItemCount ? `${it.UserData.UnplayedItemCount} unwatched` : '';
  const posterTile = it => h.tile({
    href: itemHref(it), img: posterImg(it), poster: true, title: it.Name,
    meta: it.Type === 'Series' ? [it.ProductionYear, unplayed(it)].filter(Boolean).join(' · ')
      : it.Type === 'Season' ? [it.ChildCount ? `${it.ChildCount} episodes` : '', unplayed(it)].filter(Boolean).join(' · ')
      : [it.ProductionYear, it.RunTimeTicks ? h.fmtDur(secs(it.RunTimeTicks)) : ''].filter(Boolean).join(' · '),
    progress: progressPct(it), watched: !!(it.UserData && it.UserData.Played),
  });
  const wideTile = it => h.tile({
    href: itemHref(it), img: landscapeImg(it), title: itemTitle(it),
    meta: it.Type === 'Episode' ? it.Name : [it.ProductionYear, it.RunTimeTicks ? h.fmtDur(secs(it.RunTimeTicks)) : ''].filter(Boolean).join(' · '),
    badge: it.RunTimeTicks ? h.fmtDur(secs(it.RunTimeTicks)) : '', progress: progressPct(it),
  });
  // Episodes inside a season: number + title, with watched mark and progress.
  const episodeTile = it => h.tile({
    href: `${P}/item/${it.Id}`, img: landscapeImg(it), title: `${it.IndexNumber != null ? it.IndexNumber + '. ' : ''}${it.Name}`,
    meta: it.RunTimeTicks ? h.fmtDur(secs(it.RunTimeTicks)) : '', progress: progressPct(it), watched: !!(it.UserData && it.UserData.Played),
  });

  const nav = (s, active) => [
    { href: `${P}/`, label: 'Home', on: active === 'home' },
    { href: `${P}/movies`, label: 'Movies', on: active === 'movies' },
    { href: `${P}/shows`, label: 'Shows', on: active === 'shows' },
    ...(cfg.uiUrl ? [{ href: cfg.uiUrl, label: 'Full Jellyfin', right: true }] : []),
    { href: `${P}/logout`, label: `Sign out ${s.userName}`, right: true },
  ];
  const page = (s, title, active, body) => h.layout({ title, body, nav: nav(s, active), section: 'jellyfin' });

  const SORTS = {
    added: { label: 'Recently added', by: 'DateCreated,SortName', order: 'Descending' },
    name: { label: 'A–Z', by: 'SortName', order: 'Ascending' },
    year: { label: 'Year', by: 'ProductionYear,SortName', order: 'Descending' },
    rating: { label: 'Top rated', by: 'CommunityRating,SortName', order: 'Descending' },
    unwatched: { label: 'Unwatched', by: 'SortName', order: 'Ascending', filters: 'IsUnplayed' },
    random: { label: 'Random', by: 'Random', order: 'Ascending' },
  };
  const SHOW_SORTS = {
    added: { label: 'Recently updated', by: 'DateLastContentAdded,SortName', order: 'Descending' },
    name: { label: 'A–Z', by: 'SortName', order: 'Ascending' },
    year: { label: 'Year', by: 'ProductionYear,SortName', order: 'Descending' },
    rating: { label: 'Top rated', by: 'CommunityRating,SortName', order: 'Descending' },
    unwatched: { label: 'Unwatched', by: 'SortName', order: 'Ascending', filters: 'IsUnplayed' },
    random: { label: 'Random', by: 'Random', order: 'Ascending' },
  };

  // ---------- pages ----------
  async function home(s) {
    const [resume, nextUp, latest, latestEps] = await Promise.all([
      api(s, 'GET', '/UserItems/Resume', { query: { userId: s.userId, mediaTypes: 'Video', limit: 5, fields: FIELDS, enableTotalRecordCount: false } }),
      api(s, 'GET', '/Shows/NextUp', { query: { userId: s.userId, limit: 5, fields: FIELDS, enableTotalRecordCount: false } }),
      api(s, 'GET', '/Items/Latest', { query: { userId: s.userId, includeItemTypes: 'Movie', limit: 6, fields: FIELDS } }),
      // Like jellyfin-web's "Latest TV": newest episodes, grouped by series.
      api(s, 'GET', '/Items/Latest', { query: { userId: s.userId, includeItemTypes: 'Episode', groupItems: true, limit: 6, fields: FIELDS } }),
    ]);
    // A grouped result is the series itself (several new episodes) or a single episode: show the series poster for both.
    const latestShows = latestEps.map(it => it.Type === 'Episode'
      ? h.tile({ href: `${P}/item/${it.Id}`, img: posterImg(it), poster: true, title: it.SeriesName, meta: `${epLabel(it)} · ${it.Name}` })
      : posterTile(it));
    const body = h.row('Continue watching', resume.Items.map(wideTile)) +
      h.row('Next up', nextUp.Items.map(wideTile)) +
      h.row('Latest movies', latest.map(posterTile), `${P}/movies?sort=added`) +
      h.row('Latest shows', latestShows, `${P}/shows?sort=added`);
    return page(s, 'Home', 'home', body || '<h2>Nothing here yet</h2>');
  }

  async function shows(s, q) {
    const sort = SHOW_SORTS[q.sort] ? q.sort : 'added', pageNo = Math.max(1, +q.page || 1), so = SHOW_SORTS[sort];
    const per = pageSize + 4; // posters: 7 per row
    const r = await api(s, 'GET', '/Items', { query: {
      userId: s.userId, includeItemTypes: 'Series', recursive: true, sortBy: so.by, sortOrder: so.order, filters: so.filters,
      startIndex: (pageNo - 1) * per, limit: per, fields: 'ProductionYear,ImageTags,UserData', imageTypeLimit: 1,
      enableImageTypes: 'Primary', enableTotalRecordCount: true,
    } });
    return page(s, 'Shows', 'shows', h.sortBar(`${P}/shows`, SHOW_SORTS, sort) + h.grid(r.Items.map(posterTile)) +
      h.pager(`${P}/shows`, { sort }, pageNo, r.TotalRecordCount, per, 'shows'));
  }

  // Backdrop + poster + text header shared by the series and item pages.
  function detailHeader(it, { kicker = '', facts = [], buttons = '', extra = '', compact = false }) {
    const backdrop = it.BackdropImageTags && it.BackdropImageTags.length ? img(it.Id, 'Backdrop', 1280, it.BackdropImageTags[0])
      : it.ParentBackdropItemId && it.ParentBackdropImageTags && it.ParentBackdropImageTags.length ? img(it.ParentBackdropItemId, 'Backdrop', 1280, it.ParentBackdropImageTags[0]) : '';
    return `<div class="detail${compact ? ' compact' : ''}"${backdrop ? ` style="background-image:url('${h.esc(backdrop)}')"` : ''}><div class="shade">
${posterImg(it) ? `<img class="poster-img" src="${h.esc(posterImg(it))}" alt="">` : ''}<div class="info">
${kicker}<h1>${h.esc(it.Name)}</h1>
<div class="facts">${facts.filter(Boolean).map(f => `<span>${h.esc(f)}</span>`).join('')}</div>
${buttons ? `<div class="bar">${buttons}</div>` : ''}${extra}
${it.Overview ? `<p class="overview">${h.esc(it.Overview)}</p>` : ''}</div></div></div>`;
  }

  async function series(s, id) {
    const [it, seasons, next] = await Promise.all([
      api(s, 'GET', `/Items/${id}`, { query: { userId: s.userId } }),
      api(s, 'GET', `/Shows/${id}/Seasons`, { query: { userId: s.userId, fields: 'ImageTags,UserData,ChildCount', enableImages: true } }),
      api(s, 'GET', '/Shows/NextUp', { query: { userId: s.userId, seriesId: id, limit: 1, fields: FIELDS, enableTotalRecordCount: false } }),
    ]);
    if (!it || it.Type !== 'Series') return null;
    const n = next.Items[0];
    const endYear = it.EndDate ? new Date(it.EndDate).getFullYear() : null;
    const years = it.ProductionYear ? `${it.ProductionYear}${endYear && endYear !== it.ProductionYear ? '–' + endYear : it.Status === 'Continuing' ? '–' : ''}` : '';
    const ud = it.UserData || {};
    const buttons = (n ? `<a class="btn on" href="${P}/item/${n.Id}">Next up: ${h.esc(epLabel(n))} · ${h.esc(n.Name)}</a>` : '') +
      `<a class="btn" href="${P}/item/${it.Id}/played?set=${ud.Played ? 0 : 1}">${ud.Played ? 'Mark unwatched' : 'Mark all watched'}</a>`;
    // Seasons inherit the series poster when they have none of their own.
    const seasonTiles = seasons.Items.map(se => posterTile({ ...se, SeriesId: it.Id, SeriesPrimaryImageTag: it.ImageTags && it.ImageTags.Primary }));
    return page(s, it.Name, 'shows', detailHeader(it, {
      facts: [years, it.OfficialRating, it.CommunityRating ? `★ ${it.CommunityRating.toFixed(1)}` : '', unplayed(it)], buttons, compact: true,
    }) + h.row('Seasons', seasonTiles));
  }

  async function season(s, id) {
    const se = await api(s, 'GET', `/Items/${id}`, { query: { userId: s.userId } });
    if (!se || se.Type !== 'Season') return null;
    const eps = await api(s, 'GET', `/Shows/${se.SeriesId}/Episodes`, { query: { userId: s.userId, seasonId: id, fields: FIELDS } });
    return page(s, `${se.SeriesName} · ${se.Name}`, 'shows',
      `<div class="crumb"><a class="btn" href="${P}/series/${se.SeriesId}">‹ ${h.esc(se.SeriesName)}</a></div><h1>${h.esc(se.Name)}</h1>` +
      h.grid(eps.Items.map(episodeTile)));
  }

  async function movies(s, q) {
    const sort = SORTS[q.sort] ? q.sort : 'added', pageNo = Math.max(1, +q.page || 1), so = SORTS[sort];
    const per = pageSize + 4; // posters are narrower: 7 per row
    const r = await api(s, 'GET', '/Items', { query: {
      userId: s.userId, includeItemTypes: 'Movie', recursive: true, sortBy: so.by, sortOrder: so.order, filters: so.filters,
      startIndex: (pageNo - 1) * per, limit: per, fields: 'ProductionYear,RunTimeTicks,ImageTags,UserData', imageTypeLimit: 1,
      enableImageTypes: 'Primary', enableTotalRecordCount: true,
    } });
    return page(s, 'Movies', 'movies', h.sortBar(`${P}/movies`, SORTS, sort) + h.grid(r.Items.map(posterTile)) +
      h.pager(`${P}/movies`, { sort }, pageNo, r.TotalRecordCount, per, 'movies'));
  }

  // Audio / subtitle choice, offered on the details page like jellyfin-web. "Default" sends no index, so
  // Jellyfin applies the user's language preferences; a specific choice is sent as AudioStreamIndex /
  // SubtitleStreamIndex (-1 = off), exactly as jellyfin-web does.
  const trackParam = v => /^-?\d+$/.test(v || '') ? v : '';
  function trackPicker(it, audio, sub) {
    const streams = (it.MediaSources && it.MediaSources[0] && it.MediaSources[0].MediaStreams) || [];
    const audios = streams.filter(m => m.Type === 'Audio'), subs = streams.filter(m => m.Type === 'Subtitle');
    if (audios.length < 2 && !subs.length) return '';
    const link = (a, su, label, on) =>
      `<a class="btn small${on ? ' on' : ''}" href="${P}/item/${it.Id}${h.qs({ audio: a, sub: su }) ? '?' + h.qs({ audio: a, sub: su }) : ''}">${h.esc(label)}</a>`;
    const rowHtml = (label, opts) => `<div class="tracks"><span class="tl">${label}</span>${opts.join('')}</div>`;
    let out = '';
    if (audios.length > 1) out += rowHtml('Audio', [link('', sub, 'Default', audio === '')]
      .concat(audios.map(m => link(String(m.Index), sub, m.DisplayTitle || m.Language || `Track ${m.Index}`, audio === String(m.Index)))));
    if (subs.length) out += rowHtml('Subtitles', [link(audio, '', 'Default', sub === ''), link(audio, '-1', 'Off', sub === '-1')]
      .concat(subs.map(m => link(audio, String(m.Index), m.DisplayTitle || m.Language || `Track ${m.Index}`, sub === String(m.Index)))));
    return out;
  }

  async function item(s, id, q = {}) {
    const it = await api(s, 'GET', `/Items/${id}`, { query: { userId: s.userId } });
    if (!it) return null;
    if (it.Type === 'Series' || it.Type === 'Season') return { redirect: itemHref(it) };
    const audio = trackParam(q.audio), sub = trackParam(q.sub), tracks = h.qs({ audio, sub });
    const ud = it.UserData || {}, pos = secs(ud.PlaybackPositionTicks), dur = secs(it.RunTimeTicks);
    const facts = [epLabel(it), it.ProductionYear, dur ? h.fmtDur(dur) : '', it.OfficialRating, it.CommunityRating ? `★ ${it.CommunityRating.toFixed(1)}` : '', ud.Played ? 'Watched' : ''];
    const playHref = start => `${P}/play/${it.Id}?${h.qs({ start: start || undefined, audio, sub })}`;
    const buttons = [
      pos > 0 ? `<a class="btn on" href="${playHref(Math.floor(pos))}">Resume from ${h.fmtDur(pos)}</a>` : '',
      `<a class="btn${pos > 0 ? '' : ' on'}" href="${playHref(0)}">${pos > 0 ? 'Play from start' : 'Play'}</a>`,
      `<a class="btn" href="${P}/item/${it.Id}/played?set=${ud.Played ? 0 : 1}${tracks ? '&' + tracks : ''}">${ud.Played ? 'Mark unwatched' : 'Mark watched'}</a>`,
      it.Type === 'Episode' && it.SeasonId ? `<a class="btn" href="${P}/season/${it.SeasonId}">${h.esc(it.SeasonName || 'Season')}</a>` : '',
    ].join('');
    const kicker = it.Type === 'Episode' ? `<div class="kicker"><a href="${P}/series/${it.SeriesId}">${h.esc(it.SeriesName)}</a></div>` : '';
    return page(s, itemTitle(it), it.Type === 'Movie' ? 'movies' : 'shows',
      detailHeader(it, { kicker, facts, buttons, extra: trackPicker(it, audio, sub) }));
  }

  async function setPlayed(s, id, played) {
    await api(s, played ? 'POST' : 'DELETE', `/UserPlayedItems/${id}`, { query: { userId: s.userId } });
  }

  // PlaybackInfo request, mirroring jellyfin-web (src/components/playback/playbackmanager.js getPlaybackInfo):
  // no forced audio/subtitle indexes (Jellyfin applies the user's preferences), the TV's own profile, and the
  // bitrate from jellyfin-web's bitrate test. `retry` = direct play failed on the TV, like jellyfin-web's retry.
  async function playbackInfo(s, id, startSecs, { retry = false, audio = '', sub = '' } = {}) {
    const body = {
      UserId: s.userId, StartTimeTicks: Math.floor(startSecs * TICKS), IsPlayback: true, AutoOpenLiveStream: true,
      MaxStreamingBitrate: s.bitrate, AlwaysBurnInSubtitleWhenTranscoding: false, DeviceProfile: s.profile,
    };
    if (audio !== '') body.AudioStreamIndex = +audio;
    if (sub !== '') body.SubtitleStreamIndex = +sub;
    if (retry) body.EnableDirectPlay = false;
    const r = await api(s, 'POST', `/Items/${id}/PlaybackInfo`, { query: { userId: s.userId }, body });
    if (r.ErrorCode) throw new Error(`Jellyfin can't play this: ${r.ErrorCode}`);
    return { source: r.MediaSources[0], playSessionId: r.PlaySessionId };
  }

  // Credentials never go to the TV: strip them from Jellyfin URLs; the proxy adds our auth header instead.
  const stripKeys = u => u.replace(/([?&])(api_key|ApiKey)=[^&#\s"]*&?/gi, '$1').replace(/[?&]$/, '');

  // The episode after this one, as jellyfin-web queues it when you play an episode.
  async function nextEpisode(s, it) {
    if (it.Type !== 'Episode' || !it.SeriesId) return null;
    const r = await api(s, 'GET', `/Shows/${it.SeriesId}/Episodes`, { query: { userId: s.userId, startItemId: it.Id, limit: 2, fields: 'ParentIndexNumber,IndexNumber' } }).catch(() => null);
    const n = r && r.Items && r.Items.find(e => e.Id !== it.Id);
    return n ? { url: `${P}/play/${n.Id}`, title: `${epLabel(n)} · ${n.Name}` } : null;
  }

  async function play(s, id, startSecs, retry, audio = '', sub = '') {
    const it = await api(s, 'GET', `/Items/${id}`, { query: { userId: s.userId } });
    if (!it) return null;
    const [{ source, playSessionId }, next] = await Promise.all([playbackInfo(s, id, startSecs, { retry, audio, sub }), nextEpisode(s, it)]);
    // The play id authorises its media URLs on its own (see /hls, /stream, /sub), so make it unguessable.
    const pid = crypto.randomBytes(16).toString('hex');
    // Active tracks: what was asked for (like jellyfin-web's playOptions), else the server's default choice.
    const pick = (asked, dflt) => asked !== '' ? +asked : (typeof dflt === 'number' ? dflt : undefined);
    const p = { sid: s.sid, itemId: id, mediaSourceId: source.Id, playSessionId, t: Date.now(), started: false,
      liveStreamId: source.LiveStreamId || undefined,
      audioIndex: pick(audio, source.DefaultAudioStreamIndex), subtitleIndex: pick(sub, source.DefaultSubtitleStreamIndex), subs: [] };
    const page = { direct: '', hls: '', transcode: '' };

    // Same choice and URLs as jellyfin-web's createStreamInfo().
    if (source.SupportsDirectPlay) {
      p.method = 'DirectPlay';
      p.directPath = `/Videos/${id}/stream.${source.Container}?` + h.qs({ Static: 'true', mediaSourceId: source.Id,
        deviceId: `lite-tv-${s.sid}`, Tag: source.ETag, LiveStreamId: source.LiveStreamId });
      page.direct = `${P}/stream/${pid}/direct`;
    } else if (source.TranscodingUrl) {
      p.method = source.SupportsDirectStream ? 'DirectStream' : 'Transcode';
      const u = new URL(stripKeys(source.TranscodingUrl), base);
      if (source.TranscodingSubProtocol === 'hls' || /\.m3u8$/i.test(u.pathname)) {
        // HLS: proxy the folder the playlist lives in, so relative playlist/segment URLs keep working.
        p.hlsBase = u.pathname.slice(0, u.pathname.lastIndexOf('/'));
        page.hls = `${P}/hls/${pid}/${u.pathname.slice(p.hlsBase.length + 1)}${u.search}`;
      } else {
        p.transcodePath = u.pathname + u.search; // progressive transcode (not used by current jellyfin-web profiles)
        page.transcode = `${P}/stream/${pid}/transcode?start={start}`;
      }
    } else {
      throw new Error('Jellyfin returned no way to play this on this TV.');
    }

    // Subtitles Jellyfin delivers as separate files (text subs) become <track>s; burned-in ("Encode") and
    // in-playlist ("Hls") subtitles are already part of the video stream.
    for (const m of source.MediaStreams || []) {
      if (m.Type === 'Subtitle' && m.DeliveryMethod === 'External' && m.DeliveryUrl && m.Index === p.subtitleIndex) {
        p.subs.push(stripKeys(m.DeliveryUrl));
        page.subtitles = [{ src: `${P}/sub/${pid}/0`, lang: m.Language || '', label: m.DisplayTitle || 'Subtitles' }];
      }
    }

    plays.set(pid, p);
    for (const [k, v] of plays) if (Date.now() - v.t > 12 * 3600e3) plays.delete(k);
    const vid = (source.MediaStreams || []).find(m => m.Type === 'Video') || {};
    const how = { DirectPlay: 'Direct play', DirectStream: 'Direct stream', Transcode: 'Transcoding' }[p.method];
    return h.playerPage({
      title: itemTitle(it),
      meta: [it.Type === 'Episode' ? it.Name : it.ProductionYear, vid.Height ? `${vid.Height}p ${vid.Codec || ''}`.trim() : '', how].filter(Boolean).join(' · '),
      ...page,
      // If the TV can't direct-play after all, jellyfin-web retries without direct play; so do we.
      fallback: source.SupportsDirectPlay ? `${P}/play/${id}?start={start}&retry=1${h.qs({ audio, sub }) ? '&' + h.qs({ audio, sub }) : ''}` : '',
      duration: secs(it.RunTimeTicks), start: startSecs, report: `${P}/report/${pid}`,
      next: next ? next.url : '', nextTitle: next ? next.title : '',
    });
  }

  // Media URLs are authorised by the unguessable play id alone, not the cookie: TV media players (e.g. LG
  // webOS) fetch <video> sources outside the browser and don't send its cookies.
  function playFor(pid) {
    const p = plays.get(pid);
    const stored = p && sessions.get(p.sid);
    return p && stored ? { p, s: { sid: p.sid, ...stored } } : null;
  }

  function stream(req, res, pid, kind, startSecs) {
    const ps = playFor(pid);
    const target = ps && (kind === 'direct' ? ps.p.directPath : ps.p.transcodePath);
    if (!target) { res.writeHead(404); return res.end(); }
    const u = new URL(target.replace(/^\//, ''), base);
    if (kind === 'transcode') u.searchParams.set('StartTimeTicks', String(Math.floor((startSecs || 0) * TICKS)));
    proxyMedia(req, res, u, { headers: { Authorization: authHeader(ps.s.sid, ps.s.device, ps.s.token) } });
  }

  // HLS: playlists are fetched and stripped of credentials; segments are streamed straight through.
  function hls(req, res, pid, rest, search) {
    const ps = playFor(pid);
    if (!ps || !ps.p.hlsBase || rest.includes('..')) { res.writeHead(404); return res.end(); }
    const u = new URL(`${ps.p.hlsBase}/${rest}${search}`.replace(/^\//, ''), base);
    const headers = { Authorization: authHeader(ps.s.sid, ps.s.device, ps.s.token) };
    if (!/\.m3u8$/i.test(rest)) return proxyMedia(req, res, u, { headers });
    const up = (u.protocol === 'https:' ? https : http).request(u, { headers }, r => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => {
        res.writeHead(r.statusCode, { 'Content-Type': r.headers['content-type'] || 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
        res.end(stripKeys(Buffer.concat(chunks).toString('utf8')));
      });
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    up.end();
  }

  function subtitle(req, res, pid, n) {
    const ps = playFor(pid);
    const target = ps && ps.p.subs[n];
    if (!target) { res.writeHead(404); return res.end(); }
    proxyMedia(req, res, new URL(target.replace(/^\//, ''), base), { headers: { Authorization: authHeader(ps.s.sid, ps.s.device, ps.s.token) } });
  }

  // Also authorised by the play id alone, like media URLs, so reporting can't break if a TV drops cookies.
  async function report(pid, { event, pos, paused }) {
    const ps = playFor(pid);
    if (!ps) return;
    const { p, s } = ps;
    const body = {
      ItemId: p.itemId, MediaSourceId: p.mediaSourceId, PlaySessionId: p.playSessionId, PlayMethod: p.method,
      LiveStreamId: p.liveStreamId, AudioStreamIndex: p.audioIndex, SubtitleStreamIndex: p.subtitleIndex,
      PositionTicks: Math.max(0, Math.floor((+pos || 0) * TICKS)), IsPaused: !!paused, CanSeek: true,
    };
    if (event === 'start' && !p.started) { p.started = true; await api(s, 'POST', '/Sessions/Playing', { body }); }
    else if (event === 'progress') await api(s, 'POST', '/Sessions/Playing/Progress', { body: { ...body, EventName: paused ? 'Pause' : 'TimeUpdate' } });
    else if (event === 'stopped') { await api(s, 'POST', '/Sessions/Playing/Stopped', { body }); plays.delete(pid); }
  }

  // ---------- login ----------
  function loginPage({ code, secret, error }) {
    const qc = code
      ? `<div class="login-code">${h.esc(code)}</div><p>On a phone or computer already signed in to Jellyfin, open your user menu → <b>Quick Connect</b> and enter this code.</p><p class="dim">This page signs you in as soon as the code is approved.</p>`
      : `<p>${error ? '' : 'Quick Connect is not available.'}</p>`;
    const checkUrl = secret ? `${P}/login/check?s=${encodeURIComponent(secret)}` : '';
    return h.layout({
      title: 'Sign in', nav: [],
      body: `<div class="login"><h1>Sign in to Jellyfin</h1>${error ? `<p class="err">${h.esc(error)}</p>` : ''}${qc}
<h2>Or use your password</h2><form method="post" action="${P}/login/password">
<input name="u" placeholder="Username" autocomplete="username"><input name="p" type="password" placeholder="Password" autocomplete="current-password">
<button class="btn on" type="submit">Sign in</button></form></div>` +
      // Quick Connect is checked in the background, so typing a username/password is never interrupted.
      // Without JavaScript, fall back to reloading the page.
      (secret ? `<noscript><meta http-equiv="refresh" content="3;url=${h.esc(`${P}/login?s=${encodeURIComponent(secret)}`)}"></noscript>
<script>(function(){var u=${JSON.stringify(checkUrl).replace(/</g, '\\u003c')};function c(){var x=new XMLHttpRequest();x.open('GET',u+'&t='+new Date().getTime(),true);
x.onload=function(){var r={};try{r=JSON.parse(x.responseText)}catch(e){}if(r.go){location.replace(r.go)}else{setTimeout(c,3000)}};
x.onerror=function(){setTimeout(c,5000)};x.send(null)}setTimeout(c,3000)})();</script>` : ''),
    });
  }

  // Quick Connect status. Approved → sign in (sets the cookie) and tell the page where to go;
  // expired → send the page to a fresh code; otherwise keep waiting.
  async function quickConnectStatus(req, res, secret) {
    const pend = pendingLogins.get(secret);
    if (!pend) return { go: `${P}/login` };
    const anon = { sid: pend.sid, device: deviceName(req) };
    const st = await api(anon, 'GET', '/QuickConnect/Connect', { query: { secret } }).catch(() => null);
    if (!st) { pendingLogins.delete(secret); return { go: `${P}/login` }; }
    if (!st.Authenticated) return { code: st.Code };
    const auth = await api(anon, 'POST', '/Users/AuthenticateWithQuickConnect', { body: { Secret: secret } });
    pendingLogins.delete(secret);
    startSession(res, pend.sid, anon.device, auth);
    return { go: `${P}/` };
  }

  async function login(req, res, q) {
    if (q.s) {
      const r = await quickConnectStatus(req, res, q.s);
      return r.go ? redirect(res, r.go) : loginPage({ code: r.code, secret: q.s });
    }
    const device = deviceName(req);
    const sid = crypto.randomBytes(12).toString('hex');
    const anon = { sid, device };
    const enabled = await api(anon, 'GET', '/QuickConnect/Enabled').catch(() => false);
    if (!enabled) return loginPage({});
    const init = await api(anon, 'POST', '/QuickConnect/Initiate');
    pendingLogins.set(init.Secret, { sid, t: Date.now() });
    for (const [k, v] of pendingLogins) if (Date.now() - v.t > 15 * 60e3) pendingLogins.delete(k);
    return redirect(res, `${P}/login?s=${encodeURIComponent(init.Secret)}`);
  }

  async function passwordLogin(req, res) {
    const f = await readForm(req);
    const sid = crypto.randomBytes(12).toString('hex'), device = deviceName(req);
    try {
      const auth = await api({ sid, device }, 'POST', '/Users/AuthenticateByName', { body: { Username: f.u || '', Pw: f.p || '' } });
      startSession(res, sid, device, auth);
      return redirect(res, `${P}/`);
    } catch (e) {
      return loginPage({ error: e instanceof AuthError ? 'Wrong username or password.' : e.message });
    }
  }

  async function logout(req, res, s) {
    await api(s, 'POST', '/Sessions/Logout').catch(() => {});
    sessions.delete(s.sid);
    setCookie(res, COOKIE, '', 0);
    return redirect(res, `${P}/login`);
  }

  // ---------- setup: build the device profile and measure bitrate on the TV ----------
  // mode 'full' = profile + bitrate test (first sign-in, new browser/TV info, or a new builder version);
  // mode 'bitrate' = bitrate test only (the stored result is over an hour old, as jellyfin-web re-tests).
  function setupPage(req, mode, next) {
    let di = null;
    try { di = JSON.parse(cookies(req).ltv_di || 'null'); } catch { /* ignore */ }
    const cfgJson = JSON.stringify({ mode, next, di, inNetwork: inNetwork(req), post: `${P}/setup`, test: `${P}/bitratetest` }).replace(/</g, '\\u003c');
    return h.layout({
      title: 'Getting ready', nav: [],
      body: `<div class="login"><h1 id="st">Getting ready…</h1><p class="dim" id="sd">Checking what this TV can play.</p></div>
${mode === 'full' ? '<script src="/static/jf-profile.js?v=' + PROFILE_JS_VERSION + '"></script>' : ''}
<script>window.LTV_SETUP=${cfgJson};</script><script src="/static/setup.js?v=${SETUP_JS_VERSION}"></script>`,
    });
  }

  async function saveSetup(req, res, s) {
    const b = await readJson(req, 512 * 1024);
    const update = { ...sessions.get(s.sid) };
    if (b.profile) {
      if (typeof b.profile !== 'object' || !Array.isArray(b.profile.DirectPlayProfiles)) { res.writeHead(400); return res.end(); }
      update.profile = b.profile;
      update.profileKey = profileKey(req);
    }
    const bitrate = Math.floor(+b.bitrate);
    if (bitrate > 0) { update.bitrate = Math.min(bitrate, 2147483647); update.bitrateAt = Date.now(); }
    sessions.set(s.sid, update);
    res.writeHead(204); res.end();
  }

  // ---------- routes ----------
  // Routes that need a signed-in user go through `auth`: no session → login page; expired token → login page.
  // Unless `setup: false`, the TV must also have built its device profile (→ setup page first).
  const auth = (fn, { setup = true } = {}) => async (ctx, m) => {
    const s = session(ctx.req);
    if (!s) return redirect(ctx.res, `${P}/login`);
    if (setup && (!s.profile || s.profileKey !== profileKey(ctx.req) || !s.bitrate)) {
      return redirect(ctx.res, `${P}/setup?next=${encodeURIComponent(ctx.req.url)}`);
    }
    try { return await fn(ctx, m, s); }
    catch (e) {
      if (!(e instanceof AuthError)) throw e;
      sessions.delete(s.sid);
      return redirect(ctx.res, `${P}/login`);
    }
  };

  const routes = [
    [/^\/jellyfin\/login$/, ({ req, res, q }) => login(req, res, q)],
    [/^\/jellyfin\/login\/check$/, async ({ req, res, q }) => {
      const r = q.s ? await quickConnectStatus(req, res, q.s) : { go: `${P}/login` };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ go: r.go || '' }));
    }],
    [/^\/jellyfin\/login\/password$/, ({ req, res }) => req.method === 'POST' ? passwordLogin(req, res) : redirect(res, `${P}/login`)],
    [/^\/jellyfin\/logout$/, auth(({ req, res }, m, s) => logout(req, res, s), { setup: false })],
    [/^\/jellyfin\/setup$/, auth(({ req, res, q }, m, s) => {
      if (req.method === 'POST') return saveSetup(req, res, s);
      const next = /^\/jellyfin\//.test(q.next || '') ? q.next : `${P}/`;
      const full = !s.profile || s.profileKey !== profileKey(req);
      return setupPage(req, full ? 'full' : 'bitrate', next);
    }, { setup: false })],
    // jellyfin-web's bitrate test endpoint, proxied so the TV measures its real path to the media.
    [/^\/jellyfin\/bitratetest$/, auth(({ req, res, q }, m, s) => {
      const u = new URL('Playback/BitrateTest', base);
      u.searchParams.set('Size', String(Math.min(10000000, Math.max(1, Math.floor(+q.size || 500000)))));
      proxyMedia(req, res, u, { headers: { Authorization: authHeader(s.sid, s.device, s.token) } });
    }, { setup: false })],
    [/^\/jellyfin\/?$/, auth((ctx, m, s) => home(s))],
    [/^\/jellyfin\/movies$/, auth(({ q }, m, s) => movies(s, q))],
    [/^\/jellyfin\/shows$/, auth(({ q }, m, s) => shows(s, q))],
    [/^\/jellyfin\/series\/([0-9a-f]{32})$/, auth((ctx, m, s) => series(s, m[1]))],
    [/^\/jellyfin\/season\/([0-9a-f]{32})$/, auth((ctx, m, s) => season(s, m[1]))],
    [/^\/jellyfin\/item\/([0-9a-f]{32})$/, auth(async ({ res, q }, m, s) => {
      const r = await item(s, m[1], q);
      return r && r.redirect ? redirect(res, r.redirect) : r;
    })],
    [/^\/jellyfin\/item\/([0-9a-f]{32})\/played$/, auth(async ({ req, res, q }, m, s) => {
      await setPlayed(s, m[1], q.set === '1');
      // Back to where the button was (series pages mark the whole series).
      const ref = (req.headers.referer || '').replace(/^https?:\/\/[^/]+/, '');
      redirect(res, /^\/jellyfin\/(item|series)\//.test(ref) ? ref : `${P}/item/${m[1]}`);
    })],
    [/^\/jellyfin\/play\/([0-9a-f]{32})$/, auth(({ req, res, q }, m, s) => {
      // jellyfin-web re-runs its bitrate test when the last result is over an hour old.
      if (Date.now() - (s.bitrateAt || 0) > BITRATE_MAX_AGE) return redirect(res, `${P}/setup?next=${encodeURIComponent(req.url)}`);
      return play(s, m[1], Math.max(0, Math.floor(+q.start || 0)), q.retry === '1', trackParam(q.audio), trackParam(q.sub));
    })],
    [/^\/jellyfin\/stream\/([0-9a-f]{32})\/(direct|transcode)$/, ({ req, res, q }, m) => stream(req, res, m[1], m[2], Math.max(0, +q.start || 0))],
    [/^\/jellyfin\/hls\/([0-9a-f]{32})\/(.+)$/, ({ req, res }, m) => hls(req, res, m[1], m[2], new URL(req.url, 'http://x').search)],
    [/^\/jellyfin\/sub\/([0-9a-f]{32})\/(\d+)$/, ({ req, res }, m) => subtitle(req, res, m[1], +m[2])],
    [/^\/jellyfin\/report\/([0-9a-f]{32})$/, async ({ req, res }, m) => {
      const body = await readJson(req);
      await report(m[1], body).catch(e => console.warn('jellyfin report failed:', e.message));
      res.writeHead(204); res.end();
    }],
    // Artwork is public in Jellyfin; resized server-side so the TV only decodes small images.
    [/^\/jellyfin\/img\/([0-9a-f]{32})\/(Primary|Backdrop|Thumb)$/, ({ req, res, q }, m) => {
      const u = new URL(`Items/${m[1]}/Images/${m[2]}`, base);
      u.searchParams.set('maxWidth', String(Math.min(1920, +q.w || 400)));
      u.searchParams.set('quality', '80');
      if (q.tag) u.searchParams.set('tag', q.tag);
      proxyMedia(req, res, u, { cacheSecs: 7 * 86400 });
    }],
  ];

  return { id: 'jellyfin', label: 'Jellyfin', home: `${P}/`, routes };
};
