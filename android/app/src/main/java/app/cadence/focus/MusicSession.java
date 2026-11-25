package app.cadence.focus;

import android.app.Notification;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;

/**
 * Focus music in the notification shade and lock screen: a media session with play/pause,
 * previous and next, driven by the music player in the app.
 */
final class MusicSession {
    private static MediaSessionCompat session;
    private static Bitmap art;

    /** What the app last reported: is a track loaded, is it playing, and its title and category. */
    static volatile boolean has = false;
    static volatile boolean playing = false;
    static volatile String title = "";
    static volatile String category = "";

    private MusicSession() {}

    private static MediaSessionCompat session(Context c) {
        if (session != null) return session;
        Context app = c.getApplicationContext();
        session = new MediaSessionCompat(app, "CadenceMusic");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { ActionReceiver.handle(app, "musicToggle", null); }
            @Override public void onPause() { ActionReceiver.handle(app, "musicToggle", null); }
            @Override public void onSkipToNext() { ActionReceiver.handle(app, "musicNext", null); }
            @Override public void onSkipToPrevious() { ActionReceiver.handle(app, "musicPrev", null); }
            @Override public void onStop() { ActionReceiver.handle(app, "musicStop", null); }
        });
        return session;
    }

    private static Bitmap art(Context c) {
        if (art == null) art = BitmapFactory.decodeResource(c.getResources(), R.drawable.music_art);
        return art;
    }

    static Notification build(Context c) {
        MediaSessionCompat s = session(c);
        s.setMetadata(new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, category)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "Cadence focus music")
            .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art(c))
            .build());
        s.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_STOP)
            .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build());
        s.setActive(true);

        return Notifier.builder(c, Notifier.CH_MUSIC)
            .setContentTitle(title)
            .setContentText(category)
            .setSubText("Focus music")
            .setLargeIcon(art(c))
            .setOngoing(playing).setAutoCancel(false).setOnlyAlertOnce(true).setSilent(true).setVibrate(null).setDefaults(0).setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setContentIntent(Notifier.openApp(c, "focus", 81))
            .setDeleteIntent(Notifier.command(c, "musicStop", null, 85))
            .addAction(R.drawable.ic_w_prev, "Previous", Notifier.command(c, "musicPrev", null, 82))
            .addAction(playing ? R.drawable.ic_w_pause : R.drawable.ic_w_play, playing ? "Pause" : "Play", Notifier.command(c, "musicToggle", null, 83))
            .addAction(R.drawable.ic_w_next, "Next", Notifier.command(c, "musicNext", null, 84))
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(s.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2))
            .build();
    }

    static void release() {
        if (session != null) { session.setActive(false); session.release(); session = null; }
    }
}
