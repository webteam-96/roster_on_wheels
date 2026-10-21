import 'package:rotary_flutter_app/core/brand/brand.dart';

/// Structured membership-dues payment receipt returned by
/// `GET /api/mobile/my-membership-dues/payments/{paymentId}/receipt/data`.
///
/// Mirrors the backend `DuesReceiptDto` — the same numbers/wording the receipt
/// e-mail (and the downloadable PDF at `.../receipt`) render, so the native
/// receipt screen and the PDF never disagree.
class DuesReceipt {
  final int paymentId;
  final int duesId;

  final String memberName;
  final String? districtNumber;
  final String? clubName;
  final String? purpose;
  final String status; // always "Paid" (backend-guarded)
  final String paymentDateTime; // "dd-MMM-yyyy hh:mm tt"
  final String? approverRemark;

  final List<DuesReceiptLine> fees;

  final double totalAmount;
  final double totalGatewayCharges;
  final double grandTotal;

  final String organisationName;
  final String documentTitle;
  final String generatedOn;

  const DuesReceipt({
    required this.paymentId,
    required this.duesId,
    required this.memberName,
    this.districtNumber,
    this.clubName,
    this.purpose,
    required this.status,
    required this.paymentDateTime,
    this.approverRemark,
    required this.fees,
    required this.totalAmount,
    required this.totalGatewayCharges,
    required this.grandTotal,
    required this.organisationName,
    required this.documentTitle,
    required this.generatedOn,
  });

  factory DuesReceipt.fromJson(Map<String, dynamic> j) => DuesReceipt(
        paymentId: _toInt(j['paymentId']),
        duesId: _toInt(j['duesId']),
        memberName: j['memberName']?.toString() ?? '',
        districtNumber: j['districtNumber']?.toString(),
        clubName: j['clubName']?.toString(),
        purpose: j['purpose']?.toString(),
        status: j['status']?.toString() ?? 'Paid',
        paymentDateTime: j['paymentDateTime']?.toString() ?? '',
        approverRemark: j['approverRemark']?.toString(),
        fees: (j['fees'] as List<dynamic>? ?? const [])
            .map((e) => DuesReceiptLine.fromJson((e as Map).cast<String, dynamic>()))
            .toList(),
        totalAmount: _toDouble(j['totalAmount']),
        totalGatewayCharges: _toDouble(j['totalGatewayCharges']),
        grandTotal: _toDouble(j['grandTotal']),
        organisationName:
            j['organisationName']?.toString() ?? Brand.current.productName,
        documentTitle: j['documentTitle']?.toString() ?? 'Payment Receipt',
        generatedOn: j['generatedOn']?.toString() ?? '',
      );
}

/// One row of the receipt's fee table.
class DuesReceiptLine {
  final int srNo;
  final int feeType; // 1=Annual, 2=Semi 1, 3=Semi 2
  final String feeTypeLabel;
  final double amount;
  final String amountText; // formatted by the API, e.g. "$12,500"
  final bool isOnline;
  final String mode; // "Online" / "Offline"
  final double? gatewayCharges; // null for offline
  final String gatewayChargesText;
  final String paymentDate; // "dd-MMM-yyyy"
  final String transactionId;

  const DuesReceiptLine({
    required this.srNo,
    required this.feeType,
    required this.feeTypeLabel,
    required this.amount,
    required this.amountText,
    required this.isOnline,
    required this.mode,
    this.gatewayCharges,
    required this.gatewayChargesText,
    required this.paymentDate,
    required this.transactionId,
  });

  factory DuesReceiptLine.fromJson(Map<String, dynamic> j) => DuesReceiptLine(
        srNo: _toInt(j['srNo']),
        feeType: _toInt(j['feeType']),
        feeTypeLabel: j['feeTypeLabel']?.toString() ?? '',
        amount: _toDouble(j['amount']),
        amountText: j['amountText']?.toString() ?? '',
        isOnline: j['isOnline'] == true,
        mode: j['mode']?.toString() ?? '',
        gatewayCharges:
            j['gatewayCharges'] == null ? null : _toDouble(j['gatewayCharges']),
        gatewayChargesText: j['gatewayChargesText']?.toString() ?? '',
        paymentDate: j['paymentDate']?.toString() ?? '',
        transactionId: j['transactionId']?.toString() ?? '',
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
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v) ?? 0.0;
  return 0.0;
}
