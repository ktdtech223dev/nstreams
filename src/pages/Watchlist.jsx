import React, { useEffect, useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import api from '../api';
import { useApp } from '../App';
import ContentCard from '../components/ContentCard';

const FILTERS = [
  { id: 'all',           label: 'All' },
  { id: 'watching',      label: 'Watching' },
  { id: 'plan_to_watch', label: 'Plan to Watch' },
  { id: 'completed',     label: 'Completed' },
  { id: 'on_hold',       label: 'On Hold' },
  { id: 'dropped',       label: 'Dropped' }
];

const SORTS = [
  { id: 'updated', label: 'Recently Updated' },
  { id: 'title',   label: 'A–Z' },
  { id: 'rating',  label: 'Your Rating' },
  { id: 'added',   label: 'Date Added' }
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
    <div>
      <header className="mb-8">
        <h1 className="display-lg text-white">My List</h1>
        <p className="text-muted mt-1 text-sm">{rows.length} {rows.length === 1 ? 'title' : 'titles'}</p>
      </header>

      <div className="flex flex-wrap gap-3 items-center mb-8">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setStatus(f.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition ${
                status === f.id
                  ? 'bg-accent text-white glow'
                  : 'bg-surface-2 text-muted hover:bg-surface-3 hover:text-white'
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
          <div className="relative">
            <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Filter your list…"
              className="input pl-9 w-64"
            />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-24 text-muted">
          Nothing here yet. Head to Browse to add some.
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', paddingBottom: '8rem' }}
        >
          {rows.map(w => <ContentCard key={w.id} item={w} />)}
        </div>
      )}
    </div>
  );
}
