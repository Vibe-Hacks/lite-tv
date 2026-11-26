# Roadmap

## Done
- **Shared ES5 client:** spatial D-pad navigation, lazy image loading, and a player (direct play, native HLS,
  and progressive fallback) with playback reporting.
- **Jellyfin login:** Quick Connect or password. Tokens stay server-side and the TV gets a cookie.
- **Same playback as the official app:** on first sign-in, the TV builds its device profile with jellyfin-web's
  own code (with webOS device info from the launcher app) and runs jellyfin-web's bitrate test. PlaybackInfo
  requests and stream handling mirror jellyfin-web.
- **Home:** Continue watching, Next up, Latest movies, Latest shows.
- **Movies:** grid with sort and paging, and a detail page with resume, play, mark watched, and audio and subtitle choice.
- **TV shows:** shows grid (sort and paging), series page (next up, seasons, mark all watched), season page
  (episodes with watched marks and progress), episode page with series and season links.
- **Up next:** after an episode ends, a 10 s countdown to the next one (OK plays now, Back stops).
- **Subtitles:** text subtitles that Jellyfin delivers as WebVTT are shown as `<track>`s. Burned-in and HLS subtitles come with the video.
- **webOS launcher app** (`webos/`).

## Next
Built in this order. Each step is its own commit, works on its own, and is checked the same way (see "Every step" below).

1. **Search.** A Search link in the top bar opens `/jellyfin/search`: a plain GET form (the TV's own keyboard
   opens on the text field) and server-rendered results from `/Items?searchTerm=`, in Movies, Shows and Episodes
   rows. No new client code: the text field and result tiles already work with remote navigation.
2. **Audio and subtitle switching during playback.** The server adds the audio and subtitle tracks to `#player`.
   While paused, the on-screen controls show Audio and Subtitles buttons, and the arrow keys move between them
   instead of seeking. Choosing a track reports "stopped" and reloads `/play` at the current position with the new
   track, which is the same new PlaybackInfo request jellyfin-web makes. Replaces choosing tracks only on the
   details page.
3. **Skip intro and credits** (Jellyfin 10.10+). `play()` also fetches the item's media segments
   (`/MediaSegments/{id}`; on older servers, or with no segments, nothing changes). They go to `#player` as a
   data attribute. While inside an intro, a "Skip intro" prompt appears and OK skips to its end. Inside the
   credits, with an episode to play next, the "Up next" countdown starts early. Works with any plugin that fills
   Jellyfin's segments, and needs no plugin-specific code.
4. **Libraries and collections.** If the user has more than one movie or show library (`/UserViews`), Movies and
   Shows get a library switcher (`?lib=`, sent as `parentId`). A Collections page lists box sets, and a
   collection page shows its items in the normal grid.
5. **Favourites.** A Favourite button on detail pages (`/UserFavoriteItems/{id}`) and a Favourites row on Home.

**Every step:**
- Add what the step needs to `tools/demo-jellyfin.js`, so it can be tried without a real server.
- Check the pages and remote navigation in Chrome 27, 34, 38, 53, 68 and 79 with no script errors, then on the C7.
  Player changes (steps 2 and 3) are tried in desktop Chromium with a small WebM clip served by the demo (made
  locally, not committed), then confirmed on the C7.
- Keep `public/app.js` under 16 KB (it's about 11 KB now) and keep to the CSS and ES5 rules below.
- Older servers must keep working: a missing endpoint hides the feature rather than showing an error.
- Update the README status line, this file and `STATUS.md`.

## Later (only if wanted)
- Chapter skipping, cast and "More like this" on detail pages, switching users, and a settings page (bitrate
  cap, preferred languages, re-run the bitrate test).
- Seek preview thumbnails from Jellyfin's built-in trickplay, as an option, since old TVs are slow to decode
  the large thumbnail images.

## Not planned
- Theme songs, video backdrops, animated transitions, Live TV guide grids, SyncPlay, photo slideshows, and
  drawing image subtitles (PGS) on the TV. Jellyfin already burns those subtitles into the video.
- Running Jellyfin web-interface mods (custom tabs, themes, script injectors). They patch jellyfin-web, which
  lite-tv doesn't run. The official Android TV and iOS apps don't run them either.

## Packaging
- Done: multi-arch image (amd64 and arm64) on GHCR, built by a GitHub Action (`.github/workflows/docker.yml`).
- Done: Unraid template (`unraid/lite-tv.xml`) and install guides for Docker, Unraid, Linux, Windows and macOS.
- Next: list the template in Unraid Community Applications.
- Maybe: a Jellyfin server plugin that serves the UI at `/lite`, for setups without Docker.

## Design rules
- **Playback must match the official Jellyfin client.** lite-tv never builds its own device profile or overrides
  Jellyfin's decisions. It only replaces navigation.
- **Standard Jellyfin features only, never individual plugins.** lite-tv uses Jellyfin's own APIs (for example
  media segments for skip intro). Server plugins that fill those APIs then work automatically, and nobody has to
  install anything a second time. lite-tv doesn't call plugin-specific endpoints or copy web-interface mods.
- The TV does as little as possible. The server builds the HTML and the client stays small (ES5).
- CSS must work in Chrome 27+: flexbox only (with `-webkit-` prefixed copies), no grid, `gap`, custom properties or `aspect-ratio`.
- Every control is a real link, so pointer remotes and plain navigation work even if the JavaScript fails.
- No npm dependencies in the server.
