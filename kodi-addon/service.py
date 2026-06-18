"""Long-running Kodi service for N Streams.

Plugin entry points (addon.py) exit as soon as setResolvedUrl returns —
they're not allowed to survive past the dispatch tick. The ProgressMonitor
that posts /api/episodes/progress heartbeats needs to live across the
whole playback session, so it runs here instead, started at Kodi login
via the xbmc.service extension point declared in addon.xml.

What it does:
  1. Resolves the active user + backend URL from addon settings.
  2. Spins up a ProgressMonitor instance.
  3. Loops waitForAbort(5) until Kodi shuts down, polling the playback
     context window property each tick. Whenever Kodi is playing video
     AND a context is registered, posts a heartbeat every
     PROGRESS_HEARTBEAT_S to /api/episodes/progress with position +
     duration.
  4. Sends a final report on Stopped (no completed flag) and Ended
     (completed=True) so the desktop "currently watching" tile updates
     in near real time and the crew activity feed shows finishes.

Failures are swallowed — a backend hiccup must never crash the service
or break Kodi navigation.
"""

import xbmc
import xbmcaddon

from lib import api, playback


def _resolve_settings():
    addon = xbmcaddon.Addon()
    try:
        backend_url = (addon.getSettingString('backend_url') or '').strip()
    except Exception:
        backend_url = (addon.getSetting('backend_url') or '').strip()
    try:
        active_user_id = addon.getSettingInt('active_user_id')
    except Exception:
        try:
            active_user_id = int(addon.getSetting('active_user_id') or 0)
        except Exception:
            active_user_id = 0
    return backend_url, active_user_id


def main():
    backend_url, active_user_id = _resolve_settings()
    if not backend_url or not active_user_id:
        # Plugin entry will fire the picker on next launch; nothing for
        # the service to do until the user has picked.
        xbmc.log('[nstreams.service] no backend/user configured — idling',
                 xbmc.LOGINFO)
        # Still keep the service alive so settings changes mid-session
        # can pick up without a Kodi restart.
        monitor = xbmc.Monitor()
        while not monitor.abortRequested():
            if monitor.waitForAbort(30):
                return
            backend_url, active_user_id = _resolve_settings()
            if backend_url and active_user_id:
                break
        else:
            return

    client = api.API(backend_url, active_user_id)
    xbmc.log('[nstreams.service] starting ProgressMonitor for user {}'.format(
        active_user_id), xbmc.LOGINFO)
    playback.monitor_until_stopped(client)


if __name__ == '__main__':
    main()
