import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import TopNav from './components/TopNav';
import Home from './pages/Home';
import Watchlist from './pages/Watchlist';
import Browse from './pages/Browse';
import Sites from './pages/Sites';
import Crew from './pages/Crew';
import Sports from './pages/Sports';
import Cable from './pages/Cable';
import Settings from './pages/Settings';
import Player from './pages/Player';
import SessionBanner from './components/SessionBanner';
import ContentModal from './components/ContentModal';
import TutorialOverlay from './components/TutorialOverlay';
import { PartyProvider } from './party/PartyContext';
import PartySidebar from './party/PartySidebar';
import WatchPartyModal from './party/WatchPartyModal';
import api from './api';

export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export default function App() {
  const [page, setPage] = useState('home');
  const [users, setUsers] = useState([]);
  const [activeUserId, setActiveUserId] = useState(1);
  const [modalContentId, setModalContentId] = useState(null);
  const [partyModalContentId, setPartyModalContentId] = useState(null);
  const [playerSession, setPlayerSession] = useState(null);
  const [prevPage, setPrevPage] = useState('home');
  const [activeSessions, setActiveSessions] = useState([]);
  const [toast, setToast] = useState(null);
  const searchRef = useRef(null);

  const activeUser = users.find(u => u.id === activeUserId);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.getUsers();
        setUsers(list);
        if (window.electron) {
          const uid = await window.electron.getActiveUser();
          if (uid && list.find(u => u.id === uid)) setActiveUserId(uid);
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  useEffect(() => {
    if (!activeUserId) return;
    refreshSessions();
    const handler = () => refreshSessions();
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [activeUserId]);

  useEffect(() => {
    if (!window.electron?.onPopupBlocked) return;
    window.electron.onPopupBlocked(() => {
      showToast('🛡 Popup blocked');
    });
    window.electron?.onViewerEscaped?.(() => {
      showToast('Opened in your default browser ↗');
    });
    window.electron?.onRedirectBlocked?.((d) => {
      showToast(`🛡 Blocked ad redirect → ${d.host || 'unknown'}`);
    });
  }, []);

  // Watch party: host loaded a new video — open it for all members.
  // Ref is defined here (before openPlayer exists) but populated later so the
  // listener can't capture a stale openPlayer closure. Initial value is null —
  // the effect below swaps in the real function on every render.
  const openPlayerRef = useRef(null);

  useEffect(() => {
    // Android deep-link handler for OAuth (nstreams:// scheme)
    if (window.Capacitor) {
      import('@capacitor/app').then(({ App: CapApp }) => {
        CapApp.addListener('appUrlOpen', async ({ url }) => {
          try {
            if (url.includes('mal-callback')) {
              const u = new URL(url.replace('nstreams://', 'https://x/'));
              const code = u.searchParams.get('code');
              if (code) { await api.malCallback({ code, userId: activeUserId }); showToast('MAL connected ✓'); }
            } else if (url.includes('anilist-callback')) {
              const frag = url.split('#')[1] || '';
              const token = new URLSearchParams(frag).get('access_token');
              if (token) { await api.anilistCallback({ token, userId: activeUserId }); showToast('AniList connected ✓'); }
            }
          } catch (e) { showToast('OAuth failed: ' + e.message); }
        });
      });
      return;
    }
    if (!window.electron) return;
    window.electron.onOAuthCallback(async (url) => {
      try {
        if (url.includes('mal-callback')) {
          const u = new URL(url.replace('nstreams://', 'https://x/'));
          const code = u.searchParams.get('code');
          if (code) {
            await api.malCallback({ code, userId: activeUserId });
            showToast('MAL connected ✓');
          }
        } else if (url.includes('anilist-callback')) {
          const frag = url.split('#')[1] || '';
          const params = new URLSearchParams(frag);
          const token = params.get('access_token');
          if (token) {
            await api.anilistCallback({ token, userId: activeUserId });
            showToast('AniList connected ✓');
          }
        }
      } catch (e) {
        showToast('OAuth failed: ' + e.message);
      }
    });
  }, [activeUserId]);

  // ⌘K / Ctrl+K shortcut: focus search on any page
  useEffect(() => {
    const onKey = (e) => {
      const isK = e.key === 'k' || e.key === 'K';
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select?.();
      }
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // TV remote: arrow keys scroll the main content area when no interactive
  // element is focused (the remote D-pad acts as scroll when pointer is idle).
  useEffect(() => {
    if (!window.Capacitor) return;
    const STEP = 280;
    const onKey = (e) => {
      const focused = document.activeElement;
      const isInteractive = focused && focused !== document.body &&
        ['BUTTON','INPUT','TEXTAREA','SELECT','A'].includes(focused.tagName);
      if (isInteractive) return; // let the element handle it
      const main = document.querySelector('main[class*="overflow-y-auto"]');
      if (!main) return;
      if (e.key === 'ArrowDown') { main.scrollBy({ top: STEP, behavior: 'smooth' }); e.preventDefault(); }
      if (e.key === 'ArrowUp')   { main.scrollBy({ top: -STEP, behavior: 'smooth' }); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Apply TV edge-padding CSS variable from stored preference (Android only)
  useEffect(() => {
    if (!window.Capacitor) return;
    import('@capacitor/preferences').then(({ Preferences }) => {
      Preferences.get({ key: 'tv_edge_padding' }).then(({ value }) => {
        const px = parseInt(value) || 0;
        document.documentElement.style.setProperty('--tv-edge', `${px}px`);
      });
    });
  }, []);

  async function refreshSessions() {
    try {
      const s = await api.activeSessions(activeUserId);
      setActiveSessions(s);
    } catch (_) {}
  }

  async function switchUser(id) {
    setActiveUserId(id);
    if (window.electron) await window.electron.setActiveUser(id);
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  const openPlayer = (sessionObj) => {
    // Android / Capacitor — open in the system browser instead of BrowserView
    if (window.Capacitor) {
      import('@capacitor/browser').then(({ Browser }) => {
        Browser.open({ url: sessionObj.url });
      });
      return;
    }
    // Electron — existing BrowserView player
    setPlayerSession(sessionObj);
    setPrevPage(page === 'player' ? prevPage : page);
    setPage('player');
    setModalContentId(null);
    setPartyModalContentId(null);
  };
  const closePlayer = () => {
    setPlayerSession(null);
    setPage(prevPage || 'home');
  };

  // Keep the ref fresh so the load_video listener below always calls the
  // latest openPlayer (which closes over current page / prevPage state).
  useEffect(() => { openPlayerRef.current = openPlayer; });

  useEffect(() => {
    if (!window.electron?.party) return;
    const off = window.electron.party.on('load_video', ({ url, title, contentId }) => {
      openPlayerRef.current?.({
        url,
        title: title || 'Watch Party',
        partyId: null,      // PartyContext already holds the partyId
        contentId: contentId || null,
      });
      showToast(`▶ Now watching: ${title || 'new video'}`);
    });
    return () => off?.();
  }, []);

  const ctx = {
    users, activeUserId, activeUser, switchUser,
    openContent: (id) => setModalContentId(id),
    closeContent: () => setModalContentId(null),
    openWatchParty: (id) => setPartyModalContentId(id),
    openPlayer, closePlayer, playerSession,
    refreshSessions,
    showToast,
    refreshUsers: async () => setUsers(await api.getUsers()),
    setPage
  };

  const pages = {
    home: <Home />,
    watchlist: <Watchlist />,
    browse: <Browse />,
    cable: <Cable />,
    sites: <Sites />,
    crew: <Crew />,
    sports: <Sports />,
    settings: <Settings />,
    player: playerSession ? <Player session={playerSession} onClose={closePlayer} /> : null
  };

  const chromeLess = page === 'player' || page === 'home';
  const fullHeight = page === 'player' || page === 'cable';

  const isAndroid = !!window.Capacitor;

  return (
    <AppContext.Provider value={ctx}>
      <PartyProvider showToast={showToast}>
        <div className={`flex flex-col h-screen w-screen bg-bg tv-edge ${isAndroid ? 'tv-mode' : ''}`}>
          <TopNav page={page} setPage={setPage} searchRef={searchRef} />
          <div className="flex flex-1 overflow-hidden">
            <main className={`flex-1 relative ${fullHeight ? 'overflow-hidden' : 'overflow-y-auto'}`}>
              {activeSessions.length > 0 && page !== 'player' && (
                <SessionBanner
                  session={activeSessions[0]}
                  onAction={refreshSessions}
                />
              )}
              {fullHeight ? (
                <div className="h-full animate-fade" key={page}>
                  {pages[page]}
                </div>
              ) : page === 'home' ? (
                <div className="animate-fade" key={page}>
                  {pages[page]}
                </div>
              ) : (
                <div className="px-10 pt-8 pb-16 animate-fade max-w-[1600px] mx-auto" key={page}>
                  {pages[page]}
                </div>
              )}
            </main>
          </div>

          {modalContentId && (
            <ContentModal
              contentId={modalContentId}
              onClose={() => setModalContentId(null)}
            />
          )}

          {partyModalContentId !== null && (
            <WatchPartyModal
              contentId={partyModalContentId}
              onClose={() => setPartyModalContentId(null)}
            />
          )}

          <PartySidebar />

          {toast && (
            <div className="fixed bottom-6 right-6 surface-glass text-white px-5 py-3 rounded-full shadow-lg animate-fade z-[100] font-medium text-sm border border-accent/30">
              {toast}
            </div>
          )}

          {/* First-run tutorial for new crew members */}
          <TutorialOverlay username={activeUser?.username} />
        </div>
      </PartyProvider>
    </AppContext.Provider>
  );
}
