import { useCallback, useEffect, useRef, useState } from 'react';
import {
  checkForAndroidUpdate, downloadUpdate, installUpdate, installedVersion,
  openInstallSettings, semverNewer, updaterInfo,
} from './update-checker';

const RECHECK_MS = 6 * 60 * 60 * 1000;   // a projector can sit on N Streams for days
const RESUME_RECHECK_MS = 60 * 60 * 1000;
const HANDOFF_GRACE_MS = 5000;

// Set just before we hand an episode to the system browser. That handoff
// backgrounds N Streams, and installing then could tear down the tab the
// user is about to watch in — so a background within the grace window is
// ignored. Any other background (Home, sleep, another app) applies the update.
let playbackHandoffAt = 0;
export function markPlaybackHandoff() { playbackHandoffAt = Date.now(); }

/**
 * Android self-update state machine.
 *   idle → downloading → ready → installing → (process replaced)
 * Downloads silently as soon as a newer release exists; installs on the next
 * non-playback background or when the user taps "Update now".
 */
export function useAndroidUpdater(showToastFn) {
  const [state, setStateRaw] = useState(null);   // {phase, version, path, percent, error, hidden}
  const ref = useRef(null);
  const busy = useRef(false);
  const lastCheck = useRef(0);
  const [version, setVersion] = useState(null);
  // App's showToast is a fresh function every render; keep it out of the
  // effect deps or the updater would re-register on every render.
  const toastRef = useRef(showToastFn);
  toastRef.current = showToastFn;
  const showToast = useCallback((msg) => toastRef.current?.(msg), []);

  const setState = useCallback((s) => { ref.current = s; setStateRaw(s); }, []);

  const check = useCallback(async ({ manual = false } = {}) => {
    if (busy.current) return;
    const phase = ref.current?.phase;
    if (phase === 'ready' || phase === 'installing') return;
    busy.current = true;
    lastCheck.current = Date.now();
    try {
      const info = await checkForAndroidUpdate();
      if (!info) {
        if (manual) showToast?.('N Streams is up to date');
        return;
      }
      setState({ phase: 'downloading', version: info.version, percent: 0 });
      const dl = await downloadUpdate(info, percent =>
        setState({ ...ref.current, percent }));
      setState({ phase: 'ready', version: info.version, path: dl.path });
    } catch (e) {
      setState({ phase: 'error', version: ref.current?.version, error: e.message });
    } finally {
      busy.current = false;
    }
  }, [setState, showToast]);

  const apply = useCallback(async ({ foreground }) => {
    const u = ref.current;
    if (!u || u.phase !== 'ready') return;
    const info = await updaterInfo();
    if (info && info.canInstall === false) {
      // "Install unknown apps" not granted — only fixable by the user.
      setState({ ...u, hidden: false, needsPermission: true });
      if (foreground) openInstallSettings();
      return;
    }
    setState({ ...u, phase: 'installing' });
    try {
      await installUpdate(u.path, { relaunch: foreground });
      // Success = the system replaces this process. Nothing else runs.
    } catch (e) {
      setState({ ...u, phase: 'error', error: e.message });
    }
  }, [setState]);

  useEffect(() => {
    if (!window.Capacitor) return;
    let sub;
    let alive = true;

    (async () => {
      const v = await installedVersion();
      if (!alive) return;
      setVersion(v);
      // One-time "it worked" toast after an update lands.
      try {
        const prev = localStorage.getItem('nstreams:last_version');
        if (prev && semverNewer(v, prev)) showToast?.(`Updated to v${v} ✓`);
        localStorage.setItem('nstreams:last_version', v);
      } catch {}
      const info = await updaterInfo();
      if (info?.lastStatus?.startsWith('failure')) {
        console.warn('[updater] previous install failed:', info.lastStatus, info.lastMessage);
      }
      check();
    })();

    const timer = setInterval(() => check(), RECHECK_MS);

    import('@capacitor/app').then(({ App: CapApp }) => {
      sub = CapApp.addListener('appStateChange', async ({ isActive }) => {
        if (!isActive) {
          if (Date.now() - playbackHandoffAt > HANDOFF_GRACE_MS) apply({ foreground: false });
          return;
        }
        // Back in front. If a background install needed a confirmation the
        // system wouldn't show from the background, offer it again.
        const u = ref.current;
        if (u?.phase === 'installing') {
          const info = await updaterInfo();
          if (info?.lastStatus === 'pending_user_action' || info?.lastStatus?.startsWith('failure')) {
            setState({ ...u, phase: 'ready', hidden: false });
          }
        }
        if (Date.now() - lastCheck.current > RESUME_RECHECK_MS) check();
      });
    });

    return () => {
      alive = false;
      clearInterval(timer);
      Promise.resolve(sub).then(s => s?.remove?.());
    };
  }, [check, apply, setState, showToast]);

  return {
    update: state,
    version,
    checkNow: () => check({ manual: true }),
    applyNow: () => apply({ foreground: true }),
    // Hides the banner; a ready update still applies on the next background.
    dismiss: () => setState(ref.current?.phase === 'error' ? null : { ...ref.current, hidden: true }),
  };
}
