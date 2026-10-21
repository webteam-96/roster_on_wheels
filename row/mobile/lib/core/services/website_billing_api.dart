import '../constants/api_constants.dart';
import '../network/api_client.dart';
import '../../data/models/website_billing_models.dart';

/// Client for the club-website self-service Buy / Renew endpoints
/// (`/api/website-billing/*`). A club admin (role 2) of the club buys a new
/// website or renews an expiring one via Razorpay. The server is authoritative
/// on pricing, subdomain rules and provisioning; a failed create/verify surfaces
/// as an `ApiException` whose `{message}` is user-facing. Mirrors `WalletApi`.
class WebsiteBillingApi {
  final ApiClient _api = ApiClient();

  /// Price + New/Renewal + new-expiry preview for a club (no side effects).
  Future<WebsiteQuote> getQuote(int clubId) async {
    final res = await _api.get<dynamic>(
      ApiConstants.websiteBillingQuote,
      queryParams: {'clubId': clubId},
      fromJson: (j) => j,
    );
    final d = res.data;
    return WebsiteQuote.fromJson(
        d is Map ? d.cast<String, dynamic>() : const <String, dynamic>{});
  }

  /// Availability + format check for a proposed subdomain (New purchase only).
  Future<SubdomainCheck> checkSubdomain(String input) async {
    final res = await _api.get<dynamic>(
      ApiConstants.websiteBillingCheckSubdomain,
      queryParams: {'input': input},
      fromJson: (j) => j,
    );
    final d = res.data;
    return SubdomainCheck.fromJson(
        d is Map ? d.cast<String, dynamic>() : const <String, dynamic>{});
  }

  /// Creates the Razorpay order (server re-validates price + subdomain).
  /// `subdomainInput` is required for a New purchase and ignored for a Renewal;
  /// `themeId` null = default theme.
  Future<WebsiteOrder> createOrder({
    required int clubId,
    String? subdomainInput,
    int reminderDays = 30,
    int? themeId,
  }) async {
    final res = await _api.post<dynamic>(
      ApiConstants.websiteBillingCreateOrder,
      body: {
        'clubId': clubId,
        if (subdomainInput != null) 'subdomainInput': subdomainInput,
        'reminderDays': reminderDays,
        if (themeId != null) 'themeId': themeId,
      },
      fromJson: (j) => j,
    );
    final d = res.data;
    return WebsiteOrder.fromJson(
        d is Map ? d.cast<String, dynamic>() : const <String, dynamic>{});
  }

  /// Confirms the payment; on success the server captures it and begins
  /// provisioning (which may already be `Active` or still `Provisioning`).
  Future<WebsiteVerifyResult> verify({
    required int websiteOrderId,
    required String razorpayOrderId,
    required String razorpayPaymentId,
    required String razorpaySignature,
  }) async {
    final res = await _api.post<dynamic>(
      ApiConstants.websiteBillingVerify,
      body: {
        'websiteOrderId': websiteOrderId,
        'razorpayOrderId': razorpayOrderId,
        'razorpayPaymentId': razorpayPaymentId,
        'razorpaySignature': razorpaySignature,
      },
      fromJson: (j) => j,
    );
    final d = res.data;
    return WebsiteVerifyResult.fromJson(
        d is Map ? d.cast<String, dynamic>() : const <String, dynamic>{});
  }

  /// Live status of an order — polled after payment while it provisions.
  Future<WebsiteOrderStatus> getOrderStatus(int orderId) async {
    final res = await _api.get<dynamic>(
      ApiConstants.websiteBillingOrderStatus(orderId),
      fromJson: (j) => j,
    );
    final d = res.data;
    return WebsiteOrderStatus.fromJson(
        d is Map ? d.cast<String, dynamic>() : const <String, dynamic>{});
  }

  /// The club's latest order (used to resume an in-progress provisioning on
  /// screen entry). Returns null when the club has no order yet.
  Future<WebsiteOrderStatus?> getLatestOrder(int clubId) async {
    final res = await _api.get<dynamic>(
      ApiConstants.websiteBillingLatestOrder,
      queryParams: {'clubId': clubId},
      fromJson: (j) => j,
    );
    final d = res.data;
    if (d is Map && d.isNotEmpty) {
      return WebsiteOrderStatus.fromJson(d.cast<String, dynamic>());
    }
    return null;
  }
}
