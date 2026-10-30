import 'dart:async';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import '../../../../../presentation/widgets/common/rotary_year_bar.dart';
import '../../../../../presentation/widgets/common/custom_button.dart';
import '../../../../../presentation/widgets/common/loading_widget.dart';
import '../../../../../presentation/widgets/common/empty_state_widget.dart';
import '../../../../../presentation/widgets/common/confirmation_dialog.dart';
import 'bod_member_detail_screen.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class BoardOfDirectorsScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  final bool viewOnly;
  const BoardOfDirectorsScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<BoardOfDirectorsScreen> createState() => _BoardOfDirectorsScreenState();
}

bool _asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase().trim();
    return s == 'true' || s == '1' || s == 'yes';
  }
  return false;
}

class BodRotaryYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  final DateTime? endDate;
  const BodRotaryYear({
    required this.id,
    required this.yearLabel,
    this.isCurrent = false,
    this.endDate,
  });

  factory BodRotaryYear.fromJson(Map<String, dynamic> j) => BodRotaryYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: _asBool(j['isCurrent']),
        endDate: DateTime.tryParse(j['endDate']?.toString() ?? ''),
      );

  /// Mirrors the backend rule (`EndDate < CURDATE()`): a non-member board
  /// entry may only be added for a year that has already ended.
  bool get isPast => endDate != null && endDate!.isBefore(DateTime.now());
}

class _BoardOfDirectorsScreenState extends State<BoardOfDirectorsScreen> {
  final _api = ApiClient();

  List<dynamic> _directors = [];
  List<dynamic> _allDirectors = []; // for client-side search
  List<BodRotaryYear> _boardYears = []; // years with board data (filter dropdown)
  List<BodRotaryYear> _allRotaryYears = []; // all years (form dropdown)
  List<dynamic> _designations = [];
  int? _selectedYearId;
  bool _loading = true;
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  Future<void> _loadInitial() async {
    // Fetch designations, all rotary years, and board years in parallel
    await Future.wait<void>([
      _loadDesignations(),
      _loadAllRotaryYears(),
      _loadBoardYears(),
    ]);
    await _loadDirectors();
  }

  Future<void> _loadDesignations() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/designations',
        fromJson: (j) => j as List<dynamic>,
      );
      _designations = resp.data ?? [];
    } catch (_) {
      _designations = [];
    }
  }

  Future<void> _loadAllRotaryYears() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/rotary-years',
        fromJson: (j) => j as List<dynamic>,
      );
      _allRotaryYears = (resp.data ?? [])
          .map((e) => BodRotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      _allRotaryYears = [];
    }
  }

  Future<void> _loadBoardYears() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/board-of-directors/years',
        fromJson: (j) => j as List<dynamic>,
      );
      final years = (resp.data ?? [])
          .map((e) => BodRotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
      // Default: current year if it has data, otherwise latest year with data
      final current = years.firstWhere(
        (y) => y.isCurrent,
        orElse: () => years.isNotEmpty ? years.first : const BodRotaryYear(id: 0, yearLabel: ''),
      );
      if (!mounted) return;
      // Preserve user's existing year selection if it still exists in the list
      // (e.g. after adding a member, don't snap them back to current year).
      final hasSelection = _selectedYearId != null &&
          years.any((y) => y.id == _selectedYearId);
      setState(() {
        _boardYears = years;
        if (!hasSelection) {
          _selectedYearId = current.id != 0 ? current.id : null;
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _boardYears = []);
    }
  }

  Future<void> _loadDirectors() async {
    setState(() => _loading = true);
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/board-of-directors',
        queryParams: {'yearId': _selectedYearId ?? 0},
        fromJson: (json) => json,
      );
      if (resp.data != null) {
        final list = resp.data is List
            ? resp.data as List<dynamic>
            : (resp.data as Map<String, dynamic>)['items'] as List<dynamic>? ?? [];
        setState(() {
          _allDirectors = list;
          _applySearch();
        });
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to load board of directors');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _applySearch() {
    final q = _searchQuery.toLowerCase().trim();
    if (q.isEmpty) {
      _directors = List.from(_allDirectors);
    } else {
      _directors = _allDirectors.where((d) {
        final name = (d['memberName'] ?? '').toString().toLowerCase();
        final desig = (d['designationName'] ?? '').toString().toLowerCase();
        return name.contains(q) || desig.contains(q);
      }).toList();
    }
  }

  Future<void> _deleteDirector(Map<String, dynamic> director) async {
    final name = director['memberName']?.toString() ?? 'Unknown';
    final designation = (director['designationName'] ?? '').toString();
    final yearLabel = (director['yearLabel'] ?? '').toString();
    final confirmed = await ConfirmationDialog.show(
      context,
      title: 'Delete Board Director',
      message: 'Are you sure you want to delete the record for $name ($designation, $yearLabel)?',
    );
    if (confirmed != true) return;
    try {
      await _api.delete(
          '/api/clubs/${widget.clubId}/board-of-directors/${director['id']}');
      if (mounted) SnackbarUtils.showSuccess(context, 'Board member removed');
      // Refresh board years list and re-fetch records
      await _loadBoardYears();
      _loadDirectors();
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to remove board member');
    }
  }

  void _openDetail(Map<String, dynamic> director) {
    final memberId = director['memberId'] as int?;
    if (memberId == null) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => BodMemberDetailScreen(
          memberId: memberId,
          memberName: director['memberName']?.toString() ?? 'Member',
          designationName:
              (director['designationName'] ?? director['designation'])
                      ?.toString() ??
                  '',
          yearLabel: (director['yearLabel'] ?? '').toString(),
          profilePhotoPath:
              (director['profilePhotoPath'] ?? director['profilePhoto'])
                  ?.toString(),
        ),
      ),
    );
  }

  void _openForm({Map<String, dynamic>? director}) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => BodDirectorFormScreen(
          clubId: widget.clubId,
          director: director,
          allRotaryYears: _allRotaryYears,
          designations: _designations,
          onSaved: () async {
            await _loadBoardYears();
            _loadDirectors();
          },
        ),
      ),
    );
  }

  /// Per-level gating: only club admins of THIS club can manage.
  bool get canManage =>
      !widget.viewOnly &&
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: widget.embedded ? null : const CustomAppBar(title: 'Board of Directors'),
      floatingActionButton: !canManage
          ? null
          : FloatingActionButton(
              onPressed: () => _openForm(),
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.add, color: Colors.white),
            ),
      body: Column(
        children: [
          // Year filter
          if (_boardYears.isNotEmpty)
            RotaryYearBar<int>(
              value: _selectedYearId,
              options: _boardYears
                  .map((y) => RotaryYearOption<int>(
                        value: y.id,
                        label: y.yearLabel,
                        isCurrent: y.isCurrent,
                      ))
                  .toList(),
              onChanged: (v) {
                setState(() => _selectedYearId = v);
                _loadDirectors();
              },
            ),
          // Client-side quick search
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Search by name or designation...',
                prefixIcon: const Icon(Icons.search, size: 20),
                isDense: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
              ),
              onChanged: (v) {
                setState(() {
                  _searchQuery = v;
                  _applySearch();
                });
              },
            ),
          ),
          Expanded(
            child: _loading
                ? const LoadingWidget()
                : _directors.isEmpty
                    ? const EmptyStateWidget(title: 'No board members found')
                    : RefreshIndicator(
                        onRefresh: () => _loadDirectors(),
                        child: ListView.separated(
                          padding: (const EdgeInsets.all(16)).add(const EdgeInsets.only(bottom: 88)),
                          itemCount: _directors.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 10),
                          itemBuilder: (_, i) => _buildDirectorCard(_directors[i]),
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _buildDirectorCard(Map<String, dynamic> director) {
    final photoUrl = (director['profilePhotoPath'] ?? director['profilePhoto'])?.toString();
    final name = director['memberName']?.toString() ?? 'Unknown';
    final designation = (director['designationName'] ?? director['designation'])?.toString() ?? '';
    // A non-member entry has no member profile: isMember=false (or a null
    // memberId). These are tap-inert (no member detail page to open).
    final isNonMember = director['isMember'] == false ||
        (director['isMember'] == null && director['memberId'] == null);

    return Card(
      elevation: 0,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(20))),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _openDetail(director),
        child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            CircleAvatar(
              radius: 24,
              backgroundColor: AppColors.primary.withOpacity(0.1),
              backgroundImage:
                  photoUrl != null && photoUrl.isNotEmpty ? NetworkImage(ApiConstants.mediaUrl(photoUrl)) : null,
              child: (photoUrl == null || photoUrl.isEmpty)
                  ? Text(
                      name.isNotEmpty ? name[0].toUpperCase() : '?',
                      style: AppTextStyles.h3.copyWith(color: AppColors.primary),
                    )
                  : null,
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(name,
                            style: AppTextStyles.body.copyWith(
                              fontWeight: FontWeight.w600,
                              color: AppColors.primary,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis),
                      ),
                      if (isNonMember) ...[
                        const SizedBox(width: 6),
                        const _NonMemberTag(),
                      ],
                    ],
                  ),
                  if (designation.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(designation,
                        style: AppTextStyles.caption.copyWith(color: Colors.grey[600])),
                  ],
                ],
              ),
            ),
            if (canManage)
              PopupMenuButton<String>(
                onSelected: (v) {
                  if (v == 'edit') _openForm(director: director);
                  if (v == 'delete') _deleteDirector(director);
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'edit', child: Text('Edit')),
                  PopupMenuItem(value: 'delete', child: Text('Delete')),
                ],
              ),
          ],
        ),
        ),
      ),
    );
  }
}

// ── Form BottomSheet ──────────────────────────────────────────────────────────

class BodDirectorFormScreen extends StatefulWidget {
  final int clubId;
  final Map<String, dynamic>? director;
  final List<BodRotaryYear> allRotaryYears;
  final List<dynamic> designations;
  final Future<void> Function() onSaved;

  const BodDirectorFormScreen({
    super.key,
    required this.clubId,
    required this.onSaved,
    required this.allRotaryYears,
    required this.designations,
    this.director,
  });

  @override
  State<BodDirectorFormScreen> createState() => _BodDirectorFormScreenState();
}

class _BodDirectorFormScreenState extends State<BodDirectorFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();

  // Member search (server-side with debounce)
  final _memberSearchCtrl = TextEditingController();
  List<dynamic> _searchResults = [];
  bool _searching = false;
  Timer? _debounce;
  bool _showMemberPicker = false;

  int? _memberId;
  String? _memberName;
  String? _profilePhotoPath;

  // Non-member entry (past years only): free-text Name + Mobile + Email, all
  // required by the backend. Mutually exclusive with a selected member.
  bool _isNonMember = false;
  final _nonMemberNameCtrl = TextEditingController();
  final _nonMemberMobileCtrl = TextEditingController();
  final _nonMemberEmailCtrl = TextEditingController();

  int? _designationId;
  int? _yearId;
  bool _saving = false;

  bool get _isEdit => widget.director != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      _memberId = (widget.director!['memberId'] as num?)?.toInt();
      _memberName = widget.director!['memberName']?.toString();
      _designationId = widget.director!['designationId'] as int?;
      _yearId = widget.director!['yearId'] as int?;
      _profilePhotoPath = widget.director!['profilePhotoPath']?.toString();
      // Non-member row: memberId null/0 with non-member details carried on the
      // record (standalone list returns nonMember*; dashboard threads them in).
      final nmName = widget.director!['nonMemberName']?.toString();
      final flaggedNonMember = widget.director!['isMember'] == false;
      if ((_memberId == null || _memberId == 0) &&
          (flaggedNonMember || (nmName != null && nmName.trim().isNotEmpty))) {
        _memberId = null;
        _isNonMember = true;
        _nonMemberNameCtrl.text =
            (nmName ?? widget.director!['memberName'] ?? '').toString().trim();
        _nonMemberMobileCtrl.text =
            (widget.director!['nonMemberMobile'] ?? '').toString().trim();
        _nonMemberEmailCtrl.text =
            (widget.director!['nonMemberEmail'] ?? '').toString().trim();
      }
    }
  }

  @override
  void dispose() {
    _memberSearchCtrl.dispose();
    _nonMemberNameCtrl.dispose();
    _nonMemberMobileCtrl.dispose();
    _nonMemberEmailCtrl.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String query) {
    _debounce?.cancel();
    if (query.trim().isEmpty) {
      setState(() => _searchResults = []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 300), () {
      _searchMembers(query.trim());
    });
  }

  Future<void> _searchMembers(String query) async {
    setState(() => _searching = true);
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/board-of-directors/search-members',
        queryParams: {'search': query},
        fromJson: (j) => j,
      );
      final list = resp.data is List
          ? resp.data as List<dynamic>
          : (resp.data as Map<String, dynamic>?)?['items'] as List<dynamic>? ?? [];
      if (mounted) setState(() => _searchResults = list);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  void _selectMember(Map<String, dynamic> m) {
    setState(() {
      _memberId = (m['id'] as num?)?.toInt();
      _memberName = (m['memberName'] ?? m['name'])?.toString();
      _profilePhotoPath = m['profilePhotoPath']?.toString();
      _isNonMember = false;
      _nonMemberNameCtrl.clear();
      _nonMemberMobileCtrl.clear();
      _nonMemberEmailCtrl.clear();
      _showMemberPicker = false;
      _memberSearchCtrl.clear();
      _searchResults = [];
    });
  }

  /// Switch to a free-text non-member entry (for a past board member no longer
  /// in the system). Mutually exclusive with a selected member; only valid for
  /// past years, so clear a non-past year selection.
  void _selectNonMember(String name) {
    setState(() {
      _isNonMember = true;
      _memberId = null;
      _memberName = null;
      _profilePhotoPath = null;
      _nonMemberNameCtrl.text = name.trim();
      _showMemberPicker = false;
      _memberSearchCtrl.clear();
      _searchResults = [];
      // A non-member can only be added for a past year — drop an invalid pick.
      if (_yearId != null && !_isYearPast(_yearId)) _yearId = null;
    });
  }

  bool get _hasMember => _memberId != null;
  bool get _hasSelection => _hasMember || _isNonMember;

  bool _isYearPast(int? yearId) {
    if (yearId == null) return false;
    for (final y in widget.allRotaryYears) {
      if (y.id == yearId) return y.isPast;
    }
    return false;
  }

  /// Years offered in the dropdown: all years for a member entry, but only PAST
  /// years for a non-member (matching the backend). When editing, always keep
  /// the record's current year so the value stays valid.
  List<BodRotaryYear> get _yearOptions {
    if (!_isNonMember) return widget.allRotaryYears;
    return widget.allRotaryYears
        .where((y) => y.isPast || (_isEdit && y.id == _yearId))
        .toList();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (!_hasSelection) {
      setState(() => _showMemberPicker = true);
      SnackbarUtils.showError(
          context, 'Select a member, or add a non-member (past years only).');
      return;
    }

    final nmName = _nonMemberNameCtrl.text.trim();
    final nmMobile = _nonMemberMobileCtrl.text.trim();
    final nmEmail = _nonMemberEmailCtrl.text.trim();

    if (_isNonMember) {
      // Mirror the backend rule: Name + Mobile + Email all required, past year only.
      if (nmName.isEmpty || nmMobile.isEmpty || nmEmail.isEmpty) {
        SnackbarUtils.showError(
            context, 'A non-member requires Name, Mobile, and Email.');
        return;
      }
      if (!_isYearPast(_yearId)) {
        SnackbarUtils.showError(context,
            'Non-members can only be added for past rotary years, not the current or future year.');
        return;
      }
    }

    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'memberId': _isNonMember ? null : _memberId,
        // Exactly one of memberId / non-member details per the backend rule.
        'nonMemberName': _isNonMember ? nmName : null,
        'nonMemberMobile': _isNonMember ? nmMobile : null,
        'nonMemberEmail': _isNonMember ? nmEmail : null,
        'designationId': _designationId,
        'yearId': _yearId,
      };
      if (_isEdit) {
        await _api.put(
          '/api/clubs/${widget.clubId}/board-of-directors/${widget.director!['id']}',
          body: body,
        );
      } else {
        await _api.post('/api/clubs/${widget.clubId}/board-of-directors', body: body);
      }
      if (mounted) {
        SnackbarUtils.showSuccess(context, _isEdit ? 'Updated' : 'Added');
        await widget.onSaved();
        if (mounted) Navigator.pop(context);
      }
    } catch (e) {
      if (!mounted) return;
      // The backend returns precise validation messages (duplicate designation,
      // restricted role, non-member missing fields, non-past year) as a 400
      // {message} — surface it directly instead of guessing.
      SnackbarUtils.showError(
          context, e is ApiException ? e.message : 'Failed to save');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Board Director' : 'Add Board Director',
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
                      // ── Member / Non-member section ──
                      _selectionSection(),
                      const SizedBox(height: 16),

                      // ── Designation dropdown ──
                      DropdownButtonFormField<int>(
                        value: _designationId,
                        isExpanded: true,
                        decoration: InputDecoration(
                          labelText: 'Designation *',
                          border:
                              OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                        ),
                        items: widget.designations
                            .map((d) => DropdownMenuItem<int>(
                                  value: d['id'] as int?,
                                  child: Text(
                                    (d['designationName'] ?? d['name'])?.toString() ?? '',
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ))
                            .toList(),
                        onChanged: (v) => setState(() => _designationId = v),
                        validator: (v) => v == null ? 'Please select designation' : null,
                      ),
                      const SizedBox(height: 16),

                      // ── Rotary Year dropdown ──
                      // Members can use any year; a non-member is restricted to
                      // PAST years (backend rule), so the option list narrows.
                      DropdownButtonFormField<int>(
                        value: _yearOptions.any((y) => y.id == _yearId)
                            ? _yearId
                            : null,
                        isExpanded: true,
                        decoration: InputDecoration(
                          labelText: 'Rotary Year *',
                          helperText: _isNonMember
                              ? 'Non-members: past years only.'
                              : null,
                          border:
                              OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                        ),
                        items: _yearOptions
                            .map((y) => DropdownMenuItem<int>(
                                  value: y.id,
                                  child: Text(
                                    '${y.yearLabel}${y.isCurrent ? " (Current)" : ""}',
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ))
                            .toList(),
                        onChanged: (v) => setState(() => _yearId = v),
                        validator: (v) => v == null ? 'Please select a year' : null,
                      ),
                      const SizedBox(height: 24),

                      // ── Buttons ──
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () => Navigator.pop(context),
                              child: const Text('Cancel'),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: CustomButton(
                              label: _isEdit ? 'Update' : 'Save',
                              onPressed: (_saving ||
                                      !_hasSelection ||
                                      _designationId == null ||
                                      _yearId == null)
                                  ? null
                                  : _save,
                              isLoading: _saving,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
    );
  }

  // ── Member / Non-member selector ──────────────────────────────────────────
  Widget _selectionSection() {
    if (_hasMember && !_showMemberPicker) return _selectedMemberCard();
    if (_isNonMember && !_showMemberPicker) return _nonMemberCard();
    return _memberSearchBox();
  }

  Widget _selectedMemberCard() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          ClipOval(
            child: _profilePhotoPath != null && _profilePhotoPath!.isNotEmpty
                ? CachedNetworkImage(
                    imageUrl: '${ApiConstants.mediaBaseUrl}$_profilePhotoPath',
                    width: 48,
                    height: 48,
                    fit: BoxFit.cover,
                    errorWidget: (_, __, ___) => _avatarFallback(),
                  )
                : _avatarFallback(),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _memberName ?? 'Selected Member',
                  style: AppTextStyles.body.copyWith(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                _changeLink(),
              ],
            ),
          ),
          _typeBadge('Member', AppColors.success),
        ],
      ),
    );
  }

  Widget _nonMemberCard() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.grey.shade100,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.shade300),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.person_add_alt_1, size: 18, color: Colors.grey.shade600),
              const SizedBox(width: 6),
              Text('Non-member details',
                  style: AppTextStyles.caption
                      .copyWith(fontWeight: FontWeight.w700, color: Colors.grey.shade700)),
              const Spacer(),
              _typeBadge('Non-Member', Colors.grey.shade600),
              const SizedBox(width: 8),
              _changeLink(),
            ],
          ),
          const SizedBox(height: 10),
          TextFormField(
            controller: _nonMemberNameCtrl,
            textCapitalization: TextCapitalization.words,
            decoration: _nmFieldDecoration('Name *'),
            validator: (v) => (_isNonMember && (v ?? '').trim().isEmpty)
                ? 'Name is required'
                : null,
          ),
          const SizedBox(height: 10),
          TextFormField(
            controller: _nonMemberMobileCtrl,
            keyboardType: TextInputType.phone,
            decoration: _nmFieldDecoration('Mobile *'),
            validator: (v) => (_isNonMember && (v ?? '').trim().isEmpty)
                ? 'Mobile is required'
                : null,
          ),
          const SizedBox(height: 10),
          TextFormField(
            controller: _nonMemberEmailCtrl,
            keyboardType: TextInputType.emailAddress,
            decoration: _nmFieldDecoration('Email *'),
            validator: (v) {
              if (!_isNonMember) return null;
              final t = (v ?? '').trim();
              if (t.isEmpty) return 'Email is required';
              if (!t.contains('@') || !t.contains('.')) return 'Enter a valid email';
              return null;
            },
          ),
        ],
      ),
    );
  }

  InputDecoration _nmFieldDecoration(String label) => InputDecoration(
        labelText: label,
        isDense: true,
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
      );

  Widget _changeLink() => GestureDetector(
        onTap: () => setState(() => _showMemberPicker = true),
        child: const Text(
          'Change',
          style: const TextStyle(
            color: AppColors.primary,
            fontWeight: FontWeight.w600,
            fontSize: 13,
          ),
        ),
      );

  Widget _memberSearchBox() {
    final query = _memberSearchCtrl.text.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _memberSearchCtrl,
          decoration: InputDecoration(
            hintText: 'Search club members...',
            prefixIcon: const Icon(Icons.search, size: 20),
            isDense: true,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
          ),
          onChanged: _onSearchChanged,
        ),
        const SizedBox(height: 4),
        if (_searching)
          const Padding(
            padding: EdgeInsets.all(8),
            child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
          )
        else if (query.isNotEmpty)
          Container(
            constraints: const BoxConstraints(maxHeight: 220),
            decoration: BoxDecoration(
              border: Border.all(color: Colors.grey.shade300),
              borderRadius: BorderRadius.circular(8),
            ),
            child: ListView(
              shrinkWrap: true,
              padding: (EdgeInsets.zero).add(const EdgeInsets.only(bottom: 88)),
              children: [
                for (final r in _searchResults)
                  if (r is Map<String, dynamic>) _memberResultTile(r),
                // Non-member fallback — offered whenever a query is present.
                _nonMemberResultTile(query),
              ],
            ),
          ),
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(
            'Pick a member, or add a non-member (past years only) if the '
            'person isn’t in the system.',
            style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
          ),
        ),
      ],
    );
  }

  Widget _memberResultTile(Map<String, dynamic> m) {
    final name = (m['memberName'] ?? m['name'] ?? '').toString();
    final photo = m['profilePhotoPath']?.toString();
    return ListTile(
      dense: true,
      leading: ClipOval(
        child: photo != null && photo.isNotEmpty
            ? CachedNetworkImage(
                imageUrl: '${ApiConstants.mediaBaseUrl}$photo',
                width: 32,
                height: 32,
                fit: BoxFit.cover,
                errorWidget: (_, __, ___) => _smallAvatar(name),
              )
            : _smallAvatar(name),
      ),
      title: Text(name, style: AppTextStyles.body),
      trailing: _typeBadge('Member', AppColors.success),
      onTap: () => _selectMember(m),
    );
  }

  Widget _nonMemberResultTile(String query) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.grey.shade50,
        border: Border(top: BorderSide(color: Colors.grey.shade200)),
      ),
      child: ListTile(
        dense: true,
        leading: Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: Colors.white,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.grey.shade300),
          ),
          child: Icon(Icons.person_add_alt_1, size: 18, color: Colors.grey.shade500),
        ),
        title: Text.rich(
          TextSpan(
            children: [
              const TextSpan(text: 'Add '),
              TextSpan(
                  text: '“$query”',
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              const TextSpan(text: ' as Non-Member'),
            ],
          ),
          style: AppTextStyles.body,
        ),
        trailing: _typeBadge('Non-Member', Colors.grey.shade600),
        onTap: () => _selectNonMember(query),
      ),
    );
  }

  Widget _typeBadge(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: color),
      ),
    );
  }

  Widget _avatarFallback() => Container(
        width: 48,
        height: 48,
        color: AppColors.primaryLight,
        child: const Icon(Icons.person, size: 24, color: AppColors.primary),
      );

  Widget _smallAvatar(String name) => Container(
        width: 32,
        height: 32,
        color: AppColors.primaryLight,
        child: Center(
          child: Text(
            name.isNotEmpty ? name[0].toUpperCase() : '?',
            style: const TextStyle(
                color: AppColors.primary,
                fontWeight: FontWeight.w700,
                fontSize: 14),
          ),
        ),
      );
}

/// Small pill marking a board row as a free-text non-member entry (past years).
class _NonMemberTag extends StatelessWidget {
  const _NonMemberTag();
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.grey.shade200,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        'Non-Member',
        style: TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w700,
          color: Colors.grey.shade700,
        ),
      ),
    );
  }
}
