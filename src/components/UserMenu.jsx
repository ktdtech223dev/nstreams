import React, { useEffect, useRef, useState } from 'react';
import { Settings as SettingsIcon, LogOut, ChevronDown } from 'lucide-react';
import { useApp } from '../App';

export default function UserMenu({ onNavigate }) {
  const { activeUser, users, switchUser, showToast } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  if (!activeUser) return null;

  async function signOutAll() {
    if (!confirm('Sign out of every streaming service in the viewer?')) return;
    await window.electron?.clearViewerSession();
    showToast('Cleared all viewer logins');
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-white/5 transition"
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
          style={{
            background: activeUser.avatar_color,
            boxShadow: `0 0 0 2px var(--bg), 0 0 0 3px ${activeUser.avatar_color}`
          }}
        >
          {activeUser.display_name[0]}
        </div>
        <ChevronDown size={14} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="surface-glass absolute right-0 mt-2 w-72 rounded-2xl shadow-lg overflow-hidden animate-fade"
        >
          <div className="p-2">
            <div className="px-3 pt-2 pb-1 text-[10px] tracking-[.15em] font-bold uppercase text-muted">
              Who's Watching
            </div>
            <div className="grid grid-cols-4 gap-2 px-2 py-2">
              {users.map(u => {
                const active = u.id === activeUser.id;
                return (
                  <button
                    key={u.id}
                    onClick={() => { switchUser(u.id); setOpen(false); }}
                    className="flex flex-col items-center gap-1.5 group"
                  >
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold text-white transition-all ${
                        active ? 'scale-100' : 'scale-95 opacity-60 group-hover:opacity-100 group-hover:scale-100'
                      }`}
                      style={{
                        background: u.avatar_color,
                        boxShadow: active ? `0 0 20px ${u.avatar_color}55` : 'none'
                      }}
                    >
                      {u.display_name[0]}
                    </div>
                    <div className={`text-[11px] truncate w-full text-center ${active ? 'text-white' : 'text-muted'}`}>
                      {u.display_name}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="h-px bg-white/5 mx-2" />
          <div className="p-1.5">
            <button
              onClick={() => { onNavigate('settings'); setOpen(false); }}
              className="w-full px-3 py-2 rounded-lg hover:bg-white/5 flex items-center gap-3 text-sm text-text-dim hover:text-white transition"
            >
              <SettingsIcon size={15} />
              <span>Settings</span>
            </button>
            <button
              onClick={signOutAll}
              className="w-full px-3 py-2 rounded-lg hover:bg-white/5 flex items-center gap-3 text-sm text-text-dim hover:text-white transition"
            >
              <LogOut size={15} />
              <span>Sign out of all services</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
