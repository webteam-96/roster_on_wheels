import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_button.dart';
import '../../widgets/common/custom_text_field.dart';
import '../../widgets/common/confirmation_dialog.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import '../../widgets/common/custom_drawer.dart';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
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
  final String yearName;
  final DateTime? startDate;
  final DateTime? endDate;
  final bool isCurrent;

  const _RotaryYear({
    required this.id,
    required this.yearName,
    this.startDate,
    this.endDate,
    this.isCurrent = false,
  });

  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: j['id'] as int? ?? 0,
        yearName: j['yearName'] as String? ?? j['name'] as String? ?? '',
        startDate: j['startDate'] != null ? DateTime.tryParse(j['startDate'] as String) : null,
        endDate: j['endDate'] != null ? DateTime.tryParse(j['endDate'] as String) : null,
        isCurrent: _asBool(j['isCurrent']),
      );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class RotaryYearsScreen extends StatefulWidget {
  const RotaryYearsScreen({super.key});

  @override
  State<RotaryYearsScreen> createState() => _RotaryYearsScreenState();
}

class _RotaryYearsScreenState extends State<RotaryYearsScreen> {
  final _api = ApiClient();
  final _df = DateFormat('dd MMM yyyy');

  List<_RotaryYear> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/rotary-years',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final data = resp.data ?? {};
      final rawItems = data['items'] as List<dynamic>? ?? (data['data'] as List<dynamic>?) ?? [];
      setState(() {
        _items = rawItems.map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>)).toList();
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _delete(int id) async {
    try {
      await _api.delete('/api/rotary-years/$id');
      setState(() => _items.removeWhere((y) => y.id == id));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Rotary year deleted'), backgroundColor: AppColors.success),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Delete failed: $e'), backgroundColor: AppColors.error),
        );
      }
    }
  }

  void _showForm({_RotaryYear? existing}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => _RotaryYearFormSheet(
        existing: existing,
        onSaved: _fetch,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Rotary Years'),
      drawer: const CustomDrawer(),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showForm(),
        backgroundColor: AppColors.primary,
        child: const Icon(Icons.add, color: Colors.white),
      ),
      body: _loading
          ? const ShimmerList(itemCount: 6, itemHeight: 80)
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _fetch)
              : _items.isEmpty
                  ? EmptyStateWidget(
                      title: 'No Rotary Years',
                      subtitle: 'Tap + to create a new Rotary year.',
                      icon: Icons.calendar_today_outlined,
                      actionLabel: 'Add Year',
                      onAction: () => _showForm(),
                    )
                  : RefreshIndicator(
                      color: AppColors.primary,
                      onRefresh: _fetch,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _items.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (ctx, i) {
                          final item = _items[i];
                          return _RotaryYearCard(
                            item: item,
                            df: _df,
                            onEdit: () => _showForm(existing: item),
                            onDelete: () async {
                              final ok = await ConfirmationDialog.show(
                                context,
                                title: 'Delete Rotary Year',
                                message: 'Delete "${item.yearName}"?',
                              );
                              if (ok) _delete(item.id);
                            },
                          );
                        },
                      ),
                    ),
    );
  }
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
class _RotaryYearCard extends StatelessWidget {
  final _RotaryYear item;
  final DateFormat df;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _RotaryYearCard({required this.item, required this.df, required this.onEdit, required this.onDelete});

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: item.isCurrent ? AppColors.primary : AppColors.border),
      ),
      color: AppColors.surface,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: item.isCurrent ? AppColors.primaryLight : AppColors.muted,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(
                Icons.calendar_today_outlined,
                size: 20,
                color: item.isCurrent ? AppColors.primary : AppColors.textSecondary,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(item.yearName, style: AppTextStyles.bodyMedium),
                      if (item.isCurrent) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppColors.success.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            'Current',
                            style: AppTextStyles.caption.copyWith(color: AppColors.success, fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (item.startDate != null || item.endDate != null)
                    Text(
                      [
                        if (item.startDate != null) df.format(item.startDate!),
                        if (item.endDate != null) df.format(item.endDate!),
                      ].join(' - '),
                      style: AppTextStyles.caption,
                    ),
                ],
              ),
            ),
            IconButton(
              icon: const Icon(Icons.edit_outlined, size: 18, color: AppColors.primary),
              onPressed: onEdit,
              constraints: const BoxConstraints(),
              padding: const EdgeInsets.all(6),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 18, color: AppColors.error),
              onPressed: onDelete,
              constraints: const BoxConstraints(),
              padding: const EdgeInsets.all(6),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Form Sheet
// ---------------------------------------------------------------------------
class _RotaryYearFormSheet extends StatefulWidget {
  final _RotaryYear? existing;
  final VoidCallback onSaved;

  const _RotaryYearFormSheet({this.existing, required this.onSaved});

  @override
  State<_RotaryYearFormSheet> createState() => _RotaryYearFormSheetState();
}

class _RotaryYearFormSheetState extends State<_RotaryYearFormSheet> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _displayDf = DateFormat('dd MMM yyyy');
  final _isoFmt = DateFormat('yyyy-MM-dd');

  final _yearNameCtrl = TextEditingController();
  DateTime? _startDate;
  DateTime? _endDate;
  bool _isCurrent = false;
  bool _saving = false;

  bool get _isEditing => widget.existing != null;

  @override
  void initState() {
    super.initState();
    if (_isEditing) {
      final e = widget.existing!;
      _yearNameCtrl.text = e.yearName;
      _startDate = e.startDate;
      _endDate = e.endDate;
      _isCurrent = e.isCurrent;
    }
  }

  @override
  void dispose() {
    _yearNameCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool isStart}) async {
    final initial = isStart ? (_startDate ?? DateTime.now()) : (_endDate ?? DateTime.now());
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(colorScheme: const ColorScheme.light(primary: AppColors.primary)),
        child: child!,
      ),
    );
    if (picked != null) {
      setState(() { if (isStart) _startDate = picked; else _endDate = picked; });
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);

    final body = {
      'yearName': _yearNameCtrl.text.trim(),
      'isCurrent': _isCurrent,
      if (_startDate != null) 'startDate': _isoFmt.format(_startDate!),
      if (_endDate != null) 'endDate': _isoFmt.format(_endDate!),
    };

    try {
      if (_isEditing) {
        await _api.put('/api/rotary-years/${widget.existing!.id}', body: body);
      } else {
        await _api.post('/api/rotary-years', body: body);
      }
      if (mounted) {
        Navigator.of(context).pop();
        widget.onSaved();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_isEditing ? 'Rotary year updated' : 'Rotary year created'),
            backgroundColor: AppColors.success,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Save failed: $e'), backgroundColor: AppColors.error),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40, height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2)),
                ),
              ),
              Text(_isEditing ? 'Edit Rotary Year' : 'New Rotary Year', style: AppTextStyles.h3),
              const SizedBox(height: 16),
              CustomTextField(
                label: 'Year Name *',
                controller: _yearNameCtrl,
                hint: 'e.g. 2024-25',
                validator: (v) => (v == null || v.trim().isEmpty) ? 'Year name is required' : null,
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: _buildDatePicker(label: 'Start Date', date: _startDate, onTap: () => _pickDate(isStart: true))),
                  const SizedBox(width: 10),
                  Expanded(child: _buildDatePicker(label: 'End Date', date: _endDate, onTap: () => _pickDate(isStart: false))),
                ],
              ),
              const SizedBox(height: 8),
              SwitchListTile.adaptive(
                value: _isCurrent,
                onChanged: (v) => setState(() => _isCurrent = v),
                title: Text('Mark as Current Year', style: AppTextStyles.bodyMedium),
                activeColor: AppColors.primary,
                contentPadding: EdgeInsets.zero,
                dense: true,
              ),
              const SizedBox(height: 16),
              CustomButton(
                label: _isEditing ? 'Update' : 'Create',
                onPressed: _save,
                isLoading: _saving,
                fullWidth: true,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDatePicker({required String label, required DateTime? date, required VoidCallback onTap}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTextStyles.label),
        const SizedBox(height: 6),
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(8),
          child: InputDecorator(
            decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12)),
            child: Row(
              children: [
                const Icon(Icons.calendar_today_outlined, size: 14, color: AppColors.textSecondary),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    date != null ? _displayDf.format(date) : 'Select',
                    style: date != null
                        ? AppTextStyles.body
                        : AppTextStyles.body.copyWith(color: AppColors.textMuted),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
