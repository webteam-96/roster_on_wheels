import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import '../../../../../core/constants/app_constants.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../core/utils/date_formatter.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import '../../../../../presentation/widgets/common/custom_button.dart';
import '../../../../../presentation/widgets/common/custom_text_field.dart';
import '../../../../../presentation/widgets/common/loading_widget.dart';
import '../../../../../presentation/widgets/common/empty_state_widget.dart';
import '../../../../../presentation/widgets/common/confirmation_dialog.dart';
import '../../../districts/modules/district_rni_camp_attendance_screen.dart';
import '../../../../../presentation/widgets/common/pagination_widget.dart';
import '../../../../widgets/detail/detail_widgets.dart';

// Local multipart helper supporting POST/PUT with form fields + optional file.
// ApiClient.uploadFile only supports POST, so PUT (edit) needs this helper.
Future<Map<String, dynamic>> _sendMultipart({
  required String method, // 'POST' | 'PUT'
  required String path,
  required Map<String, String> fields,
  String? filePath,
  String fileFieldName = 'logo',
}) async {
  // resetOnError:false so a transient keystore hiccup can't silently DELETE the
  // auth token (see AuthProvider). Read is guarded so a failure here degrades to
  // an unauth attempt instead of throwing — the token itself is left intact.
  const storage = FlutterSecureStorage(
    aOptions: AndroidOptions(resetOnError: false),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );
  String? token;
  try {
    token = await storage.read(key: AppConstants.tokenKey);
  } catch (_) {
    token = null;
  }
  final url = Uri.parse('${ApiConstants.baseUrl}$path');
  final request = http.MultipartRequest(method, url);
  if (token != null) request.headers['Authorization'] = 'Bearer $token';
  request.fields.addAll(fields);
  if (filePath != null && filePath.isNotEmpty) {
    request.files
        .add(await http.MultipartFile.fromPath(fileFieldName, filePath));
  }
  final streamed = await request.send();
  final response = await http.Response.fromStream(streamed);
  if (response.statusCode >= 200 && response.statusCode < 300) {
    if (response.body.isEmpty) return {};
    final decoded = jsonDecode(response.body);
    return decoded is Map<String, dynamic> ? decoded : {'data': decoded};
  }
  String msg = 'Save failed (${response.statusCode})';
  try {
    final d = jsonDecode(response.body);
    if (d is Map && d['message'] != null) msg = d['message'].toString();
  } catch (_) {}
  throw ApiException(msg, statusCode: response.statusCode);
}

class PphCampsScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  final bool viewOnly;
  const PphCampsScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<PphCampsScreen> createState() => _PphCampsScreenState();
}

class _PphCampsScreenState extends State<PphCampsScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();

  List<dynamic> _camps = [];
  bool _loading = true;
  int _currentPage = 1;
  int _totalPages = 1;

  @override
  void initState() {
    super.initState();
    _loadCamps();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadCamps({int page = 1}) async {
    setState(() => _loading = true);
    try {
      // Backend GET /api/clubs/{id}/pph-camps doesn't accept a `search`
      // query — it ignored the param and returned every camp, which made
      // the search box look broken. Fetch the full list and filter the
      // results client-side via the `_filtered` getter instead.
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/pph-camps',
        fromJson: (json) => json,
      );
      if (resp.data != null) {
        setState(() {
          _camps = resp.data is List
              ? resp.data as List<dynamic>
              : (resp.data as Map<String, dynamic>)['items'] as List<dynamic>? ?? [];
          _currentPage = 1;
          _totalPages = 1;
        });
      }
    } catch (e) {
      SnackbarUtils.showError(context, 'Failed to load PPH camps');
    } finally {
      setState(() => _loading = false);
    }
  }

  /// Camps filtered by the current search term (client-side — the backend
  /// doesn't support a search query). Matches against title, address,
  /// description and date — the same keys `_buildCard` reads from.
  List<dynamic> get _filteredCamps {
    final q = _searchCtrl.text.trim().toLowerCase();
    if (q.isEmpty) return _camps;
    return _camps.where((c) {
      if (c is! Map<String, dynamic>) return false;
      final title =
          (c['title'] ?? c['campName'] ?? c['name'] ?? '').toString().toLowerCase();
      final address =
          (c['address'] ?? c['location'] ?? '').toString().toLowerCase();
      final description =
          (c['description'] ?? c['notes'] ?? '').toString().toLowerCase();
      final date = (c['campDate'] ?? c['date'] ?? '').toString().toLowerCase();
      return title.contains(q) ||
          address.contains(q) ||
          description.contains(q) ||
          date.contains(q);
    }).toList();
  }

  Future<void> _delete(int id, [int attendanceCount = 0]) async {
    if (attendanceCount > 0) {
      await showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Cannot Delete'),
          content: Text(
            'This camp has $attendanceCount attendance record${attendanceCount == 1 ? '' : 's'}. '
            'Please delete all attendance records first before deleting this camp.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('OK'),
            ),
          ],
        ),
      );
      return;
    }
    final confirmed = await ConfirmationDialog.show(
      context,
      title: 'Delete Camp',
      message: 'Are you sure you want to delete this PPH camp?',
    );
    if (confirmed != true) return;
    try {
      await _api.delete('/api/clubs/${widget.clubId}/pph-camps/$id');
      SnackbarUtils.showSuccess(context, 'Camp deleted');
      _loadCamps(page: _currentPage);
    } catch (e) {
      SnackbarUtils.showError(context, 'Failed to delete');
    }
  }

  void _openDetail(Map<String, dynamic> camp) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _PphCampDetailScreen(camp: camp),
      ),
    );
  }

  void _openForm({Map<String, dynamic>? camp}) {
    Navigator.of(context).push(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _CampFormSheet(
          clubId: widget.clubId,
          camp: camp,
          onSaved: () => _loadCamps(page: _currentPage),
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
      appBar: widget.embedded ? null : const CustomAppBar(title: 'PPH Camps'),
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
                // Search bar always rendered — previously it was hidden
                // inside the non-empty branch, so a search that filtered
                // every camp out left the user with no way to clear it.
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                  child: TextField(
                    controller: _searchCtrl,
                    decoration: InputDecoration(
                      hintText: 'Search camps...',
                      prefixIcon: const Icon(Icons.search, size: 20),
                      suffixIcon: _searchCtrl.text.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear, size: 18),
                              onPressed: () {
                                _searchCtrl.clear();
                                setState(() {});
                              },
                            )
                          : null,
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 10),
                      border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8)),
                    ),
                    // Filter on every keystroke (matches the attendance
                    // search behaviour) rather than only on Enter.
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                Expanded(
                  child: _camps.isEmpty
                      ? const EmptyStateWidget(title: 'No PPH camps recorded')
                      : _filteredCamps.isEmpty
                          ? EmptyStateWidget(
                              title: 'No matches',
                              subtitle:
                                  'No camps match "${_searchCtrl.text.trim()}".',
                            )
                          : RefreshIndicator(
                              onRefresh: () =>
                                  _loadCamps(page: _currentPage),
                              child: ListView.builder(
                                padding: const EdgeInsets.all(16),
                                itemCount: _filteredCamps.length + 1,
                                itemBuilder: (_, i) {
                                  if (i == 0) return _buildReferenceCard();
                                  return Padding(
                                    padding:
                                        const EdgeInsets.only(bottom: 8),
                                    child:
                                        _buildCard(_filteredCamps[i - 1]),
                                  );
                                },
                              ),
                            ),
                ),
                if (_searchCtrl.text.isEmpty && _totalPages > 1)
                  PaginationWidget(
                    currentPage: _currentPage,
                    totalPages: _totalPages,
                    totalCount: 0,
                    onLoadMore: () => _loadCamps(page: _currentPage + 1),
                  ),
              ],
            ),
    );
  }

  Widget _buildReferenceCard() {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: Colors.blue.shade50,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: Colors.blue.shade200),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.info_outline, size: 18, color: Colors.blue.shade700),
                const SizedBox(width: 8),
                Text('Reference Parameters',
                    style: AppTextStyles.body.copyWith(
                        fontWeight: FontWeight.w700, color: Colors.blue.shade800)),
              ],
            ),
            const SizedBox(height: 8),
            _refRow('Fasting Blood Sugar', '< 100 mg/dl'),
            _refRow('Random Blood Sugar', '< 140 mg/dl'),
            _refRow('Blood Pressure', '< 130/90 mm Hg'),
            _refRow('BMI', '< 25'),
          ],
        ),
      ),
    );
  }

  Widget _refRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: AppTextStyles.caption.copyWith(color: Colors.blue.shade700)),
          Text(value, style: AppTextStyles.caption.copyWith(
              fontWeight: FontWeight.w600, color: Colors.blue.shade800)),
        ],
      ),
    );
  }

  Future<void> _toggleActive(int campId) async {
    try {
      await _api.put('/api/clubs/${widget.clubId}/pph-camps/$campId/toggle-active');
      _loadCamps(page: _currentPage);
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to toggle status');
    }
  }

  Widget _buildCard(Map<String, dynamic> camp) {
    final campDate = camp['campDate']?.toString();
    final attendeeCount = (camp['attendanceCount'] ?? camp['attendeeCount']) as int? ?? 0;
    final address = (camp['address'] ?? camp['location'])?.toString() ?? '';
    final title = (camp['title'] ?? camp['campName'])?.toString() ?? '';
    final description = (camp['description'] ?? camp['notes'])?.toString() ?? '';
    final isActive = camp['isActive'] as bool? ?? true;
    final logoPath = (camp['campLogoPath'] ?? camp['logo'] ?? camp['logoPath'])?.toString();

    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _openDetail(camp),
        child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (logoPath != null && logoPath.isNotEmpty)
            ClipRRect(
              borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
              // Keep the image slot a FIXED 160px in every state (loading,
              // loaded, error). Previously `errorBuilder` collapsed a broken
              // logo to height 0, so as `ListView.builder` recycled off-screen
              // cards the total scroll extent kept changing — the list would
              // jump back down when you scrolled up. A stable height fixes it.
              child: SizedBox(
                height: 160,
                width: double.infinity,
                child: Image.network(
                  logoPath.startsWith('http')
                      ? logoPath
                      : '${ApiConstants.baseUrl}${logoPath.startsWith('/') ? '' : '/'}$logoPath',
                  fit: BoxFit.cover,
                  loadingBuilder: (_, child, progress) => progress == null
                      ? child
                      : Container(
                          color: Colors.grey.shade100,
                          alignment: Alignment.center,
                          child: const SizedBox(
                            width: 22,
                            height: 22,
                            child:
                                CircularProgressIndicator(strokeWidth: 2),
                          ),
                        ),
                  errorBuilder: (_, __, ___) => Container(
                    color: Colors.grey.shade100,
                    alignment: Alignment.center,
                    child: Icon(Icons.local_hospital,
                        color: Colors.green.withOpacity(0.35), size: 40),
                  ),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.green.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.local_hospital, color: Colors.green, size: 24),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              title,
                              style: AppTextStyles.body.copyWith(fontWeight: FontWeight.w600),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: isActive
                                  ? Colors.green.withOpacity(0.1)
                                  : Colors.grey.withOpacity(0.1),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              isActive ? 'Active' : 'Inactive',
                              style: AppTextStyles.caption.copyWith(
                                color: isActive ? Colors.green.shade800 : Colors.grey.shade600,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          if (campDate != null) ...[
                            const Icon(Icons.calendar_today, size: 14, color: Colors.grey),
                            const SizedBox(width: 4),
                            Text(DateFormatter.toDisplay(DateTime.tryParse(campDate)),
                                style:
                                    AppTextStyles.caption.copyWith(color: Colors.grey[600])),
                            const SizedBox(width: 12),
                          ],
                          if (address.isNotEmpty) ...[
                            const Icon(Icons.location_on, size: 14, color: Colors.grey),
                            const SizedBox(width: 4),
                            Flexible(
                              child: Text(address,
                                  style: AppTextStyles.caption
                                      .copyWith(color: Colors.grey[600]),
                                  overflow: TextOverflow.ellipsis),
                            ),
                          ],
                        ],
                      ),
                      if (description.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(description,
                            style: AppTextStyles.caption.copyWith(color: Colors.grey[600]),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis),
                      ],
                      const SizedBox(height: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          border: Border.all(color: Colors.grey.shade300),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text('$attendeeCount Attendees',
                            style: AppTextStyles.caption.copyWith(color: Colors.grey[700])),
                      ),
                    ],
                  ),
                ),
                PopupMenuButton<String>(
                  onSelected: (v) {
                    if (v == 'edit') _openForm(camp: camp);
                    if (v == 'delete') _delete(camp['id'] as int, attendeeCount);
                    if (v == 'toggle') _toggleActive(camp['id'] as int);
                    if (v == 'attendance') {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => PphCampAttendeesScreen(
                            campBase:
                                '/api/clubs/${widget.clubId}/pph-camps/${camp['id']}',
                            title: title,
                            canManage: canManage,
                          ),
                        ),
                      );
                    }
                  },
                  itemBuilder: (_) => [
                    if (canManage)
                      const PopupMenuItem(value: 'edit', child: Text('Edit')),
                    if (canManage)
                      PopupMenuItem(
                        value: 'toggle',
                        child: Text(isActive ? 'Deactivate' : 'Activate'),
                      ),
                    const PopupMenuItem(value: 'attendance', child: Text('View Attendance')),
                    if (canManage)
                      const PopupMenuItem(
                        value: 'delete',
                        child: Text('Delete', style: TextStyle(color: Colors.red)),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],
        ),
      ),
    );
  }
}

// ── Detail Page (read-only, shared detail toolkit) ─────────────────────────────
class _PphCampDetailScreen extends StatelessWidget {
  final Map<String, dynamic> camp;
  const _PphCampDetailScreen({required this.camp});

  static final _dateFmt = DateFormat('dd MMM yyyy');

  String _fmtDate(String? iso) {
    if (iso == null || iso.isEmpty) return '';
    final dt = DateTime.tryParse(iso);
    if (dt == null || dt.year <= 1) return '';
    return _dateFmt.format(dt.toLocal());
  }

  @override
  Widget build(BuildContext context) {
    final name = (camp['title'] ?? camp['campName'] ?? camp['name'])
            ?.toString() ??
        '';
    final address =
        (camp['address'] ?? camp['location'])?.toString() ?? '';
    final description =
        (camp['description'] ?? camp['notes'])?.toString() ?? '';
    final date = _fmtDate((camp['campDate'] ?? camp['date'])?.toString());
    final attendanceCount =
        (camp['attendanceCount'] ?? camp['attendeeCount']) as int?;
    final logoPath =
        (camp['campLogoPath'] ?? camp['logo'] ?? camp['logoPath'])?.toString();
    final imageUrl = detailMediaUrl(logoPath);

    return DetailScaffold(
      title: 'PPH Camp',
      loading: false,
      error: null,
      onRetry: () {},
      body: (_) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          DetailHeader(
            title: name.isEmpty ? '(Untitled)' : name,
            meta: date.isNotEmpty ? date : null,
            icon: Icons.health_and_safety_outlined,
          ),
          const SizedBox(height: 16),
          if (address.isNotEmpty || imageUrl != null)
            DetailSectionCard(
              icon: Icons.local_hospital_outlined,
              title: 'Camp Details',
              number: 1,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (address.isNotEmpty)
                    DetailRow(label: 'Location', value: address),
                  if (imageUrl != null) ...[
                    const SizedBox(height: 12),
                    const DetailFieldLabel('Logo'),
                    const SizedBox(height: 6),
                    DetailImage(url: imageUrl),
                  ],
                ],
              ),
            ),
          if (description.isNotEmpty) ...[
            const SizedBox(height: 12),
            DetailSectionCard(
              icon: Icons.notes_outlined,
              title: 'About',
              number: 2,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DetailRow(label: 'Description', value: description),
                ],
              ),
            ),
          ],
          if (attendanceCount != null) ...[
            const SizedBox(height: 12),
            DetailSectionCard(
              icon: Icons.people_outline,
              title: 'Attendance',
              number: description.isNotEmpty ? 3 : 2,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DetailRow(
                      label: 'Attendance Count', value: '$attendanceCount'),
                ],
              ),
            ),
          ],
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

// ── Form BottomSheet ──────────────────────────────────────────────────────────

class _CampFormSheet extends StatefulWidget {
  final int clubId;
  final Map<String, dynamic>? camp;
  final VoidCallback onSaved;

  const _CampFormSheet(
      {required this.clubId, required this.onSaved, this.camp});

  @override
  State<_CampFormSheet> createState() => _CampFormSheetState();
}

class _CampFormSheetState extends State<_CampFormSheet> {
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _locationCtrl = TextEditingController();
  final _notesCtrl = TextEditingController();
  DateTime? _campDate;
  bool _saving = false;
  String? _logoPath; // server-side path (existing)
  String? _localLogoPath; // newly picked local file
  bool _isActive = true;

  bool get _isEdit => widget.camp != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      _nameCtrl.text = (widget.camp!['title'] ?? widget.camp!['campName'])?.toString() ?? '';
      _locationCtrl.text = (widget.camp!['address'] ?? widget.camp!['location'])?.toString() ?? '';
      _notesCtrl.text = (widget.camp!['description'] ?? widget.camp!['notes'])?.toString() ?? '';
      final cd = widget.camp!['campDate']?.toString();
      if (cd != null) _campDate = DateTime.tryParse(cd);
      _logoPath = (widget.camp!['campLogoPath'] ?? widget.camp!['logo'] ?? widget.camp!['logoPath'])?.toString();
      _isActive = widget.camp!['isActive'] as bool? ?? true;
    }
  }

  Future<void> _pickLogo() async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(source: ImageSource.gallery, maxWidth: 2560, maxHeight: 2560);
      if (picked == null) return;
      setState(() => _localLogoPath = picked.path);
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Pick failed: $e');
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _locationCtrl.dispose();
    _notesCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _campDate ?? DateTime.now(),
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null) setState(() => _campDate = picked);
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final fields = <String, String>{
        'title': _nameCtrl.text.trim(),
        'address': _locationCtrl.text.trim(),
        'description': _notesCtrl.text.trim(),
        'isActive': _isActive.toString(),
        if (_campDate != null)
          'campDate': _campDate!.toIso8601String().split('T')[0],
      };
      if (_isEdit) {
        await _sendMultipart(
          method: 'PUT',
          path: '/api/clubs/${widget.clubId}/pph-camps/${widget.camp!['id']}',
          fields: fields,
          filePath: _localLogoPath,
          fileFieldName: 'logo',
        );
      } else {
        await _sendMultipart(
          method: 'POST',
          path: '/api/clubs/${widget.clubId}/pph-camps',
          fields: fields,
          filePath: _localLogoPath,
          fileFieldName: 'logo',
        );
      }
      if (mounted) {
        SnackbarUtils.showSuccess(context, _isEdit ? 'Updated' : 'Created');
        Navigator.pop(context);
        widget.onSaved();
      }
    } catch (e) {
      SnackbarUtils.showError(context, 'Failed to save');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit PPH Camp' : 'Add PPH Camp',
        leading: IconButton(
          icon: const Icon(Icons.close, color: Colors.white),
          onPressed: _saving ? null : () => Navigator.pop(context),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
                      CustomTextField(
                        controller: _nameCtrl,
                        label: 'Title *',
                        validator: (v) =>
                            v == null || v.trim().isEmpty ? 'Required' : null,
                      ),
                      const SizedBox(height: 16),
                      GestureDetector(
                        onTap: _pickDate,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 14),
                          decoration: BoxDecoration(
                            border: Border.all(color: Colors.grey[400]!),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('Camp Date',
                                        style: AppTextStyles.caption
                                            .copyWith(color: Colors.grey[600])),
                                    Text(
                                      _campDate != null
                                          ? DateFormatter.toDisplay(_campDate)
                                          : 'Select date',
                                      style: AppTextStyles.caption,
                                    ),
                                  ],
                                ),
                              ),
                              const Icon(Icons.calendar_today,
                                  size: 18, color: Colors.grey),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                      CustomTextField(
                        controller: _locationCtrl,
                        label: 'Address',
                        maxLines: 2,
                      ),
                      const SizedBox(height: 16),
                      CustomTextField(
                        controller: _notesCtrl,
                        label: 'Description',
                        maxLines: 3,
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          OutlinedButton.icon(
                            onPressed: _pickLogo,
                            icon: const Icon(Icons.image_outlined, size: 18),
                            label: Text(
                              (_localLogoPath != null ||
                                      (_logoPath != null && _logoPath!.isNotEmpty))
                                  ? 'Replace Logo'
                                  : 'Pick Logo',
                            ),
                          ),
                          const SizedBox(width: 12),
                          if (_localLogoPath != null)
                            ClipRRect(
                              borderRadius: BorderRadius.circular(6),
                              child: Image.file(
                                File(_localLogoPath!),
                                width: 80,
                                height: 80,
                                fit: BoxFit.cover,
                              ),
                            )
                          else if (_logoPath != null && _logoPath!.isNotEmpty)
                            ClipRRect(
                              borderRadius: BorderRadius.circular(6),
                              child: Image.network(
                                _logoPath!.startsWith('http')
                                    ? _logoPath!
                                    : '${ApiConstants.baseUrl}${_logoPath!.startsWith('/') ? '' : '/'}$_logoPath',
                                width: 80,
                                height: 80,
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) => Container(
                                  width: 80,
                                  height: 80,
                                  color: Colors.grey.shade200,
                                  child: const Icon(Icons.broken_image_outlined),
                                ),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 24),
                      CustomButton(
                        label: _isEdit ? 'Update Camp' : 'Add Camp',
                        onPressed: _saving ? null : _save,
                        isLoading: _saving,
                      ),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
              ),
    );
  }
}
