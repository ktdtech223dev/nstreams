import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Tv, MapPin, Play, RefreshCw, ChevronRight, Radio } from 'lucide-react';
import api from '../api';
import { useApp } from '../App';

// ─── EPG constants ────────────────────────────────────────────────────────────
const PX_PER_MIN   = 4;   // pixels per minute in the grid
const LABEL_W      = 148; // channel label column width
const ROW_H        = 52;  // each channel row height
const HEADER_H     = 36;  // time header height

function epgStartTime() {
  // Start 30 min before the current half-hour mark
  const now  = Date.now();
  const slot = Math.floor(now / (30 * 60 * 1000)) * (30 * 60 * 1000);
  return new Date(slot - 30 * 60 * 1000);
}

function fmt12(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ─── Colours for the retro cable aesthetic ────────────────────────────────────
const CABLE_BG   = '#05051a';
const GRID_LINE  = '#14144a';
const LABEL_BG   = '#08083a';
const NOW_COLOR  = '#ff3333';
const GOLD       = '#ffd700';
const DIM        = '#6060a0';

// ─── Category pill colours ────────────────────────────────────────────────────
const CAT_COLORS = {
  'News':          '#e33',
  'Movies':        '#a855f7',
  'Comedy':        '#f59e0b',
  'Drama':         '#3b82f6',
  'Sports':        '#22c55e',
  'Entertainment': '#ec4899',
  'Kids':          '#06b6d4',
  'Lifestyle':     '#84cc16',
  'Thrillers':     '#6366f1',
  'Music':         '#f97316',
};
function catColor(cat) { return CAT_COLORS[cat] || '#6366f1'; }

// ─── Main component ───────────────────────────────────────────────────────────
export default function Cable() {
  const { openPlayer, showToast } = useApp();

  const [channels, setChannels]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [category, setCategory]       = useState('All');
  const [selected, setSelected]       = useState(null);   // { channel, program }
  const [location, setLocation]       = useState('');
  const [localNews, setLocalNews]     = useState([]);
  const [now, setNow]                 = useState(new Date());
  const epgStart                      = useRef(epgStartTime());
  const gridRef                       = useRef(null);

  // Clock tick every 60s
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Load channels
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get('/cable/channels');
      setChannels(data);
      if (data.length && !selected) {
        const ch  = data[0];
        const prg = currentProgram(ch, new Date());
        setSelected({ channel: ch, program: prg });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Restore saved location
  useEffect(() => {
    window.electron?.getStore('cable_location')
      .then(v => { if (v) setLocation(v); })
      .catch(() => {});
  }, []);

  // Fetch local news when location changes
  useEffect(() => {
    if (!location.trim()) { setLocalNews([]); return; }
    api.get(`/cable/local-news?city=${encodeURIComponent(location.trim())}`)
      .then(d => setLocalNews(d.stations || []))
      .catch(() => {});
  }, [location]);

  // Scroll grid to ~30 min before current time on first load
  useEffect(() => {
    if (!gridRef.current || !channels.length) return;
    const msElapsed = now - epgStart.current;
    const px        = (msElapsed / 60_000) * PX_PER_MIN;
    gridRef.current.scrollLeft = Math.max(0, px - 80);
  }, [channels.length]); // eslint-disable-line

  function currentProgram(channel, atTime) {
    const t = atTime.getTime();
    return channel.timelines?.find(p =>
      new Date(p.start).getTime() <= t && new Date(p.stop).getTime() > t
    ) || channel.timelines?.[0] || null;
  }

  function selectChannel(ch, prg) {
    setSelected({ channel: ch, program: prg || currentProgram(ch, now) });
  }

  function watchChannel(ch, prg) {
    const url = `https://pluto.tv/live-tv/${ch.slug}`;
    openPlayer({
      url,
      title: `Ch ${ch.number} — ${ch.name}${prg ? ' · ' + prg.title : ''}`,
      contentId: null,
      watchlistId: null,
    });
  }

  function watchLocalNews(station) {
    openPlayer({
      url: station.url,
      title: station.name + ' — Live',
      contentId: null,
      watchlistId: null,
    });
  }

  // Derive category list
  const categories = ['All', ...Array.from(new Set(channels.map(c => c.category))).sort()];

  const filtered = category === 'All'
    ? channels
    : channels.filter(c => c.category === category);

  const selCh  = selected?.channel;
  const selPrg = selected?.program;

  // Time slots across the top (every 30 min, covering 8 hours from epgStart)
  const timeSlots = Array.from({ length: 17 }, (_, i) =>
    new Date(epgStart.current.getTime() + i * 30 * 60 * 1000)
  );

  const nowOffsetPx = Math.max(0, (now - epgStart.current) / 60_000 * PX_PER_MIN);
  const totalGridW  = 8 * 60 * PX_PER_MIN; // 8 hours worth

  return (
    <div
      className="flex flex-col h-full select-none"
      style={{ background: CABLE_BG, color: '#fff', fontFamily: 'inherit' }}
    >
      {/* ── Top info panel ──────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 border-b"
        style={{ borderColor: GRID_LINE, minHeight: 160 }}
      >
        {/* Now-playing info */}
        <div className="flex-1 flex flex-col justify-between p-5 gap-3">
          {selCh ? (
            <>
              <div className="flex items-start gap-4">
                <div
                  className="shrink-0 w-12 h-12 rounded-lg flex items-center justify-center text-lg font-mono font-bold border"
                  style={{ borderColor: GRID_LINE, background: LABEL_BG, color: GOLD }}
                >
                  {selCh.number}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs tracking-widest uppercase mb-1" style={{ color: DIM }}>
                    Now Playing
                  </div>
                  <div className="text-white font-bold text-lg leading-tight truncate">
                    {selPrg?.title || 'Live TV'}
                  </div>
                  <div className="text-sm mt-0.5" style={{ color: GOLD }}>
                    {selCh.name}
                    {selPrg && (
                      <span style={{ color: DIM }} className="ml-2">
                        · {fmt12(new Date(selPrg.start))} – {fmt12(new Date(selPrg.stop))}
                      </span>
                    )}
                  </div>
                  {selPrg?.description && (
                    <p className="text-xs mt-1 line-clamp-2" style={{ color: DIM }}>
                      {selPrg.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => watchChannel(selCh, selPrg)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition hover:opacity-90"
                  style={{ background: GOLD, color: '#000' }}
                >
                  <Play size={14} fill="currentColor" /> Watch Now
                </button>
                <span
                  className="px-3 py-2 rounded-lg text-xs font-medium border flex items-center gap-1"
                  style={{ borderColor: catColor(selCh.category) + '66', color: catColor(selCh.category) }}
                >
                  {selCh.category}
                </span>
              </div>
            </>
          ) : (
            <div className="text-sm" style={{ color: DIM }}>Select a channel</div>
          )}
        </div>

        {/* Local news panel */}
        <div
          className="w-72 shrink-0 flex flex-col border-l p-4 gap-2"
          style={{ borderColor: GRID_LINE }}
        >
          <div className="flex items-center gap-2 mb-1">
            <MapPin size={13} style={{ color: GOLD }} />
            <span className="text-xs tracking-widest uppercase font-semibold" style={{ color: GOLD }}>
              Local News
            </span>
          </div>
          {localNews.length > 0 ? (
            <div className="flex flex-col gap-1 flex-1 overflow-y-auto">
              {localNews.map(s => (
                <button
                  key={s.id}
                  onClick={() => watchLocalNews(s)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-left transition text-sm"
                  style={{ background: LABEL_BG }}
                  onMouseEnter={e => e.currentTarget.style.background = '#14144a'}
                  onMouseLeave={e => e.currentTarget.style.background = LABEL_BG}
                >
                  <span className="text-base">{s.logo}</span>
                  <span className="flex-1 text-white truncate">{s.name}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded text-black font-bold" style={{ background: '#ff3333' }}>LIVE</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-xs flex-1 flex flex-col items-center justify-center gap-2 text-center" style={{ color: DIM }}>
              <Radio size={20} />
              <span>Set your city in<br/>Settings → Cable TV</span>
            </div>
          )}
        </div>

        {/* Category filter strip */}
        <div
          className="w-52 shrink-0 flex flex-col border-l overflow-y-auto"
          style={{ borderColor: GRID_LINE }}
        >
          <div className="px-3 pt-3 pb-1 text-[10px] tracking-widest uppercase font-semibold" style={{ color: DIM }}>
            Category
          </div>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className="px-4 py-2 text-left text-sm flex items-center gap-2 transition"
              style={{
                background:  category === cat ? catColor(cat) + '22' : 'transparent',
                color:       category === cat ? catColor(cat) : DIM,
                borderLeft:  category === cat ? `3px solid ${catColor(cat)}` : '3px solid transparent',
              }}
            >
              {cat === 'All'
                ? <Tv size={13} />
                : <span className="w-2 h-2 rounded-full shrink-0" style={{ background: catColor(cat) }} />
              }
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* ── EPG grid ────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-3" style={{ color: DIM }}>
          <RefreshCw size={18} className="animate-spin" />
          <span className="text-sm">Tuning in…</span>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ color: DIM }}>
          <Tv size={32} />
          <div className="text-sm">Could not reach Pluto TV — {error}</div>
          <button
            onClick={load}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ background: GOLD, color: '#000', fontWeight: 600 }}
          >
            Retry
          </button>
        </div>
      ) : (
        <div
          ref={gridRef}
          className="flex-1 overflow-auto"
          style={{ scrollBehavior: 'auto' }}
        >
          <div style={{ minWidth: LABEL_W + totalGridW, position: 'relative' }}>

            {/* ── Sticky time header row ── */}
            <div
              style={{
                display: 'flex',
                position: 'sticky',
                top: 0,
                zIndex: 20,
                background: CABLE_BG,
                borderBottom: `1px solid ${GRID_LINE}`,
                height: HEADER_H,
              }}
            >
              {/* Corner */}
              <div
                style={{
                  width: LABEL_W, flexShrink: 0, position: 'sticky', left: 0,
                  background: LABEL_BG, zIndex: 25,
                  display: 'flex', alignItems: 'center', paddingLeft: 12,
                  borderRight: `1px solid ${GRID_LINE}`,
                  borderBottom: `1px solid ${GRID_LINE}`,
                }}
              >
                <Tv size={14} style={{ color: GOLD }} />
                <span className="ml-2 text-xs font-mono font-bold" style={{ color: GOLD }}>
                  {fmt12(now)}
                </span>
              </div>

              {/* Time labels */}
              <div style={{ position: 'relative', flex: 1 }}>
                {timeSlots.map((slot, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: i * 30 * PX_PER_MIN,
                      top: 0,
                      width: 30 * PX_PER_MIN,
                      height: HEADER_H,
                      display: 'flex',
                      alignItems: 'center',
                      paddingLeft: 8,
                      fontSize: 11,
                      fontFamily: 'monospace',
                      color: DIM,
                      borderRight: `1px solid ${GRID_LINE}`,
                      boxSizing: 'border-box',
                    }}
                  >
                    {fmt12(slot)}
                  </div>
                ))}

                {/* Current time line in header */}
                <div style={{
                  position: 'absolute',
                  left: nowOffsetPx,
                  top: 0,
                  width: 2,
                  height: HEADER_H,
                  background: NOW_COLOR,
                  zIndex: 10,
                }} />
              </div>
            </div>

            {/* ── Channel rows ── */}
            {filtered.map(ch => {
              const isSelected = selCh?.id === ch.id;
              return (
                <div
                  key={ch.id}
                  style={{ display: 'flex', height: ROW_H, borderBottom: `1px solid ${GRID_LINE}` }}
                >
                  {/* Channel label (sticky left) */}
                  <button
                    onClick={() => selectChannel(ch)}
                    style={{
                      width: LABEL_W,
                      flexShrink: 0,
                      position: 'sticky',
                      left: 0,
                      zIndex: 10,
                      background: isSelected ? '#14144a' : LABEL_BG,
                      borderRight: `1px solid ${GRID_LINE}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '0 10px',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#10103a'; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = LABEL_BG; }}
                  >
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 12,
                        fontWeight: 700,
                        color: isSelected ? GOLD : DIM,
                        minWidth: 28,
                        textAlign: 'right',
                      }}
                    >
                      {ch.number}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: isSelected ? '#fff' : '#9090c0',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                    >
                      {ch.name}
                    </span>
                    {isSelected && <ChevronRight size={12} style={{ color: GOLD, flexShrink: 0 }} />}
                  </button>

                  {/* Program blocks */}
                  <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
                    {ch.timelines?.map((prg, pi) => {
                      const pStart  = new Date(prg.start);
                      const pStop   = new Date(prg.stop);
                      const leftPx  = (pStart - epgStart.current) / 60_000 * PX_PER_MIN;
                      const widthPx = (pStop  - pStart)            / 60_000 * PX_PER_MIN;
                      if (leftPx + widthPx < 0 || leftPx > totalGridW) return null;

                      const isNow = now >= pStart && now < pStop;
                      const isSel = isSelected && selPrg?.start === prg.start;

                      return (
                        <button
                          key={pi}
                          onClick={() => {
                            selectChannel(ch, prg);
                          }}
                          onDoubleClick={() => watchChannel(ch, prg)}
                          title={`${prg.title} · ${fmt12(pStart)} – ${fmt12(pStop)}\nDouble-click to watch`}
                          style={{
                            position: 'absolute',
                            left:     Math.max(0, leftPx),
                            width:    Math.min(widthPx, totalGridW - Math.max(0, leftPx)) - 2,
                            top: 4,
                            height: ROW_H - 8,
                            background: isSel
                              ? catColor(ch.category) + '44'
                              : isNow
                                ? '#14144a'
                                : '#09092e',
                            border: `1px solid ${isSel ? catColor(ch.category) : isNow ? catColor(ch.category) + '66' : GRID_LINE}`,
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 8px',
                            cursor: 'pointer',
                            overflow: 'hidden',
                            boxSizing: 'border-box',
                            transition: 'background 0.1s',
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: isNow ? 600 : 400,
                              color: isNow ? '#fff' : '#8888bb',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {isNow && (
                              <span
                                style={{
                                  display: 'inline-block',
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  background: NOW_COLOR,
                                  marginRight: 5,
                                  verticalAlign: 'middle',
                                  marginTop: -1,
                                }}
                              />
                            )}
                            {prg.title}
                          </span>
                        </button>
                      );
                    })}

                    {/* Current-time red line */}
                    {nowOffsetPx >= 0 && nowOffsetPx <= totalGridW && (
                      <div
                        style={{
                          position: 'absolute',
                          left: nowOffsetPx,
                          top: 0,
                          width: 2,
                          height: ROW_H,
                          background: NOW_COLOR,
                          zIndex: 5,
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Status bar ──────────────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center justify-between px-4 py-1.5 text-xs border-t"
        style={{ background: LABEL_BG, borderColor: GRID_LINE, color: DIM }}
      >
        <div className="flex items-center gap-3">
          <span style={{ color: GOLD }} className="font-mono font-bold">N STREAMS CABLE</span>
          <span>·</span>
          <span>{filtered.length} channels</span>
          {category !== 'All' && <span style={{ color: catColor(category) }}>{category}</span>}
        </div>
        <div className="flex items-center gap-4">
          <span>Click to preview · Double-click to watch</span>
          <button
            onClick={load}
            className="flex items-center gap-1 hover:opacity-100 transition"
            style={{ opacity: 0.6 }}
          >
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
