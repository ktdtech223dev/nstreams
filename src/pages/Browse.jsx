import React, { useState, useEffect } from 'react';
import api from '../api';
import { useApp } from '../App';
import SearchBar from '../components/SearchBar';
import ImportModal from '../components/ImportModal';

const TYPES = [
  { id: 'multi', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'tv', label: 'TV' },
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
    if (!q || q.length < 2) {
      setResults([]);
      return;
    }
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
    <div className="max-w-[1600px]">
      <header className="mb-6">
        <h1 className="font-display text-5xl text-white tracking-wide">Browse</h1>
        <p className="text-muted mt-1">Search TMDB to add to your watchlist</p>
      </header>

      <div className="flex gap-3 mb-5">
        <div className="flex-1">
          <SearchBar
            value={q}
            onChange={setQ}
            placeholder='e.g. "Attack on Titan", "Dune"...'
          />
        </div>
        <div className="flex gap-1 bg-bg3 rounded-lg p-1">
          {TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => setType(t.id)}
              className={`px-3 py-1.5 rounded-md text-sm transition ${
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
          {searching && <div className="text-muted">Searching...</div>}
          {!searching && q.length >= 2 && results.length === 0 && (
            <div className="text-muted">No results.</div>
          )}
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
          >
            {results.map(r => (
              <div
                key={`${r.media_type}-${r.tmdb_id}`}
                onClick={() => setSelected(r)}
                className="bg-bg3 rounded-lg overflow-hidden border border-border card-hover cursor-pointer"
              >
                <div className="relative" style={{ paddingBottom: '150%' }}>
                  {r.poster_path ? (
                    <img src={r.poster_path} className="absolute inset-0 w-full h-full object-cover" alt="" />
                  ) : (
                    <div className="absolute inset-0 bg-bg4" />
                  )}
                  <div
                    className="absolute inset-0"
                    style={{ background: 'linear-gradient(180deg, transparent 60%, rgba(0,0,0,0.9))' }}
                  />
                  <div className="absolute bottom-0 left-0 right-0 p-2">
                    <div className="text-sm font-medium text-white line-clamp-2">{r.title}</div>
                    {r.release_year > 0 && <div className="text-xs text-muted">{r.release_year}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 p-6 bg-bg2 border border-border rounded-xl">
            <div className="font-display text-xl text-white">Can't find it?</div>
            <p className="text-muted text-sm mt-1">Add it manually with a title, poster URL, and episode count.</p>
            <button onClick={() => setShowImport(true)} className="btn btn-primary mt-4">
              + Add Manually
            </button>
          </div>
        </div>

        {selected && (
          <aside className="w-96 bg-bg2 rounded-xl border border-border p-5 shrink-0 sticky top-4 self-start">
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
        <div className="font-display text-xl text-white leading-tight pr-4">{item.title}</div>
        <button onClick={onClose} className="text-muted hover:text-white">✕</button>
      </div>
      {item.poster_path && (
        <img src={item.poster_path} className="w-full rounded-lg mb-4" alt="" />
      )}
      <p className="text-sm text-muted mb-4 line-clamp-3">{item.overview}</p>

      <label className="text-xs uppercase text-muted">Status</label>
      <select value={status} onChange={e => setStatus(e.target.value)} className="input w-full mt-1 mb-3">
        <option value="plan_to_watch">Plan to Watch</option>
        <option value="watching">Watching</option>
        <option value="completed">Completed</option>
        <option value="on_hold">On Hold</option>
      </select>

      <label className="text-xs uppercase text-muted">Watch on (optional)</label>
      <select value={siteId} onChange={e => setSiteId(e.target.value)} className="input w-full mt-1 mb-3">
        <option value="">Choose later</option>
        {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      {siteId && (
        <>
          <label className="text-xs uppercase text-muted">Direct URL</label>
          <input
            value={directUrl}
            onChange={e => setDirectUrl(e.target.value)}
            placeholder="https://..."
            className="input w-full mt-1 mb-3"
          />
        </>
      )}

      <button onClick={add} disabled={adding} className="btn btn-primary w-full justify-center disabled:opacity-50">
        {adding ? 'Adding...' : 'Add to N Streams'}
      </button>
    </div>
  );
}
