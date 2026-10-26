import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import '../../../../core/constants/api_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../widgets/common/custom_app_bar.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class AssignClubsSearchResult {
  final int memberId;
  final String name;
  final String mobile;
  final String email;
  final String profilePhoto;
  const AssignClubsSearchResult({
    required this.memberId,
    required this.name,
    required this.mobile,
    required this.email,
    required this.profilePhoto,
  });
  factory AssignClubsSearchResult.fromJson(Map<String, dynamic> j) =>
      AssignClubsSearchResult(
        memberId: (j['memberId'] as int?) ?? 0,
        name: j['name']?.toString() ?? '',
        mobile: j['mobile']?.toString() ?? '',
        email: j['email']?.toString() ?? '',
        profilePhoto: j['profilePhoto']?.toString() ?? '',
      );
}

class AssignClubsAvailable {
  final int id;
  final String clubName;
  final String clubRotaryId;
  const AssignClubsAvailable({
    required this.id,
    required this.clubName,
    required this.clubRotaryId,
  });
  factory AssignClubsAvailable.fromJson(Map<String, dynamic> j) =>
      AssignClubsAvailable(
        id: (j['id'] as int?) ?? 0,
        clubName: j['clubName']?.toString() ?? '',
        clubRotaryId: j['clubRotaryId']?.toString() ?? '',
      );
}

/// A rotary year option for the form's year selector. Optional — only the AG
/// flow supplies these (AG assignments are year-scoped). When the list is empty
/// the form hides the year selector and omits `yearId` everywhere.
class AssignClubsYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const AssignClubsYear({
    required this.id,
    required this.yearLabel,
    this.isCurrent = false,
  });
  factory AssignClubsYear.fromJson(Map<String, dynamic> j) => AssignClubsYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        // `isCurrent` arrives as a bool from typed DTOs but can be 1/0 from raw
        // `dynamic` SQL projections — accept both.
        isCurrent: j['isCurrent'] == true || j['isCurrent'] == 1,
      );
}

class AssignClubsFormInitial {
  final int memberId;
  final String memberName;
  final String? mobile;
  final String? email;
  final String? profilePhoto;
  final List<AssignClubsAvailable> alreadyAssignedClubs;
  const AssignClubsFormInitial({
    required this.memberId,
    required this.memberName,
    this.mobile,
    this.email,
    this.profilePhoto,
    required this.alreadyAssignedClubs,
  });
}

/// "Assign clubs to a member" form, used for District → AG (Assistant
/// Governors).
///
/// Endpoints:
/// - searchEndpoint: GET ?search=...
/// - availableClubsEndpoint: GET ?excludeMemberId=memberId — returns clubs
///   the member could be assigned to.
/// - saveEndpoint: POST {memberId, clubIds, oldMemberId?} — same for create/update.
class AssignClubsFormScreen extends StatefulWidget {
  final String title;
  final String searchEndpoint;
  final String availableClubsEndpoint;
  final String saveEndpoint;
  final AssignClubsFormInitial? initial;

  /// All rotary years for the year selector. Empty = no year selector and no
  /// `yearId` is sent. AG passes the full list.
  final List<AssignClubsYear> years;

  /// Year pre-selected when the form opens (add → current year; edit → the
  /// listing's selected year). Ignored when [years] is empty.
  final int? initialYearId;

  const AssignClubsFormScreen({
    super.key,
    required this.title,
    required this.searchEndpoint,
    required this.availableClubsEndpoint,
    required this.saveEndpoint,
    this.initial,
    this.years = const [],
    this.initialYearId,
  });

  @override
  State<AssignClubsFormScreen> createState() => _AssignClubsFormScreenState();
}

class _AssignClubsFormScreenState extends State<AssignClubsFormScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();
  final _filterCtrl = TextEditingController();
  Timer? _debounce;

  int? _memberId;
  String? _selectedName;
  String? _selectedMobile;
  String? _selectedEmail;
  String? _selectedPhoto;
  final Set<int> _selectedClubIds = {};

  List<AssignClubsAvailable> _availableClubs = const [];
  bool _clubsLoading = false;
  bool _searching = false;
  List<AssignClubsSearchResult> _searchResults = const [];
  String _clubFilter = '';

  bool _saving = false;
  int? _formYearId;

  bool get _isEdit => widget.initial != null;
  bool get _busy => _saving || _clubsLoading;
  bool get _hasYears => widget.years.isNotEmpty;

  @override
  void initState() {
    super.initState();
    if (_hasYears) {
      // Prefer the caller's choice; otherwise current year; otherwise first.
      final preferred = widget.initialYearId;
      final exists = preferred != null &&
          widget.years.any((y) => y.id == preferred);
      if (exists) {
        _formYearId = preferred;
      } else {
        final current = widget.years.firstWhere(
          (y) => y.isCurrent,
          orElse: () => widget.years.first,
        );
        _formYearId = current.id;
      }
    }
    final init = widget.initial;
    if (init != null) {
      _memberId = init.memberId;
      _selectedName = init.memberName;
      _selectedMobile = init.mobile;
      _selectedEmail = init.email;
      _selectedPhoto = init.profilePhoto;
      _selectedClubIds.addAll(init.alreadyAssignedClubs.map((c) => c.id));
      _loadClubs();
    }
  }

  void _onFormYearChanged(int? v) {
    if (v == null || v == _formYearId) return;
    // Clubs are year-specific, so switching year clears the current selection
    // and reloads the available clubs for that year.
    setState(() {
      _formYearId = v;
      _selectedClubIds.clear();
    });
    if (_memberId != null) _loadClubs();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    _filterCtrl.dispose();
    super.dispose();
  }

  // ── Search rotarian ────────────────────────────────────────────────────

  void _onSearchChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () => _runSearch(v));
  }

  Future<void> _runSearch(String q) async {
    if (q.trim().isEmpty) {
      setState(() {
        _searchResults = const [];
        _searching = false;
      });
      return;
    }
    setState(() => _searching = true);
    try {
      final resp = await _api.get<List<dynamic>>(
        widget.searchEndpoint,
        queryParams: {
          'search': q.trim(),
          if (_formYearId != null) 'yearId': _formYearId,
        },
        fromJson: (j) => j as List<dynamic>,
      );
      // The search-members endpoint joins club_members, so a Rotarian who
      // belongs to multiple clubs comes back once per club. Dedupe by
      // memberId so the picker shows each person exactly once.
      final seen = <int>{};
      final list = <AssignClubsSearchResult>[];
      for (final e in (resp.data ?? const [])) {
        final r = AssignClubsSearchResult.fromJson(e as Map<String, dynamic>);
        if (r.memberId == 0) continue;
        if (seen.add(r.memberId)) list.add(r);
      }
      setState(() {
        _searchResults = list;
        _searching = false;
      });
    } catch (_) {
      setState(() {
        _searchResults = const [];
        _searching = false;
      });
    }
  }

  void _selectSearchResult(AssignClubsSearchResult r) {
    setState(() {
      _memberId = r.memberId;
      _selectedName = r.name;
      _selectedMobile = r.mobile;
      _selectedEmail = r.email;
      _selectedPhoto = r.profilePhoto;
      _searchCtrl.clear();
      _searchResults = const [];
      _availableClubs = const [];
      _selectedClubIds.clear();
    });
    _loadClubs();
  }

  void _changeMember() {
    setState(() {
      _memberId = null;
      _selectedName = null;
      _selectedMobile = null;
      _selectedEmail = null;
      _selectedPhoto = null;
      _availableClubs = const [];
      _selectedClubIds.clear();
    });
  }

  Future<void> _loadClubs() async {
    if (_memberId == null) return;
    setState(() => _clubsLoading = true);
    try {
      final resp = await _api.get<List<dynamic>>(
        widget.availableClubsEndpoint,
        queryParams: {
          'excludeMemberId': _memberId,
          if (_formYearId != null) 'yearId': _formYearId,
        },
        fromJson: (j) => j as List<dynamic>,
      );
      var list = (resp.data ?? const [])
          .map((e) =>
              AssignClubsAvailable.fromJson(e as Map<String, dynamic>))
          .toList();
      // Merge currently-assigned clubs (when editing) so they remain
      // selectable even if filtered out.
      if (widget.initial != null) {
        final ids = list.map((c) => c.id).toSet();
        for (final c in widget.initial!.alreadyAssignedClubs) {
          if (!ids.contains(c.id)) list.add(c);
        }
      }
      setState(() {
        _availableClubs = list;
        _clubsLoading = false;
      });
    } catch (_) {
      setState(() {
        _availableClubs = const [];
        _clubsLoading = false;
      });
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────

  Future<void> _save() async {
    if (_memberId == null || _selectedClubIds.isEmpty) return;
    final body = <String, dynamic>{
      'memberId': _memberId,
      'clubIds': _selectedClubIds.toList(),
      if (_formYearId != null) 'yearId': _formYearId,
      if (_isEdit && widget.initial!.memberId != _memberId)
        'oldMemberId': widget.initial!.memberId,
    };
    setState(() => _saving = true);
    try {
      await _api.post(widget.saveEndpoint, body: body);
      if (!mounted) return;
      // AG flow returns the saved yearId so the caller can jump to that year;
      // a year-less call returns `true`.
      Navigator.of(context).pop(_hasYears ? _formYearId : true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).clearSnackBars();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Save failed: $e'), backgroundColor: AppColors.error),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  String? _photoUrl(String? path) {
    if (path == null || path.isEmpty) return null;
    final url = ApiConstants.mediaUrl(path);
    return url.isEmpty ? null : url;
  }

  String _initials(String name) {
    final parts = name.trim().split(' ').where((s) => s.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  // ── Build ──────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final showSearchPanel = !_isEdit && _memberId == null;
    final showSelectedHeader = _memberId != null;
    final canSave = _memberId != null &&
        _selectedClubIds.isNotEmpty &&
        !_saving &&
        (!_hasYears || _formYearId != null);
    final filteredClubs = _availableClubs.where((c) {
      if (_clubFilter.trim().isEmpty) return true;
      final q = _clubFilter.trim().toLowerCase();
      return c.clubName.toLowerCase().contains(q) ||
          c.clubRotaryId.toLowerCase().contains(q);
    }).toList();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit ${widget.title}' : 'Add ${widget.title}',
        onBack: _saving ? null : () => Navigator.of(context).pop(false),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: TextButton(
              onPressed: canSave ? _save : null,
              style: TextButton.styleFrom(
                backgroundColor: AppColors.goldPrime,
                foregroundColor: AppColors.darkBg,
                disabledBackgroundColor:
                    AppColors.goldPrime.withValues(alpha: 0.4),
                padding: const EdgeInsets.symmetric(horizontal: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.2,
                        color: Colors.black54,
                      ),
                    )
                  : Text(
                      'Save',
                      style: AppFonts.body(
                        fontWeight: FontWeight.w800,
                        fontSize: 13,
                      ),
                    ),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          if (_hasYears) ..._buildYearSelector(),
          if (showSearchPanel) ..._buildSearchPanel(),
          if (showSelectedHeader) ..._buildSelectedHeader(),
          if (showSelectedHeader) ..._buildClubsPicker(filteredClubs),
        ],
      ),
    );
  }

  List<Widget> _buildYearSelector() {
    return [
      Text('Rotary Year',
          style: AppTextStyles.bodyMedium.copyWith(fontWeight: FontWeight.w700)),
      const SizedBox(height: 6),
      DropdownButtonFormField<int>(
        initialValue: _formYearId,
        isExpanded: true,
        decoration: InputDecoration(
          isDense: true,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
        ),
        items: widget.years
            .map((y) => DropdownMenuItem<int>(
                  value: y.id,
                  child: Text(
                    '${y.yearLabel}${y.isCurrent ? " (Current)" : ""}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ))
            .toList(),
        onChanged: _busy ? null : _onFormYearChanged,
      ),
      const SizedBox(height: 18),
    ];
  }

  List<Widget> _buildSearchPanel() {
    return [
      Text('Search Rotarian',
          style: AppTextStyles.bodyMedium
              .copyWith(fontWeight: FontWeight.w700)),
      const SizedBox(height: 6),
      TextField(
        controller: _searchCtrl,
        onChanged: _onSearchChanged,
        decoration: InputDecoration(
          isDense: true,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          hintText: 'Search by name, mobile, or email...',
          prefixIcon: const Icon(Icons.search, size: 20),
          suffixIcon: _searching
              ? const Padding(
                  padding: EdgeInsets.all(12),
                  child: SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              : null,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
      if (_searchResults.isNotEmpty) ...[
        const SizedBox(height: 6),
        Container(
          constraints: const BoxConstraints(maxHeight: 280),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.border),
            borderRadius: BorderRadius.circular(10),
            color: AppColors.surface,
          ),
          child: ListView.separated(
            shrinkWrap: true,
            itemCount: _searchResults.length,
            separatorBuilder: (_, __) =>
                const Divider(height: 1, color: AppColors.border),
            itemBuilder: (_, i) {
              final r = _searchResults[i];
              final url = _photoUrl(r.profilePhoto);
              return ListTile(
                dense: true,
                visualDensity: VisualDensity.compact,
                leading: CircleAvatar(
                  radius: 16,
                  backgroundColor:
                      AppColors.primary.withValues(alpha: 0.15),
                  backgroundImage: url != null ? NetworkImage(url) : null,
                  child: url == null
                      ? Text(
                          _initials(r.name),
                          style: const TextStyle(
                            color: AppColors.primary,
                            fontWeight: FontWeight.bold,
                            fontSize: 11,
                          ),
                        )
                      : null,
                ),
                title: Text(r.name,
                    style: AppTextStyles.bodyMedium
                        .copyWith(fontWeight: FontWeight.w700)),
                subtitle: Text(
                  r.mobile,
                  style: AppTextStyles.caption
                      .copyWith(color: AppColors.textSecondary),
                ),
                onTap: () => _selectSearchResult(r),
              );
            },
          ),
        ),
      ],
    ];
  }

  List<Widget> _buildSelectedHeader() {
    final url = _photoUrl(_selectedPhoto);
    return [
      Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.primary.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.primary.withValues(alpha: 0.25)),
        ),
        child: Row(
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary.withValues(alpha: 0.12),
                border: Border.all(color: AppColors.border),
              ),
              clipBehavior: Clip.antiAlias,
              child: url != null
                  ? Image.network(
                      url,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Center(
                        child: Text(
                          _initials(_selectedName ?? ''),
                          style: const TextStyle(
                              color: AppColors.primary,
                              fontWeight: FontWeight.bold),
                        ),
                      ),
                    )
                  : Center(
                      child: Text(
                        _initials(_selectedName ?? ''),
                        style: const TextStyle(
                            color: AppColors.primary,
                            fontWeight: FontWeight.bold),
                      ),
                    ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    (_selectedName ?? '').isEmpty ? 'Unnamed' : _selectedName!,
                    style: AppTextStyles.bodyMedium
                        .copyWith(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    [
                      if ((_selectedMobile ?? '').isNotEmpty) _selectedMobile!,
                      if ((_selectedEmail ?? '').isNotEmpty) _selectedEmail!,
                    ].join(' · '),
                    style: AppTextStyles.caption
                        .copyWith(color: AppColors.textSecondary),
                  ),
                ],
              ),
            ),
            if (!_isEdit)
              TextButton(
                onPressed: _busy ? null : _changeMember,
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  minimumSize: const Size(0, 32),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Text('Change'),
              ),
          ],
        ),
      ),
      const SizedBox(height: 16),
    ];
  }

  List<Widget> _buildClubsPicker(List<AssignClubsAvailable> filteredClubs) {
    return [
      Text('Assign Clubs *',
          style:
              AppTextStyles.bodyMedium.copyWith(fontWeight: FontWeight.w700)),
      const SizedBox(height: 6),
      TextField(
        controller: _filterCtrl,
        onChanged: (v) => setState(() => _clubFilter = v),
        decoration: InputDecoration(
          isDense: true,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          hintText: 'Filter clubs...',
          prefixIcon: const Icon(Icons.filter_list, size: 20),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
      const SizedBox(height: 8),
      Container(
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(10),
          color: AppColors.surface,
        ),
        child: SizedBox(
          height: 360,
          child: _clubsLoading
              ? const Center(
                  child:
                      const CircularProgressIndicator(color: AppColors.primary),
                )
              : _availableClubs.isEmpty
                  ? Center(
                      child: Text(
                        'No clubs available',
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.textSecondary),
                      ),
                    )
                  : filteredClubs.isEmpty
                      ? Center(
                          child: Text(
                            'No clubs match filter',
                            style: AppTextStyles.caption
                                .copyWith(color: AppColors.textSecondary),
                          ),
                        )
                      : ListView.builder(
                          itemCount: filteredClubs.length,
                          itemBuilder: (_, i) {
                            final c = filteredClubs[i];
                            final checked =
                                _selectedClubIds.contains(c.id);
                            return CheckboxListTile(
                              dense: true,
                              value: checked,
                              onChanged: _saving
                                  ? null
                                  : (v) {
                                      setState(() {
                                        if (v == true) {
                                          _selectedClubIds.add(c.id);
                                        } else {
                                          _selectedClubIds.remove(c.id);
                                        }
                                      });
                                    },
                              controlAffinity:
                                  ListTileControlAffinity.leading,
                              title: Text(c.clubName,
                                  style: AppTextStyles.bodyMedium),
                              subtitle: c.clubRotaryId.isEmpty
                                  ? null
                                  : Text(
                                      c.clubRotaryId,
                                      style: AppTextStyles.caption.copyWith(
                                          color: AppColors.textSecondary),
                                    ),
                            );
                          },
                        ),
        ),
      ),
      const SizedBox(height: 6),
      Text(
        '${_selectedClubIds.length} club(s) selected',
        style: AppTextStyles.caption
            .copyWith(color: AppColors.textSecondary),
      ),
    ];
  }
}
