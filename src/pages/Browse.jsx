import React, { useState, useEffect } from 'react';
import { Search as SearchIcon, X, Plus } from 'lucide-react';
import api from '../api';
import { useApp } from '../App';
import ImportModal from '../components/ImportModal';

const TYPES = [
  { id: 'multi', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'tv',    label: 'TV' },
  { id: 'anime', label: 'Anime' }
];

export default function Browse() {
  const { activeUserId, showToast, openContent } = useApp();
  const [q, setQ] = useState('');
  const [type, setType] = useState('multi');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [searching, setSearching] = useState(false);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    if (!q || q.length < 2) { setResults([]); return; }
    const h = setTimeout(async () => {
      setSearching(true);
      try {
        const t = type === 'anime' ? 'tv' : type;
        const r = await api.search(q, t);
        setResults(r);
      } catch (e) {
        showToast('Search failed: ' + e.message);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(h);
  }, [q, type]);

  return (
    <div>
      <header className="mb-8">
        <h1 className="display-lg text-white">Browse</h1>
        <p className="text-muted mt-1 text-sm">Search TMDB to add to your watchlist</p>
      </header>

      <div className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <SearchIcon size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder='Try "Attack on Titan", "Dune", or "Inception"…'
            className="input w-full pl-11 h-11 text-sm"
          />
          {q && (
            <button
              onClick={() => setQ('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex gap-1 surface p-1 rounded-full">
          {TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => setType(t.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${
                type === t.id ? 'bg-accent text-white' : 'text-muted hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-6">
        <div className="flex-1">
          {searching && <div className="text-muted text-sm">Searching…</div>}
          {!searching && q.length >= 2 && results.length === 0 && (
            <div className="text-muted text-sm">No results.</div>
          )}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}
          >
            {results.map(r => (
              <div
                key={`${r.media_type}-${r.tmdb_id}`}
                onClick={() => setSelected(r)}
                className="card-netflix"
                style={{ width: 'auto' }}
              >
                <div className="card-base relative bg-surface-2" style={{ paddingBottom: '150%' }}>
                  {r.poster_path ? (
                    <img src={r.poster_path} className="absolute inset-0 w-full h-full object-cover" alt="" />
                  ) : (
                    <div className="absolute inset-0 bg-surface-3" />
                  )}
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, transparent 55%, rgba(5,5,16,0.95))' }} />
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <div className="text-sm font-semibold text-white line-clamp-2">{r.title}</div>
                    {r.release_year > 0 && <div className="text-xs text-muted mt-0.5">{r.release_year}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 surface rounded-2xl p-6">
            <div className="display-sm text-white">Can't find it?</div>
            <p className="text-muted text-sm mt-1">Add it manually with a title, poster URL, and episode count.</p>
            <button onClick={() => setShowImport(true)} className="btn btn-primary mt-4">
              <Plus size={15} /> Add Manually
            </button>
          </div>
        </div>

        {selected && (
          <aside className="w-96 surface-elevated rounded-2xl p-5 shrink-0 sticky top-4 self-start">
            <QuickAdd
              item={selected}
              onClose={() => setSelected(null)}
              onAdded={(cid) => {
                setSelected(null);
                openContent(cid);
              }}
            />
          </aside>
        )}
      </div>

      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </div>
  );
}

function QuickAdd({ item, onClose, onAdded }) {
  const { activeUserId, showToast } = useApp();
  const [status, setStatus] = useState('plan_to_watch');
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [directUrl, setDirectUrl] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.getSites().then(d => setSites(d.all || []));
  }, []);

  async function add() {
    setAdding(true);
    try {
      const content = await api.addContent({
        tmdb_id: item.tmdb_id,
        type: item.media_type === 'movie' ? 'movie' : 'tv',
        user_id: activeUserId
      });
      await api.addToWatchlist({
        user_id: activeUserId,
        content_id: content.id,
        watch_status: status
      });
      if (siteId) {
        await api.linkService(content.id, {
          site_id: parseInt(siteId),
          direct_url: directUrl || null,
          user_id: activeUserId
        });
      }
      showToast('Added to N Streams ✓');
      onAdded?.(content.id);
    } catch (e) {
      showToast('Failed: ' + e.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      <div className="flex justify-between items-start mb-3">
        <div className="display-sm text-white leading-tight pr-4">{item.title}</div>
        <button onClick={onClose} className="btn btn-icon-sm btn-ghost"><X size={14} /></button>
      </div>
      {item.poster_path && (
        <img src={item.poster_path} className="w-full rounded-lg mb-4" alt="" />
      )}
      <p className="text-sm text-muted mb-4 line-clamp-3">{item.overview}</p>

      <label className="text-xs uppercase tracking-wider text-muted">Status</label>
      <select value={status} onChange={e => setStatus(e.target.value)} className="input w-full mt-1 mb-3">
        <option value="plan_to_watch">Plan to Watch</option>
        <option value="watching">Watching</option>
        <option value="completed">Completed</option>
        <option value="on_hold">On Hold</option>
      </select>

      <label className="text-xs uppercase tracking-wider text-muted">Watch on (optional)</label>
      <select value={siteId} onChange={e => setSiteId(e.target.value)} className="input w-full mt-1 mb-3">
        <option value="">Choose later</option>
        {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      {siteId && (
        <>
          <label className="text-xs uppercase tracking-wider text-muted">Direct URL</label>
          <input
            value={directUrl}
            onChange={e => setDirectUrl(e.target.value)}
            placeholder="https://..."
            className="input w-full mt-1 mb-3"
          />
        </>
      )}

      <button onClick={add} disabled={adding} className="btn btn-primary w-full">
        {adding ? 'Adding...' : 'Add to N Streams'}
      </button>
    </div>
  );
}
