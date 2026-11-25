import DeviceActivity
import ManagedSettings
import Foundation

/// Runs (even with Cadence closed) when the Screen Time interval for a focus session ends, and
/// lifts the app lock unless a focus session is still running.
class CadenceMonitor: DeviceActivityMonitor {
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        var t = SharedStore.timer
        TimerEngine.advance(&t, SharedStore.snapshot.obj("timerConfig"), now: SharedStore.now())
        let stillFocusing = TimerEngine.phase(t) == "focus" && TimerEngine.running(t)
        if !stillFocusing { AppLock.clear() }
    }
}
