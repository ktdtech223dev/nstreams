import React, { useEffect, useState, useRef } from 'react';
import api from '../api';
import { useApp } from '../App';

const STATUS_TABS = [
  { key: 'all',           label: 'All' },
  { key: 'watching',      label: 'Watching' },
  { key: 'completed',     label: 'Completed' },
  { key: 'plan_to_watch', label: 'Plan to Watch' },
];

export default function CrewProfileModal({ user, onClose }) {
  const { openContent } = useApp();
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [status, setStatus]       = useState('all');
  const [search, setSearch]       = useState('');
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setWatchlist([]);
    api.getWatchlist(user.id, { sort: 'updated' })
      .then(rows => setWatchlist(rows || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  // Close on backdrop click
  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose();
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!user) return null;

  const filtered = watchlist.filter(w => {
    if (status !== 'all' && w.watch_status !== status) return false;
    if (search && !w.title?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = {
    watching:      watchlist.filter(w => w.watch_status === 'watching').length,
    completed:     watchlist.filter(w => w.watch_status === 'completed').length,
    plan_to_watch: watchlist.filter(w => w.watch_status === 'plan_to_watch').length,
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={handleOverlayClick}
    >
      <div className="surface rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-4 p-6 border-b border-border shrink-0">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold text-white shrink-0"
            style={{ background: user.avatar_color }}
          >
            {user.display_name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-display text-2xl text-white">{user.display_name}</div>
            <div className="text-sm text-muted">@{user.username}</div>
            <div className="flex gap-4 mt-1 text-xs text-muted">
              <span><span className="text-green font-medium">{counts.watching}</span> watching</span>
              <span><span className="text-accent font-medium">{counts.completed}</span> completed</span>
              <span><span className="text-muted font-medium">{counts.plan_to_watch}</span> plan to watch</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-white transition text-2xl leading-none ml-2"
          >
            ×
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 px-6 pt-4 shrink-0 flex-wrap">
          <div className="flex gap-1 bg-bg3 rounded-lg p-1">
            {STATUS_TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setStatus(t.key)}
                className={`px-3 py-1 rounded text-xs font-medium transition ${
                  status === t.key ? 'bg-accent text-white' : 'text-muted hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="input flex-1 text-sm py-1.5 min-w-0"
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {loading ? (
            <div className="text-muted text-sm text-center py-8">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-muted text-sm text-center py-8">Nothing here yet.</div>
          ) : (
            filtered.map(w => (
              <div
                key={w.id}
                onClick={() => openContent(w.content_id || w.id)}
                className="flex items-center gap-3 bg-bg3 hover:bg-bg4 rounded-xl p-3 cursor-pointer transition"
              >
                {w.poster_path ? (
                  <img
                    src={`https://image.tmdb.org/t/p/w92${w.poster_path}`}
                    className="w-10 h-14 rounded object-cover shrink-0"
                    alt=""
                  />
                ) : (
                  <div className="w-10 h-14 rounded bg-bg4 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-white font-medium text-sm truncate">{w.title}</div>
                  <div className="text-xs text-muted flex items-center gap-2 mt-0.5 flex-wrap">
                    <StatusBadge status={w.watch_status} />
                    {w.current_episode > 0 && (
                      <span>S{w.current_season || 1} E{w.current_episode}</span>
                    )}
                    {w.release_year && <span>{w.release_year}</span>}
                  </div>
                </div>
                {w.user_rating > 0 && (
                  <div className="text-gold text-sm font-medium shrink-0">★ {w.user_rating}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    watching:      { label: 'Watching',      color: 'text-green' },
    completed:     { label: 'Completed',     color: 'text-accent' },
    plan_to_watch: { label: 'Plan to Watch', color: 'text-muted' },
    on_hold:       { label: 'On Hold',       color: 'text-gold' },
    dropped:       { label: 'Dropped',       color: 'text-red' },
  };
  const s = map[status] || { label: status, color: 'text-muted' };
  return <span className={s.color}>{s.label}</span>;
}
