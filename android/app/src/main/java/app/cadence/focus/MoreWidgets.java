package app.cadence.focus;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Home-screen versions of the dashboard widgets in the app, drawn from the published snapshot. */
final class MoreWidgets {
    static final String UPCOMING = "upcoming", DEADLINES = "deadlines", PROGRESS = "progress", WEEKLY = "weekly",
        STREAK = "streak", CALENDAR = "calendar", MUSIC = "music", SCREEN = "screen", QUOTE = "quote";

    private static final int[] ROWS = { R.id.l_row0, R.id.l_row1, R.id.l_row2, R.id.l_row3, R.id.l_row4 };
    private static final int[] DOTS = { R.id.l_dot0, R.id.l_dot1, R.id.l_dot2, R.id.l_dot3, R.id.l_dot4 };
    private static final int[] TITLES = { R.id.l_title0, R.id.l_title1, R.id.l_title2, R.id.l_title3, R.id.l_title4 };
    private static final int[] TIMES = { R.id.l_time0, R.id.l_time1, R.id.l_time2, R.id.l_time3, R.id.l_time4 };
    private static final long DAY = 86_400_000L;
    private static final int ACCENT = 0xFF8364E8, ACCENT_2 = 0xFFD397FA, MUTED = 0xB3FFFFFF, DANGER = 0xFFFF8A9B;

    private MoreWidgets() {}

    static RemoteViews render(Context c, String kind, JSONObject snap, Bundle opts) {
        ctx = c.getApplicationContext();
        switch (kind) {
            case UPCOMING: return list(c, snap, opts, false);
            case DEADLINES: return list(c, snap, opts, true);
            case PROGRESS: return progress(c, snap);
            case WEEKLY: return weekly(c, snap, opts);
            case STREAK: return streak(c, snap, opts);
            case CALENDAR: return calendar(c, snap, opts);
            case MUSIC: return music(c);
            case SCREEN: return screen(c, snap);
            default: return quote(c, snap);
        }
    }

    /* ---------- data helpers ---------- */

    private static JSONObject today(JSONObject snap) { JSONObject t = snap.optJSONObject("today"); return t != null ? t : new JSONObject(); }

    private static long sod(long ms) {
        Calendar cal = Calendar.getInstance(); cal.setTimeInMillis(ms);
        cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0); cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0);
        return cal.getTimeInMillis();
    }

    private static long addDays(long dayStart, int n) {
        Calendar cal = Calendar.getInstance(); cal.setTimeInMillis(dayStart); cal.add(Calendar.DAY_OF_MONTH, n); return cal.getTimeInMillis();
    }

    static String key(long ms) { return new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date(ms)); }

    private static long weekStart(JSONObject snap, long now) {
        int ws = snap.optInt("weekStart", 0);
        Calendar cal = Calendar.getInstance(); cal.setTimeInMillis(sod(now));
        int dow = cal.get(Calendar.DAY_OF_WEEK) - 1; // 0 = Sunday
        return addDays(cal.getTimeInMillis(), -((dow - ws + 7) % 7));
    }

    private static Context ctx;

    private static long focusOn(JSONObject snap, long dayStart) {
        JSONObject m = today(snap).optJSONObject("focusByDay");
        long ms = m != null ? m.optLong(key(dayStart)) : 0;
        if (ctx != null && dayStart == sod(System.currentTimeMillis())) ms += Widgets.liveFocusMs(ctx, snap);
        return ms;
    }

    private static int doneOn(JSONObject snap, long dayStart) {
        JSONObject m = today(snap).optJSONObject("doneByDay");
        return m != null ? m.optInt(key(dayStart)) : 0;
    }

    private static Set<String> focusDays(JSONObject snap) {
        Set<String> s = new HashSet<>(); JSONArray a = today(snap).optJSONArray("focusDays");
        if (a != null) for (int i = 0; i < a.length(); i++) s.add(a.optString(i));
        return s;
    }

    static int streak(JSONObject snap, long now) {
        Set<String> days = focusDays(snap); long d = sod(now);
        if (!days.contains(key(d))) d = addDays(d, -1);
        int n = 0; while (days.contains(key(d)) && n < 10000) { n++; d = addDays(d, -1); }
        return n;
    }

    private static String fmtDur(long ms) {
        long m = Math.round(ms / 60_000.0);
        if (m < 60) return m + "m";
        return (m / 60) + "h" + (m % 60 > 0 ? " " + (m % 60) + "m" : "");
    }

    private static String when(long ms, boolean h24, long now) {
        long d = sod(ms), t = sod(now);
        String day = d == t ? "Today" : d == addDays(t, 1) ? "Tomorrow" : d == addDays(t, -1) ? "Yesterday" : new SimpleDateFormat("EEE d", Locale.getDefault()).format(new Date(ms));
        return day + ", " + Controller.time(ms, h24);
    }

    private static int px(Context c, int dp) { return Math.round(dp * c.getResources().getDisplayMetrics().density); }

    private static int[] size(Context c, Bundle opts, int wDp, int hDp) {
        int w = wDp, h = hDp;
        if (opts != null) {
            int ow = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0), oh = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            if (ow > 0) w = ow; if (oh > 0) h = oh;
        }
        return new int[] { px(c, w), px(c, h) };
    }

    /* ---------- upcoming & deadlines ---------- */

    private static RemoteViews list(Context c, JSONObject snap, Bundle opts, boolean deadlines) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_list);
        long now = System.currentTimeMillis(); boolean h24 = snap.optBoolean("use24h");
        v.setTextViewText(R.id.l_title, deadlines ? "Upcoming deadlines" : "Upcoming schedule");
        v.setImageViewResource(R.id.l_icon, deadlines ? R.drawable.ic_w_flag : R.drawable.ic_w_cal);
        List<JSONObject> items = new ArrayList<>();
        JSONArray tasks = today(snap).optJSONArray("tasks");
        if (tasks != null) for (int i = 0; i < tasks.length(); i++) {
            JSONObject o = tasks.optJSONObject(i);
            if (o == null || "completed".equals(o.optString("status"))) continue;
            if (deadlines ? o.optLong("due") > 0 : (o.optLong("start") > 0 && o.optLong("end") > now)) items.add(o);
        }
        String k = deadlines ? "due" : "start";
        Collections.sort(items, (a, b) -> Long.compare(a.optLong(k), b.optLong(k)));
        int maxRows = ROWS.length;
        if (opts != null) { int h = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0); if (h > 0) maxRows = Math.max(1, Math.min(ROWS.length, (h - 56) / 32)); }
        for (int i = 0; i < ROWS.length; i++) {
            if (i >= items.size() || i >= maxRows) { v.setViewVisibility(ROWS[i], View.GONE); continue; }
            JSONObject o = items.get(i);
            v.setViewVisibility(ROWS[i], View.VISIBLE);
            int col; try { col = Color.parseColor(o.optString("color", "#8364e8")); } catch (IllegalArgumentException e) { col = ACCENT; }
            v.setTextColor(DOTS[i], col);
            v.setTextViewText(TITLES[i], o.optString("title"));
            long at = o.optLong(k);
            boolean overdue = deadlines && at < now;
            v.setTextViewText(TIMES[i], deadlines ? (overdue ? "Overdue" : "Due " + when(at, h24, now)) : (o.optLong("start") < now ? "Now" : when(at, h24, now)));
            v.setTextColor(TIMES[i], overdue ? DANGER : MUTED);
            v.setOnClickPendingIntent(ROWS[i], Notifier.openApp(c, deadlines ? "tasks" : "calendar", (deadlines ? 120 : 110) + i));
        }
        v.setViewVisibility(R.id.l_empty, items.isEmpty() ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.l_empty, deadlines ? "No deadlines. Tasks with due dates show up here." : "Nothing scheduled. Give a task a start time to see it here.");
        v.setOnClickPendingIntent(R.id.l_header, Notifier.openApp(c, deadlines ? "tasks" : "calendar", deadlines ? 129 : 119));
        v.setOnClickPendingIntent(R.id.l_add, Notifier.openApp(c, "newTask", deadlines ? 128 : 118));
        return v;
    }

    /* ---------- daily progress ---------- */

    private static RemoteViews progress(Context c, JSONObject snap) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_progress);
        long now = System.currentTimeMillis(), a = sod(now), b = addDays(a, 1);
        int total = 0, done = 0;
        JSONArray tasks = today(snap).optJSONArray("tasks");
        if (tasks != null) for (int i = 0; i < tasks.length(); i++) {
            JSONObject o = tasks.optJSONObject(i); if (o == null) continue;
            long s = o.optLong("start"), e = o.optLong("end"), due = o.optLong("due"), ca = o.optLong("completedAt");
            boolean touches = (s > 0 && e > 0 && s < b && e > a) || (due >= a && due < b);
            boolean completed = "completed".equals(o.optString("status"));
            if (touches || (completed && ca >= a && ca < b)) { total++; if (completed) done++; }
        }
        long focus = focusOn(snap, a);
        int goal = Math.max(1, today(snap).optInt("goalMin", 100));
        v.setTextViewText(R.id.p_title, "Daily progress");
        v.setTextViewText(R.id.p_label1, "Tasks done");
        v.setTextViewText(R.id.p_value1, done + " / " + total);
        v.setProgressBar(R.id.p_bar1, Math.max(1, total), done, false);
        v.setTextViewText(R.id.p_label2, "Focus goal");
        v.setTextViewText(R.id.p_value2, fmtDur(focus) + " / " + fmtDur(goal * 60_000L));
        v.setProgressBar(R.id.p_bar2, goal, (int) Math.min(goal, focus / 60_000L), false);
        v.setOnClickPendingIntent(R.id.p_root, Notifier.openApp(c, "home", 130));
        return v;
    }

    /* ---------- weekly productivity ---------- */

    private static RemoteViews weekly(Context c, JSONObject snap, Bundle opts) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_chart);
        long now = System.currentTimeMillis(), ws = weekStart(snap, now);
        long goalDay = today(snap).optInt("goalMin", 100) * 60_000L;
        long[] ms = new long[7]; long total = 0; int tasks = 0;
        for (int i = 0; i < 7; i++) { long d = addDays(ws, i); ms[i] = focusOn(snap, d); total += ms[i]; tasks += doneOn(snap, d); }
        JSONObject goals = snap.optJSONObject("goals");
        double weekGoalH = goals != null ? goals.optDouble("weeklyHours", 10) : 10;
        v.setTextViewText(R.id.c_title, "Weekly focus");
        v.setTextViewText(R.id.c_big, fmtDur(total));
        v.setTextViewText(R.id.c_sub, tasks + " task" + (tasks == 1 ? "" : "s") + " done · goal " + (int) weekGoalH + "h");
        int[] sz = size(c, opts, 250, 110);
        int w = Math.max(px(c, 160), sz[0] - px(c, 28)), h = Math.max(px(c, 44), sz[1] - px(c, 78));
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(bmp);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        Paint tp = text(c, 10, MUTED);
        long max = goalDay; for (long x : ms) max = Math.max(max, x);
        float labelH = px(c, 14), gap = px(c, 6), bw = (w - gap * 6f) / 7f, chartH = h - labelH - px(c, 2);
        int todayIdx = (int) ((sod(now) - ws) / DAY);
        for (int i = 0; i < 7; i++) {
            float x = i * (bw + gap);
            float bh = ms[i] > 0 ? Math.max(px(c, 4), (float) ms[i] / max * chartH) : px(c, 3);
            p.setColor(ms[i] == 0 ? 0x26FFFFFF : ms[i] >= goalDay ? ACCENT_2 : ACCENT);
            cv.drawRoundRect(new RectF(x, chartH - bh, x + bw, chartH), px(c, 4), px(c, 4), p);
            String letter = new SimpleDateFormat("EEEEE", Locale.getDefault()).format(new Date(addDays(ws, i)));
            tp.setColor(i == todayIdx ? Color.WHITE : MUTED);
            tp.setTypeface(i == todayIdx ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            cv.drawText(letter, x + bw / 2f, h - px(c, 2), tp);
        }
        v.setImageViewBitmap(R.id.c_image, bmp);
        v.setOnClickPendingIntent(R.id.c_root, Notifier.openApp(c, "insights", 140));
        return v;
    }

    private static Paint text(Context c, int sp, int color) {
        Paint tp = new Paint(Paint.ANTI_ALIAS_FLAG);
        tp.setColor(color); tp.setTextAlign(Paint.Align.CENTER);
        tp.setTextSize(sp * c.getResources().getDisplayMetrics().scaledDensity);
        return tp;
    }

    /* ---------- focus streak ---------- */

    private static RemoteViews streak(Context c, JSONObject snap, Bundle opts) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_chart);
        long now = System.currentTimeMillis();
        int s = streak(snap, now);
        Set<String> days = focusDays(snap);
        v.setTextViewText(R.id.c_title, "Focus streak");
        v.setTextViewText(R.id.c_big, s + (s == 1 ? " day" : " days"));
        v.setTextViewText(R.id.c_sub, s > 0 ? "One focus session a day keeps it going" : "Focus today to start a streak");
        int[] sz = size(c, opts, 180, 110);
        int w = Math.max(px(c, 140), sz[0] - px(c, 28)), h = px(c, 36);
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(bmp);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG); Paint tp = text(c, 10, MUTED);
        long ws = weekStart(snap, now); float cw = w / 7f, r = px(c, 7);
        for (int i = 0; i < 7; i++) {
            long d = addDays(ws, i); float cx = cw * i + cw / 2f;
            boolean hit = days.contains(key(d)), isToday = d == sod(now);
            p.setStyle(hit ? Paint.Style.FILL : Paint.Style.STROKE); p.setStrokeWidth(px(c, 2));
            p.setColor(hit ? ACCENT_2 : 0x4DFFFFFF);
            cv.drawCircle(cx, r + px(c, 2), r, p);
            tp.setColor(isToday ? Color.WHITE : MUTED); tp.setTypeface(isToday ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            cv.drawText(new SimpleDateFormat("EEEEE", Locale.getDefault()).format(new Date(d)), cx, h - px(c, 2), tp);
        }
        v.setImageViewBitmap(R.id.c_image, bmp);
        v.setOnClickPendingIntent(R.id.c_root, Notifier.openApp(c, "insights", 150));
        return v;
    }

    /* ---------- mini calendar ---------- */

    private static RemoteViews calendar(Context c, JSONObject snap, Bundle opts) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_chart);
        long now = System.currentTimeMillis();
        Calendar first = Calendar.getInstance(); first.setTimeInMillis(sod(now)); first.set(Calendar.DAY_OF_MONTH, 1);
        int month = first.get(Calendar.MONTH);
        v.setTextViewText(R.id.c_title, new SimpleDateFormat("MMMM yyyy", Locale.getDefault()).format(new Date(now)));
        v.setViewVisibility(R.id.c_big, View.GONE);
        v.setViewVisibility(R.id.c_sub, View.GONE);
        Set<String> busy = new HashSet<>();
        JSONArray tasks = today(snap).optJSONArray("tasks");
        if (tasks != null) for (int i = 0; i < tasks.length(); i++) {
            JSONObject o = tasks.optJSONObject(i); if (o == null || "completed".equals(o.optString("status"))) continue;
            if (o.optLong("start") > 0) busy.add(key(o.optLong("start")));
            if (o.optLong("due") > 0) busy.add(key(o.optLong("due")));
        }
        int[] sz = size(c, opts, 250, 250);
        int w = Math.max(px(c, 180), sz[0] - px(c, 28)), h = Math.max(px(c, 150), sz[1] - px(c, 52));
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(bmp);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG); Paint tp = text(c, 12, Color.WHITE); Paint hp = text(c, 10, MUTED);
        long start = weekStart(snap, first.getTimeInMillis());
        float cw = w / 7f, headH = px(c, 16), rh = (h - headH) / 6f;
        for (int i = 0; i < 7; i++) cv.drawText(new SimpleDateFormat("EEEEE", Locale.getDefault()).format(new Date(addDays(start, i))), cw * i + cw / 2f, headH - px(c, 4), hp);
        for (int i = 0; i < 42; i++) {
            long d = addDays(start, i); Calendar dc = Calendar.getInstance(); dc.setTimeInMillis(d);
            float cx = cw * (i % 7) + cw / 2f, cy = headH + rh * (i / 7) + rh / 2f - px(c, 2);
            boolean other = dc.get(Calendar.MONTH) != month, isToday = d == sod(now);
            if (isToday) { p.setColor(ACCENT); p.setStyle(Paint.Style.FILL); cv.drawCircle(cx, cy - px(c, 4), Math.min(cw, rh) * 0.38f, p); }
            tp.setColor(other ? 0x59FFFFFF : Color.WHITE); tp.setTypeface(isToday ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            cv.drawText(String.valueOf(dc.get(Calendar.DAY_OF_MONTH)), cx, cy, tp);
            if (busy.contains(key(d)) && !other) { p.setColor(ACCENT_2); cv.drawCircle(cx, cy + px(c, 6), px(c, 2), p); }
        }
        v.setImageViewBitmap(R.id.c_image, bmp);
        v.setOnClickPendingIntent(R.id.c_root, Notifier.openApp(c, "calendar", 160));
        return v;
    }

    /* ---------- focus music ---------- */

    private static RemoteViews music(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_music);
        boolean has = MusicSession.has;
        v.setTextViewText(R.id.m_title, has ? MusicSession.title : "Focus music");
        v.setTextViewText(R.id.m_sub, has ? MusicSession.category + (MusicSession.playing ? " · playing" : " · paused") : "Tap play to start");
        v.setImageViewResource(R.id.m_toggle, has && MusicSession.playing ? R.drawable.ic_w_pause : R.drawable.ic_w_play);
        if (has) {
            v.setOnClickPendingIntent(R.id.m_toggle, Notifier.command(c, "musicToggle", null, 171));
            v.setOnClickPendingIntent(R.id.m_next, Notifier.command(c, "musicNext", null, 172));
            v.setOnClickPendingIntent(R.id.m_prev, Notifier.command(c, "musicPrev", null, 173));
        } else {
            // Music plays inside the app: open it and start the player.
            v.setOnClickPendingIntent(R.id.m_toggle, Notifier.openApp(c, "playMusic", 174));
            v.setOnClickPendingIntent(R.id.m_next, Notifier.openApp(c, "playMusic", 175));
            v.setOnClickPendingIntent(R.id.m_prev, Notifier.openApp(c, "playMusic", 176));
        }
        v.setOnClickPendingIntent(R.id.m_root, Notifier.openApp(c, "focus", 177));
        return v;
    }

    /* ---------- screen breaks ---------- */

    private static RemoteViews screen(Context c, JSONObject snap) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_progress);
        JSONObject e = snap.optJSONObject("eye");
        long now = System.currentTimeMillis();
        v.setTextViewText(R.id.p_title, "Screen breaks");
        v.setViewVisibility(R.id.p_label2, View.GONE); v.setViewVisibility(R.id.p_value2, View.GONE); v.setViewVisibility(R.id.p_bar2, View.GONE);
        if (e == null || !e.optBoolean("enabled")) {
            v.setTextViewText(R.id.p_label1, "Turned off"); v.setTextViewText(R.id.p_value1, ""); v.setProgressBar(R.id.p_bar1, 1, 0, false);
        } else if (now < e.optLong("snoozeUntil")) {
            v.setTextViewText(R.id.p_label1, "Paused until " + Controller.time(e.optLong("snoozeUntil"), snap.optBoolean("use24h")));
            v.setTextViewText(R.id.p_value1, ""); v.setProgressBar(R.id.p_bar1, 1, 0, false);
        } else {
            long interval = Math.max(60_000L, e.optLong("intervalMs", 20 * 60_000L));
            long next = Store.getLong(c, "eyeNextAt");
            long left = next > now ? next - now : Math.max(0, interval - e.optLong("accumMs"));
            v.setTextViewText(R.id.p_label1, "Next break");
            v.setTextViewText(R.id.p_value1, "in ~" + Math.max(1, (left + 59_999) / 60_000) + " min");
            v.setProgressBar(R.id.p_bar1, 100, (int) Math.max(0, Math.min(100, 100 - left * 100 / interval)), false);
        }
        v.setViewVisibility(R.id.p_action, View.VISIBLE);
        v.setTextViewText(R.id.p_action, "Take a break now");
        v.setOnClickPendingIntent(R.id.p_action, Notifier.openApp(c, "screenBreak", 181));
        v.setOnClickPendingIntent(R.id.p_root, Notifier.openApp(c, "settings", 182));
        return v;
    }

    /* ---------- daily quote ---------- */

    private static RemoteViews quote(Context c, JSONObject snap) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_quote);
        JSONArray q = snap.optJSONArray("quotes");
        if (q != null && q.length() > 0) {
            // Same pick as the app: one quote per local calendar day.
            JSONArray item = q.optJSONArray((int) ((sod(System.currentTimeMillis()) / DAY) % q.length()));
            if (item != null) { v.setTextViewText(R.id.q_text, "“" + item.optString(0) + "”"); v.setTextViewText(R.id.q_by, "— " + item.optString(1)); }
        }
        v.setOnClickPendingIntent(R.id.q_root, Notifier.openApp(c, "home", 190));
        return v;
    }
}
