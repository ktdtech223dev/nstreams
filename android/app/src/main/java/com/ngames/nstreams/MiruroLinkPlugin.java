package com.ngames.nstreams;

import android.annotation.SuppressLint;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BiConsumer;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * Resolves an AniList id to Miruro's opaque catalog id, so the app can open
 * /watch/<id>?ep=N directly instead of Miruro's search page.
 *
 * Miruro's catalog API is Cloudflare-gated against non-browser clients and
 * sends no CORS headers, so neither native HTTP nor the app's own WebView
 * can call it. A throwaway, never-attached WebView parked on
 * https://www.miruro.tv/health is same-origin and passes as a browser: the
 * page fetches the catalog and hands the raw bytes back through a JS
 * interface, and the decoding (XOR "miruro/catalog", then gzip) happens here
 * so it doesn't depend on the device's WebView version.
 * Mirrors electron/miruro-link.js.
 */
@CapacitorPlugin(name = "MiruroLink")
public class MiruroLinkPlugin extends Plugin {

    private static final String ORIGIN = "https://www.miruro.tv";
    private static final long TIMEOUT_MS = 12000;
    private static final Pattern MIRURO_ID = Pattern.compile("^[A-Za-z0-9_-]{32}$");
    private static final byte[] KEY = "miruro/catalog".getBytes(StandardCharsets.UTF_8);

    @PluginMethod
    public void resolve(PluginCall call) {
        int anilistId = call.getInt("anilistId", 0);
        if (anilistId <= 0) {
            call.reject("anilistId required");
            return;
        }
        new Handler(Looper.getMainLooper()).post(() -> lookup(call, anilistId));
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void lookup(PluginCall call, int anilistId) {
        Handler main = new Handler(Looper.getMainLooper());
        WebView web = new WebView(getContext());
        AtomicBoolean finished = new AtomicBoolean(false);
        AtomicBoolean injected = new AtomicBoolean(false);

        Runnable cleanup = () -> {
            web.stopLoading();
            web.removeJavascriptInterface("NSMiruro");
            web.destroy();
        };
        BiConsumer<String, String> finish = (id, error) -> {
            if (!finished.compareAndSet(false, true)) return;
            main.post(cleanup);
            if (id != null) {
                JSObject r = new JSObject();
                r.put("id", id);
                call.resolve(r);
            } else {
                call.reject(error != null ? error : "lookup failed");
            }
        };

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // Present as plain Chrome: drop the WebView markers ("; wv",
        // "Version/4.0") that bot checks key on.
        s.setUserAgentString(s.getUserAgentString()
                .replace("; wv)", ")")
                .replaceAll("Version/\\d+(\\.\\d+)* ", ""));

        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void done(String contentType, String base64) {
                try {
                    finish.accept(findId(contentType, base64, anilistId), "no catalog entry");
                } catch (Exception e) {
                    finish.accept(null, "decode failed: " + e.getMessage());
                }
            }

            @JavascriptInterface
            public void fail(String message) {
                finish.accept(null, message);
            }
        }, "NSMiruro");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true; // stay parked on /health
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (finished.get() || url == null || !url.startsWith(ORIGIN + "/health")) return;
                if (injected.compareAndSet(false, true)) view.evaluateJavascript(lookupScript(anilistId), null);
            }
        });

        main.postDelayed(() -> finish.accept(null, "timed out"), TIMEOUT_MS);
        web.loadUrl(ORIGIN + "/health");
    }

    // Runs in the miruro.tv page; anilistId is an int, so interpolation is safe.
    private static String lookupScript(int anilistId) {
        return "(async () => {"
                + "try {"
                + "  const r = await fetch('/api/v1/anime?anilist_id_in=" + anilistId + "&limit=100');"
                + "  if (!r.ok) { NSMiruro.fail('catalog HTTP ' + r.status); return; }"
                + "  const b = new Uint8Array(await r.arrayBuffer());"
                + "  let bin = '';"
                + "  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));"
                + "  NSMiruro.done(r.headers.get('content-type') || '', btoa(bin));"
                + "} catch (e) { NSMiruro.fail(String(e && e.message || e)); }"
                + "})()";
    }

    private static String findId(String contentType, String base64, int anilistId) throws Exception {
        byte[] body = Base64.decode(base64, Base64.DEFAULT);
        String json;
        if (contentType.startsWith("application/octet-stream")) {
            for (int i = 0; i < body.length; i++) body[i] ^= KEY[i % KEY.length];
            json = new String(gunzip(body), StandardCharsets.UTF_8);
        } else {
            json = new String(body, StandardCharsets.UTF_8);
        }
        JSONArray data = new JSONObject(json).optJSONArray("data");
        if (data == null) return null;
        String want = String.valueOf(anilistId);
        for (int i = 0; i < data.length(); i++) {
            JSONObject anime = data.getJSONObject(i);
            JSONObject ext = anime.optJSONObject("external_ids");
            JSONArray anilist = ext != null ? ext.optJSONArray("anilist") : null;
            if (anilist == null) continue;
            for (int j = 0; j < anilist.length(); j++) {
                if (want.equals(anilist.optString(j))) {
                    String id = anime.optString("id");
                    return MIRURO_ID.matcher(id).matches() ? id : null;
                }
            }
        }
        return null;
    }

    private static byte[] gunzip(byte[] gz) throws Exception {
        try (InputStream in = new GZIPInputStream(new ByteArrayInputStream(gz));
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }
}
