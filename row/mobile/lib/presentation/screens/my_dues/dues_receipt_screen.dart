import 'dart:io';
import 'package:flutter/material.dart' hide Text;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../data/models/dues_receipt_model.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/utils/money_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Native membership-dues payment receipt for the logged-in member.
///
/// Loads the structured receipt from
/// `GET /api/mobile/my-membership-dues/payments/{paymentId}/receipt/data`
/// (same numbers as the receipt e-mail) and lets the member download/share the
/// official PDF from `.../receipt` via the OS sheet.
class DuesReceiptScreen extends StatefulWidget {
  final int paymentId;

  /// Shown while the receipt loads so the screen isn't blank.
  final String? feeLabel;

  const DuesReceiptScreen({
    super.key,
    required this.paymentId,
    this.feeLabel,
  });

  @override
  State<DuesReceiptScreen> createState() => _DuesReceiptScreenState();
}

class _DuesReceiptScreenState extends State<DuesReceiptScreen> {
  final _api = ApiClient();
  DuesReceipt? _receipt;
  bool _loading = true;
  String? _error;
  bool _downloading = false;

  String get _basePath =>
      '/api/mobile/my-membership-dues/payments/${widget.paymentId}/receipt';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<DuesReceipt>(
        '$_basePath/data',
        fromJson: (j) => DuesReceipt.fromJson((j as Map).cast<String, dynamic>()),
      );
      if (!mounted) return;
      setState(() {
        _receipt = resp.data;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = _friendlyError(e);
        _loading = false;
      });
    }
  }

  String _friendlyError(Object e) {
    final s = e.toString();
    if (s.contains('403')) return 'This receipt isn\'t available for your account.';
    if (s.contains('404')) return 'Receipt not found.';
    if (s.contains('400')) return 'A receipt is only available once the payment is complete.';
    return 'Couldn\'t load the receipt. Please try again.';
  }

  Future<void> _sharePdf() async {
    if (_downloading) return;
    final messenger = ScaffoldMessenger.of(context);
    final box = context.findRenderObject() as RenderBox?;
    final origin = (box != null && box.hasSize)
        ? box.localToGlobal(Offset.zero) & box.size
        : const Rect.fromLTWH(0, 0, 1, 1);

    setState(() => _downloading = true);
    try {
      final bytes = await _api.downloadBytes(_basePath);
      final dir = await getTemporaryDirectory();
      final r = _receipt;
      final name = r != null
          ? 'receipt-${r.duesId}-${r.paymentId}.pdf'
          : 'receipt-${widget.paymentId}.pdf';
      final file = File('${dir.path}/$name');
      await file.writeAsBytes(bytes, flush: true);
      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'application/pdf')],
        subject: 'Payment Receipt',
        sharePositionOrigin: origin,
      );
    } catch (_) {
      messenger.showSnackBar(const SnackBar(
        content: Text('Couldn\'t download the receipt PDF. Please try again.'),
      ));
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Payment Receipt'),
      body: _loading
          ? const LoadingWidget()
          : _error != null
              ? EmptyStateWidget(
                  icon: Icons.receipt_long_rounded,
                  title: 'Receipt unavailable',
                  subtitle: _error!,
                  actionLabel: 'Retry',
                  onAction: _load,
                )
              : _buildReceipt(_receipt!),
      bottomNavigationBar: (_error == null && !_loading)
          ? _buildDownloadBar()
          : null,
    );
  }

  Widget _buildDownloadBar() {
    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: SizedBox(
        height: 48,
        child: FilledButton.icon(
          onPressed: _downloading ? null : _sharePdf,
          icon: _downloading
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white),
                )
              : const Icon(Icons.download_rounded, size: 18),
          label: Text(
            _downloading ? 'Preparing…' : 'Download / Share PDF',
            style: AppFonts.body(
                fontSize: 14, fontWeight: FontWeight.w700),
          ),
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.primary,
            shape: const StadiumBorder(),
          ),
        ),
      ),
    );
  }

  Widget _buildReceipt(DuesReceipt r) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      children: [
        Container(
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _header(r),
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    _metaRow('Member', r.memberName),
                    if ((r.clubName ?? '').isNotEmpty)
                      _metaRow('Club', r.clubName!),
                    if ((r.districtNumber ?? '').isNotEmpty)
                      _metaRow('District', r.districtNumber!),
                    if ((r.purpose ?? '').isNotEmpty)
                      _metaRow('Purpose', r.purpose!),
                    _metaRow('Date & Time', r.paymentDateTime),
                    _metaRow('Status', r.status, valueColor: AppColors.success),
                    if ((r.approverRemark ?? '').isNotEmpty)
                      _metaRow('Approver\'s Remark', r.approverRemark!),
                  ],
                ),
              ),
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Fees Paid',
                      style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary)),
                ),
              ),
              ...r.fees.map(_feeTile),
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    _totalRow('Total Amount', r.totalAmount),
                    if (r.totalGatewayCharges > 0)
                      _totalRow('Payment Gateway Charges', r.totalGatewayCharges),
                    const SizedBox(height: 6),
                    _totalRow('Grand Total', r.grandTotal, emphasize: true),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Center(
          child: Text(
            r.generatedOn.isEmpty
                ? r.organisationName
                : '${r.organisationName}  •  Generated ${r.generatedOn}',
            textAlign: TextAlign.center,
            style: AppFonts.body(
                fontSize: 13, color: AppColors.textMuted),
          ),
        ),
      ],
    );
  }

  Widget _header(DuesReceipt r) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.06),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.receipt_long_rounded,
                color: AppColors.primary, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(r.documentTitle,
                    style: AppFonts.body(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary)),
                const SizedBox(height: 2),
                Text(r.organisationName,
                    style: AppFonts.body(
                        fontSize: 13, color: AppColors.textSecondary)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _metaRow(String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(label,
                style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary)),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(value,
                style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: valueColor ?? AppColors.textPrimary)),
          ),
        ],
      ),
    );
  }

  Widget _feeTile(DuesReceiptLine f) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(f.feeTypeLabel,
                    style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary)),
              ),
              Text(f.amountText,
                  style: AppFonts.body(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary)),
            ],
          ),
          const SizedBox(height: 3),
          Wrap(
            spacing: 10,
            runSpacing: 2,
            children: [
              _miniMeta('Mode', f.mode),
              if (f.gatewayChargesText.isNotEmpty &&
                  f.gatewayChargesText != 'N/A')
                _miniMeta('Charges', f.gatewayChargesText),
              if (f.paymentDate.isNotEmpty) _miniMeta('Date', f.paymentDate),
              if (f.transactionId.isNotEmpty && f.transactionId != 'N/A')
                _miniMeta('Txn', f.transactionId),
            ],
          ),
        ],
      ),
    );
  }

  Widget _miniMeta(String label, String value) {
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: '$label: ',
            style: AppFonts.body(
                fontSize: 13, color: AppColors.textMuted),
          ),
          TextSpan(
            text: value,
            style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _totalRow(String label, double value, {bool emphasize = false}) {
    final style = AppFonts.body(
      fontSize: emphasize ? 14.5 : 12.5,
      fontWeight: emphasize ? FontWeight.w800 : FontWeight.w600,
      color: emphasize ? AppColors.textPrimary : AppColors.textSecondary,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: style),
          Text(formatMoney(value, null), style: style),
        ],
      ),
    );
  }

}
