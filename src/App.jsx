import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import TopNav from './components/TopNav';
import Home from './pages/Home';
import Watchlist from './pages/Watchlist';
import Browse from './pages/Browse';
import Sites from './pages/Sites';
import Crew from './pages/Crew';
import Settings from './pages/Settings';
import Player from './pages/Player';
import SessionBanner from './components/SessionBanner';
import ContentModal from './components/ContentModal';
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
  }, []);

  useEffect(() => {
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
    sites: <Sites />,
    crew: <Crew />,
    settings: <Settings />,
    player: playerSession ? <Player session={playerSession} onClose={closePlayer} /> : null
  };

  const chromeLess = page === 'player' || page === 'home';

  return (
    <AppContext.Provider value={ctx}>
      <PartyProvider showToast={showToast}>
        <div className="flex flex-col h-screen w-screen bg-bg">
          <TopNav page={page} setPage={setPage} searchRef={searchRef} />
          <div className="flex flex-1 overflow-hidden">
            <main className={`flex-1 relative ${page === 'player' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
              {activeSessions.length > 0 && page !== 'player' && (
                <SessionBanner
                  session={activeSessions[0]}
                  onAction={refreshSessions}
                />
              )}
              {page === 'player' ? (
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
        </div>
      </PartyProvider>
    </AppContext.Provider>
  );
}
