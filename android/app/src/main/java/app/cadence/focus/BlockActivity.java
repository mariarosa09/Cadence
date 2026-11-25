package app.cadence.focus;

import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.widget.Chronometer;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;

/** Full-screen lock shown over an app the user has not allowed during a focus session. */
public class BlockActivity extends AppCompatActivity {
    static final String EXTRA_PKG = "pkg";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_block);
        bind(getIntent());
        findViewById(R.id.b_cadence).setOnClickListener(v -> {
            startActivity(new Intent(this, MainActivity.class).putExtra(Notifier.EXTRA_OPEN, "focus")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
            finish();
        });
        findViewById(R.id.b_home).setOnClickListener(v -> goHome());
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { goHome(); }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        bind(intent);
    }

    private void bind(Intent intent) {
        String pkg = intent.getStringExtra(EXTRA_PKG);
        ((TextView) findViewById(R.id.b_title)).setText(getString(R.string.block_title, AppLock.label(this, pkg)));
        long endAt = Store.timer(this).optLong("endAt");
        Chronometer ch = findViewById(R.id.b_chrono);
        if (TimerEngine.running(Store.timer(this)) && endAt > System.currentTimeMillis()) {
            ch.setBase(SystemClock.elapsedRealtime() + (endAt - System.currentTimeMillis()));
            ch.setCountDown(true);
            ch.start();
        } else {
            ch.setText(R.string.block_paused);
        }
    }

    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable watch = new Runnable() {
        @Override public void run() {
            if (!AppLock.active(BlockActivity.this, Store.snapshot(BlockActivity.this), Store.timer(BlockActivity.this))) { finish(); return; }
            handler.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onResume() {
        super.onResume();
        handler.post(watch);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(watch);
        super.onPause();
    }

    private void goHome() {
        startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        finish();
    }

    /** Covers {@code pkg} with the lock screen. Needs "display over other apps" to start from the background. */
    static void show(android.content.Context c, String pkg) {
        Intent i = new Intent(c, BlockActivity.class).putExtra(EXTRA_PKG, pkg)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        try { c.startActivity(i); } catch (RuntimeException ignored) {}
    }
}
