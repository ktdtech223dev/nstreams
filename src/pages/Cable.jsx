import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, RefreshCw, Tv, Radio } from 'lucide-react';
import api, { API_PORT } from '../api';
import { useApp } from '../App';

// ─── EPG layout ───────────────────────────────────────────────────────────────
const PX_PER_MIN = 4;
const LABEL_W    = 124;   // channel-label column (sticky left)
const ROW_H      = 42;    // each channel row
const HEADER_H   = 30;    // time header bar height

// ─── Early-2000s cable-box colour palette ─────────────────────────────────────
const C = {
  bg:         '#060613',
  label:      '#040420',
  labelSel:   '#001448',
  rowA:       '#07072a',
  rowB:       '#05051f',
  nowCell:    '#001d55',
  selCell:    '#002f88',
  header:     '#0b3c0b',    // dark-green time bar (Charter reference)
  headerText: '#a0ffa0',
  headerGrid: '#1a5a1a',
  border:     '#0f0f36',
  bottomBar:  '#030320',
  nowLine:    '#ff2525',
  gold:       '#ffd700',
  green:      '#3dcc3d',
  dimText:    '#484888',
  midText:    '#8080b8',
  brightText: '#c0c0ee',
  white:      '#ffffff',
};

// ─── Channel abbreviation (TNCK, MSNBC style) ─────────────────────────────────
const SKIP = new Set(['the','a','an','and','of','for','in','on','at','to','&','by','with','tv']);
function abbr(name) {
  const parts = name.split(/[\s\-&+]+/).filter(w => w && !SKIP.has(w.toLowerCase()));
  const result = (parts.length ? parts : [name])
    .map(w => (w.replace(/[^a-z0-9]/gi, '')[0] || '')).join('');
  return (result || name.replace(/\W/g, '')).toUpperCase().slice(0, 5);
}

function fmt12(d) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function epgStartTime() {
  const slot = Math.floor(Date.now() / (30 * 60 * 1000)) * (30 * 60 * 1000);
  return new Date(slot - 30 * 60 * 1000);
}

function currentProgram(ch, nowMs) {
  return ch.timelines?.find(p =>
    new Date(p.start).getTime() <= nowMs && new Date(p.stop).getTime() > nowMs
  ) || ch.timelines?.[0] || null;
}

const CAT_COLORS = {
  News:'#b02828', Movies:'#7a28c0', Comedy:'#b86800', Drama:'#1a44aa',
  Sports:'#148830', Entertainment:'#a82070', Kids:'#0880a0',
  Lifestyle:'#507800', Thrillers:'#383880', Music:'#a04000',
};
function catColor(c) { return CAT_COLORS[c] || '#404080'; }

// ─── Main component ───────────────────────────────────────────────────────────
export default function Cable() {
  const { openPlayer } = useApp();

  const [channels, setChannels]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [category, setCategory]   = useState('All');
  const [selected, setSelected]   = useState(null);
  const [localNews, setLocalNews] = useState([]);
  const [location, setLocation]   = useState('');
  const [showLocal, setShowLocal] = useState(false);
  const [now, setNow]             = useState(new Date());
  const epgStart                  = useRef(epgStartTime());
  const gridRef                   = useRef(null);
  const wrapRef                   = useRef(null);

  // Clock — tick every 60 s
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Load channels from Pluto TV (via local cache)
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get('/cable/channels');
      setChannels(data);
      if (data.length) {
        const ch = data[0];
        setSelected({ channel: ch, program: currentProgram(ch, Date.now()) });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Restore saved city
  useEffect(() => {
    window.electron?.getStore('cable_location')
      .then(v => { if (v) setLocation(v); })
      .catch(() => {});
  }, []);

  // Load local news stations when city changes
  useEffect(() => {
    if (!location.trim()) { setLocalNews([]); return; }
    api.get(`/cable/local-news?city=${encodeURIComponent(location.trim())}`)
      .then(d => setLocalNews(d.stations || []))
      .catch(() => {});
  }, [location]);

  // Auto-scroll to "now" on first channel load
  useEffect(() => {
    if (!gridRef.current || !channels.length) return;
    const px = (Date.now() - epgStart.current.getTime()) / 60_000 * PX_PER_MIN;
    gridRef.current.scrollLeft = Math.max(0, px - 120);
  }, [channels.length]); // eslint-disable-line

  function selectCh(ch, prg) {
    setSelected({ channel: ch, program: prg || currentProgram(ch, Date.now()) });
  }

  function watchCh(ch, prg) {
    const url = ch.hlsUrl
      ? `http://localhost:${API_PORT}/api/cable/player?src=${encodeURIComponent(ch.hlsUrl)}&title=${encodeURIComponent(ch.name + (prg ? ' — ' + prg.title : ''))}`
      : `https://pluto.tv/live-tv/${ch.slug}`;
    openPlayer({
      url,
      title: `Ch ${ch.number} — ${ch.name}${prg ? ' · ' + prg.title : ''}`,
      contentId: null,
    });
  }

  function watchNews(s) {
    openPlayer({ url: s.url, title: s.name + ' — Live', contentId: null });
    setShowLocal(false);
  }

  // Derived values
  const nowMs       = now.getTime();
  const categories  = ['All', ...Array.from(new Set(channels.map(c => c.category))).sort()];
  const filtered    = category === 'All' ? channels : channels.filter(c => c.category === category);
  const timeSlots   = Array.from({ length: 17 }, (_, i) =>
    new Date(epgStart.current.getTime() + i * 30 * 60 * 1000)
  );
  const totalGridW  = 8 * 60 * PX_PER_MIN;
  const nowOffsetPx = Math.max(0, (nowMs - epgStart.current.getTime()) / 60_000 * PX_PER_MIN);
  const selCh       = selected?.channel;
  const selPrg      = selected?.program;

  return (
    <div
      ref={wrapRef}
      style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        background: C.bg, color: C.brightText, fontFamily: 'monospace',
        userSelect: 'none', overflow: 'hidden', position: 'relative',
      }}
    >
      {/* ════════════════════════════════════════════════════════════════════
          TOP INFO STRIP — selected channel / current program
      ════════════════════════════════════════════════════════════════════ */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16,
        background: C.label, borderBottom: `2px solid ${C.border}`,
        padding: '10px 16px', minHeight: 82,
      }}>
        {selCh ? (
          <>
            {/* Channel badge (number + abbr) */}
            <div style={{ textAlign: 'center', minWidth: 64, flexShrink: 0 }}>
              <div style={{ fontSize: 34, fontWeight: 900, color: C.gold, lineHeight: 1 }}>
                {selCh.number}
              </div>
              <div style={{ fontSize: 10, color: C.midText, marginTop: 2, letterSpacing: 3 }}>
                {abbr(selCh.name)}
              </div>
            </div>

            {/* Separator */}
            <div style={{ width: 1, alignSelf: 'stretch', background: C.border, flexShrink: 0 }} />

            {/* Program info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: C.dimText, textTransform: 'uppercase', marginBottom: 3 }}>
                NOW PLAYING
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.white, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selPrg?.title || 'Live TV'}
              </div>
              <div style={{ fontSize: 11, color: C.midText, marginTop: 2 }}>
                {selCh.name}
                {selPrg && (
                  <span style={{ color: C.dimText }}>
                    &nbsp;·&nbsp;{fmt12(new Date(selPrg.start))} – {fmt12(new Date(selPrg.stop))}
                  </span>
                )}
              </div>
              {selPrg?.description && (
                <div style={{ fontSize: 10, color: C.dimText, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {selPrg.description}
                </div>
              )}
            </div>

            {/* WATCH button */}
            <button
              onClick={() => watchCh(selCh, selPrg)}
              style={{
                flexShrink: 0, background: C.gold, color: '#000',
                fontWeight: 800, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
                padding: '8px 18px', border: 'none', borderRadius: 2, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Play size={12} fill="#000" strokeWidth={0} />
              WATCH
            </button>
          </>
        ) : (
          <div style={{ flex: 1, color: C.dimText, fontSize: 11 }}>Select a channel below…</div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          EPG GRID
      ════════════════════════════════════════════════════════════════════ */}
      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: C.dimText }}>
          <RefreshCw size={16} className="animate-spin" />
          <span style={{ fontSize: 12 }}>Tuning in…</span>
        </div>
      ) : error ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: C.dimText }}>
          <Tv size={28} />
          <div style={{ fontSize: 12 }}>Signal lost — {error}</div>
          <button onClick={load} style={{ background: C.gold, color: '#000', fontSize: 11, fontWeight: 700, padding: '6px 16px', border: 'none', cursor: 'pointer', borderRadius: 2 }}>
            RETRY
          </button>
        </div>
      ) : (
        <div ref={gridRef} style={{ flex: 1, overflow: 'auto', scrollBehavior: 'auto' }}>
          <div style={{ minWidth: LABEL_W + totalGridW, position: 'relative' }}>

            {/* ── Sticky time-header row (dark green — Charter style) ── */}
            <div style={{
              display: 'flex', position: 'sticky', top: 0, zIndex: 20,
              borderBottom: `1px solid ${C.border}`, height: HEADER_H,
            }}>
              {/* Corner — clock */}
              <div style={{
                width: LABEL_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 25,
                background: C.header, borderRight: `1px solid ${C.headerGrid}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              }}>
                <Tv size={12} style={{ color: C.gold }} />
                <span style={{ fontSize: 10, color: C.gold, fontWeight: 700, letterSpacing: 1 }}>
                  {fmt12(now)}
                </span>
              </div>

              {/* Time slot labels */}
              <div style={{ flex: 1, position: 'relative', background: C.header }}>
                {timeSlots.map((slot, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute', left: i * 30 * PX_PER_MIN, top: 0,
                      width: 30 * PX_PER_MIN, height: HEADER_H,
                      display: 'flex', alignItems: 'center', paddingLeft: 6,
                      fontSize: 10, color: C.headerText, fontWeight: 600, letterSpacing: 0.5,
                      borderRight: `1px solid ${C.headerGrid}`, boxSizing: 'border-box',
                    }}
                  >
                    {fmt12(slot)}
                  </div>
                ))}
                {/* Current-time line in header */}
                <div style={{
                  position: 'absolute', left: nowOffsetPx, top: 0,
                  width: 2, height: HEADER_H, background: C.nowLine, zIndex: 10,
                }} />
              </div>
            </div>

            {/* ── Channel rows ── */}
            {filtered.map((ch, ri) => {
              const isSelected = selCh?.id === ch.id;
              return (
                <div
                  key={ch.id}
                  style={{
                    display: 'flex', height: ROW_H,
                    borderBottom: `1px solid ${C.border}`,
                    background: ri % 2 === 0 ? C.rowA : C.rowB,
                  }}
                >
                  {/* Channel label — sticky left */}
                  <button
                    onClick={() => selectCh(ch)}
                    onDoubleClick={() => watchCh(ch)}
                    title={`${ch.name} — double-click to watch`}
                    style={{
                      width: LABEL_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 10,
                      background: isSelected ? C.labelSel : C.label,
                      borderRight: `1px solid ${C.border}`,
                      display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
                      cursor: 'pointer', border: 'none', outline: 'none', textAlign: 'left',
                    }}
                  >
                    {/* Abbreviated name (MSNBC, TNCK, CNN…) */}
                    <span style={{
                      fontFamily: 'monospace', fontSize: 11, fontWeight: 700, letterSpacing: 1,
                      color: isSelected ? C.white : C.brightText,
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {abbr(ch.name)}
                    </span>
                    {/* Channel number */}
                    <span style={{
                      fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
                      color: isSelected ? C.gold : C.dimText,
                      minWidth: 28, textAlign: 'right', flexShrink: 0,
                    }}>
                      {ch.number}
                    </span>
                  </button>

                  {/* Program blocks */}
                  <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
                    {ch.timelines?.map((prg, pi) => {
                      const pStart  = new Date(prg.start).getTime();
                      const pStop   = new Date(prg.stop).getTime();
                      const leftPx  = (pStart - epgStart.current.getTime()) / 60_000 * PX_PER_MIN;
                      const widthPx = (pStop - pStart) / 60_000 * PX_PER_MIN;
                      if (leftPx + widthPx < 0 || leftPx > totalGridW) return null;

                      const isNow = nowMs >= pStart && nowMs < pStop;
                      const isSel = isSelected && selPrg?.start === prg.start;

                      return (
                        <button
                          key={pi}
                          onClick={() => selectCh(ch, prg)}
                          onDoubleClick={() => watchCh(ch, prg)}
                          title={`${prg.title}\n${fmt12(new Date(pStart))} – ${fmt12(new Date(pStop))}\nDouble-click to watch`}
                          style={{
                            position: 'absolute',
                            left: Math.max(0, leftPx),
                            width: Math.min(widthPx, totalGridW - Math.max(0, leftPx)) - 1,
                            top: 1, height: ROW_H - 2,
                            background: isSel ? C.selCell : isNow ? C.nowCell : 'transparent',
                            border: `1px solid ${isSel ? '#003caa' : isNow ? '#002870' : C.border}`,
                            borderRadius: 0, cursor: 'pointer', padding: '0 6px',
                            display: 'flex', alignItems: 'center', overflow: 'hidden',
                            boxSizing: 'border-box', outline: 'none',
                          }}
                        >
                          <span style={{
                            fontSize: 11,
                            color: isNow ? C.white : C.midText,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            display: 'flex', alignItems: 'center', gap: 5, width: '100%',
                          }}>
                            {/* ◄◄ indicator on the currently-airing block */}
                            {isNow && (
                              <span style={{ color: C.green, fontWeight: 700, flexShrink: 0, fontSize: 10 }}>
                                ◄◄
                              </span>
                            )}
                            {prg.title}
                          </span>
                        </button>
                      );
                    })}

                    {/* Current-time red line through program rows */}
                    {nowOffsetPx >= 0 && nowOffsetPx <= totalGridW && (
                      <div style={{
                        position: 'absolute', left: nowOffsetPx, top: 0,
                        width: 2, height: ROW_H, background: C.nowLine, zIndex: 5, pointerEvents: 'none',
                      }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          BOTTOM NAV BAR — categories + status
      ════════════════════════════════════════════════════════════════════ */}
      <div style={{
        flexShrink: 0, background: C.bottomBar, borderTop: `2px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 2,
        padding: '4px 8px', minHeight: 36,
      }}>
        {/* Category buttons */}
        <div style={{ display: 'flex', gap: 1, flex: 1, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {categories.map(cat => {
            const active = category === cat && !showLocal;
            const cc     = cat === 'All' ? C.gold : catColor(cat);
            return (
              <button
                key={cat}
                onClick={() => { setCategory(cat); setShowLocal(false); }}
                style={{
                  padding: '3px 10px', fontSize: 10, fontFamily: 'monospace',
                  fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
                  cursor: 'pointer', border: 'none', borderRadius: 2, whiteSpace: 'nowrap',
                  background: active ? cc : 'transparent',
                  color:      active ? (cat === 'All' ? '#000' : '#fff') : C.midText,
                }}
              >
                {cat}
              </button>
            );
          })}

          {/* Local news toggle */}
          <button
            onClick={() => setShowLocal(v => !v)}
            style={{
              padding: '3px 10px', fontSize: 10, fontFamily: 'monospace',
              fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
              cursor: 'pointer', border: 'none', borderRadius: 2, whiteSpace: 'nowrap',
              background: showLocal ? '#1a4a1a' : 'transparent',
              color:      showLocal ? C.green   : C.midText,
            }}
          >
            📡 LOCAL
          </button>
        </div>

        {/* Right status */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: C.dimText }}>
          <span>{filtered.length} ch</span>
          <span style={{ color: C.border }}>│</span>
          <button
            onClick={load}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: C.dimText, fontSize: 10, display: 'flex', alignItems: 'center', gap: 4,
              fontFamily: 'monospace',
            }}
          >
            <RefreshCw size={10} />
            REFRESH
          </button>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          LOCAL NEWS OVERLAY PANEL (popup above bottom bar)
      ════════════════════════════════════════════════════════════════════ */}
      {showLocal && (
        <div style={{
          position: 'absolute', bottom: 40, right: 0,
          width: 270, background: C.label,
          border: `1px solid ${C.border}`, borderBottom: 'none',
          borderRadius: '4px 4px 0 0',
          maxHeight: 280, overflow: 'hidden',
          display: 'flex', flexDirection: 'column', zIndex: 50,
          boxShadow: '0 -4px 20px rgba(0,0,0,0.6)',
        }}>
          {/* Header */}
          <div style={{
            padding: '8px 12px', borderBottom: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Radio size={12} style={{ color: C.green }} />
            <span style={{ fontSize: 10, letterSpacing: 2, color: C.green, fontWeight: 700, textTransform: 'uppercase' }}>
              Local News
            </span>
            {location && (
              <span style={{ fontSize: 10, color: C.dimText, letterSpacing: 0, marginLeft: 2 }}>
                — {location}
              </span>
            )}
          </div>

          {/* Station list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
            {localNews.length > 0 ? localNews.map(s => (
              <button
                key={s.id}
                onClick={() => watchNews(s)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 10px', background: 'none', border: 'none',
                  cursor: 'pointer', textAlign: 'left', borderRadius: 2,
                  outline: 'none',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#0a0a30'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>{s.logo}</span>
                <span style={{ fontSize: 11, color: C.brightText, flex: 1 }}>{s.name}</span>
                <span style={{
                  fontSize: 9, background: '#cc0000', color: '#fff',
                  padding: '1px 5px', fontWeight: 700, borderRadius: 1, flexShrink: 0,
                }}>
                  LIVE
                </span>
              </button>
            )) : (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: C.dimText, lineHeight: 1.6 }}>
                Set your city in<br />Settings → Cable TV
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
