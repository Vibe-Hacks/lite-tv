// lite-tv client. ES5 only (old TV browsers, back to Chrome 27): lazy thumbnails, remote (D-pad) navigation, video player.
// The player is backend-agnostic: it reads its stream URLs from data attributes on #player (see lib/html.js).
(function () {
  'use strict';
  // Browsers before Chrome 31 have no object-fit: app.css crops thumbnails another way under html.nofit.
  if (!('objectFit' in document.documentElement.style)) document.documentElement.className += ' nofit';
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 461, BACKSPACE: 8, ESC: 27,
    PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, STOP: 413, FF: 417, RW: 412, SPACE: 32 };

  // ---------- lazy images (no IntersectionObserver in Chrome 38) ----------
  function loadVisible() {
    var imgs = document.querySelectorAll('img[data-src]'), h = window.innerHeight;
    for (var i = 0; i < imgs.length; i++) {
      var r = imgs[i].getBoundingClientRect();
      if (r.bottom > -h && r.top < h * 2) {
        imgs[i].onload = function () { this.className = 'ok'; };
        imgs[i].src = imgs[i].getAttribute('data-src');
        imgs[i].removeAttribute('data-src');
      }
    }
  }
  var lazyT = null;
  function lazySoon() { if (!lazyT) lazyT = setTimeout(function () { lazyT = null; loadVisible(); }, 100); }
  window.addEventListener('scroll', lazySoon);
  window.addEventListener('resize', lazySoon);

  // ---------- spatial navigation ----------
  function focusables() {
    var all = document.querySelectorAll('a.tile, a.btn, a.nav, input, button'), out = [];
    for (var i = 0; i < all.length; i++) if (all[i].offsetWidth) out.push(all[i]);
    return out;
  }
  function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function move(dir) {
    var cur = document.activeElement, items = focusables();
    if (!cur || items.indexOf(cur) < 0) { if (items.length) focusEl(items[0]); return; }
    var cr = cur.getBoundingClientRect(), c = center(cr), best = null, bestScore = Infinity;
    for (var i = 0; i < items.length; i++) {
      var el = items[i]; if (el === cur) continue;
      var r = el.getBoundingClientRect(), p = center(r), dx = p.x - c.x, dy = p.y - c.y, main, cross;
      if (dir === KEY.RIGHT) { if (r.left < cr.right - 4) continue; main = dx; cross = Math.abs(dy); }
      else if (dir === KEY.LEFT) { if (r.right > cr.left + 4) continue; main = -dx; cross = Math.abs(dy); }
      else if (dir === KEY.DOWN) { if (r.top < cr.bottom - 4) continue; main = dy; cross = Math.abs(dx); }
      else { if (r.bottom > cr.top + 4) continue; main = -dy; cross = Math.abs(dx); }
      var score = main + cross * 2; // prefer staying in the same row/column
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) focusEl(best);
  }
  function focusEl(el) {
    el.focus();
    var r = el.getBoundingClientRect(), h = window.innerHeight;
    if (r.top < 90 || r.bottom > h - 20) window.scrollBy(0, r.top < 90 ? r.top - 120 : r.bottom - h + 60);
    lazySoon();
  }

  // ---------- player ----------
  function initPlayer(box) {
    var v = document.getElementById('v'), osd = document.getElementById('osd'), msg = document.getElementById('msg');
    var mode = box.getAttribute('data-mode'); // direct | hls | transcode
    var directUrl = box.getAttribute('data-direct'), hlsUrl = box.getAttribute('data-hls');
    var transcodeUrl = box.getAttribute('data-transcode'), fallbackUrl = box.getAttribute('data-fallback');
    var nativeSeek = mode === 'direct' || mode === 'hls';
    var duration = +box.getAttribute('data-duration') || 0, start = +box.getAttribute('data-start') || 0;
    var offset = 0;          // transcode streams restart at `offset`; v.currentTime is relative to it
    var pendingSeek = null, seekT = null, osdT = null, msgT = null;
    var reportUrl = box.getAttribute('data-report'), started = false, stopped = false, lastReport = 0;
    var nextUrl = box.getAttribute('data-next'), nextTitle = box.getAttribute('data-next-title') || '', countdownT = null;

    function escHtml(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    // "Up next" after an episode ends: 10 s countdown, OK plays now, Back stops.
    function upNext() {
      var n = 10;
      osd.className = '';
      function tick() {
        if (n <= 0) { clearInterval(countdownT); location.replace(nextUrl); return; }
        say('Up next: ' + escHtml(nextTitle) + '<br><span class="small">Playing in ' + n + ' s · OK to play now · Back to stop</span>', 0);
        n--;
      }
      tick();
      countdownT = setInterval(tick, 1000);
    }

    // Playback reporting (backends that track watched state). 'stopped' is sent synchronously so it
    // survives the page being left straight afterwards.
    function report(ev, sync) {
      // Like jellyfin-web, only report playback that actually started: a "stopped at 0:00" for a stream that
      // never played would wipe the item's resume point.
      if (!reportUrl || stopped || (ev !== 'start' && !started)) return;
      if (ev === 'stopped') stopped = true;
      try {
        var x = new XMLHttpRequest();
        x.open('POST', reportUrl, !sync);
        x.setRequestHeader('Content-Type', 'application/json');
        x.send(JSON.stringify({ event: ev, pos: Math.floor(now()), paused: v.paused }));
      } catch (e) { /* reporting must never break playback */ }
      lastReport = new Date().getTime();
    }
    function exitPlayer() { report('stopped', true); v.pause(); v.removeAttribute('src'); v.load(); history.back(); }

    function fmt(s) {
      s = Math.max(0, Math.floor(s)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
      return (h ? h + ':' + (m < 10 ? '0' : '') + m : m) + ':' + (x < 10 ? '0' : '') + x;
    }
    function now() { return nativeSeek ? v.currentTime : offset + v.currentTime; }
    function say(t, ms) { msg.innerHTML = t; clearTimeout(msgT); if (ms) msgT = setTimeout(function () { msg.innerHTML = ''; }, ms); }
    function show() {
      osd.className = ''; clearTimeout(osdT);
      osdT = setTimeout(function () { if (!v.paused) osd.className = 'hide'; }, 4000);
    }
    function draw(t) {
      document.getElementById('cur').innerHTML = fmt(t);
      document.getElementById('fill').style.width = (duration ? Math.min(100, t / duration * 100) : 0) + '%';
    }
    function load(at) {
      if (nativeSeek) {
        v.src = mode === 'direct' ? directUrl : hlsUrl;
        if (at) v.addEventListener('loadedmetadata', function once() { v.removeEventListener('loadedmetadata', once); v.currentTime = at; });
      } else {
        offset = Math.floor(at || 0);
        v.src = transcodeUrl.replace('{start}', offset);
      }
      v.play();
    }
    function seekTo(t) {
      t = Math.max(0, duration ? Math.min(duration - 1, t) : t);
      draw(t); show();
      if (nativeSeek) { v.currentTime = t; return; }
      // Progressive transcodes can't seek natively: batch key presses, then restart the stream at the new point.
      pendingSeek = t; clearTimeout(seekT);
      seekT = setTimeout(function () { var x = pendingSeek; pendingSeek = null; say('', 0); load(x); if (started) report('progress'); }, 700);
    }
    function toggle() { if (v.paused) v.play(); else v.pause(); show(); }

    v.addEventListener('timeupdate', function () {
      if (pendingSeek === null) draw(now());
      if (started && !v.paused && new Date().getTime() - lastReport > 10000) report('progress');
    });
    v.addEventListener('pause', function () { show(); say('❚❚', 0); if (started) report('progress'); });
    v.addEventListener('play', function () { say('', 0); show(); if (started) report('progress'); });
    v.addEventListener('waiting', function () { say('Loading…', 0); });
    v.addEventListener('playing', function () { say('', 0); if (!started) { started = true; report('start'); } });
    v.addEventListener('seeked', function () { if (started) report('progress'); });
    v.addEventListener('ended', function () {
      report('stopped');
      if (nextUrl) upNext(); else { say('Finished', 0); osd.className = ''; }
    });
    window.addEventListener('beforeunload', function () { if (started) report('stopped', true); });
    v.addEventListener('error', function () {
      if (mode === 'direct' && fallbackUrl) {
        // Like jellyfin-web: if direct play fails, ask the server again without direct play.
        say('Switching to a transcoded stream…', 0);
        if (started) report('stopped', true);
        location.replace(fallbackUrl.replace('{start}', Math.floor(v.currentTime || start)));
      } else say('This video can’t be played on the TV', 0);
    });
    v.addEventListener('click', toggle);

    // Magic Remote: on webOS, the arrow press that hides the pointer also reaches the page. That press should
    // only hide the pointer (and show the controls), not seek. webOS reports the pointer with cursorStateChange;
    // where it doesn't, any mouse movement counts as "pointer showing" until the next arrow press.
    var pointerOn = false, pointerKnown = false, pointerOffAt = 0;
    document.addEventListener('cursorStateChange', function (e) {
      var on = !!(e.detail && e.detail.visibility);
      pointerKnown = true;
      if (pointerOn && !on) pointerOffAt = new Date().getTime(); // may arrive just before that arrow keydown
      pointerOn = on;
    });
    document.addEventListener('mousemove', function () { if (!pointerKnown) pointerOn = true; });
    function pointerHidingPress(k) {
      if (k !== KEY.LEFT && k !== KEY.RIGHT && k !== KEY.UP && k !== KEY.DOWN) return false;
      var hiding = pointerOn || new Date().getTime() - pointerOffAt < 500;
      pointerOn = false; pointerOffAt = 0;
      return hiding;
    }

    document.addEventListener('keydown', function (e) {
      var k = e.keyCode, step = 0;
      if (pointerHidingPress(k)) { show(); e.preventDefault(); return; }
      if (countdownT) { // Up-next countdown is showing
        if (k === KEY.ENTER || k === KEY.PLAY || k === KEY.PLAYPAUSE) { clearInterval(countdownT); location.replace(nextUrl); }
        else if (k === KEY.BACK || k === KEY.STOP || k === KEY.BACKSPACE || k === KEY.ESC) { clearInterval(countdownT); countdownT = null; exitPlayer(); }
        e.preventDefault();
        return;
      }
      if (k === KEY.ENTER || k === KEY.SPACE || k === KEY.PLAYPAUSE) toggle();
      else if (k === KEY.PLAY) { v.play(); show(); }
      else if (k === KEY.PAUSE) { v.pause(); show(); }
      else if (k === KEY.LEFT) step = -10; else if (k === KEY.RIGHT) step = 10;
      else if (k === KEY.DOWN) step = -60; else if (k === KEY.UP) step = 60;
      else if (k === KEY.RW) step = -30; else if (k === KEY.FF) step = 30;
      else if (k === KEY.BACK || k === KEY.STOP || k === KEY.BACKSPACE || k === KEY.ESC) exitPlayer();
      else return;
      if (step) seekTo((pendingSeek !== null ? pendingSeek : now()) + step);
      e.preventDefault();
    });
    document.addEventListener('mousemove', show);

    draw(start); show(); load(start);
  }

  // ---------- boot ----------
  var player = document.getElementById('player');
  if (player) { initPlayer(player); return; }
  loadVisible();
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, typing = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (typing && (k === KEY.LEFT || k === KEY.RIGHT || k === KEY.BACKSPACE)) return; // let the text field have them
    if (k === KEY.LEFT || k === KEY.RIGHT || k === KEY.UP || k === KEY.DOWN) { move(k); e.preventDefault(); }
    else if (k === KEY.BACK) {
      // In the webOS launcher app there's no browser history to fall back on: Back on the first page closes the app.
      if (history.length > 1) history.back();
      else if (window.PalmSystem && window.PalmSystem.platformBack) window.PalmSystem.platformBack();
      e.preventDefault();
    }
  });
  // Start with focus on a detail page's main button, else the first tile, else the first button.
  var first = document.querySelector('.detail a.btn') || document.querySelector('a.tile') || document.querySelector('a.btn');
  if (first) first.focus();
})();
