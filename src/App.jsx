import React, { useState, useEffect, createContext, useContext } from 'react';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import Home from './pages/Home';
import Watchlist from './pages/Watchlist';
import Browse from './pages/Browse';
import Sites from './pages/Sites';
import Crew from './pages/Crew';
import Settings from './pages/Settings';
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
  const [activeSessions, setActiveSessions] = useState([]);
  const [toast, setToast] = useState(null);

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

  const ctx = {
    users, activeUserId, activeUser, switchUser,
    openContent: (id) => setModalContentId(id),
    closeContent: () => setModalContentId(null),
    openWatchParty: (id) => setPartyModalContentId(id),
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
    settings: <Settings />
  };

  return (
    <AppContext.Provider value={ctx}>
      <PartyProvider showToast={showToast}>
        <div className="flex flex-col h-screen w-screen bg-bg">
          <TitleBar />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar page={page} setPage={setPage} />
            <main className="flex-1 overflow-y-auto relative">
              {activeSessions.length > 0 && (
                <SessionBanner
                  session={activeSessions[0]}
                  onAction={refreshSessions}
                />
              )}
              <div className="p-8 animate-fade" key={page}>
                {pages[page]}
              </div>
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
            <div className="fixed bottom-6 right-6 bg-accent text-white px-4 py-3 rounded-lg shadow-2xl animate-fade z-50">
              {toast}
            </div>
          )}
        </div>
      </PartyProvider>
    </AppContext.Provider>
  );
}
