# N Streams Kodi addon — URL dispatcher.
#
# Kodi launches the addon by re-invoking this script with three argv:
#   argv[0] = plugin://plugin.video.nstreams/
#   argv[1] = handle id (int) — opaque token the addon must pass back to
#             every xbmcplugin.* call so Kodi knows which directory it is
#             populating. Fresh integer per invocation.
#   argv[2] = query string ('?action=play&content_id=42&...') or '' on cold
#             entry from the home screen. We feed it through parse_qs and
#             dispatch on the 'action' key.
#
# All directory-building lives in lib.ui; this file is just glue. The
# Pi 3B+ is RAM-constrained (1 GB total, Kodi + inputstream.adaptive
# already eat ~250 MB) so we keep imports lazy where Kodi allows and
# avoid pulling in anything heavy at module scope.

import sys
from urllib.parse import parse_qs

import xbmc
import xbmcaddon
import xbmcgui

from lib import api, ui, playback


# Settings keys must match the <setting id="..."> values in
# resources/settings.xml. Kept as constants so a typo surfaces here
# instead of as a silent default-value bug at runtime.
SETTING_ACTIVE_USER_ID = 'active_user_id'
SETTING_ACTIVE_USER_NAME = 'active_user_name'
SETTING_BACKEND_URL = 'backend_url'
SETTING_ALLOW_CHROMIUM_FALLBACK = 'allow_chromium_fallback'

ADDON_NAME = 'N Streams'
LOG_PREFIX = '[nstreams.router]'


def _log(msg, level=xbmc.LOGINFO):
    xbmc.log('{} {}'.format(LOG_PREFIX, msg), level)


def _first(params, key, default=None):
    """parse_qs hands back lists ('?id=42' -> {'id': ['42']}). Almost every
    caller wants the scalar, so unwrap once here instead of at every site."""
    value = params.get(key)
    if not value:
        return default
    return value[0]


def _int(params, key, default=None):
    raw = _first(params, key)
    if raw is None or raw == '':
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        _log('non-int value for {}: {!r}'.format(key, raw), xbmc.LOGWARNING)
        return default


def _bool_setting(addon, key, default=False):
    """getSettingBool is the modern API but raises on older Kodi builds when
    the setting hasn't been written yet. Wrap so a fresh install with no
    settings.xml on disk doesn't crash before the user opens the dialog."""
    try:
        return addon.getSettingBool(key)
    except Exception:
        raw = (addon.getSetting(key) or '').strip().lower()
        if raw in ('true', '1', 'yes'):
            return True
        if raw in ('false', '0', 'no'):
            return False
        return default


def _str_setting(addon, key, default=''):
    try:
        value = addon.getSettingString(key)
    except Exception:
        value = addon.getSetting(key)
    return (value or default).strip()


def _int_setting(addon, key, default=0):
    try:
        return addon.getSettingInt(key)
    except Exception:
        raw = (addon.getSetting(key) or '').strip()
        if not raw:
            return default
        try:
            return int(raw)
        except ValueError:
            return default


def _notify(message, heading=ADDON_NAME, icon=xbmcgui.NOTIFICATION_ERROR, time_ms=5000):
    xbmcgui.Dialog().notification(heading, message, icon, time_ms)


def _switch_user(handle, addon, client):
    """Show 'Who's watching?' picker. Persists choice to settings.

    Returns True if the user picked someone (or one was already set),
    False if they cancelled. Caller decides whether to end the
    directory empty or continue.
    """
    try:
        users = client.list_users() or []
    except Exception as exc:
        _notify('Could not load crew: {}'.format(exc))
        return False

    if not users:
        _notify('Backend returned no users — add one in the desktop app first.')
        return False

    labels = [u.get('display_name') or u.get('name') or 'user {}'.format(u.get('id')) for u in users]
    picked = xbmcgui.Dialog().select("Who's watching?", labels)
    if picked < 0:
        return False

    chosen = users[picked]
    chosen_id = int(chosen.get('id') or 0)
    if not chosen_id:
        _notify('Picked user has no id — backend data is malformed.')
        return False

    try:
        addon.setSettingInt(SETTING_ACTIVE_USER_ID, chosen_id)
    except Exception:
        addon.setSetting(SETTING_ACTIVE_USER_ID, str(chosen_id))

    # Cache the display name as a setting so build_home doesn't have to
    # hit /api/users on every render — that single GET was adding 2-3s
    # of Railway cold-start latency to every back-button press.
    try:
        addon.setSettingString(SETTING_ACTIVE_USER_NAME, labels[picked])
    except Exception:
        addon.setSetting(SETTING_ACTIVE_USER_NAME, labels[picked])

    _notify(
        'Watching as {}'.format(labels[picked]),
        icon=xbmcgui.NOTIFICATION_INFO,
        time_ms=2500,
    )
    return True


def _prompt_search():
    """Modal keyboard. Returns the stripped query or None if the user
    cancelled / submitted an empty string — caller bails in either case."""
    keyboard = xbmc.Keyboard('', 'Search N Streams')
    keyboard.doModal()
    if not keyboard.isConfirmed():
        return None
    query = (keyboard.getText() or '').strip()
    return query or None


def route(argv):
    # ── 1. Parse Kodi's invocation envelope ─────────────────────
    try:
        handle = int(argv[1])
    except (IndexError, ValueError):
        _log('missing/invalid handle in argv: {!r}'.format(argv), xbmc.LOGERROR)
        return

    query_string = argv[2] if len(argv) > 2 else ''
    # parse_qs drops the leading '?' itself, but Kodi sometimes hands us
    # the string with and sometimes without it depending on entry point.
    if query_string.startswith('?'):
        query_string = query_string[1:]
    params = parse_qs(query_string, keep_blank_values=False)

    action = _first(params, 'action', 'home')

    # ── 2. Resolve settings ─────────────────────────────────────
    addon = xbmcaddon.Addon()
    active_user_id = _int_setting(addon, SETTING_ACTIVE_USER_ID, 0)
    backend_url = _str_setting(addon, SETTING_BACKEND_URL, '')
    allow_chromium_fallback = _bool_setting(addon, SETTING_ALLOW_CHROMIUM_FALLBACK, False)

    if not backend_url:
        _notify('Backend URL not set. Open addon settings.', icon=xbmcgui.NOTIFICATION_WARNING)
        addon.openSettings()
        return

    # ── 3. Build API client ─────────────────────────────────────
    client = api.API(backend_url, active_user_id)

    # If no user is picked, force the chooser. We pass the dispatcher
    # through the same path the menu item uses so behavior stays
    # consistent. If the user cancels they end up back here next launch.
    if not active_user_id and action != 'switch_user':
        if not _switch_user(handle, addon, client):
            ui.end_empty(handle)
            return
        # Fall through to whatever action they originally asked for.
        active_user_id = _int_setting(addon, SETTING_ACTIVE_USER_ID, 0)
        client = api.API(backend_url, active_user_id)

    # ── 4. Dispatch ─────────────────────────────────────────────
    try:
        if action in (None, '', 'home'):
            ui.build_home(handle, client)

        elif action == 'watchlist':
            # Status filter is optional; ui resolves the default
            # ('watching' / 'all' / etc.) so we just pass it through.
            status = _first(params, 'status')
            ui.build_watchlist(handle, client, status=status)

        elif action == 'seasons':
            content_id = _int(params, 'content_id')
            if content_id is None:
                _notify('Missing content id')
                return
            ui.build_seasons(handle, client, content_id)

        elif action == 'episodes':
            content_id = _int(params, 'content_id')
            season = _int(params, 'season')
            if content_id is None or season is None:
                _notify('Missing content id or season')
                return
            ui.build_episodes(handle, client, content_id, season)

        elif action == 'anime_episodes':
            content_id = _int(params, 'content_id')
            if content_id is None:
                _notify('Missing content id')
                return
            ui.build_anime_episodes(handle, client, content_id)

        elif action == 'sources':
            content_id = _int(params, 'content_id')
            if content_id is None:
                _notify('Missing content id')
                return
            season = _int(params, 'season')
            episode = _int(params, 'episode')
            ui.build_sources(handle, client, content_id, season=season, episode=episode)

        elif action == 'play':
            content_id = _int(params, 'content_id')
            if content_id is None:
                _notify('Missing content id')
                # Resolve to a null item so Kodi doesn't hang on the spinner.
                playback.fail(handle)
                return
            season = _int(params, 'season')
            episode = _int(params, 'episode')
            provider = _first(params, 'provider')
            embed_url = _first(params, 'embed_url')
            playback.play(
                handle,
                client,
                content_id,
                season=season,
                episode=episode,
                provider=provider,
                embed_url=embed_url,
                allow_chromium_fallback=allow_chromium_fallback,
            )

        elif action in ('search', 'search_prompt'):
            # If the caller already supplied a query (e.g. a saved-search
            # context menu item) skip the keyboard. search_prompt is the
            # ui's "Enter a search term" empty-state row that re-opens
            # the keyboard.
            query = _first(params, 'query')
            if not query:
                query = _prompt_search()
            if not query:
                ui.end_empty(handle)
                return
            ui.build_search(handle, client, query)

        elif action == 'pick_from_search':
            # The user clicked a TMDB search result. Add the title to
            # the crew catalog server-side, then drill into the right
            # screen based on its kind.
            tmdb_id = _int(params, 'tmdb_id')
            kind = _first(params, 'kind') or 'movie'
            if not tmdb_id:
                _notify('Missing tmdb id from search row')
                ui.end_empty(handle)
                return
            try:
                row = client.add_content(tmdb_id, kind)
            except api.APIError as exc:
                _notify('Could not add title: {}'.format(exc))
                ui.end_empty(handle)
                return
            cid = int(row.get('id') or 0) if row else 0
            if not cid:
                _notify('Backend did not return a content id')
                ui.end_empty(handle)
                return
            is_anime = bool(row.get('is_anime')) or kind == 'anime'
            if kind == 'movie':
                ui.build_sources(handle, client, cid, season=None, episode=None)
            elif is_anime:
                ui.build_anime_episodes(handle, client, cid)
            else:
                ui.build_seasons(handle, client, cid)

        elif action == 'play_fallback':
            # Non-native provider — go straight to Chromium kiosk on the
            # embed URL. No /api/stream round-trip first; we already know
            # the extractor doesn't support this provider.
            site_url = _first(params, 'site_url') or _first(params, 'embed_url')
            if not site_url:
                _notify('Missing site URL for browser fallback')
                playback.fail(handle)
                return
            playback.play_fallback(handle, site_url, allow_chromium_fallback)

        elif action == 'noop':
            # Placeholder rows ('No sources found', 'No results') click
            # to this — just close the directory cleanly.
            ui.end_empty(handle)

        elif action == 'switch_user':
            _switch_user(handle, addon, client)
            # Re-render home so the "Watching as: X" chip reflects the pick.
            ui.build_home(handle, api.API(backend_url, _int_setting(addon, SETTING_ACTIVE_USER_ID, 0)))

        elif action == 'settings':
            addon.openSettings()

        else:
            _log('unknown action: {!r}'.format(action), xbmc.LOGWARNING)
            _notify('Unknown action: {}'.format(action), icon=xbmcgui.NOTIFICATION_WARNING)
            ui.end_empty(handle)

    except api.APIError as exc:
        # Backend reachable but returned an error, or the request itself
        # blew up (timeout, JSON decode, etc.). Surface a toast and end
        # the directory so the user isn't stuck on a spinner.
        _log('APIError on action={}: {}'.format(action, exc), xbmc.LOGERROR)
        _notify(str(exc) or 'Backend error')
        if action == 'play':
            playback.fail(handle)
        else:
            ui.end_empty(handle)
        return
