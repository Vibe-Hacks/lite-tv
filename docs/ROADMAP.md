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
- Switch audio or subtitles during playback. For now they're chosen on the details page before playing.
- Libraries switcher (multiple movie or show libraries), collections.

## Packaging
- A multi-arch image (amd64 and arm64) on GHCR, built by a GitHub Action.
- An Unraid Community Applications template.
- Maybe: a Jellyfin server plugin that serves the UI at `/lite`, for setups without Docker.

## Design rules
- **Playback must match the official Jellyfin client.** lite-tv never builds its own device profile or overrides
  Jellyfin's decisions. It only replaces navigation.
- The TV does as little as possible. The server builds the HTML and the client stays small (ES5).
- CSS must work in Chrome 27+: flexbox only (with `-webkit-` prefixed copies), no grid, `gap`, custom properties or `aspect-ratio`.
- Every control is a real link, so pointer remotes and plain navigation work even if the JavaScript fails.
- No npm dependencies in the server.
