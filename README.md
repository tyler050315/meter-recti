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

Current native dependency set:

- `@capacitor/core`, `@capacitor/ios`, `@capacitor/cli`: `7.6.5`
- `@capacitor/barcode-scanner`: `2.2.6`

Prepare and sync the native project:

```bash
npm install
npm run build:native-scanner
npm run prepare:www
npm run sync:ios
```

The iOS project is in `ios/App`. Building and installing on an iPhone still requires Xcode on macOS or an iOS cloud build service.

### Run on iPhone with Xcode and a free Apple ID

1. On macOS, clone the repository and run the prepare/sync commands above.
2. Open the native project with `npm run open:ios`, or open `ios/App/App.xcodeproj` directly in Xcode.
3. In Xcode, select the `App` target, choose your Apple ID team, and change the bundle identifier if Xcode reports that `com.meterrecti.app` is unavailable.
4. Connect the iPhone by USB, trust the Mac/iPhone pairing prompts, select the device as the run destination, then press Run.
5. If iOS blocks the developer certificate, trust it from Settings before opening the app again.

Free Apple ID builds are intended for direct device testing. The installed app may need to be refreshed periodically.

### Codemagic status

`codemagic.yaml` currently defines two unsigned iOS workflows:

- `ios-unsigned-check`: builds an unsigned `iphonesimulator` app. This is only a build health check and should not be installed on a real iPhone.
- `ios-unsigned-device-ipa`: builds an unsigned `iphoneos` device app and packages `Payload/App.app` as `MeterRecti-unsigned-device.ipa`. This is the artifact intended for tools such as Sideloadly to re-sign with a free Apple ID and install on a real iPhone.

To produce a signed IPA in Codemagic, the remaining work is to add Apple signing assets:

- Apple Developer Program account, or App Store Connect API key
- iOS signing certificate
- provisioning profile matching the final bundle identifier
- a Codemagic workflow that archives for device distribution and exports an `.ipa`
