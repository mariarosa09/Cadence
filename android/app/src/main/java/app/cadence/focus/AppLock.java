package app.cadence.focus;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import android.telecom.TelecomManager;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Locks apps the user has not allowed while a focus session runs: watches which app comes to the
 * foreground (usage access) and covers it with {@link BlockActivity} (display over other apps).
 */
final class AppLock {
    private static String currentPkg = null;
    private static long lastQuery = 0;

    private AppLock() {}

    static boolean hasUsageAccess(Context c) {
        AppOpsManager ops = (AppOpsManager) c.getSystemService(Context.APP_OPS_SERVICE);
        if (ops == null) return false;
        int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.getPackageName())
            : ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    static boolean canOverlay(Context c) { return Settings.canDrawOverlays(c); }

    /** True while a focus phase runs and the user turned app lock on (and Android allows it). */
    static boolean active(Context c, JSONObject snap, JSONObject timer) {
        JSONObject lock = snap.optJSONObject("lock");
        return lock != null && lock.optBoolean("enabled") && "focus".equals(TimerEngine.phase(timer))
            && TimerEngine.active(timer) && hasUsageAccess(c) && canOverlay(c);
    }

    /** Apps that are never locked: Cadence, the home screen, phone/emergency calls, system UI and Settings. */
    static Set<String> alwaysAllowed(Context c) {
        Set<String> s = new HashSet<>();
        s.add(c.getPackageName());
        s.add("com.android.systemui");
        s.add("com.android.settings");
        s.add("com.android.phone");
        s.add("com.android.server.telecom");
        s.add("com.android.emergency");
        s.add("com.android.permissioncontroller");
        s.add("com.google.android.permissioncontroller");
        s.add("com.android.packageinstaller");
        s.add("com.google.android.packageinstaller");
        PackageManager pm = c.getPackageManager();
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        for (ResolveInfo ri : pm.queryIntentActivities(home, 0)) s.add(ri.activityInfo.packageName);
        TelecomManager tm = (TelecomManager) c.getSystemService(Context.TELECOM_SERVICE);
        if (tm != null && tm.getDefaultDialerPackage() != null) s.add(tm.getDefaultDialerPackage());
        return s;
    }

    /** The package currently in the foreground, from the most recent "activity resumed" event. */
    static String foreground(Context c) {
        UsageStatsManager usm = (UsageStatsManager) c.getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) return currentPkg;
        long now = System.currentTimeMillis();
        long from = lastQuery > 0 ? lastQuery - 2000 : now - 60_000;
        UsageEvents ev = usm.queryEvents(from, now);
        UsageEvents.Event e = new UsageEvents.Event();
        long newest = 0;
        while (ev != null && ev.hasNextEvent()) {
            ev.getNextEvent(e);
            if (e.getEventType() == UsageEvents.Event.ACTIVITY_RESUMED && e.getTimeStamp() >= newest) {
                newest = e.getTimeStamp();
                currentPkg = e.getPackageName();
            }
        }
        lastQuery = now;
        return currentPkg;
    }

    static boolean isAllowed(Context c, String pkg, JSONObject snap, Set<String> always) {
        if (pkg == null || always.contains(pkg)) return true;
        JSONObject lock = snap.optJSONObject("lock");
        JSONArray allowed = lock != null ? lock.optJSONArray("allowed") : null;
        if (allowed != null) for (int i = 0; i < allowed.length(); i++) if (pkg.equals(allowed.optString(i))) return true;
        return false;
    }

    static String label(Context c, String pkg) {
        try {
            PackageManager pm = c.getPackageManager();
            return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
        } catch (PackageManager.NameNotFoundException e) {
            return "This app";
        }
    }

    /** Launchable apps (except Cadence) with a small icon, for the allowed-apps chooser. */
    static JSONArray listApps(Context c) {
        PackageManager pm = c.getPackageManager();
        Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> infos = pm.queryIntentActivities(launcher, 0);
        Set<String> seen = new HashSet<>();
        List<JSONObject> out = new ArrayList<>();
        for (ResolveInfo ri : infos) {
            String pkg = ri.activityInfo.packageName;
            if (pkg.equals(c.getPackageName()) || !seen.add(pkg)) continue;
            try {
                out.add(new JSONObject().put("pkg", pkg).put("label", ri.loadLabel(pm).toString()).put("icon", iconData(ri.loadIcon(pm))));
            } catch (JSONException ignored) {}
        }
        Collections.sort(out, (a, b) -> a.optString("label").compareToIgnoreCase(b.optString("label")));
        JSONArray arr = new JSONArray();
        for (JSONObject o : out) arr.put(o);
        return arr;
    }

    private static String iconData(Drawable d) {
        int size = 96;
        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(bmp);
        d.setBounds(0, 0, size, size);
        d.draw(cv);
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.PNG, 100, bos);
        return "data:image/png;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
    }
}
