import 'dart:async';
import 'dart:io';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:image_cropper/image_cropper.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import '../../../../../presentation/widgets/common/custom_button.dart';
import '../../../../../presentation/widgets/common/loading_widget.dart';
import '../../../../../presentation/widgets/common/empty_state_widget.dart';
import '../../../../../presentation/widgets/common/confirmation_dialog.dart';

class PastPresidentsScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  final bool viewOnly;
  const PastPresidentsScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<PastPresidentsScreen> createState() => _PastPresidentsScreenState();
}

class _PastPresidentsScreenState extends State<PastPresidentsScreen> {
  final _api = ApiClient();

  List<dynamic> _presidents = [];
  List<dynamic> _allPresidents = [];
  bool _loading = true;
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _loadPresidents();
  }

  Future<void> _loadPresidents() async {
    setState(() => _loading = true);
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/past-presidents',
        fromJson: (json) => json,
      );
      if (resp.data != null) {
        final list = resp.data is List
            ? resp.data as List<dynamic>
            : (resp.data as Map<String, dynamic>)['items'] as List<dynamic>? ?? [];
        setState(() {
          _allPresidents = list;
          _applySearch();
        });
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to load past presidents');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _applySearch() {
    final q = _searchQuery.toLowerCase().trim();
    if (q.isEmpty) {
      _presidents = List.from(_allPresidents);
    } else {
      _presidents = _allPresidents.where((p) {
        final name = (p['memberName'] ?? '').toString().toLowerCase();
        final year = (p['yearLabel'] ?? '').toString().toLowerCase();
        return name.contains(q) || year.contains(q);
      }).toList();
    }
  }

  Future<void> _delete(Map<String, dynamic> president) async {
    final name = president['memberName']?.toString() ?? 'Unknown';
    final year = (president['yearLabel'] ?? '').toString();
    final confirmed = await ConfirmationDialog.show(
      context,
      title: 'Delete Past President',
      message: 'Are you sure you want to delete the record for $name ($year)?',
    );
    if (confirmed != true) return;
    try {
      await _api.delete('/api/clubs/${widget.clubId}/past-presidents/${president['id']}');
      if (mounted) SnackbarUtils.showSuccess(context, 'Record removed');
      _loadPresidents();
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to remove record');
    }
  }

  void _openForm({Map<String, dynamic>? president}) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _PresidentFormScreen(
          clubId: widget.clubId,
          president: president,
          // Pass the current records so the form can block a second PP for a
          // year that is already taken (one PP per club/year — backend rule).
          existingRecords: _allPresidents,
          onSaved: () => _loadPresidents(),
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
      appBar: widget.embedded ? null : const CustomAppBar(title: 'Past Presidents'),
      floatingActionButton: !canManage
          ? null
          : FloatingActionButton(
              onPressed: () => _openForm(),
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.add, color: Colors.white),
            ),
      body: _loading
          ? const LoadingWidget()
          : Column(
              children: [
                // Client-side search
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: TextField(
                    decoration: InputDecoration(
                      hintText: 'Search by name or year...',
                      prefixIcon: const Icon(Icons.search, size: 20),
                      isDense: true,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
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
                  child: _presidents.isEmpty
                      ? const EmptyStateWidget(title: 'No past presidents found')
                      : RefreshIndicator(
                          onRefresh: () => _loadPresidents(),
                          child: ListView.separated(
                            padding: const EdgeInsets.all(16),
                            itemCount: _presidents.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 10),
                            itemBuilder: (_, i) => _buildCard(_presidents[i]),
                          ),
                        ),
                ),
              ],
            ),
    );
  }

  Widget _buildCard(Map<String, dynamic> president) {
    final photoUrl = (president['profilePhotoPath'] ?? president['profilePhoto'])?.toString();
    final name = president['memberName']?.toString() ?? 'Unknown';
    final yearName = (president['yearLabel'] ?? president['yearName'])?.toString() ?? '';

    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            CircleAvatar(
              radius: 28,
              backgroundColor: AppColors.primary.withValues(alpha: 0.1),
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
                  Text(name,
                      style: AppTextStyles.body.copyWith(fontWeight: FontWeight.w600)),
                  if (yearName.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(yearName,
                        style: AppTextStyles.caption.copyWith(color: Colors.grey[600])),
                  ],
                ],
              ),
            ),
            if (canManage)
              PopupMenuButton<String>(
                onSelected: (v) {
                  if (v == 'edit') _openForm(president: president);
                  if (v == 'delete') _delete(president);
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'edit', child: Text('Edit')),
                  PopupMenuItem(value: 'delete', child: Text('Delete')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ── Form BottomSheet ──────────────────────────────────────────────────────────

class _PresidentFormScreen extends StatefulWidget {
  final int clubId;
  final Map<String, dynamic>? president;
  final List<dynamic> existingRecords;
  final VoidCallback onSaved;

  const _PresidentFormScreen({
    required this.clubId,
    required this.onSaved,
    required this.existingRecords,
    this.president,
  });

  @override
  State<_PresidentFormScreen> createState() => _PresidentFormScreenState();
}

class _PresidentFormScreenState extends State<_PresidentFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();

  List<dynamic> _rotaryYears = [];
  int? _memberId;
  String? _memberName;
  String? _profilePhotoPath;
  // Non-member entry name — mutually exclusive with a selected member.
  String? _nonMemberName;
  final _nonMemberNameCtrl = TextEditingController();
  // Non-member photo: a newly-picked local file (sent as the `photo` part), and
  // a flag to delete the existing server photo on save. Members never carry a
  // non-member photo — the backend ignores a photo for member entries.
  String? _pickedPhotoPath;
  bool _removePhoto = false;
  int? _yearId;
  bool _saving = false;
  bool _loadingData = true;
  bool _showMemberPicker = false;

  // Server-side member search
  final _memberSearchCtrl = TextEditingController();
  List<dynamic> _searchResults = [];
  bool _searching = false;
  Timer? _debounce;

  bool get _isEdit => widget.president != null;

  @override
  void initState() {
    super.initState();
    _loadRotaryYears();
    if (_isEdit) {
      _memberId = (widget.president!['memberId'] as num?)?.toInt();
      _memberName = (widget.president!['memberName'] ?? widget.president!['name'])?.toString();
      _yearId = (widget.president!['yearId'] as num?)?.toInt();
      _profilePhotoPath = widget.president!['profilePhotoPath']?.toString();
      // Non-member entry: memberId is null and nonMemberName carries the name.
      final nmn = widget.president!['nonMemberName']?.toString();
      if ((_memberId == null || _memberId == 0) &&
          nmn != null &&
          nmn.trim().isNotEmpty) {
        _memberId = null;
        _nonMemberName = nmn.trim();
        _nonMemberNameCtrl.text = _nonMemberName!;
      }
    }
  }

  @override
  void dispose() {
    _memberSearchCtrl.dispose();
    _nonMemberNameCtrl.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _loadRotaryYears() async {
    try {
      final resp = await _api.get('/api/rotary-years', fromJson: (j) => j);
      _rotaryYears = resp.data is List
          ? resp.data as List<dynamic>
          : (resp.data as Map<String, dynamic>?)?['items'] as List<dynamic>? ?? [];
      setState(() {});
    } catch (_) {
    } finally {
      setState(() => _loadingData = false);
    }
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
        '/api/clubs/${widget.clubId}/past-presidents/search-members',
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
      _nonMemberName = null;
      _nonMemberNameCtrl.clear();
      // A member uses their own profile photo — drop any non-member pick.
      _pickedPhotoPath = null;
      _removePhoto = false;
      _showMemberPicker = false;
      _memberSearchCtrl.clear();
      _searchResults = [];
    });
  }

  /// Record a free-text Non-Member entry (for a past president no longer in the
  /// system). Mutually exclusive with a selected member.
  void _selectNonMember(String name) {
    final t = name.trim();
    if (t.isEmpty) return;
    setState(() {
      _nonMemberName = t;
      _nonMemberNameCtrl.text = t;
      _memberId = null;
      _memberName = null;
      // Fresh non-member entry starts with no photo.
      _profilePhotoPath = null;
      _pickedPhotoPath = null;
      _removePhoto = false;
      _showMemberPicker = false;
      _memberSearchCtrl.clear();
      _searchResults = [];
    });
  }

  String get _nonMemberTrimmed => (_nonMemberName ?? '').trim();
  bool get _hasSelection => _memberId != null || _nonMemberTrimmed.isNotEmpty;

  /// True when a non-member photo is effectively set — a fresh pick, or a saved
  /// server photo not flagged for removal.
  bool get _hasAnyPhoto =>
      _pickedPhotoPath != null ||
      (!_removePhoto && (_profilePhotoPath?.isNotEmpty ?? false));

  /// Pick + square-crop a photo for a non-member past president. Held locally
  /// and sent as the `photo` multipart part on save (mirrors the profile-photo
  /// picker in profile_edit_screen.dart).
  Future<void> _pickNonMemberPhoto() async {
    try {
      final picked = await ImagePicker()
          .pickImage(source: ImageSource.gallery, maxWidth: 1200);
      if (picked == null) return;
      final cropped = await ImageCropper().cropImage(
        sourcePath: picked.path,
        aspectRatio: const CropAspectRatio(ratioX: 1, ratioY: 1),
        compressQuality: 90,
        uiSettings: [
          AndroidUiSettings(
            toolbarTitle: 'Crop Photo',
            toolbarColor: AppColors.primary,
            toolbarWidgetColor: Colors.white,
            activeControlsWidgetColor: AppColors.primary,
            lockAspectRatio: true,
            initAspectRatio: CropAspectRatioPreset.square,
            aspectRatioPresets: const [CropAspectRatioPreset.square],
          ),
          IOSUiSettings(
            title: 'Crop Photo',
            aspectRatioLockEnabled: true,
            aspectRatioPresets: const [CropAspectRatioPreset.square],
          ),
        ],
      );
      if (cropped == null) return;
      setState(() {
        _pickedPhotoPath = cropped.path;
        _removePhoto = false;
      });
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Could not pick photo');
    }
  }

  /// Remove the shown photo: first tap discards a fresh pick (reverting to the
  /// saved photo, if any); otherwise flags the existing server photo for
  /// deletion (`removePhoto` on save).
  void _clearNonMemberPhoto() {
    setState(() {
      if (_pickedPhotoPath != null) {
        _pickedPhotoPath = null;
      } else if (_profilePhotoPath != null && _profilePhotoPath!.isNotEmpty) {
        _removePhoto = true;
      }
    });
  }

  /// A rotary year is "past" iff its end date is strictly before now. Mirrors
  /// the backend rule (`EndDate < CURDATE()`) and the web filter.
  bool _isPastYear(dynamic y) {
    final end = DateTime.tryParse((y is Map ? y['endDate'] : null)?.toString() ?? '');
    if (end == null) return false;
    return end.isBefore(DateTime.now());
  }

  /// One Past President per (club, year). Returns the conflicting record if the
  /// chosen year is already taken by another member, else null. Mirrors the web
  /// pre-check so the user sees a clear message before the network round-trip.
  Map<String, dynamic>? _yearConflict() {
    final editingId =
        _isEdit ? (widget.president!['id'] as num?)?.toInt() : null;
    for (final r in widget.existingRecords) {
      if (r is! Map) continue;
      final ry = (r['yearId'] as num?)?.toInt();
      final rid = (r['id'] as num?)?.toInt();
      if (ry == _yearId && rid != editingId) {
        return Map<String, dynamic>.from(r);
      }
    }
    return null;
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (!_hasSelection) {
      setState(() => _showMemberPicker = true);
      return;
    }
    if (_yearId == null) return;

    // Block a duplicate before hitting the API (one PP per club/year).
    final conflict = _yearConflict();
    if (conflict != null) {
      final cName =
          (conflict['memberName'] ?? conflict['name'] ?? 'another member')
              .toString();
      final cYear =
          (conflict['yearLabel'] ?? conflict['yearName'] ?? 'this year')
              .toString();
      SnackbarUtils.showError(
        context,
        'A Past President ($cName) already exists for $cYear. '
        'Only one is allowed per year.',
      );
      return;
    }

    setState(() => _saving = true);
    try {
      // The backend create/update endpoints are multipart/form-data (they carry
      // an optional non-member `photo` file), so send the fields as a form —
      // a JSON body would bind to an empty DTO against [FromForm] and 500.
      // Send only the fields that apply: exactly one of memberId / nonMemberName
      // per the backend rule, and omit the other so it binds to null.
      final fields = <String, String>{'yearId': '$_yearId'};
      final files = <String, String>{};
      if (_memberId != null) {
        fields['memberId'] = '$_memberId';
      } else if (_nonMemberTrimmed.isNotEmpty) {
        fields['nonMemberName'] = _nonMemberTrimmed;
        // Photo is honoured for non-member entries only: send a new pick as the
        // `photo` part, or (on edit) flag the existing one for removal.
        if (_pickedPhotoPath != null) {
          files['photo'] = _pickedPhotoPath!;
        } else if (_isEdit && _removePhoto) {
          fields['removePhoto'] = 'true';
        }
      }
      if (_isEdit) {
        await _api.sendMultipart(
          '/api/clubs/${widget.clubId}/past-presidents/${widget.president!['id']}',
          method: 'PUT',
          fields: fields,
          files: files.isEmpty ? null : files,
        );
      } else {
        await _api.sendMultipart(
          '/api/clubs/${widget.clubId}/past-presidents',
          method: 'POST',
          fields: fields,
          files: files.isEmpty ? null : files,
        );
      }
      if (mounted) {
        SnackbarUtils.showSuccess(context, _isEdit ? 'Updated' : 'Added');
        Navigator.pop(context);
        widget.onSaved();
      }
    } catch (e) {
      if (mounted) {
        // The backend returns a precise message (duplicate year, or
        // current/future year not allowed) — surface it directly.
        SnackbarUtils.showError(
            context, e is ApiException ? e.message : 'Failed to save');
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Past President' : 'Add Past President',
      ),
      body: _loadingData
          ? const LoadingWidget()
          : SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
              child: Form(
                key: _formKey,
                autovalidateMode: AutovalidateMode.onUserInteraction,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                        // ── Member / Non-Member section ──
                        if (_memberId != null && !_showMemberPicker) ...[
                          // Selected MEMBER
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: AppColors.primaryLight,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Row(
                              children: [
                                ClipOval(
                                  child: _profilePhotoPath != null &&
                                          _profilePhotoPath!.isNotEmpty
                                      ? CachedNetworkImage(
                                          imageUrl:
                                              '${ApiConstants.mediaBaseUrl}$_profilePhotoPath',
                                          width: 48,
                                          height: 48,
                                          fit: BoxFit.cover,
                                          errorWidget: (_, __, ___) =>
                                              _avatarFallback(),
                                        )
                                      : _avatarFallback(),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        _memberName ?? 'Selected Member',
                                        style: AppTextStyles.body.copyWith(
                                            fontWeight: FontWeight.w700),
                                      ),
                                      const SizedBox(height: 4),
                                      GestureDetector(
                                        onTap: () => setState(
                                            () => _showMemberPicker = true),
                                        child: const Text(
                                          'Change',
                                          style: const TextStyle(
                                            color: AppColors.primary,
                                            fontWeight: FontWeight.w600,
                                            fontSize: 13,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                _typeBadge('Member', AppColors.success),
                              ],
                            ),
                          ),
                        ] else if (_nonMemberTrimmed.isNotEmpty &&
                            !_showMemberPicker) ...[
                          // Selected NON-MEMBER — a tappable photo avatar plus a
                          // full-width name field (the old single-row layout
                          // squeezed the name and hid the photo control).
                          Container(
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
                                    _nonMemberAvatar(),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            children: [
                                              _typeBadge('Non-Member',
                                                  Colors.grey.shade600),
                                              const Spacer(),
                                              GestureDetector(
                                                onTap: () => setState(() =>
                                                    _showMemberPicker = true),
                                                child: const Text(
                                                  'Change',
                                                  style: const TextStyle(
                                                    color: AppColors.primary,
                                                    fontWeight: FontWeight.w600,
                                                    fontSize: 13,
                                                  ),
                                                ),
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 4),
                                          Text(
                                            _hasAnyPhoto
                                                ? 'Tap the photo to change it.'
                                                : 'Tap the photo to add one (optional).',
                                            style: AppTextStyles.caption.copyWith(
                                                color: AppColors.textSecondary),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                TextField(
                                  controller: _nonMemberNameCtrl,
                                  textCapitalization:
                                      TextCapitalization.words,
                                  style: AppTextStyles.body.copyWith(
                                      fontWeight: FontWeight.w700),
                                  decoration: InputDecoration(
                                    labelText: 'Name',
                                    isDense: true,
                                    filled: true,
                                    fillColor: Colors.white,
                                    contentPadding:
                                        const EdgeInsets.symmetric(
                                            horizontal: 12, vertical: 14),
                                    border: OutlineInputBorder(
                                        borderRadius:
                                            BorderRadius.circular(10)),
                                    enabledBorder: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(10),
                                      borderSide: BorderSide(
                                          color: Colors.grey.shade300),
                                    ),
                                  ),
                                  onChanged: (v) =>
                                      setState(() => _nonMemberName = v),
                                ),
                                if (_hasAnyPhoto) ...[
                                  const SizedBox(height: 4),
                                  Align(
                                    alignment: Alignment.centerLeft,
                                    child: TextButton.icon(
                                      onPressed: _clearNonMemberPhoto,
                                      style: TextButton.styleFrom(
                                        foregroundColor: AppColors.error,
                                        padding: EdgeInsets.zero,
                                        minimumSize: const Size(0, 32),
                                        tapTargetSize:
                                            MaterialTapTargetSize.shrinkWrap,
                                      ),
                                      icon: const Icon(Icons.delete_outline,
                                          size: 18),
                                      label: const Text('Remove photo'),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ] else ...[
                          TextField(
                            controller: _memberSearchCtrl,
                            decoration: InputDecoration(
                              hintText: 'Search club members...',
                              prefixIcon: const Icon(Icons.search, size: 20),
                              isDense: true,
                              border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(8)),
                            ),
                            onChanged: _onSearchChanged,
                          ),
                          const SizedBox(height: 4),
                          if (_searching)
                            const Padding(
                              padding: EdgeInsets.all(8),
                              child: Center(
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2)),
                            )
                          else if (_memberSearchCtrl.text.trim().isNotEmpty)
                            _searchResultsBox(_memberSearchCtrl.text.trim()),
                          if (!_hasSelection)
                            Padding(
                              padding: const EdgeInsets.only(top: 6),
                              child: Text(
                                'Pick a member, or add a non-member if the '
                                'person isn’t in the system.',
                                style: TextStyle(
                                    color: Colors.grey.shade600, fontSize: 12),
                              ),
                            ),
                        ],
                        const SizedBox(height: 16),
                        DropdownButtonFormField<int>(
                          initialValue: _yearId,
                          decoration: InputDecoration(
                            labelText: 'Rotary Year *',
                            helperText:
                                'Past years only: the current and future years are not allowed.',
                            border:
                                OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                          ),
                          // Past years only (current + future are intentionally
                          // hidden — backend rejects them). When editing, also keep
                          // the row's existing year even if it is no longer past, so
                          // the dropdown value stays valid.
                          items: _rotaryYears
                              .where((y) =>
                                  _isPastYear(y) ||
                                  (_isEdit && (y['id'] as int?) == _yearId))
                              .map((y) => DropdownMenuItem<int>(
                                    value: y['id'] as int?,
                                    child: Text((y['yearLabel'] ?? y['yearName'])?.toString() ?? ''),
                                  ))
                              .toList(),
                          onChanged: (v) => setState(() => _yearId = v),
                          validator: (v) => v == null ? 'Please select a year' : null,
                        ),
                        const SizedBox(height: 24),
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
                                label: _isEdit ? 'Update' : 'Add',
                                onPressed: (_saving || !_hasSelection || _yearId == null)
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

  /// Member search dropdown: matching members + an "Add as Non-Member" row.
  Widget _searchResultsBox(String query) {
    return Container(
      constraints: const BoxConstraints(maxHeight: 220),
      decoration: BoxDecoration(
        border: Border.all(color: Colors.grey.shade300),
        borderRadius: BorderRadius.circular(8),
      ),
      child: ListView(
        shrinkWrap: true,
        padding: EdgeInsets.zero,
        children: [
          for (final r in _searchResults)
            if (r is Map<String, dynamic>) _memberResultTile(r),
          // Non-member fallback — always offered while a query is present.
          _nonMemberResultTile(query),
        ],
      ),
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
          child: Icon(Icons.person_add_alt_1,
              size: 18, color: Colors.grey.shade500),
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
        style: TextStyle(
            fontSize: 10, fontWeight: FontWeight.w700, color: color),
      ),
    );
  }

  Widget _avatarFallback() => Container(
        width: 48,
        height: 48,
        color: AppColors.primaryLight,
        child: const Icon(Icons.person, size: 24, color: AppColors.primary),
      );

  // Tappable circular photo control for a NON-MEMBER past president. Shows the
  // fresh pick > saved server photo > an "add photo" hint, with a small camera
  // badge to signal it's tappable. Tap → pick + square-crop.
  Widget _nonMemberAvatar() {
    final hasNew = _pickedPhotoPath != null;
    final hasExisting =
        !_removePhoto && (_profilePhotoPath?.isNotEmpty ?? false);

    Widget inner;
    if (hasNew) {
      inner = Image.file(File(_pickedPhotoPath!),
          width: 64, height: 64, fit: BoxFit.cover);
    } else if (hasExisting) {
      inner = CachedNetworkImage(
        imageUrl: '${ApiConstants.mediaBaseUrl}$_profilePhotoPath',
        width: 64,
        height: 64,
        fit: BoxFit.cover,
        errorWidget: (_, __, ___) => _addPhotoInner(),
      );
    } else {
      inner = _addPhotoInner();
    }

    return GestureDetector(
      onTap: _pickNonMemberPhoto,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.grey.shade300),
            ),
            child: ClipOval(
                child: SizedBox(width: 64, height: 64, child: inner)),
          ),
          Positioned(
            right: -2,
            bottom: -2,
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: AppColors.primary,
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white, width: 2),
              ),
              child: const Icon(Icons.camera_alt, size: 12, color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }

  Widget _addPhotoInner() => Container(
        color: Colors.white,
        alignment: Alignment.center,
        child: Icon(Icons.add_a_photo_outlined,
            color: Colors.grey.shade500, size: 22),
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
