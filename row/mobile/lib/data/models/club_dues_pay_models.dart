// Models for the CLUB-level dues *payer* surface — a current-year Club
// President / Secretary / Treasurer paying their club's district dues campaign
// via /api/mobile/club-dues/*. Distinct from the member's own membership dues
// (/api/mobile/my-membership-dues).
//
// The `my-clubs` rows come back from a Dapper `dynamic` query, so their keys are
// PascalCase (DuesId, ClubName, …); the typed DTOs (public dues, pay session,
// pay link) serialise camelCase. Every fromJson therefore reads both casings.

int _asInt(dynamic v) =>
    v is int ? v : (v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0);

double _asDouble(dynamic v) =>
    v is num ? v.toDouble() : double.tryParse('${v ?? ''}') ?? 0;

bool _asBool(dynamic v) =>
    v is bool ? v : (v == 1 || '$v'.toLowerCase() == 'true');

String? _asStr(dynamic v) => v?.toString();

/// One club the signed-in officer may pay for (from GET /my-clubs).
class ClubDuesPayableClub {
  final int duesId;
  final int clubId;
  final String? purpose;
  final String? rotaryYear;
  final String? clubName;
  final String? districtNumber;

  const ClubDuesPayableClub({
    required this.duesId,
    required this.clubId,
    this.purpose,
    this.rotaryYear,
    this.clubName,
    this.districtNumber,
  });

  factory ClubDuesPayableClub.fromJson(Map<String, dynamic> j) =>
      ClubDuesPayableClub(
        duesId: _asInt(j['duesId'] ?? j['DuesId']),
        clubId: _asInt(j['clubId'] ?? j['ClubId']),
        purpose: _asStr(j['purpose'] ?? j['Purpose']),
        rotaryYear: _asStr(j['rotaryYear'] ?? j['RotaryYear']),
        clubName: _asStr(j['clubName'] ?? j['ClubName']),
        districtNumber: _asStr(j['districtNumber'] ?? j['DistrictNumber']),
      );
}

/// The public pay-page snapshot for one club/campaign (GET /{duesId}?clubId=).
class ClubDuesPublic {
  final int id;
  final String? purpose;
  final String? purposeDescription;
  final String? purposeLogo;
  final String? districtNumber;
  final int modeOfPayment; // bitmask/flag: which payment modes the campaign allows
  final int clubId;
  final String? clubName;
  final double perMemberRate;
  final int memberCount;
  final int paidCount;
  final int unpaidCount;
  final double amountOwed;
  final bool isFullyPaid;
  final bool isPending;
  final String? lastRejectedReason;
  final DateTime? lastRejectedDate;
  final String? offlineBankName;
  final String? offlineAccountNumber;
  final String? offlineIfscCode;

  const ClubDuesPublic({
    required this.id,
    this.purpose,
    this.purposeDescription,
    this.purposeLogo,
    this.districtNumber,
    required this.modeOfPayment,
    required this.clubId,
    this.clubName,
    required this.perMemberRate,
    required this.memberCount,
    required this.paidCount,
    required this.unpaidCount,
    required this.amountOwed,
    required this.isFullyPaid,
    required this.isPending,
    this.lastRejectedReason,
    this.lastRejectedDate,
    this.offlineBankName,
    this.offlineAccountNumber,
    this.offlineIfscCode,
  });

  factory ClubDuesPublic.fromJson(Map<String, dynamic> j) => ClubDuesPublic(
        id: _asInt(j['id'] ?? j['Id']),
        purpose: _asStr(j['purpose'] ?? j['Purpose']),
        purposeDescription:
            _asStr(j['purposeDescription'] ?? j['PurposeDescription']),
        purposeLogo: _asStr(j['purposeLogo'] ?? j['PurposeLogo']),
        districtNumber: _asStr(j['districtNumber'] ?? j['DistrictNumber']),
        modeOfPayment: _asInt(j['modeOfPayment'] ?? j['ModeOfPayment']),
        clubId: _asInt(j['fkClubId'] ?? j['FkClubId'] ?? j['clubId']),
        clubName: _asStr(j['clubName'] ?? j['ClubName']),
        perMemberRate: _asDouble(j['perMemberRate'] ?? j['PerMemberRate']),
        memberCount: _asInt(j['memberCount'] ?? j['MemberCount']),
        paidCount: _asInt(j['paidCount'] ?? j['PaidCount']),
        unpaidCount: _asInt(j['unpaidCount'] ?? j['UnpaidCount']),
        amountOwed: _asDouble(j['amountOwed'] ?? j['AmountOwed']),
        isFullyPaid: _asBool(j['isFullyPaid'] ?? j['IsFullyPaid']),
        isPending: _asBool(j['isPending'] ?? j['IsPending']),
        lastRejectedReason:
            _asStr(j['lastRejectedReason'] ?? j['LastRejectedReason']),
        lastRejectedDate: DateTime.tryParse(
            '${j['lastRejectedDate'] ?? j['LastRejectedDate'] ?? ''}'),
        offlineBankName: _asStr(j['offlineBankName'] ?? j['OfflineBankName']),
        offlineAccountNumber:
            _asStr(j['offlineAccountNumber'] ?? j['OfflineAccountNumber']),
        offlineIfscCode: _asStr(j['offlineIfscCode'] ?? j['OfflineIfscCode']),
      );
}

/// Razorpay checkout session (POST /{duesId}/pay).
class ClubDuesPaySession {
  final String keyId;
  final String razorpayOrderId;
  final int amountPaise;
  final String receipt;
  final int paymentId;
  final String? customerName;
  final String? customerEmail;
  final String? customerPhone;

  const ClubDuesPaySession({
    required this.keyId,
    required this.razorpayOrderId,
    required this.amountPaise,
    required this.receipt,
    required this.paymentId,
    this.customerName,
    this.customerEmail,
    this.customerPhone,
  });

  factory ClubDuesPaySession.fromJson(Map<String, dynamic> j) =>
      ClubDuesPaySession(
        keyId: _asStr(j['keyId'] ?? j['KeyId']) ?? '',
        razorpayOrderId:
            _asStr(j['razorpayOrderId'] ?? j['RazorpayOrderId']) ?? '',
        amountPaise: _asInt(j['amountPaise'] ?? j['AmountPaise']),
        receipt: _asStr(j['receipt'] ?? j['Receipt']) ?? '',
        paymentId: _asInt(j['paymentId'] ?? j['PaymentId']),
        customerName: _asStr(j['customerName'] ?? j['CustomerName']),
        customerEmail: _asStr(j['customerEmail'] ?? j['CustomerEmail']),
        customerPhone: _asStr(j['customerPhone'] ?? j['CustomerPhone']),
      );
}

/// 1-hour shareable pay link (POST /{duesId}/pay-link).
class ClubDuesPayLink {
  final String url;
  final DateTime? expiresAtUtc;

  const ClubDuesPayLink({required this.url, this.expiresAtUtc});

  factory ClubDuesPayLink.fromJson(Map<String, dynamic> j) => ClubDuesPayLink(
        url: _asStr(j['url'] ?? j['Url']) ?? '',
        expiresAtUtc:
            DateTime.tryParse('${j['expiresAtUtc'] ?? j['ExpiresAtUtc'] ?? ''}'),
      );
}

/// Result of verifying an online payment (POST public /{duesId}/verify-payment).
class ClubDuesVerifyResult {
  final bool isSuccess;
  final String? orderStatus;
  final double? amount;
  final DateTime? paymentDate;

  const ClubDuesVerifyResult({
    required this.isSuccess,
    this.orderStatus,
    this.amount,
    this.paymentDate,
  });

  factory ClubDuesVerifyResult.fromJson(Map<String, dynamic> j) =>
      ClubDuesVerifyResult(
        isSuccess: _asBool(j['isSuccess'] ?? j['IsSuccess']),
        orderStatus: _asStr(j['orderStatus'] ?? j['OrderStatus']),
        amount: (j['amount'] ?? j['Amount']) == null
            ? null
            : _asDouble(j['amount'] ?? j['Amount']),
        paymentDate:
            DateTime.tryParse('${j['paymentDate'] ?? j['PaymentDate'] ?? ''}'),
      );
}
