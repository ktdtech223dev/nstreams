import React, { useEffect, useState } from 'react';
import { Play, Check, Clock, Calendar, Star, Film } from 'lucide-react';
import api from '../api';
import { useApp } from '../App';

function fmtDate(s) {
  if (!s) return null;
  try { return new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return s; }
}

export default function EpisodeTracker({ content, wl, update, onAdvance }) {
  const { activeUserId, openPlayer } = useApp();
  const totalSeasons = content.total_seasons || 1;
  const totalEp = content.total_episodes || 0;
  const [season, setSeason] = useState(wl?.current_season || 1);
  const [seasonData, setSeasonData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const currentEp = wl?.current_episode || 0;
  const currentSeason = wl?.current_season || 1;

  useEffect(() => {
    if (!content.id || !content.tmdb_id) return;
    let cancelled = false;
    setLoading(true); setError(null);
    api.getSeason(content.id, season)
      .then(d => { if (!cancelled) { setSeasonData(d); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [content.id, content.tmdb_id, season]);

  // Movies + content without tmdb_id — fall back to simple numbered grid
  if (!content.tmdb_id || content.type === 'movie') {
    if (content.type === 'movie') {
      return (
        <div className="text-center py-16">
          <div className="text-muted mb-4">Movies don't have episodes.</div>
          <button
            onClick={() => update({ watch_status: 'completed' })}
            className="btn btn-primary"
          >
            <Check size={16} /> Mark as watched
          </button>
        </div>
      );
    }
    return <div className="text-center py-12 text-muted">No episode data available for this title.</div>;
  }

  const watchedCount = wl?.total_watched_episodes || 0;
  const progressPct = totalEp ? Math.min(100, (watchedCount / totalEp) * 100) : 0;

  async function advance() {
    if (!wl) {
      await update({ watch_status: 'watching' });
    } else {
      onAdvance?.();
    }
  }

  // Parse the seasons array (stored as JSON on content) once
  const seasonsMeta = React.useMemo(() => {
    if (!content.seasons) return null;
    try { return JSON.parse(content.seasons); } catch { return null; }
  }, [content.seasons]);

  function cumulativeCountThrough(seasonN, episodeN) {
    if (seasonsMeta && seasonsMeta.length) {
      const prior = seasonsMeta
        .filter(s => s.season_number < seasonN)
        .reduce((n, s) => n + (s.episode_count || 0), 0);
      return prior + episodeN;
    }
    // Proportional fallback if seasons metadata hasn't been backfilled
    if (totalEp && totalSeasons) {
      const avg = Math.round(totalEp / totalSeasons);
      return (seasonN - 1) * avg + episodeN;
    }
    return episodeN;
  }

  async function pickEpisode(ep) {
    const cumulative = cumulativeCountThrough(season, ep.episode_number);
    const priorCount = cumulative - 1; // episodes watched BEFORE this one

    // If this implies marking ≥ 5 previous episodes as watched,
    // show a confirmation toast via update's onComplete
    await update({
      current_season: season,
      current_episode: ep.episode_number,
      total_watched_episodes: cumulative,
      watch_status: 'watching'
    });
  }

  async function markCompleteThroughHere(ep) {
    const cumulative = cumulativeCountThrough(season, ep.episode_number);
    await update({
      current_season: season,
      current_episode: ep.episode_number,
      total_watched_episodes: cumulative,
      watch_status: (totalEp && cumulative >= totalEp) ? 'completed' : 'watching'
    });
  }

  return (
    <div className="space-y-6">
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[.15em] text-muted">Progress</div>
          <div className="display-md text-white">
            S{currentSeason}E{currentEp}
            <span className="text-muted text-2xl ml-2">/ {totalEp} eps</span>
          </div>
        </div>
        <button onClick={advance} className="btn btn-primary btn-hero">
          <Play size={16} fill="currentColor" /> Advance Episode
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div className="h-full bg-accent transition-all" style={{ width: `${progressPct}%` }} />
      </div>

      {/* Season selector */}
      {totalSeasons > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          {Array.from({ length: totalSeasons }, (_, i) => i + 1).map(s => (
            <button
              key={s}
              onClick={() => setSeason(s)}
              className={`px-4 py-2 rounded-full text-sm shrink-0 transition font-semibold ${
                s === season
                  ? 'bg-accent text-white'
                  : 'bg-surface-2 text-muted hover:bg-surface-3 hover:text-white'
              }`}
            >
              Season {s}
            </button>
          ))}
        </div>
      )}

      {/* Loading / error */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="skeleton h-24 rounded-xl" />
          ))}
        </div>
      )}
      {error && (
        <div className="surface rounded-xl p-4 text-red text-sm">
          Failed to load episodes: {error}
        </div>
      )}

      {/* Bulk action: mark all prior seasons watched */}
      {seasonsMeta && season > 1 && (
        <div className="flex items-center gap-2 py-2 px-3 surface rounded-xl text-xs">
          <span className="text-muted">Already watched previous seasons?</span>
          <button
            onClick={() => update({
              current_season: season,
              current_episode: 0,
              total_watched_episodes: cumulativeCountThrough(season, 0),
              watch_status: 'watching'
            })}
            className="btn btn-ghost text-xs px-3 py-1"
          >
            ✓ Mark Seasons 1–{season - 1} as complete
          </button>
        </div>
      )}

      {/* Episode list */}
      {seasonData && !loading && (
        <div className="space-y-2">
          {seasonData.episodes.map(ep => {
            const isCurrent = season === currentSeason && ep.episode_number === currentEp;
            const isWatched = season < currentSeason ||
              (season === currentSeason && ep.episode_number <= currentEp);
            return (
              <div
                key={ep.id}
                onClick={() => pickEpisode(ep)}
                className={`group surface-elevated rounded-xl p-3 cursor-pointer transition flex gap-4 ${
                  isCurrent
                    ? 'ring-2 ring-accent glow'
                    : 'hover:border-accent/40'
                }`}
              >
                {/* Thumbnail */}
                <div className="relative shrink-0 w-40 h-24 rounded-lg overflow-hidden bg-surface-3">
                  {ep.still_path ? (
                    <img
                      src={ep.still_path}
                      alt={ep.name}
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Film size={24} className="text-muted" />
                    </div>
                  )}
                  {/* Watched tint */}
                  {isWatched && !isCurrent && (
                    <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
                      <Check size={24} className="text-green" strokeWidth={3} />
                    </div>
                  )}
                  {/* Play hover */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition">
                    <div className="opacity-0 group-hover:opacity-100 transition w-10 h-10 rounded-full bg-white/95 text-black flex items-center justify-center shadow-lg">
                      <Play size={16} fill="currentColor" />
                    </div>
                  </div>
                  {/* Episode number badge */}
                  <div className="absolute bottom-1 left-1 bg-black/85 text-white text-[11px] px-1.5 py-0.5 rounded font-bold">
                    E{ep.episode_number}
                  </div>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <div className={`font-semibold truncate ${isCurrent ? 'text-accent' : 'text-white'}`}>
                        {ep.episode_number}. {ep.name || `Episode ${ep.episode_number}`}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-muted mt-0.5">
                        {ep.runtime > 0 && (
                          <span className="flex items-center gap-1">
                            <Clock size={10} />{ep.runtime}m
                          </span>
                        )}
                        {ep.air_date && (
                          <span className="flex items-center gap-1">
                            <Calendar size={10} />{fmtDate(ep.air_date)}
                          </span>
                        )}
                        {ep.rating > 0 && (
                          <span className="flex items-center gap-1 text-gold">
                            <Star size={10} fill="currentColor" />{ep.rating.toFixed(1)}
                          </span>
                        )}
                        {isCurrent && (
                          <span className="bg-accent/25 text-accent px-1.5 py-0.5 rounded uppercase tracking-wider font-bold text-[9px]">
                            Up next
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {ep.overview && (
                    <p className="text-sm text-text-dim line-clamp-2 leading-snug">
                      {ep.overview}
                    </p>
                  )}
                  {!ep.overview && (
                    <p className="text-sm text-muted italic">No description available.</p>
                  )}
                </div>

                {/* Hover actions */}
                <div className="shrink-0 opacity-0 group-hover:opacity-100 transition flex flex-col gap-1.5 self-center">
                  {!isCurrent && (
                    <button
                      onClick={(e) => { e.stopPropagation(); markCompleteThroughHere(ep); }}
                      className="btn btn-ghost text-[10px] px-2 py-1 whitespace-nowrap"
                      title={`Mark this and all previous episodes as watched (${cumulativeCountThrough(season, ep.episode_number)} total)`}
                    >
                      <Check size={11} /> Up to here
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Mark season complete */}
      {seasonData && (
        <div className="flex gap-3 pt-2">
          <button
            onClick={() => update({
              current_season: season,
              current_episode: seasonData.episodes.length,
              total_watched_episodes: seasonData.episodes.length * season
            })}
            className="btn btn-ghost"
          >
            <Check size={14} /> Mark Season {season} Complete
          </button>
        </div>
      )}
    </div>
  );
}
