import '../network/api_client.dart';
import '../../data/models/club_dues_pay_models.dart';

/// Client for the CLUB-dues *payer* endpoints (`/api/mobile/club-dues/*`). Only a
/// current-year Club President / Secretary / Treasurer may pay for a club — the
/// server 403s everyone else, and `my-clubs` is empty for non-officers, so the
/// app simply shows nothing to pay. A failed call surfaces its `{message}` as an
/// `ApiException`.
///
/// Online payment mirrors the wallet flow: [createPayOrder] → native Razorpay
/// checkout (openRazorpayCheckout) → [verifyPayment]. The verify endpoint lives
/// on the public controller (signature-checked, no token needed).
class ClubDuesPayApi {
  final ApiClient _api = ApiClient();

  static const _base = '/api/mobile/club-dues';

  /// Clubs the signed-in officer may pay for, each with its campaign + club id.
  Future<List<ClubDuesPayableClub>> getMyClubs() async {
    final res = await _api.get<List<dynamic>>(
      '$_base/my-clubs',
      fromJson: (j) => j as List<dynamic>,
    );
    return (res.data ?? const [])
        .whereType<Map>()
        .map((e) => ClubDuesPayableClub.fromJson(e.cast<String, dynamic>()))
        .toList();
  }

  /// The live pay-page snapshot for one club/campaign (amount owed, counts, …).
  Future<ClubDuesPublic> getDues(int duesId, int clubId) async {
    final res = await _api.get<Map<String, dynamic>>(
      '$_base/$duesId',
      queryParams: {'clubId': clubId},
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    return ClubDuesPublic.fromJson(res.data ?? const {});
  }

  /// Creates the Razorpay order (server re-computes the amount owed).
  Future<ClubDuesPaySession> createPayOrder(int duesId, int clubId) async {
    final res = await _api.post<Map<String, dynamic>>(
      '$_base/$duesId/pay?clubId=$clubId',
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    return ClubDuesPaySession.fromJson(res.data ?? const {});
  }

  /// Confirms an online payment after native checkout. Posts to the public
  /// (signature-checked) verify endpoint — no token needed.
  Future<ClubDuesVerifyResult> verifyPayment({
    required int duesId,
    required int paymentId,
    required String razorpayOrderId,
    required String razorpayPaymentId,
    required String razorpaySignature,
  }) async {
    final res = await _api.post<Map<String, dynamic>>(
      '/api/public/club-dues/$duesId/verify-payment',
      body: {
        'paymentId': paymentId,
        'razorpayOrderId': razorpayOrderId,
        'razorpayPaymentId': razorpayPaymentId,
        'razorpaySignature': razorpaySignature,
      },
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    return ClubDuesVerifyResult.fromJson(res.data ?? const {});
  }

  /// Generates a 1-hour shareable pay link (send to someone else to pay online).
  Future<ClubDuesPayLink> getPayLink(int duesId, int clubId) async {
    final res = await _api.post<Map<String, dynamic>>(
      '$_base/$duesId/pay-link?clubId=$clubId',
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    return ClubDuesPayLink.fromJson(res.data ?? const {});
  }

  /// Submits an offline (cash/cheque/transfer) payment for approval. [fields]
  /// are the RecordOfflineClubDuesPaymentDto values as strings; [attachmentPath]
  /// is an optional proof file. Returns the server's confirmation message.
  Future<String> submitOffline({
    required int duesId,
    required int clubId,
    required Map<String, String> fields,
    String? attachmentPath,
  }) async {
    final res = await _api.sendMultipart<Map<String, dynamic>>(
      '$_base/$duesId/offline-payment',
      method: 'POST',
      queryParams: {'clubId': clubId},
      fields: fields,
      files: (attachmentPath == null || attachmentPath.isEmpty)
          ? null
          : {'attachment': attachmentPath},
      fromJson: (j) => (j as Map).cast<String, dynamic>(),
    );
    return res.data?['message']?.toString() ?? 'Submitted for approval.';
  }
}
