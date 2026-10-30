import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_response.dart';
import '../../../../../core/routing/route_names.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_button.dart';
import '../../../../widgets/common/custom_text_field.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';

// ---------------------------------------------------------------------------
// COG (Council of Governors) member SEARCH — a dedicated per-field filter page
// for the COG Directory. The COG audience is 60+ and struggled with the single
// "smart" omni-search box, so tapping the directory search bar opens THIS page:
// each criterion is its own labelled field, then a Search button shows the
// results list (mirrors the Find-a-Rotarian flow).
//
// Filtering is done SERVER-SIDE. The backend (commit 0f77e097) added dedicated
// query params to GET /api/clubs/{id}/members:
//   search           -> MemberName OR PrimaryMobileNumber   (Name + Mobile share this)
//   email            -> EmailId
//   rotaryId         -> RotaryId
//   districtNumber   -> DistrictNumber (or Designation prefix)
//   designation      -> Designation
//   classification   -> ClassificationProfession
//   familyMemberName -> family member Name (EXISTS)
//   year (int)       -> COG-only: 4-digit run inside Designation (governor year)
// All AND-combined; blank/omitted params are ignored.
// ---------------------------------------------------------------------------

class CogMemberSearchScreen extends StatefulWidget {
  final int clubId;
  final String? clubName;

  const CogMemberSearchScreen({super.key, required this.clubId, this.clubName});

  @override
  State<CogMemberSearchScreen> createState() => _CogMemberSearchScreenState();
}

class _CogMemberSearchScreenState extends State<CogMemberSearchScreen> {
  // Primary (always shown) — Name and Mobile share the backend `search` param,
  // so they are presented as ONE combined field (they can't be filtered
  // independently server-side).
  final _nameMobileCtrl = TextEditingController();
  final _designationCtrl = TextEditingController();
  final _districtCtrl = TextEditingController();

  final _emailCtrl = TextEditingController();
  final _rotaryIdCtrl = TextEditingController();
  final _classificationCtrl = TextEditingController();
  final _familyCtrl = TextEditingController();

  @override
  void dispose() {
    _nameMobileCtrl.dispose();
    _designationCtrl.dispose();
    _districtCtrl.dispose();
    _emailCtrl.dispose();
    _rotaryIdCtrl.dispose();
    _classificationCtrl.dispose();
    _familyCtrl.dispose();
    super.dispose();
  }

  void _onSearch() {
    FocusScope.of(context).unfocus();
    final qp = <String, dynamic>{};

    final nameMobile = _nameMobileCtrl.text.trim();
    // NOTE: the `designation` param actually carries the Governorship Year — the
    // field is labelled "Governorship Year" in the UI but the backend key stays
    // `designation`.
    final designation = _designationCtrl.text.trim();
    final district = _districtCtrl.text.trim();
    final family = _familyCtrl.text.trim();

    if (nameMobile.isNotEmpty) qp['search'] = nameMobile;
    if (designation.isNotEmpty) qp['designation'] = designation;
    if (district.isNotEmpty) qp['districtNumber'] = district;
    if (family.isNotEmpty) qp['familyMemberName'] = family;

    // Hidden for now (2026-08-06) — restore these fields + params to re-enable.
    // final email = _emailCtrl.text.trim();
    // final rotaryId = _rotaryIdCtrl.text.trim();
    // final classification = _classificationCtrl.text.trim();
    // if (email.isNotEmpty) qp['email'] = email;
    // if (rotaryId.isNotEmpty) qp['rotaryId'] = rotaryId;
    // if (classification.isNotEmpty) qp['classification'] = classification;

    if (qp.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter at least one detail to search.')),
      );
      return;
    }

    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => CogMemberResultsScreen(
        clubId: widget.clubId,
        clubName: widget.clubName,
        filters: qp,
      ),
    ));
  }

  void _clearAll() {
    for (final c in [
      _nameMobileCtrl,
      _designationCtrl,
      _districtCtrl,
      _emailCtrl,
      _rotaryIdCtrl,
      _classificationCtrl,
      _familyCtrl,
    ]) {
      c.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Search Members'),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _intro(),
                    const SizedBox(height: 14),
                    _sectionCard(
                      child: Column(
                        children: [
                          CustomTextField(
                            label: 'Name or Mobile',
                            hint: 'Enter name or mobile number',
                            controller: _nameMobileCtrl,
                            prefixIcon: Icons.person_search_outlined,
                          ),
                          const SizedBox(height: 14),
                          CustomTextField(
                            // Labelled "Governorship Year" — the underlying data
                            // field / backend param stays `designation`.
                            label: 'Governorship Year',
                            hint: 'Enter governorship year',
                            controller: _designationCtrl,
                            prefixIcon: Icons.badge_outlined,
                          ),
                          const SizedBox(height: 14),
                          CustomTextField(
                            label: 'District Number',
                            hint: 'Enter district number',
                            controller: _districtCtrl,
                            keyboardType: TextInputType.number,
                            prefixIcon: Icons.tag_rounded,
                          ),
                          const SizedBox(height: 14),
                          // Hidden for now (2026-08-06) — restore Email, Rotary ID
                          // and Classification / Profession to re-enable.
                          // CustomTextField(
                          //   label: 'Email',
                          //   hint: 'Enter email address',
                          //   controller: _emailCtrl,
                          //   keyboardType: TextInputType.emailAddress,
                          //   prefixIcon: Icons.email_outlined,
                          // ),
                          // const SizedBox(height: 14),
                          // CustomTextField(
                          //   label: 'Rotary ID',
                          //   hint: 'Enter Rotary ID',
                          //   controller: _rotaryIdCtrl,
                          //   prefixIcon: Icons.credit_card_outlined,
                          // ),
                          // const SizedBox(height: 14),
                          // CustomTextField(
                          //   label: 'Classification / Profession',
                          //   hint: 'Enter classification or profession',
                          //   controller: _classificationCtrl,
                          //   prefixIcon: Icons.work_outline_rounded,
                          // ),
                          // const SizedBox(height: 14),
                          CustomTextField(
                            label: 'Family Member Name',
                            hint: 'Enter a family member name',
                            controller: _familyCtrl,
                            prefixIcon: Icons.family_restroom_outlined,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    Center(
                      child: TextButton.icon(
                        onPressed: _clearAll,
                        icon: const Icon(Icons.refresh_rounded, size: 18),
                        label: const Text('Clear all'),
                        style: TextButton.styleFrom(
                          foregroundColor: AppColors.textSecondary,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Container(
              decoration: const BoxDecoration(
                color: AppColors.white,
                border: const Border(top: const BorderSide(color: AppColors.border)),
              ),
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 14),
              child: CustomButton(
                label: 'Search',
                icon: Icons.search_rounded,
                onPressed: _onSearch,
                fullWidth: true,
                height: 52,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _intro() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.primaryPrime.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.primaryPrime.withValues(alpha: 0.15)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline_rounded, size: 18, color: AppColors.primaryPrime),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Fill in any one detail (or a few) and tap Search. '
              'You can search by just a name, a mobile number, or any '
              'of the fields below.',
              style: AppFonts.body(
                fontSize: 13,
                color: AppColors.textSecondary,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionCard({required Widget child}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),

      ),
      child: child,
    );
  }
}

// ---------------------------------------------------------------------------
// Results — fetches the filtered, paginated member list and renders read-only
// COG tiles (avatar + name + designation), tapping through to member detail.
// ---------------------------------------------------------------------------
class CogMemberResultsScreen extends StatefulWidget {
  final int clubId;
  final String? clubName;
  final Map<String, dynamic> filters;

  const CogMemberResultsScreen({
    super.key,
    required this.clubId,
    this.clubName,
    required this.filters,
  });

  @override
  State<CogMemberResultsScreen> createState() => _CogMemberResultsScreenState();
}

class _CogMemberResultsScreenState extends State<CogMemberResultsScreen> {
  final _api = ApiClient();
  final _scrollCtrl = ScrollController();

  final List<_CogMember> _items = [];
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  bool _loading = false;
  bool _loadingMore = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _scrollCtrl.addListener(_onScroll);
    _fetch(reset: true);
  }

  @override
  void dispose() {
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollCtrl.hasClients) return;
    final pos = _scrollCtrl.position;
    if (pos.pixels > pos.maxScrollExtent - 300 &&
        !_loadingMore &&
        !_loading &&
        _page < _totalPages) {
      _page++;
      _fetch();
    }
  }

  Future<void> _fetch({bool reset = false}) async {
    if (reset) {
      setState(() {
        _page = 1;
        _items.clear();
        _loading = true;
        _error = null;
      });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/members',
        queryParams: {
          ...widget.filters,
          'page': _page,
          'pageSize': 20,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged =
          PagedResponse.fromJson(resp.data ?? {}, (j) => _CogMember.fromJson(j));
      if (!mounted) return;
      setState(() {
        _items.addAll(paged.items);
        _totalPages = paged.totalPages;
        _totalCount = paged.totalCount;
        _loading = false;
        _loadingMore = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Search Results'),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) return const LoadingWidget();
    if (_error != null) {
      return ErrorStateWidget(message: _error!, onRetry: () => _fetch(reset: true));
    }
    if (_items.isEmpty) {
      return const EmptyStateWidget(
        icon: Icons.search_off_rounded,
        title: 'No members found',
        subtitle: 'Try different or fewer details.',
      );
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text(
              '$_totalCount result${_totalCount == 1 ? '' : 's'}',
              style: AppFonts.body(
                fontSize: 13,
                color: AppColors.textSecondary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
        Expanded(
          child: ListView.separated(
            controller: _scrollCtrl,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            itemCount: _items.length + (_loadingMore ? 1 : 0),
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (_, i) {
              if (i >= _items.length) {
                return const Padding(
                  padding: EdgeInsets.all(16),
                  child: const RowSkeletonList(),
                );
              }
              final m = _items[i];
              return _CogResultTile(
                member: m,
                onTap: () => context.push(RouteNames.directoryMemberDetail(
                  m.memberId,
                  fromDirectory: true,
                  clubId: widget.clubId,
                )),
              );
            },
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Lean read-only tile — matches the COG directory listing (avatar + name +
// designation; contact rows / role chips are intentionally hidden for COG).
// ---------------------------------------------------------------------------
class _CogResultTile extends StatelessWidget {
  final _CogMember member;
  final VoidCallback onTap;
  const _CogResultTile({required this.member, required this.onTap});

  String get _initials {
    final name = member.memberName.trim();
    if (name.isEmpty) return 'M';
    final parts = name.split(' ').where((p) => p.isNotEmpty).toList();
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  String? get _photoUrl {
    final p = member.profilePhotoPath;
    if (p == null || p.isEmpty) return null;
    return p.startsWith('http') ? p : '${ApiConstants.mediaBaseUrl}$p';
  }

  @override
  Widget build(BuildContext context) {
    final url = _photoUrl;
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(24),
                child: Container(
                  width: 46,
                  height: 46,
                  color: AppColors.primaryLight,
                  child: url == null
                      ? Center(
                          child: Text(
                            _initials,
                            style: AppTextStyles.bodyMedium.copyWith(
                              color: AppColors.primary,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        )
                      : CachedNetworkImage(
                          imageUrl: url,
                          fit: BoxFit.cover,
                          placeholder: (_, __) =>
                              Container(color: AppColors.primaryLight),
                          errorWidget: (_, __, ___) => Center(
                            child: Text(
                              _initials,
                              style: AppTextStyles.bodyMedium.copyWith(
                                color: AppColors.primary,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      member.memberName,
                      style: AppTextStyles.bodyMedium
                          .copyWith(fontWeight: FontWeight.w700),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if ((member.designation ?? '').trim().isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          member.designation!.trim(),
                          style: AppTextStyles.caption.copyWith(
                            color: AppColors.primary,
                            fontWeight: FontWeight.w600,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
            ],
          ),
        ),
      ),
    );
  }
}

class _CogMember {
  final int memberId;
  final String memberName;
  final String? designation;
  final String? profilePhotoPath;

  const _CogMember({
    required this.memberId,
    required this.memberName,
    this.designation,
    this.profilePhotoPath,
  });

  factory _CogMember.fromJson(Map<String, dynamic> j) {
    return _CogMember(
      memberId: (j['memberId'] as num?)?.toInt() ?? (j['id'] as num?)?.toInt() ?? 0,
      memberName: (j['memberName'] ?? j['name'] ?? '').toString(),
      designation: j['designation']?.toString(),
      profilePhotoPath: j['profilePhotoPath']?.toString(),
    );
  }
}
