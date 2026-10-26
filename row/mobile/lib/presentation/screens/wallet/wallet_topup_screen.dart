import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/wallet_api.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../../data/models/wallet_models.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/razorpay_checkout.dart';
import 'package:rotary_flutter_app/core/utils/money_format.dart';
import 'package:rotary_flutter_app/core/utils/currency_symbol.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// Jakarta Sans direct (matches the dashboard tabs — headings elsewhere route
// through a configurable heading font, which looked out of place here).
TextStyle _jk(double size, FontWeight weight, [Color? color]) =>
    AppFonts.body(
        fontSize: size, fontWeight: weight, color: color);

/// The "Wallet & Credits" surface — current email balance plus an
/// add-balance form (buy credits via Razorpay in an in-app WebView, see
/// [openRazorpayCheckout]). Used as an embedded tab on the club/district
/// dashboards ([embedded] = true) and as a pushed screen otherwise.
class WalletTopupScreen extends StatefulWidget {
  final String scope; // 'club' | 'district'
  final int clubId;
  final int districtId;
  final String? clubName; // shown on the Razorpay sheet
  final String? initialCreditType; // WalletCreditType.email (the only type)
  final bool embedded; // true = render as a tab body (no Scaffold/app bar)
  // Single-credit mode: titles read "Email Credits" instead of "Wallet". Used by
  // the "Email" dashboard tile; the plain "Wallet" tile leaves this false.
  final bool lockType;

  const WalletTopupScreen({
    super.key,
    required this.scope,
    this.clubId = 0,
    this.districtId = 0,
    this.clubName,
    this.initialCreditType,
    this.embedded = false,
    this.lockType = false,
  });

  @override
  State<WalletTopupScreen> createState() => _WalletTopupScreenState();
}

class _WalletTopupScreenState extends State<WalletTopupScreen> {
  final _api = WalletApi();
  final _amountCtrl = TextEditingController();

  // Email is the only credit the wallet sells.
  final String _creditType = WalletCreditType.email;

  Timer? _debounce;
  bool _quoting = false;
  bool _paying = false;
  bool _loadingBalance = true;
  WalletQuote? _quote;
  WalletBalance? _balance;
  final Map<String, double> _perUnit = {}; // price per credit, by credit type

  @override
  void initState() {
    super.initState();
    _amountCtrl.text = _defaultFor(_creditType).toStringAsFixed(0);
    _loadBalance();
    _fetchQuote();
  }

  // Product minimums (business rule; the server's technical floor is lower, so
  // we do not use the quote's minAmount for this).
  double _minFor(String type) => type == WalletCreditType.email ? 500 : 1000;

  // Amount the field is pre-filled with (the "default selected" quick chip).
  double _defaultFor(String type) =>
      type == WalletCreditType.email ? 1000 : 5000;

  // Quick-select amount chips shown above the field, per credit type.
  List<int> _quickAmountsFor(String type) => type == WalletCreditType.email
      ? const [500, 1000, 5000, 10000]
      : const [1000, 5000, 10000];

  @override
  void dispose() {
    _debounce?.cancel();
    _amountCtrl.dispose();
    super.dispose();
  }

  double get _amount => double.tryParse(_amountCtrl.text.trim()) ?? 0;

  bool get _canPay =>
      !_paying &&
      !_quoting &&
      _amount >= _minFor(_creditType) &&
      _quote != null &&
      !_quote!.hasError &&
      _quote!.creditCount > 0;

  static String _inr(double v) => formatMoney(v, null);

  Future<void> _loadBalance() async {
    setState(() => _loadingBalance = true);
    try {
      final b = await _api.getBalance(
        scope: widget.scope,
        clubId: widget.clubId,
        districtId: widget.districtId,
      );
      if (!mounted) return;
      setState(() => _balance = b);
    } catch (_) {
      // balance is best-effort; leave nulls
    } finally {
      if (mounted) setState(() => _loadingBalance = false);
    }
  }

  void _onAmountChanged() {
    _debounce?.cancel();
    // Rebuild so the quick-select chip highlight tracks the typed amount.
    setState(() {
      if (_amount <= 0) _quote = null;
    });
    if (_amount <= 0) return;
    _debounce = Timer(const Duration(milliseconds: 450), _fetchQuote);
  }

  void _selectQuickAmount(int v) {
    _debounce?.cancel();
    _amountCtrl.text = v.toString();
    _amountCtrl.selection =
        TextSelection.collapsed(offset: _amountCtrl.text.length);
    _fetchQuote(); // fetch immediately (skip the typing debounce)
  }

  Future<void> _fetchQuote() async {
    if (_amount <= 0) return;
    setState(() => _quoting = true);
    try {
      final q = await _api.getQuote(creditType: _creditType, amount: _amount);
      if (!mounted) return;
      setState(() {
        _quote = q;
        if (q.creditCount > 0) {
          _perUnit[_creditType] = q.baseAmount / q.creditCount;
        }
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _quote = WalletQuote(
            creditType: _creditType,
            creditCount: 0,
            baseAmount: _amount,
            gstAmount: 0,
            totalAmount: 0,
            minAmount: 0,
            error: e.message,
          ));
    } catch (_) {
      if (!mounted) return;
      setState(() => _quote = null);
    } finally {
      if (mounted) setState(() => _quoting = false);
    }
  }

  Future<void> _pay() async {
    if (!_canPay) return;
    FocusScope.of(context).unfocus();
    setState(() => _paying = true);
    try {
      final order = await _api.createOrder(
        scope: widget.scope,
        clubId: widget.clubId,
        districtId: widget.districtId,
        creditType: _creditType,
        amount: _amount,
      );
      if (!mounted) return;

      final result = await openRazorpayCheckout(
        keyId: order.keyId,
        orderId: order.razorpayOrderId,
        amountPaise: order.amountPaise,
        name: (widget.clubName ?? '').trim().isNotEmpty
            ? widget.clubName!.trim()
            : 'Rotary Credits',
        description: '${order.creditCount} $_creditType credits',
      );
      if (!mounted) return;

      if (result == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Payment cancelled.')),
        );
        return;
      }
      if (!result.success) {
        SnackbarUtils.showError(context, result.error ?? 'Payment failed.');
        return;
      }

      final verify = await _api.verify(
        topupOrderId: order.topupOrderId,
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: result.paymentId!,
        razorpaySignature: result.signature!,
      );
      if (!mounted) return;

      if (verify.isSuccess) {
        await _showSuccessDialog(verify);
        if (!mounted) return;
        await _loadBalance();
        if (!widget.embedded && mounted) Navigator.of(context).pop(true);
      } else {
        SnackbarUtils.showError(
          context,
          verify.message ??
              'Payment received but not yet confirmed. Credits will be added shortly.',
        );
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

  Future<void> _showSuccessDialog(WalletTopupResult r) {
    final newBalance = r.emailRemaining;
    return showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            const Icon(Icons.check_circle_rounded,
                color: AppColors.success, size: 22),
            const SizedBox(width: 8),
            Text('Credits Added', style: _jk(15, FontWeight.w800)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${r.creditCount} $_creditType credits were added.',
                style: _jk(12.5, FontWeight.w500, AppColors.textPrimary)),
            if (newBalance != null) ...[
              const SizedBox(height: 6),
              Text('New $_creditType balance: $newBalance',
                  style: _jk(11, FontWeight.w600, AppColors.textSecondary)),
            ],
          ],
        ),
        actions: [
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text('Done', style: _jk(12.5, FontWeight.w700, Colors.white)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canTopUp = widget.scope == 'district'
        ? auth.isDistrictAdminOf(widget.districtId)
        : auth.isClubAdminOf(widget.clubId);
    final scopeWord = widget.scope == 'district' ? 'district' : 'club';

    final content = ListView(
      padding: const EdgeInsets.fromLTRB(12, 14, 12, 28),
      children: [
        _WideBalanceCard(
          creditType: _creditType,
          value: _balance?.emailRemaining,
          loading: _loadingBalance,
          color: AppColors.accentBlue,
          icon: Icons.mail_rounded,
        ),
        const SizedBox(height: 12),
        if (canTopUp)
          _buildAddBalance()
        else
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              children: [
                const Icon(Icons.info_outline_rounded,
                    size: 16, color: AppColors.textMuted),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Only $scopeWord admins can add credits.',
                    style: _jk(11, FontWeight.w500, AppColors.textSecondary),
                  ),
                ),
              ],
            ),
          ),
      ],
    );

    if (widget.embedded) {
      return Container(color: AppColors.lightBg, child: content);
    }
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: CustomAppBar(
          title: widget.lockType ? '$_creditType Credits' : 'Wallet'),
      body: content,
    );
  }

  Widget _buildAddBalance() {
    final q = _quote;
    final minVal = _minFor(_creditType);
    final belowMin = _amount > 0 && _amount < minVal;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.lockType ? 'Add $_creditType balance' : 'Add balance',
              style: _jk(13.5, FontWeight.w800, AppColors.textPrimary)),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text('Amount (${currencySymbolFor(null)})',
                  style: _jk(12, FontWeight.w700, AppColors.textPrimary)),
              const SizedBox(width: 6),
              Text('Minimum ${_inr(minVal)}',
                  style: _jk(10.5, FontWeight.w500, AppColors.textMuted)),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _amountCtrl,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
            ],
            onChanged: (_) => _onAmountChanged(),
            style: _jk(14, FontWeight.w700, AppColors.textPrimary),
            decoration: InputDecoration(
              prefixText: '${currencySymbolFor(null)} ',
              prefixStyle: _jk(14, FontWeight.w700, AppColors.textSecondary),
              hintText: 'Enter base amount',
              hintStyle: _jk(13, FontWeight.w400, AppColors.textMuted),
              isDense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              filled: true,
              fillColor: AppColors.surface,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: AppColors.border),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: AppColors.border),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              for (final (i, v) in _quickAmountsFor(_creditType).indexed) ...[
                if (i > 0) const SizedBox(width: 8),
                Expanded(
                  child: _AmountChip(
                    label: _inr(v.toDouble()),
                    selected: _amount == v.toDouble(),
                    onTap: () => _selectQuickAmount(v),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 12),
          _QuoteCard(
            quoting: _quoting,
            quote: belowMin
                ? WalletQuote(
                    creditType: _creditType,
                    creditCount: 0,
                    baseAmount: _amount,
                    gstAmount: 0,
                    totalAmount: 0,
                    minAmount: minVal,
                    error: 'Minimum ${_inr(minVal)} for $_creditType credits.',
                  )
                : _quote,
            creditType: _creditType,
            inr: _inr,
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                disabledBackgroundColor: AppColors.slate200,
                padding: const EdgeInsets.symmetric(vertical: 13),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              onPressed: _canPay ? _pay : null,
              child: _paying
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : Text(
                      (!belowMin && q != null && !q.hasError && q.totalAmount > 0)
                          ? 'Pay ${_inr(q.totalAmount)} with Razorpay'
                          : 'Pay with Razorpay',
                      style: _jk(13.5, FontWeight.w800, Colors.white),
                    ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Credits are valid for 1 year from purchase. GST is charged on top of the credit amount.',
            style: _jk(10, FontWeight.w500, AppColors.textMuted),
          ),
        ],
      ),
    );
  }
}

/// Full-width email balance card: a
/// channel icon + label on the left and the big balance on the right, so the
/// whole row is used instead of leaving the right half empty.
class _WideBalanceCard extends StatelessWidget {
  final String creditType; // 'Email'
  final int? value;
  final bool loading;
  final Color color;
  final IconData icon;
  const _WideBalanceCard({
    required this.creditType,
    required this.value,
    required this.loading,
    required this.color,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: color, size: 24),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('$creditType balance',
                    style: _jk(12.5, FontWeight.w700, AppColors.textPrimary)),
                const SizedBox(height: 2),
                Text('credits remaining',
                    style: _jk(10.5, FontWeight.w500, AppColors.textMuted)),
              ],
            ),
          ),
          const SizedBox(width: 12),
          if (loading && value == null)
            SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2, color: color),
            )
          else
            Text(value != null ? '$value' : '–',
                style: _jk(30, FontWeight.w800, color)),
        ],
      ),
    );
  }
}

/// A quick-select amount pill above the amount field. Filled when its value
/// matches the current amount.
class _AmountChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _AmountChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.primary : AppColors.surface,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
                color: selected ? AppColors.primary : AppColors.border),
          ),
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: _jk(12, FontWeight.w700,
                selected ? AppColors.white : AppColors.textPrimary),
          ),
        ),
      ),
    );
  }
}

class _QuoteCard extends StatelessWidget {
  final bool quoting;
  final WalletQuote? quote;
  final String creditType;
  final String Function(double) inr;
  const _QuoteCard({
    required this.quoting,
    required this.quote,
    required this.creditType,
    required this.inr,
  });

  @override
  Widget build(BuildContext context) {
    if (quoting && quote == null) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Center(
          child: SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }
    final q = quote;
    if (q == null) {
      return Text(
        'Enter an amount to see how many credits you get.',
        style: _jk(11, FontWeight.w500, AppColors.textMuted),
      );
    }
    if (q.hasError) {
      return Container(
        padding: const EdgeInsets.all(11),
        decoration: BoxDecoration(
          color: AppColors.error.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppColors.error.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            const Icon(Icons.info_outline_rounded,
                size: 16, color: AppColors.error),
            const SizedBox(width: 8),
            Expanded(
              child: Text(q.error!,
                  style: _jk(10.5, FontWeight.w500, AppColors.error)),
            ),
          ],
        ),
      );
    }
    final pct =
        q.baseAmount > 0 ? (q.gstAmount / q.baseAmount * 100).round() : 18;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          _row("Credits you'll receive", '${q.creditCount} $creditType',
              emphasise: true),
          const SizedBox(height: 6),
          _row('Amount', inr(q.baseAmount)),
          const SizedBox(height: 4),
          _row('GST ($pct%)', inr(q.gstAmount)),
          const Divider(height: 16),
          _row('Total payable', inr(q.totalAmount), bold: true),
        ],
      ),
    );
  }

  Widget _row(String label, String value,
      {bool bold = false, bool emphasise = false}) {
    final strong = bold || emphasise;
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label,
            style: _jk(11, bold ? FontWeight.w700 : FontWeight.w500,
                AppColors.textSecondary)),
        Text(value,
            style: _jk(strong ? 12.5 : 11.5, strong ? FontWeight.w800 : FontWeight.w600,
                strong ? AppColors.textPrimary : AppColors.textSecondary)),
      ],
    );
  }
}
