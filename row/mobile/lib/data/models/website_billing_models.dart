// Club website self-service Buy / Renew (Razorpay). A club admin (role 2) buys a
// brand-new website or renews an expiring one. The server is authoritative on
// price (base + GST), validity, subdomain rules and provisioning — the client
// only sends the club id (+ a subdomain for a New purchase) and pays; amounts,
// the resolved subdomain and the new end date all come back. Mirrors the wallet
// top-up models (`wallet_models.dart`) — same `_d`/`_i` num-parsing idioms.

double _d(dynamic v) =>
    v is num ? v.toDouble() : double.tryParse('${v ?? ''}') ?? 0;
int _i(dynamic v) => v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0;
String? _s(dynamic v) {
  final s = (v ?? '').toString().trim();
  return s.isEmpty ? null : s;
}

DateTime? _dt(dynamic v) {
  final s = (v ?? '').toString().trim();
  return s.isEmpty ? null : DateTime.tryParse(s);
}

/// Price + New/Renewal + new expiry preview (`GET /api/website-billing/quote`).
/// `orderType` is "New" when the club has no live website (a subdomain must be
/// chosen), "Renewal" when it already has one (the current subdomain is kept).
class WebsiteQuote {
  final String orderType; // "New" | "Renewal"
  final String? currentSubdomain; // set on Renewal
  final DateTime? currentEndDate; // set on Renewal
  final DateTime? newEndDate;
  final int validityMonths;
  final double baseAmount;
  final double gstAmount;
  final int gstPercent;
  final double totalAmount;
  final String subdomainPrefix; // "rc"
  final String parentDomain; // the club-site parent domain
  // The server owns the renewal window: a PAID, active site with more than
  // `RenewalWindowDays` (15) left can't be re-purchased yet, and create-order
  // enforces the same rule (400). Trial / expired / near-expiry / no-site clubs
  // can always buy. Never re-derive this from `currentEndDate` client-side —
  // the server's check reads the LATEST club_websites row while currentEndDate
  // comes from an unordered one, and only the server knows if the site is paid.
  final bool canPurchase;
  final String? purchaseBlockedReason; // server-worded, render verbatim
  final int daysRemaining;

  const WebsiteQuote({
    required this.orderType,
    this.currentSubdomain,
    this.currentEndDate,
    this.newEndDate,
    required this.validityMonths,
    required this.baseAmount,
    required this.gstAmount,
    required this.gstPercent,
    required this.totalAmount,
    required this.subdomainPrefix,
    required this.parentDomain,
    this.canPurchase = true,
    this.purchaseBlockedReason,
    this.daysRemaining = 0,
  });

  factory WebsiteQuote.fromJson(Map<String, dynamic> j) => WebsiteQuote(
        orderType: '${j['orderType'] ?? ''}',
        currentSubdomain: _s(j['currentSubdomain']),
        currentEndDate: _dt(j['currentEndDate']),
        newEndDate: _dt(j['newEndDate']),
        validityMonths: _i(j['validityMonths']),
        baseAmount: _d(j['baseAmount']),
        gstAmount: _d(j['gstAmount']),
        gstPercent: _i(j['gstPercent']),
        totalAmount: _d(j['totalAmount']),
        subdomainPrefix: '${j['subdomainPrefix'] ?? 'rc'}',
        parentDomain: '${j['parentDomain'] ?? ''}',
        // Default-true so an older server (no such field) keeps the old
        // always-purchasable behaviour instead of locking the buy flow.
        canPurchase: j['canPurchase'] != false,
        purchaseBlockedReason: _s(j['purchaseBlockedReason']),
        daysRemaining: _i(j['daysRemaining']),
      );

  bool get isRenewal => orderType.toLowerCase() == 'renewal';
  bool get isNew => !isRenewal;
}

/// Availability + format result for a proposed subdomain
/// (`GET /api/website-billing/check-subdomain`). `label` is the full stored
/// label the server resolved the raw input to (e.g. "rcmumbaiwest").
class SubdomainCheck {
  final String label;
  final bool available;
  final String? reason;

  const SubdomainCheck({
    required this.label,
    required this.available,
    this.reason,
  });

  factory SubdomainCheck.fromJson(Map<String, dynamic> j) => SubdomainCheck(
        label: '${j['label'] ?? ''}',
        available: j['available'] == true,
        reason: _s(j['reason']),
      );
}

/// Server response to `POST /api/website-billing/create-order` — everything the
/// Razorpay checkout needs (keyId is the public key; no secret on the device).
class WebsiteOrder {
  final int websiteOrderId;
  final String razorpayOrderId;
  final String keyId;
  final int amountPaise;
  final String currency;
  final String orderType;
  final String subdomain;
  final double baseAmount;
  final double gstAmount;
  final double totalAmount;

  const WebsiteOrder({
    required this.websiteOrderId,
    required this.razorpayOrderId,
    required this.keyId,
    required this.amountPaise,
    required this.currency,
    required this.orderType,
    required this.subdomain,
    required this.baseAmount,
    required this.gstAmount,
    required this.totalAmount,
  });

  factory WebsiteOrder.fromJson(Map<String, dynamic> j) => WebsiteOrder(
        websiteOrderId: _i(j['websiteOrderId']),
        razorpayOrderId: '${j['razorpayOrderId'] ?? ''}',
        keyId: '${j['keyId'] ?? ''}',
        amountPaise: _i(j['amountPaise']),
        currency: '${j['currency'] ?? 'INR'}',
        orderType: '${j['orderType'] ?? ''}',
        subdomain: '${j['subdomain'] ?? ''}',
        baseAmount: _d(j['baseAmount']),
        gstAmount: _d(j['gstAmount']),
        totalAmount: _d(j['totalAmount']),
      );
}

/// Server response to `POST /api/website-billing/verify` — post-payment result.
/// `provisionStatus` is "Active" when the site is already live, "Provisioning"
/// when the background worker is still setting it up (poll order-status), or
/// "ActivationFailed" when auto-provisioning failed (support intervention).
class WebsiteVerifyResult {
  final bool isSuccess;
  final String paymentStatus; // "PAID"
  final String orderType;
  final String subdomain;
  final String provisionStatus; // Provisioning | Active | ActivationFailed
  final String? visitUrl;
  final DateTime? endDate;
  final String? message;

  const WebsiteVerifyResult({
    required this.isSuccess,
    required this.paymentStatus,
    required this.orderType,
    required this.subdomain,
    required this.provisionStatus,
    this.visitUrl,
    this.endDate,
    this.message,
  });

  factory WebsiteVerifyResult.fromJson(Map<String, dynamic> j) =>
      WebsiteVerifyResult(
        isSuccess: j['isSuccess'] == true,
        paymentStatus: '${j['paymentStatus'] ?? ''}',
        orderType: '${j['orderType'] ?? ''}',
        subdomain: '${j['subdomain'] ?? ''}',
        provisionStatus: '${j['provisionStatus'] ?? ''}',
        visitUrl: _s(j['visitUrl']),
        endDate: _dt(j['endDate']),
        message: _s(j['message']),
      );

  bool get isActive => provisionStatus.toLowerCase() == 'active';
  bool get isProvisioning => provisionStatus.toLowerCase() == 'provisioning';
  bool get isFailed => provisionStatus.toLowerCase() == 'activationfailed';
}

/// Live status of an order (`GET /api/website-billing/order-status/{id}` and
/// `/latest-order`) — polled after payment while the site is provisioning.
class WebsiteOrderStatus {
  final int websiteOrderId;
  final int clubId;
  final String orderType;
  final String subdomain;
  final String paymentStatus;
  final String status; // AwaitingPayment | Provisioning | Active | ActivationFailed
  final String? visitUrl;
  final DateTime? endDate;

  const WebsiteOrderStatus({
    required this.websiteOrderId,
    required this.clubId,
    required this.orderType,
    required this.subdomain,
    required this.paymentStatus,
    required this.status,
    this.visitUrl,
    this.endDate,
  });

  factory WebsiteOrderStatus.fromJson(Map<String, dynamic> j) =>
      WebsiteOrderStatus(
        websiteOrderId: _i(j['websiteOrderId']),
        clubId: _i(j['clubId']),
        orderType: '${j['orderType'] ?? ''}',
        subdomain: '${j['subdomain'] ?? ''}',
        paymentStatus: '${j['paymentStatus'] ?? ''}',
        status: '${j['status'] ?? ''}',
        visitUrl: _s(j['visitUrl']),
        endDate: _dt(j['endDate']),
      );

  bool get isActive => status.toLowerCase() == 'active';
  bool get isProvisioning => status.toLowerCase() == 'provisioning';
  bool get isFailed => status.toLowerCase() == 'activationfailed';
  bool get isAwaitingPayment => status.toLowerCase() == 'awaitingpayment';
}
