import React, { useEffect, useState } from 'react';
import api from '../api';
import { useApp } from '../App';
import { useParty, DEFAULT_RELAY_URL } from '../party/PartyContext';

export default function Settings() {
  const { users, activeUserId, switchUser, showToast, activeUser } = useApp();
  const [tmdbKey, setTmdbKey] = useState('');
  const [malClientId, setMalClientId] = useState('');
  const [malClientSecret, setMalClientSecret] = useState('');
  const [alClientId, setAlClientId] = useState('');
  const [malSaved, setMalSaved] = useState('');
  const [malSecretSaved, setMalSecretSaved] = useState('');
  const [alSaved, setAlSaved] = useState('');
  const [sync, setSync] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [redirectUris, setRedirectUris] = useState({ mal: '', anilist: '' });

  useEffect(() => {
    (async () => {
      if (window.electron) {
        setTmdbKey((await window.electron.getStore('tmdb_api_key')) || '');
        const mid = (await window.electron.getStore('mal_client_id')) || '';
        setMalClientId(mid); setMalSaved(mid);
        const msec = (await window.electron.getStore('mal_client_secret')) || '';
        setMalClientSecret(msec); setMalSecretSaved(msec);
        const aid = (await window.electron.getStore('anilist_client_id')) || '';
        setAlClientId(aid); setAlSaved(aid);
      }
    })();
  }, []);

  useEffect(() => {
    if (activeUserId) {
      api.syncStatus(activeUserId).then(setSync).catch(() => {});
    }
    api.redirectUris().then(setRedirectUris).catch(() => {});
  }, [activeUserId]);

  function copy(val) {
    navigator.clipboard.writeText(val);
    showToast('Copied ✓');
  }

  async function saveKey(key, val) {
    if (window.electron) {
      await window.electron.setStore(key, val);
      if (key === 'mal_client_id') setMalSaved(val);
      if (key === 'mal_client_secret') setMalSecretSaved(val);
      if (key === 'anilist_client_id') setAlSaved(val);
      showToast('Saved ✓');
    }
  }

  async function testTmdb() {
    try {
      await api.search('test');
      showToast('TMDB OK ✓');
    } catch (e) {
      showToast('TMDB failed: ' + e.message);
    }
  }

  async function connectMal() {
    if (!malSaved || !malSaved.trim()) {
      showToast('Paste your MAL Client ID above and click Save first');
      return;
    }
    if (!malSecretSaved || !malSecretSaved.trim()) {
      showToast('MAL also requires a Client Secret. Save it above first.');
      return;
    }
    try {
      showToast('Opening MAL in your browser — approve, then come back');
      const r = await api.malConnect(activeUserId);
      setSync(await api.syncStatus(activeUserId));
      showToast(`Connected as ${r.profile.name} ✓`);
    } catch (e) {
      showToast(e.message.replace(/^[A-Z_]+:\s*/, ''));
    }
  }

  async function connectAnilist() {
    if (!alSaved || !alSaved.trim()) {
      showToast('Paste your AniList Client ID above and click Save first');
      return;
    }
    try {
      showToast('Opening AniList in your browser — approve, then come back');
      const r = await api.anilistConnect(activeUserId);
      setSync(await api.syncStatus(activeUserId));
      showToast(`Connected as ${r.profile.name} ✓`);
    } catch (e) {
      showToast(e.message.replace(/^[A-Z_]+:\s*/, ''));
    }
  }

  async function syncNow(service) {
    setSyncing(true);
    try {
      const r = service === 'mal'
        ? await api.malSync(activeUserId)
        : await api.anilistSync(activeUserId);
      showToast(`Imported ${r.imported}, updated ${r.updated}`);
      setSync(await api.syncStatus(activeUserId));
    } catch (e) {
      showToast('Sync failed: ' + e.message);
    } finally {
      setSyncing(false);
    }
  }

  async function syncAll() {
    setSyncing(true);
    try {
      if (sync?.mal?.connected) await api.malSync(activeUserId);
      if (sync?.anilist?.connected) await api.anilistSync(activeUserId);
      setSync(await api.syncStatus(activeUserId));
      showToast('Synced all ✓');
    } catch (e) {
      showToast('Failed: ' + e.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <header>
        <h1 className="font-display text-5xl text-white tracking-wide">Settings</h1>
      </header>

      <Section title="Active User">
        <p className="text-muted text-sm mb-4">Who are you on this machine?</p>
        <div className="grid grid-cols-4 gap-3">
          {users.map(u => (
            <button
              key={u.id}
              onClick={() => switchUser(u.id)}
              className={`p-4 rounded-xl border transition ${
                activeUserId === u.id
                  ? 'border-accent bg-accent/10 glow'
                  : 'border-border bg-bg3 hover:bg-bg4'
              }`}
            >
              <div
                className="w-16 h-16 rounded-full mx-auto flex items-center justify-center text-2xl font-bold text-white"
                style={{ background: u.avatar_color }}
              >
                {u.display_name[0]}
              </div>
              <div className="text-white font-medium mt-2">{u.display_name}</div>
              <div className="text-xs text-muted">@{u.username}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="TMDB">
        <label className="text-xs uppercase text-muted">API Key</label>
        <div className="flex gap-2 mt-1">
          <input
            type="password"
            value={tmdbKey}
            onChange={e => setTmdbKey(e.target.value)}
            placeholder="Your TMDB v3 API key"
            className="input flex-1"
          />
          <button onClick={() => saveKey('tmdb_api_key', tmdbKey)} className="btn btn-primary">Save</button>
          <button onClick={testTmdb} className="btn btn-ghost">Test</button>
        </div>
        <a
          href="https://www.themoviedb.org/settings/api"
          onClick={e => { e.preventDefault(); window.electron?.openUrl(e.currentTarget.href); }}
          className="text-xs text-accent hover:underline mt-2 inline-block"
        >
          Get a free key at themoviedb.org →
        </a>
      </Section>

      <Section title={`MyAnimeList — ${activeUser?.display_name}`}>
        <div className="bg-bg3 border border-border rounded-lg p-3 mb-4 text-xs text-muted space-y-1">
          <div className="text-white text-sm font-medium mb-1">Before connecting:</div>
          <div>1. Go to <a
            href="https://myanimelist.net/apiconfig"
            onClick={e => { e.preventDefault(); window.electron?.openUrl(e.currentTarget.href); }}
            className="text-accent hover:underline">myanimelist.net/apiconfig</a> → Create ID</div>
          <div>2. <b>App Type:</b> Web</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span>3.</span><b>App Redirect URL:</b>
            <code className="text-accent bg-bg4 px-1.5 py-0.5 rounded select-text">{redirectUris.mal || 'http://localhost:57835/mal-callback'}</code>
            <button
              onClick={() => copy(redirectUris.mal || 'http://localhost:57835/mal-callback')}
              className="text-[10px] bg-accent text-white px-2 py-0.5 rounded hover:bg-accent3"
            >
              Copy
            </button>
          </div>
          <div>4. <b>Homepage URL:</b> anything (e.g. <code className="text-accent bg-bg4 px-1 py-0.5 rounded">https://github.com/ktdtech223dev/nstreams</code>)</div>
          <div>5. Fill the rest however (name "N Streams", description anything). Submit.</div>
          <div className="text-gold">6. MAL requires <b>BOTH</b> Client ID and Client Secret — copy both from your app page.</div>
        </div>

        <label className="text-xs uppercase text-muted">Client ID</label>
        <div className="flex gap-2 mt-1 mb-2">
          <input
            value={malClientId}
            onChange={e => setMalClientId(e.target.value)}
            placeholder="Paste MAL Client ID here"
            className="input flex-1"
          />
          <button onClick={() => saveKey('mal_client_id', malClientId)} className="btn btn-primary">
            {malSaved && malSaved === malClientId ? '✓ Saved' : 'Save'}
          </button>
        </div>

        <label className="text-xs uppercase text-muted">Client Secret</label>
        <div className="flex gap-2 mt-1 mb-2">
          <input
            type="password"
            value={malClientSecret}
            onChange={e => setMalClientSecret(e.target.value)}
            placeholder="Paste MAL Client Secret here"
            className="input flex-1"
          />
          <button onClick={() => saveKey('mal_client_secret', malClientSecret)} className="btn btn-primary">
            {malSecretSaved && malSecretSaved === malClientSecret ? '✓ Saved' : 'Save'}
          </button>
        </div>
        {(!malSaved || !malSecretSaved) && (
          <div className="text-xs text-red mb-4">
            ⚠ {!malSaved && 'Client ID'}{!malSaved && !malSecretSaved && ' + '}{!malSecretSaved && 'Client Secret'} not saved — Connect MAL will fail.
          </div>
        )}

        {sync?.mal?.connected ? (
          <div className="bg-bg3 p-4 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 bg-green rounded-full" />
              <span className="text-white">Connected as <b>{sync.mal.username}</b></span>
            </div>
            <div className="text-xs text-muted mb-3">
              Last sync: {sync.mal.last_sync ? new Date(sync.mal.last_sync).toLocaleString() : 'never'}
            </div>
            <button onClick={() => syncNow('mal')} disabled={syncing} className="btn btn-primary">
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        ) : (
          <button
            onClick={connectMal}
            disabled={!malSaved || !malSecretSaved}
            className="btn btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Connect MAL
          </button>
        )}
      </Section>

      <Section title={`AniList — ${activeUser?.display_name}`}>
        <div className="bg-bg3 border border-border rounded-lg p-3 mb-4 text-xs text-muted space-y-1">
          <div className="text-white text-sm font-medium mb-1">Before connecting:</div>
          <div>1. Go to <a
            href="https://anilist.co/settings/developer"
            onClick={e => { e.preventDefault(); window.electron?.openUrl(e.currentTarget.href); }}
            className="text-accent hover:underline">anilist.co/settings/developer</a> → Create New Client</div>
          <div>2. <b>Name:</b> N Streams</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span>3.</span><b>Redirect URL:</b>
            <code className="text-accent bg-bg4 px-1.5 py-0.5 rounded select-text">{redirectUris.anilist || 'http://localhost:57836/anilist-callback'}</code>
            <button
              onClick={() => copy(redirectUris.anilist || 'http://localhost:57836/anilist-callback')}
              className="text-[10px] bg-accent text-white px-2 py-0.5 rounded hover:bg-accent3"
            >
              Copy
            </button>
          </div>
          <div>4. Save. Copy the <b>ID</b> (a number) from the resulting client and paste below.</div>
        </div>

        <label className="text-xs uppercase text-muted">Client ID</label>
        <div className="flex gap-2 mt-1 mb-2">
          <input
            value={alClientId}
            onChange={e => setAlClientId(e.target.value)}
            placeholder="Paste AniList Client ID (numeric)"
            className="input flex-1"
          />
          <button onClick={() => saveKey('anilist_client_id', alClientId)} className="btn btn-primary">
            {alSaved && alSaved === alClientId ? '✓ Saved' : 'Save'}
          </button>
        </div>
        {!alSaved && (
          <div className="text-xs text-red mb-4">
            ⚠ No Client ID saved — Connect AniList will not work.
          </div>
        )}

        {sync?.anilist?.connected ? (
          <div className="bg-bg3 p-4 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 bg-green rounded-full" />
              <span className="text-white">Connected</span>
            </div>
            <div className="text-xs text-muted mb-3">
              Last sync: {sync.anilist.last_sync ? new Date(sync.anilist.last_sync).toLocaleString() : 'never'}
            </div>
            <button onClick={() => syncNow('anilist')} disabled={syncing} className="btn btn-primary">
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        ) : (
          <button
            onClick={connectAnilist}
            disabled={!alSaved}
            className="btn btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Connect AniList
          </button>
        )}
      </Section>

      <AboutSection />

      <WatchPartySection />

      <LinkedAccountsSection />

      <Section title="Sync Status">
        {sync && (
          <div className="space-y-2">
            <StatusRow label="MAL" s={sync.mal} />
            <StatusRow label="AniList" s={sync.anilist} />
          </div>
        )}
        <button onClick={syncAll} disabled={syncing} className="btn btn-primary mt-4">
          {syncing ? 'Syncing...' : 'Sync All Now'}
        </button>
      </Section>
    </div>
  );
}

function AboutSection() {
  const { showToast } = useApp();
  const [info, setInfo] = useState(null);
  const [update, setUpdate] = useState(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (window.electron?.getAppInfo) {
      window.electron.getAppInfo().then(setInfo);
    }
    if (window.electron?.onUpdateProgress) {
      return window.electron.onUpdateProgress((data) => {
        setProgress(data);
        if (data.event === 'installing') {
          showToast('Restarting to install update…');
        }
      });
    }
  }, []);

  async function installNow() {
    if (!update?.downloadUrl) return;
    setInstalling(true);
    try {
      await window.electron.installUpdate({ downloadUrl: update.downloadUrl });
    } catch (e) {
      showToast('Install failed: ' + e.message);
      setInstalling(false);
    }
  }

  async function check() {
    setChecking(true);
    setUpdate(null);
    try {
      const r = await window.electron.checkForUpdates();
      if (r.error) {
        showToast('Update check failed: ' + r.error);
      } else {
        setUpdate(r);
        if (!r.hasUpdate) showToast('You\'re on the latest version ✓');
      }
    } finally {
      setChecking(false);
    }
  }

  function downloadUpdate() {
    if (update?.downloadUrl) window.electron.openUrl(update.downloadUrl);
  }

  return (
    <Section title="About & Updates">
      <div className="grid grid-cols-2 gap-3 text-sm mb-4">
        <InfoRow label="Version" value={info?.version || '—'} />
        <InfoRow label="API Port" value={info?.apiPort || '—'} />
        <InfoRow label="Platform" value={info ? `${info.platform} ${info.arch}` : '—'} />
        <InfoRow
          label="Your Data"
          value={
            <button
              onClick={() => window.electron?.openUserDataFolder()}
              className="text-accent hover:underline text-left truncate"
              title={info?.userDataPath}
            >
              Open folder
            </button>
          }
        />
      </div>

      <div className="bg-bg3 border border-border rounded-lg p-3 mb-4 text-xs text-muted">
        <div className="text-white text-sm font-medium mb-1">Your data persists across updates.</div>
        Watchlist, settings, API keys, MAL/AniList tokens, and streaming-service logins
        are saved under <code className="text-accent">{info?.userDataPath || '%APPDATA%/N Streams/'}</code>.
        Replacing the portable exe with a newer version keeps everything intact.
      </div>

      <div className="flex gap-2 items-center mb-3">
        <button onClick={check} disabled={checking} className="btn btn-primary disabled:opacity-50">
          {checking ? 'Checking…' : '⟳ Check for Updates'}
        </button>
        {update && (
          <span className={`text-sm ${update.hasUpdate ? 'text-gold' : 'text-muted'}`}>
            {update.hasUpdate
              ? `New: v${update.latest} (you're on v${update.current})`
              : `Up to date · v${update.current}`}
          </span>
        )}
      </div>

      {update?.hasUpdate && (
        <div className="bg-gold/10 border border-gold/40 rounded-lg p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="text-white font-medium">{update.name || `Version ${update.latest}`}</div>
              <div className="text-xs text-muted">
                Published {new Date(update.publishedAt).toLocaleDateString()}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={installNow}
                disabled={installing}
                className="btn btn-primary disabled:opacity-60"
              >
                {installing
                  ? (progress?.event === 'progress'
                      ? `Downloading ${progress.percent || 0}%`
                      : progress?.event === 'installing'
                      ? 'Installing…'
                      : 'Preparing…')
                  : '⚡ Install Now'}
              </button>
              <button onClick={downloadUpdate} className="btn btn-ghost" title="Download manually instead">
                ↓
              </button>
            </div>
          </div>
          {installing && progress?.event === 'progress' && progress.total > 0 && (
            <div className="h-1.5 bg-bg4 rounded-full overflow-hidden mt-2 mb-3">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${progress.percent || 0}%` }}
              />
            </div>
          )}
          {update.notes && (
            <pre className="text-xs text-muted whitespace-pre-wrap max-h-40 overflow-y-auto bg-bg4 rounded p-2 mt-2">
              {update.notes}
            </pre>
          )}
          <div className="text-xs text-muted mt-3">
            "Install Now" downloads, swaps the exe, and relaunches automatically.
            Your data persists.
          </div>
        </div>
      )}
    </Section>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <div className="text-xs text-muted uppercase tracking-wider">{label}</div>
      <div className="text-white mt-0.5">{value}</div>
    </div>
  );
}

function WatchPartySection() {
  const { relayUrl, updateRelay, party, leaveParty } = useParty();
  const { showToast, activeUser } = useApp();
  const [draft, setDraft] = useState(relayUrl);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => { setDraft(relayUrl); }, [relayUrl]);

  async function save() {
    await updateRelay(draft.trim());
    showToast('Relay URL saved');
  }

  async function test() {
    if (!draft) return;
    setTesting(true);
    setStatus(null);
    try {
      const res = await fetch(draft.trim().replace(/\/$/, '') + '/');
      const j = await res.json();
      if (j.ok) setStatus('✓ Relay reachable');
      else setStatus('? Unexpected response');
    } catch (e) {
      setStatus(`✗ ${e.message}`);
    } finally {
      setTesting(false);
    }
  }

  const isDefault = (draft || relayUrl) === DEFAULT_RELAY_URL;

  async function resetToDefault() {
    setDraft(DEFAULT_RELAY_URL);
    await updateRelay(DEFAULT_RELAY_URL);
    showToast('Reset to N Games crew relay');
  }

  return (
    <Section title="Watch Party — Relay">
      <p className="text-muted text-sm mb-4">
        The relay shuttles chat, reactions and play/pause events between everyone in a party.
        N Streams ships pre-configured with the N Games crew's relay — you don't need to do anything.
      </p>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs uppercase text-muted">Relay URL</label>
        {isDefault && (
          <span className="text-[10px] bg-accent/20 text-accent2 px-2 py-0.5 rounded-full flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-green rounded-full" />
            N Games crew default
          </span>
        )}
      </div>
      <div className="flex gap-2 mt-1 mb-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="https://nstreams-relay-production.up.railway.app"
          className="input flex-1"
        />
        <button onClick={save} className="btn btn-primary">Save</button>
        <button onClick={test} disabled={testing || !draft} className="btn btn-ghost">
          {testing ? 'Testing…' : 'Test'}
        </button>
      </div>
      {!isDefault && (
        <button onClick={resetToDefault} className="text-xs text-accent hover:underline mb-2">
          ↺ Reset to N Games crew relay
        </button>
      )}
      {status && <div className="text-xs text-muted mb-3">{status}</div>}

      {party ? (
        <div className="bg-bg3 p-4 rounded-lg">
          <div className="font-medium text-white mb-1">
            Currently in party <span className="font-mono text-accent">{party.code}</span>
          </div>
          <div className="text-xs text-muted mb-3">
            {party.content?.title || 'No title'} · {party.members?.length || 0} watching
          </div>
          <button onClick={leaveParty} className="btn btn-ghost text-sm">Leave party</button>
        </div>
      ) : (
        <p className="text-xs text-muted">
          No active party. Start one from any show's Watch Together button.
        </p>
      )}
    </Section>
  );
}

function LinkedAccountsSection() {
  const { showToast } = useApp();
  const [sites, setSites] = useState([]);
  const [linked, setLinked] = useState({});
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const all = await api.linkableSites();
      setSites(all);
      if (window.electron?.viewerLinkedDomains) {
        const domains = all.map(s => {
          try { return new URL(s.url).hostname.replace(/^www\./, ''); }
          catch { return null; }
        }).filter(Boolean);
        const result = await window.electron.viewerLinkedDomains(domains);
        setLinked(result);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function signIn(site) {
    if (!window.electron?.watchInApp) {
      showToast('In-app viewer only works inside the Electron app');
      return;
    }
    await window.electron.watchInApp({
      url: site.login_url,
      title: `Sign in to ${site.name}`
    });
    showToast(`Opened ${site.name} — sign in and close the window when done`);
    // Refresh linked state after a delay
    setTimeout(load, 3000);
  }

  async function signOut(site) {
    try {
      const domain = new URL(site.url).hostname.replace(/^www\./, '');
      const r = await window.electron.clearViewerDomain(domain);
      showToast(`Cleared ${r.cleared} cookies for ${site.name}`);
      load();
    } catch (e) {
      showToast('Failed: ' + e.message);
    }
  }

  async function clearAll() {
    if (!confirm('Sign out of ALL services inside N Streams viewer?')) return;
    await window.electron.clearViewerSession();
    showToast('Cleared all viewer data');
    load();
  }

  const linkable = sites.filter(s => s.supported);

  return (
    <Section title="Linked Accounts (In-App Viewer)">
      <p className="text-muted text-sm mb-4">
        Sign in to a service once — N Streams remembers your login so you can click
        "Watch in app" from any show and jump straight in. Cookies are stored in a
        persistent session isolated from your system browser.
      </p>
      <div className="bg-gold/10 border border-gold/30 text-gold text-xs p-3 rounded-lg mb-4">
        ⚠ Services that use Widevine DRM (Netflix, Hulu, Disney+, Max, Prime, etc.)
        may not play video inside the embedded viewer without a signed Electron
        build. Sign-in works; playback will fall back to "Open externally" if it fails.
      </div>

      {loading ? (
        <div className="text-muted text-sm">Loading…</div>
      ) : (
        <div className="space-y-2">
          {linkable.map(s => {
            let domain = '';
            try { domain = new URL(s.url).hostname.replace(/^www\./, ''); } catch {}
            const isLinked = linked[domain];
            return (
              <div key={s.id} className="bg-bg3 border border-border rounded-lg p-3 flex items-center gap-3">
                <img
                  src={s.logo_url || `https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
                  className="w-8 h-8 rounded shrink-0"
                  alt=""
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white flex items-center gap-2">
                    {s.name}
                    {s.requires_drm && (
                      <span className="text-[10px] bg-gold/20 text-gold px-1.5 py-0.5 rounded">DRM</span>
                    )}
                    {isLinked && (
                      <span className="text-[10px] bg-green/20 text-green px-1.5 py-0.5 rounded flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-green rounded-full" />
                        Signed in
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted truncate">{domain}</div>
                </div>
                {isLinked ? (
                  <button onClick={() => signOut(s)} className="btn btn-ghost text-xs py-1.5">
                    Sign out
                  </button>
                ) : (
                  <button onClick={() => signIn(s)} className="btn btn-primary text-xs py-1.5">
                    Sign in
                  </button>
                )}
              </div>
            );
          })}
          {linkable.length === 0 && (
            <div className="text-muted text-sm">
              No supported services in your catalog. Add one from the Sites page.
            </div>
          )}
        </div>
      )}
      <button onClick={clearAll} className="btn btn-ghost text-sm mt-4">
        Sign out of everything
      </button>
    </Section>
  );
}

function Section({ title, children }) {
  return (
    <section className="bg-bg2 rounded-xl p-6 border border-border">
      <h2 className="font-display text-2xl text-white mb-4 tracking-wide">{title}</h2>
      {children}
    </section>
  );
}

function StatusRow({ label, s }) {
  return (
    <div className="flex items-center justify-between bg-bg3 px-4 py-2 rounded-lg">
      <span className="text-white font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${s.connected ? 'bg-green' : 'bg-muted'}`} />
        <span className="text-sm text-muted">
          {s.connected ? (s.last_sync ? new Date(s.last_sync).toLocaleString() : 'connected') : 'Not connected'}
        </span>
      </div>
    </div>
  );
}
