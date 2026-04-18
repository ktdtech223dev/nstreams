import React, { useState, useEffect } from 'react';
import { useApp } from '../App';
import { useParty } from './PartyContext';
import api from '../api';

// "Start / Join Watch Party" modal for a specific piece of content.
export default function WatchPartyModal({ contentId, onClose }) {
  const { activeUser, showToast } = useApp();
  const { createParty, joinParty, relayUrl } = useParty();
  const [mode, setMode] = useState('create');
  const [content, setContent] = useState(null);
  const [whereToWatch, setWhereToWatch] = useState(null);
  const [siteChoice, setSiteChoice] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (contentId) {
      api.getContent(contentId, activeUser.id).then(setContent).catch(() => {});
      api.whereToWatch(contentId).then(setWhereToWatch).catch(() => {});
    }
  }, [contentId]);

  const options = whereToWatch
    ? [
        ...whereToWatch.crew_links.map(l => ({
          id: `link-${l.id}`,
          label: `${l.name} (crew link)`,
          url: l.deep_link,
          site_id: l.site_id,
          name: l.name
        })),
        ...whereToWatch.tmdb_providers
          .filter(p => p.deep_link)
          .map(p => ({
            id: `tmdb-${p.provider_id}`,
            label: `${p.provider_name}`,
            url: p.deep_link,
            site_id: p.site_in_catalog?.id,
            name: p.provider_name
          }))
      ]
    : [];

  async function start() {
    if (!siteChoice) return showToast('Pick a service first');
    const opt = options.find(o => o.id === siteChoice);
    if (!opt) return;
    setBusy(true);
    try {
      const p = await createParty({
        user: activeUser,
        content: content ? { id: content.id, title: content.title, poster: content.poster_path } : null,
        site: { name: opt.name, id: opt.site_id }
      });
      // Open viewer window bound to this party
      await window.electron.watchInApp({
        url: opt.url,
        title: `${content?.title} · Watch Party`,
        partyId: p.id
      });
      showToast(`Party started · code: ${p.code}`);
      onClose();
    } catch (e) {
      showToast('Failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (!joinCode) return;
    setBusy(true);
    try {
      const p = await joinParty({ user: activeUser, code: joinCode });
      // Open viewer with the show if party has site info
      if (p.site?.id || p.content) {
        // Try to resolve URL — fall back to searching the service homepage
        const ww = p.content?.id ? await api.whereToWatch(p.content.id).catch(() => null) : null;
        let url = null;
        if (ww && p.site) {
          const match = ww.crew_links.find(l => l.site_id === p.site.id)
                     || ww.tmdb_providers.find(t => t.provider_name === p.site.name);
          url = match?.deep_link;
        }
        if (url) {
          await window.electron.watchInApp({
            url,
            title: `${p.content?.title || 'Watch Party'} · joined`,
            partyId: p.id
          });
        }
      }
      showToast(`Joined ${p.code}`);
      onClose();
    } catch (e) {
      showToast('Failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-8" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-bg2 rounded-xl p-6 w-full max-w-md border border-border">
        <div className="flex justify-between items-start mb-4">
          <h3 className="font-display text-2xl text-white">Watch Party</h3>
          <button onClick={onClose} className="text-muted hover:text-white">✕</button>
        </div>

        {!relayUrl && (
          <div className="bg-red/10 border border-red/40 text-red text-sm p-3 rounded-lg mb-4">
            Set a Relay URL in Settings first. Watch parties need a relay server.
          </div>
        )}

        <div className="flex gap-1 bg-bg3 rounded-lg p-1 mb-5">
          <button
            onClick={() => setMode('create')}
            className={`flex-1 px-3 py-1.5 rounded-md text-sm transition ${
              mode === 'create' ? 'bg-accent text-white' : 'text-muted hover:text-white'
            }`}
          >
            Start one
          </button>
          <button
            onClick={() => setMode('join')}
            className={`flex-1 px-3 py-1.5 rounded-md text-sm transition ${
              mode === 'join' ? 'bg-accent text-white' : 'text-muted hover:text-white'
            }`}
          >
            Join with code
          </button>
        </div>

        {mode === 'create' ? (
          <>
            {content && (
              <div className="flex gap-3 mb-4">
                {content.poster_path && (
                  <img src={content.poster_path} className="w-16 rounded" alt="" />
                )}
                <div>
                  <div className="font-medium text-white">{content.title}</div>
                  <div className="text-xs text-muted">{content.release_year}</div>
                </div>
              </div>
            )}
            <label className="text-xs uppercase text-muted">Watch where?</label>
            <select
              value={siteChoice}
              onChange={e => setSiteChoice(e.target.value)}
              className="input w-full mt-1 mb-4"
            >
              <option value="">Pick a service…</option>
              {options.map(o => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={start}
              disabled={busy || !siteChoice || !relayUrl}
              className="btn btn-primary w-full justify-center disabled:opacity-50"
            >
              {busy ? 'Starting…' : '🎬 Start Party & Open Viewer'}
            </button>
            <p className="text-xs text-muted mt-3">
              Everyone else joins with the 6-character code you'll get next.
              Play/pause/seek syncs automatically via your browser's &lt;video&gt; element.
            </p>
          </>
        ) : (
          <>
            <label className="text-xs uppercase text-muted">Party code</label>
            <input
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={10}
              className="input w-full mt-1 mb-4 text-center text-2xl font-mono tracking-widest"
            />
            <button
              onClick={join}
              disabled={busy || !joinCode || !relayUrl}
              className="btn btn-primary w-full justify-center disabled:opacity-50"
            >
              {busy ? 'Joining…' : 'Join Party'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
