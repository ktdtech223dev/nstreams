import React from 'react';
import { useApp } from '../App';

export default function ContentCard({ item, onClick }) {
  const { openContent } = useApp();
  const handleClick = onClick || (() => openContent(item.content_id || item.id));

  const status = item.watch_status || null;
  const title = item.title;
  const year = item.release_year;

  return (
    <div
      onClick={handleClick}
      className="card-hover cursor-pointer bg-bg3 rounded-lg overflow-hidden border border-border relative"
      style={{ width: 160, flexShrink: 0 }}
    >
      <div className="relative" style={{ paddingBottom: '150%' }}>
        {item.poster_path ? (
          <img
            src={item.poster_path}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-bg4 text-muted text-xs">
            No Poster
          </div>
        )}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(180deg, transparent 50%, rgba(8,8,16,0.9) 100%)'
          }}
        />
        {status && (
          <div className="absolute top-2 right-2">
            <div className={`w-3 h-3 rounded-full status-${status} ring-2 ring-bg`} />
          </div>
        )}
        {item.is_anime === 1 && (
          <div className="absolute top-2 left-2 bg-accent text-white text-xs px-2 py-0.5 rounded font-bold">
            ANIME
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 p-2">
          <div className="text-white text-sm font-medium line-clamp-2 leading-tight">
            {title}
          </div>
          {year && (
            <div className="text-muted text-xs mt-0.5">{year}</div>
          )}
        </div>
      </div>
      {item.current_episode !== undefined && item.total_episodes ? (
        <div className="px-2 py-1.5 bg-bg3 text-xs text-muted flex justify-between">
          <span>S{item.current_season || 1}E{item.current_episode}</span>
          <span>/ {item.total_episodes}</span>
        </div>
      ) : null}
    </div>
  );
}
