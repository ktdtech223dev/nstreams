import React, { useEffect, useState } from 'react';
import { Play, Info, Plus, Check } from 'lucide-react';
import api from '../api';
import { useApp } from '../App';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Hero() {
  const { activeUser, activeUserId, openContent, openPlayer, showToast } = useApp();
  const [featured, setFeatured] = useState(null);
  const [where, setWhere] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeUserId) return;
    (async () => {
      setLoading(true);
      try {
        // Prefer currently watching (most recent)
        const watching = await api.getWatchlist(activeUserId, { status: 'watching' });
        if (watching?.length) {
          const pick = watching.find(w => w.backdrop_path) || watching[0];
          if (pick) {
            const full = await api.getContent(pick.content_id || pick.id, activeUserId);
            setFeatured(full);
            setLoading(false);
            return;
          }
        }
        // Fallback: trending with a backdrop
        const trending = await api.discoverTrending('tv').catch(() => []);
        const pick2 = trending.find(t => t.backdrop_path);
        if (pick2) {
          setFeatured({
            ...pick2,
            _tmdbOnly: true,
            genres: JSON.stringify(['Trending'])
          });
        }
      } catch (_) {}
      setLoading(false);
    })();
  }, [activeUserId]);

  // For in-list items, fetch where-to-watch
  useEffect(() => {
    if (featured?.id && !featured._tmdbOnly) {
      api.whereToWatch(featured.id).then(setWhere).catch(() => {});
    }
  }, [featured?.id]);

  async function addToList() {
    if (!featured) return;
    try {
      const content = await api.addContent({
        tmdb_id: featured.tmdb_id,
        type: featured.media_type === 'movie' ? 'movie' : 'tv',
        user_id: activeUserId
      });
      await api.addToWatchlist({
        user_id: activeUserId,
        content_id: content.id,
        watch_status: 'plan_to_watch'
      });
      showToast('Added to your list');
      openContent(content.id);
    } catch (e) {
      showToast('Failed: ' + e.message);
    }
  }

  function watchNow() {
    if (!featured || featured._tmdbOnly) { openContent(featured?.id); return; }

    // Prefer the last source the user watched this show on
    const lastUrl = featured.watchlist?.last_site_url;
    if (lastUrl) {
      openPlayer({
        url: lastUrl,
        title: featured.title,
        contentId: featured.id,
        watchlistId: featured.watchlist?.id
      });
      return;
    }

    const first = where?.crew_links?.[0] || where?.tmdb_providers?.find(p => p.site_in_catalog);
    if (first?.deep_link || first?.site_in_catalog?.url) {
      openPlayer({
        url: first.deep_link || first.site_in_catalog.url,
        title: featured.title,
        contentId: featured.id,
        watchlistId: featured.watchlist?.id
      });
    } else {
      openContent(featured.id);
    }
  }

  function more() {
    if (featured?.id && !featured._tmdbOnly) openContent(featured.id);
  }

  if (loading) {
    return <div className="w-full h-[70vh] skeleton" />;
  }
  if (!featured) {
    return (
      <div className="w-full h-[40vh] flex items-end px-12 pb-10 bg-gradient-to-b from-surface-2 to-bg">
        <div>
          <div className="text-xs uppercase tracking-[.18em] text-accent mb-2">{greeting()}, {activeUser?.display_name}</div>
          <div className="display-lg text-white">Welcome to N&nbsp;Streams</div>
          <div className="text-muted mt-2">Add a show from Browse or search above.</div>
        </div>
      </div>
    );
  }

  const genres = featured.genres ? (JSON.parse(featured.genres) || []).slice(0, 3) : [];
  const year = featured.release_year;
  const rating = featured.rating;
  const inList = !!featured.watchlist;

  return (
    <div className="relative w-full h-[70vh] min-h-[420px] overflow-hidden">
      {/* Backdrop */}
      {featured.backdrop_path && (
        <img
          src={featured.backdrop_path.replace('w780', 'original')}
          className="absolute inset-0 w-full h-full object-cover"
          alt=""
          onError={e => { e.currentTarget.src = featured.backdrop_path; }}
        />
      )}
      {/* Gradients */}
      <div className="absolute inset-0"
        style={{ background: 'linear-gradient(90deg, rgba(5,5,16,0.95) 0%, rgba(5,5,16,0.7) 35%, rgba(5,5,16,0.15) 70%, transparent 100%)' }}
      />
      <div className="absolute inset-0"
        style={{ background: 'linear-gradient(0deg, var(--bg) 0%, transparent 40%, transparent 100%)' }}
      />

      {/* Content */}
      <div className="relative h-full flex flex-col justify-end px-12 pb-16 max-w-3xl animate-slide-up">
        <div className="text-xs uppercase tracking-[.18em] text-accent mb-3 flex items-center gap-2">
          <span className="inline-block w-4 h-px bg-accent" />
          {greeting()}, {activeUser?.display_name}
        </div>

        <h1 className="display-xl text-white mb-3" style={{ textShadow: '0 4px 40px rgba(0,0,0,0.8)' }}>
          {featured.title}
        </h1>

        <div className="flex items-center gap-3 text-sm text-text-dim mb-4">
          {rating > 0 && (
            <span className="flex items-center gap-1 text-gold">
              <span className="text-lg leading-none">★</span>
              <span className="font-semibold">{rating.toFixed(1)}</span>
            </span>
          )}
          {year && <span>{year}</span>}
          {genres.length > 0 && (
            <span className="text-muted">
              {genres.join(' · ')}
            </span>
          )}
          {featured.total_episodes && <span className="text-muted">{featured.total_episodes} episodes</span>}
        </div>

        {featured.overview && (
          <p className="text-text-dim text-base leading-relaxed mb-6 line-clamp-3 max-w-2xl">
            {featured.overview}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button onClick={watchNow} className="btn btn-primary btn-hero">
            <Play size={18} fill="currentColor" /> Watch
          </button>
          {!featured._tmdbOnly && (
            <button onClick={more} className="btn btn-secondary btn-hero">
              <Info size={18} /> More info
            </button>
          )}
          {!inList && (
            <button onClick={addToList} className="btn btn-icon btn-secondary" title="Add to My List">
              <Plus size={18} />
            </button>
          )}
          {inList && (
            <div className="btn btn-icon" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }} title="In your list">
              <Check size={18} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
