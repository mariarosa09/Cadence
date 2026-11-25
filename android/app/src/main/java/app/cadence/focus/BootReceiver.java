package app.cadence.focus;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarms are cleared on reboot, app update and clock changes: schedule them again. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)
            && !Intent.ACTION_TIME_CHANGED.equals(a) && !Intent.ACTION_TIMEZONE_CHANGED.equals(a)
            && !"android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED".equals(a)) return;
        Context c = context.getApplicationContext();
        Notifier.ensureChannels(c);
        Controller.refresh(c);
    }
}
