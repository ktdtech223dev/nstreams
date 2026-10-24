# N Streams on Android (projector, Quest, phones)

The Android build is a Capacitor app. It's sideloaded once over adb; after that
**it updates itself** — no computer needed.

## How updates work

1. On launch, on resume (if >1h since last check) and every 6h while running,
   the app asks GitHub for the latest release.
2. If it's newer than the **installed** APK, it downloads
   `N-Streams-vX.Y.Z-android.apk` in the background.
3. The native `AppUpdater` plugin refuses the file unless it is this package,
   a strictly higher `versionCode`, and signed by the **same key** as the
   installed copy.
4. It installs the next time you leave the app (Home, sleep, another app) —
   **not** when Play hands an episode to the browser, so it never interrupts
   playback. "Update now" (banner, or Settings → App Updates) installs
   immediately.

On **Android 12+** the install is silent: the app holds
`REQUEST_INSTALL_PACKAGES` and declares `UPDATE_PACKAGES_WITHOUT_USER_ACTION`,
and the platform lets an app update itself with no dialog. Below 12 you get the
system "Update this app?" prompt — one press on the remote.

## First install (once per device)

```bash
adb connect <device-ip>:5555
adb install N-Streams-vX.Y.Z-android.apk
# Lets the app install its own updates without a Settings detour:
adb shell appops set com.ngames.nstreams REQUEST_INSTALL_PACKAGES allow
```

Without the `appops` line the app still works; the first update will ask you
to allow "Install unknown apps" for N Streams once (Settings → App Updates →
Allow).

**Upgrading from v1.3.9 or older:** uninstall first. Those APKs were signed
with throwaway per-build debug keys, so nothing can install over them:

```bash
adb uninstall com.ngames.nstreams
```

## The signing key — back it up

Every APK is signed with one permanent key:

- local: `~/.nstreams-signing/nstreams-release.jks` (+ `keystore.properties`)
- CI: GitHub secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`

**If this key is lost, no installed copy can ever be updated again** — every
device would need an uninstall + reinstall (losing local settings). Keep a copy
of `~/.nstreams-signing/` somewhere safe that isn't this computer.

CI fails the build if the APK's certificate doesn't match
[`release-cert.sha256`](release-cert.sha256), so a wrong key can't be shipped
by accident. Only change that file if you are deliberately rotating keys (and
accept that every device must reinstall).

## Versioning

`versionName` and `versionCode` come from the root `package.json`
(`1.3.10` → `1003010`). Bump `package.json`, tag `vX.Y.Z`, push the tag —
the Android workflow builds, verifies and attaches the APK, and every device
picks it up on its own.

## Debugging on a device

Release builds keep WebView debugging on. With the device connected over adb,
open `chrome://inspect` on the computer to get DevTools for the app.
