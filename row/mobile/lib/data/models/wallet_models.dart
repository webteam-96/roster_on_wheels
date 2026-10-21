// Wallet credit top-up (club/district admins buy email credits via
// the payment provider). The server is authoritative on pricing — the client only sends a
// base rupee amount + scope + credit type; credits / GST / total come back.

double _d(dynamic v) =>
    v is num ? v.toDouble() : double.tryParse('${v ?? ''}') ?? 0;
int _i(dynamic v) => v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0;

/// Credit types the wallet sells (sent verbatim to the server).
class WalletCreditType {
  static const String email = 'Email';
}

/// Current remaining balances (`GET /api/credit-management/{scope}/{id}/balance`).
class WalletBalance {
  final int? emailRemaining;
  const WalletBalance({this.emailRemaining});

  factory WalletBalance.fromJson(Map<String, dynamic> j) => WalletBalance(
        emailRemaining:
            j['emailRemaining'] == null ? null : _i(j['emailRemaining']),
      );
}

/// Live preview of what an entered base amount buys (`GET /api/wallet/quote`).
class WalletQuote {
  final String creditType;
  final int creditCount;
  final double baseAmount;
  final double gstAmount;
  final double totalAmount;
  final double minAmount;
  final String? error;

  const WalletQuote({
    required this.creditType,
    required this.creditCount,
    required this.baseAmount,
    required this.gstAmount,
    required this.totalAmount,
    required this.minAmount,
    this.error,
  });

  factory WalletQuote.fromJson(Map<String, dynamic> j) {
    final err = (j['error'] as String?)?.trim();
    return WalletQuote(
      creditType: '${j['creditType'] ?? ''}',
      creditCount: _i(j['creditCount']),
      baseAmount: _d(j['baseAmount']),
      gstAmount: _d(j['gstAmount']),
      totalAmount: _d(j['totalAmount']),
      minAmount: _d(j['minAmount']),
      error: (err == null || err.isEmpty) ? null : err,
    );
  }

  bool get hasError => (error ?? '').isNotEmpty;
}

/// Server response to `POST /api/wallet/create-order` — everything the Razorpay
/// checkout needs (keyId is the public key; no secret on the device).
class WalletTopupOrder {
  final int topupOrderId;
  final String razorpayOrderId;
  final String keyId;
  final int amountPaise;
  final String currency;
  final int creditCount;
  final double baseAmount;
  final double gstAmount;
  final double totalAmount;

  const WalletTopupOrder({
    required this.topupOrderId,
    required this.razorpayOrderId,
    required this.keyId,
    required this.amountPaise,
    required this.currency,
    required this.creditCount,
    required this.baseAmount,
    required this.gstAmount,
    required this.totalAmount,
  });

  factory WalletTopupOrder.fromJson(Map<String, dynamic> j) => WalletTopupOrder(
        topupOrderId: _i(j['topupOrderId']),
        razorpayOrderId: '${j['razorpayOrderId'] ?? ''}',
        keyId: '${j['keyId'] ?? ''}',
        amountPaise: _i(j['amountPaise']),
        currency: '${j['currency'] ?? 'INR'}',
        creditCount: _i(j['creditCount']),
        baseAmount: _d(j['baseAmount']),
        gstAmount: _d(j['gstAmount']),
        totalAmount: _d(j['totalAmount']),
      );
}

/// Server response to `POST /api/wallet/verify` — post-payment credit result.
class WalletTopupResult {
  final bool isSuccess;
  final String paymentStatus;
  final int creditCount;
  final int? emailRemaining;
  final String? message;

  const WalletTopupResult({
    required this.isSuccess,
    required this.paymentStatus,
    required this.creditCount,
    this.emailRemaining,
    this.message,
  });

  factory WalletTopupResult.fromJson(Map<String, dynamic> j) {
    final nb = j['newBalance'];
    final bal = nb is Map ? nb.cast<String, dynamic>() : const <String, dynamic>{};
    return WalletTopupResult(
      isSuccess: j['isSuccess'] == true,
      paymentStatus: '${j['paymentStatus'] ?? ''}',
      creditCount: _i(j['creditCount']),
      emailRemaining:
          bal.containsKey('emailRemaining') ? _i(bal['emailRemaining']) : null,
      message: (j['message'] as String?)?.trim().isNotEmpty == true
          ? j['message'] as String?
          : null,
    );
  }
}
