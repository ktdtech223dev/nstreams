import React, { useEffect, useState } from 'react';
import api from '../api';
import { useApp } from '../App';
import EpisodeTracker from './EpisodeTracker';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'episodes', label: 'Episodes' },
  { id: 'where', label: 'Where to Watch' },
  { id: 'crew', label: 'Crew Progress' }
];

const STATUSES = [
  { id: 'watching', label: 'Watching' },
  { id: 'plan_to_watch', label: 'Plan to Watch' },
  { id: 'completed', label: 'Completed' },
  { id: 'on_hold', label: 'On Hold' },
  { id: 'dropped', label: 'Dropped' }
];

export default function ContentModal({ contentId, onClose }) {
  const { activeUserId, users, showToast, refreshSessions, openWatchParty, openPlayer } = useApp();
  const [content, setContent] = useState(null);
  const [tab, setTab] = useState('overview');
  const [where, setWhere] = useState(null);
  const [loading, setLoading] = useState(true);
  const [linkOpen, setLinkOpen] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const c = await api.getContent(contentId, activeUserId);
        setContent(c);
      } catch (e) {
        showToast('Failed to load: ' + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [contentId]);

  const [scraped, setScraped] = useState(null); // {results, loading, error}

  useEffect(() => {
    if (tab === 'where' && !where && content) {
      api.whereToWatch(contentId).then(setWhere).catch(() => {});
    }
    if (tab === 'where' && !scraped && content) {
      setScraped({ loading: true, results: [] });
      api.scrapeAvailability(contentId)
        .then(d => setScraped({ loading: false, results: d.results || [], data: d }))
        .catch(e => setScraped({ loading: false, results: [], error: e.message }));
    }
  }, [tab, content]);

  useEffect(() => {
    // Re-fetch scraped after user hides a bad match
    const h = (e) => {
      if (String(e.detail?.contentId) !== String(contentId)) return;
      api.scrapeAvailability(contentId)
        .then(d => setScraped({ loading: false, results: d.results || [], data: d }))
        .catch(() => {});
    };
    window.addEventListener('nstreams:rescrape', h);
    return () => window.removeEventListener('nstreams:rescrape', h);
  }, [contentId]);

  if (loading || !content) {
    return (
      <div
        className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
        onClick={onClose}
      >
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  const wl = content.watchlist;
  const genres = content.genres ? JSON.parse(content.genres) : [];
  const cast = content.cast_list ? JSON.parse(content.cast_list) : [];

  async function update(fields) {
    if (!wl) {
      await api.addToWatchlist({
        user_id: activeUserId,
        content_id: contentId,
        ...fields
      });
    } else {
      await api.updateWatchlist(wl.id, fields);
    }
    const c = await api.getContent(contentId, activeUserId);
    setContent(c);
  }

  async function watchNow(siteId, url, opts = {}) {
    const { inApp = false, title, siteName } = opts;
    try {
      const s = await api.startSession({
        user_id: activeUserId,
        content_id: contentId,
        site_id: siteId
      });
      if (inApp && window.electron?.player) {
        const drmServices = /netflix|hulu|disney|max|prime|crunchyroll|peacock|paramount|apple tv|funimation|hidive/i;
        if (drmServices.test(siteName || '') || drmServices.test(url)) {
          showToast(`⚠ ${siteName || 'Service'} requires DRM — if playback fails, click "Open in browser" top-right`);
        }
        openPlayer({
          url,
          title: `${title || content.title} · ${siteName || ''}`.trim(),
          contentId,
          watchlistId: wl?.id,
          siteId
        });
        // ContentModal auto-closes in openPlayer()
      } else if (window.electron) {
        await window.electron.openUrl(url);
        showToast('Opened in browser — come back when done!');
      } else {
        window.open(url, '_blank');
      }
      refreshSessions();
    } catch (e) {
      showToast('Failed: ' + e.message);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8 animate-fade"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-bg2 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col border border-border"
      >
        {/* Header with backdrop */}
        <div className="relative h-64 shrink-0">
          {content.backdrop_path && (
            <img src={content.backdrop_path} className="w-full h-full object-cover" alt="" />
          )}
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(180deg, rgba(8,8,16,0.3) 0%, rgba(8,8,16,0.95) 100%)' }}
          />
          <div className="absolute top-4 right-4 flex gap-2">
            <button
              onClick={() => { openWatchParty(contentId); }}
              className="bg-accent hover:bg-accent3 text-white px-4 h-9 rounded-full font-medium text-sm transition flex items-center gap-2 glow"
              title="Start a synced watch party with your crew"
            >
              📺 Watch Together
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 bg-bg3/80 backdrop-blur hover:bg-red rounded-full text-white flex items-center justify-center transition"
            >
              ✕
            </button>
          </div>
          <div className="absolute bottom-4 left-6 right-6 flex gap-5 items-end">
            {content.poster_path && (
              <img
                src={content.poster_path}
                className="w-32 rounded-lg shadow-2xl border border-border"
                alt=""
              />
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-3xl font-display text-white tracking-wide">{content.title}</h1>
              <div className="flex items-center gap-3 mt-2 text-sm text-muted">
                {content.release_year && <span>{content.release_year}</span>}
                {content.rating && <span>★ {content.rating.toFixed(1)}</span>}
                {content.total_episodes && <span>{content.total_episodes} eps</span>}
                <span className="capitalize">{content.type}</span>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {genres.slice(0, 4).map(g => (
                  <span key={g} className="text-xs bg-bg3 px-2 py-0.5 rounded-full text-muted">
                    {g}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-6 shrink-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
                tab === t.id
                  ? 'text-white border-accent'
                  : 'text-muted border-transparent hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'overview' && (
            <OverviewTab content={content} wl={wl} update={update} cast={cast} />
          )}
          {tab === 'episodes' && (
            <EpisodeTracker content={content} wl={wl} update={update} onAdvance={async () => {
              if (!wl) {
                await update({ watch_status: 'watching' });
              } else {
                await api.advanceEpisode(wl.id);
                const c = await api.getContent(contentId, activeUserId);
                setContent(c);
                showToast('Episode +1');
              }
            }} />
          )}
          {tab === 'where' && (
            <WhereToWatchTab
              data={where}
              scraped={scraped}
              onWatch={watchNow}
              contentId={contentId}
              onLinkOpen={() => setLinkOpen(true)}
            />
          )}
          {tab === 'crew' && (
            <CrewProgressTab contentId={contentId} users={users} activeUserId={activeUserId} />
          )}
        </div>
      </div>

      {linkOpen && (
        <LinkServiceModal
          contentId={contentId}
          onClose={() => setLinkOpen(false)}
          onSaved={async () => {
            setLinkOpen(false);
            const w = await api.whereToWatch(contentId);
            setWhere(w);
            showToast('Linked ✓');
          }}
        />
      )}
    </div>
  );
}

function OverviewTab({ content, wl, update, cast }) {
  return (
    <div className="space-y-6">
      {content.overview && (
        <p className="text-text/80 leading-relaxed">{content.overview}</p>
      )}

      {cast.length > 0 && (
        <div>
          <h3 className="font-display text-xl text-white mb-3">Cast</h3>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {cast.map((c, i) => (
              <div key={i} className="shrink-0 text-center w-20">
                {c.photo ? (
                  <img src={c.photo} className="w-16 h-16 rounded-full object-cover mx-auto" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-bg4 mx-auto flex items-center justify-center text-muted text-xs">
                    {c.name[0]}
                  </div>
                )}
                <div className="text-xs text-white mt-2 truncate">{c.name}</div>
                <div className="text-xs text-muted truncate">{c.character}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">Your Rating</label>
          <div className="flex gap-1 mt-2">
            {[1,2,3,4,5,6,7,8,9,10].map(n => (
              <button
                key={n}
                onClick={() => update({ user_rating: n })}
                className={`w-7 h-7 rounded text-xs font-bold transition ${
                  wl?.user_rating >= n
                    ? 'bg-gold text-bg'
                    : 'bg-bg3 text-muted hover:bg-bg4'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wider text-muted">Status</label>
          <select
            value={wl?.watch_status || 'plan_to_watch'}
            onChange={e => update({ watch_status: e.target.value })}
            className="input w-full mt-2"
          >
            {STATUSES.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs uppercase tracking-wider text-muted">Notes</label>
        <textarea
          defaultValue={wl?.notes || ''}
          onBlur={e => update({ notes: e.target.value })}
          placeholder="Private notes..."
          className="input w-full mt-2 h-24 resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">Start Date</label>
          <input
            type="date"
            defaultValue={wl?.start_date || ''}
            onBlur={e => update({ start_date: e.target.value })}
            className="input w-full mt-2"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">Finish Date</label>
          <input
            type="date"
            defaultValue={wl?.finish_date || ''}
            onBlur={e => update({ finish_date: e.target.value })}
            className="input w-full mt-2"
          />
        </div>
      </div>
    </div>
  );
}

function WhereToWatchTab({ data, scraped, onWatch, contentId, onLinkOpen }) {
  const { activeUserId, showToast } = useApp();

  async function hideScraped(r) {
    try {
      await api.hideScrapeResult({
        content_id: contentId,
        provider: r.provider,
        site_url: r.site_url,
        user_id: activeUserId
      });
      showToast(`Hidden: ${r.provider_name}`);
      // Reload scraped list — parent will re-fetch on next tab open, but
      // for immediacy we just emit a custom event the ContentModal can pick up
      window.dispatchEvent(new CustomEvent('nstreams:rescrape', { detail: { contentId } }));
    } catch (e) {
      showToast('Failed to hide: ' + e.message);
    }
  }

  if (!data) return <div className="text-muted">Loading...</div>;

  const hasElectron = !!window.electron?.watchInApp;

  function ProviderButtons({ name, siteId, url, drm }) {
    return (
      <div className="flex flex-col gap-1 shrink-0">
        {hasElectron && (
          <button
            onClick={() => onWatch(siteId, url, { inApp: true, siteName: name })}
            className="btn btn-primary text-xs py-1.5 px-3 whitespace-nowrap"
            title={drm ? 'DRM service — playback may fail in embedded viewer' : ''}
          >
            ▶ Watch in app
          </button>
        )}
        <button
          onClick={() => onWatch(siteId, url, { inApp: false, siteName: name })}
          className="btn btn-ghost text-xs py-1.5 px-3 whitespace-nowrap"
        >
          ↗ Open externally
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* SCRAPED AVAILABILITY — Consumet lookup across aggregator sites */}
      <div>
        <h3 className="font-display text-xl text-white mb-1">
          Found on Aggregators {scraped?.results?.length > 0 && (
            <span className="text-sm text-accent ml-2">{scraped.results.length} match{scraped.results.length === 1 ? '' : 'es'}</span>
          )}
        </h3>
        <div className="text-xs text-muted mb-3">
          Auto-detected from HiAnime, GogoAnime, AnimePahe, FlixHQ, FMovies, DramaCool, and more.
          Click to open the direct show page in the viewer — no DRM required.
        </div>
        {!scraped || scraped.loading ? (
          <div className="bg-bg3 border border-border rounded-lg p-4 text-muted text-sm">
            🔍 Checking aggregator sites…
          </div>
        ) : scraped.error ? (
          <div className="bg-red/10 border border-red/40 text-red text-sm p-3 rounded-lg">
            Scraper unreachable: {scraped.error}
            <div className="text-muted text-xs mt-1">Check Settings → Aggregator Scraper</div>
          </div>
        ) : scraped.results.length === 0 ? (
          <div className="bg-bg3/50 border border-border rounded-lg p-3 text-muted text-sm">
            No matches found across aggregator sites.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {scraped.results.map(r => (
              <div
                key={`${r.provider}-${r.site_url}`}
                className="bg-bg3 border border-border hover:border-accent rounded-lg p-3 flex items-center gap-2 transition group relative"
              >
                <button
                  onClick={() => onWatch(null, r.site_url, { inApp: true, siteName: r.provider_name })}
                  className="flex-1 flex items-center gap-2 text-left min-w-0"
                >
                  {r.image && (
                    <img
                      src={r.image}
                      className="w-10 h-14 rounded object-cover shrink-0"
                      alt=""
                      onError={e => { e.currentTarget.style.display = 'none'; }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate group-hover:text-accent transition">
                      {r.provider_name}
                    </div>
                    <div className="text-xs text-muted truncate">{r.title}</div>
                    <div className="text-[10px] text-green mt-0.5">
                      ▶ Watch · {r.match_score}% match
                    </div>
                  </div>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); hideScraped(r); }}
                  title="Wrong match? Hide this result"
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-bg4/80 hover:bg-red text-muted hover:text-white opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-xs"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="font-display text-xl text-white mb-1">Available On</h3>
        <div className="text-xs text-muted mb-3">
          Auto-pulled from TMDB · US region · "Watch in app" takes you straight to the show
        </div>
        {data.tmdb_providers?.length ? (
          <div className="space-y-2">
            {data.tmdb_providers.map(p => {
              const site = p.site_in_catalog;
              const linkUrl = p.deep_link || site?.url;
              return (
                <div
                  key={p.provider_id}
                  className={`p-3 rounded-lg border flex items-center gap-3 ${
                    site ? 'bg-bg3 border-border' : 'bg-bg3/40 border-border/60'
                  }`}
                >
                  {p.logo_path && (
                    <img src={p.logo_path} className="w-10 h-10 rounded shrink-0" alt="" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate flex items-center gap-2">
                      {p.provider_name}
                      {p.requires_drm && (
                        <span
                          title="DRM-protected — may only work in external browser"
                          className="text-[10px] bg-gold/20 text-gold px-1.5 py-0.5 rounded"
                        >
                          DRM
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted">
                      {site ? `In your catalog · ${site.category}` : 'Not in catalog'}
                    </div>
                  </div>
                  {linkUrl ? (
                    <ProviderButtons
                      name={p.provider_name}
                      siteId={site?.id}
                      url={linkUrl}
                      drm={p.requires_drm}
                    />
                  ) : (
                    <span className="text-xs text-muted">No link</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-muted text-sm">
            No streaming providers found. Set your TMDB API key in Settings.
          </div>
        )}
      </div>

      {data.search_sites?.length > 0 && (
        <div>
          <h3 className="font-display text-xl text-white mb-1">Search Other Sites</h3>
          <div className="text-xs text-muted mb-3">
            Not a perfect match? Click to search these sites directly for "{data.title}"
            — good for free aggregators like Miruro, HiAnime, etc. that TMDB doesn't index.
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {data.search_sites.map(s => (
              <button
                key={s.id}
                onClick={() => onWatch(s.id, s.search_url, { inApp: true, siteName: s.name })}
                className="bg-bg3 border border-border hover:border-accent hover:bg-bg4 rounded-lg p-3 flex items-center gap-2 transition text-left"
                title={`Search ${s.name} for ${data.title}`}
              >
                {s.logo_url && <img src={s.logo_url} className="w-6 h-6 rounded shrink-0" alt="" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{s.name}</div>
                  <div className="text-[10px] text-muted flex items-center gap-1">
                    🔍 Search
                    {s.is_free === 1 && <span className="text-green">· FREE</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-display text-xl text-white">In Your Catalog</h3>
          <button onClick={onLinkOpen} className="btn btn-ghost text-sm">
            + Link a site
          </button>
        </div>
        {data.crew_links?.length ? (
          <div className="space-y-2">
            {data.crew_links.map(l => (
              <div key={l.id} className="bg-bg3 border border-border rounded-lg p-3 flex items-center gap-3">
                {l.logo_url && <img src={l.logo_url} className="w-8 h-8 rounded shrink-0" alt="" />}
                <div className="flex-1 min-w-0">
                  <div className="text-white font-medium truncate flex items-center gap-2">
                    {l.name}
                    {l.requires_drm && (
                      <span className="text-[10px] bg-gold/20 text-gold px-1.5 py-0.5 rounded">DRM</span>
                    )}
                    {l.direct_url && (
                      <span className="text-[10px] bg-green/20 text-green px-1.5 py-0.5 rounded">DIRECT</span>
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    {l.quality} · Added by{' '}
                    <span style={{ color: l.avatar_color }}>{l.added_by_name}</span>
                  </div>
                </div>
                <ProviderButtons
                  name={l.name}
                  siteId={l.site_id}
                  url={l.deep_link}
                  drm={l.requires_drm}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted text-sm">
            No crew links yet. Click "+ Link a site" to add one.
          </div>
        )}
      </div>
    </div>
  );
}

function LinkServiceModal({ contentId, onClose, onSaved }) {
  const { activeUserId } = useApp();
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [directUrl, setDirectUrl] = useState('');

  useEffect(() => {
    api.getSites().then(d => setSites(d.all || []));
  }, []);

  async function save() {
    if (!siteId) return;
    await api.linkService(contentId, {
      site_id: parseInt(siteId),
      direct_url: directUrl,
      user_id: activeUserId
    });
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-8" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-bg2 rounded-xl p-6 w-full max-w-md border border-border">
        <h3 className="font-display text-2xl text-white mb-4">Link a Site</h3>
        <label className="text-xs text-muted uppercase">Site</label>
        <select value={siteId} onChange={e => setSiteId(e.target.value)} className="input w-full mt-1 mb-4">
          <option value="">Choose...</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="text-xs text-muted uppercase">Direct URL (optional)</label>
        <input
          value={directUrl}
          onChange={e => setDirectUrl(e.target.value)}
          placeholder="https://..."
          className="input w-full mt-1 mb-6"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={save} className="btn btn-primary">Save</button>
        </div>
      </div>
    </div>
  );
}

function CrewProgressTab({ contentId, users, activeUserId }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      const rows = await Promise.all(users.map(async u => {
        const c = await api.getContent(contentId, u.id).catch(() => null);
        return { user: u, wl: c?.watchlist };
      }));
      setData(rows);
    })();
  }, [contentId, users.length]);

  if (!data) return <div className="text-muted">Loading...</div>;

  const mine = data.find(d => d.user.id === activeUserId);

  return (
    <div className="space-y-3">
      {data.map(({ user, wl }) => {
        const isYou = user.id === activeUserId;
        const status = wl?.watch_status || 'not_started';
        let comparison = null;
        if (mine?.wl && wl && !isYou) {
          const diff = (wl.current_episode || 0) - (mine.wl.current_episode || 0);
          if (diff > 0) comparison = `${diff} episode${diff > 1 ? 's' : ''} ahead of you`;
          else if (diff < 0) comparison = `${-diff} episode${-diff > 1 ? 's' : ''} behind you`;
          else comparison = 'Same spot as you';
        }

        return (
          <div
            key={user.id}
            className={`p-4 rounded-lg border flex items-center gap-4 ${
              isYou ? 'border-accent bg-accent/10' : 'border-border bg-bg3'
            }`}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white shrink-0"
              style={{ background: user.avatar_color }}
            >
              {user.display_name[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-white">
                {user.display_name} {isYou && <span className="text-xs text-accent">(you)</span>}
              </div>
              {wl ? (
                <div className="text-sm text-muted">
                  {status === 'completed' ? (
                    <>Completed · ★ {wl.user_rating || '-'}/10</>
                  ) : (
                    <>S{wl.current_season || 1}E{wl.current_episode || 0} · {status.replace(/_/g, ' ')}</>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted">Haven't started</div>
              )}
              {comparison && (
                <div className="text-xs text-accent mt-1">{comparison}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
