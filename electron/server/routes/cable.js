const express = require('express');
const axios   = require('axios');

const router = express.Router();

// ─── Cache ────────────────────────────────────────────────────────────────────
let channelCache = null;
let cacheExpiry  = 0;
const CACHE_TTL  = 20 * 60 * 1000; // 20 min

const PLUTO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://pluto.tv/',
  'Origin': 'https://pluto.tv'
};

// ─── Local news stations by market ────────────────────────────────────────────
// URL is opened in the BrowserView player — YouTube @handle/live redirects
// to whatever the channel is currently streaming.
const LOCAL_NEWS = {
  'austin': [
    { id: 'kxan',  name: 'KXAN News',    url: 'https://www.youtube.com/@KXAN/live',        logo: '🔵' },
    { id: 'kvue',  name: 'KVUE',          url: 'https://www.youtube.com/@kvuenews/live',    logo: '🟠' },
    { id: 'fox7',  name: 'FOX 7 Austin',  url: 'https://www.youtube.com/@fox7austin/live',  logo: '🔴' },
  ],
  'houston': [
    { id: 'khou',  name: 'KHOU 11',         url: 'https://www.youtube.com/@KHOU/live',          logo: '🔵' },
    { id: 'kprc',  name: 'Click2Houston',   url: 'https://www.youtube.com/@ClickHouston/live',  logo: '🟢' },
    { id: 'abc13', name: 'ABC13 Houston',   url: 'https://www.youtube.com/@abc13houston/live',  logo: '🟡' },
  ],
  'dallas': [
    { id: 'wfaa',  name: 'WFAA',         url: 'https://www.youtube.com/@WFAA/live',      logo: '🔵' },
    { id: 'nbc5',  name: 'NBC 5 DFW',    url: 'https://www.youtube.com/@nbcdfw/live',    logo: '🔴' },
    { id: 'fox4',  name: 'FOX 4 Dallas', url: 'https://www.youtube.com/@fox4news/live',  logo: '🟠' },
  ],
  'new york': [
    { id: 'abc7ny',  name: 'ABC7 NY',        url: 'https://www.youtube.com/@ABC7NY/live',       logo: '🟡' },
    { id: 'nbc4ny',  name: 'NBC New York',   url: 'https://www.youtube.com/@NBCNewYork/live',   logo: '🔵' },
    { id: 'cbs2ny',  name: 'CBS New York',   url: 'https://www.youtube.com/@CBSNewYork/live',   logo: '🟢' },
  ],
  'los angeles': [
    { id: 'abc7la', name: 'ABC7 LA',       url: 'https://www.youtube.com/@abc7LA/live',         logo: '🟡' },
    { id: 'nbcla',  name: 'NBC LA',        url: 'https://www.youtube.com/@NBCLA/live',          logo: '🔵' },
    { id: 'fox11',  name: 'FOX 11 LA',     url: 'https://www.youtube.com/@FOX11LosAngeles/live',logo: '🔴' },
  ],
  'chicago': [
    { id: 'wgn',    name: 'WGN News',    url: 'https://www.youtube.com/@WGNNews/live',     logo: '🔵' },
    { id: 'abc7chi',name: 'ABC7 Chicago',url: 'https://www.youtube.com/@ABC7Chicago/live', logo: '🟡' },
    { id: 'nbc5chi',name: 'NBC 5',       url: 'https://www.youtube.com/@nbcchicago/live',  logo: '🔴' },
  ],
  'miami': [
    { id: 'nbc6',   name: 'NBC 6 South Florida', url: 'https://www.youtube.com/@NBC6SouthFlorida/live', logo: '🔵' },
    { id: 'wplg',   name: 'Local 10 WPLG',        url: 'https://www.youtube.com/@wplglocal10/live',      logo: '🟢' },
  ],
  'san francisco': [
    { id: 'kqed',   name: 'KQED News',   url: 'https://www.youtube.com/@KQED/live',        logo: '🔵' },
    { id: 'abc7sf', name: 'ABC7 Bay Area',url: 'https://www.youtube.com/@abc7bayarea/live', logo: '🟡' },
    { id: 'nbcba',  name: 'NBC Bay Area', url: 'https://www.youtube.com/@NBCBayArea/live',  logo: '🔴' },
  ],
  'phoenix': [
    { id: '12news',  name: '12 News AZ',   url: 'https://www.youtube.com/@12NewsArizona/live', logo: '🔵' },
    { id: 'abc15',   name: 'ABC15 AZ',     url: 'https://www.youtube.com/@abc15arizona/live',  logo: '🟡' },
    { id: 'fox10phx',name: 'FOX 10 AZ',   url: 'https://www.youtube.com/@FOX10Phoenix/live',  logo: '🔴' },
  ],
  'seattle': [
    { id: 'king5',   name: 'KING 5',     url: 'https://www.youtube.com/@KING5Seattle/live', logo: '🔵' },
    { id: 'komo4',   name: 'KOMO 4 News',url: 'https://www.youtube.com/@komonews/live',     logo: '🟡' },
  ],
  'denver': [
    { id: 'kusa9',   name: '9NEWS Denver', url: 'https://www.youtube.com/@9NEWSColorado/live', logo: '🔵' },
    { id: 'kdvr',    name: 'FOX31 Denver', url: 'https://www.youtube.com/@FOX31Denver/live',   logo: '🔴' },
  ],
  'atlanta': [
    { id: 'wsbtv',   name: 'WSB-TV',     url: 'https://www.youtube.com/@wsbtv/live',       logo: '🔵' },
    { id: 'fox5atl', name: 'FOX 5 ATL',  url: 'https://www.youtube.com/@fox5atlanta/live', logo: '🔴' },
  ],
};

// ─── GET /api/cable/channels ──────────────────────────────────────────────────
router.get('/cable/channels', async (req, res) => {
  try {
    const now = Date.now();
    if (channelCache && now < cacheExpiry) return res.json(channelCache);

    // Round to nearest 30 min for cleaner EPG alignment
    const startMs   = Math.floor(now / (30 * 60 * 1000)) * (30 * 60 * 1000) - 30 * 60 * 1000;
    const stopMs    = startMs + 8 * 60 * 60 * 1000;
    const start     = new Date(startMs).toISOString();
    const stop      = new Date(stopMs).toISOString();

    const { data } = await axios.get(
      `https://api.pluto.tv/v2/channels?start=${encodeURIComponent(start)}&stop=${encodeURIComponent(stop)}`,
      { headers: PLUTO_HEADERS, timeout: 15000 }
    );

    const channels = (Array.isArray(data) ? data : [])
      .filter(c => c.timelines?.length)
      .map(c => ({
        id:       c._id,
        name:     c.name,
        number:   c.number,
        category: c.category || 'Uncategorized',
        slug:     c.slug || c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        logo:     c.thumbnail || null,
        hlsUrl:   c.stitched?.urls?.[0]?.url || null,
        timelines: (c.timelines || []).map(t => ({
          start:       t.start,
          stop:        t.stop,
          title:       t.title || (t.episode?.name) || 'Unknown',
          description: t.episode?.description || null,
          poster:      t.episode?.poster?.path || null,
          rating:      t.episode?.rating || null,
        }))
      }))
      .sort((a, b) => a.number - b.number);

    channelCache = channels;
    cacheExpiry  = now + CACHE_TTL;
    res.json(channels);
  } catch (e) {
    if (channelCache) return res.json(channelCache);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/cable/local-news?city=austin ───────────────────────────────────
router.get('/cable/local-news', (req, res) => {
  const city    = (req.query.city || '').toLowerCase().trim();
  const match   = Object.keys(LOCAL_NEWS).find(k => city.includes(k) || k.includes(city));
  const stations = match ? LOCAL_NEWS[match] : [];
  res.json({ city: match || city, stations });
});

// ─── GET /api/cable/player?src=<hlsUrl>&title=<title> ────────────────────────
// Returns a self-contained HTML page that plays an HLS stream using hls.js.
// Opened in the N Streams BrowserView player so it inherits the app's UA.
router.get('/cable/player', (req, res) => {
  const src   = req.query.src   || '';
  const title = String(req.query.title || 'Live TV').replace(/[<>"]/g, '');

  if (!src) return res.status(400).send('<h1>Missing ?src= parameter</h1>');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:100%; height:100%; background:#000; overflow:hidden; }
    video { width:100%; height:100%; display:block; background:#000; }
    #err {
      display:none; position:fixed; inset:0; background:#000;
      color:#aaa; font-family:monospace; font-size:13px;
      align-items:center; justify-content:center; flex-direction:column; gap:12px;
    }
    #err.show { display:flex; }
    #err a { color:#ffd700; }
  </style>
</head>
<body>
  <video id="v" controls autoplay playsinline></video>
  <div id="err">
    <div id="msg">Loading…</div>
    <a id="fallback" href="#" style="display:none">Open on Pluto.tv ↗</a>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"></script>
  <script>
    var video = document.getElementById('v');
    var err   = document.getElementById('err');
    var msg   = document.getElementById('msg');
    var src   = ${JSON.stringify(src)};

    function showErr(text, fallbackUrl) {
      msg.textContent = text;
      err.classList.add('show');
      if (fallbackUrl) {
        var a = document.getElementById('fallback');
        a.href = fallbackUrl;
        a.style.display = '';
        a.onclick = function(e) { e.preventDefault(); window.open(fallbackUrl); };
      }
    }

    if (!src) {
      showErr('No stream URL provided.');
    } else if (typeof Hls === 'undefined') {
      showErr('hls.js could not load — check internet connection.');
    } else if (Hls.isSupported()) {
      var hls = new Hls({ enableWorker: false, xhrSetup: function(xhr) {
        xhr.setRequestHeader('Referer', 'https://pluto.tv/');
      }});
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, function() { video.play().catch(function(){}); });
      hls.on(Hls.Events.ERROR, function(_, data) {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            showErr('Network error loading stream. The channel may be geo-restricted.');
          } else {
            showErr('Stream error: ' + (data.details || 'unknown'));
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.play().catch(function(){});
    } else {
      showErr('HLS playback is not supported.');
    }
  </script>
</body>
</html>`);
});

module.exports = router;
