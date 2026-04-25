import React, { useEffect, useRef, useState } from 'react';
import {
  Home, Compass, Bookmark, Users, Globe, Trophy, Tv,
  Search, X, Minus, Square, Check, ArrowRight
} from 'lucide-react';
import { useApp } from '../App';
import api from '../api';
import UserMenu from './UserMenu';

const NAV = [
  { id: 'home',       label: 'Home',     icon: Home },
  { id: 'browse',     label: 'Browse',   icon: Compass },
  { id: 'watchlist',  label: 'My List',  icon: Bookmark },
  { id: 'cable',      label: 'Cable',    icon: Tv },
  { id: 'crew',       label: 'Crew',     icon: Users },
  { id: 'sports',     label: 'Sports',   icon: Trophy },
  { id: 'sites',      label: 'Sites',    icon: Globe }
];

export default function TopNav({ page, setPage, searchRef }) {
  const { activeUserId, openContent, setPage: ctxSetPage, showToast } = useApp();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [watchlistHits, setWatchlistHits] = useState([]);
  const [tmdbHits, setTmdbHits] = useState([]);
  const [loadingTmdb, setLoadingTmdb] = useState(false);
  const [allWatchlist, setAllWatchlist] = useState([]);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Expose input focus to parent via ref (for ⌘K)
  useEffect(() => {
    if (searchRef) searchRef.current = inputRef.current;
  }, [searchRef]);

  // Load watchlist once per user
  useEffect(() => {
    if (!activeUserId) return;
    api.getWatchlist(activeUserId).then(setAllWatchlist).catch(() => {});
  }, [activeUserId]);

  // Refresh watchlist when the search opens (so new additions show up)
  useEffect(() => {
    if (focused && activeUserId) {
      api.getWatchlist(activeUserId).then(setAllWatchlist).catch(() => {});
    }
  }, [focused, activeUserId]);

  // Client-side watchlist filter (instant)
  useEffect(() => {
    if (!query || query.length < 2) { setWatchlistHits([]); return; }
    const q = query.toLowerCase();
    const hits = allWatchlist
      .filter(w => (w.title || '').toLowerCase().includes(q))
      .slice(0, 6);
    setWatchlistHits(hits);
  }, [query, allWatchlist]);

  // Debounced TMDB search
  useEffect(() => {
    if (!query || query.length < 2) { setTmdbHits([]); setLoadingTmdb(false); return; }
    setLoadingTmdb(true);
    const h = setTimeout(async () => {
      try {
        const r = await api.search(query, 'multi');
        setTmdbHits(r.slice(0, 10));
      } catch (e) {
        setTmdbHits([]);
      } finally {
        setLoadingTmdb(false);
      }
    }, 250);
    return () => clearTimeout(h);
  }, [query]);

  // Dismiss handlers
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setFocused(false); inputRef.current?.blur(); } };
    const onClick = (e) => {
      if (!dropdownRef.current) return;
      if (dropdownRef.current.contains(e.target)) return;
      if (inputRef.current?.contains(e.target)) return;
      setFocused(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, []);

  function reset() {
    setQuery('');
    setFocused(false);
    inputRef.current?.blur();
  }

  async function addFromTmdb(item) {
    try {
      const content = await api.addContent({
        tmdb_id: item.tmdb_id,
        type: item.media_type === 'movie' ? 'movie' : 'tv',
        user_id: activeUserId
      });
      openContent(content.id);
      showToast(`Added ${item.title}`);
      reset();
    } catch (e) {
      showToast('Failed: ' + e.message);
    }
  }

  function openWl(w) {
    openContent(w.content_id);
    reset();
  }

  // Check if TMDB id is already in watchlist
  const watchlistTmdbIds = new Set(allWatchlist.map(w => w.tmdb_id).filter(Boolean));

  // Win controls
  const handle = (op) => window.electron?.[op]?.();

  const showDropdown = focused && query.length >= 2;

  return (
    <>
      <header
        className="drag-region h-14 w-full flex items-center gap-4 px-5 border-b border-border relative z-50"
        style={{ background: 'var(--surface-1)', flexShrink: 0 }}
      >
        {/* Logo */}
        <button
          onClick={() => setPage('home')}
          className="no-drag flex items-baseline gap-1.5 group"
        >
          <span
            className="font-display text-accent text-3xl leading-none transition-all"
            style={{ textShadow: '0 0 22px rgba(99,102,241,0.6)' }}
          >N</span>
          <span className="font-display text-white text-2xl leading-none tracking-wider opacity-90 group-hover:opacity-100">
            STREAMS
          </span>
        </button>

        {/* Nav items */}
        <nav className="no-drag flex items-center gap-1 ml-4">
          {NAV.map(n => {
            const Icon = n.icon;
            const active = page === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                className={`px-3.5 py-2 rounded-full text-sm font-medium flex items-center gap-2 transition
                  ${active
                    ? 'bg-accent/20 text-white'
                    : 'text-text-dim hover:text-white hover:bg-white/5'}`}
              >
                <Icon size={16} strokeWidth={2.2} />
                <span>{n.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Flex spacer — also draggable */}
        <div className="flex-1 drag-region h-full" />

        {/* Search */}
        <div className="no-drag relative">
          <div className={`flex items-center rounded-full transition-all duration-200
            ${focused ? 'bg-surface-3 ring-2 ring-accent w-80' : 'bg-surface-2 w-64 hover:bg-surface-3'}`}
          >
            <Search size={16} className="text-muted ml-3.5" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              placeholder="Search titles…"
              className="bg-transparent flex-1 py-2 pl-2.5 pr-3 text-sm text-white placeholder-muted outline-none"
            />
            {query && (
              <button onClick={reset} className="mr-2 p-1 text-muted hover:text-white">
                <X size={14} />
              </button>
            )}
            {!query && (
              <kbd className="mr-3 hidden md:inline-flex text-[10px] text-muted font-mono px-1.5 py-0.5 rounded bg-surface-4 border border-border">
                Ctrl&nbsp;K
              </kbd>
            )}
          </div>

          {/* Dropdown */}
          {showDropdown && (
            <div
              ref={dropdownRef}
              className="surface-glass absolute right-0 mt-2 w-[480px] rounded-2xl shadow-lg overflow-hidden animate-fade"
              style={{ maxHeight: 560 }}
            >
              {/* Watchlist section */}
              {watchlistHits.length > 0 && (
                <div className="p-2 pt-3">
                  <div className="px-3 pb-1.5 text-[10px] tracking-[.15em] font-bold uppercase text-muted">
                    Your List
                  </div>
                  {watchlistHits.map(w => (
                    <button
                      key={`w-${w.id}`}
                      onClick={() => openWl(w)}
                      className="w-full px-3 py-2 rounded-lg hover:bg-white/5 flex items-center gap-3 text-left transition"
                    >
                      {w.poster_path
                        ? <img src={w.poster_path} className="w-9 h-12 object-cover rounded shrink-0" alt="" />
                        : <div className="w-9 h-12 rounded bg-surface-3 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white truncate">{w.title}</div>
                        <div className="text-xs text-muted flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full status-${w.watch_status}`} />
                          {w.watch_status.replace(/_/g, ' ')}
                          {w.release_year && <><span>·</span><span>{w.release_year}</span></>}
                        </div>
                      </div>
                      <ArrowRight size={14} className="text-muted shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {/* TMDB section */}
              <div className="p-2 pb-3 border-t border-white/5">
                <div className="px-3 pb-1.5 pt-2 text-[10px] tracking-[.15em] font-bold uppercase text-muted flex items-center gap-2">
                  <span>From TMDB</span>
                  {loadingTmdb && <span className="text-accent">searching…</span>}
                </div>
                {!loadingTmdb && tmdbHits.length === 0 && watchlistHits.length === 0 && (
                  <div className="px-3 py-4 text-sm text-muted text-center">
                    No matches. Try <button
                      onClick={() => { setPage('browse'); reset(); }}
                      className="text-accent hover:underline">Browse →</button>
                  </div>
                )}
                {tmdbHits.map(t => {
                  const inList = watchlistTmdbIds.has(t.tmdb_id);
                  return (
                    <button
                      key={`t-${t.tmdb_id}-${t.media_type}`}
                      onClick={() => addFromTmdb(t)}
                      className="w-full px-3 py-2 rounded-lg hover:bg-white/5 flex items-center gap-3 text-left transition"
                    >
                      {t.poster_path
                        ? <img src={t.poster_path} className="w-9 h-12 object-cover rounded shrink-0" alt="" />
                        : <div className="w-9 h-12 rounded bg-surface-3 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white truncate flex items-center gap-2">
                          {t.title}
                          {inList && (
                            <span className="text-[10px] text-green bg-green/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                              <Check size={10} /> In list
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted">
                          {t.release_year || '—'} · {t.type === 'movie' ? 'Movie' : 'TV'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* User avatar */}
        <div className="no-drag">
          <UserMenu onNavigate={setPage} />
        </div>

        {/* Window controls */}
        <div className="no-drag flex gap-0.5 ml-1">
          <button
            onClick={() => handle('minimize')}
            className="w-9 h-8 flex items-center justify-center rounded text-muted hover:bg-white/10 hover:text-white transition"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={() => handle('maximize')}
            className="w-9 h-8 flex items-center justify-center rounded text-muted hover:bg-white/10 hover:text-white transition"
          >
            <Square size={12} />
          </button>
          <button
            onClick={() => handle('close')}
            className="w-9 h-8 flex items-center justify-center rounded text-muted hover:bg-red hover:text-white transition"
          >
            <X size={15} />
          </button>
        </div>
      </header>
    </>
  );
}
