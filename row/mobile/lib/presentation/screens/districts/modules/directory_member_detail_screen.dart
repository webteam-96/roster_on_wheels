import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/constants/api_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/utils/maps_utils.dart';
import '../../../../core/routing/route_names.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_gradients.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../../data/models/rotarian_model.dart';
import '../../../../data/models/member_model.dart';
import '../../../providers/auth_provider.dart';
import '../../../widgets/common/aspect_ratio_network_image.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/maps_action_button.dart';
import '../../../widgets/common/full_screen_image_view.dart';
import '../../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Member detail screen for the District Admin → Master Modules → Directory
/// flow. Mirrors the visual language of `profile_screen.dart` — gradient
/// SliverAppBar hero plus stacked InfoCard sections.
///
/// Visibility flags are honored:
/// - `isPersonalDetailsVisible == false` → hide phone/email/birthday/anniversary
///   fields and the contact action row, show a private notice card.
/// - `isFamilyDetailsVisible == false` → hide the family photo, show notice.
class DirectoryMemberDetailScreen extends StatefulWidget {
  final int memberId;

  /// True only when opened from the **Directory** members list (the club-admin
  /// directory). The "Edit Member" button is offered ONLY on that path — the
  /// same detail page is also reached from the District / Club member lists and
  /// other places, where editing must not be offered.
  final bool fromDirectory;

  /// The club whose Directory this member was opened from. A member can belong
  /// to several clubs (the `find-rotarian` response returns them all); when set,
  /// the "Club" card shows THIS club instead of defaulting to the first in the
  /// array. Null (e.g. from the District members list) → falls back to first.
  final int? clubId;

  /// Like [clubId] but matched by club NAME — used by the **district** directory,
  /// whose members endpoint returns no clubId (the row's club name is the club
  /// within that district). Used only when [clubId] is null.
  final String? clubName;

  /// The member's current Club-Admin status for [clubId], threaded from the
  /// club Directory list (the only caller that knows it). Drives the app-bar
  /// "Make Admin" / "Remove Admin" button label. Null when opened from anywhere
  /// that doesn't manage admins (district directory, deep links) → button hidden.
  final bool? initialHasAdminRole;

  const DirectoryMemberDetailScreen({
    super.key,
    required this.memberId,
    this.fromDirectory = false,
    this.clubId,
    this.clubName,
    this.initialHasAdminRole,
  });

  @override
  State<DirectoryMemberDetailScreen> createState() =>
      _DirectoryMemberDetailScreenState();
}

class _DirectoryMemberDetailScreenState
    extends State<DirectoryMemberDetailScreen> {
  final _api = ApiClient();
  RotarianDetail? _detail;
  bool _loading = true;
  String? _error;

  // Family members are NOT part of the find-rotarian payload. When the viewer
  // is a CLUB ADMIN of this member's club, we pull the full member record from
  // `/api/members/{id}` purely to read the `familyMembers` list. Plain club
  // members never load it. `_familyVisible` mirrors the member's privacy flag.
  // The fetch is best-effort: any error leaves the section hidden.
  List<FamilyMemberModel> _family = const [];
  bool _familyVisible = true;

  // Edit button is hidden for now. Flip to `true` to re-enable it (the gate
  // below still scopes it to the Club Admin of this member's club).
  static const bool _showEditButton = true;

  // Member's current Club-Admin status for [widget.clubId]. Seeded from the
  // route (threaded by the club Directory list) and kept in sync after a
  // promote/demote so the app-bar button flips label without a reload. Also
  // tracks whether a toggle is in flight (disables the button).
  bool? _hasAdminRole;
  bool _togglingAdmin = false;

  @override
  void initState() {
    super.initState();
    _hasAdminRole = widget.initialHasAdminRole;
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
        final detail = RotarianDetail.fromJson(resp.data!);
        setState(() {
          _detail = detail;
          _loading = false;
        });
        _maybeLoadFamily(detail);
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

  /// Open the full member edit form. Editing someone else's record applies the
  /// backend's directory-member field lock (see member_form_screen's
  /// `_lockedForOther`); reload on return so any changes show immediately.
  Future<void> _openEdit() async {
    await context.push(RouteNames.memberEdit(widget.memberId, clubId: widget.clubId));
    if (mounted) _load();
  }

  /// Promote/demote this member as a Club Admin of [widget.clubId]. Mirrors the
  /// club Directory list's toggle (Club Admin role id = 2, club-scoped):
  ///   Promote → POST /api/admin/assign-role
  ///   Demote  → POST /api/admin/remove-role
  ///   body: { memberId, roleId: 2, clubId }
  /// A confirmation dialog guards the action, and the button reflects the new
  /// state on success (no reload needed).
  Future<void> _toggleAdmin() async {
    final clubId = widget.clubId;
    if (clubId == null || _togglingAdmin) return;
    final makeAdmin = _hasAdminRole != true;

    final who = _detail?.member.memberName.trim();
    final whoLabel = (who == null || who.isEmpty) ? 'this member' : who;
    final auth = context.read<AuthProvider>();
    final clubName = auth.clubNameOf(clubId);
    final ofClub =
        (clubName != null && clubName.isNotEmpty) ? ' of $clubName' : '';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(makeAdmin ? 'Make Admin' : 'Remove Admin'),
        content: Text(makeAdmin
            ? 'Make $whoLabel an Admin$ofClub?'
            : 'Remove $whoLabel as an Admin$ofClub?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(
              makeAdmin ? 'Make Admin' : 'Remove',
              style: TextStyle(
                  color: makeAdmin ? AppColors.primary : AppColors.error),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _togglingAdmin = true);
    try {
      await _api.post(
        makeAdmin
            ? ApiConstants.adminAssignRole
            : ApiConstants.adminRemoveRole,
        body: {'memberId': widget.memberId, 'roleId': 2, 'clubId': clubId},
      );
      if (!mounted) return;
      setState(() {
        _hasAdminRole = makeAdmin;
        _togglingAdmin = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              makeAdmin ? 'Promoted to Club Admin' : 'Removed Club Admin role'),
          backgroundColor: AppColors.success,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _togglingAdmin = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed: $e'), backgroundColor: AppColors.error),
      );
    }
  }

  /// Pull family members from `/api/members/{id}` — gated by `_canSeeFamily`
  /// (CLUB directory + COG directory: any viewer; DISTRICT directory: never
  /// shown). Best-effort: any error (e.g. the endpoint being blocked) leaves the
  /// family section hidden.
  Future<void> _maybeLoadFamily(RotarianDetail detail) async {
    if (!mounted) return;
    if (!_canSeeFamily(detail)) return;
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/members/${widget.memberId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      if (resp.isSuccess && resp.data != null) {
        final mm = MemberModel.fromJson(resp.data!);
        setState(() {
          _family = mm.familyMembers;
          _familyVisible = mm.isFamilyDetailsVisible;
        });
      }
    } catch (_) {
      // Endpoint forbidden / member has no family → keep section hidden.
    }
  }

  /// CLUB directory: family is visible to EVERYONE (plain members too). COG
  /// directory: also everyone. DISTRICT directory: NEVER shown (to anyone). In
  /// all cases the member's own privacy flag still gates display in
  /// `showFamily`.
  bool _canSeeFamily(RotarianDetail d) {
    if (_isCogContext(d)) return true;
    // CLUB directory (clubId threaded): family is visible to everyone — plain
    // members too, not just admins. The target member's own
    // isFamilyDetailsVisible flag still controls display (see `showFamily`).
    if (widget.clubId != null) {
      return true;
    }
    // DISTRICT directory (clubName threaded, no clubId): family is NOT shown at
    // all — to anyone (admins included). Only the COG bypass above can override.
    return false;
  }

  /// True when the directory being viewed is the COG club. Mirrors the build's
  /// `isCog` detection: the club matched to the directory we came from (by
  /// clubId, else by clubName) is named "COG".
  bool _isCogContext(RotarianDetail d) {
    final wantId = widget.clubId;
    final wantName = (widget.clubName ?? '').trim().toLowerCase();
    // Only a POSITIVE match counts: the club we actually navigated from (by the
    // threaded clubId for a club directory, or clubName for a district one).
    // NEVER fall back to clubs.first — that would mis-fire for any member who
    // also belongs to COG (their first club), leaking family to plain members
    // browsing a NORMAL club's directory.
    RotarianClub? match;
    for (final c in d.clubs) {
      final byId = wantId != null && c.clubId == wantId;
      final byName = wantId == null &&
          wantName.isNotEmpty &&
          c.clubName.trim().toLowerCase() == wantName;
      if (byId || byName) {
        match = c;
        break;
      }
    }
    // No club row matched: it's COG only if the directory we came from is itself
    // literally named "cog" (district COG path threads clubName). Otherwise no.
    if (match == null) return wantName == 'cog';
    return match.clubName.trim().toLowerCase() == 'cog';
  }

  // Family group photo banner — full-width; height follows the image's own
  // aspect ratio (no crop), rounded only at the bottom so it sits flush at the
  // end of the merged "Family Members" card.
  Widget _familyPhotoBanner(String path) {
    final url = ApiConstants.mediaUrl(path);
    if (url.isEmpty) return const SizedBox.shrink();
    return AspectRatioNetworkImage(
      url: url,
      borderRadius: const BorderRadius.vertical(bottom: Radius.circular(20)),
    );
  }

  // Family member's profile photo (circular). Falls back to a person icon when
  // the member has no photo or the image fails to load.
  Widget _familyAvatar(FamilyMemberModel f) {
    final url = ApiConstants.mediaUrl(f.photoPath ?? '');
    Widget placeholder() => Container(
          width: 40,
          height: 40,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.primaryPrime.withValues(alpha: 0.06),
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.person_rounded,
              size: 20, color: AppColors.primaryPrime),
        );
    if ((f.photoPath ?? '').trim().isEmpty || url.isEmpty) return placeholder();
    return ClipOval(
      child: CachedNetworkImage(
        imageUrl: url,
        width: 40,
        height: 40,
        fit: BoxFit.cover,
        placeholder: (_, __) => placeholder(),
        errorWidget: (_, __, ___) => placeholder(),
      ),
    );
  }

  /// One family member rendered inside the "Family Members" _InfoCard — profile
  /// photo, name + relation badge, tappable email and birthday (day-month, e.g.
  /// "13 June"). Phone/mobile is intentionally NOT shown.
  Widget _familyRow(FamilyMemberModel f) {
    final email = (f.email ?? '').trim();
    final birthDt = DateTime.tryParse((f.birthDate ?? '').trim());
    final birthday = birthDt != null ? DateFormat('d MMMM').format(birthDt) : '';
    final anniDt = DateTime.tryParse((f.anniversaryDate ?? '').trim());
    final anniversary = anniDt != null ? DateFormat('d MMMM').format(anniDt) : '';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _familyAvatar(f),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        f.name.isEmpty ? 'Family member' : f.name,
                        style: AppFonts.body(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ),
                    if (f.relation.isNotEmpty)
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.primaryPrime.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          f.relation.toUpperCase(),
                          style: AppFonts.body(
                            fontSize: 9,
                            fontWeight: FontWeight.w800,
                            color: AppColors.primaryPrime,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ),
                  ],
                ),
                if (email.isNotEmpty) ...[
                  const SizedBox(height: 5),
                  GestureDetector(
                    onTap: () => _openUrl('mailto:$email'),
                    child: Row(children: [
                      const Icon(Icons.mail_outline,
                          size: 12, color: AppColors.primaryPrime),
                      const SizedBox(width: 5),
                      Expanded(
                        child: Text(
                          email,
                          style: AppFonts.body(
                            color: AppColors.primaryPrime,
                            fontWeight: FontWeight.w700,
                            fontSize: 12,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ]),
                  ),
                ],
                if (birthday.isNotEmpty) ...[
                  const SizedBox(height: 5),
                  Row(children: [
                    const Icon(Icons.cake_outlined,
                        size: 15, color: AppColors.textSecondary),
                    const SizedBox(width: 6),
                    Text(
                      'Birthday: ',
                      style: AppFonts.body(
                        color: AppColors.textMuted,
                        fontWeight: FontWeight.w500,
                        fontSize: 12,
                      ),
                    ),
                    Text(
                      birthday,
                      style: AppFonts.body(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w700,
                        fontSize: 12,
                      ),
                    ),
                  ]),
                ],
                if (anniversary.isNotEmpty) ...[
                  const SizedBox(height: 5),
                  Row(children: [
                    const Icon(Icons.favorite_border_rounded,
                        size: 15, color: AppColors.textSecondary),
                    const SizedBox(width: 6),
                    Text(
                      'Anniversary: ',
                      style: AppFonts.body(
                        color: AppColors.textMuted,
                        fontWeight: FontWeight.w500,
                        fontSize: 12,
                      ),
                    ),
                    Text(
                      anniversary,
                      style: AppFonts.body(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w700,
                        fontSize: 12,
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

  @override
  Widget build(BuildContext context) {
    // Edit Member shows ONLY when ALL hold:
    //   1. this detail page was opened from the Directory members list
    //      ([widget.fromDirectory]) — NOT from the District members list, the
    //      Club members list, or anywhere else the same page is reached.
    //   2. we know WHICH club's directory this is ([widget.clubId] is threaded
    //      by both club-directory entry points; the district directory threads
    //      clubName only, so it stays edit-less — correct).
    //   3. the user is the club admin of THAT SAME club.
    // CRUCIAL: gate on the DIRECTORY's club ([widget.clubId]), NOT on the viewed
    // member's clubs. The old `d.clubs.any((c) => isClubAdminOf(c.clubId))`
    // leaked Edit to a club admin of ANY club the member ALSO belonged to — so a
    // plain member of "Lake Shore" who is admin of "Thane City View" could edit
    // a Lake Shore member who happened to also be in Thane City View. Scoping to
    // widget.clubId fixes that (mirrors the family-card fix in _canSeeFamily).
    final auth = context.watch<AuthProvider>();
    final d = _detail;
    final canEdit = _showEditButton &&
        widget.fromDirectory &&
        d != null &&
        widget.clubId != null &&
        auth.isClubAdminOf(widget.clubId!);
    final showEdit = canEdit && !_loading && _error == null;
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: _buildBody(),
      floatingActionButton: showEdit
          ? FloatingActionButton.extended(
              onPressed: _openEdit,
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.edit_outlined),
              label: Text(
                'Edit Member',
                style: AppFonts.body(fontWeight: FontWeight.w700),
              ),
            )
          : null,
    );
  }

  Widget _buildBody() {
    if (_loading) return const LoadingWidget();
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: _load);
    }
    final d = _detail;
    if (d == null) {
      return const EmptyStateWidget(
        title: 'Member not found',
        icon: Icons.error_outline_rounded,
      );
    }

    final m = d.member;
    // Show the club whose Directory we came from, not just the first in the
    // member's multi-club array. Match by clubId (club directory) first, then
    // by club name (district directory — its members endpoint has no clubId).
    // Falls back to the first club when nothing was specified (or no match).
    final wantName = (widget.clubName ?? '').trim().toLowerCase();
    final primaryClub = d.clubs.isEmpty
        ? null
        : d.clubs.firstWhere(
            (c) =>
                (widget.clubId != null && c.clubId == widget.clubId) ||
                (widget.clubId == null &&
                    wantName.isNotEmpty &&
                    c.clubName.trim().toLowerCase() == wantName),
            orElse: () => d.clubs.first,
          );
    // COG members are a special case: the directory is the "COG" club itself, so
    // showing "COG" under the name is meaningless. For COG we surface the
    // member's per-club DESIGNATION under the name (in the hero) and move the
    // Designation row from Business → Personal Details. Detected purely by the
    // club name being "COG".
    final isCog =
        (primaryClub?.clubName ?? widget.clubName ?? '').trim().toLowerCase() ==
            'cog';
    final business = d.addresses.firstWhere(
      (a) => (a.addressType ?? '').toLowerCase() == 'business',
      orElse: () => const RotarianAddress(),
    );
    final residential = d.addresses.firstWhere(
      (a) => (a.addressType ?? '').toLowerCase() == 'residential',
      orElse: () => const RotarianAddress(),
    );

    // Family is one merged "Family Members" section (per-member rows + group
    // photo). Visible to ANY viewer in the CLUB and COG directories; ADMIN-ONLY
    // in the DISTRICT directory (see `_canSeeFamily`). Still gated by the
    // member's own privacy flag (`_familyVisible`).
    final hasFamilyPhoto =
        m.isFamilyDetailsVisible && (m.familyPhoto ?? '').isNotEmpty;
    final showFamily = _canSeeFamily(d) &&
        _familyVisible &&
        (_family.isNotEmpty || hasFamilyPhoto);

    // "Make Admin" / "Remove Admin" app-bar button. Same gate as the Edit FAB
    // (opened from the club Directory + we know the club + viewer admins it),
    // plus the member's current admin status must be known (threaded from the
    // list as [widget.initialHasAdminRole]). This replaces the old inline shield
    // icon on every directory row, which was easy to mis-tap.
    final canManageAdmin = widget.fromDirectory &&
        widget.clubId != null &&
        _hasAdminRole != null &&
        context.read<AuthProvider>().isClubAdminOf(widget.clubId!);
    final isAdminNow = _hasAdminRole == true;

    return CustomScrollView(
      physics: const BouncingScrollPhysics(),
      slivers: [
        _ProfileHeroAppBar(
          member: m,
          club: primaryClub,
          actions: canManageAdmin
              ? [
                  // A narrow 3-dot overflow menu (not a wide text button) so it
                  // never collides with the centered member name once the hero
                  // collapses. Single item, label reflects current status.
                  _togglingAdmin
                      ? const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 18),
                          child: Center(
                            child: SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white),
                            ),
                          ),
                        )
                      : PopupMenuButton<String>(
                          icon: const Icon(Icons.more_vert, color: Colors.white),
                          tooltip: 'Admin options',
                          onSelected: (v) {
                            if (v == 'toggleAdmin') _toggleAdmin();
                          },
                          itemBuilder: (_) => [
                            PopupMenuItem(
                              value: 'toggleAdmin',
                              child: Row(
                                children: [
                                  Icon(
                                      isAdminNow
                                          ? Icons.remove_moderator_outlined
                                          : Icons.add_moderator_outlined,
                                      size: 20,
                                      color: isAdminNow
                                          ? AppColors.error
                                          : AppColors.primary),
                                  const SizedBox(width: 12),
                                  Text(isAdminNow
                                      ? 'Remove Club Admin'
                                      : 'Make Club Admin'),
                                ],
                              ),
                            ),
                          ],
                        ),
                ]
              : const [],
        ),
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
          sliver: SliverList(
            delegate: SliverChildListDelegate([
              if (m.isPersonalDetailsVisible) ...[
                _buildContactCard(m),
                const SizedBox(height: 16),
              ],

              if ((m.memberIntroduction ?? '').isNotEmpty) ...[
                _IntroductionCard(text: m.memberIntroduction!),
                const SizedBox(height: 16),
              ],

              _InfoCard(
                title: 'Personal Details',
                icon: Icons.person_rounded,
                children: [
                  _InfoRow('FULL NAME', m.memberName),
                  if (m.isPersonalDetailsVisible) ...[
                    if ((m.email ?? '').isNotEmpty)
                      _InfoRow('EMAIL', m.email!,
                          tappable: true,
                          onTap: () => _openUrl('mailto:${m.email}')),
                    if ((m.primaryMobile ?? '').isNotEmpty)
                      _InfoRow(
                        'PRIMARY MOBILE',
                        _formatPhone(m.primaryPhoneCode, m.primaryMobile),
                        tappable: true,
                        onTap: () =>
                            _openUrl('tel:${_digits(m.primaryMobile!)}'),
                      ),
                    if ((m.secondaryMobile ?? '').isNotEmpty)
                      _InfoRow(
                        'SECONDARY MOBILE',
                        _formatPhone(m.secondaryPhoneCode, m.secondaryMobile),
                        tappable: true,
                        onTap: () =>
                            _openUrl('tel:${_digits(m.secondaryMobile!)}'),
                      ),
                  ],
                  // Gender + Language hidden on other members' detail pages
                  // (shown only on the user's own profile). Birthday/Anniversary
                  // are day-month only (year hidden).
                  if (m.isPersonalDetailsVisible &&
                      m.birthDate != null)
                    _InfoRow('BIRTHDAY', _formatDayMonth(m.birthDate!)),
                  if (m.isPersonalDetailsVisible &&
                      m.anniversaryDate != null)
                    _InfoRow('ANNIVERSARY', _formatDayMonth(m.anniversaryDate!)),
                  // COG only: designation lives here (Personal Details) instead
                  // of the Business card — below Anniversary, above Rotary ID.
                  if (isCog && (primaryClub?.designation ?? '').isNotEmpty)
                    _InfoRow('DESIGNATION', primaryClub!.designation!),
                  if ((m.bloodGroup ?? '').isNotEmpty)
                    _InfoRow('BLOOD GROUP', m.bloodGroup!),
                  if ((m.rotaryId ?? '').isNotEmpty)
                    _InfoRow('ROTARY ID', m.rotaryId!),
                  // Joining date is PER-CLUB (RotarianClub.joinedDate) — shows
                  // the date this member joined the club this page is scoped to.
                  // Ungated like Rotary ID; full date incl. year.
                  if (primaryClub?.joinedDate != null)
                    _InfoRow(
                        'JOINING DATE', _formatFullDate(primaryClub!.joinedDate!)),
                  if ((m.donorRecognition ?? '').isNotEmpty)
                    _InfoRow('DONOR RECOGNITION', m.donorRecognition!),
                ],
              ),
              const SizedBox(height: 16),

              // The "Club" info card is intentionally omitted here: this detail
              // page is only reached from the Directory modules, where the
              // member's club is already the context you navigated in from, so
              // repeating it as a card is redundant. (The profile hero still
              // shows the club banner.)

              // Designation/Classification are per-club (backend moved them off
              // the address onto the club row 2026-06-22) → read from primaryClub.
              if (_hasBusinessInfo(business, primaryClub, !isCog)) ...[
                _InfoCard(
                  title: 'Business',
                  icon: Icons.work_rounded,
                  children: [
                    // COG shows designation in Personal Details, not here.
                    if (!isCog && (primaryClub?.designation ?? '').isNotEmpty)
                      _InfoRow('DESIGNATION', primaryClub!.designation!),
                    if ((primaryClub?.classification ?? '').isNotEmpty)
                      _InfoRow('CLASSIFICATION', primaryClub!.classification!),
                    if ((business.businessName ?? '').isNotEmpty)
                      _InfoRow('BUSINESS NAME', business.businessName!),
                    if ((business.keywords ?? '').isNotEmpty)
                      _InfoRow('KEYWORDS', business.keywords!),
                    if ((business.businessEmail ?? '').isNotEmpty)
                      _InfoRow('BUSINESS EMAIL', business.businessEmail!,
                          tappable: true,
                          onTap: () =>
                              _openUrl('mailto:${business.businessEmail}')),
                    if ((business.phoneNumber ?? '').isNotEmpty)
                      _InfoRow('PHONE', business.phoneNumber!,
                          tappable: true,
                          onTap: () => _openUrl(
                              'tel:${_digits(business.phoneNumber!)}')),
                    if (_addressLine(business).isNotEmpty)
                      _InfoRow('ADDRESS', _addressLine(business),
                          tappable: true,
                          valueIcon: Icons.location_on_rounded,
                          onTap: () => _openMaps(_addressLine(business))),
                  ],
                ),
                const SizedBox(height: 16),
              ],

              if (_hasResidentialInfo(residential) &&
                  m.isPersonalDetailsVisible) ...[
                _InfoCard(
                  title: 'Residential Address',
                  icon: Icons.home_rounded,
                  children: [
                    if ((residential.phoneNumber ?? '').isNotEmpty)
                      _InfoRow('PHONE', residential.phoneNumber!,
                          tappable: true,
                          onTap: () => _openUrl(
                              'tel:${_digits(residential.phoneNumber!)}')),
                    if (_addressLine(residential).isNotEmpty)
                      _InfoRow('ADDRESS', _addressLine(residential),
                          tappable: true,
                          valueIcon: Icons.location_on_rounded,
                          onTap: () => _openMaps(_addressLine(residential))),
                  ],
                ),
                const SizedBox(height: 16),
              ],

              if (_hasSocialPresence(m)) ...[
                _InfoCard(
                  title: 'Social Presence',
                  icon: Icons.public_rounded,
                  children: [
                    if ((m.facebook ?? '').isNotEmpty)
                      _InfoRow('FACEBOOK', m.facebook!,
                          tappable: true,
                          linkStyle: true,
                          onTap: () => _openUrl(m.facebook!)),
                    if ((m.instagram ?? '').isNotEmpty)
                      _InfoRow('INSTAGRAM', m.instagram!,
                          tappable: true,
                          linkStyle: true,
                          onTap: () => _openUrl(m.instagram!)),
                    if ((m.linkedIn ?? '').isNotEmpty)
                      _InfoRow('LINKEDIN', m.linkedIn!,
                          tappable: true,
                          linkStyle: true,
                          onTap: () => _openUrl(m.linkedIn!)),
                    if ((m.twitter ?? '').isNotEmpty)
                      _InfoRow('TWITTER / X', m.twitter!,
                          tappable: true,
                          linkStyle: true,
                          onTap: () => _openUrl(m.twitter!)),
                    if ((m.youtube ?? '').isNotEmpty)
                      _InfoRow('YOUTUBE', m.youtube!,
                          tappable: true,
                          linkStyle: true,
                          onTap: () => _openUrl(m.youtube!)),
                    if ((m.website ?? '').isNotEmpty)
                      _InfoRow('WEBSITE', m.website!,
                          tappable: true,
                          linkStyle: true,
                          onTap: () => _openUrl(m.website!)),
                  ],
                ),
                const SizedBox(height: 16),
              ],

              // Family Members — ONE merged card (per-member rows followed by
              // the family group photo). Visible to a CLUB ADMIN of this
              // member's club, or to ANY viewer in the COG directory (see
              // _canSeeFamily). Member rows come from /api/members/{id} (see
              // _maybeLoadFamily); the photo comes from find-rotarian.
              if (showFamily) ...[
                _InfoCard(
                  title: 'Family',
                  icon: Icons.family_restroom_rounded,
                  children: [
                    ..._family.map(_familyRow),
                    if (hasFamilyPhoto) _familyPhotoBanner(m.familyPhoto!),
                  ],
                ),
                const SizedBox(height: 16),
              ],

              if (!m.isPersonalDetailsVisible) ...[
                const _PrivateNotice(
                  icon: Icons.lock_person_outlined,
                  title: 'Personal details are private',
                  subtitle:
                      'This member chose to hide their phone, email, and personal dates.',
                ),
                const SizedBox(height: 12),
              ],
              if (!m.isFamilyDetailsVisible) ...[
                const _PrivateNotice(
                  icon: Icons.shield_outlined,
                  title: 'Family details are private',
                  subtitle:
                      'This member chose to hide their family information.',
                ),
                const SizedBox(height: 12),
              ],

              const SizedBox(height: 80),
            ]),
          ),
        ),
      ],
    );
  }

  // ── Contact actions card ────────────────────────────────────────────────

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

  // ── Helpers ─────────────────────────────────────────────────────────────

  bool _hasBusinessInfo(RotarianAddress a,
      [RotarianClub? club, bool includeDesignation = true]) {
    return [
      if (includeDesignation) club?.designation,
      club?.classification,
      a.businessName,
      a.keywords,
      a.businessEmail,
      a.phoneNumber,
      a.address,
      a.city,
      a.state,
    ].any((s) => (s ?? '').isNotEmpty);
  }

  bool _hasResidentialInfo(RotarianAddress a) {
    return [a.address, a.city, a.state, a.country, a.pinCode, a.phoneNumber]
        .any((s) => (s ?? '').isNotEmpty);
  }

  bool _hasSocialPresence(RotarianProfile m) {
    return [m.facebook, m.instagram, m.linkedIn, m.twitter, m.youtube, m.website]
        .any((s) => (s ?? '').isNotEmpty);
  }

  String _addressLine(RotarianAddress a) {
    final parts = [a.address, a.city, a.state, a.country, a.pinCode]
        .where((p) => p != null && p.isNotEmpty)
        .toList();
    return parts.join(', ');
  }

  // Birthday/anniversary are day-month only (the year is a 1900 placeholder
  // system-wide), so render without the year to avoid showing "1900".
  String _formatDayMonth(DateTime dt) => DateFormat('d MMM').format(dt);

  // Joining date is a real date — show the full day-month-year.
  String _formatFullDate(DateTime dt) => DateFormat('d MMM yyyy').format(dt);

  String _formatPhone(String? code, String? number) {
    final n = (number ?? '').trim();
    if (n.isEmpty) return '';
    final c = (code ?? '').trim();
    return c.isEmpty ? n : '$c $n';
  }

  String _digits(String input,
      {bool includeCountry = false, String? fallback}) {
    final stripped = input.replaceAll(RegExp(r'[^0-9+]'), '');
    if (!includeCountry) return stripped;
    if (stripped.startsWith('+')) return stripped.substring(1);
    final code = (fallback ?? '').replaceAll(RegExp(r'[^0-9]'), '');
    return '$code$stripped';
  }

  Future<void> _openUrl(String raw) async {
    var url = raw.trim();
    if (url.isEmpty) return;
    // Social / website fields are usually stored WITHOUT a scheme
    // ("facebook.com/x", "www.site.com"); launchUrl can't open a schemeless
    // URI, so prepend https://. Anything that already has a scheme
    // (tel:, mailto:, https://, the Maps URL) is left untouched.
    if (!RegExp(r'^[a-zA-Z][a-zA-Z0-9+.\-]*:').hasMatch(url)) {
      url = 'https://$url';
    }
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {}
  }

  // Open the given address in Google Maps (Maps app if installed, else
  // browser). The address is normalized first so smushed/abbreviated
  // hand-typed addresses still resolve — see [googleMapsSearchUrl].
  Future<void> _openMaps(String address) async {
    final url = googleMapsSearchUrl(address);
    if (url == null) return;
    await _openUrl(url);
  }
}

// ─── Sliver hero ──────────────────────────────────────────────────────────
class _ProfileHeroAppBar extends StatelessWidget {
  final RotarianProfile member;
  final RotarianClub? club;
  final List<Widget> actions;
  const _ProfileHeroAppBar(
      {required this.member, this.club, this.actions = const []});

  // For COG members "COG" under the name is meaningless, so show the member's
  // per-club designation instead. Everyone else keeps the club name.
  String _heroSubtitle(RotarianClub c) {
    final isCog = c.clubName.trim().toLowerCase() == 'cog';
    return isCog ? (c.designation ?? '').trim() : c.clubName;
  }

  @override
  Widget build(BuildContext context) {
    final initialsText = _getInitials(member.memberName);
    final photoUrl = ApiConstants.mediaUrl(member.profilePhoto ?? '');

    return SliverAppBar(
      expandedHeight: 324,
      pinned: true,
      stretch: true,
      actions: actions,
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
                Builder(builder: (ctx) {
                  final heroTag = 'member_photo_${member.memberId}';
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
                              placeholder: (_, __) =>
                                  _initials(initialsText),
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
                      title: member.memberName,
                    ),
                    child: Hero(tag: heroTag, child: avatar),
                  );
                }),
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
                const SizedBox(height: 6),
                if (club != null && _heroSubtitle(club!).isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: Text(
                      _heroSubtitle(club!),
                      textAlign: TextAlign.center,
                      style: AppFonts.body(
                        color: Colors.white.withValues(alpha: 0.85),
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                const SizedBox(height: 8),
                if ((member.rotaryId ?? '').isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.goldPrime,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      'ROTARY ID: ${member.rotaryId}',
                      style: AppFonts.body(
                        color: AppColors.darkBg,
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
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

// ─── Reusable cards / rows ────────────────────────────────────────────────
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

  /// When true, the value renders as a bright-blue underlined web link.
  /// Used ONLY for the Social Presence rows.
  final bool linkStyle;
  const _InfoRow(
    this.label,
    this.value, {
    this.tappable = false,
    this.onTap,
    this.valueIcon,
    this.linkStyle = false,
  });

  @override
  Widget build(BuildContext context) {
    // Rows that open Google Maps (valueIcon set) keep normal text colour and
    // get a clear blue map button. Plain tappable rows (email/phone) stay
    // link-blue with no button.
    final showMapButton = tappable && onTap != null && valueIcon != null;
    final isLink = tappable && onTap != null && !showMapButton;
    // Social Presence rows (linkStyle) render as bright-blue underlined web
    // links. Other tappable rows (email/phone) keep the primary colour.
    final valueStyle = AppFonts.body(
      fontSize: 14,
      fontWeight: FontWeight.w700,
      color: linkStyle
          ? AppColors.info
          : (isLink ? AppColors.primaryPrime : AppColors.textPrimary),
      decoration: linkStyle ? TextDecoration.underline : null,
      decorationColor: linkStyle ? AppColors.info : null,
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

class _IntroductionCard extends StatefulWidget {
  final String text;
  const _IntroductionCard({required this.text});

  @override
  State<_IntroductionCard> createState() => _IntroductionCardState();
}

class _IntroductionCardState extends State<_IntroductionCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final style = AppTextStyles.body
        .copyWith(color: AppColors.textPrimary, height: 1.45);
    return _InfoCard(
      title: 'Introduction',
      icon: Icons.format_quote_rounded,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          child: LayoutBuilder(
            builder: (context, constraints) {
              // Collapse to 3 lines with a "Read more" toggle; only show the
              // toggle when the text actually overflows.
              final tp = TextPainter(
                text: TextSpan(text: widget.text, style: style),
                maxLines: 3,
                textDirection: Directionality.of(context),
              )..layout(maxWidth: constraints.maxWidth);
              final overflows = tp.didExceedMaxLines;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.text,
                    style: style,
                    maxLines: _expanded ? null : 3,
                    overflow:
                        _expanded ? TextOverflow.visible : TextOverflow.ellipsis,
                  ),
                  if (overflows) ...[
                    const SizedBox(height: 6),
                    GestureDetector(
                      onTap: () => setState(() => _expanded = !_expanded),
                      child: Text(
                        _expanded ? 'Read less' : 'Read more',
                        style: AppTextStyles.caption.copyWith(
                          color: AppColors.primary,
                          fontWeight: FontWeight.w700,
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
  final bool filled;
  final bool enabled;
  final VoidCallback? onTap;
  const _ContactAction({
    this.icon,
    this.iconAsset,
    required this.label,
    required this.color,
    this.filled = false,
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
                color: filled ? color : Colors.transparent,
                border:
                    filled ? null : Border.all(color: color, width: 1.5),
              ),
              alignment: Alignment.center,
              child: iconAsset != null
                  ? Image.asset(iconAsset!,
                      width: 22, height: 22, fit: BoxFit.contain)
                  : Icon(icon,
                      color: filled ? Colors.white : color, size: 22),
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
