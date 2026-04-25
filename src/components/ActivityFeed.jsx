import React, { useEffect, useState } from 'react';
import api from '../api';
import { useApp } from '../App';

const LABELS = {
  added_to_watchlist: 'added to watchlist',
  advanced_episode: 'watched an episode of',
  finished_episode: 'finished an episode of',
  started_watching: 'started',
  status_changed: 'updated status of',
  completed: 'completed',
  rated: 'rated',
  linked_service: 'linked a service for',
  added_site: 'added a new site'
};

function timeAgo(iso) {
  const d = new Date(iso + 'Z');
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function ActivityFeed({ compact, limit }) {
  const { openContent } = useApp();
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => api.activityCrew().then(d => { if (!cancelled) setItems(d); }).catch(() => {});
    load();
    const timer = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const list = limit ? items.slice(0, limit) : items;

  return (
    <div className="space-y-2">
      {list.map(a => {
        const meta = a.metadata ? JSON.parse(a.metadata) : {};
        return (
          <div
            key={a.id}
            onClick={() => a.content_id && openContent(a.content_id)}
            className={`flex items-center gap-3 p-2 rounded-lg ${
              a.content_id ? 'cursor-pointer hover:bg-bg3' : ''
            } transition`}
          >
            <div
              className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white"
              style={{ background: a.avatar_color || '#6366f1' }}
            >
              {a.display_name?.[0] || '?'}
            </div>
            <div className="flex-1 min-w-0 text-sm">
              <span style={{ color: a.avatar_color }} className="font-medium">
                {a.display_name}
              </span>{' '}
              <span className="text-muted">{LABELS[a.activity_type] || a.activity_type}</span>{' '}
              {a.title && <span className="text-white">{a.title}</span>}
              {meta.rating && <span className="text-gold"> · ★ {meta.rating}</span>}
              {meta.name && <span className="text-white"> {meta.name}</span>}
            </div>
            {a.poster_path && !compact && (
              <img src={a.poster_path} className="w-8 h-12 rounded object-cover shrink-0" alt="" />
            )}
            <div className="text-xs text-muted shrink-0">{timeAgo(a.created_at)}</div>
          </div>
        );
      })}
      {list.length === 0 && (
        <div className="text-muted text-sm text-center py-8">No activity yet.</div>
      )}
    </div>
  );
}
