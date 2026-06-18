# N Streams on Raspberry Pi 3B+

A Linux ARM64 `AppImage` of N Streams sized down for the Pi 3B+'s
1 GB RAM. Watch parties and the WebSocket relay are stripped out;
ad blocking, scrapers, embedded player, watchlist, MAL/AniList sync,
DoH, and the cable/sports tabs all stay.

## Goal

Use the Pi as a normal **Raspberry Pi OS Desktop** install that *can
also* run N Streams when you launch it. No kiosk, no auto-start —
double-click the AppImage when you want it.

## One-time setup

1. **Flash Raspberry Pi OS Desktop 64-bit (Bookworm)** with the
   Raspberry Pi Imager. In the advanced options dialog (Ctrl-Shift-X
   in Imager), set:
   - Hostname, Wi-Fi, SSH (handy for headless troubleshooting)
   - User + password
2. Boot the Pi, finish the first-run wizard.
3. Open **Terminal** and install the libs the AppImage needs:
   ```bash
   sudo apt update
   sudo apt install -y libnss3 libgbm1 libasound2 fontconfig fuse libfuse2
   ```
4. Download the AppImage. Replace the version in the URL with the
   latest from
   <https://github.com/ktdtech223dev/nstreams/releases>:
   ```bash
   mkdir -p ~/Applications
   curl -L https://github.com/ktdtech223dev/nstreams/releases/latest/download/N-Streams-1.2.40-arm64.AppImage \
     -o ~/Applications/N-Streams.AppImage
   chmod +x ~/Applications/N-Streams.AppImage
   ```
5. Run it: `~/Applications/N-Streams.AppImage --no-sandbox`
   - The `--no-sandbox` flag is required on Pi OS (no sandbox support
     in unprivileged user namespaces by default).
   - Quit any other heavy apps first — Pi 3B+ shares 1 GB of RAM with
     the desktop and you'll want every MB you can spare for playback.

## TV settings (if connecting to a TV)

If the Pi's image overscans your TV (cropped edges), open
`sudo raspi-config` → Display → Underscan → enable. Reboot.

## Streaming limits to expect

- **H.264 video** plays great — Pi 3B+ has hardware H.264 decode via
  the V3D pipeline.
- **HEVC (H.265) / VP9** software-decodes and will stutter or freeze.
  Stick to providers that ship H.264 — VidSrc/Embed.su/2Embed default
  to H.264.
- **4K** isn't realistic on this hardware. Pick 720p or 1080p sources.

## Remote control

Plug in any USB IR receiver (e.g. Flirc) or pair a Bluetooth media
remote. They emit standard arrow-key events that hit the D-pad nav
already wired into the modal + episode tracker — same code path the
Android projector uses.

## Watch parties

Not available on this build. If you need them, run N Streams on a
desktop / laptop with more RAM and have the Pi join the same Wi-Fi
to follow along.

## Troubleshooting

- **App fails to launch with a sandbox error** — re-run with
  `--no-sandbox`.
- **Player just spins** — same fix as desktop:
  Settings → Secure DNS (DoH) → ensure it's ON. Reboot the app.
- **Streams chug or skip** — try a different source on the same show
  (Embed.su tends to be lighter than VidSrc, sometimes the other way
  around). Disable the ad blocker in Settings for the session if a
  CDN is mis-flagged.
- **High RAM in `htop`** — totally normal. Electron + Chromium uses
  ~500 MB on its own. Avoid running Firefox/Chrome alongside.
