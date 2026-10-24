package com.ngames.nstreams;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.util.Log;

/**
 * Receives the PackageInstaller session result. The normal outcome of a
 * self-update is that this process dies mid-install and the new version
 * starts fresh, so this mostly matters for the two non-silent cases:
 *   - STATUS_PENDING_USER_ACTION: the platform wants the user to confirm
 *     (Android < 12, or silent conditions not met) — show the system prompt.
 *   - a failure: record it so the JS side can surface it next launch.
 */
public class InstallResultReceiver extends BroadcastReceiver {

    private static final String TAG = "NStreamsUpdater";

    @Override
    @SuppressWarnings("deprecation")
    public void onReceive(Context ctx, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);

        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            ctx.getSharedPreferences(AppUpdaterPlugin.PREFS, Context.MODE_PRIVATE).edit()
                    .putString("last_status", "pending_user_action").apply();
            Intent confirm = Build.VERSION.SDK_INT >= 33
                    ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class)
                    : intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    ctx.startActivity(confirm);
                } catch (Exception e) {
                    // Blocked if we're in the background — JS retries in the foreground.
                    Log.w(TAG, "could not show install confirmation: " + e.getMessage());
                }
            }
            return;
        }

        String result = status == PackageInstaller.STATUS_SUCCESS ? "success" : "failure:" + status;
        Log.i(TAG, "install result " + result + (message != null ? " — " + message : ""));
        ctx.getSharedPreferences(AppUpdaterPlugin.PREFS, Context.MODE_PRIVATE).edit()
                .putString("last_status", result)
                .putString("last_message", message)
                .apply();
    }
}
