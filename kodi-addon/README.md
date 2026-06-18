# N Streams for Kodi

`plugin.video.nstreams` — a Kodi 21 (Omega) add-on that brings the full N Streams
catalog, watchlist, and resume-tracking experience to lightweight devices that
cannot comfortably run the Electron desktop client.

The add-on is purpose-built for the **Raspberry Pi 3B+** (1 GB RAM, ARM64
Pi OS Desktop) but works on any Kodi 21+ install — desktop, Android TV, LibreELEC,
CoreELEC, OSMC, Vero, Fire TV, or Apple TV.

---

## 1. Overview

The standard N Streams desktop client is an Electron app that bundles Chromium.
On a Raspberry Pi 3B+ that means **600 – 700 MB resident memory** before a stream
even starts, plus software video decode (Chromium does not pick up the Pi's
H.264 hardware decoder reliably under the Electron runtime). The result is
dropped frames, audio drift, and a UI that barely responds while a stream is
playing.

The Kodi add-on takes a different route:

- **Kodi handles the UI and playback** — already memory-resident on most media
  devices, already tuned for remote-control navigation, already plumbed into
  the Pi's V4L2-M2M H.264 hardware decoder via `inputstream.adaptive`.
- **The Railway backend does the heavy lifting** — the Python add-on never
  touches a scraper page. It calls a small set of REST endpoints
  (`/api/scrape/availability`, `/api/content/:id`, etc.) and the Node backend
  in `electron/server/` returns raw HLS manifest URLs plus the headers needed
  to fetch them.
- **`inputstream.adaptive` plays the HLS directly** — no embedded browser,
  no JavaScript runtime in the playback path, no extra layer of Chrome
  process trees.

Approximate resident memory footprints on a Pi 3B+ during 1080p playback:

| Stack                                          | Idle      | Playing   |
| ---------------------------------------------- | --------- | --------- |
| Electron N Streams                             | ~420 MB   | ~680 MB   |
| Kodi 21 + N Streams add-on + inputstream.adaptive | ~180 MB   | ~380 MB   |

The add-on retains feature parity with the desktop client for the things that
matter on a 10-foot UI:

- Multi-user profiles (the same `active_user_id` the backend already tracks)
- Watchlist add / remove / mark-watched
- Per-episode resume positions
- Anime, TV, and movie browsing and search
- Provider fallback chain (`miruro` → `vidsrc` → `embedsu`) handled server-side
- Chromium browser fallback (optional, opens `chromium-browser` when the raw
  HLS extractor fails) — disabled by default on Pi installs without Chromium

---

## 2. System requirements

**Required**

- **Kodi 21 (Omega) or newer.** Kodi 20 (Nexus) is missing several
  `xbmcplugin` flags the add-on uses for resume handling. The add-on will
  refuse to load on Kodi 19 and below.
- **Python 3.** Bundled with Kodi 21 — you do not need to install it
  separately. The add-on targets Python 3.11.
- **`inputstream.adaptive`.** Bundled with the official Kodi build on
  Raspberry Pi OS, LibreELEC, CoreELEC, OSMC, Android, and Windows. If you are
  on a stripped-down distro and the add-on reports "inputstream.adaptive is
  not installed", install it from
  *Settings → Add-ons → Install from repository → Kodi Add-on repository →
  VideoPlayer InputStream → InputStream Adaptive*, then enable it.
- **Network access to the Railway backend.** Default URL is
  `https://nstreams-api-production.up.railway.app`. You can point the add-on
  at a self-hosted backend in the settings.

**Recommended for Raspberry Pi 3B+**

- Pi OS Bookworm (Desktop or Lite — both work, Kodi runs fine on Lite via
  the standalone session).
- A wired Ethernet connection. Wi-Fi on the 3B+ tops out at ~40 Mbps in
  practice, which is enough for 1080p but leaves no headroom for buffer
  recovery on a busy network.
- An active cooler or a heatsink case. H.264 hardware decode is cheap, but
  the wireless and USB subsystems on the 3B+ throttle aggressively above
  80 °C and a throttled SoC will starve the decoder.
- A class 10 / A1 microSD card or a USB SSD. Resume positions are written
  through the backend, but Kodi's own thumbnail cache lives on the boot
  device and slow storage is the most common cause of "menu feels laggy".

**Optional**

- `chromium-browser` on `PATH`, only if you want the fallback path to launch
  a browser when raw HLS extraction fails. The add-on never installs or
  expects Chromium — leave it out for the leanest install.

---

## 3. Installation

### 3a. Download the release zip

Grab `plugin.video.nstreams-1.0.0.zip` from the latest release on GitHub:

> https://github.com/your-org/NStreams/releases

Copy it onto the Kodi device however you like — USB stick, SMB share,
`scp`, or download it directly inside Kodi using the *File Manager → Add source*
flow.

If you build from source instead, run:

```sh
cd kodi-addon
zip -r ../plugin.video.nstreams-1.0.0.zip . \
  -x '*.pyc' -x '__pycache__/*' -x '.git/*'
```

The repository's `kodi-addon/` directory **is** the add-on root — its
`addon.xml` sits at the top level of the zip.

### 3b. Allow installs from outside the official repo

Kodi blocks unsigned zips by default.

1. Open Kodi.
2. *Settings* (the gear icon) → *System*.
3. Select the *Add-ons* category in the left rail.
4. Toggle **Unknown sources** to **On**.
5. Acknowledge the warning dialog ("Add-ons will be given access to personal
   data…"). The add-on does not exfiltrate anything — its only outbound
   destination is your backend URL — but the warning is Kodi-wide and cannot
   be suppressed per-add-on.

### 3c. Install the zip

1. Back in *Settings → Add-ons*, choose **Install from zip file**.
2. Browse to wherever you copied `plugin.video.nstreams-1.0.0.zip`.
3. Select the zip. After a moment Kodi shows a toast: *N Streams Add-on
   installed*.

The add-on now appears under *Add-ons → Video add-ons → N Streams* and in the
main *Videos* menu.

### 3d. First-run configuration

Open *N Streams* once so the settings file is generated, then configure it:

1. Highlight *N Streams* in the Video add-ons list.
2. Press **c** on a keyboard, **menu** on a remote, or long-press
   *select* on a game controller. Choose **Settings**.
3. Set **Active User**. This is the `user_id` the backend already knows about
   from the desktop or Android client — pick the same one so your watchlist
   and resume positions carry over. If you are starting fresh, leave it blank
   and the add-on will create a user the first time you add something to your
   watchlist.
4. Set **Backend URL**. Default:
   `https://nstreams-api-production.up.railway.app`. Change it only if you
   are self-hosting the backend.
5. (Optional) Toggle **Enable Chromium fallback** to **Off** on Pi installs
   without Chromium. With it on, a failed extraction will try to launch
   `chromium-browser`; with it off, you get a clean "Source unavailable"
   toast instead.
6. (Optional) Set **Preferred provider order**. The default
   `miruro,vidsrc,embedsu` matches the desktop client and is what the
   backend's `PROVIDERS` constant returns. Leave it alone unless you know
   one provider is broken in your region.

Press *OK* to save. The add-on is ready.

---

## 4. Usage

The top-level menu mirrors the desktop client:

- **Home** — continue-watching rail (driven by the backend's resume
  positions), trending, recently added.
- **My List** — your watchlist for the active user. Context menu (`c` /
  menu button) gives you *Remove from list* and *Mark as watched*.
- **Browse** — by genre, year, or provider. Movies, TV, and Anime are
  separate folders.
- **Search** — opens the Kodi text-input keyboard. Results stream in as the
  backend resolves availability across providers, so the first few hits
  appear well before the wheel stops spinning.
- **Settings** — same dialog as the first-run configuration above. Reachable
  from the add-on root, no need to back out to Kodi's add-on manager.

### 4a. Playback flow

1. Pick a title from any rail. Movies play directly; TV and anime open into
   a season → episode picker (the backend's
   `/api/content/:id/season/:n` and `/api/content/:id/anime-episodes`
   endpoints).
2. Pick an episode. The add-on calls `/api/scrape/availability` to find a
   working provider, then asks the backend to extract the raw HLS URL.
3. Kodi starts playback through `inputstream.adaptive`. You get standard
   Kodi controls — OSD, subtitle picker, audio track switcher, seek bar,
   skip-intro if the backend reports an intro range.
4. When you stop, the add-on POSTs a resume update to the backend
   (`POST /api/sessions/start` is reused for the resume payload — same call
   the desktop client makes). Next time you open that episode from any
   client, it starts where you left off.

### 4b. Remote-control tips

- The **back** button always returns to the previous menu; it never closes
  the add-on mid-playback. Use **stop** to end playback.
- **Up / down** during playback shows the OSD and lets you change source.
  *Change source* re-queries the backend and steps through the next
  provider in your preferred order without restarting the resume timer.
- On a CEC-aware TV, the TV remote's *info* button shows the title, the
  current source, and the actual resolution `inputstream.adaptive`
  negotiated — handy when the network is throttling and you want to know
  whether you are watching 720p or 1080p.

---

## 5. Troubleshooting

### Cannot connect to backend

> *Toast:* "Cannot reach backend at https://nstreams-api-production.up.railway.app"

Check, in order:

1. **Backend URL setting.** A trailing slash, missing `https://`, or a typo
   in the Railway subdomain will all produce this error. The default value
   should work for everyone who has not self-hosted.
2. **DNS.** From an SSH shell on the Pi: `getent hosts
   nstreams-api-production.up.railway.app`. If that returns nothing, your
   router or upstream DNS is the problem.
3. **Outbound HTTPS.** Some captive-portal Wi-Fi networks (dorms, hotels)
   block long-lived connections to `*.railway.app`. Try a phone hotspot to
   confirm.
4. **Backend health.** Hit
   `https://nstreams-api-production.up.railway.app/api/health` from any
   browser. If that returns 5xx, the backend itself is down — wait or
   redeploy, the add-on cannot do anything until it is back.

### Stream resolver failed — opening browser fallback

> *Toast:* "Stream resolver failed — opening browser fallback"
>
> *Followed by either:* a Chromium window, or *"chromium-browser not found"*.

This means the server-side extractor in `electron/server/scrapers.js` could
not find a playable HLS URL for the provider it tried. Causes:

- **Provider site layout changed.** This is the most common cause and
  usually resolves itself within a day or two — the `PROVIDERS` constant in
  `scrapers.js` is updated and the Railway backend redeploys
  automatically. You can force an immediate retry of the next provider by
  picking *Change source* in the playback OSD.
- **Cloudflare challenge.** Some providers occasionally gate requests
  behind a JavaScript challenge that the Cheerio-based extractor cannot
  solve. The browser fallback exists for exactly this case — Chromium
  passes the challenge, plays the embed in a normal browser window, and
  you lose hardware decode but keep watching.
- **No Chromium installed.** If you are on a headless or stripped-down
  Pi build, the fallback launch fails. Either install
  `chromium-browser` (`sudo apt install chromium-browser`) or, more
  Pi-friendly, **turn off** *Enable Chromium fallback* in the add-on
  settings. With the fallback off, a failed extraction shows a clean
  *Source unavailable* dialog and lets you pick another source.

### Playback stutters or buffers constantly

A few things to check in order of likelihood:

1. **`inputstream.adaptive` version.** Update it via
   *Add-ons → My add-ons → VideoPlayer InputStream → InputStream Adaptive →
   Update*. Pre-21.5 versions on the Pi shipped with a slow segment
   prefetcher that struggles with the segment sizes some providers use.
2. **Source.** Press *up* during playback, pick *Change source*, and try the
   next provider in the list. Provider quality varies — `miruro` is usually
   the highest bitrate, `vidsrc` is the most reliable, `embedsu` is the
   fastest to start.
3. **Network.** Run `iperf3 -c iperf.he.net` from the Pi. If you do not get
   at least 25 Mbps sustained, no add-on tweak will help — fix the network
   first. Wi-Fi on the 3B+ in particular degrades sharply at the edge of
   range.
4. **Storage.** If the OSD reports buffering even when the network monitor
   is idle, the Pi's cache is on a slow SD card. Either move Kodi's userdata
   to a USB SSD (`~/.kodi/userdata` → external disk symlink) or raise the
   cache in `~/.kodi/userdata/advancedsettings.xml`:

   ```xml
   <advancedsettings>
     <cache>
       <memorysize>104857600</memorysize>
       <readfactor>4</readfactor>
     </cache>
   </advancedsettings>
   ```

   On a 1 GB Pi do not raise `memorysize` above 100 MB or Kodi will start
   competing with the video decoder for RAM and stutter for a different
   reason.

### Watchlist or resume positions out of sync

The add-on writes to the same `watchlist` and `sessions` tables in the
backend SQLite database that the desktop and Android clients use. If
positions are not syncing:

1. **Active User mismatch.** Settings → Active User must be the **same**
   `user_id` across clients. If you set up the Pi with a blank user, the
   add-on created a brand-new user instead of reusing the desktop one.
   Set Active User on the Pi to match the desktop value (find it in
   `electron/server/database.js`'s users table on the backend, or in the
   *Users* settings on the desktop client) and the next playback will
   write into the right row.
2. **Backend offline at the moment of stop.** The add-on posts the resume
   update synchronously when playback ends. If the request fails, the
   position is lost — Kodi has no local queue. This is by design (the
   alternative is silent drift) but it means the first thing to check
   after a backend outage is whether your last-watched position survived.

### Add-on does not appear in the Video add-ons list after install

1. *Settings → System → Add-ons → Manage dependencies* — make sure
   `inputstream.adaptive` is enabled (not just installed).
2. Kodi log at `~/.kodi/temp/kodi.log` will have a `Failed to load
   plugin.video.nstreams` line with the actual exception. The most common
   cause is Kodi 20 — confirm the version under *Settings → System →
   System information*.

---

## 6. Architecture

```
┌──────────────────────────┐
│  Kodi 21 (Pi 3B+)        │
│  ┌────────────────────┐  │
│  │ plugin.video.nstreams (Python 3)
│  │   • menu rendering │  │
│  │   • settings       │  │
│  │   • HTTPS to API   │  │
│  └─────────┬──────────┘  │
│            │ stream URL  │
│            ▼             │
│  inputstream.adaptive    │
│            │             │
│            ▼             │
│  Kodi VideoPlayer        │
│  (V4L2-M2M H.264 decode) │
└──────────────────────────┘
             ▲
             │ raw HLS .m3u8
             │
┌────────────┴─────────────┐
│  Railway backend (Node)  │
│  electron/server/        │
│  ┌────────────────────┐  │
│  │ routes/content.js  │  │ /api/scrape/availability
│  │                    │  │ /api/content/:id
│  │                    │  │ /api/content/:id/season/:n
│  │                    │  │ /api/content/:id/anime-episodes
│  ├────────────────────┤  │
│  │ routes/watchlist.js│  │ /api/watchlist/:userId
│  ├────────────────────┤  │
│  │ routes/users.js    │  │ /api/users
│  ├────────────────────┤  │
│  │ routes/sessions.js │  │ POST /api/sessions/start (resume)
│  ├────────────────────┤  │
│  │ scrapers.js        │  │ PROVIDERS + miruro/vidsrc/embedsu builders
│  │                    │  │ Cheerio HTML scrape → raw HLS URL
│  ├────────────────────┤  │
│  │ database.js        │  │ better-sqlite3, shared with desktop/Android
│  └────────────────────┘  │
└──────────────────────────┘
             │
             │ outbound HTTPS to provider sites
             ▼
   miruro / vidsrc / embedsu
```

### Why the extractor lives on the backend

The same logic powers the Electron desktop client and the Android (Capacitor)
client. Three things follow from that:

- **One scraper, three frontends.** When a provider site changes, the fix
  ships in `scrapers.js` and every client benefits the next time the Railway
  service restarts. The Kodi add-on does not need to be rebuilt or
  re-installed.
- **The Pi never runs Cheerio.** Cheerio plus the dependent Node runtime is
  ~50 MB of resident memory we do not have to spend on a 1 GB device. Pi
  RAM is reserved for Kodi and the video decoder.
- **HLS URLs are short-lived.** The backend can refresh a URL on demand
  without dragging the client through another full extraction. If a stream
  401s mid-playback, the add-on re-asks the backend and `inputstream.adaptive`
  resumes from the new manifest URL with almost no visible glitch.

### Why `inputstream.adaptive` and not the Kodi built-in HLS player

Kodi's built-in `ffmpeg`-based HLS reader works fine for low-bitrate streams
but does not pick up the Pi's hardware H.264 decoder reliably. Pushing the
manifest through `inputstream.adaptive` makes Kodi treat the stream the way
it treats a Widevine DASH source — it negotiates representations, prefetches
segments aggressively, and (critically) hands the elementary stream to the
hardware decoder via the V4L2-M2M codec wrapper. On a Pi 3B+ that is the
difference between 1080p30 hardware-decoded playback at ~25 % CPU and
software 1080p that pegs all four cores and still drops frames.

### Why server-side scrape and not a thin add-on that hits providers directly

Two reasons. First, the providers fingerprint clients — a Python `requests`
call with a stock user-agent gets blocked almost immediately, and replicating
the desktop client's spoofing in Python doubles the surface area we have to
maintain. Second, the backend already does this work for the desktop and
Android clients. Splitting the extractor across Node and Python would mean
fixing every provider change twice. The add-on's only job is "ask the backend
for a URL and hand it to `inputstream.adaptive`" and that is what makes it
small enough to ship in a few hundred lines of Python.

### Resume and session model

The add-on calls `POST /api/sessions/start` with the same payload the
desktop client uses (`user_id`, `content_id`, `season`, `episode`, `position`,
`duration`). The backend writes through to the `sessions` table in the
shared SQLite database. When the add-on opens an episode, it reads the same
row to find the resume offset and passes it to Kodi as the playback start
position. The net effect is that you can start an episode on the desktop,
pause it, and pick up exactly where you left off on the Pi a minute later —
no extra sync step.

---

## License & credits

Same license as the parent N Streams repository.

The add-on talks only to your configured backend; it does not phone home to
Anthropic, the add-on author, or any analytics service. Provider sites
(`miruro`, `vidsrc`, `embedsu`) are contacted by the **backend** on your
behalf — your Pi's IP address is not exposed to them. If you self-host the
backend, you are responsible for the legal posture of those provider
requests in your jurisdiction.
