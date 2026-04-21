import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ExternalLink, X, Play, RotateCcw, Users } from 'lucide-react';
import api from '../api';
import { useApp } from '../App';

function fmtTime(s) {
  if (!s || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export default function Player({ session, onClose }) {
  const { activeUserId, showToast } = useApp();
  const slotRef = useRef(null);
  const [resume, setResume] = useState(null);
  const [opened, setOpened] = useState(false);

  const loadAndOpen = useCallback(async (resumeAt = 0) => {
    if (!slotRef.current) return;
    const rect = slotRef.current.getBoundingClientRect();
    const bounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
    await window.electron.player.open({
      url: session.url,
      title: session.title,
      partyId: session.partyId || null,
      contentId: session.contentId || null,
      userId: activeUserId,
      watchlistId: session.watchlistId || null,
      bounds,
      resumeAt
    });
    setOpened(true);
  }, [session, activeUserId]);

  // On mount: check for resume position, offer resume or restart
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (session.contentId && activeUserId) {
        try {
          const pos = await api.getPosition(activeUserId, session.contentId);
          if (!cancelled && pos?.last_position_seconds > 10
              && pos.last_site_url === session.url) {
            setResume(pos);
            return; // wait for user to pick
          }
        } catch {}
      }
      if (!cancelled) loadAndOpen(0);
    })();
    return () => { cancelled = true; };
  }, [session.url, session.contentId, activeUserId, loadAndOpen]);

  // Track slot bounds and send to main whenever they change
  useEffect(() => {
    if (!opened || !slotRef.current) return;
    const send = () => {
      if (!slotRef.current) return;
      const r = slotRef.current.getBoundingClientRect();
      window.electron.player.setBounds({
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height)
      });
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(slotRef.current);
    window.addEventListener('resize', send);
    // Catch scrolling if Player is inside a scroll container
    const scrollEl = document.querySelector('main');
    scrollEl?.addEventListener('scroll', send, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', send);
      scrollEl?.removeEventListener('scroll', send);
    };
  }, [opened]);

  // Close Player view when component unmounts
  useEffect(() => {
    return () => { window.electron.player.close(); };
  }, []);

  function exit() {
    window.electron.player.close();
    onClose();
  }

  function openExternal() {
    window.electron.openUrl(session.url);
    exit();
    showToast('Opened in browser ↗');
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-2.5 surface-glass border-b border-border shrink-0">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[.15em] text-muted">Now playing</div>
          <div className="text-white font-medium truncate">{session.title}</div>
        </div>
        <div className="flex gap-2 shrink-0 items-center">
          {session.partyId && (
            <span className="text-xs bg-accent/20 text-accent px-3 py-1.5 rounded-full flex items-center gap-1.5 font-semibold">
              <span className="w-1.5 h-1.5 bg-green rounded-full animate-pulse" />
              <Users size={12} /> Watch Party
            </span>
          )}
          <button onClick={openExternal} className="btn btn-ghost">
            <ExternalLink size={14} /> Open in browser
          </button>
          <button onClick={exit} className="btn btn-icon btn-ghost" aria-label="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Video slot */}
      <div className="flex-1 relative bg-black overflow-hidden">
        <div ref={slotRef} className="absolute inset-0" />
        {!opened && !resume && (
          <div className="absolute inset-0 flex items-center justify-center text-muted">
            Loading…
          </div>
        )}
        {resume && !opened && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg">
            <div className="surface-elevated rounded-2xl p-10 max-w-md text-center shadow-lg">
              <div className="display-md text-white mb-2">Welcome back</div>
              <div className="text-muted mb-8">
                You were <span className="text-white">{fmtTime(resume.last_position_seconds)}</span> into this show.
              </div>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => { loadAndOpen(resume.last_position_seconds); setResume(null); }}
                  className="btn btn-primary btn-hero"
                >
                  <Play size={16} fill="currentColor" /> Resume from {fmtTime(resume.last_position_seconds)}
                </button>
                <button
                  onClick={() => { loadAndOpen(0); setResume(null); }}
                  className="btn btn-ghost btn-hero"
                >
                  <RotateCcw size={15} /> Start over
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
