package app.cadence.focus;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.util.Set;

/**
 * Foreground service that runs while focus music plays (so it keeps playing in the background)
 * and while app lock is on during a focus session (it watches for locked apps).
 */
public class FocusService extends Service {
    static volatile boolean running = false;
    private static final long POLL_MS = 700;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean watching = false;
    private Set<String> always;
    private String lastBlocked = null;
    private long lastBlockedAt = 0;

    static boolean start(Context c) {
        try {
            ContextCompat.startForegroundService(c, new Intent(c, FocusService.class));
            return true;
        } catch (RuntimeException e) {
            return false; // not allowed from the background right now
        }
    }

    static void stop(Context c) {
        if (running) c.stopService(new Intent(c, FocusService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        JSONObject snap = Store.snapshot(this);
        JSONObject t = Store.timer(this);
        boolean music = MusicSession.has && MusicSession.playing;
        boolean lock = AppLock.active(this, snap, t);
        Notification n = music ? MusicSession.build(this) : Controller.buildOngoing(this);
        if ((!music && !lock) || n == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        int type = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && music) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
        if (Build.VERSION.SDK_INT >= 34 && lock) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
        try {
            ServiceCompat.startForeground(this, music ? Notifier.ID_MUSIC : Notifier.ID_ONGOING, n, type);
            running = true;
        } catch (RuntimeException e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (lock && !watching) { watching = true; always = AppLock.alwaysAllowed(this); handler.post(watch); }
        if (!lock) { watching = false; handler.removeCallbacks(watch); }
        return START_NOT_STICKY;
    }

    private final Runnable watch = new Runnable() {
        @Override public void run() {
            if (!watching) return;
            Context c = FocusService.this;
            JSONObject snap = Store.snapshot(c);
            JSONObject t = Store.timer(c);
            TimerEngine.advance(t, Controller.config(snap), System.currentTimeMillis());
            if (!AppLock.active(c, snap, t)) {
                watching = false;
                Controller.refresh(c);
                return;
            }
            String pkg = AppLock.foreground(c);
            if (!AppLock.isAllowed(c, pkg, snap, always)) {
                long now = System.currentTimeMillis();
                if (!pkg.equals(lastBlocked) || now - lastBlockedAt > 1500) {
                    lastBlocked = pkg; lastBlockedAt = now;
                    BlockActivity.show(c, pkg);
                }
            }
            handler.postDelayed(this, POLL_MS);
        }
    };

    @Override
    public void onDestroy() {
        running = false;
        watching = false;
        handler.removeCallbacks(watch);
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
        // Put back the plain (dismissable) timer and music notifications that are still relevant.
        Controller.postNotifications(getApplicationContext());
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
