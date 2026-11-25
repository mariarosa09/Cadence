package app.cadence.focus;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Color;
import android.os.Bundle;
import android.os.SystemClock;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StrikethroughSpan;
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

/** Renders the home-screen widgets from the stored snapshot and the native timer. */
final class Widgets {
    private static final int[] ROWS = { R.id.t_row0, R.id.t_row1, R.id.t_row2, R.id.t_row3, R.id.t_row4 };
    private static final int[] CHECKS = { R.id.t_check0, R.id.t_check1, R.id.t_check2, R.id.t_check3, R.id.t_check4 };
    private static final int[] DOTS = { R.id.t_dot0, R.id.t_dot1, R.id.t_dot2, R.id.t_dot3, R.id.t_dot4 };
    private static final int[] TIMES = { R.id.t_time0, R.id.t_time1, R.id.t_time2, R.id.t_time3, R.id.t_time4 };
    private static final int[] TITLES = { R.id.t_title0, R.id.t_title1, R.id.t_title2, R.id.t_title3, R.id.t_title4 };

    private Widgets() {}

    static void updateAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        if (m == null) return;
        JSONObject snap = Store.snapshot(c);
        for (int id : m.getAppWidgetIds(new ComponentName(c, TimerWidget.class))) m.updateAppWidget(id, timer(c, snap));
        for (int id : m.getAppWidgetIds(new ComponentName(c, TodayWidget.class))) m.updateAppWidget(id, today(c, snap, m.getAppWidgetOptions(id)));
        for (BaseWidget w : MORE) {
            for (int id : m.getAppWidgetIds(new ComponentName(c, w.getClass()))) {
                try { m.updateAppWidget(id, MoreWidgets.render(c, w.kind(), snap, m.getAppWidgetOptions(id))); } catch (RuntimeException ignored) {}
            }
        }
    }

    private static final BaseWidget[] MORE = {
        new UpcomingWidget(), new DeadlinesWidget(), new ProgressWidget(), new WeeklyWidget(), new StreakWidget(),
        new CalendarWidget(), new MusicWidget(), new ScreenBreakWidget(), new QuoteWidget(),
    };

    /* ---------- focus timer widget ---------- */

    static RemoteViews timer(Context c, JSONObject snap) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_timer);
        JSONObject cfg = Controller.config(snap);
        JSONObject t = Store.timer(c);
        long now = System.currentTimeMillis();
        String phase = TimerEngine.phase(t);
        String status = TimerEngine.status(t);
        boolean isBreak = !"focus".equals(phase);

        v.setInt(R.id.w_root, "setBackgroundResource", isBreak ? R.drawable.widget_bg_break : R.drawable.widget_bg);
        v.setTextViewText(R.id.w_phase, (TimerEngine.label(phase) + ("paused".equals(status) ? " · paused" : "")).toUpperCase(Locale.getDefault()));

        if ("running".equals(status)) {
            long base = SystemClock.elapsedRealtime() + (t.optLong("endAt") - now);
            v.setChronometer(R.id.w_chrono, base, null, true);
            v.setChronometerCountDown(R.id.w_chrono, true);
            v.setViewVisibility(R.id.w_chrono, View.VISIBLE);
            v.setViewVisibility(R.id.w_time, View.GONE);
        } else {
            v.setChronometer(R.id.w_chrono, SystemClock.elapsedRealtime(), null, false);
            v.setViewVisibility(R.id.w_chrono, View.GONE);
            v.setViewVisibility(R.id.w_time, View.VISIBLE);
            v.setTextViewText(R.id.w_time, Controller.clock(TimerEngine.remaining(t, cfg, now)));
        }

        String task = cfg.optString("taskTitle", "");
        String sub;
        if (!task.isEmpty() && !isBreak) sub = task;
        else if ("idle".equals(status)) sub = isBreak ? "Break is ready" : "Tap play to start focusing";
        else sub = isBreak ? "Rest away from the screen" : "No task selected";
        v.setTextViewText(R.id.w_task, sub);

        v.setImageViewResource(R.id.w_toggle, "running".equals(status) ? R.drawable.ic_w_pause : R.drawable.ic_w_play);
        v.setContentDescription(R.id.w_toggle, "running".equals(status) ? "Pause" : "idle".equals(status) ? "Start" : "Resume");
        v.setOnClickPendingIntent(R.id.w_toggle, Notifier.command(c, "timerToggle", null, 41));
        v.setOnClickPendingIntent(R.id.w_skip, Notifier.command(c, "timerSkip", null, 42));
        v.setContentDescription(R.id.w_skip, isBreak ? "Skip break" : "End focus early");
        v.setOnClickPendingIntent(R.id.w_root, Notifier.openApp(c, "focus", 43));
        return v;
    }

    /* ---------- today widget ---------- */

    private static final class Row {
        String id, title, status;
        long start, end, due, completedAt;
        int color;
        boolean done() { return "completed".equals(status); }
        long sortKey() { return start > 0 ? start : due > 0 ? due : Long.MAX_VALUE; }
        long deadline() { return due > 0 ? due : end; }
    }

    static RemoteViews today(Context c, JSONObject snap, Bundle options) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_today);
        boolean h24 = snap.optBoolean("use24h");
        JSONObject today = snap.optJSONObject("today");
        if (today == null) today = new JSONObject();
        long now = System.currentTimeMillis();

        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0); cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0);
        long a = cal.getTimeInMillis();
        cal.add(Calendar.DAY_OF_MONTH, 1);
        long b = cal.getTimeInMillis();
        String todayKey = dayKey(a);

        List<Row> rows = new ArrayList<>();
        JSONArray tasks = today.optJSONArray("tasks");
        if (tasks != null) {
            for (int i = 0; i < tasks.length(); i++) {
                JSONObject o = tasks.optJSONObject(i);
                if (o == null) continue;
                Row r = new Row();
                r.id = o.optString("id"); r.title = o.optString("title"); r.status = o.optString("status", "pending");
                r.start = o.optLong("start"); r.end = o.optLong("end"); r.due = o.optLong("due"); r.completedAt = o.optLong("completedAt");
                try { r.color = Color.parseColor(o.optString("color", "#8364e8")); } catch (IllegalArgumentException e) { r.color = 0xFF8364E8; }
                boolean touches = (r.start > 0 && r.end > 0 && r.start < b && r.end > a) || (r.due >= a && r.due < b);
                boolean doneToday = r.done() && r.completedAt >= a && r.completedAt < b;
                if (touches || doneToday || (!r.done() && "inprogress".equals(r.status))) rows.add(r);
            }
        }
        int done = 0;
        for (Row r : rows) if (r.done()) done++;
        Collections.sort(rows, (x, y) -> {
            if (x.done() != y.done()) return x.done() ? 1 : -1;
            return Long.compare(x.sortKey(), y.sortKey());
        });

        v.setTextViewText(R.id.t_date, new SimpleDateFormat("EEEE, MMM d", Locale.getDefault()).format(new Date(now)));

        JSONObject ft = today.optJSONObject("focusToday");
        long focusMs = (ft != null && todayKey.equals(ft.optString("day")) ? ft.optLong("ms") : 0) + liveFocusMs(c, snap);
        int goal = today.optInt("goalMin", 100);
        int streak = streak(today.optJSONArray("focusDays"), a);
        String stats = done + "/" + rows.size() + " tasks · " + (focusMs / 60_000L) + "/" + goal + " min focus"
            + (streak > 0 ? " · " + streak + "-day streak" : "");
        v.setTextViewText(R.id.t_stats, stats);
        v.setProgressBar(R.id.t_progress, Math.max(1, rows.size()), done, false);

        int maxRows = ROWS.length;
        if (options != null) {
            int h = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
            if (h > 0) maxRows = Math.max(1, Math.min(ROWS.length, (h - 96) / 34));
        }
        for (int i = 0; i < ROWS.length; i++) {
            if (i >= rows.size() || i >= maxRows) { v.setViewVisibility(ROWS[i], View.GONE); continue; }
            Row r = rows.get(i);
            v.setViewVisibility(ROWS[i], View.VISIBLE);
            v.setImageViewResource(CHECKS[i], r.done() ? R.drawable.ic_w_check_on : R.drawable.ic_w_check_off);
            v.setContentDescription(CHECKS[i], (r.done() ? "Mark not done: " : "Mark done: ") + r.title);
            v.setTextColor(DOTS[i], r.color);
            String when = "";
            if (r.start > 0 && r.start < b && r.end > a) when = r.start < a ? "Ongoing" : Controller.time(r.start, h24);
            else if (r.due > 0) when = "Due " + Controller.time(r.due, h24);
            v.setTextViewText(TIMES[i], when);
            boolean overdue = !r.done() && r.deadline() > 0 && r.deadline() < now;
            v.setTextColor(TIMES[i], overdue ? 0xFFFF8A9B : 0xB3FFFFFF);
            CharSequence title = r.title;
            if (r.done()) {
                SpannableString s = new SpannableString(r.title);
                s.setSpan(new StrikethroughSpan(), 0, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                title = s;
            }
            v.setTextViewText(TITLES[i], title);
            v.setTextColor(TITLES[i], r.done() ? 0x99FFFFFF : 0xFFFFFFFF);
            v.setOnClickPendingIntent(CHECKS[i], Notifier.command(c, "taskToggle", r.id, 60 + i));
            v.setOnClickPendingIntent(ROWS[i], Notifier.openApp(c, "tasks", 70 + i));
        }
        int hidden = Math.max(0, rows.size() - maxRows);
        v.setViewVisibility(R.id.t_more, hidden > 0 ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.t_more, "+" + hidden + " more");
        v.setViewVisibility(R.id.t_empty, rows.isEmpty() ? View.VISIBLE : View.GONE);

        v.setOnClickPendingIntent(R.id.t_add, Notifier.openApp(c, "newTask", 51));
        v.setOnClickPendingIntent(R.id.t_header, Notifier.openApp(c, "home", 52));
        v.setOnClickPendingIntent(R.id.t_empty, Notifier.openApp(c, "newTask", 53));
        return v;
    }

    /** Minutes of the focus session running now, so widgets match the app's "Focus today". */
    static long liveFocusMs(Context c, JSONObject snap) {
        JSONObject t = Store.timer(c);
        if (!"focus".equals(TimerEngine.phase(t)) || !TimerEngine.active(t)) return 0;
        JSONObject cfg = Controller.config(snap);
        long total = t.optLong("total", TimerEngine.phaseTotal(cfg, "focus"));
        return Math.max(0, total - TimerEngine.remaining(t, cfg, System.currentTimeMillis()));
    }

    private static String dayKey(long ms) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date(ms));
    }

    private static int streak(JSONArray days, long startOfToday) {
        if (days == null) return 0;
        Set<String> set = new HashSet<>();
        for (int i = 0; i < days.length(); i++) set.add(days.optString(i));
        Calendar d = Calendar.getInstance();
        d.setTimeInMillis(startOfToday);
        if (!set.contains(dayKey(d.getTimeInMillis()))) d.add(Calendar.DAY_OF_MONTH, -1);
        int n = 0;
        while (set.contains(dayKey(d.getTimeInMillis())) && n < 10000) { n++; d.add(Calendar.DAY_OF_MONTH, -1); }
        return n;
    }
}
