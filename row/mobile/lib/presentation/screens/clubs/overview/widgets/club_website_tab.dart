import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../../core/services/club_admin_dashboard_api.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../data/models/club_admin_dashboard_models.dart';
import '../../../districts/overview/widgets/stat_card.dart';
import '../../../../widgets/common/coming_soon_card.dart';
import '../../../../widgets/common/dashboard_refresh.dart';
import '../../../../widgets/common/website_renewal_dialog.dart';
import '../../modules/website_purchase/website_purchase_screen.dart';
import '../../modules/website_training/website_training_screen.dart';
import '../../modules/website_data/website_data_modules.dart';
import 'club_dashboard_async.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Pushes the self-service Buy / Renew (Razorpay) screen and, on a confirmed
/// purchase (`pop(true)`), invokes [onPurchased] so the tab refreshes its
/// website status snapshot.
Future<void> _openWebsitePurchase(
  BuildContext context, {
  required int clubId,
  String? clubName,
  required VoidCallback onPurchased,
}) async {
  final result = await Navigator.of(context).push<bool>(
    MaterialPageRoute<bool>(
      builder: (_) => WebsitePurchaseScreen(
        clubId: clubId,
        clubName: (clubName ?? '').trim().isEmpty ? null : clubName,
      ),
    ),
  );
  if (result == true) onPurchased();
}

/// "My Club Website" tab on the Club Overview screen — wired to the live
/// `api/mobile/club-admin-dashboard/website` endpoint (a compact status/config
/// snapshot of this club's integrated website).
///
/// The React reference's mock-only sections are dropped: ad slots, the 8
/// website-management module tiles + their editors (banner/social/logo/theme/
/// contact/about), the "Start Free Trial / Demo" marketing hero + feature list,
/// and the expired-period analytics block (visit charts, top pages). None of
/// those have an API source. What remains is fully real — status KPIs, the live
/// public URL with share actions, and an expired-subscription alert.
class ClubWebsiteTab extends StatefulWidget {
  final int clubId;
  final int? yearId;
  const ClubWebsiteTab({super.key, required this.clubId, this.yearId});

  @override
  State<ClubWebsiteTab> createState() => _ClubWebsiteTabState();
}

class _ClubWebsiteTabState extends State<ClubWebsiteTab>
    with AutomaticKeepAliveClientMixin<ClubWebsiteTab> {
  final ClubAdminDashboardApi _api = ClubAdminDashboardApi();
  late Future<ClubAdminWebsite> _future;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _api.getWebsite(widget.clubId, yearId: widget.yearId);
  }

  void _reload() =>
      setState(() => _future = _api.getWebsite(widget.clubId, yearId: widget.yearId));

  /// Pull-to-refresh: fetch first, then swap so content doesn't flash a loader.
  Future<void> _refresh() async {
    final f = _api.getWebsite(widget.clubId, yearId: widget.yearId);
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  /// The live website tab is now enabled (web ships it live). Set back to
  /// true only to temporarily re-stub the tab behind a Coming-Soon card.
  bool get _comingSoon => false;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_comingSoon) {
      return const SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(12, 24, 12, 32),
        child: ComingSoonCard(
          title: 'My Club Website',
          description:
              'Your club website status, public link and management tools '
              'will appear here soon.',
        ),
      );
    }
    return _buildLive(context);
  }

  Widget _buildLive(BuildContext context) {
    return FutureBuilder<ClubAdminWebsite>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const ClubDashboardLoading();
        }
        if (snap.hasError) {
          return ClubDashboardError(error: snap.error!, onRetry: _reload);
        }
        final web = snap.data!;
        return DashboardRefresh(
          onRefresh: _refresh,
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Header(
                clubName: web.clubName,
                yearLabel: web.yearLabel,
                statusText: web.yesNoStatus,
                statusColor: _websiteStatusColor(web),
              ),
              const SizedBox(height: 12),
              if (!web.configured)
                WebsiteNotConfiguredCard(
                  clubId: widget.clubId,
                  clubName: web.clubName,
                  onPurchased: _reload,
                )
              else
                _ConfiguredView(
                  web: web,
                  clubId: widget.clubId,
                  onPurchased: _reload,
                ),
              const SizedBox(height: 14),
              // Management tiles are locked until the club has actually set up
              // its website — there is nothing to manage before then.
              _WebsiteManagementGrid(
                  clubId: widget.clubId, enabled: web.configured),
            ],
          ),
        );
      },
    );
  }
}

// ── Website Management grid (reuses the existing website_data module screens
//    via go_router routes) ─────────────────────────────────────────────────────

class _WebsiteManagementGrid extends StatelessWidget {
  final int clubId;

  /// When false the tiles are shown greyed-out and non-tappable — the club has
  /// not set up its website yet, so there is no content to manage.
  final bool enabled;
  const _WebsiteManagementGrid({required this.clubId, required this.enabled});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('Website Management',
                    style: AppFonts.body(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary)),
              ),
              if (!enabled)
                const Icon(Icons.lock_outline_rounded,
                    size: 15, color: AppColors.slate500),
            ],
          ),
          Text(
              enabled
                  ? 'Edit your public club website content'
                  : 'Set up your website to manage its content',
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.slate500)),
          const SizedBox(height: 12),
          // Fixed tile HEIGHT (mainAxisExtent) instead of childAspectRatio: a
          // ratio makes height shrink with screen width, so on narrow phones
          // two-line labels ("Advertisement Area", "Social Media Links") were
          // clipped. A constant 112px height fits the 40px icon + 8px gap + two
          // label lines with headroom for larger system font scales.
          GridView(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: 10,
              mainAxisSpacing: 10,
              mainAxisExtent: 124,
            ),
            children: [
              for (final m in kClubWebsiteDataModules)
                _ManageTile(
                  label: m.label,
                  icon: m.icon,
                  color: m.color,
                  enabled: enabled,
                  onTap: () => context.push(m.pathFor(clubId)),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ManageTile extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color color;
  final bool enabled;
  final VoidCallback onTap;
  const _ManageTile({
    required this.label,
    required this.icon,
    required this.color,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final Color iconColor = enabled ? color : AppColors.slate400;
    final Color labelColor =
        enabled ? AppColors.textPrimary : AppColors.slate400;
    return Material(
      color: AppColors.slate50,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.slate200),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: iconColor.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: iconColor, size: 20),
              ),
              const SizedBox(height: 8),
              Flexible(
                child: Text(label,
                    textAlign: TextAlign.center,
                    style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: labelColor),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Header ───────────────────────────────────────────────────────────────────

/// Accent for the 3-state website status (Yes / Expired / No).
Color _websiteStatusColor(ClubAdminWebsite w) {
  if (w.isExpired) return AppColors.statusNone;
  if (!w.configured) return AppColors.slate500;
  if (w.isLive) return AppColors.statusDone;
  return AppColors.rotaryBlue;
}

class _Header extends StatelessWidget {
  final String clubName;
  final String yearLabel;
  final String? statusText;
  final Color? statusColor;
  const _Header({
    required this.clubName,
    required this.yearLabel,
    this.statusText,
    this.statusColor,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Club Website',
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.slate700,
                ),
              ),
              Text(
                [
                  if (clubName.isNotEmpty) clubName,
                  if (yearLabel.isNotEmpty) 'RY $yearLabel',
                ].join(' · '),
                style: AppFonts.body(
                  fontSize: 13,
                  color: AppColors.slate400,
                ),
              ),
            ],
          ),
        ),
        if (statusText != null)
          _StatusChip(
            text: statusText!,
            color: statusColor ?? AppColors.slate500,
          ),
      ],
    );
  }
}

/// Small pill showing the website's Yes / Expired / No status in the header.
class _StatusChip extends StatelessWidget {
  final String text;
  final Color color;
  const _StatusChip({required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Text(
        text,
        style: AppFonts.body(
          fontSize: 13,
          fontWeight: FontWeight.w800,
          color: color,
        ),
      ),
    );
  }
}

// ── Not configured (empty state) ─────────────────────────────────────────────

/// "Website not set up yet" empty state.
///
/// [showSetup] = true (club admin): shows the "Set up website" purchase CTA plus
/// a Contact-support link. [showSetup] = false (plain member who can't set up a
/// site): shows ONLY the message + Contact support — no set-up button and no
/// purchase copy. Reused by the member-facing "My Club Website" page so it gets
/// the same card without any admin-only actions.
class WebsiteNotConfiguredCard extends StatelessWidget {
  final int clubId;
  final String clubName;
  final bool showSetup;
  final VoidCallback? onPurchased;
  const WebsiteNotConfiguredCard({
    super.key,
    required this.clubId,
    required this.clubName,
    this.showSetup = true,
    this.onPurchased,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(16, 22, 16, 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 46,
            height: 46,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.slate100,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.public_off_rounded,
                size: 22, color: AppColors.slate400),
          ),
          const SizedBox(height: 12),
          Text(
            'Website not set up yet',
            textAlign: TextAlign.center,
            style: AppFonts.body(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            showSetup
                ? 'Get your own club website${Brand.current.clubSiteParent.isEmpty ? '' : ' with a ${Brand.current.clubSiteParent} address'}. '
                    'Set it up in minutes and pay securely online.'
                : 'This club has not set up its website yet. Please contact '
                    'support if you need more information.',
            textAlign: TextAlign.center,
            style: AppFonts.body(
              fontSize: 13,
              color: AppColors.slate500,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 14),
          if (showSetup) ...[
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: () => _openWebsitePurchase(
                  context,
                  clubId: clubId,
                  clubName: clubName,
                  onPurchased: onPurchased ?? () {},
                ),
                icon: const Icon(Icons.add_circle_outline_rounded, size: 18),
                label: Text(
                  'Set up website',
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: const StadiumBorder(),
                ),
              ),
            ),
            const SizedBox(height: 8),
          ],
          TextButton.icon(
            onPressed: () =>
                showWebsiteRenewalDialog(context, notConfigured: true),
            icon: const Icon(Icons.support_agent_rounded, size: 15),
            label: Text(
              'Contact support',
              style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
            style: TextButton.styleFrom(foregroundColor: AppColors.slate500),
          ),
        ],
      ),
    );
  }
}

// ── Configured view ──────────────────────────────────────────────────────────

class _ConfiguredView extends StatelessWidget {
  final ClubAdminWebsite web;
  final int clubId;
  final VoidCallback onPurchased;
  const _ConfiguredView({
    required this.web,
    required this.clubId,
    required this.onPurchased,
  });

  Color get _statusAccent {
    if (web.killSwitchOn) return AppColors.slate500;
    if (web.isExpired) return AppColors.statusNone;
    if (web.isLive) return AppColors.statusDone;
    return AppColors.rotaryBlue;
  }

  @override
  Widget build(BuildContext context) {
    final url = web.publicUrl;
    final statusSub = !web.configured
        ? 'No website set up'
        : web.isExpired
            ? (web.expiryDate != null ? 'Expired ${web.expiryDate}' : 'Expired')
            : (web.expiryDate != null
                ? 'Expiry ${web.expiryDate}'
                : 'No expiry on file');
    // 2 KPIs: Website Status (Yes/Live/Expired + expiry sub) paired with Last
    // Updated. The old "Subscription" card was dropped — it echoed the same
    // status/expiry the Website Status card already shows. The public URL sits
    // at the very top; Banner Photos + Advertisement Area live in the Website
    // Management grid below, not as duplicate progress tiles here.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (web.killSwitchOn) ...[
          const _KillSwitchBanner(),
          const SizedBox(height: 12),
        ],
        if (web.isExpired) ...[
          _ExpiredBanner(
            expiryDate: web.expiryDate,
            clubId: clubId,
            clubName: web.clubName,
            onPurchased: onPurchased,
          ),
          const SizedBox(height: 12),
        ],
        // Public URL with copy + visit — at the very top.
        if (url.isNotEmpty) ...[
          _ShareBar(url: url),
          const SizedBox(height: 12),
        ],
        StatCard(
          label: 'Website Status',
          value: web.statusLabel,
          sub: statusSub,
          accent: _statusAccent,
          subTone: web.isExpired
              ? StatSubTone.down
              : (web.isLive ? StatSubTone.up : StatSubTone.muted),
        ),
        // Website Training booking — only when the site is live (booking
        // requires an active website subscription server-side).
        if (web.isLive) ...[
          const SizedBox(height: 12),
          _TrainingEntryCard(clubId: clubId, clubName: web.clubName),
        ],
      ],
    );
  }
}

// ── Website Training entry card ──────────────────────────────────────────────

/// Tappable card that opens the Website Training booking screen. Only rendered
/// when the club website is live (booking needs an active subscription).
class _TrainingEntryCard extends StatelessWidget {
  final int clubId;
  final String clubName;
  const _TrainingEntryCard({required this.clubId, required this.clubName});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => WebsiteTrainingScreen(
              clubId: clubId,
              clubName: clubName.isEmpty ? null : clubName,
            ),
          ),
        ),
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.slate200),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.primaryLight,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: const Icon(Icons.cast_for_education_rounded,
                    color: AppColors.primary, size: 21),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Website Training',
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Book a live Zoom session to learn your website tools',
                      style: AppFonts.body(
                        fontSize: 13,
                        color: AppColors.slate500,
                        height: 1.3,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.chevron_right_rounded,
                  size: 22, color: AppColors.slate400),
            ],
          ),
        ),
      ),
    );
  }
}

/// Red banner shown when the district has disabled this club's website.
class _KillSwitchBanner extends StatelessWidget {
  const _KillSwitchBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.errorTint,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.errorLight),
      ),
      child: Row(
        children: [
          const Icon(Icons.gpp_bad_rounded,
              size: 18, color: AppColors.statusNone),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Your website is hidden by district administration (kill switch enabled).',
              style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.errorDark),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Share bar (real public URL) ──────────────────────────────────────────────

class _ShareBar extends StatefulWidget {
  final String url;
  const _ShareBar({required this.url});

  @override
  State<_ShareBar> createState() => _ShareBarState();
}

class _ShareBarState extends State<_ShareBar> {
  bool _copied = false;

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
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.public_rounded,
                  size: 14, color: AppColors.statusDone),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  widget.url,
                  style: AppFonts.body(
                    fontSize: 13,
                    color: AppColors.slate500,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _ShareBtn(
                onTap: _copy,
                icon: _copied ? Icons.check_rounded : Icons.copy_rounded,
                label: _copied ? 'Copied!' : 'Copy',
                bg: _copied ? AppColors.successTint : Colors.white,
                fg: _copied ? AppColors.statusDone : AppColors.slate500,
                borderColor:
                    _copied ? AppColors.lightBorder : AppColors.slate200,
              ),
              _ShareBtn(
                onTap: () => _visit(),
                icon: Icons.open_in_new_rounded,
                label: 'Visit',
                bg: AppColors.rotaryBlue,
                fg: Colors.white,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ShareBtn extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color bg;
  final Color fg;
  final Color? borderColor;
  final VoidCallback onTap;
  const _ShareBtn({
    required this.onTap,
    required this.icon,
    required this.label,
    required this.bg,
    required this.fg,
    this.borderColor,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(7),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(7),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(7),
            border:
                borderColor != null ? Border.all(color: borderColor!) : null,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 12, color: fg),
              const SizedBox(width: 4),
              Text(
                label,
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: fg,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Expired-subscription alert ───────────────────────────────────────────────

class _ExpiredBanner extends StatelessWidget {
  final String? expiryDate;
  final int clubId;
  final String clubName;
  final VoidCallback onPurchased;
  const _ExpiredBanner({
    required this.expiryDate,
    required this.clubId,
    required this.clubName,
    required this.onPurchased,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: AppColors.errorTint,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.errorLight),
      ),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: const BoxDecoration(
              color: AppColors.statusNone,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Website Subscription Expired',
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.statusNone,
                  ),
                ),
                Text(
                  expiryDate != null
                      ? 'Expired on $expiryDate. Renew to restore your website.'
                      : 'Renew to restore your website.',
                  style: AppFonts.body(
                    fontSize: 13,
                    color: AppColors.statusNone.withValues(alpha: 0.8),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          ElevatedButton(
            onPressed: () => _openWebsitePurchase(
              context,
              clubId: clubId,
              clubName: clubName,
              onPurchased: onPurchased,
            ),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.statusNone,
              foregroundColor: Colors.white,
              elevation: 0,
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              shape: const StadiumBorder(),
            ),
            child: Text(
              'Renew',
              style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
