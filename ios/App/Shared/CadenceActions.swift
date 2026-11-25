import Foundation
import AppIntents
import WidgetKit

/// Commands from widgets, the Live Activity and lock-screen controls. The change is applied to the
/// shared timer right away (so widgets update even with the app closed) and queued with its time so
/// the app replays it into its own data the next time it runs.
enum CadenceActions {
    /// Set by the app at launch: reschedules notifications, the Live Activity and the app lock,
    /// and tells the web layer. Nil inside the widget extension.
    static var appHook: ((String, String?) -> Void)?

    static func handle(_ cmd: String, arg: String? = nil) {
        let now = SharedStore.now()
        var snap = SharedStore.snapshot
        let cfg = snap.obj("timerConfig")
        var t = SharedStore.timer
        TimerEngine.advance(&t, cfg, now: now)
        switch cmd {
        case "timerToggle":
            switch TimerEngine.status(t) {
            case "running": TimerEngine.pause(&t, at: now); SharedStore.queue(["type": "pause", "at": now])
            case "paused": TimerEngine.resume(&t, at: now); SharedStore.queue(["type": "resume", "at": now])
            default: TimerEngine.start(&t, cfg, at: now); SharedStore.queue(["type": "start", "at": now])
            }
        case "timerSkip":
            TimerEngine.skip(&t, cfg); SharedStore.queue(["type": "skip", "at": now])
        case "taskToggle", "taskDone":
            guard let id = arg else { return }
            var today = snap.obj("today"); var tasks = today.arr("tasks")
            var done = cmd == "taskDone"
            if let i = tasks.firstIndex(where: { $0.str("id") == id }) {
                if cmd == "taskToggle" { done = tasks[i].str("status") != "completed" }
                tasks[i]["status"] = done ? "completed" : "pending"
                tasks[i]["completedAt"] = done ? now : 0
            }
            today["tasks"] = tasks; snap["today"] = today; SharedStore.snapshot = snap
            SharedStore.queue(["type": "task", "id": id, "done": done, "at": now])
        case "eyeDone":
            SharedStore.queue(["type": "eye", "action": "completed", "at": now, "ms": 1000 * snap.obj("eye").num("durationSec", 20)])
        case "eyeSnooze":
            SharedStore.queue(["type": "eye", "action": "postponed", "at": now, "minutes": snap.obj("eye").int("postponeMin", 5)])
        case "musicToggle", "musicNext", "musicPrev", "musicStop":
            SharedStore.queue(["type": "music", "cmd": cmd, "at": now])
        default:
            return
        }
        SharedStore.timer = t
        WidgetCenter.shared.reloadAllTimelines()
        appHook?(cmd, arg)
    }
}

// Buttons in widgets and the Live Activity. LiveActivityIntent runs in the app's process, so the
// app can also reschedule its notifications and update the Live Activity.
@available(iOS 17.0, *)
struct TimerToggleIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Start or pause focus"
    func perform() async throws -> some IntentResult { CadenceActions.handle("timerToggle"); return .result() }
}

@available(iOS 17.0, *)
struct TimerSkipIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Skip to the next phase"
    func perform() async throws -> some IntentResult { CadenceActions.handle("timerSkip"); return .result() }
}

@available(iOS 17.0, *)
struct TaskToggleIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Tick a task off"
    @Parameter(title: "Task") var taskId: String
    init() { taskId = "" }
    init(taskId: String) { self.taskId = taskId }
    func perform() async throws -> some IntentResult { CadenceActions.handle("taskToggle", arg: taskId); return .result() }
}

@available(iOS 17.0, *)
struct MusicCommandIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Control focus music"
    @Parameter(title: "Command") var command: String
    init() { command = "musicToggle" }
    init(command: String) { self.command = command }
    func perform() async throws -> some IntentResult { CadenceActions.handle(command); return .result() }
}
