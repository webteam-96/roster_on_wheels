import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../../data/models/member_model.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/full_screen_image_view.dart';
import '../../widgets/common/loading_widget.dart';
import 'profile_edit_screen.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _api = ApiClient();
  MemberModel? _member;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final memberId = context.read<AuthProvider>().memberId;
    setState(() { _loading = true; _error = null; });
    try {
      final res = await _api.get<Map<String, dynamic>>(
        '/api/members/$memberId',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (res.data != null) {
        setState(() { _member = MemberModel.fromJson(res.data!); _loading = false; });
      }
    } on ApiException catch (e) {
      setState(() { _error = e.message; _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: _loading
          ? const FullScreenLoader(message: 'Loading profile...')
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _load)
              : _member == null
                  ? const EmptyStateWidget(title: 'Profile Not Found', icon: Icons.person_off_rounded)
                  : CustomScrollView(
                      physics: const BouncingScrollPhysics(),
                      slivers: [
                        _ProfileAppBar(member: _member!),
                        SliverPadding(
                          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.xl).add(const EdgeInsets.only(bottom: 88)),
                          sliver: SliverList(
                            delegate: SliverChildListDelegate([
                              if ((_member!.memberIntroduction ?? '').isNotEmpty) ...[
                                _InfoCard(
                                  title: 'Introduction',
                                  icon: Icons.format_quote_rounded,
                                  children: [_IntroBlock(_member!.memberIntroduction!)],
                                ),
                                const SizedBox(height: AppSpacing.lg),
                              ],

                              _InfoCard(
                                title: 'Personal Details',
                                icon: Icons.person_rounded,
                                children: [
                                  _InfoRow('Full name', _member!.memberName),
                                  if (_member!.emailId?.isNotEmpty == true)
                                    _InfoRow('Email address', _member!.emailId!),
                                  if (_member!.primaryMobileNumber?.isNotEmpty == true)
                                    _InfoRow('Primary mobile',
                                        '${_member!.primaryCountryPhoneCode ?? ''} ${_member!.primaryMobileNumber!}'.trim()),
                                  if (_member!.secondaryMobileNumber?.isNotEmpty == true)
                                    _InfoRow('Secondary mobile',
                                        '${_member!.secondaryCountryPhoneCode ?? ''} ${_member!.secondaryMobileNumber!}'.trim()),
                                  if (_member!.birthDate?.isNotEmpty == true)
                                    _InfoRow('Date of birth', _formatDate(_member!.birthDate!)),
                                  if (_member!.anniversaryDate?.isNotEmpty == true)
                                    _InfoRow('Anniversary', _formatDate(_member!.anniversaryDate!)),
                                  if (_member!.bloodGroup?.isNotEmpty == true)
                                    _InfoRow('Blood group', _member!.bloodGroup!),
                                  if (_member!.rotaryId?.isNotEmpty == true)
                                    _InfoRow('Rotary ID', _member!.rotaryId!),
                                  if (_member!.donorRecognition?.isNotEmpty == true)
                                    _InfoRow('Donor recognition', _member!.donorRecognition!),
                                  if (_member!.isHonoraryMember || _member!.isYouth)
                                    _InfoRow(
                                      'STATUS',
                                      [
                                        if (_member!.isHonoraryMember) 'Honorary',
                                        if (_member!.isYouth) 'Youth',
                                      ].join(' · '),
                                    ),
                                ],
                              ),
                              const SizedBox(height: AppSpacing.lg),

                              ..._buildBusinessCard(_member!),

                              ..._buildAddressCards(_member!),

                              if (_member!.facebook != null ||
                                  _member!.instagram != null ||
                                  _member!.linkedIn != null ||
                                  _member!.twitter != null ||
                                  _member!.youtube != null ||
                                  _member!.website != null) ...[
                                _InfoCard(
                                  title: 'Social Presence',
                                  icon: Icons.public_rounded,
                                  children: [
                                    if (_member!.facebook?.isNotEmpty == true)
                                      _InfoRow('Facebook', _member!.facebook!),
                                    if (_member!.instagram?.isNotEmpty == true)
                                      _InfoRow('Instagram', _member!.instagram!),
                                    if (_member!.linkedIn?.isNotEmpty == true)
                                      _InfoRow('Linkedin', _member!.linkedIn!),
                                    if (_member!.twitter?.isNotEmpty == true)
                                      _InfoRow('Twitter / X', _member!.twitter!),
                                    if (_member!.youtube?.isNotEmpty == true)
                                      _InfoRow('Youtube', _member!.youtube!),
                                    if (_member!.website?.isNotEmpty == true)
                                      _InfoRow('Website', _member!.website!),
                                  ],
                                ),
                                const SizedBox(height: AppSpacing.lg),
                              ],

                              if (_member!.familyMembers.isNotEmpty) ...[
                                _InfoCard(
                                  title: 'Family Members',
                                  icon: Icons.family_restroom_rounded,
                                  children: _member!.familyMembers
                                      .map((f) => _FamilyRow(f))
                                      .toList(),
                                ),
                                const SizedBox(height: AppSpacing.lg),
                              ],

                              const SizedBox(height: 100),
                            ]),
                          ),
                        ),
                      ],
                    ),
      floatingActionButton: _member != null
          ? FloatingActionButton.extended(
              onPressed: () async {
                final updated = await Navigator.of(context).push<bool>(
                  MaterialPageRoute(
                    builder: (_) => const ProfileEditScreen(),
                  ),
                );
                if (!mounted) return;
                if (updated == true) await _load();
              },
              backgroundColor: AppColors.primaryPrime,
              foregroundColor: AppColors.white,
              icon: const Icon(Icons.edit_rounded),
              label: const Text('Edit My Profile'),
              shape: const StadiumBorder(),
            )
          : null,
    );
  }

  // Used only for DATE OF BIRTH / ANNIVERSARY, which are day-month only (the
  // year is a 1900 placeholder system-wide) — render without the year.
  String _formatDate(String raw) {
    try {
      final dt = DateTime.parse(raw);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return '${dt.day} ${months[dt.month - 1]}';
    } catch (_) {
      return raw;
    }
  }

  // Business address can carry profession-related fields. If any of those are
  // present we surface them in their own card. Pure address parts are
  // surfaced in `_buildAddressCards` below.
  List<Widget> _buildBusinessCard(MemberModel m) {
    final business = m.addresses.firstWhere(
      (a) => a.addressType.toLowerCase() == 'business',
      orElse: () => const MemberAddressModel(addressType: 'Business'),
    );
    // Designation/Classification are member-level (club_members) and now arrive
    // top-level on the member payload, NOT nested in the Business address
    // (Step 11B, 2026-06-18) — read them from the model.
    final designation = m.designation ?? business.designation;
    final classification =
        m.classificationProfession ?? business.classificationProfession;
    final hasBiz = [
      business.businessName,
      business.businessEmailId,
      designation,
      classification,
      business.keywords,
      business.phoneNumber,
    ].any((s) => (s ?? '').isNotEmpty);
    if (!hasBiz) return const [];
    return [
      _InfoCard(
        title: 'Business',
        icon: Icons.work_rounded,
        children: [
          if ((business.businessName ?? '').isNotEmpty)
            _InfoRow('Business name', business.businessName!),
          if ((designation ?? '').isNotEmpty)
            _InfoRow('Designation', designation!),
          if ((classification ?? '').isNotEmpty)
            _InfoRow('Classification', classification!),
          if ((business.keywords ?? '').isNotEmpty)
            _InfoRow('Keywords', business.keywords!),
          if ((business.businessEmailId ?? '').isNotEmpty)
            _InfoRow('Business email', business.businessEmailId!),
          if ((business.phoneNumber ?? '').isNotEmpty)
            _InfoRow('Phone', business.phoneNumber!),
        ],
      ),
      const SizedBox(height: AppSpacing.lg),
    ];
  }

  List<Widget> _buildAddressCards(MemberModel m) {
    final out = <Widget>[];
    for (final a in m.addresses) {
      final line = [a.address, a.city, a.state, a.country, a.pinCode]
          .where((s) => (s ?? '').isNotEmpty)
          .join(', ');
      if (line.isEmpty && (a.phoneNumber ?? '').isEmpty) continue;
      out.add(_InfoCard(
        title: '${a.addressType} Address',
        icon: a.addressType.toLowerCase() == 'business'
            ? Icons.business_center_rounded
            : Icons.home_rounded,
        children: [
          if (line.isNotEmpty) _InfoRow('Address', line),
          if ((a.phoneNumber ?? '').isNotEmpty)
            _InfoRow('Phone', a.phoneNumber!),
        ],
      ));
      out.add(const SizedBox(height: AppSpacing.lg));
    }
    return out;
  }
}

class _IntroBlock extends StatelessWidget {
  final String text;
  const _IntroBlock(this.text);
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: 16),
      child: Text(
        text,
        style: AppFonts.body(
          fontSize: 14,
          fontWeight: FontWeight.w500,
          color: AppColors.textPrimary,
          height: 1.5,
        ),
      ),
    );
  }
}

// ─── Sliver AppBar ────────────────────────────────────────────────────────────
class _ProfileAppBar extends StatelessWidget {
  final MemberModel member;
  const _ProfileAppBar({required this.member});

  @override
  Widget build(BuildContext context) {
    final initialsText = _getInitials(member.memberName);

    return SliverAppBar(
      expandedHeight: 280,
      pinned: true,
      stretch: true,
      backgroundColor: AppColors.primaryPrime,
      leading: IconButton(
        icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white),
        onPressed: () => context.pop(),
      ),
      flexibleSpace: FlexibleSpaceBar(
        stretchModes: const [StretchMode.zoomBackground, StretchMode.blurBackground],
        background: Stack(
          fit: StackFit.expand,
          children: [
            Container(
              decoration: const BoxDecoration(
                color: AppColors.primaryPrime,
              ),
            ),
            // Decorative shapes
            Positioned(
              top: -50,
              right: -50,
              child: Container(
                width: 200,
                height: 200,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white.withOpacity(0.05),
                ),
              ),
            ),
            Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const SizedBox(height: 60),
                // Avatar
                Builder(builder: (ctx) {
                  final hasPhoto = member.profilePhotoPath?.isNotEmpty == true;
                  final fullPhotoUrl = hasPhoto
                      ? (member.profilePhotoPath!.startsWith('http')
                          ? member.profilePhotoPath!
                          : '${ApiConstants.mediaBaseUrl}${member.profilePhotoPath!}')
                      : '';
                  final heroTag = 'own_member_photo_${member.id}';
                  final avatar = Container(
                    width: 110,
                    height: 110,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white.withOpacity(0.5), width: 4),

                    ),
                    child: ClipOval(
                      child: hasPhoto
                          ? CachedNetworkImage(
                              imageUrl: fullPhotoUrl,
                              fit: BoxFit.cover,
                              placeholder: (_, __) => _initialsWidget(initialsText),
                              errorWidget: (_, __, ___) => _initialsWidget(initialsText),
                            )
                          : _initialsWidget(initialsText),
                    ),
                  );
                  if (!hasPhoto) return avatar;
                  return GestureDetector(
                    onTap: () => FullScreenImageView.open(
                      ctx,
                      imageUrl: fullPhotoUrl,
                      heroTag: heroTag,
                      title: member.memberName,
                    ),
                    child: Hero(tag: heroTag, child: avatar),
                  );
                }),
                const SizedBox(height: 16),
                Text(
                  member.memberName,
                  style: AppFonts.display(
                    color: AppColors.lightBg,
                    fontSize: 24,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                if (member.rotaryId?.isNotEmpty == true)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.goldPrime,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      'Rotary ID: ${member.rotaryId}',
                      style: AppFonts.body(
                        color: AppColors.darkBg,
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
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

  Widget _initialsWidget(String text) {
    return Container(
      color: AppColors.white.withOpacity(0.2),
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

// ─── Info Card ────────────────────────────────────────────────────────────────
class _InfoCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final List<Widget> children;
  const _InfoCard({required this.title, required this.icon, required this.children});

  @override
  Widget build(BuildContext context) {
    if (children.isEmpty) return const SizedBox.shrink();
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
            border: Border.all(color: AppColors.line, width: 1),

          ),
          child: Column(
            children: children,
          ),
        ),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  const _InfoRow(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity, // full width so the stacked label/value stay left
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 16),
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
                color: AppColors.textPrimary,
              ),
            ),
        ],
      ),
    );
  }
}

class _FamilyRow extends StatelessWidget {
  final FamilyMemberModel member;
  const _FamilyRow(this.member);

  String _fmtDate(String? raw) {
    if (raw == null || raw.isEmpty) return '';
    try {
      final dt = DateTime.parse(raw);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return '${dt.day} ${months[dt.month - 1]}';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final dob = _fmtDate(member.birthDate);
    final anniv = _fmtDate(member.anniversaryDate);
    final secondaryBits = <String>[
      if ((member.bloodGroup ?? '').isNotEmpty) member.bloodGroup!,
      if (dob.isNotEmpty) 'DOB $dob',
      if (anniv.isNotEmpty) 'Anniv $anniv',
    ];
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.primaryPrime.withOpacity(0.05),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.person_rounded, size: 20, color: AppColors.primaryPrime),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        member.name,
                        style: AppFonts.body(
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ),
                    if ((member.relation).isNotEmpty)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.primaryPrime.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          member.relation,
                          style: AppFonts.body(
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                            color: AppColors.primaryPrime,
                          ),
                        ),
                      ),
                  ],
                ),
                if (secondaryBits.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    secondaryBits.join(' · '),
                    style: AppFonts.body(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textMuted,
                    ),
                  ),
                ],
                if ((member.contact ?? '').isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Row(children: [
                    const Icon(Icons.phone, size: 12, color: AppColors.primaryPrime),
                    const SizedBox(width: 4),
                    Text(
                      member.contact!,
                      style: AppFonts.body(
                        color: AppColors.primaryPrime,
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      ),
                    ),
                  ]),
                ],
                if ((member.email ?? '').isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Row(children: [
                    const Icon(Icons.mail_outline, size: 12, color: AppColors.textSecondary),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        member.email!,
                        style: AppFonts.body(
                          color: AppColors.textSecondary,
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ]),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
