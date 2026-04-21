import React, { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import api from '../api';
import { useApp } from '../App';
import ContentCard from '../components/ContentCard';
import ActivityFeed from '../components/ActivityFeed';
import DiscoverRow from '../components/DiscoverRow';
import Hero from '../components/Hero';

export default function Home() {
  const { activeUserId, setPage } = useApp();
  const [watching, setWatching] = useState([]);
  const [plan, setPlan] = useState([]);
  const [recentAdds, setRecentAdds] = useState([]);
  const [trending, setTrending] = useState([]);
  const [serviceRows, setServiceRows] = useState([]);
  const [discoverType, setDiscoverType] = useState('tv');
  const [discoverError, setDiscoverError] = useState(null);

  useEffect(() => {
    if (!activeUserId) return;
    (async () => {
      try {
        const w = await api.getWatchlist(activeUserId, { status: 'watching' });
        setWatching(w);
        const p = await api.getWatchlist(activeUserId, { status: 'plan_to_watch' });
        setPlan(p.slice(0, 12));
        const acts = await api.activityCrew();
        const added = acts.filter(a => a.activity_type === 'added_to_watchlist').slice(0, 12);
        setRecentAdds(added);
      } catch (_) {}
    })();
  }, [activeUserId]);

  useEffect(() => {
    loadDiscover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoverType]);

  async function loadDiscover() {
    setDiscoverError(null);
    try {
      const [t, rows] = await Promise.all([
        api.discoverTrending(discoverType === 'tv' ? 'tv' : 'movie').catch(() => []),
        api.discoverAll(discoverType).catch((e) => {
          setDiscoverError(e.message);
          return [];
        })
      ]);
      setTrending(t);
      setServiceRows(rows);
    } catch (e) {
      setDiscoverError(e.message);
    }
  }

  return (
    <div className="pb-20">
      <Hero />

      <div className="mt-[-80px] relative z-10 space-y-12 px-10">
        {watching.length > 0 && (
          <Row title="Continue Watching" onMore={() => setPage('watchlist')}>
            {watching.slice(0, 12).map((w, i) => (
              <ContentCard
                key={w.id}
                item={w}
                edge={i === 0 ? 'left' : i === Math.min(12, watching.length) - 1 ? 'right' : null}
              />
            ))}
          </Row>
        )}

        {/* DISCOVER */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="row-title">Browse by Service</h2>
            <div className="flex gap-1 surface p-1 rounded-full">
              <button
                onClick={() => setDiscoverType('tv')}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${
                  discoverType === 'tv' ? 'bg-accent text-white' : 'text-muted hover:text-white'
                }`}
              >
                TV
              </button>
              <button
                onClick={() => setDiscoverType('movie')}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${
                  discoverType === 'movie' ? 'bg-accent text-white' : 'text-muted hover:text-white'
                }`}
              >
                Movies
              </button>
            </div>
          </div>

          {discoverError ? (
            <div className="surface rounded-2xl p-8 text-center">
              <div className="text-muted">
                {discoverError.includes('TMDB_KEY_MISSING')
                  ? 'Add your TMDB API key in Settings to unlock Browse by Service.'
                  : `Couldn't load discover: ${discoverError}`}
              </div>
              <button onClick={() => setPage('settings')} className="btn btn-primary mt-4">
                Open Settings
              </button>
            </div>
          ) : (
            <div className="space-y-10">
              {trending.length > 0 && (
                <DiscoverRow
                  title="Trending This Week"
                  subtitle="Across all services"
                  items={trending}
                  accent="#f59e0b"
                />
              )}
              {serviceRows.length === 0 && !discoverError && (
                <div className="text-muted text-sm">Loading service rows…</div>
              )}
              {serviceRows.map(row => (
                <DiscoverRow
                  key={row.site.id}
                  title={row.site.name}
                  subtitle={`Popular on ${row.site.name} · ${row.site.quality}`}
                  items={row.results}
                  logoUrl={row.site.logo_url}
                />
              ))}
            </div>
          )}
        </section>

        {recentAdds.length > 0 && (
          <Row title="Recently Added by the Crew">
            {recentAdds.map(a => (
              <div key={a.id} className="relative">
                <ContentCard
                  item={{
                    content_id: a.content_id,
                    title: a.title,
                    poster_path: a.poster_path
                  }}
                />
                {a.avatar_color && (
                  <div
                    className="absolute -top-1.5 -left-1.5 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-bg z-30 shadow-md"
                    style={{ background: a.avatar_color }}
                    title={a.display_name}
                  >
                    {a.display_name?.[0]}
                  </div>
                )}
              </div>
            ))}
          </Row>
        )}

        {plan.length > 0 && (
          <Row title="Plan to Watch" onMore={() => setPage('watchlist')}>
            {plan.map(w => <ContentCard key={w.id} item={w} />)}
          </Row>
        )}

        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="row-title">Crew Activity</h2>
            <button
              onClick={() => setPage('crew')}
              className="text-xs text-muted hover:text-accent transition flex items-center gap-1 uppercase tracking-wider font-semibold"
            >
              See all <ChevronRight size={14} />
            </button>
          </div>
          <div className="surface rounded-2xl p-5">
            <ActivityFeed compact limit={5} />
          </div>
        </section>
      </div>
    </div>
  );
}

function Row({ title, onMore, children }) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="row-title">{title}</h2>
        {onMore && (
          <button
            onClick={onMore}
            className="text-xs text-muted hover:text-accent transition flex items-center gap-1 uppercase tracking-wider font-semibold"
          >
            See all <ChevronRight size={14} />
          </button>
        )}
      </div>
      {/* Extra vertical padding so hovered cards (scale 1.08) don't clip */}
      <div className="row-scroll flex gap-3 overflow-x-auto pb-16 pt-2 px-1">
        {children}
      </div>
    </section>
  );
}
