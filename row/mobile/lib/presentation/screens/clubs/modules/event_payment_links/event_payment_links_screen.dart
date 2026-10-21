import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/constants/api_constants.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../core/utils/date_formatter.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import '../../../../../presentation/widgets/common/custom_button.dart';
import '../../../../../presentation/widgets/common/custom_text_field.dart';
import '../../../../../presentation/widgets/common/loading_widget.dart';
import '../../../../../presentation/widgets/common/empty_state_widget.dart';
import '../../../../../presentation/widgets/common/confirmation_dialog.dart';
import '../../../../../presentation/widgets/common/pagination_widget.dart';
import 'package:rotary_flutter_app/core/utils/currency_symbol.dart';

class EventPaymentLinksScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  final bool viewOnly;
  const EventPaymentLinksScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<EventPaymentLinksScreen> createState() =>
      _EventPaymentLinksScreenState();
}

class _EventPaymentLinksScreenState extends State<EventPaymentLinksScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();

  List<dynamic> _links = [];
  bool _loading = true;
  int _currentPage = 1;
  int _totalPages = 1;

  bool get _canManage =>
      !widget.viewOnly &&
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

  @override
  void initState() {
    super.initState();
    _loadLinks();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  /// Backend `GET /api/event-payment-links` returns 403 unless the caller
  /// has the SuperAdmin or Admin role — the web frontend mirrors this gate
  /// with an "Access Denied" panel for non-admins. Without the same check
  /// the Flutter screen fires the request, hits 403, and shows a misleading
  /// "Failed to load" snackbar to plain Members opening the module from the
  /// unified club view.
  bool get _isAdminRole {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    return auth.isAdmin;
  }

  Future<void> _loadLinks({int page = 1}) async {
    if (!_isAdminRole) {
      setState(() {
        _links = const [];
        _loading = false;
      });
      return;
    }
    setState(() => _loading = true);
    try {
      final search = _searchCtrl.text.trim();
      final resp = await _api.get(
        '/api/event-payment-links',
        queryParams: {
          'clubId': widget.clubId,
          if (search.isNotEmpty) 'search': search,
        },
        fromJson: (json) => json,
      );
      if (resp.data != null) {
        setState(() {
          _links = resp.data is List
              ? resp.data as List<dynamic>
              : (resp.data as Map<String, dynamic>)['items'] as List<dynamic>? ?? [];
          _currentPage = 1;
          _totalPages = 1;
        });
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to load payment links');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _delete(int id) async {
    final confirmed = await ConfirmationDialog.show(
      context,
      title: 'Delete Payment Link',
      message: 'Are you sure you want to delete this payment link?',
    );
    if (confirmed != true) return;
    try {
      await _api.delete('/api/event-payment-links/$id');
      SnackbarUtils.showSuccess(context, 'Payment link deleted');
      _loadLinks(page: _currentPage);
    } catch (e) {
      SnackbarUtils.showError(context, 'Failed to delete');
    }
  }

  void _openForm({Map<String, dynamic>? link}) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _PaymentLinkFormScreen(
          clubId: widget.clubId,
          link: link,
          onSaved: () => _loadLinks(page: _currentPage),
        ),
      ),
    );
  }

  void _viewParticipants(Map<String, dynamic> link) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => _ParticipantsScreen(
          clubId: widget.clubId,
          linkId: link['id'] as int,
          linkName: (link['title'] ?? link['name'])?.toString() ?? 'Event',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canManage = _canManage;
    if (!_isAdminRole) {
      return Scaffold(
        appBar:
            widget.embedded ? null : const CustomAppBar(title: 'Event Payment Links'),
        body: const EmptyStateWidget(
          icon: Icons.lock_outline,
          title: 'Admin Only',
          subtitle:
              'Event Payment Links are managed by club and district admins. '
              'Members do not have access to this module.',
        ),
      );
    }
    return Scaffold(
      appBar: widget.embedded ? null : const CustomAppBar(title: 'Event Payment Links'),
      floatingActionButton: canManage
          ? FloatingActionButton(
              onPressed: () => _openForm(),
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.add, color: Colors.white),
            )
          : null,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              controller: _searchCtrl,
              decoration: InputDecoration(
                hintText: 'Search by title...',
                prefixIcon: const Icon(Icons.search, size: 20),
                suffixIcon: ValueListenableBuilder<TextEditingValue>(
                  valueListenable: _searchCtrl,
                  builder: (_, value, __) => value.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear, size: 18),
                          onPressed: () {
                            _searchCtrl.clear();
                            _loadLinks();
                          },
                        )
                      : const SizedBox.shrink(),
                ),
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
              ),
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _loadLinks(),
            ),
          ),
          Expanded(
            child: _loading
                ? const LoadingWidget()
                : _links.isEmpty
                    ? const EmptyStateWidget(title: 'No event payment links found')
                    : RefreshIndicator(
                        onRefresh: () => _loadLinks(page: _currentPage),
                        child: Column(
                          children: [
                            Expanded(
                              child: ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: _links.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (_, i) => _buildLinkCard(_links[i], canManage),
                        ),
                      ),
                      if (_totalPages > 1)
                        PaginationWidget(
                          currentPage: _currentPage,
                          totalPages: _totalPages,
                          totalCount: 0,
                          onLoadMore: () => _loadLinks(page: _currentPage + 1),
                        ),
                    ],
                  ),
                ),
          ),
        ],
      ),
    );
  }

  Widget _buildLinkCard(Map<String, dynamic> link, bool canManage) {
    final isActive = link['isActive'] as bool? ?? false;
    final title = (link['title'] ?? link['name'])?.toString() ?? '';
    final formType = link['formType']?.toString() ?? '';
    final createdDate = (link['createdDate'] ?? link['eventDate'])?.toString();
    final registrationCount = link['registrationCount'] as int? ?? 0;
    final paidCount = link['paidCount'] as int? ?? 0;
    final unpaidCount = link['unpaidCount'] as int? ?? 0;

    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        onTap: () => _viewParticipants(link as Map<String, dynamic>),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style:
                          AppTextStyles.body.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: isActive
                          ? Colors.green.withOpacity(0.15)
                          : Colors.grey.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      isActive ? 'ACTIVE' : 'INACTIVE',
                      style: AppTextStyles.caption.copyWith(
                        color: isActive ? Colors.green : Colors.grey,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  if (formType.isNotEmpty)
                    Text(
                      formType,
                      style: AppTextStyles.body.copyWith(
                        color: AppColors.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  if (createdDate != null) ...[
                    const SizedBox(width: 16),
                    const Icon(Icons.event, size: 14, color: Colors.grey),
                    const SizedBox(width: 4),
                    Text(DateFormatter.toDisplay(DateTime.tryParse(createdDate)),
                        style:
                            AppTextStyles.caption.copyWith(color: Colors.grey[600])),
                  ],
                  const Spacer(),
                  const Icon(Icons.people_outline, size: 14, color: Colors.grey),
                  const SizedBox(width: 4),
                  Text('$registrationCount reg · $paidCount paid · $unpaidCount unpaid',
                      style: AppTextStyles.caption.copyWith(color: Colors.grey[600])),
                ],
              ),
              const Divider(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton.icon(
                    icon: const Icon(Icons.people, size: 16),
                    label: const Text('Participants'),
                    onPressed: () => _viewParticipants(link as Map<String, dynamic>),
                  ),
                  PopupMenuButton<String>(
                    icon: Icon(Icons.assessment_outlined, size: 18, color: Colors.grey[600]),
                    tooltip: 'Report',
                    onSelected: (value) async {
                      final linkId = link['id'] as int;
                      final reportUrl =
                          '${ApiConstants.baseUrl}/api/event-payment-links/$linkId/report';
                      if (value == 'view_report') {
                        final uri = Uri.parse(reportUrl);
                        if (await canLaunchUrl(uri)) {
                          await launchUrl(uri, mode: LaunchMode.externalApplication);
                        } else {
                          if (mounted) {
                            SnackbarUtils.showError(context, 'Could not open report');
                          }
                        }
                      } else if (value == 'copy_report') {
                        await Clipboard.setData(ClipboardData(text: reportUrl));
                        if (mounted) {
                          SnackbarUtils.showSuccess(context, 'Report link copied');
                        }
                      }
                    },
                    itemBuilder: (_) => const [
                      PopupMenuItem(
                        value: 'view_report',
                        child: ListTile(
                          leading: Icon(Icons.open_in_new, size: 18),
                          title: Text('View Report'),
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                        ),
                      ),
                      PopupMenuItem(
                        value: 'copy_report',
                        child: ListTile(
                          leading: Icon(Icons.copy, size: 18),
                          title: Text('Copy Report Link'),
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                        ),
                      ),
                    ],
                  ),
                  if (canManage) ...[
                    IconButton(
                      icon: const Icon(Icons.edit_outlined, size: 18),
                      onPressed: () => _openForm(link: link as Map<String, dynamic>),
                      color: Colors.grey[600],
                    ),
                    IconButton(
                      icon: const Icon(Icons.delete_outline, size: 18),
                      onPressed: () => _delete(link['id'] as int),
                      color: Colors.red[400],
                    ),
                  ],
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

class _PaymentLinkFormScreen extends StatefulWidget {
  final int clubId;
  final Map<String, dynamic>? link;
  final VoidCallback onSaved;

  const _PaymentLinkFormScreen(
      {required this.clubId, required this.onSaved, this.link});

  @override
  State<_PaymentLinkFormScreen> createState() => _PaymentLinkFormScreenState();
}

class _PaymentLinkFormScreenState extends State<_PaymentLinkFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _amountCtrl = TextEditingController();
  final _maxParticipantsCtrl = TextEditingController();
  DateTime? _eventDate;
  bool _isActive = true;
  bool _saving = false;
  String? _eventLogoPath;
  String? _eventLogoName;

  bool get _isEdit => widget.link != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      _nameCtrl.text = (widget.link!['title'] ?? widget.link!['name'])?.toString() ?? '';
      _descCtrl.text = widget.link!['description']?.toString() ?? '';
      _amountCtrl.text = widget.link!['amount']?.toString() ?? '';
      _maxParticipantsCtrl.text =
          widget.link!['maxParticipants']?.toString() ?? '';
      _isActive = widget.link!['isActive'] as bool? ?? true;
      final ed = (widget.link!['createdDate'] ?? widget.link!['eventDate'])?.toString();
      if (ed != null) _eventDate = DateTime.tryParse(ed);
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _descCtrl.dispose();
    _amountCtrl.dispose();
    _maxParticipantsCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickEventDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _eventDate ?? DateTime.now(),
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null) setState(() => _eventDate = picked);
  }

  Future<void> _pickEventLogo() async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(source: ImageSource.gallery, maxWidth: 2560, maxHeight: 2560);
      if (picked == null) return;
      setState(() {
        _eventLogoPath = picked.path;
        _eventLogoName = picked.name;
      });
    } catch (e) {
      SnackbarUtils.showError(context, 'Failed to pick image');
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      // Multipart create/update: text fields + optional eventLogo file.
      final fields = <String, String>{
        'title': _nameCtrl.text.trim(),
        'formType': 'EVENT',
        'description': _descCtrl.text.trim(),
        'amount': (double.tryParse(_amountCtrl.text.trim()) ?? 0).toString(),
        'isActive': _isActive.toString(),
        'clubId': widget.clubId.toString(),
        if (_eventDate != null)
          'eventDate': _eventDate!.toIso8601String().split('T')[0],
        if (_maxParticipantsCtrl.text.isNotEmpty)
          'maxParticipants': _maxParticipantsCtrl.text.trim(),
      };
      final files = <String, String>{
        if (_eventLogoPath != null && _eventLogoPath!.isNotEmpty)
          'eventLogo': _eventLogoPath!,
      };
      if (_isEdit) {
        await _api.sendMultipart(
          '/api/event-payment-links/${widget.link!['id']}',
          method: 'PUT',
          fields: fields,
          files: files,
        );
      } else {
        await _api.sendMultipart(
          '/api/event-payment-links',
          method: 'POST',
          queryParams: {'clubId': widget.clubId},
          fields: fields,
          files: files,
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
      backgroundColor: Colors.white,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Payment Link' : 'Create Payment Link',
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            children: [
                      CustomTextField(
                        controller: _nameCtrl,
                        label: 'Name *',
                        validator: (v) =>
                            v == null || v.trim().isEmpty ? 'Required' : null,
                      ),
                      const SizedBox(height: 16),
                      CustomTextField(
                        controller: _descCtrl,
                        label: 'Description',
                        maxLines: 3,
                      ),
                      const SizedBox(height: 16),
                      CustomTextField(
                        controller: _amountCtrl,
                        label: 'Amount (${currencySymbolFor(null)}) *',
                        keyboardType: TextInputType.number,
                        validator: (v) =>
                            v == null || v.trim().isEmpty ? 'Required' : null,
                      ),
                      const SizedBox(height: 16),
                      GestureDetector(
                        onTap: _pickEventDate,
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
                                    Text('Event Date',
                                        style: AppTextStyles.caption
                                            .copyWith(color: Colors.grey[600])),
                                    const SizedBox(height: 2),
                                    Text(
                                      _eventDate != null
                                          ? DateFormatter.toDisplay(_eventDate)
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
                        controller: _maxParticipantsCtrl,
                        label: 'Max Participants (optional)',
                        keyboardType: TextInputType.number,
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        icon: const Icon(Icons.image_outlined, size: 18),
                        label: Text(_eventLogoName ?? _eventLogoPath?.split('/').last ?? 'Pick Event Logo (optional)'),
                        onPressed: _pickEventLogo,
                      ),
                      const SizedBox(height: 8),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        value: _isActive,
                        activeColor: AppColors.primary,
                        onChanged: (v) => setState(() => _isActive = v),
                        title: Text('Active', style: AppTextStyles.body),
                      ),
              const SizedBox(height: 16),
              CustomButton(
                label: _isEdit ? 'Update' : 'Create Link',
                onPressed: _saving ? null : _save,
                isLoading: _saving,
                fullWidth: true,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Participants Screen ───────────────────────────────────────────────────────

class _ParticipantsScreen extends StatefulWidget {
  final int clubId;
  final int linkId;
  final String linkName;

  const _ParticipantsScreen(
      {required this.clubId, required this.linkId, required this.linkName});

  @override
  State<_ParticipantsScreen> createState() => _ParticipantsScreenState();
}

class _ParticipantsScreenState extends State<_ParticipantsScreen> {
  final _api = ApiClient();
  List<dynamic> _participants = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadParticipants();
  }

  Future<void> _loadParticipants() async {
    setState(() => _loading = true);
    try {
      final resp = await _api.get(
        '/api/event-payment-links/${widget.linkId}/members',
        fromJson: (j) => j,
      );
      setState(() {
        _participants = resp.data is List
            ? resp.data as List<dynamic>
            : (resp.data as Map<String, dynamic>?)?['items'] as List<dynamic>? ?? [];
      });
    } catch (e) {
      SnackbarUtils.showError(context, 'Failed to load participants');
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _sendReceipt(int memberPaymentId) async {
    try {
      await _api.post(
        '/api/event-payment-links/members/$memberPaymentId/send-receipt',
      );
      if (mounted) SnackbarUtils.showSuccess(context, 'Receipt sent');
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed: $e');
    }
  }

  Future<void> _sendReminder(int memberPaymentId, String channel) async {
    const path = 'send-reminder-email';
    try {
      await _api.post(
        '/api/event-payment-links/members/$memberPaymentId/$path',
      );
      if (mounted) SnackbarUtils.showSuccess(context, 'Reminder sent via $channel');
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed: $e');
    }
  }

  Future<void> _bulkReminder(String channel) async {
    const path = 'bulk-reminder-email';
    final ok = await ConfirmationDialog.show(
      context,
      title: 'Send bulk reminders?',
      message: 'Send $channel reminder to all unpaid participants?',
    );
    if (!ok) return;
    try {
      await _api.post(
        '/api/event-payment-links/${widget.linkId}/members/$path',
      );
      if (mounted) {
        SnackbarUtils.showSuccess(context, 'Bulk $channel reminders sent');
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed: $e');
    }
  }

  Future<void> _openOfflinePayment(int memberPaymentId, String memberName) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _OfflinePaymentDialog(
        clubId: widget.clubId,
        linkId: widget.linkId,
        memberPaymentId: memberPaymentId,
        memberName: memberName,
      ),
    );
    if (saved == true) await _loadParticipants();
  }

  @override
  Widget build(BuildContext context) {
    final isClubAdmin =
        context.watch<AuthProvider>().isClubAdminOf(widget.clubId);
    return Scaffold(
      appBar: CustomAppBar(
        title: 'Participants – ${widget.linkName}',
        actions: isClubAdmin
            ? [
                PopupMenuButton<String>(
                  icon: const Icon(Icons.campaign_outlined),
                  tooltip: 'Bulk reminders',
                  onSelected: (v) => _bulkReminder(v),
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'email', child: Text('Bulk Reminder (Email)')),
                  ],
                ),
              ]
            : null,
      ),
      body: _loading
          ? const LoadingWidget()
          : _participants.isEmpty
              ? const EmptyStateWidget(title: 'No participants yet')
              : ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: _participants.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final p = _participants[i] as Map<String, dynamic>;
                    final name = p['name']?.toString() ?? '-';
                    final memberPaymentId = (p['memberPaymentId'] ??
                            p['id'] ??
                            p['memberFeeId']) as int?;
                    final isPaid = p['paidAt'] != null ||
                        (p['isPaid'] == true) ||
                        (p['paymentStatus']?.toString().toLowerCase() == 'paid');
                    return ListTile(
                      leading: CircleAvatar(
                        child: Text(
                          name.isNotEmpty ? name[0].toUpperCase() : '?',
                        ),
                      ),
                      title: Text(name, style: AppTextStyles.body),
                      subtitle: Text(p['email']?.toString() ?? '',
                          style: AppTextStyles.caption),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (isPaid)
                            const Padding(
                              padding: EdgeInsets.only(right: 4),
                              child: Icon(Icons.check_circle,
                                  color: Colors.green, size: 18),
                            ),
                          if (isClubAdmin && memberPaymentId != null)
                            PopupMenuButton<String>(
                              icon: const Icon(Icons.more_vert, size: 20),
                              onSelected: (v) {
                                switch (v) {
                                  case 'offline':
                                    _openOfflinePayment(memberPaymentId, name);
                                    break;
                                  case 'receipt':
                                    _sendReceipt(memberPaymentId);
                                    break;
                                  case 'email':
                                    _sendReminder(memberPaymentId, 'email');
                                    break;
                                }
                              },
                              itemBuilder: (_) => [
                                if (!isPaid)
                                  const PopupMenuItem(
                                      value: 'offline',
                                      child: Text('Record Offline Payment')),
                                if (isPaid)
                                  const PopupMenuItem(
                                      value: 'receipt',
                                      child: Text('Send Receipt')),
                                if (!isPaid)
                                  const PopupMenuItem(
                                      value: 'email',
                                      child: Text('Send Reminder (Email)')),
                              ],
                            ),
                        ],
                      ),
                    );
                  },
                ),
    );
  }
}

// ---------------------------------------------------------------------------
// Offline Payment Dialog — multipart POST with payment details + optional attachment
// ---------------------------------------------------------------------------
class _OfflinePaymentDialog extends StatefulWidget {
  final int clubId;
  final int linkId;
  final int memberPaymentId;
  final String memberName;

  const _OfflinePaymentDialog({
    required this.clubId,
    required this.linkId,
    required this.memberPaymentId,
    required this.memberName,
  });

  @override
  State<_OfflinePaymentDialog> createState() => _OfflinePaymentDialogState();
}

class _OfflinePaymentDialogState extends State<_OfflinePaymentDialog> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _transactionIdCtrl = TextEditingController();
  final _givenToCtrl = TextEditingController();
  final _bankNameCtrl = TextEditingController();
  final _chequeNumberCtrl = TextEditingController();
  final _remarkCtrl = TextEditingController();

  String _transactionType = 'Cash';
  static const _types = ['Cash', 'Cheque', 'Bank Transfer', 'UPI', 'Other'];

  DateTime _paymentDate = DateTime.now();
  bool _sendEmail = true;
  bool _saving = false;

  String? _attachmentPath;
  String? _attachmentName;

  @override
  void dispose() {
    _transactionIdCtrl.dispose();
    _givenToCtrl.dispose();
    _bankNameCtrl.dispose();
    _chequeNumberCtrl.dispose();
    _remarkCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickAttachment() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png'],
    );
    if (result == null || result.files.isEmpty) return;
    final f = result.files.first;
    if (f.path == null) return;
    setState(() {
      _attachmentPath = f.path;
      _attachmentName = f.name;
    });
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final fields = <String, String>{
        'memberPaymentId': widget.memberPaymentId.toString(),
        'transactionType': _transactionType,
        'transactionId': _transactionIdCtrl.text.trim(),
        'givenTo': _givenToCtrl.text.trim(),
        'bankName': _bankNameCtrl.text.trim(),
        'chequeNumber': _chequeNumberCtrl.text.trim(),
        'paymentDate': DateFormat('yyyy-MM-dd').format(_paymentDate),
        'remark': _remarkCtrl.text.trim(),
        'sendEmail': _sendEmail.toString(),
      };
      await _api.sendMultipart(
        '/api/event-payment-links/${widget.linkId}/members/offline-payment',
        method: 'POST',
        fields: fields,
        files: _attachmentPath != null
            ? {'attachment': _attachmentPath!}
            : null,
        fromJson: (j) => j,
      );
      if (mounted) {
        Navigator.of(context).pop(true);
        SnackbarUtils.showSuccess(context, 'Offline payment recorded');
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('Offline Payment: ${widget.memberName}'),
      content: SizedBox(
        width: double.maxFinite,
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  value: _transactionType,
                  decoration: const InputDecoration(
                    labelText: 'Transaction Type',
                    isDense: true,
                  ),
                  items: _types
                      .map((t) => DropdownMenuItem(value: t, child: Text(t)))
                      .toList(),
                  onChanged: (v) => setState(() =>
                      _transactionType = v ?? _transactionType),
                ),
                const SizedBox(height: 10),
                CustomTextField(
                  controller: _transactionIdCtrl,
                  label: 'Transaction ID',
                ),
                const SizedBox(height: 10),
                CustomTextField(
                  controller: _givenToCtrl,
                  label: 'Given To',
                ),
                const SizedBox(height: 10),
                CustomTextField(
                  controller: _bankNameCtrl,
                  label: 'Bank Name (if applicable)',
                ),
                const SizedBox(height: 10),
                CustomTextField(
                  controller: _chequeNumberCtrl,
                  label: 'Cheque Number (if applicable)',
                ),
                const SizedBox(height: 10),
                InkWell(
                  onTap: () async {
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: _paymentDate,
                      firstDate: DateTime(2000),
                      lastDate: DateTime.now(),
                    );
                    if (picked != null) {
                      setState(() => _paymentDate = picked);
                    }
                  },
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'Payment Date',
                      isDense: true,
                    ),
                    child: Text(
                      DateFormat('dd MMM yyyy').format(_paymentDate),
                      style: AppTextStyles.body,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                CustomTextField(
                  controller: _remarkCtrl,
                  label: 'Remark',
                  maxLines: 2,
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  icon: const Icon(Icons.attach_file, size: 16),
                  label: Text(_attachmentName ?? 'Attach receipt / proof (optional)',
                      overflow: TextOverflow.ellipsis),
                  onPressed: _pickAttachment,
                ),
                SwitchListTile(
                  value: _sendEmail,
                  onChanged: (v) => setState(() => _sendEmail = v),
                  title: const Text('Send confirmation email'),
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        CustomButton(
          label: 'Save',
          onPressed: _saving ? null : _submit,
          isLoading: _saving,
          height: 36,
          padding: const EdgeInsets.symmetric(horizontal: 20),
        ),
      ],
    );
  }
}
