// N Streams Watch Party — viewer bridge
//
// Injected into every streaming-service page inside our viewer window.
// Finds the <video> element (or the most-relevant one if multiple), hooks
// playback events, and exposes a control API back to the main process via IPC.
//
// Works across Netflix, Disney+, Max, Hulu, Prime, Crunchyroll, YouTube, etc.
// because they all use a standard HTMLVideoElement — DRM affects decoding,
// not the DOM API.

const { ipcRenderer, contextBridge } = require('electron');

let currentVideo = null;
let syncing = false;               // true while we programmatically control <video>
let lastHeartbeatTime = 0;
let partyActive = false;

// ─── Video discovery ─────────────────────────────────────────
function pickBestVideo() {
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length === 0) return null;
  // Prefer the video that's: visible, largest, and has a src
  const scored = videos.map(v => {
    const r = v.getBoundingClientRect();
    const visible = r.width > 100 && r.height > 100 && getComputedStyle(v).visibility !== 'hidden';
    const area = r.width * r.height;
    const hasSrc = !!(v.src || v.currentSrc || v.querySelector('source'));
    return { v, score: (visible ? 1000 : 0) + (hasSrc ? 500 : 0) + area };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].v;
}

function attachTo(video) {
  if (currentVideo === video) return;
  detach();
  currentVideo = video;

  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onPause);
  video.addEventListener('seeking', onSeek);
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('ratechange', onRate);

  ipcRenderer.send('party:video-ready', {
    duration: video.duration || null,
    currentTime: video.currentTime || 0,
    paused: video.paused
  });
}

function detach() {
  if (!currentVideo) return;
  currentVideo.removeEventListener('play', onPlay);
  currentVideo.removeEventListener('pause', onPause);
  currentVideo.removeEventListener('seeking', onSeek);
  currentVideo.removeEventListener('timeupdate', onTimeUpdate);
  currentVideo.removeEventListener('ratechange', onRate);
  currentVideo = null;
}

function onPlay() {
  if (syncing || !partyActive) return;
  ipcRenderer.send('party:playback', { action: 'play', current_time: currentVideo.currentTime });
}
function onPause() {
  if (syncing || !partyActive) return;
  ipcRenderer.send('party:playback', { action: 'pause', current_time: currentVideo.currentTime });
}
function onSeek() {
  if (syncing || !partyActive) return;
  ipcRenderer.send('party:playback', { action: 'seek', current_time: currentVideo.currentTime });
}
function onTimeUpdate() {
  const now = Date.now();
  if (now - lastHeartbeatTime < 2000) return;
  lastHeartbeatTime = now;
  // Always send player heartbeat so main can save resume position
  ipcRenderer.send('player:heartbeat', {
    current_time: currentVideo.currentTime,
    duration: currentVideo.duration,
    playing: !currentVideo.paused
  });
  if (partyActive) {
    ipcRenderer.send('party:heartbeat', {
      current_time: currentVideo.currentTime,
      playing: !currentVideo.paused
    });
  }
}
function onRate() {
  // Ignore rate changes — don't try to sync speed
}

// ─── Commands from main process ──────────────────────────────
ipcRenderer.on('party:apply', (_, cmd) => {
  if (!currentVideo) return;
  syncing = true;
  try {
    if (typeof cmd.current_time === 'number') {
      const diff = Math.abs(currentVideo.currentTime - cmd.current_time);
      if (diff > 0.5) {
        currentVideo.currentTime = cmd.current_time;
      }
    }
    if (cmd.action === 'play') {
      const p = currentVideo.play();
      if (p && p.catch) p.catch(() => {
        // Autoplay blocked — surface to user
        flashOverlay('⚠ Click anywhere to start playback (browser autoplay rules)');
      });
    } else if (cmd.action === 'pause') {
      currentVideo.pause();
    }
  } catch (e) {
    console.warn('[NStreams] apply failed', e);
  }
  setTimeout(() => { syncing = false; }, 150);
});

ipcRenderer.on('party:active', (_, active) => {
  partyActive = !!active;
  if (active) showPartyBadge();
  else hidePartyBadge();
});

ipcRenderer.on('party:request-state', () => {
  if (!currentVideo) {
    ipcRenderer.send('party:state', null);
    return;
  }
  ipcRenderer.send('party:state', {
    current_time: currentVideo.currentTime,
    playing: !currentVideo.paused,
    duration: currentVideo.duration
  });
});

ipcRenderer.on('party:reaction', (_, { emoji, user }) => {
  floatReaction(emoji, user);
});

// ─── Watch DOM for the <video> ───────────────────────────────
function scan() {
  const v = pickBestVideo();
  if (v && v !== currentVideo) attachTo(v);
}

const mo = new MutationObserver(() => scan());
function boot() {
  scan();
  mo.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scan, 3000); // belt-and-suspenders
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// ─── Escape hatch: "Open in real browser" button ───────────────
// Always-visible floating button in the top-right. Highlights gold when
// we detect DRM playback failures so user can fall back to the browser.
let escapeBtn = null;
let escapeBtnAlerted = false;

// Known DRM-failure patterns across services
const DRM_FAILURE_PATTERNS = [
  /KAT-?\d+/i,                            // Crunchyroll (KAT-6005 etc)
  /widevine/i,
  /drm error|drm failed|drm failure/i,
  /playback error|not available|we can'?t play/i,
  /error code[: ]*S?7\d{2,3}/i,           // Netflix
  /error code[: ]*UI-\d+/i,                // HBO Max / Disney+
  /error code[: ]*83\d{2}/i,               // Amazon Prime
  /error code[: ]*m7\d{3}/i,               // Netflix
  /error code[: ]*B\d{2,3}-\d+/i           // Generic
];

function injectEscapeButton() {
  injectStyles();
  // Extra styles for escape button
  if (!document.getElementById('nstreams-escape-css')) {
    const s = document.createElement('style');
    s.id = 'nstreams-escape-css';
    s.textContent = `
      #nstreams-escape-btn {
        position: fixed; top: 12px; left: 12px; z-index: 2147483646;
        background: rgba(30,30,53,0.85); color: white;
        padding: 8px 14px; border-radius: 999px;
        font: 600 12px/1 system-ui, sans-serif; cursor: pointer;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        border: 1px solid rgba(99,102,241,0.5);
        backdrop-filter: blur(12px);
        transition: all 0.2s ease;
        user-select: none;
      }
      #nstreams-escape-btn:hover {
        background: rgba(99,102,241,0.95);
        transform: scale(1.04);
      }
      #nstreams-escape-btn.alert {
        background: rgba(245,158,11,0.95);
        border-color: rgba(245,158,11,1);
        animation: ns-alert 1.5s infinite;
      }
      @keyframes ns-alert {
        0%,100% { box-shadow: 0 0 10px rgba(245,158,11,0.5); }
        50%     { box-shadow: 0 0 25px rgba(245,158,11,1); }
      }
    `;
    document.documentElement.appendChild(s);
  }

  if (document.getElementById('nstreams-escape-btn')) return;
  escapeBtn = document.createElement('div');
  escapeBtn.id = 'nstreams-escape-btn';
  escapeBtn.textContent = '🌐 Open in browser';
  escapeBtn.title = 'Open the current page in your default browser — use this if video playback fails inside N Streams';
  escapeBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    ipcRenderer.send('viewer:open-externally');
  };
  document.documentElement.appendChild(escapeBtn);
}

function flagEscapeAlert(reason) {
  if (!escapeBtn || escapeBtnAlerted) return;
  escapeBtnAlerted = true;
  escapeBtn.classList.add('alert');
  escapeBtn.textContent = '⚠ Playback failed — open externally';
  console.log('[NStreams] DRM playback failure detected:', reason);
}

function scanForDrmFailure() {
  try {
    const text = document.body?.innerText || '';
    if (!text) return;
    for (const pat of DRM_FAILURE_PATTERNS) {
      const m = text.match(pat);
      if (m) return flagEscapeAlert(m[0]);
    }
  } catch {}
}

// Inject after the page has a body
function bootEscape() {
  injectEscapeButton();
  setInterval(scanForDrmFailure, 2500);
  // Also listen for video errors from our existing <video> hooks
  setInterval(() => {
    if (currentVideo && currentVideo.error) {
      flagEscapeAlert(`video.error code ${currentVideo.error.code}`);
    }
  }, 2000);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootEscape);
} else {
  bootEscape();
}

// ─── Visual: party badge + floating reactions + overlay ──────
function injectStyles() {
  if (document.getElementById('nstreams-party-css')) return;
  const s = document.createElement('style');
  s.id = 'nstreams-party-css';
  s.textContent = `
    #nstreams-party-badge {
      position: fixed; top: 12px; right: 12px; z-index: 2147483647;
      background: rgba(99,102,241,0.95); color: white;
      padding: 6px 12px; border-radius: 999px; font: 600 12px/1.2 system-ui;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      display: flex; align-items: center; gap: 6px;
      pointer-events: none; animation: nspulse 2s infinite;
    }
    @keyframes nspulse {
      0%,100% { box-shadow: 0 0 12px rgba(99,102,241,0.5); }
      50%     { box-shadow: 0 0 24px rgba(99,102,241,0.9); }
    }
    .nstreams-reaction {
      position: fixed; z-index: 2147483647;
      font-size: 48px; pointer-events: none;
      animation: nsfloat 2.4s ease-out forwards;
    }
    @keyframes nsfloat {
      0%   { opacity: 0; transform: translateY(0) scale(0.5); }
      15%  { opacity: 1; transform: translateY(-20px) scale(1.1); }
      100% { opacity: 0; transform: translateY(-300px) scale(0.9); }
    }
    .nstreams-reaction-label {
      position: absolute; top: 60px; left: 50%; transform: translateX(-50%);
      font: 600 12px/1 system-ui; background: rgba(0,0,0,0.7); color: white;
      padding: 3px 8px; border-radius: 4px; white-space: nowrap;
    }
    #nstreams-flash {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      z-index: 2147483647;
      background: rgba(239,68,68,0.95); color: white;
      padding: 10px 18px; border-radius: 8px; font: 500 14px/1.2 system-ui;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    }
  `;
  document.documentElement.appendChild(s);
}

function showPartyBadge() {
  injectStyles();
  if (document.getElementById('nstreams-party-badge')) return;
  const b = document.createElement('div');
  b.id = 'nstreams-party-badge';
  b.innerHTML = '📺 N Streams Watch Party';
  document.documentElement.appendChild(b);
}
function hidePartyBadge() {
  document.getElementById('nstreams-party-badge')?.remove();
}

function floatReaction(emoji, user) {
  injectStyles();
  const el = document.createElement('div');
  el.className = 'nstreams-reaction';
  el.textContent = emoji;
  el.style.left = `${20 + Math.random() * 60}%`;
  el.style.bottom = '80px';
  if (user?.name) {
    const lbl = document.createElement('div');
    lbl.className = 'nstreams-reaction-label';
    lbl.textContent = user.name;
    lbl.style.color = user.color || '#fff';
    el.appendChild(lbl);
  }
  document.documentElement.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function flashOverlay(text) {
  injectStyles();
  document.getElementById('nstreams-flash')?.remove();
  const el = document.createElement('div');
  el.id = 'nstreams-flash';
  el.textContent = text;
  document.documentElement.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
