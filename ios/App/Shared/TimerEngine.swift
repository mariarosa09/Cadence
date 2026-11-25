import Foundation

/// Native copy of the Pomodoro state machine in script.js (and in the Android TimerEngine), so
/// widgets, notifications and the Live Activity agree with the app while it is closed.
/// Times are epoch milliseconds.
enum TimerEngine {
    typealias State = [String: Any]
    static let minute: Double = 60_000

    static func phase(_ t: State) -> String { t.str("phase", "focus") }
    static func status(_ t: State) -> String { t.str("status", "idle") }
    static func running(_ t: State) -> Bool { status(t) == "running" }
    static func active(_ t: State) -> Bool { status(t) != "idle" }

    static func total(_ cfg: [String: Any], _ phase: String) -> Double {
        switch phase {
        case "short": return cfg.num("shortMs", 5 * minute)
        case "long": return cfg.num("longMs", 15 * minute)
        default: return cfg.num("focusMs", 25 * minute)
        }
    }

    static func remaining(_ t: State, _ cfg: [String: Any], now: Double) -> Double {
        switch status(t) {
        case "running": return max(0, t.num("endAt") - now)
        case "paused": return t.num("remaining")
        default: return total(cfg, phase(t))
        }
    }

    static func start(_ t: inout State, _ cfg: [String: Any], at: Double) {
        let len = total(cfg, phase(t))
        t["total"] = len; t["endAt"] = at + len; t["status"] = "running"
    }

    static func pause(_ t: inout State, at: Double) {
        guard running(t) else { return }
        t["remaining"] = max(0, t.num("endAt") - at); t["status"] = "paused"
    }

    static func resume(_ t: inout State, at: Double) {
        guard status(t) == "paused" else { return }
        t["endAt"] = at + t.num("remaining"); t["status"] = "running"
    }

    static func skip(_ t: inout State, _ cfg: [String: Any]) {
        let cycle = t.int("cycle")
        if phase(t) == "focus" {
            t["phase"] = (cycle + 1) % max(1, cfg.int("interval", 4)) == 0 ? "long" : "short"
        } else {
            if phase(t) == "long" { t["cycle"] = 0 }
            t["phase"] = "focus"
        }
        t["status"] = "idle"
    }

    /// Completes every phase that ended by `now`; returns the phases that ended, in order.
    @discardableResult
    static func advance(_ t: inout State, _ cfg: [String: Any], now: Double) -> [String] {
        var ended: [String] = []
        var guardCount = 0
        while running(t) && now >= t.num("endAt") && guardCount < 12 {
            guardCount += 1
            let p = phase(t); let at = t.num("endAt")
            ended.append(p)
            if p == "focus" {
                let cycle = t.int("cycle") + 1
                t["cycle"] = cycle
                t["phase"] = cycle % max(1, cfg.int("interval", 4)) == 0 ? "long" : "short"
                t["status"] = "idle"
                if cfg.bool("autoTransition", true) { start(&t, cfg, at: at) }
            } else {
                if p == "long" { t["cycle"] = 0 }
                t["phase"] = "focus"; t["status"] = "idle"
            }
        }
        return ended
    }

    /// Upcoming phase changes (time, state after the change), for widget timelines and notifications.
    static func future(_ t: State, _ cfg: [String: Any], now: Double, limit: Int = 6) -> [(at: Double, ended: String, state: State)] {
        var s = t; var out: [(at: Double, ended: String, state: State)] = []
        while running(s) && out.count < limit {
            let at = s.num("endAt"); let p = phase(s)
            advance(&s, cfg, now: at)
            out.append((at: at, ended: p, state: s))
        }
        return out
    }

    static func label(_ phase: String) -> String {
        switch phase { case "short": return "Short break"; case "long": return "Long break"; default: return "Focus" }
    }
}
