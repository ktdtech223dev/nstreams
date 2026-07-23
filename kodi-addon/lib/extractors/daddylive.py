# -*- coding: utf-8 -*-
"""daddylive (dlhd.st) extractor — Pi-local port of the Node.js daddylive.js.

Why this file exists:
    The classic daddylive.org schedule scrape is dead — the domain was
    seized by Operation Offsides (the body literally reads "THIS DOMAIN
    HAS BEEN SEIZED"). The live site now runs at dlhd.st (dlhd.pk 301s
    onto it) with the same 900-ish 24/7 channel roster and a JSON
    schedule at /schedule/schedule-generated.json. The maintained
    StepDaddyLiveHD script still hardcodes dlhd.dad — that domain is
    NXDOMAIN as of 2026-07-22 — so we probe rather than trust the
    upstream constant.

Flow:
    1. resolve_base() — probe BASE_CANDIDATES in order (parallel fetch,
       ordered pick), plus a cross-check of the StepDaddyLiveHD source on
       GitHub for a fresh `self._base_url = "..."` hint. 6h cache.
    2. list_channels() — parse /24-7-channels.php into [{id, name}]. 24h
       cache. The one guaranteed-live source since schedule JSON often
       freezes on a stale date_key.
    3. list_live_events() — flatten dlhd.st/schedule/schedule-generated.json
       into a rows list. Category keys carry a trailing `</span>`; strip
       it. 5min cache.
    4. resolve_stream(id) — 4-hop chain returning the fully-signed HLS
       URL plus the exact Referer/Origin the CDN's Varnish demands. 30min
       cache OR until the URL's embedded expiry epoch minus 5 minutes,
       whichever comes first — a segment 403 after the epoch passes.
    5. extract(content, ...) — canonical Kodi entry. Accepts channel_id,
       event_id, or a title to fuzzy-match against list_live_events().

Referer / Origin locks (from probe):
    Hop 1 (dlhd.st/stream/stream-{id}.php): Referer=dlhd.st/.
    Hop 2 (iframe host, rotates — hamis.romponalis.st today):
           Referer=dlhd.st/stream/stream-{id}.php, Origin=dlhd.st.
    Hop 3 (HLS master on rotating Varnish CDN):
           Referer=https://{iframe_host}/  (WITH trailing slash),
           Origin=https://{iframe_host}. Missing either → 403 Invalid
           Referer, Content-Length: 0.
    Hop 4 (.ts segments): same Referer/Origin as hop 3.

Anti-devtools JS in the iframe HTML is not proxied out — we only ever
scrape server-side and hand the CLIENT the final HLS URL plus the
required Referer/Origin. The client player replays those on every
segment fetch.

stdlib only — no requests, no yt-dlp. Runs on a stock Kodi 21 install
via the LOCAL registry in kodi-addon/lib/extractors/__init__.py.
"""

import base64
import concurrent.futures
import difflib
import html as html_mod
import json
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    from . import ExtractorError  # noqa: F401
except ImportError:
    class ExtractorError(Exception):
        pass


# ── constants ───────────────────────────────────────────────────────────

# Firefox 137 UA — probe verified the schedule/24-7 endpoints are happy
# with it, and it's the UA the maintained upstream picked when the site
# started fingerprinting Chrome-on-Windows requests.
UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0'
TIMEOUT = 12
MAX_BYTES = 20 * 1024 * 1024

BASE_TTL_S = 6 * 60 * 60
CHANNELS_TTL_S = 24 * 60 * 60
EVENTS_TTL_S = 5 * 60
STREAM_TTL_S = 30 * 60
STREAM_EXPIRY_MARGIN_S = 5 * 60  # refetch when we're within 5min of epoch

# Ordered by probe likelihood. dlhd.st is canonical today; dlhd.pk 301s
# onto it. The rest are historical or speculative — we probe them so a
# rotation doesn't need a code push. dlhd.dad is the script upstream's
# hardcode (NXDOMAIN today, kept in case it comes back). Anything with
# `no response / NXDOMAIN / parked` in the probe still gets tried since
# domains rotate every few months.
BASE_CANDIDATES = (
    'https://dlhd.st',
    'https://dlhd.pk',
    'https://dlhd.dad',
    'https://dlhd.sx',
    'https://daddylive.mp',
    'https://daddylive.sx',
    'https://daddylive.dad',
    'https://daddylivestream.com',
)

# Upstream script — read for a fresh base_url hint whenever our cache
# expires. The regex targets `self._base_url = "..."` in step_daddy.py.
STEPDADDY_SRC_URL = (
    'https://raw.githubusercontent.com/gookie-dev/StepDaddyLiveHD/'
    'master/StepDaddyLiveHD/step_daddy.py'
)
STEPDADDY_BASE_RE = re.compile(
    r"self\._base_url\s*=\s*['\"](https?://[^'\"/]+)['\"]"
)

# Markers we expect on any live dlhd base — presence of ANY one means
# the candidate is serving the real site (not a parked page or seizure
# notice).
LIVE_MARKERS = ('24-7-channels', 'watch.php', 'stream-', 'schedule/schedule-generated')
DEAD_MARKERS = ('this domain has been seized', 'operation offsides',
                'sinkholed', 'parked', 'parklogic', 'buy this domain')

# Iframe atob pattern — the Clappr player embeds a base64-encoded signed
# HLS URL as `source: window.atob('...')`. This is the primary extract
# path today; the legacy b_ts/b_sig/b_rnd/b_host bundle stays wired as a
# fallback for channels that regress to the old shape.
ATOB_SOURCE_RE = re.compile(
    r"source\s*:\s*window\.atob\(\s*['\"]([A-Za-z0-9+/=]+)['\"]"
)
IFRAME_SRC_RE = re.compile(r'<iframe[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE)
CHANNEL_CARD_RE = re.compile(
    r'<a class="card"\s+href="/watch\.php\?id=(\d+)"[^>]*>\s*'
    r'<div class="card__title">(.*?)</div>',
    re.DOTALL,
)
# `/{10-digit epoch}/premium{id}/index.m3u8` — probe: 1784776579 seen
# today (~2026-08 valid window). Anchor to 10 digits so a stray path
# segment can't false-match.
HLS_EXPIRY_RE = re.compile(r'/(\d{10})/premium\d+/')

# ── caches ──────────────────────────────────────────────────────────────

# Module-scope so they survive across plugin invocations in the same
# Kodi session. Guarded by a single Lock — the caches are small dicts
# and contention is negligible; a per-cache lock would be premature.
_lock = threading.Lock()
_BASE_CACHE = {}     # 'base' -> (canonical_url, ts)
_CHANNELS_CACHE = {}  # 'channels' -> (list, ts)
_EVENTS_CACHE = {}   # 'events' -> (list, ts)
_STREAM_CACHE = {}   # channel_id -> (payload, ts, expires_epoch or None)
# In-flight dedupe — two concurrent resolve_stream calls for the same id
# would otherwise both walk the 4 hops. Especially painful when Kodi
# double-fires the play action on a bouncy remote.
_STREAM_INFLIGHT = {}  # channel_id -> threading.Event (guards a slot)


# ── URL validation ─────────────────────────────────────────────────────
# Node-side parity: the atob'd HLS URL is upstream-controlled; without a
# scheme + host gate a compromised dlhd could hand us http://192.168.1.1/
# ...m3u8 and Kodi would happily play the LAN. Strict https + public
# hostname only.
_HOSTNAME_ALLOW_RE = re.compile(
    r'^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$',
    re.IGNORECASE,
)
_HOSTNAME_BLOCK_RE = re.compile(
    r'^(?:localhost|.*\.local|.*\.internal|.*\.lan)$', re.IGNORECASE,
)
_PRIVATE_IP_RE = re.compile(
    r'^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.|169\.254\.|0\.|::1$)',
    re.IGNORECASE,
)
_BARE_IPV4_RE = re.compile(r'^\d+\.\d+\.\d+\.\d+$')


def _is_public_https_host(hostname):
    if not hostname:
        return False
    h = hostname.lower()
    if _HOSTNAME_BLOCK_RE.match(h):
        return False
    if _PRIVATE_IP_RE.match(h):
        return False
    if _BARE_IPV4_RE.match(h):
        return False
    return bool(_HOSTNAME_ALLOW_RE.match(h))


def _validate_hls_url(url):
    """https-only + public hostname. Called before we hand a URL to Kodi."""
    if not url or not isinstance(url, str):
        return False
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False
    if parsed.scheme != 'https':
        return False
    return _is_public_https_host(parsed.hostname or '')


# ── HTTP ────────────────────────────────────────────────────────────────

def _request(url, referer=None, origin=None, extra_headers=None,
             method='GET', data=None, allow_redirect=True):
    """One HTTP call. Returns (status, headers, text, final_url). Doesn't
    raise on non-2xx — the caller decides what to do with 3xx/4xx bodies
    (e.g. captured 302 Location, or a 403 diagnostic snippet)."""
    headers = {
        'User-Agent': UA,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
    }
    if referer:
        headers['Referer'] = referer
    if origin:
        headers['Origin'] = origin
    if extra_headers:
        headers.update(extra_headers)
    if method == 'POST':
        headers.setdefault('Content-Type', 'application/x-www-form-urlencoded')

    body = data.encode('utf-8') if isinstance(data, str) else data
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    if not allow_redirect:
        class _NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **kw):
                return None
        opener = urllib.request.build_opener(_NoRedirect)
    else:
        opener = urllib.request.build_opener()

    try:
        resp = opener.open(req, timeout=TIMEOUT)
        raw = resp.read(MAX_BYTES)
        text = raw.decode('utf-8', errors='replace')
        final = resp.geturl() or url
        return resp.getcode(), resp.headers, text, final
    except urllib.error.HTTPError as e:
        # 3xx with allow_redirect=False lands here; also 4xx/5xx. Return
        # what we can so the caller can diagnose or capture Location.
        try:
            text = e.read(MAX_BYTES).decode('utf-8', errors='replace')
        except Exception:
            text = ''
        return e.code, e.headers, text, url
    except (urllib.error.URLError, socket.timeout) as e:
        raise ExtractorError('daddylive: http error for {0}: {1}'.format(url, e))


# ── base URL resolution ─────────────────────────────────────────────────

def _stepdaddy_hint():
    """Fetch step_daddy.py and pull the current hardcoded base URL. Best
    effort — GitHub can be slow/rate-limited; a miss here just skips the
    cross-check and we fall through to the static candidates."""
    try:
        status, _h, src, _f = _request(STEPDADDY_SRC_URL, referer=None)
    except ExtractorError:
        return None
    if status != 200 or not src:
        return None
    m = STEPDADDY_BASE_RE.search(src)
    if not m:
        return None
    return m.group(1).rstrip('/')


def _probe_base(candidate):
    """Return the canonical URL (post-redirect origin) if the candidate
    serves a real dlhd page, None otherwise. Filters out seizure banners
    and parked pages so a squatter can't hijack the extractor."""
    try:
        status, _h, text, final = _request(candidate + '/', referer=None)
    except ExtractorError:
        return None
    if status != 200 or not text:
        return None
    low = text.lower()
    if any(m in low for m in DEAD_MARKERS):
        return None
    if not any(m in low for m in LIVE_MARKERS):
        return None
    parsed = urllib.parse.urlparse(final)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc:
        return None
    return '{0}://{1}'.format(parsed.scheme, parsed.netloc)


def resolve_base():
    """Probe candidates in order, cache 6h. Uses a ThreadPoolExecutor to
    fetch in parallel but returns the FIRST candidate in the ordered
    preference list that succeeded — a slower-but-preferred host still
    wins over a faster fallback."""
    now = time.time()
    with _lock:
        hit = _BASE_CACHE.get('base')
        if hit and now - hit[1] < BASE_TTL_S:
            return hit[0]

    # Build the ordered candidate list, folding in the StepDaddy hint if
    # it's fresh (i.e. not one we already had). We append rather than
    # prepend — the hint has proven stale (dlhd.dad NXDOMAIN today) so a
    # known-live candidate should still win the ordering.
    ordered = list(BASE_CANDIDATES)
    hint = _stepdaddy_hint()
    if hint and hint not in ordered:
        ordered.append(hint)

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [(c, pool.submit(_probe_base, c)) for c in ordered]
        for cand, fut in futures:  # ordered iteration, not as_completed
            try:
                ok = fut.result(timeout=TIMEOUT + 2)
            except Exception:
                ok = None
            if ok:
                with _lock:
                    _BASE_CACHE['base'] = (ok, time.time())
                return ok

    raise ExtractorError(
        'daddylive: no live base URL — tried {0}'.format(', '.join(ordered))
    )


# ── channel + event lists ───────────────────────────────────────────────

def list_channels():
    """Fetch /24-7-channels.php and parse the card list. Same shape as
    the Node version: [{id, name}]. Cached 24h."""
    now = time.time()
    with _lock:
        hit = _CHANNELS_CACHE.get('channels')
        if hit and now - hit[1] < CHANNELS_TTL_S:
            return hit[0]

    base = resolve_base()
    status, _h, text, _f = _request(base + '/24-7-channels.php', referer=base + '/')
    if status != 200:
        raise ExtractorError('daddylive: /24-7-channels.php status {0}'.format(status))

    out = []
    seen_ids = set()
    for m in CHANNEL_CARD_RE.finditer(text or ''):
        cid = m.group(1)
        if cid in seen_ids:
            continue
        seen_ids.add(cid)
        name = html_mod.unescape(re.sub(r'<[^>]+>', '', m.group(2))).strip()
        out.append({'id': cid, 'name': name})

    if not out:
        raise ExtractorError('daddylive: /24-7-channels.php parsed 0 channels')

    with _lock:
        _CHANNELS_CACHE['channels'] = (out, time.time())
    return out


def _parse_events_json(data):
    """Flatten the schedule JSON into rows.
    Shape observed: {date_key: {category_key + '</span>': [event, ...]}}.
    Category keys carry a trailing </span> the site injects for styling
    — strip both open and close span variants defensively."""
    out = []
    if not isinstance(data, dict):
        return out
    for date_key, cats in data.items():
        if not isinstance(cats, dict):
            continue
        for cat_key, events in cats.items():
            category = re.sub(r'</?span[^>]*>', '', cat_key or '').strip()
            if not isinstance(events, list):
                continue
            for ev in events:
                if not isinstance(ev, dict):
                    continue
                name = html_mod.unescape((ev.get('event') or '').strip())
                t = (ev.get('time') or '').strip()
                primaries = ev.get('channels') or []
                mirrors = ev.get('channels2') or []
                primary_id = None
                primary_name = None
                if isinstance(primaries, list) and primaries:
                    c0 = primaries[0]
                    if isinstance(c0, dict):
                        primary_id = c0.get('channel_id')
                        primary_name = c0.get('channel_name')
                if not primary_id:
                    continue
                # Collect the remaining primaries + all mirrors as
                # fallback IDs the caller can try if hop 2 breaks on the
                # primary — the whole point of channels2 being a
                # separate list is CDN mirroring.
                mirror_ids = []
                for src in (primaries[1:], mirrors):
                    if not isinstance(src, list):
                        continue
                    for c in src:
                        if isinstance(c, dict) and c.get('channel_id'):
                            mirror_ids.append(str(c['channel_id']))
                out.append({
                    'id': str(primary_id),
                    'name': name,
                    'category': category,
                    'time_uk': t,
                    'date_key': date_key,
                    'primary_channel': primary_name or '',
                    'mirrors': mirror_ids,
                })
    return out


def list_live_events():
    """Fetch dlhd.st/schedule/schedule-generated.json and flatten.
    Note (probe): daddylive.org has been SEIZED, so the classic HTML
    fixture scrape is not viable. The JSON endpoint is what the current
    site actually serves — same content, structured. It's often stale
    (probe saw a 2025-03-20 date_key served today) so the caller should
    show freshness to the user."""
    now = time.time()
    with _lock:
        hit = _EVENTS_CACHE.get('events')
        if hit and now - hit[1] < EVENTS_TTL_S:
            return hit[0]

    base = resolve_base()
    status, _h, text, _f = _request(
        base + '/schedule/schedule-generated.json',
        referer=base + '/',
    )
    if status != 200:
        raise ExtractorError('daddylive: schedule status {0}'.format(status))
    try:
        data = json.loads(text)
    except ValueError as e:
        raise ExtractorError('daddylive: schedule JSON parse: {0}'.format(e))

    out = _parse_events_json(data)
    with _lock:
        _EVENTS_CACHE['events'] = (out, time.time())
    return out


# ── stream resolution (4-hop chain) ─────────────────────────────────────

def _fetch_stream_page(channel_id, base):
    """Hop 1 — GET /stream/stream-{id}.php, pull the <iframe src>."""
    url = '{0}/stream/stream-{1}.php'.format(base, channel_id)
    status, _h, text, _f = _request(url, referer=base + '/')
    if status != 200:
        raise ExtractorError(
            'daddylive: stream-{0}.php status {1}'.format(channel_id, status)
        )
    m = IFRAME_SRC_RE.search(text or '')
    if not m:
        raise ExtractorError(
            'daddylive: iframe not found for id {0} (page {1} bytes)'.format(
                channel_id, len(text or '')
            )
        )
    iframe_url = m.group(1).strip()
    if iframe_url.startswith('//'):
        iframe_url = 'https:' + iframe_url
    elif iframe_url.startswith('/'):
        iframe_url = base + iframe_url
    return url, iframe_url


def _fetch_iframe_source(iframe_url, stream_page_url, base):
    """Hop 2 — GET iframe HTML (Referer=stream page, Origin=dlhd.st),
    extract the atob'd HLS URL. Falls back to the legacy b_* bundle
    decode path if the atob isn't present."""
    status, _h, text, _f = _request(
        iframe_url,
        referer=stream_page_url,
        origin=base,
    )
    if status != 200:
        raise ExtractorError('daddylive: iframe status {0}'.format(status))

    m = ATOB_SOURCE_RE.search(text or '')
    if m:
        try:
            decoded = base64.b64decode(m.group(1)).decode('utf-8', errors='replace').strip()
        except Exception as e:
            raise ExtractorError('daddylive: atob decode: {0}'.format(e))
        if not _validate_hls_url(decoded):
            raise ExtractorError(
                'daddylive: atob HLS URL failed validation: {0}'.format(decoded[:100])
            )
        return decoded

    # Legacy fallback — kept lean, only tried when the atob is absent.
    fallback = _decode_bundle(text, base)
    if fallback:
        return fallback

    raise ExtractorError('daddylive: no source in iframe (page {0} bytes)'.format(len(text or '')))


def _decode_bundle(iframe_html, base):
    """Legacy path — b_ts / b_sig / b_rnd / b_host + auth.php +
    server_lookup.php → newkso.ru style m3u8. Returns None on any error;
    the atob path is preferred and this only kicks in when the iframe
    regresses to the old shape."""
    try:
        m = re.search(r"var\s+bundle\s*=\s*['\"]([A-Za-z0-9+/=]+)['\"]", iframe_html or '')
        if not m:
            return None
        raw = base64.b64decode(m.group(1)).decode('utf-8', errors='replace')
        try:
            parts = json.loads(raw)
        except ValueError:
            return None
        b_ts = parts.get('b_ts')
        b_sig = parts.get('b_sig')
        b_rnd = parts.get('b_rnd')
        b_host = parts.get('b_host')
        cid = parts.get('cid') or parts.get('channel_id')
        if not all([b_ts, b_sig, b_rnd, b_host, cid]):
            return None
        # auth.php side-effect writes the token server-side; body ignored.
        _request(
            '{0}/auth.php?ts={1}&sig={2}&rnd={3}'.format(
                base, urllib.parse.quote(str(b_ts)),
                urllib.parse.quote(str(b_sig)),
                urllib.parse.quote(str(b_rnd))
            ),
            referer=base + '/',
        )
        status, _h, srv, _f = _request(
            '{0}/server_lookup.php?channel_id={1}'.format(b_host, urllib.parse.quote(str(cid))),
            referer=base + '/',
        )
        if status != 200:
            return None
        try:
            payload = json.loads(srv)
        except ValueError:
            return None
        server_key = payload.get('server_key')
        if not server_key:
            return None
        return 'https://{0}/{1}/{2}/mono.m3u8'.format(
            b_host.rstrip('/'), server_key, cid
        )
    except Exception:
        return None


def _extract_hls_expiry(hls_url):
    """Pull the 10-digit epoch from /<epoch>/premiumNN/. Returns None if
    not parseable — caller then falls back to STREAM_TTL_S alone."""
    m = HLS_EXPIRY_RE.search(hls_url or '')
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


def resolve_stream(channel_or_event_id):
    """Full 4-hop resolve. Returns:
        {stream_url, headers, subtitles: [], expires, hoster, site_url}
    Cache: 30min OR until the embedded expiry epoch minus 5min, whichever
    comes first. A segment 403 after the epoch means we need a fresh
    signature — the cache TTL forces the refetch before the player sees
    the failure. In-flight promise dedupe keeps two racing callers from
    both walking the full 4 hops."""
    cid = str(channel_or_event_id)
    if not cid or not re.match(r'^\d+$', cid):
        raise ExtractorError('daddylive: bad channel id {0!r}'.format(cid))

    now = time.time()
    with _lock:
        hit = _STREAM_CACHE.get(cid)
        if hit:
            payload, ts, expires = hit
            fresh = (now - ts) < STREAM_TTL_S
            if expires and expires - STREAM_EXPIRY_MARGIN_S < now:
                fresh = False
            if fresh:
                return payload
        # In-flight coordination — if another thread is already resolving
        # this cid, block on its Event and read the cache once it lands.
        # Threading.Event because we can't use asyncio in a Kodi addon
        # (the plugin invocation exits before an event loop would drain).
        event = _STREAM_INFLIGHT.get(cid)
        if event is not None:
            first = False
        else:
            event = threading.Event()
            _STREAM_INFLIGHT[cid] = event
            first = True

    if not first:
        # Wait for the leader. 30s upper bound matches the play() timeout.
        event.wait(timeout=30)
        with _lock:
            hit = _STREAM_CACHE.get(cid)
        if hit:
            return hit[0]
        raise ExtractorError('daddylive: leader resolve returned nothing for {0}'.format(cid))

    try:
        base = resolve_base()
        stream_page_url, iframe_url = _fetch_stream_page(cid, base)
        hls_url = _fetch_iframe_source(iframe_url, stream_page_url, base)

        iframe_parsed = urllib.parse.urlparse(iframe_url)
        iframe_origin = '{0}://{1}'.format(iframe_parsed.scheme, iframe_parsed.netloc)

        expires = _extract_hls_expiry(hls_url)
        payload = {
            'stream_url': hls_url,
            # Trailing slash on Referer is not decorative — the Varnish
            # CDN rejects `https://host` without it as `403 Invalid
            # Referer` (Content-Length: 0). Keep the slash.
            'headers': {
                'User-Agent': UA,
                'Referer': iframe_origin + '/',
                'Origin': iframe_origin,
            },
            'subtitles': [],
            'expires': expires,
            'hoster': 'dlhd',
            'site_url': stream_page_url,
        }
        with _lock:
            _STREAM_CACHE[cid] = (payload, time.time(), expires)
        return payload
    finally:
        with _lock:
            _STREAM_INFLIGHT.pop(cid, None)
        event.set()


# ── public extract() entry ──────────────────────────────────────────────

def _normalize(s):
    """Lowercase, strip punctuation, collapse whitespace — same
    normalization goojara uses so scoring is comparable."""
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', '', (s or '').lower())).strip()


def _fuzzy_match_event(title, events):
    """Score every event name against the query; return the best if it
    clears 0.60. Threshold lower than goojara (0.75) because sports
    event names are noisier — team abbreviations, competition tags,
    channel-side prefixes like 'Sky Sports:' the user won't have."""
    norm = _normalize(title)
    if not norm:
        return None
    best = None
    best_score = 0.0
    for ev in events:
        n = _normalize(ev.get('name') or '')
        if not n:
            continue
        score = difflib.SequenceMatcher(None, norm, n).ratio()
        # Reward category context if the query happens to include one
        # of the category words (e.g. "premier league arsenal chelsea"
        # matching "Soccer: Arsenal vs Chelsea").
        cat = _normalize(ev.get('category') or '')
        if cat and cat in norm:
            score += 0.05
        if score > best_score:
            best_score = score
            best = ev
    if best and best_score >= 0.60:
        return best
    return None


def extract(content, season=None, episode=None):
    """Canonical Kodi extractor entry — matches the LOCAL registry shape
    in kodi-addon/lib/extractors/__init__.py.

    `content` accepts (in priority order):
      channel_id: 24/7 channel id from list_channels()
      event_id:   channel_id of a matched schedule row
      title:      fuzzy-matched against list_live_events()

    season/episode are accepted for signature parity with the goojara /
    file-hoster extractors but ignored — live TV has no S/E concept."""
    if not content:
        raise ExtractorError('daddylive: empty content')

    cid = content.get('channel_id') or content.get('event_id')
    if cid is None and content.get('title'):
        events = list_live_events()
        if not events:
            raise ExtractorError('daddylive: schedule empty, cannot fuzzy-match title')
        ev = _fuzzy_match_event(content['title'], events)
        if not ev:
            raise ExtractorError(
                'daddylive: no event match for "{0}"'.format(content['title'])
            )
        cid = ev['id']

    if cid is None or cid == '':
        raise ExtractorError('daddylive: content needs channel_id / event_id / title')

    return resolve_stream(cid)
