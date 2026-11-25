import Foundation
import FamilyControls
import ManagedSettings
import DeviceActivity

/// App lock with Apple's Screen Time API: during a focus session every app except the ones the
/// user allowed is shielded. The selection is stored in the App Group so the Screen Time
/// extension can lift the shield when the session ends, even if Cadence is closed.
enum AppLock {
    static let store = ManagedSettingsStore(named: ManagedSettingsStore.Name("cadence.focus"))
    static let activity = DeviceActivityName("cadence.focus.session")

    static var allowed: FamilyActivitySelection {
        get {
            guard let d = SharedStore.defaults.data(forKey: "allowedApps"),
                  let s = try? JSONDecoder().decode(FamilyActivitySelection.self, from: d) else { return FamilyActivitySelection() }
            return s
        }
        set { SharedStore.defaults.set(try? JSONEncoder().encode(newValue), forKey: "allowedApps") }
    }

    static var allowedCount: Int { allowed.applicationTokens.count + allowed.categoryTokens.count }

    static var authorized: Bool { AuthorizationCenter.shared.authorizationStatus == .approved }

    /// Shields every app except the allowed ones.
    static func apply() {
        let sel = allowed
        store.shield.applicationCategories = .all(except: sel.applicationTokens)
        store.shield.webDomainCategories = .all(except: sel.webDomainTokens)
        SharedStore.defaults.set(true, forKey: "shieldOn")
    }

    static func clear() {
        store.clearAllSettings()
        SharedStore.defaults.set(false, forKey: "shieldOn")
    }

    static var shieldOn: Bool { SharedStore.defaults.bool(forKey: "shieldOn") }

    /// Lock while a focus phase runs: apply the shield now, and ask Screen Time to call the
    /// extension when the phase ends (Screen Time intervals must be at least 15 minutes long).
    static func sync(shouldLock: Bool, endAt: Double) {
        guard authorized else { if shieldOn { clear() }; return }
        let center = DeviceActivityCenter()
        if shouldLock {
            if !shieldOn { apply() }
            let end = Date(timeIntervalSince1970: endAt / 1000)
            let start = min(Date(), end.addingTimeInterval(-15 * 60 - 30))
            let cal = Calendar.current
            let comps: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
            let schedule = DeviceActivitySchedule(intervalStart: cal.dateComponents(comps, from: start),
                                                  intervalEnd: cal.dateComponents(comps, from: end), repeats: false)
            center.stopMonitoring([activity])
            try? center.startMonitoring(activity, during: schedule)
        } else {
            if shieldOn { clear() }
            center.stopMonitoring([activity])
        }
    }
}
