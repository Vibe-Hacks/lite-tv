# lite-tv

A fast Jellyfin interface for **old LG TVs**.

The official Jellyfin TV apps wrap Jellyfin's web client, a large JavaScript application. On an older TV,
with a slow processor and a browser engine from years ago, it can take a very long time to become usable.
lite-tv runs next to your Jellyfin server and **builds the pages on the server**. The TV gets plain HTML
plus about 11 KB of simple JavaScript for remote-control navigation and the video player. Nothing has to
be installed on the TV: you open a URL in its browser (or install the optional launcher app).

**Status:** early, but usable every day. Home (Continue watching, Next up, latest movies and shows), Movies,
TV shows, playback with progress reporting, and "Up next" all work. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Which TVs

lite-tv is built for and tested on an **LG OLED55C7 (2017, webOS 3.5, Chrome 38)**. The pages have also been
checked in the browser engine of each older and newer webOS generation:

| LG TVs | webOS | Browser engine | Pages |
|---|---|---|---|
| 2014 | 1.x | Chrome 26 | Should work (checked in Chrome 27), not tried on a real TV |
| 2015 | 2.x | Chrome 34 | Work |
| 2016–2017 | 3.x | Chrome 38 | Work, tested on a real TV |
| 2018–2019 | 4.x | Chrome 53 | Work |
| 2020–2021 | 5.x, 6.x | Chrome 68, 79 | Work |

The engine checks cover the pages and remote-control navigation. Video playback depends on the TV's own
media player, so it has only been confirmed on the C7. The older the TV, the more lite-tv helps. On a 2022 or
newer TV the official Jellyfin app is usually fine.

## Quick start

```sh
docker build -t lite-tv .
docker run -d --init --name lite-tv -p 6972:6972 -v lite-tv-data:/data -e JELLYFIN_URL=http://192.168.1.10:8096 lite-tv
```

Or with Docker Compose: edit `JELLYFIN_URL` in [docker-compose.yml](docker-compose.yml), then `docker compose up -d`.

Then open `http://<host>:6972` in the TV's browser and sign in. On LG webOS TVs you can also install a small
launcher app, so lite-tv gets its own icon on the home screen and opens full screen: see [webos/README.md](webos/README.md).

Without Docker (any OS, Node 18 or later, no `npm install` needed):

```sh
JELLYFIN_URL=http://192.168.1.10:8096 node server.js
```

lite-tv is meant for your home network. Don't expose it to the internet.

## Signing in

- **Quick Connect** (recommended): the TV shows a 6-digit code. Enter it in any Jellyfin app that's already
  signed in (user menu → Quick Connect). You need to turn on Quick Connect first, under Dashboard → General.
- **Username and password**, using the TV's on-screen keyboard.

lite-tv keeps the Jellyfin access token on the server and gives the TV a cookie. The device shows up in
Jellyfin under Dashboard → Devices, where you can revoke it. Sign-ins are stored in `DATA_DIR`, so treat
that folder as private: it contains Jellyfin access tokens.

## Configuration

| Variable | Default | |
|---|---|---|
| `JELLYFIN_URL` | | **Required.** Your Jellyfin server, as reachable from lite-tv |
| `JELLYFIN_UI_URL` | | Optional "Full Jellyfin" link in the header |
| `PORT` | `6972` | Listen port |
| `PAGE_SIZE` | `24` | Items per grid page |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where sign-ins are stored |

## Remote control

| Key | Lists | Player |
|---|---|---|
| ◀ ▶ ▲ ▼ | move between tiles | ±10 s / ±1 min |
| OK | open | play / pause |
| ⏪ ⏩ | | ±30 s |
| Back | previous page | exit |

Pointer remotes (LG Magic Remote) also work: everything is a normal link.

## How playback works

lite-tv only replaces the browsing UI. **Playback decisions are the official Jellyfin web client's:**

- **Same device profile.** On first sign-in, a one-off "Getting ready" page runs **jellyfin-web's own
  device-profile builder** (`public/jf-profile.js`, built from `vendor/jellyfin-web`) on the TV. Inside the
  webOS launcher app, it uses the same options as the official Jellyfin webOS app, including the TV's Dolby
  Atmos, Dolby Vision and HDR10 support.
- **Same bitrate.** It also runs jellyfin-web's bitrate test, and repeats it hourly as jellyfin-web does.
- **Same request.** Every `PlaybackInfo` request matches jellyfin-web's: that profile, that bitrate, and no
  forced audio or subtitle tracks (Jellyfin applies your preferences).
- **Same playback.** Direct play uses jellyfin-web's direct stream URL. Remuxes and transcodes use Jellyfin's
  HLS stream with the TV's native HLS player, as jellyfin-web does on webOS and Tizen. If direct play fails,
  lite-tv retries without it, like jellyfin-web.
- **Subtitles.** Ones Jellyfin delivers as separate WebVTT files are shown. Burned-in and in-stream subtitles
  come with the video.
- **Reporting.** Playback start, progress and stop are reported, so watched state, resume points and Next Up
  stay in step with your other apps.
- **One address for the TV.** All media goes through lite-tv, so the TV never sees Jellyfin credentials.

## Browser support

The client is plain ES5 with flexbox layout (no CSS grid, `gap` or custom properties, and no
IntersectionObserver or fetch). Flexbox rules carry `-webkit-` prefixed copies for Chrome 27 and older.

## Project layout

```
server.js             HTTP server, routing, static files
lib/config.js         environment configuration
lib/html.js           shared page, tile, grid and player markup
lib/proxy.js          media proxy (Range passthrough)
lib/http.js           cookies, forms, redirects
lib/store.js          tiny JSON store for sign-ins
backends/jellyfin.js  Jellyfin pages, playback and reporting
public/app.js         ES5 client: lazy images, D-pad navigation, player
public/app.css        styles for old TV browsers
public/setup.js       "Getting ready" page: device profile and bitrate test
public/jf-profile.js  jellyfin-web's device-profile builder, compiled to ES5 (built by profile/)
profile/              build tooling for jf-profile.js (not needed to run lite-tv)
vendor/jellyfin-web/  the jellyfin-web source files jf-profile.js is built from
webos/                optional LG webOS launcher app
```

## Licence

GPL-2.0-or-later (see `LICENSE`). lite-tv runs jellyfin-web's own device-profile code on the TV
(`vendor/jellyfin-web`, GPL-2.0-or-later), so Jellyfin decides playback exactly as it does for the
official Jellyfin apps. The webOS launcher bundles LG's `webOSTV.js` (Apache-2.0, `webos/app/webOSTV.LICENSE-2.0.txt`).

lite-tv is not affiliated with Jellyfin or LG.
