"""
Kodi list-building helpers for the N Streams addon.

One function per screen. Each takes the Kodi plugin `handle` (int) and
an `api` object (see lib/api.py) that wraps the Railway backend, plus
whatever extra params the screen needs.

The build_* helpers do three things:
  1. Call the backend to get the rows for the screen.
  2. Turn each row into a Kodi ListItem with art + metadata.
  3. addDirectoryItem + endOfDirectory to commit the directory.

Kodi 21 (Omega) modern APIs only:
  • ListItem(label=..., offscreen=True) — `offscreen=True` skips a
    synchronous skin notify on every item, ~3x faster building on Pi.
  • setArt({...}) for posters / thumbs / fanart / icons.
  • InfoTagVideo setter methods via getVideoInfoTag() — setInfo() is
    deprecated in v20 and slated for removal.
"""

from urllib.parse import urlencode

import xbmcgui
import xbmcplugin

ADDON_ID = 'plugin.video.nstreams'

# ─── URL helpers ──────────────────────────────────────────────

def url_for(action, **params):
    """Build a plugin:// callback URL for the given action.

    Filters out None values so optional params (season=, query=, …) drop
    cleanly out of the URL rather than turning into the literal string
    'None'.
    """
    clean = {k: v for k, v in params.items() if v is not None}
    qs = urlencode({'action': action, **clean})
    return 'plugin://{}/?{}'.format(ADDON_ID, qs)


# ─── Art helpers ──────────────────────────────────────────────

# TMDB serves three image sizes we care about: w500 (posters), w780
# (stills / backdrops), original (fanart). Building the URL once here
# keeps the row builders below readable.
TMDB_IMG = 'https://image.tmdb.org/t/p'


def _img(path, size='w500'):
    """Resolve a TMDB image path or pass through full URLs.

    Backend rows store either a TMDB path ('/abc.jpg') or, for
    AniList-sourced episode thumbnails, an already-absolute URL. Pass
    those through untouched.
    """
    if not path:
        return ''
    if path.startswith('http://') or path.startswith('https://'):
        return path
    return '{}/{}{}'.format(TMDB_IMG, size, path)


def _set_art(li, *, poster=None, thumb=None, fanart=None, icon=None):
    """setArt with only the keys we actually have — Kodi ignores empties
    but ListItem.setArt drops *all* keys to the default if you pass
    falsy values, so filter first."""
    art = {}
    if poster: art['poster'] = poster
    if thumb:  art['thumb']  = thumb
    if fanart: art['fanart'] = fanart
    if icon:   art['icon']   = icon
    if art:
        li.setArt(art)


# ─── InfoTagVideo helpers ─────────────────────────────────────

def _set_video_info(li, *, title=None, plot=None, year=None, rating=None,
                    duration=None, premiered=None, mediatype=None,
                    season=None, episode=None, tvshow=None, genres=None,
                    cast=None):
    """Populate ListItem video info via the modern InfoTagVideo setters.

    setInfo() works in Omega but is deprecated; setters are forward-
    compatible to Kodi 22+. Each setter is wrapped in a None-guard so
    callers can pass through whatever the backend gave them without
    pre-filtering.

    `duration` is in seconds (Kodi convention). Callers passing TMDB
    runtime (minutes) must multiply by 60 themselves — see
    `build_episodes`.
    """
    tag = li.getVideoInfoTag()
    if title is not None:     tag.setTitle(title)
    if plot is not None:      tag.setPlot(plot)
    if year is not None:      tag.setYear(int(year))
    if rating is not None:    tag.setRating(float(rating))
    if duration is not None:  tag.setDuration(int(duration))
    if premiered is not None: tag.setPremiered(premiered)
    if mediatype is not None: tag.setMediaType(mediatype)
    if season is not None:    tag.setSeason(int(season))
    if episode is not None:   tag.setEpisode(int(episode))
    if tvshow is not None:    tag.setTvShowTitle(tvshow)
    if genres:
        # Accept either a list (TMDB) or a comma-joined string (our DB).
        if isinstance(genres, str):
            genres = [g.strip() for g in genres.split(',') if g.strip()]
        tag.setGenres(genres)
    if cast:
        # Cast strings like "Bryan Cranston, Aaron Paul" → Actor list.
        actors = []
        if isinstance(cast, str):
            cast = [c.strip() for c in cast.split(',') if c.strip()]
        for name in cast:
            actors.append(xbmcgui.Actor(name))
        if actors:
            tag.setCast(actors)


def _add_directory(handle, *, url, li, is_folder=True):
    xbmcplugin.addDirectoryItem(handle=handle, url=url,
                                listitem=li, isFolder=is_folder)


def _new_item(label, *, plot=None):
    """Shorthand for the menu-style ListItems used on the home screen."""
    li = xbmcgui.ListItem(label=label, offscreen=True)
    if plot:
        _set_video_info(li, title=label, plot=plot)
    return li


# ─── Build: home ──────────────────────────────────────────────

def end_empty(handle):
    """Close the directory cleanly with no rows. Used by every cancel/
    error path so Kodi pops back to the previous folder instead of
    spinning forever — the router relies on this being defined even
    when nothing got rendered.
    """
    xbmcplugin.endOfDirectory(handle, succeeded=True, cacheToDisc=False)


def build_home(handle, api):
    """Root menu. Top item is the active-user chip so the crew can
    see at a glance who's being credited for activity + swap in one
    click. Activity reporting (sessions, episode progress) on the
    backend hangs off the active user id — get that wrong and watch
    history lands on the wrong avatar in the desktop app.
    """
    # The active user's display name is cached in addon settings at
    # pick-time so building the home menu never blocks on /api/users.
    # On a Pi 3B+ with Railway cold-starting, that single GET was
    # adding 2-3s to every back-button press.
    try:
        import xbmcaddon
        active_name = (xbmcaddon.Addon().getSettingString('active_user_name') or '').strip()
    except Exception:
        active_name = ''
    if not active_name:
        active_name = 'Pick a user'

    entries = [
        ('Watching as: {}'.format(active_name),
         'Tap to switch crew member — controls who gets credit for activity',
         url_for('switch_user')),
        ('Continue Watching', "Shows you started but haven't finished",
         url_for('watchlist', status='watching')),
        ('My List',           "Everything you've added",
         url_for('watchlist', status='all')),
        ('Plan to Watch',     'Saved for later',
         url_for('watchlist', status='plan_to_watch')),
        ('Search',            'Find any title',
         url_for('search')),
        ('Settings',          'Backend URL, playback options',
         url_for('settings')),
    ]

    for label, plot, url in entries:
        li = _new_item(label, plot=plot)
        _add_directory(handle, url=url, li=li, is_folder=True)

    xbmcplugin.endOfDirectory(handle, succeeded=True, cacheToDisc=False)


# ─── Build: watchlist ─────────────────────────────────────────

# Backend status enum → human label for the screen title.
_STATUS_LABELS = {
    'watching':      'Continue Watching',
    'plan_to_watch': 'Plan to Watch',
    'completed':     'Completed',
    'dropped':       'Dropped',
    'on_hold':       'On Hold',
    'all':           'My List',
}


def build_watchlist(handle, api, status='all'):
    """Render the active user's watchlist filtered by `status`. The
    api client carries the user id internally — passing it again here
    would just create a way for caller/instance to disagree.
    """
    rows = api.get_watchlist(status=status) or []

    xbmcplugin.setPluginCategory(handle, _STATUS_LABELS.get(status, 'My List'))
    xbmcplugin.setContent(handle, 'tvshows')

    for row in rows:
        content_id = row.get('content_id') or row.get('id')
        title      = row.get('title') or 'Untitled'
        is_anime   = bool(row.get('is_anime'))
        kind       = row.get('type') or ('anime' if is_anime else 'tv')

        # Decorate title with current progress when watching a series.
        cs = row.get('current_season') or 1
        ce = row.get('current_episode') or 0
        if kind != 'movie' and ce:
            label = '{}  ·  S{:d}E{:d}'.format(title, int(cs), int(ce))
        else:
            label = title

        li = xbmcgui.ListItem(label=label, offscreen=True)
        _set_art(
            li,
            poster=_img(row.get('poster_path')),
            thumb=_img(row.get('poster_path')),
            fanart=_img(row.get('backdrop_path'), size='w780'),
        )
        _set_video_info(
            li,
            title=title,
            plot=row.get('overview'),
            year=row.get('release_year'),
            rating=row.get('user_rating') or row.get('rating'),
            mediatype='movie' if kind == 'movie' else 'tvshow',
        )

        # Drill-in target by content kind.
        if kind == 'movie':
            url = url_for('sources', content_id=content_id, season=1, episode=1)
            is_folder = True   # sources screen is still a directory
        elif is_anime or kind == 'anime':
            url = url_for('anime_episodes', content_id=content_id)
            is_folder = True
        else:
            url = url_for('seasons', content_id=content_id)
            is_folder = True

        _add_directory(handle, url=url, li=li, is_folder=is_folder)

    xbmcplugin.addSortMethod(handle, xbmcplugin.SORT_METHOD_LABEL_IGNORE_THE)
    xbmcplugin.addSortMethod(handle, xbmcplugin.SORT_METHOD_VIDEO_YEAR)
    xbmcplugin.endOfDirectory(handle, succeeded=True, cacheToDisc=False)


# ─── Build: seasons ───────────────────────────────────────────

def build_seasons(handle, api, content_id):
    """List of seasons for a TV show.

    `api.get_content(content_id)` returns the row from /api/content/:id
    which carries a `seasons` JSON blob backfilled from TMDB. We parse
    it lazily — older rows just had a `total_seasons` count, so we fall
    back to synthesising 1..N stubs in that case.
    """
    content = api.get_content(content_id) or {}
    title = content.get('title') or 'Show'

    xbmcplugin.setPluginCategory(handle, '{} · Seasons'.format(title))
    xbmcplugin.setContent(handle, 'seasons')

    seasons_json = content.get('seasons')
    seasons = []
    if seasons_json:
        # Backend stores the TMDB seasons array as a JSON string.
        if isinstance(seasons_json, str):
            import json as _json
            try:
                seasons = _json.loads(seasons_json) or []
            except (ValueError, TypeError):
                seasons = []
        elif isinstance(seasons_json, list):
            seasons = seasons_json

    if not seasons:
        # Pre-migration fallback: synthesise from total_seasons.
        total = content.get('total_seasons') or 0
        seasons = [{'season_number': n, 'name': 'Season {}'.format(n)}
                   for n in range(1, int(total) + 1)]

    fanart = _img(content.get('backdrop_path'), size='w780')

    for s in seasons:
        # TMDB ships season 0 as "Specials"; surface that but de-prioritise.
        num = s.get('season_number')
        if num is None:
            continue
        name = s.get('name') or ('Specials' if num == 0 else 'Season {}'.format(num))
        ep_count = s.get('episode_count')
        if ep_count:
            label = '{}  ·  {} episodes'.format(name, ep_count)
        else:
            label = name

        li = xbmcgui.ListItem(label=label, offscreen=True)
        _set_art(
            li,
            poster=_img(s.get('poster_path')) or _img(content.get('poster_path')),
            thumb=_img(s.get('poster_path')) or _img(content.get('poster_path')),
            fanart=fanart,
        )
        _set_video_info(
            li,
            title=name,
            plot=s.get('overview') or content.get('overview'),
            season=num,
            tvshow=title,
            mediatype='season',
            premiered=s.get('air_date'),
        )

        url = url_for('episodes', content_id=content_id, season=num)
        _add_directory(handle, url=url, li=li, is_folder=True)

    xbmcplugin.endOfDirectory(handle, succeeded=True, cacheToDisc=False)


# ─── Build: episodes (TV — TMDB) ──────────────────────────────

def build_episodes(handle, api, content_id, season):
    """Episode list for a single TV season.

    Pulled from GET /api/content/:id/season/:n which proxies TMDB
    and is cached server-side. Episode rows carry name, overview,
    runtime (minutes), still_path, air_date, rating.
    """
    season = int(season)
    data = api.get_season(content_id, season) or {}
    episodes = data.get('episodes') or []
    content = api.get_content(content_id) or {}

    show_title = content.get('title') or 'Show'
    fanart = _img(content.get('backdrop_path'), size='w780')

    xbmcplugin.setPluginCategory(handle, '{} · Season {}'.format(show_title, season))
    xbmcplugin.setContent(handle, 'episodes')

    for ep in episodes:
        ep_num = ep.get('episode_number')
        if ep_num is None:
            continue
        ep_name = ep.get('name') or 'Episode {}'.format(ep_num)
        label = '{:d}. {}'.format(int(ep_num), ep_name)

        li = xbmcgui.ListItem(label=label, offscreen=True)

        # Prefer the large still (TMDB w780) for thumb; fall back to
        # the smaller one or the season poster.
        thumb = (_img(ep.get('still_path_large'), size='w780')
                 or _img(ep.get('still_path'))
                 or _img(content.get('poster_path')))
        _set_art(
            li,
            poster=_img(content.get('poster_path')),
            thumb=thumb,
            fanart=fanart,
        )

        runtime_min = ep.get('runtime')
        duration_s = int(runtime_min) * 60 if runtime_min else None

        _set_video_info(
            li,
            title=ep_name,
            plot=ep.get('overview'),
            rating=ep.get('rating'),
            duration=duration_s,
            premiered=ep.get('air_date'),
            season=season,
            episode=ep_num,
            tvshow=show_title,
            mediatype='episode',
        )

        url = url_for('sources', content_id=content_id,
                      season=season, episode=ep_num)
        # Sources screen is itself a directory of providers.
        _add_directory(handle, url=url, li=li, is_folder=True)

    xbmcplugin.endOfDirectory(handle, succeeded=True, cacheToDisc=False)


# ─── Build: anime episodes (flat) ─────────────────────────────

def build_anime_episodes(handle, api, content_id):
    """Flat episode list for anime — no season grouping.

    GET /api/content/:id/anime-episodes returns a single pseudo-season
    (season_number 1) built from AniList, or a placeholder 1..N stub
    when AniList resolution fails. Either way the row shape matches
    the TMDB season payload, so the rendering logic mirrors
    build_episodes but skips the season chrome.
    """
    data = api.get_anime_episodes(content_id) or {}
    episodes = data.get('episodes') or []
    content = api.get_content(content_id) or {}

    title = content.get('title') or 'Anime'
    fanart = _img(content.get('backdrop_path'), size='w780')

    xbmcplugin.setPluginCategory(handle, '{} · Episodes'.format(title))
    xbmcplugin.setContent(handle, 'episodes')

    for ep in episodes:
        ep_num = ep.get('episode_number')
        if ep_num is None:
            continue
        ep_name = ep.get('name') or 'Episode {}'.format(ep_num)
        label = '{:d}. {}'.format(int(ep_num), ep_name)

        li = xbmcgui.ListItem(label=label, offscreen=True)

        # AniList thumbnails arrive as absolute URLs — _img passes them
        # through; missing → show poster as a fallback.
        thumb = (_img(ep.get('still_path_large'))
                 or _img(ep.get('still_path'))
                 or _img(content.get('poster_path')))
        _set_art(
            li,
            poster=_img(content.get('poster_path')),
            thumb=thumb,
            fanart=fanart,
        )

        runtime_min = ep.get('runtime')
        duration_s = int(runtime_min) * 60 if runtime_min else None

        _set_video_info(
            li,
            title=ep_name,
            plot=ep.get('overview'),
            duration=duration_s,
            premiered=ep.get('air_date'),
            season=1,
            episode=ep_num,
            tvshow=title,
            mediatype='episode',
        )

        # Anime backend treats season as 1 for AniList-sourced lists.
        url = url_for('sources', content_id=content_id,
                      season=1, episode=ep_num)
        _add_directory(handle, url=url, li=li, is_folder=True)

    xbmcplugin.endOfDirectory(handle, succeeded=True, cacheToDisc=False)


# ─── Build: sources ───────────────────────────────────────────

# Providers we know how to extract raw HLS for — the backend's
# /api/stream/:provider returns a direct stream_url for these. Anything
# else goes through the Chromium fallback path.
STREAM_PROVIDERS = {'miruro', 'vidsrc', 'embedsu'}


def build_sources(handle, api, content_id, season, episode):
    """Provider list for one episode (or a movie's single source set).

    GET /api/scrape/availability/:contentId is the existing endpoint;
    it returns a results[] array with provider, site_url, match_score,
    note, image. Each row becomes a non-folder ListItem whose URL is
    `action=play` so the addon dispatcher can call /api/stream/... and
    hand a resolved HLS URL to inputstream.adaptive.

    Match score, provider note, and an extraction hint live in the
    label so the user can pick the lightest provider on a Pi 3B+ —
    raw HLS (~100 MB RAM via inputstream.adaptive) beats embed in
    Chromium (~500 MB) every time.
    """
    season = int(season) if season is not None else None
    episode = int(episode) if episode is not None else None

    payload = api.get_availability(content_id,
                                   season=season, episode=episode) or {}
    results = payload.get('results') or []
    content = api.get_content(content_id) or {}

    title = payload.get('title') or content.get('title') or 'Sources'
    if season and episode and content.get('type') != 'movie':
        cat_title = '{} · S{:d}E{:d}'.format(title, season, episode)
    else:
        cat_title = title

    xbmcplugin.setPluginCategory(handle, cat_title)
    # 'videos' is the most permissive content type for mixed source
    # rows — Kodi won't try to fetch per-episode metadata for them.
    xbmcplugin.setContent(handle, 'videos')

    if not results:
        # Show a single non-actionable row rather than an empty list —
        # users land here from a back-button so an empty directory is
        # confusing.
        li = xbmcgui.ListItem(label='No sources found', offscreen=True)
        _set_video_info(
            li,
            title='No sources found',
            plot=('No providers returned a match for this episode. '
                  'Try a different episode, or open the show in the '
                  'web UI to file a manual link.'),
        )
        _add_directory(handle, url=url_for('noop'), li=li, is_folder=False)
        xbmcplugin.endOfDirectory(handle, succeeded=True, cacheToDisc=False)
        return

    fanart = _img(content.get('backdrop_path'), size='w780')

    for r in results:
        provider = r.get('provider') or ''
        provider_name = r.get('provider_name') or provider or 'Source'
        score = r.get('match_score')
        note = r.get('note')

        # Tag rows that support raw HLS extraction — these play on Pi
        # without spinning up Chromium, which is the whole point.
        native = provider in STREAM_PROVIDERS

        bits = [provider_name]
        if score is not None:
            bits.append('{}% match'.format(int(score)))
        if native:
            bits.append('Direct HLS')
        else:
            bits.append('Browser fallback')
        label = '  ·  '.join(bits)

        li = xbmcgui.ListItem(label=label, offscreen=True)
        # The provider's own image (TMDB poster from the result row) is
        # the same poster as the show — use it as the thumb so the row
        # has a face.
        poster = _img(r.get('image') or content.get('poster_path'))
        _set_art(li, poster=poster, thumb=poster, fanart=fanart)

        plot_lines = []
        if note:
            plot_lines.append(note)
        plot_lines.append('Provider: {}'.format(provider_name))
        if score is not None:
            plot_lines.append('Match: {}%'.format(int(score)))
        plot_lines.append(
            'Playback: inputstream.adaptive (native, hardware-decoded)'
            if native else
            'Playback: Chromium fallback (heavier — last resort on Pi)'
        )
        _set_video_info(
            li,
            title=label,
            plot='\n'.join(plot_lines),
            mediatype='video',
        )
        # Playable, not a folder.
        li.setProperty('IsPlayable', 'true')

        # The dispatcher picks the path:
        #   • native providers → /api/stream/:provider → HLS resolve
        #   • everything else → Chromium fallback action
        action = 'play' if native else 'play_fallback'
        url = url_for(
            action,
            provider=provider,
            content_id=content_id,
            season=season,
            episode=episode,
            site_url=r.get('site_url'),
            title=title,
        )
        _add_directory(handle, url=url, li=li, is_folder=False)

    xbmcplugin.endOfDirectory(handle, succeeded=True, cacheToDisc=False)


# ─── Build: search ────────────────────────────────────────────

def build_search(handle, api, query):
    """Render TMDB search results.

    Hits GET /api/search?q=... which returns a multi-type TMDB list
    with media_type ('movie' | 'tv' | 'person'). We drop people and
    surface the rest. Each row's click adds the title to the user's
    watchlist *then* drills into seasons/anime-episodes/sources —
    that 'add then drill' is wrapped inside the dispatcher's
    `pick_from_search` action so this builder only carries the
    content_kind hint in the URL.
    """
    query = (query or '').strip()
    xbmcplugin.setPluginCategory(handle, 'Search · {}'.format(query) if query else 'Search')
    xbmcplugin.setContent(handle, 'videos')

    if not query:
        li = xbmcgui.ListItem(label='Enter a search term', offscreen=True)
        _add_directory(handle, url=url_for('search_prompt'), li=li, is_folder=True)
        xbmcplugin.endOfDirectory(handle, succeeded=True, cacheToDisc=False)
        return

    results = api.search(query) or []
    # Filter to playable types only — person rows are dead ends in this
    # addon (no actor-filmography screen).
    results = [r for r in results
               if (r.get('media_type') or r.get('type')) in ('movie', 'tv', 'anime')]

    if not results:
        li = xbmcgui.ListItem(label='No results for "{}"'.format(query),
                              offscreen=True)
        _set_video_info(
            li,
            title='No results',
            plot=('TMDB returned nothing for "{}". Try a shorter query '
                  'or the original-language title.').format(query),
        )
        _add_directory(handle, url=url_for('noop'), li=li, is_folder=False)
        xbmcplugin.endOfDirectory(handle, succeeded=True, cacheToDisc=False)
        return

    for r in results:
        media_type = r.get('media_type') or r.get('type') or 'movie'
        # TMDB exposes title for movies, name for tv. Backend already
        # normalises to `title` in most paths but search proxies raw.
        title = r.get('title') or r.get('name') or 'Untitled'
        # Release year — TMDB returns release_date (movie) or
        # first_air_date (tv) as YYYY-MM-DD strings.
        date = r.get('release_date') or r.get('first_air_date') or ''
        year = None
        if len(date) >= 4 and date[:4].isdigit():
            year = int(date[:4])

        label = '{}  ·  {}'.format(title, year) if year else title

        li = xbmcgui.ListItem(label=label, offscreen=True)
        _set_art(
            li,
            poster=_img(r.get('poster_path')),
            thumb=_img(r.get('poster_path')),
            fanart=_img(r.get('backdrop_path'), size='w780'),
        )
        _set_video_info(
            li,
            title=title,
            plot=r.get('overview'),
            year=year,
            rating=r.get('vote_average'),
            mediatype='movie' if media_type == 'movie' else 'tvshow',
        )

        # `pick_from_search` adds to content + watchlist server-side
        # then redirects to seasons / anime_episodes / sources based on
        # the resolved row. We forward the tmdb_id + kind so the
        # dispatcher doesn't have to re-hit TMDB.
        url = url_for(
            'pick_from_search',
            tmdb_id=r.get('id') or r.get('tmdb_id'),
            kind=media_type,
            title=title,
        )
        _add_directory(handle, url=url, li=li, is_folder=True)

    xbmcplugin.endOfDirectory(handle, succeeded=True, cacheToDisc=False)
