package app.cadence.focus;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fires when a timer phase ends, a reminder is due or a screen break is due; also after reboot. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Context c = context.getApplicationContext();
        String action = intent.getAction();
        Notifier.ensureChannels(c);
        if (Controller.ALARM_EYE.equals(action)) Controller.onEyeAlarm(c);
        else Controller.refresh(c);
    }
}
