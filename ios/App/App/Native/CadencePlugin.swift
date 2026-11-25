import Foundation
import UIKit
import Capacitor
import UserNotifications
import FamilyControls
import AudioToolbox
import UniformTypeIdentifiers

/// Bridge between the app's web layer and iOS. Same methods as the Android plugin, so the web
/// code is shared; features iOS doesn't allow report themselves as unavailable.
@objc(CadencePlugin)
public class CadencePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "CadencePlugin"
    public let jsName = "CadenceNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeActions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAppearance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listApps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickApps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestScreenTime", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAlarms", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "vibrate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pinWidget", returnType: CAPPluginReturnPromise),
    ]

    static weak var current: CadencePlugin?
    private var audioCall: CAPPluginCall?

    override public func load() {
        CadencePlugin.current = self
        Controller.registerCategories()
        NowPlaying.activateAudioSession()
        CadenceActions.appHook = { _, _ in
            DispatchQueue.main.async { Controller.refresh(); CadencePlugin.emitActions() }
        }
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    static func emitActions() { current?.notifyListeners("actions", data: [:]) }

    /// Opens a screen the app was launched for (widget or notification tap).
    static func open(_ screen: String) {
        SharedStore.queue(["type": "open", "screen": screen, "at": SharedStore.now()])
        emitActions()
    }

    @objc private func didBecomeActive() {
        Controller.foreground = true
        Controller.collectDelivered {
            UNUserNotificationCenter.current().removeAllDeliveredNotifications()
            DispatchQueue.main.async { Controller.refresh(); CadencePlugin.emitActions() }
        }
    }

    @objc private func didEnterBackground() {
        Controller.foreground = false
        Controller.refresh()
    }

    // MARK: state

    @objc func sync(_ call: CAPPluginCall) {
        guard var state = call.options["state"] as? [String: Any] else { call.reject("Missing state"); return }
        let music = state.obj("music")
        DispatchQueue.main.async {
            NowPlaying.update(has: music.bool("has"), playing: music.bool("playing"), title: music.str("title"), category: music.str("category"))
        }
        let timer = state["timer"] as? [String: Any]
        state.removeValue(forKey: "timer")
        SharedStore.snapshot = state
        // Actions not yet replayed by the app win over the app's older copy of the timer.
        if let timer, !SharedStore.hasActions { SharedStore.timer = timer }
        DispatchQueue.main.async { Controller.refresh() }
        call.resolve()
    }

    @objc func takeActions(_ call: CAPPluginCall) {
        call.resolve(["actions": SharedStore.takeActions()])
    }

    @objc func status(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            let notif: String
            switch s.authorizationStatus {
            case .authorized, .provisional, .ephemeral: notif = "granted"
            case .notDetermined: notif = "prompt"
            default: notif = "denied"
            }
            call.resolve([
                "platform": "ios",
                "notifications": notif,
                "exactAlarms": true,
                "dndAccess": false, "dndActive": false, "dndSupported": false,
                // App lock uses Screen Time; "overlay" has no iOS equivalent and is always fine.
                "usageAccess": AppLock.authorized, "overlay": true,
                "fullScreen": AlarmController.handlesNextPhase,
                "alarmsSupported": { if #available(iOS 26.0, *) { return true }; return false }(),
            ])
        }
    }

    @objc func requestNotifications(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            self.status(call)
        }
    }

    @objc func requestScreenTime(_ call: CAPPluginCall) {
        Task { @MainActor in
            try? await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            call.resolve(["granted": AppLock.authorized])
        }
    }

    @objc func requestAlarms(_ call: CAPPluginCall) {
        Task { call.resolve(["granted": await AlarmController.requestAuthorization()]) }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        let which = call.getString("which") ?? "notifications"
        DispatchQueue.main.async {
            if which == "usage" { self.requestScreenTime(call); return }
            if which == "fullScreen" { self.requestAlarms(call); return }
            let url = URL(string: which == "notifications" ? UIApplication.openNotificationSettingsURLString : UIApplication.openSettingsURLString)!
            UIApplication.shared.open(url)
            call.resolve()
        }
    }

    @objc func setAppearance(_ call: CAPPluginCall) {
        let dark = call.getBool("dark") ?? false
        DispatchQueue.main.async {
            (self.bridge?.viewController as? MainViewController)?.setDark(dark)
            self.bridge?.webView?.backgroundColor = dark ? UIColor(red: 0.067, green: 0.055, blue: 0.098, alpha: 1) : UIColor(red: 0.965, green: 0.953, blue: 0.988, alpha: 1)
            self.bridge?.webView?.isOpaque = true
            call.resolve()
        }
    }

    // MARK: app lock

    /// iOS never lists installed apps; the chooser is Apple's picker (see pickApps).
    @objc func listApps(_ call: CAPPluginCall) { call.resolve(["apps": []]) }

    @objc func pickApps(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("No view"); return }
            AppPicker.present(from: vc) { count in
                if let count { call.resolve(["saved": true, "count": count]) } else { call.resolve(["saved": false, "count": AppLock.allowedCount]) }
                Controller.refresh()
            }
        }
    }

    // MARK: music files

    @objc func pickAudio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.audioCall = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.audio], asCopy: true)
            picker.allowsMultipleSelection = true
            picker.delegate = self
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let dir = Self.musicDir()
        var files: [[String: Any]] = []
        for url in urls {
            let ext = url.pathExtension.isEmpty ? "m4a" : url.pathExtension.lowercased()
            let dest = dir.appendingPathComponent("\(UUID().uuidString).\(ext)")
            do {
                try FileManager.default.copyItem(at: url, to: dest)
                let size = (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? NSNumber)?.intValue ?? 0
                files.append(["name": url.deletingPathExtension().lastPathComponent, "path": dest.path, "size": size])
            } catch { continue }
        }
        audioCall?.resolve(["files": files]); audioCall = nil
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        audioCall?.resolve(["files": []]); audioCall = nil
    }

    static func musicDir() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("music", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    @objc func deleteAudio(_ call: CAPPluginCall) {
        let path = call.getString("path") ?? ""
        let url = URL(fileURLWithPath: path).standardizedFileURL
        if url.path.hasPrefix(Self.musicDir().standardizedFileURL.path + "/") { try? FileManager.default.removeItem(at: url) }
        call.resolve()
    }

    // MARK: misc

    @objc func vibrate(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let total = (call.getArray("pattern", NSNumber.self) ?? [200]).enumerated().filter { $0.offset % 2 == 0 }.count
            let gen = UINotificationFeedbackGenerator()
            gen.notificationOccurred(.success)
            if total > 1 { AudioServicesPlaySystemSound(kSystemSoundID_Vibrate) }
            call.resolve()
        }
    }

    /// iOS has no API to add a widget for the user; the app shows how to add it instead.
    @objc func pinWidget(_ call: CAPPluginCall) { call.resolve(["supported": false]) }

    @objc func shareFile(_ call: CAPPluginCall) {
        let name = (call.getString("filename") ?? "cadence-backup.json").replacingOccurrences(of: "/", with: "_")
        let text = call.getString("text") ?? ""
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do { try text.write(to: url, atomically: true, encoding: .utf8) } catch { call.reject("Could not export: \(error.localizedDescription)"); return }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("No view"); return }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = vc.view
            vc.present(sheet, animated: true)
            call.resolve()
        }
    }
}
