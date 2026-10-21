import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_gradients.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../data/models/rotarian_model.dart';
import '../../../../../presentation/widgets/common/empty_state_widget.dart';
import '../../../../../presentation/widgets/common/full_screen_image_view.dart';
import '../../../../../presentation/widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Read-only detail page for a single Board-of-Directors member.
///
/// The board record itself carries only name / designation / year / photo, so
/// those are passed in from the list row for an instant hero (no blank flash),
/// then the member's full profile is fetched from `find-rotarian` to fill in
/// the contact / personal / club / social / family sections. Mirrors the visual
/// language of `directory_member_detail_screen.dart`.
class BodMemberDetailScreen extends StatefulWidget {
  final int memberId;
  final String memberName;
  final String designationName;
  final String yearLabel;
  final String? profilePhotoPath;

  const BodMemberDetailScreen({
    super.key,
    required this.memberId,
    required this.memberName,
    required this.designationName,
    required this.yearLabel,
    this.profilePhotoPath,
  });

  @override
  State<BodMemberDetailScreen> createState() => _BodMemberDetailScreenState();
}

class _BodMemberDetailScreenState extends State<BodMemberDetailScreen> {
  final _api = ApiClient();
  RotarianDetail? _detail;
  bool _loading = true;
  String? _error;

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
          _error = resp.error ?? 'Member not found';
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
      body: CustomScrollView(
        physics: const BouncingScrollPhysics(),
        slivers: [
          _BodHeroAppBar(
            memberName: widget.memberName,
            designation: widget.designationName,
            yearLabel: widget.yearLabel,
            // Prefer the freshly-fetched photo (more reliable path), else the
            // one handed over from the list row.
            photoPath: _detail?.member.profilePhoto ?? widget.profilePhotoPath,
            rotaryId: _detail?.member.rotaryId,
          ),
          SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
            sliver: SliverList(
              delegate: SliverChildListDelegate(_buildSections()),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _buildSections() {
    final sections = <Widget>[];

    // While the profile is still loading or failed, contact info isn't available
    // yet — show the Board Position card (data already in hand) on its own.
    if (_loading) {
      sections
        ..add(_boardPositionCard())
        ..add(const SizedBox(height: 16))
        ..add(const Padding(
          padding: EdgeInsets.only(top: 40),
          child: LoadingWidget(),
        ));
      return sections;
    }
    if (_error != null) {
      sections
        ..add(_boardPositionCard())
        ..add(const SizedBox(height: 16))
        ..add(Padding(
          padding: const EdgeInsets.only(top: 24),
          child: ErrorStateWidget(message: _error!, onRetry: _load),
        ));
      return sections;
    }

    final d = _detail;
    if (d == null) {
      sections
        ..add(_boardPositionCard())
        ..add(const SizedBox(height: 16));
      return sections;
    }
    final m = d.member;
    final primaryClub = d.clubs.isNotEmpty ? d.clubs.first : null;
    final business = d.addresses.firstWhere(
      (a) => (a.addressType ?? '').toLowerCase() == 'business',
      orElse: () => const RotarianAddress(),
    );
    final residential = d.addresses.firstWhere(
      (a) => (a.addressType ?? '').toLowerCase() == 'residential',
      orElse: () => const RotarianAddress(),
    );

    // Contact actions at the very top, ABOVE the Board Position card.
    if (m.isPersonalDetailsVisible) {
      sections
        ..add(_buildContactCard(m))
        ..add(const SizedBox(height: 16));
    }

    // Board Position right below the contact actions.
    sections
      ..add(_boardPositionCard())
      ..add(const SizedBox(height: 16));

    if ((m.memberIntroduction ?? '').isNotEmpty) {
      sections
        ..add(_IntroductionCard(text: m.memberIntroduction!))
        ..add(const SizedBox(height: 16));
    }

    sections
      ..add(_InfoCard(
        title: 'Personal Details',
        icon: Icons.person_rounded,
        children: [
          _InfoRow('FULL NAME', m.memberName),
          if (m.isPersonalDetailsVisible) ...[
            if ((m.email ?? '').isNotEmpty)
              _InfoRow('EMAIL', m.email!,
                  tappable: true, onTap: () => _openUrl('mailto:${m.email}')),
            if ((m.primaryMobile ?? '').isNotEmpty)
              _InfoRow(
                'PRIMARY MOBILE',
                _formatPhone(m.primaryPhoneCode, m.primaryMobile),
                tappable: true,
                onTap: () => _openUrl('tel:${_digits(m.primaryMobile!)}'),
              ),
            if ((m.secondaryMobile ?? '').isNotEmpty)
              _InfoRow(
                'SECONDARY MOBILE',
                _formatPhone(m.secondaryPhoneCode, m.secondaryMobile),
                tappable: true,
                onTap: () => _openUrl('tel:${_digits(m.secondaryMobile!)}'),
              ),
            if (m.birthDate != null)
              _InfoRow('BIRTHDAY', _formatDayMonth(m.birthDate!)),
            if (m.anniversaryDate != null)
              _InfoRow('ANNIVERSARY', _formatDayMonth(m.anniversaryDate!)),
          ],
          if ((m.bloodGroup ?? '').isNotEmpty)
            _InfoRow('BLOOD GROUP', m.bloodGroup!),
          if ((m.rotaryId ?? '').isNotEmpty) _InfoRow('ROTARY ID', m.rotaryId!),
          if ((m.donorRecognition ?? '').isNotEmpty)
            _InfoRow('DONOR RECOGNITION', m.donorRecognition!),
        ],
      ))
      ..add(const SizedBox(height: 16));

    if (primaryClub != null) {
      sections
        ..add(_InfoCard(
          title: 'Club',
          icon: Icons.business_rounded,
          children: [
            _InfoRow('CLUB NAME', primaryClub.clubName),
            if (primaryClub.districtNumber.isNotEmpty)
              _InfoRow('DISTRICT', 'D${primaryClub.districtNumber}'),
            if ((primaryClub.city ?? '').isNotEmpty)
              _InfoRow('CITY', primaryClub.city!),
            if (primaryClub.joinedDate != null)
              _InfoRow('JOINED', _formatDate(primaryClub.joinedDate!)),
          ],
        ))
        ..add(const SizedBox(height: 16));
    }

    if (_hasBusinessInfo(business)) {
      sections
        ..add(_InfoCard(
          title: 'Business',
          icon: Icons.work_rounded,
          children: [
            if ((business.businessName ?? '').isNotEmpty)
              _InfoRow('BUSINESS NAME', business.businessName!),
            if ((business.designation ?? '').isNotEmpty)
              _InfoRow('DESIGNATION', business.designation!),
            if ((business.classification ?? '').isNotEmpty)
              _InfoRow('CLASSIFICATION', business.classification!),
            if ((business.businessEmail ?? '').isNotEmpty)
              _InfoRow('BUSINESS EMAIL', business.businessEmail!,
                  tappable: true,
                  onTap: () => _openUrl('mailto:${business.businessEmail}')),
            if ((business.phoneNumber ?? '').isNotEmpty)
              _InfoRow('PHONE', business.phoneNumber!,
                  tappable: true,
                  onTap: () => _openUrl('tel:${_digits(business.phoneNumber!)}')),
            if (_addressLine(business).isNotEmpty)
              _InfoRow('ADDRESS', _addressLine(business)),
          ],
        ))
        ..add(const SizedBox(height: 16));
    }

    if (_hasResidentialInfo(residential) && m.isPersonalDetailsVisible) {
      sections
        ..add(_InfoCard(
          title: 'Residential Address',
          icon: Icons.home_rounded,
          children: [
            if ((residential.phoneNumber ?? '').isNotEmpty)
              _InfoRow('PHONE', residential.phoneNumber!,
                  tappable: true,
                  onTap: () =>
                      _openUrl('tel:${_digits(residential.phoneNumber!)}')),
            if (_addressLine(residential).isNotEmpty)
              _InfoRow('ADDRESS', _addressLine(residential)),
          ],
        ))
        ..add(const SizedBox(height: 16));
    }

    if (_hasSocialPresence(m)) {
      sections
        ..add(_InfoCard(
          title: 'Social Presence',
          icon: Icons.public_rounded,
          children: [
            if ((m.facebook ?? '').isNotEmpty)
              _InfoRow('FACEBOOK', m.facebook!,
                  tappable: true, onTap: () => _openUrl(m.facebook!)),
            if ((m.instagram ?? '').isNotEmpty)
              _InfoRow('INSTAGRAM', m.instagram!,
                  tappable: true, onTap: () => _openUrl(m.instagram!)),
            if ((m.linkedIn ?? '').isNotEmpty)
              _InfoRow('LINKEDIN', m.linkedIn!,
                  tappable: true, onTap: () => _openUrl(m.linkedIn!)),
            if ((m.twitter ?? '').isNotEmpty)
              _InfoRow('TWITTER / X', m.twitter!,
                  tappable: true, onTap: () => _openUrl(m.twitter!)),
            if ((m.youtube ?? '').isNotEmpty)
              _InfoRow('YOUTUBE', m.youtube!,
                  tappable: true, onTap: () => _openUrl(m.youtube!)),
            if ((m.website ?? '').isNotEmpty)
              _InfoRow('WEBSITE', m.website!,
                  tappable: true, onTap: () => _openUrl(m.website!)),
          ],
        ))
        ..add(const SizedBox(height: 16));
    }

    if (m.isFamilyDetailsVisible && (m.familyPhoto ?? '').isNotEmpty) {
      sections
        ..add(_FamilyPhotoCard(photoPath: m.familyPhoto!))
        ..add(const SizedBox(height: 16));
    }

    if (!m.isPersonalDetailsVisible) {
      sections
        ..add(const _PrivateNotice(
          icon: Icons.lock_person_outlined,
          title: 'Personal details are private',
          subtitle:
              'This member chose to hide their phone, email, and personal dates.',
        ))
        ..add(const SizedBox(height: 12));
    }

    sections.add(const SizedBox(height: 80));
    return sections;
  }

  // ── Board Position card ───────────────────────────────────────────────────
  Widget _boardPositionCard() {
    final clubName = _detail?.clubs.isNotEmpty == true
        ? _detail!.clubs.first.clubName
        : '';
    return _InfoCard(
      title: 'Board Position',
      icon: Icons.workspace_premium_rounded,
      children: [
        if (widget.designationName.isNotEmpty)
          _InfoRow('DESIGNATION', widget.designationName),
        if (widget.yearLabel.isNotEmpty)
          _InfoRow('ROTARY YEAR', widget.yearLabel),
        if (clubName.isNotEmpty) _InfoRow('CLUB', clubName),
      ],
    );
  }

  // ── Contact actions card ──────────────────────────────────────────────────
  Widget _buildContactCard(RotarianProfile m) {
    final phone = (m.primaryMobile ?? '').trim();
    final email = (m.email ?? '').trim();
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
            enabled: phone.isNotEmpty,
            onTap: () => _openUrl('tel:${_digits(phone)}'),
          ),
          _ContactAction(
            icon: Icons.chat_bubble_outline_rounded,
            label: 'SMS',
            color: AppColors.primaryPrime,
            enabled: phone.isNotEmpty,
            onTap: () => _openUrl('sms:${_digits(phone)}'),
          ),
          _ContactAction(
            icon: Icons.mail_outline_rounded,
            label: 'Email',
            color: AppColors.primaryPrime,
            enabled: email.isNotEmpty,
            onTap: () => _openUrl('mailto:$email'),
          ),
        ],
      ),
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  bool _hasBusinessInfo(RotarianAddress a) => [
        a.businessName,
        a.designation,
        a.classification,
        a.keywords,
        a.businessEmail,
        a.phoneNumber,
        a.address,
        a.city,
        a.state,
      ].any((s) => (s ?? '').isNotEmpty);

  bool _hasResidentialInfo(RotarianAddress a) =>
      [a.address, a.city, a.state, a.country, a.pinCode, a.phoneNumber]
          .any((s) => (s ?? '').isNotEmpty);

  bool _hasSocialPresence(RotarianProfile m) =>
      [m.facebook, m.instagram, m.linkedIn, m.twitter, m.youtube, m.website]
          .any((s) => (s ?? '').isNotEmpty);

  String _addressLine(RotarianAddress a) =>
      [a.address, a.city, a.state, a.country, a.pinCode]
          .where((p) => p != null && p.isNotEmpty)
          .join(', ');

  String _formatDate(DateTime dt) => DateFormat('dd MMM yyyy').format(dt);

  // Birthday/anniversary are day-month only (year is a 1900 placeholder).
  String _formatDayMonth(DateTime dt) => DateFormat('d MMM').format(dt);

  String _formatPhone(String? code, String? number) {
    final n = (number ?? '').trim();
    if (n.isEmpty) return '';
    final c = (code ?? '').trim();
    return c.isEmpty ? n : '$c $n';
  }

  String _digits(String input, {bool includeCountry = false, String? fallback}) {
    final stripped = input.replaceAll(RegExp(r'[^0-9+]'), '');
    if (!includeCountry) return stripped;
    if (stripped.startsWith('+')) return stripped.substring(1);
    final code = (fallback ?? '').replaceAll(RegExp(r'[^0-9]'), '');
    return '$code$stripped';
  }

  Future<void> _openUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {}
  }
}

// ─── Sliver hero ────────────────────────────────────────────────────────────
class _BodHeroAppBar extends StatelessWidget {
  final String memberName;
  final String designation;
  final String yearLabel;
  final String? photoPath;
  final String? rotaryId;
  const _BodHeroAppBar({
    required this.memberName,
    required this.designation,
    required this.yearLabel,
    this.photoPath,
    this.rotaryId,
  });

  @override
  Widget build(BuildContext context) {
    final initialsText = _getInitials(memberName);
    final photoUrl = ApiConstants.mediaUrl(photoPath ?? '');

    return SliverAppBar(
      expandedHeight: 332,
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
      flexibleSpace: FlexibleSpaceBar(
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
                Builder(builder: (ctx) {
                  final heroTag = 'bod_photo_$memberName';
                  final avatar = Container(
                    width: 108,
                    height: 108,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(
                          color: Colors.white.withValues(alpha: 0.5), width: 4),
                    ),
                    child: ClipOval(
                      child: photoUrl.isNotEmpty
                          ? CachedNetworkImage(
                              imageUrl: photoUrl,
                              fit: BoxFit.cover,
                              placeholder: (_, __) => _initials(initialsText),
                              errorWidget: (_, __, ___) =>
                                  _initials(initialsText),
                            )
                          : _initials(initialsText),
                    ),
                  );
                  if (photoUrl.isEmpty) return avatar;
                  return GestureDetector(
                    onTap: () => FullScreenImageView.open(
                      ctx,
                      imageUrl: photoUrl,
                      heroTag: heroTag,
                      title: memberName,
                    ),
                    child: Hero(tag: heroTag, child: avatar),
                  );
                }),
                const SizedBox(height: 14),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Text(
                    memberName.toUpperCase(),
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
                if (designation.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: Text(
                      designation,
                      textAlign: TextAlign.center,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppFonts.body(
                        color: Colors.white.withValues(alpha: 0.9),
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                if (yearLabel.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.goldPrime,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      yearLabel,
                      style: AppFonts.body(
                        color: AppColors.darkBg,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
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

// ─── Reusable cards / rows (local copies — matches the per-page detail
//     convention used by directory / committee member detail screens) ────────
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
  const _InfoRow(this.label, this.value, {this.tappable = false, this.onTap});

  @override
  Widget build(BuildContext context) {
    final body = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 2,
            child: Text(
              label,
              style: AppFonts.body(
                fontSize: 10,
                fontWeight: FontWeight.w800,
                color: AppColors.textMuted,
                letterSpacing: 0.5,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 3,
            child: Text(
              value,
              style: AppFonts.body(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: tappable && onTap != null
                    ? AppColors.primaryPrime
                    : AppColors.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
    return tappable && onTap != null
        ? InkWell(onTap: onTap, child: body)
        : body;
  }
}

class _IntroductionCard extends StatelessWidget {
  final String text;
  const _IntroductionCard({required this.text});

  @override
  Widget build(BuildContext context) {
    return _InfoCard(
      title: 'Introduction',
      icon: Icons.format_quote_rounded,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          child: Text(
            text,
            style: AppTextStyles.body
                .copyWith(color: AppColors.textPrimary, height: 1.45),
          ),
        ),
      ],
    );
  }
}

class _FamilyPhotoCard extends StatelessWidget {
  final String photoPath;
  const _FamilyPhotoCard({required this.photoPath});

  @override
  Widget build(BuildContext context) {
    final url = ApiConstants.mediaUrl(photoPath);
    if (url.isEmpty) return const SizedBox.shrink();
    return _InfoCard(
      title: 'Family',
      icon: Icons.family_restroom_rounded,
      children: [
        ClipRRect(
          borderRadius:
              const BorderRadius.vertical(bottom: Radius.circular(20)),
          child: CachedNetworkImage(
            imageUrl: url,
            fit: BoxFit.cover,
            width: double.infinity,
            height: 220,
            errorWidget: (_, __, ___) => const SizedBox.shrink(),
          ),
        ),
      ],
    );
  }
}

class _PrivateNotice extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  const _PrivateNotice({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: AppColors.warning, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: AppTextStyles.bodyMedium
                        .copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                Text(subtitle,
                    style: AppTextStyles.caption.copyWith(
                        color: AppColors.textSecondary, height: 1.4)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

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
