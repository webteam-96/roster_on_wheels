import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../widgets/common/full_screen_image_view.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Read-only detail page for a single District Committee office-bearer.
///
/// Self-contained: every field shown is passed in from the committee list item
/// (the committee endpoints already return name/designation/club/contact), so
/// no extra fetch is needed. Mirrors the visual language of the Directory member
/// detail (gradient hero + contact action row + info card), scaled to the
/// fields a committee record carries.
class DistrictCommitteeMemberDetailScreen extends StatelessWidget {
  final String name;
  final String designation;
  final String clubName;
  final String mobile;
  final String email;
  final String remark;
  final String profilePhoto;
  final bool isMember;

  /// When opened from the District Committee person-search, these list the
  /// committee groups this member belongs to (with the designation held in
  /// each); tapping a row opens that group. [districtId] is needed to build
  /// the group route. Empty/null when opened from a single list.
  final int? districtId;
  final List<({int id, String name, String designation})> groups;

  const DistrictCommitteeMemberDetailScreen({
    super.key,
    required this.name,
    required this.designation,
    required this.clubName,
    required this.mobile,
    required this.email,
    required this.remark,
    required this.profilePhoto,
    required this.isMember,
    this.districtId,
    this.groups = const [],
  });

  @override
  Widget build(BuildContext context) {
    final phone = mobile.trim();
    final mail = email.trim();
    final hasContact = phone.isNotEmpty || mail.isNotEmpty;

    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: CustomScrollView(
        physics: const BouncingScrollPhysics(),
        slivers: [
          _HeroAppBar(
            name: name,
            designation: designation,
            clubName: clubName,
            profilePhoto: profilePhoto,
            isMember: isMember,
          ),
          SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                if (hasContact) ...[
                  _ContactCard(phone: phone, email: mail),
                  const SizedBox(height: 16),
                ],
                _InfoCard(
                  title: 'Details',
                  icon: Icons.badge_rounded,
                  children: [
                    if (designation.trim().isNotEmpty)
                      _InfoRow('Designation', designation.trim()),
                    if (clubName.trim().isNotEmpty)
                      _InfoRow('CLUB', clubName.trim()),
                    if (phone.isNotEmpty)
                      _InfoRow('Mobile', phone,
                          tappable: true,
                          onTap: () => _openUrl('tel:${_digits(phone)}')),
                    if (mail.isNotEmpty)
                      _InfoRow('Email', mail,
                          tappable: true,
                          onTap: () => _openUrl('mailto:$mail')),
                    if (remark.trim().isNotEmpty)
                      _InfoRow('Remark', remark.trim()),
                  ],
                ),
                if (groups.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  _GroupsCard(
                    groups: groups,
                    onOpenGroup: districtId == null
                        ? null
                        : (id, name) {
                            final encoded = Uri.encodeComponent(name);
                            context.push(
                                '/districts/$districtId/district-committee/groups/$id?name=$encoded');
                          },
                  ),
                ],
                const SizedBox(height: 80),
              ]),
            ),
          ),
        ],
      ),
    );
  }

  String _digits(String input, {bool includeCountry = false}) {
    final stripped = input.replaceAll(RegExp(r'[^0-9+]'), '');
    if (!includeCountry) return stripped;
    if (stripped.startsWith('+')) return stripped.substring(1);
    // Committee records carry no country code; never guess one.
    return stripped;
  }

  Future<void> _openUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {}
  }
}

// ─── Sliver hero ──────────────────────────────────────────────────────────
class _HeroAppBar extends StatelessWidget {
  final String name;
  final String designation;
  final String clubName;
  final String profilePhoto;
  final bool isMember;
  const _HeroAppBar({
    required this.name,
    required this.designation,
    required this.clubName,
    required this.profilePhoto,
    required this.isMember,
  });

  @override
  Widget build(BuildContext context) {
    final photoUrl = ApiConstants.mediaUrl(profilePhoto);
    final subtitle = [
      if (designation.trim().isNotEmpty) designation.trim(),
      if (clubName.trim().isNotEmpty) clubName.trim(),
    ].join(' · ');

    return SliverAppBar(
      expandedHeight: 300,
      pinned: true,
      stretch: true,
      backgroundColor: AppColors.primaryPrime,
      leading: IconButton(
        icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white),
        onPressed: () => context.canPop() ? context.pop() : context.go('/home'),
      ),
      flexibleSpace: FlexibleSpaceBar(
        stretchModes: const [
          StretchMode.zoomBackground,
          StretchMode.blurBackground,
        ],
        background: Stack(
          fit: StackFit.expand,
          children: [
            Container(decoration: const BoxDecoration(color: AppColors.primaryPrime)),
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
                  final avatar = Container(
                    width: 110,
                    height: 110,
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
                              placeholder: (_, __) => _initialsAvatar(),
                              errorWidget: (_, __, ___) => _initialsAvatar(),
                            )
                          : _initialsAvatar(),
                    ),
                  );
                  if (photoUrl.isEmpty) return avatar;
                  return GestureDetector(
                    onTap: () => FullScreenImageView.open(
                      ctx,
                      imageUrl: photoUrl,
                      heroTag: 'committee_photo_$name',
                      title: name,
                    ),
                    child: Hero(tag: 'committee_photo_$name', child: avatar),
                  );
                }),
                const SizedBox(height: 14),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Text(
                    (name.isEmpty ? 'Unnamed' : name),
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: AppFonts.display(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                if (subtitle.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: Text(
                      subtitle,
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
                if (!isMember) ...[
                  const SizedBox(height: 8),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.goldPrime,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      'NON-MEMBER',
                      style: AppFonts.body(
                        color: AppColors.darkBg,
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _initialsAvatar() {
    final parts =
        name.trim().split(' ').where((p) => p.isNotEmpty).toList();
    final initials = parts.isEmpty
        ? '?'
        : (parts.length == 1
            ? parts[0][0].toUpperCase()
            : '${parts.first[0]}${parts.last[0]}'.toUpperCase());
    return Container(
      color: Colors.white.withValues(alpha: 0.2),
      child: Center(
        child: Text(
          initials,
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

// ─── Contact actions ──────────────────────────────────────────────────────
class _ContactCard extends StatelessWidget {
  final String phone;
  final String email;
  const _ContactCard({required this.phone, required this.email});

  Future<void> _openUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {}
  }

  String _digits(String input, {bool includeCountry = false}) {
    final stripped = input.replaceAll(RegExp(r'[^0-9+]'), '');
    if (!includeCountry) return stripped;
    if (stripped.startsWith('+')) return stripped.substring(1);
    return stripped.length <= 10 ? '91$stripped' : stripped;
  }

  @override
  Widget build(BuildContext context) {
    final hasPhone = phone.isNotEmpty;
    final hasEmail = email.isNotEmpty;
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
            enabled: hasPhone,
            onTap: () => _openUrl('tel:${_digits(phone)}'),
          ),
          _ContactAction(
            icon: Icons.chat_bubble_outline_rounded,
            label: 'SMS',
            enabled: hasPhone,
            onTap: () => _openUrl('sms:${_digits(phone)}'),
          ),
          _ContactAction(
            icon: Icons.mail_outline_rounded,
            label: 'Email',
            enabled: hasEmail,
            onTap: () => _openUrl('mailto:$email'),
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
  final bool enabled;
  final VoidCallback? onTap;
  const _ContactAction({
    this.icon,
    this.iconAsset,
    required this.label,
    this.enabled = true,
    this.onTap,
  }) : assert(icon != null || iconAsset != null);

  @override
  Widget build(BuildContext context) {
    const color = AppColors.primaryPrime;
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
                fontSize: 13,
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

// ─── Info card / row ──────────────────────────────────────────────────────
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
                title,
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textMuted,
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

/// "Committee Groups" section: the groups this member belongs to, each with
/// the designation held there; rows tappable → that group (when [onOpenGroup]
/// is provided). Reuses the [_InfoCard] shell.
class _GroupsCard extends StatelessWidget {
  final List<({int id, String name, String designation})> groups;
  final void Function(int id, String name)? onOpenGroup;
  const _GroupsCard({required this.groups, this.onOpenGroup});

  @override
  Widget build(BuildContext context) {
    return _InfoCard(
      title: 'Committee Groups',
      icon: Icons.groups_2_rounded,
      children: [
        for (final g in groups)
          InkWell(
            onTap: onOpenGroup == null ? null : () => onOpenGroup!(g.id, g.name),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                children: [
                  const Icon(Icons.groups_2_outlined,
                      size: 18, color: AppColors.primaryPrime),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          g.designation.isNotEmpty ? g.designation : g.name,
                          style: AppFonts.body(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (g.designation.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            g.name,
                            style: AppFonts.body(
                              fontSize: 13,
                              color: AppColors.textSecondary,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (onOpenGroup != null)
                    const Icon(Icons.chevron_right_rounded,
                        size: 18, color: AppColors.textMuted),
                ],
              ),
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
    final body = Container(
      width: double.infinity, // full width so the stacked label/value stay left
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
              label,
              style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                color: AppColors.textSecondary,
              ),
            ),
          const SizedBox(height: 4),
          Text(
              value,
              style: AppFonts.body(
                fontSize: 16,
                fontWeight: FontWeight.w500,
                color: tappable && onTap != null
                    ? AppColors.primaryPrime
                    : AppColors.textPrimary,
              ),
            ),
        ],
      ),
    );
    return tappable && onTap != null ? InkWell(onTap: onTap, child: body) : body;
  }
}
