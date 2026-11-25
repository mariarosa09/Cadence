import Foundation
import ActivityKit

/// Live Activity for a running focus session or break (lock screen and Dynamic Island).
struct CadenceTimerAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var phase: String          // focus | short | long
        var running: Bool
        var endAt: Date            // when running
        var remaining: Double      // seconds left, when paused
        var task: String
    }
}
