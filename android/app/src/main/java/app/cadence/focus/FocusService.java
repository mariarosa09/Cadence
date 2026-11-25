package app.cadence.focus;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Foreground service that runs while focus music is playing, so Android keeps the app alive and
 * the music keeps playing when you switch to another app or lock the screen.
 */
public class FocusService extends Service {
    static volatile boolean running = false;

    static boolean start(Context c) {
        try {
            ContextCompat.startForegroundService(c, new Intent(c, FocusService.class));
            return true;
        } catch (RuntimeException e) {
            // Starting from the background is not allowed in some states; the plain notification is used instead.
            return false;
        }
    }

    static void stop(Context c) {
        if (!running) return;
        c.stopService(new Intent(c, FocusService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = Controller.buildOngoing(this);
        if (n == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            ServiceCompat.startForeground(this, Notifier.ID_ONGOING, n,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0);
            running = true;
        } catch (RuntimeException e) {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        // Keep the notification if a timer is still running (it is then updated as a plain notification).
        boolean keep = Controller.buildOngoing(this) != null;
        ServiceCompat.stopForeground(this, keep ? ServiceCompat.STOP_FOREGROUND_DETACH : ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
