/**
 * Android self-update checker.
 *
 * Fetches the latest GitHub release, compares it to the version baked in
 * at build time, and returns the APK download URL if an update is available.
 */

const REPO_API = 'https://api.github.com/repos/ktdtech223dev/nstreams/releases/latest';
const CURRENT  = (import.meta.env.VITE_APP_VERSION || '0.0.0').replace(/^v/, '');

function semverNewer(latest, current) {
  const p = v => v.replace(/^v/, '').split('.').map(Number);
  const [la, lb, lc] = p(latest);
  const [ca, cb, cc] = p(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

export async function checkForAndroidUpdate() {
  try {
    const res = await fetch(REPO_API, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      // Short timeout — don't block the UI
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const release = await res.json();
    const latestVersion = (release.tag_name || '').replace(/^v/, '');
    if (!latestVersion || !semverNewer(latestVersion, CURRENT)) return null;

    // Find the Android APK asset (named *android*.apk)
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
    return null; // network issues are silent — don't block the app
  }
}
