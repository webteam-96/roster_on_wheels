import '../constants/api_constants.dart';
import '../network/api_client.dart';
import '../../data/models/wallet_models.dart';

/// Client for the wallet credit top-up endpoints (`/api/wallet/*`). A club or
/// district admin (role 2) buys email credits via Razorpay. The server
/// is authoritative on pricing; a failed create/verify surfaces as an
/// `ApiException` whose `{message}` is user-facing.
class WalletApi {
  final ApiClient _api = ApiClient();

  Future<WalletBalance> getBalance({
    required String scope,
    int clubId = 0,
    int districtId = 0,
  }) async {
    final path = scope == 'district'
        ? ApiConstants.creditBalanceDistrict(districtId)
        : ApiConstants.creditBalanceClub(clubId);
    final res = await _api.get<dynamic>(path, fromJson: (j) => j);
    final d = res.data;
    return WalletBalance.fromJson(
        d is Map ? d.cast<String, dynamic>() : const <String, dynamic>{});
  }

  /// Live price preview for an entered base amount (no side effects).
  Future<WalletQuote> getQuote({
    required String creditType,
    required num amount,
  }) async {
    final res = await _api.get<dynamic>(
      ApiConstants.walletQuote,
      queryParams: {'creditType': creditType, 'amount': amount},
      fromJson: (j) => j,
    );
    final d = res.data;
    return WalletQuote.fromJson(
        d is Map ? d.cast<String, dynamic>() : const <String, dynamic>{});
  }

  /// Creates the Razorpay order (server re-validates the amount). `scope` is
  /// "club" or "district"; pass the matching id.
  Future<WalletTopupOrder> createOrder({
    required String scope,
    int clubId = 0,
    int districtId = 0,
    required String creditType,
    required num amount,
  }) async {
    final res = await _api.post<dynamic>(
      ApiConstants.walletCreateOrder,
      body: {
        'scope': scope,
        'clubId': clubId,
        'districtId': districtId,
        'creditType': creditType,
        'amount': amount,
      },
      fromJson: (j) => j,
    );
    final d = res.data;
    return WalletTopupOrder.fromJson(
        d is Map ? d.cast<String, dynamic>() : const <String, dynamic>{});
  }

  /// Confirms the payment; on success the server credits the wallet and returns
  /// the new balance.
  Future<WalletTopupResult> verify({
    required int topupOrderId,
    required String razorpayOrderId,
    required String razorpayPaymentId,
    required String razorpaySignature,
  }) async {
    final res = await _api.post<dynamic>(
      ApiConstants.walletVerify,
      body: {
        'topupOrderId': topupOrderId,
        'razorpayOrderId': razorpayOrderId,
        'razorpayPaymentId': razorpayPaymentId,
        'razorpaySignature': razorpaySignature,
      },
      fromJson: (j) => j,
    );
    final d = res.data;
    return WalletTopupResult.fromJson(
        d is Map ? d.cast<String, dynamic>() : const <String, dynamic>{});
  }
}
