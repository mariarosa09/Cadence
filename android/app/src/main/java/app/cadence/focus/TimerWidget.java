package app.cadence.focus;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/** Home-screen focus timer: live countdown with start/pause and skip. */
public class TimerWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        Controller.refresh(context.getApplicationContext());
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle newOptions) {
        Widgets.updateAll(context.getApplicationContext());
    }
}
