import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/club_dues_pay_api.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../../data/models/club_dues_pay_models.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import '../../widgets/common/razorpay_checkout.dart';
import 'club_dues_offline_screen.dart';
import 'package:rotary_flutter_app/core/utils/money_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Pay page for one club's district dues campaign. Online payment mirrors the
/// wallet flow: create order → native Razorpay checkout → verify. Offline opens
/// a submit-for-approval form. A 1-hour shareable pay link can also be sent.
class ClubDuesPayScreen extends StatefulWidget {
  final int duesId;
  final int clubId;
  final String? clubName;

  const ClubDuesPayScreen({
    super.key,
    required this.duesId,
    required this.clubId,
    this.clubName,
  });

  @override
  State<ClubDuesPayScreen> createState() => _ClubDuesPayScreenState();
}

class _ClubDuesPayScreenState extends State<ClubDuesPayScreen> {
  final _api = ClubDuesPayApi();
  ClubDuesPublic? _dues;
  bool _loading = true;
  String? _error;
  bool _paying = false;
  bool _sharing = false;

  bool get _showOnline =>
      _dues != null && (_dues!.modeOfPayment == 1 || _dues!.modeOfPayment == 3);
  bool get _showOffline =>
      _dues != null && (_dues!.modeOfPayment == 2 || _dues!.modeOfPayment == 3);

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
      final d = await _api.getDues(widget.duesId, widget.clubId);
      if (!mounted) return;
      setState(() {
        _dues = d;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is ApiException ? e.message : 'Could not load club dues.';
        _loading = false;
      });
    }
  }

  String _inr(double v) => formatMoney(v, null);

  Future<void> _payOnline() async {
    final dues = _dues;
    if (dues == null || _paying) return;
    setState(() => _paying = true);
    try {
      final session = await _api.createPayOrder(widget.duesId, widget.clubId);
      if (!mounted) return;
      final result = await openRazorpayCheckout(
        keyId: session.keyId,
        orderId: session.razorpayOrderId,
        amountPaise: session.amountPaise,
        name: dues.clubName ?? widget.clubName ?? 'District Dues',
        description: dues.purpose ?? 'District Dues',
        prefillEmail: session.customerEmail,
        prefillContact: session.customerPhone,
      );
      if (!mounted) return;
      if (result == null) {
        SnackbarUtils.showInfo(context, 'Payment cancelled.');
        return;
      }
      if (!result.success) {
        SnackbarUtils.showError(context, result.error ?? 'Payment failed.');
        return;
      }
      final verify = await _api.verifyPayment(
        duesId: widget.duesId,
        paymentId: session.paymentId,
        razorpayOrderId: session.razorpayOrderId,
        razorpayPaymentId: result.paymentId!,
        razorpaySignature: result.signature!,
      );
      if (!mounted) return;
      if (verify.isSuccess) {
        await _showSuccessDialog(verify);
        if (!mounted) return;
        await _load();
      } else {
        SnackbarUtils.showError(
          context,
          'Payment received but not yet confirmed. It will update shortly.',
        );
        await _load();
      }
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } catch (_) {
      if (mounted) {
        SnackbarUtils.showError(context, 'Something went wrong. Please try again.');
      }
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  Future<void> _showSuccessDialog(ClubDuesVerifyResult r) {
    return showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.check_circle_rounded,
            color: AppColors.success, size: 48),
        title: const Text('Payment successful'),
        content: Text(
          r.amount != null
              ? 'Your club dues payment of ${_inr(r.amount!)} was received.'
              : 'Your club dues payment was received.',
          textAlign: TextAlign.center,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }

  Future<void> _sharePayLink() async {
    if (_sharing) return;
    setState(() => _sharing = true);
    try {
      final link = await _api.getPayLink(widget.duesId, widget.clubId);
      if (!mounted) return;
      if (link.url.isEmpty) {
        SnackbarUtils.showError(context, 'Could not create a pay link.');
        return;
      }
      final club = _dues?.clubName ?? widget.clubName ?? 'our club';
      await Share.share(
        'Pay the Rotary district dues for $club here:\n${link.url}',
        subject: 'District Dues payment link',
      );
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Could not share the link.');
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  Future<void> _recordOffline() async {
    final dues = _dues;
    if (dues == null) return;
    final done = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => ClubDuesOfflineScreen(
        duesId: widget.duesId,
        clubId: widget.clubId,
        dues: dues,
      ),
    ));
    if (done == true) await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'District Dues'),
      body: _body(),
      bottomNavigationBar: _bottomBar(),
    );
  }

  Widget _body() {
    if (_loading) return const LoadingWidget();
    if (_error != null) return ErrorStateWidget(message: _error!, onRetry: _load);
    final dues = _dues!;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          _headerCard(dues),
          const SizedBox(height: 14),
          _amountCard(dues),
          if ((dues.lastRejectedReason ?? '').isNotEmpty) ...[
            const SizedBox(height: 14),
            _rejectedBanner(dues),
          ],
          if (_showOffline && (dues.offlineBankName ?? '').isNotEmpty) ...[
            const SizedBox(height: 14),
            _bankCard(dues),
          ],
        ],
      ),
    );
  }

  Widget _headerCard(ClubDuesPublic d) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            d.clubName ?? widget.clubName ?? 'Club ${widget.clubId}',
            style: AppFonts.body(
                fontSize: 17, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            [
              if ((d.purpose ?? '').isNotEmpty) d.purpose!,
              if ((d.districtNumber ?? '').isNotEmpty)
                'District ${d.districtNumber}',
            ].join(' · '),
            style: AppFonts.body(
                fontSize: 13,
                color: AppColors.textSecondary,
                fontWeight: FontWeight.w500),
          ),
          if ((d.purposeDescription ?? '').isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              d.purposeDescription!,
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.textSecondary, height: 1.4),
            ),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              _statChip('Members', '${d.memberCount}'),
              const SizedBox(width: 8),
              _statChip('Paid', '${d.paidCount}', color: AppColors.success),
              const SizedBox(width: 8),
              _statChip('Unpaid', '${d.unpaidCount}',
                  color: d.unpaidCount > 0 ? AppColors.warning : null),
            ],
          ),
        ],
      ),
    );
  }

  Widget _statChip(String label, String value, {Color? color}) {
    final c = color ?? AppColors.textPrimary;
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: c.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            Text(value,
                style: AppFonts.body(
                    fontSize: 18, fontWeight: FontWeight.w800, color: c)),
            const SizedBox(height: 2),
            Text(label,
                style: AppFonts.body(
                    fontSize: 11, color: AppColors.textSecondary)),
          ],
        ),
      ),
    );
  }

  Widget _amountCard(ClubDuesPublic d) {
    final paid = d.isFullyPaid;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.primaryPrime,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            paid ? 'All dues paid' : 'Amount to pay',
            style: AppFonts.body(
                fontSize: 13,
                color: Colors.white.withValues(alpha: 0.9),
                fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Text(
            paid ? _inr(0) : _inr(d.amountOwed),
            style: AppFonts.body(
                fontSize: 32, fontWeight: FontWeight.w800, color: Colors.white),
          ),
          if (!paid) ...[
            const SizedBox(height: 4),
            Text(
              '${d.unpaidCount} unpaid × ${_inr(d.perMemberRate)} per member',
              style: AppFonts.body(
                  fontSize: 12, color: Colors.white.withValues(alpha: 0.9)),
            ),
          ],
          if (d.isPending && !paid) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                'An offline payment is awaiting approval',
                style: AppFonts.body(
                    fontSize: 11,
                    color: Colors.white,
                    fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _rejectedBanner(ClubDuesPublic d) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.error.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.error.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline_rounded,
              color: AppColors.error, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Last offline payment was rejected',
                    style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.error)),
                const SizedBox(height: 2),
                Text(d.lastRejectedReason!,
                    style: AppFonts.body(
                        fontSize: 12.5, color: AppColors.textSecondary)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _bankCard(ClubDuesPublic d) {
    Widget row(String k, String? v) => (v == null || v.isEmpty)
        ? const SizedBox.shrink()
        : Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 110,
                  child: Text(k,
                      style: AppFonts.body(
                          fontSize: 12.5, color: AppColors.textSecondary)),
                ),
                Expanded(
                  child: Text(v,
                      style: AppFonts.body(
                          fontSize: 12.5, fontWeight: FontWeight.w600)),
                ),
              ],
            ),
          );

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Bank details (for offline transfer)',
              style: AppFonts.body(
                  fontSize: 13, fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),
          row('Bank', d.offlineBankName),
          row('Account No.', d.offlineAccountNumber),
          row('IFSC', d.offlineIfscCode),
        ],
      ),
    );
  }

  Widget? _bottomBar() {
    if (_loading || _error != null || _dues == null) return null;
    final dues = _dues!;
    if (dues.isFullyPaid) {
      return SafeArea(
        minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.verified_rounded,
                color: AppColors.success, size: 20),
            const SizedBox(width: 8),
            Text('This club is fully paid',
                style: AppFonts.body(
                    fontWeight: FontWeight.w700, color: AppColors.success)),
          ],
        ),
      );
    }
    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_showOnline)
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton.icon(
                onPressed: _paying ? null : _payOnline,
                icon: _paying
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.lock_rounded, size: 18),
                label: Text(_paying ? 'Processing…' : 'Pay ${_inr(dues.amountOwed)} now'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primaryPrime,
                  foregroundColor: Colors.white,
                  textStyle: AppFonts.body(
                      fontSize: 15, fontWeight: FontWeight.w700),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ),
          if (_showOnline) const SizedBox(height: 8),
          Row(
            children: [
              if (_showOffline)
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _recordOffline,
                    icon: const Icon(Icons.receipt_rounded, size: 18),
                    label: const Text('Offline'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, 48),
                      foregroundColor: AppColors.primaryPrime,
                      side: const BorderSide(color: AppColors.primaryPrime),
                      textStyle: AppFonts.body(
                          fontSize: 14, fontWeight: FontWeight.w700),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ),
              if (_showOffline && _showOnline) const SizedBox(width: 8),
              if (_showOnline)
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _sharing ? null : _sharePayLink,
                    icon: _sharing
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.share_rounded, size: 18),
                    label: const Text('Share link'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, 48),
                      foregroundColor: AppColors.primaryPrime,
                      side: const BorderSide(color: AppColors.primaryPrime),
                      textStyle: AppFonts.body(
                          fontSize: 14, fontWeight: FontWeight.w700),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
