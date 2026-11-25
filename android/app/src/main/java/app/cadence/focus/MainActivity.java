package app.cadence.focus;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CadencePlugin.class);
        super.onCreate(savedInstanceState);
        // Draw behind the status and navigation bars on every Android version; the page pads
        // itself with the safe-area insets, so the app uses the full height of the screen.
        // Must run after super.onCreate(): touching the window earlier locks in the launch theme.
        EdgeToEdge.enable(this);
    }
}
