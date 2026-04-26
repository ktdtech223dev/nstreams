import React, { useEffect, useState } from 'react';
import api, { API_PORT } from '../api';
import { useApp } from '../App';
import { useParty, DEFAULT_RELAY_URL } from '../party/PartyContext';

const IS_ANDROID = typeof window !== 'undefined' && !!window.Capacitor;
const RAILWAY_URL = 'https://nstreams-api-production.up.railway.app/api';

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
    // Client Secret is only required for "Web" app type.
    // "Other" type doesn't issue one — skip the check.
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
        <h1 className="display-lg text-white">Settings</h1>
      </header>

      {/* Cloud sync — shown on Electron (desktop) so you can link to Railway */}
      {!IS_ANDROID && window.electron && <CloudSyncSection showToast={showToast} />}

      {/* TV edge padding — shown on Android projector to fix overscan */}
      {IS_ANDROID && <TvPaddingSection showToast={showToast} />}

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

      <TmdbSection tmdbKey={tmdbKey} setTmdbKey={setTmdbKey} saveKey={saveKey} testTmdb={testTmdb} showToast={showToast} />

      <Section title={`MyAnimeList — ${activeUser?.display_name}`}>
        <div className="bg-bg3 border border-border rounded-lg p-3 mb-4 text-xs text-muted space-y-1">
          <div className="text-white text-sm font-medium mb-1">Before connecting:</div>
          <div>1. Go to <a
            href="https://myanimelist.net/apiconfig"
            onClick={e => { e.preventDefault(); window.electron?.openUrl(e.currentTarget.href); }}
            className="text-accent hover:underline">myanimelist.net/apiconfig</a> → Create ID</div>
          <div>2. <b>App Type:</b> Other <span className="text-gold">(recommended — skips the Client Secret step)</span>, or Web</div>
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
          <div className="text-gold">6. <b>Web type:</b> copy both Client ID AND Client Secret. <b>Other type:</b> just Client ID (no secret is issued).</div>
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

        <label className="text-xs uppercase text-muted">Client Secret <span className="text-muted/60 normal-case">(Web type only — leave blank if Other type)</span></label>
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
        {!malSaved && (
          <div className="text-xs text-red mb-4">
            ⚠ Client ID not saved — Connect MAL will fail.
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
            disabled={!malSaved}
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

      <AdblockSection />

      <CableTvSection />


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

function TmdbSection({ tmdbKey, setTmdbKey, saveKey, testTmdb, showToast }) {
  const [status, setStatus] = useState(null);
  useEffect(() => { api.tmdbStatus().then(setStatus).catch(() => {}); }, [tmdbKey]);

  async function resetToDefault() {
    setTmdbKey('');
    await window.electron.setStore('tmdb_api_key', '');
    showToast('Reverted to N Games crew TMDB key');
    api.tmdbStatus().then(setStatus);
  }

  const onDefault = status?.using_default;

  return (
    <Section title="TMDB">
      <p className="text-muted text-sm mb-4">
        TMDB powers search, Browse, Hero, episode cards and Where to Watch. N Streams ships
        with the N Games crew's shared key — you don't need to do anything unless you want
        to use your own (e.g. for higher rate limits).
      </p>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs uppercase text-muted">API Key</label>
        {onDefault && (
          <span className="text-[10px] bg-accent/20 text-accent2 px-2 py-0.5 rounded-full flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-green rounded-full" />
            N Games crew default
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={tmdbKey}
          onChange={e => setTmdbKey(e.target.value)}
          placeholder={onDefault ? 'Override with your own TMDB v3 key…' : 'Your TMDB v3 API key'}
          className="input flex-1"
        />
        <button onClick={() => saveKey('tmdb_api_key', tmdbKey)} className="btn btn-primary">Save</button>
        <button onClick={testTmdb} className="btn btn-ghost">Test</button>
      </div>
      {!onDefault && (
        <button onClick={resetToDefault} className="text-xs text-accent hover:underline mt-2 inline-block">
          ↺ Reset to N Games crew key
        </button>
      )}
      <a
        href="https://www.themoviedb.org/settings/api"
        onClick={e => { e.preventDefault(); window.electron?.openUrl(e.currentTarget.href); }}
        className="text-xs text-muted hover:text-accent block mt-2"
      >
        Get your own free key at themoviedb.org →
      </a>
    </Section>
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

// Unused — kept for reference, removed from render
// eslint-disable-next-line no-unused-vars
function _UnusedScraperSection() {
  const { showToast } = useApp();
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState('');
  const [status, setStatus] = useState(null);
  const [testing, setTesting] = useState(false);
  const DEFAULT = 'https://api.consumet.org';

  useEffect(() => {
    (async () => {
      if (!window.electron) return;
      const v = await window.electron.getStore('consumet_url');
      setUrl(v || DEFAULT);
      setSaved(v || DEFAULT);
    })();
  }, []);

  async function save() {
    await window.electron.setStore('consumet_url', url.trim());
    setSaved(url.trim());
    await api.clearScrapeCache();
    showToast('Scraper URL saved');
  }

  async function test() {
    setTesting(true);
    try {
      const r = await api.scrapeTest();
      setStatus(`✓ Reachable · ${r.url}`);
    } catch (e) {
      setStatus(`✗ ${e.message}`);
    } finally {
      setTesting(false);
    }
  }

  async function reset() {
    setUrl(DEFAULT);
    await window.electron.setStore('consumet_url', DEFAULT);
    setSaved(DEFAULT);
    await api.clearScrapeCache();
    showToast('Reset to public Consumet');
  }

  const isDefault = saved === DEFAULT;

  return (
    <Section title="Aggregator Scraper (Consumet)">
      <p className="text-muted text-sm mb-4">
        Consumet is an open-source API that scrapes HiAnime, GogoAnime, AnimePahe, FlixHQ,
        FMovies, DramaCool and more. N Streams queries it on every show's Where to Watch tab
        to show direct-play links that bypass DRM. No site-specific maintenance needed on our end.
      </p>
      <div className="bg-bg3 border border-border rounded-lg p-3 mb-4 text-xs text-muted space-y-1">
        <div className="text-white text-sm font-medium mb-1">Deploy your own (recommended):</div>
        <div>1. Fork or clone <a
          href="https://github.com/consumet/api.consumet.org"
          onClick={e => { e.preventDefault(); window.electron?.openUrl(e.currentTarget.href); }}
          className="text-accent hover:underline">consumet/api.consumet.org</a></div>
        <div>2. Deploy to Railway (same way as your relay)</div>
        <div>3. Paste the Railway URL below</div>
        <div className="text-gold mt-2">
          Using the default public API? Rate limits may kick in. Self-hosting is free on Railway and never throttles.
        </div>
      </div>
      <label className="text-xs uppercase text-muted">Consumet URL</label>
      <div className="flex gap-2 mt-1 mb-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder={DEFAULT}
          className="input flex-1"
        />
        <button onClick={save} className="btn btn-primary">Save</button>
        <button onClick={test} disabled={testing || !url} className="btn btn-ghost">
          {testing ? 'Testing…' : 'Test'}
        </button>
      </div>
      {!isDefault && (
        <button onClick={reset} className="text-xs text-accent hover:underline mb-2">
          ↺ Reset to public Consumet
        </button>
      )}
      {status && <div className="text-xs text-muted">{status}</div>}
    </Section>
  );
}


function AdblockSection() {
  const { showToast } = useApp();
  const [status, setStatus] = useState(null);

  useEffect(() => {
    window.electron?.adblockStatus().then(setStatus);
  }, []);

  async function toggle() {
    const r = await window.electron.adblockToggle(!status?.setting);
    setStatus({ enabled: r.enabled, setting: !status?.setting });
    showToast(r.enabled ? 'Ad blocker ON' : 'Ad blocker OFF');
  }

  return (
    <Section title="Ad & Popup Blocking">
      <p className="text-muted text-sm mb-4">
        When you watch on free aggregator sites like Miruro or HiAnime, ads and popups
        can overwhelm the embedded viewer (unlike your browser, you can't alt-tab to a new
        tab to deal with them). N Streams ships with EasyList + EasyPrivacy filters applied
        to the viewer session, plus a popup blocker that refuses every new-window attempt.
      </p>
      <div className="flex items-center justify-between bg-bg3 border border-border rounded-lg p-3">
        <div>
          <div className="text-white font-medium">Block ads, trackers, and popups</div>
          <div className="text-xs text-muted">
            {status?.enabled
              ? '✓ Active in viewer + main window'
              : status?.setting === false
              ? 'Disabled'
              : 'Initializing…'}
          </div>
        </div>
        <button
          onClick={toggle}
          className={`relative w-12 h-6 rounded-full transition ${
            status?.setting ? 'bg-accent' : 'bg-bg4'
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${
              status?.setting ? 'left-6' : 'left-0.5'
            }`}
          />
        </button>
      </div>
      <div className="text-xs text-muted mt-3">
        If a site isn't loading correctly, try toggling this off temporarily.
      </div>
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

function CableTvSection() {
  const [city, setCity] = React.useState('');
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    window.electron?.getStore('cable_location')
      .then(v => { if (v) setCity(v); })
      .catch(() => {});
  }, []);

  function save() {
    window.electron?.setStore('cable_location', city.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Section title="Cable TV">
      <p className="text-muted text-sm mb-4">
        Set your city to show local news stations in the Cable tab.
        Use a major city name — e.g. <span className="text-white">Austin</span>, <span className="text-white">Houston</span>, <span className="text-white">Dallas</span>.
      </p>
      <div className="flex gap-3 items-center">
        <input
          type="text"
          value={city}
          onChange={e => { setCity(e.target.value); setSaved(false); }}
          onKeyDown={e => e.key === 'Enter' && save()}
          placeholder="Your city (e.g. Austin)"
          className="bg-bg3 border border-border text-white rounded-lg px-4 py-2 text-sm flex-1 max-w-xs outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          onClick={save}
          className="btn btn-primary text-sm"
        >
          {saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
    </Section>
  );
}

// ── Cloud Sync (Electron only) ────────────────────────────────────────────────
function CloudSyncSection({ showToast }) {
  const current = localStorage.getItem('nstreams_cloud_url');
  const [url, setUrl] = useState(current || RAILWAY_URL);
  const [status, setStatus] = useState(null); // 'migrating' | 'done' | 'error'
  const [statusMsg, setStatusMsg] = useState('');
  const isCloud = !!current;

  // Migrate local → cloud, then flip the URL and reload.
  // This is the ONLY way to enable cloud sync so no data is ever lost.
  async function enableCloud() {
    const cloudUrl = url.trim().replace(/\/$/, '');
    setStatus('migrating');
    setStatusMsg('Exporting local data…');
    try {
      // 1. Pull everything from the local Electron server
      const exportRes = await fetch(`http://localhost:${API_PORT}/api/migrate/export`);
      if (!exportRes.ok) throw new Error('Could not read local database');
      const exportData = await exportRes.json();

      const counts = {
        content:  exportData.content?.length  || 0,
        watchlist: exportData.watchlist?.length || 0,
        progress: exportData.episodeProgress?.length || 0,
        activity: exportData.activityFeed?.length || 0,
      };
      setStatusMsg(`Pushing ${counts.content} shows, ${counts.watchlist} watchlist entries…`);

      // 2. Push to Railway
      const importRes = await fetch(`${cloudUrl}/migrate/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exportData),
      });
      if (!importRes.ok) throw new Error(`Server returned ${importRes.status}`);
      const result = await importRes.json();
      if (!result.ok) throw new Error(result.error || 'Import failed');

      const { imported } = result;
      setStatusMsg(
        `✓ Migrated ${imported.content} shows · ${imported.watchlist} watchlist entries · ${imported.episodeProgress} progress records · ${imported.activity} activity items`
      );
      setStatus('done');

      // 3. Switch to cloud and reload
      localStorage.setItem('nstreams_cloud_url', cloudUrl);
      setTimeout(() => window.location.reload(), 1800);
    } catch (e) {
      setStatus('error');
      setStatusMsg(`Error: ${e.message}`);
    }
  }

  // Already on cloud — push any new local data that accumulated (e.g. offline use)
  async function pushToCloud() {
    setStatus('migrating');
    setStatusMsg('Syncing local data to cloud…');
    try {
      const exportRes = await fetch(`http://localhost:${API_PORT}/api/migrate/export`);
      if (!exportRes.ok) throw new Error('Could not read local database');
      const exportData = await exportRes.json();

      const importRes = await fetch(`${current.replace(/\/$/, '')}/migrate/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exportData),
      });
      const result = await importRes.json();
      if (!result.ok) throw new Error(result.error || 'Import failed');

      const { imported } = result;
      setStatusMsg(`✓ Pushed ${imported.content} shows · ${imported.watchlist} watchlist · ${imported.episodeProgress} progress records`);
      setStatus('done');
      showToast('Local data pushed to cloud ✓');
    } catch (e) {
      setStatus('error');
      setStatusMsg(`Error: ${e.message}`);
    }
  }

  function disableCloud() {
    localStorage.removeItem('nstreams_cloud_url');
    showToast('Switched to local — reloading…');
    setTimeout(() => window.location.reload(), 900);
  }

  const isBusy = status === 'migrating';

  return (
    <Section title="☁ Cloud Sync">
      {/* Status badge */}
      <div className={`rounded-lg p-3 mb-4 border flex items-center gap-3 ${isCloud ? 'bg-green/10 border-green/30' : 'bg-bg3 border-border'}`}>
        <span className={`w-3 h-3 rounded-full shrink-0 ${isCloud ? 'bg-green' : 'bg-muted'}`} />
        <div>
          <div className={`font-medium text-sm ${isCloud ? 'text-green' : 'text-muted'}`}>
            {isCloud
              ? 'Cloud sync active — PC and projector share one database'
              : 'Local only — data stays on this machine'}
          </div>
          {isCloud && <div className="text-xs text-muted font-mono truncate mt-0.5">{current}</div>}
        </div>
      </div>

      <p className="text-muted text-sm mb-4">
        {isCloud
          ? 'Any watch activity on the PC or projector is instantly visible on both. To sync data you added while offline, use "Push Local → Cloud" below.'
          : 'Enable to sync your full watch history to Railway. Your local data is uploaded first — nothing is lost.'}
      </p>

      {/* Cloud URL input (only relevant when not yet on cloud) */}
      {!isCloud && (
        <>
          <label className="text-xs uppercase text-muted">Cloud API URL</label>
          <div className="flex gap-2 mt-1 mb-4">
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder={RAILWAY_URL} className="input flex-1" />
          </div>
        </>
      )}

      {/* Progress / result message */}
      {statusMsg && (
        <div className={`text-sm rounded-lg px-4 py-3 mb-4 ${
          status === 'error' ? 'bg-red/10 text-red border border-red/30' :
          status === 'done'  ? 'bg-green/10 text-green border border-green/30' :
          'bg-accent/10 text-accent border border-accent/30'
        }`}>
          {isBusy && <span className="mr-2 inline-block animate-spin">⟳</span>}
          {statusMsg}
          {status === 'done' && !isCloud && <span className="ml-2 text-muted text-xs">Reloading…</span>}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {!isCloud ? (
          <button onClick={enableCloud} disabled={isBusy} className="btn btn-primary disabled:opacity-50">
            {isBusy ? 'Uploading…' : '⚡ Upload My Data & Enable Cloud Sync'}
          </button>
        ) : (
          <>
            <button onClick={pushToCloud} disabled={isBusy} className="btn btn-ghost disabled:opacity-50">
              {isBusy ? 'Syncing…' : '↑ Push Local → Cloud'}
            </button>
            <button onClick={disableCloud} disabled={isBusy} className="btn btn-ghost disabled:opacity-50">
              Use Local Only
            </button>
          </>
        )}
      </div>
    </Section>
  );
}

// ── TV Edge Padding (Android only) ────────────────────────────────────────────
function TvPaddingSection({ showToast }) {
  const [padding, setPadding] = useState(0);

  useEffect(() => {
    import('@capacitor/preferences').then(({ Preferences }) => {
      Preferences.get({ key: 'tv_edge_padding' }).then(({ value }) => {
        const v = parseInt(value) || 0;
        setPadding(v);
      });
    });
  }, []);

  async function save(val) {
    const px = Math.max(0, Math.min(80, val));
    setPadding(px);
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: 'tv_edge_padding', value: String(px) });
    document.documentElement.style.setProperty('--tv-edge', `${px}px`);
    showToast(`Edge padding: ${px}px`);
  }

  return (
    <Section title="📺 Projector Display">
      <p className="text-muted text-sm mb-4">
        If your projector clips the edges of the image (overscan), increase the edge padding until all content is visible.
      </p>
      <div className="flex items-center gap-4">
        <input
          type="range" min={0} max={80} step={4} value={padding}
          onChange={e => save(parseInt(e.target.value))}
          className="flex-1 accent-accent"
        />
        <span className="text-white font-mono w-16 text-center">{padding}px</span>
      </div>
      <div className="flex gap-3 mt-3">
        {[0, 16, 24, 32, 48].map(v => (
          <button key={v} onClick={() => save(v)}
            className={`btn text-xs ${padding === v ? 'btn-primary' : 'btn-ghost'}`}
          >{v}px</button>
        ))}
      </div>
      <p className="text-xs text-muted mt-3">Changes apply immediately — no restart needed.</p>
    </Section>
  );
}

function Section({ title, children }) {
  return (
    <section className="surface rounded-2xl p-6">
      <h2 className="display-sm text-white mb-4">{title}</h2>
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
