import Flutter
import UIKit
import LocalAuthentication

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // UIScene lifecycle (required from iOS 27): plugins and channels are set up
  // here, once Flutter's engine exists; there is no window at launch any more.
  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)

    guard let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "RowNativeChannels") else { return }
    let messenger = registrar.messenger()
    let passcodeChannel = FlutterMethodChannel(
      name: "rotary_india/passcode_auth",
      binaryMessenger: messenger
    )
    passcodeChannel.setMethodCallHandler { (call, result) in
      switch call.method {
      case "authenticatePasscode":
        let args = call.arguments as? [String: Any] ?? [:]
        let reason = (args["reason"] as? String) ?? "Enter your device passcode"
        AppDelegate.authenticatePasscodeOnly(reason: reason, result: result)
      default:
        result(FlutterMethodNotImplemented)
      }
    }

    // The device's IANA time zone ("Europe/Paris"), sent with API requests (X-Time-Zone).
    let zoneChannel = FlutterMethodChannel(name: "row/time_zone", binaryMessenger: messenger)
    zoneChannel.setMethodCallHandler { (call, result) in
      if call.method == "localZone" { result(TimeZone.current.identifier) } else { result(FlutterMethodNotImplemented) }
    }
  }

  /// Forces a passcode-only prompt by evaluating an access-control object
  /// configured with `.devicePasscode`. This skips Face ID / Touch ID
  /// entirely, even when biometric is enrolled — which is the behaviour
  /// `LAContext.evaluatePolicy` cannot deliver on its own.
  private static func authenticatePasscodeOnly(
    reason: String,
    result: @escaping FlutterResult
  ) {
    guard let access = SecAccessControlCreateWithFlags(
      nil,
      kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
      .devicePasscode,
      nil
    ) else {
      result(false)
      return
    }
    let context = LAContext()
    context.evaluateAccessControl(
      access,
      operation: .useItem,
      localizedReason: reason
    ) { success, _ in
      DispatchQueue.main.async { result(success) }
    }
  }
}
