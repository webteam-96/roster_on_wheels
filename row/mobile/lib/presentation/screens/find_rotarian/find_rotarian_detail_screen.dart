import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/utils/maps_utils.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_gradients.dart';
import '../../../data/models/rotarian_model.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/maps_action_button.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class FindRotarianDetailScreen extends StatefulWidget {
  final int memberId;

  /// The club this member was opened from. A member can belong to several clubs
  /// (the search returns one row per club), so the hero shows THIS club instead
  /// of defaulting to the first in the array. Matched by [clubRotaryId] (unique)
  /// first, then [clubName]; falls back to the first club when neither matches.
  final String? clubName;
  final String? clubRotaryId;

  const FindRotarianDetailScreen({
    super.key,
    required this.memberId,
    this.clubName,
    this.clubRotaryId,
  });

  @override
  State<FindRotarianDetailScreen> createState() => _FindRotarianDetailScreenState();
}

class _FindRotarianDetailScreenState extends State<FindRotarianDetailScreen> {
  final _api = ApiClient();
  RotarianDetail? _detail;
  bool _loading = true;
  String? _error;
  bool _introExpanded = false;

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
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/mobile/find-rotarian/${widget.memberId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (resp.isSuccess && resp.data != null) {
        setState(() {
          _detail = RotarianDetail.fromJson(resp.data!);
          _loading = false;
        });
      } else {
        setState(() {
          _error = resp.error ?? 'Rotarian not found';
          _loading = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) return const LoadingWidget();
    if (_error != null) return ErrorStateWidget(message: _error!, onRetry: _load);
    final d = _detail;
    if (d == null) {
      return const EmptyStateWidget(
        title: 'Rotarian not found',
        icon: Icons.error_outline_rounded,
      );
    }

    final m = d.member;
    // Public profile (Find a Rotarian / Find a Club): show only the BUSINESS
    // address — Residential, Family and Social are hidden here.
    final businessAddrs = d.addresses
        .where((a) => (a.addressType ?? '').toLowerCase() == 'business')
        .toList();
    // Club name shown under the member's name in the hero. Show the club this
    // member was opened from (a member can be in several), matched by club
    // Rotary ID first then name; falls back to the first club.
    String? heroClubName;
    RotarianClub? pickedClub;
    if (d.clubs.isNotEmpty) {
      final wantRid = (widget.clubRotaryId ?? '').trim();
      final wantName = (widget.clubName ?? '').trim().toLowerCase();
      RotarianClub picked = d.clubs.first;
      if (wantRid.isNotEmpty) {
        picked = d.clubs.firstWhere(
          (c) => (c.clubRotaryId ?? '').trim() == wantRid,
          orElse: () => d.clubs.firstWhere(
            (c) => c.clubName.trim().toLowerCase() == wantName,
            orElse: () => d.clubs.first,
          ),
        );
      } else if (wantName.isNotEmpty) {
        picked = d.clubs.firstWhere(
          (c) => c.clubName.trim().toLowerCase() == wantName,
          orElse: () => d.clubs.first,
        );
      }
      pickedClub = picked;
      heroClubName = picked.clubName;
    }

    // Contact actions in the app bar (share / save to phone). Hidden when the
    // member has hidden their personal details — there's nothing to act on.
    // Shared/saved contact carries: name, mobile(s), email, classification
    // (as job title) and the club name (as organization).
    // Designation/classification are per-club (backend moved them off the
    // address onto the club row 2026-06-22), so read them from the picked club.
    final classification = (pickedClub?.classification ?? '').trim();
    final contactClubName = (heroClubName ?? '').trim();
    final canContact = m.isPersonalDetailsVisible && _hasContact(m);

    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.primary,
      child: CustomScrollView(
        physics:
            const BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics()),
        slivers: [
          _HeroAppBar(
            member: m,
            clubName: heroClubName,
            onShare: canContact
                ? () => _shareContact(m,
                    classification: classification, clubName: contactClubName)
                : null,
            onSave: canContact
                ? () => _saveContact(m,
                    classification: classification, clubName: contactClubName)
                : null,
          ),
          SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                if (m.isPersonalDetailsVisible && _hasContact(m)) ...[
                  _buildContactCard(m),
                  const SizedBox(height: 16),
                ] else if (!m.isPersonalDetailsVisible) ...[
                  _privateContactNotice(),
                  const SizedBox(height: 16),
                ],
                if ((m.memberIntroduction ?? '').isNotEmpty) ...[
                  _introCard(m.memberIntroduction!),
                  const SizedBox(height: 16),
                ],
                _aboutCard(m),
                // Show the Business card whenever there's a business address OR
                // a per-club classification/designation to display — so members
                // with no business address still get their classification shown
                // (it comes from the club row, not the address).
                if (businessAddrs.isNotEmpty ||
                    classification.isNotEmpty ||
                    (pickedClub?.designation ?? '').trim().isNotEmpty) ...[
                  const SizedBox(height: 16),
                  _businessCard(businessAddrs, pickedClub),
                ],
                const SizedBox(height: 24),
              ]),
            ),
          ),
        ],
      ),
    );
  }

  // ── Contact actions card ──────────────────────────────────────────────────
  Widget _buildContactCard(RotarianProfile m) {
    final primary = _fullPhone(m.primaryPhoneCode, m.primaryMobile);
    final email = (m.email ?? '').trim();
    final hasPhone = primary != null;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.lightBorder),

      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _ContactAction(
            icon: Icons.call_rounded,
            label: 'Call',
            color: AppColors.primaryPrime,
            enabled: hasPhone,
            onTap: hasPhone ? () => _openUrl('tel:${_digitsOnly(primary)}') : null,
          ),
          _ContactAction(
            icon: Icons.chat_bubble_outline_rounded,
            label: 'SMS',
            color: AppColors.primaryPrime,
            enabled: hasPhone,
            onTap: hasPhone ? () => _openUrl('sms:${_digitsOnly(primary)}') : null,
          ),
          _ContactAction(
            icon: Icons.mail_outline_rounded,
            label: 'Email',
            color: AppColors.primaryPrime,
            enabled: email.isNotEmpty,
            onTap: email.isNotEmpty ? () => _openUrl('mailto:$email') : null,
          ),
        ],
      ),
    );
  }

  Widget _privateContactNotice() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.25)),
      ),
      child: Row(
        children: [
          const Icon(Icons.lock_outline_rounded,
              size: 20, color: AppColors.warning),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Contact details are private.',
              style: AppFonts.body(
                fontSize: 13,
                color: AppColors.textSecondary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Introduction (collapsible "Read more") inside the shared card shell ─────
  Widget _introCard(String text) {
    return _InfoCard(
      title: 'Introduction',
      icon: Icons.format_quote_rounded,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final style = AppFonts.body(
                fontSize: 14,
                height: 1.5,
                color: AppColors.textPrimary,
              );
              final tp = TextPainter(
                text: TextSpan(text: text, style: style),
                maxLines: 3,
                textDirection: Directionality.of(context),
              )..layout(maxWidth: constraints.maxWidth);
              final overflows = tp.didExceedMaxLines;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    text,
                    style: style,
                    maxLines: _introExpanded ? null : 3,
                    overflow: _introExpanded
                        ? TextOverflow.visible
                        : TextOverflow.ellipsis,
                  ),
                  if (overflows) ...[
                    const SizedBox(height: 6),
                    GestureDetector(
                      onTap: () =>
                          setState(() => _introExpanded = !_introExpanded),
                      child: Text(
                        _introExpanded ? 'Read less' : 'Read more',
                        style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppColors.primary,
                        ),
                      ),
                    ),
                  ],
                ],
              );
            },
          ),
        ),
      ],
    );
  }

  // ── About (Blood Group / Birthday / Anniversary) ────────────────────────────
  Widget _aboutCard(RotarianProfile m) {
    final rows = <Widget>[];
    // Email + mobile shown as visible, tappable rows (in addition to the action
    // buttons above), but ONLY when the member exposes personal details.
    // Birthday / Anniversary are day-month only (year hidden) via _fmtDayMonth.
    if (m.isPersonalDetailsVisible) {
      final email = (m.email ?? '').trim();
      if (email.isNotEmpty) {
        rows.add(_InfoRow('EMAIL', email,
            tappable: true, onTap: () => _openUrl('mailto:$email')));
      }
      final primary = _fullPhone(m.primaryPhoneCode, m.primaryMobile);
      if (primary != null) {
        rows.add(_InfoRow('PRIMARY MOBILE', primary,
            tappable: true, onTap: () => _openUrl('tel:${_digitsOnly(primary)}')));
      }
      final secondary = _fullPhone(m.secondaryPhoneCode, m.secondaryMobile);
      if (secondary != null) {
        rows.add(_InfoRow('SECONDARY MOBILE', secondary,
            tappable: true,
            onTap: () => _openUrl('tel:${_digitsOnly(secondary)}')));
      }
    }
    if ((m.bloodGroup ?? '').isNotEmpty) {
      rows.add(_InfoRow('BLOOD GROUP', m.bloodGroup!));
    }
    if (m.birthDate != null) {
      rows.add(_InfoRow('BIRTHDAY', _fmtDayMonth(m.birthDate!)));
    }
    if (m.anniversaryDate != null) {
      rows.add(_InfoRow('ANNIVERSARY', _fmtDayMonth(m.anniversaryDate!)));
    }
    // _InfoCard self-hides when there are no rows.
    return _InfoCard(
      title: 'About',
      icon: Icons.person_outline_rounded,
      children: rows,
    );
  }

  // ── Business (same fields as before, rendered as label/value rows) ──────────
  // Designation + Classification are per-club (backend moved them off the
  // address onto the club row 2026-06-22), so they come from `club`, rendered
  // once at the top rather than per business-address.
  Widget _businessCard(List<RotarianAddress> addrs, RotarianClub? club) {
    final rows = <Widget>[];
    final designation = (club?.designation ?? '').trim();
    final classification = (club?.classification ?? '').trim();
    if (designation.isNotEmpty) {
      rows.add(_InfoRow('DESIGNATION', designation));
    }
    if (classification.isNotEmpty) {
      rows.add(_InfoRow('CLASSIFICATION', classification));
    }
    for (final a in addrs) {
      if ((a.businessName ?? '').isNotEmpty) {
        rows.add(_InfoRow('BUSINESS NAME', a.businessName!));
      }
      if ((a.keywords ?? '').isNotEmpty) {
        rows.add(_InfoRow('KEYWORDS', a.keywords!));
      }
      if ((a.businessEmail ?? '').isNotEmpty) {
        rows.add(_InfoRow('BUSINESS EMAIL', a.businessEmail!,
            tappable: true, onTap: () => _openUrl('mailto:${a.businessEmail}')));
      }
      if ((a.phoneNumber ?? '').isNotEmpty) {
        rows.add(_InfoRow('PHONE', a.phoneNumber!,
            tappable: true,
            onTap: () => _openUrl('tel:${_digitsOnly(a.phoneNumber!)}')));
      }
      final loc = _join([a.address, a.city, a.state, a.pinCode, a.country]);
      if (loc.isNotEmpty) {
        rows.add(_InfoRow('ADDRESS', loc,
            tappable: true,
            valueIcon: Icons.location_on_rounded,
            onTap: () => _openMaps(loc)));
      }
    }
    return _InfoCard(
      title: 'Business',
      icon: Icons.work_rounded,
      children: rows,
    );
  }

  // ── Helpers (unchanged) ─────────────────────────────────────────────────────
  bool _hasContact(RotarianProfile m) {
    return (m.primaryMobile ?? '').isNotEmpty ||
        (m.secondaryMobile ?? '').isNotEmpty ||
        (m.email ?? '').isNotEmpty;
  }

  String? _fullPhone(String? code, String? number) {
    final n = (number ?? '').trim();
    if (n.isEmpty) return null;
    final c = (code ?? '').replaceAll(RegExp(r'[^0-9]'), '');
    return c.isNotEmpty ? '+$c $n' : n;
  }

  String _digitsOnly(String v) => v.replaceAll(RegExp(r'[^0-9+]'), '');

  Future<void> _openUrl(String raw) async {
    var url = raw.trim();
    if (url.isEmpty) return;
    // Pass through any URL that already specifies a scheme (tel:, mailto:,
    // sms:, https://…, etc). Only bare hostnames like "example.com"
    // get prefixed with https:// — the old code prepended https:// to
    // everything, which silently turned tel:+<cc>… into https://tel:+<cc>…
    // and made canLaunchUrl reject it.
    if (!RegExp(r'^[a-zA-Z][a-zA-Z0-9+.\-]*:').hasMatch(url)) {
      url = 'https://$url';
    }
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  // Open the given address in Google Maps (Maps app if installed, else
  // browser). The address is normalized first so smushed/abbreviated
  // hand-typed addresses still resolve — see [googleMapsSearchUrl].
  Future<void> _openMaps(String address) async {
    final url = googleMapsSearchUrl(address);
    if (url == null) return;
    await _openUrl(url);
  }

  // ── App-bar contact actions ───────────────────────────────────────────────

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(msg)));
  }

  // Split a full name into (given, family) on the LAST whitespace — matches the
  // dominant Indian-name convention; single-word names keep family empty.
  (String, String) _splitName(String name) {
    final t = name.trim();
    final last = t.lastIndexOf(RegExp(r'\s+'));
    if (last > 0) {
      return (t.substring(0, last).trim(), t.substring(last).trim());
    }
    return (t, '');
  }

  String _telDigits(String? code, String? number) {
    final n = (number ?? '').replaceAll(RegExp(r'[^0-9]'), '');
    if (n.isEmpty) return '';
    final c = (code ?? '').replaceAll(RegExp(r'[^0-9]'), '');
    return c.isNotEmpty ? '+$c$n' : n;
  }

  // vCard 3.0 reserves , ; \ and newlines as separators (RFC 2426).
  String _escapeVcard(String v) => v
      .replaceAll('\\', '\\\\')
      .replaceAll(';', '\\;')
      .replaceAll(',', '\\,')
      .replaceAll('\n', '\\n');

  String _buildVCard(RotarianProfile m,
      {required String classification, required String clubName}) {
    final (given, family) = _splitName(m.memberName);
    final primary = _telDigits(m.primaryPhoneCode, m.primaryMobile);
    final secondary = _telDigits(m.secondaryPhoneCode, m.secondaryMobile);
    final email = (m.email ?? '').trim();
    final lines = <String>[
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:${_escapeVcard(family)};${_escapeVcard(given)};;;',
      'FN:${_escapeVcard(m.memberName.trim())}',
      if (primary.isNotEmpty) 'TEL;TYPE=CELL:$primary',
      if (secondary.isNotEmpty) 'TEL;TYPE=CELL:$secondary',
      if (email.isNotEmpty) 'EMAIL:${_escapeVcard(email)}',
      if (clubName.isNotEmpty) 'ORG:${_escapeVcard(clubName)}',
      if (classification.isNotEmpty) 'TITLE:${_escapeVcard(classification)}',
      'END:VCARD',
    ];
    return lines.join('\r\n');
  }

  /// Share the member's details out via the OS share sheet as a .vcf file.
  Future<void> _shareContact(RotarianProfile m,
      {required String classification, required String clubName}) async {
    try {
      final vcard =
          _buildVCard(m, classification: classification, clubName: clubName);
      final dir = await getTemporaryDirectory();
      final safe = m.memberName.replaceAll(RegExp(r'[^A-Za-z0-9]+'), '_');
      final file = File('${dir.path}/${safe.isEmpty ? 'contact' : safe}.vcf');
      await file.writeAsString(vcard);
      if (!mounted) return;
      // iOS requires a non-zero source rect for the share popover.
      final box = context.findRenderObject() as RenderBox?;
      final origin = (box != null && box.hasSize)
          ? box.localToGlobal(Offset.zero) & box.size
          : const Rect.fromLTWH(0, 0, 1, 1);
      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'text/vcard')],
        subject: m.memberName,
        sharePositionOrigin: origin,
      );
    } catch (_) {
      _toast('Could not share contact.');
    }
  }

  /// Save the member to the device address book (needs contacts permission).
  Future<void> _saveContact(RotarianProfile m,
      {required String classification, required String clubName}) async {
    try {
      final status =
          await FlutterContacts.permissions.request(PermissionType.write);
      if (!mounted) return;
      if (status != PermissionStatus.granted &&
          status != PermissionStatus.limited) {
        _toast('Contacts permission denied.');
        return;
      }
      final (given, family) = _splitName(m.memberName);
      final primary = _telDigits(m.primaryPhoneCode, m.primaryMobile);
      final secondary = _telDigits(m.secondaryPhoneCode, m.secondaryMobile);
      final email = (m.email ?? '').trim();
      final contact = Contact(
        name: Name(first: given, last: family),
        phones: [
          if (primary.isNotEmpty) Phone(number: primary),
          if (secondary.isNotEmpty) Phone(number: secondary),
        ],
        emails: [if (email.isNotEmpty) Email(address: email)],
        organizations: [
          if (clubName.isNotEmpty || classification.isNotEmpty)
            Organization(
              name: clubName.isEmpty ? null : clubName,
              jobTitle: classification.isEmpty ? null : classification,
            ),
        ],
      );
      await FlutterContacts.create(contact);
      if (!mounted) return;
      _toast('Saved to contacts.');
    } catch (_) {
      _toast('Could not save contact.');
    }
  }
}

// ─── Sliver hero (mirrors directory_member_detail_screen) ────────────────────
class _HeroAppBar extends StatelessWidget {
  final RotarianProfile member;
  final String? clubName;
  final VoidCallback? onShare;
  final VoidCallback? onSave;
  const _HeroAppBar({
    required this.member,
    this.clubName,
    this.onShare,
    this.onSave,
  });

  @override
  Widget build(BuildContext context) {
    final photoUrl = _photoUrl(member.profilePhoto);
    final initials = _getInitials(member.memberName);

    return SliverAppBar(
      expandedHeight: 324,
      pinned: true,
      stretch: true,
      backgroundColor: AppColors.primaryPrime,
      leading: IconButton(
        icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white),
        onPressed: () {
          if (context.canPop()) {
            context.pop();
          } else {
            context.go('/home');
          }
        },
      ),
      actions: [
        if (onShare != null)
          IconButton(
            tooltip: 'Share contact',
            icon: const Icon(Icons.ios_share_rounded, color: Colors.white),
            onPressed: onShare,
          ),
        if (onSave != null)
          IconButton(
            tooltip: 'Save to contacts',
            icon:
                const Icon(Icons.person_add_alt_1_rounded, color: Colors.white),
            onPressed: onSave,
          ),
      ],
      flexibleSpace: LayoutBuilder(
        builder: (context, constraints) {
          // Show the member name in the bar only once the hero has collapsed.
          final collapsed = constraints.biggest.height <=
              kToolbarHeight + MediaQuery.of(context).padding.top + 12;
          return FlexibleSpaceBar(
            centerTitle: true,
            titlePadding: const EdgeInsetsDirectional.only(
                start: 48, end: 48, bottom: 16),
            title: AnimatedOpacity(
              opacity: collapsed ? 1 : 0,
              duration: const Duration(milliseconds: 200),
              child: Text(
                member.memberName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppFonts.body(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            stretchModes: const [
              StretchMode.zoomBackground,
              StretchMode.blurBackground,
            ],
            background: Stack(
              fit: StackFit.expand,
              children: [
            Container(
              decoration: const BoxDecoration(gradient: AppGradients.royalSweep),
            ),
            Positioned(
              top: -50,
              right: -50,
              child: Container(
                width: 200,
                height: 200,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white.withValues(alpha: 0.05),
                ),
              ),
            ),
            Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const SizedBox(height: 56),
                Container(
                  width: 110,
                  height: 110,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                        color: Colors.white.withValues(alpha: 0.5), width: 4),

                  ),
                  child: ClipOval(
                    child: photoUrl == null
                        ? _initials(initials)
                        : CachedNetworkImage(
                            imageUrl: photoUrl,
                            fit: BoxFit.cover,
                            placeholder: (_, __) => _initials(initials),
                            errorWidget: (_, __, ___) => _initials(initials),
                          ),
                  ),
                ),
                const SizedBox(height: 14),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Text(
                    member.memberName.toUpperCase(),
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: AppFonts.display(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1,
                    ),
                  ),
                ),
                if (member.isHonoraryMember) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                    decoration: BoxDecoration(
                      color: AppColors.warning,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.workspace_premium_rounded,
                            size: 14, color: Colors.white),
                        const SizedBox(width: 5),
                        Text(
                          'Honorary Member',
                          style: AppFonts.body(
                            color: Colors.white,
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.3,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                if ((clubName ?? '').isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: Text(
                      clubName!,
                      textAlign: TextAlign.center,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppFonts.body(
                        color: Colors.white.withValues(alpha: 0.85),
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ],
            ),
          );
        },
      ),
    );
  }

  String _getInitials(String name) {
    final parts = name.trim().split(' ').where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  Widget _initials(String text) {
    return Container(
      color: Colors.white.withValues(alpha: 0.2),
      child: Center(
        child: Text(
          text,
          style: AppFonts.body(
            color: Colors.white,
            fontSize: 36,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
  }
}

// ─── Reusable cards / rows (mirrors directory_member_detail_screen) ──────────
class _InfoCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final List<Widget> children;
  const _InfoCard({
    required this.title,
    required this.icon,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    final visible = children.whereType<Widget>().toList();
    if (visible.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 8, bottom: 12),
          child: Row(
            children: [
              Icon(icon, size: 18, color: AppColors.primaryPrime),
              const SizedBox(width: 8),
              Text(
                title.toUpperCase(),
                style: AppFonts.body(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textMuted,
                  letterSpacing: 1.2,
                ),
              ),
            ],
          ),
        ),
        Container(
          width: double.infinity,
          decoration: BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.lightBorder),

          ),
          child: Column(
            children: [
              for (var i = 0; i < visible.length; i++) ...[
                visible[i],
                if (i != visible.length - 1)
                  Divider(
                    height: 1,
                    thickness: 1,
                    color: AppColors.lightBorder.withValues(alpha: 0.6),
                  ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final bool tappable;
  final VoidCallback? onTap;
  final IconData? valueIcon;
  const _InfoRow(
    this.label,
    this.value, {
    this.tappable = false,
    this.onTap,
    this.valueIcon,
  });

  @override
  Widget build(BuildContext context) {
    // Rows that open Google Maps (valueIcon set) keep normal text colour and
    // get a clear blue map button. Plain tappable rows (email/phone) stay
    // link-blue with no button.
    final showMapButton = tappable && onTap != null && valueIcon != null;
    final isLink = tappable && onTap != null && !showMapButton;
    final valueStyle = AppFonts.body(
      fontSize: 14,
      fontWeight: FontWeight.w700,
      color: isLink ? AppColors.primaryPrime : AppColors.textPrimary,
    );
    final labelStyle = AppFonts.body(
      fontSize: 10,
      fontWeight: FontWeight.w800,
      color: AppColors.textMuted,
      letterSpacing: 0.5,
    );

    // Address rows STACK the label + map button on top and give the value the
    // full card width below, so a long address isn't squeezed into a narrow
    // column (the two-column layout below is for short values only).
    if (showMapButton) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(label, style: labelStyle)),
                const SizedBox(width: 12),
                MapsActionButton(onTap: onTap!),
              ],
            ),
            const SizedBox(height: 8),
            Text(value, style: valueStyle),
          ],
        ),
      );
    }

    final body = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(flex: 2, child: Text(label, style: labelStyle)),
          const SizedBox(width: 12),
          Expanded(flex: 3, child: Text(value, style: valueStyle)),
        ],
      ),
    );
    return tappable && onTap != null
        ? InkWell(onTap: onTap, child: body)
        : body;
  }
}

/// Circular outlined contact icon button with a label underneath
/// (Call / SMS / email). Mirrors the District Directory member card.
class _ContactAction extends StatelessWidget {
  final IconData? icon;
  final String? iconAsset;
  final String label;
  final Color color;
  final bool enabled;
  final VoidCallback? onTap;
  const _ContactAction({
    this.icon,
    this.iconAsset,
    required this.label,
    required this.color,
    this.enabled = true,
    this.onTap,
  }) : assert(icon != null || iconAsset != null,
            'Either icon or iconAsset must be provided');

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: enabled ? 1 : 0.35,
      child: InkResponse(
        onTap: enabled ? onTap : null,
        radius: 36,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.transparent,
                border: Border.all(color: color, width: 1.5),
              ),
              alignment: Alignment.center,
              child: iconAsset != null
                  ? Image.asset(iconAsset!,
                      width: 22, height: 22, fit: BoxFit.contain)
                  : Icon(icon, color: color, size: 22),
            ),
            const SizedBox(height: 6),
            Text(
              label,
              style: AppFonts.body(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _join(List<String?> parts) =>
    parts.whereType<String>().where((s) => s.isNotEmpty).join(', ');

// Birthday/anniversary are day-month only (year is a 1900 placeholder
// system-wide) — render without the year to avoid showing "1900".
String _fmtDayMonth(DateTime d) => DateFormat('d MMM').format(d);

String? _photoUrl(String? path) {
  if (path == null || path.isEmpty) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  final base = ApiConstants.mediaBaseUrl;
  final clean = path.startsWith('/') ? path : '/$path';
  return '$base$clean';
}
