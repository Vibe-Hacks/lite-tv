# Status

Last updated: 2026-11-25

## Current

- **Published:** github.com/Vibe-Hacks/lite-tv (public). The Docker image `ghcr.io/vibe-hacks/lite-tv:latest`
  (amd64 and arm64) is built by `.github/workflows/docker.yml` on every push to `main`.
- **Works:** Home, Movies, Shows (series, season, episode), playback with jellyfin-web's device profile and
  bitrate test, progress reporting, Up next, Quick Connect and password sign-in. Used daily on an LG OLED55C7
  (webOS 3.5).
- **Browser engines:** pages, layout and remote navigation checked in Chrome 27, 34, 38, 53, 68 and 79 (LG TVs
  2014 to 2021) against a real Jellyfin. Playback has only been confirmed on the C7.
- **Install guide** (`docs/INSTALL.md`): Linux tested; Docker and Windows partly tested; Unraid and macOS not
  tested yet. The status table at the top of the guide is the source of truth.

## Changed on 2026-11-25

- Code review fixes: malformed cookies no longer cause 500s, dropped upstream streams now close, 15 s timeout on
  Jellyfin calls, config validation, a clean shutdown that saves sign-ins, security headers, and a sessions file
  readable only by its owner.
- Chrome 27 (2014 TVs): `-webkit-` flexbox prefixes, an `object-fit` fallback (`html.nofit`), and
  `min-width: 0` on tiles.
- Docker: `PUID`/`PGID` (starts as root only to hand `/data` over, then drops privileges), a health check, and
  a tighter `.dockerignore`.
- Added `docs/INSTALL.md`, `unraid/lite-tv.xml`, the image workflow, `tools/demo-jellyfin.js` (invented library
  for development and the screenshots), the README screenshots, the testing notes and the project note.
- webOS launcher app ID is now `io.github.vibe-hacks.litetv`.

## Open

- **Run the published image as a container** (Docker and Unraid template) end to end. Then mark Docker and
  Unraid as tested in `docs/INSTALL.md`.
- **Windows:** register and run the scheduled task end to end. **macOS:** untested, needs a Mac.
- **2014 TVs (webOS 1.x):** never tried on a real TV. The launcher app there runs in WebKit, which is untested.
- **Roadmap:** switch audio and subtitles during playback, a libraries switcher, collections, and listing in
  Unraid Community Applications (see `docs/ROADMAP.md`).
