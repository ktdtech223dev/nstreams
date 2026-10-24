package com.ngames.nstreams;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;

/**
 * In-app self-updater for sideloaded installs (projector, Quest, phones).
 *
 * download() fetches the release APK into cache/updates and refuses it unless
 * it is (a) this package, (b) a strictly higher versionCode, and (c) signed by
 * the same key as the installed copy — so a bad URL can never install anything
 * foreign. install() feeds it to PackageInstaller.
 *
 * On Android 12+ (API 31) the session asks for USER_ACTION_NOT_REQUIRED. The
 * platform honours that for an app updating itself when it holds
 * REQUEST_INSTALL_PACKAGES and declares UPDATE_PACKAGES_WITHOUT_USER_ACTION, so
 * the update lands with no dialog. Below 12, or if the platform still wants
 * confirmation, InstallResultReceiver shows the standard system prompt.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    static final String PREFS = "nstreams_updater";
    private static final long MAX_APK_BYTES = 250L * 1024 * 1024;

    @PluginMethod
    public void getInfo(PluginCall call) {
        Context ctx = getContext();
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSObject r = new JSObject();
            r.put("versionName", pi.versionName);
            r.put("versionCode", versionCodeOf(pi));
            r.put("sdk", Build.VERSION.SDK_INT);
            r.put("canInstall", canRequestInstalls(ctx));
            r.put("silentCapable", Build.VERSION.SDK_INT >= 31);
            r.put("lastStatus", sp.getString("last_status", null));
            r.put("lastMessage", sp.getString("last_message", null));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("getInfo failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url");
        final String version = call.getString("version", "update");
        if (url == null || !url.startsWith("https://")) {
            call.reject("an https url is required");
            return;
        }
        new Thread(() -> {
            try {
                call.resolve(doDownload(url, version));
            } catch (Exception e) {
                call.reject("download failed: " + e.getMessage());
            }
        }, "nstreams-update-download").start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        final String path = call.getString("path");
        final boolean relaunch = Boolean.TRUE.equals(call.getBoolean("relaunch", false));
        if (path == null) {
            call.reject("path is required");
            return;
        }
        new Thread(() -> {
            try {
                call.resolve(doInstall(path, relaunch));
            } catch (Exception e) {
                call.reject("install failed: " + e.getMessage());
            }
        }, "nstreams-update-install").start();
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 26) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    // ─── download + verify ───────────────────────────────────────────────

    private JSObject doDownload(String url, String version) throws Exception {
        Context ctx = getContext();
        File dir = updatesDir(ctx);
        String safe = version.replaceAll("[^0-9A-Za-z._-]", "");
        File part = new File(dir, "nstreams-" + safe + ".apk.part");
        File apk = new File(dir, "nstreams-" + safe + ".apk");

        // Already downloaded this exact version on an earlier launch? Re-verify
        // and reuse it rather than pulling the APK again.
        if (apk.isFile()) {
            try {
                return verified(ctx, apk, apk);
            } catch (Exception stale) {
                apk.delete();
            }
        }
        // Only ever keep the latest download around.
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();

        fetch(url, part);
        return verified(ctx, part, apk);
    }

    /** Verifies {@code file} as a valid newer same-signer update, moves it to {@code dest}. */
    private JSObject verified(Context ctx, File file, File dest) throws Exception {
        PackageManager pm = ctx.getPackageManager();
        PackageInfo archive = pm.getPackageArchiveInfo(file.getAbsolutePath(), signingFlags());
        if (archive == null) throw new IOException("downloaded file is not a valid APK");
        if (!ctx.getPackageName().equals(archive.packageName)) {
            throw new IOException("APK is for " + archive.packageName + ", not this app");
        }
        PackageInfo installed = pm.getPackageInfo(ctx.getPackageName(), signingFlags());
        if (versionCodeOf(archive) <= versionCodeOf(installed)) {
            throw new IOException("APK " + archive.versionName + " is not newer than installed "
                    + installed.versionName);
        }
        // null = the platform couldn't read the archive's certs (old Android);
        // PackageInstaller still enforces the signer, so only a definite
        // mismatch is treated as fatal here.
        Boolean same = sameSigner(installed, archive);
        if (Boolean.FALSE.equals(same)) {
            throw new IOException("APK is signed with a different key — it cannot update this install");
        }
        if (!file.equals(dest) && !file.renameTo(dest)) throw new IOException("could not finalize download");

        JSObject r = new JSObject();
        r.put("path", dest.getAbsolutePath());
        r.put("versionName", archive.versionName);
        r.put("versionCode", versionCodeOf(archive));
        r.put("bytes", dest.length());
        return r;
    }

    private void fetch(String url, File dest) throws IOException {
        String current = url;
        HttpURLConnection c = null;
        // Follow redirects by hand so a redirect can never downgrade to http
        // (GitHub release assets 302 to a separate CDN host).
        for (int hop = 0; ; hop++) {
            if (hop > 5) throw new IOException("too many redirects");
            c = (HttpURLConnection) new URL(current).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "NStreams-Updater");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new IOException("redirect without a Location header");
                URL next = new URL(new URL(current), loc);
                if (!"https".equals(next.getProtocol())) throw new IOException("refusing non-https redirect");
                current = next.toString();
                continue;
            }
            if (code != 200) {
                c.disconnect();
                throw new IOException("HTTP " + code);
            }
            break;
        }

        long total = c.getContentLengthLong();
        if (total > MAX_APK_BYTES) {
            c.disconnect();
            throw new IOException("APK too large (" + total + " bytes)");
        }
        long done = 0;
        int lastPct = -1;
        try (InputStream in = new BufferedInputStream(c.getInputStream());
             OutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                done += n;
                if (done > MAX_APK_BYTES) throw new IOException("APK exceeded size cap");
                if (total > 0) {
                    int pct = (int) (done * 100 / total);
                    if (pct >= lastPct + 5) {
                        lastPct = pct;
                        JSObject p = new JSObject();
                        p.put("percent", pct);
                        notifyListeners("downloadProgress", p);
                    }
                }
            }
        } finally {
            c.disconnect();
        }
        if (total > 0 && done != total) throw new IOException("download truncated");
    }

    // ─── install ─────────────────────────────────────────────────────────

    private JSObject doInstall(String path, boolean relaunch) throws Exception {
        Context ctx = getContext();
        File apk = new File(path);
        // Only install what download() verified — never an arbitrary path.
        String root = updatesDir(ctx).getCanonicalPath() + File.separator;
        if (!apk.getCanonicalPath().startsWith(root)) throw new IOException("path is outside the update cache");
        if (!apk.isFile()) throw new IOException("update file is missing — download again");

        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean("relaunch", relaunch)
                .putString("last_status", "committing")
                .remove("last_message")
                .apply();

        PackageInstaller installer = ctx.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(ctx.getPackageName());
        params.setSize(apk.length());
        if (Build.VERSION.SDK_INT >= 26) params.setInstallReason(PackageManager.INSTALL_REASON_USER);
        if (Build.VERSION.SDK_INT >= 31) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        }

        int sessionId = installer.createSession(params);
        PackageInstaller.Session session = installer.openSession(sessionId);
        try {
            try (InputStream in = new FileInputStream(apk);
                 OutputStream out = session.openWrite("base.apk", 0, apk.length())) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                session.fsync(out);
            }
            Intent cb = new Intent(ctx, InstallResultReceiver.class);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            // The system writes the result extras into this intent, so it must
            // be mutable on 12+; it's explicit, which 14 requires for mutable.
            if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
            PendingIntent result = PendingIntent.getBroadcast(ctx, sessionId, cb, flags);
            session.commit(result.getIntentSender());
        } catch (Exception e) {
            session.abandon();
            throw e;
        } finally {
            session.close();
        }

        JSObject r = new JSObject();
        r.put("sessionId", sessionId);
        r.put("silent", Build.VERSION.SDK_INT >= 31);
        return r;
    }

    // ─── helpers ─────────────────────────────────────────────────────────

    static File updatesDir(Context ctx) throws IOException {
        File dir = new File(ctx.getCacheDir(), "updates");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cannot create update cache");
        return dir;
    }

    private static boolean canRequestInstalls(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return true;
        return ctx.getPackageManager().canRequestPackageInstalls();
    }

    @SuppressWarnings("deprecation")
    private static int signingFlags() {
        return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }

    @SuppressWarnings("deprecation")
    static long versionCodeOf(PackageInfo pi) {
        return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
    }

    @SuppressWarnings("deprecation")
    private static Set<String> signerDigests(PackageInfo pi) {
        Signature[] sigs = null;
        if (Build.VERSION.SDK_INT >= 28) {
            if (pi.signingInfo != null) {
                sigs = pi.signingInfo.hasMultipleSigners()
                        ? pi.signingInfo.getApkContentsSigners()
                        : pi.signingInfo.getSigningCertificateHistory();
            }
        } else {
            sigs = pi.signatures;
        }
        if (sigs == null || sigs.length == 0) return null;
        Set<String> out = new HashSet<>();
        for (Signature s : sigs) {
            try {
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                byte[] d = md.digest(s.toByteArray());
                StringBuilder sb = new StringBuilder();
                for (byte b : d) sb.append(String.format("%02x", b));
                out.add(sb.toString());
            } catch (Exception ignored) {
                return null;
            }
        }
        return out;
    }

    private static Boolean sameSigner(PackageInfo installed, PackageInfo archive) {
        Set<String> a = signerDigests(installed);
        Set<String> b = signerDigests(archive);
        if (a == null || b == null) return null;
        for (String d : b) if (a.contains(d)) return true;
        return false;
    }
}
