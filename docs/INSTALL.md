# Installing lite-tv

lite-tv is a small web server. Install it on any computer that's always on and on the same network as your TV.
Usually that's the machine that already runs Jellyfin. The TV then opens lite-tv in its web browser.

Pick your system:

- [Docker](#docker) (Linux servers, NAS boxes, Docker Desktop)
- [Unraid](#unraid)
- [Linux without Docker](#linux-without-docker)
- [Windows](#windows)
- [macOS](#macos)

Then [open it on the TV](#open-it-on-the-tv).

## How well tested each install is

lite-tv itself is used daily on an LG C7 TV, served from an Unraid server. The install methods below are newer, and
not all of them have been tried end to end yet. The untested ones use the same lite-tv code and only standard parts
of each system, so they should work. If you try one, please [open an issue](https://github.com/Vibe-Hacks/lite-tv/issues)
and say whether it did.

| Install | Status | What's been checked |
|---|---|---|
| [Docker](#docker) | Partly tested | The image builds and is published for amd64 and arm64. A container hasn't been run from it yet. The `PUID`/`PGID` handling was tested on Linux outside Docker |
| [Unraid](#unraid) | Not tested yet | The template file is valid, and it uses the same image as Docker. (The author's own Unraid setup runs lite-tv a different way, with Node mounted from a folder.) |
| [Linux](#linux-without-docker) | Tested | Run on Ubuntu 24.04 (under WSL): sign-ins stored, `PUID`/`PGID` checked. The systemd unit passes `systemd-analyze verify`, but hasn't been run as a service |
| [Windows](#windows) | Partly tested | On Windows 10, `start.cmd` was run the way Task Scheduler starts it, and served pages. The firewall and scheduled-task commands were checked but not registered |
| [macOS](#macos) | Not tested | lite-tv only needs Node.js, as on Linux. The launch agent file is valid |

## Before you start: your Jellyfin address

lite-tv needs one setting, `JELLYFIN_URL`: the address of your Jellyfin server **as lite-tv sees it**.

| Where lite-tv runs | Use |
|---|---|
| Same computer as Jellyfin, not in Docker | `http://localhost:8096` |
| In Docker (including Unraid) | The server's network address, for example `http://192.168.1.10:8096`. Inside a container, `localhost` means the container itself, not your server |
| Docker Desktop on Windows or Mac, Jellyfin on the same computer | `http://host.docker.internal:8096` |
| Jellyfin on another computer | That computer's address, for example `http://192.168.1.10:8096` |

If your Jellyfin uses a base URL (Dashboard → Networking), add it: `http://192.168.1.10:8096/jellyfin`.
HTTPS addresses work too.

To check the address, open it in a browser on the machine that will run lite-tv. You should see Jellyfin.

You'll also want **Quick Connect** turned on in Jellyfin (Dashboard → General), so you can sign in on the TV
with a 6-digit code instead of typing your password with the remote.

---

## Docker

> **Status: partly tested.** The image builds and is published. A container hasn't been run from it yet.

The image is `ghcr.io/vibe-hacks/lite-tv:latest` (amd64 and arm64).

**Docker Compose:** save this as `docker-compose.yml` in a new folder, set `JELLYFIN_URL`, then run
`docker compose up -d` in that folder.

```yaml
services:
  lite-tv:
    image: ghcr.io/vibe-hacks/lite-tv:latest
    container_name: lite-tv
    restart: unless-stopped
    init: true
    ports:
      - "6972:6972"
    environment:
      - JELLYFIN_URL=http://192.168.1.10:8096
      - PUID=1000   # the user and group that own ./data
      - PGID=1000
    volumes:
      - ./data:/data   # sign-ins
```

**Or plain Docker:**

```sh
docker run -d --init --name lite-tv --restart unless-stopped -p 6972:6972 \
  -e JELLYFIN_URL=http://192.168.1.10:8096 -v lite-tv-data:/data ghcr.io/vibe-hacks/lite-tv:latest
```

`PUID` and `PGID` set the user lite-tv runs as and the owner of its data folder. The default is 1000:1000. On
Linux, `id -u` and `id -g` show yours. Synology users usually want the IDs of their own account.

**Update:** `docker compose pull && docker compose up -d` (or pull the image and recreate the container).

**Build it yourself instead:** clone this repository and replace `image:` with `build: .`, or run
`docker build -t lite-tv .`.

---

## Unraid

> **Status: not tested yet.** It should work: it uses the same image as Docker. Please report how it goes.

### With the template (recommended)

1. Open **Terminal** (top right in the Unraid web UI) and paste:

   ```sh
   wget -O /boot/config/plugins/dockerMan/templates-user/my-lite-tv.xml \
     https://raw.githubusercontent.com/Vibe-Hacks/lite-tv/main/unraid/lite-tv.xml
   ```

2. Go to **Docker → Add Container**, and choose **lite-tv** from the **Template** list.
3. Set **Jellyfin URL** to your server's address and Jellyfin port, for example `http://192.168.1.10:8096`.
   Don't use `localhost`.
4. Click **Apply**.

The template stores sign-ins in `/mnt/user/appdata/lite-tv` and runs as `nobody:users` (99:100), like other
Unraid containers. Updates show up on the Docker tab like any other container.

### By hand

Docker → Add Container, then set:

| Field | Value |
|---|---|
| Name | `lite-tv` |
| Repository | `ghcr.io/vibe-hacks/lite-tv:latest` |
| Network Type | `bridge` |
| Extra Parameters (advanced view) | `--init` |
| Port: container `6972` | host `6972` |
| Path: container `/data` | `/mnt/user/appdata/lite-tv` |
| Variable `JELLYFIN_URL` | `http://<your Unraid IP>:8096` |
| Variable `PUID` | `99` |
| Variable `PGID` | `100` |

---

## Linux without Docker

> **Status: tested** on Ubuntu 24.04. The systemd unit is validated but hasn't been run as a service yet.

You need **Node.js 18 or newer** (`node -v` to check). Use your distribution's package if it's new enough, or
[nodejs.org](https://nodejs.org/en/download). lite-tv has no other dependencies and needs no `npm install`.

```sh
sudo git clone https://github.com/Vibe-Hacks/lite-tv.git /opt/lite-tv
cd /opt/lite-tv
JELLYFIN_URL=http://localhost:8096 node server.js
```

If it starts (`lite-tv on :6972 ...`), stop it with Ctrl+C and set it up as a service, so it starts with the
computer. Save this as `/etc/systemd/system/lite-tv.service`, changing `JELLYFIN_URL` (and the `node` path if
`command -v node` shows a different one):

```ini
[Unit]
Description=lite-tv (Jellyfin UI for old TVs)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/node /opt/lite-tv/server.js
Environment=JELLYFIN_URL=http://localhost:8096
Environment=DATA_DIR=/var/lib/lite-tv
DynamicUser=yes
StateDirectory=lite-tv
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now lite-tv
systemctl status lite-tv
```

If you use a firewall, allow the port: `sudo ufw allow 6972/tcp` (or your firewall's equivalent).

**Update:** `cd /opt/lite-tv && sudo git pull && sudo systemctl restart lite-tv`.

---

## Windows

> **Status: partly tested** on Windows 10. The start script works; the scheduled task hasn't been registered and run end to end yet.

1. **Install Node.js** (the LTS version) from [nodejs.org](https://nodejs.org/en/download), or in PowerShell:
   `winget install OpenJS.NodeJS.LTS`.
2. **Get lite-tv:** on the [GitHub page](https://github.com/Vibe-Hacks/lite-tv), click **Code → Download ZIP**
   and extract it to `C:\lite-tv`. Check that `C:\lite-tv\server.js` exists, not `C:\lite-tv\lite-tv-main\server.js`.
3. **Try it.** In PowerShell:

   ```powershell
   cd C:\lite-tv
   $env:JELLYFIN_URL = "http://localhost:8096"
   node server.js
   ```

   When Windows asks whether to allow Node.js on networks, allow **Private networks**. If you missed the prompt,
   run this in PowerShell **as administrator**:

   ```powershell
   New-NetFirewallRule -DisplayName "lite-tv" -Direction Inbound -Protocol TCP -LocalPort 6972 -Action Allow -Profile Private
   ```

   Open `http://<this PC's IP>:6972` on the TV to check it works, then press Ctrl+C to stop it.

4. **Start it automatically.** Create `C:\lite-tv\start.cmd` with your Jellyfin address:

   ```bat
   @echo off
   set JELLYFIN_URL=http://localhost:8096
   cd /d %~dp0
   node server.js >> lite-tv.log 2>&1
   ```

   Then run this in PowerShell **as administrator**. It starts lite-tv when Windows starts, before anyone signs in,
   and restarts it if it stops:

   ```powershell
   $action   = New-ScheduledTaskAction -Execute "C:\lite-tv\start.cmd" -WorkingDirectory "C:\lite-tv"
   $trigger  = New-ScheduledTaskTrigger -AtStartup
   $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
   Register-ScheduledTask -TaskName "lite-tv" -Action $action -Trigger $trigger -Settings $settings -User "SYSTEM" -RunLevel Highest
   Start-ScheduledTask -TaskName "lite-tv"
   ```

   The log goes to `C:\lite-tv\lite-tv.log`. To remove it later: `Unregister-ScheduledTask -TaskName "lite-tv"`.

**Update:** download the ZIP again and extract it over `C:\lite-tv` (your `start.cmd` and the `data` folder are
kept), then restart the PC.

Prefer Docker Desktop? Use the [Docker](#docker) steps with `JELLYFIN_URL=http://host.docker.internal:8096`.

---

## macOS

> **Status: not tested.** It should work: it's the same as Linux apart from the launch agent. Please report how it goes.

1. **Install Node.js** (LTS) from [nodejs.org](https://nodejs.org/en/download), or with Homebrew: `brew install node`.
2. **Get lite-tv** into your home folder:

   ```sh
   git clone https://github.com/Vibe-Hacks/lite-tv.git ~/lite-tv
   ```

   (or **Code → Download ZIP** on GitHub, and move the extracted folder to `~/lite-tv`).
3. **Try it:**

   ```sh
   cd ~/lite-tv
   JELLYFIN_URL=http://localhost:8096 node server.js
   ```

   If macOS asks whether `node` may accept incoming network connections, click **Allow**. Check it on the TV,
   then press Ctrl+C.

4. **Start it automatically.** Run `which node` and note the path (`/usr/local/bin/node`, or
   `/opt/homebrew/bin/node` with Homebrew on Apple silicon). Save this as
   `~/Library/LaunchAgents/io.github.vibe-hacks.lite-tv.plist`, replacing `YOURNAME`, the node path and the
   Jellyfin address:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>Label</key><string>io.github.vibe-hacks.lite-tv</string>
     <key>ProgramArguments</key>
     <array>
       <string>/usr/local/bin/node</string>
       <string>/Users/YOURNAME/lite-tv/server.js</string>
     </array>
     <key>WorkingDirectory</key><string>/Users/YOURNAME/lite-tv</string>
     <key>EnvironmentVariables</key>
     <dict>
       <key>JELLYFIN_URL</key><string>http://localhost:8096</string>
     </dict>
     <key>RunAtLoad</key><true/>
     <key>KeepAlive</key><true/>
     <key>StandardOutPath</key><string>/Users/YOURNAME/lite-tv/lite-tv.log</string>
     <key>StandardErrorPath</key><string>/Users/YOURNAME/lite-tv/lite-tv.log</string>
   </dict>
   </plist>
   ```

   Then load it:

   ```sh
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.github.vibe-hacks.lite-tv.plist
   ```

   It runs while you're logged in to the Mac, like Jellyfin's own Mac app. To stop it for good:
   `launchctl bootout gui/$(id -u)/io.github.vibe-hacks.lite-tv`.

**Update:** `cd ~/lite-tv && git pull`, then `launchctl kickstart -k gui/$(id -u)/io.github.vibe-hacks.lite-tv`.

---

## Open it on the TV

1. Find the IP address of the machine running lite-tv:
   - Windows: `ipconfig` (the IPv4 address)
   - macOS: `ipconfig getifaddr en0` (Wi-Fi) or `en1`, or System Settings → Network
   - Linux: `hostname -I`
   - Unraid: shown at the top of the web UI
2. On the TV, open the web browser and go to `http://<that address>:6972`, for example `http://192.168.1.10:6972`.
3. Sign in with Quick Connect or your password. The first time, a "Getting ready" page checks what the TV can
   play. It takes a few seconds and runs again only when something changes.
4. Bookmark the page. On LG webOS TVs you can instead install the [launcher app](../webos/README.md), which gives
   lite-tv its own icon and opens it full screen.

Give the lite-tv machine a fixed IP address (a DHCP reservation in your router), so the bookmark keeps working.

## Settings

| Variable | Default | |
|---|---|---|
| `JELLYFIN_URL` | | **Required.** Your Jellyfin server, as lite-tv reaches it |
| `JELLYFIN_UI_URL` | | Optional "Full Jellyfin" link in the header |
| `PORT` | `6972` | Listen port |
| `PAGE_SIZE` | `24` | Items per grid page |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where sign-ins are stored. It contains Jellyfin access tokens, so keep it private |
| `PUID`, `PGID` | `1000` (Docker only) | User and group lite-tv runs as, and owner of `/data` |

## Troubleshooting

| Problem | What to check |
|---|---|
| The TV can't open the page | Same network as the TV? Right IP and port? Firewall on the lite-tv machine (see your system's section) |
| "Couldn't reach Jellyfin at …" | `JELLYFIN_URL` is wrong. In Docker, don't use `localhost` |
| "Jellyfin didn't answer within 15 s" | Jellyfin is down or busy (on Unraid: is the array started?) |
| Quick Connect isn't offered | Turn it on in Jellyfin: Dashboard → General → Quick Connect |
| You're signed out after every restart | lite-tv can't write its data folder. Its log says `can't write …`. In Docker, set `PUID`/`PGID` to the folder's owner |
| Windows log says `'node' is not recognized` | Node.js isn't on the system PATH (for example, installed with a version manager). In `start.cmd`, replace `node` with its full path, which `where.exe node` shows |
| A video won't play | lite-tv asks Jellyfin to transcode when the TV can't play a file directly. Check Jellyfin's Dashboard → Activity and its transcoding settings |

Logs: `docker logs lite-tv` (Docker and Unraid), `journalctl -u lite-tv` (Linux service), or `lite-tv.log` in the
lite-tv folder (Windows and macOS).
