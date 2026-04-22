import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../App';
import api from '../api';

// ─── Filter chips ─────────────────────────────────────────────────────────────
const FILTERS = [
  { id: 'all',          label: 'All' },
  { id: 'ufc',          label: '🥊 UFC' },
  { id: 'basketball',   label: '🏀 NBA' },
  { id: 'football',     label: '🏈 NFL' },
  { id: 'hockey',       label: '🏒 NHL' },
  { id: 'baseball',     label: '⚾ MLB' },
  { id: 'soccer',       label: '⚽ Soccer' },
  { id: 'f1',           label: '🏎️ F1' },
  { id: 'motogp',       label: '🏍️ MotoGP' },
  { id: 'wec',          label: '🏁 WEC' },
  { id: 'boxing',       label: '🥊 Boxing' },
  { id: 'golf',         label: '⛳ Golf' },
  { id: 'tennis',       label: '🎾 Tennis' },
];

// ─── Emoji helper ─────────────────────────────────────────────────────────────
function getEmoji(ev) {
  const byLeague = { f1: '🏎️', wec: '🏁', motogp: '🏍️', boxing: '🥊', ufc: '🥊' };
  const bySport  = {
    basketball: '🏀', football: '🏈', hockey: '🏒', baseball: '⚾',
    soccer: '⚽', golf: '⛳', tennis: '🎾', motorsports: '🏎️',
  };
  return byLeague[ev.leagueId] || bySport[ev.sport] || '🏆';
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function localDateLabel(iso) {
  const d = new Date(iso);
  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const dDay     = new Date(d);    dDay.setHours(0, 0, 0, 0);
  if (dDay.getTime() === today.getTime())    return 'Today';
  if (dDay.getTime() === tomorrow.getTime()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function groupUpcomingByDate(events) {
  const groups = [];
  const keyMap = {};
  for (const ev of events) {
    const key = localDateLabel(ev.startTime);
    if (!keyMap[key]) { keyMap[key] = []; groups.push({ label: key, events: keyMap[key] }); }
    keyMap[key].push(ev);
  }
  return groups;
}

// ─── EventCard ────────────────────────────────────────────────────────────────
function EventCard({ event, expanded, onToggle, onStream }) {
  const isLive  = event.status === 'live';
  const isFinal = event.status === 'final';
  const emoji   = getEmoji(event);

  return (
    <div
      className={`rounded-xl border transition-all overflow-hidden select-none
        ${isLive
          ? 'border-red/30 bg-red/5 hover:bg-red/8 cursor-pointer'
          : isFinal
            ? 'border-border/50 bg-transparent opacity-60 hover:opacity-80 cursor-pointer'
            : 'border-border bg-surface-1 hover:bg-surface-2 cursor-pointer'}`}
      onClick={onToggle}
    >
      {/* Main row */}
      <div className="px-4 py-3 flex items-center gap-3">
        <span className="text-xl shrink-0 leading-none">{emoji}</span>

        <div className="flex-1 min-w-0">
          {/* Title + live badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white leading-snug">{event.title}</span>
            {isLive && (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-red bg-red/15 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-red animate-pulse" />
                LIVE
              </span>
            )}
            {isFinal && (
              <span className="text-[10px] text-text-dim bg-surface-3 px-2 py-0.5 rounded-full">Final</span>
            )}
          </div>

          {/* Meta row */}
          <div className="text-xs text-text-dim flex items-center gap-1.5 mt-0.5 flex-wrap leading-relaxed">
            <span className="font-medium">{event.league}</span>
            {event.subtitle && event.subtitle !== event.league && (
              <>
                <span className="opacity-40">·</span>
                <span className="truncate max-w-[220px]">{event.subtitle.replace(event.league + ' · ', '')}</span>
              </>
            )}
            {!isLive && !isFinal && (
              <>
                <span className="opacity-40">·</span>
                <span>{formatTime(event.startTime)}</span>
              </>
            )}
            {event.statusText && !['LIVE', 'Final', 'F', ''].includes(event.statusText) && (
              <>
                <span className="opacity-40">·</span>
                <span className="text-accent">{event.statusText}</span>
              </>
            )}
          </div>

          {/* Live score */}
          {event.score && (
            <div className="text-sm font-mono text-white/80 mt-1 tracking-tight">{event.score}</div>
          )}
        </div>

        {/* Expand chevron */}
        <span
          className={`text-text-dim transition-transform duration-200 shrink-0 text-lg leading-none ${expanded ? 'rotate-90' : ''}`}
        >›</span>
      </div>

      {/* Expanded: stream buttons */}
      {expanded && (
        <div
          className="border-t border-white/5 bg-black/20 px-4 py-3 flex flex-wrap gap-2 items-center"
          onClick={e => e.stopPropagation()}
        >
          <span className="text-xs text-text-dim mr-1 shrink-0">Watch on:</span>
          {event.streams.map(s => (
            <button
              key={s.name}
              onClick={() => onStream(s, event)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent/15 hover:bg-accent/30 text-accent text-sm font-medium transition"
            >
              ▶ {s.name}
            </button>
          ))}
          <span className="text-[11px] text-text-dim/50 ml-auto shrink-0 hidden sm:block">
            Opens in viewer
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Sports page ──────────────────────────────────────────────────────────────
export default function Sports() {
  const { openPlayer } = useApp();
  const [events,     setEvents]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [filter,     setFilter]     = useState('all');
  const [expanded,   setExpanded]   = useState(new Set());
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (bust = false) => {
    try {
      if (bust) {
        setRefreshing(true);
        await api.post('/sports/clear-cache', {});
      } else {
        setLoading(true);
      }
      const data = await api.get('/sports');
      setEvents(data);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60 s to keep live scores / status current
  useEffect(() => {
    const t = setInterval(() => load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Filter
  const filtered = events.filter(ev => {
    if (filter === 'all') return true;
    return ev.leagueId === filter || ev.sport === filter;
  });

  const live     = filtered.filter(ev => ev.status === 'live');
  const upcoming = filtered.filter(ev => ev.status === 'upcoming');
  const finals   = filtered.filter(ev => ev.status === 'final');
  const upcomingGroups = groupUpcomingByDate(upcoming);

  function toggleExpand(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openStream(stream, event) {
    openPlayer({
      url: stream.url,
      title: `${event.title} — ${stream.name}`,
      contentId: null,
    });
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        <div className="text-text-dim text-sm">Loading sports schedule…</div>
      </div>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="font-display text-3xl text-white">Sports</h1>
          <p className="text-text-dim text-sm mt-1">
            Live events & this week's schedule · times in your local zone
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="mt-1 shrink-0 flex items-center gap-2 px-4 py-2 rounded-full bg-surface-2 hover:bg-surface-3
            text-sm text-text-dim hover:text-white transition disabled:opacity-40"
        >
          {refreshing
            ? <><span className="animate-spin inline-block">⟳</span> Refreshing…</>
            : '⟳ Refresh'}
        </button>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl bg-red/10 border border-red/20 text-sm text-red">
          ⚠ Could not load schedule: {error}
        </div>
      )}

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-8">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition
              ${filter === f.id
                ? 'bg-accent text-white shadow-md'
                : 'bg-surface-2 text-text-dim hover:bg-surface-3 hover:text-white'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── LIVE NOW ── */}
      {live.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-2.5 h-2.5 rounded-full bg-red animate-pulse" />
            <h2 className="font-display text-xl text-white">Live Now</h2>
            <span className="text-xs bg-red/15 text-red px-2 py-0.5 rounded-full font-medium">
              {live.length}
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {live.map(ev => (
              <EventCard
                key={ev.id} event={ev}
                expanded={expanded.has(ev.id)}
                onToggle={() => toggleExpand(ev.id)}
                onStream={openStream}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── UPCOMING ── */}
      {upcoming.length > 0 && (
        <section className="mb-10">
          <h2 className="font-display text-xl text-white mb-5">Upcoming</h2>
          {upcomingGroups.map(({ label, events: evs }) => (
            <div key={label} className="mb-7">
              {/* Date divider */}
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-bold uppercase tracking-[.14em] text-text-dim shrink-0">
                  {label}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="flex flex-col gap-2">
                {evs.map(ev => (
                  <EventCard
                    key={ev.id} event={ev}
                    expanded={expanded.has(ev.id)}
                    onToggle={() => toggleExpand(ev.id)}
                    onStream={openStream}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ── RECENT RESULTS ── */}
      {finals.length > 0 && (
        <section className="mb-8">
          <h2 className="font-display text-lg text-white mb-4 opacity-70">Recent Results</h2>
          <div className="flex flex-col gap-2">
            {finals.slice(0, 15).map(ev => (
              <EventCard
                key={ev.id} event={ev}
                expanded={expanded.has(ev.id)}
                onToggle={() => toggleExpand(ev.id)}
                onStream={openStream}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {filtered.length === 0 && !loading && !error && (
        <div className="text-center py-24 text-text-dim">
          <div className="text-5xl mb-4">📅</div>
          <div className="text-base font-medium text-white/60">No events right now</div>
          <div className="text-sm mt-2 opacity-50">
            {filter === 'all'
              ? 'Check back soon — events will appear here when scheduled.'
              : 'No events for this sport this week. Try All or a different category.'}
          </div>
        </div>
      )}
    </div>
  );
}
