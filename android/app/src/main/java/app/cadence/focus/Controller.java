package app.cadence.focus;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Brings everything that lives outside the app in step with the current state: advances the
 * timer, applies Do Not Disturb, schedules alarms, posts due notifications and redraws widgets.
 */
final class Controller {
    static final String ALARM_TIMER = "app.cadence.focus.ALARM_TIMER";
    static final String ALARM_REMINDERS = "app.cadence.focus.ALARM_REMINDERS";
    static final String ALARM_EYE = "app.cadence.focus.ALARM_EYE";
    static final String ALARM_MIDNIGHT = "app.cadence.focus.ALARM_MIDNIGHT";
    static final String ALARM_MINUTE = "app.cadence.focus.ALARM_MINUTE";

    private Controller() {}

    static JSONObject config(JSONObject snap) {
        JSONObject cfg = snap.optJSONObject("timerConfig");
        return cfg != null ? cfg : new JSONObject();
    }

    static synchronized void refresh(Context c) {
        long now = System.currentTimeMillis();
        JSONObject snap = Store.snapshot(c);
        JSONObject cfg = config(snap);
        JSONObject t = Store.timer(c);

        List<String> ended = TimerEngine.advance(t, cfg, now);
        if (!ended.isEmpty()) Store.saveTimer(c, t);

        // DND first, so a "focus finished" alert is not silenced by our own DND.
        JSONObject dnd = snap.optJSONObject("dnd");
        // Only while focus is running: pausing or ending it restores the phone's previous DND mode.
        boolean wantDnd = dnd != null && dnd.optBoolean("enabled") && "focus".equals(TimerEngine.phase(t)) && TimerEngine.running(t);
        Dnd.apply(c, wantDnd, dnd != null ? dnd.optJSONObject("allow") : null);

        if (!ended.isEmpty() && !Store.foreground) notifyPhaseEnded(c, snap, t, ended.get(ended.size() - 1));

        setAlarm(c, ALARM_TIMER, TimerEngine.running(t) ? t.optLong("endAt") : 0);
        deliverReminders(c, snap, now);
        scheduleEye(c, snap, t, now);
        setAlarm(c, ALARM_MIDNIGHT, nextMidnight(now));
        // While focusing, the widgets' "focus today" minutes go up every minute.
        boolean focusing = TimerEngine.running(t) && "focus".equals(TimerEngine.phase(t));
        setAlarm(c, ALARM_MINUTE, focusing ? Math.min(t.optLong("endAt"), now + 60_000L) : 0);
        Widgets.updateAll(c);
        updateOngoing(c, snap, t);
    }

    /** Widgets show "today": redraw them just after midnight. */
    private static long nextMidnight(long now) {
        java.util.Calendar cal = java.util.Calendar.getInstance();
        cal.setTimeInMillis(now);
        cal.set(java.util.Calendar.HOUR_OF_DAY, 0); cal.set(java.util.Calendar.MINUTE, 0); cal.set(java.util.Calendar.SECOND, 30); cal.set(java.util.Calendar.MILLISECOND, 0);
        cal.add(java.util.Calendar.DAY_OF_MONTH, 1);
        return cal.getTimeInMillis();
    }

    /* ---------- alarms ---------- */

    static void setAlarm(Context c, String action, long at) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent i = new Intent(c, AlarmReceiver.class).setAction(action);
        PendingIntent pi = PendingIntent.getBroadcast(c, action.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (at <= 0) { am.cancel(pi); return; }
        try {
            if (canExact(c)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    static boolean canExact(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    /* ---------- timer ---------- */

    private static void notifyPhaseEnded(Context c, JSONObject snap, JSONObject t, String ended) {
        JSONObject cats = snap.optJSONObject("notif");
        String kind = "focus".equals(ended) ? AlertActivity.KIND_FOCUS_END : AlertActivity.KIND_BREAK_END;
        // Full-screen: wakes a sleeping screen and shows over the lock screen.
        PendingIntent full = PendingIntent.getActivity(c, 24, AlertActivity.intent(c, kind), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = Notifier.builder(c, Notifier.CH_TIMER)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setFullScreenIntent(full, true)
            .setContentIntent(Notifier.openApp(c, "focus", 21));
        if ("focus".equals(ended)) {
            if (cats != null && !cats.optBoolean("pomodoro", true)) return;
            String next = TimerEngine.label(TimerEngine.phase(t)).toLowerCase(Locale.ROOT);
            b.setContentTitle("Focus session complete");
            if (TimerEngine.running(t)) {
                b.setContentText("Your " + next + " has started. Rest away from the screen.");
                b.addAction(0, "Skip break", Notifier.command(c, "timerSkip", null, 22));
            } else {
                b.setContentText("Time for a " + next + ".");
                b.addAction(0, "Start break", Notifier.command(c, "timerToggle", null, 23));
                b.addAction(0, "Skip break", Notifier.command(c, "timerSkip", null, 22));
            }
        } else {
            if (cats != null && !cats.optBoolean("breakDone", true)) return;
            b.setContentTitle("Break finished").setContentText("Ready for another focus session?");
            b.addAction(0, "Start focus", Notifier.command(c, "timerToggle", null, 23));
        }
        // While the phone is in use, cover the current app (with "display over other apps"). On a
        // sleeping or locked phone the full-screen intent opens the alert. Either way the alert screen
        // plays the sound and vibrates, so the notification itself stays quiet.
        boolean shown = AlertActivity.showNow(c, kind) || AlertActivity.fullScreenWillShow(c);
        if (shown) b.setSilent(true);
        Notifier.post(c, Notifier.ID_PHASE, b);
    }

    static Notification buildOngoing(Context c) {
        JSONObject snap = Store.snapshot(c);
        JSONObject cfg = config(snap);
        JSONObject t = Store.timer(c);
        boolean timerActive = TimerEngine.active(t);
        if (!timerActive) return null;
        long now = System.currentTimeMillis();
        boolean h24 = snap.optBoolean("use24h");

        NotificationCompat.Builder b = Notifier.builder(c, Notifier.CH_ONGOING)
            .setOngoing(true).setAutoCancel(false).setOnlyAlertOnce(true).setSilent(true).setVibrate(null).setDefaults(0)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(Notifier.openApp(c, "focus", 11));

        {
            String phase = TimerEngine.phase(t);
            String task = cfg.optString("taskTitle", "");
            String title = TimerEngine.label(phase) + ("focus".equals(phase) && !task.isEmpty() ? " · " + task : "");
            b.setContentTitle(title);
            if (TimerEngine.running(t)) {
                long endAt = t.optLong("endAt");
                b.setUsesChronometer(true).setChronometerCountDown(true).setWhen(endAt).setShowWhen(true)
                    .setContentText("Ends at " + time(endAt, h24));
                b.addAction(0, "Pause", Notifier.command(c, "timerToggle", null, 12));
            } else {
                b.setShowWhen(false).setContentText("Paused · " + clock(TimerEngine.remaining(t, cfg, now)) + " left");
                b.addAction(0, "Resume", Notifier.command(c, "timerToggle", null, 12));
            }
            b.addAction(0, "focus".equals(phase) ? "End early" : "Skip break", Notifier.command(c, "timerSkip", null, 13));
        }
        return b.build();
    }

    static void updateOngoing(Context c, JSONObject snap, JSONObject t) {
        boolean needService = (MusicSession.has && MusicSession.playing) || AppLock.active(c, snap, t);
        if (needService) FocusService.start(c);
        else FocusService.stop(c);
        postNotifications(c);
    }

    /** The running-timer notification and the music player notification. */
    static void postNotifications(Context c) {
        if (!Notifier.enabled(c)) return;
        androidx.core.app.NotificationManagerCompat nm = androidx.core.app.NotificationManagerCompat.from(c);
        try {
            Notification timer = buildOngoing(c);
            if (timer != null) nm.notify(Notifier.ID_ONGOING, timer); else nm.cancel(Notifier.ID_ONGOING);
            if (MusicSession.has) nm.notify(Notifier.ID_MUSIC, MusicSession.build(c));
            else { nm.cancel(Notifier.ID_MUSIC); MusicSession.release(); }
        } catch (SecurityException ignored) {}
    }

    /* ---------- task reminders ---------- */

    private static void deliverReminders(Context c, JSONObject snap, long now) {
        JSONArray rs = snap.optJSONArray("reminders");
        JSONArray deliveredArr = Store.delivered(c);
        Set<String> delivered = new HashSet<>();
        for (int i = 0; i < deliveredArr.length(); i++) delivered.add(deliveredArr.optString(i));
        Set<String> keep = new HashSet<>();
        long next = 0;
        if (rs != null) {
            for (int i = 0; i < rs.length(); i++) {
                JSONObject r = rs.optJSONObject(i);
                if (r == null) continue;
                String key = r.optString("key");
                long at = r.optLong("at");
                if (delivered.contains(key)) { keep.add(key); continue; }
                if (at <= now + 15_000) {
                    keep.add(key);
                    // While the app is open it shows the reminder itself.
                    if (Store.foreground || at < now - 20 * 60_000L) continue;
                    String cat = r.optString("cat", "upcoming");
                    NotificationCompat.Builder b = Notifier.builder(c, Notifier.channelFor(cat))
                        .setContentTitle(r.optString("title"))
                        .setContentText(r.optString("body"))
                        .setStyle(new NotificationCompat.BigTextStyle().bigText(r.optString("body")))
                        .setWhen(at).setShowWhen(true)
                        .setCategory("daily".equals(cat) ? NotificationCompat.CATEGORY_RECOMMENDATION : NotificationCompat.CATEGORY_REMINDER)
                        .setContentIntent(Notifier.openApp(c, "daily".equals(cat) ? "home" : "tasks", Notifier.idFor(key)));
                    String taskId = r.optString("taskId", "");
                    if (!taskId.isEmpty() && ("start".equals(cat))) {
                        b.addAction(0, "Start focus", Notifier.command(c, "focusTask", taskId, Notifier.idFor(key) + 1));
                    }
                    if (!taskId.isEmpty() && ("endApproach".equals(cat) || "overdue".equals(cat) || "deadline".equals(cat))) {
                        b.addAction(0, "Mark done", Notifier.command(c, "taskDone", taskId, Notifier.idFor(key) + 2));
                    }
                    Notifier.post(c, Notifier.idFor(key), b);
                    Store.queue(c, Store.obj("type", "delivered", "key", key, "at", at, "cat", cat, "title", r.optString("title"), "body", r.optString("body")));
                    CadencePlugin.emitActions();
                } else if (next == 0 || at < next) {
                    next = at;
                }
            }
        }
        JSONArray out = new JSONArray();
        for (String k : keep) out.put(k);
        Store.saveDelivered(c, out);
        setAlarm(c, ALARM_REMINDERS, next);
    }

    /* ---------- screen breaks ---------- */

    private static boolean eyeEligible(JSONObject e, JSONObject t, long now) {
        if (e == null || !e.optBoolean("enabled") || Store.foreground) return false;
        boolean focusing = TimerEngine.running(t) && "focus".equals(TimerEngine.phase(t));
        String mode = e.optString("applyTo", "both");
        if ("focus".equals(mode)) return focusing;
        if ("general".equals(mode)) return !focusing;
        return true;
    }

    private static void scheduleEye(Context c, JSONObject snap, JSONObject t, long now) {
        JSONObject e = snap.optJSONObject("eye");
        if (!eyeEligible(e, t, now)) {
            Store.putLong(c, "eyeNextAt", 0);
            setAlarm(c, ALARM_EYE, 0);
            return;
        }
        long interval = Math.max(60_000L, e.optLong("intervalMs", 20 * 60_000L));
        long next = Store.getLong(c, "eyeNextAt");
        if (next <= 0) next = now + Math.max(15_000L, interval - e.optLong("accumMs"));
        else if (next < now - 60_000L) next = now + interval; // e.g. after a restart: start a fresh interval
        long snooze = e.optLong("snoozeUntil");
        if (next < snooze) next = snooze + interval;
        Store.putLong(c, "eyeNextAt", next);
        setAlarm(c, ALARM_EYE, next);
    }

    static void onEyeAlarm(Context c) {
        long now = System.currentTimeMillis();
        JSONObject snap = Store.snapshot(c);
        JSONObject e = snap.optJSONObject("eye");
        JSONObject t = Store.timer(c);
        if (eyeEligible(e, t, now) && now >= Store.getLong(c, "eyeNextAt") - 5_000) {
            long interval = Math.max(60_000L, e.optLong("intervalMs", 20 * 60_000L));
            PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
            boolean screenOn = pm == null || pm.isInteractive();
            JSONObject cats = snap.optJSONObject("notif");
            if (screenOn && now >= e.optLong("snoozeUntil") && (cats == null || cats.optBoolean("screenBreak", true))) {
                int secs = e.optInt("durationSec", 20);
                String len = secs >= 60 ? (secs / 60) + " min" : secs + " seconds";
                NotificationCompat.Builder b = Notifier.builder(c, Notifier.CH_SCREEN)
                    .setContentTitle("Screen break")
                    .setContentText("Look at something about 20 feet away for " + len + ".")
                    .setCategory(NotificationCompat.CATEGORY_REMINDER)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setTimeoutAfter(10 * 60_000L)
                    .setContentIntent(Notifier.openApp(c, "screenBreak", 31))
                    .addAction(0, "Done", Notifier.command(c, "eyeDone", null, 32))
                    .addAction(0, "Snooze " + e.optInt("postponeMin", 5) + " min", Notifier.command(c, "eyeSnooze", null, 33));
                if (!AlertActivity.showNow(c, AlertActivity.KIND_SCREEN)) Notifier.post(c, Notifier.ID_EYE, b);
                Store.queue(c, Store.obj("type", "eyeFired", "at", now));
            }
            // Screen off counts as a rest: start a fresh interval either way.
            Store.putLong(c, "eyeNextAt", now + interval);
        }
        refresh(c);
    }

    /* ---------- formatting ---------- */

    static String time(long ms, boolean h24) {
        return new SimpleDateFormat(h24 ? "H:mm" : "h:mm a", Locale.getDefault()).format(new Date(ms));
    }

    static String clock(long ms) {
        long s = Math.max(0, (ms + 999) / 1000);
        long m = s / 60;
        if (m >= 60) return String.format(Locale.ROOT, "%d:%02d:%02d", m / 60, m % 60, s % 60);
        return String.format(Locale.ROOT, "%02d:%02d", m, s % 60);
    }
}
