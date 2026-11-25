package app.cadence.focus;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Handles taps on widget buttons and notification actions. The change is applied natively right
 * away (so widgets and notifications update even when the app is closed) and queued with its
 * timestamp so the app replays it into its own data the next time it runs.
 */
public class ActionReceiver extends BroadcastReceiver {
    static final String ACTION = "app.cadence.focus.COMMAND";
    static final String EXTRA_CMD = "cmd";
    static final String EXTRA_ARG = "arg";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION.equals(intent.getAction())) return;
        String cmd = intent.getStringExtra(EXTRA_CMD);
        String arg = intent.getStringExtra(EXTRA_ARG);
        if (cmd == null) return;
        handle(context.getApplicationContext(), cmd, arg);
    }

    static void handle(Context c, String cmd, String arg) {
        long now = System.currentTimeMillis();
        synchronized (Controller.class) {
            JSONObject snap = Store.snapshot(c);
            JSONObject cfg = Controller.config(snap);
            JSONObject t = Store.timer(c);
            TimerEngine.advance(t, cfg, now);
            switch (cmd) {
                case "timerToggle": {
                    String status = TimerEngine.status(t);
                    if ("running".equals(status)) { TimerEngine.pause(t, now); queue(c, "pause", now); }
                    else if ("paused".equals(status)) { TimerEngine.resume(t, now); queue(c, "resume", now); }
                    else { TimerEngine.start(t, cfg, now); queue(c, "start", now); }
                    Notifier.cancel(c, Notifier.ID_PHASE);
                    break;
                }
                case "timerSkip":
                    TimerEngine.skip(t, cfg);
                    queue(c, "skip", now);
                    Notifier.cancel(c, Notifier.ID_PHASE);
                    break;
                case "focusTask":
                    if (!TimerEngine.active(t)) {
                        try { t.put("phase", "focus"); } catch (JSONException ignored) {}
                        setTaskTitle(c, snap, arg);
                        cfg = Controller.config(snap);
                        TimerEngine.start(t, cfg, now);
                        Store.queue(c, Store.obj("type", "focusTask", "id", arg, "at", now));
                    }
                    break;
                case "taskToggle":
                case "taskDone":
                    if (arg != null) {
                        boolean done = "taskDone".equals(cmd) || !isDone(snap, arg);
                        markTask(c, snap, arg, done, now);
                        Store.queue(c, Store.obj("type", "task", "id", arg, "done", done, "at", now));
                    }
                    break;
                case "eyeDone": {
                    JSONObject e = snap.optJSONObject("eye");
                    Store.queue(c, Store.obj("type", "eye", "action", "completed", "at", now, "ms", 1000L * (e != null ? e.optInt("durationSec", 20) : 20)));
                    Notifier.cancel(c, Notifier.ID_EYE);
                    break;
                }
                case "eyeSnooze": {
                    JSONObject e = snap.optJSONObject("eye");
                    int min = e != null ? e.optInt("postponeMin", 5) : 5;
                    Store.queue(c, Store.obj("type", "eye", "action", "postponed", "at", now, "minutes", min));
                    Store.putLong(c, "eyeNextAt", now + min * 60_000L);
                    Notifier.cancel(c, Notifier.ID_EYE);
                    break;
                }
                case "musicToggle":
                    Store.queue(c, Store.obj("type", "music", "at", now));
                    break;
                default:
                    return;
            }
            Store.saveTimer(c, t);
        }
        Controller.refresh(c);
        CadencePlugin.emitActions();
    }

    private static void queue(Context c, String type, long at) {
        Store.queue(c, Store.obj("type", type, "at", at));
    }

    private static JSONArray tasks(JSONObject snap) {
        JSONObject today = snap.optJSONObject("today");
        return today != null ? today.optJSONArray("tasks") : null;
    }

    private static boolean isDone(JSONObject snap, String id) {
        JSONArray a = tasks(snap);
        if (a == null) return false;
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && id.equals(o.optString("id"))) return "completed".equals(o.optString("status"));
        }
        return false;
    }

    private static void markTask(Context c, JSONObject snap, String id, boolean done, long now) {
        JSONArray a = tasks(snap);
        if (a == null) return;
        try {
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && id.equals(o.optString("id"))) {
                    o.put("status", done ? "completed" : "pending");
                    o.put("completedAt", done ? now : 0);
                }
            }
            Store.saveSnapshot(c, snap);
        } catch (JSONException ignored) {}
    }

    private static void setTaskTitle(Context c, JSONObject snap, String id) {
        JSONArray a = tasks(snap);
        JSONObject cfg = snap.optJSONObject("timerConfig");
        if (a == null || cfg == null || id == null) return;
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && id.equals(o.optString("id"))) {
                try { cfg.put("taskTitle", o.optString("title")); Store.saveSnapshot(c, snap); } catch (JSONException ignored) {}
            }
        }
    }
}
