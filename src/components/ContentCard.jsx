import React from 'react';
import { Play, Plus, Check, Info } from 'lucide-react';
import { useApp } from '../App';
import api from '../api';

const STATUS_LABEL = {
  watching: 'Watching',
  completed: 'Completed',
  plan_to_watch: 'Plan to watch',
  on_hold: 'On hold',
  dropped: 'Dropped'
};

export default function ContentCard({ item, onClick, edge }) {
  const { openContent, openPlayer, activeUserId, showToast } = useApp();
  const handleOpen = onClick || (() => openContent(item.content_id || item.id));

  const status = item.watch_status || null;
  const title = item.title;
  const year = item.release_year;
  const inList = !!status;
  const contentId = item.content_id || item.id;

  async function addList(e) {
    e.stopPropagation();
    try {
      await api.addToWatchlist({
        user_id: activeUserId,
        content_id: contentId,
        watch_status: 'plan_to_watch'
      });
      showToast('Added to your list');
    } catch (err) {
      showToast('Failed: ' + err.message);
    }
  }

  function quickPlay(e) {
    e.stopPropagation();
    // Open content modal — user can then pick a source
    openContent(contentId);
  }

  const edgeClass = edge === 'left' ? 'edge-left' : edge === 'right' ? 'edge-right' : '';

  return (
    <div
      onClick={handleOpen}
      className={`card-netflix ${edgeClass}`}
      style={{ width: 180, flexShrink: 0 }}
    >
      {/* Base poster */}
      <div className="card-base relative bg-surface-2" style={{ paddingBottom: '150%' }}>
        {item.poster_path ? (
          <img
            src={item.poster_path}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-3 text-muted text-xs p-4 text-center">
            {title}
          </div>
        )}
        {status && (
          <div className="absolute top-2 right-2">
            <div className={`w-2.5 h-2.5 rounded-full status-${status}`} style={{ boxShadow: '0 0 0 2px rgba(5,5,16,0.8)' }} />
          </div>
        )}
        {item.is_anime === 1 && (
          <div className="absolute top-2 left-2 bg-accent text-white text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
            Anime
          </div>
        )}
        {item.current_episode > 0 && item.total_episodes > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
            <div
              className="h-full bg-accent"
              style={{ width: `${Math.min(100, (item.current_episode / item.total_episodes) * 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* Hover overlay */}
      <div className="card-overlay absolute left-0 right-0 top-full pt-2 z-20">
        <div className="surface-glass rounded-lg p-3 shadow-lg">
          <div className="flex items-center gap-1.5 mb-2">
            <button
              onClick={quickPlay}
              className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center hover:bg-white/90 transition"
              title="Play"
            >
              <Play size={14} fill="currentColor" />
            </button>
            {!inList ? (
              <button
                onClick={addList}
                className="w-8 h-8 rounded-full bg-white/10 border border-white/30 text-white flex items-center justify-center hover:bg-white/20 transition"
                title="Add to list"
              >
                <Plus size={14} />
              </button>
            ) : (
              <div
                className="w-8 h-8 rounded-full bg-green/20 border border-green/40 text-green flex items-center justify-center"
                title="In your list"
              >
                <Check size={14} />
              </div>
            )}
            <div className="flex-1" />
            <button
              onClick={(e) => { e.stopPropagation(); openContent(contentId); }}
              className="w-8 h-8 rounded-full bg-white/10 border border-white/30 text-white flex items-center justify-center hover:bg-white/20 transition"
              title="Details"
            >
              <Info size={14} />
            </button>
          </div>
          <div className="text-sm font-semibold text-white line-clamp-1">{title}</div>
          <div className="text-[11px] text-muted flex items-center gap-1.5 mt-0.5">
            {year && <span>{year}</span>}
            {status && (
              <>
                {year && <span>·</span>}
                <span className={`inline-flex items-center gap-1`}>
                  <span className={`w-1.5 h-1.5 rounded-full status-${status}`} />
                  {STATUS_LABEL[status]}
                </span>
              </>
            )}
            {item.total_episodes > 0 && (
              <>
                <span>·</span>
                <span>{item.current_episode || 0}/{item.total_episodes} eps</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
