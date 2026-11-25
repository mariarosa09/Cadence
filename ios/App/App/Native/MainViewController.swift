import UIKit
import Capacitor

/// The app's web view controller: registers Cadence's native plugin and follows the app's theme
/// for the status bar.
class MainViewController: CAPBridgeViewController {
    private var dark = false

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CadencePlugin())
    }

    func setDark(_ value: Bool) {
        dark = value
        setNeedsStatusBarAppearanceUpdate()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { dark ? .lightContent : .darkContent }
}
