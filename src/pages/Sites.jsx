import React, { useEffect, useState } from 'react';
import api from '../api';
import { useApp } from '../App';
import SiteCard from '../components/SiteCard';

const CATS = [
  { id: 'all', label: 'All' },
  { id: 'streaming', label: 'Streaming' },
  { id: 'anime', label: 'Anime' },
  { id: 'sports', label: 'Sports' },
  { id: 'movies', label: 'Movies' },
  { id: 'general', label: 'General' },
  { id: 'other', label: 'Other' }
];

export default function Sites() {
  const [data, setData] = useState({ all: [], grouped: {} });
  const [cat, setCat] = useState('all');
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    const d = await api.getSites();
    setData(d);
  }

  useEffect(() => { load(); }, []);

  const rows = cat === 'all' ? data.all : (data.grouped[cat] || []);

  return (
    <div className="max-w-[1600px]">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="font-display text-5xl text-white tracking-wide">Site Catalog</h1>
          <p className="text-muted mt-1">{data.all.length} sites</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn btn-primary">
          + Add a Site
        </button>
      </header>

      <div className="flex flex-wrap gap-2 mb-6">
        {CATS.map(c => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            className={`px-4 py-1.5 rounded-full text-sm transition ${
              cat === c.id ? 'bg-accent text-white' : 'bg-bg3 text-muted hover:bg-bg4 hover:text-white'
            }`}
          >
            {c.label}
            {c.id !== 'all' && data.grouped[c.id] && (
              <span className="ml-2 opacity-60">{data.grouped[c.id].length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))' }}>
        {rows.map(s => (
          <SiteCard key={s.id} site={s} onUpvoted={load} onDeleted={load} />
        ))}
      </div>

      {showAdd && (
        <AddSiteModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />
      )}
    </div>
  );
}

function AddSiteModal({ onClose, onSaved }) {
  const { activeUserId, showToast } = useApp();
  const [form, setForm] = useState({
    name: '', url: '', category: 'streaming', description: '',
    is_free: 1, requires_vpn: 0, quality: 'HD', search_url_template: ''
  });
  const [saving, setSaving] = useState(false);

  const domain = form.url.replace(/https?:\/\//, '').split('/')[0];
  const faviconPreview = domain
    ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    : null;

  async function save() {
    if (!form.name || !form.url) return;
    const normalized = form.url.startsWith('http')
      ? form.url
      : `https://${form.url}`;
    setSaving(true);
    try {
      await api.addSite({ ...form, url: normalized, user_id: activeUserId });
      showToast('Site added ✓');
      onSaved();
    } catch (e) {
      showToast('Failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-bg2 rounded-xl p-6 w-full max-w-lg border border-border">
        <h3 className="font-display text-2xl text-white mb-4">Add a Site</h3>
        <div className="space-y-3">
          <div className="flex gap-3 items-center">
            {faviconPreview ? (
              <img src={faviconPreview} className="w-12 h-12 rounded shrink-0" alt="" />
            ) : (
              <div className="w-12 h-12 rounded bg-bg3 shrink-0" />
            )}
            <div className="flex-1">
              <input
                placeholder="Name *"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="input w-full"
              />
            </div>
          </div>
          <input
            placeholder="URL * (e.g. https://example.com)"
            value={form.url}
            onChange={e => setForm({ ...form, url: e.target.value })}
            className="input w-full"
          />
          <select
            value={form.category}
            onChange={e => setForm({ ...form, category: e.target.value })}
            className="input w-full"
          >
            {CATS.filter(c => c.id !== 'all').map(c => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <textarea
            placeholder="Description (optional)"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            className="input w-full h-16 resize-none"
          />
          <div>
            <input
              placeholder="Search URL template (optional) — use {title} as placeholder"
              value={form.search_url_template}
              onChange={e => setForm({ ...form, search_url_template: e.target.value })}
              className="input w-full"
            />
            <div className="text-[10px] text-muted mt-1 leading-tight">
              Example: <code className="text-accent">https://www.miruro.tv/search?query={'{title}'}</code>
              {' '}— lets "Search on {form.name || 'Site'}" appear on every show.
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <select
              value={form.quality}
              onChange={e => setForm({ ...form, quality: e.target.value })}
              className="input"
            >
              <option value="SD">SD</option>
              <option value="HD">HD</option>
              <option value="4K">4K</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!form.is_free}
                onChange={e => setForm({ ...form, is_free: e.target.checked ? 1 : 0 })}
              />
              Free
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!form.requires_vpn}
                onChange={e => setForm({ ...form, requires_vpn: e.target.checked ? 1 : 0 })}
              />
              VPN
            </label>
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !form.name || !form.url} className="btn btn-primary disabled:opacity-50">
            {saving ? 'Adding...' : 'Add Site'}
          </button>
        </div>
      </div>
    </div>
  );
}
