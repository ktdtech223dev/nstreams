import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

const PartyContext = createContext(null);
export const useParty = () => useContext(PartyContext);

export function PartyProvider({ children, showToast }) {
  const [party, setParty] = useState(null);   // current party object
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [playback, setPlayback] = useState({ playing: false, current_time: 0 });
  const [systemLog, setSystemLog] = useState([]);
  const [relayUrl, setRelayUrl] = useState('');

  // Load saved relay URL
  useEffect(() => {
    (async () => {
      if (!window.electron) return;
      const url = (await window.electron.getStore('relay_url')) || '';
      setRelayUrl(url);
      if (url) await window.electron.party.setRelay(url);
    })();
  }, []);

  // Subscribe to party events from main process
  useEffect(() => {
    if (!window.electron?.party) return;
    const offs = [
      window.electron.party.on('connected', ({ party: p }) => {
        setParty(p);
        setMembers(p.members || []);
        setMessages(p.messages || []);
        showToast?.(`Connected to watch party`);
      }),
      window.electron.party.on('state', (p) => {
        setParty(p);
        setMembers(p.members || []);
        setMessages(p.messages || []);
      }),
      window.electron.party.on('presence', (m) => setMembers(m || [])),
      window.electron.party.on('chat', (m) => setMessages(prev => [...prev, m])),
      window.electron.party.on('system', (m) => {
        setSystemLog(prev => [...prev, m]);
        setMessages(prev => [...prev, { id: `sys-${Date.now()}`, system: true, text: m.text, ts: Date.now() }]);
      }),
      window.electron.party.on('reaction', (r) => {
        const id = `r-${Date.now()}-${Math.random()}`;
        setReactions(prev => [...prev, { ...r, id }]);
        setTimeout(() => setReactions(prev => prev.filter(x => x.id !== id)), 2500);
      }),
      window.electron.party.on('playback', (p) => {
        setPlayback({ playing: p.action === 'play', current_time: p.current_time });
      }),
      window.electron.party.on('disconnected', () => {
        setParty(null);
        setMembers([]);
      }),
      window.electron.party.on('ended', () => {
        showToast?.('Watch party ended');
        setParty(null);
        setMembers([]);
      }),
      window.electron.party.on('error', ({ error }) => {
        showToast?.(`Party error: ${error}`);
      })
    ];
    return () => offs.forEach(off => off && off());
  }, [showToast]);

  const updateRelay = useCallback(async (url) => {
    setRelayUrl(url);
    if (window.electron) {
      await window.electron.setStore('relay_url', url);
      await window.electron.party.setRelay(url);
    }
  }, []);

  const createParty = useCallback(async ({ user, content, site }) => {
    if (!relayUrl) throw new Error('Set a Relay URL in Settings first.');
    const p = await window.electron.party.create({
      relay: relayUrl,
      host_id: user.id,
      host_name: user.display_name,
      host_color: user.avatar_color,
      content, site
    });
    return p;
  }, [relayUrl]);

  const joinParty = useCallback(async ({ user, code }) => {
    if (!relayUrl) throw new Error('Set a Relay URL in Settings first.');
    const p = await window.electron.party.join({
      relay: relayUrl,
      party_code_or_id: code,
      user_id: user.id,
      name: user.display_name,
      color: user.avatar_color
    });
    return p;
  }, [relayUrl]);

  const leaveParty = useCallback(async () => {
    if (window.electron) await window.electron.party.leave();
    setParty(null);
    setMembers([]);
    setMessages([]);
  }, []);

  const sendChat = useCallback((text) => {
    if (!text.trim()) return;
    window.electron?.party.chat(text.trim());
  }, []);

  const sendReaction = useCallback((emoji) => {
    window.electron?.party.reaction(emoji);
  }, []);

  const control = useCallback((action, current_time) => {
    window.electron?.party.control(action, current_time);
  }, []);

  return (
    <PartyContext.Provider value={{
      party, members, messages, reactions, playback, systemLog,
      relayUrl, updateRelay,
      createParty, joinParty, leaveParty,
      sendChat, sendReaction, control
    }}>
      {children}
    </PartyContext.Provider>
  );
}
