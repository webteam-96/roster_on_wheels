import 'dart:async';
import 'package:razorpay_flutter/razorpay_flutter.dart';

/// Outcome of a Razorpay checkout run.
///
/// Payment is collected by the **native** Razorpay SDK ([Razorpay] from
/// `razorpay_flutter`): [openRazorpayCheckout] opens a native payment screen and
/// the SDK returns the result through method-channel events. `keyId`, `orderId`
/// and `amountPaise` all come from the server's create-order response, so no
/// Razorpay secret is ever on the device (keyId is the public key).
///
/// The native SDK dismisses its own screen, so — unlike the old in-app web view —
/// there is no page that can get stuck on Razorpay's success screen.
class RazorpayCheckoutResult {
  final bool success;
  final String? paymentId;
  final String? orderId;
  final String? signature;
  final String? error; // set only when Razorpay reported a payment failure

  const RazorpayCheckoutResult._({
    required this.success,
    this.paymentId,
    this.orderId,
    this.signature,
    this.error,
  });

  const RazorpayCheckoutResult.success({
    required String paymentId,
    required String orderId,
    required String signature,
  }) : this._(
          success: true,
          paymentId: paymentId,
          orderId: orderId,
          signature: signature,
        );

  const RazorpayCheckoutResult.failed(String message)
      : this._(success: false, error: message);
}

/// Opens the native Razorpay checkout and resolves to:
///  • a [RazorpayCheckoutResult.success] with the payment id + signature (POST
///    these to the server's `verify` endpoint), or
///  • [RazorpayCheckoutResult.failed] when Razorpay reported a payment failure, or
///  • `null` when the user cancelled / dismissed the sheet (verify nothing).
Future<RazorpayCheckoutResult?> openRazorpayCheckout({
  required String keyId,
  required String orderId,
  required int amountPaise,
  required String name,
  String? description,
  String? prefillEmail,
  String? prefillContact,
  String currency = 'INR',
}) {
  final razorpay = Razorpay();
  final completer = Completer<RazorpayCheckoutResult?>();
  var settled = false;

  void finish(RazorpayCheckoutResult? result) {
    if (settled) return;
    settled = true;
    // Detach listeners / release the native handler before resolving.
    razorpay.clear();
    if (!completer.isCompleted) completer.complete(result);
  }

  razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, (PaymentSuccessResponse r) {
    final paymentId = r.paymentId ?? '';
    final signature = r.signature ?? '';
    if (paymentId.isEmpty || signature.isEmpty) {
      finish(const RazorpayCheckoutResult.failed(
          'Payment could not be confirmed.'));
    } else {
      finish(RazorpayCheckoutResult.success(
        paymentId: paymentId,
        orderId: r.orderId ?? orderId,
        signature: signature,
      ));
    }
  });

  razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, (PaymentFailureResponse r) {
    // The SDK reports a user-dismissed sheet as a PAYMENT_CANCELLED error;
    // surface that as a plain cancel (null), not a failure.
    if (r.code == Razorpay.PAYMENT_CANCELLED) {
      finish(null);
      return;
    }
    final message = (r.message ?? '').trim();
    finish(RazorpayCheckoutResult.failed(
        message.isNotEmpty ? message : 'Payment failed.'));
  });

  // Selecting an external wallet (e.g. PhonePe) is not terminal on its own —
  // the SDK still fires a success/error event afterwards — so this is a no-op.
  razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, (ExternalWalletResponse r) {});

  final options = <String, dynamic>{
    'key': keyId,
    'order_id': orderId,
    'amount': amountPaise,
    'currency': currency,
    'name': name,
    if ((description ?? '').isNotEmpty) 'description': description,
    'prefill': <String, dynamic>{
      if ((prefillEmail ?? '').isNotEmpty) 'email': prefillEmail,
      if ((prefillContact ?? '').isNotEmpty) 'contact': prefillContact,
    },
    'theme': <String, dynamic>{'color': '#1C5BAE'},
    'retry': <String, dynamic>{'enabled': false},
  };

  try {
    razorpay.open(options);
  } catch (e) {
    finish(RazorpayCheckoutResult.failed('Could not start payment. $e'));
  }
  return completer.future;
}
