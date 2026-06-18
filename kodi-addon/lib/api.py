# -*- coding: utf-8 -*-
"""
N Streams backend API client for Kodi.

stdlib-only HTTP client (Kodi addons cannot pip-install). Wraps the
Express routes in electron/server/routes/* exposed by the Railway
deployment at https://nstreams-api-production.up.railway.app.

The backend is the source of truth for content, watchlist, episode
progress, availability resolution, and server-side stream extraction.
The addon uses the extracted HLS URL with inputstream.adaptive for
native hardware-accelerated playback on the Pi; the iframe embed URL
is only used when extraction fails and the user has enabled the
Chromium fallback in settings.
"""

import json
import socket
from urllib import request as urlrequest
from urllib import parse as urlparse
from urllib import error as urlerror


DEFAULT_BACKEND_URL = "https://nstreams-api-production.up.railway.app"
USER_AGENT = "NStreams-Kodi/1.0"
# Generous timeout — /api/scrape/availability fans out to all three
# upstream providers and Railway free-tier cold starts alone burn 2-3s.
# Most calls are sub-second; the longer ceiling only matters for the
# slow ones and prevents the "Timeout after 8s" toast that masks healthy
# (just-slow) scrapes.
TIMEOUT_SECONDS = 30


class APIError(Exception):
    """
    Raised on any non-2xx response or transport-level failure.

    Attributes:
        status:   HTTP status code (int) or None for transport errors.
        body:     Decoded response body (str), best-effort.
        endpoint: The path that was requested, for log triage.
    """

    def __init__(self, message, status=None, body=None, endpoint=None):
        super(APIError, self).__init__(message)
        self.status = status
        self.body = body
        self.endpoint = endpoint


class API(object):
    """
    Thin wrapper around the N Streams backend.

    Construct once per addon entry-point with the user's configured
    backend URL and active user id. All read methods return the
    JSON-decoded response; write methods return whatever the backend
    echoes back (usually {ok: True} or the inserted row).
    """

    def __init__(self, backend_url, active_user_id):
        # Strip trailing slash so path joins don't double up.
        self.backend_url = (backend_url or DEFAULT_BACKEND_URL).rstrip("/")
        self.active_user_id = int(active_user_id) if active_user_id else None

    # ─── HTTP plumbing ──────────────────────────────────────────

    def _request(self, method, path, query=None, body=None):
        """
        Single chokepoint for every HTTP call. Builds the URL,
        attaches the User-Agent, enforces TIMEOUT_SECONDS, decodes
        JSON, and converts any non-2xx response into APIError so
        callers don't have to remember to check status codes.
        """
        url = self.backend_url + path
        if query:
            # Drop None values so callers can pass kwargs without
            # filtering — e.g. season=None won't emit '?season='.
            cleaned = {k: v for k, v in query.items() if v is not None}
            if cleaned:
                url = url + "?" + urlparse.urlencode(cleaned)

        data = None
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        }
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = urlrequest.Request(url, data=data, headers=headers, method=method)

        try:
            resp = urlrequest.urlopen(req, timeout=TIMEOUT_SECONDS)
        except urlerror.HTTPError as e:
            # 4xx/5xx — read the body so the error message is useful
            # in kodi.log instead of just "HTTP Error 500: Internal".
            body_text = ""
            try:
                body_text = e.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            raise APIError(
                "HTTP {0} on {1} {2}: {3}".format(e.code, method, path, body_text or e.reason),
                status=e.code,
                body=body_text,
                endpoint=path,
            )
        except urlerror.URLError as e:
            # DNS / TCP / TLS — backend unreachable.
            raise APIError(
                "Network error on {0} {1}: {2}".format(method, path, e.reason),
                status=None,
                body=None,
                endpoint=path,
            )
        except socket.timeout:
            raise APIError(
                "Timeout after {0}s on {1} {2}".format(TIMEOUT_SECONDS, method, path),
                status=None,
                body=None,
                endpoint=path,
            )

        try:
            raw = resp.read()
        finally:
            try:
                resp.close()
            except Exception:
                pass

        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except ValueError as e:
            # Backend should always return JSON; if it didn't, surface
            # the body so we can debug what came back instead.
            raise APIError(
                "Invalid JSON from {0}: {1}".format(path, e),
                status=resp.getcode(),
                body=raw.decode("utf-8", errors="replace"),
                endpoint=path,
            )

    def _get(self, path, query=None):
        return self._request("GET", path, query=query)

    def _post(self, path, body=None):
        return self._request("POST", path, body=body or {})

    # ─── Users ──────────────────────────────────────────────────

    def list_users(self):
        """GET /api/users — used by the user-picker on first run."""
        return self._get("/api/users")

    # ─── Content ────────────────────────────────────────────────

    def add_content(self, tmdb_id, kind, user_id=None):
        """POST /api/content — add a TMDB title to the crew catalog.

        Used by the search-result drilldown so picking an item adds it
        to the crew's library before navigating into seasons / sources.
        Backend is idempotent (returns the existing row if already added).
        """
        uid = user_id if user_id is not None else self.active_user_id
        body = {"tmdb_id": tmdb_id, "type": kind}
        if uid is not None:
            body["user_id"] = uid
        return self._post("/api/content", body)

    # ─── Watchlist ──────────────────────────────────────────────

    def get_watchlist(self, status="watching", user_id=None):
        """
        GET /api/watchlist/{user_id}?status=...

        status: 'watching' | 'plan_to_watch' | 'completed' |
                'on_hold' | 'dropped' | 'all'
        """
        uid = user_id if user_id is not None else self.active_user_id
        if uid is None:
            raise APIError("No active user id configured", endpoint="/api/watchlist")
        return self._get(
            "/api/watchlist/{0}".format(uid),
            query={"status": status},
        )

    # ─── Content detail ────────────────────────────────────────

    def get_content(self, content_id, user_id=None):
        """
        GET /api/content/{id}?user_id=...

        Returns the full content row plus the user's watchlist row
        (current_season, current_episode, last_site_url, etc.) when
        user_id is supplied — which is what the player needs to
        resume from the right episode.
        """
        uid = user_id if user_id is not None else self.active_user_id
        return self._get(
            "/api/content/{0}".format(content_id),
            query={"user_id": uid},
        )

    def get_season(self, content_id, season_number):
        """
        GET /api/content/{id}/season/{n}

        TMDB-backed episode list. 400 if the content has no tmdb_id —
        use get_anime_episodes() instead for MAL-only shows.
        """
        return self._get(
            "/api/content/{0}/season/{1}".format(content_id, season_number)
        )

    def get_anime_episodes(self, content_id):
        """
        GET /api/content/{id}/anime-episodes

        AniList-backed episode list for anime without a TMDB id.
        Always returns season_number=1 with a flat episode array;
        falls back to a placeholder list keyed off total_episodes
        when AniList can't resolve the show.
        """
        return self._get(
            "/api/content/{0}/anime-episodes".format(content_id)
        )

    # ─── Availability + extraction ─────────────────────────────

    def get_availability(self, content_id, season=None, episode=None, user_id=None):
        """
        GET /api/scrape/availability/{id}?user_id=&season=&episode=

        Returns {title, is_anime, season, episode, results: [...]} —
        the list of provider URLs (Miruro, VidSrc, Embed.su, FlixHQ,
        SFlix...) ranked by match score. For anime, season/episode
        are ignored by the resolver (AniList sites embed their own
        episode picker).
        """
        uid = user_id if user_id is not None else self.active_user_id
        return self._get(
            "/api/scrape/availability/{0}".format(content_id),
            query={"user_id": uid, "season": season, "episode": episode},
        )

    def get_stream(self, provider, content_id, season=None, episode=None):
        """
        GET /api/stream/{provider}?content_id=&season=&episode=

        Server-side extraction — this is the whole point of the Pi
        Kodi build. On success returns:
            {ok: True, stream_url: <hls>, headers: {...},
             subtitles: [...], provider, cached}
        On extractor failure returns:
            {ok: False, error, fallback_embed_url, provider}
        — caller should then either iframe the fallback in Chromium
        (if the user enabled it in settings) or surface the error.

        provider must be one of 'miruro', 'vidsrc', 'embedsu'.
        """
        return self._get(
            "/api/stream/{0}".format(provider),
            query={
                "content_id": content_id,
                "season": season,
                "episode": episode,
            },
        )

    # ─── Sessions + episode progress ───────────────────────────

    def start_session(self, content_id, site_url, site_id=None, user_id=None):
        """
        POST /api/sessions/start

        Tells the backend the user just hit Play. Creates/bumps the
        watchlist row, opens a watching_sessions row, fires Discord
        + crew-stats side effects. Returns {session_id, watchlist_id,
        watch_status, last_site_url}.
        """
        uid = user_id if user_id is not None else self.active_user_id
        return self._post("/api/sessions/start", body={
            "user_id": uid,
            "content_id": content_id,
            "site_id": site_id,
            "site_url": site_url,
        })

    def update_episode_progress(self, content_id, season_number, episode_number,
                                last_site_url=None, last_position_seconds=None,
                                last_duration_seconds=None, last_provider=None,
                                completed=None, user_id=None):
        """
        POST /api/episodes/progress

        Upsert for the (user × content × season × episode) progress
        row. Call once at playback start with last_site_url/provider
        so resume sticks per-episode, then periodically with
        last_position_seconds during playback. Pass completed=True
        on episode finish.
        """
        uid = user_id if user_id is not None else self.active_user_id
        payload = {
            "user_id": uid,
            "content_id": content_id,
            "season_number": season_number,
            "episode_number": episode_number,
            "last_site_url": last_site_url,
            "last_provider": last_provider,
            "last_position_seconds": last_position_seconds,
            "last_duration_seconds": last_duration_seconds,
            "completed": completed,
        }
        return self._post("/api/episodes/progress", body=payload)

    # ─── Search ────────────────────────────────────────────────

    def search(self, q, type_="multi"):
        """
        GET /api/search?q=&type=

        Proxies TMDB multi-search. Returns [] when q is empty.
        type_: 'multi' | 'tv' | 'movie'
        """
        return self._get(
            "/api/search",
            query={"q": q, "type": type_},
        )
