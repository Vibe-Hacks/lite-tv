// A pretend Jellyfin server with an invented library and generated artwork, for trying lite-tv, working on it
// without a real server, and taking the README screenshots. No dependencies. Not a real Jellyfin: just the
// API calls lite-tv makes.
//
//   node tools/demo-jellyfin.js            (listens on :8097)
//   JELLYFIN_URL=http://localhost:8097 node server.js
//
// Sign in with any username and password. Playback isn't simulated (there's no video).
'use strict';
const http = require('http'), crypto = require('crypto');
const PORT = +(process.env.DEMO_PORT || 8097);
const TICKS = 10000000;

// ---------- invented library ----------
const hash = s => crypto.createHash('md5').update(s).digest('hex');
const MOVIES = [
  ['The Quiet Orbit', 2024, 118, 'PG-13', 7.8, 'A lone engineer keeps a failing relay station alive while the colony below forgets it exists.'],
  ['Paper Lanterns', 2023, 102, 'PG', 7.2, 'Three sisters reopen their late grandmother\'s lantern workshop for one last festival.'],
  ['Saltwater Kings', 2022, 131, '15', 6.9, 'Rival fishing families on a storm-battered coast discover a wreck that could save or sink them both.'],
  ['Glasshouse', 2025, 97, '12A', 7.4, 'A botanist locked in a research greenhouse starts to suspect the plants are rearranging themselves.'],
  ['Ember Season', 2021, 124, 'PG-13', 6.6, 'A smoke-jumper crew spends one long summer in the mountains, and not everyone comes home.'],
  ['The Cartographer\'s Daughter', 2024, 141, 'PG', 8.1, 'Armed with her father\'s unfinished maps, a young surveyor sets out to chart a valley no one returns from.'],
  ['Low Tide at Marrow Bay', 2020, 109, '15', 7.0, 'A detective returns to her seaside hometown to find the case that drove her away has resurfaced.'],
  ['Copper Fox', 2023, 88, 'U', 7.6, 'An inventive fox builds a clockwork flying machine to win back the forest\'s stolen lights.'],
  ['Atlas of Small Things', 2025, 115, '12A', 7.9, 'A retired watchmaker and a restless teenager catalogue every lost object in their small town.'],
  ['Neon Orchard', 2022, 106, '15', 6.4, 'In a city where fruit glows after dark, a courier stumbles onto the orchard\'s secret.'],
  ['The Last Lighthouse Keeper', 2019, 119, 'PG', 7.3, 'When the lighthouse is automated, its keeper refuses to leave, and the sea seems to agree.'],
  ['Winter Static', 2024, 101, '15', 6.8, 'A late-night radio host starts receiving calls from listeners who claim it is a different year.'],
  ['Kites Over Calder', 2021, 94, 'U', 7.1, 'A kite-flying contest turns a sleepy hill town into a battlefield of string and paper.'],
  ['Meridian', 2025, 128, '12A', 7.5, 'Navigators on an airship race the sunset around the world to deliver a single letter.'],
];
const SHOWS = [
  ['Harbour Lights', 2021, 'Continuing', 8.2, 'Life, love and lifeboat call-outs in a small harbour town.', [8, 8, 6]],
  ['The Night Shift Botanists', 2022, 'Ended', 7.7, 'Gardeners at a vast glasshouse keep the rarest plants alive through the night.', [6, 6]],
  ['Static & Snow', 2023, 'Continuing', 7.9, 'A remote mountain radio station and the strangers who drift through it.', [8]],
  ['Kestrel Valley', 2019, 'Ended', 8.4, 'Four generations of a farming family fight to keep their land.', [10, 10, 8]],
  ['Orbit Station Nine', 2024, 'Continuing', 7.4, 'The crew of a crumbling space station juggle repairs, rivalries and a mystery signal.', [8, 8]],
  ['Small Town Signals', 2020, 'Ended', 7.2, 'A local newspaper with three staff and far too many stories.', [6]],
  ['The Long Way Round', 2025, 'Continuing', 8.0, 'Two estranged brothers drive an old bus across the continent.', [7]],
  ['Copperline', 2022, 'Continuing', 7.6, 'Miners in a frontier town strike copper and trouble in equal measure.', [8, 8]],
];
const EP_WORDS = ['Tides', 'Lanterns', 'The Crossing', 'Old Friends', 'Static', 'First Light', 'The Storm', 'Homecoming', 'Signals',
  'The Long Night', 'Driftwood', 'Open Water', 'The Bargain', 'Thaw', 'Low Ceiling', 'Paper Boats', 'Embers', 'The Map Room'];

const items = new Map(); // id -> item
const userData = new Map(); // id -> { Played, PlaybackPositionTicks }
const day = 864e5, now = Date.now();
const mk = (key, obj) => { const it = { Id: hash(key), ...obj }; items.set(it.Id, it); return it; };
const audioStreams = [
  { Type: 'Audio', Index: 1, Language: 'eng', DisplayTitle: 'English - AAC - Stereo - Default' },
  { Type: 'Audio', Index: 2, Language: 'fra', DisplayTitle: 'French - AAC - Stereo' },
  { Type: 'Subtitle', Index: 3, Language: 'eng', DisplayTitle: 'English - SUBRIP' },
];

MOVIES.forEach(([name, year, mins, rating, score, overview], i) => mk('movie:' + name, {
  Name: name, Type: 'Movie', ProductionYear: year, RunTimeTicks: mins * 60 * TICKS, OfficialRating: rating,
  CommunityRating: score, Overview: overview, DateCreated: new Date(now - i * 3 * day).toISOString(),
  ImageTags: { Primary: 'p', Thumb: 't' }, BackdropImageTags: ['b'],
  MediaSources: [{ Id: hash('ms:' + name), Container: 'mp4', MediaStreams: [{ Type: 'Video', Codec: 'h264', Height: 1080, Index: 0 }, ...audioStreams] }],
}));
SHOWS.forEach(([name, year, status, score, overview, seasons], si) => {
  const show = mk('show:' + name, {
    Name: name, Type: 'Series', ProductionYear: year, Status: status, CommunityRating: score, Overview: overview,
    OfficialRating: '12', EndDate: status === 'Ended' ? `${year + seasons.length - 1}-12-01` : undefined,
    DateCreated: new Date(now - si * 5 * day).toISOString(), DateLastContentAdded: new Date(now - si * 2 * day).toISOString(),
    ImageTags: { Primary: 'p', Thumb: 't' }, BackdropImageTags: ['b'],
  });
  show.seasons = seasons.map((count, s) => {
    const season = mk(`season:${name}:${s + 1}`, {
      Name: `Season ${s + 1}`, Type: 'Season', IndexNumber: s + 1, SeriesId: show.Id, SeriesName: name, ChildCount: count,
      ImageTags: {}, ProductionYear: year + s,
    });
    season.episodes = Array.from({ length: count }, (_, e) => mk(`ep:${name}:${s + 1}:${e + 1}`, {
      Name: EP_WORDS[(si * 7 + s * 5 + e) % EP_WORDS.length], Type: 'Episode', IndexNumber: e + 1, ParentIndexNumber: s + 1,
      SeriesId: show.Id, SeriesName: name, SeasonId: season.Id, SeasonName: season.Name, SeriesPrimaryImageTag: 'p',
      ProductionYear: year + s, RunTimeTicks: (42 + (e * 7) % 15) * 60 * TICKS, CommunityRating: 7 + ((e * 3) % 20) / 10,
      Overview: `Episode ${e + 1} of ${name}: ${overview.toLowerCase().replace(/\.$/, '')}, as things get more complicated.`,
      DateCreated: new Date(now - (si * 5 + (count - e)) * day).toISOString(),
      ImageTags: { Primary: 'p' }, ParentBackdropItemId: show.Id, ParentBackdropImageTags: ['b'],
      MediaSources: [{ Id: hash(`ms:${name}:${s}:${e}`), Container: 'mp4', MediaStreams: [{ Type: 'Video', Codec: 'h264', Height: 1080, Index: 0 }, ...audioStreams] }],
    }));
    return season;
  });
  show.episodes = show.seasons.flatMap(se => se.episodes);
});
// Some watch history, so Continue watching, Next up and the watched marks have something to show.
const movie = n => [...items.values()].find(i => i.Type === 'Movie' && i.Name === n);
const show = n => [...items.values()].find(i => i.Type === 'Series' && i.Name === n);
userData.set(movie('Meridian').Id, { PlaybackPositionTicks: 51 * 60 * TICKS, LastPlayed: now - 1e5 });
userData.set(movie('Glasshouse').Id, { PlaybackPositionTicks: 22 * 60 * TICKS, LastPlayed: now - 3e5 });
for (const [n, upTo] of [['Harbour Lights', 11], ['Kestrel Valley', 25], ['Orbit Station Nine', 4], ['Static & Snow', 2]]) {
  const eps = show(n).episodes;
  eps.slice(0, upTo).forEach((e, i) => userData.set(e.Id, { Played: true, LastPlayed: now - (upTo - i) * day }));
}
userData.set(show('Orbit Station Nine').episodes[4].Id, { PlaybackPositionTicks: 18 * 60 * TICKS, LastPlayed: now - 2e5 });
['Saltwater Kings', 'The Last Lighthouse Keeper', 'Copper Fox'].forEach(n => userData.set(movie(n).Id, { Played: true }));
userData.set(show('Small Town Signals').Id, { Played: true });
show('Small Town Signals').episodes.forEach(e => userData.set(e.Id, { Played: true }));

// ---------- views of items, with user data like Jellyfin's ----------
function view(it) {
  const ud = userData.get(it.Id) || {}, out = { ...it };
  delete out.seasons; delete out.episodes;
  const d = { Played: !!ud.Played, PlaybackPositionTicks: ud.PlaybackPositionTicks || 0 };
  if (it.RunTimeTicks && ud.PlaybackPositionTicks) d.PlayedPercentage = ud.PlaybackPositionTicks / it.RunTimeTicks * 100;
  const eps = it.Type === 'Series' ? it.episodes : it.Type === 'Season' ? it.episodes : null;
  if (eps) { d.UnplayedItemCount = eps.filter(e => !(userData.get(e.Id) || {}).Played).length; d.Played = d.UnplayedItemCount === 0; }
  out.UserData = d;
  return out;
}
const all = type => [...items.values()].filter(i => i.Type === type);
const played = it => view(it).UserData.Played;
function nextUp(seriesId) {
  const out = [];
  for (const s of all('Series')) {
    if (seriesId && s.Id !== seriesId) continue;
    const eps = s.episodes, last = eps.map(e => !!(userData.get(e.Id) || {}).Played).lastIndexOf(true);
    if (last >= 0 && last < eps.length - 1 && !(userData.get(eps[last + 1].Id) || {}).PlaybackPositionTicks) {
      out.push({ ep: eps[last + 1], t: (userData.get(eps[last].Id) || {}).LastPlayed || 0 });
    }
  }
  return out.sort((a, b) => b.t - a.t).map(x => view(x.ep));
}

// ---------- generated artwork (SVG) ----------
const PALETTES = [['#0f2027', '#2c5364', '#f7b267'], ['#1a1033', '#5b3a8c', '#f4d35e'], ['#102a43', '#3e6c8c', '#ffd6a5'],
  ['#2b1d1d', '#8c3b2c', '#ffcf99'], ['#0b2e2a', '#2d7d6e', '#f1e3c8'], ['#1d1b2f', '#c0577a', '#ffe0b5'], ['#14213d', '#4f6d7a', '#fca311'],
  ['#2d1e2f', '#6b4e71', '#f2c14e']];
const xml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function art(it, type) {
  const h = parseInt(hash(it.Id + type).slice(0, 8), 16), p = PALETTES[parseInt(it.Id.slice(0, 2), 16) % PALETTES.length];
  const poster = type === 'Primary' && it.Type !== 'Episode';
  const W = poster ? 600 : 960, H = poster ? 900 : 540, motif = parseInt(it.Id.slice(2, 4), 16) % 4;
  const sun = { x: W * (0.25 + (h % 50) / 100), y: H * (poster ? 0.32 : 0.36), r: (poster ? W : H) * 0.16 };
  let shapes = '';
  if (motif === 0) { // mountains
    for (let l = 0; l < 3; l++) { const base = H * (0.55 + l * 0.12); let d = `M0 ${H} L0 ${base}`;
      for (let x = 0; x <= W; x += W / 6) d += ` L${x} ${base - ((h >>> (l * 3 + x % 7)) % 5) * H * 0.04 - (x / W * 37 % 9) * H * 0.006}`;
      shapes += `<path d="${d} L${W} ${H} Z" fill="${p[0]}" opacity="${0.55 + l * 0.2}"/>`; }
  } else if (motif === 1) { // waves
    for (let l = 0; l < 4; l++) { const y = H * (0.6 + l * 0.09); let d = `M0 ${y}`;
      for (let x = 0; x <= W; x += W / 8) d += ` Q${x + W / 16} ${y - H * 0.03 * ((l + x / (W / 8)) % 2 ? 1 : -1)} ${x + W / 8} ${y}`;
      shapes += `<path d="${d} L${W} ${H} L0 ${H} Z" fill="${p[0]}" opacity="${0.4 + l * 0.18}"/>`; }
  } else if (motif === 2) { // planet and rings
    shapes = `<ellipse cx="${sun.x}" cy="${sun.y}" rx="${sun.r * 2.2}" ry="${sun.r * 0.45}" fill="none" stroke="${p[2]}" stroke-width="${sun.r * 0.08}" opacity=".7"/>` +
      Array.from({ length: 40 }, (_, i) => `<circle cx="${(h * (i + 3) * 7919) % W}" cy="${(h * (i + 5) * 104729) % (H * 0.8)}" r="${1 + i % 3}" fill="#fff" opacity=".6"/>`).join('') +
      `<rect y="${H * 0.78}" width="${W}" height="${H * 0.22}" fill="${p[0]}"/>`;
  } else { // city skyline
    let x = 0; while (x < W) { const bw = Math.max(W * 0.04, W * (0.05 + ((h >>> (Math.floor(x) % 13)) % 5) * 0.02)), bh = H * (0.15 + ((h >>> (x % 11)) % 7) * 0.05);
      shapes += `<rect x="${x}" y="${H - bh}" width="${bw - 3}" height="${bh}" fill="${p[0]}" opacity=".9"/>`; x += bw; }
  }
  const title = poster || type === 'Thumb' ? (it.Type === 'Season' ? it.SeriesName : it.Name) : '';
  const words = title.toUpperCase().split(' '), lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > (poster ? 14 : 26)) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; }
  if (cur.trim()) lines.push(cur.trim());
  // Serif capitals with letter spacing are about 0.8 em wide: fit the longest line in 88% of the width.
  const longest = Math.max(1, ...lines.map(l => l.length));
  const fs = Math.min(poster ? 64 : 52, W * 0.88 / (longest * 0.8));
  const ty = poster ? H * 0.86 - (lines.length - 1) * fs * 1.1 : H * 0.84 - (lines.length - 1) * fs * 1.1;
  const text = lines.map((l, i) => `<text x="${W / 2}" y="${ty + i * fs * 1.1}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${fs}" letter-spacing="${fs * 0.08}" fill="#fff" opacity=".95">${xml(l)}</text>`).join('');
  const sub = poster && it.Type === 'Season' ? `<text x="${W / 2}" y="${H * 0.95}" text-anchor="middle" font-family="Georgia, serif" font-size="30" fill="${p[2]}">${xml(it.Name.toUpperCase())}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p[1]}"/><stop offset="1" stop-color="${p[0]}"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="${sun.x}" cy="${sun.y}" r="${sun.r}" fill="${p[2]}" opacity=".85"/>${shapes}
${title ? `<rect y="${ty - fs * 1.6}" width="${W}" height="${H - ty + fs * 1.6}" fill="#000" opacity=".25"/>` : ''}${text}${sub}</svg>`;
}

// ---------- API ----------
const json = (res, v, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
function list(q) {
  let out = [...items.values()].filter(i => !q.includeItemTypes || q.includeItemTypes.split(',').includes(i.Type));
  if (q.filters === 'IsUnplayed') out = out.filter(i => !played(i));
  const key = (q.sortBy || 'SortName').split(',')[0], dir = q.sortOrder === 'Descending' ? -1 : 1;
  const val = i => key === 'DateCreated' ? i.DateCreated : key === 'DateLastContentAdded' ? i.DateLastContentAdded || i.DateCreated
    : key === 'ProductionYear' ? i.ProductionYear : key === 'CommunityRating' ? i.CommunityRating : i.Name.replace(/^The /, '');
  if (key === 'Random') out.sort(() => Math.random() - 0.5); else out.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
  const start = +q.startIndex || 0, limit = +q.limit || out.length;
  return { Items: out.slice(start, start + limit).map(view), TotalRecordCount: out.length };
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname, q = Object.fromEntries(u.searchParams);
  let m;
  req.resume();
  if (p === '/QuickConnect/Enabled') return json(res, true);
  if (p === '/QuickConnect/Initiate') return json(res, { Secret: crypto.randomBytes(16).toString('hex'), Code: '428913' });
  if (p === '/QuickConnect/Connect') return json(res, { Authenticated: false, Code: '428913' });
  if (p === '/Users/AuthenticateByName') return json(res, { User: { Id: hash('demo-user'), Name: 'Demo' }, AccessToken: hash('demo-token') });
  if (p === '/Playback/BitrateTest') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(Buffer.alloc(Math.min(+q.Size || 500000, 1e7))); }
  if (p === '/UserItems/Resume') return json(res, { Items: [...items.values()].filter(i => (userData.get(i.Id) || {}).PlaybackPositionTicks)
    .sort((a, b) => userData.get(b.Id).LastPlayed - userData.get(a.Id).LastPlayed).map(view) });
  if (p === '/Shows/NextUp') return json(res, { Items: nextUp(q.seriesId).slice(0, +q.limit || 20) });
  if (p === '/Items/Latest') {
    if (q.includeItemTypes === 'Episode') return json(res, all('Series').sort((a, b) => b.DateLastContentAdded.localeCompare(a.DateLastContentAdded)).slice(0, +q.limit || 16).map(view));
    return json(res, list({ ...q, sortBy: 'DateCreated', sortOrder: 'Descending' }).Items.slice(0, +q.limit || 16));
  }
  if (p === '/Items') return json(res, list(q));
  if ((m = p.match(/^\/Items\/([0-9a-f]{32})\/Images\/(Primary|Backdrop|Thumb)$/))) {
    const it = items.get(m[1]);
    if (!it) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
    return res.end(art(it.Type === 'Season' && m[2] === 'Primary' ? it : it, m[2]));
  }
  if ((m = p.match(/^\/Items\/([0-9a-f]{32})\/PlaybackInfo$/))) {
    const it = items.get(m[1]);
    return json(res, { PlaySessionId: 'demo', MediaSources: [{ ...it.MediaSources[0], SupportsDirectPlay: true, ETag: 'demo' }] });
  }
  if ((m = p.match(/^\/Items\/([0-9a-f]{32})$/))) { const it = items.get(m[1]); return it ? json(res, view(it)) : json(res, null, 404); }
  if ((m = p.match(/^\/Shows\/([0-9a-f]{32})\/Seasons$/))) return json(res, { Items: (items.get(m[1]) || { seasons: [] }).seasons.map(view) });
  if ((m = p.match(/^\/Shows\/([0-9a-f]{32})\/Episodes$/))) {
    const s = items.get(m[1]); let eps = s ? s.episodes : [];
    if (q.seasonId) eps = eps.filter(e => e.SeasonId === q.seasonId);
    if (q.startItemId) eps = eps.slice(Math.max(0, eps.findIndex(e => e.Id === q.startItemId)));
    return json(res, { Items: eps.slice(0, +q.limit || eps.length).map(view) });
  }
  if ((m = p.match(/^\/UserPlayedItems\/([0-9a-f]{32})$/))) {
    const it = items.get(m[1]), targets = it && it.episodes ? [it, ...it.episodes] : it ? [it] : [];
    for (const t of targets) userData.set(t.Id, { ...(userData.get(t.Id) || {}), Played: req.method === 'POST', PlaybackPositionTicks: 0 });
    return json(res, {});
  }
  if (p.startsWith('/Sessions/')) { res.writeHead(204); return res.end(); }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`demo Jellyfin on :${PORT} (${MOVIES.length} movies, ${SHOWS.length} shows). Sign in with any username and password.`));
