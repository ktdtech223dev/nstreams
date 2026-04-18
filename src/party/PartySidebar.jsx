import React, { useEffect, useRef, useState } from 'react';
import { useParty } from './PartyContext';
import { useApp } from '../App';

// Floating chat + controls sidebar shown whenever a party is active.
// Lives in the main N Streams window. User keeps this + viewer window
// visible side-by-side (or snapped).
const REACTIONS = ['🔥', '😂', '😱', '😭', '👀', '❤️', '💀', '🤯'];

export default function PartySidebar() {
  const { party, members, messages, playback, reactions,
          sendChat, sendReaction, control, leaveParty } = useParty();
  const { activeUser, showToast } = useApp();
  const [text, setText] = useState('');
  const [minimized, setMinimized] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  if (!party) return null;

  const isHost = party.host_id === String(activeUser?.id);

  function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    sendChat(text);
    setText('');
  }

  function copyCode() {
    navigator.clipboard.writeText(party.code);
    showToast(`Copied ${party.code}`);
  }

  async function end() {
    if (!confirm('End the watch party?')) return;
    await leaveParty();
  }

  if (minimized) {
    return (
      <div
        onClick={() => setMinimized(false)}
        className="fixed bottom-6 right-6 z-40 bg-accent text-white px-4 py-2.5 rounded-full shadow-2xl cursor-pointer flex items-center gap-2 pulse-glow"
      >
        📺 Party · {members.length} watching
      </div>
    );
  }

  return (
    <div
      className="fixed right-4 top-12 bottom-4 w-80 z-40 bg-bg2 border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
      style={{ boxShadow: '0 0 40px rgba(99,102,241,0.3)' }}
    >
      {/* Floating reactions */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
        {reactions.map(r => (
          <div
            key={r.id}
            className="absolute text-4xl animate-fade"
            style={{
              left: `${20 + Math.random() * 60}%`,
              bottom: '100px',
              animation: 'float 2.2s ease-out forwards'
            }}
          >
            {r.emoji}
            <div className="text-[10px] text-center mt-1" style={{ color: r.user?.color }}>
              {r.user?.name}
            </div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="p-3 border-b border-border bg-bg3">
        <div className="flex items-center justify-between mb-2">
          <div className="font-display text-lg text-white tracking-wide flex items-center gap-2">
            <span className="w-2 h-2 bg-green rounded-full animate-pulse" />
            Watch Party
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setMinimized(true)}
              className="text-muted hover:text-white w-7 h-7 rounded hover:bg-bg4 transition"
              title="Minimize"
            >
              _
            </button>
            <button
              onClick={end}
              className="text-muted hover:text-red w-7 h-7 rounded hover:bg-bg4 transition"
              title="Leave"
            >
              ✕
            </button>
          </div>
        </div>
        {party.content && (
          <div className="flex gap-2 items-center text-sm mb-2">
            {party.content.poster && (
              <img src={party.content.poster} className="w-8 h-12 rounded object-cover" alt="" />
            )}
            <div className="min-w-0">
              <div className="text-white truncate font-medium">{party.content.title}</div>
              {party.site && <div className="text-xs text-muted">on {party.site.name}</div>}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={copyCode}
            className="font-mono text-xs bg-bg4 text-accent px-2 py-1 rounded hover:bg-bg transition"
            title="Click to copy"
          >
            {party.code}
          </button>
          <div className="flex -space-x-2">
            {members.map(m => (
              <div
                key={m.id}
                className="w-7 h-7 rounded-full border-2 border-bg2 flex items-center justify-center text-xs font-bold text-white"
                style={{ background: m.color }}
                title={m.name}
              >
                {m.name[0]}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Host controls */}
      <div className="p-3 border-b border-border bg-bg3/30">
        <div className="text-[10px] uppercase tracking-wider text-muted mb-2">
          {isHost ? 'Host Controls' : 'Sync'}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => control('play')}
            className="flex-1 btn btn-ghost text-xs py-1.5 justify-center"
          >
            ▶ Play All
          </button>
          <button
            onClick={() => control('pause')}
            className="flex-1 btn btn-ghost text-xs py-1.5 justify-center"
          >
            ⏸ Pause All
          </button>
        </div>
        <div className="text-[10px] text-muted mt-2">
          Current: {playback.playing ? 'Playing' : 'Paused'} at {formatTime(playback.current_time)}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 ? (
          <div className="text-center text-xs text-muted py-8">
            Chat starts here. 👋
          </div>
        ) : messages.map(m => (
          m.system ? (
            <div key={m.id} className="text-center text-[10px] text-muted italic">
              — {m.text} —
            </div>
          ) : (
            <div key={m.id} className="text-sm">
              <span className="font-medium" style={{ color: m.color }}>
                {m.name}
              </span>
              <span className="text-muted text-[10px] ml-2">
                {new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <div className="text-text/90 break-words">{m.text}</div>
            </div>
          )
        ))}
      </div>

      {/* Reactions bar */}
      <div className="px-3 py-2 border-t border-border flex justify-between">
        {REACTIONS.map(e => (
          <button
            key={e}
            onClick={() => sendReaction(e)}
            className="text-xl hover:scale-125 transition"
          >
            {e}
          </button>
        ))}
      </div>

      {/* Composer */}
      <form onSubmit={submit} className="p-3 border-t border-border flex gap-2">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Say something…"
          className="input flex-1 text-sm"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="btn btn-primary text-sm px-3 disabled:opacity-40"
        >
          ➤
        </button>
      </form>
    </div>
  );
}

function formatTime(seconds) {
  if (!seconds && seconds !== 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}
