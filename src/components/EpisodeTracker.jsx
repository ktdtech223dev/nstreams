import React, { useState } from 'react';

export default function EpisodeTracker({ content, wl, update, onAdvance }) {
  const totalSeasons = content.total_seasons || 1;
  const totalEp = content.total_episodes || 0;
  const [season, setSeason] = useState(wl?.current_season || 1);

  // Estimate episodes per season
  const epsPerSeason = totalSeasons ? Math.ceil(totalEp / totalSeasons) : totalEp;
  const currentEp = wl?.current_episode || 0;

  if (!totalEp) {
    return (
      <div className="text-center py-12">
        <div className="text-muted">No episode data for this title.</div>
        {content.type === 'movie' && (
          <button
            onClick={() => update({ watch_status: 'completed' })}
            className="btn btn-primary mt-4"
          >
            Mark Movie Watched
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-muted uppercase tracking-wider">Progress</div>
          <div className="font-display text-3xl text-white">
            S{wl?.current_season || 1}E{currentEp}
            <span className="text-muted text-xl"> / {totalEp} eps</span>
          </div>
        </div>
        <button onClick={onAdvance} className="btn btn-primary text-base px-6 py-3 glow">
          + Advance Episode
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-bg3 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${Math.min(100, ((wl?.total_watched_episodes || 0) / totalEp) * 100)}%` }}
        />
      </div>

      {/* Season selector */}
      {totalSeasons > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {Array.from({ length: totalSeasons }, (_, i) => i + 1).map(s => (
            <button
              key={s}
              onClick={() => setSeason(s)}
              className={`px-4 py-2 rounded-lg text-sm shrink-0 transition ${
                s === season ? 'bg-accent text-white' : 'bg-bg3 text-muted hover:bg-bg4'
              }`}
            >
              Season {s}
            </button>
          ))}
        </div>
      )}

      {/* Episode grid */}
      <div className="grid grid-cols-8 gap-2">
        {Array.from({ length: epsPerSeason }, (_, i) => i + 1).map(ep => {
          const isWatched = season < (wl?.current_season || 1) ||
            (season === (wl?.current_season || 1) && ep <= currentEp);
          const isCurrent = season === (wl?.current_season || 1) && ep === currentEp;
          return (
            <button
              key={ep}
              onClick={() => update({ current_season: season, current_episode: ep })}
              className={`aspect-square rounded text-xs font-medium transition ${
                isCurrent
                  ? 'bg-accent text-white ring-2 ring-accent2'
                  : isWatched
                  ? 'bg-green/30 text-green'
                  : 'bg-bg3 text-muted hover:bg-bg4'
              }`}
            >
              {ep}
            </button>
          );
        })}
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => update({
            current_season: season,
            current_episode: epsPerSeason,
            total_watched_episodes: epsPerSeason * season
          })}
          className="btn btn-ghost"
        >
          Mark Season Complete
        </button>
      </div>
    </div>
  );
}
