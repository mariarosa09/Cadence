import WidgetKit
import SwiftUI
import ActivityKit
import AppIntents

/// Lock screen and Dynamic Island countdown for a running focus session or break.
struct TimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CadenceTimerAttributes.self) { context in
            LockScreenTimer(state: context.state)
                .padding(16)
                .activityBackgroundTint(Palette.bgBottom)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(TimerEngine.label(context.state.phase), systemImage: context.state.phase == "focus" ? "hourglass" : "cup.and.saucer.fill")
                        .font(.caption.bold()).foregroundStyle(Palette.accent2)
                }
                DynamicIslandExpandedRegion(.trailing) { countdown(context.state).font(.title3.monospacedDigit()).foregroundStyle(.white) }
                DynamicIslandExpandedRegion(.bottom) { controls(context.state) }
            } compactLeading: {
                Image(systemName: "hourglass").foregroundStyle(Palette.accent2)
            } compactTrailing: {
                countdown(context.state).monospacedDigit().frame(maxWidth: 52)
            } minimal: {
                Image(systemName: "hourglass").foregroundStyle(Palette.accent2)
            }
            .widgetURL(URL(string: "cadence://open/focus"))
        }
    }
}

@ViewBuilder
func countdown(_ s: CadenceTimerAttributes.ContentState) -> some View {
    if s.running {
        Text(timerInterval: Date()...max(Date(), s.endAt), countsDown: true)
    } else {
        let left = Int(s.remaining)
        Text(String(format: "%02d:%02d", left / 60, left % 60))
    }
}

@ViewBuilder
func controls(_ s: CadenceTimerAttributes.ContentState) -> some View {
    HStack(spacing: 12) {
        Button(intent: TimerToggleIntent()) {
            Label(s.running ? "Pause" : "Resume", systemImage: s.running ? "pause.fill" : "play.fill").frame(maxWidth: .infinity)
        }.tint(Palette.accent)
        Button(intent: TimerSkipIntent()) {
            Label(s.phase == "focus" ? "End early" : "Skip break", systemImage: "forward.fill").frame(maxWidth: .infinity)
        }.tint(.white.opacity(0.25))
    }
    .buttonStyle(.borderedProminent)
    .font(.caption.bold())
}

struct LockScreenTimer: View {
    let state: CadenceTimerAttributes.ContentState
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(TimerEngine.label(state.phase).uppercased() + (state.running ? "" : " · PAUSED")).font(.caption2.bold()).foregroundStyle(Palette.accent2).tracking(1)
                    Text(state.task.isEmpty ? (state.phase == "focus" ? "Focus session" : "Rest away from the screen") : state.task)
                        .font(.subheadline.bold()).foregroundStyle(.white).lineLimit(1)
                }
                Spacer()
                countdown(state).font(.system(size: 36, weight: .light, design: .rounded)).monospacedDigit().foregroundStyle(.white)
                    .multilineTextAlignment(.trailing).frame(maxWidth: 140, alignment: .trailing)
            }
            controls(state)
        }
    }
}
