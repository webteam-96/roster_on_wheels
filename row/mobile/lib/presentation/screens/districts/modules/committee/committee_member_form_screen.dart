import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:image_picker/image_picker.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/validators.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Search-result row returned by the committee `search-members` endpoint.
class CommitteeSearchResult {
  final int memberId;
  final String name;
  final String mobile;
  final String email;
  final String clubName;
  final String profilePhoto;
  const CommitteeSearchResult({
    required this.memberId,
    required this.name,
    required this.mobile,
    required this.email,
    required this.clubName,
    required this.profilePhoto,
  });
  factory CommitteeSearchResult.fromJson(Map<String, dynamic> j) =>
      CommitteeSearchResult(
        memberId: (j['memberId'] as int?) ?? 0,
        name: j['name']?.toString() ?? '',
        mobile: j['mobile']?.toString() ?? '',
        email: j['email']?.toString() ?? '',
        clubName: j['clubName']?.toString() ?? '',
        profilePhoto: j['profilePhoto']?.toString() ?? '',
      );
}

/// Initial values for editing an existing committee member. Pass null for
/// add. The id is used for the PUT URL.
class CommitteeMemberFormInitial {
  final int id;
  final bool isMember;
  final int? memberId;
  final String name;
  final String mobile;
  final String email;
  final String designation;
  final String clubName;
  final String remark;
  final String profilePhoto;
  const CommitteeMemberFormInitial({
    required this.id,
    required this.isMember,
    this.memberId,
    required this.name,
    required this.mobile,
    required this.email,
    required this.designation,
    required this.clubName,
    required this.remark,
    required this.profilePhoto,
  });
}

/// Dropdown option for the optional year picker on committee_members screen.
class CommitteeMemberYearOption {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const CommitteeMemberYearOption({
    required this.id,
    required this.yearLabel,
    required this.isCurrent,
  });
}

/// Shared add/edit form for committee members across:
/// - district committee → group → members
/// - district committee → group → sub-group → members
/// - district committee top-level members list (year-scoped)
///
/// Caller configures the endpoint URLs and field name overrides; the form
/// handles search, member-lock/unlock, photo upload, and the POST/PUT.
class CommitteeMemberFormScreen extends StatefulWidget {
  final String title;

  /// GET endpoint for member search. Receives `?search=` query.
  final String searchEndpoint;

  /// POST endpoint to create a member.
  final String createEndpoint;

  /// PUT endpoint template for updating a member by id.
  final String Function(int id) updateEndpointBuilder;

  /// POST endpoint to upload a member photo. Returns `{path: ...}`.
  final String photoUploadEndpoint;

  /// Body field name for designation. Some screens send `districtDesignation`.
  final String designationField;

  /// Body field name for remark. Some screens send `districtRemark`.
  final String remarkField;

  /// Optional year picker (only the year-scoped committee_members screen).
  final List<CommitteeMemberYearOption>? years;
  final int? defaultYearId;

  final CommitteeMemberFormInitial? initial;

  const CommitteeMemberFormScreen({
    super.key,
    required this.title,
    required this.searchEndpoint,
    required this.createEndpoint,
    required this.updateEndpointBuilder,
    required this.photoUploadEndpoint,
    this.designationField = 'designation',
    this.remarkField = 'remark',
    this.years,
    this.defaultYearId,
    this.initial,
  });

  @override
  State<CommitteeMemberFormScreen> createState() =>
      _CommitteeMemberFormScreenState();
}

class _CommitteeMemberFormScreenState extends State<CommitteeMemberFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _mobileCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _designationCtrl = TextEditingController();
  final _clubCtrl = TextEditingController();
  final _remarkCtrl = TextEditingController();
  final _searchCtrl = TextEditingController();

  bool _isMember = false;
  int? _memberId;
  String? _memberLockedName;
  String _profilePhoto = '';
  int? _yearId;

  bool _uploading = false;
  bool _saving = false;
  bool _searching = false;
  List<CommitteeSearchResult> _searchResults = const [];
  Timer? _debounce;

  bool get _isEdit => widget.initial != null;
  bool get _busy => _saving || _uploading;

  @override
  void initState() {
    super.initState();
    final init = widget.initial;
    if (init != null) {
      _nameCtrl.text = init.name;
      _mobileCtrl.text = init.mobile;
      _emailCtrl.text = init.email;
      _designationCtrl.text = init.designation;
      _clubCtrl.text = init.clubName;
      _remarkCtrl.text = init.remark;
      _profilePhoto = init.profilePhoto;
      _isMember = init.isMember;
      _memberId = init.memberId;
      _memberLockedName = init.isMember ? init.name : null;
    }
    _yearId = widget.defaultYearId;
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _nameCtrl.dispose();
    _mobileCtrl.dispose();
    _emailCtrl.dispose();
    _designationCtrl.dispose();
    _clubCtrl.dispose();
    _remarkCtrl.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  // ── Search ─────────────────────────────────────────────────────────────

  void _onSearchChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () => _runSearch(v));
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
        queryParams: {'search': q.trim()},
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? const [])
          .map((e) => CommitteeSearchResult.fromJson(e as Map<String, dynamic>))
          .toList();
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

  void _selectSearchResult(CommitteeSearchResult r) {
    setState(() {
      _isMember = true;
      _memberId = r.memberId;
      _memberLockedName = r.name;
      _nameCtrl.text = r.name;
      _mobileCtrl.text = r.mobile;
      _emailCtrl.text = r.email;
      _clubCtrl.text = r.clubName;
      if (r.profilePhoto.isNotEmpty) _profilePhoto = r.profilePhoto;
      _searchCtrl.clear();
      _searchResults = const [];
    });
  }

  void _clearMemberLink() {
    setState(() {
      _isMember = false;
      _memberId = null;
      _memberLockedName = null;
      _nameCtrl.clear();
      _mobileCtrl.clear();
      _emailCtrl.clear();
      _clubCtrl.clear();
      _profilePhoto = '';
    });
  }

  // ── Photo ──────────────────────────────────────────────────────────────

  Future<void> _pickPhoto() async {
    final picker = ImagePicker();
    final picked =
        await picker.pickImage(source: ImageSource.gallery, imageQuality: 85, maxWidth: 2560, maxHeight: 2560);
    if (picked == null) return;
    setState(() => _uploading = true);
    try {
      final resp = await _api.uploadFile<Map<String, dynamic>>(
        // Route member photos to /Documents/directory/ so they match how the
        // committee GET reconstructs member photo paths. uploadFile takes no
        // queryParams, so pass isMember on the path. (No clubId in this form →
        // non-member photos keep the district-group default, unchanged.)
        '${widget.photoUploadEndpoint}?isMember=$_isMember',
        filePath: picked.path,
        fieldName: 'file',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final newPath = (resp.data?['path'] as String?) ?? '';
      if (newPath.isNotEmpty) {
        setState(() => _profilePhoto = newPath);
      }
    } catch (e) {
      _showError('Upload failed: $e');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final body = <String, dynamic>{
      'isMember': _isMember,
      'memberId': _isMember ? _memberId : null,
      'name': _nameCtrl.text.trim(),
      'mobile': _mobileCtrl.text.trim(),
      'email': _emailCtrl.text.trim(),
      widget.designationField: _designationCtrl.text.trim(),
      'clubName': _clubCtrl.text.trim(),
      widget.remarkField: _remarkCtrl.text.trim(),
      'profilePhoto': _profilePhoto,
      if (widget.years != null) 'yearId': _yearId,
    };
    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await _api.put(
          widget.updateEndpointBuilder(widget.initial!.id),
          body: body,
        );
      } else {
        await _api.post(widget.createEndpoint, body: body);
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      _showError('Save failed: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _showError(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).clearSnackBars();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: AppColors.error),
    );
  }

  String? _photoUrl(String path) {
    if (path.isEmpty) return null;
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
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit ${widget.title}' : 'Add ${widget.title}',
        onBack: _busy ? null : () => Navigator.of(context).pop(false),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: TextButton(
              onPressed: _busy ? null : _save,
              style: TextButton.styleFrom(
                backgroundColor: AppColors.goldPrime,
                foregroundColor: AppColors.darkBg,
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
      body: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
            if (!_isEdit) ..._buildSearchBlock(),
            CustomTextField(
              label: 'Name *',
              controller: _nameCtrl,
              hint: 'Full name',
              enabled: !_isMember,
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Name is required' : null,
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Mobile',
              controller: _mobileCtrl,
              hint: '10-digit mobile number',
              keyboardType: TextInputType.phone,
              enabled: !_isMember,
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? null : Validators.phone(v),
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Email',
              controller: _emailCtrl,
              hint: 'email@example.com',
              keyboardType: TextInputType.emailAddress,
              enabled: !_isMember,
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? null : Validators.email(v),
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Designation',
              controller: _designationCtrl,
              hint: 'e.g. Chair',
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Club Name',
              controller: _clubCtrl,
              hint: 'Rotary Club of ...',
              enabled: !_isMember,
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Remark',
              controller: _remarkCtrl,
              hint: 'Optional notes',
              maxLines: 3,
            ),
            if (widget.years != null) ...[
              const SizedBox(height: 12),
              DropdownButtonFormField<int>(
                initialValue: _yearId,
                decoration: InputDecoration(
                  labelText: 'Rotary Year',
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10)),
                ),
                items: widget.years!
                    .map((y) => DropdownMenuItem(
                          value: y.id,
                          child: Text(
                              '${y.yearLabel}${y.isCurrent ? " (Current)" : ""}'),
                        ))
                    .toList(),
                onChanged:
                    _busy ? null : (v) => setState(() => _yearId = v),
                validator: (v) => v == null ? 'Year is required' : null,
              ),
            ],
            const SizedBox(height: 16),
            _buildPhotoBlock(),
          ],
        ),
        ),
      ),
    );
  }

  List<Widget> _buildSearchBlock() {
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
          border:
              OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
      if (_searchResults.isNotEmpty) ...[
        const SizedBox(height: 6),
        Container(
          constraints: const BoxConstraints(maxHeight: 240),
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
                  radius: 18,
                  backgroundColor:
                      AppColors.primary.withValues(alpha: 0.15),
                  backgroundImage:
                      url != null ? NetworkImage(url) : null,
                  child: url == null
                      ? Text(
                          _initials(r.name),
                          style: const TextStyle(
                            color: AppColors.primary,
                            fontWeight: FontWeight.bold,
                            fontSize: 12,
                          ),
                        )
                      : null,
                ),
                title:
                    Text(r.name, style: AppTextStyles.bodyMedium),
                subtitle: Text(
                  [
                    if (r.mobile.isNotEmpty) r.mobile,
                    if (r.clubName.isNotEmpty) r.clubName,
                  ].join(' · '),
                  style: AppTextStyles.caption
                      .copyWith(color: AppColors.textSecondary),
                ),
                onTap: () => _selectSearchResult(r),
              );
            },
          ),
        ),
      ],
      if (_isMember && _memberLockedName != null) ...[
        const SizedBox(height: 8),
        Container(
          padding:
              const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: AppColors.success.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
                color: AppColors.success.withValues(alpha: 0.4)),
          ),
          child: Row(
            children: [
              const Icon(Icons.check_circle,
                  size: 16, color: AppColors.success),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Member selected: $_memberLockedName',
                  style: AppTextStyles.caption
                      .copyWith(color: AppColors.success),
                ),
              ),
              TextButton(
                onPressed: _busy ? null : _clearMemberLink,
                style: TextButton.styleFrom(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8),
                  minimumSize: const Size(0, 28),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Text('Clear'),
              ),
            ],
          ),
        ),
      ],
      const SizedBox(height: 16),
    ];
  }

  Widget _buildPhotoBlock() {
    final url = _photoUrl(_profilePhoto);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(10),
        color: AppColors.surface,
      ),
      child: Row(
        children: [
          Container(
            width: 80,
            height: 80,
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
                    errorBuilder: (_, __, ___) => const Center(
                      child: const Icon(Icons.person,
                          size: 36, color: AppColors.primary),
                    ),
                  )
                : const Center(
                    child: const Icon(Icons.person,
                        size: 36, color: AppColors.primary),
                  ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Photo',
                    style: AppTextStyles.bodyMedium
                        .copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    icon: _uploading
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.upload, size: 18),
                    label: Text(
                      _uploading
                          ? 'Uploading...'
                          : (_profilePhoto.isEmpty
                              ? 'Pick Photo'
                              : 'Replace'),
                    ),
                    onPressed: _busy ? null : _pickPhoto,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
