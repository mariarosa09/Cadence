import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Palette

enum Palette {
    static let bgTop = Color(red: 0.165, green: 0.125, blue: 0.27)
    static let bgBottom = Color(red: 0.10, green: 0.078, blue: 0.19)
    static let breakTop = Color(red: 0.086, green: 0.247, blue: 0.231)
    static let breakBottom = Color(red: 0.067, green: 0.165, blue: 0.18)
    static let accent = Color(red: 0.514, green: 0.392, blue: 0.91)
    static let accent2 = Color(red: 0.827, green: 0.592, blue: 0.98)
    static let muted = Color.white.opacity(0.7)
    static let danger = Color(red: 1, green: 0.54, blue: 0.61)
    static func background(breakTime: Bool = false) -> LinearGradient {
        LinearGradient(colors: breakTime ? [breakTop, breakBottom] : [bgTop, bgBottom], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

// MARK: - Data

struct CadenceEntry: TimelineEntry {
    let date: Date
    let snap: [String: Any]
    let timer: [String: Any]

    var now: Double { date.timeIntervalSince1970 * 1000 }
    var cfg: [String: Any] { snap.obj("timerConfig") }
    var today: [String: Any] { snap.obj("today") }
    var use24h: Bool { snap.bool("use24h") }
    var tasks: [[String: Any]] { today.arr("tasks") }

    func time(_ ms: Double) -> String {
        let f = DateFormatter(); f.dateFormat = use24h ? "H:mm" : "h:mm a"
        return f.string(from: Date(timeIntervalSince1970: ms / 1000))
    }

    func when(_ ms: Double) -> String {
        let cal = Calendar.current; let d = Date(timeIntervalSince1970: ms / 1000)
        let day = cal.isDateInToday(d) ? "Today" : cal.isDateInTomorrow(d) ? "Tomorrow" : d.formatted(.dateTime.weekday(.abbreviated).day())
        return "\(day), \(time(ms))"
    }

    static func key(_ d: Date) -> String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f.string(from: d) }

    /// Focus time on a day, including the session running at this entry's time.
    func focusMs(on day: Date) -> Double {
        var ms = today.obj("focusByDay").num(Self.key(day))
        if Calendar.current.isDate(day, inSameDayAs: date), TimerEngine.phase(timer) == "focus", TimerEngine.active(timer) {
            ms += max(0, timer.num("total", TimerEngine.total(cfg, "focus")) - TimerEngine.remaining(timer, cfg, now: now))
        }
        return ms
    }

    func weekDays() -> [Date] {
        let cal = Calendar.current; let start = cal.startOfDay(for: date)
        let ws = snap.int("weekStart", 0); let dow = cal.component(.weekday, from: start) - 1
        let first = cal.date(byAdding: .day, value: -((dow - ws + 7) % 7), to: start)!
        return (0..<7).map { cal.date(byAdding: .day, value: $0, to: first)! }
    }

    var focusDays: Set<String> { Set((today["focusDays"] as? [String]) ?? []) }

    var streak: Int {
        let cal = Calendar.current; var d = cal.startOfDay(for: date)
        if !focusDays.contains(Self.key(d)) { d = cal.date(byAdding: .day, value: -1, to: d)! }
        var n = 0
        while focusDays.contains(Self.key(d)) && n < 10000 { n += 1; d = cal.date(byAdding: .day, value: -1, to: d)! }
        return n
    }

    /// Tasks touching today (or completed today), unfinished first.
    var todayTasks: [[String: Any]] {
        let cal = Calendar.current; let a = cal.startOfDay(for: date).timeIntervalSince1970 * 1000; let b = a + 86_400_000
        return tasks.filter { t in
            let touches = (t.num("start") > 0 && t.num("end") > 0 && t.num("start") < b && t.num("end") > a) || (t.num("due") >= a && t.num("due") < b)
            let doneToday = t.str("status") == "completed" && t.num("completedAt") >= a && t.num("completedAt") < b
            return touches || doneToday || (t.str("status") == "inprogress")
        }.sorted { x, y in
            let dx = x.str("status") == "completed", dy = y.str("status") == "completed"
            if dx != dy { return !dx }
            func k(_ t: [String: Any]) -> Double { t.num("start") > 0 ? t.num("start") : t.num("due") > 0 ? t.num("due") : .greatestFiniteMagnitude }
            return k(x) < k(y)
        }
    }
}

struct CadenceProvider: TimelineProvider {
    func placeholder(in context: Context) -> CadenceEntry { CadenceEntry(date: Date(), snap: [:], timer: SharedStore.timer) }

    func getSnapshot(in context: Context, completion: @escaping (CadenceEntry) -> Void) { completion(entry(at: Date())) }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CadenceEntry>) -> Void) {
        let now = Date()
        var dates: Set<Date> = [now]
        // Every upcoming phase change, and every few minutes so "focus today" keeps counting.
        let t = SharedStore.timer; let cfg = SharedStore.snapshot.obj("timerConfig")
        for step in TimerEngine.future(t, cfg, now: now.timeIntervalSince1970 * 1000) { dates.insert(Date(timeIntervalSince1970: step.at / 1000 + 0.5)) }
        for i in 1...12 { dates.insert(now.addingTimeInterval(Double(i) * 300)) }
        if let midnight = Calendar.current.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0, second: 30), matchingPolicy: .nextTime) { dates.insert(midnight) }
        let entries = dates.sorted().map { entry(at: $0) }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(3600))))
    }

    private func entry(at date: Date) -> CadenceEntry {
        let snap = SharedStore.snapshot
        var t = SharedStore.timer
        TimerEngine.advance(&t, snap.obj("timerConfig"), now: date.timeIntervalSince1970 * 1000)
        return CadenceEntry(date: date, snap: snap, timer: t)
    }
}

// MARK: - Building blocks

struct Header: View {
    let icon: String; let title: String; var link: String? = nil
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon).foregroundStyle(Palette.accent2).font(.caption.bold())
            Text(title).font(.subheadline.bold()).foregroundStyle(.white).lineLimit(1)
            Spacer(minLength: 0)
            if let link { Link(destination: URL(string: "cadence://open/\(link)")!) { Image(systemName: "plus.circle.fill").font(.title3).foregroundStyle(Palette.accent) } }
        }
    }
}

struct Bar: View {
    let value: Double; var color: Color = Palette.accent2
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.15))
                Capsule().fill(color).frame(width: max(0, min(1, value)) * g.size.width)
            }
        }.frame(height: 6)
    }
}

func durText(_ ms: Double) -> String {
    let m = Int((ms / 60_000).rounded())
    return m < 60 ? "\(m)m" : "\(m / 60)h" + (m % 60 > 0 ? " \(m % 60)m" : "")
}

func color(_ hex: String) -> Color {
    var v: UInt64 = 0; Scanner(string: hex.replacingOccurrences(of: "#", with: "")).scanHexInt64(&v)
    return Color(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
}

extension View {
    func cadenceBackground(breakTime: Bool = false) -> some View {
        containerBackground(for: .widget) { Palette.background(breakTime: breakTime) }
    }
}

// MARK: - Widgets

struct TimerView: View {
    let e: CadenceEntry
    var body: some View {
        let t = e.timer; let phase = TimerEngine.phase(t); let status = TimerEngine.status(t); let isBreak = phase != "focus"
        VStack(spacing: 4) {
            Text((TimerEngine.label(phase) + (status == "paused" ? " · paused" : "")).uppercased())
                .font(.caption2.bold()).foregroundStyle(Palette.accent2).tracking(1)
            Group {
                if status == "running" {
                    Text(timerInterval: e.date...Date(timeIntervalSince1970: max(e.now, t.num("endAt")) / 1000), countsDown: true)
                } else {
                    let s = Int(TimerEngine.remaining(t, e.cfg, now: e.now) / 1000)
                    Text(String(format: "%02d:%02d", s / 60, s % 60))
                }
            }
            .font(.system(size: 34, weight: .light, design: .rounded)).monospacedDigit().foregroundStyle(.white).multilineTextAlignment(.center)
            Text(!isBreak && !e.cfg.str("taskTitle").isEmpty ? e.cfg.str("taskTitle") : status == "idle" ? (isBreak ? "Break is ready" : "Tap play to start") : (isBreak ? "Rest away from the screen" : "No task selected"))
                .font(.caption).foregroundStyle(Palette.muted).lineLimit(1)
            HStack(spacing: 12) {
                Button(intent: TimerToggleIntent()) {
                    Image(systemName: status == "running" ? "pause.fill" : "play.fill").font(.title3).frame(width: 44, height: 44)
                        .background(Circle().fill(Palette.accent)).foregroundStyle(.white)
                }.buttonStyle(.plain)
                Button(intent: TimerSkipIntent()) {
                    Image(systemName: "forward.fill").font(.callout).frame(width: 36, height: 36)
                        .background(Circle().fill(Color.white.opacity(0.15))).foregroundStyle(.white)
                }.buttonStyle(.plain)
            }.padding(.top, 4)
        }
        .widgetURL(URL(string: "cadence://open/focus"))
        .cadenceBackground(breakTime: isBreak)
    }
}

struct TodayView: View {
    let e: CadenceEntry
    @Environment(\.widgetFamily) var family
    var body: some View {
        let list = e.todayTasks; let done = list.filter { $0.str("status") == "completed" }.count
        let focus = e.focusMs(on: e.date); let goal = max(1, e.today.num("goalMin", 100))
        let rows = family == .systemLarge ? 8 : 3
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(e.date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())).font(.subheadline.bold()).foregroundStyle(.white)
                    Text("\(done)/\(list.count) tasks · \(Int(focus / 60_000))/\(Int(goal)) min" + (e.streak > 0 ? " · \(e.streak)-day streak" : ""))
                        .font(.caption2).foregroundStyle(Palette.muted).lineLimit(1)
                }
                Spacer()
                Link(destination: URL(string: "cadence://open/newTask")!) { Image(systemName: "plus.circle.fill").font(.title2).foregroundStyle(Palette.accent) }
            }
            Bar(value: list.isEmpty ? 0 : Double(done) / Double(list.count))
            if list.isEmpty {
                Text("Nothing planned today. Tap + to add a task.").font(.caption).foregroundStyle(Palette.muted)
            }
            ForEach(Array(list.prefix(rows).enumerated()), id: \.offset) { _, t in
                let isDone = t.str("status") == "completed"
                HStack(spacing: 8) {
                    Button(intent: TaskToggleIntent(taskId: t.str("id"))) {
                        Image(systemName: isDone ? "checkmark.circle.fill" : "circle").foregroundStyle(isDone ? Palette.accent : Palette.muted)
                    }.buttonStyle(.plain)
                    Circle().fill(color(t.str("color", "#8364e8"))).frame(width: 6, height: 6)
                    Text(t.str("title")).font(.caption).foregroundStyle(isDone ? Palette.muted : .white).strikethrough(isDone).lineLimit(1)
                    Spacer(minLength: 4)
                    Text(t.num("start") > 0 ? e.time(t.num("start")) : t.num("due") > 0 ? "Due \(e.time(t.num("due")))" : "")
                        .font(.caption2).foregroundStyle(!isDone && max(t.num("due"), t.num("end")) > 0 && max(t.num("due"), t.num("end")) < e.now ? Palette.danger : Palette.muted)
                }
            }
            Spacer(minLength: 0)
        }
        .widgetURL(URL(string: "cadence://open/tasks"))
        .cadenceBackground()
    }
}

struct ListView: View {
    let e: CadenceEntry; let deadlines: Bool
    @Environment(\.widgetFamily) var family
    var body: some View {
        let key = deadlines ? "due" : "start"
        let items = e.tasks.filter { $0.str("status") != "completed" && (deadlines ? $0.num("due") > 0 : ($0.num("start") > 0 && $0.num("end") > e.now)) }
            .sorted { $0.num(key) < $1.num(key) }
        VStack(alignment: .leading, spacing: 6) {
            Header(icon: deadlines ? "flag.fill" : "calendar", title: deadlines ? "Upcoming deadlines" : "Upcoming schedule", link: "newTask")
            if items.isEmpty {
                Text(deadlines ? "No deadlines. Tasks with due dates show up here." : "Nothing scheduled. Give a task a start time.").font(.caption).foregroundStyle(Palette.muted)
            }
            ForEach(Array(items.prefix(family == .systemLarge ? 9 : 4).enumerated()), id: \.offset) { _, t in
                let at = t.num(key); let overdue = deadlines && at < e.now
                HStack(spacing: 8) {
                    Circle().fill(color(t.str("color", "#8364e8"))).frame(width: 7, height: 7)
                    Text(t.str("title")).font(.caption).foregroundStyle(.white).lineLimit(1)
                    Spacer(minLength: 4)
                    Text(overdue ? "Overdue" : deadlines ? "Due \(e.when(at))" : (t.num("start") < e.now ? "Now" : e.when(at)))
                        .font(.caption2).foregroundStyle(overdue ? Palette.danger : Palette.muted).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .widgetURL(URL(string: "cadence://open/\(deadlines ? "tasks" : "calendar")"))
        .cadenceBackground()
    }
}

struct ProgressView2: View {
    let e: CadenceEntry
    var body: some View {
        let list = e.todayTasks; let done = list.filter { $0.str("status") == "completed" }.count
        let focus = e.focusMs(on: e.date); let goal = max(1, e.today.num("goalMin", 100)) * 60_000
        VStack(alignment: .leading, spacing: 8) {
            Header(icon: "checkmark.circle", title: "Daily progress")
            HStack { Text("Tasks done").foregroundStyle(Palette.muted); Spacer(); Text("\(done) / \(list.count)").bold().foregroundStyle(.white) }.font(.caption)
            Bar(value: list.isEmpty ? 0 : Double(done) / Double(list.count))
            HStack { Text("Focus goal").foregroundStyle(Palette.muted); Spacer(); Text("\(durText(focus)) / \(durText(goal))").bold().foregroundStyle(.white) }.font(.caption)
            Bar(value: focus / goal, color: Palette.accent)
            Spacer(minLength: 0)
        }
        .widgetURL(URL(string: "cadence://open/home"))
        .cadenceBackground()
    }
}

struct WeeklyView: View {
    let e: CadenceEntry
    var body: some View {
        let days = e.weekDays(); let ms = days.map { e.focusMs(on: $0) }
        let goalDay = e.today.num("goalMin", 100) * 60_000; let maxMs = max(goalDay, ms.max() ?? 0)
        let done = days.reduce(0) { $0 + e.today.obj("doneByDay").int(CadenceEntry.key($1)) }
        VStack(alignment: .leading, spacing: 4) {
            Text("Weekly focus").font(.caption.bold()).foregroundStyle(Palette.muted)
            Text(durText(ms.reduce(0, +))).font(.title2.bold()).foregroundStyle(.white)
            Text("\(done) task\(done == 1 ? "" : "s") done · goal \(Int(e.snap.obj("goals").num("weeklyHours", 10)))h").font(.caption2).foregroundStyle(Palette.muted)
            HStack(alignment: .bottom, spacing: 6) {
                ForEach(0..<7, id: \.self) { i in
                    let isToday = Calendar.current.isDate(days[i], inSameDayAs: e.date)
                    VStack(spacing: 3) {
                        GeometryReader { g in
                            VStack { Spacer(minLength: 0)
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(ms[i] == 0 ? Color.white.opacity(0.15) : ms[i] >= goalDay ? Palette.accent2 : Palette.accent)
                                    .frame(height: ms[i] > 0 ? max(4, ms[i] / maxMs * g.size.height) : 3)
                            }
                        }
                        Text(days[i].formatted(.dateTime.weekday(.narrow))).font(.caption2.weight(isToday ? .bold : .regular)).foregroundStyle(isToday ? .white : Palette.muted)
                    }
                }
            }
        }
        .widgetURL(URL(string: "cadence://open/insights"))
        .cadenceBackground()
    }
}

struct StreakView: View {
    let e: CadenceEntry
    var body: some View {
        let s = e.streak; let days = e.weekDays(); let hits = e.focusDays
        VStack(alignment: .leading, spacing: 6) {
            Text("Focus streak").font(.caption.bold()).foregroundStyle(Palette.muted)
            Text("\(s) \(s == 1 ? "day" : "days")").font(.title.bold()).foregroundStyle(.white)
            Text(s > 0 ? "One session a day keeps it going" : "Focus today to start a streak").font(.caption2).foregroundStyle(Palette.muted).lineLimit(2)
            Spacer(minLength: 0)
            HStack {
                ForEach(0..<7, id: \.self) { i in
                    VStack(spacing: 3) {
                        Circle().strokeBorder(Color.white.opacity(0.3), lineWidth: hits.contains(CadenceEntry.key(days[i])) ? 0 : 2)
                            .background(Circle().fill(hits.contains(CadenceEntry.key(days[i])) ? Palette.accent2 : .clear)).frame(width: 14, height: 14)
                        Text(days[i].formatted(.dateTime.weekday(.narrow))).font(.system(size: 9)).foregroundStyle(Palette.muted)
                    }.frame(maxWidth: .infinity)
                }
            }
        }
        .widgetURL(URL(string: "cadence://open/insights"))
        .cadenceBackground()
    }
}

struct MiniCalendarView: View {
    let e: CadenceEntry
    var body: some View {
        let cal = Calendar.current
        let first = cal.date(from: cal.dateComponents([.year, .month], from: e.date))!
        let ws = e.snap.int("weekStart", 0); let dow = cal.component(.weekday, from: first) - 1
        let start = cal.date(byAdding: .day, value: -((dow - ws + 7) % 7), to: first)!
        let busy = Set(e.tasks.filter { $0.str("status") != "completed" }.flatMap { t -> [String] in
            [t.num("start"), t.num("due")].filter { $0 > 0 }.map { CadenceEntry.key(Date(timeIntervalSince1970: $0 / 1000)) } })
        VStack(alignment: .leading, spacing: 6) {
            Text(e.date.formatted(.dateTime.month(.wide).year())).font(.subheadline.bold()).foregroundStyle(.white)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 7), spacing: 4) {
                ForEach(0..<7, id: \.self) { i in
                    Text(cal.date(byAdding: .day, value: i, to: start)!.formatted(.dateTime.weekday(.narrow))).font(.caption2.bold()).foregroundStyle(Palette.muted)
                }
                ForEach(0..<42, id: \.self) { i in
                    let d = cal.date(byAdding: .day, value: i, to: start)!
                    let other = cal.component(.month, from: d) != cal.component(.month, from: e.date)
                    let isToday = cal.isDate(d, inSameDayAs: e.date)
                    VStack(spacing: 1) {
                        Text("\(cal.component(.day, from: d))").font(.caption2.weight(isToday ? .bold : .regular))
                            .foregroundStyle(other ? Color.white.opacity(0.35) : .white)
                            .frame(width: 22, height: 22).background(Circle().fill(isToday ? Palette.accent : .clear))
                        Circle().fill(busy.contains(CadenceEntry.key(d)) && !other ? Palette.accent2 : .clear).frame(width: 4, height: 4)
                    }
                }
            }
        }
        .widgetURL(URL(string: "cadence://open/calendar"))
        .cadenceBackground()
    }
}

struct MusicView: View {
    let e: CadenceEntry
    var body: some View {
        let m = e.snap.obj("music"); let has = m.bool("has"); let playing = m.bool("playing")
        HStack(spacing: 12) {
            Image("MusicArt").resizable().frame(width: 52, height: 52).clipShape(RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 2) {
                Text(has ? m.str("title") : "Focus music").font(.subheadline.bold()).foregroundStyle(.white).lineLimit(1)
                Text(has ? m.str("category") + (playing ? " · playing" : " · paused") : "Open Cadence to play").font(.caption).foregroundStyle(Palette.muted).lineLimit(1)
            }
            Spacer(minLength: 0)
            if has {
                Button(intent: MusicCommandIntent(command: "musicPrev")) { Image(systemName: "backward.fill") }.buttonStyle(.plain).foregroundStyle(.white)
                Button(intent: MusicCommandIntent(command: "musicToggle")) {
                    Image(systemName: playing ? "pause.fill" : "play.fill").frame(width: 40, height: 40).background(Circle().fill(Palette.accent)).foregroundStyle(.white)
                }.buttonStyle(.plain)
                Button(intent: MusicCommandIntent(command: "musicNext")) { Image(systemName: "forward.fill") }.buttonStyle(.plain).foregroundStyle(.white)
            } else {
                Link(destination: URL(string: "cadence://open/playMusic")!) {
                    Image(systemName: "play.fill").frame(width: 40, height: 40).background(Circle().fill(Palette.accent)).foregroundStyle(.white)
                }
            }
        }
        .widgetURL(URL(string: "cadence://open/focus"))
        .cadenceBackground()
    }
}

struct ScreenBreakView: View {
    let e: CadenceEntry
    var body: some View {
        let eye = e.snap.obj("eye"); let interval = max(60_000, eye.num("intervalMs", 1_200_000))
        let left = max(0, interval - eye.num("accumMs"))
        VStack(alignment: .leading, spacing: 8) {
            Header(icon: "eye", title: "Screen breaks")
            if !eye.bool("enabled") {
                Text("Turned off").font(.caption).foregroundStyle(Palette.muted)
            } else if e.now < eye.num("snoozeUntil") {
                Text("Paused until \(e.time(eye.num("snoozeUntil")))").font(.caption).foregroundStyle(Palette.muted)
            } else {
                HStack { Text("Next break").foregroundStyle(Palette.muted); Spacer(); Text("every \(Int(interval / 60_000)) min").bold().foregroundStyle(.white) }.font(.caption)
                Bar(value: 1 - left / interval)
            }
            Spacer(minLength: 0)
            Link(destination: URL(string: "cadence://open/screenBreak")!) {
                Text("Take a break now").font(.caption.bold()).foregroundStyle(.white).padding(.horizontal, 12).padding(.vertical, 7)
                    .background(Capsule().fill(Palette.accent.opacity(0.35)))
            }
        }
        .cadenceBackground()
    }
}

struct QuoteView: View {
    let e: CadenceEntry
    var body: some View {
        let quotes = (e.snap["quotes"] as? [[String]]) ?? []
        let day = Int(Calendar.current.startOfDay(for: e.date).timeIntervalSince1970 * 1000 / 86_400_000)
        let q = quotes.isEmpty ? ["Do one thing at a time, and do it well.", "Proverb"] : quotes[day % quotes.count]
        VStack(alignment: .leading, spacing: 6) {
            Text("“\(q.first ?? "")”").font(.callout.italic()).foregroundStyle(.white).lineLimit(4)
            Text("— \(q.count > 1 ? q[1] : "")").font(.caption).foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(URL(string: "cadence://open/home"))
        .cadenceBackground()
    }
}

// MARK: - Widget definitions

/// Shared setup for every Cadence home-screen widget.
func cadenceConfiguration<V: View>(kind: String, name: String, desc: String, families: [WidgetFamily],
                                   @ViewBuilder view: @escaping (CadenceEntry) -> V) -> some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: CadenceProvider()) { entry in view(entry).padding(14) }
        .configurationDisplayName(name).description(desc).supportedFamilies(families)
        .contentMarginsDisabled()
}

struct TimerHomeWidget: Widget {
    var body: some WidgetConfiguration {
        cadenceConfiguration(kind: "timer", name: "Focus timer", desc: "Start, pause and skip Pomodoro sessions", families: [.systemSmall]) { TimerView(e: $0) }
    }
}

struct TodayHomeWidget: Widget {
    var body: some WidgetConfiguration {
        cadenceConfiguration(kind: "today", name: "Today", desc: "Today's tasks, focus goal and streak", families: [.systemMedium, .systemLarge]) { TodayView(e: $0) }
    }
}

struct UpcomingHomeWidget: Widget {
    var body: some WidgetConfiguration {
        cadenceConfiguration(kind: "upcoming", name: "Upcoming schedule", desc: "Your next scheduled tasks", families: [.systemMedium, .systemLarge]) { ListView(e: $0, deadlines: false) }
    }
}

struct DeadlinesHomeWidget: Widget {
    var body: some WidgetConfiguration {
        cadenceConfiguration(kind: "deadlines", name: "Upcoming deadlines", desc: "Tasks with due dates, soonest first", families: [.systemMedium, .systemLarge]) { ListView(e: $0, deadlines: true) }
    }
}

struct ProgressHomeWidget: Widget {
    var body: some WidgetConfiguration {
        cadenceConfiguration(kind: "progress", name: "Daily progress", desc: "Tasks done and your daily focus goal", families: [.systemSmall, .systemMedium]) { ProgressView2(e: $0) }
    }
}

struct WeeklyHomeWidget: Widget {
    var body: some WidgetConfiguration {
        cadenceConfiguration(kind: "weekly", name: "Weekly focus", desc: "Focus time for each day this week", families: [.systemMedium]) { WeeklyView(e: $0) }
    }
}

struct StreakHomeWidget: Widget {
    var body: some WidgetConfiguration {
        cadenceConfiguration(kind: "streak", name: "Focus streak", desc: "Days in a row with a focus session", families: [.systemSmall]) { StreakView(e: $0) }
    }
}

struct CalendarHomeWidget: Widget {
    var body: some WidgetConfiguration {
        cadenceConfiguration(kind: "calendar", name: "Mini calendar", desc: "This month, with days that have tasks", families: [.systemLarge]) { MiniCalendarView(e: $0) }
    }
}

struct MusicHomeWidget: Widget {
    var body: some WidgetConfiguration {
        cadenceConfiguration(kind: "music", name: "Focus music", desc: "Play, pause and skip focus music", families: [.systemMedium]) { MusicView(e: $0) }
    }
}

struct ScreenBreakHomeWidget: Widget {
    var body: some WidgetConfiguration {
        cadenceConfiguration(kind: "screenbreak", name: "Screen breaks", desc: "Your screen-break reminders", families: [.systemSmall]) { ScreenBreakView(e: $0) }
    }
}

struct QuoteHomeWidget: Widget {
    var body: some WidgetConfiguration {
        cadenceConfiguration(kind: "quote", name: "Daily quote", desc: "A new motivational quote every day", families: [.systemMedium]) { QuoteView(e: $0) }
    }
}

// A bundle body lists at most 10 widgets, so they are split in two groups.
@main
struct CadenceWidgets: WidgetBundle {
    var body: some Widget {
        TimerHomeWidget()
        TodayHomeWidget()
        UpcomingHomeWidget()
        DeadlinesHomeWidget()
        ProgressHomeWidget()
        WeeklyHomeWidget()
        TimerLiveActivity()
        MoreCadenceWidgets().body
    }
}

struct MoreCadenceWidgets: WidgetBundle {
    var body: some Widget {
        StreakHomeWidget()
        CalendarHomeWidget()
        MusicHomeWidget()
        ScreenBreakHomeWidget()
        QuoteHomeWidget()
    }
}
