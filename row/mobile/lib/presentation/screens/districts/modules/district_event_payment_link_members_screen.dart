import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../core/utils/snackbar_utils.dart';
import '../../../providers/auth_provider.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/custom_button.dart';
import '../../../widgets/common/custom_text_field.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/utils/money_format.dart';

enum _StatusFilter { all, paid, unpaid, pending }

class DistrictEventPaymentLinkMembersScreen extends StatefulWidget {
  final int districtId;
  final int linkId;
  final String linkTitle;
  final bool viewOnly;

  const DistrictEventPaymentLinkMembersScreen({
    super.key,
    required this.districtId,
    required this.linkId,
    required this.linkTitle,
    this.viewOnly = false,
  });

  @override
  State<DistrictEventPaymentLinkMembersScreen> createState() =>
      _DistrictEventPaymentLinkMembersScreenState();
}

class _DistrictEventPaymentLinkMembersScreenState
    extends State<DistrictEventPaymentLinkMembersScreen> {
  final _api = ApiClient();

  List<Map<String, dynamic>> _all = [];
  bool _loading = true;
  String? _error;
  _StatusFilter _filter = _StatusFilter.all;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<dynamic>(
        '/api/event-payment-links/${widget.linkId}/registrations',
        fromJson: (j) => j,
      );
      final raw = resp.data;
      List<dynamic> items = [];
      if (raw is List) {
        items = raw;
      } else if (raw is Map<String, dynamic>) {
        items = (raw['items'] as List<dynamic>?) ?? (raw['data'] as List<dynamic>?) ?? [];
      }
      _all = items
          .whereType<Map<String, dynamic>>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
    } catch (e) {
      if (!e.toString().contains('(404)')) {
        _error = e.toString();
      } else {
        _all = [];
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _statusOf(Map<String, dynamic> m) {
    final raw = (m['paymentStatus'] ?? m['status'])?.toString() ?? '';
    final s = raw.trim().toLowerCase();
    if (s.contains('paid') && !s.contains('un')) return 'Paid';
    if (s.contains('pending')) return 'Pending';
    return 'Unpaid';
  }

  List<Map<String, dynamic>> get _filtered {
    if (_filter == _StatusFilter.all) return _all;
    return _all.where((m) {
      final s = _statusOf(m);
      switch (_filter) {
        case _StatusFilter.paid:
          return s == 'Paid';
        case _StatusFilter.unpaid:
          return s == 'Unpaid';
        case _StatusFilter.pending:
          return s == 'Pending';
        default:
          return true;
      }
    }).toList();
  }

  int _countFor(_StatusFilter f) {
    if (f == _StatusFilter.all) return _all.length;
    return _all.where((m) {
      final s = _statusOf(m);
      switch (f) {
        case _StatusFilter.paid:
          return s == 'Paid';
        case _StatusFilter.unpaid:
          return s == 'Unpaid';
        case _StatusFilter.pending:
          return s == 'Pending';
        default:
          return true;
      }
    }).length;
  }

  Future<void> _openRecordPayment(Map<String, dynamic> member) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _RecordPaymentDialog(
        linkId: widget.linkId,
        member: member,
      ),
    );
    if (saved == true) _fetch();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    // Per-level gating: only district admins of THIS district can manage.
    final canAdmin =
        !widget.viewOnly && auth.isDistrictAdminOf(widget.districtId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(title: widget.linkTitle),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _filterChip(_StatusFilter.all, 'All'),
                  const SizedBox(width: 8),
                  _filterChip(_StatusFilter.paid, 'Paid'),
                  const SizedBox(width: 8),
                  _filterChip(_StatusFilter.unpaid, 'Unpaid'),
                  const SizedBox(width: 8),
                  _filterChip(_StatusFilter.pending, 'Pending'),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'Registered Members',
                style: AppTextStyles.caption.copyWith(color: Colors.grey[600]),
              ),
            ),
          ),
          Expanded(
            child: _loading
                ? const ShimmerList(itemCount: 6, itemHeight: 100)
                : _error != null
                    ? ErrorStateWidget(message: _error!, onRetry: _fetch)
                    : _filtered.isEmpty
                        ? const EmptyStateWidget(
                            title: 'No Members',
                            subtitle: 'No registrations match the selected filter.',
                            icon: Icons.people_outline,
                          )
                        : RefreshIndicator(
                            color: AppColors.primary,
                            onRefresh: _fetch,
                            child: ListView.separated(
                              padding: const EdgeInsets.all(16),
                              itemCount: _filtered.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: 8),
                              itemBuilder: (_, i) =>
                                  _memberCard(_filtered[i], canAdmin),
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _filterChip(_StatusFilter f, String label) {
    final selected = _filter == f;
    final count = _countFor(f);
    return ChoiceChip(
      selected: selected,
      label: Text('$label ($count)'),
      labelStyle: AppTextStyles.caption.copyWith(
        color: selected ? Colors.white : AppColors.textPrimary,
        fontWeight: FontWeight.w600,
      ),
      selectedColor: AppColors.primary,
      backgroundColor: AppColors.surface,
      side: const BorderSide(color: AppColors.border),
      onSelected: (_) => setState(() => _filter = f),
    );
  }

  Widget _memberCard(Map<String, dynamic> m, bool canAdmin) {
    final name = m['name']?.toString() ?? '–';
    final mobile = m['mobileNo']?.toString() ?? m['mobile']?.toString() ?? '';
    final email = m['email']?.toString() ?? '';
    final designation = m['designation']?.toString() ?? '';
    final status = _statusOf(m);
    final amount = m['amount'];
    final paidDate = m['paidDate']?.toString();

    Color fg;
    Color bg;
    switch (status) {
      case 'Paid':
        fg = AppColors.success;
        bg = AppColors.successLight;
        break;
      case 'Pending':
        fg = AppColors.warning;
        bg = AppColors.warningLight;
        break;
      default:
        fg = AppColors.error;
        bg = AppColors.errorLight;
    }

    return Card(
      elevation: 0,
      color: AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    name,
                    style: AppTextStyles.bodyMedium
                        .copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: bg,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    status.toUpperCase(),
                    style: AppTextStyles.caption.copyWith(
                      color: fg,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            if (designation.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(
                designation,
                style: AppTextStyles.caption.copyWith(color: Colors.grey[700]),
              ),
            ],
            if (mobile.isNotEmpty) ...[
              const SizedBox(height: 6),
              Row(
                children: [
                  const Icon(Icons.phone_outlined,
                      size: 14, color: Colors.grey),
                  const SizedBox(width: 4),
                  Text(mobile,
                      style: AppTextStyles.caption
                          .copyWith(color: Colors.grey[700])),
                ],
              ),
            ],
            if (email.isNotEmpty) ...[
              const SizedBox(height: 2),
              Row(
                children: [
                  const Icon(Icons.mail_outline,
                      size: 14, color: Colors.grey),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      email,
                      style: AppTextStyles.caption
                          .copyWith(color: Colors.grey[700]),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ],
            if (status == 'Paid' && amount != null) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Text(
                    formatMoney(amount, null),
                    style: AppTextStyles.bodyMedium.copyWith(
                      color: AppColors.success,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (paidDate != null) ...[
                    const SizedBox(width: 10),
                    Text(
                      DateFormatter.toDisplay(DateTime.tryParse(paidDate)),
                      style: AppTextStyles.caption
                          .copyWith(color: Colors.grey[600]),
                    ),
                  ],
                ],
              ),
            ],
            if (canAdmin && status != 'Paid') ...[
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  icon: const Icon(Icons.payments_outlined, size: 16),
                  label: const Text('Record Payment'),
                  onPressed: () => _openRecordPayment(m),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ── Record Payment Dialog ─────────────────────────────────────────────────────

class _RecordPaymentDialog extends StatefulWidget {
  final int linkId;
  final Map<String, dynamic> member;
  const _RecordPaymentDialog({required this.linkId, required this.member});

  @override
  State<_RecordPaymentDialog> createState() => _RecordPaymentDialogState();
}

class _RecordPaymentDialogState extends State<_RecordPaymentDialog> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _amountCtrl = TextEditingController();
  final _methodCtrl = TextEditingController();
  final _txnCtrl = TextEditingController();
  final _remarkCtrl = TextEditingController();
  DateTime _paidDate = DateTime.now();
  String? _proofPath;
  String? _proofName;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final expected = widget.member['amount'];
    if (expected != null) _amountCtrl.text = expected.toString();
  }

  @override
  void dispose() {
    _amountCtrl.dispose();
    _methodCtrl.dispose();
    _txnCtrl.dispose();
    _remarkCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _paidDate,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null) setState(() => _paidDate = picked);
  }

  Future<void> _pickFile() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['jpg', 'jpeg', 'png', 'pdf'],
    );
    if (result == null || result.files.isEmpty) return;
    final f = result.files.first;
    if (f.path == null) return;
    setState(() {
      _proofPath = f.path;
      _proofName = f.name;
    });
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final regId = widget.member['id'];
      final fields = <String, String>{
        'FkRegistrationId': regId?.toString() ?? '0',
        'TransactionType': _methodCtrl.text.trim(),
        if (_txnCtrl.text.trim().isNotEmpty)
          'TransactionId': _txnCtrl.text.trim(),
        if (_remarkCtrl.text.trim().isNotEmpty)
          'Remark': _remarkCtrl.text.trim(),
        'PaymentDate': _paidDate.toIso8601String().split('T')[0],
        if (widget.member['name'] != null)
          'MemberName': widget.member['name'].toString(),
        if (widget.member['mobileNo'] != null)
          'Mobile': widget.member['mobileNo'].toString(),
        if (widget.member['email'] != null)
          'Email': widget.member['email'].toString(),
      };

      if (_proofPath != null) {
        await _api.uploadFile(
          '/api/event-payment-links/${widget.linkId}/members/offline-payment',
          filePath: _proofPath!,
          fieldName: 'attachment',
          fields: fields,
        );
      } else {
        // Send multipart with no file by uploading a tiny fallback is not ideal;
        // use uploadFile only when file is present. Otherwise we must hit a
        // form-POST endpoint. The API accepts IFormFile? attachment (optional),
        // so we still need multipart. Reuse the ApiClient uploadFile by
        // providing an empty placeholder is not acceptable. Instead, perform a
        // manual multipart via uploadFile equivalent: fall back to a light
        // workaround — post a zero-byte temp is fragile. Pragmatic approach:
        // the backend accepts IFormFile? attachment, and ASP.NET reads
        // [FromForm] fields regardless of files. We do not have a multipart
        // helper without a file, so warn if no file picked.
        SnackbarUtils.showWarning(
          context,
          'Please attach a proof file to record the payment',
        );
        setState(() => _saving = false);
        return;
      }

      if (mounted) {
        SnackbarUtils.showSuccess(context, 'Payment recorded');
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) {
        SnackbarUtils.showError(context, 'Failed to record payment');
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
          child: Form(
            key: _formKey,
            autovalidateMode: AutovalidateMode.onUserInteraction,
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('Record Payment',
                      style: AppTextStyles.bodyMedium
                          .copyWith(fontWeight: FontWeight.w700, fontSize: 18)),
                  const SizedBox(height: 4),
                  Text(
                    widget.member['name']?.toString() ?? '',
                    style: AppTextStyles.caption
                        .copyWith(color: Colors.grey[600]),
                  ),
                  const SizedBox(height: 16),
                  CustomTextField(
                    controller: _amountCtrl,
                    label: 'Amount *',
                    keyboardType: TextInputType.number,
                    validator: (v) =>
                        v == null || v.trim().isEmpty ? 'Required' : null,
                  ),
                  const SizedBox(height: 12),
                  CustomTextField(
                    controller: _methodCtrl,
                    label: 'Payment Method *',
                    validator: (v) =>
                        v == null || v.trim().isEmpty ? 'Required' : null,
                  ),
                  const SizedBox(height: 12),
                  CustomTextField(
                    controller: _txnCtrl,
                    label: 'Transaction ID (optional)',
                  ),
                  const SizedBox(height: 12),
                  CustomTextField(
                    controller: _remarkCtrl,
                    label: 'Remark (optional)',
                    maxLines: 3,
                  ),
                  const SizedBox(height: 12),
                  GestureDetector(
                    onTap: _pickDate,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 14),
                      decoration: BoxDecoration(
                        border: Border.all(color: AppColors.border),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Paid Date',
                                    style: AppTextStyles.caption
                                        .copyWith(color: Colors.grey[600])),
                                const SizedBox(height: 2),
                                Text(
                                  DateFormatter.toDisplay(_paidDate),
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
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: _pickFile,
                    icon: const Icon(Icons.attach_file, size: 18),
                    label: Text(
                      _proofName ?? 'Attach Proof (image/pdf)',
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(height: 18),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: _saving
                              ? null
                              : () => Navigator.pop(context, false),
                          child: const Text('Cancel'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: CustomButton(
                          label: 'Save',
                          onPressed: _saving ? null : _save,
                          isLoading: _saving,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
