import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart' hide Text;
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/club_dues_pay_api.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../../data/models/club_dues_pay_models.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_button.dart';
import '../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/utils/money_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Records an OFFLINE (cash / cheque / transfer / UPI) club-dues payment for
/// approval. The amount is computed server-side (unpaid × rate) — this form only
/// captures the reference details + optional proof. Pops `true` on success so
/// the pay screen refreshes.
class ClubDuesOfflineScreen extends StatefulWidget {
  final int duesId;
  final int clubId;
  final ClubDuesPublic dues;

  const ClubDuesOfflineScreen({
    super.key,
    required this.duesId,
    required this.clubId,
    required this.dues,
  });

  @override
  State<ClubDuesOfflineScreen> createState() => _ClubDuesOfflineScreenState();
}

class _ClubDuesOfflineScreenState extends State<ClubDuesOfflineScreen> {
  final _api = ClubDuesPayApi();

  static const _types = ['Cash', 'Cheque', 'Bank Transfer', 'UPI', 'Other'];
  String _txnType = 'Cash';

  final _txnIdCtrl = TextEditingController();
  final _bankCtrl = TextEditingController();
  final _chequeCtrl = TextEditingController();
  final _givenToCtrl = TextEditingController();
  final _remarkCtrl = TextEditingController();

  DateTime? _paymentDate;
  String? _attachmentPath;
  String? _attachmentName;
  bool _sendReceipt = true;
  bool _saving = false;

  bool get _needsBank => _txnType == 'Cheque' || _txnType == 'Bank Transfer';
  bool get _needsCheque => _txnType == 'Cheque';

  @override
  void dispose() {
    _txnIdCtrl.dispose();
    _bankCtrl.dispose();
    _chequeCtrl.dispose();
    _givenToCtrl.dispose();
    _remarkCtrl.dispose();
    super.dispose();
  }

  String _inr(double v) => formatMoney(v, null);

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _paymentDate ?? now,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
    );
    if (picked != null) setState(() => _paymentDate = picked);
  }

  Future<void> _pickAttachment() async {
    try {
      final res = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['jpg', 'jpeg', 'png', 'pdf'],
      );
      final path = res?.files.single.path;
      if (path == null) return;
      setState(() {
        _attachmentPath = path;
        _attachmentName = res!.files.single.name;
      });
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Could not pick a file.');
    }
  }

  Future<void> _submit() async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      final fields = <String, String>{
        'transactionType': _txnType,
        if (_txnIdCtrl.text.trim().isNotEmpty)
          'transactionId': _txnIdCtrl.text.trim(),
        if (_bankCtrl.text.trim().isNotEmpty) 'bankName': _bankCtrl.text.trim(),
        if (_chequeCtrl.text.trim().isNotEmpty)
          'chequeNumber': _chequeCtrl.text.trim(),
        if (_givenToCtrl.text.trim().isNotEmpty)
          'givenTo': _givenToCtrl.text.trim(),
        if (_remarkCtrl.text.trim().isNotEmpty) 'remark': _remarkCtrl.text.trim(),
        if (_paymentDate != null)
          'paymentDate': _paymentDate!.toIso8601String(),
        'sendReceiptEmail': _sendReceipt.toString(),
      };
      final message = await _api.submitOffline(
        duesId: widget.duesId,
        clubId: widget.clubId,
        fields: fields,
        attachmentPath: _attachmentPath,
      );
      if (!mounted) return;
      SnackbarUtils.showSuccess(context, message);
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Could not submit payment.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Record Offline Payment'),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
                children: [
                  _amountBanner(),
                  const SizedBox(height: 16),
                  _typeSelector(),
                  const SizedBox(height: 14),
                  _dateField(),
                  const SizedBox(height: 14),
                  CustomTextField(
                    label: 'Reference / Transaction ID',
                    hint: 'Optional',
                    controller: _txnIdCtrl,
                    prefixIcon: Icons.tag_rounded,
                  ),
                  if (_needsBank) ...[
                    const SizedBox(height: 14),
                    CustomTextField(
                      label: 'Bank Name',
                      hint: 'Enter bank name',
                      controller: _bankCtrl,
                      prefixIcon: Icons.account_balance_outlined,
                    ),
                  ],
                  if (_needsCheque) ...[
                    const SizedBox(height: 14),
                    CustomTextField(
                      label: 'Cheque Number',
                      hint: 'Enter cheque number',
                      controller: _chequeCtrl,
                      keyboardType: TextInputType.number,
                      prefixIcon: Icons.numbers_rounded,
                    ),
                  ],
                  const SizedBox(height: 14),
                  CustomTextField(
                    label: 'Given To',
                    hint: 'Whom the payment was handed to (optional)',
                    controller: _givenToCtrl,
                    prefixIcon: Icons.person_outline_rounded,
                  ),
                  const SizedBox(height: 14),
                  CustomTextField(
                    label: 'Remark',
                    hint: 'Any note for the approver (optional)',
                    controller: _remarkCtrl,
                    maxLines: 3,
                    prefixIcon: Icons.notes_rounded,
                  ),
                  const SizedBox(height: 14),
                  _attachmentField(),
                  const SizedBox(height: 8),
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    value: _sendReceipt,
                    onChanged: (v) => setState(() => _sendReceipt = v),
                    activeThumbColor: AppColors.primaryPrime,
                    title: Text('Email a receipt on approval',
                        style: AppFonts.body(
                            fontSize: 14, fontWeight: FontWeight.w600)),
                  ),
                ],
              ),
            ),
            Container(
              decoration: const BoxDecoration(
                color: AppColors.surface,
                border: const Border(top: const BorderSide(color: AppColors.border)),
              ),
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 14),
              child: CustomButton(
                label: _saving ? 'Submitting…' : 'Submit for approval',
                icon: Icons.check_rounded,
                onPressed: _saving ? null : _submit,
                fullWidth: true,
                height: 52,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _amountBanner() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.primaryPrime.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.primaryPrime.withValues(alpha: 0.15)),
      ),
      child: Row(
        children: [
          const Icon(Icons.info_outline_rounded, color: AppColors.primaryPrime, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Amount ${_inr(widget.dues.amountOwed)} for ${widget.dues.unpaidCount} '
              'unpaid member(s). This will be submitted for approval by the district.',
              style: AppFonts.body(
                  fontSize: 12.5, color: AppColors.textSecondary, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }

  Widget _typeSelector() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Text('Payment Mode',
              style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary)),
        ),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: _types.map((t) {
            final sel = t == _txnType;
            return ChoiceChip(
              label: Text(t),
              selected: sel,
              onSelected: (_) => setState(() => _txnType = t),
              labelStyle: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: sel ? Colors.white : AppColors.textSecondary,
              ),
              selectedColor: AppColors.primaryPrime,
              backgroundColor: AppColors.surface,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(999),
                side: BorderSide(
                    color: sel ? AppColors.primaryPrime : AppColors.border),
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  Widget _dateField() {
    final label = _paymentDate == null
        ? 'Select date'
        : '${_paymentDate!.day.toString().padLeft(2, '0')}/'
            '${_paymentDate!.month.toString().padLeft(2, '0')}/'
            '${_paymentDate!.year}';
    return CustomTextField(
      label: 'Payment Date',
      hint: label,
      controller: TextEditingController(
          text: _paymentDate == null ? '' : label),
      readOnly: true,
      onTap: _pickDate,
      prefixIcon: Icons.calendar_today_outlined,
    );
  }

  Widget _attachmentField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Text('Proof (optional)',
              style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary)),
        ),
        InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: _pickAttachment,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
            decoration: BoxDecoration(
              color: AppColors.primaryPrime.withValues(alpha: 0.04),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                  color: AppColors.primaryPrime.withValues(alpha: 0.5)),
            ),
            child: Row(
              children: [
                const Icon(Icons.attach_file_rounded,
                    size: 20, color: AppColors.textSecondary),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    _attachmentName ?? 'Attach a receipt (image or PDF)',
                    style: AppFonts.body(
                        fontSize: 14,
                        color: _attachmentName == null
                            ? AppColors.textMuted
                            : AppColors.textPrimary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (_attachmentName != null)
                  GestureDetector(
                    onTap: () => setState(() {
                      _attachmentPath = null;
                      _attachmentName = null;
                    }),
                    child: const Icon(Icons.close_rounded,
                        size: 18, color: AppColors.textSecondary),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
