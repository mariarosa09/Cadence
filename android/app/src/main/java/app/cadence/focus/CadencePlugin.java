package app.cadence.focus;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
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

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
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
            Controller.musicPlaying = music != null && music.optBoolean("playing");
            Controller.musicTitle = music != null ? music.optString("title", "") : "";
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
