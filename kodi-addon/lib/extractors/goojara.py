# -*- coding: utf-8 -*-
"""goojara.to extractor — Pi-local port of electron/server/extractors/goojara.js.

Why this file exists:
    Railway's data-center IPs get Cloudflare-gated on goojara's A-Z pages —
    the index returns a short "Just a moment..." challenge HTML instead of
    the real listing, so slug lookup never matches and /api/stream/goojara
    returns ok:false. The Pi runs on a residential IP that goojara doesn't
    bot-flag; running the extractor here works around the gate entirely.

Flow (identical to the JS):
    1. Warm session: GET https://ww1.goojara.to/ → captures aGooz + _3chk
       cookies (the latter rotates per session, re-scraped on every page).
    2. TMDB title → show slug via /watch-series-az-<LETTER>?p=<N> walk.
       Searches BOTH the article-letter (T for "The Boys") and the
       first-keyword-letter (B), pages 1-9 in parallel batches of 3.
       Match against `title="<Name> (<Year>)"` with similarity + a +0.25
       year-match bonus; threshold 0.75.
    3. Show slug → episode slug via POST /xmre.php with form body s=N&t=ID.
       Response is reverse-ordered HTML fragment; match `<span class="sea">
       NN</span>` (zero-padded with leading space).
    4. Episode page → first allowed hoster anchor (dood > luluvdo > wootly
       > streamplay, ranked by label).
    5. GET /go.php?url=<token> with both cookies + Referer → 302 → real
       hoster URL. Validate scheme + host allowlist before returning.

24h SLUG_CACHE so subsequent plays of the same show are instant. AZ pages
cached too. Stale-slug retry: episode-page 404 / data-id missing →
invalidate slug, retry once.

stdlib only — no requests, no tough-cookie. Works on a stock Kodi 21
install (with our addon's empty extractors/__init__.py for LOCAL registry).
"""

import base64  # noqa: F401  # imported for parity with embedsu shape
import concurrent.futures
import difflib
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


BASE = 'https://ww1.goojara.to'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
TIMEOUT = 12
MAX_BYTES = 10 * 1024 * 1024
SLUG_TTL_S = 24 * 60 * 60
AZ_TTL_S = 24 * 60 * 60

# Hosts ResolveURL is known to crack reliably. Anything off-list is dropped
# so a compromised goojara can't pivot the Pi onto ad-mining junk.
ALLOWED_HOSTERS_RE = re.compile(
    r'^(?:www\.)?(?:'
    r'doodstream\.com|dood\.(?:re|la|wf|yt|so|ws|sh|pm|to|stream|watch)|'
    r'luluvdo\.com|'
    r'wootly\.ch|'
    r'streamtape\.com|'
    r'filemoon\.sx|'
    r'mixdrop\.(?:co|ag|to|club|sx|ms|bz)|'
    r'streamwish\.(?:com|to|site|fyi|net)|'
    r'vidoza\.net|'
    r'vidmoly\.me|'
    r'fembed\.(?:com|net|tv)|'
    r'streamplay\.to'
    r')$',
    re.IGNORECASE,
)

# Order hoster anchors try in. ResolveURL coverage is best for dood
# / luluvdo; wootly's a coin-flip; streamplay last (tokens expire fastest).
HOSTER_PREF = ('dood', 'doodstream', 'luluvdo', 'wootly', 'streamplay')

# In-process caches. Module-scope so they survive across plugin
# invocations within the same Kodi session. ProgressMonitor in service.py
# lives across the whole session too, so service-side state would also work
# but per-invocation state is simpler.
_lock = threading.Lock()
_SLUG_CACHE = {}   # key (tmdb_id or title|year) → (slug, ts)
_AZ_INDEX = {}     # letter|page → (html, ts)


# ── HTTP / cookies ──────────────────────────────────────────────────────

def _cookie_header(jar):
    return '; '.join('{0}={1}'.format(k, v) for k, v in jar.items())


def _parse_set_cookie(resp_headers, jar):
    """Pull every Set-Cookie name=value into the jar (drops attributes).
    urllib's headers list every Set-Cookie line separately via get_all."""
    try:
        cookies = resp_headers.get_all('Set-Cookie') or []
    except Exception:
        # Some urllib backends expose getheaders / items instead.
        cookies = [v for k, v in resp_headers.items() if k.lower() == 'set-cookie']
    for line in cookies:
        m = re.match(r'^([^=;\s]+)=([^;]+)', line)
        if m:
            jar[m.group(1)] = m.group(2)


def _extract_js_cookie(html):
    """Every goojara page embeds _3chk('<8hex>','<22hex>') — that pair IS
    the rotating JS cookie. Re-extract from each page response since the
    name AND value rotate per session."""
    m = re.search(r"_3chk\(['\"]([a-f0-9]{8})['\"],\s*['\"]([a-f0-9]{22})['\"]\)", html or '')
    return (m.group(1), m.group(2)) if m else None


def _request(url, jar, referer=None, method='GET', data=None, allow_redirect=True):
    """One HTTP call with cookie-aware shape. urllib follows redirects by
    default; we disable it for /go.php to capture the 302 Location."""
    headers = {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
    }
    if jar:
        headers['Cookie'] = _cookie_header(jar)
    if referer:
        headers['Referer'] = referer
    if method == 'POST':
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
        headers['X-Requested-With'] = 'XMLHttpRequest'

    body = data.encode('utf-8') if isinstance(data, str) else data
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    if not allow_redirect:
        class _NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **kw): return None
        opener = urllib.request.build_opener(_NoRedirect)
    else:
        opener = urllib.request.build_opener()

    try:
        resp = opener.open(req, timeout=TIMEOUT)
        raw = resp.read(MAX_BYTES)
        text = raw.decode('utf-8', errors='replace')
        _parse_set_cookie(resp.headers, jar)
        js = _extract_js_cookie(text)
        if js:
            jar[js[0]] = js[1]
        return resp.getcode(), resp.headers, text
    except urllib.error.HTTPError as e:
        # 302 with maxRedirects:0 lands here when allow_redirect=False.
        try:
            text = e.read(MAX_BYTES).decode('utf-8', errors='replace')
        except Exception:
            text = ''
        _parse_set_cookie(e.headers, jar)
        return e.code, e.headers, text
    except (urllib.error.URLError, socket.timeout) as e:
        raise ExtractorError('goojara: http error: {0}'.format(e))


# ── slug lookup ─────────────────────────────────────────────────────────

def _similarity(a, b):
    """0..1 fuzzy similarity. difflib's SequenceMatcher gives a Gestalt
    ratio close enough to the JS implementation for title matching."""
    return difflib.SequenceMatcher(None, (a or '').lower(), (b or '').lower()).ratio()


def _normalize_title(t):
    """Lowercase, strip punctuation, collapse whitespace. Used for the
    exact-match gate so "The Boys" doesn't accidentally pair with
    "TallBoyz" via a fuzzy similarity score."""
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', '', (t or '').lower())).strip()


def _scan_index_html(html, title, year):
    """Score every anchor on the page. Returns
    (exact_slug_if_any, candidates_list_for_global_aggregation)."""
    pattern = re.compile(
        r'href="(https://ww1\.goojara\.to/([A-Za-z0-9]{6,8}))/?"\s+title="([^"]+)"',
        re.IGNORECASE,
    )
    norm_target = _normalize_title(title)
    exact_slug = None
    candidates = []
    for m in pattern.finditer(html or ''):
        slug = m.group(2)
        full_title = m.group(3)
        tm = re.match(r'^(.+?)\s*\((\d{4})\)\s*$', full_title)
        if not tm:
            continue
        r_title, r_year = tm.group(1), tm.group(2)
        # Exact normalized match — the only reliable signal at goojara's
        # scale. If year also matches, we can return immediately and skip
        # the rest of the walk; an exact title-and-year hit is unambiguous.
        if _normalize_title(r_title) == norm_target:
            if year and int(r_year) == int(year):
                return slug, [{'title': full_title, 'score': 2.0, 'slug': slug}]
            # Exact title but wrong year — record as strong candidate.
            exact_slug = exact_slug or slug
            candidates.append({'title': full_title, 'score': 1.5, 'slug': slug})
            continue
        # Fuzzy fallback for misspellings / regional variants. Year match
        # gets the +0.25 bonus but the base similarity has to clear a
        # high bar to win against an exact match elsewhere.
        score = _similarity(title, r_title)
        if year and int(r_year) == int(year):
            score += 0.25
        candidates.append({'title': full_title, 'score': round(score, 3), 'slug': slug})
    return exact_slug, candidates


def _fetch_az_page(letter, page, jar):
    key = '{0}|{1}'.format(letter, page)
    with _lock:
        hit = _AZ_INDEX.get(key)
        if hit and time.time() - hit[1] < AZ_TTL_S:
            return hit[0]
    url = '{0}/watch-series-az-{1}'.format(BASE, letter)
    if page > 1:
        url += '?p={0}'.format(page)
    try:
        status, _h, html = _request(url, jar, referer=BASE + '/')
    except ExtractorError:
        return None
    if status != 200:
        return None
    with _lock:
        _AZ_INDEX[key] = (html, time.time())
    return html


def _get_slug(content, jar):
    title = content.get('title') or ''
    year = content.get('release_year')
    if not year and content.get('release_date'):
        try:
            year = int(content['release_date'][:4])
        except (ValueError, TypeError):
            year = None
    if not title:
        raise ExtractorError('goojara: missing title')

    cache_key = (
        't:{0}'.format(content['tmdb_id']) if content.get('tmdb_id')
        else 's:{0}|{1}'.format(title, year or '')
    )
    with _lock:
        hit = _SLUG_CACHE.get(cache_key)
        if hit and time.time() - hit[1] < SLUG_TTL_S:
            return hit[0]

    # Both the article-letter and first-keyword-letter — probe note: "The
    # Boys" lives under B page 5, not under T.
    stripped = re.sub(r'^(the|a|an)\s+', '', title.strip(), flags=re.IGNORECASE).strip()
    words = stripped.split()
    candidates = []
    for ch in (title.strip()[:1].upper(), (words[0][:1].upper() if words else '')):
        if re.match(r'[A-Z]', ch) and ch not in candidates:
            candidates.append(ch)

    stats = {
        'letters': candidates,
        'pages_scanned': 0,
        'pages_empty': 0,
        'pages_short': 0,
        'best_seen': None,
    }

    BATCH = 3
    # Accumulate ALL fuzzy candidates across both letters; only an exact
    # title+year match short-circuits the walk. "The Boys" used to match
    # "TallBoyz (2019)" on T page 1 (similarity 0.5 + year bonus 0.25 =
    # 0.75) and never reached "The Boys (2019)" on B page 5 — global-best
    # aggregation fixes that.
    global_best = None
    exact_no_year = None
    with concurrent.futures.ThreadPoolExecutor(max_workers=BATCH) as pool:
        for letter in candidates:
            for start_p in range(1, 10, BATCH):
                end_p = min(start_p + BATCH - 1, 9)
                pages = list(range(start_p, end_p + 1))
                futures = {p: pool.submit(_fetch_az_page, letter, p, jar) for p in pages}
                short_seen = False
                for p in pages:
                    try:
                        html = futures[p].result()
                    except Exception:
                        html = None
                    stats['pages_scanned'] += 1
                    if not html:
                        stats['pages_empty'] += 1
                        short_seen = True
                        continue
                    if len(html) < 8000:
                        stats['pages_short'] += 1
                        short_seen = True
                    exact_slug, page_candidates = _scan_index_html(html, title, year)
                    if exact_slug and any(c['score'] >= 2.0 for c in page_candidates):
                        # Exact title AND year match — unambiguous, stop here.
                        with _lock:
                            _SLUG_CACHE[cache_key] = (exact_slug, time.time())
                        stats['best_seen'] = next(c for c in page_candidates if c['score'] >= 2.0)
                        return exact_slug
                    if exact_slug:
                        exact_no_year = exact_no_year or exact_slug
                    for c in page_candidates:
                        if global_best is None or c['score'] > global_best['score']:
                            global_best = c
                            stats['best_seen'] = {'title': c['title'], 'score': c['score']}
                if short_seen:
                    break

    # No exact title+year match in the whole walk. Fall back to:
    #   1. Any exact title match (year unknown) — typically right.
    #   2. Otherwise the global-best fuzzy candidate if score >= 1.0
    #      (a clear winner — 0.75 base similarity + 0.25 year bonus, or
    #      0.85+ exact-spelling near-match without year).
    if exact_no_year:
        with _lock:
            _SLUG_CACHE[cache_key] = (exact_no_year, time.time())
        return exact_no_year
    if global_best and global_best['score'] >= 1.0:
        with _lock:
            _SLUG_CACHE[cache_key] = (global_best['slug'], time.time())
        return global_best['slug']

    detail = ' [searched={letters} pages={pages_scanned} empty={pages_empty} short={pages_short} best={best_seen}]'.format(**stats)
    raise ExtractorError(
        'goojara: no slug match for "{0}" ({1}){2}'.format(title, year or '?', detail)
    )


def _invalidate_slug(content):
    title = content.get('title') or ''
    year = content.get('release_year')
    cache_key = (
        't:{0}'.format(content['tmdb_id']) if content.get('tmdb_id')
        else 's:{0}|{1}'.format(title, year or '')
    )
    with _lock:
        _SLUG_CACHE.pop(cache_key, None)


# ── episode + hoster walk ───────────────────────────────────────────────

def _get_episode_slug(show_slug, season, episode, jar):
    show_url = '{0}/{1}'.format(BASE, show_slug)
    status, _h, show_html = _request(show_url, jar, referer=BASE + '/')
    if status != 200:
        err = ExtractorError('goojara: show page {0}'.format(status))
        err.stale_slug = True
        raise err
    id_match = re.search(r'data-id=["\'](\d+)["\']', show_html)
    if not id_match:
        err = ExtractorError('goojara: data-id missing on show page')
        err.stale_slug = True
        raise err
    show_id = id_match.group(1)

    body = 's={0}&t={1}'.format(
        urllib.parse.quote(str(season)),
        urllib.parse.quote(show_id),
    )
    try:
        status, _h, ep_html = _request(
            '{0}/xmre.php'.format(BASE),
            jar,
            referer=show_url,
            method='POST',
            data=body,
        )
    except ExtractorError as e:
        e.stale_slug = True
        raise

    if status != 200:
        err = ExtractorError('goojara: /xmre.php status {0}'.format(status))
        err.stale_slug = True
        raise err

    # Episode list reverse-ordered; match `<span class="sea"> NN</span>`.
    want = '{0:02d}'.format(int(episode))
    block_re = re.compile(
        r'<div class="seho">.*?<span class="sea">\s*(\d{2})</span>.*?<a href="/([A-Za-z0-9]{6,8})"',
        re.DOTALL,
    )
    for m in block_re.finditer(ep_html):
        if m.group(1) == want:
            return m.group(2)
    err = ExtractorError('goojara: S{0}E{1} not found'.format(season, episode))
    err.stale_slug = True
    raise err


def _pick_hoster_order(html):
    """All <a class="bcg"> anchors with /go.php?url=<token>, ranked by
    HOSTER_PREF. Tolerates both absolute and relative href shapes."""
    out = []
    # Match either:
    #   href="https://ww1.goojara.to/go.php?url=..."
    #   href="/go.php?url=..."
    pattern = re.compile(
        r'<a[^>]+class="bcg"[^>]+href="[^"]*?/go\.php\?url=([^&"\']+)"[^>]*>([^<]+)',
        re.IGNORECASE,
    )
    for m in pattern.finditer(html or ''):
        token = m.group(1)
        label = m.group(2).strip().lower()
        rank = next(
            (i for i, h in enumerate(HOSTER_PREF) if h in label),
            len(HOSTER_PREF),
        )
        out.append({'token': token, 'label': label, 'rank': rank})
    out.sort(key=lambda x: x['rank'])
    return out


def _resolve_go_url(token, referer, jar):
    """GET /go.php?url=<token>; expect 302; return Location."""
    # Do NOT URL-encode the token — goojara already encoded it. Wrapping
    # with urllib.parse.quote double-encodes and the server 404s.
    status, headers, _body = _request(
        '{0}/go.php?url={1}'.format(BASE, token),
        jar,
        referer=referer,
        allow_redirect=False,
    )
    if status not in (301, 302):
        raise ExtractorError('goojara: /go.php status {0} (cookie gate?)'.format(status))
    loc = headers.get('Location') or headers.get('location')
    if not loc:
        raise ExtractorError('goojara: /go.php missing Location')
    return loc


def _is_playable_hoster_url(url):
    """Scheme + host gate so a compromised goojara can't redirect us into
    gopher:// / ftp:// / file:/// / private IPs."""
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in ('http', 'https'):
        return False
    host = (parsed.hostname or '').lower()
    if not host:
        return False
    if host == 'localhost' or host.endswith('.local'):
        return False
    # RFC 1918 + loopback + link-local
    if (host.startswith('127.') or host.startswith('10.')
            or host.startswith('192.168.') or host.startswith('169.254.')):
        return False
    if re.match(r'^172\.(1[6-9]|2[0-9]|3[0-1])\.', host):
        return False
    return bool(ALLOWED_HOSTERS_RE.match(host))


# ── public API ──────────────────────────────────────────────────────────

def _extract_once(content, season, episode):
    jar = {}
    # Warm session — first GET sets aGooz + _3chk cookies.
    _request(BASE + '/', jar, referer=None)

    show_slug = _get_slug(content, jar)
    is_movie = content.get('type') == 'movie'

    if is_movie:
        page_url = '{0}/{1}'.format(BASE, show_slug)
        status, _h, page_html = _request(page_url, jar, referer=BASE + '/')
        if status != 200:
            err = ExtractorError('goojara: movie page {0}'.format(status))
            err.stale_slug = True
            raise err
    else:
        ep_slug = _get_episode_slug(show_slug, season or 1, episode or 1, jar)
        page_url = '{0}/{1}'.format(BASE, ep_slug)
        status, _h, page_html = _request(page_url, jar, referer='{0}/{1}'.format(BASE, show_slug))
        if status != 200:
            err = ExtractorError('goojara: episode page {0}'.format(status))
            err.stale_slug = True
            raise err

    anchors = _pick_hoster_order(page_html)
    if not anchors:
        raise ExtractorError('goojara: no hoster anchors found')

    last_err = None
    for a in anchors:
        try:
            real = _resolve_go_url(a['token'], page_url, jar)
            if not _is_playable_hoster_url(real):
                last_err = ExtractorError('goojara: rejected redirect to {0}'.format(real[:80]))
                continue
            return {
                'stream_url': real,
                'headers': {'Referer': BASE + '/', 'User-Agent': UA},
                'subtitles': [],
                'hoster': a['label'].split()[0] if a['label'] else '',
                'site_url': page_url,
            }
        except ExtractorError as e:
            last_err = e
    raise last_err or ExtractorError('goojara: all hosters failed')


def extract(content, season=None, episode=None):
    """Public entry — matches the LOCAL registry shape in __init__.py."""
    if not content or not content.get('title'):
        raise ExtractorError('goojara: content.title required')
    try:
        return _extract_once(content, season, episode)
    except ExtractorError as e:
        # Slug likely rotated — invalidate + retry once.
        if getattr(e, 'stale_slug', False):
            _invalidate_slug(content)
            return _extract_once(content, season, episode)
        raise
