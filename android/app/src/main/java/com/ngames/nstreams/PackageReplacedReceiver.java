package com.ngames.nstreams;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import java.io.File;

/**
 * Fires in the NEW version right after a self-update lands. Clears the
 * downloaded APK and, if the user hit "Update now" (rather than the update
 * applying while the app sat in the background), tries to reopen the app.
 * Android 10+ may block that launch from the background; in that case the
 * user just reopens it — nothing is lost.
 */
public class PackageReplacedReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;

        SharedPreferences sp = ctx.getSharedPreferences(AppUpdaterPlugin.PREFS, Context.MODE_PRIVATE);
        boolean relaunch = sp.getBoolean("relaunch", false);
        sp.edit()
                .putString("last_status", "success")
                .remove("last_message")
                .putBoolean("relaunch", false)
                .apply();

        File[] leftovers = new File(ctx.getCacheDir(), "updates").listFiles();
        if (leftovers != null) for (File f : leftovers) f.delete();

        if (!relaunch) return;
        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launch == null) return;
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            ctx.startActivity(launch);
        } catch (Exception e) {
            Log.w("NStreamsUpdater", "relaunch after update blocked: " + e.getMessage());
        }
    }
}
