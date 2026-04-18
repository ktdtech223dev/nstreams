import React, { useState } from 'react';
import api from '../api';
import { useApp } from '../App';

export default function ImportModal({ onClose, onDone }) {
  const { activeUserId, showToast } = useApp();
  const [form, setForm] = useState({
    title: '', type: 'series', description: '',
    poster_url: '', total_episodes: '', total_seasons: ''
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.title) return;
    setSaving(true);
    try {
      const c = await api.addContentManual({
        ...form,
        total_episodes: parseInt(form.total_episodes) || null,
        total_seasons: parseInt(form.total_seasons) || null,
        user_id: activeUserId
      });
      await api.addToWatchlist({
        user_id: activeUserId,
        content_id: c.id,
        watch_status: 'plan_to_watch'
      });
      showToast('Added ✓');
      onDone?.();
      onClose();
    } catch (e) {
      showToast('Failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-bg2 rounded-xl p-6 w-full max-w-lg border border-border"
      >
        <h3 className="font-display text-2xl text-white mb-4">Add Manually</h3>
        <div className="space-y-3">
          <input
            placeholder="Title *"
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            className="input w-full"
          />
          <select
            value={form.type}
            onChange={e => setForm({ ...form, type: e.target.value })}
            className="input w-full"
          >
            <option value="series">TV Series</option>
            <option value="movie">Movie</option>
            <option value="anime">Anime</option>
          </select>
          <input
            placeholder="Poster URL"
            value={form.poster_url}
            onChange={e => setForm({ ...form, poster_url: e.target.value })}
            className="input w-full"
          />
          <textarea
            placeholder="Description"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            className="input w-full h-20 resize-none"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Total episodes"
              type="number"
              value={form.total_episodes}
              onChange={e => setForm({ ...form, total_episodes: e.target.value })}
              className="input"
            />
            <input
              placeholder="Total seasons"
              type="number"
              value={form.total_seasons}
              onChange={e => setForm({ ...form, total_seasons: e.target.value })}
              className="input"
            />
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !form.title} className="btn btn-primary disabled:opacity-50">
            {saving ? 'Adding...' : 'Add to N Streams'}
          </button>
        </div>
      </div>
    </div>
  );
}
