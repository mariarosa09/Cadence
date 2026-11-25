package app.cadence.focus;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/** Shared provider for the dashboard widgets drawn by {@link MoreWidgets}. */
public abstract class BaseWidget extends AppWidgetProvider {
    abstract String kind();

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        Controller.refresh(context.getApplicationContext());
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle newOptions) {
        Widgets.updateAll(context.getApplicationContext());
    }
}
