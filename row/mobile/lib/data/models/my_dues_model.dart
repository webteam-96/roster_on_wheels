class MyDues {
  final int duesId;
  final int clubId;
  final String clubName;
  final String districtNumber;
  final String rotaryYear;
  final String? purpose;
  final String? purposeLogo;
  final String categoryType;
  final String? payUrl;
  final List<MyDuesFee> fees;

  const MyDues({
    required this.duesId,
    required this.clubId,
    required this.clubName,
    required this.districtNumber,
    required this.rotaryYear,
    this.purpose,
    this.purposeLogo,
    required this.categoryType,
    this.payUrl,
    required this.fees,
  });

  factory MyDues.fromJson(Map<String, dynamic> j) => MyDues(
        duesId: _toInt(j['duesId']),
        clubId: _toInt(j['clubId']),
        clubName: j['clubName']?.toString() ?? '',
        districtNumber: j['districtNumber']?.toString() ?? '',
        rotaryYear: j['rotaryYear']?.toString() ?? '',
        purpose: j['purpose']?.toString(),
        purposeLogo: j['purposeLogo']?.toString(),
        categoryType: j['categoryType']?.toString() ?? 'Standard',
        payUrl: j['payUrl']?.toString(),
        fees: ((j['fees'] as List?) ?? const [])
            .map((e) => MyDuesFee.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  bool get hasUnpaidFee => fees.any((f) => !f.isPaid);
  double get totalAmount => fees.fold<double>(0, (sum, f) => sum + f.amount);
  double get paidAmount =>
      fees.where((f) => f.isPaid).fold<double>(0, (sum, f) => sum + f.amount);

  // ── Plan-aware helpers ────────────────────────────────────────────────
  // Annual (feeType 1) and Semi 1 + Semi 2 (feeType 2 + 3) are two mutually
  // exclusive ways to pay the SAME year's dues — whole-year OR two halves — not
  // three separate charges. Once the member pays down one path, the other is no
  // longer owed, so totals must follow the chosen path (the flat totalAmount /
  // paidAmount above sum ALL three and overstate the bill once anything is paid).

  MyDuesFee? feeOf(int type) {
    for (final f in fees) {
      if (f.feeType == type) return f;
    }
    return null;
  }

  bool get annualPaid => feeOf(1)?.isPaid ?? false;
  bool get semi1Paid => feeOf(2)?.isPaid ?? false;
  bool get semi2Paid => feeOf(3)?.isPaid ?? false;
  bool get anyPlanPaid => annualPaid || semi1Paid || semi2Paid;

  /// Bill for the path the member has committed to. Before any payment we keep
  /// the flat sum (the member hasn't chosen a path yet — "show same as now").
  double get effectiveTotal {
    if (annualPaid) return feeOf(1)?.amount ?? 0;
    if (semi1Paid || semi2Paid) {
      return (feeOf(2)?.amount ?? 0) + (feeOf(3)?.amount ?? 0);
    }
    return totalAmount;
  }

  double get effectivePaid {
    if (annualPaid) return feeOf(1)?.amount ?? 0;
    var p = 0.0;
    if (semi1Paid) p += feeOf(2)?.amount ?? 0;
    if (semi2Paid) p += feeOf(3)?.amount ?? 0;
    return p;
  }

  double get effectiveOutstanding {
    final o = effectiveTotal - effectivePaid;
    return o < 0 ? 0 : o;
  }

  bool get planFullyPaid => anyPlanPaid && effectiveOutstanding <= 0;
}

class MyDuesFee {
  final int feeType;
  final String label;
  final double amount;
  final bool isPaid;
  final String paymentStatus;
  final DateTime? paymentDate;
  final String? transactionId;

  /// Backing payment row id — the key the receipt endpoint
  /// (`/my-membership-dues/payments/{paymentId}/receipt`) needs. Present only on
  /// paid fees, and only once the backend surfaces it on the fee JSON. Null →
  /// the Receipt action stays disabled/"not available yet".
  final int? paymentId;

  const MyDuesFee({
    required this.feeType,
    required this.label,
    required this.amount,
    required this.isPaid,
    required this.paymentStatus,
    this.paymentDate,
    this.transactionId,
    this.paymentId,
  });

  bool get hasReceipt => isPaid && (paymentId ?? 0) > 0;

  factory MyDuesFee.fromJson(Map<String, dynamic> j) => MyDuesFee(
        feeType: _toInt(j['feeType']),
        label: j['label']?.toString() ?? '',
        amount: _toDouble(j['amount']),
        isPaid: _toBool(j['isPaid']),
        paymentStatus: j['paymentStatus']?.toString() ?? 'Unpaid',
        paymentDate: _parseDate(j['paymentDate']),
        transactionId: j['transactionId']?.toString(),
        paymentId: j['paymentId'] == null ? null : _toInt(j['paymentId']),
      );
}

int _toInt(dynamic v) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v) ?? 0;
  return 0;
}

double _toDouble(dynamic v) {
  if (v is double) return v;
  if (v is int) return v.toDouble();
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v) ?? 0.0;
  return 0.0;
}

bool _toBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase();
    return s == 'true' || s == '1';
  }
  return false;
}

DateTime? _parseDate(dynamic v) {
  if (v == null) return null;
  // Backend zero dates (`0001-01-01`, from ConvertZeroDateTime) mean "no value".
  if (v is DateTime) return v.year <= 1 ? null : v;
  final s = v.toString();
  if (s.isEmpty) return null;
  final d = DateTime.tryParse(s);
  return (d == null || d.year <= 1) ? null : d;
}
