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
    // v2 channels: Android never lets an app change sound/vibration of an existing channel.
    static final String CH_TIMER = "timer_alerts";
    static final String CH_REMINDERS = "task_reminders";
    static final String CH_SCREEN = "screen_break_alerts";
    static final String CH_GENERAL = "general_v2";
    private static final String[] OLD_CHANNELS = { "timer", "reminders", "screen_breaks", "general" };
    static final long[] VIBRATION = { 0, 350, 180, 350 };
    static final String CH_ONGOING = "ongoing";
    static final String CH_MUSIC = "music";

    static final int ID_ONGOING = 1;
    static final int ID_PHASE = 2;
    static final int ID_EYE = 3;
    static final int ID_MUSIC = 4;

    static final String EXTRA_OPEN = "cadence_open";

    private Notifier() {}

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        for (String old : OLD_CHANNELS) nm.deleteNotificationChannel(old);
        nm.createNotificationChannel(alerting(CH_TIMER, "Focus sessions", "Focus sessions and breaks ending", NotificationManager.IMPORTANCE_HIGH, android.media.AudioAttributes.USAGE_ALARM));
        nm.createNotificationChannel(alerting(CH_REMINDERS, "Task reminders", "Start times, end times, deadlines and overdue tasks", NotificationManager.IMPORTANCE_HIGH, android.media.AudioAttributes.USAGE_NOTIFICATION_EVENT));
        nm.createNotificationChannel(alerting(CH_SCREEN, "Screen breaks", "Reminders to rest your eyes", NotificationManager.IMPORTANCE_HIGH, android.media.AudioAttributes.USAGE_ALARM));
        nm.createNotificationChannel(alerting(CH_GENERAL, "Daily plan & goals", "Daily planning reminder and goals", NotificationManager.IMPORTANCE_DEFAULT, android.media.AudioAttributes.USAGE_NOTIFICATION));
        NotificationChannel ongoing = channel(CH_ONGOING, "Session in progress", "Shows the running timer and focus music", NotificationManager.IMPORTANCE_LOW);
        ongoing.setShowBadge(false);
        nm.createNotificationChannel(ongoing);
        NotificationChannel music = channel(CH_MUSIC, "Focus music", "Play, pause and skip focus music", NotificationManager.IMPORTANCE_LOW);
        music.setShowBadge(false);
        nm.createNotificationChannel(music);
    }

    /** A channel that plays the default notification sound (also with the screen off) and vibrates. */
    @RequiresApi(Build.VERSION_CODES.O)
    private static NotificationChannel alerting(String id, String name, String desc, int importance, int usage) {
        NotificationChannel ch = channel(id, name, desc, importance);
        ch.enableVibration(true);
        ch.setVibrationPattern(VIBRATION);
        ch.enableLights(true);
        ch.setLightColor(0xFF8364E8);
        ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        ch.setSound(android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION),
            new android.media.AudioAttributes.Builder().setUsage(usage).setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        return ch;
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
            .setVibrate(VIBRATION) // for Android 7 (no channels)
            .setDefaults(NotificationCompat.DEFAULT_SOUND)
            .setAutoCancel(true);
    }

    /** Vibrates with the user's setting (the WebView can't vibrate without a tap). */
    static void vibrate(Context c, long[] pattern) {
        android.os.Vibrator v = (android.os.Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
        if (v == null || !v.hasVibrator()) return;
        // Alarm usage: "touch" vibrations are muted when the phone's touch feedback is off.
        if (Build.VERSION.SDK_INT >= 33) {
            v.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1), android.os.VibrationAttributes.createForUsage(android.os.VibrationAttributes.USAGE_ALARM));
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1), new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_ALARM).build());
        } else {
            v.vibrate(pattern, -1);
        }
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
