import Foundation

/// State shared by the app, the widgets and the Screen Time extension (App Group storage).
/// The web layer owns the user's data; this holds the snapshot it publishes, the native copy of
/// the timer, and actions taken outside the app that the app replays the next time it runs.
enum SharedStore {
    static let group = "group.app.cadence.focus"
    static var defaults: UserDefaults { UserDefaults(suiteName: group) ?? .standard }

    static func now() -> Double { Date().timeIntervalSince1970 * 1000 }

    static func json(_ key: String) -> [String: Any] {
        guard let s = defaults.string(forKey: key), let d = s.data(using: .utf8),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return [:] }
        return o
    }

    static func setJSON(_ key: String, _ value: Any) {
        guard JSONSerialization.isValidJSONObject(value),
              let d = try? JSONSerialization.data(withJSONObject: value),
              let s = String(data: d, encoding: .utf8) else { return }
        defaults.set(s, forKey: key)
    }

    static var snapshot: [String: Any] {
        get { json("snapshot") }
        set { setJSON("snapshot", newValue) }
    }

    static var timer: [String: Any] {
        get {
            let t = json("timer")
            return t["phase"] == nil ? ["phase": "focus", "status": "idle", "endAt": 0, "remaining": 0, "total": 0, "cycle": 0] : t
        }
        set { setJSON("timer", newValue) }
    }

    private static let lock = NSLock()

    static func queue(_ action: [String: Any]) {
        lock.lock(); defer { lock.unlock() }
        var list = actions()
        list.append(action)
        if list.count > 300 { list.removeFirst(list.count - 300) }
        setJSON("actions", list)
    }

    static func takeActions() -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        let list = actions()
        defaults.removeObject(forKey: "actions")
        return list
    }

    static var hasActions: Bool { !actions().isEmpty }

    private static func actions() -> [[String: Any]] {
        guard let s = defaults.string(forKey: "actions"), let d = s.data(using: .utf8),
              let a = try? JSONSerialization.jsonObject(with: d) as? [[String: Any]] else { return [] }
        return a
    }
}

/// Small helpers for reading the loosely typed JSON snapshot.
extension Dictionary where Key == String, Value == Any {
    func num(_ k: String, _ d: Double = 0) -> Double { (self[k] as? NSNumber)?.doubleValue ?? d }
    func int(_ k: String, _ d: Int = 0) -> Int { (self[k] as? NSNumber)?.intValue ?? d }
    func str(_ k: String, _ d: String = "") -> String { self[k] as? String ?? d }
    func bool(_ k: String, _ d: Bool = false) -> Bool { (self[k] as? NSNumber)?.boolValue ?? d }
    func obj(_ k: String) -> [String: Any] { self[k] as? [String: Any] ?? [:] }
    func arr(_ k: String) -> [[String: Any]] { self[k] as? [[String: Any]] ?? [] }
}
