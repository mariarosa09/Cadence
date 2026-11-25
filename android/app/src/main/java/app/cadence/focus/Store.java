package app.cadence.focus;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Native-side persistent state shared by the widgets, alarms, notifications and the bridge.
 * The web layer owns the user's data; this keeps the snapshot it publishes, the native copy of
 * the timer, and a queue of actions taken outside the app that the web layer replays on resume.
 */
final class Store {
    private static final String PREFS = "cadence_native";
    private static final int MAX_ACTIONS = 300;

    /** True while the app's activity is in the foreground. */
    static volatile boolean foreground = false;

    private Store() {}

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONObject snapshot(Context c) {
        return parse(prefs(c).getString("snapshot", null));
    }

    static void saveSnapshot(Context c, JSONObject s) {
        prefs(c).edit().putString("snapshot", s.toString()).apply();
    }

    static JSONObject timer(Context c) {
        JSONObject t = parse(prefs(c).getString("timer", null));
        if (!t.has("phase")) {
            try {
                t.put("phase", "focus").put("status", "idle").put("endAt", 0L).put("remaining", 0L).put("total", 0L).put("cycle", 0);
            } catch (JSONException ignored) {}
        }
        return t;
    }

    static void saveTimer(Context c, JSONObject t) {
        prefs(c).edit().putString("timer", t.toString()).apply();
    }

    static long getLong(Context c, String key) { return prefs(c).getLong(key, 0L); }

    static void putLong(Context c, String key, long v) { prefs(c).edit().putLong(key, v).apply(); }

    static boolean getBool(Context c, String key) { return prefs(c).getBoolean(key, false); }

    static void putBool(Context c, String key, boolean v) { prefs(c).edit().putBoolean(key, v).apply(); }

    @android.annotation.SuppressLint("ApplySharedPref") // must reach disk before the process can be killed
    static synchronized void queue(Context c, JSONObject action) {
        JSONArray a = parseArray(prefs(c).getString("actions", null));
        a.put(action);
        while (a.length() > MAX_ACTIONS) a.remove(0);
        prefs(c).edit().putString("actions", a.toString()).commit();
    }

    static synchronized boolean hasActions(Context c) {
        return parseArray(prefs(c).getString("actions", null)).length() > 0;
    }

    @android.annotation.SuppressLint("ApplySharedPref")
    static synchronized JSONArray takeActions(Context c) {
        JSONArray a = parseArray(prefs(c).getString("actions", null));
        prefs(c).edit().remove("actions").commit();
        return a;
    }

    static JSONArray delivered(Context c) { return parseArray(prefs(c).getString("delivered", null)); }

    static void saveDelivered(Context c, JSONArray a) { prefs(c).edit().putString("delivered", a.toString()).apply(); }

    static JSONObject parse(String s) {
        if (s == null) return new JSONObject();
        try { return new JSONObject(s); } catch (JSONException e) { return new JSONObject(); }
    }

    static JSONArray parseArray(String s) {
        if (s == null) return new JSONArray();
        try { return new JSONArray(s); } catch (JSONException e) { return new JSONArray(); }
    }

    static JSONObject obj(Object... kv) {
        JSONObject o = new JSONObject();
        try { for (int i = 0; i + 1 < kv.length; i += 2) o.put((String) kv[i], kv[i + 1]); } catch (JSONException ignored) {}
        return o;
    }
}
