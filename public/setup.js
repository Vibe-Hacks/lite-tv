// lite-tv setup (ES5, runs on the TV once per sign-in): builds the Jellyfin device profile with jellyfin-web's own
// code (jf-profile.js) and runs jellyfin-web's bitrate test, then saves both and continues to the requested page.
// The bitrate test mirrors jellyfin-web src/utils/bitrateTest.ts.
(function () {
  'use strict';
  var C = window.LTV_SETUP, $ = function (id) { return document.getElementById(id); };
  var MAX_BITRATE = 2147483647, LAN_BITRATE = 140000000, TIMEOUT = 5000;
  var TESTS = [{ bytes: 500000, threshold: 500000 }, { bytes: 1000000, threshold: 20000000 }, { bytes: 3000000, threshold: 50000000 }];

  function fail(text) { $('st').innerHTML = 'Couldn’t finish setting up'; $('sd').innerHTML = text + ' <a class="btn on" href="">Try again</a>'; }

  // One download, timed from the first response headers to the end (as jellyfin-web does).
  function speed(bytes, ok, err) {
    var x = new XMLHttpRequest(), t0 = 0;
    x.open('GET', C.test + '?size=' + bytes + '&t=' + new Date().getTime(), true);
    x.responseType = 'blob';
    x.timeout = TIMEOUT;
    x.onreadystatechange = function () { if (x.readyState === 2) t0 = window.performance ? performance.now() : new Date().getTime(); };
    x.onload = function () {
      if (x.status >= 400) return err();
      var t1 = window.performance ? performance.now() : new Date().getTime();
      var secs = Math.max((t1 - t0) / 1000, 0.001);
      ok(Math.round(x.response.size / secs * 8));
    };
    x.onerror = x.ontimeout = x.onabort = err;
    x.send(null);
  }
  function normalize(b) { return Math.min(Math.round((b || 0) * 0.7), MAX_BITRATE); }
  function detect(i, current, done) {
    if (i >= TESTS.length) return done(normalize(current));
    speed(TESTS[i].bytes, function (b) {
      if (b < TESTS[i].threshold) done(normalize(b)); else detect(i + 1, b, done);
    }, function () { done(normalize(current)); });
  }

  function save(data) {
    var x = new XMLHttpRequest();
    x.open('POST', C.post, true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.onload = function () { if (x.status < 300) location.replace(C.next); else fail('The server didn’t accept the result (' + x.status + ').'); };
    x.onerror = function () { fail('Couldn’t reach the server.'); };
    x.send(JSON.stringify(data));
  }

  var data = {};
  if (C.mode === 'full') {
    try { data.profile = window.LiteTvProfile.build(C.di); }
    catch (e) { return fail('Building the device profile failed: ' + (e && e.message)); }
  }
  $('sd').innerHTML = 'Measuring the connection to the server.';
  detect(0, undefined, function (bitrate) {
    if (C.inNetwork) bitrate = Math.max(bitrate || 0, LAN_BITRATE); // jellyfin-web's floor for in-network clients
    data.bitrate = bitrate || LAN_BITRATE;
    save(data);
  });
})();
