import Foundation
import SwiftUI
#if canImport(AlarmKit)
import AlarmKit
#endif

/// iOS 26+: when a focus session or break ends, show a full-screen alarm (like the Clock app) that
/// plays a sound and wakes the phone, even in silent mode. Older iOS uses a time-sensitive notification.
enum AlarmController {
    /// True when the next phase change is announced by an alarm instead of a notification.
    static var handlesNextPhase: Bool {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) { return AlarmStore.authorized }
        #endif
        return false
    }

    static func requestAuthorization() async -> Bool {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) { return await AlarmStore.request() }
        #endif
        return false
    }

    static func sync(snap: [String: Any], cfg: [String: Any], timer t: [String: Any], now: Double) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) { AlarmStore.sync(cfg: cfg, timer: t, now: now) }
        #endif
    }
}

#if canImport(AlarmKit)
@available(iOS 26.0, *)
struct CadenceAlarmMetadata: AlarmMetadata {}

@available(iOS 26.0, *)
enum AlarmStore {
    static var authorized: Bool { AlarmManager.shared.authorizationState == .authorized }

    static func request() async -> Bool {
        (try? await AlarmManager.shared.requestAuthorization()) == .authorized
    }

    private static var currentId: UUID? {
        get { SharedStore.defaults.string(forKey: "alarmId").flatMap(UUID.init(uuidString:)) }
        set { SharedStore.defaults.set(newValue?.uuidString, forKey: "alarmId") }
    }

    static func sync(cfg: [String: Any], timer t: [String: Any], now: Double) {
        guard authorized else { return }
        if let id = currentId { try? AlarmManager.shared.cancel(id: id); currentId = nil }
        guard TimerEngine.running(t), t.num("endAt") > now + 1000 else { return }
        let focusEnds = TimerEngine.phase(t) == "focus"
        let alert = AlarmPresentation.Alert(
            title: focusEnds ? "Focus session complete" : "Break finished",
            stopButton: AlarmButton(text: "Done", textColor: .white, systemImageName: "checkmark"),
            secondaryButton: AlarmButton(text: focusEnds ? "Skip break" : "Start focus", textColor: .white, systemImageName: focusEnds ? "forward.fill" : "play.fill"),
            secondaryButtonBehavior: .custom)
        let attributes = AlarmAttributes<CadenceAlarmMetadata>(presentation: AlarmPresentation(alert: alert), metadata: CadenceAlarmMetadata(), tintColor: Color(red: 0.51, green: 0.39, blue: 0.91))
        let id = UUID()
        let config = AlarmManager.AlarmConfiguration<CadenceAlarmMetadata>(
            schedule: .fixed(Date(timeIntervalSince1970: t.num("endAt") / 1000)),
            attributes: attributes,
            secondaryIntent: focusEnds ? TimerSkipIntent() : TimerToggleIntent())
        Task {
            if (try? await AlarmManager.shared.schedule(id: id, configuration: config)) != nil { currentId = id }
        }
    }
}
#endif
