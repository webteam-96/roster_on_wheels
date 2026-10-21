import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../providers/auth_provider.dart';
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
import '../../../../../presentation/widgets/common/rotary_year_bar.dart';

class TrfScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  final bool viewOnly;
  const TrfScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<TrfScreen> createState() => _TrfScreenState();
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

class _RotaryYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const _RotaryYear({required this.id, required this.yearLabel, this.isCurrent = false});

  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: _asBool(j['isCurrent']),
      );
}

class _TrfScreenState extends State<TrfScreen> {
  final _api = ApiClient();

  List<dynamic> _contributions = [];
  List<dynamic> _allContributions = [];
  List<_RotaryYear> _years = [];
  int? _selectedYearId;
  List<dynamic> _funds = [];
  bool _loading = true;
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  Future<void> _loadInitial() async {
    await Future.wait<void>([_loadYears(), _loadFunds()]);
    await _loadContributions();
  }

  Future<void> _loadYears() async {
    List<_RotaryYear> years = [];
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/rotary-years',
        fromJson: (j) => j as List<dynamic>,
      );
      years = (resp.data ?? [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      years = [];
    }
    final current = years.firstWhere(
      (y) => y.isCurrent,
      orElse: () => years.isNotEmpty ? years.first : const _RotaryYear(id: 0, yearLabel: ''),
    );
    if (!mounted) return;
    setState(() {
      _years = years;
      _selectedYearId = current.id != 0 ? current.id : null;
    });
  }

  Future<void> _loadFunds() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/trf/funds',
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      setState(() => _funds = resp.data ?? []);
    } catch (_) {
      // Silently ignore
    }
  }

  Future<void> _loadContributions() async {
    setState(() => _loading = true);
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/trf',
        queryParams: {'yearId': _selectedYearId ?? 0},
        fromJson: (json) => json,
      );
      if (resp.data != null) {
        final list = resp.data is List
            ? resp.data as List<dynamic>
            : (resp.data as Map<String, dynamic>)['items'] as List<dynamic>? ?? [];
        setState(() {
          _allContributions = list;
          _applySearch();
        });
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to load TRF contributions');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _applySearch() {
    final q = _searchQuery.toLowerCase().trim();
    if (q.isEmpty) {
      _contributions = List.from(_allContributions);
    } else {
      _contributions = _allContributions.where((c) {
        final donor = (c['donorName'] ?? '').toString().toLowerCase();
        final fund = (c['fundType'] ?? '').toString().toLowerCase();
        final amount = (c['amountUSD'] ?? '').toString().toLowerCase();
        final date = (c['trfDate'] ?? '').toString();
        final formattedDate = date.isNotEmpty
            ? DateFormatter.toDisplay(DateTime.tryParse(date)).toLowerCase()
            : '';
        return donor.contains(q) ||
            fund.contains(q) ||
            amount.contains(q) ||
            formattedDate.contains(q);
      }).toList();
    }
  }

  double get _totalAmount {
    double total = 0;
    for (final c in _contributions) {
      final amt = c['amountUSD'];
      if (amt is num) {
        total += amt.toDouble();
      } else if (amt is String) {
        total += double.tryParse(amt) ?? 0;
      }
    }
    return total;
  }

  Future<void> _delete(int id) async {
    final confirmed = await ConfirmationDialog.show(
      context,
      title: 'Delete Contribution',
      message: 'Are you sure you want to delete this TRF contribution?',
    );
    if (confirmed != true) return;
    try {
      await _api.delete('/api/clubs/${widget.clubId}/trf/$id');
      if (mounted) SnackbarUtils.showSuccess(context, 'Contribution deleted');
      _loadContributions();
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to delete');
    }
  }

  void _openForm({Map<String, dynamic>? contribution}) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TrfContributionFormScreen(
          clubId: widget.clubId,
          contribution: contribution,
          yearId: _selectedYearId ?? 0,
          funds: _funds,
          onSaved: () => _loadContributions(),
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
      appBar: widget.embedded ? null : const CustomAppBar(title: 'TRF Contributions'),
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
          if (_years.isNotEmpty)
            RotaryYearBar<int>(
              value: _selectedYearId,
              options: [
                for (final y in _years)
                  RotaryYearOption(
                      value: y.id, label: y.yearLabel, isCurrent: y.isCurrent),
              ],
              onChanged: (v) {
                setState(() => _selectedYearId = v);
                _loadContributions();
              },
            ),
          // Client-side search
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Search by donor, fund, amount...',
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
                : _contributions.isEmpty
                    ? const EmptyStateWidget(title: 'No TRF contributions')
                    : RefreshIndicator(
                        onRefresh: () => _loadContributions(),
                        child: ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: _contributions.length + 1, // +1 for total row
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (_, i) {
                            if (i == _contributions.length) {
                              return _buildTotalRow();
                            }
                            return _buildCard(_contributions[i], i);
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _buildTotalRow() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: Colors.grey.shade300)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text('Total',
              style: AppTextStyles.body.copyWith(fontWeight: FontWeight.w600)),
          Text(
            '${_totalAmount.toStringAsFixed(_totalAmount.truncateToDouble() == _totalAmount ? 0 : 2)} USD',
            style: AppTextStyles.body.copyWith(fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }

  Widget _buildCard(Map<String, dynamic> c, int index) {
    final amount = (c['amountUSD'] ?? c['amount']);
    final date = (c['trfDate'] ?? c['contributionDate'])?.toString();
    final fundType = (c['fundType'] ?? c['category'])?.toString() ?? '';
    final donorName = (c['donorName'] ?? c['memberName'])?.toString() ?? 'Unknown';
    final otherFundName = (c['otherFundName'])?.toString();
    // If fund is "Others", show otherFundName or "Others"
    final displayFund = fundType.toLowerCase() == 'others'
        ? (otherFundName != null && otherFundName.isNotEmpty ? otherFundName : 'Others')
        : fundType;

    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.amber.withOpacity(0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                '${index + 1}',
                style: AppTextStyles.body.copyWith(
                  fontWeight: FontWeight.w700,
                  color: Colors.amber.shade800,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    donorName,
                    style: AppTextStyles.body.copyWith(fontWeight: FontWeight.w500),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Text(
                        '\$${amount?.toString() ?? '0'}',
                        style: AppTextStyles.caption.copyWith(
                          color: AppColors.primary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      if (displayFund.isNotEmpty) ...[
                        const SizedBox(width: 8),
                        Flexible(
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: Colors.blue.withOpacity(0.1),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(displayFund,
                                style: AppTextStyles.caption
                                    .copyWith(color: Colors.blue),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis),
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (date != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      DateFormatter.toDisplay(DateTime.tryParse(date)),
                      style: AppTextStyles.caption.copyWith(color: Colors.grey[600]),
                    ),
                  ],
                ],
              ),
            ),
            if (canManage)
              PopupMenuButton<String>(
                onSelected: (v) {
                  if (v == 'edit') _openForm(contribution: c);
                  if (v == 'delete') _delete(c['id'] as int);
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

/// Add / edit form for a single TRF contribution. Public so it can be reused
/// from the Club Overview → Foundation tab's inline records list as well as the
/// standalone [TrfScreen].
class TrfContributionFormScreen extends StatefulWidget {
  final int clubId;
  final int yearId;
  final Map<String, dynamic>? contribution;
  final List<dynamic> funds;
  final VoidCallback onSaved;

  const TrfContributionFormScreen({
    super.key,
    required this.clubId,
    required this.onSaved,
    required this.yearId,
    required this.funds,
    this.contribution,
  });

  @override
  State<TrfContributionFormScreen> createState() =>
      _TrfContributionFormScreenState();
}

class _TrfContributionFormScreenState
    extends State<TrfContributionFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _donorNameCtrl = TextEditingController();
  final _amountCtrl = TextEditingController();
  final _otherFundCtrl = TextEditingController();

  int? _fundId;
  DateTime? _trfDate;
  bool _saving = false;

  bool get _isEdit => widget.contribution != null;
  bool get _isOthersFund {
    if (_fundId == null) return false;
    final fund = widget.funds.cast<Map<String, dynamic>>().firstWhere(
      (f) => f['id'] == _fundId,
      orElse: () => <String, dynamic>{},
    );
    final name = (fund['fundName'] ?? fund['name'] ?? '').toString().toLowerCase();
    return name.contains('other');
  }

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      final c = widget.contribution!;
      _donorNameCtrl.text =
          (c['donorName'] ?? c['memberName'] ?? '').toString();
      _amountCtrl.text =
          (c['amountUSD'] ?? c['amount'] ?? '').toString();
      _fundId = (c['fundId'] as num?)?.toInt();
      _otherFundCtrl.text = (c['otherFundName'] ?? '').toString();
      final cd =
          (c['trfDate'] ?? c['contributionDate'])?.toString();
      if (cd != null) _trfDate = DateTime.tryParse(cd);
    }
  }

  @override
  void dispose() {
    _donorNameCtrl.dispose();
    _amountCtrl.dispose();
    _otherFundCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _trfDate ?? DateTime.now(),
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null) setState(() => _trfDate = picked);
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_trfDate == null) {
      SnackbarUtils.showError(context, 'Please select a date');
      return;
    }
    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'donorName': _donorNameCtrl.text.trim(),
        'amountUSD': double.tryParse(_amountCtrl.text.trim()) ?? 0,
        'fundId': _fundId ?? 0,
        'trfDate': _trfDate!.toIso8601String().split('T')[0],
        if (_isOthersFund && _otherFundCtrl.text.trim().isNotEmpty)
          'otherFundName': _otherFundCtrl.text.trim()
        else
          'otherFundName': null,
      };
      if (_isEdit) {
        // yearId not sent on update per spec
        await _api.put(
          '/api/clubs/${widget.clubId}/trf/${widget.contribution!['id']}',
          body: body,
        );
      } else {
        // yearId sent only on create
        body['yearId'] = widget.yearId;
        await _api.post(
            '/api/clubs/${widget.clubId}/trf', body: body);
      }
      if (mounted) {
        SnackbarUtils.showSuccess(context, _isEdit ? 'Updated' : 'Added');
        Navigator.pop(context);
        widget.onSaved();
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to save');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit TRF Contribution' : 'Add TRF Contribution',
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            children: [
                      // TRF Date (required)
                      GestureDetector(
                        onTap: _pickDate,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 14),
                          decoration: BoxDecoration(
                            border:
                                Border.all(color: Colors.grey[400]!),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.start,
                                  children: [
                                    Text('Date & Time *',
                                        style: AppTextStyles.caption
                                            .copyWith(
                                                color:
                                                    Colors.grey[600])),
                                    Text(
                                      _trfDate != null
                                          ? DateFormatter.toDisplay(
                                              _trfDate)
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

                      // Donor Name (free text, maxLength=200)
                      CustomTextField(
                        controller: _donorNameCtrl,
                        label: 'Name *',
                        hint: 'Enter donor name',
                        maxLength: 200,
                        validator: (v) => v == null || v.trim().isEmpty
                            ? 'Required'
                            : null,
                      ),
                      const SizedBox(height: 16),

                      // Amount USD (>= 0)
                      CustomTextField(
                        controller: _amountCtrl,
                        label: 'Amount USD *',
                        keyboardType: TextInputType.number,
                        validator: (v) {
                          if (v == null || v.trim().isEmpty) return 'Required';
                          final parsed = double.tryParse(v.trim());
                          if (parsed == null || parsed < 0) return 'Must be >= 0';
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),

                      // Fund dropdown (active only)
                      DropdownButtonFormField<int>(
                        value: widget.funds
                                .cast<Map<String, dynamic>>()
                                .any((f) => f['id'] == _fundId)
                            ? _fundId
                            : null,
                        isExpanded: true,
                        decoration: InputDecoration(
                          labelText: 'Fund Type *',
                          border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8)),
                        ),
                        items: widget.funds
                            .cast<Map<String, dynamic>>()
                            .where((f) =>
                                _asBool(f['isActive'] ?? true))
                            .map((f) => DropdownMenuItem<int>(
                                  value: f['id'] as int?,
                                  child: Text(
                                    (f['fundName'] ?? f['name'] ?? '')
                                        .toString(),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ))
                            .toList(),
                        onChanged: (v) =>
                            setState(() => _fundId = v),
                        validator: (v) =>
                            v == null ? 'Please select a fund' : null,
                      ),
                      const SizedBox(height: 16),

                      // Other Fund Name (conditional)
                      if (_isOthersFund) ...[
                        CustomTextField(
                          controller: _otherFundCtrl,
                          label: 'Fund Name *',
                          hint: 'Specify the fund name',
                          validator: (v) =>
                              v == null || v.trim().isEmpty
                                  ? 'Required for Others'
                                  : null,
                        ),
                        const SizedBox(height: 16),
                      ],

                      const SizedBox(height: 8),
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
                              label:
                                  _isEdit ? 'Update' : 'Add',
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
            );
  }
}
