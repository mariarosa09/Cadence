package app.cadence.focus;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.CountDownTimer;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONObject;

import java.util.Locale;

/**
 * Full-screen alert that wakes the screen and shows over the lock screen and other apps when a
 * focus session or break ends, or when a screen break is due.
 */
public class AlertActivity extends AppCompatActivity {
    static final String EXTRA_KIND = "kind";
    static final String KIND_FOCUS_END = "focusEnd";
    static final String KIND_BREAK_END = "breakEnd";
    static final String KIND_SCREEN = "screen";

    private CountDownTimer countdown;
    /** When the screen break ends (epoch ms). Kept across rotation so the countdown doesn't restart. */
    private long eyeEndAt = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_alert);
        if (savedInstanceState != null) eyeEndAt = savedInstanceState.getLong("eyeEndAt", 0);
        bind(getIntent());
        if (savedInstanceState == null) announce(); // sound and vibration only once, not on rotation
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putLong("eyeEndAt", eyeEndAt);
    }

    private android.media.Ringtone ringtone;

    /** Sound and vibration, following the user's Cadence settings and the phone's ringer mode. */
    private void announce() {
        JSONObject alerts = Store.snapshot(this).optJSONObject("alerts");
        boolean sound = alerts == null || alerts.optBoolean("sound", true);
        boolean vibrate = alerts == null || alerts.optBoolean("vibrate", true);
        android.media.AudioManager am = (android.media.AudioManager) getSystemService(Context.AUDIO_SERVICE);
        int mode = am != null ? am.getRingerMode() : android.media.AudioManager.RINGER_MODE_NORMAL;
        if (vibrate && mode != android.media.AudioManager.RINGER_MODE_SILENT) Notifier.vibrate(this, Notifier.VIBRATION);
        if (sound && mode == android.media.AudioManager.RINGER_MODE_NORMAL) {
            try {
                ringtone = android.media.RingtoneManager.getRingtone(this, android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION));
                if (ringtone != null) {
                    ringtone.setAudioAttributes(new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_ALARM)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
                    ringtone.play();
                }
            } catch (RuntimeException ignored) {}
        }
    }

    /** True when the system will open this alert from a full-screen notification (screen off or locked). */
    static boolean fullScreenWillShow(Context c) {
        android.os.PowerManager pm = (android.os.PowerManager) c.getSystemService(Context.POWER_SERVICE);
        KeyguardManager km = (KeyguardManager) c.getSystemService(Context.KEYGUARD_SERVICE);
        boolean asleepOrLocked = (pm != null && !pm.isInteractive()) || (km != null && km.isKeyguardLocked());
        android.app.NotificationManager nm = c.getSystemService(android.app.NotificationManager.class);
        boolean allowed = Build.VERSION.SDK_INT < 34 || (nm != null && nm.canUseFullScreenIntent());
        return asleepOrLocked && allowed;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        eyeEndAt = 0; // a new alert starts a new countdown
        bind(intent);
        announce();
    }

    private void bind(Intent intent) {
        if (countdown != null) countdown.cancel();
        String kind = intent.getStringExtra(EXTRA_KIND);
        if (kind == null) kind = KIND_FOCUS_END;
        TextView label = findViewById(R.id.a_label), title = findViewById(R.id.a_title), body = findViewById(R.id.a_body), big = findViewById(R.id.a_big);
        Button primary = findViewById(R.id.a_primary), secondary = findViewById(R.id.a_secondary);
        JSONObject t = Store.timer(this);
        big.setVisibility(View.GONE);
        switch (kind) {
            case KIND_SCREEN: {
                JSONObject e = Store.snapshot(this).optJSONObject("eye");
                int secs = e != null ? e.optInt("durationSec", 20) : 20;
                int snooze = e != null ? e.optInt("postponeMin", 5) : 5;
                label.setText(R.string.alert_screen_label);
                title.setText(R.string.alert_screen_title);
                body.setText(R.string.alert_screen_body);
                big.setVisibility(View.VISIBLE);
                if (eyeEndAt == 0) eyeEndAt = System.currentTimeMillis() + secs * 1000L;
                long left = Math.max(0, eyeEndAt - System.currentTimeMillis());
                big.setText(clock(left));
                countdown = new CountDownTimer(left, 250) {
                    @Override public void onTick(long left) { big.setText(clock(left)); }
                    @Override public void onFinish() { big.setText(R.string.alert_screen_done); primary.setText(R.string.alert_done); }
                }.start();
                primary.setText(R.string.alert_done);
                secondary.setText(getString(R.string.alert_snooze, snooze));
                primary.setOnClickListener(v -> act("eyeDone"));
                secondary.setOnClickListener(v -> act("eyeSnooze"));
                break;
            }
            case KIND_BREAK_END:
                label.setText(R.string.alert_break_label);
                title.setText(R.string.alert_break_title);
                body.setText(R.string.alert_break_body);
                primary.setText(R.string.alert_start_focus);
                secondary.setText(R.string.alert_not_now);
                primary.setOnClickListener(v -> act(TimerEngine.active(Store.timer(this)) ? null : "timerToggle"));
                secondary.setOnClickListener(v -> finishAndRemoveTask());
                break;
            default: {
                String next = TimerEngine.label(TimerEngine.phase(t)).toLowerCase(Locale.ROOT);
                label.setText(R.string.alert_focus_label);
                title.setText(R.string.alert_focus_title);
                boolean running = TimerEngine.running(t);
                body.setText(running ? getString(R.string.alert_focus_body_running, next) : getString(R.string.alert_focus_body_idle, next));
                primary.setText(running ? R.string.alert_ok : R.string.alert_start_break);
                secondary.setText(R.string.alert_skip_break);
                primary.setOnClickListener(v -> act(running ? null : "timerToggle"));
                secondary.setOnClickListener(v -> act("timerSkip"));
            }
        }
        findViewById(R.id.a_open).setOnClickListener(v -> {
            startActivity(new Intent(this, MainActivity.class).putExtra(Notifier.EXTRA_OPEN, "focus")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
            finishAndRemoveTask();
        });
    }

    private void act(String cmd) {
        if (cmd != null) ActionReceiver.handle(getApplicationContext(), cmd, null);
        Notifier.cancel(this, Notifier.ID_PHASE);
        Notifier.cancel(this, Notifier.ID_EYE);
        finishAndRemoveTask();
    }

    @Override
    protected void onDestroy() {
        if (countdown != null) countdown.cancel();
        if (ringtone != null) ringtone.stop();
        super.onDestroy();
    }

    private static String clock(long ms) {
        long s = (ms + 999) / 1000;
        return s >= 60 ? String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60) : String.valueOf(s);
    }

    static Intent intent(Context c, String kind) {
        return new Intent(c, AlertActivity.class).putExtra(EXTRA_KIND, kind)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
    }

    /** Shows the alert over whatever is on screen right now (needs "display over other apps"). */
    static boolean showNow(Context c, String kind) {
        KeyguardManager km = (KeyguardManager) c.getSystemService(Context.KEYGUARD_SERVICE);
        boolean locked = km != null && km.isKeyguardLocked();
        if (locked || !AppLock.canOverlay(c)) return false; // the full-screen notification covers a locked or sleeping phone
        try { c.startActivity(intent(c, kind)); return true; } catch (RuntimeException e) { return false; }
    }
}
