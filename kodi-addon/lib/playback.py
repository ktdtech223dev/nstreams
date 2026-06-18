# -*- coding: utf-8 -*-
"""
N Streams playback handler — the 'play' action endpoint.

This module owns the bridge between the backend's /api/stream/<provider>
response and Kodi's player. On the happy path the backend hands us a raw
HLS manifest plus the Referer/User-Agent the origin demands; we wire it
into a ListItem and resolve to inputstream.adaptive so Kodi 21 (Omega)
streams natively through libavformat with VideoToolbox/V4L2 hardware
decode — the whole reason the Pi 3B+ Kodi build exists instead of a
Chromium kiosk eating 350+ MB of RAM.

When extraction fails (anti-bot, layout drift, key rotation, etc.) the
backend returns {ok: False, fallback_embed_url}. We resolve the play
request to a null item so Kodi doesn't sit on the spinner, then — if
the user has opted in via settings — shell out to Chromium in kiosk
mode pointed at the embed URL. This keeps the Pi usable when miruro
ships a fresh encryption change at 3 AM without burning 350 MB on every
launch.

Header propagation note (Kodi 21+, inputstream.adaptive ≥ 21.x):
    inputstream.adaptive.stream_headers    -- applied to segment requests
    inputstream.adaptive.manifest_headers  -- applied to the m3u8 fetch
Both take a URL-encoded `Key=Value&Key=Value` string. For HLS the
manifest and segments share an origin so the same header bundle works
for both — we set both properties so a CDN that gates one or the other
behaves consistently.
References:
    https://github.com/xbmc/inputstream.adaptive/wiki/Integration
    https://kodi.wiki/view/Add-on:InputStream_Adaptive
"""

import re
import subprocess
import threading
import time
from urllib.parse import urlencode

import xbmc
import xbmcgui
import xbmcplugin


ADDON_NAME = 'N Streams'
LOG_PREFIX = '[nstreams.playback]'

# inputstream.adaptive in Kodi 21 routes the live decision through this
# addon id; passing it as 'inputstream' on the ListItem replaces the
# legacy 'inputstreamaddon' property (which is still accepted but emits
# a deprecation warning in kodi.log).
INPUTSTREAM_ADDON_ID = 'inputstream.adaptive'

# Background API calls (session start, progress) need a hard ceiling so a
# slow backend can't keep Kodi's idle worker threads alive forever and
# leak RAM on the 1 GB Pi.
BG_THREAD_TIMEOUT_S = 8.0

# How often the optional progress monitor reports playback position back
# to /api/episodes/progress. 30 s matches the web app's heartbeat and is
# infrequent enough not to thrash the Railway instance.
PROGRESS_HEARTBEAT_S = 30.0

# Chromium executable candidates, in preference order. On Raspberry Pi OS
# Bookworm the package is `chromium-browser`; on plain Debian-based Pi
# images and Ubuntu it's `chromium`. Try both so the addon works without
# the user editing PATH.
CHROMIUM_BINARIES = ('chromium-browser', 'chromium')

# Hoster domains the backend (e.g. the goojara extractor) may hand back
# unresolved — these are file-host landing pages, not playable media URLs,
# so they need a pass through script.module.resolveurl before we can feed
# them to Kodi's player. Keep the family list narrow: each entry maps to
# a ResolveURL plugin that's been verified to still work. Matches both
# the apex and any www./cdn./ subdomain, and tolerates the TLD churn these
# sites are infamous for (.com → .ch → .re → .to ...).
KNOWN_HOSTERS_RE = re.compile(
    r'^https?://(?:[\w-]+\.)*'
    r'(?:doodstream|dood|d000d|ds2play|dooood|'
    r'luluvdo|'
    r'wootly|'
    r'streamtape|streamta|stape|tapewithadblock|'
    r'filemoon|moonfile|'
    r'mixdrop|mxdrop|mdy48tn97n|'
    r'streamwish|swhoi|streamwis|'
    r'vidoza|videzz|vidozatv|'
    r'vidmoly|molystream|'
    r'fembed|femax20|feurl|fcdn|embedsito|'
    r'streamplay)'
    r'\.[a-z]{2,6}(?:/|$)',
    re.IGNORECASE,
)


# ── logging ────────────────────────────────────────────────────────────

def _log(msg, level=xbmc.LOGINFO):
    xbmc.log('{0} {1}'.format(LOG_PREFIX, msg), level)


def _notify(message, heading=ADDON_NAME, icon=xbmcgui.NOTIFICATION_INFO, time_ms=4000):
    xbmcgui.Dialog().notification(heading, message, icon, time_ms)


# ── public API ─────────────────────────────────────────────────────────

def fail(handle):
    """
    Resolve to a null item so Kodi releases the spinner.

    Exposed so the router can call us on validation errors (missing
    content_id, etc.) without having to import xbmcplugin itself.
    """
    try:
        xbmcplugin.setResolvedUrl(handle, False, xbmcgui.ListItem())
    except Exception as exc:
        _log('fail() setResolvedUrl threw: {0}'.format(exc), xbmc.LOGERROR)


def play(handle, api, content_id, season=None, episode=None,
         provider=None, embed_url=None, allow_chromium_fallback=False):
    """
    Resolve a play request from the router.

    Flow:
        1. Hit /api/stream/<provider> to extract a raw HLS URL.
        2. On ok=True   -> build a ListItem wired into inputstream.adaptive
                           with per-request Referer/UA and any subtitles,
                           fire-and-forget a session start, resolve True.
        3. On ok=False  -> if the user enabled chromium_fallback, shell out
                           to chromium --kiosk pointed at the embed URL and
                           resolve False (Kodi then exits the play state).
                           Otherwise notify and resolve False.
        4. On APIError  -> notify, resolve False.

    The handle/content_id/season/episode/provider/embed_url args mirror
    the query string the router parsed from Kodi's argv, so this signature
    is locked by the router contract.
    """
    # The router already validates content_id presence and calls fail()
    # before reaching us, but defensive guard for direct invocation
    # (e.g. another addon launching us via RunPlugin).
    if not content_id:
        _log('play() called with empty content_id', xbmc.LOGERROR)
        fail(handle)
        return

    if not provider:
        # Without a provider we can't route to an extractor. This shouldn't
        # happen via the normal Sources screen, but a stale favorite or a
        # context-menu deep link might hit it.
        _notify('No source selected', icon=xbmcgui.NOTIFICATION_WARNING)
        fail(handle)
        return

    # Pi-local extraction first. Railway gets Cloudflare-gated on goojara
    # (and was DNS-filtered on the dead embed providers), but the Pi sits
    # on a residential IP that goojara doesn't bot-flag. When the local
    # extractor returns ok=True we never round-trip through /api/stream;
    # on local failure / missing extractor we fall through to the backend
    # path which carries the cached results.
    response = _try_local_extract(api, provider, content_id, season, episode)
    if response is not None and response.get('ok'):
        _play_native(handle, api, response, content_id, season, episode, provider)
        return

    try:
        response = api.get_stream(provider, content_id,
                                  season=season, episode=episode)
    except Exception as exc:
        # api.APIError is the expected case; catch broad so a malformed
        # JSON response or an unexpected urllib edge case can't take down
        # the whole player UI.
        _log('get_stream({0}) raised: {1}'.format(provider, exc),
             xbmc.LOGERROR)
        _notify(str(exc) or 'Backend error',
                icon=xbmcgui.NOTIFICATION_ERROR)
        fail(handle)
        return

    if not isinstance(response, dict):
        _log('get_stream returned non-dict: {0!r}'.format(response),
             xbmc.LOGERROR)
        _notify('Bad response from backend',
                icon=xbmcgui.NOTIFICATION_ERROR)
        fail(handle)
        return

    if response.get('ok'):
        _play_native(handle, api, response, content_id,
                     season, episode, provider)
    else:
        _play_fallback(handle, response, embed_url,
                       allow_chromium_fallback)


# ── Pi-local extractor dispatch ────────────────────────────────────────

def _try_local_extract(api, provider, content_id, season, episode):
    """Try a Pi-local Python extractor for `provider` before hitting Railway.

    Returns the same shape /api/stream returns on success
    ({ok, stream_url, headers, subtitles, site_url, provider}) so the
    caller can drop the response straight into _play_native. Returns
    None when no local extractor is registered for this provider OR when
    the extractor crashed with a non-ExtractorError (so the backend
    fallback gets a chance).
    """
    try:
        from lib.extractors import LOCAL, ExtractorError
    except Exception as exc:
        _log('lib.extractors unavailable: {0}'.format(exc), xbmc.LOGWARNING)
        return None
    extractor = LOCAL.get(provider)
    if extractor is None:
        return None

    # The extractor needs the full content row (tmdb_id, title, type,
    # release_year). api.get_content is cached so this is cheap on
    # repeat plays.
    try:
        content = api.get_content(content_id)
    except Exception as exc:
        _log('get_content({0}) for local extract failed: {1}'.format(
            content_id, exc), xbmc.LOGWARNING)
        return None

    try:
        result = extractor.extract(content, season, episode)
    except ExtractorError as exc:
        _log('local {0}: {1}'.format(provider, exc), xbmc.LOGINFO)
        return None
    except Exception as exc:
        _log('local {0} crashed: {1}'.format(provider, exc), xbmc.LOGERROR)
        return None

    _log('local {0} OK: {1}'.format(
        provider, (result.get('stream_url') or '')[:80]), xbmc.LOGINFO)
    return {
        'ok': True,
        'stream_url': result.get('stream_url'),
        'headers': result.get('headers') or {},
        'subtitles': result.get('subtitles') or [],
        'site_url': result.get('site_url'),
        'provider': provider,
        'cached': False,
    }


# ── hoster resolution (ResolveURL bridge) ──────────────────────────────

def _resolve_hoster(url, headers):
    """Try ResolveURL on a known hoster URL. Returns playable URL with
    |Referer suffix Kodi VFS handles, or None.

    script.module.resolveurl is declared optional in addon.xml so a
    fresh install on a Kodi instance without the Gujal repo still loads
    the addon. When the import is missing we surface a one-line toast
    directing the user to fix it, instead of the generic "Could not
    resolve stream" message — saves the user a kodi.log dig.
    """
    try:
        import resolveurl
    except ImportError:
        _log("script.module.resolveurl not installed", xbmc.LOGWARNING)
        _notify("Install ResolveURL from the Gujal repo to enable playback",
                icon=xbmcgui.NOTIFICATION_WARNING, time_ms=6000)
        return None
    try:
        hmf = resolveurl.HostedMediaFile(url=url, include_disabled=False,
                                         include_universal=True)
        if not hmf or not hmf.valid_url():
            return None
        resolved = hmf.resolve(return_all=False)
        return resolved if isinstance(resolved, str) and resolved else None
    except Exception as exc:
        _log("resolveurl error: " + str(exc), xbmc.LOGWARNING)
        return None


# ── native HLS via inputstream.adaptive ────────────────────────────────

def _play_native(handle, api, response, content_id, season, episode, provider):
    """
    Build a ListItem pointing at the raw HLS URL, attach inputstream.adaptive
    with the right headers + subtitles, and hand it to Kodi.
    """
    stream_url = response.get('stream_url')
    if not stream_url:
        _log('ok=True but no stream_url in response', xbmc.LOGERROR)
        _notify('No stream URL returned',
                icon=xbmcgui.NOTIFICATION_ERROR)
        fail(handle)
        return

    headers = response.get('headers') or {}
    subtitles = response.get('subtitles') or []

    # If the backend handed us a file-host landing page instead of a
    # ready-to-play manifest (goojara/embedsu-style extractors emit these
    # as a final step because the real CDN URL rotates per-session), route
    # it through script.module.resolveurl before touching inputstream.adaptive.
    # Already-resolved .m3u8 / unknown-host URLs skip this and fall through
    # to the existing HLS path unchanged.
    resolved_has_suffix = False
    if KNOWN_HOSTERS_RE.match(stream_url or ''):
        _log('hoster URL detected, dispatching to resolveurl: {0}'.format(
            stream_url))
        resolved = _resolve_hoster(stream_url, headers)
        if not resolved:
            _notify('Could not resolve stream',
                    icon=xbmcgui.NOTIFICATION_ERROR)
            fail(handle)
            return
        # ResolveURL hands back either a bare URL or a `url|Header=val&...`
        # blob — the suffix takes precedence over inputstream.adaptive's
        # manifest_headers/stream_headers on Kodi VFS, so when it's present
        # we must NOT also push our own header_blob or Kodi gets confused
        # and one of the two header sources silently wins.
        resolved_has_suffix = '|' in resolved
        stream_url = resolved

    # Detect the actual container so we don't ask inputstream.adaptive to
    # demux a progressive MP4. Strip any |Header=... suffix Kodi VFS appends,
    # strip query/fragment, look at the path. Hoster-resolved URLs from
    # doodstream/luluvdo/wootly are MP4; only an .m3u8 path goes to
    # inputstream.adaptive. Without this branch a progressive MP4 hits the
    # HLS demuxer, returns "Playback failed" within 2 seconds, and the user
    # never sees a frame.
    bare = stream_url.split('|', 1)[0].split('#', 1)[0].split('?', 1)[0].lower()
    is_hls = bare.endswith('.m3u8')

    # offscreen=True skips the expensive skin-rendering pass on a
    # ListItem that's only ever going to be handed back through
    # setResolvedUrl — saves ~15-30 ms on the Pi 3B+ where every frame
    # of UI work matters.
    listitem = xbmcgui.ListItem(path=stream_url, offscreen=True)

    if is_hls:
        listitem.setMimeType('application/vnd.apple.mpegurl')
        # setContentLookup(False) tells Kodi to trust the MIME type we just
        # set instead of issuing a HEAD request to sniff Content-Type — some
        # CDNs (vidsrc's in particular) 403 HEAD while happily serving GET,
        # so skipping the probe avoids a spurious "Playback failed" toast.
        listitem.setContentLookup(False)
        listitem.setProperty('inputstream', INPUTSTREAM_ADDON_ID)
        # manifest_type is technically deprecated in Kodi 22 (auto-detected
        # from MIME / URL) but still required in Kodi 21 / inputstream.adaptive
        # 21.x — without it the addon refuses to pick the HLS demuxer.
        listitem.setProperty('inputstream.adaptive.manifest_type', 'hls')

        header_blob = _encode_headers(headers)
        if header_blob and not resolved_has_suffix:
            # Apply to both manifest and segment requests. For HLS the m3u8
            # and .ts/.m4s segments share an origin, so the same Referer/UA
            # works for both — and a CDN that gates one but not the other
            # (cough Cloudflare) won't bite us.
            #
            # Skipped when ResolveURL already returned a `|Referer=...`
            # suffix: the VFS suffix takes precedence anyway, so setting
            # both invites confusing precedence bugs across Kodi 21/22.
            listitem.setProperty('inputstream.adaptive.manifest_headers',
                                 header_blob)
            listitem.setProperty('inputstream.adaptive.stream_headers',
                                 header_blob)
    else:
        # Progressive container (mp4/mkv/webm/ts). Kodi's default ffmpeg
        # player handles these natively — no inputstream.adaptive setup,
        # no manifest_type. setContentLookup(False) still helps when the
        # CDN 403s HEAD probes. Headers ride on the URL suffix only.
        listitem.setContentLookup(False)
        # Only attach our header bundle as a URL suffix when ResolveURL
        # didn't already add one. The goojara Referer wouldn't help a
        # doodstream CDN anyway, but the User-Agent might.
        if not resolved_has_suffix:
            ua = headers.get('User-Agent') or headers.get('user-agent') or ''
            if ua:
                # Single-header suffix, just User-Agent — leave Referer off
                # since hoster CDNs gate on their own origin, not goojara's.
                listitem.setPath(stream_url + '|User-Agent=' + ua)

    if subtitles:
        # Kodi VFS fetches subtitles itself (NOT through inputstream.adaptive)
        # so the stream_headers property doesn't propagate. Use the
        # |Referer=...&User-Agent=... URL suffix syntax Kodi VFS honours so
        # CDNs that gate on Referer (cloudnestra, embed.su) still serve.
        ref = headers.get('Referer') or headers.get('referer') or ''
        ua = headers.get('User-Agent') or headers.get('user-agent') or ''
        suffix = ''
        if ref or ua:
            parts = []
            if ref: parts.append('Referer=' + ref)
            if ua: parts.append('User-Agent=' + ua)
            suffix = '|' + '&'.join(parts)
        urls = [s.get('url') + suffix for s in subtitles
                if isinstance(s, dict) and s.get('url')]
        if urls:
            listitem.setSubtitles(urls)

    # Best-effort metadata for the OSD so the user sees the show title
    # instead of the raw m3u8 path while it's loading. InfoTagVideo is the
    # Kodi 20+ accessor; older setInfo('video', {...}) still works as a
    # belt-and-braces fallback.
    title = response.get('title')
    if title:
        try:
            tag = listitem.getVideoInfoTag()
            tag.setTitle(title)
            if season is not None:
                tag.setSeason(int(season))
            if episode is not None:
                tag.setEpisode(int(episode))
        except Exception:
            # InfoTagVideo isn't available on all Kodi 21 builds yet;
            # fall back to setInfo() so we still get *something* shown.
            try:
                info = {'title': title}
                if season is not None:
                    info['season'] = int(season)
                if episode is not None:
                    info['episode'] = int(episode)
                listitem.setInfo('video', info)
            except Exception:
                pass

    # Tell the backend the user hit play. Non-blocking: a hang on Railway
    # must NEVER hold up the player. The thread is daemonized so it can't
    # outlive Kodi's main process even if the API never returns.
    site_url = response.get('site_url') or response.get('stream_url')
    _fire_and_forget(
        'session-start',
        lambda: api.start_session(content_id, site_url),
    )

    # Hand the long-running service.py the playback context. Plugin
    # scripts exit as soon as setResolvedUrl returns, so without this
    # window-property bridge the ProgressMonitor would have nothing to
    # heartbeat against. Window 10000 (Home) is the standard cross-script
    # property bucket — survives until Kodi shuts down.
    try:
        import json as _json
        ctx_blob = _json.dumps({
            'content_id': content_id,
            'season': season,
            'episode': episode,
            'provider': provider,
            'site_url': site_url,
        })
        xbmcgui.Window(10000).setProperty('nstreams.context', ctx_blob)
    except Exception:
        pass

    xbmcplugin.setResolvedUrl(handle, True, listitem)
    _log('resolved native HLS via {0} for content {1} s{2}e{3}'.format(
        provider, content_id, season, episode))


def _encode_headers(headers):
    """
    Encode a dict of headers into inputstream.adaptive's `K=V&K=V` blob.

    Values are URL-encoded (quote_via=quote) so Referer URLs with '/' and
    ':' don't break the parser, which splits on raw '&' and '='. Empty
    or None values are skipped.

    Returns '' for an empty/missing dict so callers can `if blob:` cleanly.
    """
    if not headers:
        return ''
    cleaned = [(k, v) for k, v in headers.items()
               if k and v is not None and v != '']
    if not cleaned:
        return ''
    # urlencode percent-encodes both keys and values; inputstream.adaptive
    # decodes them again before issuing the HTTP request.
    return urlencode(cleaned)


# ── extractor-failure path (Chromium fallback) ─────────────────────────

def play_fallback(handle, site_url, allow_chromium_fallback):
    """Public entry point for non-native providers in the sources list.

    Unlike `_play_fallback` (which handles `ok:false` from /api/stream
    after an extractor throw), this is called when ui.build_sources
    emits a row for a provider that NSStreams never even attempted to
    extract — e.g. FlixHQ, SFlix. Just spawn Chromium on the embed URL
    directly, or notify+bail if the user has the fallback disabled.
    """
    _play_fallback(
        handle,
        {'fallback_embed_url': site_url, 'error': 'non-native provider'},
        site_url,
        allow_chromium_fallback,
    )


def _play_fallback(handle, response, embed_url, allow_chromium_fallback):
    """
    Handle ok=False from the backend.

    Either spawn a Chromium kiosk on the embed URL (if the user opted in)
    or notify-and-bail. Either way we resolve the play request to a null
    item so Kodi doesn't sit on the spinner.
    """
    err = response.get('error') or 'unknown'
    fallback_url = response.get('fallback_embed_url') or embed_url
    _log('extraction failed: {0} (fallback_url={1})'.format(err, fallback_url),
         xbmc.LOGWARNING)

    if not allow_chromium_fallback:
        _notify('Stream resolver failed — enable browser fallback in settings',
                icon=xbmcgui.NOTIFICATION_WARNING, time_ms=6000)
        fail(handle)
        return

    if not fallback_url:
        _notify('Stream resolver failed and no embed URL available',
                icon=xbmcgui.NOTIFICATION_ERROR, time_ms=6000)
        fail(handle)
        return

    _notify('Stream resolver failed — opening browser fallback',
            icon=xbmcgui.NOTIFICATION_WARNING, time_ms=5000)

    spawned = _spawn_chromium(fallback_url)
    if not spawned:
        _notify('Chromium not found — install chromium-browser',
                icon=xbmcgui.NOTIFICATION_ERROR, time_ms=6000)

    # Even when Chromium launches we still resolve False — Kodi shouldn't
    # try to render the embed URL itself, the browser is handling it now.
    fail(handle)


def _spawn_chromium(url):
    """
    Launch Chromium in kiosk mode pointed at the embed URL.

    Returns True if a binary was found and Popen succeeded. The browser
    runs detached from Kodi so it survives Kodi exiting playback mode.

    Flags:
        --kiosk             fullscreen, no chrome, no exit affordances
        --no-sandbox        required when launched by the kodi user on Pi
                            OS without a setuid sandbox helper installed
        --app=<url>         opens as a chromeless app window so there's
                            no tab bar or omnibox burning RAM on the Pi
        --noerrdialogs      suppress crash/restore prompts that would
                            steal focus from Kodi when the user kills
                            the browser
        --disable-translate disable the translate popup which can also
                            steal focus mid-stream
    """
    flags = [
        '--kiosk',
        '--no-sandbox',
        '--noerrdialogs',
        '--disable-translate',
        '--app={0}'.format(url),
    ]
    for binary in CHROMIUM_BINARIES:
        try:
            # close_fds=True so the child doesn't inherit Kodi's file
            # descriptors — keeps Kodi's GUI socket clean if the browser
            # crashes. start_new_session=True puts Chromium in its own
            # process group so a TERM to Kodi's group doesn't take it down.
            subprocess.Popen(
                [binary] + flags,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                close_fds=True,
                start_new_session=True,
            )
            _log('launched {0} for fallback url'.format(binary))
            return True
        except (OSError, FileNotFoundError) as exc:
            # Wrong binary name on this distro — try the next candidate.
            _log('chromium spawn failed for {0}: {1}'.format(binary, exc),
                 xbmc.LOGDEBUG)
            continue
        except Exception as exc:
            _log('unexpected chromium spawn error for {0}: {1}'.format(binary, exc),
                 xbmc.LOGERROR)
            continue
    return False


# ── background fire-and-forget helper ─────────────────────────────────

def _fire_and_forget(name, fn):
    """
    Run `fn` on a daemon thread and forget about it.

    Wrapped so every background-side-effect call has consistent logging
    and a hard timeout — a hang inside a session POST must never block
    setResolvedUrl, which Kodi treats as a synchronous contract.

    `name` is used purely for log triage.
    """
    def _runner():
        try:
            fn()
        except Exception as exc:
            _log('background {0} failed: {1}'.format(name, exc),
                 xbmc.LOGWARNING)

    t = threading.Thread(target=_runner, name='nstreams-bg-' + name)
    t.daemon = True
    t.start()


# ── optional progress monitor ─────────────────────────────────────────

class ProgressMonitor(xbmc.Monitor):
    """
    Background monitor that heartbeats playback position back to
    /api/episodes/progress.

    NOT started from play() itself — Kodi requires xbmc.Monitor instances
    to live on the addon's main thread to receive callbacks correctly,
    and an addon script invoked via plugin:// exits as soon as
    setResolvedUrl returns. The intended consumer is a long-running
    service.py that imports and runs `monitor_until_stopped()` once at
    Kodi startup. Kept here so the play / progress contract lives in
    one file.

    Usage from a service script:

        from lib import api, playback
        client = api.API(backend_url, active_user_id)
        playback.monitor_until_stopped(client)

    The monitor only acts while xbmc.Player().isPlayingVideo() is True
    and a context (content_id / season / episode) has been registered
    via `set_context(...)`. Without context it stays silent — we don't
    have a reliable way to map a raw HLS URL back to a content row.
    """

    def __init__(self, api_client):
        super(ProgressMonitor, self).__init__()
        self._api = api_client
        self._player = xbmc.Player()
        self._ctx_lock = threading.Lock()
        self._ctx = None  # dict: content_id, season, episode, provider, site_url
        self._last_heartbeat = 0.0

    def _try_pull_context_from_window(self):
        """Plugin scripts can't share Python state with this service —
        they leave the playback context on Window(10000) for us to read
        when playback actually starts. Called from each heartbeat tick."""
        try:
            import json as _json
            blob = xbmcgui.Window(10000).getProperty('nstreams.context')
            if not blob:
                return
            data = _json.loads(blob)
            with self._ctx_lock:
                # Only overwrite if the content changed — avoids resetting
                # _last_heartbeat in the middle of a healthy session.
                if (not self._ctx or
                        self._ctx.get('content_id') != data.get('content_id') or
                        self._ctx.get('episode') != data.get('episode')):
                    self._ctx = data
                    self._last_heartbeat = 0.0
        except Exception:
            pass

    def set_context(self, content_id, season, episode,
                    provider=None, site_url=None):
        """Register what's playing so heartbeats know how to label it."""
        with self._ctx_lock:
            self._ctx = {
                'content_id': content_id,
                'season': season,
                'episode': episode,
                'provider': provider,
                'site_url': site_url,
            }
            self._last_heartbeat = 0.0

    def clear_context(self):
        with self._ctx_lock:
            self._ctx = None

    def _snapshot_context(self):
        with self._ctx_lock:
            return dict(self._ctx) if self._ctx else None

    def onPlayBackStopped(self):
        # Final report (no completed flag — Kodi fires both Stopped and
        # Ended on a natural finish, and we treat Ended as the canonical
        # "they finished it" signal below).
        self._report(force=True, completed=False)
        self.clear_context()

    def onPlayBackEnded(self):
        self._report(force=True, completed=True)
        self.clear_context()

    def _report(self, force=False, completed=False):
        ctx = self._snapshot_context()
        if not ctx:
            return
        if not (force or self._player.isPlayingVideo()):
            return

        try:
            position = float(self._player.getTime())
            duration = float(self._player.getTotalTime())
        except Exception:
            # getTime() throws if the player isn't actually playing —
            # which happens between Stopped and the next play start.
            return

        try:
            self._api.update_episode_progress(
                content_id=ctx['content_id'],
                season_number=ctx['season'],
                episode_number=ctx['episode'],
                last_site_url=ctx.get('site_url'),
                last_position_seconds=int(position),
                last_duration_seconds=int(duration),
                last_provider=ctx.get('provider'),
                completed=True if completed else None,
            )
        except Exception as exc:
            _log('progress report failed: {0}'.format(exc),
                 xbmc.LOGWARNING)

    def run_forever(self):
        """
        Loop until Kodi shuts down, posting a heartbeat every
        PROGRESS_HEARTBEAT_S while video is playing.

        waitForAbort() returns True when Kodi is exiting — that's our
        signal to break cleanly.
        """
        while not self.abortRequested():
            now = time.time()
            if self._player.isPlayingVideo():
                self._try_pull_context_from_window()
                if now - self._last_heartbeat >= PROGRESS_HEARTBEAT_S:
                    self._report(force=False, completed=False)
                    self._last_heartbeat = now
            # waitForAbort sleeps but yields to Kodi's abort signal so we
            # don't waste 30 s of shutdown time on the Pi.
            if self.waitForAbort(5):
                break


def monitor_until_stopped(api_client):
    """
    Entry point for service.py — runs the ProgressMonitor until Kodi
    shuts down. Safe to call from a long-running service script; not
    safe to call from a plugin:// entry point (the script exits before
    the monitor can do anything useful).
    """
    monitor = ProgressMonitor(api_client)
    monitor.run_forever()
