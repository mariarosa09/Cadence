package app.cadence.focus;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.database.Cursor;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import android.graphics.Color;
import android.view.Window;

import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;

/**
 * Bridge between the app's web layer and Android: publishes state for widgets, alarms and
 * notifications, hands back actions taken outside the app, and exposes system permissions.
 */
@CapacitorPlugin(
    name = "CadenceNative",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class CadencePlugin extends Plugin {
    private static WeakReference<CadencePlugin> current = new WeakReference<>(null);

    @Override
    public void load() {
        current = new WeakReference<>(this);
        Notifier.ensureChannels(getContext());
        Store.foreground = true;
        if (getActivity() != null) handleIntent(getActivity().getIntent());
    }

    /** Tells the web layer that actions are waiting in the queue. */
    static void emitActions() {
        CadencePlugin p = current.get();
        if (p != null) p.notifyListeners("actions", new JSObject());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleIntent(intent);
    }

    private Boolean appearanceDark = null;
    private int appearanceColor = 0;

    /** Matches the system bar icons and the area behind the bars to the app's light/dark theme. */
    @PluginMethod
    public void setAppearance(PluginCall call) {
        appearanceDark = call.getBoolean("dark", false);
        String color = call.getString("color", appearanceDark ? "#110E19" : "#F6F3FC");
        try { appearanceColor = Color.parseColor(color); } catch (IllegalArgumentException e) { appearanceColor = appearanceDark ? 0xFF110E19 : 0xFFF6F3FC; }
        getBridge().executeOnMainThread(() -> {
            applyAppearance();
            // Window setup at startup (edge-to-edge, system bars) can reset the bar style just
            // after this runs, so apply it once more when that has settled.
            if (getActivity() != null) getActivity().getWindow().getDecorView().postDelayed(this::applyAppearance, 400);
            call.resolve();
        });
    }

    private void applyAppearance() {
        if (appearanceDark == null || getActivity() == null) return;
        Window w = getActivity().getWindow();
        w.getDecorView().setBackgroundColor(appearanceColor);
        if (getBridge().getWebView() != null) getBridge().getWebView().setBackgroundColor(appearanceColor);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
        c.setAppearanceLightStatusBars(!appearanceDark);
        c.setAppearanceLightNavigationBars(!appearanceDark);
        // Some vendor builds re-derive the bar style from the legacy flags, so keep them in step too.
        android.view.View d = w.getDecorView();
        int flags = d.getSystemUiVisibility();
        int light = android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0);
        d.setSystemUiVisibility(appearanceDark ? (flags & ~light) : (flags | light));
    }

    @Override
    protected void handleOnConfigurationChanged(android.content.res.Configuration newConfig) {
        super.handleOnConfigurationChanged(newConfig);
        // The system-bars plugin resets the bars on configuration changes: re-apply the app's theme.
        getBridge().executeOnMainThread(this::applyAppearance);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        applyAppearance();
        if (getActivity() != null) getActivity().getWindow().getDecorView().postDelayed(this::applyAppearance, 400);
        Store.foreground = true;
        Notifier.cancel(getContext(), Notifier.ID_EYE);
        Controller.refresh(getContext());
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        Store.foreground = false;
        Store.putLong(getContext(), "eyeNextAt", 0);
        Controller.refresh(getContext());
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String open = intent.getStringExtra(Notifier.EXTRA_OPEN);
        if (open == null) return;
        intent.removeExtra(Notifier.EXTRA_OPEN);
        Store.queue(getContext(), Store.obj("type", "open", "screen", open, "at", System.currentTimeMillis()));
        emitActions();
    }

    /** Receives the app state the widgets, alarms and notifications are built from. */
    @PluginMethod
    public void sync(PluginCall call) {
        JSObject state = call.getObject("state");
        if (state == null) { call.reject("Missing state"); return; }
        Context c = getContext();
        synchronized (Controller.class) {
            JSONObject music = state.optJSONObject("music");
            MusicSession.has = music != null && music.optBoolean("has");
            MusicSession.playing = music != null && music.optBoolean("playing");
            MusicSession.title = music != null ? music.optString("title", "") : "";
            MusicSession.category = music != null ? music.optString("category", "") : "";
            JSONObject timer = state.optJSONObject("timer");
            state.remove("timer");
            Store.saveSnapshot(c, state);
            // Actions not yet replayed by the app win over the app's older copy of the timer.
            if (timer != null && !Store.hasActions(c)) Store.saveTimer(c, timer);
        }
        Controller.refresh(c);
        call.resolve();
    }

    @PluginMethod
    public void takeActions(PluginCall call) {
        JSONArray a = Store.takeActions(getContext());
        JSObject res = new JSObject();
        try { res.put("actions", new JSArray(a.toString())); } catch (JSONException e) { res.put("actions", new JSArray()); }
        call.resolve(res);
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    private JSObject statusObject() {
        Context c = getContext();
        JSObject o = new JSObject();
        String notif;
        if (Notifier.enabled(c)) notif = "granted";
        else if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.DENIED
            && !Store.getBool(c, "notifAsked")) notif = "prompt";
        else notif = "denied";
        o.put("notifications", notif);
        o.put("exactAlarms", Controller.canExact(c));
        o.put("dndAccess", Dnd.hasAccess(c));
        o.put("dndActive", Dnd.activeByUs(c));
        o.put("overlay", AppLock.canOverlay(c));
        o.put("usageAccess", AppLock.hasUsageAccess(c));
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        o.put("fullScreen", Build.VERSION.SDK_INT < 34 || (nm != null && nm.canUseFullScreenIntent()));
        return o;
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Notifier.enabled(getContext()) || Build.VERSION.SDK_INT < 33) {
            call.resolve(statusObject());
            return;
        }
        if (Store.getBool(getContext(), "notifAsked") && getPermissionState("notifications") == PermissionState.DENIED) {
            openAppNotificationSettings();
            call.resolve(statusObject());
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsResult");
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        Store.putBool(getContext(), "notifAsked", true);
        Controller.refresh(getContext());
        call.resolve(statusObject());
    }

    /** Opens a system settings screen: "notifications", "exactAlarms" or "dnd". */
    @PluginMethod
    public void openSettings(PluginCall call) {
        String which = call.getString("which", "notifications");
        Context c = getContext();
        try {
            if ("exactAlarms".equals(which) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + c.getPackageName())));
            } else if ("dnd".equals(which)) {
                startActivity(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
            } else if ("overlay".equals(which)) {
                startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + c.getPackageName())));
            } else if ("usage".equals(which)) {
                startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));
            } else if ("fullScreen".equals(which) && Build.VERSION.SDK_INT >= 34) {
                startActivity(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + c.getPackageName())));
            } else {
                openAppNotificationSettings();
            }
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Settings screen not available");
        }
    }

    private void openAppNotificationSettings() {
        Context c = getContext();
        Intent i;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName());
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.getPackageName()));
        }
        startActivity(i);
    }

    private void startActivity(Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
    }

    @PluginMethod
    public void vibrate(PluginCall call) {
        JSArray arr = call.getArray("pattern");
        long[] pattern;
        try {
            java.util.List<Object> list = arr != null ? arr.toList() : new java.util.ArrayList<>();
            pattern = new long[list.size() + 1];
            for (int i = 0; i < list.size(); i++) pattern[i + 1] = ((Number) list.get(i)).longValue();
        } catch (Exception e) {
            pattern = new long[] { 0, 60 };
        }
        if (pattern.length < 2) pattern = new long[] { 0, 60 };
        Notifier.vibrate(getContext(), pattern);
        call.resolve();
    }

    /** Asks the launcher to add one of Cadence's widgets to the phone's home screen. */
    @PluginMethod
    public void pinWidget(PluginCall call) {
        Class<?> cls;
        switch (call.getString("kind", "")) {
            case "timer": cls = TimerWidget.class; break;
            case "today": cls = TodayWidget.class; break;
            case "upcoming": cls = UpcomingWidget.class; break;
            case "deadlines": cls = DeadlinesWidget.class; break;
            case "progress": cls = ProgressWidget.class; break;
            case "weekly": cls = WeeklyWidget.class; break;
            case "streak": cls = StreakWidget.class; break;
            case "calendar": cls = CalendarWidget.class; break;
            case "music": cls = MusicWidget.class; break;
            case "screen": cls = ScreenBreakWidget.class; break;
            default: cls = QuoteWidget.class;
        }
        android.appwidget.AppWidgetManager m = android.appwidget.AppWidgetManager.getInstance(getContext());
        boolean ok = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && m.isRequestPinAppWidgetSupported()
            && m.requestPinAppWidget(new android.content.ComponentName(getContext(), cls), null, null);
        call.resolve(new JSObject().put("supported", ok));
    }

    /** Launchable apps with icons, for choosing which apps stay usable during focus. */
    @PluginMethod
    public void listApps(PluginCall call) {
        new Thread(() -> {
            JSObject res = new JSObject();
            try { res.put("apps", new JSArray(AppLock.listApps(getContext()).toString())); } catch (JSONException e) { res.put("apps", new JSArray()); }
            call.resolve(res);
        }).start();
    }

    /** Lets the user pick audio files; copies them into the app's private storage. */
    @PluginMethod
    public void pickAudio(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("audio/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, i, "pickAudioResult");
    }

    @ActivityCallback
    private void pickAudioResult(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) { call.resolve(new JSObject().put("files", new JSArray())); return; }
        List<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
        else if (data.getData() != null) uris.add(data.getData());
        new Thread(() -> {
            JSArray files = new JSArray();
            File dir = new File(getContext().getFilesDir(), "music");
            if (!dir.exists()) dir.mkdirs();
            for (Uri uri : uris) {
                String name = displayName(uri);
                String ext = name.contains(".") ? name.substring(name.lastIndexOf('.')).toLowerCase(java.util.Locale.ROOT) : ".mp3";
                if (!ext.matches("\\.[a-z0-9]{1,5}")) ext = ".mp3";
                File out = new File(dir, UUID.randomUUID() + ext);
                try (InputStream in = getContext().getContentResolver().openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
                    if (in == null) continue;
                    byte[] buf = new byte[64 * 1024]; int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                    JSObject f = new JSObject();
                    f.put("name", name.contains(".") ? name.substring(0, name.lastIndexOf('.')) : name);
                    f.put("path", out.getAbsolutePath());
                    f.put("size", out.length());
                    files.put(f);
                } catch (Exception e) {
                    out.delete();
                }
            }
            call.resolve(new JSObject().put("files", files));
        }).start();
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) { String n = c.getString(0); if (n != null) return n; }
        } catch (Exception ignored) {}
        String last = uri.getLastPathSegment();
        return last != null ? last : "Track";
    }

    /** Deletes an uploaded track (only files inside the app's music folder). */
    @PluginMethod
    public void deleteAudio(PluginCall call) {
        String path = call.getString("path", "");
        File dir = new File(getContext().getFilesDir(), "music");
        File f = new File(path);
        try {
            if (f.getCanonicalPath().startsWith(dir.getCanonicalPath() + File.separator)) f.delete();
        } catch (java.io.IOException ignored) {}
        call.resolve();
    }

    /** Writes a file to the app cache and opens the share sheet so the user can save or send it. */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String name = call.getString("filename", "cadence-export.json");
        String text = call.getString("text", "");
        String mime = call.getString("mimeType", "application/json");
        try {
            File dir = new File(getContext().getCacheDir(), "exports");
            if (!dir.exists() && !dir.mkdirs()) throw new java.io.IOException("Cannot create export folder");
            File f = new File(dir, name.replaceAll("[^A-Za-z0-9._-]", "_"));
            try (Writer w = new OutputStreamWriter(new FileOutputStream(f), StandardCharsets.UTF_8)) { w.write(text); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "Save or share Cadence data");
            if (getActivity() != null) getActivity().startActivity(chooser);
            else startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not export: " + e.getMessage());
        }
    }

}
