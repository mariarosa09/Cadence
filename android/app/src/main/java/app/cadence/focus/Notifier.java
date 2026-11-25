package app.cadence.focus;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.RequiresApi;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/** Notification channels, intents and posting helpers. */
final class Notifier {
    static final String CH_TIMER = "timer";
    static final String CH_REMINDERS = "reminders";
    static final String CH_SCREEN = "screen_breaks";
    static final String CH_GENERAL = "general";
    static final String CH_ONGOING = "ongoing";

    static final int ID_ONGOING = 1;
    static final int ID_PHASE = 2;
    static final int ID_EYE = 3;

    static final String EXTRA_OPEN = "cadence_open";

    private Notifier() {}

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.createNotificationChannel(channel(CH_TIMER, "Focus sessions", "Focus sessions and breaks ending", NotificationManager.IMPORTANCE_HIGH));
        nm.createNotificationChannel(channel(CH_REMINDERS, "Task reminders", "Start times, end times, deadlines and overdue tasks", NotificationManager.IMPORTANCE_HIGH));
        nm.createNotificationChannel(channel(CH_SCREEN, "Screen breaks", "Reminders to rest your eyes", NotificationManager.IMPORTANCE_HIGH));
        nm.createNotificationChannel(channel(CH_GENERAL, "Daily plan & achievements", "Daily planning reminder, goals and milestones", NotificationManager.IMPORTANCE_DEFAULT));
        NotificationChannel ongoing = channel(CH_ONGOING, "Session in progress", "Shows the running timer and focus music", NotificationManager.IMPORTANCE_LOW);
        ongoing.setShowBadge(false);
        nm.createNotificationChannel(ongoing);
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private static NotificationChannel channel(String id, String name, String desc, int importance) {
        NotificationChannel ch = new NotificationChannel(id, name, importance);
        ch.setDescription(desc);
        return ch;
    }

    static String channelFor(String cat) {
        switch (cat) {
            case "pomodoro":
            case "breakDone": return CH_TIMER;
            case "screenBreak": return CH_SCREEN;
            case "daily":
            case "achievements": return CH_GENERAL;
            default: return CH_REMINDERS;
        }
    }

    static boolean enabled(Context c) {
        return NotificationManagerCompat.from(c).areNotificationsEnabled();
    }

    /** Opens the app, optionally on a given screen ("home", "tasks", "focus", "newTask", ...). */
    static PendingIntent openApp(Context c, String screen, int requestCode) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (screen != null) i.putExtra(EXTRA_OPEN, screen);
        return PendingIntent.getActivity(c, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** A command handled by {@link ActionReceiver} (timer toggle, skip, task toggle, ...). */
    static PendingIntent command(Context c, String cmd, String arg, int requestCode) {
        Intent i = new Intent(c, ActionReceiver.class);
        i.setAction(ActionReceiver.ACTION);
        i.putExtra(ActionReceiver.EXTRA_CMD, cmd);
        if (arg != null) i.putExtra(ActionReceiver.EXTRA_ARG, arg);
        return PendingIntent.getBroadcast(c, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static NotificationCompat.Builder builder(Context c, String channel) {
        return new NotificationCompat.Builder(c, channel)
            .setSmallIcon(R.drawable.ic_stat_cadence)
            .setColor(ContextCompat.getColor(c, R.color.brand))
            .setAutoCancel(true);
    }

    static void post(Context c, int id, NotificationCompat.Builder b) {
        if (!enabled(c)) return;
        try { NotificationManagerCompat.from(c).notify(id, b.build()); } catch (SecurityException ignored) {}
    }

    static void cancel(Context c, int id) {
        NotificationManagerCompat.from(c).cancel(id);
    }

    static int idFor(String key) {
        return 1000 + (key.hashCode() & 0x0fffffff);
    }
}
