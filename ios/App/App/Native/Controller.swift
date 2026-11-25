import Foundation
import UIKit
import UserNotifications
import ActivityKit
import WidgetKit

/// Brings everything outside the app in step with the current state: timer and reminder
/// notifications, the iOS 26 alarm, the Live Activity, the app lock and the widgets.
/// iOS can't run app code at a set time, so all future alerts are scheduled up front.
enum Controller {
    static var foreground = true
    private static let center = UNUserNotificationCenter.current()

    static func refresh() {
        let now = SharedStore.now()
        let snap = SharedStore.snapshot
        let cfg = snap.obj("timerConfig")
        var t = SharedStore.timer
        TimerEngine.advance(&t, cfg, now: now)
        SharedStore.timer = t

        scheduleNotifications(snap: snap, cfg: cfg, timer: t, now: now)
        AlarmController.sync(snap: snap, cfg: cfg, timer: t, now: now)
        LiveActivityController.sync(snap: snap, cfg: cfg, timer: t)
        let focusing = TimerEngine.phase(t) == "focus" && TimerEngine.active(t)
        AppLock.sync(shouldLock: focusing && snap.obj("lock").bool("enabled"), endAt: TimerEngine.running(t) ? t.num("endAt") : now + 4 * 3600_000)
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: notifications

    private static func content(_ title: String, _ body: String, sound: Bool, timeSensitive: Bool, info: [String: Any] = [:]) -> UNMutableNotificationContent {
        let c = UNMutableNotificationContent()
        c.title = title; c.body = body; c.userInfo = info
        if sound { c.sound = .default }
        if timeSensitive { c.interruptionLevel = .timeSensitive }
        return c
    }

    private static func request(_ id: String, at: Double, _ c: UNMutableNotificationContent) -> UNNotificationRequest? {
        let secs = (at - SharedStore.now()) / 1000
        guard secs > 0.5 else { return nil }
        return UNNotificationRequest(identifier: id, content: c, trigger: UNTimeIntervalNotificationTrigger(timeInterval: secs, repeats: false))
    }

    /// iOS keeps at most 64 pending notifications per app: timer and screen breaks first, then reminders.
    static func scheduleNotifications(snap: [String: Any], cfg: [String: Any], timer: [String: Any], now: Double) {
        center.getPendingNotificationRequests { pending in
            let ours = pending.map(\.identifier).filter { $0.hasPrefix("cad.") }
            center.removePendingNotificationRequests(withIdentifiers: ours)
            var reqs: [UNNotificationRequest] = []
            let alerts = snap.obj("alerts"); let sound = alerts.bool("sound", true)
            let cats = snap.obj("notif")

            // Timer: every phase change ahead (with automatic breaks). On iOS 26 the alarm covers the next one.
            let usingAlarm = AlarmController.handlesNextPhase
            for (i, step) in TimerEngine.future(timer, cfg, now: now).enumerated() where !(i == 0 && usingAlarm) {
                let focusEnded = step.ended == "focus"
                if focusEnded && !cats.bool("pomodoro", true) { continue }
                if !focusEnded && !cats.bool("breakDone", true) { continue }
                let next = TimerEngine.label(TimerEngine.phase(step.state)).lowercased()
                let body = focusEnded ? (TimerEngine.running(step.state) ? "Your \(next) has started. Step away from the screen." : "Time for a \(next).") : "Ready for another focus session?"
                let c = content(focusEnded ? "Focus session complete" : "Break finished", body, sound: sound, timeSensitive: true, info: ["kind": "phase"])
                c.categoryIdentifier = focusEnded ? "FOCUS_END" : "BREAK_END"
                if let r = request("cad.timer.\(i)", at: step.at, c) { reqs.append(r) }
            }

            // Screen breaks while Cadence is in the background (iOS can't tell if the screen is on).
            let eye = snap.obj("eye")
            if !foreground && eye.bool("enabled") && cats.bool("screenBreak", true) {
                let interval = max(60_000, eye.num("intervalMs", 20 * 60_000))
                var at = now + max(15_000, interval - eye.num("accumMs"))
                if at < eye.num("snoozeUntil") { at = eye.num("snoozeUntil") + interval }
                let secs = eye.int("durationSec", 20)
                for i in 0..<12 {
                    let c = content("Screen break", "Look at something about 20 feet away for \(secs >= 60 ? "\(secs / 60) min" : "\(secs) seconds").",
                                    sound: sound, timeSensitive: true, info: ["kind": "eye"])
                    c.categoryIdentifier = "SCREEN_BREAK"
                    if let r = request("cad.eye.\(i)", at: at, c) { reqs.append(r) }
                    at += interval
                }
            }

            // Task reminders, soonest first, in the space that is left.
            for r in snap.arr("reminders") {
                if reqs.count >= 60 { break }
                let key = r.str("key")
                let c = content(r.str("title"), r.str("body"), sound: sound, timeSensitive: r.str("cat") != "daily",
                                info: ["kind": "reminder", "key": key, "cat": r.str("cat"), "at": r.num("at"), "taskId": r.str("taskId")])
                if !r.str("taskId").isEmpty && ["endApproach", "overdue", "deadline"].contains(r.str("cat")) { c.categoryIdentifier = "TASK_DUE" }
                if let q = request("cad.rem.\(key)", at: r.num("at"), c) { reqs.append(q) }
            }
            reqs.forEach { center.add($0) }
        }
    }

    /// Reminders delivered while Cadence was away go into its notification history.
    static func collectDelivered(_ done: @escaping () -> Void) {
        center.getDeliveredNotifications { list in
            for n in list {
                let info = n.request.content.userInfo
                guard info["kind"] as? String == "reminder", let key = info["key"] as? String else { continue }
                SharedStore.queue(["type": "delivered", "key": key, "at": (info["at"] as? NSNumber)?.doubleValue ?? SharedStore.now(),
                                   "cat": info["cat"] as? String ?? "upcoming", "title": n.request.content.title, "body": n.request.content.body])
            }
            done()
        }
    }

    static func registerCategories() {
        let startBreak = UNNotificationAction(identifier: "timerToggle", title: "Start break")
        let skipBreak = UNNotificationAction(identifier: "timerSkip", title: "Skip break")
        let startFocus = UNNotificationAction(identifier: "timerToggle", title: "Start focus")
        let done = UNNotificationAction(identifier: "eyeDone", title: "Done")
        let snooze = UNNotificationAction(identifier: "eyeSnooze", title: "Snooze")
        let markDone = UNNotificationAction(identifier: "taskDone", title: "Mark done")
        center.setNotificationCategories([
            UNNotificationCategory(identifier: "FOCUS_END", actions: [startBreak, skipBreak], intentIdentifiers: []),
            UNNotificationCategory(identifier: "BREAK_END", actions: [startFocus], intentIdentifiers: []),
            UNNotificationCategory(identifier: "SCREEN_BREAK", actions: [done, snooze], intentIdentifiers: []),
            UNNotificationCategory(identifier: "TASK_DUE", actions: [markDone], intentIdentifiers: []),
        ])
    }
}

/// Lock-screen and Dynamic Island countdown while a session or break runs.
enum LiveActivityController {
    static func sync(snap: [String: Any], cfg: [String: Any], timer t: [String: Any]) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let state = CadenceTimerAttributes.ContentState(
            phase: TimerEngine.phase(t), running: TimerEngine.running(t),
            endAt: Date(timeIntervalSince1970: t.num("endAt") / 1000),
            remaining: TimerEngine.remaining(t, cfg, now: SharedStore.now()) / 1000,
            task: TimerEngine.phase(t) == "focus" ? cfg.str("taskTitle") : "")
        let current = Activity<CadenceTimerAttributes>.activities
        Task {
            if !TimerEngine.active(t) {
                for a in current { await a.end(nil, dismissalPolicy: .immediate) }
            } else if let a = current.first {
                await a.update(ActivityContent(state: state, staleDate: nil))
            } else {
                _ = try? Activity.request(attributes: CadenceTimerAttributes(), content: ActivityContent(state: state, staleDate: nil))
            }
        }
    }
}
