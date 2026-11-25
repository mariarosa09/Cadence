<p align="center">
  <img src="resources/icons/app-icon-512.png" alt="Cadence logo: a white hourglass on purple" width="128" height="128">
</p>

<h1 align="center">Cadence</h1>

<p align="center">Tasks, calendar, Pomodoro focus, focus music and screen-break reminders in one calm Android app.<br>
Everything stays on your phone: no account, no server, no internet needed.</p>

## Features

**In the app**

- **Tasks and calendar.** Tasks with schedules, due dates, priorities, categories, checklists and reminders. Month, week and day views.
- **Pomodoro timer and Focus Mode.** Focus sessions with short and long breaks, tied to a task if you like, with background music.
- **Do Not Disturb.** Switches the phone's DND on during focus sessions and off for breaks. Calls, repeat callers, messages and calendar events can still come through if you allow them.
- **App lock.** During focus sessions, apps you haven't allowed show a lock screen until your next break. Calls, Settings, the home screen and Cadence are always allowed.
- **Screen breaks.** Reminders to rest your eyes, with a guided countdown.
- **Focus music.** Built-in tracks generated on the device (lo-fi, ambient, rain, nature and more), plus your own uploads in any category, including *Others*.
- **Insights and goals.** Focus time, tasks completed, streaks and charts, based only on your own activity.
- **Dashboard widgets.** An empty Home tab you fill from the widget gallery.

**Outside the app**

- **Home-screen widgets:** Focus timer, Today, Upcoming schedule, Deadlines, Daily progress, Weekly focus, Focus streak, Mini calendar, Focus music, Screen breaks and Daily quote. They update as soon as anything changes in the app, every minute during a focus session, and at midnight.
- **Full-screen alerts** when a focus session, break or screen break ends. They wake the screen and play a sound with vibration.
- **Notifications** for task start and end times, deadlines, overdue tasks and the daily plan. They're scheduled with Android alarms, so they fire with the app closed and after a reboot.
- **Notification controls.** An ongoing timer notification (pause, resume, skip) and a music player in the notification shade.

Anything you do from a widget or notification is replayed into the app's data the next time it runs.

## Permissions

Cadence asks for each permission when you first use the feature that needs it. **Settings → Permissions** in the app lists them all with a switch each.

| Permission | Used for |
| --- | --- |
| Notifications | Reminders, timers and screen breaks while the app is closed |
| Full-screen alerts | Waking the screen when a session or break ends |
| Display over other apps | Showing alerts and the app lock over the app that's open |
| Usage access | Seeing which app is open, to lock apps during focus |
| Do Not Disturb access | Silencing the phone during focus sessions |
| Exact alarms (automatic) | Firing timers and reminders on time |

Google restricts several of these on the Play Store, so publishing needs a justification for each in the store listing. Installing the app directly is not affected.

## Data

Data is stored on the device (Android SharedPreferences, via Capacitor Preferences). Uploaded music is copied into the app's private storage. **Settings → Data & storage** has **Back up** (save everything to a JSON file through the share sheet) and **Restore**.

## Project layout

| Path | What it is |
| --- | --- |
| `www/` | The app interface: `index.html`, `style.css`, `script.js` (app logic), `audio.js` (music engine), `native.js` (device storage and the bridge to Android) |
| `android/` | The native Android project (Capacitor 8). Native code is in `android/app/src/main/java/app/cadence/focus/` |
| `resources/icons/` | Logo artwork: `logo-source.png` (original), `logo-mark.png` (hourglass on transparent), `app-icon-512.png` |

The main native classes:

| Class | Role |
| --- | --- |
| `CadencePlugin` | Bridge the app calls: sync state, permissions, app list, music files, widgets, vibration |
| `Controller` | Keeps alarms, notifications, Do Not Disturb and widgets in step with the app's state |
| `TimerEngine` | Native copy of the Pomodoro timer, so it keeps running while the app is closed |
| `AlertActivity`, `BlockActivity` | Full-screen alert, and the app-lock screen |
| `FocusService` | Foreground service for background music and the app lock |
| `Widgets`, `MoreWidgets` | Draw the home-screen widgets |

## Build and run

Requirements: Node 18+ and Android Studio, or a JDK 21 plus the Android SDK. Set `JAVA_HOME` to the JDK, for example Android Studio's `jbr` folder.

```sh
npm install
npx cap sync android      # copy www/ into the Android project
npx cap run android       # build and install on a connected phone
# or open it in Android Studio:
npx cap open android
# or build an APK from the command line:
cd android && ./gradlew assembleDebug   # android/app/build/outputs/apk/debug/app-debug.apk
```

After changing anything in `www/`, run `npx cap sync android` again.

For a Play Store release, create a signing key, add a `signingConfigs` block to `android/app/build.gradle`, and run `./gradlew bundleRelease`.

## Supported Android versions

Android 7.0 (API 24) and newer. Built for Android 16 (API 36).
