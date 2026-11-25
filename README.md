# Cadence

Tasks, calendar, Pomodoro focus, focus music and screen-break reminders, as an Android app.

## Layout

| Path | What it is |
| --- | --- |
| `www/` | The app UI (HTML/CSS/JS). `native.js` holds on-device storage and the bridge to Android. |
| `android/` | The native Android project (Capacitor). Native code is in `android/app/src/main/java/app/cadence/focus/`. |
| `resources/icons/` | Source artwork for the launcher icon. |

## What runs outside the app

- **Home-screen widgets.** *Focus timer* is a live countdown with start, pause and skip. *Today* shows today's tasks, the focus goal and your streak; tap a circle to tick a task off.
- **Notifications** for task start and end times, deadlines, overdue tasks, the daily plan, finished sessions and breaks, and screen breaks. They are scheduled with Android alarms, so they fire while the app is closed and after a reboot.
- **Ongoing notification** while a session runs, with Pause, Resume and Skip buttons.
- **Do Not Disturb.** The phone's real DND turns on during focus sessions, with the calls, messages and events you allow, and turns off for breaks.
- **Focus music** keeps playing in the background.

Anything done from a widget or notification is replayed into the app's data the next time the app runs.

## Data

Everything is stored on the device (Android SharedPreferences, via Capacitor Preferences). There is no account, server or network access. Back up and Restore are in **Settings → Data & storage**.

## Build

Requirements: Node 18+, Android Studio (or JDK 21 plus the Android SDK).

```sh
npm install
npx cap sync android          # copy www/ into the Android project
npx cap open android          # open in Android Studio, then Run
# or from the command line:
cd android && ./gradlew assembleDebug   # APK: android/app/build/outputs/apk/debug/app-debug.apk
```

After editing anything in `www/`, run `npx cap sync android` again.

For a Play Store release, create a signing key, add a `signingConfigs` block to `android/app/build.gradle`, and run `./gradlew bundleRelease`.
