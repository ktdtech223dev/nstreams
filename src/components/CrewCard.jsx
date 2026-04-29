import React, { useEffect, useState } from 'react';
import api from '../api';
import { useApp } from '../App';

export default function CrewCard({ user, onViewProfile }) {
  const { activeUserId, openContent } = useApp();
  const [detail, setDetail] = useState(null);
  const [sync, setSync] = useState(null);

  useEffect(() => {
    const load = () => {
      api.getUser(user.id).then(setDetail).catch(() => {});
      api.syncStatus(user.id).then(setSync).catch(() => {});
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [user.id]);

  const isActive = user.id === activeUserId;

  return (
    <div
      className={`surface rounded-2xl p-6 transition cursor-pointer ${
        isActive ? 'ring-2 ring-accent glow' : 'hover:border-surface-4'
      }`}
      onClick={() => onViewProfile && onViewProfile(user)}
    >
      <div className="flex items-start gap-4">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white shrink-0"
          style={{ background: user.avatar_color }}
        >
          {user.display_name[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display text-2xl text-white tracking-wide">
            {user.display_name}
          </div>
          <div className="text-sm text-muted">@{user.username}</div>
          <div className="flex gap-2 mt-2">
            {sync?.mal?.connected && (
              <span className="text-xs bg-bg3 px-2 py-1 rounded flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green rounded-full" />
                MAL
              </span>
            )}
            {sync?.anilist?.connected && (
              <span className="text-xs bg-bg3 px-2 py-1 rounded flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green rounded-full" />
                AniList
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-5 text-center">
        <Stat label="Watching" value={detail?.stats?.watching || 0} color="var(--green)" />
        <Stat label="Completed" value={detail?.stats?.completed || 0} color="var(--accent)" />
        <Stat label="Plan" value={detail?.stats?.plan_to_watch || 0} color="var(--muted)" />
      </div>

      {detail?.thisWeek?.length > 0 && (
        <div className="mt-5">
          <div className="text-xs text-muted uppercase tracking-wider mb-2">This Week</div>
          <div className="flex gap-2">
            {detail.thisWeek.map(w => (
              <div
                key={w.id}
                onClick={e => { e.stopPropagation(); openContent(w.content_id); }}
                className="relative w-14 cursor-pointer"
              >
                {w.poster_path ? (
                  <img src={w.poster_path} className="w-full aspect-[2/3] rounded object-cover" alt="" />
                ) : (
                  <div className="w-full aspect-[2/3] rounded bg-bg4" />
                )}
                {w.current_episode > 0 && (
                  <div className="absolute bottom-0.5 right-0.5 bg-accent text-white text-[10px] px-1 rounded">
                    E{w.current_episode}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {detail?.recentCompleted?.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-muted uppercase tracking-wider mb-2">Recently Completed</div>
          <div className="space-y-1.5">
            {detail.recentCompleted.map(w => (
              <div
                key={w.id}
                onClick={e => { e.stopPropagation(); openContent(w.content_id); }}
                className="text-sm text-white truncate cursor-pointer hover:text-accent transition"
              >
                {w.title} {w.user_rating && <span className="text-gold">★ {w.user_rating}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="bg-bg3 rounded-lg py-2">
      <div className="font-display text-2xl" style={{ color }}>{value}</div>
      <div className="text-xs text-muted uppercase tracking-wider">{label}</div>
    </div>
  );
}
