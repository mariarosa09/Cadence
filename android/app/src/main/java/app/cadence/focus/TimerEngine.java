package app.cadence.focus;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Native mirror of the Pomodoro state machine in script.js (startTimer, pauseTimer, resumeTimer,
 * skipPhase, completePhase), so the timer keeps advancing and can be controlled from widgets and
 * notifications while the app is closed. Times are epoch milliseconds.
 */
final class TimerEngine {
    private static final long MIN = 60_000L;

    private TimerEngine() {}

    static String phase(JSONObject t) { return t.optString("phase", "focus"); }

    static String status(JSONObject t) { return t.optString("status", "idle"); }

    static boolean running(JSONObject t) { return "running".equals(status(t)); }

    static boolean active(JSONObject t) { return !"idle".equals(status(t)); }

    static long phaseTotal(JSONObject cfg, String phase) {
        switch (phase) {
            case "short": return cfg.optLong("shortMs", 5 * MIN);
            case "long": return cfg.optLong("longMs", 15 * MIN);
            default: return cfg.optLong("focusMs", 25 * MIN);
        }
    }

    static long remaining(JSONObject t, JSONObject cfg, long now) {
        switch (status(t)) {
            case "running": return Math.max(0, t.optLong("endAt") - now);
            case "paused": return t.optLong("remaining");
            default: return phaseTotal(cfg, phase(t));
        }
    }

    static void start(JSONObject t, JSONObject cfg, long at) {
        long total = phaseTotal(cfg, phase(t));
        put(t, "total", total);
        put(t, "endAt", at + total);
        put(t, "status", "running");
    }

    static void pause(JSONObject t, long at) {
        if (!running(t)) return;
        put(t, "remaining", Math.max(0, t.optLong("endAt") - at));
        put(t, "status", "paused");
    }

    static void resume(JSONObject t, long at) {
        if (!"paused".equals(status(t))) return;
        put(t, "endAt", at + t.optLong("remaining"));
        put(t, "status", "running");
    }

    static void skip(JSONObject t, JSONObject cfg) {
        int cycle = t.optInt("cycle", 0);
        if ("focus".equals(phase(t))) {
            int interval = Math.max(1, cfg.optInt("interval", 4));
            put(t, "phase", (cycle + 1) % interval == 0 ? "long" : "short");
        } else {
            if ("long".equals(phase(t))) put(t, "cycle", 0);
            put(t, "phase", "focus");
        }
        put(t, "status", "idle");
    }

    /** Completes every phase that has ended by {@code now}; returns the phases that ended, in order. */
    static List<String> advance(JSONObject t, JSONObject cfg, long now) {
        List<String> ended = new ArrayList<>();
        int guard = 0;
        while (running(t) && now >= t.optLong("endAt") && guard++ < 12) {
            String p = phase(t);
            long at = t.optLong("endAt");
            ended.add(p);
            if ("focus".equals(p)) {
                int cycle = t.optInt("cycle", 0) + 1;
                int interval = Math.max(1, cfg.optInt("interval", 4));
                put(t, "cycle", cycle);
                put(t, "phase", cycle % interval == 0 ? "long" : "short");
                put(t, "status", "idle");
                if (cfg.optBoolean("autoTransition", true)) start(t, cfg, at);
            } else {
                if ("long".equals(p)) put(t, "cycle", 0);
                put(t, "phase", "focus");
                put(t, "status", "idle");
            }
        }
        return ended;
    }

    static String label(String phase) {
        switch (phase) {
            case "short": return "Short break";
            case "long": return "Long break";
            default: return "Focus";
        }
    }

    private static void put(JSONObject o, String k, Object v) {
        try { o.put(k, v); } catch (JSONException ignored) {}
    }
}
