import React, { useRef, useState } from 'react';
import api from '../api';
import { useApp } from '../App';

// Horizontal-scrolling row of TMDB results. Click a poster to add + open.
export default function DiscoverRow({ title, subtitle, items, icon, logoUrl, accent }) {
  const scrollerRef = useRef(null);
  const { activeUserId, showToast, openContent } = useApp();
  const [adding, setAdding] = useState(null);

  function scroll(dir) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (el.clientWidth * 0.85), behavior: 'smooth' });
  }

  async function pick(item) {
    setAdding(item.tmdb_id);
    try {
      const content = await api.addContent({
        tmdb_id: item.tmdb_id,
        type: item.media_type === 'movie' ? 'movie' : 'tv',
        user_id: activeUserId
      });
      openContent(content.id);
    } catch (e) {
      showToast('Failed: ' + e.message);
    } finally {
      setAdding(null);
    }
  }

  if (!items || items.length === 0) return null;

  return (
    <section className="relative group">
      <div className="flex items-center gap-3 mb-3">
        {logoUrl ? (
          <img src={logoUrl} className="w-8 h-8 rounded shrink-0" alt="" />
        ) : icon ? (
          <span className="text-2xl">{icon}</span>
        ) : null}
        <div className="min-w-0">
          <h2 className="font-display text-2xl text-white tracking-wide leading-none">
            {title}
          </h2>
          {subtitle && (
            <div className="text-xs text-muted mt-1">{subtitle}</div>
          )}
        </div>
        {accent && (
          <div
            className="h-px flex-1 ml-4 opacity-40"
            style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }}
          />
        )}
      </div>

      {/* Scroll arrows */}
      <button
        onClick={() => scroll(-1)}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-20 bg-gradient-to-r from-bg to-transparent opacity-0 group-hover:opacity-100 transition flex items-center justify-start pl-1 text-white text-2xl"
      >
        ‹
      </button>
      <button
        onClick={() => scroll(1)}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-20 bg-gradient-to-l from-bg to-transparent opacity-0 group-hover:opacity-100 transition flex items-center justify-end pr-1 text-white text-2xl"
      >
        ›
      </button>

      <div
        ref={scrollerRef}
        className="flex gap-3 overflow-x-auto pb-3 scroll-smooth"
        style={{ scrollbarWidth: 'thin' }}
      >
        {items.map(item => (
          <div
            key={`${item.media_type}-${item.tmdb_id}`}
            onClick={() => pick(item)}
            className="card-hover cursor-pointer bg-bg3 rounded-lg overflow-hidden border border-border relative shrink-0"
            style={{ width: 160 }}
          >
            <div className="relative" style={{ paddingBottom: '150%' }}>
              {item.poster_path ? (
                <img
                  src={item.poster_path}
                  className="absolute inset-0 w-full h-full object-cover"
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="absolute inset-0 bg-bg4" />
              )}
              <div
                className="absolute inset-0"
                style={{ background: 'linear-gradient(180deg, transparent 55%, rgba(8,8,16,0.95))' }}
              />
              {adding === item.tmdb_id && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm">
                  Adding...
                </div>
              )}
              {item.rating > 0 && (
                <div className="absolute top-2 right-2 bg-black/70 text-gold text-xs px-1.5 py-0.5 rounded font-bold backdrop-blur">
                  ★ {item.rating.toFixed(1)}
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 p-2">
                <div className="text-sm font-medium text-white line-clamp-2 leading-tight">
                  {item.title}
                </div>
                {item.release_year > 0 && (
                  <div className="text-xs text-muted mt-0.5">{item.release_year}</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
