import Flutter
import UIKit
import LocalAuthentication

@main
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let controller = window?.rootViewController as! FlutterViewController
    let passcodeChannel = FlutterMethodChannel(
      name: "rotary_india/passcode_auth",
      binaryMessenger: controller.binaryMessenger
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

    GeneratedPluginRegistrant.register(with: self)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
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
