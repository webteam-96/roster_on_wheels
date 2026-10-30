package com.kaizen.roww

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterFragmentActivity() {
    private val passcodeChannelName = "rotary_india/passcode_auth"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, passcodeChannelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "authenticatePasscode" -> {
                        val title = call.argument<String>("title") ?: "Unlock"
                        val subtitle = call.argument<String>("subtitle")
                            ?: "Enter your device PIN, pattern, or password"
                        authenticatePasscode(title, subtitle, result)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    /**
     * Shows a passcode-only prompt by setting allowed authenticators to
     * DEVICE_CREDENTIAL only — this skips fingerprint/face unlock entirely
     * even when biometric is enrolled. Returns true on success, false on
     * cancel / error / no credential set.
     */
    private fun authenticatePasscode(
        title: String,
        subtitle: String,
        result: MethodChannel.Result,
    ) {
        // If no PIN/pattern/password is set on the device, the prompt
        // would fail anyway — fail fast with a clear signal.
        val canAuth = BiometricManager.from(this)
            .canAuthenticate(BiometricManager.Authenticators.DEVICE_CREDENTIAL)
        if (canAuth != BiometricManager.BIOMETRIC_SUCCESS) {
            result.success(false)
            return
        }

        val executor = ContextCompat.getMainExecutor(this)
        var settled = false
        val biometricPrompt = BiometricPrompt(
            this,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(
                    authResult: BiometricPrompt.AuthenticationResult,
                ) {
                    if (settled) return
                    settled = true
                    result.success(true)
                }

                override fun onAuthenticationError(
                    errorCode: Int,
                    errString: CharSequence,
                ) {
                    if (settled) return
                    settled = true
                    result.success(false)
                }

                override fun onAuthenticationFailed() {
                    // Wrong credential entered. The system prompt stays up
                    // so the user can retry — don't deliver a result here.
                }
            },
        )

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(BiometricManager.Authenticators.DEVICE_CREDENTIAL)
            .build()

        biometricPrompt.authenticate(promptInfo)
    }
}
