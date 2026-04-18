# N Streams 📺

Desktop streaming hub for the N Games crew — Ke'Shawn, Sean, Amari, Dart.

Track what you're watching across every service, see where to watch anything, sync your MAL/AniList lists, and run **synced watch parties** across Netflix / Disney+ / Crunchyroll / anywhere with a `<video>` element.

## Stack

Electron · React · Vite · TailwindCSS · Node.js · Express · SQLite (better-sqlite3) · WebSocket relay on Railway

## Monorepo layout

```
NStreams/
├── electron/      # Electron main process, local Express server, viewer preload
├── src/           # React frontend (Vite)
├── relay/         # Watch Party WebSocket relay (deploy to Railway)
└── public/
```

## Getting started (desktop app)

```bash
npm install
npm run dev
```

Vite dev: `http://localhost:5173` · Local API: `http://localhost:57832`

Open **Settings** and configure:
1. **TMDB API key** — free at https://www.themoviedb.org/settings/api
2. **MAL Client ID** — free at https://myanimelist.net/apiconfig *(per-user)*
3. **AniList Client ID** — free at https://anilist.co/settings/developer *(per-user)*
4. **Relay URL** — paste the Railway URL from the relay deploy below

## Deploy the Watch Party relay

The relay is a small stateless WebSocket + REST service in `relay/`. Deploy it to Railway, Fly.io, Render, or anywhere that runs Node.

### Railway (easiest)

1. Railway dashboard → **New Service** → **Deploy from GitHub repo** → pick this repo
2. **Root directory** → `relay`
3. Railway auto-detects Node via nixpacks, runs `npm install && node index.js`
4. Once deployed, copy the public URL (e.g. `https://nstreams-relay-production.up.railway.app`)
5. Paste it into **Settings → Watch Party — Relay** on every crew member's machine

### Local dev

```bash
cd relay
npm install
npm run dev      # watches + restarts on :8787
```

## Features

- **TMDB search** + auto "Where to Watch" via TMDB Watch Providers (US region)
- **Netflix-style Browse by Service** — popular titles per streaming service in your catalog, scrollable rows on the Home page
- **MyAnimeList & AniList OAuth sync** — per crew member, auto-syncs every 6 hours
- **Site catalog** — shared, anyone can add, upvote, link to shows
- **In-app viewer** — persistent login session per service, single-click deep-link into the show you want
- **Watch Party** — synced play/pause/seek across every crew member's machine, chat sidebar, reactions, 6-character join codes
- **Crew progress** — see where each friend is in a show, who's ahead/behind
- **Activity feed** across all crew members

## Watch Party architecture

```
[Your Netflix]           [Amari's Crunchyroll]        [Dart's Disney+]
    │ <video> DOM             │ <video> DOM               │ <video> DOM
    │  ↕ viewer-preload.js    │  ↕ viewer-preload.js      │  ↕ viewer-preload.js
[Your Electron] ── WS ── [Railway Relay] ── WS ── [Dart's Electron]
                                │
                                └── WS ── [Amari's Electron]
```

Each Electron app injects `electron/viewer-preload.js` into the streaming service's page. The preload finds the `<video>` element (which is standard HTML5 on every major service — DRM protects the pixels, not the DOM API) and hooks its play/pause/seeking/timeupdate events, sending them through the main process WebSocket to the relay, which fans them out to everyone else in the party.

## DRM caveat

Unsigned Electron builds can't play Widevine-protected content (Netflix, Hulu, Disney+, Max, Prime, etc.). The viewer will load and let you sign in, but pressing Play may fail. Works fully for:

- Crunchyroll (free + premium)
- YouTube
- Tubi, Pluto TV, Freevee
- Plex, Jellyfin
- Any service that doesn't require Widevine L1/L3

For DRM services, use the **"Open externally"** button — it deep-links into your real browser where you're already logged in.

To unlock DRM inside the embedded viewer, sign the Electron build with castlabs EVS (see their docs). Free-tier signings are sufficient for a small crew.

## Build installers

```bash
npm run dist
```

Outputs per-platform installers to `release/`.

## License

MIT
