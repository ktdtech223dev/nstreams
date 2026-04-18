import React from 'react';
import { useApp } from '../App';

const NAV = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'watchlist', label: 'Watchlist', icon: '▶' },
  { id: 'browse', label: 'Browse', icon: '◎' },
  { id: 'sites', label: 'Sites', icon: '◈' },
  { id: 'crew', label: 'Crew', icon: '◉' },
  { id: 'settings', label: 'Settings', icon: '⚙' }
];

export default function Sidebar({ page, setPage }) {
  const { activeUser } = useApp();

  return (
    <aside
      className="bg-bg2 border-r border-border flex flex-col"
      style={{ width: 220, flexShrink: 0 }}
    >
      <div className="px-5 pt-6 pb-8">
        <div className="flex items-baseline gap-1">
          <span className="font-display text-accent text-4xl leading-none">N</span>
          <span className="font-display text-white text-3xl leading-none tracking-wider">STREAMS</span>
        </div>
        <div className="text-xs text-muted mt-1 pl-1">by n games</div>
      </div>

      <nav className="flex-1 px-3">
        {NAV.map(n => (
          <button
            key={n.id}
            onClick={() => setPage(n.id)}
            className={`w-full text-left px-4 py-3 rounded-lg mb-1 flex items-center gap-3 transition-all ${
              page === n.id
                ? 'bg-accent text-white glow'
                : 'text-muted hover:bg-bg3 hover:text-white'
            }`}
          >
            <span className="text-lg w-5 text-center">{n.icon}</span>
            <span className="font-medium">{n.label}</span>
          </button>
        ))}
      </nav>

      {activeUser && (
        <div className="px-5 py-5 border-t border-border">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
              style={{ background: activeUser.avatar_color }}
            >
              {activeUser.display_name[0]}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-white truncate">
                {activeUser.display_name}
              </div>
              <div className="text-xs text-muted truncate">
                @{activeUser.username}
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
