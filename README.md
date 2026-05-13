# Meter Recti

Water meter calibration PWA for field use.

## Features

- MQTT over WebSocket configuration
- QR/barcode-assisted serial number input
- Meter reading validation
- Two-stage MQTT calibration flow
- Local IndexedDB history records
- PWA manifest and service worker

## Usage

Serve the project from an HTTPS origin, then open it on iPhone Safari and add it to the Home Screen.

## Capacitor iOS

This project also contains a Capacitor iOS shell. The web app remains the main UI; in a native Capacitor build, scanning uses `@capacitor/barcode-scanner`.

Prepare and sync the native project:

```bash
npm install
npm run build:native-scanner
npm run prepare:www
npm run sync:ios
```

The iOS project is in `ios/App`. Building and installing on an iPhone still requires Xcode on macOS or an iOS cloud build service.
