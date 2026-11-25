import SwiftUI
import FamilyControls

/// Apple's Screen Time app picker, used to choose the apps that stay usable during focus.
/// (iOS never reveals which apps are installed; the picker returns opaque tokens.)
struct AllowedAppsPicker: View {
    @State var selection: FamilyActivitySelection
    let onDone: (FamilyActivitySelection?) -> Void

    var body: some View {
        NavigationStack {
            FamilyActivityPicker(selection: $selection)
                .navigationTitle("Allowed during focus")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { onDone(nil) } }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") { onDone(selection) }.bold() }
                }
        }
        .tint(Color(red: 0.51, green: 0.39, blue: 0.91))
    }
}

enum AppPicker {
    static func present(from vc: UIViewController, done: @escaping (Int?) -> Void) {
        var host: UIHostingController<AllowedAppsPicker>?
        let view = AllowedAppsPicker(selection: AppLock.allowed) { sel in
            if let sel { AppLock.allowed = sel }
            host?.dismiss(animated: true)
            done(sel == nil ? nil : AppLock.allowedCount)
        }
        host = UIHostingController(rootView: view)
        vc.present(host!, animated: true)
    }
}
