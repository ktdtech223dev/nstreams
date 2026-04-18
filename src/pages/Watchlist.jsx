import React, { useEffect, useState } from 'react';
import api from '../api';
import { useApp } from '../App';
import ContentCard from '../components/ContentCard';
import SearchBar from '../components/SearchBar';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'watching', label: 'Watching' },
  { id: 'plan_to_watch', label: 'Plan to Watch' },
  { id: 'completed', label: 'Completed' },
  { id: 'on_hold', label: 'On Hold' },
  { id: 'dropped', label: 'Dropped' }
];

const SORTS = [
  { id: 'updated', label: 'Recently Updated' },
  { id: 'title', label: 'A-Z' },
  { id: 'rating', label: 'Your Rating' },
  { id: 'added', label: 'Date Added' }
];

export default function Watchlist() {
  const { activeUserId } = useApp();
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('updated');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!activeUserId) return;
    const opts = { sort };
    if (status !== 'all') opts.status = status;
    if (q) opts.q = q;
    api.getWatchlist(activeUserId, opts).then(setRows).catch(() => {});
  }, [activeUserId, status, sort, q]);

  return (
    <div className="max-w-[1600px]">
      <header className="mb-6">
        <h1 className="font-display text-5xl text-white tracking-wide">Your Watchlist</h1>
        <p className="text-muted mt-1">{rows.length} titles</p>
      </header>

      <div className="flex flex-wrap gap-3 items-center mb-6">
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setStatus(f.id)}
              className={`px-3 py-1.5 rounded-full text-sm transition ${
                status === f.id
                  ? 'bg-accent text-white'
                  : 'bg-bg3 text-muted hover:bg-bg4 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-3 items-center">
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="input text-sm"
          >
            {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <div className="w-64">
            <SearchBar value={q} onChange={setQ} placeholder="Search watchlist..." />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-20 text-muted">
          Nothing here yet. Head to Browse to add some.
        </div>
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
        >
          {rows.map(w => <ContentCard key={w.id} item={w} />)}
        </div>
      )}
    </div>
  );
}
