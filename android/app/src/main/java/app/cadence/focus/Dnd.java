package app.cadence.focus;

import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

import org.json.JSONObject;

/**
 * Turns the system Do Not Disturb mode on for focus sessions (with the user's chosen exceptions)
 * and restores the user's previous DND mode and policy afterwards. Requires notification-policy
 * access, which the user grants in system settings.
 */
final class Dnd {
    private Dnd() {}

    static boolean hasAccess(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        return nm != null && nm.isNotificationPolicyAccessGranted();
    }

    /** True while Cadence has switched DND on. */
    static boolean activeByUs(Context c) { return Store.getBool(c, "dndOn"); }

    static void apply(Context c, boolean want, JSONObject allow) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        boolean ours = activeByUs(c);
        if (want && !ours) {
            if (!nm.isNotificationPolicyAccessGranted()) return;
            try {
                NotificationManager.Policy prev = nm.getNotificationPolicy();
                Store.prefs(c).edit()
                    .putInt("dndPrevFilter", nm.getCurrentInterruptionFilter())
                    .putInt("dndPrevCats", prev.priorityCategories)
                    .putInt("dndPrevCalls", prev.priorityCallSenders)
                    .putInt("dndPrevMsgs", prev.priorityMessageSenders)
                    .putBoolean("dndOn", true)
                    .apply();
                nm.setNotificationPolicy(new NotificationManager.Policy(categories(allow), NotificationManager.Policy.PRIORITY_SENDERS_ANY, NotificationManager.Policy.PRIORITY_SENDERS_ANY));
                nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY);
            } catch (SecurityException e) {
                Store.putBool(c, "dndOn", false);
            }
        } else if (!want && ours) {
            restore(c, nm);
        } else if (want && nm.isNotificationPolicyAccessGranted()) {
            // Already on: keep the exceptions in step with the user's current choices.
            try {
                nm.setNotificationPolicy(new NotificationManager.Policy(categories(allow), NotificationManager.Policy.PRIORITY_SENDERS_ANY, NotificationManager.Policy.PRIORITY_SENDERS_ANY));
            } catch (SecurityException ignored) {}
        }
    }

    private static void restore(Context c, NotificationManager nm) {
        Store.putBool(c, "dndOn", false);
        if (!nm.isNotificationPolicyAccessGranted()) return;
        try {
            int cats = Store.prefs(c).getInt("dndPrevCats", -1);
            if (cats >= 0) {
                nm.setNotificationPolicy(new NotificationManager.Policy(cats,
                    Store.prefs(c).getInt("dndPrevCalls", NotificationManager.Policy.PRIORITY_SENDERS_STARRED),
                    Store.prefs(c).getInt("dndPrevMsgs", NotificationManager.Policy.PRIORITY_SENDERS_STARRED)));
            }
            // Only switch DND back if the user has not changed it themselves in the meantime.
            if (nm.getCurrentInterruptionFilter() == NotificationManager.INTERRUPTION_FILTER_PRIORITY) {
                int prev = Store.prefs(c).getInt("dndPrevFilter", NotificationManager.INTERRUPTION_FILTER_ALL);
                nm.setInterruptionFilter(prev == NotificationManager.INTERRUPTION_FILTER_UNKNOWN ? NotificationManager.INTERRUPTION_FILTER_ALL : prev);
            }
        } catch (SecurityException ignored) {}
    }

    private static int categories(JSONObject allow) {
        int cats = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            cats |= NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS | NotificationManager.Policy.PRIORITY_CATEGORY_MEDIA;
        }
        if (allow == null) return cats;
        if (allow.optBoolean("calls")) cats |= NotificationManager.Policy.PRIORITY_CATEGORY_CALLS;
        if (allow.optBoolean("repeatCallers")) cats |= NotificationManager.Policy.PRIORITY_CATEGORY_REPEAT_CALLERS;
        if (allow.optBoolean("messages")) cats |= NotificationManager.Policy.PRIORITY_CATEGORY_MESSAGES;
        if (allow.optBoolean("events")) cats |= NotificationManager.Policy.PRIORITY_CATEGORY_EVENTS | NotificationManager.Policy.PRIORITY_CATEGORY_REMINDERS;
        return cats;
    }
}
