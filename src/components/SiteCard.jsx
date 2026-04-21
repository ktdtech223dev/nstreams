import React from 'react';
import api from '../api';
import { useApp } from '../App';

export default function SiteCard({ site, onUpvoted, onDeleted }) {
  const { activeUserId, showToast } = useApp();

  async function open() {
    if (window.electron) await window.electron.openUrl(site.url);
    else window.open(site.url, '_blank');
  }

  async function upvote(e) {
    e.stopPropagation();
    await api.upvoteSite(site.id);
    onUpvoted?.();
  }

  async function del(e) {
    e.stopPropagation();
    try {
      await api.delSite(site.id, activeUserId);
      onDeleted?.();
    } catch (err) {
      showToast(err.message);
    }
  }

  const canDelete = site.added_by === activeUserId;

  return (
    <div
      onClick={open}
      className="surface-elevated rounded-xl p-4 cursor-pointer flex items-center gap-4 hover:border-accent/60 transition-all hover:shadow-md"
    >
      <img
        src={site.logo_url || `https://www.google.com/s2/favicons?domain=${site.url}&sz=64`}
        className="w-10 h-10 rounded shrink-0"
        alt=""
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-white font-medium">{site.name}</div>
          <span className="text-xs bg-bg4 text-muted px-2 py-0.5 rounded-full capitalize">
            {site.category}
          </span>
        </div>
        <div className="text-xs text-muted truncate mt-0.5">{site.url}</div>
        {site.added_by_name && (
          <div className="text-xs mt-1">
            Added by <span style={{ color: site.avatar_color }}>{site.added_by_name}</span>
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex gap-1.5">
          <span className={`text-xs px-2 py-0.5 rounded font-bold ${
            site.quality === '4K' ? 'bg-gold/20 text-gold' :
            site.quality === 'HD' ? 'bg-accent/20 text-accent2' : 'bg-bg4 text-muted'
          }`}>{site.quality}</span>
          {site.is_free === 1 && (
            <span className="text-xs px-2 py-0.5 rounded bg-green/20 text-green">FREE</span>
          )}
          {site.requires_vpn === 1 && (
            <span className="text-xs px-2 py-0.5 rounded bg-red/20 text-red">VPN</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={upvote} className="text-xs text-muted hover:text-accent transition">
            ▲ {site.upvotes || 0}
          </button>
          {canDelete && (
            <button onClick={del} className="text-xs text-muted hover:text-red">✕</button>
          )}
        </div>
      </div>
    </div>
  );
}
