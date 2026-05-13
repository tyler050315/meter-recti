import AVFoundation
import UIKit

final class MeterRectiScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onResult: ((String, Int) -> Void)?
    var onCancel: (() -> Void)?
    var onError: ((String) -> Void)?

    private let hint: Int
    private let initialZoom: CGFloat
    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "meter-recti.scanner.session")
    private let metadataOutput = AVCaptureMetadataOutput()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var captureDevice: AVCaptureDevice?
    private var hasFinished = false

    private let scanFrameView = UIView()
    private let instructionsLabel = UILabel()
    private let zoomStack = UIStackView()
    private let torchButton = UIButton(type: .system)

    init(hint: Int, initialZoom: CGFloat) {
        self.hint = hint
        self.initialZoom = initialZoom
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        setupPreview()
        setupOverlay()
        let focusGesture = UITapGestureRecognizer(target: self, action: #selector(focusTapped(_:)))
        focusGesture.cancelsTouchesInView = false
        view.addGestureRecognizer(focusGesture)
        configureSession()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
        layoutScanFrame()
        updateRectOfInterest()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        setTorch(false)
        sessionQueue.async { [weak self] in
            if self?.session.isRunning == true {
                self?.session.stopRunning()
            }
        }
    }

    private func setupPreview() {
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(layer)
        previewLayer = layer
    }

    private func setupOverlay() {
        let dimView = UIView()
        dimView.translatesAutoresizingMaskIntoConstraints = false
        dimView.backgroundColor = UIColor.black.withAlphaComponent(0.22)
        view.addSubview(dimView)
        NSLayoutConstraint.activate([
            dimView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            dimView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            dimView.topAnchor.constraint(equalTo: view.topAnchor),
            dimView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        scanFrameView.layer.borderColor = UIColor.systemGreen.cgColor
        scanFrameView.layer.borderWidth = 3
        scanFrameView.layer.cornerRadius = 14
        scanFrameView.backgroundColor = .clear
        view.addSubview(scanFrameView)

        instructionsLabel.translatesAutoresizingMaskIntoConstraints = false
        instructionsLabel.text = "Hold steady inside the frame"
        instructionsLabel.textAlignment = .center
        instructionsLabel.textColor = .white
        instructionsLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        instructionsLabel.numberOfLines = 2
        view.addSubview(instructionsLabel)

        let cancelButton = UIButton(type: .system)
        cancelButton.translatesAutoresizingMaskIntoConstraints = false
        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.setTitleColor(.white, for: .normal)
        cancelButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        cancelButton.backgroundColor = UIColor.black.withAlphaComponent(0.42)
        cancelButton.layer.cornerRadius = 18
        cancelButton.contentEdgeInsets = UIEdgeInsets(top: 8, left: 16, bottom: 8, right: 16)
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        view.addSubview(cancelButton)

        torchButton.translatesAutoresizingMaskIntoConstraints = false
        torchButton.setTitle("Light", for: .normal)
        torchButton.setTitleColor(.white, for: .normal)
        torchButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        torchButton.backgroundColor = UIColor.black.withAlphaComponent(0.42)
        torchButton.layer.cornerRadius = 18
        torchButton.contentEdgeInsets = UIEdgeInsets(top: 8, left: 16, bottom: 8, right: 16)
        torchButton.addTarget(self, action: #selector(torchTapped), for: .touchUpInside)
        torchButton.isHidden = true
        view.addSubview(torchButton)

        zoomStack.translatesAutoresizingMaskIntoConstraints = false
        zoomStack.axis = .horizontal
        zoomStack.alignment = .center
        zoomStack.distribution = .fillEqually
        zoomStack.spacing = 8
        [1.0, 1.5, 2.0].forEach { zoom in
            let button = UIButton(type: .system)
            button.setTitle("\(zoom)x", for: .normal)
            button.setTitleColor(.white, for: .normal)
            button.titleLabel?.font = .systemFont(ofSize: 15, weight: .bold)
            button.backgroundColor = UIColor.black.withAlphaComponent(0.42)
            button.layer.cornerRadius = 18
            button.tag = Int(zoom * 10)
            button.addTarget(self, action: #selector(zoomTapped(_:)), for: .touchUpInside)
            zoomStack.addArrangedSubview(button)
        }
        view.addSubview(zoomStack)

        NSLayoutConstraint.activate([
            cancelButton.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 18),
            cancelButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            torchButton.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -18),
            torchButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            instructionsLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            instructionsLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            instructionsLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 82),
            zoomStack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            zoomStack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -28),
            zoomStack.widthAnchor.constraint(equalToConstant: 230),
            zoomStack.heightAnchor.constraint(equalToConstant: 42)
        ])
    }

    private func layoutScanFrame() {
        let side = min(view.bounds.width * 0.82, view.bounds.height * 0.48, 390)
        let height = side * 0.72
        scanFrameView.frame = CGRect(
            x: (view.bounds.width - side) / 2,
            y: (view.bounds.height - height) / 2,
            width: side,
            height: height
        )
    }

    private func configureSession() {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            session.beginConfiguration()
            session.sessionPreset = .high

            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) ??
                AVCaptureDevice.default(for: .video) else {
                self.session.commitConfiguration()
                self.fail("No camera is available.")
                return
            }
            self.captureDevice = device
            DispatchQueue.main.async { [weak self] in
                self?.torchButton.isHidden = !device.hasTorch
            }

            do {
                let input = try AVCaptureDeviceInput(device: device)
                if self.session.canAddInput(input) {
                    self.session.addInput(input)
                }

                if self.session.canAddOutput(self.metadataOutput) {
                    self.session.addOutput(self.metadataOutput)
                    self.metadataOutput.setMetadataObjectsDelegate(self, queue: .main)
                    let requestedTypes = self.metadataTypes(for: self.hint)
                    let available = self.metadataOutput.availableMetadataObjectTypes
                    let enabledTypes = requestedTypes.filter { available.contains($0) }
                    self.metadataOutput.metadataObjectTypes = enabledTypes.isEmpty ? available : enabledTypes
                }

                self.configureCamera(device)
                self.session.commitConfiguration()
                self.session.startRunning()
            } catch {
                self.session.commitConfiguration()
                self.fail("Unable to start camera: \(error.localizedDescription)")
            }
        }
    }

    private func configureCamera(_ device: AVCaptureDevice) {
        do {
            try device.lockForConfiguration()
            defer { device.unlockForConfiguration() }
            if device.isFocusModeSupported(.continuousAutoFocus) {
                device.focusMode = .continuousAutoFocus
            }
            if device.isSmoothAutoFocusSupported {
                device.isSmoothAutoFocusEnabled = true
            }
            if device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposureMode = .continuousAutoExposure
            }
            if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) {
                device.whiteBalanceMode = .continuousAutoWhiteBalance
            }
            let maxZoom = min(device.activeFormat.videoMaxZoomFactor, 4.0)
            device.videoZoomFactor = min(max(initialZoom, 1.0), maxZoom)
        } catch {
        }
    }

    private func applyZoom(_ zoom: CGFloat, to device: AVCaptureDevice? = nil) {
        let targetDevice = device ?? captureDevice
        guard let targetDevice else { return }
        do {
            try targetDevice.lockForConfiguration()
            defer { targetDevice.unlockForConfiguration() }
            let maxZoom = min(targetDevice.activeFormat.videoMaxZoomFactor, 4.0)
            targetDevice.videoZoomFactor = min(max(zoom, 1.0), maxZoom)
        } catch {
        }
    }

    private func updateRectOfInterest() {
        guard let previewLayer else { return }
        metadataOutput.rectOfInterest = previewLayer.metadataOutputRectConverted(fromLayerRect: scanFrameView.frame)
    }

    private func metadataTypes(for hint: Int) -> [AVMetadataObject.ObjectType] {
        switch hint {
        case 0: return [.qr]
        case 1: return [.aztec]
        case 3: return [.code39]
        case 4: return [.code93]
        case 5: return [.code128]
        case 6: return [.dataMatrix]
        case 8: return [.interleaved2of5]
        case 9: return [.ean13, .upce]
        case 10: return [.ean8]
        case 11: return [.pdf417]
        case 14: return [.ean13]
        case 15: return [.upce]
        default:
            return [.qr, .code128, .code39, .code93, .ean13, .ean8, .interleaved2of5, .upce, .pdf417, .aztec, .dataMatrix]
        }
    }

    private func formatCode(for type: AVMetadataObject.ObjectType) -> Int {
        switch type {
        case .qr: return 0
        case .aztec: return 1
        case .code39: return 3
        case .code93: return 4
        case .code128: return 5
        case .dataMatrix: return 6
        case .interleaved2of5: return 8
        case .ean13: return 9
        case .ean8: return 10
        case .pdf417: return 11
        case .upce: return 15
        default: return 17
        }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !hasFinished else { return }
        guard let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let value = object.stringValue,
              !value.isEmpty else { return }
        hasFinished = true
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        setTorch(false)
        sessionQueue.async { [weak self] in
            self?.session.stopRunning()
        }
        dismiss(animated: true) { [weak self] in
            self?.onResult?(value, self?.formatCode(for: object.type) ?? 17)
        }
    }

    @objc private func cancelTapped() {
        guard !hasFinished else { return }
        hasFinished = true
        setTorch(false)
        dismiss(animated: true) { [weak self] in
            self?.onCancel?()
        }
    }

    @objc private func zoomTapped(_ sender: UIButton) {
        applyZoom(CGFloat(sender.tag) / 10.0)
    }

    @objc private func torchTapped() {
        guard let device = captureDevice, device.hasTorch else { return }
        setTorch(device.torchMode != .on)
    }

    @objc private func focusTapped(_ gesture: UITapGestureRecognizer) {
        guard let previewLayer, let device = captureDevice else { return }
        let point = gesture.location(in: view)
        let devicePoint = previewLayer.captureDevicePointConverted(fromLayerPoint: point)
        do {
            try device.lockForConfiguration()
            defer { device.unlockForConfiguration() }
            if device.isFocusPointOfInterestSupported {
                device.focusPointOfInterest = devicePoint
                if device.isFocusModeSupported(.autoFocus) {
                    device.focusMode = .autoFocus
                }
            }
            if device.isExposurePointOfInterestSupported {
                device.exposurePointOfInterest = devicePoint
                if device.isExposureModeSupported(.autoExpose) {
                    device.exposureMode = .autoExpose
                }
            }
        } catch {
        }
    }

    private func fail(_ message: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.setTorch(false)
            self.dismiss(animated: true) {
                self.onError?(message)
            }
        }
    }

    private func setTorch(_ enabled: Bool) {
        guard let device = captureDevice, device.hasTorch else { return }
        do {
            try device.lockForConfiguration()
            defer { device.unlockForConfiguration() }
            device.torchMode = enabled ? .on : .off
            torchButton.setTitle(enabled ? "Light On" : "Light", for: .normal)
            torchButton.backgroundColor = enabled ? UIColor.systemYellow.withAlphaComponent(0.82) : UIColor.black.withAlphaComponent(0.42)
            torchButton.setTitleColor(enabled ? .black : .white, for: .normal)
        } catch {
        }
    }
}
