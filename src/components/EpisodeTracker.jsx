import React, { useEffect, useState } from 'react';
import {
  Play, Check, Clock, Calendar, Star, Film,
  ChevronDown, RotateCcw, Zap, Sparkles
} from 'lucide-react';
import api from '../api';
import { useApp } from '../App';

function fmtDate(s) {
  if (!s) return null;
  try { return new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return s; }
}
function fmtTime(sec) {
  if (!sec || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}

export default function EpisodeTracker({ content, wl, update, onAdvance }) {
  const { activeUserId, openPlayer, showToast } = useApp();
  const totalSeasons = content.total_seasons || 1;
  const totalEp = content.total_episodes || 0;
  const [season, setSeason] = useState(wl?.current_season || 1);
  const [seasonData, setSeasonData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progressMap, setProgressMap] = useState({}); // "S:E" → progress row
  const [expandedKey, setExpandedKey] = useState(null); // "S:E" string
  const [sourcesByKey, setSourcesByKey] = useState({}); // "S:E" → scrape results

  const currentEp = wl?.current_episode || 0;
  const currentSeason = wl?.current_season || 1;

  const isAnime = content.is_anime === 1 || content.type === 'anime';
  const useAnilist = !content.tmdb_id && isAnime;

  useEffect(() => {
    if (!content.id) return;
    // Need either TMDB id (for per-season data) OR anime branch (AniList)
    if (!content.tmdb_id && !isAnime) return;

    let cancelled = false;
    setLoading(true); setError(null);

    const fetcher = useAnilist
      ? api.getAnimeEpisodes(content.id)
      : api.getSeason(content.id, season);

    fetcher
      .then(d => { if (!cancelled) { setSeasonData(d); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [content.id, content.tmdb_id, season, isAnime, useAnilist]);

  // Fetch all episode-progress rows once per content
  useEffect(() => {
    if (!content.id || !activeUserId) return;
    api.episodeProgressAll(activeUserId, content.id).then(rows => {
      const m = {};
      for (const r of rows) m[`${r.season_number}:${r.episode_number}`] = r;
      setProgressMap(m);
    }).catch(() => {});
  }, [content.id, activeUserId]);

  // Movies: no episode grid needed
  if (content.type === 'movie') {
    return (
      <div className="text-center py-16">
        <div className="text-muted mb-4">Movies don't have episodes.</div>
        <button onClick={() => update({ watch_status: 'completed' })} className="btn btn-primary">
          <Check size={16} /> Mark as watched
        </button>
      </div>
    );
  }
  // Non-anime TV shows without a TMDB id — no data source available
  if (!content.tmdb_id && !isAnime) {
    return <div className="text-center py-12 text-muted">No episode data available for this title.</div>;
  }

  const watchedCount = wl?.total_watched_episodes || 0;
  const progressPct = totalEp ? Math.min(100, (watchedCount / totalEp) * 100) : 0;

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
    if (totalEp && totalSeasons) {
      const avg = Math.round(totalEp / totalSeasons);
      return (seasonN - 1) * avg + episodeN;
    }
    return episodeN;
  }

  async function advance() {
    if (!wl) await update({ watch_status: 'watching' });
    else onAdvance?.();
  }

  async function markCompleteThroughHere(ep) {
    const cumulative = cumulativeCountThrough(season, ep.episode_number);
    await update({
      current_season: season,
      current_episode: ep.episode_number,
      total_watched_episodes: cumulative,
      watch_status: (totalEp && cumulative >= totalEp) ? 'completed' : 'watching'
    });
    showToast(`Marked ${cumulative} episodes as watched`);
  }

  async function loadSourcesForEp(ep) {
    const key = `${season}:${ep.episode_number}`;
    if (sourcesByKey[key]) return;
    try {
      const d = await api.scrapeAvailability(content.id, activeUserId, {
        season, episode: ep.episode_number
      });
      setSourcesByKey(prev => ({ ...prev, [key]: d.results || [] }));
    } catch (e) {
      setSourcesByKey(prev => ({ ...prev, [key]: [] }));
    }
  }

  function toggleExpand(ep) {
    const key = `${season}:${ep.episode_number}`;
    if (expandedKey === key) { setExpandedKey(null); return; }
    setExpandedKey(key);
    loadSourcesForEp(ep);
  }

  async function playEpisode(ep, sourceUrl, providerName) {
    const cumulative = cumulativeCountThrough(season, ep.episode_number);

    // Mark current episode + total watched up to (but not including) this ep
    await update({
      current_season: season,
      current_episode: ep.episode_number,
      total_watched_episodes: Math.max(cumulative - 1, watchedCount),
      watch_status: 'watching'
    });

    // Check if we have a saved resume point for this exact (episode, source)
    let resumeAt = 0;
    const prog = progressMap[`${season}:${ep.episode_number}`];
    if (prog && prog.last_site_url === sourceUrl && prog.last_position_seconds > 10) {
      resumeAt = prog.last_position_seconds;
    }

    // Start a session (upserts watchlist, saves last_site_url at show level)
    try {
      await api.startSession({
        user_id: activeUserId,
        content_id: content.id,
        site_id: null,
        site_url: sourceUrl
      });
    } catch {}

    // Persist initial per-episode source so it's remembered even if
    // the player never heartbeats (closed immediately).
    try {
      await api.saveEpisodeProgress({
        user_id: activeUserId,
        content_id: content.id,
        season_number: season,
        episode_number: ep.episode_number,
        last_site_url: sourceUrl,
        last_provider: providerName,
        last_position_seconds: resumeAt
      });
      setProgressMap(prev => ({
        ...prev,
        [`${season}:${ep.episode_number}`]: {
          season_number: season,
          episode_number: ep.episode_number,
          last_site_url: sourceUrl,
          last_provider: providerName,
          last_position_seconds: resumeAt,
          last_duration_seconds: 0
        }
      }));
    } catch {}

    openPlayer({
      url: sourceUrl,
      title: `${content.title} · S${season}E${ep.episode_number}${ep.name ? ` · ${ep.name}` : ''}`,
      contentId: content.id,
      watchlistId: wl?.id,
      season,
      episode: ep.episode_number,
      provider: providerName,
      resumeAt
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

      <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div className="h-full bg-accent transition-all" style={{ width: `${progressPct}%` }} />
      </div>

      {/* Season selector — hidden in AniList mode (anime data comes
          back as a single flat season) */}
      {!useAnilist && totalSeasons > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          {Array.from({ length: totalSeasons }, (_, i) => i + 1).map(s => (
            <button
              key={s}
              onClick={() => { setSeason(s); setExpandedKey(null); }}
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

      {/* Mark prior seasons as complete */}
      {seasonsMeta && season > 1 && (
        <div className="flex items-center gap-2 py-2 px-3 surface rounded-xl text-xs">
          <span className="text-muted">Already watched previous seasons?</span>
          <button
            onClick={() => update({
              current_season: season, current_episode: 0,
              total_watched_episodes: cumulativeCountThrough(season, 0),
              watch_status: 'watching'
            })}
            className="btn btn-ghost text-xs px-3 py-1"
          >
            ✓ Mark Seasons 1–{season - 1} as complete
          </button>
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

      {/* Episode list */}
      {seasonData && !loading && (
        <div className="space-y-2">
          {seasonData.episodes.map(ep => {
            const key = `${season}:${ep.episode_number}`;
            const isCurrent = season === currentSeason && ep.episode_number === currentEp;
            const isWatched = season < currentSeason ||
              (season === currentSeason && ep.episode_number < currentEp);
            const expanded = expandedKey === key;
            const prog = progressMap[key];

            return (
              <EpisodeCard
                key={ep.id}
                ep={ep}
                season={season}
                isCurrent={isCurrent}
                isWatched={isWatched}
                expanded={expanded}
                prog={prog}
                sources={sourcesByKey[key]}
                onToggle={() => toggleExpand(ep)}
                onPlay={playEpisode}
                onMarkUpToHere={() => markCompleteThroughHere(ep)}
              />
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
              total_watched_episodes: cumulativeCountThrough(season, seasonData.episodes.length),
              watch_status: 'watching'
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

function EpisodeCard({ ep, season, isCurrent, isWatched, expanded, prog, sources, onToggle, onPlay, onMarkUpToHere }) {
  const last = prog?.last_site_url;
  const lastProv = prog?.last_provider;

  // Build a sane ordering for the sources panel:
  // - Preferred: the user's last source for this episode (if any)
  // - Then: the grouped embed aggregator card (expanded into its variants)
  // - Then: scraped providers that are specific (Miruro, Anify, FlixHQ...)
  //         — we treat these as DRM-free primary sources
  // - Then: TMDB/official providers (DRM) as secondary, shown collapsed
  const embedGroup = sources?.find(s => s.is_grouped);
  const embedVariants = embedGroup?.variants || [];
  const otherScrapes = (sources || []).filter(s => !s.is_grouped);

  const drmFree = [...embedVariants, ...otherScrapes];

  return (
    <div className={`surface-elevated rounded-xl transition overflow-hidden ${
      isCurrent ? 'ring-2 ring-accent glow' : 'hover:border-accent/40'
    }`}>
      {/* Row */}
      <div
        onClick={onToggle}
        className="group p-3 cursor-pointer flex gap-4"
      >
        {/* Thumbnail */}
        <div className="relative shrink-0 w-40 h-24 rounded-lg overflow-hidden bg-surface-3">
          {ep.still_path ? (
            <img src={ep.still_path} alt={ep.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center"><Film size={24} className="text-muted" /></div>
          )}
          {isWatched && (
            <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
              <Check size={24} className="text-green" strokeWidth={3} />
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition">
            <div className="opacity-0 group-hover:opacity-100 transition w-10 h-10 rounded-full bg-white/95 text-black flex items-center justify-center shadow-lg">
              <Play size={16} fill="currentColor" />
            </div>
          </div>
          <div className="absolute bottom-1 left-1 bg-black/85 text-white text-[11px] px-1.5 py-0.5 rounded font-bold">
            E{ep.episode_number}
          </div>
          {/* Per-episode resume indicator */}
          {prog?.last_position_seconds > 10 && prog?.last_duration_seconds > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/50">
              <div
                className="h-full bg-accent"
                style={{ width: `${Math.min(100, (prog.last_position_seconds / prog.last_duration_seconds) * 100)}%` }}
              />
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 mb-1">
            <div className="flex-1 min-w-0">
              <div className={`font-semibold ${isCurrent ? 'text-accent' : 'text-white'}`}>
                {ep.episode_number}. {ep.name || `Episode ${ep.episode_number}`}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted mt-0.5 flex-wrap">
                {ep.runtime > 0 && <span className="flex items-center gap-1"><Clock size={10} />{ep.runtime}m</span>}
                {ep.air_date && <span className="flex items-center gap-1"><Calendar size={10} />{fmtDate(ep.air_date)}</span>}
                {ep.rating > 0 && <span className="flex items-center gap-1 text-gold"><Star size={10} fill="currentColor" />{ep.rating.toFixed(1)}</span>}
                {isCurrent && (
                  <span className="bg-accent/25 text-accent px-1.5 py-0.5 rounded uppercase tracking-wider font-bold text-[9px]">
                    Up next
                  </span>
                )}
                {prog?.last_position_seconds > 10 && (
                  <span className="bg-green/20 text-green px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1">
                    <RotateCcw size={9} /> {fmtTime(prog.last_position_seconds)}
                  </span>
                )}
              </div>
            </div>
          </div>
          {ep.overview && (
            <p className="text-sm text-text-dim line-clamp-2 leading-snug">{ep.overview}</p>
          )}
          {!ep.overview && (
            <p className="text-sm text-muted italic">No description available.</p>
          )}
        </div>

        {/* Hover actions */}
        <div className="shrink-0 flex flex-col items-end gap-1.5 self-center">
          {!isCurrent && (
            <button
              onClick={(e) => { e.stopPropagation(); onMarkUpToHere(); }}
              className="btn btn-ghost text-[10px] px-2 py-1 opacity-0 group-hover:opacity-100 transition whitespace-nowrap"
              title="Mark this and all previous episodes as watched"
            >
              <Check size={11} /> Up to here
            </button>
          )}
          <ChevronDown
            size={16}
            className={`text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {/* Expanded source picker */}
      {expanded && (
        <div className="border-t border-white/5 p-4 bg-surface-1/40 space-y-3 animate-fade">
          {/* Resume bar if we have a last source */}
          {last && (
            <button
              onClick={() => onPlay(ep, last, lastProv)}
              className="w-full btn btn-primary btn-hero justify-between"
            >
              <span className="flex items-center gap-2">
                <Play size={16} fill="currentColor" />
                {prog.last_position_seconds > 10
                  ? `Resume at ${fmtTime(prog.last_position_seconds)}`
                  : 'Continue on last source'}
              </span>
              <span className="text-xs font-normal opacity-75">
                {lastProv || 'last source'}
              </span>
            </button>
          )}

          {/* DRM-free sources */}
          <div>
            <div className="text-[10px] uppercase tracking-[.15em] text-accent font-bold mb-2 flex items-center gap-1.5">
              <Sparkles size={11} />
              One-click · DRM-free
            </div>
            {!sources ? (
              <div className="text-sm text-muted">Loading sources…</div>
            ) : drmFree.length === 0 ? (
              <div className="text-sm text-muted">No DRM-free sources found for this episode.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {drmFree.map(s => {
                  const isLast = s.site_url === last;
                  return (
                    <button
                      key={`${s.provider}-${s.site_url}`}
                      onClick={() => onPlay(ep, s.site_url, s.provider_name)}
                      className={`btn ${isLast ? 'btn-primary' : 'btn-secondary'} text-sm`}
                    >
                      <Play size={13} fill="currentColor" /> {s.provider_name}
                      {isLast && (
                        <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded ml-1">Last used</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="text-[10px] text-muted mt-2 flex items-center gap-1">
              <Zap size={10} /> Aggregator sites — no account needed, DRM-free
            </div>
          </div>

          {/* Quick tip */}
          <div className="text-[10px] text-muted pt-1 border-t border-white/5">
            Prefer an official service like Prime Video or Hulu? Jump to the
            <span className="text-white"> Where to Watch </span>tab — that lives at the show level.
          </div>
        </div>
      )}
    </div>
  );
}
