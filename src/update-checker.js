/**
 * Android self-update — bridge to the native AppUpdater plugin
 * (android/app/src/main/java/com/ngames/nstreams/AppUpdaterPlugin.java).
 *
 * Flow: GitHub latest release → is it newer than the INSTALLED APK? → native
 * download (verifies package, version, and signing key) → native silent
 * PackageInstaller session on Android 12+.
 */
import { registerPlugin } from '@capacitor/core';

const AppUpdater = registerPlugin('AppUpdater');

const REPO_API = 'https://api.github.com/repos/ktdtech223dev/nstreams/releases/latest';
// Version the web bundle was built with — only a fallback; the installed
// APK's versionName (from the native side) is what an update must beat.
const BUILD_VERSION = (import.meta.env.VITE_APP_VERSION || '0.0.0').replace(/^v/, '');

export function semverNewer(latest, current) {
  const p = v => String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const [la, lb, lc] = p(latest);
  const [ca, cb, cc] = p(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

export async function updaterInfo() {
  try { return await AppUpdater.getInfo(); } catch { return null; }
}

export async function installedVersion() {
  const info = await updaterInfo();
  return (info && info.versionName) || BUILD_VERSION;
}

/** Returns {version, downloadUrl, releaseNotes} when a newer APK is published. */
export async function checkForAndroidUpdate() {
  try {
    const res = await fetch(REPO_API, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const release = await res.json();
    const latestVersion = (release.tag_name || '').replace(/^v/, '');
    const current = await installedVersion();
    if (!latestVersion || !semverNewer(latestVersion, current)) return null;

    // The other platform jobs can attach to the release before the Android
    // job finishes — no APK yet just means "check again later".
    const apkAsset = (release.assets || []).find(
      a => a.name.toLowerCase().includes('android') && a.name.endsWith('.apk')
    );
    if (!apkAsset) return null;

    return {
      version: latestVersion,
      downloadUrl: apkAsset.browser_download_url,
      releaseNotes: release.body || '',
    };
  } catch {
    return null; // network issues are silent — never block the app
  }
}

/** Native download + verification. Resolves {path, versionName, versionCode}. */
export async function downloadUpdate(info, onProgress) {
  const sub = onProgress
    ? await AppUpdater.addListener('downloadProgress', e => onProgress(e.percent))
    : null;
  try {
    return await AppUpdater.download({ url: info.downloadUrl, version: info.version });
  } finally {
    sub?.remove();
  }
}

/** Hands the verified APK to PackageInstaller. The app process is replaced on success. */
export function installUpdate(path, { relaunch = false } = {}) {
  return AppUpdater.install({ path, relaunch });
}

export function openInstallSettings() {
  return AppUpdater.openInstallSettings();
}
