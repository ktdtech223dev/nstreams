import React, { useState } from 'react';
import api from '../api';
import { useApp } from '../App';

export default function SessionBanner({ session, onAction }) {
  const { showToast } = useApp();
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);
  if (dismissed) return null;

  async function end(finished) {
    setLoading(true);
    try {
      const r = await api.endSession(session.id, { finished_episode: finished });
      if (finished) {
        if (r.completed) {
          showToast('🎉 Series complete! Great job.');
        } else {
          showToast(`Advanced to E${r.current_episode}`);
        }
      }
      onAction?.();
    } catch (e) {
      showToast('Failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sticky top-0 z-30 bg-accent text-white px-6 py-3 flex items-center gap-4 pulse-glow">
      <span className="text-lg">📺</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">
          Still watching <b>{session.title}</b>?
        </div>
        <div className="text-xs opacity-80">
          S{session.current_season || 1}E{session.current_episode || 0}
          {session.site_name && ` · ${session.site_name}`}
        </div>
      </div>
      <button
        onClick={() => end(true)}
        disabled={loading}
        className="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-md text-sm font-medium transition disabled:opacity-50"
      >
        ✓ Finished it
      </button>
      <button
        onClick={() => end(false)}
        disabled={loading}
        className="bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md text-sm transition disabled:opacity-50"
      >
        ⏸ Not yet
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="hover:bg-white/20 w-7 h-7 rounded-md transition flex items-center justify-center"
      >
        ✕
      </button>
    </div>
  );
}
