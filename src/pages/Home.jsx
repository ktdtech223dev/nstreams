import React, { useEffect, useState } from 'react';
import api from '../api';
import { useApp } from '../App';
import ContentCard from '../components/ContentCard';
import ActivityFeed from '../components/ActivityFeed';
import DiscoverRow from '../components/DiscoverRow';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Home() {
  const { activeUser, activeUserId, setPage } = useApp();
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
        setPlan(p.slice(0, 10));

        const acts = await api.activityCrew();
        const added = acts.filter(a => a.activity_type === 'added_to_watchlist').slice(0, 10);
        setRecentAdds(added);
      } catch (_) {}
    })();
  }, [activeUserId]);

  // Discover rows — depends on TMDB key being set
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
    <div className="space-y-10 max-w-[1600px]">
      <header>
        <h1 className="font-display text-5xl text-white tracking-wide">
          {greeting()}, {activeUser?.display_name || '...'}
        </h1>
        <p className="text-muted mt-1">
          Let's find something good to watch with the crew.
        </p>
      </header>

      {watching.length > 0 && (
        <Row title="Continue Watching" onMore={() => setPage('watchlist')}>
          {watching.slice(0, 10).map(w => <ContentCard key={w.id} item={w} />)}
        </Row>
      )}

      {/* DISCOVER: Netflix-style browser by service */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-display text-4xl text-white tracking-wide">Browse by Service</h2>
            <p className="text-xs text-muted mt-1">
              Trending titles on the streaming services in your catalog
            </p>
          </div>
          <div className="flex gap-1 bg-bg3 rounded-lg p-1">
            <button
              onClick={() => setDiscoverType('tv')}
              className={`px-3 py-1.5 rounded-md text-sm transition ${
                discoverType === 'tv' ? 'bg-accent text-white' : 'text-muted hover:text-white'
              }`}
            >
              TV
            </button>
            <button
              onClick={() => setDiscoverType('movie')}
              className={`px-3 py-1.5 rounded-md text-sm transition ${
                discoverType === 'movie' ? 'bg-accent text-white' : 'text-muted hover:text-white'
              }`}
            >
              Movies
            </button>
          </div>
        </div>

        {discoverError ? (
          <div className="bg-bg2 border border-border rounded-xl p-6 text-center">
            <div className="text-muted">
              {discoverError.includes('TMDB_KEY_MISSING')
                ? 'Add your TMDB API key in Settings to unlock Browse by Service.'
                : `Couldn't load discover: ${discoverError}`}
            </div>
            <button onClick={() => setPage('settings')} className="btn btn-primary mt-3">
              Open Settings
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {trending.length > 0 && (
              <DiscoverRow
                title="🔥 Trending This Week"
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
        <Row title="Recently Added by Crew">
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
                  className="absolute -top-1 -left-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 border-bg z-10"
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
          <h2 className="font-display text-3xl text-white tracking-wide">Crew Activity</h2>
          <button onClick={() => setPage('crew')} className="text-sm text-accent hover:underline">
            See all →
          </button>
        </div>
        <div className="bg-bg2 border border-border rounded-xl p-4">
          <ActivityFeed compact limit={5} />
        </div>
      </section>
    </div>
  );
}

function Row({ title, onMore, children }) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-display text-3xl text-white tracking-wide">{title}</h2>
        {onMore && (
          <button onClick={onMore} className="text-sm text-accent hover:underline">
            See all →
          </button>
        )}
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4">{children}</div>
    </section>
  );
}
