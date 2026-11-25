# lite-tv launcher for LG webOS

A tiny webOS app that puts lite-tv on the TV's home launcher. It opens full screen with no browser address
bar, and the remote's Back button closes it from the first page. The app is about 4 KB: it checks your lite-tv
server is reachable (and keeps retrying with a message if not), then loads it. All the real UI still comes from
the server, so updating lite-tv never needs the app reinstalled.

## Build

```sh
npm install -g @webos-tools/cli                 # LG's webOS CLI (ares-*)
node webos/build.js http://192.168.1.10:6972    # your lite-tv address, as the TV can reach it
```

Output: `webos/dist/io.github.vibe-hacks.litetv_<version>_all.ipk`

## Install (Developer Mode)

1. Create a free account at <https://webostv.developer.lge.com>.
2. On the TV, install **Developer Mode** from the LG Content Store, open it, sign in, and switch
   **Dev Mode Status** on. The TV restarts.
3. Open Developer Mode again and switch **Key Server** on. Note the TV's IP address and the passphrase it shows.
4. On your computer:

   ```sh
   ares-setup-device -a tv -i "host=<TV IP>" -i "port=9922" -i "username=prisoner"
   ares-novacom --device tv --getkey          # enter the passphrase from the TV
   ares-install --device tv webos/dist/io.github.vibe-hacks.litetv_<version>_all.ipk
   ```

   Or use the community [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) app, a GUI that does the same steps.

**Developer Mode sessions expire.** Apps installed this way are removed when the session runs out. Open the
Developer Mode app now and then and press **Extend** to keep it alive. On rooted TVs you can install the
`.ipk` through the Homebrew Channel instead, where it doesn't expire.

## Icons

`app/icon.png` (80×80) and `app/largeIcon.png` (130×130) come from `tools/make-icons.js`, which has no
dependencies. Run `node webos/tools/make-icons.js` to regenerate them.
