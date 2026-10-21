import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/services/website_billing_api.dart';
import '../../../../../core/services/website_provisioning_controller.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../data/models/website_billing_models.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import '../../../../../presentation/widgets/common/razorpay_checkout.dart';
import 'package:rotary_flutter_app/core/utils/money_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Club website self-service Buy / Renew (Razorpay). A club admin (role 2) of
/// the club buys a brand-new website (choosing a subdomain) or renews an
/// expiring one, paying via the native Razorpay checkout (see
/// [openRazorpayCheckout], the same helper the wallet top-up uses).
///
/// On a confirmed payment the server begins provisioning (Plesk vhost + SSL).
/// If the site is already `Active` we show its live URL; if still `Provisioning`
/// we poll `order-status` until it goes live (or fails). Pops `true` when the
/// user finishes so the caller (Website tab) can refresh its status snapshot.
class WebsitePurchaseScreen extends StatefulWidget {
  final int clubId;
  final String? clubName;
  // true = render as a tab body (no Scaffold/app bar), for the unified module
  // detail. Standalone (Payments > Website route) leaves it false.
  final bool embedded;

  const WebsitePurchaseScreen({
    super.key,
    required this.clubId,
    this.clubName,
    this.embedded = false,
  });

  @override
  State<WebsitePurchaseScreen> createState() => _WebsitePurchaseScreenState();
}

enum _Phase { form, done }

class _WebsitePurchaseScreenState extends State<WebsitePurchaseScreen> {
  static const int _reminderDays = 30;

  final _api = WebsiteBillingApi();
  final _subdomainCtrl = TextEditingController();

  Timer? _debounce;

  bool _loadingQuote = true;
  String? _quoteError;
  WebsiteQuote? _quote;

  bool _checkingSubdomain = false;
  SubdomainCheck? _subCheck;

  bool _paying = false;

  _Phase _phase = _Phase.form;

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _subdomainCtrl.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    // If a purchase is already provisioning (the user paid then reopened this
    // screen), hand it to the app-wide tracker (banner + notification) and show
    // the confirmation instead of the buy form.
    try {
      final latest = await _api.getLatestOrder(widget.clubId);
      if (!mounted) return;
      if (latest != null && latest.isProvisioning) {
        context.read<WebsiteProvisioningController>().track(
              orderId: latest.websiteOrderId,
              host: latest.subdomain,
              visitUrl: latest.visitUrl,
            );
        setState(() {
          _phase = _Phase.done;
          _loadingQuote = false;
        });
        return;
      }
    } catch (_) {
      // ignore — fall through to the normal quote flow
    }
    await _loadQuote();
  }

  Future<void> _loadQuote() async {
    setState(() {
      _loadingQuote = true;
      _quoteError = null;
    });
    try {
      final q = await _api.getQuote(widget.clubId);
      if (!mounted) return;
      setState(() {
        _quote = q;
        _loadingQuote = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _quoteError = e.message;
        _loadingQuote = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _quoteError = 'Could not load pricing. Please try again.';
        _loadingQuote = false;
      });
    }
  }

  String get _payeeName {
    final name = (widget.clubName ?? '').trim();
    return name.isEmpty ? 'Club Website' : name;
  }

  static String _inr(double v) => formatMoney(v, null);

  static String _fmtDate(DateTime? d) =>
      d == null ? '–' : DateFormat('d MMM yyyy').format(d);

  bool get _canPay {
    final q = _quote;
    if (q == null || _paying || _loadingQuote) return false;
    // The server owns the renewal window (paid + >15 days left → blocked), and
    // create-order enforces it, so never second-guess it client-side.
    if (!q.canPurchase) return false;
    if (q.isRenewal) return true;
    return _subCheck != null && _subCheck!.available && !_checkingSubdomain;
  }

  // ── Subdomain check (New purchase only) ────────────────────────────────────

  void _onSubdomainChanged(String v) {
    _debounce?.cancel();
    final input = v.trim();
    if (input.isEmpty) {
      setState(() {
        _subCheck = null;
        _checkingSubdomain = false;
      });
      return;
    }
    setState(() => _checkingSubdomain = true);
    _debounce = Timer(const Duration(milliseconds: 450), _checkSubdomain);
  }

  Future<void> _checkSubdomain() async {
    final input = _subdomainCtrl.text.trim();
    if (input.isEmpty) return;
    try {
      final r = await _api.checkSubdomain(input);
      if (!mounted) return;
      // Drop a stale response if the field changed while the check was in flight.
      if (_subdomainCtrl.text.trim() != input) return;
      setState(() {
        _subCheck = r;
        _checkingSubdomain = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (_subdomainCtrl.text.trim() != input) return;
      setState(() {
        _subCheck = SubdomainCheck(label: '', available: false, reason: e.message);
        _checkingSubdomain = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _subCheck = null;
        _checkingSubdomain = false;
      });
    }
  }

  // ── Pay ────────────────────────────────────────────────────────────────────

  Future<void> _pay() async {
    final q = _quote;
    if (q == null || !_canPay) return;
    FocusScope.of(context).unfocus();
    setState(() => _paying = true);
    try {
      final order = await _api.createOrder(
        clubId: widget.clubId,
        subdomainInput: q.isNew ? _subdomainCtrl.text.trim() : null,
        reminderDays: _reminderDays,
      );
      if (!mounted) return;

      final result = await openRazorpayCheckout(
        keyId: order.keyId,
        orderId: order.razorpayOrderId,
        amountPaise: order.amountPaise,
        name: _payeeName,
        description: 'Club website: ${order.orderType}',
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
        websiteOrderId: order.websiteOrderId,
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: result.paymentId!,
        razorpaySignature: result.signature!,
      );
      if (!mounted) return;

      if (!verify.isSuccess) {
        SnackbarUtils.showError(
          context,
          verify.message ??
              'Payment received but not yet confirmed. Please check back shortly.',
        );
        return;
      }

      // Payment confirmed. Hand provisioning off to the app-wide tracker so the
      // buyer is told when the site is live / needs attention even after they
      // leave this screen, then show a static confirmation here.
      context.read<WebsiteProvisioningController>().track(
            orderId: order.websiteOrderId,
            host: '${order.subdomain}.${q.parentDomain}',
            visitUrl: verify.visitUrl,
          );
      setState(() => _phase = _Phase.done);
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } catch (_) {
      if (mounted) {
        SnackbarUtils.showError(
            context, 'Something went wrong. Please try again.');
      }
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  void _finishDone() {
    if (mounted) Navigator.of(context).pop(true);
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    if (widget.embedded) {
      return SafeArea(child: _body());
    }
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Club Website'),
      body: SafeArea(child: _body()),
    );
  }

  Widget _body() {
    switch (_phase) {
      case _Phase.done:
        return _DoneView(onDone: _finishDone);
      case _Phase.form:
        return _formBody();
    }
  }

  Widget _formBody() {
    if (_loadingQuote) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_quoteError != null || _quote == null) {
      return _ErrorState(
        message: _quoteError ?? 'Could not load pricing.',
        onRetry: _loadQuote,
      );
    }
    final q = _quote!;
    // The server blocks buy/renew for a paid, active site with more than the
    // renewal window left. Mirror the web: replace the whole form with a
    // blocked screen rather than show a price under a dead Pay button.
    if (!q.canPurchase) {
      return _RenewalNotOpenState(
        reason: q.purchaseBlockedReason,
        subdomain: q.currentSubdomain,
        parentDomain: q.parentDomain,
        onRefresh: _loadQuote,
      );
    }
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _OrderSummaryCard(quote: q, fmtDate: _fmtDate),
              const SizedBox(height: 16),
              if (q.isNew) ...[
                Text('Choose your website address',
                    style: AppTextStyles.bodyMedium
                        .copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                _SubdomainField(
                  controller: _subdomainCtrl,
                  prefix: q.subdomainPrefix,
                  parentDomain: q.parentDomain,
                  onChanged: _onSubdomainChanged,
                ),
                const SizedBox(height: 8),
                _SubdomainStatus(
                  checking: _checkingSubdomain,
                  check: _subCheck,
                  parentDomain: q.parentDomain,
                  empty: _subdomainCtrl.text.trim().isEmpty,
                ),
              ] else ...[
                Text('Your website address',
                    style: AppTextStyles.bodyMedium
                        .copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                _CurrentSubdomainCard(
                  subdomain: q.currentSubdomain,
                  parentDomain: q.parentDomain,
                ),
              ],
              const SizedBox(height: 16),
              _PriceCard(quote: q, inr: _inr),
              const SizedBox(height: 8),
              Text(
                'You’ll complete the payment on a secure Razorpay checkout. '
                'Setup runs in the background afterwards: we’ll email you when '
                'your website is live.',
                style: AppTextStyles.caption.copyWith(color: AppColors.textMuted),
              ),
            ],
          ),
        ),
        _PayBar(
          enabled: _canPay,
          paying: _paying,
          label: q.totalAmount > 0 ? 'Pay ${_inr(q.totalAmount)}' : 'Pay',
          onPay: _pay,
        ),
      ],
    );
  }
}

// ── Order summary (New vs Renewal) ─────────────────────────────────────────────

class _OrderSummaryCard extends StatelessWidget {
  final WebsiteQuote quote;
  final String Function(DateTime?) fmtDate;
  const _OrderSummaryCard({required this.quote, required this.fmtDate});

  @override
  Widget build(BuildContext context) {
    final renewal = quote.isRenewal;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.primaryLight,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: const Icon(Icons.language_rounded,
                    color: AppColors.primary, size: 21),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      renewal ? 'Renew your website' : 'New club website',
                      style: AppTextStyles.bodyMedium
                          .copyWith(fontWeight: FontWeight.w800),
                    ),
                    Text(
                      '${quote.validityMonths} months validity',
                      style: AppTextStyles.caption
                          .copyWith(color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
              _TypeBadge(renewal: renewal),
            ],
          ),
          const Divider(height: 20),
          if (renewal && quote.currentEndDate != null) ...[
            _factRow('Current expiry', fmtDate(quote.currentEndDate)),
            const SizedBox(height: 6),
          ],
          _factRow(
            renewal ? 'New expiry' : 'Valid until',
            fmtDate(quote.newEndDate),
            bold: true,
          ),
        ],
      ),
    );
  }

  Widget _factRow(String label, String value, {bool bold = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label,
            style: AppTextStyles.caption
                .copyWith(color: AppColors.textSecondary)),
        Text(
          value,
          style: AppTextStyles.bodyMedium.copyWith(
            fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
            color: bold ? AppColors.textPrimary : AppColors.textSecondary,
          ),
        ),
      ],
    );
  }
}

class _TypeBadge extends StatelessWidget {
  final bool renewal;
  const _TypeBadge({required this.renewal});

  @override
  Widget build(BuildContext context) {
    final color = renewal ? AppColors.rotaryBlue : AppColors.success;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Text(
        renewal ? 'RENEWAL' : 'NEW',
        style: AppFonts.body(
          fontSize: 10.5,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.4,
          color: color,
        ),
      ),
    );
  }
}

// ── Subdomain field + status (New) ─────────────────────────────────────────────

class _SubdomainField extends StatelessWidget {
  final TextEditingController controller;
  final String prefix;
  final String parentDomain;
  final ValueChanged<String> onChanged;
  const _SubdomainField({
    required this.controller,
    required this.prefix,
    required this.parentDomain,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      autocorrect: false,
      enableSuggestions: false,
      textInputAction: TextInputAction.done,
      inputFormatters: [
        FilteringTextInputFormatter.allow(RegExp(r'[a-zA-Z0-9-]')),
      ],
      onChanged: onChanged,
      style: AppFonts.body(fontSize: 14, color: AppColors.textPrimary),
      decoration: InputDecoration(
        prefixText: prefix,
        prefixStyle: AppFonts.body(
            fontSize: 14,
            color: AppColors.textSecondary,
            fontWeight: FontWeight.w700),
        suffixText: parentDomain.isEmpty ? null : '.$parentDomain',
        suffixStyle: AppFonts.body(
            fontSize: 13, color: AppColors.textSecondary),
        hintText: 'yourclub',
        hintStyle: AppFonts.body(
            fontSize: 14, color: AppColors.textMuted),
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
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.primary, width: 1.4),
        ),
      ),
    );
  }
}

class _SubdomainStatus extends StatelessWidget {
  final bool checking;
  final SubdomainCheck? check;
  final String parentDomain;
  final bool empty;
  const _SubdomainStatus({
    required this.checking,
    required this.check,
    required this.parentDomain,
    required this.empty,
  });

  @override
  Widget build(BuildContext context) {
    if (checking) {
      return Row(
        children: [
          const SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 8),
          Text('Checking availability…',
              style:
                  AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
        ],
      );
    }
    final c = check;
    if (c == null || empty) {
      return Text(
        'Letters and numbers only. Example: yourclub → '
        '${parentDomain.isEmpty ? "yourclub" : "yourclub.$parentDomain"}',
        style: AppTextStyles.caption.copyWith(color: AppColors.textMuted),
      );
    }
    if (c.available) {
      final url = c.label.isEmpty
          ? ''
          : (parentDomain.isEmpty ? c.label : '${c.label}.$parentDomain');
      return Row(
        children: [
          const Icon(Icons.check_circle_rounded,
              size: 16, color: AppColors.success),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              url.isEmpty ? 'Available' : '$url is available',
              style: AppTextStyles.caption.copyWith(
                  color: AppColors.success, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.cancel_rounded, size: 16, color: AppColors.error),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            (c.reason ?? '').isNotEmpty
                ? c.reason!
                : 'This address is not available.',
            style: AppTextStyles.caption.copyWith(
                color: AppColors.error, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }
}

/// Replaces the whole buy/renew form when the server reports the club's site is
/// paid + active with more than the renewal window left (`canPurchase == false`).
/// The wording — including the real day count and when renewal opens — is the
/// server's `purchaseBlockedReason`, rendered verbatim so the app never drifts
/// from the rule create-order actually enforces.
class _RenewalNotOpenState extends StatelessWidget {
  final String? reason;
  final String? subdomain;
  final String parentDomain;
  final Future<void> Function() onRefresh;
  const _RenewalNotOpenState({
    required this.reason,
    required this.subdomain,
    required this.parentDomain,
    required this.onRefresh,
  });

  /// Full public URL of the live site, or null when we don't have a subdomain.
  String? get _url {
    final sub = (subdomain ?? '').trim();
    if (sub.isEmpty) return null;
    final host = parentDomain.trim().isEmpty ? sub : '$sub.$parentDomain';
    return 'https://$host';
  }

  @override
  Widget build(BuildContext context) {
    final url = _url;
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 24),
          Container(
            width: 76,
            height: 76,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.success.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.check_circle_rounded,
                color: AppColors.success, size: 40),
          ),
          const SizedBox(height: 20),
          Text(
            'Your club website is active',
            textAlign: TextAlign.center,
            style: AppTextStyles.h3.copyWith(color: AppColors.primary),
          ),
          const SizedBox(height: 10),
          Text(
            reason ?? 'Renewal opens closer to expiry.',
            textAlign: TextAlign.center,
            style:
                AppTextStyles.bodyMedium.copyWith(color: AppColors.textSecondary),
          ),
          // The live public link — so the admin can copy/share or open the site
          // right from this "active" screen (there is nothing to buy here).
          if (url != null) ...[
            const SizedBox(height: 24),
            _ActiveSiteLinkCard(url: url),
          ],
        ],
      ),
    );
  }
}

/// Live public URL with Copy + Visit actions, shown on the "website active"
/// screen. Mirrors the share bar on the My Club Website tab.
class _ActiveSiteLinkCard extends StatefulWidget {
  final String url;
  const _ActiveSiteLinkCard({required this.url});

  @override
  State<_ActiveSiteLinkCard> createState() => _ActiveSiteLinkCardState();
}

class _ActiveSiteLinkCardState extends State<_ActiveSiteLinkCard> {
  bool _copied = false;

  /// Display form (no scheme) — cleaner to read than "https://…".
  String get _display => widget.url.replaceFirst(RegExp(r'^https?://'), '');

  void _copy() {
    Clipboard.setData(ClipboardData(text: widget.url));
    setState(() => _copied = true);
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _copied = false);
    });
  }

  Future<void> _visit() async {
    final uri = Uri.tryParse(widget.url);
    if (uri == null || !uri.hasScheme) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'YOUR WEBSITE',
            style: AppFonts.body(
              fontSize: 10,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.6,
              color: AppColors.textMuted,
            ),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              const Icon(Icons.public_rounded,
                  size: 16, color: AppColors.success),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _display,
                  style: AppFonts.body(
                      fontSize: 13, color: AppColors.textPrimary),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _copy,
                  icon: Icon(
                    _copied ? Icons.check_rounded : Icons.copy_rounded,
                    size: 16,
                  ),
                  label: Text(_copied ? 'Copied!' : 'Copy'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor:
                        _copied ? AppColors.success : AppColors.textSecondary,
                    side: BorderSide(
                        color: _copied ? AppColors.success : AppColors.border),
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(9)),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _visit,
                  icon: const Icon(Icons.open_in_new_rounded, size: 16),
                  label: const Text('Visit'),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(9)),
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

class _CurrentSubdomainCard extends StatelessWidget {
  final String? subdomain;
  final String parentDomain;
  const _CurrentSubdomainCard({
    required this.subdomain,
    required this.parentDomain,
  });

  @override
  Widget build(BuildContext context) {
    final sub = (subdomain ?? '').trim();
    final url = sub.isEmpty
        ? '–'
        : (parentDomain.isEmpty ? sub : '$sub.$parentDomain');
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.slate50,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Row(
        children: [
          const Icon(Icons.public_rounded, size: 16, color: AppColors.slate500),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              url,
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.textPrimary),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppColors.slate200,
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text('KEPT',
                style: AppFonts.body(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.4,
                    color: AppColors.slate500)),
          ),
        ],
      ),
    );
  }
}

// ── Price breakdown ────────────────────────────────────────────────────────────

class _PriceCard extends StatelessWidget {
  final WebsiteQuote quote;
  final String Function(double) inr;
  const _PriceCard({required this.quote, required this.inr});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          _row('Base amount', inr(quote.baseAmount)),
          const SizedBox(height: 6),
          _row('GST (${quote.gstPercent}%)', inr(quote.gstAmount)),
          const Divider(height: 18),
          _row('Total payable', inr(quote.totalAmount), bold: true),
        ],
      ),
    );
  }

  Widget _row(String label, String value, {bool bold = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label,
            style: AppTextStyles.caption.copyWith(
                color: AppColors.textSecondary,
                fontWeight: bold ? FontWeight.w700 : FontWeight.w500)),
        Text(value,
            style: AppTextStyles.bodyMedium.copyWith(
                fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
                color:
                    bold ? AppColors.textPrimary : AppColors.textSecondary)),
      ],
    );
  }
}

// ── Pay bar ──────────────────────────────────────────────────────────────────

class _PayBar extends StatelessWidget {
  final bool enabled;
  final bool paying;
  final String label;
  final VoidCallback onPay;
  const _PayBar({
    required this.enabled,
    required this.paying,
    required this.label,
    required this.onPay,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
      decoration: const BoxDecoration(
        color: AppColors.white,
        border: const Border(top: const BorderSide(color: AppColors.border)),
      ),
      child: SizedBox(
        width: double.infinity,
        child: FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.primary,
            disabledBackgroundColor: AppColors.slate200,
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
          onPressed: enabled ? onPay : null,
          child: paying
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white),
                )
              : Text(label, style: AppTextStyles.button),
        ),
      ),
    );
  }
}

// ── Post-payment confirmation ───────────────────────────────────────────────────
//
// After payment we hand provisioning to the app-wide `WebsiteProvisioning
// Controller` (banner + local notification + email backstop), so this screen
// only needs a static confirmation — no polling, no "live/failed" screens (the
// banner owns those, and follows the user if they leave).

class _DoneView extends StatelessWidget {
  final VoidCallback onDone;
  const _DoneView({required this.onDone});

  @override
  Widget build(BuildContext context) {
    return Padding(
      // Extra bottom room so the app-wide provisioning banner (which floats at
      // the screen bottom) doesn't overlap the Done button.
      padding: const EdgeInsets.fromLTRB(24, 32, 24, 112),
      child: Column(
        children: [
          const Spacer(),
          Container(
            width: 68,
            height: 68,
            decoration: BoxDecoration(
              color: AppColors.success.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.check_circle_rounded,
                color: AppColors.success, size: 38),
          ),
          const SizedBox(height: 18),
          Text('Payment successful',
              textAlign: TextAlign.center,
              style: AppTextStyles.h4.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Text(
            'Your club website is being set up in the background: this can take '
            'a few minutes. You can safely leave this page: we’ll show a '
            'notification the moment it’s live and email you too.',
            textAlign: TextAlign.center,
            style: AppTextStyles.body.copyWith(color: AppColors.textSecondary),
          ),
          const Spacer(),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              onPressed: onDone,
              child: Text('Done', style: AppTextStyles.button),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Quote load error ───────────────────────────────────────────────────────────

class _ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorState({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline_rounded,
                size: 40, color: AppColors.error),
            const SizedBox(height: 12),
            Text(message,
                textAlign: TextAlign.center,
                style:
                    AppTextStyles.body.copyWith(color: AppColors.textSecondary)),
            const SizedBox(height: 16),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
              onPressed: onRetry,
              child: Text('Retry', style: AppTextStyles.button),
            ),
          ],
        ),
      ),
    );
  }
}
