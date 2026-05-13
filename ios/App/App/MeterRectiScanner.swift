import AVFoundation
import Capacitor
import UIKit

@objc(MeterRectiScanner)
public class MeterRectiScanner: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MeterRectiScanner"
    public let jsName = "MeterRectiScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scanBarcode", returnType: CAPPluginReturnPromise)
    ]

    private var activeCall: CAPPluginCall?

    @objc func scanBarcode(_ call: CAPPluginCall) {
        if activeCall != nil {
            call.reject("Scanner is already running.")
            return
        }

        let hint = call.getInt("hint", 0)
        let zoom = call.getDouble("zoom", 1.5)

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            presentScanner(call, hint: hint, zoom: zoom)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    guard granted else {
                        call.reject("Camera permission was denied.")
                        return
                    }
                    self?.presentScanner(call, hint: hint, zoom: zoom)
                }
            }
        case .denied, .restricted:
            call.reject("Camera permission was denied.")
        @unknown default:
            call.reject("Camera permission is unavailable.")
        }
    }

    private func presentScanner(_ call: CAPPluginCall, hint: Int, zoom: Double) {
        guard let presenter = bridge?.viewController else {
            call.reject("Capacitor view controller is not available.")
            return
        }

        activeCall = call
        DispatchQueue.main.async {
            let scanner = MeterRectiScannerViewController(hint: hint, initialZoom: CGFloat(zoom))
            scanner.modalPresentationStyle = .fullScreen
            scanner.onResult = { [weak self] text, format in
                self?.activeCall?.resolve([
                    "ScanResult": text,
                    "format": format
                ])
                self?.activeCall = nil
            }
            scanner.onCancel = { [weak self] in
                self?.activeCall?.reject("Scanning was cancelled.")
                self?.activeCall = nil
            }
            scanner.onError = { [weak self] message in
                self?.activeCall?.reject(message)
                self?.activeCall = nil
            }
            presenter.present(scanner, animated: true)
        }
    }
}
