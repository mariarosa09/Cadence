package app.cadence.focus;

import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

import androidx.core.content.ContextCompat;

import org.json.JSONObject;

/**
 * Screen-break rule: if the screen was off for at least the break length, that counts as a rest,
 * and the next screen break is a full interval after the screen came back on.
 *
 * Two sources: a live screen on/off listener while Cadence's process runs, and Android's usage
 * history (with Usage access) so it also works after Cadence was closed.
 */
final class ScreenRest {
    private static boolean registered = false;
    private static long offAt = 0;

    private ScreenRest() {}

    /** Break length in ms (a screen-off at least this long counts as a rest). */
    static long minOffMs(JSONObject snap) {
        JSONObject e = snap.optJSONObject("eye");
        return Math.max(5_000L, 1000L * (e != null ? e.optInt("durationSec", 20) : 20));
    }

    /** Starts listening for the screen turning off and on (while this process is alive). */
    static synchronized void watch(Context context) {
        if (registered) return;
        registered = true;
        Context c = context.getApplicationContext();
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_SCREEN_ON);
        ContextCompat.registerReceiver(c, new BroadcastReceiver() {
            @Override public void onReceive(Context ctx, Intent intent) {
                long now = System.currentTimeMillis();
                if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) { offAt = now; return; }
                if (offAt > 0 && now - offAt >= minOffMs(Store.snapshot(ctx))) {
                    Store.putLong(ctx, "lastRestEnd", now);
                    // Cadence is in the background: restart the screen-break interval now.
                    if (!Store.foreground) {
                        JSONObject e = Store.snapshot(ctx).optJSONObject("eye");
                        long interval = Math.max(60_000L, e != null ? e.optLong("intervalMs", 20 * 60_000L) : 20 * 60_000L);
                        Store.putLong(ctx, "eyeNextAt", now + interval);
                        Controller.refresh(ctx);
                    }
                }
                offAt = 0;
            }
        }, f, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    /**
     * The latest moment after {@code since} when the screen came back on after being off for at
     * least {@code minOffMs}; 0 if there was none.
     */
    static long lastRestEnd(Context c, long since, long minOffMs) {
        long best = Store.getLong(c, "lastRestEnd");
        if (best < since) best = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && AppLock.hasUsageAccess(c)) {
            UsageStatsManager usm = (UsageStatsManager) c.getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm != null) {
                long now = System.currentTimeMillis();
                // Start a little earlier so a screen-off that began before `since` is seen.
                UsageEvents ev = usm.queryEvents(Math.max(0, since - 6 * 3_600_000L), now);
                UsageEvents.Event e = new UsageEvents.Event();
                long off = 0;
                while (ev != null && ev.hasNextEvent()) {
                    ev.getNextEvent(e);
                    int type = e.getEventType();
                    if (type == UsageEvents.Event.SCREEN_NON_INTERACTIVE) off = e.getTimeStamp();
                    else if (type == UsageEvents.Event.SCREEN_INTERACTIVE) {
                        long on = e.getTimeStamp();
                        if (off > 0 && on - off >= minOffMs && on >= since && on > best) best = on;
                        off = 0;
                    }
                }
            }
        }
        return best;
    }
}
